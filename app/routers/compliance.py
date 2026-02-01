"""Compliance reporting API endpoints for HIPAA and access control auditing."""
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_

from database import get_db
from models import User, Consent, FileMetadata, AuditLog
from routers.auth import get_current_user

router = APIRouter(prefix="/api/compliance", tags=["compliance"])


# ============ Response Models ============

class ComplianceSummary(BaseModel):
    """Overall compliance summary"""
    report_generated_at: str
    period_start: str
    period_end: str
    total_files: int
    total_users: int
    total_consents: int
    active_consents: int
    expired_consents: int
    revoked_consents: int
    total_audit_events: int
    failed_access_attempts: int
    high_severity_events: int
    compliance_score: float  # 0-100 score


class ConsentAuditItem(BaseModel):
    """Individual consent audit entry"""
    consent_id: int
    patient_id: int
    granted_to_role: Optional[str]
    granted_to_user_id: Optional[int]
    scope: Optional[str]
    granted_at: str
    expires_at: Optional[str]
    revoked_at: Optional[str]
    status: str  # active, expired, revoked


class ConsentAuditReport(BaseModel):
    """Consent trail report"""
    report_generated_at: str
    period_start: str
    period_end: str
    total_consents: int
    items: list[ConsentAuditItem]


class AccessSummaryItem(BaseModel):
    """Access summary per user/role"""
    user_id: Optional[int]
    user_email: Optional[str]
    role: str
    files_accessed: int
    files_uploaded: int
    files_downloaded: int
    files_deleted: int
    consents_granted: int
    last_activity: Optional[str]


class AccessSummaryReport(BaseModel):
    """File access summary report"""
    report_generated_at: str
    period_start: str
    period_end: str
    total_accesses: int
    by_user: list[AccessSummaryItem]
    by_role: dict[str, int]


# ============ API Endpoints ============

@router.get("/report", response_model=ComplianceSummary)
def get_compliance_report(
    days: int = Query(30, ge=1, le=365, description="Report period in days"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Generate HIPAA compliance summary report.
    
    Only admins can access this endpoint.
    """
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    now = datetime.utcnow()
    period_start = now - timedelta(days=days)
    
    # Count files
    total_files = db.query(func.count(FileMetadata.id)).scalar() or 0
    
    # Count users
    total_users = db.query(func.count(User.id)).scalar() or 0
    
    # Consent statistics
    total_consents = db.query(func.count(Consent.id)).filter(
        Consent.granted_at >= period_start
    ).scalar() or 0
    
    active_consents = db.query(func.count(Consent.id)).filter(
        and_(
            Consent.revoked_at.is_(None),
            or_(Consent.expires_at.is_(None), Consent.expires_at > now)
        )
    ).scalar() or 0
    
    expired_consents = db.query(func.count(Consent.id)).filter(
        and_(
            Consent.revoked_at.is_(None),
            Consent.expires_at <= now
        )
    ).scalar() or 0
    
    revoked_consents = db.query(func.count(Consent.id)).filter(
        Consent.revoked_at.isnot(None)
    ).scalar() or 0
    
    # Audit statistics
    total_audit_events = db.query(func.count(AuditLog.id)).filter(
        AuditLog.timestamp >= period_start
    ).scalar() or 0
    
    failed_access_attempts = db.query(func.count(AuditLog.id)).filter(
        and_(
            AuditLog.timestamp >= period_start,
            AuditLog.status == "failure"
        )
    ).scalar() or 0
    
    high_severity_events = db.query(func.count(AuditLog.id)).filter(
        and_(
            AuditLog.timestamp >= period_start,
            AuditLog.severity.in_(["high", "critical"])
        )
    ).scalar() or 0
    
    # Calculate compliance score (simple heuristic)
    # Penalize for failed attempts and high severity events
    base_score = 100.0
    if total_audit_events > 0:
        failure_ratio = failed_access_attempts / total_audit_events
        base_score -= failure_ratio * 30  # Max 30 point penalty for failures
    if high_severity_events > 0:
        base_score -= min(high_severity_events * 2, 20)  # Max 20 point penalty
    compliance_score = max(0.0, min(100.0, base_score))
    
    return ComplianceSummary(
        report_generated_at=now.isoformat() + "Z",
        period_start=period_start.isoformat() + "Z",
        period_end=now.isoformat() + "Z",
        total_files=total_files,
        total_users=total_users,
        total_consents=total_consents,
        active_consents=active_consents,
        expired_consents=expired_consents,
        revoked_consents=revoked_consents,
        total_audit_events=total_audit_events,
        failed_access_attempts=failed_access_attempts,
        high_severity_events=high_severity_events,
        compliance_score=round(compliance_score, 1)
    )


@router.get("/consent-audit", response_model=ConsentAuditReport)
def get_consent_audit(
    days: int = Query(30, ge=1, le=365, description="Report period in days"),
    user_id: Optional[int] = Query(None, description="Filter by user ID"),
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Generate consent trail report.
    
    Only admins can access full report; others see only their own consents.
    """
    now = datetime.utcnow()
    period_start = now - timedelta(days=days)
    
    query = db.query(Consent).filter(Consent.granted_at >= period_start)
    
    # RBAC: non-admins see only their own
    if current_user.role != "admin":
        query = query.filter(Consent.user_id == current_user.id)
    elif user_id:
        query = query.filter(Consent.user_id == user_id)
    
    total = query.count()
    consents = query.order_by(Consent.granted_at.desc()).offset((page - 1) * page_size).limit(page_size).all()
    
    items = []
    for c in consents:
        # Determine status
        if c.revoked_at:
            status = "revoked"
        elif c.expires_at and c.expires_at <= now:
            status = "expired"
        else:
            status = "active"
        
        items.append(ConsentAuditItem(
            consent_id=c.id,
            patient_id=c.user_id,
            granted_to_role=c.granted_to_role,
            granted_to_user_id=c.granted_to_user_id,
            scope=c.scope,
            granted_at=c.granted_at.isoformat() + "Z" if c.granted_at else None,
            expires_at=c.expires_at.isoformat() + "Z" if c.expires_at else None,
            revoked_at=c.revoked_at.isoformat() + "Z" if c.revoked_at else None,
            status=status
        ))
    
    return ConsentAuditReport(
        report_generated_at=now.isoformat() + "Z",
        period_start=period_start.isoformat() + "Z",
        period_end=now.isoformat() + "Z",
        total_consents=total,
        items=items
    )


@router.get("/access-summary", response_model=AccessSummaryReport)
def get_access_summary(
    days: int = Query(30, ge=1, le=365, description="Report period in days"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Generate file access summary by user and role.
    
    Only admins can access this endpoint.
    """
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    now = datetime.utcnow()
    period_start = now - timedelta(days=days)
    
    # Get audit events grouped by user
    user_stats = db.query(
        AuditLog.user_id,
        AuditLog.user_role,
        func.count(AuditLog.id).label("total_events")
    ).filter(
        AuditLog.timestamp >= period_start
    ).group_by(AuditLog.user_id, AuditLog.user_role).all()
    
    # Build user summary
    by_user = []
    by_role = {}
    total_accesses = 0
    
    for user_id, role, count in user_stats:
        total_accesses += count
        
        # Get user email if available
        user_email = None
        if user_id:
            user = db.query(User).filter(User.id == user_id).first()
            if user:
                user_email = user.email
        
        # Count specific actions
        uploads = db.query(func.count(AuditLog.id)).filter(
            and_(
                AuditLog.user_id == user_id,
                AuditLog.timestamp >= period_start,
                AuditLog.event_type == "file.upload"
            )
        ).scalar() or 0
        
        downloads = db.query(func.count(AuditLog.id)).filter(
            and_(
                AuditLog.user_id == user_id,
                AuditLog.timestamp >= period_start,
                AuditLog.event_type == "file.download"
            )
        ).scalar() or 0
        
        deletes = db.query(func.count(AuditLog.id)).filter(
            and_(
                AuditLog.user_id == user_id,
                AuditLog.timestamp >= period_start,
                AuditLog.event_type == "file.delete"
            )
        ).scalar() or 0
        
        consents_granted = db.query(func.count(Consent.id)).filter(
            and_(
                Consent.user_id == user_id,
                Consent.granted_at >= period_start
            )
        ).scalar() or 0
        
        # Last activity
        last_event = db.query(AuditLog.timestamp).filter(
            AuditLog.user_id == user_id
        ).order_by(AuditLog.timestamp.desc()).first()
        
        by_user.append(AccessSummaryItem(
            user_id=user_id,
            user_email=user_email,
            role=role or "unknown",
            files_accessed=count,
            files_uploaded=uploads,
            files_downloaded=downloads,
            files_deleted=deletes,
            consents_granted=consents_granted,
            last_activity=last_event[0].isoformat() + "Z" if last_event else None
        ))
        
        # Aggregate by role
        role_key = role or "unknown"
        by_role[role_key] = by_role.get(role_key, 0) + count
    
    return AccessSummaryReport(
        report_generated_at=now.isoformat() + "Z",
        period_start=period_start.isoformat() + "Z",
        period_end=now.isoformat() + "Z",
        total_accesses=total_accesses,
        by_user=by_user,
        by_role=by_role
    )
