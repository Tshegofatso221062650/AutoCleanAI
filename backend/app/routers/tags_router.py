from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List
from ..db import get_conn, _utc_now
from ..auth import require_auth
from ..services.access_control import require_item_access

router = APIRouter()

class TagCreate(BaseModel):
    dataset_id: str
    tag: str

def get_dataset_tags(dataset_id: str) -> List[str]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT tag FROM dataset_tags WHERE dataset_id = ?",
            (dataset_id,)
        ).fetchall()
        return [row[0] for row in rows]

def add_dataset_tag(dataset_id: str, tag: str) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO dataset_tags (dataset_id, tag, created_at)
            VALUES (?, ?, ?)
            """,
            (dataset_id, tag, _utc_now())
        )

def remove_dataset_tag(dataset_id: str, tag: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "DELETE FROM dataset_tags WHERE dataset_id = ? AND tag = ?",
            (dataset_id, tag)
        )

def get_all_tags() -> List[str]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT DISTINCT tag FROM dataset_tags ORDER BY tag"
        ).fetchall()
        return [row[0] for row in rows]

@router.get("/dataset/{dataset_id}")
def get_tags(dataset_id: str, user: str = Depends(require_auth)):
    """Get tags for a specific dataset."""
    tags = get_dataset_tags(dataset_id)
    return {"tags": tags}

@router.get("/")
def list_tags(user: str = Depends(require_auth)):
    """List all tags."""
    tags = get_all_tags()
    return {"tags": tags}

@router.post("/")
def add_tag(tag: TagCreate, user: str = Depends(require_auth)):
    """Add a tag to a dataset."""
    require_item_access(user, "dataset", tag.dataset_id)
    add_dataset_tag(tag.dataset_id, tag.tag)
    return {"message": "Tag added successfully"}

@router.delete("/{dataset_id}/{tag}")
def remove_tag(dataset_id: str, tag: str, user: str = Depends(require_auth)):
    """Remove a tag from a dataset."""
    require_item_access(user, "dataset", dataset_id)
    remove_dataset_tag(dataset_id, tag)
    return {"message": "Tag removed successfully"}
