"""Consent checks for file operations: enforce Kenya DPA patient consent before access."""
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import or_

from models import Consent, FileMetadata


def can_access_file(
    db: Session,
    file_id: int,
    requester_user_id: int,
    requester_role: str,
    file_owner_user_id: str,
) -> bool:
    """
    Return True if requester is allowed to access the file (read/download).
    
    Access is granted if ANY of the following is true:
    1. Requester is the file uploader (owner)
    2. Requester is an admin
    3. An active, non-expired, non-revoked Consent exists that grants access via:
       a. granted_to_user_id matches requester
       b. granted_to_role matches requester's role
       c. granted_to_hospital_id matches requester's hospital
       d. Emergency or proxy consent for the specific file
    """
    # Owner always allowed
    owner_id_int = None
    try:
        owner_id_int = int(file_owner_user_id)
    except (ValueError, TypeError):
        pass
    if owner_id_int is not None and requester_user_id == owner_id_int:
        return True

    # Admin always allowed
    if requester_role == "admin":
        return True

    if owner_id_int is None:
        return False

    now = datetime.utcnow()

    # Check consents: both user_id-based (owner granted) and patient_id-based
    file_meta = db.query(FileMetadata).filter(FileMetadata.id == file_id).first()
    patient_id = file_meta.patient_id if file_meta else None

    # Build base consent query — active, non-revoked, non-expired
    base_filter = [
        Consent.revoked_at.is_(None),
        or_(Consent.expires_at.is_(None), Consent.expires_at > now),
    ]

    # Match by file (subject_id) or by patient_id scope
    file_match = or_(
        Consent.subject_id == file_id,
        Consent.scope == "all",
        Consent.scope == "patient_all",
    )
    if patient_id:
        file_match = or_(
            file_match,
            Consent.scope == f"file:{file_id}",
            Consent.scope == f"emergency:file:{file_id}",
            Consent.scope == f"proxy:file:{file_id}",
            Consent.scope == f"approved:file:{file_id}",
            Consent.scope.like(f"patient:{patient_id}%"),
        )

    # Owner-granted consents
    owner_consents = db.query(Consent).filter(
        Consent.user_id == owner_id_int,
        file_match,
        *base_filter,
    ).all()

    # Patient-record consents (if file has patient_id)
    patient_consents = []
    if patient_id:
        patient_consents = db.query(Consent).filter(
            Consent.patient_id == patient_id,
            file_match,
            *base_filter,
        ).all()

    all_consents = owner_consents + patient_consents

    for c in all_consents:
        # Check if consent applies to requester
        if c.granted_to_user_id == requester_user_id:
            return True
        if c.granted_to_role and c.granted_to_role == requester_role:
            return True
        # Scope-only consents (e.g. "all" without specific user)
        if c.scope == "all" and c.granted_to_role == requester_role:
            return True

    return False
    return False
