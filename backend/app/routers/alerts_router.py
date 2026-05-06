from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional
from ..db import get_conn, _utc_now
from ..auth import require_auth

router = APIRouter()

class AlertCreate(BaseModel):
    name: str
    alert_type: str  # 'quality_below', 'missing_above', 'duplicate_above'
    threshold_value: float
    metric_type: str  # 'quality_score', 'missing_pct', 'duplicate_pct'

class AlertUpdate(BaseModel):
    name: Optional[str] = None
    alert_type: Optional[str] = None
    threshold_value: Optional[float] = None
    metric_type: Optional[str] = None
    is_active: Optional[bool] = None

def get_alerts(created_by: str = None) -> list[dict]:
    with get_conn() as conn:
        if created_by:
            rows = conn.execute(
                "SELECT * FROM quality_alerts WHERE created_by = ? ORDER BY created_at DESC",
                (created_by,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM quality_alerts ORDER BY created_at DESC"
            ).fetchall()
        return [dict(row) for row in rows]

def get_alert(alert_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM quality_alerts WHERE id = ?",
            (alert_id,)
        ).fetchone()
        return dict(row) if row else None

def create_alert(
    name: str,
    alert_type: str,
    threshold_value: float,
    metric_type: str,
    created_by: str = None,
) -> int:
    with get_conn() as conn:
        cursor = conn.execute(
            """
            INSERT INTO quality_alerts 
            (name, alert_type, threshold_value, metric_type, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (name, alert_type, threshold_value, metric_type, created_by, _utc_now())
        )
        return cursor.lastrowid

def update_alert(
    alert_id: int,
    name: str = None,
    alert_type: str = None,
    threshold_value: float = None,
    metric_type: str = None,
    is_active: bool = None,
) -> None:
    with get_conn() as conn:
        updates = []
        values = []
        
        if name is not None:
            updates.append("name = ?")
            values.append(name)
        if alert_type is not None:
            updates.append("alert_type = ?")
            values.append(alert_type)
        if threshold_value is not None:
            updates.append("threshold_value = ?")
            values.append(threshold_value)
        if metric_type is not None:
            updates.append("metric_type = ?")
            values.append(metric_type)
        if is_active is not None:
            updates.append("is_active = ?")
            values.append(is_active)
        
        values.append(alert_id)
        conn.execute(
            f"UPDATE quality_alerts SET {', '.join(updates)} WHERE id = ?",
            values
        )

def delete_alert(alert_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM quality_alerts WHERE id = ?", (alert_id,))

@router.get("/")
def list_alerts(user: str = Depends(require_auth)):
    """List all quality alerts."""
    alerts = get_alerts(created_by=user)
    return {"alerts": alerts}

@router.get("/{alert_id}")
def get_alert_endpoint(alert_id: int, user: str = Depends(require_auth)):
    """Get a specific alert."""
    alert = get_alert(alert_id)
    if not alert:
        raise HTTPException(404, "Alert not found")
    if alert.get("created_by") != user and user != "owner":
        raise HTTPException(403, "Access denied")
    return alert

@router.post("/")
def create_alert_endpoint(alert: AlertCreate, user: str = Depends(require_auth)):
    """Create a new quality alert."""
    alert_id = create_alert(
        name=alert.name,
        alert_type=alert.alert_type,
        threshold_value=alert.threshold_value,
        metric_type=alert.metric_type,
        created_by=user,
    )
    created = get_alert(alert_id)
    if not created:
        raise HTTPException(500, "Failed to create alert")
    return {"id": alert_id, **created}

@router.put("/{alert_id}")
def update_alert_endpoint(alert_id: int, update: AlertUpdate, user: str = Depends(require_auth)):
    """Update a quality alert."""
    alert = get_alert(alert_id)
    if not alert:
        raise HTTPException(404, "Alert not found")
    if alert.get("created_by") != user and user != "owner":
        raise HTTPException(403, "Access denied")
    update_alert(
        alert_id,
        name=update.name,
        alert_type=update.alert_type,
        threshold_value=update.threshold_value,
        metric_type=update.metric_type,
        is_active=update.is_active,
    )
    
    updated = get_alert(alert_id)
    return updated

@router.delete("/{alert_id}")
def delete_alert_endpoint(alert_id: int, user: str = Depends(require_auth)):
    """Delete a quality alert."""
    alert = get_alert(alert_id)
    if not alert:
        raise HTTPException(404, "Alert not found")
    if alert.get("created_by") != user and user != "owner":
        raise HTTPException(403, "Access denied")
    delete_alert(alert_id)
    return {"message": "Alert deleted successfully"}
