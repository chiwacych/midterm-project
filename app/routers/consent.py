"""Consent management API: grant/revoke/list consent — Kenya DPA compliant.

Patient-facing endpoints:
  - GET /api/consent/my-files: View own medical files
  - POST /api/consent: Grant consent for specific files
  - POST /api/consent/{id}/revoke: Revoke consent
  - GET /api/consent: List all consents (patients see own, admins see all)
  - GET /api/consent/my-notifications: Patient notifications
"""
from datetime import datetime, timedelta, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import or_, desc

from database import get_db
from models import User, Consent, Patient, FileMetadata, Notification
from auth import get_current_user
from audit import log_audit_event

router = APIRouter(prefix="/api/consent", tags=["consent"])


class GrantConsentRequest(BaseModel):
    subject_id: Optional[int] = None  # file_id
    file_ids: Optional[List[int]] = None  # multiple file IDs
    scope: Optional[str] = None
    granted_to_role: Optional[str] = None
    granted_to_user_id: Optional[int] = None
    granted_to_hospital_id: Optional[str] = None
    granted_to_hospital_name: Optional[str] = None
    expires_at: Optional[str] = None  # ISO datetime
    expires_days: Optional[int] = None  # convenience: days from now


class ConsentResponse(BaseModel):
    id: int
    user_id: int
    patient_id: Optional[int] = None
    subject_id: Optional[int] = None
    scope: Optional[str] = None
    granted_to_role: Optional[str] = None
    granted_to_user_id: Optional[int] = None
    granted_to_hospital_id: Optional[str] = None
    granted_to_hospital_name: Optional[str] = None
    granted_at: str
    expires_at: Optional[str] = None
    revoked_at: Optional[str] = None
    status: Optional[str] = None

    class Config:
        from_attributes = True


class PatientFileResponse(BaseModel):
    id: int
    filename: str
    original_filename: str
    file_size: int
    content_type: Optional[str] = None
    upload_timestamp: str
    description: Optional[str] = None
    has_active_consent: bool = False
    consent_count: int = 0


class NotificationResponse(BaseModel):
    id: int
    title: str
    message: str
    type: str
    read: bool
    link: Optional[str] = None
    created_at: str


def _resolve_patient_for_user(db: Session, user: User) -> Optional[Patient]:
    """Resolve patient record for a patient user using link-first fallback matching."""
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


def _consent_status(c: Consent) -> str:
    """Compute consent status."""
    if c.revoked_at:
        return "revoked"
    if c.expires_at and c.expires_at < datetime.now(timezone.utc):
        return "expired"
    return "active"


def _format_consent(c: Consent) -> ConsentResponse:
    return ConsentResponse(
        id=c.id,
        user_id=c.user_id,
        patient_id=c.patient_id,
        subject_id=c.subject_id,
        scope=c.scope,
        granted_to_role=c.granted_to_role,
        granted_to_user_id=c.granted_to_user_id,
        granted_to_hospital_id=c.granted_to_hospital_id,
        granted_to_hospital_name=c.granted_to_hospital_name,
        granted_at=c.granted_at.isoformat() if c.granted_at else "",
        expires_at=c.expires_at.isoformat() if c.expires_at else None,
        revoked_at=c.revoked_at.isoformat() if c.revoked_at else None,
        status=_consent_status(c),
    )


# ============ PATIENT-FACING: View My Files ============

@router.get("/my-files", response_model=List[PatientFileResponse])
def my_files(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Patient views their own medical files.
    Matches patient record by email/phone.
    """
    if current_user.role != "patient":
        raise HTTPException(status_code=403, detail="Only patients can view their own files through this endpoint")

    # Find patient record linked to user
    patient = _resolve_patient_for_user(db, current_user)

    if not patient:
        return []

    # Get files for this patient
    files = db.query(FileMetadata).filter(
        FileMetadata.patient_id == patient.id,
        FileMetadata.is_deleted == False,
    ).order_by(desc(FileMetadata.upload_timestamp)).all()

    result = []
    for f in files:
        # Count active consents for this file
        consent_count = db.query(Consent).filter(
            Consent.subject_id == f.id,
            Consent.revoked_at.is_(None),
            or_(Consent.expires_at.is_(None), Consent.expires_at > datetime.now(timezone.utc)),
        ).count()

        result.append(PatientFileResponse(
            id=f.id,
            filename=f.filename,
            original_filename=f.original_filename,
            file_size=f.file_size,
            content_type=f.content_type,
            upload_timestamp=f.upload_timestamp.isoformat() if f.upload_timestamp else "",
            description=f.description,
            has_active_consent=consent_count > 0,
            consent_count=consent_count,
        ))
    return result


# ============ PATIENT-FACING: Notifications ============

@router.get("/my-notifications", response_model=List[NotificationResponse])
def my_notifications(
    unread_only: str | None = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get notifications for the current user."""
    unread_only_flag = False
    if unread_only is not None:
        unread_raw = unread_only.strip().lower()
        unread_only_flag = unread_raw in ("1", "true", "yes", "on")

    query = db.query(Notification).filter(Notification.user_id == current_user.id)
    if unread_only_flag:
        query = query.filter(Notification.read == False)
    notifs = query.order_by(desc(Notification.created_at)).limit(50).all()
    return [
        NotificationResponse(
            id=n.id, title=n.title, message=n.message, type=n.type,
            read=n.read, link=n.link,
            created_at=n.created_at.isoformat() if n.created_at else "",
        )
        for n in notifs
    ]


@router.put("/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Mark a notification as read."""
    notif = db.query(Notification).filter(
        Notification.id == notification_id, Notification.user_id == current_user.id
    ).first()
    if not notif:
        raise HTTPException(status_code=404, detail="Notification not found")
    notif.read = True
    notif.read_at = datetime.now(timezone.utc)
    db.commit()
    return {"status": "ok"}


# ============ GRANT CONSENT ============

@router.post("", response_model=ConsentResponse)
def grant_consent(
    body: GrantConsentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Grant consent for file access.
    
    - Patients can grant consent for their own files
    - Doctors/admins can grant on behalf (logged as proxy)
    - Supports single file (subject_id) or multiple files (file_ids)
    - Supports cross-hospital federation
    """
    if current_user.role not in ("patient", "doctor", "admin"):
        raise HTTPException(status_code=403, detail="Insufficient permissions")

    # Compute expiration
    expires = None
    if body.expires_at:
        try:
            expires = datetime.fromisoformat(body.expires_at.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid expires_at format")
    elif body.expires_days:
        expires = datetime.now(timezone.utc) + timedelta(days=body.expires_days)

    # Find patient record for patient users
    patient_id = None
    if current_user.role == "patient":
        patient = _resolve_patient_for_user(db, current_user)
        if patient:
            patient_id = patient.id

    # Handle multiple files
    file_ids = body.file_ids or ([body.subject_id] if body.subject_id else [])
    
    created_consents = []
    for fid in file_ids:
        # Verify patient owns this file
        if current_user.role == "patient" and patient_id:
            file_meta = db.query(FileMetadata).filter(
                FileMetadata.id == fid, FileMetadata.patient_id == patient_id
            ).first()
            if not file_meta:
                raise HTTPException(status_code=403, detail=f"File {fid} does not belong to you")

        c = Consent(
            user_id=current_user.id,
            patient_id=patient_id,
            subject_id=fid,
            scope=body.scope or f"file:{fid}",
            granted_to_role=body.granted_to_role,
            granted_to_user_id=body.granted_to_user_id,
            granted_to_hospital_id=body.granted_to_hospital_id,
            granted_to_hospital_name=body.granted_to_hospital_name,
            expires_at=expires,
        )
        db.add(c)
        created_consents.append(c)

    # If no file IDs, scope-based consent
    if not file_ids:
        c = Consent(
            user_id=current_user.id,
            patient_id=patient_id,
            subject_id=body.subject_id,
            scope=body.scope,
            granted_to_role=body.granted_to_role,
            granted_to_user_id=body.granted_to_user_id,
            granted_to_hospital_id=body.granted_to_hospital_id,
            granted_to_hospital_name=body.granted_to_hospital_name,
            expires_at=expires,
        )
        db.add(c)
        created_consents.append(c)

    log_audit_event(
        db=db, event_type="consent.granted", user_id=current_user.id,
        user_role=current_user.role,
        action=f"Granted consent for files {file_ids or 'scope-based'} to role={body.granted_to_role} user={body.granted_to_user_id} hospital={body.granted_to_hospital_id}",
        resource="consent", resource_id=",".join(str(c.id) for c in created_consents if c.id),
        status="success", severity="medium",
    )

    db.commit()
    # Return the first (or only) consent
    last = created_consents[-1]
    db.refresh(last)
    return _format_consent(last)


# ============ REVOKE CONSENT ============

@router.post("/{consent_id}/revoke")
def revoke_consent(
    consent_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Patient revokes a consent (or admin)."""
    c = db.query(Consent).filter(Consent.id == consent_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Consent not found")

    # Permission: own consent or admin
    if c.user_id != current_user.id and current_user.role != "admin":
        # Also allow patient to revoke if it's their patient record
        if current_user.role == "patient":
            patient = _resolve_patient_for_user(db, current_user)
            if not patient or c.patient_id != patient.id:
                raise HTTPException(status_code=403, detail="Not allowed to revoke this consent")
        else:
            raise HTTPException(status_code=403, detail="Not allowed to revoke this consent")

    c.revoked_at = datetime.now(timezone.utc)

    log_audit_event(
        db=db, event_type="consent.revoked", user_id=current_user.id,
        user_role=current_user.role, action=f"Revoked consent #{consent_id}",
        resource="consent", resource_id=str(consent_id), status="success", severity="medium",
    )

    db.commit()
    return {"status": "success", "message": "Consent revoked"}


# ============ LIST CONSENTS ============

@router.get("", response_model=List[ConsentResponse])
def list_consents(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List consents. Patients see their own; admins see all; doctors see grants to them."""
    q = db.query(Consent)

    if current_user.role == "patient":
        # Patient sees consents they granted + consents for their patient record
        patient = _resolve_patient_for_user(db, current_user)
        if patient:
            q = q.filter(or_(Consent.user_id == current_user.id, Consent.patient_id == patient.id))
        else:
            q = q.filter(Consent.user_id == current_user.id)
    elif current_user.role == "doctor":
        # Doctors see consents granted to them
        q = q.filter(or_(
            Consent.granted_to_user_id == current_user.id,
            Consent.granted_to_role == "doctor",
            Consent.user_id == current_user.id,
        ))
    # Admins see all

    consents = q.order_by(desc(Consent.granted_at)).all()
    return [_format_consent(c) for c in consents]
