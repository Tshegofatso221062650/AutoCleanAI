from pathlib import Path

import pandas as pd
import json
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException, Request

from app.auth import require_auth
from app.db import get_dataset, update_dataset_analysis, update_dataset_clean, create_dataset_version, get_next_version_number, create_lineage_entry, get_transformation_rule
from app.services.analysis import analyze_dataframe, quality_score_from_profile
from app.services.cleaning_engine import clean_dataframe, load_dataframe
from app.services.schema_tracker import record_schema_snapshot
from app.services.storage import exported_dir, infer_format_from_name, resolve_original_path
from app.services.transformation_engine import apply_transformation_rules
from app.services.objective_validator import validate_objectives
from app.services.quality_monitoring_service import record_quality_snapshot
from app.services.access_control import require_item_access
from app.services.security import clean_limiter
from app.services import webhook_dispatcher
from app.routers.analyze_router import invalidate_df_cache
from app.schemas import CleanRequest

router = APIRouter(tags=["clean"])


def run_clean_pipeline(body: CleanRequest) -> dict:
    path = resolve_original_path(body.dataset_id)
    if not path:
        raise HTTPException(404, "Dataset not found")
    ds = get_dataset(body.dataset_id)
    if not ds:
        raise HTTPException(404, "Dataset not found")
    fmt = ds["file_format"] or infer_format_from_name(ds["original_filename"])
    try:
        df = load_dataframe(path, fmt)
    except Exception as e:
        raise HTTPException(400, str(e)) from e

    row_count = len(df)
    fast_mode = bool(body.performance_mode) or row_count >= 100_000
    preview_limit = 20 if fast_mode else 50

    def _enrich_col_stats(profile: dict, frame: pd.DataFrame) -> dict:
        col_stats_raw: dict = {}
        category_proportions: dict = {}
        for col in frame.columns:
            s = frame[col]
            if pd.api.types.is_numeric_dtype(s):
                vals = s.dropna().astype("float64")
                if len(vals) > 0:
                    col_stats_raw[str(col)] = {
                        "mean": round(float(vals.mean()), 6),
                        "std": round(float(vals.std(ddof=0)), 6),
                        "skew": round(float(vals.skew()), 6),
                        "p25": round(float(vals.quantile(0.25)), 6),
                        "p75": round(float(vals.quantile(0.75)), 6),
                        "min": round(float(vals.min()), 6),
                        "max": round(float(vals.max()), 6),
                    }
            elif s.dtype == object and not fast_mode:
                vc = s.dropna().value_counts(normalize=True)
                top = vc.head(10)
                if len(top):
                    category_proportions[str(col)] = {str(k): round(float(v), 6) for k, v in top.items()}
        profile["column_stats_raw"] = col_stats_raw
        profile["category_proportions"] = category_proportions
        return profile

    # Single analyze pass on the raw data
    profile_before = analyze_dataframe(df)
    q_before = float(profile_before.get("quality_score") or quality_score_from_profile(profile_before))
    profile_before = _enrich_col_stats(profile_before, df)
    
    # Get data preview from original
    preview_before = df.head(preview_limit).to_dict(orient="records")
    for prow in preview_before:
        for key, value in list(prow.items()):
            if pd.isna(value) if not isinstance(value, (list, dict)) else False:
                prow[key] = None
            elif isinstance(value, (pd.Timestamp, datetime)):
                prow[key] = value.strftime("%Y-%m-%d") if isinstance(value, (pd.Timestamp, datetime)) else str(value)
            elif isinstance(value, (int, float)):
                prow[key] = float(value) if isinstance(value, float) else int(value)

    opts = body.model_dump()
    
    # Apply transformation rules if specified
    if body.transformation_rule_ids:
        all_rules = []
        for rule_id in body.transformation_rule_ids:
            rule = get_transformation_rule(rule_id)
            if rule:
                all_rules.extend(json.loads(rule["rules"]))
        if all_rules:
            df = apply_transformation_rules(df, all_rules)
    
    cleaned, report = clean_dataframe(df, opts)

    out_dir = exported_dir(body.dataset_id)
    stem = Path(ds["original_filename"]).stem
    base = out_dir / f"{stem}_cleaned"
    paths: dict[str, str] = {}

    # `clean_dataframe` already applies export preparation internally.
    export_df = cleaned

    # Excel is primary format - always required
    export_df.to_excel(base.with_suffix(".xlsx"), index=False, engine="openpyxl")
    paths["xlsx"] = str(base.with_suffix(".xlsx").resolve())

    # CSV — empty string for nulls so cells are truly blank
    try:
        export_df.to_csv(base.with_suffix(".csv"), index=False, na_rep="")
        paths["csv"] = str(base.with_suffix(".csv").resolve())
    except Exception:
        pass

    # JSON — null for missing values (not NaN literal)
    try:
        export_df.to_json(base.with_suffix(".json"), orient="records", indent=2, date_format="iso", force_ascii=False)
        paths["json"] = str(base.with_suffix(".json").resolve())
    except Exception:
        pass

    profile_after = analyze_dataframe(cleaned)
    q_after = float(profile_after.get("quality_score") or quality_score_from_profile(profile_after))

    profile_after = _enrich_col_stats(profile_after, cleaned)
    
    # Get data preview from cleaned
    preview_after = cleaned.head(preview_limit).to_dict(orient="records")
    for prow in preview_after:
        for key, value in list(prow.items()):
            if pd.isna(value) if not isinstance(value, (list, dict)) else False:
                prow[key] = None
            elif isinstance(value, (pd.Timestamp, datetime)):
                prow[key] = value.strftime("%Y-%m-%d") if isinstance(value, (pd.Timestamp, datetime)) else str(value)
            elif isinstance(value, (int, float)):
                prow[key] = float(value) if isinstance(value, float) else int(value)

    # Create dataset version
    version_number = get_next_version_number(body.dataset_id)
    create_dataset_version(
        dataset_id=body.dataset_id,
        version_number=version_number,
        file_path=str(base.with_suffix(".xlsx").resolve()),
        row_count=len(cleaned),
        quality_score=q_after,
        operation_type="clean",
        operation_details=json.dumps({"strategy": body.missing_strategy, "clip_outliers": body.clip_outliers}),
    )
    
    # Create lineage entry
    create_lineage_entry(
        dataset_id=body.dataset_id,
        operation="clean",
        operation_details=json.dumps({
            "missing_strategy": body.missing_strategy,
            "clip_outliers": body.clip_outliers,
            "outlier_method": body.outlier_method,
            "fix_missing": body.fix_missing,
            "remove_duplicates": body.remove_duplicates,
        }),
        input_columns=list(df.columns),
        output_columns=list(cleaned.columns),
        rows_affected=len(cleaned),
    )
    
    update_dataset_clean(body.dataset_id, report, paths, q_after)
    update_dataset_analysis(body.dataset_id, profile_after, q_after)
    invalidate_df_cache(body.dataset_id)   # stale cache — cleaned file has new mtime

    # Record quality snapshots for trend/anomaly detection
    try:
        record_quality_snapshot(body.dataset_id, profile_before)
        record_quality_snapshot(body.dataset_id, profile_after)
    except Exception:
        pass

    # Record schema snapshot
    record_schema_snapshot(body.dataset_id, list(cleaned.columns), "clean")

    # Validate objectives after cleaning
    objective_results = validate_objectives(body.dataset_id, q_after, profile_after)

    return {
        "dataset_id": body.dataset_id,
        "report": report,
        "export_paths": paths,
        "profile_before": profile_before,
        "profile_after": profile_after,
        "quality_score_before": q_before,
        "quality_score_after": q_after,
        "preview_before": preview_before,
        "preview_after": preview_after,
        "objective_results": objective_results,
        "performance": {
            "fast_mode": fast_mode,
            "preview_rows": preview_limit,
            "dataset_rows": row_count,
        },
    }


@router.post("/clean")
def clean(body: CleanRequest, request: Request, user: str = Depends(require_auth)):
    if not clean_limiter.allow(user):
        raise HTTPException(429, "Too many clean requests — please wait a moment")
    require_item_access(user, "dataset", body.dataset_id)
    result = run_clean_pipeline(body)
    webhook_dispatcher.on_dataset_cleaned(body.dataset_id, result.get("quality_score_after"), user)
    return result


@router.post("/clean/safe-all")
def clean_safe_all(body: CleanRequest, request: Request, user: str = Depends(require_auth)):
    if not clean_limiter.allow(user):
        raise HTTPException(429, "Too many clean requests — please wait a moment")
    require_item_access(user, "dataset", body.dataset_id)
    """One-click: conservative defaults (no outlier clipping)."""
    body.clip_outliers = False
    body.remove_duplicates = True
    body.fix_missing = True
    body.missing_strategy = "median"
    body.coerce_types = True
    body.normalize_strings = True
    body.fix_typos = True
    body.validate_emails = True
    body.fuzzy_threshold = 0  # disable O(n²) fuzzy dedup in one-click mode
    body.min_transform_confidence = max(float(body.min_transform_confidence or 0.0), 0.75)
    body.quarantine_on_schema_failure = True
    return run_clean_pipeline(body)
