"""WebSocket router — real-time push notifications.

Clients connect to /ws/jobs?token=<jwt> and receive JSON events:
  {"event": "job_update", "job_id": "...", "status": "...", "progress": 0-100, "message": "..."}
  {"event": "batch_update", "batch_id": "...", "status": "...", "completed": N, "total": N}
  {"event": "ping"}

The connection manager is a module-level singleton so any router/service
can call ws_manager.broadcast(...) to push to all connected clients.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from jose import JWTError

from app.auth import decode_token
from app.config import settings

logger = logging.getLogger(__name__)
router = APIRouter(tags=["websocket"])


class ConnectionManager:
    """Thread-safe WebSocket connection pool with per-user channels."""

    def __init__(self) -> None:
        self._connections: dict[str, list[WebSocket]] = {}  # username → sockets

    async def connect(self, ws: WebSocket, username: str) -> None:
        await ws.accept()
        self._connections.setdefault(username, []).append(ws)
        logger.info("WS connected: user=%s total=%d", username, self._total())

    def disconnect(self, ws: WebSocket, username: str) -> None:
        conns = self._connections.get(username, [])
        if ws in conns:
            conns.remove(ws)
        logger.info("WS disconnected: user=%s total=%d", username, self._total())

    async def send_to(self, username: str, payload: dict[str, Any]) -> None:
        """Push a message to all sockets for a specific user."""
        dead: list[WebSocket] = []
        for ws in list(self._connections.get(username, [])):
            try:
                await ws.send_text(json.dumps(payload))
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws, username)

    async def broadcast(self, payload: dict[str, Any]) -> None:
        """Push a message to all connected clients."""
        for username in list(self._connections):
            await self.send_to(username, payload)

    def _total(self) -> int:
        return sum(len(v) for v in self._connections.values())

    def user_count(self) -> int:
        return len([u for u, v in self._connections.items() if v])


ws_manager = ConnectionManager()


def _authenticate_token(token: str | None) -> str:
    """Return username from JWT, or raise ValueError."""
    if settings.autoclean_disable_auth:
        return "owner"
    if not token:
        raise ValueError("token required")
    try:
        payload = decode_token(token)
        sub = payload.get("sub", "")
        if not sub:
            raise ValueError("invalid token")
        return sub
    except JWTError as exc:
        raise ValueError(f"invalid token: {exc}") from exc


@router.websocket("/ws/jobs")
async def ws_jobs(ws: WebSocket, token: str | None = Query(default=None)):
    """Real-time job-status stream.

    Connect with:  ws://host/ws/jobs?token=<jwt>
    Receive JSON events whenever a scheduled job, batch, or cleaning
    pipeline completes or changes status.
    """
    try:
        username = _authenticate_token(token)
    except ValueError as exc:
        await ws.close(code=4001, reason=str(exc))
        return

    await ws_manager.connect(ws, username)
    try:
        # Send welcome ping so the client knows the connection is live.
        await ws.send_text(json.dumps({"event": "connected", "username": username}))
        # Keep-alive loop — send a ping every 30 s, listen for client pongs.
        while True:
            try:
                data = await asyncio.wait_for(ws.receive_text(), timeout=30)
                msg = json.loads(data)
                if msg.get("type") == "ping":
                    await ws.send_text(json.dumps({"event": "pong"}))
            except asyncio.TimeoutError:
                await ws.send_text(json.dumps({"event": "ping"}))
            except WebSocketDisconnect:
                break
    finally:
        ws_manager.disconnect(ws, username)
