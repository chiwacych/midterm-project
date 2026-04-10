"""User profile management API: get/update profile, change password, preferences."""
from typing import Optional
from datetime import datetime, date, timedelta
import os
import random

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import User
from auth import get_current_user, hash_password, verify_password

router = APIRouter(prefix="/api/profile", tags=["profile"])


TWO_FACTOR_CHALLENGE_TTL_SECONDS = 300
_two_factor_challenges: dict[int, tuple[str, datetime]] = {}


class EmergencyContact(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    relationship: Optional[str] = None


class NotificationPreferences(BaseModel):
    email: bool = True
    sms: bool = False
    push: bool = True


class UserPreferences(BaseModel):
    theme: Optional[str] = None
    language: Optional[str] = None
    timezone: Optional[str] = None
    notifications: Optional[NotificationPreferences] = None


class UserProfileResponse(BaseModel):
    id: int
    email: str
    full_name: Optional[str]
    role: str
    is_active: bool
    created_at: str
    
    # Profile fields
    phone: Optional[str]
    department: Optional[str]
    license_number: Optional[str]
    date_of_birth: Optional[str]
    bio: Optional[str]
    
    # Emergency contact
    emergency_contact: EmergencyContact
    
    # Preferences
    preferences: dict
    
    # Security
    two_factor_enabled: bool
    last_password_change: Optional[str]
    
    # Stats (calculated)
    stats: dict

    class Config:
        from_attributes = True


class UpdateProfileRequest(BaseModel):
    full_name: Optional[str] = None
    phone: Optional[str] = None
    department: Optional[str] = None
    license_number: Optional[str] = None
    date_of_birth: Optional[str] = None
    bio: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    emergency_contact_relationship: Optional[str] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class UpdatePreferencesRequest(BaseModel):
    theme: Optional[str] = None
    language: Optional[str] = None
    timezone: Optional[str] = None
    notifications_email: Optional[bool] = None
    notifications_sms: Optional[bool] = None
    notifications_push: Optional[bool] = None


class TwoFactorChallengeResponse(BaseModel):
    status: str
    message: str
    expires_in: int
    otp_hint: Optional[str] = None


class VerifyTwoFactorRequest(BaseModel):
    code: str
    enable: bool


@router.get("", response_model=UserProfileResponse)
def get_profile(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the current user's full profile."""
    # Calculate stats from database
    from models import FileMetadata, Consent
    
    files_uploaded = db.query(FileMetadata).filter(
        FileMetadata.user_id == str(current_user.id),
        FileMetadata.is_deleted == False
    ).count()
    
    consents_granted = db.query(Consent).filter(
        Consent.user_id == current_user.id,
        Consent.revoked_at == None
    ).count()
    
    return UserProfileResponse(
        id=current_user.id,
        email=current_user.email,
        full_name=current_user.full_name,
        role=current_user.role,
        is_active=current_user.is_active,
        created_at=current_user.created_at.isoformat() if current_user.created_at else "",
        phone=current_user.phone,
        department=current_user.department,
        license_number=current_user.license_number,
        date_of_birth=current_user.date_of_birth.isoformat() if current_user.date_of_birth else None,
        bio=current_user.bio,
        emergency_contact=EmergencyContact(
            name=current_user.emergency_contact_name,
            phone=current_user.emergency_contact_phone,
            relationship=current_user.emergency_contact_relationship
        ),
        preferences={
            "theme": current_user.theme_preference or "dark",
            "language": current_user.language_preference or "en",
            "timezone": current_user.timezone_preference or "UTC",
            "notifications": {
                "email": current_user.notifications_email if current_user.notifications_email is not None else True,
                "sms": current_user.notifications_sms if current_user.notifications_sms is not None else False,
                "push": current_user.notifications_push if current_user.notifications_push is not None else True
            }
        },
        two_factor_enabled=current_user.two_factor_enabled or False,
        last_password_change=current_user.last_password_change.isoformat() if current_user.last_password_change else None,
        stats={
            "files_uploaded": files_uploaded,
            "files_downloaded": 0,  # Would need download tracking
            "consents_granted": consents_granted,
            "last_login": current_user.updated_at.isoformat() if current_user.updated_at else None
        }
    )


@router.put("", response_model=UserProfileResponse)
def update_profile(
    body: UpdateProfileRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update the current user's profile."""
    # Update fields if provided
    if body.full_name is not None:
        current_user.full_name = body.full_name
    if body.phone is not None:
        current_user.phone = body.phone
    if body.department is not None:
        current_user.department = body.department
    if body.license_number is not None:
        current_user.license_number = body.license_number
    if body.date_of_birth is not None:
        try:
            current_user.date_of_birth = date.fromisoformat(body.date_of_birth)
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid date_of_birth format")
    if body.bio is not None:
        current_user.bio = body.bio
    if body.emergency_contact_name is not None:
        current_user.emergency_contact_name = body.emergency_contact_name
    if body.emergency_contact_phone is not None:
        current_user.emergency_contact_phone = body.emergency_contact_phone
    if body.emergency_contact_relationship is not None:
        current_user.emergency_contact_relationship = body.emergency_contact_relationship
    
    db.commit()
    db.refresh(current_user)
    
    return get_profile(db=db, current_user=current_user)


@router.put("/password")
def change_password(
    body: ChangePasswordRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Change the current user's password."""
    if not verify_password(body.current_password, current_user.hashed_password):
        raise HTTPException(status_code=400, detail="Current password is incorrect")
    
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="New password must be at least 6 characters")
    
    current_user.hashed_password = hash_password(body.new_password)
    current_user.last_password_change = datetime.utcnow()
    db.commit()
    
    return {"status": "success", "message": "Password changed successfully"}


@router.put("/preferences")
def update_preferences(
    body: UpdatePreferencesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update user preferences (theme, language, notifications)."""
    if body.theme is not None:
        if body.theme not in ["light", "dark", "auto"]:
            raise HTTPException(status_code=400, detail="Invalid theme")
        current_user.theme_preference = body.theme
    if body.language is not None:
        current_user.language_preference = body.language
    if body.timezone is not None:
        current_user.timezone_preference = body.timezone
    if body.notifications_email is not None:
        current_user.notifications_email = body.notifications_email
    if body.notifications_sms is not None:
        current_user.notifications_sms = body.notifications_sms
    if body.notifications_push is not None:
        current_user.notifications_push = body.notifications_push
    
    db.commit()
    
    return {
        "status": "success",
        "preferences": {
            "theme": current_user.theme_preference,
            "language": current_user.language_preference,
            "timezone": current_user.timezone_preference,
            "notifications": {
                "email": current_user.notifications_email,
                "sms": current_user.notifications_sms,
                "push": current_user.notifications_push
            }
        }
    }


@router.put("/2fa")
def toggle_two_factor(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Toggle two-factor authentication on/off."""
    current_user.two_factor_enabled = not current_user.two_factor_enabled
    db.commit()
    
    return {
        "status": "success",
        "two_factor_enabled": current_user.two_factor_enabled,
        "message": f"Two-factor authentication {'enabled' if current_user.two_factor_enabled else 'disabled'}"
    }


@router.post("/2fa/challenge", response_model=TwoFactorChallengeResponse)
def create_two_factor_challenge(
    current_user: User = Depends(get_current_user),
):
    """Create a short-lived OTP challenge for enabling/disabling 2FA."""
    # Opportunistically clean up expired challenges.
    now = datetime.utcnow()
    expired_users = [uid for uid, (_, expires_at) in _two_factor_challenges.items() if expires_at <= now]
    for uid in expired_users:
        _two_factor_challenges.pop(uid, None)

    otp_code = f"{random.randint(0, 999999):06d}"
    expires_at = now + timedelta(seconds=TWO_FACTOR_CHALLENGE_TTL_SECONDS)
    _two_factor_challenges[current_user.id] = (otp_code, expires_at)

    include_hint = os.getenv("ENV", "development").lower() != "production"
    return TwoFactorChallengeResponse(
        status="success",
        message="OTP challenge generated",
        expires_in=TWO_FACTOR_CHALLENGE_TTL_SECONDS,
        otp_hint=otp_code if include_hint else None,
    )


@router.post("/2fa/verify")
def verify_two_factor(
    body: VerifyTwoFactorRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Verify OTP challenge and apply requested 2FA state."""
    challenge = _two_factor_challenges.get(current_user.id)
    if not challenge:
        raise HTTPException(status_code=400, detail="No active OTP challenge. Request a new code.")

    expected_code, expires_at = challenge
    if datetime.utcnow() > expires_at:
        _two_factor_challenges.pop(current_user.id, None)
        raise HTTPException(status_code=400, detail="OTP challenge expired. Request a new code.")

    if body.code.strip() != expected_code:
        raise HTTPException(status_code=400, detail="Invalid OTP code")

    current_user.two_factor_enabled = body.enable
    db.commit()
    _two_factor_challenges.pop(current_user.id, None)

    return {
        "status": "success",
        "two_factor_enabled": current_user.two_factor_enabled,
        "message": f"Two-factor authentication {'enabled' if current_user.two_factor_enabled else 'disabled'}",
    }
