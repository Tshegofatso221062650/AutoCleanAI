from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_auth
from app.services.quality_monitoring_service import (
    record_quality_snapshot,
    get_quality_history,
    get_quality_trend,
    get_all_quality_metrics,
    detect_quality_anomalies,
    generate_quality_report,
    suggest_quality_improvements,
)

router = APIRouter(tags=["quality"])


@router.post("/quality/snapshot")
def create_snapshot(body: dict, _: str = Depends(require_auth)):
    """Record a quality snapshot for a dataset."""
    dataset_id = body.get("dataset_id")
    analysis = body.get("analysis")
    
    if not dataset_id or not analysis:
        raise HTTPException(400, "dataset_id and analysis are required")
    
    record_quality_snapshot(dataset_id, analysis)
    return {"status": "recorded", "dataset_id": dataset_id}


@router.get("/quality/{dataset_id}/history")
def get_history(dataset_id: str, days: int = 30, _: str = Depends(require_auth)):
    """Get quality history for a dataset."""
    history = get_quality_history(dataset_id, days)
    return {"dataset_id": dataset_id, "history": history, "period_days": days}


@router.get("/quality/{dataset_id}/trend")
def get_trend(dataset_id: str, _: str = Depends(require_auth)):
    """Get quality trend analysis for a dataset."""
    trend = get_quality_trend(dataset_id)
    return {"dataset_id": dataset_id, "trend": trend}


@router.get("/quality/metrics")
def get_metrics(days: int = 30, _: str = Depends(require_auth)):
    """Get quality metrics for all datasets."""
    metrics = get_all_quality_metrics(days)
    return {"metrics": metrics, "period_days": days}


@router.get("/quality/{dataset_id}/anomalies")
def get_anomalies(dataset_id: str, threshold: float = 2.0, _: str = Depends(require_auth)):
    """Detect quality anomalies for a dataset."""
    anomalies = detect_quality_anomalies(dataset_id, threshold)
    return {"dataset_id": dataset_id, "anomalies": anomalies, "threshold": threshold}


@router.get("/quality/{dataset_id}/report")
def get_report(dataset_id: str, _: str = Depends(require_auth)):
    """Generate comprehensive quality report for a dataset."""
    report = generate_quality_report(dataset_id)
    return {"dataset_id": dataset_id, "report": report}


@router.get("/quality/{dataset_id}/suggestions")
def get_improvements(dataset_id: str, _: str = Depends(require_auth)):
    """Get quality improvement suggestions for a dataset."""
    suggestions = suggest_quality_improvements(dataset_id)
    return {"dataset_id": dataset_id, "suggestions": suggestions}
