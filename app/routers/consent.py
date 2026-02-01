"""Consent management API: grant/revoke/list consent."""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import User, Consent
from auth import get_current_user, require_roles

router = APIRouter(prefix="/api/consent", tags=["consent"])


class GrantConsentRequest(BaseModel):
    subject_id: Optional[int] = None  # file_id or null for scope
    scope: Optional[str] = None  # e.g. "all" or "patient:123"
    granted_to_role: Optional[str] = None  # doctor, admin
    granted_to_user_id: Optional[int] = None
    granted_to_hospital_id: Optional[str] = None  # For cross-hospital federation
    granted_to_hospital_name: Optional[str] = None  # Human-readable hospital name
    expires_at: Optional[str] = None  # ISO datetime


class ConsentResponse(BaseModel):
    id: int
    user_id: int
    subject_id: Optional[int]
    scope: Optional[str]
    granted_to_role: Optional[str]
    granted_to_user_id: Optional[int]
    granted_to_hospital_id: Optional[str]
    granted_to_hospital_name: Optional[str]
    granted_at: str
    expires_at: Optional[str]
    revoked_at: Optional[str]

    class Config:
        from_attributes = True


@router.post("", response_model=ConsentResponse)
def grant_consent(
    body: GrantConsentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Patient grants consent for file/scope access to a role, user, or hospital (federated)."""
    if current_user.role != "patient" and current_user.role != "doctor" and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Insufficient permissions to grant consent")
    expires = None
    if body.expires_at:
        try:
            expires = datetime.fromisoformat(body.expires_at.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid expires_at")
    c = Consent(
        user_id=current_user.id,
        subject_id=body.subject_id,
        scope=body.scope,
        granted_to_role=body.granted_to_role,
        granted_to_user_id=body.granted_to_user_id,
        granted_to_hospital_id=body.granted_to_hospital_id,
        granted_to_hospital_name=body.granted_to_hospital_name,
        expires_at=expires,
    )
    db.add(c)
    db.commit()
    db.refresh(c)
    return ConsentResponse(
        id=c.id,
        user_id=c.user_id,
        subject_id=c.subject_id,
        scope=c.scope,
        granted_to_role=c.granted_to_role,
        granted_to_user_id=c.granted_to_user_id,
        granted_to_hospital_id=c.granted_to_hospital_id,
        granted_to_hospital_name=c.granted_to_hospital_name,
        granted_at=c.granted_at.isoformat() if c.granted_at else "",
        expires_at=c.expires_at.isoformat() if c.expires_at else None,
        revoked_at=c.revoked_at.isoformat() if c.revoked_at else None,
    )


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
    if c.user_id != current_user.id and current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Not allowed to revoke this consent")
    c.revoked_at = datetime.utcnow()
    db.commit()
    return {"status": "success", "message": "Consent revoked"}


@router.get("", response_model=list[ConsentResponse])
def list_consents(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List consents given by the current user (patient) or all (admin)."""
    q = db.query(Consent)
    if current_user.role == "patient":
        q = q.filter(Consent.user_id == current_user.id)
    consents = q.order_by(Consent.granted_at.desc()).all()
    return [
        ConsentResponse(
            id=c.id,
            user_id=c.user_id,
            subject_id=c.subject_id,
            scope=c.scope,
            granted_to_role=c.granted_to_role,
            granted_to_user_id=c.granted_to_user_id,
            granted_to_hospital_id=c.granted_to_hospital_id,
            granted_to_hospital_name=c.granted_to_hospital_name,
            granted_at=c.granted_at.isoformat() if c.granted_at else "",
            expires_at=c.expires_at.isoformat() if c.expires_at else None,
            revoked_at=c.revoked_at.isoformat() if c.revoked_at else None,
        )
        for c in consents
    ]
