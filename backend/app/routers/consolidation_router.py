from fastapi import APIRouter, Depends, HTTPException
from pathlib import Path

from app.auth import require_auth
from app.services.consolidation_service import (
    create_consolidation_group,
    add_dataset_to_group,
    get_group_datasets,
    consolidate_datasets,
    auto_detect_consolidation_strategy,
)
from app.services.storage import exported_dir
from app.db import mark_as_consolidated, new_dataset_id, insert_dataset

router = APIRouter(tags=["consolidation"])


@router.post("/consolidation/groups")
def create_group(body: dict, _: str = Depends(require_auth)):
    """Create a new consolidation group."""
    name = body.get("name")
    if not name:
        raise HTTPException(400, "name is required")
    
    group_id = create_consolidation_group(name, body.get("description"))
    return {"group_id": group_id, "name": name}


@router.post("/consolidation/groups/{group_id}/datasets")
def add_to_group(group_id: str, body: dict, _: str = Depends(require_auth)):
    """Add a dataset to a consolidation group."""
    dataset_id = body.get("dataset_id")
    if not dataset_id:
        raise HTTPException(400, "dataset_id is required")
    
    success = add_dataset_to_group(group_id, dataset_id, body.get("join_key"))
    if not success:
        raise HTTPException(400, "Failed to add dataset to group")
    
    return {"group_id": group_id, "dataset_id": dataset_id}


@router.get("/consolidation/groups/{group_id}")
def get_group(group_id: str, _: str = Depends(require_auth)):
    """Get consolidation group details."""
    datasets = get_group_datasets(group_id)
    return {"group_id": group_id, "datasets": datasets}


@router.get("/consolidation/groups")
def list_groups(_: str = Depends(require_auth), limit: int = 50):
    """List all consolidation groups."""
    from app.db import get_consolidation_groups
    return {"groups": get_consolidation_groups(limit)}


@router.post("/consolidation/groups/{group_id}/execute")
def execute_consolidation(group_id: str, body: dict, _: str = Depends(require_auth)):
    """Execute consolidation of datasets in a group."""
    merge_strategy = body.get("merge_strategy", "concat")
    
    try:
        df, log = consolidate_datasets(group_id, merge_strategy)
        
        # Save consolidated dataset
        consolidated_id = new_dataset_id()
        out_dir = exported_dir(consolidated_id)
        out_dir.mkdir(parents=True, exist_ok=True)
        
        export_path = out_dir / "consolidated.csv"
        df.to_csv(export_path, index=False)
        
        # Store in database
        insert_dataset(
            dataset_id=consolidated_id,
            original_filename=f"consolidated_{group_id}.csv",
            stored_path=str(export_path),
            file_format="csv",
            row_count=len(df),
            col_count=len(df.columns),
        )
        mark_as_consolidated(consolidated_id)
        
        return {
            "consolidated_dataset_id": consolidated_id,
            "row_count": len(df),
            "column_count": len(df.columns),
            "log": log,
        }
    except Exception as e:
        raise HTTPException(400, str(e))


@router.post("/consolidation/detect-strategy")
def detect_strategy(body: dict, _: str = Depends(require_auth)):
    """Auto-detect best consolidation strategy for given datasets."""
    datasets = body.get("datasets", [])
    strategy = auto_detect_consolidation_strategy(datasets)
    return {"recommended_strategy": strategy}
