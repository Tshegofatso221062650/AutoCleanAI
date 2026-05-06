"""Webhook dispatcher — fires signed HTTP POST requests to subscriber URLs.

Uses httpx (already a dependency) in a daemon thread so it never blocks
the request that triggered the event.

Payload format:
  {
    "event": "dataset.cleaned",
    "timestamp": "2026-05-05T...",
    "data": { ... event-specific data ... }
  }

Signature: X-AutoClean-Signature: sha256=<hex>
Computed as HMAC-SHA256(secret, payload_json_bytes).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import threading
from datetime import datetime, timezone

import httpx

from app.db import get_webhooks_for_event, record_webhook_result

logger = logging.getLogger(__name__)

_TIMEOUT = httpx.Timeout(10.0)


def _sign(secret: str, payload: bytes) -> str:
    return "sha256=" + hmac.new(key=secret.encode(), msg=payload, digestmod=hashlib.sha256).hexdigest()


def _fire_single(webhook: dict, event: str, data: dict) -> None:
    payload = json.dumps({
        "event": event,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data,
    }, default=str).encode()

    signature = _sign(webhook["secret"], payload)
    headers = {
        "Content-Type": "application/json",
        "X-AutoClean-Signature": signature,
        "X-AutoClean-Event": event,
        "User-Agent": "AutoClean-AI-Webhook/2.0",
    }

    try:
        resp = httpx.post(webhook["url"], content=payload, headers=headers, timeout=_TIMEOUT)
        status = f"{resp.status_code}"
        success = 200 <= resp.status_code < 300
    except Exception as exc:
        status = f"error:{exc}"
        success = False

    try:
        record_webhook_result(webhook["id"], status, success)
    except Exception:
        pass

    if success:
        logger.debug("Webhook %d fired OK for event=%s", webhook["id"], event)
    else:
        logger.warning("Webhook %d failed for event=%s status=%s", webhook["id"], event, status)


def dispatch(event: str, data: dict) -> None:
    """Fire webhooks for *event* asynchronously. Never raises."""
    try:
        hooks = get_webhooks_for_event(event)
    except Exception as exc:
        logger.error("Failed to fetch webhooks: %s", exc)
        return

    for hook in hooks:
        t = threading.Thread(target=_fire_single, args=(hook, event, data), daemon=True)
        t.start()


# ── Convenience wrappers ─────────────────────────────────────────────────────

def on_dataset_uploaded(dataset_id: str, filename: str, user: str) -> None:
    dispatch("dataset.uploaded", {"dataset_id": dataset_id, "filename": filename, "user": user})


def on_dataset_analyzed(dataset_id: str, quality_score: float | None, user: str) -> None:
    dispatch("dataset.analyzed", {"dataset_id": dataset_id, "quality_score": quality_score, "user": user})


def on_dataset_cleaned(dataset_id: str, quality_score: float | None, user: str) -> None:
    dispatch("dataset.cleaned", {"dataset_id": dataset_id, "quality_score": quality_score, "user": user})


def on_pipeline_run(pipeline_id: int, dataset_id: str, user: str) -> None:
    dispatch("pipeline.run", {"pipeline_id": pipeline_id, "dataset_id": dataset_id, "user": user})
