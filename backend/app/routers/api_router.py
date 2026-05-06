from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
import json

from app.auth import require_auth
from app.routers.clean_router import run_clean_pipeline
from app.schemas import CleanRequest
from app.routers.pipeline_router import run as run_pipeline
from app.services.access_control import require_item_access
from app.db import list_history_for_user
from ..db import get_conn, get_dataset

router = APIRouter()

class CleaningRequest(CleanRequest):
    """API cleaning request (same as UI cleaning request)."""

class PipelineExecutionRequest(BaseModel):
    pipeline_id: int
    dataset_id: str

@router.post("/clean")
def trigger_cleaning(request: CleaningRequest, user: str = Depends(require_auth)):
    """Trigger cleaning operation programmatically."""
    require_item_access(user, "dataset", request.dataset_id)
    dataset = get_dataset(request.dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset not found")

    # Execute synchronously (programmatic trigger).
    result = run_clean_pipeline(request)
    return {"status": "completed", **result}

@router.post("/pipeline/execute")
def execute_pipeline(request: PipelineExecutionRequest, user: str = Depends(require_auth)):
    """Execute a pipeline programmatically."""
    require_item_access(user, "dataset", request.dataset_id)
    dataset = get_dataset(request.dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset not found")
    return run_pipeline(request.pipeline_id, request.dataset_id, user)

@router.get("/datasets")
def list_datasets(user: str = Depends(require_auth)):
    """List datasets the authenticated user can access."""
    rows = list_history_for_user(user, limit=500)
    datasets = [
        {
            "id": r["id"],
            "filename": r["original_filename"],
            "quality_score": r.get("quality_score"),
            "row_count": r.get("row_count"),
            "col_count": r.get("col_count"),
            "created_at": r["created_at"],
            "created_by": r.get("created_by"),
        }
        for r in rows
    ]
    return {"datasets": datasets}

@router.get("/pipelines")
def list_pipelines(user: str = Depends(require_auth)):
    """List pipelines owned by the user plus all templates."""
    with get_conn() as conn:
        if user == "owner":
            rows = conn.execute(
                "SELECT id, name, steps, is_template, created_by FROM pipelines ORDER BY created_at DESC"
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, name, steps, is_template, created_by FROM pipelines "
                "WHERE created_by = ? OR is_template = 1 ORDER BY created_at DESC",
                (user,),
            ).fetchall()
        pipelines = [
            {
                "id": row[0],
                "name": row[1],
                "steps": json.loads(row[2]) if row[2] else [],
                "is_template": bool(row[3]),
                "created_by": row[4],
            }
            for row in rows
        ]
    return {"pipelines": pipelines}

@router.get("/health")
def api_health():
    """API health check endpoint."""
    return {"status": "ok", "service": "AutoClean AI API"}
