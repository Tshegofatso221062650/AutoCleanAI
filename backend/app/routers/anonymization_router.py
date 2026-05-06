from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Optional

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import require_auth
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
from app.services.schema_tracker import record_schema_snapshot
from app.services.storage import exported_dir
from app.services.access_control import require_item_access

router = APIRouter()

class AnonymizationRequest(BaseModel):
    dataset_id: str
    pii_types: Optional[list[str]] = None  # 'email', 'phone', 'ssn', 'credit_card', 'address'

class MaskingRequest(BaseModel):
    dataset_id: str
    column_name: str
    masking_method: str  # 'hash', 'replace', 'partial'
    replacement: Optional[str] = None

# Simple PII detection patterns
PII_PATTERNS = {
    'email': r'\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b',
    'phone': r'\b\d{3}[-.]?\d{3}[-.]?\d{4}\b',
    'ssn': r'\b\d{3}[-.]?\d{2}[-.]?\d{4}\b',
    'credit_card': r'\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b',
}

def detect_pii_in_dataset(dataset_id: str, pii_types: list[str] = None) -> list[dict]:
    """Detect PII in a dataset."""
    detections = []
    
    # Get dataset info
    with get_conn() as conn:
        dataset = conn.execute(
            "SELECT * FROM datasets WHERE id = ?",
            (dataset_id,)
        ).fetchone()
        
        if not dataset:
            raise HTTPException(404, "Dataset not found")
        
        # Get analysis JSON which contains column info
        analysis_json = dataset[8] if len(dataset) > 8 else None
        
        if analysis_json:
            import json
            analysis = json.loads(analysis_json)
            columns = analysis.get('column_names', [])
            
            # Check each column for PII patterns (simplified)
            for col in columns:
                col_lower = col.lower()
                detected_types = []
                
                if not pii_types or 'email' in pii_types:
                    if 'email' in col_lower or 'mail' in col_lower:
                        detected_types.append('email')
                
                if not pii_types or 'phone' in pii_types:
                    if 'phone' in col_lower or 'mobile' in col_lower or 'tel' in col_lower:
                        detected_types.append('phone')
                
                if not pii_types or 'ssn' in pii_types:
                    if 'ssn' in col_lower or 'social' in col_lower:
                        detected_types.append('ssn')
                
                if not pii_types or 'credit_card' in pii_types:
                    if 'card' in col_lower or 'credit' in col_lower:
                        detected_types.append('credit_card')
                
                if detected_types:
                    for pii_type in detected_types:
                        detections.append({
                            "column_name": col,
                            "pii_type": pii_type,
                            "detection_method": "column_name_pattern",
                        })
    
    return detections

def save_pii_detections(dataset_id: str, detections: list[dict]) -> None:
    """Save PII detections to database."""
    with get_conn() as conn:
        for detection in detections:
            conn.execute(
                """
                INSERT INTO pii_detections 
                (dataset_id, column_name, pii_type, detection_method, detected_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (dataset_id, detection['column_name'], detection['pii_type'], 
                 detection['detection_method'], _utc_now())
            )

def get_pii_detections(dataset_id: str) -> list[dict]:
    """Get PII detections for a dataset."""
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM pii_detections WHERE dataset_id = ? ORDER BY detected_at DESC",
            (dataset_id,)
        ).fetchall()
        return [dict(row) for row in rows]

@router.post("/detect")
def detect_pii(request: AnonymizationRequest, user: str = Depends(require_auth)):
    """Detect PII in a dataset."""
    require_item_access(user, "dataset", request.dataset_id)
    dataset = get_dataset(request.dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset not found")
    
    detections = detect_pii_in_dataset(request.dataset_id, request.pii_types)
    
    # Save detections
    if detections:
        save_pii_detections(request.dataset_id, detections)
    
    return {
        "dataset_id": request.dataset_id,
        "detections": detections,
        "count": len(detections),
    }

@router.get("/{dataset_id}")
def get_detections(dataset_id: str, user: str = Depends(require_auth)):
    """Get PII detections for a dataset."""
    require_item_access(user, "dataset", dataset_id)
    detections = get_pii_detections(dataset_id)
    return {"detections": detections}

@router.post("/mask")
def mask_pii(request: MaskingRequest, user: str = Depends(require_auth)):
    """Mask PII in a column and create a new dataset version."""
    require_item_access(user, "dataset", request.dataset_id)
    dataset = get_dataset(request.dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset not found")

    method = (request.masking_method or "replace").lower()
    if method not in ("hash", "replace", "partial"):
        raise HTTPException(400, "masking_method must be hash, replace, or partial")

    # Prefer the latest version file if present; otherwise use current export xlsx; otherwise original.
    active_path: Path
    latest = get_latest_version(request.dataset_id)
    if latest and latest.get("file_path"):
        active_path = Path(latest["file_path"])
    else:
        paths = json.loads(dataset["export_paths"]) if dataset.get("export_paths") else {}
        active_path = Path(paths.get("xlsx") or dataset["stored_path"])

    if not active_path.exists():
        raise HTTPException(404, "Active dataset file not found")

    suffix = active_path.suffix.lower()
    if suffix == ".csv":
        df = pd.read_csv(active_path)
    elif suffix in (".xlsx", ".xls"):
        df = pd.read_excel(active_path)
    elif suffix == ".json":
        df = pd.read_json(active_path)
    else:
        raise HTTPException(400, f"Unsupported dataset file format: {suffix}")

    if request.column_name not in df.columns:
        raise HTTPException(400, "column_name not found in dataset")

    repl = request.replacement if request.replacement is not None else "***"

    def _mask_value(v: object) -> object:
        if pd.isna(v):
            return v
        s = str(v)
        if method == "replace":
            return repl
        if method == "partial":
            if len(s) <= 4:
                return repl
            return f"{repl}{s[-4:]}"
        # hash
        return hashlib.sha256(s.encode("utf-8")).hexdigest()

    df[request.column_name] = df[request.column_name].map(_mask_value)

    # Save masked outputs
    stem = Path(dataset["original_filename"]).stem
    next_v = get_next_version_number(request.dataset_id)
    out_dir = exported_dir(request.dataset_id)
    base = out_dir / f"{stem}_masked_v{next_v}"

    export_paths: dict[str, str] = {}
    df.to_excel(base.with_suffix(".xlsx"), index=False, engine="openpyxl")
    export_paths["xlsx"] = str(base.with_suffix(".xlsx").resolve())
    try:
        df.to_csv(base.with_suffix(".csv"), index=False)
        export_paths["csv"] = str(base.with_suffix(".csv").resolve())
    except Exception:
        pass
    try:
        df.to_json(base.with_suffix(".json"), orient="records", indent=2, date_format="iso")
        export_paths["json"] = str(base.with_suffix(".json").resolve())
    except Exception:
        pass

    profile = analyze_dataframe(df)
    q = float(profile.get("quality_score") or quality_score_from_profile(profile))

    update_dataset_clean(
        request.dataset_id,
        {
            "operation": "mask",
            "column": request.column_name,
            "method": method,
        },
        export_paths,
        q,
    )
    update_dataset_analysis(request.dataset_id, profile, q)

    create_dataset_version(
        dataset_id=request.dataset_id,
        version_number=next_v,
        file_path=export_paths["xlsx"],
        row_count=len(df),
        quality_score=q,
        operation_type="mask",
        operation_details=json.dumps({"column": request.column_name, "method": method}),
        parent_version_id=latest.get("id") if latest else None,
    )

    record_schema_snapshot(request.dataset_id, list(df.columns), "mask")

    return {
        "dataset_id": request.dataset_id,
        "column_name": request.column_name,
        "masking_method": method,
        "export_paths": export_paths,
        "quality_score": q,
        "message": "Masking completed",
    }
