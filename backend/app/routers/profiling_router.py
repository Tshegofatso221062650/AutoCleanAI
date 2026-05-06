from fastapi import APIRouter, Depends, HTTPException
from ..db import get_conn
from ..auth import require_auth
from app.services.access_control import require_item_access

router = APIRouter()

@router.get("/overview")
def get_profiling_overview(user: str = Depends(require_auth)):
    """Get overview statistics for the profiling dashboard."""
    # owner sees everything; other users see only their own datasets
    user_filter = "" if user == "owner" else "AND created_by = ?"
    user_args: tuple = () if user == "owner" else (user,)

    with get_conn() as conn:
        total_datasets = conn.execute(
            f"SELECT COUNT(*) FROM datasets WHERE 1=1 {user_filter}", user_args
        ).fetchone()[0]

        cleaned_datasets = conn.execute(
            f"SELECT COUNT(*) FROM datasets WHERE quality_score IS NOT NULL {user_filter}", user_args
        ).fetchone()[0]

        avg_quality = conn.execute(
            f"SELECT AVG(quality_score) FROM datasets WHERE quality_score IS NOT NULL {user_filter}", user_args
        ).fetchone()[0] or 0

        # Quality history — filter via dataset ownership subquery
        ds_filter = (
            "1=1"
            if user == "owner"
            else "dataset_id IN (SELECT id FROM datasets WHERE created_by = ?)"
        )
        total_history = conn.execute(
            f"SELECT COUNT(*) FROM quality_history WHERE {ds_filter}", user_args
        ).fetchone()[0]

        quality_trend = conn.execute(
            f"""
            SELECT timestamp, quality_score, missing_pct, duplicate_pct
            FROM quality_history
            WHERE {ds_filter}
            ORDER BY timestamp DESC
            LIMIT 30
            """,
            user_args,
        ).fetchall()

        quality_by_dataset = conn.execute(
            f"""
            SELECT id, original_filename, quality_score, created_at
            FROM datasets
            WHERE quality_score IS NOT NULL {user_filter}
            ORDER BY quality_score DESC
            LIMIT 20
            """,
            user_args,
        ).fetchall()

        missing_trend = conn.execute(
            f"""
            SELECT timestamp, missing_pct
            FROM quality_history
            WHERE {ds_filter}
            ORDER BY timestamp DESC
            LIMIT 30
            """,
            user_args,
        ).fetchall()
        
        return {
            "overview": {
                "total_datasets": total_datasets,
                "cleaned_datasets": cleaned_datasets,
                "avg_quality_score": round(avg_quality, 2),
                "total_history_entries": total_history,
            },
            "quality_trend": [
                {
                    "timestamp": row[0],
                    "quality_score": row[1],
                    "missing_pct": row[2],
                    "duplicate_pct": row[3],
                }
                for row in reversed(quality_trend)
            ],
            "quality_by_dataset": [
                {
                    "id": row[0],
                    "filename": row[1],
                    "quality_score": row[2],
                    "created_at": row[3],
                }
                for row in quality_by_dataset
            ],
            "missing_trend": [
                {
                    "timestamp": row[0],
                    "missing_pct": row[1],
                }
                for row in reversed(missing_trend)
            ],
        }

@router.get("/dataset/{dataset_id}")
def get_dataset_profile(dataset_id: str, user: str = Depends(require_auth)):
    """Get detailed profile for a specific dataset."""
    require_item_access(user, "dataset", dataset_id)
    with get_conn() as conn:
        dataset = conn.execute(
            "SELECT * FROM datasets WHERE id = ?",
            (dataset_id,)
        ).fetchone()
        
        if not dataset:
            raise HTTPException(404, "Dataset not found")
        
        dataset_dict = dict(dataset)
        
        # Quality history for this dataset
        quality_history = conn.execute(
            """
            SELECT timestamp, quality_score, missing_pct, duplicate_pct, row_count, col_count
            FROM quality_history
            WHERE dataset_id = ?
            ORDER BY timestamp DESC
            LIMIT 50
            """,
            (dataset_id,)
        ).fetchall()
        
        return {
            "dataset": dataset_dict,
            "quality_history": [
                {
                    "timestamp": row[0],
                    "quality_score": row[1],
                    "missing_pct": row[2],
                    "duplicate_pct": row[3],
                    "row_count": row[4],
                    "col_count": row[5],
                }
                for row in reversed(quality_history)
            ],
        }
