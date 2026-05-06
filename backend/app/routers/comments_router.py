"""Dataset comments router — threaded annotations on any dataset."""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import require_auth
from app.db import create_comment, delete_comment, get_comment, get_comments, get_user_by_username
from app.services.access_control import require_item_access

router = APIRouter(tags=["comments"])


class CommentCreate(BaseModel):
    content: str


@router.get("/datasets/{dataset_id}/comments")
def list_comments(dataset_id: str, user: str = Depends(require_auth)):
    """List all comments for a dataset."""
    require_item_access(user, "dataset", dataset_id)
    return {"comments": get_comments(dataset_id)}


@router.post("/datasets/{dataset_id}/comments", status_code=201)
def add_comment(dataset_id: str, body: CommentCreate, user: str = Depends(require_auth)):
    """Post a new comment on a dataset."""
    if not body.content.strip():
        raise HTTPException(400, "Comment cannot be empty")
    require_item_access(user, "dataset", dataset_id)
    comment_id = create_comment(dataset_id, user, body.content.strip())
    return {
        "id": comment_id,
        "dataset_id": dataset_id,
        "author": user,
        "content": body.content.strip(),
    }


@router.delete("/datasets/{dataset_id}/comments/{comment_id}")
def remove_comment(dataset_id: str, comment_id: int, user: str = Depends(require_auth)):
    """Delete a comment — only the author or owner can delete."""
    comment = get_comment(comment_id)
    if not comment:
        raise HTTPException(404, "Comment not found")
    if comment["author"] != user:
        if user != "owner":
            record = get_user_by_username(user)
            if not record or record.get("role") != "admin":
                raise HTTPException(403, "You can only delete your own comments")
    delete_comment(comment_id)
    return {"ok": True}
