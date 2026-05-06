from __future__ import annotations

import json

from fastapi import HTTPException

from app.db import _utc_now, get_conn
from app.routers.clean_router import run_clean_pipeline
from app.schemas import CleanRequest


def run_batch(batch_id: int) -> dict:
    with get_conn() as conn:
        batch = conn.execute("SELECT * FROM batch_operations WHERE id = ?", (batch_id,)).fetchone()
        if not batch:
            raise HTTPException(404, "Batch not found")
        batch = dict(batch)
        items = conn.execute("SELECT * FROM batch_operation_items WHERE batch_id = ?", (batch_id,)).fetchall()
        items = [dict(r) for r in items]

    op_type = batch.get("operation_type")
    cfg = json.loads(batch.get("operation_config") or "{}")

    completed = 0
    failed = 0
    total = len(items)

    def _ws_push(payload: dict) -> None:
        try:
            import asyncio
            from app.routers.ws_router import ws_manager
            owner = batch.get("created_by", "owner")
            loop = asyncio.new_event_loop()
            loop.run_until_complete(ws_manager.send_to(owner, payload))
            loop.close()
        except Exception:
            pass

    for it in items:
        dataset_id = it["dataset_id"]
        try:
            if op_type == "clean":
                body = CleanRequest(dataset_id=dataset_id, **cfg)
                run_clean_pipeline(body)
            else:
                raise HTTPException(400, f"Unsupported operation_type: {op_type}")

            with get_conn() as conn:
                conn.execute(
                    "UPDATE batch_operation_items SET status='completed', processed_at=? WHERE id=?",
                    (_utc_now(), it["id"]),
                )
            completed += 1
            _ws_push({"event": "batch_update", "batch_id": batch_id,
                       "status": "running", "completed": completed, "failed": failed, "total": total})
        except Exception as e:
            with get_conn() as conn:
                conn.execute(
                    "UPDATE batch_operation_items SET status='failed', error_message=?, processed_at=? WHERE id=?",
                    (str(e), _utc_now(), it["id"]),
                )
            failed += 1
            _ws_push({"event": "batch_update", "batch_id": batch_id,
                       "status": "running", "completed": completed, "failed": failed, "total": total})

    status = "completed" if failed == 0 else "completed_with_errors"
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE batch_operations
            SET status=?, completed_datasets=?, failed_datasets=?, completed_at=?
            WHERE id=?
            """,
            (status, completed, failed, _utc_now(), batch_id),
        )

    _ws_push({"event": "batch_update", "batch_id": batch_id,
               "status": status, "completed": completed, "failed": failed, "total": total})
    return {"batch_id": batch_id, "status": status, "completed": completed, "failed": failed}
