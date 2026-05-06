"""Pipeline router for data cleaning workflows."""
import json
from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_auth
from app.db import (
    create_pipeline,
    get_pipeline,
    list_pipelines,
    update_pipeline,
    delete_pipeline,
    create_pipeline_run,
    update_pipeline_run,
    get_pipeline_runs,
    create_schedule,
    get_schedules,
    update_schedule,
    get_conn,
)
from app.schemas.pipeline import PipelineCreate, PipelineUpdate, PipelineResponse
from app.services.pipeline_executor import execute_pipeline

router = APIRouter(tags=["pipelines"])


@router.post("/pipelines")
def create(pipeline: PipelineCreate, user: str = Depends(require_auth)) -> dict:
    """Create a new cleaning pipeline."""
    pipeline_id = create_pipeline(
        name=pipeline.name,
        description=pipeline.description,
        steps=json.dumps([s.model_dump() for s in pipeline.steps]),
        created_by=user,
        is_template=pipeline.is_template,
    )
    return {"pipeline_id": pipeline_id, "message": "Pipeline created successfully"}


@router.get("/pipelines")
def list_all(user: str = Depends(require_auth), is_template: bool | None = None) -> list[dict]:
    """List all pipelines for the user."""
    return list_pipelines(created_by=user, is_template=is_template)


@router.get("/pipelines/templates")
def list_templates() -> list[dict]:
    """List template pipelines available to all users."""
    return list_pipelines(is_template=True)


@router.get("/pipelines/{pipeline_id}")
def get(pipeline_id: int, user: str = Depends(require_auth)) -> dict:
    """Get a specific pipeline."""
    pipeline = get_pipeline(pipeline_id)
    if not pipeline:
        raise HTTPException(404, "Pipeline not found")
    if pipeline["created_by"] != user and not pipeline["is_template"]:
        raise HTTPException(403, "Access denied")
    pipeline["steps"] = json.loads(pipeline["steps"])
    return pipeline


@router.put("/pipelines/{pipeline_id}")
def update(pipeline_id: int, pipeline: PipelineUpdate, user: str = Depends(require_auth)) -> dict:
    """Update a pipeline."""
    existing = get_pipeline(pipeline_id)
    if not existing:
        raise HTTPException(404, "Pipeline not found")
    if existing["created_by"] != user:
        raise HTTPException(403, "Access denied")
    
    steps_json = None
    if pipeline.steps:
        steps_json = json.dumps([s.model_dump() for s in pipeline.steps])
    
    update_pipeline(
        pipeline_id=pipeline_id,
        name=pipeline.name,
        description=pipeline.description,
        steps=steps_json,
        is_template=pipeline.is_template,
    )
    return {"message": "Pipeline updated successfully"}


@router.delete("/pipelines/{pipeline_id}")
def delete(pipeline_id: int, user: str = Depends(require_auth)) -> dict:
    """Delete a pipeline."""
    existing = get_pipeline(pipeline_id)
    if not existing:
        raise HTTPException(404, "Pipeline not found")
    if existing["created_by"] != user:
        raise HTTPException(403, "Access denied")
    
    delete_pipeline(pipeline_id)
    return {"message": "Pipeline deleted successfully"}


@router.post("/pipelines/{pipeline_id}/run")
def run(pipeline_id: int, dataset_id: str, user: str = Depends(require_auth)) -> dict:
    """Run a pipeline on a dataset."""
    pipeline = get_pipeline(pipeline_id)
    if not pipeline:
        raise HTTPException(404, "Pipeline not found")
    if pipeline["created_by"] != user and not pipeline["is_template"]:
        raise HTTPException(403, "Access denied")
    
    try:
        result = execute_pipeline(pipeline_id, dataset_id)
        return {"message": "Pipeline execution completed", **result}
    except ValueError as e:
        raise HTTPException(404, str(e))
    except RuntimeError as e:
        raise HTTPException(500, str(e))


@router.get("/pipelines/{pipeline_id}/runs")
def get_runs(pipeline_id: int, user: str = Depends(require_auth)) -> list[dict]:
    """Get run history for a pipeline."""
    pipeline = get_pipeline(pipeline_id)
    if not pipeline:
        raise HTTPException(404, "Pipeline not found")
    if pipeline["created_by"] != user and not pipeline["is_template"]:
        raise HTTPException(403, "Access denied")
    
    return get_pipeline_runs(pipeline_id=pipeline_id)


@router.post("/pipelines/{pipeline_id}/schedule")
def schedule(
    pipeline_id: int,
    dataset_id: str | None = None,
    cron_expression: str = "0 0 * * *",  # Daily at midnight
    user: str = Depends(require_auth)
) -> dict:
    """Schedule a pipeline to run automatically."""
    pipeline = get_pipeline(pipeline_id)
    if not pipeline:
        raise HTTPException(404, "Pipeline not found")
    if pipeline["created_by"] != user:
        raise HTTPException(403, "Access denied")
    
    schedule_id = create_schedule(pipeline_id, dataset_id, cron_expression)
    return {"schedule_id": schedule_id, "message": "Pipeline scheduled successfully"}


@router.get("/schedules")
def list_schedules(user: str = Depends(require_auth)) -> list[dict]:
    """List schedules that belong to pipelines owned by the requesting user."""
    all_schedules = get_schedules()
    with get_conn() as conn:
        user_pipeline_ids = {
            row[0]
            for row in conn.execute(
                "SELECT id FROM pipelines WHERE created_by = ?", (user,)
            ).fetchall()
        }
    return [s for s in all_schedules if s.get("pipeline_id") in user_pipeline_ids]


@router.put("/schedules/{schedule_id}")
def update_schedule_endpoint(
    schedule_id: int,
    enabled: bool | None = None,
    cron_expression: str | None = None,
    user: str = Depends(require_auth)
) -> dict:
    """Update a schedule after verifying the caller owns its pipeline."""
    schedules = get_schedules()
    schedule = next((s for s in schedules if s["id"] == schedule_id), None)
    if not schedule:
        raise HTTPException(404, "Schedule not found")
    pipeline = get_pipeline(schedule["pipeline_id"])
    if not pipeline or pipeline["created_by"] != user:
        raise HTTPException(403, "Access denied")
    update_schedule(schedule_id, enabled=enabled, cron_expression=cron_expression)
    return {"message": "Schedule updated successfully"}
