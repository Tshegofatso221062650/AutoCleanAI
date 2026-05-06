import os
from collections import OrderedDict
from threading import Lock

from fastapi import APIRouter, Depends, HTTPException, Query
import pandas as pd
from datetime import datetime
from typing import Optional

from app.auth import require_auth
from app.db import get_dataset, update_dataset_analysis
from app.services.analysis import analyze_dataframe, histogram_data, quality_score_from_profile, get_duplicate_mask
from app.services.cleaning_engine import load_dataframe, run_great_expectations_smoke
from app.services.storage import infer_format_from_name, resolve_original_path
from app.services.access_control import require_item_access
from app.services import webhook_dispatcher
from app.schemas import AnalyzeRequest

# ---------------------------------------------------------------------------
# In-process DataFrame cache — avoids re-reading the file on every page flip.
# Keyed on (dataset_id, file_mtime) so a new upload/clean automatically
# invalidates the old entry.
# ---------------------------------------------------------------------------
_DF_CACHE_MAX = 10
_df_cache: "OrderedDict[tuple, tuple[pd.DataFrame, pd.Series]]" = OrderedDict()
_df_lock = Lock()


def _get_cached_df(dataset_id: str, path: str, fmt: str) -> tuple[pd.DataFrame, pd.Series]:
    """Return (DataFrame, dup_mask) from cache; load from disk on miss."""
    try:
        mtime = os.path.getmtime(path)
    except OSError:
        mtime = 0.0
    key = (dataset_id, mtime)
    with _df_lock:
        if key in _df_cache:
            _df_cache.move_to_end(key)          # LRU refresh
            return _df_cache[key]
        # evict all stale entries for this dataset_id
        stale = [k for k in _df_cache if k[0] == dataset_id]
        for k in stale:
            del _df_cache[k]
    # Load outside the lock so other threads aren't blocked
    df = load_dataframe(path, fmt)
    dup_mask = get_duplicate_mask(df)
    with _df_lock:
        _df_cache[key] = (df, dup_mask)
        _df_cache.move_to_end(key)
        while len(_df_cache) > _DF_CACHE_MAX:
            _df_cache.popitem(last=False)        # evict least-recently-used
    return df, dup_mask


def invalidate_df_cache(dataset_id: str) -> None:
    """Call this after upload / clean to force a fresh read on next request."""
    with _df_lock:
        stale = [k for k in _df_cache if k[0] == dataset_id]
        for k in stale:
            del _df_cache[k]

router = APIRouter(tags=["analyze"])


@router.post("/analyze")
def analyze(body: AnalyzeRequest, user: str = Depends(require_auth)):
    require_item_access(user, "dataset", body.dataset_id)
    path = resolve_original_path(body.dataset_id)
    if not path:
        raise HTTPException(404, "Dataset not found")
    row = get_dataset(body.dataset_id)
    if not row:
        raise HTTPException(404, "Dataset not found")
    fmt = row["file_format"] or infer_format_from_name(row["original_filename"])
    try:
        df = load_dataframe(path, fmt)
    except Exception as e:
        raise HTTPException(400, str(e)) from e

    profile = analyze_dataframe(df)
    ge = run_great_expectations_smoke(df)
    if ge:
        profile["great_expectations"] = ge

    q = float(profile.get("quality_score") or quality_score_from_profile(profile))
    update_dataset_analysis(body.dataset_id, profile, q)

    # Data preview (first 5 rows) — tag duplicates across the full dataset
    dup_mask = get_duplicate_mask(df)
    preview_df = df.head(5)
    preview_dup_flags = dup_mask.iloc[:5].tolist()
    preview_data = preview_df.to_dict(orient="records")
    for i, row in enumerate(preview_data):
        for key, value in list(row.items()):
            if pd.isna(value):
                row[key] = None
            elif isinstance(value, (pd.Timestamp, datetime)):
                row[key] = str(value)
            elif isinstance(value, (int, float)):
                row[key] = float(value) if isinstance(value, float) else int(value)
        row["_is_duplicate"] = bool(preview_dup_flags[i])

    # chart-friendly payloads
    missing_chart = [
        {"column": str(k), "missing": int(v)}
        for k, v in sorted(
            (profile.get("missing_per_column") or {}).items(),
            key=lambda x: -x[1],
        )[:25]
    ]
    hist = None
    for c in profile.get("numeric_columns") or []:
        h = histogram_data(df, c, bins=24)
        if h:
            hist = h
            break

    # Data type distribution for pie chart
    dtype_dist = [
        {"type": dtype, "count": sum(1 for c in profile.get("dtypes", {}).values() if c == dtype)}
        for dtype in set(profile.get("dtypes", {}).values())
    ]

    result = {
        "dataset_id": body.dataset_id,
        "profile": profile,
        "preview": preview_data,
        "charts": {
            "missing_by_column": missing_chart,
            "histogram": hist,
            "correlation": profile.get("correlation_matrix"),
            "dtypes_distribution": dtype_dist,
        },
    }
    webhook_dispatcher.on_dataset_analyzed(body.dataset_id, q, user)
    return result


@router.get("/datasets/{dataset_id}/rows")
def get_rows(
    dataset_id: str,
    page: int = Query(1, ge=1),
    page_size: int = Query(100, ge=1, le=500),
    search: Optional[str] = Query(None),
    sort_by: Optional[str] = Query(None),
    sort_dir: str = Query("asc", pattern="^(asc|desc)$"),
    user: str = Depends(require_auth),
):
    """Return paginated rows from a dataset file."""
    require_item_access(user, "dataset", dataset_id)
    path = resolve_original_path(dataset_id)
    if not path:
        raise HTTPException(404, "Dataset file not found")
    row_meta = get_dataset(dataset_id)
    if not row_meta:
        raise HTTPException(404, "Dataset not found")
    fmt = row_meta["file_format"] or infer_format_from_name(row_meta["original_filename"])
    try:
        df, dup_mask = _get_cached_df(dataset_id, str(path), fmt)
    except Exception as e:
        raise HTTPException(400, str(e)) from e

    columns = list(df.columns)

    # dup_mask already computed over full dataset by the cache layer

    # Global search across all string columns
    if search and search.strip():
        mask = df.apply(lambda col: col.astype(str).str.contains(search.strip(), case=False, na=False)).any(axis=1)
        df = df[mask]
        dup_mask = dup_mask[df.index]

    # Sort
    if sort_by and sort_by in df.columns:
        df = df.sort_values(by=sort_by, ascending=(sort_dir == "asc"), na_position="last")
        dup_mask = dup_mask[df.index]

    total_rows = len(df)
    total_pages = max(1, -(-total_rows // page_size))  # ceiling division
    start = (page - 1) * page_size
    end = start + page_size
    page_df = df.iloc[start:end]
    page_dup = dup_mask.iloc[start:end].tolist()

    # Serialise to list-of-dicts, converting NaN/Timestamp safely
    records = []
    for i, record in enumerate(page_df.to_dict(orient="records")):
        clean = {}
        for k, v in record.items():
            if pd.isna(v) if not isinstance(v, (list, dict)) else False:
                clean[k] = None
            elif isinstance(v, (pd.Timestamp, datetime)):
                clean[k] = str(v)
            elif isinstance(v, float):
                clean[k] = round(v, 6)
            else:
                clean[k] = v
        clean["_is_duplicate"] = bool(page_dup[i])
        records.append(clean)

    return {
        "columns": columns,
        "rows": records,
        "total_rows": total_rows,
        "total_pages": total_pages,
        "page": page,
        "page_size": page_size,
    }
