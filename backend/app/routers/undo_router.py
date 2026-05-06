from __future__ import annotations

import json
import shutil
from datetime import datetime
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_auth
from app.services.access_control import require_item_access
from app.db import (
    _utc_now,
    create_dataset_version,
    get_conn,
    get_dataset,
    get_latest_version,
    get_next_version_number,
    update_dataset_analysis,
    update_dataset_clean,
)
from app.services.analysis import analyze_dataframe, quality_score_from_profile
from app.services.storage import exported_dir

router = APIRouter()


def _active_dataset_path(dataset: dict) -> Path:
    paths = json.loads(dataset["export_paths"]) if dataset.get("export_paths") else {}
    p = paths.get("xlsx") or dataset.get("stored_path")
    return Path(p)


def _load_df(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise HTTPException(404, "File not found for restore")
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(path)
    if suffix in (".xlsx", ".xls"):
        return pd.read_excel(path)
    if suffix == ".json":
        return pd.read_json(path)
    raise HTTPException(400, f"Unsupported file format: {suffix}")


def _write_export_files(dataset_id: str, stem: str, df: pd.DataFrame, label: str) -> dict:
    out_dir = exported_dir(dataset_id)
    base = out_dir / f"{stem}_{label}"
    paths: dict[str, str] = {}

    df.to_excel(base.with_suffix(".xlsx"), index=False, engine="openpyxl")
    paths["xlsx"] = str(base.with_suffix(".xlsx").resolve())

    try:
        df.to_csv(base.with_suffix(".csv"), index=False)
        paths["csv"] = str(base.with_suffix(".csv").resolve())
    except Exception:
        pass

    try:
        df.to_json(base.with_suffix(".json"), orient="records", indent=2, date_format="iso")
        paths["json"] = str(base.with_suffix(".json").resolve())
    except Exception:
        pass

    return paths


def _restore_to_version(dataset_id: str, target_version_id: int, operation_type: str, operation_details: dict) -> dict:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM dataset_versions WHERE id = ? AND dataset_id = ?",
            (target_version_id, dataset_id),
        ).fetchone()
        if not row:
            raise HTTPException(404, "Target version not found")
        version = dict(row)

    src = Path(version["file_path"])
    if not src.exists():
        raise HTTPException(404, "Target version file is missing")

    dataset = get_dataset(dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset not found")

    # Make a new immutable copy as the new active state.
    stem = Path(dataset["original_filename"]).stem
    next_v = get_next_version_number(dataset_id)
    out_dir = exported_dir(dataset_id)
    restored_xlsx = out_dir / f"{stem}_{operation_type}_v{next_v}.xlsx"
    restored_xlsx.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(src, restored_xlsx)

    df = _load_df(restored_xlsx)
    profile = analyze_dataframe(df)
    q = float(profile.get("quality_score") or quality_score_from_profile(profile))

    export_paths = _write_export_files(dataset_id, stem, df, f"{operation_type}_v{next_v}")

    update_dataset_clean(dataset_id, {"operation": operation_type, **operation_details}, export_paths, q)
    update_dataset_analysis(dataset_id, profile, q)

    create_dataset_version(
        dataset_id=dataset_id,
        version_number=next_v,
        file_path=export_paths["xlsx"],
        row_count=len(df),
        quality_score=q,
        operation_type=operation_type,
        operation_details=json.dumps(operation_details),
        parent_version_id=target_version_id,
    )

    return {
        "dataset_id": dataset_id,
        "version_id": target_version_id,
        "new_version_number": next_v,
        "export_paths": export_paths,
        "quality_score": q,
    }

def create_undo_entry(
    dataset_id: str,
    operation_type: str,
    operation_details: str,
    previous_state: str,
    created_by: str,
) -> int:
    """Create an undo entry for tracking operations."""
    with get_conn() as conn:
        cursor = conn.execute(
            """
            INSERT INTO undo_history 
            (dataset_id, operation_type, operation_details, previous_state, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (dataset_id, operation_type, operation_details, previous_state, created_by, _utc_now())
        )
        return cursor.lastrowid

def get_undo_history(dataset_id: str, limit: int = 10) -> list[dict]:
    """Get undo history for a dataset."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM undo_history WHERE dataset_id = ? ORDER BY created_at DESC LIMIT ?",
            (dataset_id, limit)
        ).fetchall()
        return [dict(row) for row in rows]

def perform_undo(undo_id: int, user: str) -> dict:
    """Perform an undo operation."""
    with get_conn() as conn:
        undo_entry = conn.execute(
            "SELECT * FROM undo_history WHERE id = ?",
            (undo_id,)
        ).fetchone()
        
        if not undo_entry:
            raise HTTPException(404, "Undo entry not found")
        
        # Mark as used
        conn.execute(
            "UPDATE undo_history SET used = 1 WHERE id = ?",
            (undo_id,)
        )
    
    return {
        "message": "Undo operation performed",
        "undo_id": undo_id,
    }


@router.post("/{dataset_id}/undo")
def undo_latest(dataset_id: str, user: str = Depends(require_auth)):
    """Undo the latest dataset version (single-step)."""
    require_item_access(user, "dataset", dataset_id)
    latest = get_latest_version(dataset_id)
    if not latest:
        raise HTTPException(404, "No versions found for dataset")

    with get_conn() as conn:
        prev = conn.execute(
            "SELECT * FROM dataset_versions WHERE dataset_id = ? AND version_number = ?",
            (dataset_id, int(latest["version_number"]) - 1),
        ).fetchone()
        if not prev:
            raise HTTPException(400, "Nothing to undo (no previous version)")
        prev_version = dict(prev)

    # Store redo info (restore latest version_id)
    create_undo_entry(
        dataset_id=dataset_id,
        operation_type="undo",
        operation_details=json.dumps({"from_version_id": latest["id"], "to_version_id": prev_version["id"]}),
        previous_state=json.dumps({"redo_version_id": latest["id"]}),
        created_by=user,
    )

    result = _restore_to_version(
        dataset_id,
        target_version_id=prev_version["id"],
        operation_type="undo",
        operation_details={"from_version": latest["version_number"], "to_version": prev_version["version_number"]},
    )
    return {"message": "Undo completed", **result}


@router.post("/{dataset_id}/redo")
def redo_latest(dataset_id: str, user: str = Depends(require_auth)):
    """Redo the most recent undo (single-step)."""
    require_item_access(user, "dataset", dataset_id)
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT * FROM undo_history
            WHERE dataset_id = ? AND operation_type = 'undo' AND used = 0
            ORDER BY created_at DESC
            LIMIT 1
            """,
            (dataset_id,),
        ).fetchone()
        if not row:
            raise HTTPException(400, "Nothing to redo")
        undo_entry = dict(row)

        try:
            redo_version_id = json.loads(undo_entry.get("previous_state") or "{}").get("redo_version_id")
        except Exception:
            redo_version_id = None
        if not redo_version_id:
            raise HTTPException(400, "Redo state is missing")

        conn.execute("UPDATE undo_history SET used = 1 WHERE id = ?", (undo_entry["id"],))

    result = _restore_to_version(
        dataset_id,
        target_version_id=int(redo_version_id),
        operation_type="redo",
        operation_details={"redo_version_id": redo_version_id},
    )
    return {"message": "Redo completed", **result}

@router.get("/{dataset_id}")
def list_undo_history(dataset_id: str, user: str = Depends(require_auth)):
    """List undo history for a dataset."""
    require_item_access(user, "dataset", dataset_id)
    history = get_undo_history(dataset_id)
    return {"history": history}
