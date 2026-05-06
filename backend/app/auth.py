import uuid
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from passlib.context import CryptContext

from app.config import settings

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
security = HTTPBearer(auto_error=False)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def create_access_token(sub: str = "owner") -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_expire_minutes)
    return jwt.encode(
        {"sub": sub, "exp": expire, "jti": str(uuid.uuid4())},
        settings.secret_key,
        algorithm=settings.jwt_algorithm,
    )


def decode_token(token: str) -> dict:
    return jwt.decode(token, settings.secret_key, algorithms=[settings.jwt_algorithm])


async def require_admin(credentials: HTTPAuthorizationCredentials | None = Depends(security)) -> str:
    """Dependency that requires the caller to be 'owner' or have role='admin'."""
    from app.db import get_user_by_username, is_token_revoked

    if settings.autoclean_disable_auth:
        return "owner"
    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = decode_token(credentials.credentials)
        sub: str = payload.get("sub", "")
        jti: str = payload.get("jti", "")
        if not sub:
            raise HTTPException(status_code=401, detail="Invalid token")
        if jti and is_token_revoked(jti):
            raise HTTPException(status_code=401, detail="Token has been revoked. Please log in again.")
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
    if sub == "owner":
        return sub
    record = get_user_by_username(sub)
    if not record or record.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    return sub


async def require_auth(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(security),
) -> str:
    from app.db import is_token_revoked, verify_api_key

    if settings.autoclean_disable_auth:
        return "owner"

    api_key = request.headers.get("X-Api-Key")
    if api_key:
        username = verify_api_key(api_key)
        if not username:
            raise HTTPException(status_code=401, detail="Invalid API key")
        return username

    if credentials is None or not credentials.credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    try:
        payload = decode_token(credentials.credentials)
        sub: str = payload.get("sub", "")
        jti: str = payload.get("jti", "")
        if not sub:
            raise HTTPException(status_code=401, detail="Invalid token")
        if jti and is_token_revoked(jti):
            raise HTTPException(status_code=401, detail="Token has been revoked. Please log in again.")
        return sub
    except JWTError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")
