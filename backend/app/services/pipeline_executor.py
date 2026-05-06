"""Shared pipeline execution service used by both the pipeline router and the scheduler."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd

from app.db import (
    create_dataset_version,
    create_lineage_entry,
    create_pipeline_run,
    get_dataset,
    get_pipeline,
    get_transformation_rule,
    increment_pipeline_usage,
    get_next_version_number,
    update_dataset_analysis,
    update_dataset_clean,
    update_pipeline_run,
    get_conn,
)
from app.services.analysis import analyze_dataframe, quality_score_from_profile
from app.services.cleaning_engine import clean_dataframe, load_dataframe
from app.services.consolidation_service import consolidate_datasets, get_group_datasets
from app.services.storage import exported_dir, infer_format_from_name, resolve_original_path
from app.services.transformation_engine import apply_transformation_rules


def execute_pipeline(pipeline_id: int, dataset_id: str) -> dict[str, Any]:
    """
    Run a pipeline on a dataset and persist all artefacts.
    Returns a result dict. Raises ValueError on logical errors,
    RuntimeError on execution failures — no HTTPException so it can be
    called safely from background threads (scheduler).
    """
    pipeline = get_pipeline(pipeline_id)
    if not pipeline:
        raise ValueError(f"Pipeline {pipeline_id} not found")

    path = resolve_original_path(dataset_id)
    if not path:
        raise ValueError(f"Dataset {dataset_id} not found on disk")

    row = get_dataset(dataset_id)
    if not row:
        raise ValueError(f"Dataset {dataset_id} not in database")

    fmt = row["file_format"] or infer_format_from_name(row["original_filename"])
    df = load_dataframe(path, fmt)

    steps: list[dict] = json.loads(pipeline["steps"] or "[]")

    opts: dict[str, Any] = {
        "fix_missing": False,
        "missing_strategy": "median",
        "remove_duplicates": False,
        "coerce_types": False,
        "normalize_strings": False,
        "fix_typos": False,
        "clip_outliers": False,
        "outlier_method": "iqr",
        "validate_emails": False,
        "validate_age_min": 0,
        "validate_age_max": 120,
        "custom_rules": [],
        "safe_mode": True,
    }

    for step in steps:
        if not step.get("enabled", True):
            continue
        step_type = step.get("step_type", "")
        params = step.get("params", {})

        if step_type == "fix_missing":
            opts["fix_missing"] = True
            opts["missing_strategy"] = params.get("strategy", "median")
        elif step_type == "remove_duplicates":
            opts["remove_duplicates"] = True
        elif step_type == "coerce_types":
            opts["coerce_types"] = True
        elif step_type == "normalize_strings":
            opts["normalize_strings"] = True
        elif step_type == "fix_typos":
            opts["fix_typos"] = True
        elif step_type == "clip_outliers":
            opts["clip_outliers"] = True
            opts["outlier_method"] = params.get("method", "iqr")
        elif step_type == "validate_emails":
            opts["validate_emails"] = True
        elif step_type == "transformation_rule":
            rule_id = step.get("transformation_rule_id")
            if rule_id:
                rule = get_transformation_rule(rule_id)
                if rule:
                    df = apply_transformation_rules(df, json.loads(rule["rules"]))
        elif step_type == "consolidation":
            group_id = step.get("consolidation_group_id")
            if group_id:
                try:
                    group_datasets = get_group_datasets(group_id)
                    if group_datasets:
                        merged, _ = consolidate_datasets(group_id, params.get("merge_strategy", "concat"))
                        df = merged
                except Exception as exc:
                    print(f"[pipeline_executor] consolidation step failed: {exc}")

    run_id = create_pipeline_run(pipeline_id, dataset_id)
    increment_pipeline_usage(pipeline_id)

    try:
        cleaned, report = clean_dataframe(df, opts)

        out_dir = exported_dir(dataset_id)
        stem = Path(row["original_filename"]).stem
        base = out_dir / f"{stem}_pipeline_{pipeline_id}_cleaned"
        paths: dict[str, str] = {}
        cleaned.to_excel(base.with_suffix(".xlsx"), index=False, engine="openpyxl")
        paths["xlsx"] = str(base.with_suffix(".xlsx").resolve())

        profile_after = analyze_dataframe(cleaned)
        q_after = float(profile_after.get("quality_score") or quality_score_from_profile(profile_after))

        version_number = get_next_version_number(dataset_id)
        create_dataset_version(
            dataset_id=dataset_id,
            version_number=version_number,
            file_path=paths["xlsx"],
            row_count=len(cleaned),
            quality_score=q_after,
            operation_type="pipeline",
            operation_details=json.dumps({"pipeline_id": pipeline_id, "pipeline_name": pipeline["name"]}),
        )

        create_lineage_entry(
            dataset_id=dataset_id,
            operation="pipeline_run",
            operation_details=json.dumps({
                "pipeline_id": pipeline_id,
                "pipeline_name": pipeline["name"],
                "steps_executed": len([s for s in steps if s.get("enabled", True)]),
            }),
            input_columns=list(df.columns),
            output_columns=list(cleaned.columns),
            rows_affected=len(cleaned),
        )

        update_dataset_clean(dataset_id, report, paths, q_after)
        update_dataset_analysis(dataset_id, profile_after, q_after)
        update_pipeline_run(run_id, "completed")

        return {
            "run_id": run_id,
            "report": report,
            "export_paths": paths,
            "quality_score": q_after,
        }
    except Exception as exc:
        update_pipeline_run(run_id, "failed", str(exc))
        raise RuntimeError(f"Pipeline execution failed: {exc}") from exc
