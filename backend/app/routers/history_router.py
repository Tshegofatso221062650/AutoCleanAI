import json

from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_auth
from app.db import delete_dataset, get_dataset, list_history_for_user
from app.services.access_control import require_item_access

router = APIRouter(tags=["history"])


@router.get("/history")
def history(user: str = Depends(require_auth), limit: int = 100):
    rows = list_history_for_user(user, limit)
    slim = [
        {
            "id": r["id"],
            "original_filename": r["original_filename"],
            "created_at": r["created_at"],
            "created_by": r.get("created_by"),
            "last_analyzed_at": r.get("last_analyzed_at"),
            "last_cleaned_at": r.get("last_cleaned_at"),
            "row_count": r.get("row_count"),
            "col_count": r.get("col_count"),
            "quality_score": r.get("quality_score"),
            "has_analysis": bool(r.get("has_analysis")),
        }
        for r in rows
    ]
    return {"items": slim}


@router.get("/dataset/{dataset_id}")
def dataset_detail(dataset_id: str, user: str = Depends(require_auth)):
    require_item_access(user, "dataset", dataset_id)
    r = get_dataset(dataset_id)
    if not r:
        return {"error": "not_found"}
    out = dict(r)
    for k in ("analysis_json", "clean_report_json", "export_paths"):
        if out.get(k):
            try:
                out[k] = json.loads(out[k])
            except Exception:
                pass
    return out


@router.get("/datasets/{dataset_id}")
def dataset_detail_plural(dataset_id: str, user: str = Depends(require_auth)):
    """Plural alias for compatibility with frontend calls."""
    return dataset_detail(dataset_id, user)


@router.delete("/dataset/{dataset_id}")
def delete_dataset_endpoint(dataset_id: str, user: str = Depends(require_auth)):
    require_item_access(user, "dataset", dataset_id)
    dataset = get_dataset(dataset_id)
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
    
    deleted = delete_dataset(dataset_id)
    if not deleted:
        raise HTTPException(status_code=500, detail="Failed to delete dataset")
    
    return {"message": "Dataset deleted successfully", "dataset_id": dataset_id}


@router.delete("/datasets/{dataset_id}")
def delete_dataset_endpoint_plural(dataset_id: str, user: str = Depends(require_auth)):
    """Plural alias for compatibility with frontend calls."""
    return delete_dataset_endpoint(dataset_id, user)
