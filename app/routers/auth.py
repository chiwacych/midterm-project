"""Auth endpoints: signup, login, refresh, me."""
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from database import get_db
from models import User, UserRole
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

    class Config:
        from_attributes = True


@router.post("/signup", response_model=TokenResponse)
def signup(body: SignupRequest, db: Session = Depends(get_db)):
    """Register a new user. Default role is patient."""
    if db.query(User).filter(User.email == body.email).first():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Email already registered")
    allowed_roles = [UserRole.patient.value]
    role = body.role if body.role in allowed_roles else UserRole.patient.value
    user = User(
        email=body.email,
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
        role=role,
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
def login(body: LoginRequest, db: Session = Depends(get_db)):
    """Login with email/password; returns access and refresh tokens."""
    user = db.query(User).filter(User.email == body.email).first()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account disabled")
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


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    """Return current authenticated user."""
    return UserResponse(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        role=current_user.role,
        is_active=current_user.is_active,
    )
