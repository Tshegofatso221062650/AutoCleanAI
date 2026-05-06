"""Version router for dataset version management."""
import shutil
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_auth
from app.db import get_dataset, get_dataset_versions, get_latest_version
from app.services.access_control import require_item_access
from app.services.storage import resolve_original_path, exported_dir, infer_format_from_name
from app.services.cleaning_engine import load_dataframe

router = APIRouter(tags=["versions"])


@router.get("/datasets/{dataset_id}/versions")
def list_versions(dataset_id: str, user: str = Depends(require_auth)):
    """Get all versions of a dataset."""
    require_item_access(user, "dataset", dataset_id)
    dataset = get_dataset(dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset not found")
    
    versions = get_dataset_versions(dataset_id)
    return {"dataset_id": dataset_id, "versions": versions}


@router.get("/datasets/{dataset_id}/versions/latest")
def get_latest(dataset_id: str, user: str = Depends(require_auth)):
    """Get the latest version of a dataset."""
    require_item_access(user, "dataset", dataset_id)
    dataset = get_dataset(dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset not found")
    
    version = get_latest_version(dataset_id)
    if not version:
        raise HTTPException(404, "No versions found")
    
    return version


@router.post("/datasets/{dataset_id}/versions/{version_id}/restore")
def restore_version(dataset_id: str, version_id: int, user: str = Depends(require_auth)):
    """Restore a dataset from a specific version."""
    require_item_access(user, "dataset", dataset_id)
    dataset = get_dataset(dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset not found")
    
    versions = get_dataset_versions(dataset_id)
    version = next((v for v in versions if v["id"] == version_id), None)
    if not version:
        raise HTTPException(404, "Version not found")
    
    try:
        version_path = Path(version["file_path"])
        if not version_path.exists():
            raise HTTPException(404, "Version file not found")

        stored = dataset.get("stored_path")
        if not stored:
            raise HTTPException(404, "Dataset has no stored path")
        original_path = Path(stored)

        backup_path: Path | None = None
        if original_path.exists():
            backup_path = original_path.with_suffix(f".backup_{version_id}")
            shutil.copy2(original_path, backup_path)

        shutil.copy2(version_path, original_path)

        fmt = dataset.get("file_format") or infer_format_from_name(dataset["original_filename"])
        df = load_dataframe(original_path, fmt)

        return {
            "message": "Dataset restored successfully",
            "version_id": version_id,
            "rows_restored": len(df),
            "backup_path": str(backup_path) if backup_path else None,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(500, f"Failed to restore version: {str(e)}")
