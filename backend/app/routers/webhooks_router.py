"""Webhooks router — CRUD for user-owned webhook subscriptions."""
import secrets

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, HttpUrl
from typing import List

from app.auth import require_auth
from app.db import (
    create_webhook, list_webhooks, get_webhook,
    update_webhook, delete_webhook,
)

router = APIRouter(prefix="/webhooks", tags=["webhooks"])

SUPPORTED_EVENTS = {
    "dataset.uploaded",
    "dataset.analyzed",
    "dataset.cleaned",
    "pipeline.run",
    "*",
}

MAX_WEBHOOKS_PER_USER = 10


class WebhookCreate(BaseModel):
    url: str
    events: List[str]


class WebhookUpdate(BaseModel):
    url: str | None = None
    events: List[str] | None = None
    enabled: bool | None = None


@router.get("/")
def list_user_webhooks(user: str = Depends(require_auth)):
    hooks = list_webhooks(user)
    for h in hooks:
        h.pop("secret", None)
    return {"webhooks": hooks}


@router.post("/", status_code=201)
def create_user_webhook(body: WebhookCreate, user: str = Depends(require_auth)):
    existing = list_webhooks(user)
    if len(existing) >= MAX_WEBHOOKS_PER_USER:
        raise HTTPException(400, f"Maximum {MAX_WEBHOOKS_PER_USER} webhooks per user")
    unknown = [e for e in body.events if e not in SUPPORTED_EVENTS]
    if unknown:
        raise HTTPException(400, f"Unknown event(s): {', '.join(unknown)}. Supported: {', '.join(sorted(SUPPORTED_EVENTS))}")
    if not body.url.startswith("https://") and not body.url.startswith("http://"):
        raise HTTPException(400, "URL must start with http:// or https://")
    secret = secrets.token_hex(32)
    webhook_id = create_webhook(user=user, url=body.url, events=body.events, secret=secret)
    return {
        "id": webhook_id,
        "url": body.url,
        "events": body.events,
        "secret": secret,
        "secret_note": "Save this secret — it will not be shown again. Use it to verify HMAC-SHA256 signatures.",
    }


@router.patch("/{webhook_id}")
def update_user_webhook(webhook_id: int, body: WebhookUpdate, user: str = Depends(require_auth)):
    hook = get_webhook(webhook_id, user)
    if not hook:
        raise HTTPException(404, "Webhook not found")
    if body.events is not None:
        unknown = [e for e in body.events if e not in SUPPORTED_EVENTS]
        if unknown:
            raise HTTPException(400, f"Unknown event(s): {', '.join(unknown)}")
    update_webhook(webhook_id, user, url=body.url, events=body.events, enabled=body.enabled)
    return {"ok": True}


@router.delete("/{webhook_id}")
def delete_user_webhook(webhook_id: int, user: str = Depends(require_auth)):
    hook = get_webhook(webhook_id, user)
    if not hook:
        raise HTTPException(404, "Webhook not found")
    delete_webhook(webhook_id, user)
    return {"ok": True}
