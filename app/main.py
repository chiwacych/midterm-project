from fastapi import FastAPI, UploadFile, File, Depends, HTTPException, Form, Request
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.base import BaseHTTPMiddleware
from sqlalchemy.orm import Session
from sqlalchemy import func, or_
from typing import List, Optional, Dict, Any, Tuple
import hashlib
from datetime import datetime, date
import io
import os
import asyncio
import re
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor
from prometheus_fastapi_instrumentator import Instrumentator

import pydicom
from pydicom.uid import ExplicitVRLittleEndian

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
        "http://localhost:8042",
        "http://localhost:8000",
        "http://localhost:5000",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3002",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:8042",
        "http://127.0.0.1:8000",
        "http://127.0.0.1:5000",
        "https://viewer.ohif.org",
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
        if request.headers.get("access-control-request-private-network") == "true":
            response.headers["Access-Control-Allow-Private-Network"] = "true"
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


BODY_PART_PATTERN = re.compile(r"(?:body\s*part|bodypart)\s*[:=]\s*([^|,;]+)", re.IGNORECASE)


def _is_probably_dicom(filename: str, content_type: Optional[str], file_content: Optional[bytes] = None) -> bool:
    """Best-effort DICOM detection for upload/list/filter paths."""
    if filename.lower().endswith((".dcm", ".dicom")):
        return True
    if content_type and "dicom" in content_type.lower():
        return True
    if file_content and len(file_content) >= 132 and file_content[128:132] == b"DICM":
        return True
    return False


def _parse_dicom_date(value: Optional[str]) -> Optional[date]:
    if not value:
        return None
    value = value.strip()
    if not value:
        return None
    try:
        return datetime.strptime(value, "%Y%m%d").date()
    except Exception:
        return None


def _extract_body_part_from_description(description: Optional[str]) -> Optional[str]:
    if not description:
        return None
    m = BODY_PART_PATTERN.search(description)
    if not m:
        return None
    value = m.group(1).strip()
    return value or None


def _ds_str(ds: pydicom.Dataset, tag: str) -> Optional[str]:
    """Return stripped string value for a DICOM tag, or None if absent/empty."""
    return str(ds.get(tag, "")).strip() or None


def _ds_int(ds: pydicom.Dataset, tag: str) -> Optional[int]:
    try:
        v = ds.get(tag)
        return int(v) if v is not None else None
    except Exception:
        return None


def _ds_float_list(ds: pydicom.Dataset, tag: str) -> Optional[list]:
    """Return a list of floats for multi-value DICOM tags (e.g. ImagePositionPatient)."""
    try:
        v = ds.get(tag)
        if v is None:
            return None
        if hasattr(v, "__iter__") and not isinstance(v, str):
            return [float(x) for x in v]
        return [float(v)]
    except Exception:
        return None


def _extract_dicom_fields_from_dataset(ds: pydicom.Dataset) -> Dict[str, Any]:
    study_uid = _ds_str(ds, "StudyInstanceUID")
    series_uid = _ds_str(ds, "SeriesInstanceUID")
    instance_uid = _ds_str(ds, "SOPInstanceUID")
    modality = _ds_str(ds, "Modality")
    body_part = _ds_str(ds, "BodyPartExamined")
    study_date = _parse_dicom_date(str(ds.get("StudyDate", "")).strip())

    patient_name = None
    if "PatientName" in ds:
        try:
            patient_name = str(ds.PatientName)
        except Exception:
            patient_name = None

    # Window center/width may be multi-value (e.g. for CT with multiple presets)
    window_center = _ds_float_list(ds, "WindowCenter")
    window_width = _ds_float_list(ds, "WindowWidth")

    return {
        "study_uid": study_uid,
        "series_uid": series_uid,
        "instance_uid": instance_uid,
        "modality": modality,
        "study_date": study_date,
        "body_part": body_part,
        "patient_name": patient_name,
        "sop_class_uid": _ds_str(ds, "SOPClassUID"),
        "rows": int(ds.get("Rows", 0) or 0),
        "columns": int(ds.get("Columns", 0) or 0),
        # Per-instance rendering fields needed by OHIF
        "instance_number": _ds_int(ds, "InstanceNumber"),
        "number_of_frames": _ds_int(ds, "NumberOfFrames"),
        "bits_allocated": _ds_int(ds, "BitsAllocated"),
        "bits_stored": _ds_int(ds, "BitsStored"),
        "high_bit": _ds_int(ds, "HighBit"),
        "pixel_representation": _ds_int(ds, "PixelRepresentation"),
        "samples_per_pixel": _ds_int(ds, "SamplesPerPixel"),
        "photometric_interpretation": _ds_str(ds, "PhotometricInterpretation"),
        "window_center": window_center,
        "window_width": window_width,
        "image_position_patient": _ds_float_list(ds, "ImagePositionPatient"),
        "image_orientation_patient": _ds_float_list(ds, "ImageOrientationPatient"),
        "pixel_spacing": _ds_float_list(ds, "PixelSpacing"),
        "rescale_intercept": _ds_float_list(ds, "RescaleIntercept"),
        "rescale_slope": _ds_float_list(ds, "RescaleSlope"),
        "series_number": _ds_int(ds, "SeriesNumber"),
        "image_type": _ds_str(ds, "ImageType"),
    }


def _extract_dicom_fields_from_bytes(file_content: bytes) -> Dict[str, Any]:
    """Parse non-pixel DICOM metadata safely; returns empty dict when parsing fails."""
    try:
        ds = pydicom.dcmread(io.BytesIO(file_content), stop_before_pixels=True, force=True)
        return _extract_dicom_fields_from_dataset(ds)
    except Exception:
        return {}


def _read_dicom_header(object_key: str) -> Optional[pydicom.Dataset]:
    """Load a DICOM header from object storage without pixel parsing."""
    try:
        data = minio_cluster.get_file_from_node(
            object_name=object_key,
            bucket_name="dfs-files",
        )
        if not data:
            return None
        return pydicom.dcmread(io.BytesIO(data), stop_before_pixels=True, force=True)
    except Exception:
        return None


ZIP_CONTENT_TYPES = {
    "application/zip",
    "application/x-zip-compressed",
    "multipart/x-zip",
}

MAX_ARCHIVE_MEMBERS = 500
MAX_ARCHIVE_UNCOMPRESSED_BYTES = 512 * 1024 * 1024  # 512 MB


def _is_zip_upload(filename: str, content_type: Optional[str]) -> bool:
    lowered = filename.lower()
    if lowered.endswith(".zip"):
        return True
    if content_type and content_type.lower() in ZIP_CONTENT_TYPES:
        return True
    return False


def _build_object_key(user_id: str, filename: str) -> str:
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    unique_suffix = uuid.uuid4().hex[:12]
    safe_filename = os.path.basename(filename).replace("\\", "_")
    return f"{user_id}/{timestamp}_{unique_suffix}_{safe_filename}"


def _extract_zip_members(archive_bytes: bytes) -> List[Tuple[str, str, bytes]]:
    members: List[Tuple[str, str, bytes]] = []
    total_uncompressed = 0

    with zipfile.ZipFile(io.BytesIO(archive_bytes)) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            if info.filename.startswith("__MACOSX/"):
                continue

            total_uncompressed += int(info.file_size or 0)
            if len(members) >= MAX_ARCHIVE_MEMBERS:
                raise ValueError(f"ZIP archive exceeds {MAX_ARCHIVE_MEMBERS} files")
            if total_uncompressed > MAX_ARCHIVE_UNCOMPRESSED_BYTES:
                raise ValueError(
                    f"ZIP archive exceeds {MAX_ARCHIVE_UNCOMPRESSED_BYTES // (1024 * 1024)} MB uncompressed size"
                )

            archive_name = info.filename.replace("\\", "/")
            member_name = os.path.basename(archive_name)
            if not member_name:
                continue

            member_bytes = archive.read(info)
            if not member_bytes:
                continue

            members.append((archive_name, member_name, member_bytes))

    return members


def _repair_decompressed_color_metadata(ds: pydicom.Dataset) -> None:
    """Fix photometric tags when decompressed pixel bytes are expanded.

    Some JPEG/YBR images may retain YBR_FULL_422 tags after decompression while
    the decoded PixelData has full 3-channel samples. This mismatch can break
    downstream decoders in web viewers.
    """
    try:
        photometric = str(getattr(ds, "PhotometricInterpretation", "") or "").upper()
        if photometric != "YBR_FULL_422":
            return

        rows = int(getattr(ds, "Rows", 0) or 0)
        cols = int(getattr(ds, "Columns", 0) or 0)
        samples = int(getattr(ds, "SamplesPerPixel", 1) or 1)
        bits_allocated = int(getattr(ds, "BitsAllocated", 8) or 8)
        frames = int(getattr(ds, "NumberOfFrames", 1) or 1)
        pixel_data = getattr(ds, "PixelData", None)

        if not pixel_data or rows <= 0 or cols <= 0 or samples <= 0:
            return

        bytes_per_sample = max(1, (bits_allocated + 7) // 8)
        expected_full_len = rows * cols * samples * frames * bytes_per_sample
        actual_len = len(pixel_data)

        should_convert_to_rgb = actual_len == expected_full_len

        # In some pydicom/plugin combinations, decompression updates transfer
        # syntax and decode cache before PixelData bytes are rewritten.
        if not should_convert_to_rgb:
            try:
                arr = ds.pixel_array
                should_convert_to_rgb = (
                    hasattr(arr, "shape")
                    and len(arr.shape) >= 3
                    and int(arr.shape[-1]) == samples
                )
            except Exception:
                should_convert_to_rgb = False

        if should_convert_to_rgb:
            ds.PhotometricInterpretation = "RGB"
            if samples > 1:
                ds.PlanarConfiguration = 0
    except Exception:
        # Keep original metadata if we cannot safely reason about it.
        return


def _rewrite_pixel_data_from_decoded_array(ds: pydicom.Dataset) -> None:
    """Rewrite PixelData from the decoded numpy array and align pixel tags.

    pydicom.pixel_array returns shapes depending on image type:
      (rows, cols)              — single-frame grayscale
      (rows, cols, 3)           — single-frame RGB/colour
      (frames, rows, cols)      — multi-frame grayscale
      (frames, rows, cols, 3)   — multi-frame colour

    ndim==3 is ambiguous: it covers both single-frame RGB and multi-frame
    grayscale.  We use the existing NumberOfFrames tag to disambiguate so
    that we never corrupt Rows / Columns for multi-frame studies.
    """
    arr = ds.pixel_array
    # Ensure little-endian byte order (required for ExplicitVRLittleEndian).
    if arr.dtype.byteorder not in ("<", "=", "|"):
        arr = arr.byteswap().newbyteorder("<")
    ds.PixelData = arr.tobytes()

    existing_frames = int(getattr(ds, "NumberOfFrames", 1) or 1)

    frames = 1
    if arr.ndim == 2:
        # (rows, cols) — single-frame grayscale
        rows, cols, channels = int(arr.shape[0]), int(arr.shape[1]), 1
    elif arr.ndim == 3:
        if existing_frames > 1 or arr.shape[2] not in (1, 3, 4):
            # (frames, rows, cols) — multi-frame grayscale
            frames = int(arr.shape[0])
            rows, cols, channels = int(arr.shape[1]), int(arr.shape[2]), 1
        else:
            # (rows, cols, channels) — single-frame colour
            rows, cols, channels = int(arr.shape[0]), int(arr.shape[1]), int(arr.shape[2])
    elif arr.ndim == 4:
        # (frames, rows, cols, channels) — multi-frame colour
        frames = int(arr.shape[0])
        rows, cols, channels = int(arr.shape[1]), int(arr.shape[2]), int(arr.shape[3])
    else:
        return  # unexpected shape; leave dataset untouched

    if rows > 0:
        ds.Rows = rows
    if cols > 0:
        ds.Columns = cols
    if frames > 1:
        ds.NumberOfFrames = str(frames)

    ds.SamplesPerPixel = channels
    if channels > 1:
        ds.PlanarConfiguration = 0
    elif hasattr(ds, "PlanarConfiguration"):
        del ds.PlanarConfiguration

    photometric = str(getattr(ds, "PhotometricInterpretation", "") or "").upper()
    if channels == 3 and photometric.startswith("YBR"):
        ds.PhotometricInterpretation = "RGB"

    bits_allocated = int(arr.dtype.itemsize * 8)
    if bits_allocated > 0:
        ds.BitsAllocated = bits_allocated
        bits_stored = int(getattr(ds, "BitsStored", bits_allocated) or bits_allocated)
        if bits_stored <= 0 or bits_stored > bits_allocated:
            bits_stored = bits_allocated
        ds.BitsStored = bits_stored
        ds.HighBit = bits_stored - 1
        if getattr(ds, "PixelRepresentation", None) is None:
            ds.PixelRepresentation = 1 if arr.dtype.kind == "i" else 0


def _normalize_dicom_payload(file_content: bytes) -> Tuple[bytes, Dict[str, Any], List[str]]:
    """Decompress DICOM payload to Explicit VR Little Endian when feasible."""

    dicom_meta = _extract_dicom_fields_from_bytes(file_content)
    ingest_notes: List[str] = []
    normalized = file_content

    try:
        ds = pydicom.dcmread(io.BytesIO(file_content), force=True)
    except Exception:
        return normalized, dicom_meta, ingest_notes

    transfer_syntax = getattr(getattr(ds, "file_meta", None), "TransferSyntaxUID", None)
    if transfer_syntax is None or not getattr(transfer_syntax, "is_compressed", False):
        return normalized, dicom_meta, ingest_notes

    try:
        ds.decompress()
        _rewrite_pixel_data_from_decoded_array(ds)
        _repair_decompressed_color_metadata(ds)

        if not hasattr(ds, "file_meta") or ds.file_meta is None:
            ds.file_meta = pydicom.dataset.FileMetaDataset()
        ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian

        output = io.BytesIO()
        ds.save_as(output, write_like_original=False)
        normalized = output.getvalue()
        ingest_notes.append("DicomDecompressed")

        # Re-extract metadata from the normalised file so all tags are accurate.
        refreshed = _extract_dicom_fields_from_bytes(normalized)
        if refreshed:
            dicom_meta = refreshed

    except Exception as exc:
        ingest_notes.append(f"DicomCompressed:{exc.__class__.__name__}")

    return normalized, dicom_meta, ingest_notes


def _group_file_payloads_by_dicom_study(files_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    grouped: List[Dict[str, Any]] = []
    dicom_groups: Dict[str, Dict[str, Any]] = {}

    for item in files_data:
        study_uid = str(item.get("dicom_study_id") or "").strip()
        series_uid = str(item.get("dicom_series_id") or "").strip()

        if not study_uid:
            entry = dict(item)
            entry["dicom_instance_count"] = 1
            entry["grouped_file_ids"] = [entry["id"]]
            entry["is_study_group"] = False
            grouped.append(entry)
            continue

        key = f"{study_uid}::{series_uid or 'unknown-series'}"
        existing = dicom_groups.get(key)

        if not existing:
            entry = dict(item)
            entry["dicom_instance_count"] = 1
            entry["grouped_file_ids"] = [entry["id"]]
            entry["is_study_group"] = False
            dicom_groups[key] = entry
            continue

        existing["size"] = int(existing.get("size") or 0) + int(item.get("size") or 0)
        existing["grouped_file_ids"] = [*existing.get("grouped_file_ids", []), item["id"]]
        existing["dicom_instance_count"] = int(existing.get("dicom_instance_count") or 1) + 1
        existing["is_study_group"] = True

        if str(item.get("upload_timestamp") or "") > str(existing.get("upload_timestamp") or ""):
            existing["upload_timestamp"] = item["upload_timestamp"]
            if item.get("description"):
                existing["description"] = item["description"]

    grouped.extend(dicom_groups.values())

    for entry in grouped:
        count = int(entry.get("dicom_instance_count") or 1)
        if count <= 1:
            continue

        modality = str(entry.get("dicom_modality") or "DICOM")
        entry["filename"] = f"{modality} Study ({count} instances)"
        if not entry.get("description"):
            entry["description"] = f"StudyInstanceUID={entry.get('dicom_study_id')}"

    grouped.sort(key=lambda item: item.get("upload_timestamp") or "", reverse=True)
    return grouped


def _file_to_api_payload(file_meta: FileMetadata, dicom_body_part: Optional[str] = None) -> Dict[str, Any]:
    return {
        "id": file_meta.id,
        "filename": file_meta.filename,
        "size": file_meta.file_size,
        "content_type": file_meta.content_type,
        "user_id": file_meta.user_id,
        "patient_id": file_meta.patient_id,
        "upload_timestamp": file_meta.upload_timestamp.isoformat(),
        "checksum": file_meta.checksum,
        "description": file_meta.description,
        "dicom_study_id": file_meta.dicom_study_id,
        "dicom_series_id": file_meta.dicom_series_id,
        "dicom_modality": file_meta.dicom_modality,
        "dicom_study_date": file_meta.dicom_study_date.isoformat() if file_meta.dicom_study_date else None,
        "dicom_body_part": dicom_body_part or _extract_body_part_from_description(file_meta.description),
    }


def _dicom_date_to_da(value: Optional[date]) -> Optional[str]:
    if not value:
        return None
    return value.strftime("%Y%m%d")

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
    Upload a file to the distributed file system - Patient-centered for DPA compliance.

    - Only doctors and admins can upload files
    - Requires patient_id to link file to patient record
    - Uploads to all MinIO nodes for redundancy
    - Stores metadata in PostgreSQL
    - Accepts a ZIP archive of DICOM instances and ingests each instance
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
    
    user_id = str(current_user.id)

    async def persist_single_payload(
        source_filename: str,
        raw_content: bytes,
        declared_content_type: Optional[str],
        base_description: str,
    ) -> Dict[str, Any]:
        """Persist one payload and return per-file ingest status."""
        if not raw_content:
            return {
                "status": "failed",
                "filename": source_filename,
                "message": "File content is empty",
            }

        description_value = (base_description or "").strip()
        content_to_store = raw_content
        detected_dicom = _is_probably_dicom(source_filename, declared_content_type, raw_content)
        dicom_meta: Dict[str, Any] = {}
        ingest_notes: List[str] = []

        if detected_dicom:
            content_to_store, dicom_meta, ingest_notes = _normalize_dicom_payload(raw_content)
            if not dicom_meta:
                dicom_meta = _extract_dicom_fields_from_bytes(content_to_store)

            body_part = dicom_meta.get("body_part")
            has_body_marker = bool(BODY_PART_PATTERN.search(description_value or ""))
            if body_part and not has_body_marker:
                if description_value:
                    description_value = f"{description_value} | BodyPart={body_part}"
                else:
                    description_value = f"BodyPart={body_part}"

            if ingest_notes:
                ingest_note_text = ",".join(ingest_notes)
                if description_value:
                    description_value = f"{description_value} | Ingest={ingest_note_text}"
                else:
                    description_value = f"Ingest={ingest_note_text}"

        checksum = hashlib.sha256(content_to_store).hexdigest()

        existing = db.query(FileMetadata).filter(
            FileMetadata.checksum == checksum,
            FileMetadata.is_deleted == False,
        ).first()
        if existing:
            return {
                "status": "duplicate_local",
                "filename": source_filename,
                "checksum": checksum,
                "existing_file_id": existing.id,
                "message": f"Duplicate file: checksum already exists (file_id={existing.id})",
            }

        grpc_dup = await asyncio.get_event_loop().run_in_executor(
            thread_pool,
            lambda: federation_check_duplicate(checksum),
        )
        if grpc_dup and grpc_dup.get("exists"):
            return {
                "status": "duplicate_federation",
                "filename": source_filename,
                "checksum": checksum,
                "message": f"Duplicate file (federation): object_key={grpc_dup.get('object_key', '')}",
            }

        object_key = _build_object_key(user_id, source_filename)
        content_type_to_store = declared_content_type or "application/octet-stream"
        if detected_dicom and (
            not content_type_to_store
            or "zip" in content_type_to_store.lower()
            or content_type_to_store == "application/octet-stream"
        ):
            content_type_to_store = "application/dicom"

        upload_start = datetime.now()
        upload_results = minio_cluster.upload_file_to_all_nodes(
            file_data=content_to_store,
            object_name=object_key,
            bucket_name="dfs-files",
            content_type=content_type_to_store,
        )
        upload_duration = (datetime.now() - upload_start).total_seconds()

        successful_uploads = sum(1 for r in upload_results.values() if r["status"] == "success")
        upload_status = "success" if successful_uploads == 3 else "partial" if successful_uploads > 0 else "failed"

        file_metadata = FileMetadata(
            filename=source_filename,
            original_filename=source_filename,
            file_size=len(content_to_store),
            content_type=content_type_to_store,
            user_id=user_id,
            patient_id=patient_id,
            bucket_name="dfs-files",
            object_key=object_key,
            checksum=checksum,
            description=description_value,
            dicom_study_id=dicom_meta.get("study_uid"),
            dicom_series_id=dicom_meta.get("series_uid"),
            dicom_modality=dicom_meta.get("modality"),
            dicom_study_date=dicom_meta.get("study_date"),
            dicom_instance_uid=dicom_meta.get("instance_uid"),
            dicom_instance_number=dicom_meta.get("instance_number"),
        )

        db.add(file_metadata)
        db.flush()

        db.add(
            UploadLog(
                file_id=file_metadata.id,
                filename=source_filename,
                user_id=user_id,
                status=upload_status,
                minio_node="all_nodes",
                upload_duration=upload_duration,
            )
        )

        now = datetime.now()
        for node_id, result in upload_results.items():
            db.add(
                ReplicationStatus(
                    file_id=file_metadata.id,
                    object_key=object_key,
                    node_name=node_id,
                    is_replicated=(result["status"] == "success"),
                    replication_timestamp=now if result["status"] == "success" else None,
                    is_verified=False,
                    checksum=checksum if result["status"] == "success" else None,
                    error_message=result["message"] if result["status"] == "error" else None,
                )
            )

        db.commit()
        db.refresh(file_metadata)

        metrics.record_file_upload(upload_status, successful_uploads, upload_duration, len(content_to_store))
        await audit.audit_upload(
            file_metadata.id,
            file_metadata.filename,
            user_id,
            len(content_to_store),
            checksum,
            upload_status,
        )

        return {
            "status": "uploaded",
            "file_id": file_metadata.id,
            "filename": file_metadata.filename,
            "size": file_metadata.file_size,
            "checksum": checksum,
            "upload_duration": upload_duration,
            "replication_results": upload_results,
            "successful_uploads": successful_uploads,
            "dicom_study_id": file_metadata.dicom_study_id,
            "dicom_series_id": file_metadata.dicom_series_id,
            "ingest_notes": ingest_notes,
        }
    
    try:
        file_content = await file.read()
        if not file_content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty")

        if _is_zip_upload(file.filename, file.content_type):
            try:
                archive_members = _extract_zip_members(file_content)
            except zipfile.BadZipFile as exc:
                raise HTTPException(status_code=400, detail="Uploaded ZIP archive is invalid") from exc
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc)) from exc

            if not archive_members:
                raise HTTPException(status_code=400, detail="ZIP archive does not contain readable files")

            uploaded_items: List[Dict[str, Any]] = []
            duplicate_items: List[Dict[str, Any]] = []
            failed_items: List[Dict[str, Any]] = []
            skipped_items: List[Dict[str, Any]] = []

            for archive_path, member_name, member_content in archive_members:
                is_member_dicom = _is_probably_dicom(member_name, None, member_content)
                dicom_probe = _extract_dicom_fields_from_bytes(member_content)
                has_dicom_uid = bool(dicom_probe.get("study_uid") or dicom_probe.get("instance_uid"))

                if not is_member_dicom and not has_dicom_uid:
                    skipped_items.append(
                        {
                            "entry": archive_path,
                            "reason": "not_dicom",
                        }
                    )
                    continue

                entry_description = description.strip()
                if entry_description:
                    entry_description = f"{entry_description} | Source={archive_path}"
                else:
                    entry_description = f"Source={archive_path}"

                try:
                    result = await persist_single_payload(
                        source_filename=member_name,
                        raw_content=member_content,
                        declared_content_type="application/dicom",
                        base_description=entry_description,
                    )
                    if result["status"].startswith("duplicate"):
                        duplicate_items.append(
                            {
                                "entry": archive_path,
                                "filename": result.get("filename", member_name),
                                "message": result.get("message", "duplicate"),
                            }
                        )
                    elif result["status"] == "uploaded":
                        uploaded_items.append(result)
                    else:
                        failed_items.append(
                            {
                                "entry": archive_path,
                                "filename": result.get("filename", member_name),
                                "message": result.get("message", "failed"),
                            }
                        )
                except Exception as exc:
                    db.rollback()
                    failed_items.append(
                        {
                            "entry": archive_path,
                            "filename": member_name,
                            "message": str(exc),
                        }
                    )

            if not uploaded_items and not duplicate_items:
                raise HTTPException(
                    status_code=400,
                    detail="ZIP archive did not contain ingestible DICOM instances",
                )

            redis_cache.invalidate_file_list()
            metrics.total_files.set(db.query(FileMetadata).count())
            metrics.total_storage_bytes.set(db.query(func.sum(FileMetadata.file_size)).scalar() or 0)

            return {
                "status": "success",
                "archive": True,
                "message": (
                    f"Processed ZIP archive: uploaded {len(uploaded_items)} instance(s), "
                    f"duplicates {len(duplicate_items)}, skipped {len(skipped_items)}, failed {len(failed_items)}"
                ),
                "uploaded_count": len(uploaded_items),
                "duplicate_count": len(duplicate_items),
                "skipped_count": len(skipped_items),
                "failed_count": len(failed_items),
                "uploaded_files": [
                    {
                        "file_id": item["file_id"],
                        "filename": item["filename"],
                        "dicom_study_id": item.get("dicom_study_id"),
                        "dicom_series_id": item.get("dicom_series_id"),
                    }
                    for item in uploaded_items
                ],
                "duplicates": duplicate_items[:50],
                "skipped": skipped_items[:50],
                "failed": failed_items[:50],
            }

        single_result = await persist_single_payload(
            source_filename=file.filename,
            raw_content=file_content,
            declared_content_type=file.content_type,
            base_description=description,
        )

        if single_result["status"] == "duplicate_local":
            raise HTTPException(status_code=409, detail=single_result["message"])
        if single_result["status"] == "duplicate_federation":
            raise HTTPException(status_code=409, detail=single_result["message"])
        if single_result["status"] != "uploaded":
            raise HTTPException(status_code=500, detail=single_result.get("message", "Upload failed"))

        redis_cache.invalidate_file_list()
        metrics.total_files.set(db.query(FileMetadata).count())
        metrics.total_storage_bytes.set(db.query(func.sum(FileMetadata.file_size)).scalar() or 0)

        return {
            "status": "success",
            "message": f"File uploaded successfully to {single_result['successful_uploads']}/3 nodes",
            "file_id": single_result["file_id"],
            "filename": single_result["filename"],
            "size": single_result["size"],
            "checksum": single_result["checksum"],
            "upload_duration": single_result["upload_duration"],
            "replication_results": single_result["replication_results"],
            "ingest_notes": single_result.get("ingest_notes", []),
        }

    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        # Record failed upload
        metrics.file_uploads_total.labels(status="failed", nodes_count="0").inc()
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")


@app.get("/api/files")
async def list_files(
    user_id: Optional[str] = None,
    patient_id: Optional[int] = None,
    search: Optional[str] = None,
    content_type: Optional[str] = None,
    size_min: Optional[int] = None,
    size_max: Optional[int] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    dicom_modality: Optional[str] = None,
    dicom_study_id: Optional[str] = None,
    dicom_series_id: Optional[str] = None,
    dicom_body_part: Optional[str] = None,
    group_by_study: bool = False,
    page: Optional[int] = None,
    page_size: int = 20,
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
                    "total": 0,
                    "page": page or 1,
                    "page_size": page_size if page is not None else 0,
                }
            patient_id = resolved_patient_id
            user_id = None
        has_advanced_filters = any([
            search,
            content_type,
            size_min is not None,
            size_max is not None,
            date_from,
            date_to,
            dicom_modality,
            dicom_study_id,
            dicom_series_id,
            dicom_body_part,
            group_by_study,
        ])

        # Preserve previous cache behavior for basic "list all" requests.
        # Skip stale cache entries where DICOM files are missing study UIDs.
        if not has_advanced_filters and page is None:
            cache_key = f"files:list:{user_id or 'all'}:{patient_id or 'all'}"
            cached_files = redis_cache.get(cache_key)
            cache_has_stale_dicom = cached_files and any(
                f.get("dicom_series_id") and not f.get("dicom_study_id")
                for f in cached_files
            )
            if cached_files and not cache_has_stale_dicom:
                return {
                    "status": "success",
                    "source": "cache",
                    "files": cached_files,
                    "total": len(cached_files),
                    "page": 1,
                    "page_size": len(cached_files),
                }

        # Query database
        query = db.query(FileMetadata).filter(FileMetadata.is_deleted == False)
        if user_id:
            query = query.filter(FileMetadata.user_id == user_id)
        if patient_id:
            query = query.filter(FileMetadata.patient_id == patient_id)

        if search:
            pattern = f"%{search.strip()}%"
            query = query.filter(
                or_(
                    FileMetadata.filename.ilike(pattern),
                    FileMetadata.description.ilike(pattern),
                )
            )

        if content_type:
            query = query.filter(FileMetadata.content_type == content_type)
        if size_min is not None:
            query = query.filter(FileMetadata.file_size >= size_min)
        if size_max is not None:
            query = query.filter(FileMetadata.file_size <= size_max)
        if date_from:
            query = query.filter(FileMetadata.upload_timestamp >= datetime.fromisoformat(date_from))
        if date_to:
            # If the UI sends a date-only string, include the full day.
            date_to_value = f"{date_to}T23:59:59" if len(date_to) == 10 else date_to
            query = query.filter(FileMetadata.upload_timestamp <= datetime.fromisoformat(date_to_value))

        if dicom_modality:
            query = query.filter(FileMetadata.dicom_modality == dicom_modality)
        if dicom_study_id:
            query = query.filter(FileMetadata.dicom_study_id == dicom_study_id)
        if dicom_series_id:
            query = query.filter(FileMetadata.dicom_series_id == dicom_series_id)

        query = query.order_by(FileMetadata.upload_timestamp.desc())

        files_for_payload: List[FileMetadata] = []
        files_data: List[Dict[str, Any]] = []
        total = 0
        body_part_by_file_id: Dict[int, str] = {}

        if dicom_body_part:
            # Body-part is not persisted in a dedicated DB column; filter via parsed metadata.
            body_filter = dicom_body_part.strip().lower()
            candidates = query.all()
            filtered_candidates: List[FileMetadata] = []
            for file_meta in candidates:
                body_part = _extract_body_part_from_description(file_meta.description)
                if not body_part and _is_probably_dicom(file_meta.filename, file_meta.content_type):
                    ds = _read_dicom_header(file_meta.object_key)
                    if ds:
                        body_part = _extract_dicom_fields_from_dataset(ds).get("body_part")
                if body_part:
                    body_part_by_file_id[file_meta.id] = body_part
                if body_part and body_filter in body_part.lower():
                    filtered_candidates.append(file_meta)

            files_for_payload = filtered_candidates
        elif group_by_study:
            files_for_payload = query.all()
        else:
            total = query.count()
            if page is not None:
                offset = (page - 1) * page_size
                files_for_payload = query.offset(offset).limit(page_size).all()
            else:
                files_for_payload = query.all()

        # Provide a best-effort body-part value for UI display.
        for file_meta in files_for_payload:
            if file_meta.id in body_part_by_file_id:
                continue
            body_part = _extract_body_part_from_description(file_meta.description)
            if body_part:
                body_part_by_file_id[file_meta.id] = body_part

        files_data_full = [_file_to_api_payload(f, body_part_by_file_id.get(f.id)) for f in files_for_payload]

        if group_by_study:
            grouped_files_data = _group_file_payloads_by_dicom_study(files_data_full)
            total = len(grouped_files_data)
            if page is not None:
                offset = (page - 1) * page_size
                files_data = grouped_files_data[offset:offset + page_size]
            else:
                files_data = grouped_files_data
        elif dicom_body_part:
            total = len(files_data_full)
            if page is not None:
                offset = (page - 1) * page_size
                files_data = files_data_full[offset:offset + page_size]
            else:
                files_data = files_data_full
        else:
            files_data = files_data_full

        if not has_advanced_filters and page is None:
            cache_key = f"files:list:{user_id or 'all'}:{patient_id or 'all'}"
            redis_cache.set(cache_key, files_data, ttl=300)

        return {
            "status": "success",
            "source": "database",
            "files": files_data,
            "total": total,
            "page": page or 1,
            "page_size": page_size if page is not None else len(files_data),
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

        # Try cache — but skip if cached entry is missing dicom_study_id
        # (file may have been cached before QIDO backfill wrote the study UID)
        cached_metadata = redis_cache.get_file_metadata(file_id)
        if cached_metadata and cached_metadata.get("dicom_study_id"):
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
        
        body_part = _extract_body_part_from_description(file_meta.description)

        # If DICOM identifiers are missing, try to backfill from the DICOM header now.
        # This handles files uploaded before the QIDO backfill mechanism ran.
        if _is_probably_dicom(file_meta.filename, file_meta.content_type):
            needs_backfill = not file_meta.dicom_study_id
            ds = _read_dicom_header(file_meta.object_key) if (needs_backfill or not body_part) else None
            if ds:
                extracted = _extract_dicom_fields_from_dataset(ds)
                if not body_part:
                    body_part = extracted.get("body_part")
                if needs_backfill:
                    changed = False
                    if not file_meta.dicom_study_id and extracted.get("study_uid"):
                        file_meta.dicom_study_id = extracted["study_uid"]
                        changed = True
                    if not file_meta.dicom_series_id and extracted.get("series_uid"):
                        file_meta.dicom_series_id = extracted["series_uid"]
                        changed = True
                    if not file_meta.dicom_modality and extracted.get("modality"):
                        file_meta.dicom_modality = extracted["modality"]
                        changed = True
                    if not file_meta.dicom_instance_uid and extracted.get("instance_uid"):
                        file_meta.dicom_instance_uid = extracted["instance_uid"]
                        changed = True
                    if changed:
                        db.commit()
                        db.refresh(file_meta)

        file_data = {
            "id": file_meta.id,
            "filename": file_meta.filename,
            "size": file_meta.file_size,
            "content_type": file_meta.content_type,
            "user_id": file_meta.user_id,
            "patient_id": file_meta.patient_id,
            "upload_timestamp": file_meta.upload_timestamp.isoformat(),
            "checksum": file_meta.checksum,
            "description": file_meta.description,
            "dicom_study_id": file_meta.dicom_study_id,
            "dicom_series_id": file_meta.dicom_series_id,
            "dicom_modality": file_meta.dicom_modality,
            "dicom_study_date": file_meta.dicom_study_date.isoformat() if file_meta.dicom_study_date else None,
            "dicom_body_part": body_part,
            "replication_status": replication_data,
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


def _accessible_dicom_files_query(db: Session, current_user: User):
    query = db.query(FileMetadata).filter(FileMetadata.is_deleted == False)
    if current_user.role == "patient":
        resolved_patient_id = _resolve_patient_id_for_user(db, current_user)
        if not resolved_patient_id:
            query = query.filter(False)
        else:
            query = query.filter(FileMetadata.patient_id == resolved_patient_id)
    return query.filter(
        or_(
            FileMetadata.dicom_study_id.isnot(None),
            FileMetadata.content_type.ilike("%dicom%"),
            FileMetadata.filename.ilike("%.dcm"),
            FileMetadata.filename.ilike("%.dicom"),
        )
    )


def _ensure_uncompressed(file_data: bytes) -> bytes:
    """Return file_data as an uncompressed Explicit VR Little Endian DICOM file.

    Files stored before the pipeline fix may still carry a compressed transfer
    syntax.  This function decompresses them on-the-fly at serve time so
    cornerstoneWADOImageLoader always receives plain pixel data it can render.
    """
    try:
        ds = pydicom.dcmread(io.BytesIO(file_data), force=True)
    except Exception:
        return file_data

    ts = getattr(getattr(ds, "file_meta", None), "TransferSyntaxUID", None)
    was_compressed = bool(ts is not None and getattr(ts, "is_compressed", False))
    changed = False

    if was_compressed:
        try:
            # Use pydicom's native decompressor to keep photometric and pixel
            # metadata consistent with the rewritten PixelData payload.
            ds.decompress()
            _rewrite_pixel_data_from_decoded_array(ds)
            changed = True
        except Exception:
            return file_data  # serve original; better than a 500

    original_photometric = getattr(ds, "PhotometricInterpretation", None)
    original_planar = getattr(ds, "PlanarConfiguration", None)
    _repair_decompressed_color_metadata(ds)
    if (
        getattr(ds, "PhotometricInterpretation", None) != original_photometric
        or getattr(ds, "PlanarConfiguration", None) != original_planar
    ):
        changed = True

    if not changed:
        return file_data

    try:
        if not hasattr(ds, "file_meta") or ds.file_meta is None:
            ds.file_meta = pydicom.dataset.FileMetaDataset()
        if was_compressed or getattr(ds.file_meta, "TransferSyntaxUID", None) is None:
            ds.file_meta.TransferSyntaxUID = ExplicitVRLittleEndian
        out = io.BytesIO()
        ds.save_as(out, write_like_original=False)
        return out.getvalue()
    except Exception:
        return file_data  # serve original; better than a 500


def _hydrate_dicom_ids_if_missing(file_meta: FileMetadata) -> Dict[str, Any]:
    """Return a dict of DICOM fields for a file.

    Uses cached DB values when available and only falls back to reading the
    DICOM header from object storage when required fields are missing.
    The instance_uid is always seeded from the DB column so that WADO-URI
    lookups never need to scan headers just to resolve SOPInstanceUID.
    """
    meta: Dict[str, Any] = {
        "study_uid": file_meta.dicom_study_id,
        "series_uid": file_meta.dicom_series_id,
        "modality": file_meta.dicom_modality,
        "study_date": file_meta.dicom_study_date,
        # Seed from cached DB column — avoids header scan for every WADO request
        "instance_uid": getattr(file_meta, "dicom_instance_uid", None),
        "instance_number": getattr(file_meta, "dicom_instance_number", None),
        "patient_name": None,
        "sop_class_uid": None,
        "rows": 0,
        "columns": 0,
        "number_of_frames": None,
        "bits_allocated": None,
        "bits_stored": None,
        "high_bit": None,
        "pixel_representation": None,
        "samples_per_pixel": None,
        "photometric_interpretation": None,
        "window_center": None,
        "window_width": None,
        "image_position_patient": None,
        "image_orientation_patient": None,
        "pixel_spacing": None,
        "rescale_intercept": None,
        "rescale_slope": None,
        "series_number": None,
        "image_type": None,
    }
    # Pixel-level rendering tags are NOT cached in the DB; always read the header
    # so the metadata endpoint can include Rows, Columns, BitsAllocated, etc.
    # If the header is unavailable we fall back to whatever is in meta (mostly nulls)
    # which is safe — Cornerstone reads these from the DICOM file in wadouri mode.
    needs_header = (
        not (file_meta.dicom_study_id and file_meta.dicom_series_id and file_meta.dicom_modality)
        or meta["rows"] == 0
        or meta["bits_allocated"] is None
    )
    if not needs_header:
        return meta

    ds = _read_dicom_header(file_meta.object_key)
    if not ds:
        return meta
    extracted = _extract_dicom_fields_from_dataset(ds)
    for key in meta.keys():
        if extracted.get(key) is not None:
            meta[key] = extracted[key]
    return meta


@app.get("/dicomweb/studies")
async def dicomweb_list_studies(
    StudyInstanceUID: Optional[str] = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """QIDO-RS study search endpoint used by OHIF data source."""
    query = _accessible_dicom_files_query(db, current_user)
    if StudyInstanceUID:
        query = query.filter(FileMetadata.dicom_study_id == StudyInstanceUID)

    files = query.order_by(FileMetadata.upload_timestamp.desc()).all()
    studies: Dict[str, Dict[str, Any]] = {}

    changed = False
    for file_meta in files:
        meta = _hydrate_dicom_ids_if_missing(file_meta)
        study_uid = meta.get("study_uid")
        if not study_uid:
            continue

        # Persist discovered identifiers for existing historical files.
        if not file_meta.dicom_study_id and meta.get("study_uid"):
            file_meta.dicom_study_id = meta["study_uid"]
            changed = True
        if not file_meta.dicom_series_id and meta.get("series_uid"):
            file_meta.dicom_series_id = meta["series_uid"]
            changed = True
        if not file_meta.dicom_modality and meta.get("modality"):
            file_meta.dicom_modality = meta["modality"]
            changed = True
        if not file_meta.dicom_study_date and meta.get("study_date"):
            file_meta.dicom_study_date = meta["study_date"]
            changed = True

        item = studies.setdefault(study_uid, {
            "series": set(),
            "instances": 0,
            "modalities": set(),
            "study_date": meta.get("study_date"),
            "patient_name": meta.get("patient_name"),
        })
        if meta.get("series_uid"):
            item["series"].add(meta["series_uid"])
        if meta.get("modality"):
            item["modalities"].add(meta["modality"])
        item["instances"] += 1

    if changed:
        db.commit()

    sorted_items = list(studies.items())
    paged = sorted_items[offset:offset + max(limit, 1)]
    response = []
    for study_uid, info in paged:
        row = {
            "0020000D": {"vr": "UI", "Value": [study_uid]},
            "00201206": {"vr": "IS", "Value": [str(len(info["series"]))]},
            "00201208": {"vr": "IS", "Value": [str(info["instances"])]},
        }
        da = _dicom_date_to_da(info.get("study_date"))
        if da:
            row["00080020"] = {"vr": "DA", "Value": [da]}
        modalities = sorted(m for m in info["modalities"] if m)
        if modalities:
            row["00080061"] = {"vr": "CS", "Value": modalities}
        if info.get("patient_name"):
            row["00100010"] = {"vr": "PN", "Value": [{"Alphabetic": info["patient_name"]}]}
        response.append(row)
    return JSONResponse(content=response)


@app.get("/dicomweb/studies/{study_uid}/series")
async def dicomweb_list_series(
    study_uid: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """QIDO-RS series search endpoint for a study."""
    files = (
        _accessible_dicom_files_query(db, current_user)
        .filter(FileMetadata.dicom_study_id == study_uid)
        .order_by(FileMetadata.upload_timestamp.desc())
        .all()
    )

    series_map: Dict[str, Dict[str, Any]] = {}
    changed = False
    for file_meta in files:
        meta = _hydrate_dicom_ids_if_missing(file_meta)
        series_uid = meta.get("series_uid")
        if not series_uid:
            continue

        if not file_meta.dicom_series_id and series_uid:
            file_meta.dicom_series_id = series_uid
            changed = True

        entry = series_map.setdefault(series_uid, {
            "modality": meta.get("modality"),
            "count": 0,
            "description": file_meta.description or file_meta.filename,
        })
        entry["count"] += 1

    if changed:
        db.commit()

    response = []
    for series_uid, info in series_map.items():
        row = {
            "0020000D": {"vr": "UI", "Value": [study_uid]},
            "0020000E": {"vr": "UI", "Value": [series_uid]},
            "00201209": {"vr": "IS", "Value": [str(info["count"])]},
            "0008103E": {"vr": "LO", "Value": [info["description"]]},
        }
        if info.get("modality"):
            row["00080060"] = {"vr": "CS", "Value": [info["modality"]]}
        response.append(row)
    return JSONResponse(content=response)


@app.get("/dicomweb/studies/{study_uid}/series/{series_uid}/instances")
async def dicomweb_list_instances(
    study_uid: str,
    series_uid: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """QIDO-RS instance search endpoint for a study/series."""
    files = (
        _accessible_dicom_files_query(db, current_user)
        .filter(
            FileMetadata.dicom_study_id == study_uid,
            FileMetadata.dicom_series_id == series_uid,
        )
        .order_by(FileMetadata.upload_timestamp.asc())
        .all()
    )
    # Sort by InstanceNumber in Python so this works even before the DB migration
    # has added the dicom_instance_number column to existing containers.
    files.sort(key=lambda f: (getattr(f, "dicom_instance_number", None) or 0x7FFFFFFF))

    response = []
    for file_meta in files:
        meta = _hydrate_dicom_ids_if_missing(file_meta)
        instance_uid = meta.get("instance_uid") or f"2.25.{file_meta.id}"
        sop_class_uid = meta.get("sop_class_uid") or "1.2.840.10008.5.1.4.1.1.7"
        row = {
            "00080016": {"vr": "UI", "Value": [sop_class_uid]},
            "00080018": {"vr": "UI", "Value": [instance_uid]},
            "0020000D": {"vr": "UI", "Value": [study_uid]},
            "0020000E": {"vr": "UI", "Value": [series_uid]},
            "00080060": {"vr": "CS", "Value": [meta.get("modality") or "OT"]},
        }
        rows = meta.get("rows") or 0
        cols = meta.get("columns") or 0
        if rows:
            row["00280010"] = {"vr": "US", "Value": [rows]}
        if cols:
            row["00280011"] = {"vr": "US", "Value": [cols]}
        if meta.get("instance_number") is not None:
            row["00200013"] = {"vr": "IS", "Value": [str(meta["instance_number"])]}
        response.append(row)
    return JSONResponse(content=response)


def _dicom_instance_metadata_item(file_meta: FileMetadata, study_uid: str, series_uid: str) -> Dict[str, Any]:
    meta = _hydrate_dicom_ids_if_missing(file_meta)
    instance_uid = meta.get("instance_uid") or f"2.25.{file_meta.id}"
    sop_class_uid = meta.get("sop_class_uid") or "1.2.840.10008.5.1.4.1.1.7"

    item: Dict[str, Any] = {
        "00080016": {"vr": "UI", "Value": [sop_class_uid]},
        "00080018": {"vr": "UI", "Value": [instance_uid]},
        "00080060": {"vr": "CS", "Value": [meta.get("modality") or "OT"]},
        "0020000D": {"vr": "UI", "Value": [study_uid]},
        "0020000E": {"vr": "UI", "Value": [series_uid]},
    }

    da = _dicom_date_to_da(meta.get("study_date"))
    if da:
        item["00080020"] = {"vr": "DA", "Value": [da]}
    if meta.get("patient_name"):
        item["00100010"] = {"vr": "PN", "Value": [{"Alphabetic": meta["patient_name"]}]}

    # Pixel geometry
    rows = meta.get("rows") or 0
    cols = meta.get("columns") or 0
    if rows:
        item["00280010"] = {"vr": "US", "Value": [rows]}
    if cols:
        item["00280011"] = {"vr": "US", "Value": [cols]}

    # --- Rendering-critical tags required by OHIF ---

    # InstanceNumber (00200013): determines slice ordering in the display set
    if meta.get("instance_number") is not None:
        item["00200013"] = {"vr": "IS", "Value": [str(meta["instance_number"])]}

    # NumberOfFrames (00280008): multi-frame support
    if meta.get("number_of_frames") and meta["number_of_frames"] > 1:
        item["00280008"] = {"vr": "IS", "Value": [str(meta["number_of_frames"])]}

    # Pixel encoding
    if meta.get("bits_allocated") is not None:
        item["00280100"] = {"vr": "US", "Value": [meta["bits_allocated"]]}
    if meta.get("bits_stored") is not None:
        item["00280101"] = {"vr": "US", "Value": [meta["bits_stored"]]}
    if meta.get("high_bit") is not None:
        item["00280102"] = {"vr": "US", "Value": [meta["high_bit"]]}
    if meta.get("pixel_representation") is not None:
        item["00280103"] = {"vr": "US", "Value": [meta["pixel_representation"]]}
    if meta.get("samples_per_pixel") is not None:
        item["00280002"] = {"vr": "US", "Value": [meta["samples_per_pixel"]]}
    if meta.get("photometric_interpretation"):
        item["00280004"] = {"vr": "CS", "Value": [meta["photometric_interpretation"]]}

    # Window center/width — default display windowing
    if meta.get("window_center"):
        item["00281050"] = {"vr": "DS", "Value": [str(v) for v in meta["window_center"]]}
    if meta.get("window_width"):
        item["00281051"] = {"vr": "DS", "Value": [str(v) for v in meta["window_width"]]}

    # Spatial positioning — required for MPR and correct slice display
    if meta.get("image_position_patient"):
        item["00200032"] = {"vr": "DS", "Value": [str(v) for v in meta["image_position_patient"]]}
    if meta.get("image_orientation_patient"):
        item["00200037"] = {"vr": "DS", "Value": [str(v) for v in meta["image_orientation_patient"]]}
    if meta.get("pixel_spacing"):
        item["00280030"] = {"vr": "DS", "Value": [str(v) for v in meta["pixel_spacing"]]}

    # Rescale slope/intercept (Hounsfield units for CT)
    if meta.get("rescale_intercept"):
        item["00281052"] = {"vr": "DS", "Value": [str(v) for v in meta["rescale_intercept"]]}
    if meta.get("rescale_slope"):
        item["00281053"] = {"vr": "DS", "Value": [str(v) for v in meta["rescale_slope"]]}

    # Series number
    if meta.get("series_number") is not None:
        item["00200011"] = {"vr": "IS", "Value": [str(meta["series_number"])]}

    if meta.get("image_type"):
        item["00080008"] = {"vr": "CS", "Value": meta["image_type"].split("\\")}

    return item


@app.get("/dicomweb/studies/{study_uid}/metadata")
async def dicomweb_study_metadata(
    study_uid: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """WADO-RS study metadata endpoint used by OHIF study loaders."""
    files = (
        _accessible_dicom_files_query(db, current_user)
        .filter(FileMetadata.dicom_study_id == study_uid)
        .order_by(FileMetadata.upload_timestamp.desc())
        .all()
    )

    response: List[Dict[str, Any]] = []
    for file_meta in files:
        meta = _hydrate_dicom_ids_if_missing(file_meta)
        series_uid = meta.get("series_uid") or file_meta.dicom_series_id
        if not series_uid:
            continue
        response.append(_dicom_instance_metadata_item(file_meta, study_uid, series_uid))

    return JSONResponse(content=response, media_type="application/dicom+json")


@app.get("/dicomweb/studies/{study_uid}/series/{series_uid}/metadata")
async def dicomweb_series_metadata(
    study_uid: str,
    series_uid: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """WADO-RS series metadata endpoint used by OHIF display set loading."""
    files = (
        _accessible_dicom_files_query(db, current_user)
        .filter(
            FileMetadata.dicom_study_id == study_uid,
            FileMetadata.dicom_series_id == series_uid,
        )
        .order_by(FileMetadata.upload_timestamp.desc())
        .all()
    )

    response = [_dicom_instance_metadata_item(file_meta, study_uid, series_uid) for file_meta in files]
    return JSONResponse(content=response, media_type="application/dicom+json")


@app.get("/dicomweb/wado")
async def dicomweb_wado_uri(
    requestType: str = "WADO",
    studyUID: Optional[str] = None,
    seriesUID: Optional[str] = None,
    objectUID: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """WADO-URI retrieval endpoint kept for legacy compatibility."""
    if requestType.upper() != "WADO":
        raise HTTPException(status_code=400, detail="Only requestType=WADO is supported")
    if not studyUID or not seriesUID:
        raise HTTPException(status_code=400, detail="studyUID and seriesUID are required")

    candidates = (
        _accessible_dicom_files_query(db, current_user)
        .filter(
            FileMetadata.dicom_study_id == studyUID,
            FileMetadata.dicom_series_id == seriesUID,
        )
        .order_by(FileMetadata.upload_timestamp.desc())
        .all()
    )
    if not candidates:
        raise HTTPException(status_code=404, detail="No DICOM objects found for study/series")

    selected: Optional[FileMetadata] = None
    if objectUID:
        # 1. Fast path: match against the cached SOPInstanceUID column (O(1))
        selected = next(
            (f for f in candidates if getattr(f, "dicom_instance_uid", None) == objectUID),
            None,
        )

        # 2. Synthetic fallback UIDs of the form "2.25.<db_id>" emitted by /instances
        if not selected and objectUID.startswith("2.25."):
            synthetic_suffix = objectUID[5:]
            if synthetic_suffix.isdigit():
                synthetic_id = int(synthetic_suffix)
                selected = next((f for f in candidates if f.id == synthetic_id), None)

        # 3. Last resort: header scan for files uploaded before the instance_uid column existed
        if not selected:
            for file_meta in candidates:
                ds = _read_dicom_header(file_meta.object_key)
                if not ds:
                    continue
                if str(ds.get("SOPInstanceUID", "")).strip() == objectUID:
                    selected = file_meta
                    break

        # 4. Single-candidate fallback when headers are too broken to match
        if not selected and len(candidates) == 1:
            selected = candidates[0]
    else:
        selected = candidates[0]

    if not selected:
        raise HTTPException(status_code=404, detail="Requested DICOM object not found")

    if not can_access_file(db, selected.id, current_user.id, current_user.role, selected.user_id):
        raise HTTPException(status_code=403, detail="Consent required to access this DICOM object")

    file_data = minio_cluster.get_file_from_node(
        object_name=selected.object_key,
        bucket_name="dfs-files",
    )
    if not file_data:
        raise HTTPException(status_code=404, detail="DICOM object not available in object storage")

    # On-the-fly decompression for files stored before the pipeline fix.
    # Runs in a thread-pool executor so it doesn't block the async event loop.
    loop = asyncio.get_event_loop()
    file_data = await loop.run_in_executor(None, _ensure_uncompressed, file_data)

    return StreamingResponse(
        io.BytesIO(file_data),
        media_type="application/dicom",
        headers={
            "Content-Disposition": f'inline; filename="{selected.filename}"',
        },
    )


@app.get("/dicomweb/studies/{study_uid}/series/{series_uid}/instances/{instance_uid}")
async def dicomweb_wado_rs_retrieve(
    study_uid: str,
    series_uid: str,
    instance_uid: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """WADO-RS instance retrieve — GET .../instances/{SOPInstanceUID}.

    This is OHIF's modern (wadors) retrieval codepath. Returns the raw DICOM
    file for a single SOP instance wrapped in a multipart/related response.
    """
    # 1. Fast path: cached SOPInstanceUID column
    file_meta = (
        _accessible_dicom_files_query(db, current_user)
        .filter(
            FileMetadata.dicom_study_id == study_uid,
            FileMetadata.dicom_series_id == series_uid,
            FileMetadata.dicom_instance_uid == instance_uid,
        )
        .first()
    )

    # 2. Synthetic UID fallback
    if not file_meta and instance_uid.startswith("2.25."):
        suffix = instance_uid[5:]
        if suffix.isdigit():
            file_meta = (
                _accessible_dicom_files_query(db, current_user)
                .filter(
                    FileMetadata.dicom_study_id == study_uid,
                    FileMetadata.dicom_series_id == series_uid,
                    FileMetadata.id == int(suffix),
                )
                .first()
            )

    if not file_meta:
        raise HTTPException(status_code=404, detail="DICOM instance not found")

    if not can_access_file(db, file_meta.id, current_user.id, current_user.role, file_meta.user_id):
        raise HTTPException(status_code=403, detail="Consent required to access this DICOM object")

    file_data = minio_cluster.get_file_from_node(
        object_name=file_meta.object_key,
        bucket_name="dfs-files",
    )
    if not file_data:
        raise HTTPException(status_code=404, detail="DICOM object not available in object storage")

    loop = asyncio.get_event_loop()
    file_data = await loop.run_in_executor(None, _ensure_uncompressed, file_data)

    boundary = "dicomBoundary"
    # RFC 2046: boundary value must NOT be quoted in the body delimiter lines.
    # The Content-Type header must use the unquoted form too so that parsers
    # comparing header boundary == body delimiter don't mismatch.
    body = (
        f"--{boundary}\r\n"
        f"Content-Type: application/dicom\r\n"
        f"Content-Length: {len(file_data)}\r\n"
        f"\r\n"
    ).encode("latin-1") + file_data + f"\r\n--{boundary}--\r\n".encode("latin-1")

    return Response(
        content=body,
        status_code=200,
        headers={
            "Content-Type": f'multipart/related; type="application/dicom"; boundary={boundary}',
            "Content-Disposition": f'inline; filename="{file_meta.filename}"',
        },
    )


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
