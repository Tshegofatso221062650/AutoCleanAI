import json
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from app.config import settings


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _is_postgres() -> bool:
    url = settings.database_url or ""
    return url.startswith("postgresql://") or url.startswith("postgres://")


class _PgRow(dict):
    """Minimal sqlite3.Row-compatible wrapper for psycopg2 dict rows."""
    def keys(self):
        return list(super().keys())


@contextmanager
def get_conn():
    if _is_postgres():
        try:
            import psycopg2
            import psycopg2.extras
        except ImportError:
            raise RuntimeError(
                "DATABASE_URL is set to PostgreSQL but psycopg2 is not installed. "
                "Run: pip install psycopg2-binary"
            )
        conn = psycopg2.connect(settings.database_url)
        conn.autocommit = False
        cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)

        class _PgConnWrapper:
            """Thin wrapper that makes psycopg2 behave like sqlite3 for our code."""
            def execute(self, sql: str, params=()) -> "_PgConnWrapper":
                # Translate SQLite ? placeholders → PostgreSQL %s
                pg_sql = sql.replace("?", "%s")
                # Translate SQLite-specific DDL that differs in Postgres
                pg_sql = pg_sql.replace("INTEGER PRIMARY KEY AUTOINCREMENT", "SERIAL PRIMARY KEY")
                pg_sql = pg_sql.replace("IF NOT EXISTS idx_", "IF NOT EXISTS idx_pg_")
                cur.execute(pg_sql, params)
                return self
            def executemany(self, sql: str, seq):
                pg_sql = sql.replace("?", "%s")
                cur.executemany(pg_sql, seq)
            def fetchone(self):
                row = cur.fetchone()
                return _PgRow(row) if row else None
            def fetchall(self):
                return [_PgRow(r) for r in cur.fetchall()]
            @property
            def lastrowid(self):
                cur.execute("SELECT lastval()")
                return cur.fetchone()["lastval"]

        wrapper = _PgConnWrapper()
        try:
            yield wrapper
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            cur.close()
            conn.close()
    else:
        conn = sqlite3.connect(str(settings.history_db), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA cache_size=-32000")
        conn.execute("PRAGMA temp_store=MEMORY")
        conn.execute("PRAGMA mmap_size=268435456")
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()


def write_audit_log(
    action: str,
    actor: str,
    resource_type: str | None = None,
    resource_id: str | None = None,
    detail: str | None = None,
    ip: str | None = None,
) -> None:
    """Non-blocking best-effort audit log write."""
    try:
        with get_conn() as conn:
            conn.execute(
                """INSERT INTO audit_log (action, actor, resource_type, resource_id, detail, ip, ts)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (action, actor, resource_type, resource_id, detail, ip, _utc_now()),
            )
    except Exception:
        pass  # Audit logging must never crash the app


def init_db() -> None:
    with get_conn() as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS users (
                username TEXT PRIMARY KEY,
                password_hash TEXT,
                email TEXT,
                role TEXT NOT NULL DEFAULT 'user',
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at)")
        for _col, _def in [
            ("password_hash", "TEXT"),
            ("email",         "TEXT"),
            ("role",          "TEXT NOT NULL DEFAULT 'user'"),
        ]:
            try:
                conn.execute(f"ALTER TABLE users ADD COLUMN {_col} {_def}")
            except sqlite3.OperationalError:
                pass
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS datasets (
                id TEXT PRIMARY KEY,
                original_filename TEXT NOT NULL,
                stored_path TEXT NOT NULL,
                file_format TEXT NOT NULL,
                row_count INTEGER,
                col_count INTEGER,
                created_at TEXT NOT NULL,
                created_by TEXT,
                last_analyzed_at TEXT,
                last_cleaned_at TEXT,
                export_paths TEXT,
                analysis_json TEXT,
                clean_report_json TEXT,
                quality_score REAL,
                cleaning_objective TEXT,
                parent_dataset_id TEXT,
                is_consolidated BOOLEAN DEFAULT 0
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_datasets_created_at ON datasets(created_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_datasets_parent_dataset_id ON datasets(parent_dataset_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_datasets_quality_score ON datasets(quality_score)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS audit_log (
                id       INTEGER PRIMARY KEY AUTOINCREMENT,
                ts       TEXT NOT NULL,
                action   TEXT NOT NULL,
                actor    TEXT NOT NULL,
                resource_type TEXT,
                resource_id   TEXT,
                detail   TEXT,
                ip       TEXT
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_ts     ON audit_log(ts)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_actor  ON audit_log(actor)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action)")
        # Add cleaning_objective column if it doesn't exist (for existing databases)
        try:
            conn.execute("ALTER TABLE datasets ADD COLUMN cleaning_objective TEXT")
        except sqlite3.OperationalError:
            pass  # Column already exists
        # Add created_by column if it doesn't exist
        try:
            conn.execute("ALTER TABLE datasets ADD COLUMN created_by TEXT")
        except sqlite3.OperationalError:
            pass
        conn.execute("CREATE INDEX IF NOT EXISTS idx_datasets_created_by ON datasets(created_by)")
        # Index for the shared_items subquery used in list_history_for_user
        try:
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_shared_items_shared_with ON shared_items(shared_with, item_type)"
            )
        except sqlite3.OperationalError:
            pass  # shared_items table may not exist yet — created later in init_db
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS token_blocklist (
                jti      TEXT PRIMARY KEY,
                expires_at TEXT NOT NULL,
                revoked_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_token_blocklist_expires ON token_blocklist(expires_at)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS dataset_comments (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_id TEXT    NOT NULL,
                author     TEXT    NOT NULL,
                content    TEXT    NOT NULL,
                created_at TEXT    NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_comments_dataset ON dataset_comments(dataset_id, created_at)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS api_keys (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                user         TEXT    NOT NULL,
                name         TEXT    NOT NULL,
                key_hash     TEXT    NOT NULL UNIQUE,
                key_prefix   TEXT    NOT NULL,
                created_at   TEXT    NOT NULL,
                last_used_at TEXT
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user)")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS user_sessions (
                jti        TEXT PRIMARY KEY,
                username   TEXT NOT NULL,
                ip         TEXT,
                user_agent TEXT,
                created_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                revoked    INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_user_sessions_username ON user_sessions(username)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_user_sessions_expires  ON user_sessions(expires_at)")

        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS webhooks (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                user         TEXT    NOT NULL,
                url          TEXT    NOT NULL,
                events       TEXT    NOT NULL DEFAULT '[]',
                secret       TEXT    NOT NULL,
                enabled      INTEGER NOT NULL DEFAULT 1,
                created_at   TEXT    NOT NULL,
                last_fired_at TEXT,
                last_status  TEXT,
                failure_count INTEGER NOT NULL DEFAULT 0
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_webhooks_user ON webhooks(user)")

        # TOTP 2FA columns on users
        for _col, _def in [
            ("totp_secret",  "TEXT"),
            ("totp_enabled", "INTEGER NOT NULL DEFAULT 0"),
        ]:
            try:
                conn.execute(f"ALTER TABLE users ADD COLUMN {_col} {_def}")
            except Exception:
                pass

        # Ensure default owner user exists for single-user mode.
        conn.execute(
            "INSERT OR IGNORE INTO users (username, created_at) VALUES (?, ?)",
            ("owner", _utc_now()),
        )
        # Add parent_dataset_id column if it doesn't exist
        try:
            conn.execute("ALTER TABLE datasets ADD COLUMN parent_dataset_id TEXT")
        except sqlite3.OperationalError:
            pass  # Column already exists
        # Add is_consolidated column if it doesn't exist
        try:
            conn.execute("ALTER TABLE datasets ADD COLUMN is_consolidated BOOLEAN DEFAULT 0")
        except sqlite3.OperationalError:
            pass  # Column already exists
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS settings_kv (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS quality_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_id TEXT NOT NULL,
                quality_score REAL NOT NULL,
                missing_pct REAL NOT NULL,
                duplicate_pct REAL NOT NULL,
                row_count INTEGER NOT NULL,
                col_count INTEGER NOT NULL,
                timestamp TEXT NOT NULL,
                FOREIGN KEY (dataset_id) REFERENCES datasets (id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_quality_history_dataset_id ON quality_history(dataset_id)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_quality_history_timestamp ON quality_history(timestamp)")
        # Migration: add column_stats for per-column distribution tracking (ignored if already exists)
        try:
            conn.execute("ALTER TABLE quality_history ADD COLUMN column_stats TEXT")
        except Exception:
            pass
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS consolidation_groups (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                created_at TEXT NOT NULL,
                status TEXT DEFAULT 'pending'
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS consolidation_members (
                group_id TEXT NOT NULL,
                dataset_id TEXT NOT NULL,
                join_key TEXT,
                FOREIGN KEY (group_id) REFERENCES consolidation_groups (id),
                FOREIGN KEY (dataset_id) REFERENCES datasets (id),
                PRIMARY KEY (group_id, dataset_id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_consolidation_members_dataset_id ON consolidation_members(dataset_id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS pipelines (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                steps TEXT NOT NULL,
                is_template BOOLEAN DEFAULT 0,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                usage_count INTEGER DEFAULT 0
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS pipeline_runs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pipeline_id INTEGER NOT NULL,
                dataset_id TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                started_at TEXT,
                completed_at TEXT,
                error_message TEXT,
                FOREIGN KEY (pipeline_id) REFERENCES pipelines (id),
                FOREIGN KEY (dataset_id) REFERENCES datasets (id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                pipeline_id INTEGER NOT NULL,
                dataset_id TEXT,
                cron_expression TEXT NOT NULL,
                enabled BOOLEAN DEFAULT 1,
                last_run_at TEXT,
                next_run_at TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (pipeline_id) REFERENCES pipelines (id),
                FOREIGN KEY (dataset_id) REFERENCES datasets (id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS transformation_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                rules TEXT NOT NULL,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS dataset_versions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_id TEXT NOT NULL,
                version_number INTEGER NOT NULL,
                parent_version_id INTEGER,
                file_path TEXT NOT NULL,
                row_count INTEGER,
                quality_score REAL,
                operation_type TEXT NOT NULL,
                operation_details TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (dataset_id) REFERENCES datasets (id),
                FOREIGN KEY (parent_version_id) REFERENCES dataset_versions (id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS data_lineage (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_id TEXT NOT NULL,
                source_dataset_id TEXT,
                operation TEXT NOT NULL,
                operation_details TEXT,
                input_columns TEXT,
                output_columns TEXT,
                rows_affected INTEGER,
                created_at TEXT NOT NULL,
                FOREIGN KEY (dataset_id) REFERENCES datasets (id),
                FOREIGN KEY (source_dataset_id) REFERENCES datasets (id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS cleaning_objectives (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                objective_type TEXT NOT NULL,
                target_value TEXT,
                column_name TEXT,
                validation_rule TEXT,
                is_template BOOLEAN DEFAULT 0,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS dataset_objectives (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_id TEXT NOT NULL,
                objective_id INTEGER NOT NULL,
                status TEXT DEFAULT 'pending',
                result_value TEXT,
                completed_at TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (dataset_id) REFERENCES datasets (id),
                FOREIGN KEY (objective_id) REFERENCES cleaning_objectives (id),
                UNIQUE(dataset_id, objective_id)
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS validation_rules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                rule_type TEXT NOT NULL,
                column_name TEXT NOT NULL,
                pattern TEXT,
                min_value REAL,
                max_value REAL,
                allowed_values TEXT,
                is_required BOOLEAN DEFAULT 0,
                error_message TEXT,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_validation_rules_column ON validation_rules(column_name)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS dataset_validations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_id TEXT NOT NULL,
                rule_id INTEGER NOT NULL,
                passed BOOLEAN NOT NULL,
                failed_rows INTEGER DEFAULT 0,
                details TEXT,
                validated_at TEXT NOT NULL,
                FOREIGN KEY (dataset_id) REFERENCES datasets (id),
                FOREIGN KEY (rule_id) REFERENCES validation_rules (id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_dataset_validations_dataset_id ON dataset_validations(dataset_id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS scheduled_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                pipeline_id INTEGER NOT NULL,
                dataset_id TEXT,
                schedule_type TEXT NOT NULL,
                schedule_value TEXT NOT NULL,
                last_run_at TEXT,
                next_run_at TEXT NOT NULL,
                is_active BOOLEAN DEFAULT 1,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                FOREIGN KEY (pipeline_id) REFERENCES pipelines (id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_next_run ON scheduled_jobs(next_run_at)")
        conn.execute("CREATE INDEX IF NOT EXISTS idx_scheduled_jobs_active ON scheduled_jobs(is_active)")
        try:
            conn.execute("ALTER TABLE scheduled_jobs ADD COLUMN dataset_id TEXT")
        except sqlite3.OperationalError:
            pass  # column already exists
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS database_connections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                db_type TEXT NOT NULL,
                host TEXT,
                port INTEGER,
                database TEXT,
                username TEXT,
                password TEXT,
                connection_string TEXT,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS export_jobs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_id TEXT NOT NULL,
                connection_id INTEGER NOT NULL,
                table_name TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                error_message TEXT,
                exported_at TEXT,
                created_at TEXT NOT NULL,
                FOREIGN KEY (dataset_id) REFERENCES datasets (id),
                FOREIGN KEY (connection_id) REFERENCES database_connections (id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_export_jobs_dataset_id ON export_jobs(dataset_id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS batch_operations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                operation_type TEXT NOT NULL,
                operation_config TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                total_datasets INTEGER DEFAULT 0,
                completed_datasets INTEGER DEFAULT 0,
                failed_datasets INTEGER DEFAULT 0,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                completed_at TEXT,
                error_message TEXT
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_batch_operations_status ON batch_operations(status)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS batch_operation_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_id INTEGER NOT NULL,
                dataset_id TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                result TEXT,
                error_message TEXT,
                processed_at TEXT,
                created_at TEXT,
                FOREIGN KEY (batch_id) REFERENCES batch_operations (id),
                FOREIGN KEY (dataset_id) REFERENCES datasets (id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_batch_operation_items_batch_id ON batch_operation_items(batch_id)")
        try:
            conn.execute("ALTER TABLE batch_operation_items ADD COLUMN created_at TEXT")
        except Exception:
            pass  # Column already exists in existing databases
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS dataset_tags (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_id TEXT NOT NULL,
                tag TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (dataset_id) REFERENCES datasets (id),
                UNIQUE(dataset_id, tag)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_dataset_tags_tag ON dataset_tags(tag)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS quality_alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                alert_type TEXT NOT NULL,
                threshold_value REAL NOT NULL,
                metric_type TEXT NOT NULL,
                is_active BOOLEAN DEFAULT 1,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                last_triggered_at TEXT
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_quality_alerts_active ON quality_alerts(is_active)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS custom_functions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                description TEXT,
                function_type TEXT NOT NULL,
                function_code TEXT NOT NULL,
                language TEXT DEFAULT 'python',
                parameters TEXT,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_custom_functions_type ON custom_functions(function_type)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS dataset_comparisons (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset1_id TEXT NOT NULL,
                dataset2_id TEXT NOT NULL,
                comparison_result TEXT,
                summary TEXT,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (dataset1_id) REFERENCES datasets (id),
                FOREIGN KEY (dataset2_id) REFERENCES datasets (id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_dataset_comparisons_dataset1 ON dataset_comparisons(dataset1_id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS shared_items (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                item_type TEXT NOT NULL,
                item_id TEXT NOT NULL,
                shared_with TEXT NOT NULL,
                shared_by TEXT NOT NULL,
                permissions TEXT,
                created_at TEXT NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_shared_items_item ON shared_items(item_type, item_id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_id TEXT NOT NULL,
                schema_snapshot TEXT NOT NULL,
                change_type TEXT,
                changed_at TEXT NOT NULL,
                FOREIGN KEY (dataset_id) REFERENCES datasets (id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_schema_history_dataset ON schema_history(dataset_id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS anomaly_detections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_id TEXT NOT NULL,
                column_name TEXT NOT NULL,
                anomaly_type TEXT NOT NULL,
                anomaly_value TEXT,
                confidence REAL,
                detected_at TEXT NOT NULL,
                FOREIGN KEY (dataset_id) REFERENCES datasets (id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_anomaly_detections_dataset ON anomaly_detections(dataset_id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS pii_detections (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_id TEXT NOT NULL,
                column_name TEXT NOT NULL,
                pii_type TEXT NOT NULL,
                row_indices TEXT,
                detection_method TEXT,
                detected_at TEXT NOT NULL,
                FOREIGN KEY (dataset_id) REFERENCES datasets (id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_pii_detections_dataset ON pii_detections(dataset_id)")
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS undo_history (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                dataset_id TEXT NOT NULL,
                operation_type TEXT NOT NULL,
                operation_details TEXT,
                previous_state TEXT,
                used BOOLEAN DEFAULT 0,
                created_by TEXT NOT NULL,
                created_at TEXT NOT NULL,
                FOREIGN KEY (dataset_id) REFERENCES datasets (id)
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_undo_history_dataset ON undo_history(dataset_id)")


def insert_dataset(
    dataset_id: str,
    original_filename: str,
    stored_path: str,
    file_format: str,
    row_count: int | None = None,
    col_count: int | None = None,
    cleaning_objective: str | None = None,
    created_by: str | None = None,
    parent_dataset_id: str | None = None,
) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO datasets (id, original_filename, stored_path, file_format, row_count, col_count, created_at, cleaning_objective, created_by, parent_dataset_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dataset_id,
                original_filename,
                stored_path,
                file_format,
                row_count,
                col_count,
                _utc_now(),
                cleaning_objective,
                created_by or "owner",
                parent_dataset_id,
            ),
        )


def update_dataset_analysis(dataset_id: str, analysis: dict, quality_score: float) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE datasets
            SET analysis_json = ?, quality_score = ?, last_analyzed_at = ?, row_count = ?, col_count = ?
            WHERE id = ?
            """,
            (
                json.dumps(analysis),
                quality_score,
                _utc_now(),
                analysis.get("total_rows"),
                analysis.get("total_columns"),
                dataset_id,
            ),
        )


def update_dataset_clean(
    dataset_id: str,
    clean_report: dict,
    export_paths: dict,
    quality_score: float | None = None,
) -> None:
    with get_conn() as conn:
        sets = "clean_report_json = ?, export_paths = ?, last_cleaned_at = ?"
        args: list = [json.dumps(clean_report), json.dumps(export_paths), _utc_now()]
        if quality_score is not None:
            sets += ", quality_score = ?"
            args.append(quality_score)
        args.append(dataset_id)
        conn.execute(f"UPDATE datasets SET {sets} WHERE id = ?", args)


def get_dataset(dataset_id: str) -> dict | None:
    with get_conn() as conn:
        cur = conn.execute("SELECT * FROM datasets WHERE id = ?", (dataset_id,))
        row = cur.fetchone()
        if not row:
            return None
        return dict(row)


def delete_dataset(dataset_id: str) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM datasets WHERE id = ?", (dataset_id,))
        return cur.rowcount > 0


def list_history_lite(limit: int = 1000, user: str | None = None) -> list[dict]:
    """Like list_history but excludes large JSON blob columns.

    Use this for analytics / overview endpoints that only need metadata
    (id, filename, row_count, quality_score, timestamps).  Avoids pulling
    analysis_json / clean_report_json (can be hundreds of KB each) for
    every row just to compute aggregates.

    When `user` is provided, only returns datasets owned by or shared with that user.
    """
    with get_conn() as conn:
        if user and user != "owner":
            rows = conn.execute(
                """
                SELECT id, original_filename, file_format, row_count, col_count,
                       created_at, created_by, last_analyzed_at, last_cleaned_at,
                       quality_score, parent_dataset_id, is_consolidated
                FROM datasets
                WHERE created_by = ?
                   OR id IN (
                       SELECT item_id FROM shared_items
                       WHERE shared_with = ? AND item_type = 'dataset'
                   )
                ORDER BY datetime(created_at) DESC
                LIMIT ?
                """,
                (user, user, limit),
            ).fetchall()
        else:
            rows = conn.execute(
                """
                SELECT id, original_filename, file_format, row_count, col_count,
                       created_at, created_by, last_analyzed_at, last_cleaned_at,
                       quality_score, parent_dataset_id, is_consolidated
                FROM datasets
                ORDER BY datetime(created_at) DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return [dict(r) for r in rows]


def get_pipeline_runs_batch(pipeline_ids: list[int]) -> list[dict]:
    """Return all pipeline runs for a list of pipeline IDs in one query."""
    if not pipeline_ids:
        return []
    placeholders = ",".join("?" * len(pipeline_ids))
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT * FROM pipeline_runs WHERE pipeline_id IN ({placeholders}) ORDER BY started_at DESC",
            pipeline_ids,
        ).fetchall()
        return [dict(r) for r in rows]


def get_objectives_for_datasets(dataset_ids: list[str]) -> dict[str, list[dict]]:
    """Return objectives grouped by dataset_id in one query.

    Returns a dict mapping dataset_id -> list of objective dicts.
    """
    if not dataset_ids:
        return {}
    placeholders = ",".join("?" * len(dataset_ids))
    with get_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT do.*, co.name, co.objective_type, co.target_value,
                   co.column_name, co.validation_rule
            FROM dataset_objectives do
            JOIN cleaning_objectives co ON do.objective_id = co.id
            WHERE do.dataset_id IN ({placeholders})
            ORDER BY do.dataset_id, do.created_at DESC
            """,
            dataset_ids,
        ).fetchall()
    result: dict[str, list[dict]] = {}
    for r in rows:
        d = dict(r)
        result.setdefault(d["dataset_id"], []).append(d)
    return result


def list_history(limit: int = 100) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM datasets ORDER BY datetime(created_at) DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [dict(r) for r in rows]


def list_history_for_user(user: str, limit: int = 100, include_derived: bool = False) -> list[dict]:
    """Return dataset metadata rows for a user WITHOUT the large JSON blob columns.

    Excludes analysis_json, clean_report_json, and export_paths which can be
    hundreds of KB each — callers that only need metadata should never load them.
    A synthetic `has_analysis` integer (0/1) is included so the /history endpoint
    can set `has_analysis` without json.loads() on every row.

    By default, derived datasets (parent_dataset_id IS NOT NULL, i.e. transform
    outputs) are excluded to keep the history list clean.  Pass include_derived=True
    to include them.
    """
    _LITE_COLS = """
        id, original_filename, file_format, row_count, col_count,
        created_at, created_by, last_analyzed_at, last_cleaned_at,
        quality_score, parent_dataset_id, is_consolidated, cleaning_objective,
        CASE WHEN analysis_json IS NOT NULL THEN 1 ELSE 0 END AS has_analysis
    """
    _derived_filter = "" if include_derived else "AND parent_dataset_id IS NULL"
    if user == "owner":
        with get_conn() as conn:
            rows = conn.execute(
                f"SELECT {_LITE_COLS} FROM datasets WHERE 1=1 {_derived_filter} ORDER BY datetime(created_at) DESC LIMIT ?",
                (limit,),
            ).fetchall()
            return [dict(r) for r in rows]
    with get_conn() as conn:
        rows = conn.execute(
            f"""
            SELECT {_LITE_COLS}
            FROM datasets
            WHERE (created_by = ?
               OR id IN (
                   SELECT item_id
                   FROM shared_items
                   WHERE item_type = 'dataset' AND shared_with = ?
               ))
            {_derived_filter}
            ORDER BY datetime(created_at) DESC
            LIMIT ?
            """,
            (user, user, limit),
        ).fetchall()
        return [dict(r) for r in rows]


def get_setting(key: str) -> str | None:
    with get_conn() as conn:
        row = conn.execute("SELECT value FROM settings_kv WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else None


def set_setting(key: str, value: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO settings_kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )


def update_dataset_objective(dataset_id: str, objective: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE datasets SET cleaning_objective = ? WHERE id = ?",
            (objective, dataset_id)
        )


def mark_as_consolidated(dataset_id: str, parent_id: str | None = None) -> None:
    with get_conn() as conn:
        updates = "is_consolidated = 1"
        args = []
        if parent_id:
            updates += ", parent_dataset_id = ?"
            args.append(parent_id)
        args.append(dataset_id)
        conn.execute(f"UPDATE datasets SET {updates} WHERE id = ?", args)


def get_consolidation_groups(limit: int = 50) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM consolidation_groups ORDER BY created_at DESC LIMIT ?",
            (limit,)
        ).fetchall()
        return [dict(r) for r in rows]


def get_consolidation_group(group_id: str) -> dict | None:
    with get_conn() as conn:
        cur = conn.execute("SELECT * FROM consolidation_groups WHERE id = ?", (group_id,))
        row = cur.fetchone()
        return dict(row) if row else None


def new_dataset_id() -> str:
    return str(uuid.uuid4())


# Pipeline functions
def create_pipeline(name: str, description: str | None, steps: str, created_by: str, is_template: bool = False) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO pipelines (name, description, steps, is_template, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            """,
            (name, description, steps, is_template, created_by, _utc_now(), _utc_now())
        )
        return cur.lastrowid


def get_pipeline(pipeline_id: int) -> dict | None:
    with get_conn() as conn:
        cur = conn.execute("SELECT * FROM pipelines WHERE id = ?", (pipeline_id,))
        row = cur.fetchone()
        return dict(row) if row else None


def list_pipelines(created_by: str | None = None, is_template: bool | None = None) -> list[dict]:
    with get_conn() as conn:
        query = "SELECT * FROM pipelines WHERE 1=1"
        args = []
        if created_by:
            query += " AND created_by = ?"
            args.append(created_by)
        if is_template is not None:
            query += " AND is_template = ?"
            args.append(is_template)
        query += " ORDER BY created_at DESC"
        rows = conn.execute(query, args).fetchall()
        return [dict(r) for r in rows]


def update_pipeline(pipeline_id: int, name: str | None = None, description: str | None = None, steps: str | None = None, is_template: bool | None = None) -> bool:
    with get_conn() as conn:
        updates = []
        args = []
        if name:
            updates.append("name = ?")
            args.append(name)
        if description is not None:
            updates.append("description = ?")
            args.append(description)
        if steps:
            updates.append("steps = ?")
            args.append(steps)
        if is_template is not None:
            updates.append("is_template = ?")
            args.append(is_template)
        if updates:
            updates.append("updated_at = ?")
            args.append(_utc_now())
            args.append(pipeline_id)
            conn.execute(f"UPDATE pipelines SET {', '.join(updates)} WHERE id = ?", args)
            return True
        return False


def delete_pipeline(pipeline_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM pipelines WHERE id = ?", (pipeline_id,))
        return cur.rowcount > 0


def increment_pipeline_usage(pipeline_id: int) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE pipelines SET usage_count = usage_count + 1 WHERE id = ?", (pipeline_id,))


# Pipeline run functions
def create_pipeline_run(pipeline_id: int, dataset_id: str) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO pipeline_runs (pipeline_id, dataset_id, started_at)
            VALUES (?, ?, ?)
            """,
            (pipeline_id, dataset_id, _utc_now())
        )
        return cur.lastrowid


def update_pipeline_run(run_id: int, status: str, error_message: str | None = None) -> None:
    with get_conn() as conn:
        updates = ["status = ?", "completed_at = ?"]
        args = [status, _utc_now()]
        if error_message:
            updates.append("error_message = ?")
            args.append(error_message)
        args.append(run_id)
        conn.execute(f"UPDATE pipeline_runs SET {', '.join(updates)} WHERE id = ?", args)


def get_pipeline_runs(pipeline_id: int | None = None, dataset_id: str | None = None, limit: int = 50) -> list[dict]:
    with get_conn() as conn:
        query = "SELECT * FROM pipeline_runs WHERE 1=1"
        args = []
        if pipeline_id:
            query += " AND pipeline_id = ?"
            args.append(pipeline_id)
        if dataset_id:
            query += " AND dataset_id = ?"
            args.append(dataset_id)
        query += " ORDER BY started_at DESC LIMIT ?"
        args.append(limit)
        rows = conn.execute(query, args).fetchall()
        return [dict(r) for r in rows]


# Schedule functions
def create_schedule(pipeline_id: int, dataset_id: str | None, cron_expression: str) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO schedules (pipeline_id, dataset_id, cron_expression, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (pipeline_id, dataset_id, cron_expression, _utc_now())
        )
        return cur.lastrowid


def get_schedules(enabled_only: bool = False) -> list[dict]:
    with get_conn() as conn:
        query = "SELECT * FROM schedules"
        if enabled_only:
            query += " WHERE enabled = 1"
        query += " ORDER BY created_at DESC"
        rows = conn.execute(query).fetchall()
        return [dict(r) for r in rows]


def update_schedule(schedule_id: int, enabled: bool | None = None, cron_expression: str | None = None) -> bool:
    with get_conn() as conn:
        updates = []
        args = []
        if enabled is not None:
            updates.append("enabled = ?")
            args.append(enabled)
        if cron_expression:
            updates.append("cron_expression = ?")
            args.append(cron_expression)
        if updates:
            args.append(schedule_id)
            conn.execute(f"UPDATE schedules SET {', '.join(updates)} WHERE id = ?", args)
            return True
        return False


# Transformation rules functions
def create_transformation_rule(name: str, description: str | None, rules: str, created_by: str) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO transformation_rules (name, description, rules, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (name, description, rules, created_by, _utc_now(), _utc_now())
        )
        return cur.lastrowid


def get_transformation_rule(rule_id: int) -> dict | None:
    with get_conn() as conn:
        cur = conn.execute("SELECT * FROM transformation_rules WHERE id = ?", (rule_id,))
        row = cur.fetchone()
        return dict(row) if row else None


def list_transformation_rules(created_by: str | None = None) -> list[dict]:
    with get_conn() as conn:
        query = "SELECT * FROM transformation_rules WHERE 1=1"
        args = []
        if created_by:
            query += " AND created_by = ?"
            args.append(created_by)
        query += " ORDER BY created_at DESC"
        rows = conn.execute(query, args).fetchall()
        return [dict(r) for r in rows]


def update_transformation_rule(rule_id: int, name: str | None = None, description: str | None = None, rules: str | None = None) -> bool:
    with get_conn() as conn:
        updates = []
        args = []
        if name:
            updates.append("name = ?")
            args.append(name)
        if description is not None:
            updates.append("description = ?")
            args.append(description)
        if rules:
            updates.append("rules = ?")
            args.append(rules)
        if updates:
            updates.append("updated_at = ?")
            args.append(_utc_now())
            args.append(rule_id)
            conn.execute(f"UPDATE transformation_rules SET {', '.join(updates)} WHERE id = ?", args)
            return True
        return False


def delete_transformation_rule(rule_id: int) -> bool:
    with get_conn() as conn:
        cur = conn.execute("DELETE FROM transformation_rules WHERE id = ?", (rule_id,))
        return cur.rowcount > 0


# Dataset version functions
def create_dataset_version(
    dataset_id: str,
    version_number: int,
    file_path: str,
    row_count: int | None = None,
    quality_score: float | None = None,
    operation_type: str = "clean",
    operation_details: str | None = None,
    parent_version_id: int | None = None,
) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO dataset_versions (dataset_id, version_number, file_path, row_count, quality_score, operation_type, operation_details, created_at, parent_version_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (dataset_id, version_number, file_path, row_count, quality_score, operation_type, operation_details, _utc_now(), parent_version_id)
        )
        return cur.lastrowid


def get_dataset_versions(dataset_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM dataset_versions WHERE dataset_id = ? ORDER BY version_number DESC",
            (dataset_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def get_latest_version(dataset_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM dataset_versions WHERE dataset_id = ? ORDER BY version_number DESC LIMIT 1",
            (dataset_id,)
        ).fetchone()
        return dict(row) if row else None


def get_next_version_number(dataset_id: str) -> int:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT MAX(version_number) as max_version FROM dataset_versions WHERE dataset_id = ?",
            (dataset_id,)
        ).fetchone()
        return (row["max_version"] or 0) + 1


# Data lineage functions
def create_lineage_entry(
    dataset_id: str,
    operation: str,
    operation_details: str | None = None,
    source_dataset_id: str | None = None,
    input_columns: list[str] | None = None,
    output_columns: list[str] | None = None,
    rows_affected: int | None = None,
) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO data_lineage (dataset_id, source_dataset_id, operation, operation_details, input_columns, output_columns, rows_affected, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dataset_id,
                source_dataset_id,
                operation,
                operation_details,
                json.dumps(input_columns) if input_columns else None,
                json.dumps(output_columns) if output_columns else None,
                rows_affected,
                _utc_now(),
            )
        )
        return cur.lastrowid


def get_data_lineage(dataset_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM data_lineage WHERE dataset_id = ? ORDER BY created_at ASC",
            (dataset_id,)
        ).fetchall()
        lineage = []
        for row in rows:
            r = dict(row)
            if r["input_columns"]:
                r["input_columns"] = json.loads(r["input_columns"])
            if r["output_columns"]:
                r["output_columns"] = json.loads(r["output_columns"])
            lineage.append(r)
        return lineage


def get_data_lineage_batch(dataset_ids: list[str]) -> dict[str, list[dict]]:
    """Return lineage entries for multiple datasets in a single query."""
    if not dataset_ids:
        return {}
    placeholders = ",".join("?" * len(dataset_ids))
    with get_conn() as conn:
        rows = conn.execute(
            f"SELECT dataset_id, operation FROM data_lineage WHERE dataset_id IN ({placeholders})",
            dataset_ids,
        ).fetchall()
    result: dict[str, list[dict]] = {}
    for row in rows:
        result.setdefault(row["dataset_id"], []).append({"operation": row["operation"]})
    return result


def get_full_lineage(dataset_id: str) -> list[dict]:
    """Get full lineage tree including source datasets."""
    with get_conn() as conn:
        # Get all lineage entries for this dataset
        rows = conn.execute(
            "SELECT * FROM data_lineage WHERE dataset_id = ? ORDER BY created_at ASC",
            (dataset_id,)
        ).fetchall()
        
        lineage = []
        for row in rows:
            r = dict(row)
            if r["input_columns"]:
                r["input_columns"] = json.loads(r["input_columns"])
            if r["output_columns"]:
                r["output_columns"] = json.loads(r["output_columns"])
            
            # If there's a source dataset, get its lineage recursively
            if r["source_dataset_id"]:
                r["source_lineage"] = get_full_lineage(r["source_dataset_id"])
            
            lineage.append(r)
        
        return lineage


# Cleaning objectives functions
def create_cleaning_objective(
    name: str,
    objective_type: str,
    created_by: str,
    description: str | None = None,
    target_value: float | str | None = None,
    column_name: str | None = None,
    validation_rule: str | None = None,
    is_template: bool = False,
) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT INTO cleaning_objectives (name, description, objective_type, target_value, column_name, validation_rule, is_template, created_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                name,
                description,
                objective_type,
                str(target_value) if target_value else None,
                column_name,
                validation_rule,
                is_template,
                created_by,
                _utc_now(),
                _utc_now(),
            ),
        )
        return cur.lastrowid


def get_cleaning_objectives(created_by: str | None = None) -> list[dict]:
    with get_conn() as conn:
        if created_by:
            rows = conn.execute(
                "SELECT * FROM cleaning_objectives WHERE created_by = ? ORDER BY created_at DESC",
                (created_by,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM cleaning_objectives ORDER BY created_at DESC"
            ).fetchall()
        return [dict(r) for r in rows]


def get_cleaning_objective(objective_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM cleaning_objectives WHERE id = ?", (objective_id,)
        ).fetchone()
        return dict(row) if row else None


def update_cleaning_objective(
    objective_id: int,
    name: str | None = None,
    description: str | None = None,
    objective_type: str | None = None,
    target_value: float | str | None = None,
    column_name: str | None = None,
    validation_rule: str | None = None,
    is_template: bool | None = None,
) -> bool:
    with get_conn() as conn:
        updates = []
        params = []
        if name is not None:
            updates.append("name = ?")
            params.append(name)
        if description is not None:
            updates.append("description = ?")
            params.append(description)
        if objective_type is not None:
            updates.append("objective_type = ?")
            params.append(objective_type)
        if target_value is not None:
            updates.append("target_value = ?")
            params.append(str(target_value))
        if column_name is not None:
            updates.append("column_name = ?")
            params.append(column_name)
        if validation_rule is not None:
            updates.append("validation_rule = ?")
            params.append(validation_rule)
        if is_template is not None:
            updates.append("is_template = ?")
            params.append(is_template)
        
        updates.append("updated_at = ?")
        params.append(_utc_now())
        params.append(objective_id)
        
        if updates:
            conn.execute(
                f"UPDATE cleaning_objectives SET {', '.join(updates)} WHERE id = ?",
                params,
            )
        return True


def delete_cleaning_objective(objective_id: int) -> bool:
    with get_conn() as conn:
        conn.execute("DELETE FROM cleaning_objectives WHERE id = ?", (objective_id,))
        return True


def assign_objective_to_dataset(dataset_id: str, objective_id: int) -> int:
    with get_conn() as conn:
        cur = conn.execute(
            """
            INSERT OR REPLACE INTO dataset_objectives (dataset_id, objective_id, status, created_at)
            VALUES (?, ?, 'pending', ?)
            """,
            (dataset_id, objective_id, _utc_now()),
        )
        return cur.lastrowid


def get_dataset_objectives(dataset_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT do.*, co.name, co.objective_type, co.target_value, co.column_name, co.validation_rule
            FROM dataset_objectives do
            JOIN cleaning_objectives co ON do.objective_id = co.id
            WHERE do.dataset_id = ?
            ORDER BY do.created_at DESC
            """,
            (dataset_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def register_user(username: str, password_hash: str, email: str | None = None, role: str = "user") -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT INTO users (username, password_hash, email, role, created_at) VALUES (?, ?, ?, ?, ?)",
            (username, password_hash, email, role, _utc_now()),
        )


def get_user_by_username(username: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT username, password_hash, email, role, created_at FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        return dict(row) if row else None


def username_exists(username: str) -> bool:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM users WHERE username = ?", (username,)
        ).fetchone()
        return row is not None


def update_user_password(username: str, new_password_hash: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE users SET password_hash = ? WHERE username = ?",
            (new_password_hash, username),
        )


def update_user_role(username: str, role: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "UPDATE users SET role = ? WHERE username = ?",
            (role, username),
        )


def delete_user(username: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM users WHERE username = ?", (username,))


def list_all_users() -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT username, email, role, created_at FROM users ORDER BY created_at DESC"
        ).fetchall()
        return [dict(r) for r in rows]


def count_datasets_for_user(user: str) -> int:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT COUNT(*) FROM datasets WHERE created_by = ?", (user,)
        ).fetchone()
        return row[0] if row else 0


def revoke_token(jti: str, expires_at: str) -> None:
    """Add a JWT jti to the blocklist so it cannot be used after logout."""
    with get_conn() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO token_blocklist (jti, expires_at, revoked_at) VALUES (?, ?, ?)",
            (jti, expires_at, _utc_now()),
        )


def is_token_revoked(jti: str) -> bool:
    """Return True if the token jti has been explicitly revoked."""
    with get_conn() as conn:
        row = conn.execute(
            "SELECT 1 FROM token_blocklist WHERE jti = ? LIMIT 1", (jti,)
        ).fetchone()
        return row is not None


def cleanup_expired_tokens() -> int:
    """Delete blocklist entries whose token has already expired. Returns count deleted."""
    now = _utc_now()
    with get_conn() as conn:
        conn.execute("DELETE FROM token_blocklist WHERE expires_at < ?", (now,))
    return 0


def get_comments(dataset_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM dataset_comments WHERE dataset_id = ? ORDER BY created_at ASC",
            (dataset_id,),
        ).fetchall()
        return [dict(r) for r in rows]


def get_comment(comment_id: int) -> dict | None:
    with get_conn() as conn:
        row = conn.execute("SELECT * FROM dataset_comments WHERE id = ?", (comment_id,)).fetchone()
        return dict(row) if row else None


def create_comment(dataset_id: str, author: str, content: str) -> int:
    with get_conn() as conn:
        cursor = conn.execute(
            "INSERT INTO dataset_comments (dataset_id, author, content, created_at) VALUES (?, ?, ?, ?)",
            (dataset_id, author, content, _utc_now()),
        )
        return cursor.lastrowid


def delete_comment(comment_id: int) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM dataset_comments WHERE id = ?", (comment_id,))


def create_api_key(user: str, name: str, key_hash: str, key_prefix: str) -> int:
    with get_conn() as conn:
        cursor = conn.execute(
            "INSERT INTO api_keys (user, name, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?)",
            (user, name, key_hash, key_prefix, _utc_now()),
        )
        return cursor.lastrowid


def list_api_keys(user: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, user, name, key_prefix, created_at, last_used_at FROM api_keys WHERE user = ? ORDER BY created_at DESC",
            (user,),
        ).fetchall()
        return [dict(r) for r in rows]


def delete_api_key(key_id: int, user: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM api_keys WHERE id = ? AND user = ?", (key_id, user))


def verify_api_key(key: str) -> str | None:
    """Return the owner username if the key is valid, else None. Updates last_used_at."""
    import hashlib
    key_hash = hashlib.sha256(key.encode()).hexdigest()
    with get_conn() as conn:
        row = conn.execute(
            "SELECT user FROM api_keys WHERE key_hash = ?", (key_hash,)
        ).fetchone()
        if row:
            conn.execute(
                "UPDATE api_keys SET last_used_at = ? WHERE key_hash = ?",
                (_utc_now(), key_hash),
            )
            return row["user"]
    return None


# ── Session helpers ───────────────────────────────────────────────────────────

def record_session(jti: str, username: str, ip: str | None, user_agent: str | None, expires_at: str) -> None:
    with get_conn() as conn:
        conn.execute(
            "INSERT OR IGNORE INTO user_sessions (jti, username, ip, user_agent, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)",
            (jti, username, ip, user_agent, _utc_now(), expires_at),
        )


def get_user_sessions(username: str) -> list[dict]:
    now = _utc_now()
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM user_sessions WHERE username = ? AND expires_at > ? AND revoked = 0 ORDER BY created_at DESC",
            (username, now),
        ).fetchall()
        return [dict(r) for r in rows]


def revoke_session(jti: str, username: str) -> bool:
    with get_conn() as conn:
        conn.execute(
            "UPDATE user_sessions SET revoked = 1 WHERE jti = ? AND username = ?",
            (jti, username),
        )
    return True


def get_all_sessions(active_only: bool = True) -> list[dict]:
    now = _utc_now()
    with get_conn() as conn:
        if active_only:
            rows = conn.execute(
                "SELECT * FROM user_sessions WHERE expires_at > ? AND revoked = 0 ORDER BY created_at DESC",
                (now,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM user_sessions ORDER BY created_at DESC LIMIT 500",
            ).fetchall()
        return [dict(r) for r in rows]


def force_revoke_session(jti: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE user_sessions SET revoked = 1 WHERE jti = ?", (jti,))


# ── Webhook helpers ──────────────────────────────────────────────────────────

def create_webhook(user: str, url: str, events: list[str], secret: str) -> int:
    import json as _j
    with get_conn() as conn:
        cursor = conn.execute(
            "INSERT INTO webhooks (user, url, events, secret, created_at) VALUES (?, ?, ?, ?, ?)",
            (user, url, _j.dumps(events), secret, _utc_now()),
        )
        return cursor.lastrowid


def list_webhooks(user: str) -> list[dict]:
    import json as _j
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM webhooks WHERE user = ? ORDER BY created_at DESC",
            (user,),
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            try:
                d["events"] = _j.loads(d["events"])
            except Exception:
                d["events"] = []
            result.append(d)
        return result


def get_webhook(webhook_id: int, user: str) -> dict | None:
    import json as _j
    with get_conn() as conn:
        row = conn.execute(
            "SELECT * FROM webhooks WHERE id = ? AND user = ?",
            (webhook_id, user),
        ).fetchone()
        if not row:
            return None
        d = dict(row)
        try:
            d["events"] = _j.loads(d["events"])
        except Exception:
            d["events"] = []
        return d


def update_webhook(webhook_id: int, user: str, *, url: str | None = None, events: list | None = None, enabled: bool | None = None) -> None:
    import json as _j
    updates, params = [], []
    if url is not None:
        updates.append("url = ?"); params.append(url)
    if events is not None:
        updates.append("events = ?"); params.append(_j.dumps(events))
    if enabled is not None:
        updates.append("enabled = ?"); params.append(1 if enabled else 0)
    if not updates:
        return
    params.extend([webhook_id, user])
    with get_conn() as conn:
        conn.execute(f"UPDATE webhooks SET {', '.join(updates)} WHERE id = ? AND user = ?", params)


def delete_webhook(webhook_id: int, user: str) -> None:
    with get_conn() as conn:
        conn.execute("DELETE FROM webhooks WHERE id = ? AND user = ?", (webhook_id, user))


def get_webhooks_for_event(event: str) -> list[dict]:
    """Return all enabled webhooks that subscribe to *event*."""
    import json as _j
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM webhooks WHERE enabled = 1",
        ).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            try:
                d["events"] = _j.loads(d["events"])
            except Exception:
                d["events"] = []
            if event in d["events"] or "*" in d["events"]:
                result.append(d)
        return result


def record_webhook_result(webhook_id: int, status: str, success: bool) -> None:
    with get_conn() as conn:
        if success:
            conn.execute(
                "UPDATE webhooks SET last_fired_at = ?, last_status = ?, failure_count = 0 WHERE id = ?",
                (_utc_now(), status, webhook_id),
            )
        else:
            conn.execute(
                "UPDATE webhooks SET last_fired_at = ?, last_status = ?, failure_count = failure_count + 1 WHERE id = ?",
                (_utc_now(), status, webhook_id),
            )


# ── TOTP helpers ──────────────────────────────────────────────────────────────

def set_totp_secret(username: str, secret: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE users SET totp_secret = ? WHERE username = ?", (secret, username))


def enable_totp(username: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE users SET totp_enabled = 1 WHERE username = ?", (username,))


def disable_totp(username: str) -> None:
    with get_conn() as conn:
        conn.execute("UPDATE users SET totp_secret = NULL, totp_enabled = 0 WHERE username = ?", (username,))


def get_totp_info(username: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            "SELECT totp_secret, totp_enabled FROM users WHERE username = ?", (username,)
        ).fetchone()
        return dict(row) if row else None


def update_objective_status(dataset_id: str, objective_id: int, status: str, result_value: str | None = None) -> bool:
    with get_conn() as conn:
        updates = ["status = ?", "completed_at = ?"]
        params = [status, _utc_now()]
        if result_value is not None:
            updates.append("result_value = ?")
            params.append(result_value)
        params.extend([dataset_id, objective_id])
        
        conn.execute(
            f"UPDATE dataset_objectives SET {', '.join(updates)} WHERE dataset_id = ? AND objective_id = ?",
            params,
        )
        return True
