from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sklearn.ensemble import IsolationForest

from app.auth import require_auth
from app.services.access_control import require_item_access
from app.services.storage import resolve_original_path
from ..db import _utc_now, get_conn, get_dataset

router = APIRouter()

class AnomalyDetectionRequest(BaseModel):
    dataset_id: str
    columns: Optional[list[str]] = None
    method: str = "statistical"  # 'statistical', 'isolation_forest', 'zscore'

def detect_statistical_anomalies(dataset_id: str, columns: list[str] = None) -> list[dict]:
    """Detect anomalies using statistical methods (z-score)."""
    detections = []
    
    # Get dataset info
    with get_conn() as conn:
        dataset = conn.execute(
            "SELECT * FROM datasets WHERE id = ?",
            (dataset_id,)
        ).fetchone()
        
        if not dataset:
            raise HTTPException(404, "Dataset not found")
        
        # Get analysis JSON which contains column statistics
        analysis_json = dataset[8] if len(dataset) > 8 else None
        
        if analysis_json:
            analysis = json.loads(analysis_json)
            column_stats = analysis.get('column_stats', {})
            
            # Check each column for anomalies based on statistics
            for col_name, stats in column_stats.items():
                if columns and col_name not in columns:
                    continue
                
                # Simple anomaly detection: check for outliers in numeric columns
                if stats.get('type') == 'numeric':
                    mean = stats.get('mean', 0)
                    std = stats.get('std', 0)
                    
                    if std > 0:
                        # Flag columns with high variance as potential anomaly sources
                        if std > mean * 0.5:  # High variance relative to mean
                            detections.append({
                                "column_name": col_name,
                                "anomaly_type": "high_variance",
                                "anomaly_value": f"std={std:.2f}, mean={mean:.2f}",
                                "confidence": min(0.9, std / (mean + std)),
                            })
    
    return detections


def detect_isolation_forest(dataset_id: str, columns: list[str] | None = None) -> list[dict]:
    path = resolve_original_path(dataset_id)
    if not path:
        raise HTTPException(404, "Dataset not found")
    df = pd.read_excel(path) if Path(path).suffix.lower() in (".xlsx", ".xls") else pd.read_csv(path)

    num_df = df.select_dtypes(include=["number"]).copy()
    if columns:
        cols = [c for c in columns if c in num_df.columns]
        num_df = num_df[cols]

    if num_df.shape[1] == 0 or len(num_df) < 10:
        return []

    num_df = num_df.replace([np.inf, -np.inf], np.nan).dropna()
    if len(num_df) < 10:
        return []

    model = IsolationForest(n_estimators=200, contamination="auto", random_state=42)
    preds = model.fit_predict(num_df)
    scores = model.decision_function(num_df)

    # Flag top anomalies
    anomaly_idx = np.where(preds == -1)[0]
    detections: list[dict] = []
    for i in anomaly_idx[:50]:
        # pick the most "responsible" column via z-score magnitude
        row = num_df.iloc[i]
        z = ((row - num_df.mean()) / (num_df.std(ddof=0) + 1e-9)).abs()
        col = str(z.sort_values(ascending=False).index[0])
        detections.append(
            {
                "column_name": col,
                "anomaly_type": "isolation_forest",
                "anomaly_value": json.dumps(row.to_dict()),
                "confidence": float(min(0.99, max(0.01, -scores[i]))),
            }
        )
    return detections

def save_anomaly_detections(dataset_id: str, detections: list[dict]) -> None:
    """Save anomaly detections to database."""
    with get_conn() as conn:
        for detection in detections:
            conn.execute(
                """
                INSERT INTO anomaly_detections 
                (dataset_id, column_name, anomaly_type, anomaly_value, confidence, detected_at)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (dataset_id, detection['column_name'], detection['anomaly_type'], 
                 str(detection.get('anomaly_value', '')), detection.get('confidence', 0.5), _utc_now())
            )

def get_anomaly_detections(dataset_id: str) -> list[dict]:
    """Get anomaly detections for a dataset."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM anomaly_detections WHERE dataset_id = ? ORDER BY detected_at DESC",
            (dataset_id,)
        ).fetchall()
        return [dict(row) for row in rows]

@router.post("/detect")
def detect_anomalies(request: AnomalyDetectionRequest, user: str = Depends(require_auth)):
    """Detect anomalies in a dataset using ML/statistical methods."""
    require_item_access(user, "dataset", request.dataset_id)
    dataset = get_dataset(request.dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset not found")
    
    if request.method == "statistical":
        detections = detect_statistical_anomalies(request.dataset_id, request.columns)
    elif request.method == "isolation_forest":
        detections = detect_isolation_forest(request.dataset_id, request.columns)
    else:
        detections = []
    
    # Save detections
    if detections:
        save_anomaly_detections(request.dataset_id, detections)
    
    return {
        "dataset_id": request.dataset_id,
        "method": request.method,
        "detections": detections,
        "count": len(detections),
    }

@router.get("/{dataset_id}")
def get_detections(dataset_id: str, user: str = Depends(require_auth)):
    """Get anomaly detections for a dataset."""
    detections = get_anomaly_detections(dataset_id)
    return {"detections": detections}

@router.delete("/{dataset_id}")
def clear_detections(dataset_id: str, user: str = Depends(require_auth)):
    """Clear anomaly detections for a dataset."""
    with get_conn() as conn:
        conn.execute("DELETE FROM anomaly_detections WHERE dataset_id = ?", (dataset_id,))
    return {"message": "Anomaly detections cleared"}
