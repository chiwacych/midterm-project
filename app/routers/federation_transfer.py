# Federation File Transfer API
# Handles cross-hospital file sharing with patient metadata
# Now uses libp2p via Go gRPC sidecar for cross-hospital transfers

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, BackgroundTasks, Request
from sqlalchemy.orm import Session
from sqlalchemy import desc
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import os
import uuid
import hashlib
import httpx
import io
import logging

from database import get_db
from models import (
    FileMetadata, Patient, FederationTransfer, User,
    Consent, AccessRequest, AuditLog
)
from auth import get_current_user, require_roles
from minio_client import minio_cluster
import audit

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/federation/transfer", tags=["federation-transfer"])

HOSPITAL_ID = os.getenv("HOSPITAL_ID", "hospital-a")
HOSPITAL_NAME = os.getenv("HOSPITAL_NAME", "Hospital A")


# ── Pydantic models ──

class ShareFileRequest(BaseModel):
    """Request to share a file with another hospital"""
    file_id: int
    target_hospital_id: str
    target_peer_id: str = ""           # libp2p peer ID (preferred)
    target_hospital_endpoint: str = "" # legacy HTTP endpoint (fallback)
    reason: str = "Clinical consultation"


class IncomingTransferMetadata(BaseModel):
    """Metadata sent with a cross-hospital file transfer"""
    transfer_id: str
    source_hospital_id: str
    source_hospital_name: str
    # File info
    original_filename: str
    content_type: str = "application/octet-stream"
    checksum: str = ""  # SHA256
    # Patient info
    patient_name: str
    patient_mrn: Optional[str] = None
    patient_dob: Optional[str] = None  # ISO date string
    patient_email: Optional[str] = None
    patient_phone: Optional[str] = None
    # Consent reference
    reason: str = ""
    consent_reference: Optional[str] = None


class TransferStatus(BaseModel):
    id: int
    transfer_id: str
    direction: str
    source_hospital_id: str
    source_hospital_name: Optional[str]
    dest_hospital_id: str
    dest_hospital_name: Optional[str]
    original_filename: str
    file_size: Optional[int]
    patient_name: Optional[str]
    patient_mrn: Optional[str]
    status: str
    initiated_at: Optional[str]
    completed_at: Optional[str]
    error_message: Optional[str]


# ── SENDING: Share a file to another hospital ──

@router.post("/share")
async def share_file_to_hospital(
    request: ShareFileRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["admin", "doctor"]))
):
    """
    Share a file with another hospital in the federation.
    
    Transfer path (hybrid libp2p):
      Python → gRPC TransferFile → Go sidecar → libp2p stream → remote Go → remote MinIO
    
    Falls back to legacy HTTP POST if the Go sidecar is unreachable.
    """
    
    # 1. Get the file metadata
    file_meta = db.query(FileMetadata).filter(FileMetadata.id == request.file_id).first()
    if not file_meta:
        raise HTTPException(status_code=404, detail="File not found")
    
    # 2. Get patient metadata
    patient = None
    if file_meta.patient_id:
        patient = db.query(Patient).filter(Patient.id == file_meta.patient_id).first()
    
    # 3. Create transfer record
    transfer_id = str(uuid.uuid4())
    transfer = FederationTransfer(
        transfer_id=transfer_id,
        direction="sent",
        source_hospital_id=HOSPITAL_ID,
        source_hospital_name=HOSPITAL_NAME,
        dest_hospital_id=request.target_hospital_id,
        dest_hospital_name=request.target_hospital_id,  # Will be resolved
        file_id=file_meta.id,
        original_filename=file_meta.original_filename,
        file_size=file_meta.file_size,
        content_type=file_meta.content_type,
        checksum=file_meta.checksum,
        patient_id=file_meta.patient_id,
        patient_name=patient.full_name if patient else None,
        patient_mrn=patient.medical_record_number if patient else None,
        patient_dob=patient.date_of_birth if patient else None,
        status="pending"
    )
    db.add(transfer)
    db.commit()
    db.refresh(transfer)
    
    # 4. Execute transfer in background via gRPC → libp2p (preferred) or legacy HTTP
    background_tasks.add_task(
        _execute_outbound_transfer,
        transfer_id=transfer_id,
        file_meta=file_meta,
        patient=patient,
        target_peer_id=request.target_peer_id,
        target_hospital_id=request.target_hospital_id,
        target_hospital_endpoint=request.target_hospital_endpoint,
        reason=request.reason,
        user_id=current_user.id,
    )
    
    # 5. Audit
    audit.log_audit_event(
        event_type="federation.transfer.initiated",
        user_id=current_user.id,
        action=f"Initiated file transfer to {request.target_hospital_id}",
        resource="federation_transfer",
        resource_id=transfer_id,
        details={
            "filename": file_meta.original_filename,
            "target_hospital": request.target_hospital_id,
        },
    )
    
    return {
        "success": True,
        "transfer_id": transfer_id,
        "status": "pending",
        "message": f"Transfer initiated to {request.target_hospital_id}"
    }


async def _execute_outbound_transfer(
    transfer_id: str,
    file_meta,
    patient,
    target_peer_id: str,
    target_hospital_id: str,
    target_hospital_endpoint: str,
    reason: str,
    user_id: int,
):
    """
    Background task: transfer file via Go gRPC sidecar (libp2p).
    Falls back to legacy HTTP POST if gRPC is unavailable.
    """
    from database import SessionLocal
    db = SessionLocal()
    
    try:
        transfer = db.query(FederationTransfer).filter(
            FederationTransfer.transfer_id == transfer_id
        ).first()
        if not transfer:
            return
        transfer.status = "in_progress"
        db.commit()

        # ── Primary path: gRPC → Go sidecar → libp2p ──
        from federation_client import federation_transfer_file
        
        grpc_result = federation_transfer_file(
            target_peer_id=target_peer_id or "",
            target_hospital_id=target_hospital_id,
            bucket=file_meta.bucket_name or "dfs-files",
            object_key=file_meta.object_key,
            original_filename=file_meta.original_filename,
            content_type=file_meta.content_type or "application/octet-stream",
            checksum=file_meta.checksum or "",
            patient_name=patient.full_name if patient else "Unknown",
            patient_mrn=patient.medical_record_number if patient else "",
            patient_dob=str(patient.date_of_birth) if patient and patient.date_of_birth else "",
            reason=reason,
            source_hospital_id=HOSPITAL_ID,
            source_hospital_name=HOSPITAL_NAME,
            transfer_id=transfer_id,
        )

        if grpc_result and grpc_result.get("success"):
            transfer.status = "completed"
            transfer.completed_at = datetime.utcnow()
            transfer.dest_hospital_name = grpc_result.get("receiving_hospital_name", target_hospital_id)
            logger.info(f"Transfer {transfer_id} completed via libp2p: {grpc_result.get('message')}")
            db.commit()
            return

        # Log gRPC failure reason
        grpc_msg = grpc_result.get("message", "unknown") if grpc_result else "gRPC unavailable"
        logger.warning(f"Transfer {transfer_id} libp2p failed: {grpc_msg}, trying legacy HTTP...")

        # ── Fallback: legacy HTTP POST ──
        if target_hospital_endpoint:
            await _execute_legacy_http_transfer(
                db, transfer, transfer_id, file_meta, patient, target_hospital_id,
                target_hospital_endpoint, reason,
            )
        else:
            transfer.status = "failed"
            transfer.error_message = f"libp2p: {grpc_msg}; no HTTP endpoint for fallback"
            db.commit()

    except Exception as e:
        logger.error(f"Transfer {transfer_id} error: {e}")
        try:
            transfer = db.query(FederationTransfer).filter(
                FederationTransfer.transfer_id == transfer_id
            ).first()
            if transfer:
                transfer.status = "failed"
                transfer.error_message = str(e)[:500]
                db.commit()
        except Exception:
            pass
    finally:
        db.close()


async def _execute_legacy_http_transfer(
    db, transfer, transfer_id, file_meta, patient,
    target_hospital_id, target_hospital_endpoint, reason,
):
    """Fallback: download from MinIO and HTTP POST to target hospital."""
    resolved_endpoint = _resolve_peer_endpoint(target_hospital_id, target_hospital_endpoint)

    file_data = minio_cluster.get_file_from_node(
        file_meta.object_key, bucket_name=file_meta.bucket_name
    )
    if file_data is None:
        transfer.status = "failed"
        transfer.error_message = "Failed to download file from local storage"
        db.commit()
        return

    meta = IncomingTransferMetadata(
        transfer_id=transfer_id,
        source_hospital_id=HOSPITAL_ID,
        source_hospital_name=HOSPITAL_NAME,
        original_filename=file_meta.original_filename,
        content_type=file_meta.content_type or "application/octet-stream",
        checksum=file_meta.checksum or "",
        patient_name=patient.full_name if patient else "Unknown",
        patient_mrn=patient.medical_record_number if patient else None,
        patient_dob=str(patient.date_of_birth) if patient and patient.date_of_birth else None,
        patient_email=patient.email if patient else None,
        patient_phone=patient.phone if patient else None,
        reason=reason,
    )

    target_url = f"{resolved_endpoint.rstrip('/')}/api/federation/transfer/receive"
    logger.info(f"Legacy HTTP transfer to {target_url}")

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                target_url,
                files={"file": (file_meta.original_filename, file_data, file_meta.content_type or "application/octet-stream")},
                data={"metadata": meta.json()},
            )
    except (httpx.ConnectError, httpx.TimeoutException) as exc:
        transfer.status = "failed"
        transfer.error_message = f"HTTP fallback failed: {exc}"
        db.commit()
        return

    if response.status_code == 200:
        result = response.json()
        transfer.status = "completed"
        transfer.completed_at = datetime.utcnow()
        transfer.dest_hospital_name = result.get("receiving_hospital_name", target_hospital_id)
        logger.info(f"Transfer {transfer_id} completed via HTTP fallback")
    else:
        transfer.status = "failed"
        transfer.error_message = f"HTTP {response.status_code}: {response.text[:500]}"
    db.commit()


# ── RECEIVING: Accept incoming file from another hospital ──

@router.post("/receive")
async def receive_file_from_hospital(
    request: Request,
    file: UploadFile = File(...),
    metadata: str = Form(...),
    db: Session = Depends(get_db),
):
    """
    Receive a file from another hospital in the federation.
    
    This endpoint is called by a remote hospital's share endpoint.
    It:
    1. Parses the incoming patient metadata
    2. Finds or creates a local patient record
    3. Stores the file in local MinIO
    4. Creates file_metadata record
    5. Records the transfer
    6. Creates audit trail
    
    No authentication required — this is a server-to-server endpoint
    protected by network/mTLS at the infrastructure level.
    """
    import json
    
    try:
        meta = IncomingTransferMetadata.parse_raw(metadata)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid metadata: {e}")
    
    logger.info(
        f"Receiving file '{meta.original_filename}' from "
        f"{meta.source_hospital_name} ({meta.source_hospital_id})"
    )
    
    # 1. Find or create patient record
    patient = _find_or_create_patient(db, meta)
    
    # 2. Read file content
    file_content = await file.read()
    file_size = len(file_content)
    
    # Compute SHA256
    sha256 = hashlib.sha256(file_content).hexdigest()
    
    # 3. Upload to local MinIO
    bucket_name = "dfs-files"
    # Prefix with source hospital to organize received files
    object_key = f"federation/{meta.source_hospital_id}/{meta.transfer_id}/{meta.original_filename}"
    
    try:
        minio_cluster.upload_file_to_all_nodes(
            file_data=file_content,
            object_name=object_key,
            bucket_name=bucket_name,
            content_type=meta.content_type,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to store file: {e}")
    
    # 4. Create file_metadata record
    file_meta = FileMetadata(
        filename=meta.original_filename,
        original_filename=meta.original_filename,
        file_size=file_size,
        content_type=meta.content_type,
        user_id=f"federation:{meta.source_hospital_id}",
        patient_id=patient.id if patient else None,
        bucket_name=bucket_name,
        object_key=object_key,
        checksum=sha256,
        description=f"Received from {meta.source_hospital_name} — {meta.reason}",
    )
    db.add(file_meta)
    db.flush()
    
    # 5. Create transfer record
    transfer = FederationTransfer(
        transfer_id=meta.transfer_id,
        direction="received",
        source_hospital_id=meta.source_hospital_id,
        source_hospital_name=meta.source_hospital_name,
        dest_hospital_id=HOSPITAL_ID,
        dest_hospital_name=HOSPITAL_NAME,
        file_id=file_meta.id,
        original_filename=meta.original_filename,
        file_size=file_size,
        content_type=meta.content_type,
        checksum=sha256,
        patient_id=patient.id if patient else None,
        patient_name=meta.patient_name,
        patient_mrn=meta.patient_mrn,
        patient_dob=datetime.strptime(meta.patient_dob, "%Y-%m-%d").date() if meta.patient_dob else None,
        status="completed",
        completed_at=datetime.utcnow(),
    )
    db.add(transfer)
    
    db.commit()
    
    # 6. Audit
    audit.log_audit_event(
        event_type="federation.transfer.received",
        user_id=None,
        action=f"Received file from {meta.source_hospital_name}",
        resource="federation_transfer",
        resource_id=meta.transfer_id,
        details={
            "filename": meta.original_filename,
            "patient_name": meta.patient_name,
            "source_hospital": meta.source_hospital_id,
        },
        ip_address=request.client.host if request.client else None,
    )
    
    logger.info(
        f"Successfully received and stored '{meta.original_filename}' "
        f"from {meta.source_hospital_name}, patient_id={patient.id if patient else 'N/A'}"
    )
    
    return {
        "success": True,
        "transfer_id": meta.transfer_id,
        "receiving_hospital_id": HOSPITAL_ID,
        "receiving_hospital_name": HOSPITAL_NAME,
        "file_id": file_meta.id,
        "patient_id": patient.id if patient else None,
        "patient_created": patient is not None,
        "message": "File received and stored successfully",
    }


def _find_or_create_patient(db: Session, meta: IncomingTransferMetadata) -> Optional[Patient]:
    """
    Find or create a patient record based on incoming transfer metadata.
    
    Matching strategy (per Kenya DPA — use identity hashes):
    1. Match by MRN if provided
    2. Match by name+email hash
    3. Match by name+phone hash
    4. Create new patient if no match
    """
    if not meta.patient_name or meta.patient_name == "Unknown":
        return None
    
    # Try MRN match first
    if meta.patient_mrn:
        patient = db.query(Patient).filter(
            Patient.medical_record_number == meta.patient_mrn
        ).first()
        if patient:
            logger.info(f"Matched patient by MRN: {meta.patient_mrn} → id={patient.id}")
            return patient
    
    # Try name+email hash
    if meta.patient_email:
        name_email_hash = hashlib.sha256(
            f"{meta.patient_name.strip().lower()}{meta.patient_email.strip().lower()}".encode()
        ).hexdigest()
        patient = db.query(Patient).filter(
            Patient.name_email_hash == name_email_hash
        ).first()
        if patient:
            logger.info(f"Matched patient by name+email hash → id={patient.id}")
            return patient
    
    # Try name+phone hash
    if meta.patient_phone:
        name_phone_hash = hashlib.sha256(
            f"{meta.patient_name.strip().lower()}{meta.patient_phone.strip()}".encode()
        ).hexdigest()
        patient = db.query(Patient).filter(
            Patient.name_phone_hash == name_phone_hash
        ).first()
        if patient:
            logger.info(f"Matched patient by name+phone hash → id={patient.id}")
            return patient
    
    # No match — create new patient
    logger.info(f"No existing patient match, creating new: {meta.patient_name}")
    
    # Build identity hashes
    name_email_hash = None
    name_phone_hash = None
    name_email_phone_hash = None
    
    name_lower = meta.patient_name.strip().lower()
    if meta.patient_email:
        email_lower = meta.patient_email.strip().lower()
        name_email_hash = hashlib.sha256(f"{name_lower}{email_lower}".encode()).hexdigest()
    if meta.patient_phone:
        phone_clean = meta.patient_phone.strip()
        name_phone_hash = hashlib.sha256(f"{name_lower}{phone_clean}".encode()).hexdigest()
    if meta.patient_email and meta.patient_phone:
        name_email_phone_hash = hashlib.sha256(
            f"{name_lower}{meta.patient_email.strip().lower()}{meta.patient_phone.strip()}".encode()
        ).hexdigest()
    
    new_patient = Patient(
        full_name=meta.patient_name,
        email=meta.patient_email,
        phone=meta.patient_phone,
        date_of_birth=(
            datetime.strptime(meta.patient_dob, "%Y-%m-%d").date()
            if meta.patient_dob else None
        ),
        medical_record_number=meta.patient_mrn,
        name_email_hash=name_email_hash,
        name_phone_hash=name_phone_hash,
        name_email_phone_hash=name_email_phone_hash,
        notes=f"Auto-created from federation transfer by {meta.source_hospital_name}",
    )
    db.add(new_patient)
    db.flush()
    
    logger.info(f"Created patient id={new_patient.id} for {meta.patient_name}")
    return new_patient


# ── Transfer history ──

@router.get("/history", response_model=List[TransferStatus])
async def get_transfer_history(
    direction: Optional[str] = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["admin", "doctor"])),
):
    """Get history of federation file transfers."""
    query = db.query(FederationTransfer)
    if direction:
        query = query.filter(FederationTransfer.direction == direction)
    
    transfers = query.order_by(desc(FederationTransfer.initiated_at)).limit(limit).all()
    
    return [
        TransferStatus(
            id=t.id,
            transfer_id=t.transfer_id,
            direction=t.direction,
            source_hospital_id=t.source_hospital_id,
            source_hospital_name=t.source_hospital_name,
            dest_hospital_id=t.dest_hospital_id,
            dest_hospital_name=t.dest_hospital_name,
            original_filename=t.original_filename,
            file_size=t.file_size,
            patient_name=t.patient_name,
            patient_mrn=t.patient_mrn,
            status=t.status,
            initiated_at=t.initiated_at.isoformat() if t.initiated_at else None,
            completed_at=t.completed_at.isoformat() if t.completed_at else None,
            error_message=t.error_message,
        )
        for t in transfers
    ]


@router.get("/status/{transfer_id}")
async def get_transfer_status(
    transfer_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(["admin", "doctor"])),
):
    """Get status of a specific transfer."""
    transfer = db.query(FederationTransfer).filter(
        FederationTransfer.transfer_id == transfer_id
    ).first()
    
    if not transfer:
        raise HTTPException(status_code=404, detail="Transfer not found")
    
    return TransferStatus(
        id=transfer.id,
        transfer_id=transfer.transfer_id,
        direction=transfer.direction,
        source_hospital_id=transfer.source_hospital_id,
        source_hospital_name=transfer.source_hospital_name,
        dest_hospital_id=transfer.dest_hospital_id,
        dest_hospital_name=transfer.dest_hospital_name,
        original_filename=transfer.original_filename,
        file_size=transfer.file_size,
        patient_name=transfer.patient_name,
        patient_mrn=transfer.patient_mrn,
        status=transfer.status,
        initiated_at=transfer.initiated_at.isoformat() if transfer.initiated_at else None,
        completed_at=transfer.completed_at.isoformat() if transfer.completed_at else None,
        error_message=transfer.error_message,
    )


# ── Federation peers summary for sharing UI ──

@router.get("/peers")
async def get_available_peers(
    current_user: User = Depends(require_roles(["admin", "doctor"])),
):
    """
    Get list of reachable peer hospitals for the sharing dialog.
    Prefers libp2p-discovered peers, falls back to env/registry.
    """
    peers = []
    seen = set()

    # 1. From libp2p (primary source)
    from federation_client import federation_list_peers
    libp2p_peers = federation_list_peers()
    if libp2p_peers:
        for p in libp2p_peers:
            hid = p.get("hospital_id", "")
            if hid and hid != HOSPITAL_ID and hid not in seen:
                peers.append({
                    "hospital_id": hid,
                    "hospital_name": p.get("hospital_name", hid.replace("-", " ").title()),
                    "peer_id": p.get("peer_id", ""),
                    "addresses": p.get("addresses", []),
                    "reachable": p.get("reachable", False),
                    "latency_ms": p.get("latency_ms", -1),
                    "source": "libp2p",
                })
                seen.add(hid)

    # 2. From FEDERATION_PEER_* env vars (fallback)
    api_port = os.getenv("API_PORT", "8000")
    for key, value in os.environ.items():
        if key.startswith("FEDERATION_PEER_"):
            peer_id_derived = key.replace("FEDERATION_PEER_", "").lower().replace("_", "-")
            grpc_endpoint = value
            host = grpc_endpoint.split(":")[0]
            api_endpoint = f"http://{host}:{api_port}"

            if peer_id_derived not in seen:
                peers.append({
                    "hospital_id": peer_id_derived,
                    "hospital_name": peer_id_derived.replace("-", " ").title(),
                    "peer_id": "",
                    "api_endpoint": api_endpoint,
                    "grpc_endpoint": grpc_endpoint,
                    "source": "environment",
                })
                seen.add(peer_id_derived)

    # 3. From federation registry (fallback)
    try:
        from routers.federation_registry import get_registry
        registry = get_registry()
        for hid, meta in registry.hospitals.items():
            if hid != HOSPITAL_ID and hid not in seen:
                peers.append({
                    "hospital_id": hid,
                    "hospital_name": meta.hospital_name,
                    "peer_id": "",
                    "api_endpoint": meta.api_endpoint,
                    "grpc_endpoint": meta.federation_endpoint,
                    "source": "registry",
                })
                seen.add(hid)
    except Exception:
        pass

    return {"peers": peers, "total": len(peers)}


# ── Internal endpoint for Go sidecar → Python DB record creation ──

class InternalReceiveRequest(BaseModel):
    """Called by the local Go sidecar when it receives a file via libp2p.
    The file is already stored in MinIO; this just creates DB records."""
    transfer_id: str
    source_hospital_id: str
    source_hospital_name: str
    original_filename: str
    content_type: str = "application/octet-stream"
    checksum: str = ""
    file_size: int = 0
    object_key: str
    bucket_name: str = "dfs-files"
    patient_name: str = "Unknown"
    patient_mrn: Optional[str] = None
    patient_dob: Optional[str] = None
    reason: str = ""


@router.post("/receive-internal")
async def receive_file_internal(
    body: InternalReceiveRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Internal endpoint called by the local Go federation sidecar.
    
    The Go sidecar has already stored the file in MinIO via libp2p.
    This endpoint just creates the DB records (file_metadata, patient,
    federation_transfer, audit).
    """
    logger.info(
        f"receive-internal: '{body.original_filename}' from "
        f"{body.source_hospital_name} ({body.source_hospital_id}), "
        f"object_key={body.object_key}"
    )

    # Build a pseudo IncomingTransferMetadata for patient matching
    meta = IncomingTransferMetadata(
        transfer_id=body.transfer_id,
        source_hospital_id=body.source_hospital_id,
        source_hospital_name=body.source_hospital_name,
        original_filename=body.original_filename,
        content_type=body.content_type,
        checksum=body.checksum,
        patient_name=body.patient_name,
        patient_mrn=body.patient_mrn,
        patient_dob=body.patient_dob,
        reason=body.reason,
    )

    # Find or create patient
    patient = _find_or_create_patient(db, meta)

    # Create file_metadata record (file already in MinIO)
    file_meta = FileMetadata(
        filename=body.original_filename,
        original_filename=body.original_filename,
        file_size=body.file_size,
        content_type=body.content_type,
        user_id=f"federation:{body.source_hospital_id}",
        patient_id=patient.id if patient else None,
        bucket_name=body.bucket_name,
        object_key=body.object_key,
        checksum=body.checksum,
        description=f"Received via libp2p from {body.source_hospital_name} — {body.reason}",
    )
    db.add(file_meta)
    db.flush()

    # Create transfer record
    transfer = FederationTransfer(
        transfer_id=body.transfer_id,
        direction="received",
        source_hospital_id=body.source_hospital_id,
        source_hospital_name=body.source_hospital_name,
        dest_hospital_id=HOSPITAL_ID,
        dest_hospital_name=HOSPITAL_NAME,
        file_id=file_meta.id,
        original_filename=body.original_filename,
        file_size=body.file_size,
        content_type=body.content_type,
        checksum=body.checksum,
        patient_id=patient.id if patient else None,
        patient_name=body.patient_name,
        patient_mrn=body.patient_mrn,
        patient_dob=(
            datetime.strptime(body.patient_dob, "%Y-%m-%d").date()
            if body.patient_dob else None
        ),
        status="completed",
        completed_at=datetime.utcnow(),
    )
    db.add(transfer)
    db.commit()

    # Audit
    audit.log_audit_event(
        event_type="federation.transfer.received",
        user_id=None,
        action=f"Received file via libp2p from {body.source_hospital_name}",
        resource="federation_transfer",
        resource_id=body.transfer_id,
        details={
            "filename": body.original_filename,
            "patient_name": body.patient_name,
            "source_hospital": body.source_hospital_id,
            "transport": "libp2p",
        },
        ip_address=request.client.host if request.client else None,
    )

    return {
        "success": True,
        "transfer_id": body.transfer_id,
        "receiving_hospital_id": HOSPITAL_ID,
        "receiving_hospital_name": HOSPITAL_NAME,
        "file_id": file_meta.id,
    }


# ── Legacy helper (used by HTTP fallback) ──

def _resolve_peer_endpoint(target_hospital_id: str, fallback_endpoint: str) -> str:
    """Resolve API endpoint for legacy HTTP transfers."""
    api_port = os.getenv("API_PORT", "8000")

    # 1. Env var
    env_key = f"FEDERATION_PEER_{target_hospital_id.upper().replace('-', '_')}"
    peer_val = os.getenv(env_key, "")
    if peer_val:
        host = peer_val.split(":")[0]
        return f"http://{host}:{api_port}"

    # 2. Registry
    try:
        registry_path = os.path.join(
            os.getenv("DATA_DIR", "/app/data"), "federation-registry.json"
        )
        if os.path.exists(registry_path):
            import json
            with open(registry_path, "r") as f:
                data = json.load(f)
            meta = data.get("hospitals", {}).get(target_hospital_id)
            if meta and meta.get("api_endpoint"):
                return meta["api_endpoint"]
    except Exception:
        pass

    return fallback_endpoint
