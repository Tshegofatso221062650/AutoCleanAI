from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import json
from ..db import get_conn, get_dataset, _utc_now
from ..auth import require_auth
from app.services.access_control import require_item_access

router = APIRouter()

def record_schema_change(dataset_id: str, schema_snapshot: dict, change_type: str) -> int:
    """Record a schema change."""
    with get_conn() as conn:
        cursor = conn.execute(
            """
            INSERT INTO schema_history 
            (dataset_id, schema_snapshot, change_type, changed_at)
            VALUES (?, ?, ?, ?)
            """,
            (dataset_id, json.dumps(schema_snapshot), change_type, _utc_now())
        )
        return cursor.lastrowid

def get_schema_history(dataset_id: str) -> list[dict]:
    """Get schema history for a dataset."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM schema_history WHERE dataset_id = ? ORDER BY changed_at DESC",
            (dataset_id,)
        ).fetchall()
        return [dict(row) for row in rows]

def get_latest_schema(dataset_id: str) -> dict | None:
    """Get the latest schema snapshot for a dataset."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM schema_history WHERE dataset_id = ? ORDER BY changed_at DESC LIMIT 1",
            (dataset_id,)
        ).fetchone()
        if row:
            snapshot = dict(row)
            snapshot['schema_snapshot'] = json.loads(snapshot['schema_snapshot'])
            return snapshot
        return None

@router.get("/{dataset_id}")
def get_history(dataset_id: str, user: str = Depends(require_auth)):
    """Get schema evolution history for a dataset."""
    require_item_access(user, "dataset", dataset_id)
    dataset = get_dataset(dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset not found")
    
    history = get_schema_history(dataset_id)
    
    # Parse schema snapshots
    for entry in history:
        if entry['schema_snapshot']:
            try:
                entry['schema_snapshot'] = json.loads(entry['schema_snapshot'])
            except:
                pass
    
    return {"dataset_id": dataset_id, "history": history}

@router.get("/{dataset_id}/latest")
def get_latest(dataset_id: str, user: str = Depends(require_auth)):
    """Get the latest schema for a dataset."""
    require_item_access(user, "dataset", dataset_id)
    dataset = get_dataset(dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset not found")
    
    latest = get_latest_schema(dataset_id)
    return latest or {"message": "No schema history found"}
