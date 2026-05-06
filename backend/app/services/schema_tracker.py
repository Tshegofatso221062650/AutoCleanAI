from __future__ import annotations

import json

from app.db import _utc_now, get_conn


def record_schema_snapshot(dataset_id: str, column_names: list[str], change_type: str) -> int:
    snapshot = {"column_names": list(column_names)}
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO schema_history (dataset_id, schema_snapshot, change_type, changed_at)
            VALUES (?, ?, ?, ?)
            """,
            (dataset_id, json.dumps(snapshot), change_type, _utc_now()),
        )
        return cur.lastrowid
