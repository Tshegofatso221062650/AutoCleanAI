import json as _json

from fastapi import APIRouter, Depends, HTTPException
from pathlib import Path

from app.auth import require_auth
from app.services.access_control import require_item_access
from app.services.transformation_service import apply_transformation_pipeline
from app.services.cleaning_engine import load_dataframe
from app.services.storage import exported_dir, infer_format_from_name
from app.db import get_dataset, new_dataset_id, insert_dataset, write_audit_log
from app.services import webhook_dispatcher

router = APIRouter(tags=["transformation"])


def _resolve_best_path(row: dict, use_cleaned: bool) -> tuple[Path, str, str]:
    """Return (path, file_format, data_source) preferring the cleaned export when available.

    data_source is either 'cleaned' or 'raw' so the caller can surface it to the user.
    """
    if use_cleaned:
        raw_paths = row.get("export_paths") or {}
        if isinstance(raw_paths, str):
            try:
                raw_paths = _json.loads(raw_paths)
            except Exception:
                raw_paths = {}
        for fmt in ("csv", "xlsx", "xls", "json"):
            p_str = raw_paths.get(fmt)
            if p_str:
                p = Path(p_str)
                if p.exists():
                    return p, fmt, "cleaned"

    # Fall back to original stored path
    p = Path(row["stored_path"])
    if not p.exists():
        raise FileNotFoundError(f"Dataset file not found: {p}")
    return p, row["file_format"] or "csv", "raw"


@router.post("/transform")
def apply_transformations(body: dict, user: str = Depends(require_auth)):
    """Apply transformation pipeline to a dataset.

    By default transforms the *cleaned* version of the data when one exists.
    Pass ``use_cleaned=false`` to always use the original uploaded file.
    """
    dataset_id = body.get("dataset_id")
    pipeline   = body.get("pipeline", [])
    use_cleaned: bool = body.get("use_cleaned", True)

    if not dataset_id:
        raise HTTPException(400, "dataset_id is required")
    if not pipeline:
        raise HTTPException(400, "pipeline is required")

    require_item_access(user, "dataset", dataset_id)
    row = get_dataset(dataset_id)
    if not row:
        raise HTTPException(404, "Dataset not found")

    # Resolve source file — prefer cleaned export when available
    try:
        path, file_format, data_source = _resolve_best_path(row, use_cleaned)
    except FileNotFoundError as exc:
        raise HTTPException(404, str(exc))

    try:
        df = load_dataframe(path, file_format)
    except Exception as e:
        raise HTTPException(400, f"Failed to load dataset: {str(e)}")
    
    # Apply transformations
    try:
        transformed_df, log = apply_transformation_pipeline(df, pipeline)
    except Exception as e:
        raise HTTPException(400, f"Transformation failed: {str(e)}")
    
    # Save transformed dataset — preserve source format
    transformed_id = new_dataset_id()
    out_dir = exported_dir(transformed_id)
    out_dir.mkdir(parents=True, exist_ok=True)

    out_name = f"transformed_{row['original_filename']}"
    export_path = out_dir / out_name

    if file_format in ("xlsx", "xls"):
        export_path = export_path.with_suffix(".xlsx")
        transformed_df.to_excel(export_path, index=False, engine="openpyxl")
        out_fmt = "xlsx"
    else:
        export_path = export_path.with_suffix(".csv")
        transformed_df.to_csv(export_path, index=False)
        out_fmt = "csv"

    # Store in database with owner
    insert_dataset(
        dataset_id=transformed_id,
        original_filename=export_path.name,
        stored_path=str(export_path),
        file_format=out_fmt,
        row_count=len(transformed_df),
        col_count=len(transformed_df.columns),
        created_by=user,
        parent_dataset_id=dataset_id,  # mark as derived so history can filter it
    )

    write_audit_log("transform", user, resource_type="dataset", resource_id=dataset_id, detail=f"{len(pipeline)} steps → {transformed_id}")
    webhook_dispatcher.dispatch(
        "pipeline.run",
        {"dataset_id": dataset_id, "transformed_dataset_id": transformed_id, "steps": len(pipeline), "user": user},
    )
    return {
        "transformed_dataset_id": transformed_id,
        "row_count": len(transformed_df),
        "column_count": len(transformed_df.columns),
        "log": log,
        "data_source": data_source,
    }
