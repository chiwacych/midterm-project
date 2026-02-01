"""Audit logging: emit events to Kafka for file upload, download, delete, auth."""
import asyncio
from typing import Optional
from sqlalchemy.orm import Session
from datetime import datetime
import json

from kafka_client import send_audit_event


def log_audit_event(
    db: Session,
    event_type: str,
    user_id: Optional[int],
    user_role: Optional[str],
    action: str,
    resource: Optional[str] = None,
    resource_id: Optional[str] = None,
    status: str = "success",
    severity: str = "low",
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
    details: Optional[dict] = None
):
    """Log an audit event to the database."""
    from models import AuditLog
    
    audit_log = AuditLog(
        event_type=event_type,
        user_id=user_id,
        user_role=user_role,
        action=action,
        resource=resource,
        resource_id=resource_id,
        status=status,
        severity=severity,
        ip_address=ip_address,
        user_agent=user_agent,
        details=json.dumps(details) if details else None
    )
    
    db.add(audit_log)
    # Don't commit here - let the calling function handle transaction


async def audit_upload(file_id: int, filename: str, user_id: str, size: int, checksum: str, status: str):
    asyncio.create_task(send_audit_event(
        "file.upload",
        {"file_id": file_id, "filename": filename, "size": size, "checksum": checksum, "status": status},
        user_id=user_id,
    ))


async def audit_download(file_id: int, filename: str, user_id: Optional[str], node: Optional[str], status: str):
    asyncio.create_task(send_audit_event(
        "file.download",
        {"file_id": file_id, "filename": filename, "node": node, "status": status},
        user_id=user_id,
    ))


async def audit_delete(file_id: int, filename: str, user_id: str):
    asyncio.create_task(send_audit_event(
        "file.delete",
        {"file_id": file_id, "filename": filename},
        user_id=user_id,
    ))


async def audit_login(user_id: str, success: bool):
    asyncio.create_task(send_audit_event(
        "auth.login",
        {"success": success},
        user_id=user_id,
    ))
