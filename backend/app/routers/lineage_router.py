"""Lineage router for data lineage tracking."""
from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_auth
from app.db import get_dataset, get_data_lineage, get_full_lineage
from app.services.access_control import require_item_access

router = APIRouter(tags=["lineage"])


@router.get("/datasets/{dataset_id}/lineage")
def get_lineage(dataset_id: str, user: str = Depends(require_auth)):
    """Get lineage for a dataset."""
    require_item_access(user, "dataset", dataset_id)
    dataset = get_dataset(dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset not found")
    
    lineage = get_data_lineage(dataset_id)
    return {"dataset_id": dataset_id, "lineage": lineage}


@router.get("/datasets/{dataset_id}/lineage/full")
def get_full(dataset_id: str, user: str = Depends(require_auth)):
    """Get full lineage tree for a dataset."""
    require_item_access(user, "dataset", dataset_id)
    dataset = get_dataset(dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset not found")
    
    lineage = get_full_lineage(dataset_id)
    return {"dataset_id": dataset_id, "full_lineage": lineage}
