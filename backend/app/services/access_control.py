from __future__ import annotations

from app.db import get_conn


def can_access_item(user: str, item_type: str, item_id: str) -> bool:
    """ACL: owner bypasses all checks; other users pass if they created the item OR it was shared with them."""
    if user == "owner":
        return True
    with get_conn() as conn:
        if item_type == "dataset":
            owned = conn.execute(
                "SELECT 1 FROM datasets WHERE id = ? AND created_by = ? LIMIT 1",
                (item_id, user),
            ).fetchone()
            if owned:
                return True
        elif item_type == "pipeline":
            owned = conn.execute(
                "SELECT 1 FROM pipelines WHERE id = ? AND created_by = ? LIMIT 1",
                (item_id, user),
            ).fetchone()
            if owned:
                return True
        row = conn.execute(
            """
            SELECT 1
            FROM shared_items
            WHERE item_type = ? AND item_id = ? AND shared_with = ?
            LIMIT 1
            """,
            (item_type, item_id, user),
        ).fetchone()
        return row is not None


def require_item_access(user: str, item_type: str, item_id: str) -> None:
    if not can_access_item(user, item_type, item_id):
        from fastapi import HTTPException

        raise HTTPException(403, "Access denied")
