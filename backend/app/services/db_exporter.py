"""DB export service — executes pending export jobs using SQLAlchemy."""
from __future__ import annotations

from typing import Any

import pandas as pd


def _build_connection_url(conn: dict) -> str:
    """Build a SQLAlchemy URL from a stored connection record."""
    db_type = conn.get("db_type", "sqlite")
    cs = conn.get("connection_string")
    if cs:
        return cs

    user = conn.get("username") or ""
    pwd = conn.get("password") or ""
    host = conn.get("host") or "localhost"
    port = conn.get("port")
    database = conn.get("database") or ""

    credentials = f"{user}:{pwd}@" if user else ""
    port_str = f":{port}" if port else ""

    if db_type == "postgresql":
        return f"postgresql+psycopg2://{credentials}{host}{port_str}/{database}"
    if db_type == "mysql":
        return f"mysql+pymysql://{credentials}{host}{port_str}/{database}"
    if db_type == "sqlite":
        return f"sqlite:///{database}"
    raise ValueError(f"Unsupported db_type: {db_type}")


def run_export_job(job: dict, conn_record: dict, df: pd.DataFrame) -> dict[str, Any]:
    """
    Write *df* to *table_name* on the target database described by *conn_record*.
    Returns a result dict. Raises RuntimeError on failure.
    """
    try:
        from sqlalchemy import create_engine  # local import — optional dependency
    except ImportError as exc:
        raise RuntimeError(
            "sqlalchemy is required for database export. "
            "Run: pip install sqlalchemy"
        ) from exc

    table_name: str = job["table_name"]
    url = _build_connection_url(conn_record)

    try:
        engine = create_engine(url, pool_pre_ping=True)
        with engine.begin() as conn:
            df.to_sql(table_name, conn, if_exists="replace", index=False)
        engine.dispose()
    except Exception as exc:
        raise RuntimeError(f"Export to {table_name} failed: {exc}") from exc

    return {
        "rows_exported": len(df),
        "table": table_name,
        "db_type": conn_record.get("db_type"),
    }
