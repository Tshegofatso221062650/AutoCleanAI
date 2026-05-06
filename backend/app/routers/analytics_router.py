"""Analytics router for advanced dashboard metrics."""
from fastapi import APIRouter, Depends

from app.auth import require_auth
from app.db import (
    list_history, list_history_lite,
    get_dataset_versions, get_data_lineage, get_data_lineage_batch,
    list_pipelines, list_transformation_rules,
    get_pipeline_runs, get_pipeline_runs_batch,
    get_dataset_objectives, get_objectives_for_datasets,
)
from app.services.quality_monitoring_service import (
    get_quality_history, get_quality_trend, detect_quality_anomalies,
    generate_quality_report, suggest_quality_improvements, detect_distribution_shift,
)

router = APIRouter(tags=["analytics"])


@router.get("/analytics/overview")
def get_overview(user: str = Depends(require_auth)):
    """Get overview analytics for the dashboard."""
    # list_history_lite omits JSON blobs — much smaller payload
    datasets = list_history_lite(limit=1000, user=user)

    total_datasets = len(datasets)
    total_rows = sum(d.get("row_count") or 0 for d in datasets)
    quality_scores = [d["quality_score"] for d in datasets if d.get("quality_score")]
    avg_quality = sum(quality_scores) / len(quality_scores) if quality_scores else 0
    cleaned_count = sum(1 for d in datasets if d.get("last_cleaned_at"))

    pipelines = list_pipelines(created_by=user)
    rules = list_transformation_rules(created_by=user)

    # Single batch query instead of one query per pipeline
    pipeline_ids = [p["id"] for p in pipelines]
    pipeline_runs = get_pipeline_runs_batch(pipeline_ids)

    total_runs = len(pipeline_runs)
    successful_runs = sum(1 for r in pipeline_runs if r.get("status") == "completed")
    success_rate = (successful_runs / total_runs * 100) if total_runs > 0 else 0

    return {
        "total_datasets": total_datasets,
        "total_rows": total_rows,
        "average_quality_score": round(avg_quality, 2),
        "cleaned_datasets": cleaned_count,
        "pipeline_count": len(pipelines),
        "rule_set_count": len(rules),
        "pipeline_success_rate": round(success_rate, 2),
        "avg_quality_improvement": 0,
        "total_pipeline_runs": total_runs,
    }


@router.get("/analytics/quality-trends")
def get_quality_trends(user: str = Depends(require_auth), limit: int = 1000):
    """Get quality score trends over time."""
    datasets = list_history_lite(limit=limit, user=user)

    trends = []
    for d in datasets:
        if d.get("quality_score") and d.get("last_analyzed_at"):
            trends.append({
                "dataset_id": d["id"],
                "filename": d["original_filename"],
                "quality_score": d["quality_score"],
                "analyzed_at": d["last_analyzed_at"],
            })
    
    return {"trends": sorted(trends, key=lambda x: x["analyzed_at"], reverse=True)}


@router.get("/analytics/pipeline-usage")
def get_pipeline_usage(user: str = Depends(require_auth)):
    """Get pipeline usage statistics."""
    pipelines = list_pipelines(created_by=user)
    
    usage_stats = []
    for p in pipelines:
        usage_stats.append({
            "pipeline_id": p["id"],
            "name": p["name"],
            "usage_count": p.get("usage_count", 0),
            "is_template": p["is_template"],
            "created_at": p["created_at"],
        })
    
    return {"pipeline_usage": sorted(usage_stats, key=lambda x: x["usage_count"], reverse=True)}


@router.get("/analytics/operation-stats")
def get_operation_stats(user: str = Depends(require_auth)):
    """Get statistics about cleaning operations."""
    datasets = list_history_lite(limit=1000, user=user)

    stats: dict = {
        "total_cleaning_operations": 0,
        "operations_by_type": {},
        "quality_improvements": [],
    }

    cleaned_ids = [d["id"] for d in datasets if d.get("last_cleaned_at")]
    stats["total_cleaning_operations"] = len(cleaned_ids)

    # Single batch query instead of one query per cleaned dataset
    all_lineage = get_data_lineage_batch(cleaned_ids)
    for entries in all_lineage.values():
        for entry in entries:
            op_type = entry.get("operation", "unknown")
            stats["operations_by_type"][op_type] = stats["operations_by_type"].get(op_type, 0) + 1

    return stats


@router.get("/analytics/dataset/{dataset_id}/quality-history")
def dataset_quality_history(dataset_id: str, days: int = 90, user: str = Depends(require_auth)):
    """Get quality snapshot history for a specific dataset."""
    return {"history": get_quality_history(dataset_id, days=days)}


@router.get("/analytics/dataset/{dataset_id}/quality-trend")
def dataset_quality_trend(dataset_id: str, user: str = Depends(require_auth)):
    """Get quality trend (improving / stable / degrading) for a dataset."""
    return get_quality_trend(dataset_id)


@router.get("/analytics/dataset/{dataset_id}/anomalies")
def dataset_anomalies(dataset_id: str, threshold: float = 2.0, user: str = Depends(require_auth)):
    """Detect statistical anomalies in quality history using z-score."""
    return {"anomalies": detect_quality_anomalies(dataset_id, threshold=threshold)}


@router.get("/analytics/dataset/{dataset_id}/quality-report")
def dataset_quality_report(dataset_id: str, user: str = Depends(require_auth)):
    """Full quality report: trend + anomalies + improvement suggestions."""
    report = generate_quality_report(dataset_id)
    report["suggestions"] = suggest_quality_improvements(dataset_id)
    return report


@router.get("/analytics/dataset/{dataset_id}/distribution-shift")
def dataset_distribution_shift(
    dataset_id: str,
    proportion_threshold: float = 0.10,
    user: str = Depends(require_auth),
):
    """
    Detect distribution and category-proportion shifts across quality snapshots.
    Returns per-column alerts sorted by severity.
    proportion_threshold: minimum proportion change (0–1) to flag a category shift.
    """
    alerts = detect_distribution_shift(
        dataset_id, proportion_shift_threshold=proportion_threshold
    )
    return {
        "dataset_id": dataset_id,
        "alerts": alerts,
        "alert_count": len(alerts),
        "high_severity": sum(1 for a in alerts if a["severity"] == "high"),
        "medium_severity": sum(1 for a in alerts if a["severity"] == "medium"),
    }


@router.get("/analytics/objective-completion")
def get_objective_completion(user: str = Depends(require_auth)):
    """Get objective completion statistics."""
    datasets = list_history_lite(limit=1000)
    dataset_ids = [d["id"] for d in datasets]

    # Single batch query instead of one query per dataset
    all_objectives = get_objectives_for_datasets(dataset_ids)

    total_objectives = 0
    completed_objectives = 0
    failed_objectives = 0
    pending_objectives = 0
    objective_type_stats: dict = {}

    for objs in all_objectives.values():
        for obj in objs:
            total_objectives += 1
            status = obj.get("status", "pending")
            obj_type = obj.get("objective_type", "unknown")
            bucket = objective_type_stats.setdefault(
                obj_type, {"total": 0, "completed": 0, "failed": 0, "pending": 0}
            )
            bucket["total"] += 1
            if status == "completed":
                completed_objectives += 1
                bucket["completed"] += 1
            elif status == "failed":
                failed_objectives += 1
                bucket["failed"] += 1
            else:
                pending_objectives += 1
                bucket["pending"] += 1

    completion_rate = (completed_objectives / total_objectives * 100) if total_objectives > 0 else 0

    return {
        "total_objectives": total_objectives,
        "completed_objectives": completed_objectives,
        "failed_objectives": failed_objectives,
        "pending_objectives": pending_objectives,
        "completion_rate": round(completion_rate, 2),
        "objective_type_stats": objective_type_stats,
    }
