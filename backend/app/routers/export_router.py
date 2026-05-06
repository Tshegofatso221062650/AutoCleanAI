from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from ..db import get_conn, _utc_now, get_dataset
from ..auth import require_auth
from ..services.db_exporter import run_export_job
from ..services.cleaning_engine import load_dataframe
from ..services.storage import resolve_original_path, infer_format_from_name

router = APIRouter()

class DatabaseConnectionCreate(BaseModel):
    name: str
    db_type: str  # 'postgresql', 'mysql', 'sqlite'
    host: Optional[str] = None
    port: Optional[int] = None
    database: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    connection_string: Optional[str] = None

class ExportJobCreate(BaseModel):
    dataset_id: str
    connection_id: int
    table_name: str

def get_database_connections(created_by: str = None) -> list[dict]:
    with get_conn() as conn:
        if created_by:
            rows = conn.execute(
                "SELECT * FROM database_connections WHERE created_by = ? ORDER BY created_at DESC",
                (created_by,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM database_connections ORDER BY created_at DESC"
            ).fetchall()
        return [dict(row) for row in rows]

def get_database_connection(conn_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM database_connections WHERE id = ?",
            (conn_id,)
        ).fetchone()
        return dict(row) if row else None

def create_database_connection(
    name: str,
    db_type: str,
    host: str = None,
    port: int = None,
    database: str = None,
    username: str = None,
    password: str = None,
    connection_string: str = None,
    created_by: str = None,
) -> int:
    with get_conn() as conn:
        cursor = conn.execute(
            """
            INSERT INTO database_connections 
            (name, db_type, host, port, database, username, password, connection_string, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (name, db_type, host, port, database, username, password, connection_string, created_by, _utc_now(), _utc_now())
        )
        return cursor.lastrowid

def update_database_connection(conn_id: int, **kwargs) -> None:
    fields = {k: v for k, v in kwargs.items() if v is not None}
    if not fields:
        return
    set_clause = ", ".join(f"{k} = ?" for k in fields)
    values = list(fields.values()) + [_utc_now(), conn_id]
    with get_conn() as conn:
        conn.execute(
            f"UPDATE database_connections SET {set_clause}, updated_at = ? WHERE id = ?",
            values,
        )

def delete_database_connection(conn_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM database_connections WHERE id = ?", (conn_id,))

def create_export_job(
    dataset_id: str,
    connection_id: int,
    table_name: str,
) -> int:
    with get_conn() as conn:
        cursor = conn.execute(
            """
            INSERT INTO export_jobs 
            (dataset_id, connection_id, table_name, status, created_at)
            VALUES (?, ?, ?, 'pending', ?)
            """,
            (dataset_id, connection_id, table_name, _utc_now())
        )
        return cursor.lastrowid

def get_export_jobs(dataset_id: str = None) -> list[dict]:
    with get_conn() as conn:
        if dataset_id:
            rows = conn.execute(
                "SELECT * FROM export_jobs WHERE dataset_id = ? ORDER BY created_at DESC",
                (dataset_id,)
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM export_jobs ORDER BY created_at DESC"
            ).fetchall()
        return [dict(row) for row in rows]

@router.get("/connections")
def list_connections(user: str = Depends(require_auth)):
    """List all database connections for the user."""
    connections = get_database_connections(created_by=user)
    # Remove password from response
    for conn in connections:
        if 'password' in conn:
            del conn['password']
    return {"connections": connections}

@router.get("/connections/{conn_id}")
def get_connection(conn_id: int, user: str = Depends(require_auth)):
    """Get a specific database connection."""
    conn = get_database_connection(conn_id)
    if not conn:
        raise HTTPException(404, "Database connection not found")
    if 'password' in conn:
        del conn['password']
    return conn

@router.post("/connections")
def create_connection(conn: DatabaseConnectionCreate, user: str = Depends(require_auth)):
    """Create a new database connection."""
    conn_id = create_database_connection(
        name=conn.name,
        db_type=conn.db_type,
        host=conn.host,
        port=conn.port,
        database=conn.database,
        username=conn.username,
        password=conn.password,
        connection_string=conn.connection_string,
        created_by=user,
    )
    created = get_database_connection(conn_id)
    if not created:
        raise HTTPException(500, "Failed to create database connection")
    if 'password' in created:
        del created['password']
    return {"id": conn_id, **created}

@router.put("/connections/{conn_id}")
def update_connection(conn_id: int, conn: DatabaseConnectionCreate, user: str = Depends(require_auth)):
    """Update an existing database connection in-place."""
    existing = get_database_connection(conn_id)
    if not existing:
        raise HTTPException(404, "Database connection not found")
    update_database_connection(
        conn_id,
        name=conn.name,
        db_type=conn.db_type,
        host=conn.host,
        port=conn.port,
        database=conn.database,
        username=conn.username,
        **({"password": conn.password} if conn.password else {}),
        connection_string=conn.connection_string,
    )
    updated = get_database_connection(conn_id)
    if "password" in updated:
        del updated["password"]
    return updated

@router.delete("/connections/{conn_id}")
def delete_connection(conn_id: int, user: str = Depends(require_auth)):
    """Delete a database connection."""
    conn = get_database_connection(conn_id)
    if not conn:
        raise HTTPException(404, "Database connection not found")
    
    delete_database_connection(conn_id)
    return {"message": "Database connection deleted successfully"}

def _execute_export_job(job_id: int) -> dict:
    """Load dataset and run the export; update job status in DB."""
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM export_jobs WHERE id = ?", (job_id,)).fetchone()
        if not row:
            raise HTTPException(404, "Export job not found")
        job = dict(row)

    conn_record = get_database_connection(job["connection_id"])
    if not conn_record:
        raise HTTPException(404, "Database connection not found")

    dataset = get_dataset(job["dataset_id"])
    if not dataset:
        raise HTTPException(404, "Dataset not found")

    path = resolve_original_path(job["dataset_id"])
    if not path:
        raise HTTPException(404, "Dataset file not found")

    fmt = dataset.get("file_format") or infer_format_from_name(dataset["original_filename"])
    df = load_dataframe(path, fmt)

    try:
        result = run_export_job(job, conn_record, df)
        status = "completed"
        error_msg = None
    except RuntimeError as exc:
        result = {}
        status = "failed"
        error_msg = str(exc)

    with get_conn() as conn:
        conn.execute(
            "UPDATE export_jobs SET status = ?, error_message = ?, exported_at = ? WHERE id = ?",
            (status, error_msg, _utc_now(), job_id),
        )

    if status == "failed":
        raise HTTPException(500, error_msg)

    return {"id": job_id, "status": status, **result}


@router.post("/export")
def export_to_database(job: ExportJobCreate, user: str = Depends(require_auth)):
    """Create and immediately execute a database export job."""
    job_id = create_export_job(
        dataset_id=job.dataset_id,
        connection_id=job.connection_id,
        table_name=job.table_name,
    )
    return _execute_export_job(job_id)


@router.post("/jobs/{job_id}/run")
def retry_export_job(job_id: int, user: str = Depends(require_auth)):
    """Re-run a failed export job."""
    return _execute_export_job(job_id)


@router.get("/export/{dataset_id}")
def list_exports(dataset_id: str, user: str = Depends(require_auth)):
    """List export jobs for a dataset."""
    jobs = get_export_jobs(dataset_id)
    return {"jobs": jobs}
