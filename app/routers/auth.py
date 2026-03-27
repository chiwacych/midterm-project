"""Auth endpoints: signup, login, refresh, me, setup-password, seed."""
import os
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session
from sqlalchemy import or_

from database import get_db
from models import User, UserRole, Patient
from auth import (
    hash_password,
    verify_password,
    create_access_token,
    create_refresh_token,
    decode_token,
    get_current_user,
)

router = APIRouter(prefix="/api/auth", tags=["auth"])


class SignupRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str | None = None
    role: str = "patient"


class LoginRequest(BaseModel):
    email: str  # Using str instead of EmailStr to allow .local domains in dev
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    expires_in: int  # seconds


class UserResponse(BaseModel):
    id: int
    email: str
    full_name: str | None
    role: str
    is_active: bool
    patient_id: int | None = None

    class Config:
        from_attributes = True


class SetupPasswordRequest(BaseModel):
    """Used by doctor/admin-created patients to set their login credentials."""
    token: str
    password: str


@router.post("/signup", response_model=TokenResponse)
def signup(body: SignupRequest, db: Session = Depends(get_db)):
    """Register a new user. Default role is patient.
    
    If the email matches a doctor/admin-created patient record, the user
    is automatically linked to that patient record (preventing duplicates).
    """
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
    allowed_roles = [UserRole.patient.value]
    role = body.role if body.role in allowed_roles else UserRole.patient.value

    # Auto-link to existing patient record if email matches
    patient_id = None
    if role == UserRole.patient.value:
        patient = db.query(Patient).filter(
            Patient.email == body.email, Patient.is_active == True
        ).first()
        if patient:
            # Check no other user is already linked to this patient
            existing_link = db.query(User).filter(User.patient_id == patient.id).first()
            if not existing_link:
                patient_id = patient.id

    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
        role=role,
        patient_id=patient_id,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    from auth import ACCESS_TOKEN_EXPIRE_MINUTES
    return TokenResponse(
        access_token=create_access_token(user.email, user.role, user.id),
        refresh_token=create_refresh_token(user.email, user.id),
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/login", response_model=TokenResponse)
async def login(body: LoginRequest, request: Request, db: Session = Depends(get_db)):
    """Login with email/password; returns access and refresh tokens."""
    import audit as audit_mod

    ip = request.client.host if request.client else None
    user = db.query(User).filter(User.email == body.email).first()
    if not user or not verify_password(body.password, user.hashed_password):
        # Audit failed login
        await audit_mod.audit_login(
            user_id=str(user.id) if user else "0",
            email=body.email,
            success=False,
            ip_address=ip,
        )
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")

    # Audit successful login
    await audit_mod.audit_login(
        user_id=str(user.id),
        email=user.email,
        success=True,
        ip_address=ip,
    )

    from auth import ACCESS_TOKEN_EXPIRE_MINUTES
    return TokenResponse(
        access_token=create_access_token(user.email, user.role, user.id),
        refresh_token=create_refresh_token(user.email, user.id),
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/refresh", response_model=TokenResponse)
def refresh(body: RefreshRequest, db: Session = Depends(get_db)):
    """Exchange refresh token for new access and refresh tokens."""
    payload = decode_token(body.refresh_token)
    if not payload or payload.get("type") != "refresh":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid refresh token")
    user_id = payload.get("user_id")
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    from auth import ACCESS_TOKEN_EXPIRE_MINUTES
    return TokenResponse(
        access_token=create_access_token(user.email, user.role, user.id),
        refresh_token=create_refresh_token(user.email, user.id),
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.post("/setup-password", response_model=TokenResponse)
def setup_password(body: SetupPasswordRequest, db: Session = Depends(get_db)):
    """Allow doctor/admin-created patients to set their login password via invitation token."""
    user = db.query(User).filter(
        User.invitation_token == body.token,
        User.is_active == True,
    ).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired invitation token")
    if user.invitation_expires_at and user.invitation_expires_at < datetime.now(timezone.utc):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invitation token has expired")
    user.hashed_password = hash_password(body.password)
    user.invitation_token = None
    user.invitation_expires_at = None
    db.commit()
    db.refresh(user)
    from auth import ACCESS_TOKEN_EXPIRE_MINUTES
    return TokenResponse(
        access_token=create_access_token(user.email, user.role, user.id),
        refresh_token=create_refresh_token(user.email, user.id),
        expires_in=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    """Return current authenticated user."""
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        role=current_user.role,
        is_active=current_user.is_active,
        patient_id=current_user.patient_id,
    )


# ── Seed default users (admin + doctor) on first deployment ──────────────

class SeedUserOut(BaseModel):
    email: str
    role: str
    status: str  # "created" or "exists"


class SeedResponse(BaseModel):
    users: list[SeedUserOut]


@router.post("/seed", response_model=SeedResponse)
def seed_default_users(db: Session = Depends(get_db)):
    """Create default admin and doctor accounts for this hospital.

    Idempotent — skips users that already exist.
    Called automatically by start.sh on first deployment.
    """
    hospital_id = os.getenv("HOSPITAL_ID", "hospital-a")
    hospital_name = os.getenv("HOSPITAL_NAME", "Hospital")

    default_users = [
        {
            "email": f"admin@{hospital_id}.local",
            "password": "admin123",
            "full_name": f"{hospital_name} Admin",
            "role": UserRole.admin.value,
        },
        {
            "email": f"doctor@{hospital_id}.local",
            "password": "doctor123",
            "full_name": f"{hospital_name} Doctor",
            "role": UserRole.doctor.value,
        },
    ]

    results: list[SeedUserOut] = []
    for u in default_users:
        existing = db.query(User).filter(User.email == u["email"]).first()
        if existing:
            results.append(SeedUserOut(email=u["email"], role=u["role"], status="exists"))
            continue
        user = User(
            email=u["email"],
            hashed_password=hash_password(u["password"]),
            full_name=u["full_name"],
            role=u["role"],
            hospital_id=hospital_id,
            hospital_name=hospital_name,
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        results.append(SeedUserOut(email=u["email"], role=u["role"], status="created"))

    return SeedResponse(users=results)
