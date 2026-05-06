"""API key management — create, list, revoke personal API keys."""
import hashlib
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import require_auth
from app.db import create_api_key, delete_api_key, list_api_keys

router = APIRouter(tags=["api-keys"])

_MAX_KEYS_PER_USER = 10


class ApiKeyCreate(BaseModel):
    name: str


@router.get("/api-keys")
def get_keys(user: str = Depends(require_auth)):
    """List all API keys for the authenticated user (never returns the raw key)."""
    return {"keys": list_api_keys(user)}


@router.post("/api-keys", status_code=201)
def new_key(body: ApiKeyCreate, user: str = Depends(require_auth)):
    """Generate a new API key. The raw key is returned ONCE and cannot be recovered."""
    if not body.name.strip():
        raise HTTPException(400, "Key name is required")
    existing = list_api_keys(user)
    if len(existing) >= _MAX_KEYS_PER_USER:
        raise HTTPException(400, f"Maximum {_MAX_KEYS_PER_USER} API keys per user — revoke one first")
    raw = "sk-" + secrets.token_hex(24)
    key_hash = hashlib.sha256(raw.encode()).hexdigest()
    prefix = raw[:11]
    key_id = create_api_key(user, body.name.strip(), key_hash, prefix)
    return {"id": key_id, "name": body.name.strip(), "key": raw, "prefix": prefix}


@router.delete("/api-keys/{key_id}")
def revoke_key(key_id: int, user: str = Depends(require_auth)):
    """Revoke (permanently delete) an API key."""
    delete_api_key(key_id, user)
    return {"ok": True}
