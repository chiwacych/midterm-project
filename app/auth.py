"""
JWT RS256 authentication and RBAC for FastAPI.
Uses RS256 for access tokens; keys can be set via env or generated for dev.
"""
import os
from datetime import datetime, timedelta
from typing import List, Optional

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from passlib.context import CryptContext
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from models import User, UserRole

# Password hashing
pwd_context = CryptContext(schemes=["argon2", "bcrypt"], deprecated="auto")

# Bearer token extraction
security = HTTPBearer(auto_error=False)

# JWT settings
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_ACCESS_EXPIRE_MINUTES", "30"))
REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("JWT_REFRESH_EXPIRE_DAYS", "7"))
JWT_ALGORITHM = "RS256"
JWT_ISSUER = os.getenv("JWT_ISSUER", "medimage-federation")
JWT_AUDIENCE = os.getenv("JWT_AUDIENCE", "medimage-api")


def _get_rsa_keys():
    """Load RSA key pair from env or generate for dev."""
    private_pem = os.getenv("JWT_PRIVATE_KEY_PEM")
    public_pem = os.getenv("JWT_PUBLIC_KEY_PEM")
    if private_pem and public_pem:
        return private_pem.encode() if isinstance(private_pem, str) else private_pem, \
               public_pem.encode() if isinstance(public_pem, str) else public_pem
    # Generate for dev (do not use in production)
    try:
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.hazmat.primitives import serialization
        private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        private_pem = private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
        public_key = private_key.public_key()
        public_pem = public_key.public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
        return private_pem, public_pem
    except Exception as e:
        raise RuntimeError(f"JWT keys not configured and dev generation failed: {e}") from e


_private_key, _public_key = None, None


def get_private_key():
    global _private_key, _public_key
    if _private_key is None:
        _private_key, _public_key = _get_rsa_keys()
    return _private_key


def get_public_key():
    global _private_key, _public_key
    if _public_key is None:
        _private_key, _public_key = _get_rsa_keys()
    return _public_key


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(subject: str, role: str, user_id: int) -> str:
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {
        "sub": subject,
        "role": role,
        "user_id": user_id,
        "exp": expire,
        "iat": datetime.utcnow(),
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "type": "access",
    }
    return jwt.encode(payload, get_private_key(), algorithm=JWT_ALGORITHM)


def create_refresh_token(subject: str, user_id: int) -> str:
    expire = datetime.utcnow() + timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    payload = {
        "sub": subject,
        "user_id": user_id,
        "exp": expire,
        "iat": datetime.utcnow(),
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "type": "refresh",
    }
    return jwt.encode(payload, get_private_key(), algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        payload = jwt.decode(
            token,
            get_public_key(),
            algorithms=[JWT_ALGORITHM],
            audience=JWT_AUDIENCE,
            issuer=JWT_ISSUER,
        )
        return payload
    except jwt.PyJWTError:
        return None


class TokenPayload(BaseModel):
    sub: str
    role: Optional[str] = None
    user_id: int
    type: str  # access | refresh


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user_id = payload.get("user_id")
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


def require_roles(allowed_roles: List[str]):
    """Dependency factory: require current user to have one of the given roles."""

    def _require(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in allowed_roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Requires one of roles: {allowed_roles}",
            )
        return current_user

    return _require


def optional_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Optional auth: returns user if valid token, else None."""
    if not credentials or not credentials.credentials:
        return None
    payload = decode_token(credentials.credentials)
    if not payload or payload.get("type") != "access":
        return None
    user_id = payload.get("user_id")
    if not user_id:
        return None
    return db.query(User).filter(User.id == user_id, User.is_active == True).first()
