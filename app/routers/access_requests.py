"""Access request management API for handling file access requests."""
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import desc

from database import get_db
from models import User, Consent, Base
from routers.auth import get_current_user
from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, Enum as SQLEnum
from sqlalchemy.sql import func
import enum


# ============ Access Request Model ============

class RequestStatus(enum.Enum):
    pending = "pending"
    approved = "approved"
    denied = "denied"
    expired = "expired"


# We'll add AccessRequest to models dynamically or create table inline
# For now, we'll use a simple in-memory store with Consent table as backup

# ============ Pydantic Models ============

class AccessRequestCreate(BaseModel):
    """Request to access a file or resource"""
    file_id: Optional[int] = None
    scope: Optional[str] = None  # 'file', 'all', or specific scope
    reason: str


class AccessRequestResponse(BaseModel):
    """Access request details"""
    id: int
    requester_id: int
    requester_email: str
    requester_role: str
    file_id: Optional[int]
    scope: Optional[str]
    reason: str
    status: str
    requested_at: str
    resolved_at: Optional[str]
    resolved_by: Optional[int]


class AccessRequestList(BaseModel):
    """List of access requests"""
    requests: List[AccessRequestResponse]
    total: int
    page: int
    page_size: int


router = APIRouter(prefix="/api/access-requests", tags=["access-requests"])


# In-memory store for demo (in production, add AccessRequest table to models.py)
_access_requests: dict[int, dict] = {}
_next_id = 1


def _get_next_id() -> int:
    global _next_id
    result = _next_id
    _next_id += 1
    return result


@router.post("", response_model=AccessRequestResponse)
def create_access_request(
    body: AccessRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Create a new access request.
    
    Patients and doctors can request access to files.
    """
    req_id = _get_next_id()
    now = datetime.utcnow()
    
    request_data = {
        "id": req_id,
        "requester_id": current_user.id,
        "requester_email": current_user.email,
        "requester_role": current_user.role,
        "file_id": body.file_id,
        "scope": body.scope or "file",
        "reason": body.reason,
        "status": "pending",
        "requested_at": now.isoformat() + "Z",
        "resolved_at": None,
        "resolved_by": None,
    }
    
    _access_requests[req_id] = request_data
    
    return AccessRequestResponse(**request_data)


@router.get("", response_model=AccessRequestList)
def list_access_requests(
    status: Optional[str] = Query(None, description="Filter by status: pending, approved, denied"),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    List access requests.
    
    Admins see all requests; doctors see requests for their patients' files;
    patients see their own requests.
    """
    # Filter requests
    all_requests = list(_access_requests.values())
    
    # Filter by role
    if current_user.role == "patient":
        # Patients see only their own requests
        all_requests = [r for r in all_requests if r["requester_id"] == current_user.id]
    elif current_user.role == "doctor":
        # Doctors see requests TO them (file owner) + their own requests
        # For now, show all pending (simplified - in production check file ownership)
        pass
    # Admins see all
    
    # Filter by status
    if status:
        all_requests = [r for r in all_requests if r["status"] == status]
    
    # Sort by requested_at desc
    all_requests.sort(key=lambda x: x["requested_at"], reverse=True)
    
    # Paginate
    total = len(all_requests)
    start = (page - 1) * page_size
    end = start + page_size
    paginated = all_requests[start:end]
    
    return AccessRequestList(
        requests=[AccessRequestResponse(**r) for r in paginated],
        total=total,
        page=page,
        page_size=page_size
    )


@router.get("/{request_id}", response_model=AccessRequestResponse)
def get_access_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a specific access request."""
    if request_id not in _access_requests:
        raise HTTPException(status_code=404, detail="Access request not found")
    
    request_data = _access_requests[request_id]
    
    # Check permissions
    if current_user.role == "patient" and request_data["requester_id"] != current_user.id:
        raise HTTPException(status_code=403, detail="Access denied")
    
    return AccessRequestResponse(**request_data)


@router.put("/{request_id}/approve", response_model=AccessRequestResponse)
def approve_access_request(
    request_id: int,
    expires_days: int = Query(30, ge=1, le=365, description="Consent expiration in days"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Approve an access request and create a consent.
    
    Only file owners, doctors, and admins can approve requests.
    """
    if request_id not in _access_requests:
        raise HTTPException(status_code=404, detail="Access request not found")
    
    request_data = _access_requests[request_id]
    
    if request_data["status"] != "pending":
        raise HTTPException(status_code=400, detail="Request is not pending")
    
    # Check permissions (simplified - in production check file ownership)
    if current_user.role == "patient":
        raise HTTPException(status_code=403, detail="Patients cannot approve requests")
    
    now = datetime.utcnow()
    expires_at = datetime(now.year, now.month, now.day) + __import__("datetime").timedelta(days=expires_days)
    
    # Create consent
    consent = Consent(
        user_id=current_user.id,
        subject_id=request_data["file_id"],
        scope=request_data["scope"],
        granted_to_user_id=request_data["requester_id"],
        granted_at=now,
        expires_at=expires_at
    )
    db.add(consent)
    db.commit()
    
    # Update request
    request_data["status"] = "approved"
    request_data["resolved_at"] = now.isoformat() + "Z"
    request_data["resolved_by"] = current_user.id
    
    return AccessRequestResponse(**request_data)


@router.put("/{request_id}/deny", response_model=AccessRequestResponse)
def deny_access_request(
    request_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Deny an access request.
    
    Only file owners, doctors, and admins can deny requests.
    """
    if request_id not in _access_requests:
        raise HTTPException(status_code=404, detail="Access request not found")
    
    request_data = _access_requests[request_id]
    
    if request_data["status"] != "pending":
        raise HTTPException(status_code=400, detail="Request is not pending")
    
    # Check permissions
    if current_user.role == "patient":
        raise HTTPException(status_code=403, detail="Patients cannot deny requests")
    
    now = datetime.utcnow()
    
    # Update request
    request_data["status"] = "denied"
    request_data["resolved_at"] = now.isoformat() + "Z"
    request_data["resolved_by"] = current_user.id
    
    return AccessRequestResponse(**request_data)
