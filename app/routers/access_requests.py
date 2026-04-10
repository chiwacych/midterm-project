"""
Access Request & Consent Workflow API — Kenya DPA Compliant

Workflow:
  1. File Upload: All files uploaded as patient-centric records (enforced by upload endpoint)
  2. Patient Access: Patients log in and see their medical files via /api/consent/my-files
  3. Patient Consent Granting: Patients grant consent for specific files
  4. Hospital Consent Requests: Hospitals/doctors send requests to patients
  5. Emergency Override: Doctors override consent in emergencies (audit-logged)
  6. Proxy Approval: Doctors approve on behalf of patients without digital capabilities
"""
import os
from datetime import datetime, timedelta
from typing import Optional, List
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_, desc

from database import get_db
from models import User, Consent, AccessRequest, Patient, FileMetadata, Notification
from auth import get_current_user
from audit import log_audit_event


router = APIRouter(prefix="/api/access-requests", tags=["access-requests"])


# ============ Pydantic Models ============

class ConsentRequestCreate(BaseModel):
    """Hospital/doctor requests consent from a patient to access files"""
    patient_id: int
    file_ids: Optional[List[int]] = None
    scope: Optional[str] = "file"
    reason: str
    urgency: Optional[str] = "normal"  # normal, urgent, emergency
    target_hospital_id: Optional[str] = None
    target_hospital_name: Optional[str] = None


class EmergencyOverrideRequest(BaseModel):
    """Doctor emergency override — bypasses patient consent (audit-logged)"""
    patient_id: int
    file_ids: List[int]
    reason: str
    clinical_justification: str


class ProxyApprovalRequest(BaseModel):
    """Doctor approves consent on behalf of a patient without digital capabilities"""
    request_id: int
    proxy_reason: str
    verification_method: str  # verbal, written, witness


class AccessRequestResponse(BaseModel):
    """Access request details"""
    id: int
    requester_id: int
    requester_name: Optional[str] = None
    requester_email: str
    requester_role: str
    patient_id: Optional[int] = None
    patient_name: Optional[str] = None
    file_id: Optional[int] = None
    file_ids: Optional[List[int]] = None
    scope: Optional[str] = None
    reason: str
    urgency: Optional[str] = "normal"
    status: str
    requested_at: str
    resolved_at: Optional[str] = None
    resolved_by: Optional[int] = None
    resolved_by_name: Optional[str] = None
    is_emergency: bool = False
    is_proxy: bool = False
    proxy_reason: Optional[str] = None
    requester_hospital_id: Optional[str] = None
    target_hospital_id: Optional[str] = None


class AccessRequestList(BaseModel):
    """List of access requests"""
    requests: List[AccessRequestResponse]
    total: int
    page: int
    page_size: int


def _resolve_patient_for_user(db: Session, user: User) -> Optional[Patient]:
    """Resolve the patient record for a patient user using link-first fallback matching."""
    if user.patient_id:
        linked_patient = db.query(Patient).filter(Patient.id == user.patient_id).first()
        if linked_patient:
            return linked_patient

    match_filters = []
    if user.email:
        match_filters.append(Patient.email == user.email)
    if user.phone:
        match_filters.append(Patient.phone == user.phone)

    if not match_filters:
        return None

    return db.query(Patient).filter(or_(*match_filters)).first()


def _parse_file_ids(scope: Optional[str], file_id: Optional[int]) -> List[int]:
    """Extract file IDs from scope string."""
    fids = []
    if scope and scope.startswith("files:"):
        try:
            fids = [int(fid) for fid in scope.replace("files:", "").split(",") if fid.strip()]
        except ValueError:
            pass
    if file_id and file_id not in fids:
        fids.append(file_id)
    return fids


def _format_request(req: AccessRequest, db: Session) -> AccessRequestResponse:
    """Format an AccessRequest DB record into API response."""
    requester = db.query(User).filter(User.id == req.requester_id).first()
    patient = db.query(Patient).filter(Patient.id == req.patient_id).first() if req.patient_id else None
    resolved_by_user = db.query(User).filter(User.id == req.resolved_by).first() if req.resolved_by else None
    file_ids = _parse_file_ids(req.scope, req.file_id)
    urgency = req.requester_identifier if req.requester_identifier in ("normal", "urgent", "emergency", "proxy") else "normal"

    return AccessRequestResponse(
        id=req.id,
        requester_id=req.requester_id,
        requester_name=requester.full_name if requester else None,
        requester_email=requester.email if requester else "unknown",
        requester_role=requester.role if requester else "unknown",
        patient_id=req.patient_id,
        patient_name=patient.full_name if patient else None,
        file_id=req.file_id,
        file_ids=file_ids or None,
        scope=req.scope,
        reason=req.reason,
        urgency=urgency,
        status=req.status,
        requested_at=req.requested_at.isoformat() + "Z" if req.requested_at else "",
        resolved_at=req.resolved_at.isoformat() + "Z" if req.resolved_at else None,
        resolved_by=req.resolved_by,
        resolved_by_name=resolved_by_user.full_name if resolved_by_user else None,
        is_emergency=(urgency == "emergency"),
        is_proxy=(urgency == "proxy"),
        requester_hospital_id=req.requester_hospital_id,
        target_hospital_id=req.target_hospital_id,
    )


def _create_file_consents(
    db: Session,
    file_ids: List[int],
    patient_id: Optional[int],
    granted_to_user_id: int,
    granted_to_hospital_id: Optional[str],
    scope_prefix: str,
    expires_at: datetime,
    fallback_user_id: int,
):
    """Create consent records for a list of files."""
    for fid in file_ids:
        file_meta = db.query(FileMetadata).filter(FileMetadata.id == fid).first()
        consent_user_id = int(file_meta.user_id) if file_meta and file_meta.user_id else fallback_user_id
        consent = Consent(
            user_id=consent_user_id,
            patient_id=patient_id,
            subject_id=fid,
            scope=f"{scope_prefix}:file:{fid}",
            granted_to_user_id=granted_to_user_id,
            granted_to_hospital_id=granted_to_hospital_id,
            expires_at=expires_at,
        )
        db.add(consent)


# ============ CONSENT REQUEST WORKFLOW ============

@router.post("/consent-request", response_model=AccessRequestResponse)
def create_consent_request(
    body: ConsentRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Hospital/doctor sends a consent request to a patient.
    The patient will be notified and can approve/deny from their consent page.
    """
    if current_user.role not in ("doctor", "admin"):
        raise HTTPException(status_code=403, detail="Only doctors and admins can send consent requests")

    patient = db.query(Patient).filter(Patient.id == body.patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    # Verify requested files belong to this patient
    file_id_for_record = None
    scope_str = body.scope or "file"
    if body.file_ids:
        for fid in body.file_ids:
            f = db.query(FileMetadata).filter(
                FileMetadata.id == fid, FileMetadata.patient_id == body.patient_id, FileMetadata.is_deleted == False,
            ).first()
            if not f:
                raise HTTPException(status_code=404, detail=f"File {fid} not found or doesn't belong to patient")
        file_id_for_record = body.file_ids[0] if len(body.file_ids) == 1 else None
        scope_str = f"files:{','.join(str(fid) for fid in body.file_ids)}"

    access_req = AccessRequest(
        requester_id=current_user.id,
        patient_id=body.patient_id,
        file_id=file_id_for_record,
        scope=scope_str,
        reason=body.reason,
        status="pending",
        requester_hospital_id=current_user.hospital_id or os.environ.get("HOSPITAL_ID", ""),
        target_hospital_id=body.target_hospital_id,
        requester_identifier=body.urgency or "normal",
    )
    db.add(access_req)
    db.flush()

    # Notify patient
    patient_user = db.query(User).filter(
        User.role == "patient",
        User.patient_id == patient.id,
    ).first()
    if not patient_user and patient.email:
        patient_user = db.query(User).filter(User.email == patient.email, User.role == "patient").first()
    if patient_user:
        db.add(Notification(
            user_id=patient_user.id,
            title="New Consent Request",
            message=f"Dr. {current_user.full_name or current_user.email} requests access to your files. Reason: {body.reason}",
            type="consent_request",
            link=f"/consent?request_id={access_req.id}",
        ))

    log_audit_event(db=db, event_type="consent.request_created", user_id=current_user.id,
                    user_role=current_user.role,
                    action=f"Consent request for patient {patient.full_name} (ID: {body.patient_id})",
                    resource="access_request", resource_id=str(access_req.id), status="success", severity="medium")
    db.commit()
    db.refresh(access_req)
    return _format_request(access_req, db)


@router.post("", response_model=AccessRequestResponse)
def create_access_request(
    body: ConsentRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a standard access request (delegates to consent-request flow)."""
    return create_consent_request(body, db, current_user)


@router.post("/emergency-override", response_model=AccessRequestResponse)
def emergency_override(
    body: EmergencyOverrideRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Emergency override: Doctor bypasses patient consent.
    Kenya DPA Section 35: lawful processing without consent for medical emergencies.
    Auto-approved, time-limited (24h), heavily audit-logged.
    """
    if current_user.role != "doctor":
        raise HTTPException(status_code=403, detail="Only doctors can use emergency override")

    patient = db.query(Patient).filter(Patient.id == body.patient_id).first()
    if not patient:
        raise HTTPException(status_code=404, detail="Patient not found")

    for fid in body.file_ids:
        f = db.query(FileMetadata).filter(
            FileMetadata.id == fid, FileMetadata.patient_id == body.patient_id, FileMetadata.is_deleted == False,
        ).first()
        if not f:
            raise HTTPException(status_code=404, detail=f"File {fid} not found or doesn't belong to patient")

    now = datetime.utcnow()
    expires = now + timedelta(hours=24)
    scope_str = f"files:{','.join(str(fid) for fid in body.file_ids)}"

    access_req = AccessRequest(
        requester_id=current_user.id, patient_id=body.patient_id,
        file_id=body.file_ids[0] if len(body.file_ids) == 1 else None,
        scope=scope_str,
        reason=f"[EMERGENCY] {body.reason} — Clinical: {body.clinical_justification}",
        status="approved", requested_at=now, resolved_at=now, resolved_by=current_user.id,
        requester_hospital_id=current_user.hospital_id or os.environ.get("HOSPITAL_ID", ""),
        requester_identifier="emergency", expires_at=expires,
    )
    db.add(access_req)
    db.flush()

    _create_file_consents(db, body.file_ids, body.patient_id, current_user.id, None,
                          "emergency", expires, current_user.id)

    # Notify patient
    patient_user = db.query(User).filter(
        User.role == "patient",
        User.patient_id == patient.id,
    ).first()
    if not patient_user and patient.email:
        patient_user = db.query(User).filter(User.email == patient.email, User.role == "patient").first()
    if patient_user:
        db.add(Notification(
            user_id=patient_user.id,
            title="⚠️ Emergency Access Override",
            message=f"Dr. {current_user.full_name or current_user.email} accessed your files via emergency override. Reason: {body.reason}",
            type="warning", link="/consent",
        ))

    log_audit_event(db=db, event_type="consent.emergency_override", user_id=current_user.id,
                    user_role=current_user.role,
                    action=f"EMERGENCY OVERRIDE: Patient {patient.full_name}, files {body.file_ids}. Reason: {body.reason}. Clinical: {body.clinical_justification}",
                    resource="access_request", resource_id=str(access_req.id), status="success", severity="critical")
    db.commit()
    db.refresh(access_req)
    return _format_request(access_req, db)


@router.post("/proxy-approval", response_model=AccessRequestResponse)
def proxy_approval(
    body: ProxyApprovalRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Proxy approval: Doctor approves a pending request on behalf of a patient
    who lacks digital capabilities. Kenya DPA: third-party representation.
    """
    if current_user.role not in ("doctor", "admin"):
        raise HTTPException(status_code=403, detail="Only doctors and admins can proxy-approve")
    if body.verification_method not in ("verbal", "written", "witness"):
        raise HTTPException(status_code=400, detail="Verification must be 'verbal', 'written', or 'witness'")

    access_req = db.query(AccessRequest).filter(
        AccessRequest.id == body.request_id, AccessRequest.status == "pending",
    ).first()
    if not access_req:
        raise HTTPException(status_code=404, detail="Pending access request not found")

    now = datetime.utcnow()
    expires = now + timedelta(days=30)
    access_req.status = "approved"
    access_req.resolved_at = now
    access_req.resolved_by = current_user.id
    access_req.requester_identifier = "proxy"

    file_ids = _parse_file_ids(access_req.scope, access_req.file_id)
    if file_ids:
        _create_file_consents(db, file_ids, access_req.patient_id, access_req.requester_id,
                              access_req.requester_hospital_id, "proxy", expires, current_user.id)
    else:
        db.add(Consent(
            user_id=current_user.id, patient_id=access_req.patient_id,
            scope=access_req.scope or "patient_all",
            granted_to_user_id=access_req.requester_id, expires_at=expires,
        ))

    log_audit_event(db=db, event_type="consent.proxy_approval", user_id=current_user.id,
                    user_role=current_user.role,
                    action=f"PROXY APPROVAL: Request #{access_req.id}. Verification: {body.verification_method}. Reason: {body.proxy_reason}",
                    resource="access_request", resource_id=str(access_req.id), status="success", severity="high")
    db.commit()
    db.refresh(access_req)
    return _format_request(access_req, db)


# ============ LIST / GET / APPROVE / DENY ============

@router.get("", response_model=AccessRequestList)
def list_access_requests(
    status_filter: Optional[str] = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List access requests. Patients see their own; doctors see theirs; admins see all."""
    query = db.query(AccessRequest)

    if current_user.role == "patient":
        patient = _resolve_patient_for_user(db, current_user)
        if patient:
            query = query.filter(AccessRequest.patient_id == patient.id)
        else:
            return AccessRequestList(requests=[], total=0, page=page, page_size=page_size)
    elif current_user.role == "doctor":
        query = query.filter(
            or_(AccessRequest.requester_id == current_user.id, AccessRequest.resolved_by == current_user.id)
        )

    if status_filter:
        query = query.filter(AccessRequest.status == status_filter)

    total = query.count()
    requests = query.order_by(desc(AccessRequest.requested_at)).offset((page - 1) * page_size).limit(page_size).all()
    return AccessRequestList(
        requests=[_format_request(r, db) for r in requests],
        total=total, page=page, page_size=page_size,
    )


@router.get("/pending-for-me", response_model=AccessRequestList)
def pending_for_me(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Pending consent requests addressed to the current patient."""
    if current_user.role != "patient":
        raise HTTPException(status_code=403, detail="Only patients can view their pending requests")

    patient = _resolve_patient_for_user(db, current_user)
    if not patient:
        return AccessRequestList(requests=[], total=0, page=page, page_size=page_size)

    query = db.query(AccessRequest).filter(AccessRequest.patient_id == patient.id, AccessRequest.status == "pending")
    total = query.count()
    requests = query.order_by(desc(AccessRequest.requested_at)).offset((page - 1) * page_size).limit(page_size).all()
    return AccessRequestList(
        requests=[_format_request(r, db) for r in requests],
        total=total, page=page, page_size=page_size,
    )


@router.get("/{request_id}", response_model=AccessRequestResponse)
def get_access_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific access request."""
    access_req = db.query(AccessRequest).filter(AccessRequest.id == request_id).first()
    if not access_req:
        raise HTTPException(status_code=404, detail="Access request not found")

    if current_user.role == "patient":
        patient = _resolve_patient_for_user(db, current_user)
        if not patient or access_req.patient_id != patient.id:
            raise HTTPException(status_code=403, detail="Access denied")

    return _format_request(access_req, db)


@router.put("/{request_id}/approve", response_model=AccessRequestResponse)
def approve_access_request(
    request_id: int,
    expires_days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Approve an access request. Patients approve their own; doctors/admins can proxy-approve.
    Automatically creates consent records.
    """
    access_req = db.query(AccessRequest).filter(AccessRequest.id == request_id).first()
    if not access_req:
        raise HTTPException(status_code=404, detail="Access request not found")
    if access_req.status != "pending":
        raise HTTPException(status_code=400, detail=f"Request is already {access_req.status}")

    actor_patient_id = None

    # Permission check
    if current_user.role == "patient":
        patient = _resolve_patient_for_user(db, current_user)
        if not patient or access_req.patient_id != patient.id:
            raise HTTPException(status_code=403, detail="You can only approve requests for your own records")
        actor_patient_id = patient.id
    elif current_user.role not in ("doctor", "admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    now = datetime.utcnow()
    expires = now + timedelta(days=expires_days)
    access_req.status = "approved"
    access_req.resolved_at = now
    access_req.resolved_by = current_user.id
    access_req.expires_at = expires

    file_ids = _parse_file_ids(access_req.scope, access_req.file_id)
    if file_ids:
        _create_file_consents(db, file_ids, access_req.patient_id, access_req.requester_id,
                              access_req.requester_hospital_id, "approved", expires, current_user.id)
    else:
        db.add(Consent(
            user_id=current_user.id, patient_id=access_req.patient_id,
            scope=access_req.scope or "patient_all",
            granted_to_user_id=access_req.requester_id,
            granted_to_hospital_id=access_req.requester_hospital_id,
            expires_at=expires,
        ))

    # Notify requester
    db.add(Notification(
        user_id=access_req.requester_id,
        title="Consent Request Approved",
        message=f"Your consent request has been approved. Access expires {expires.strftime('%Y-%m-%d')}.",
        type="success", link="/share",
    ))

    log_audit_event(db=db, event_type="consent.request_approved", user_id=current_user.id,
                    user_role=current_user.role,
                    action=f"Approved request #{request_id} for patient ID {access_req.patient_id}",
                    resource="access_request", resource_id=str(request_id), status="success", severity="medium",
                    details={
                        "request_id": request_id,
                        "patient_id": access_req.patient_id,
                        "requester_id": access_req.requester_id,
                        "expires_days": expires_days,
                        "actor_patient_id": actor_patient_id,
                    })
    db.commit()
    db.refresh(access_req)
    return _format_request(access_req, db)


@router.put("/{request_id}/deny", response_model=AccessRequestResponse)
def deny_access_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Deny an access request. Patients can deny their own; doctors/admins can also deny."""
    access_req = db.query(AccessRequest).filter(AccessRequest.id == request_id).first()
    if not access_req:
        raise HTTPException(status_code=404, detail="Access request not found")
    if access_req.status != "pending":
        raise HTTPException(status_code=400, detail=f"Request is already {access_req.status}")

    actor_patient_id = None

    if current_user.role == "patient":
        patient = _resolve_patient_for_user(db, current_user)
        if not patient or access_req.patient_id != patient.id:
            raise HTTPException(status_code=403, detail="You can only deny requests for your own records")
        actor_patient_id = patient.id
    elif current_user.role not in ("doctor", "admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    now = datetime.utcnow()
    access_req.status = "denied"
    access_req.resolved_at = now
    access_req.resolved_by = current_user.id

    db.add(Notification(
        user_id=access_req.requester_id,
        title="Consent Request Denied",
        message="Your consent request has been denied by the patient.",
        type="warning", link="/share",
    ))

    log_audit_event(db=db, event_type="consent.request_denied", user_id=current_user.id,
                    user_role=current_user.role, action=f"Denied request #{request_id}",
                    resource="access_request", resource_id=str(request_id), status="success", severity="medium",
                    details={
                        "request_id": request_id,
                        "patient_id": access_req.patient_id,
                        "requester_id": access_req.requester_id,
                        "actor_patient_id": actor_patient_id,
                    })
    db.commit()
    db.refresh(access_req)
    return _format_request(access_req, db)
