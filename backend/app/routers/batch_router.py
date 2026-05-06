import threading

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import List
import json
from ..db import get_conn, _utc_now, write_audit_log
from ..auth import require_auth
from app.services.access_control import can_access_item
from app.services.batch_executor import run_batch
from app.services import webhook_dispatcher

router = APIRouter()

class BatchOperationCreate(BaseModel):
    name: str
    operation_type: str  # 'clean', 'transform', 'export'
    operation_config: dict
    dataset_ids: List[str]

def create_batch_operation(
    name: str,
    operation_type: str,
    operation_config: dict,
    dataset_ids: List[str],
    created_by: str = None,
) -> int:
    with get_conn() as conn:
        cursor = conn.execute(
            """
            INSERT INTO batch_operations 
            (name, operation_type, operation_config, total_datasets, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (name, operation_type, json.dumps(operation_config), len(dataset_ids), created_by, _utc_now())
        )
        batch_id = cursor.lastrowid
        
        # Add batch items
        for dataset_id in dataset_ids:
            conn.execute(
                """
                INSERT INTO batch_operation_items 
                (batch_id, dataset_id, status)
                VALUES (?, ?, 'pending')
                """,
                (batch_id, dataset_id)
            )
        
        return batch_id

def get_batch_operations(created_by: str = None) -> List[dict]:
    with get_conn() as conn:
        if created_by:
            rows = conn.execute(
                "SELECT * FROM batch_operations WHERE created_by = ? ORDER BY created_at DESC",
                (created_by,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM batch_operations ORDER BY created_at DESC"
            ).fetchall()
        return [dict(row) for row in rows]

def get_batch_operation(batch_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM batch_operations WHERE id = ?",
            (batch_id,)
        ).fetchone()
        return dict(row) if row else None

def get_batch_operation_items(batch_id: int) -> List[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM batch_operation_items WHERE batch_id = ?",
            (batch_id,)
        ).fetchall()
        return [dict(row) for row in rows]

def update_batch_operation_status(
    batch_id: int,
    status: str,
    completed_datasets: int = None,
    failed_datasets: int = None,
    error_message: str = None,
) -> None:
    with get_conn() as conn:
        updates = ["status = ?", "completed_at = ?"]
        values = [status, _utc_now()]
        
        if completed_datasets is not None:
            updates.append("completed_datasets = ?")
            values.append(completed_datasets)
        if failed_datasets is not None:
            updates.append("failed_datasets = ?")
            values.append(failed_datasets)
        if error_message is not None:
            updates.append("error_message = ?")
            values.append(error_message)
        
        values.append(batch_id)
        conn.execute(
            f"UPDATE batch_operations SET {', '.join(updates)} WHERE id = ?",
            values
        )

@router.get("/")
def list_batches(user: str = Depends(require_auth)):
    """List all batch operations."""
    batches = get_batch_operations(created_by=None if user == "owner" else user)
    return {"batches": batches}

@router.get("/{batch_id}")
def get_batch(batch_id: int, user: str = Depends(require_auth)):
    """Get a specific batch operation with its items."""
    batch = get_batch_operation(batch_id)
    if not batch:
        raise HTTPException(404, "Batch operation not found")
    if batch.get("created_by") != user and user != "owner":
        raise HTTPException(403, "Access denied")
    items = get_batch_operation_items(batch_id)
    return {"batch": batch, "items": items}

@router.post("/")
def create_batch(batch: BatchOperationCreate, user: str = Depends(require_auth)):
    """Create a new batch operation."""
    denied = [d for d in batch.dataset_ids if not can_access_item(user, "dataset", d)]
    if denied:
        raise HTTPException(403, f"Access denied to {len(denied)} dataset(s): {', '.join(denied[:3])}")
    batch_id = create_batch_operation(
        name=batch.name,
        operation_type=batch.operation_type,
        operation_config=batch.operation_config,
        dataset_ids=batch.dataset_ids,
        created_by=user,
    )
    write_audit_log("batch_created", user, resource_type="batch", resource_id=str(batch_id), detail=batch.name)
    created = get_batch_operation(batch_id)
    if not created:
        raise HTTPException(500, "Failed to create batch operation")
    return {"id": batch_id, **created}


@router.delete("/{batch_id}")
def delete_batch(batch_id: int, user: str = Depends(require_auth)):
    """Delete a batch operation and its items."""
    batch = get_batch_operation(batch_id)
    if not batch:
        raise HTTPException(404, "Batch operation not found")
    if batch.get("created_by") != user and user != "owner":
        raise HTTPException(403, "Access denied")
    if batch.get("status") == "running":
        raise HTTPException(409, "Cannot delete a running batch operation")
    with get_conn() as conn:
        conn.execute("DELETE FROM batch_operation_items WHERE batch_id = ?", (batch_id,))
        conn.execute("DELETE FROM batch_operations WHERE id = ?", (batch_id,))
    return {"message": "Batch operation deleted"}


@router.post("/{batch_id}/run")
def run_batch_operation(batch_id: int, user: str = Depends(require_auth)):
    """Kick off a batch operation in the background and return 202 immediately.

    Poll GET /{batch_id} to check status (pending → running → completed / completed_with_errors).
    """
    batch = get_batch_operation(batch_id)
    if not batch:
        raise HTTPException(404, "Batch operation not found")
    if batch.get("created_by") != user and user != "owner":
        raise HTTPException(403, "Access denied")
    if batch.get("status") == "running":
        raise HTTPException(409, "Batch is already running")

    with get_conn() as conn:
        conn.execute(
            "UPDATE batch_operations SET status = 'running' WHERE id = ?",
            (batch_id,),
        )

    def _run():
        try:
            run_batch(batch_id)
            b = get_batch_operation(batch_id)
            write_audit_log("batch_completed", user, resource_type="batch", resource_id=str(batch_id))
            webhook_dispatcher.dispatch(
                "pipeline.run",
                {"batch_id": batch_id, "name": b.get("name") if b else "", "status": "completed", "user": user},
            )
        except Exception as exc:
            with get_conn() as conn:
                conn.execute(
                    "UPDATE batch_operations SET status = 'failed', completed_at = ? WHERE id = ?",
                    (_utc_now(), batch_id),
                )
            write_audit_log("batch_failed", user, resource_type="batch", resource_id=str(batch_id), detail=str(exc))
            print(f"[batch] job {batch_id} failed: {exc}")

    threading.Thread(target=_run, daemon=True).start()
    return JSONResponse(status_code=202, content={"batch_id": batch_id, "status": "running"})
