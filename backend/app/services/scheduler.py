"""Scheduler service for automated pipeline execution."""
import threading
import time

from app.db import _utc_now, get_conn, get_pipeline
from app.services.pipeline_executor import execute_pipeline


class Scheduler:
    """Simple scheduler for running pipelines on a schedule."""

    def __init__(self):
        self.running = False
        self.thread: threading.Thread | None = None
        self.check_interval = 60  # Check every minute

    def start(self):
        """Start the scheduler in a background thread."""
        if self.running:
            return
        self.running = True
        self.thread = threading.Thread(target=self._run_loop, daemon=True)
        self.thread.start()

    def stop(self):
        """Stop the scheduler."""
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)

    def _run_loop(self):
        """Main scheduler loop."""
        while self.running:
            try:
                self._check_and_run_schedules()
            except Exception as e:
                print(f"Scheduler error: {e}")
            time.sleep(self.check_interval)

    def _check_and_run_schedules(self):
        """Query scheduled_jobs where next_run_at is due and execute them."""
        now_str = _utc_now()

        with get_conn() as conn:
            due_jobs = conn.execute(
                """
                SELECT sj.*,
                       (SELECT d.id FROM datasets d
                        WHERE d.created_by = sj.created_by
                        ORDER BY d.last_analyzed_at DESC
                        LIMIT 1) AS latest_dataset_id
                FROM scheduled_jobs sj
                WHERE sj.is_active = 1
                  AND sj.next_run_at <= ?
                """,
                (now_str,),
            ).fetchall()

        for row in due_jobs:
            job = dict(row)
            # Prefer the pinned dataset_id stored on the job; fall back to
            # the user's most-recently-analysed dataset only when unset.
            dataset_id = job.get("dataset_id") or job.get("latest_dataset_id")
            if not dataset_id:
                print(
                    f"Scheduler: job {job['id']} skipped — "
                    f"no dataset found for user {job['created_by']}"
                )
                self._advance_next_run(job)
                continue
            if not job.get("dataset_id"):
                print(
                    f"Scheduler: job {job['id']} has no pinned dataset_id — "
                    f"falling back to latest dataset {dataset_id} for user {job['created_by']}"
                )
            self._run_pipeline(job, dataset_id)

    def _advance_next_run(self, job: dict):
        """Recalculate and persist next_run_at without running the pipeline."""
        from app.routers.scheduler_router import calculate_next_run
        next_run = calculate_next_run(
            job["schedule_type"], job["schedule_value"], _utc_now()
        )
        with get_conn() as conn:
            conn.execute(
                "UPDATE scheduled_jobs SET next_run_at = ?, updated_at = ? WHERE id = ?",
                (next_run, _utc_now(), job["id"]),
            )

    def _run_pipeline(self, job: dict, dataset_id: str):
        """Execute a pipeline on a dataset and update job timestamps."""
        pipeline_id = job["pipeline_id"]
        job_id = job["id"]

        try:
            pipeline = get_pipeline(pipeline_id)
            if not pipeline:
                print(f"Scheduler: pipeline {pipeline_id} not found for job {job_id}")
                self._advance_next_run(job)
                return

            execute_pipeline(pipeline_id, dataset_id)

            from app.routers.scheduler_router import calculate_next_run
            next_run = calculate_next_run(
                job["schedule_type"], job["schedule_value"], _utc_now()
            )
            now = _utc_now()
            with get_conn() as conn:
                conn.execute(
                    """UPDATE scheduled_jobs
                       SET last_run_at = ?, next_run_at = ?, updated_at = ?
                       WHERE id = ?""",
                    (now, next_run, now, job_id),
                )

            print(
                f"Scheduler: job {job_id} ran pipeline {pipeline_id} "
                f"on dataset {dataset_id} successfully"
            )
            self._ws_notify(job, "completed", "Pipeline executed successfully")
        except Exception as e:
            print(f"Scheduler: job {job_id} failed — {e}")
            self._advance_next_run(job)
            self._ws_notify(job, "failed", str(e))

    def _ws_notify(self, job: dict, status: str, message: str) -> None:
        """Fire-and-forget WebSocket push to the job owner."""
        try:
            import asyncio
            from app.routers.ws_router import ws_manager
            payload = {
                "event": "job_update",
                "job_id": job.get("id"),
                "job_name": job.get("name", ""),
                "status": status,
                "message": message,
            }
            owner = job.get("created_by", "owner")
            loop = asyncio.new_event_loop()
            loop.run_until_complete(ws_manager.send_to(owner, payload))
            loop.close()
        except Exception:
            pass


# Global scheduler instance
scheduler = Scheduler()


def start_scheduler():
    """Start the global scheduler."""
    scheduler.start()


def stop_scheduler():
    """Stop the global scheduler."""
    scheduler.stop()
