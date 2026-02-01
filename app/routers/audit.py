"""Audit log API: list and search audit events."""
from typing import Optional
from datetime import datetime
import json

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import desc

from database import get_db
from models import User, AuditLog
from auth import get_current_user

router = APIRouter(prefix="/api/audit", tags=["audit"])


class AuditEventResponse(BaseModel):
    id: int
    timestamp: str
    event_type: str
    user_id: Optional[int]
    user_role: Optional[str]
    action: str
    resource: Optional[str]
    resource_id: Optional[str]
    ip_address: Optional[str]
    user_agent: Optional[str]
    status: str
    severity: str
    details: Optional[dict]

    class Config:
        from_attributes = True


class AuditListResponse(BaseModel):
    events: list[AuditEventResponse]
    total: int
    page: int
    page_size: int


def log_audit_event(
    db: Session,
    event_type: str,
    action: str,
    user: Optional[User] = None,
    resource: Optional[str] = None,
    resource_id: Optional[str] = None,
    request: Optional[Request] = None,
    status: str = "success",
    severity: str = "low",
    details: Optional[dict] = None
):
    """Helper function to create audit log entries."""
    ip_address = None
    user_agent = None
    if request:
        ip_address = request.client.host if request.client else None
        user_agent = request.headers.get("user-agent", "")[:500]
    
    audit = AuditLog(
        event_type=event_type,
        action=action,
        user_id=user.id if user else None,
        user_role=user.role if user else None,
        resource=resource,
        resource_id=str(resource_id) if resource_id else None,
        ip_address=ip_address,
        user_agent=user_agent,
        status=status,
        severity=severity,
        details=json.dumps(details) if details else None
    )
    db.add(audit)
    db.commit()
    return audit


@router.get("", response_model=AuditListResponse)
def list_audit_events(
    event_type: Optional[str] = Query(None, description="Filter by event type"),
    user_id: Optional[int] = Query(None, description="Filter by user ID"),
    status: Optional[str] = Query(None, description="Filter by status: success, failure, warning"),
    severity: Optional[str] = Query(None, description="Filter by severity: low, medium, high, critical"),
    date_from: Optional[str] = Query(None, description="Filter from date (ISO format)"),
    date_to: Optional[str] = Query(None, description="Filter to date (ISO format)"),
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List audit events with filtering and pagination.
    
    Admin sees all events; doctors see their own and patient file access events;
    patients see only their own events.
    """
    query = db.query(AuditLog)
    
    # Role-based filtering
    if current_user.role == "patient":
        query = query.filter(AuditLog.user_id == current_user.id)
    elif current_user.role == "doctor":
        # Doctors see their own events and file-related events
        query = query.filter(
            (AuditLog.user_id == current_user.id) | 
            (AuditLog.resource == "file")
        )
    # Admin sees all
    
    # Apply filters
    if event_type:
        query = query.filter(AuditLog.event_type == event_type)
    if user_id:
        query = query.filter(AuditLog.user_id == user_id)
    if status:
        query = query.filter(AuditLog.status == status)
    if severity:
        query = query.filter(AuditLog.severity == severity)
    if date_from:
        try:
            from_dt = datetime.fromisoformat(date_from.replace("Z", "+00:00"))
            query = query.filter(AuditLog.timestamp >= from_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date_from format")
    if date_to:
        try:
            to_dt = datetime.fromisoformat(date_to.replace("Z", "+00:00"))
            query = query.filter(AuditLog.timestamp <= to_dt)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date_to format")
    
    # Get total count
    total = query.count()
    
    # Apply pagination and ordering
    events = (
        query
        .order_by(desc(AuditLog.timestamp))
        .offset((page - 1) * page_size)
        .limit(page_size)
        .all()
    )
    
    return AuditListResponse(
        events=[
            AuditEventResponse(
                id=e.id,
                timestamp=e.timestamp.isoformat() if e.timestamp else "",
                event_type=e.event_type,
                user_id=e.user_id,
                user_role=e.user_role,
                action=e.action,
                resource=e.resource,
                resource_id=e.resource_id,
                ip_address=e.ip_address,
                user_agent=e.user_agent,
                status=e.status,
                severity=e.severity,
                details=json.loads(e.details) if e.details else None
            )
            for e in events
        ],
        total=total,
        page=page,
        page_size=page_size
    )


@router.get("/{audit_id}", response_model=AuditEventResponse)
def get_audit_event(
    audit_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific audit event by ID."""
    audit = db.query(AuditLog).filter(AuditLog.id == audit_id).first()
    if not audit:
        raise HTTPException(status_code=404, detail="Audit event not found")
    
    # Role-based access check
    if current_user.role == "patient" and audit.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to view this event")
    
    return AuditEventResponse(
        id=audit.id,
        timestamp=audit.timestamp.isoformat() if audit.timestamp else "",
        event_type=audit.event_type,
        user_id=audit.user_id,
        user_role=audit.user_role,
        action=audit.action,
        resource=audit.resource,
        resource_id=audit.resource_id,
        ip_address=audit.ip_address,
        user_agent=audit.user_agent,
        status=audit.status,
        severity=audit.severity,
        details=json.loads(audit.details) if audit.details else None
    )
