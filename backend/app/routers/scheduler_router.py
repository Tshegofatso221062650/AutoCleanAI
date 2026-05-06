from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from datetime import datetime, timedelta
from ..db import get_conn, _utc_now
from ..auth import require_auth

router = APIRouter()

class ScheduledJobCreate(BaseModel):
    name: str
    pipeline_id: int
    dataset_id: Optional[str] = None
    schedule_type: str  # 'daily', 'weekly', 'monthly', 'cron'
    schedule_value: str  # e.g., '09:00' for daily, 'Monday 09:00' for weekly, '15 09:00' for monthly

class ScheduledJobUpdate(BaseModel):
    name: Optional[str] = None
    dataset_id: Optional[str] = None
    schedule_type: Optional[str] = None
    schedule_value: Optional[str] = None
    is_active: Optional[bool] = None

def get_scheduled_jobs(created_by: str = None) -> list[dict]:
    with get_conn() as conn:
        if created_by:
            rows = conn.execute(
                """SELECT * FROM scheduled_jobs WHERE created_by = ? ORDER BY next_run_at ASC""",
                (created_by,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM scheduled_jobs ORDER BY next_run_at ASC"
            ).fetchall()
        return [dict(row) for row in rows]

def get_scheduled_job(job_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM scheduled_jobs WHERE id = ?",
            (job_id,)
        ).fetchone()
        return dict(row) if row else None

def create_scheduled_job(
    name: str,
    pipeline_id: int,
    schedule_type: str,
    schedule_value: str,
    created_by: str = None,
    dataset_id: str = None,
) -> int:
    now = _utc_now()
    next_run = calculate_next_run(schedule_type, schedule_value, now)

    with get_conn() as conn:
        cursor = conn.execute(
            """
            INSERT INTO scheduled_jobs
            (name, pipeline_id, dataset_id, schedule_type, schedule_value, next_run_at, is_active, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
            """,
            (name, pipeline_id, dataset_id, schedule_type, schedule_value, next_run, created_by, now, now)
        )
        return cursor.lastrowid

def update_scheduled_job(
    job_id: int,
    name: str = None,
    schedule_type: str = None,
    schedule_value: str = None,
    is_active: bool = None,
    dataset_id: str = None,
) -> None:
    with get_conn() as conn:
        updates = []
        values = []

        if name is not None:
            updates.append("name = ?")
            values.append(name)
        if dataset_id is not None:
            updates.append("dataset_id = ?")
            values.append(dataset_id)
        if schedule_type is not None:
            updates.append("schedule_type = ?")
            values.append(schedule_type)
        if schedule_value is not None:
            updates.append("schedule_value = ?")
            values.append(schedule_value)
        if is_active is not None:
            updates.append("is_active = ?")
            values.append(is_active)
        
        # Recalculate next run if schedule changed
        if schedule_type is not None or schedule_value is not None:
            job = get_scheduled_job(job_id)
            if job:
                next_run = calculate_next_run(
                    schedule_type or job['schedule_type'],
                    schedule_value or job['schedule_value'],
                    _utc_now()
                )
                updates.append("next_run_at = ?")
                values.append(next_run)
        
        updates.append("updated_at = ?")
        values.append(_utc_now())
        values.append(job_id)
        
        conn.execute(
            f"UPDATE scheduled_jobs SET {', '.join(updates)} WHERE id = ?",
            values
        )

def delete_scheduled_job(job_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM scheduled_jobs WHERE id = ?", (job_id,))

def calculate_next_run(schedule_type: str, schedule_value: str, from_time: str) -> str:
    """Calculate the next run time strictly after from_time based on schedule type.

    schedule_value formats:
      daily   → "HH:MM"  (e.g. "09:00")
      weekly  → "DayName HH:MM" or just "DayName" (defaults 09:00)
                  e.g. "Monday 14:30" or "Monday"
      monthly → "DD" or "DD HH:MM"  (e.g. "15" or "15 09:00")
      cron    → any string (not parsed; falls back to +1 day)
    """
    now = datetime.fromisoformat(from_time)

    def _parse_hhmm(s: str, default_hour: int = 9, default_minute: int = 0) -> tuple[int, int]:
        parts = s.strip().split(":")
        try:
            return int(parts[0]), int(parts[1])
        except (IndexError, ValueError):
            return default_hour, default_minute

    if schedule_type == "daily":
        hour, minute = _parse_hhmm(schedule_value)
        next_run = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if next_run <= now:
            next_run += timedelta(days=1)

    elif schedule_type == "weekly":
        _DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
        parts = schedule_value.split(None, 1)  # split on first whitespace
        day_name = parts[0]
        hour, minute = _parse_hhmm(parts[1]) if len(parts) > 1 else (9, 0)
        try:
            target_day = _DAYS.index(day_name)
        except ValueError:
            target_day = 0  # fallback to Monday
        days_ahead = (target_day - now.weekday()) % 7
        next_run = now + timedelta(days=days_ahead)
        next_run = next_run.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if next_run <= now:
            next_run += timedelta(weeks=1)

    elif schedule_type == "monthly":
        parts = schedule_value.split(None, 1)
        try:
            day = max(1, min(int(parts[0]), 28))  # clamp to 28 — safe across all months
        except ValueError:
            day = 1
        hour, minute = _parse_hhmm(parts[1]) if len(parts) > 1 else (9, 0)
        # Build candidate for this month
        next_run = now.replace(day=day, hour=hour, minute=minute, second=0, microsecond=0)
        if next_run <= now:
            # Advance to next month, carrying the year correctly
            year, month = now.year, now.month + 1
            if month > 12:
                month, year = 1, year + 1
            next_run = next_run.replace(year=year, month=month)

    else:  # cron / unrecognised — run tomorrow at the same time
        next_run = now + timedelta(days=1)

    return next_run.isoformat()

@router.get("/")
def list_jobs(user: str = Depends(require_auth)):
    """List all scheduled jobs for the user."""
    jobs = get_scheduled_jobs(created_by=user)
    return {"jobs": jobs}

@router.get("/{job_id}")
def get_job(job_id: int, user: str = Depends(require_auth)):
    """Get a specific scheduled job."""
    job = get_scheduled_job(job_id)
    if not job:
        raise HTTPException(404, "Scheduled job not found")
    if job.get("created_by") != user and user != "owner":
        raise HTTPException(403, "Access denied")
    return job

@router.post("/")
def create_job(job: ScheduledJobCreate, user: str = Depends(require_auth)):
    """Create a new scheduled job."""
    job_id = create_scheduled_job(
        name=job.name,
        pipeline_id=job.pipeline_id,
        dataset_id=job.dataset_id,
        schedule_type=job.schedule_type,
        schedule_value=job.schedule_value,
        created_by=user,
    )
    created = get_scheduled_job(job_id)
    if not created:
        raise HTTPException(500, "Failed to create scheduled job")
    return {"id": job_id, **created}

@router.put("/{job_id}")
def update_job(job_id: int, update: ScheduledJobUpdate, user: str = Depends(require_auth)):
    """Update a scheduled job."""
    job = get_scheduled_job(job_id)
    if not job:
        raise HTTPException(404, "Scheduled job not found")
    if job.get("created_by") != user and user != "owner":
        raise HTTPException(403, "Access denied")
    update_scheduled_job(
        job_id,
        name=update.name,
        dataset_id=update.dataset_id,
        schedule_type=update.schedule_type,
        schedule_value=update.schedule_value,
        is_active=update.is_active,
    )
    
    updated = get_scheduled_job(job_id)
    return updated

@router.delete("/{job_id}")
def delete_job(job_id: int, user: str = Depends(require_auth)):
    """Delete a scheduled job."""
    job = get_scheduled_job(job_id)
    if not job:
        raise HTTPException(404, "Scheduled job not found")
    if job.get("created_by") != user and user != "owner":
        raise HTTPException(403, "Access denied")
    delete_scheduled_job(job_id)
    return {"message": "Scheduled job deleted successfully"}
