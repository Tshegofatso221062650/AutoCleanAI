from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
import json
from ..db import get_conn, _utc_now
from ..auth import require_auth

router = APIRouter()

class ShareItemRequest(BaseModel):
    item_type: str  # 'dataset', 'pipeline', 'report'
    item_id: str
    shared_with: str
    permissions: Optional[str] = None

def share_item(
    item_type: str,
    item_id: str,
    shared_with: str,
    shared_by: str,
    permissions: str = None,
) -> int:
    with get_conn() as conn:
        u = conn.execute("SELECT 1 FROM users WHERE username = ?", (shared_with,)).fetchone()
        if not u:
            raise HTTPException(400, "shared_with user does not exist")

        existing = conn.execute(
            """
            SELECT id FROM shared_items
            WHERE item_type = ? AND item_id = ? AND shared_with = ?
            LIMIT 1
            """,
            (item_type, item_id, shared_with),
        ).fetchone()
        if existing:
            return int(existing[0])

        cursor = conn.execute(
            """
            INSERT INTO shared_items 
            (item_type, item_id, shared_with, shared_by, permissions, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (item_type, item_id, shared_with, shared_by, permissions, _utc_now())
        )
        return cursor.lastrowid

def get_shared_items(shared_with: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM shared_items WHERE shared_with = ? ORDER BY created_at DESC",
            (shared_with,)
        ).fetchall()
        return [dict(row) for row in rows]

def get_shared_with_me(item_type: str, item_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM shared_items WHERE item_type = ? AND item_id = ?",
            (item_type, item_id)
        ).fetchall()
        return [dict(row) for row in rows]

def unshare_item(share_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM shared_items WHERE id = ?", (share_id,))

@router.post("/share")
def share_item_endpoint(request: ShareItemRequest, user: str = Depends(require_auth)):
    """Share an item with another user — caller must own the item."""
    from app.services.access_control import can_access_item
    if not can_access_item(user, request.item_type, request.item_id):
        raise HTTPException(403, "You do not have permission to share this item")
    share_id = share_item(
        item_type=request.item_type,
        item_id=request.item_id,
        shared_with=request.shared_with,
        shared_by=user,
        permissions=request.permissions,
    )
    return {"id": share_id, "message": "Item shared successfully"}

@router.get("/shared-with-me")
def list_shared_with_me(user: str = Depends(require_auth)):
    """List items shared with the current user."""
    items = get_shared_items(shared_with=user)
    return {"items": items}

@router.get("/shared-by-me")
def list_shared_by_me(user: str = Depends(require_auth)):
    """List items shared by the current user."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM shared_items WHERE shared_by = ? ORDER BY created_at DESC",
            (user,)
        ).fetchall()
        return {"items": [dict(row) for row in rows]}

@router.get("/item/{item_type}/{item_id}")
def get_item_shares(item_type: str, item_id: str, user: str = Depends(require_auth)):
    """Get all shares for a specific item."""
    shares = get_shared_with_me(item_type, item_id)
    return {"shares": shares}

@router.delete("/{share_id}")
def unshare(share_id: int, user: str = Depends(require_auth)):
    """Unshare an item — only the sharer or owner can remove a share."""
    with get_conn() as conn:
        row = conn.execute("SELECT shared_by FROM shared_items WHERE id = ?", (share_id,)).fetchone()
    if not row:
        raise HTTPException(404, "Share not found")
    if user != "owner" and row["shared_by"] != user:
        raise HTTPException(403, "Only the person who shared this item can unshare it")
    unshare_item(share_id)
    return {"message": "Item unshared successfully"}
