"""Audit logging: write events to PostgreSQL (primary) and optionally forward to Kafka."""
import asyncio
import json
import traceback
from typing import Optional

from kafka_client import send_audit_event


def _persist(
    event_type: str,
    action: str,
    user_id: Optional[int],
    user_role: Optional[str] = None,
    resource: Optional[str] = None,
    resource_id: Optional[str] = None,
    status: str = "success",
    severity: str = "low",
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    details: Optional[dict] = None,
):
    """Write an audit row to PostgreSQL (uses its own short-lived session)."""
    try:
        from database import SessionLocal
        from models import AuditLog

        db = SessionLocal()
        try:
            row = AuditLog(
                event_type=event_type,
                user_id=user_id,
                user_role=user_role,
                action=action,
                resource=resource,
                resource_id=str(resource_id) if resource_id else None,
                status=status,
                severity=severity,
                ip_address=ip_address,
                user_agent=user_agent,
                details=json.dumps(details) if details else None,
            )
            db.add(row)
            db.commit()
        except Exception:
            db.rollback()
            traceback.print_exc()
        finally:
            db.close()
    except Exception:
        traceback.print_exc()


async def _forward_kafka(event_type: str, payload: dict, user_id: Optional[str] = None):
    """Best-effort forward to Kafka (no-op if Kafka is down)."""
    try:
        asyncio.create_task(send_audit_event(event_type, payload, user_id=user_id))
    except Exception:
        pass


def log_audit_event(
    db=None,
    event_type: str = "",
    action: str = "",
    user_id: Optional[int] = None,
    user_role: Optional[str] = None,
    resource: Optional[str] = None,
    resource_id: Optional[str] = None,
    request=None,
    status: str = "success",
    severity: str = "low",
    details: Optional[dict] = None,
    **kwargs,
):
    """Convenience wrapper used by routers (consent, patients, access_requests).

    Accepts an optional SQLAlchemy ``db`` session.  If provided the row is
    added to that session (caller commits); otherwise falls back to
    ``_persist`` which opens its own session.
    """
    ip_address = None
    user_agent = None
    if request:
        ip_address = getattr(getattr(request, "client", None), "host", None)
        user_agent = (getattr(request, "headers", {}).get("user-agent", "") or "")[:500]

    if db is not None:
        try:
            import json as _json
            from models import AuditLog
            row = AuditLog(
                event_type=event_type,
                action=action,
                user_id=user_id,
                user_role=user_role,
                resource=resource,
                resource_id=str(resource_id) if resource_id else None,
                ip_address=ip_address,
                user_agent=user_agent,
                status=status,
                severity=severity,
                details=_json.dumps(details) if details else None,
            )
            db.add(row)
            # Don't commit here – let the caller commit with its own transaction
        except Exception:
            traceback.print_exc()
    else:
        _persist(
            event_type=event_type,
            action=action,
            user_id=user_id,
            user_role=user_role,
            resource=resource,
            resource_id=resource_id,
            status=status,
            severity=severity,
            ip_address=ip_address,
            user_agent=user_agent,
            details=details,
        )


# ── Public helpers called from endpoint handlers ──────────────────────


async def audit_upload(
    file_id: int,
    filename: str,
    user_id: str,
    size: int,
    checksum: str,
    status: str,
):
    _persist(
        event_type="file.upload",
        action=f"Uploaded file '{filename}' ({size} bytes)",
        user_id=int(user_id) if str(user_id).isdigit() else None,
        resource="file",
        resource_id=str(file_id),
        status=status,
        severity="low",
        details={"file_id": file_id, "filename": filename, "size": size, "checksum": checksum},
    )
    await _forward_kafka("file.upload", {"file_id": file_id, "filename": filename, "size": size, "checksum": checksum, "status": status}, user_id=user_id)


async def audit_download(
    file_id: int,
    filename: str,
    user_id: Optional[str],
    node: Optional[str],
    status: str,
):
    _persist(
        event_type="file.download",
        action=f"Downloaded file '{filename}' from node {node or 'unknown'}",
        user_id=int(user_id) if user_id and str(user_id).isdigit() else None,
        resource="file",
        resource_id=str(file_id),
        status=status,
        severity="low",
        details={"file_id": file_id, "filename": filename, "node": node},
    )
    await _forward_kafka("file.download", {"file_id": file_id, "filename": filename, "node": node, "status": status}, user_id=user_id)


async def audit_delete(file_id: int, filename: str, user_id: str):
    _persist(
        event_type="file.delete",
        action=f"Deleted file '{filename}'",
        user_id=int(user_id) if str(user_id).isdigit() else None,
        resource="file",
        resource_id=str(file_id),
        status="success",
        severity="medium",
        details={"file_id": file_id, "filename": filename},
    )
    await _forward_kafka("file.delete", {"file_id": file_id, "filename": filename}, user_id=user_id)


async def audit_login(user_id: str, email: str = "", success: bool = True, ip_address: Optional[str] = None):
    _persist(
        event_type="auth.login",
        action=f"Login {'succeeded' if success else 'failed'} for {email or user_id}",
        user_id=int(user_id) if str(user_id).isdigit() else None,
        resource="authentication",
        status="success" if success else "failure",
        severity="low" if success else "high",
        ip_address=ip_address,
        details={"email": email, "success": success},
    )
    await _forward_kafka("auth.login", {"success": success}, user_id=user_id)


async def audit_consent(
    action_verb: str,
    user_id: int,
    user_role: str = "",
    consent_id: Optional[int] = None,
    patient_id: Optional[int] = None,
    status: str = "success",
    details: Optional[dict] = None,
):
    _persist(
        event_type=f"consent.{action_verb}",
        action=f"Consent {action_verb} for patient {patient_id or '?'}",
        user_id=user_id,
        user_role=user_role,
        resource="consent",
        resource_id=str(consent_id) if consent_id else None,
        status=status,
        severity="medium",
        details=details,
    )
