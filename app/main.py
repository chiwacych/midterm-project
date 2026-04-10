from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Form, Request
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import List, Optional
import hashlib
from datetime import datetime
import io
import os
import asyncio
from concurrent.futures import ThreadPoolExecutor
from prometheus_fastapi_instrumentator import Instrumentator

from database import get_db, init_db, engine, SessionLocal
from models import FileMetadata, UploadLog, ReplicationStatus, NodeHealth, User, Patient
from minio_client import minio_cluster
from auth import get_current_user, optional_user, require_roles
from consent_check import can_access_file
from redis_client import redis_cache
from replication_manager import replication_manager
from routers.auth import router as auth_router
from routers.consent import router as consent_router
from routers.audit import router as audit_router
from routers.profile import router as profile_router
from routers.compliance import router as compliance_router
from routers.access_requests import router as access_requests_router
from routers.patients import router as patients_router
from routers.federation_network import router as federation_network_router
from routers.federation_registry import router as federation_registry_router
from routers.federation_transfer import router as federation_transfer_router
import metrics
import audit
from federation_client import federation_health, federation_check_duplicate

# Thread pool for running blocking operations (reduced, replication has its own)
thread_pool = ThreadPoolExecutor(max_workers=4)

# Initialize FastAPI app
app = FastAPI(
    title="Distributed File Storage System",
    description="A fault-tolerant distributed file storage system using MinIO, PostgreSQL, and Redis with versioning support",
    version="1.2.0"
)
app.include_router(auth_router)
app.include_router(consent_router)
app.include_router(audit_router)
app.include_router(profile_router)
app.include_router(compliance_router)
app.include_router(access_requests_router)
app.include_router(patients_router)
app.include_router(federation_network_router)
app.include_router(federation_registry_router)
app.include_router(federation_transfer_router)

# CORS - Dynamic configuration
# In production, set CORS_ORIGINS environment variable
# In development, defaults to allow all localhost origins
def get_cors_origins():
    """Get CORS origins from environment or use permissive defaults for development."""
    origins_str = os.getenv("CORS_ORIGINS", "")
    if origins_str:
        return [origin.strip() for origin in origins_str.split(",") if origin.strip()]
    # Development fallback: allow common local development ports
    return [
        "http://localhost:3000",
        "http://localhost:3001", 
        "http://localhost:3002",
        "http://localhost:5173",  # Vite default
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3002",
        "http://127.0.0.1:5173",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        return response


app.add_middleware(SecurityHeadersMiddleware)

# Initialize Prometheus metrics
Instrumentator().instrument(app).expose(app)
metrics.initialize_system_info()

# Mount static files directory
os.makedirs("static", exist_ok=True)
app.mount("/static", StaticFiles(directory="static"), name="static")

# Mount frontend build directory for React SPA
frontend_dist = "/app/frontend/dist"
if os.path.exists(frontend_dist):
    assets_dir = os.path.join(frontend_dist, "assets")
    if os.path.exists(assets_dir):
        app.mount("/assets", StaticFiles(directory=assets_dir), name="frontend-assets")

# Templates
templates = Jinja2Templates(directory="templates")

# Background task flag
background_tasks_running = False


def _resolve_patient_id_for_user(db: Session, user: User) -> Optional[int]:
    """Resolve patient ID using explicit user link first, then email/phone fallback."""
    if user.patient_id:
        linked_patient = db.query(Patient).filter(Patient.id == user.patient_id).first()
        if linked_patient:
            return linked_patient.id

    match_filters = []
    if user.email:
        match_filters.append(Patient.email == user.email)
    if user.phone:
        match_filters.append(Patient.phone == user.phone)

    if not match_filters:
        return None

    patient = db.query(Patient).filter(or_(*match_filters)).first()
    return patient.id if patient else None


async def auto_sync_replication():
    """Background task to automatically sync incomplete replications using robust manager"""
    global background_tasks_running
    
    while background_tasks_running:
        try:
            print("🔄 Auto-sync: Checking for incomplete replications...")
            
            # Use the replication manager with a database session
            from database import SessionLocal
            db = SessionLocal()
            
            try:
                # Sync only recent files (last 24 hours) to avoid processing too many
                result = await replication_manager.sync_all(
                    db,
                    priority_recent=True,
                    max_age_hours=24
                )
                
                if result["status"] == "success":
                    summary = result["summary"]
                    if summary["synced"] > 0:
                        print(f"✓ Auto-sync completed: {summary['synced']} file(s) synced")
                    else:
                        print(f"✓ Auto-sync: {summary['complete']} files fully replicated, {summary['pending']} pending")
                elif result["status"] == "busy":
                    print("⏳ Auto-sync: Skipped (manual sync in progress)")
                    
            finally:
                db.close()
                
        except Exception as e:
            print(f"✗ Auto-sync error: {str(e)}")
        
        # Wait 30 seconds before next check
        await asyncio.sleep(30)


async def periodic_node_health_check():
    """Background task to check node health every 60 seconds"""
    print("🏥 Starting periodic node health monitoring...")
    
    while background_tasks_running:
        try:
            db = SessionLocal()
            try:
                node_health = minio_cluster.get_node_health()
                for node_name, health_data in node_health.items():
                    node_record = db.query(NodeHealth).filter(NodeHealth.node_name == node_name).first()
                    if node_record:
                        node_record.is_healthy = health_data["healthy"]
                        node_record.last_check = datetime.utcnow()
                        node_record.total_files = health_data.get("total_files", 0)
                        node_record.total_size = health_data.get("total_size", 0)
                    else:
                        node_record = NodeHealth(
                            node_name=node_name,
                            endpoint=health_data["endpoint"],
                            is_healthy=health_data["healthy"],
                            last_check=datetime.utcnow(),
                            total_files=health_data.get("total_files", 0),
                            total_size=health_data.get("total_size", 0)
                        )
                        db.add(node_record)
                db.commit()
                
            finally:
                db.close()
                
        except Exception as e:
            print(f"✗ Node health check error: {str(e)}")
        
        # Wait 60 seconds before next check
        await asyncio.sleep(60)


@app.on_event("startup")
async def startup_event():
    """Initialize database and MinIO buckets on startup"""
    global background_tasks_running
    
    print("🚀 Starting Distributed File Storage System...")
    
    # Initialize database
    init_db()
    print("✓ Database initialized")
    
    # Ensure buckets exist on all MinIO nodes
    bucket_results = minio_cluster.ensure_bucket("dfs-files")
    for node_id, result in bucket_results.items():
        print(f"  {node_id}: {result}")
    
    print("✓ MinIO cluster ready")
    
    # Initialize node health monitoring
    db = SessionLocal()
    try:
        node_health = minio_cluster.get_node_health()
        for node_name, health_data in node_health.items():
            node_record = db.query(NodeHealth).filter(NodeHealth.node_name == node_name).first()
            if node_record:
                node_record.is_healthy = health_data["healthy"]
                node_record.last_check = datetime.utcnow()
                node_record.total_files = health_data.get("total_files", 0)
                node_record.total_size = health_data.get("total_size", 0)
            else:
                node_record = NodeHealth(
                    node_name=node_name,
                    endpoint=health_data["endpoint"],
                    is_healthy=health_data["healthy"],
                    last_check=datetime.utcnow(),
                    total_files=health_data.get("total_files", 0),
                    total_size=health_data.get("total_size", 0)
                )
                db.add(node_record)
        db.commit()
        print("✓ Node health monitoring initialized")
    except Exception as e:
        print(f"⚠ Node health initialization failed: {e}")
        db.rollback()
    finally:
        db.close()
    
    # Start background replication sync task
    background_tasks_running = True
    asyncio.create_task(auto_sync_replication())
    print("✓ Auto-sync replication task started")
    
    # Start periodic node health check task
    asyncio.create_task(periodic_node_health_check())
    print("✓ Node health monitoring task started")
    
    # Auto self-register in federation on every startup so a VM restart doesn't
    # require a manual "Self-Register" click in the UI.
    asyncio.create_task(auto_federation_self_register())
    print("✓ Federation auto-registration task started")

    # Run discovery continuously even if auto-registration is delayed/fails once.
    try:
        from peer_discovery import start_discovery_service
        asyncio.create_task(start_discovery_service())
        print("✓ Peer discovery service started")
    except Exception as e:
        print(f"⚠ Peer discovery service failed to start: {e}")


async def auto_federation_self_register():
    """
    Automatically self-register this hospital node in the federation registry
    on every startup.  Retries until the gRPC federation service is healthy
    so that start-order races (e.g. after a VM restart) don't cause a permanent
    failure requiring a manual UI click.
    """
    import os

    # Ensure the data directory exists so the registry JSON can be persisted.
    os.makedirs("data", exist_ok=True)

    hospital_id   = os.getenv("HOSPITAL_ID",   "hospital-a")
    hospital_name = os.getenv("HOSPITAL_NAME", "Hospital A")
    cert_path     = os.getenv("TLS_CERT_FILE", f"certs/{hospital_id}-cert.pem")
    key_path      = os.getenv("TLS_KEY_FILE",  f"certs/{hospital_id}-key.pem")
    ca_cert_path  = os.getenv("TLS_CA_FILE",   "certs/ca-cert.pem")

    if not all(os.path.exists(p) for p in [cert_path, ca_cert_path, key_path]):
        print("⚠ Federation auto-registration skipped: certificate files not found")
        return

    # Wait for gRPC federation service to become healthy (up to 90 s).
    max_wait = 90
    waited   = 0
    interval = 5
    while waited < max_wait:
        health = federation_health()
        if health and health.get("ok"):
            break
        await asyncio.sleep(interval)
        waited += interval

    if waited >= max_wait:
        print("⚠ Federation auto-registration skipped: gRPC service did not become healthy in time")
        return

    # gRPC is now healthy. Clear the per-peer retry throttle so the fast
    # reconnect loop can immediately re-dial peers instead of waiting up to
    # connect_retry_seconds from the (likely failed) startup attempt.
    try:
        from peer_discovery import get_discovery_service
        get_discovery_service().last_connect_attempt.clear()
    except Exception:
        pass

    try:
        from routers.federation_registry import get_registry
        from federation_registry import create_hospital_metadata

        # Resolve the host IP (injected by start.sh, or fall back to socket).
        ip_address = os.getenv("HOST_IP", "").strip().strip("\\")
        if not ip_address:
            try:
                import socket
                ip_address = socket.gethostbyname(socket.gethostname())
            except Exception:
                ip_address = "localhost"

        metadata = create_hospital_metadata(
            hospital_id=hospital_id,
            hospital_name=hospital_name,
            organization=f"{hospital_name} Medical Center",
            federation_endpoint=f"{ip_address}:50051",
            api_endpoint=f"http://{ip_address}:8000",
            cert_path=cert_path,
            ca_cert_path=ca_cert_path,
            private_key_path=key_path,
            contact_email=f"admin@{hospital_id}.local",
        )

        registry = get_registry()
        result   = registry.register_hospital(metadata)

        if result.get("success"):
            registry.export_registry("data/federation-registry.json")
            print(f"✓ Federation auto-registration successful: {hospital_id}")
        else:
            # "already registered" is not an error after restart; log as info.
            print(f"ℹ Federation auto-registration: {result.get('error', 'already registered')}")

        # ── Announce ourselves to peers & pull their registries ──
        # This mirrors the manual /self-register endpoint behaviour and is
        # the critical step that was previously missing, causing discovery
        # to "only work once" (i.e. only on manual self-register).
        try:
            from routers.federation_registry import _announce_to_peers, _pull_remote_registries
            await _announce_to_peers(metadata)
            imported = await _pull_remote_registries()
            if imported:
                registry.export_registry("data/federation-registry.json")
            print(f"✓ Federation peer sync done (imported {imported} peer(s))")
        except Exception as sync_exc:
            print(f"⚠ Federation peer sync failed (will retry via discovery service): {sync_exc}")

    except Exception as exc:
        print(f"⚠ Federation auto-registration failed: {exc}")

# React SPA Routes - Serve index.html for all non-API routes
@app.get("/", response_class=HTMLResponse)
async def home():
    """Serve React frontend"""
    frontend_dist = "/app/frontend/dist"
    index_file = os.path.join(frontend_dist, "index.html")
    
    if os.path.exists(index_file):
        with open(index_file, 'r', encoding='utf-8') as f:
            return HTMLResponse(content=f.read())
    else:
        raise HTTPException(status_code=404, detail="Frontend not found")


@app.get("/admin", response_class=HTMLResponse)
async def admin_dashboard():
    """Serve React frontend (handles routing client-side)"""
    frontend_dist = "/app/frontend/dist"
    index_file = os.path.join(frontend_dist, "index.html")
    
    if os.path.exists(index_file):
        with open(index_file, 'r', encoding='utf-8') as f:
            return HTMLResponse(content=f.read())
    else:
        raise HTTPException(status_code=404, detail="Frontend not found")


@app.get("/user", response_class=HTMLResponse)
async def user_portal():
    """Serve React frontend (handles routing client-side)"""
    frontend_dist = "/app/frontend/dist"
    index_file = os.path.join(frontend_dist, "index.html")
    
    if os.path.exists(index_file):
        with open(index_file, 'r', encoding='utf-8') as f:
            return HTMLResponse(content=f.read())
    else:
        raise HTTPException(status_code=404, detail="Frontend not found")


@app.post("/api/upload")
async def upload_file(
    file: UploadFile = File(...),
    description: str = Form(default=""),
    patient_id: Optional[int] = Form(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["doctor", "admin"])),
):
    """
    Upload a file to the distributed file system - Patient-centered for DPA compliance
    - Only doctors and admins can upload files
    - Requires patient_id to link file to patient record
    - Uploads to all MinIO nodes for redundancy
    - Stores metadata in PostgreSQL
    - Invalidates cache
    """
    from models import Patient
    
    # DPA Requirement: Files must be linked to a patient
    if not patient_id:
        raise HTTPException(
            status_code=400,
            detail="patient_id is required. All medical files must be associated with a patient record."
        )
    
    # Verify patient exists and user has access
    patient = db.query(Patient).filter(Patient.id == patient_id, Patient.is_active == True).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found or inactive")
    
    upload_start_time = datetime.now()
    
    try:
        # Read file content
        file_content = await file.read()
        file_size = len(file_content)
        
        # Calculate checksum
        checksum = hashlib.sha256(file_content).hexdigest()
        # Duplicate rejection: DB first, then Federation gRPC if available
        existing = db.query(FileMetadata).filter(
            FileMetadata.checksum == checksum,
            FileMetadata.is_deleted == False,
        ).first()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"Duplicate file: a file with the same content (SHA256) already exists (file_id={existing.id})",
            )
        grpc_dup = await asyncio.get_event_loop().run_in_executor(
            thread_pool,
            lambda: federation_check_duplicate(checksum),
        )
        if grpc_dup and grpc_dup.get("exists"):
            raise HTTPException(
                status_code=409,
                detail=f"Duplicate file (federation): same SHA256 already stored (object_key={grpc_dup.get('object_key', '')})",
            )

        user_id = str(current_user.id)
        # Generate unique object key
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        object_key = f"{user_id}/{timestamp}_{file.filename}"
        
        # Upload to all MinIO nodes
        upload_start = datetime.now()
        upload_results = minio_cluster.upload_file_to_all_nodes(
            file_data=file_content,
            object_name=object_key,
            bucket_name="dfs-files",
            content_type=file.content_type or "application/octet-stream"
        )
        upload_duration = (datetime.now() - upload_start).total_seconds()
        
        # Count successful uploads
        successful_uploads = sum(1 for r in upload_results.values() if r["status"] == "success")
        
        # Record metrics
        status = "success" if successful_uploads == 3 else "partial" if successful_uploads > 0 else "failed"
        total_duration = (datetime.now() - upload_start_time).total_seconds()
        metrics.record_file_upload(status, successful_uploads, total_duration, file_size)
        
        # Create file metadata record (user_id stored as string for compatibility)
        file_metadata = FileMetadata(
            filename=file.filename,
            original_filename=file.filename,
            file_size=file_size,
            content_type=file.content_type,
            user_id=user_id,  # from current_user.id
            patient_id=patient_id,  # DPA-compliant: link to patient
            bucket_name="dfs-files",
            object_key=object_key,
            checksum=checksum,
            description=description
        )
        db.add(file_metadata)
        db.commit()
        db.refresh(file_metadata)
        
        # Log upload operation
        upload_log = UploadLog(
            file_id=file_metadata.id,
            filename=file.filename,
            user_id=user_id,
            status="success" if successful_uploads == 3 else "partial",
            minio_node="all_nodes",
            upload_duration=upload_duration
        )
        db.add(upload_log)
        
        # Create replication status records
        for node_id, result in upload_results.items():
            replication = ReplicationStatus(
                file_id=file_metadata.id,
                object_key=object_key,
                node_name=node_id,
                is_replicated=(result["status"] == "success"),
                replication_timestamp=datetime.now() if result["status"] == "success" else None,
                is_verified=False,
                checksum=checksum if result["status"] == "success" else None,
                error_message=result["message"] if result["status"] == "error" else None
            )
            db.add(replication)
        
        db.commit()
        
        # Invalidate file list cache
        redis_cache.invalidate_file_list()

        # Update system metrics
        metrics.total_files.set(db.query(FileMetadata).count())
        metrics.total_storage_bytes.set(db.query(func.sum(FileMetadata.file_size)).scalar() or 0)

        # Audit
        await audit.audit_upload(
            file_metadata.id, file_metadata.filename, user_id, file_size, checksum,
            "success" if successful_uploads == 3 else "partial",
        )

        return {
            "status": "success",
            "message": f"File uploaded successfully to {successful_uploads}/3 nodes",
            "file_id": file_metadata.id,
            "filename": file.filename,
            "size": file_size,
            "checksum": checksum,
            "upload_duration": upload_duration,
            "replication_results": upload_results
        }
        
    except Exception as e:
        db.rollback()
        # Record failed upload
        metrics.file_uploads_total.labels(status="failed", nodes_count="0").inc()
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@app.get("/api/files")
async def list_files(
    user_id: Optional[str] = None,
    patient_id: Optional[int] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List files in the system.
    Patients see only files linked to their patient record.
    Doctors/admins see all files (with optional filters).
    """
    try:
        # RBAC: patients see only their own files (linked via patient_id on User)
        if current_user.role == "patient":
            resolved_patient_id = _resolve_patient_id_for_user(db, current_user)
            if not resolved_patient_id:
                return {
                    "status": "success",
                    "source": "database",
                    "files": [],
                }
            patient_id = resolved_patient_id
            user_id = None

        cache_key = f"files:list:{user_id or 'all'}:{patient_id or 'all'}"
        cached_files = redis_cache.get(cache_key)

        if cached_files:
            return {
                "status": "success",
                "source": "cache",
                "files": cached_files
            }

        # Query database
        query = db.query(FileMetadata).filter(FileMetadata.is_deleted == False)
        if user_id:
            query = query.filter(FileMetadata.user_id == user_id)
        if patient_id:
            query = query.filter(FileMetadata.patient_id == patient_id)
        
        files = query.order_by(FileMetadata.upload_timestamp.desc()).all()
        
        files_data = []
        for f in files:
            files_data.append({
                "id": f.id,
                "filename": f.filename,
                "size": f.file_size,
                "content_type": f.content_type,
                "user_id": f.user_id,
                "patient_id": f.patient_id,
                "upload_timestamp": f.upload_timestamp.isoformat(),
                "checksum": f.checksum,
                "description": f.description
            })
        
        # Cache the result
        redis_cache.set(cache_key, files_data, ttl=300)
        
        return {
            "status": "success",
            "source": "database",
            "files": files_data
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to list files: {str(e)}")


@app.get("/api/files/{file_id}")
async def get_file_info(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Get detailed information about a specific file.
    Requires consent for non-owner access.
    """
    try:
        # Query database (skip cache for consent check)
        file_meta = db.query(FileMetadata).filter(FileMetadata.id == file_id).first()
        if not file_meta:
            raise HTTPException(status_code=404, detail="File not found")
        if not can_access_file(db, file_id, current_user.id, current_user.role, file_meta.user_id):
            raise HTTPException(status_code=403, detail="Consent required to access this file")

        # Try cache
        cached_metadata = redis_cache.get_file_metadata(file_id)
        if cached_metadata:
            return {
                "status": "success",
                "source": "cache",
                "file": cached_metadata
            }
        
        # Get replication status
        replication_status = db.query(ReplicationStatus).filter(
            ReplicationStatus.file_id == file_id
        ).all()
        
        replication_data = []
        for rep in replication_status:
            replication_data.append({
                "node": rep.node_name,
                "replicated": rep.is_replicated,
                "verified": rep.is_verified,
                "timestamp": rep.replication_timestamp.isoformat() if rep.replication_timestamp else None
            })
        
        file_data = {
            "id": file_meta.id,
            "filename": file_meta.filename,
            "size": file_meta.file_size,
            "content_type": file_meta.content_type,
            "user_id": file_meta.user_id,
            "upload_timestamp": file_meta.upload_timestamp.isoformat(),
            "checksum": file_meta.checksum,
            "description": file_meta.description,
            "replication_status": replication_data
        }
        
        # Cache the result
        redis_cache.set_file_metadata(file_id, file_data)
        
        return {
            "status": "success",
            "source": "database",
            "file": file_data
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get file info: {str(e)}")


@app.get("/api/files/{file_id}/download")
async def download_file(
    file_id: int,
    node: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Download a file from the distributed system.
    Requires consent for non-owner access.
    """
    download_start_time = datetime.now()
    download_node = None

    try:
        # Get file metadata
        file_meta = db.query(FileMetadata).filter(FileMetadata.id == file_id).first()
        if not file_meta:
            raise HTTPException(status_code=404, detail="File not found")
        if not can_access_file(db, file_id, current_user.id, current_user.role, file_meta.user_id):
            raise HTTPException(status_code=403, detail="Consent required to download this file")
        
        # Try to download from MinIO
        file_data = minio_cluster.get_file_from_node(
            object_name=file_meta.object_key,
            node_id=node,
            bucket_name="dfs-files"
        )
        
        # Determine which node was used (check replication status)
        if file_data:
            replications = db.query(ReplicationStatus).filter(
                ReplicationStatus.file_id == file_id,
                ReplicationStatus.is_replicated == True
            ).all()
            download_node = replications[0].node_name if replications else "unknown"
        
        if file_data is None:
            # Record failed download
            metrics.record_file_download("failed", "none", (datetime.now() - download_start_time).total_seconds())
            raise HTTPException(status_code=404, detail="File not found on any MinIO node")
        
        # Update last accessed timestamp
        file_meta.last_accessed = datetime.now()
        db.commit()
        
        # Increment download counter in Redis
        redis_cache.increment_downloads(file_id)

        # Record successful download metrics
        download_duration = (datetime.now() - download_start_time).total_seconds()
        metrics.record_file_download("success", download_node, download_duration)

        # Audit
        await audit.audit_download(
            file_id, file_meta.filename, file_meta.user_id, download_node, "success",
        )

        # Return file as streaming response
        return StreamingResponse(
            io.BytesIO(file_data),
            media_type=file_meta.content_type or "application/octet-stream",
            headers={
                "Content-Disposition": f'attachment; filename="{file_meta.filename}"'
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        # Record failed download
        if download_node:
            metrics.record_file_download("failed", download_node, (datetime.now() - download_start_time).total_seconds())
        raise HTTPException(status_code=500, detail=f"Download failed: {str(e)}")


@app.delete("/api/files/{file_id}")
async def delete_file(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["doctor", "admin"])),
):
    """
    Delete a file from the distributed system.
    Only doctors and admins can delete files.
    """
    try:
        # Get file metadata
        file_meta = db.query(FileMetadata).filter(FileMetadata.id == file_id).first()
        if not file_meta:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Delete from all MinIO nodes
        delete_results = minio_cluster.delete_file_from_all_nodes(
            object_name=file_meta.object_key,
            bucket_name="dfs-files"
        )
        
        # Mark as deleted in database (soft delete)
        file_meta.is_deleted = True
        db.commit()
        
        # Clear cache
        redis_cache.delete(f"file:metadata:{file_id}")
        redis_cache.invalidate_file_list()

        # Audit
        await audit.audit_delete(file_id, file_meta.filename, str(current_user.id))

        return {
            "status": "success",
            "message": "File deleted successfully",
            "delete_results": delete_results
        }
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Delete failed: {str(e)}")


@app.get("/api/nodes/health")
async def get_nodes_health(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["doctor", "admin"])),
):
    """
    Get health status of all MinIO nodes
    - Checks connectivity to each node
    - Updates node health table
    - Uses Redis cache
    """
    try:
        # Get health status from MinIO cluster
        health_status = minio_cluster.get_node_health()
        
        # Update database and cache
        for node_id, health in health_status.items():
            # Update or create node health record
            node_health = db.query(NodeHealth).filter(NodeHealth.node_name == node_id).first()
            if node_health:
                node_health.is_healthy = health["healthy"]
                node_health.last_check = datetime.now()
                node_health.status_message = health["message"]
            else:
                node_health = NodeHealth(
                    node_name=node_id,
                    endpoint=health["endpoint"],
                    is_healthy=health["healthy"],
                    status_message=health["message"]
                )
                db.add(node_health)
            
            # Cache node health
            redis_cache.set_node_health(node_id, health, ttl=60)
        
        db.commit()
        
        return {
            "status": "success",
            "nodes": health_status
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Health check failed: {str(e)}")


@app.get("/api/federation/health")
async def get_federation_health():
    """Health of the Go Federation gRPC service and its MinIO nodes."""
    result = await asyncio.get_event_loop().run_in_executor(thread_pool, federation_health)
    if result is None:
        raise HTTPException(status_code=503, detail="Federation gRPC service unavailable")
    return {"status": "success", "federation": result}


@app.get("/api/stats")
async def get_system_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["doctor", "admin"])),
):
    """Get system statistics"""
    try:
        total_files = db.query(FileMetadata).filter(FileMetadata.is_deleted == False).count()
        total_size = db.query(FileMetadata).filter(FileMetadata.is_deleted == False).with_entities(
            func.sum(FileMetadata.file_size)
        ).scalar() or 0
        
        total_uploads = db.query(UploadLog).count()
        successful_uploads = db.query(UploadLog).filter(UploadLog.status == "success").count()
        
        cache_stats = redis_cache.get_cache_stats()
        popular_files = redis_cache.get_popular_files(limit=5)
        
        return {
            "status": "success",
            "stats": {
                "total_files": total_files,
                "total_size_bytes": total_size,
                "total_size_mb": round(total_size / (1024 * 1024), 2),
                "total_uploads": total_uploads,
                "successful_uploads": successful_uploads,
                "success_rate": round(successful_uploads / max(total_uploads, 1) * 100, 2),
                "cache_stats": cache_stats,
                "popular_files": popular_files
            }
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get stats: {str(e)}")


@app.get("/api/dashboard")
async def get_dashboard_data(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Get comprehensive dashboard data including stats, access requests, consents, notifications, and node health
    """
    from models import Patient, Consent, AccessRequest, Notification
    
    try:
        # Role-based dashboard data
        is_patient = current_user.role == "patient"
        resolved_patient_id = _resolve_patient_id_for_user(db, current_user) if is_patient else None
        
        if is_patient:
            # Patients see only their own file stats
            patient_filter = []
            if resolved_patient_id:
                patient_filter.append(FileMetadata.patient_id == resolved_patient_id)
            else:
                patient_filter.append(False)
            
            total_files = db.query(FileMetadata).filter(
                FileMetadata.is_deleted == False, *patient_filter
            ).count()
            total_size = db.query(FileMetadata).filter(
                FileMetadata.is_deleted == False, *patient_filter
            ).with_entities(func.sum(FileMetadata.file_size)).scalar() or 0
            total_uploads = 0
            successful_uploads = 0
            total_patients = 0
        else:
            # Doctors/admins see system-wide stats
            total_files = db.query(FileMetadata).filter(FileMetadata.is_deleted == False).count()
            total_size = db.query(FileMetadata).filter(FileMetadata.is_deleted == False).with_entities(
                func.sum(FileMetadata.file_size)
            ).scalar() or 0
            total_uploads = db.query(UploadLog).count()
            successful_uploads = db.query(UploadLog).filter(UploadLog.status == "success").count()
            total_patients = db.query(Patient).filter(Patient.is_active == True).count()
        
        # Query pending access requests from database
        if is_patient:
            # Patients see only requests targeting their patient record
            pending_query = db.query(AccessRequest).filter(
                AccessRequest.status == "pending"
            )
            if resolved_patient_id:
                pending_query = pending_query.filter(AccessRequest.patient_id == resolved_patient_id)
            else:
                pending_query = pending_query.filter(False)
            pending_access_requests = pending_query.order_by(AccessRequest.requested_at.desc()).limit(5).all()
        else:
            pending_access_requests = db.query(AccessRequest).filter(
                AccessRequest.status == "pending"
            ).order_by(AccessRequest.requested_at.desc()).limit(5).all()
        
        # Format access requests
        access_requests_list = []
        for req in pending_access_requests:
            requester = db.query(User).filter(User.id == req.requester_id).first()
            patient = db.query(Patient).filter(Patient.id == req.patient_id).first() if req.patient_id else None
            access_requests_list.append({
                "id": req.id,
                "requester_email": requester.email if requester else "Unknown",
                "requester_role": requester.role if requester else "Unknown",
                "patient_name": patient.full_name if patient else "N/A",
                "reason": req.reason,
                "scope": req.scope or "all",
                "requested_at": req.requested_at.isoformat() if req.requested_at else None,
                "status": req.status
            })
        
        # Query active consents
        active_consents_count = db.query(Consent).filter(
            Consent.revoked_at.is_(None),
            (Consent.expires_at.is_(None) | (Consent.expires_at > datetime.utcnow()))
        ).count()
        
        # Query user's unread notifications
        unread_notifications = db.query(Notification).filter(
            Notification.user_id == current_user.id,
            Notification.read == False
        ).order_by(Notification.created_at.desc()).limit(5).all()
        
        notifications_list = []
        for notif in unread_notifications:
            notifications_list.append({
                "id": notif.id,
                "title": notif.title,
                "message": notif.message,
                "type": notif.type,
                "link": notif.link,
                "created_at": notif.created_at.isoformat() if notif.created_at else None
            })
        
        # Node health status (only for doctors/admins)
        node_health = []
        if not is_patient:
            for node_id in ["minio1", "minio2", "minio3"]:
                cached_health = redis_cache.get_node_health(node_id)
                if cached_health:
                    node_health.append(cached_health)
                else:
                    # Get from database
                    node_record = db.query(NodeHealth).filter(NodeHealth.node_name == node_id).first()
                    if node_record:
                        node_health.append({
                            "id": node_record.node_name,
                            "name": node_record.node_name.upper(),
                            "endpoint": node_record.endpoint,
                            "healthy": node_record.is_healthy,
                            "status": "healthy" if node_record.is_healthy else "offline",
                            "last_check": node_record.last_check.isoformat() if node_record.last_check else None,
                            "total_files": node_record.total_files,
                            "total_size": node_record.total_size
                        })
        
        return {
            "status": "success",
            "stats": {
                "total_files": total_files,
                "total_size_mb": round(total_size / (1024 * 1024), 2),
                "total_patients": total_patients,
                "success_rate": round(successful_uploads / max(total_uploads, 1) * 100, 2),
                "active_consents": active_consents_count
            },
            "pending_requests": {
                "count": len(access_requests_list),
                "requests": access_requests_list
            },
            "notifications": {
                "unread_count": len(notifications_list),
                "items": notifications_list
            },
            "node_health": node_health,
            "user_role": current_user.role
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get dashboard data: {str(e)}")


@app.get("/api/replication/verify/{file_id}")
async def verify_replication(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["doctor", "admin"])),
):
    """Verify that a file is properly replicated across all nodes"""
    try:
        file_meta = db.query(FileMetadata).filter(FileMetadata.id == file_id).first()
        if not file_meta:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Check file existence on all nodes
        existence_status = minio_cluster.check_file_exists_on_nodes(
            object_name=file_meta.object_key,
            bucket_name="dfs-files"
        )
        
        # Update replication status
        for node_id, exists in existence_status.items():
            replication = db.query(ReplicationStatus).filter(
                ReplicationStatus.file_id == file_id,
                ReplicationStatus.node_name == node_id
            ).first()
            
            if replication:
                replication.is_verified = exists
                replication.verification_timestamp = datetime.now()
        
        db.commit()
        
        return {
            "status": "success",
            "file_id": file_id,
            "replication_status": existence_status,
            "fully_replicated": all(existence_status.values())
        }
        
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Verification failed: {str(e)}")


@app.post("/api/replication/sync/{file_id}")
async def sync_replication(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["doctor", "admin"])),
):
    """Sync/repair replication for a file by copying it to missing nodes"""
    try:
        file_meta = db.query(FileMetadata).filter(FileMetadata.id == file_id).first()
        if not file_meta:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Check which nodes have the file
        existence_status = minio_cluster.check_file_exists_on_nodes(
            object_name=file_meta.object_key,
            bucket_name="dfs-files"
        )
        
        # Find a source node that has the file
        source_node = None
        for node_id, exists in existence_status.items():
            if exists:
                source_node = node_id
                break
        
        if not source_node:
            raise HTTPException(status_code=404, detail="File not found on any node")
        
        # Get the file from the source node
        file_data = minio_cluster.get_file_from_node(
            object_name=file_meta.object_key,
            node_id=source_node,
            bucket_name="dfs-files"
        )
        
        if not file_data:
            raise HTTPException(status_code=500, detail="Failed to retrieve file from source node")
        
        # Upload to missing nodes
        sync_results = {}
        for node_id, exists in existence_status.items():
            if not exists:
                try:
                    node_info = minio_cluster.nodes[node_id]
                    client = node_info["client"]
                    file_stream = io.BytesIO(file_data)
                    
                    start_time = datetime.now()
                    client.put_object(
                        "dfs-files",
                        file_meta.object_key,
                        file_stream,
                        len(file_data),
                        content_type=file_meta.content_type or "application/octet-stream"
                    )
                    upload_time = (datetime.now() - start_time).total_seconds()
                    
                    sync_results[node_id] = {
                        "status": "success",
                        "message": f"Synced to {node_info['name']}",
                        "upload_time": upload_time
                    }
                    
                    # Update replication status
                    replication = db.query(ReplicationStatus).filter(
                        ReplicationStatus.file_id == file_id,
                        ReplicationStatus.node_name == node_id
                    ).first()
                    
                    if replication:
                        replication.is_replicated = True
                        replication.replication_timestamp = datetime.now()
                        replication.is_verified = True
                        replication.verification_timestamp = datetime.now()
                        replication.checksum = file_meta.checksum
                        replication.error_message = None
                    else:
                        # Create new replication record
                        new_replication = ReplicationStatus(
                            file_id=file_id,
                            object_key=file_meta.object_key,
                            node_name=node_id,
                            is_replicated=True,
                            replication_timestamp=datetime.now(),
                            is_verified=True,
                            verification_timestamp=datetime.now(),
                            checksum=file_meta.checksum
                        )
                        db.add(new_replication)
                    
                except Exception as e:
                    sync_results[node_id] = {
                        "status": "error",
                        "message": str(e)
                    }
            else:
                sync_results[node_id] = {
                    "status": "skipped",
                    "message": "File already exists on this node"
                }
        
        db.commit()
        
        # Verify final state
        final_status = minio_cluster.check_file_exists_on_nodes(
            object_name=file_meta.object_key,
            bucket_name="dfs-files"
        )
        
        return {
            "status": "success",
            "file_id": file_id,
            "source_node": source_node,
            "sync_results": sync_results,
            "final_replication_status": final_status,
            "fully_replicated": all(final_status.values())
        }
        
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")


@app.post("/api/replication/sync-all")
async def sync_all_files(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["admin"])),
):
    """Sync replication for all files using robust replication manager"""
    try:
        result = await replication_manager.sync_all(db, priority_recent=True)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")


@app.get("/api/files/{file_id}/versions")
async def get_file_versions(
    file_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["doctor", "admin"])),
):
    """Get all versions of a file"""
    try:
        # Get file metadata
        file_record = db.query(FileMetadata).filter(FileMetadata.id == file_id).first()
        if not file_record:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Get versions from MinIO
        versions = minio_cluster.list_object_versions(file_record.object_key)
        
        return {
            "file_id": file_id,
            "filename": file_record.filename,
            "object_key": file_record.object_key,
            "versions": versions,
            "total_versions": len(versions)
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error retrieving versions: {str(e)}")


@app.get("/api/files/{file_id}/versions/{version_id}/download")
async def download_file_version(
    file_id: int,
    version_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["doctor", "admin"])),
):
    """Download a specific version of a file"""
    try:
        # Get file metadata
        file_record = db.query(FileMetadata).filter(FileMetadata.id == file_id).first()
        if not file_record:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Get specific version from MinIO
        file_data = minio_cluster.get_object_version(
            file_record.object_key,
            version_id
        )
        
        if not file_data:
            raise HTTPException(status_code=404, detail="Version not found")
        
        # Create streaming response
        return StreamingResponse(
            io.BytesIO(file_data),
            media_type="application/octet-stream",
            headers={
                "Content-Disposition": f"attachment; filename={file_record.filename}",
                "X-Version-ID": version_id
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error downloading version: {str(e)}")


@app.delete("/api/files/{file_id}/versions/{version_id}")
async def delete_file_version(
    file_id: int,
    version_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["admin"])),
):
    """Delete a specific version of a file"""
    try:
        # Get file metadata
        file_record = db.query(FileMetadata).filter(FileMetadata.id == file_id).first()
        if not file_record:
            raise HTTPException(status_code=404, detail="File not found")
        
        # Delete version from all MinIO nodes
        results = minio_cluster.delete_object_version(
            file_record.object_key,
            version_id
        )
        
        return {
            "message": "Version deleted",
            "file_id": file_id,
            "version_id": version_id,
            "results": results
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error deleting version: {str(e)}")


# Serve React frontend for all non-API routes (SPA catch-all)
@app.get("/{full_path:path}")
async def serve_frontend(full_path: str):
    """Serve React frontend for all routes that don't match API endpoints"""
    frontend_dist = "/app/frontend/dist"
    index_file = os.path.join(frontend_dist, "index.html")
    
    if os.path.exists(index_file):
        with open(index_file, 'r', encoding='utf-8') as f:
            return HTMLResponse(content=f.read())
    else:
        raise HTTPException(status_code=404, detail="Frontend not found. Please build the frontend first.")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
