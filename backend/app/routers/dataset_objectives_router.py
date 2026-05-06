from fastapi import APIRouter, Depends

from app.auth import require_auth
from app.db import get_dataset_objectives

router = APIRouter(tags=["dataset-objectives"])


@router.get("/datasets/{dataset_id}/objectives")
def list_dataset_objectives(dataset_id: str, _: str = Depends(require_auth)):
    objectives = get_dataset_objectives(dataset_id)
    return {"objectives": objectives}
