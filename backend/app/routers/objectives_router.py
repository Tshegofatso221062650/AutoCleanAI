"""Router for cleaning objectives management."""
from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_auth
from app.services.access_control import require_item_access
from app.db import (
    create_cleaning_objective,
    get_cleaning_objective,
    get_cleaning_objectives,
    update_cleaning_objective,
    delete_cleaning_objective,
    assign_objective_to_dataset,
    get_dataset_objectives,
    update_objective_status,
)
from app.schemas import CleaningObjectiveCreate, CleaningObjectiveUpdate, CleaningObjectiveResponse

router = APIRouter(tags=["objectives"])


@router.get("/")
def list_objectives(user: str = Depends(require_auth)):
    """List all cleaning objectives for the user."""
    objectives = get_cleaning_objectives(created_by=user)
    return {"objectives": objectives}


@router.get("/templates")
def list_templates(user: str = Depends(require_auth)):
    """List all template objectives."""
    objectives = get_cleaning_objectives()
    templates = [o for o in objectives if o.get("is_template")]
    return {"templates": templates}


@router.post("/")
def create_objective(objective: CleaningObjectiveCreate, user: str = Depends(require_auth)):
    """Create a new cleaning objective."""
    objective_id = create_cleaning_objective(
        name=objective.name,
        description=objective.description,
        objective_type=objective.objective_type,
        target_value=objective.target_value,
        column_name=objective.column_name,
        validation_rule=objective.validation_rule,
        is_template=objective.is_template,
        created_by=user,
    )
    created = get_cleaning_objective(objective_id)
    if not created:
        raise HTTPException(500, "Failed to create objective")
    return {"id": objective_id, **created}


@router.get("/{objective_id}")
def get_objective(objective_id: int, user: str = Depends(require_auth)):
    """Get a specific cleaning objective."""
    objective = get_cleaning_objective(objective_id)
    if not objective:
        raise HTTPException(404, "Objective not found")
    if not objective.get("is_template") and objective.get("created_by") != user and user != "owner":
        raise HTTPException(403, "Access denied")
    return objective


@router.put("/{objective_id}")
def update_objective(
    objective_id: int,
    update: CleaningObjectiveUpdate,
    user: str = Depends(require_auth),
):
    """Update a cleaning objective."""
    objective = get_cleaning_objective(objective_id)
    if not objective:
        raise HTTPException(404, "Objective not found")
    if objective.get("created_by") != user and user != "owner":
        raise HTTPException(403, "Access denied")
    update_cleaning_objective(
        objective_id,
        name=update.name,
        description=update.description,
        objective_type=update.objective_type,
        target_value=update.target_value,
        column_name=update.column_name,
        validation_rule=update.validation_rule,
        is_template=update.is_template,
    )
    
    updated = get_cleaning_objective(objective_id)
    return updated


@router.delete("/{objective_id}")
def delete_objective(objective_id: int, user: str = Depends(require_auth)):
    """Delete a cleaning objective."""
    objective = get_cleaning_objective(objective_id)
    if not objective:
        raise HTTPException(404, "Objective not found")
    if objective.get("created_by") != user and user != "owner":
        raise HTTPException(403, "Access denied")
    delete_cleaning_objective(objective_id)
    return {"message": "Objective deleted successfully"}


@router.post("/datasets/{dataset_id}/objectives/{objective_id}")
def assign_objective(dataset_id: str, objective_id: int, user: str = Depends(require_auth)):
    """Assign an objective to a dataset."""
    require_item_access(user, "dataset", dataset_id)
    objective = get_cleaning_objective(objective_id)
    if not objective:
        raise HTTPException(404, "Objective not found")
    assignment_id = assign_objective_to_dataset(dataset_id, objective_id)
    return {"assignment_id": assignment_id, "message": "Objective assigned successfully"}


@router.get("/datasets/{dataset_id}/objectives")
def get_dataset_objectives_list(dataset_id: str, user: str = Depends(require_auth)):
    """Get all objectives assigned to a dataset."""
    require_item_access(user, "dataset", dataset_id)
    objectives = get_dataset_objectives(dataset_id)
    return {"objectives": objectives}


@router.put("/datasets/{dataset_id}/objectives/{objective_id}/status")
def update_status(
    dataset_id: str,
    objective_id: int,
    status: str,
    result_value: str | None = None,
    user: str = Depends(require_auth),
):
    """Update the status of an objective for a dataset."""
    update_objective_status(dataset_id, objective_id, status, result_value)
    return {"message": "Status updated successfully"}
