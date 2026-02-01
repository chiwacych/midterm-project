"""Consent checks for file operations: enforce patient consent before access."""
from datetime import datetime
from sqlalchemy.orm import Session

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
    - Owner (file_owner_user_id == requester) always allowed.
    - Admin always allowed.
    - Doctor/other: allowed if an active consent exists for this file or scope for this requester.
    """
    owner_id_int = None
    try:
        owner_id_int = int(file_owner_user_id)
    except (ValueError, TypeError):
        pass
    if owner_id_int is not None and requester_user_id == owner_id_int:
        return True
    if requester_role == "admin":
        return True

    # Consent is given by the file owner (patient); check consents where owner granted to requester
    if owner_id_int is None:
        return False
    now = datetime.utcnow()
    from sqlalchemy import or_
    q = db.query(Consent).filter(
        Consent.user_id == owner_id_int,
        Consent.revoked_at.is_(None),
        or_(Consent.subject_id.is_(None), Consent.subject_id == file_id),
    ).filter(
        (Consent.expires_at.is_(None)) | (Consent.expires_at > now)
    )
    consents = q.all()
    for c in consents:
        if c.subject_id is None and c.scope != "all":
            continue
        if c.granted_to_user_id == requester_user_id:
            return True
        if c.granted_to_role and c.granted_to_role == requester_role:
            return True
    return False
