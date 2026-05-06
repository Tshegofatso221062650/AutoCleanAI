from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import List
import json
from pathlib import Path
import pandas as pd
from ..db import get_conn, _utc_now, get_dataset
from ..auth import require_auth

router = APIRouter()


class ComparisonCreate(BaseModel):
    dataset1_id: str
    dataset2_id: str


def _load_dataset_df(dataset: dict) -> pd.DataFrame:
    """Load a dataset record into a DataFrame."""
    paths = {}
    try:
        paths = json.loads(dataset.get("export_paths") or "{}")
    except Exception:
        pass

    for key in ("csv", "xlsx", "json"):
        p = paths.get(key)
        if p and Path(p).exists():
            if key == "csv":
                return pd.read_csv(p)
            if key == "xlsx":
                return pd.read_excel(p)
            if key == "json":
                return pd.read_json(p)

    stored = dataset.get("stored_path")
    if stored and Path(stored).exists():
        suffix = Path(stored).suffix.lower()
        if suffix == ".csv":
            return pd.read_csv(stored)
        if suffix in (".xlsx", ".xls"):
            return pd.read_excel(stored)
        if suffix == ".json":
            return pd.read_json(stored)

    raise ValueError("No readable file found for dataset")


def _compute_comparison(df1: pd.DataFrame, df2: pd.DataFrame) -> dict:
    """Return a structured diff between two DataFrames."""
    cols1 = set(df1.columns)
    cols2 = set(df2.columns)
    common_cols = cols1 & cols2

    only_in_1 = sorted(cols1 - cols2)
    only_in_2 = sorted(cols2 - cols1)

    type_changes = []
    for col in sorted(common_cols):
        t1 = str(df1[col].dtype)
        t2 = str(df2[col].dtype)
        if t1 != t2:
            type_changes.append({"column": col, "type1": t1, "type2": t2})

    column_stats = []
    for col in sorted(common_cols):
        s1, s2 = df1[col], df2[col]
        missing1 = round(s1.isna().mean() * 100, 2)
        missing2 = round(s2.isna().mean() * 100, 2)
        stat: dict = {"column": col, "missing_pct_1": missing1, "missing_pct_2": missing2}
        if pd.api.types.is_numeric_dtype(s1) and pd.api.types.is_numeric_dtype(s2):
            stat["mean_1"] = round(float(s1.mean()), 4) if not s1.empty else None
            stat["mean_2"] = round(float(s2.mean()), 4) if not s2.empty else None
            stat["std_1"] = round(float(s1.std()), 4) if len(s1) > 1 else None
            stat["std_2"] = round(float(s2.std()), 4) if len(s2) > 1 else None
        column_stats.append(stat)

    dup1 = int(df1.duplicated().sum())
    dup2 = int(df2.duplicated().sum())

    return {
        "row_count_1": len(df1),
        "row_count_2": len(df2),
        "row_count_diff": len(df2) - len(df1),
        "col_count_1": len(df1.columns),
        "col_count_2": len(df2.columns),
        "columns_only_in_1": only_in_1,
        "columns_only_in_2": only_in_2,
        "type_changes": type_changes,
        "column_stats": column_stats,
        "duplicate_count_1": dup1,
        "duplicate_count_2": dup2,
        "schema_identical": (only_in_1 == [] and only_in_2 == [] and type_changes == []),
    }


def create_comparison(dataset1_id: str, dataset2_id: str, created_by: str = None) -> int:
    with get_conn() as conn:
        cursor = conn.execute(
            """
            INSERT INTO dataset_comparisons
            (dataset1_id, dataset2_id, created_by, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (dataset1_id, dataset2_id, created_by, _utc_now()),
        )
        return cursor.lastrowid


def get_comparisons(created_by: str = None) -> List[dict]:
    with get_conn() as conn:
        if created_by:
            rows = conn.execute(
                "SELECT * FROM dataset_comparisons WHERE created_by = ? ORDER BY created_at DESC",
                (created_by,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM dataset_comparisons ORDER BY created_at DESC"
            ).fetchall()
        return [dict(row) for row in rows]


def get_comparison(comp_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM dataset_comparisons WHERE id = ?", (comp_id,)
        ).fetchone()
        return dict(row) if row else None


@router.get("/")
def list_comparisons(user: str = Depends(require_auth)):
    """List all comparisons."""
    return {"comparisons": get_comparisons(created_by=user)}


@router.post("/")
def create_comp(comp: ComparisonCreate, user: str = Depends(require_auth)):
    """Compare two datasets and return a full diff report."""
    dataset1 = get_dataset(comp.dataset1_id)
    dataset2 = get_dataset(comp.dataset2_id)

    if not dataset1 or not dataset2:
        raise HTTPException(404, "One or both datasets not found")

    try:
        df1 = _load_dataset_df(dataset1)
        df2 = _load_dataset_df(dataset2)
    except Exception as e:
        raise HTTPException(400, f"Failed to load datasets for comparison: {e}")

    comparison_data = _compute_comparison(df1, df2)

    comp_id = create_comparison(
        dataset1_id=comp.dataset1_id,
        dataset2_id=comp.dataset2_id,
        created_by=user,
    )

    return {
        "id": comp_id,
        "dataset1_name": dataset1.get("original_filename", comp.dataset1_id),
        "dataset2_name": dataset2.get("original_filename", comp.dataset2_id),
        "dataset1_quality": dataset1.get("quality_score"),
        "dataset2_quality": dataset2.get("quality_score"),
        "comparison": comparison_data,
    }
