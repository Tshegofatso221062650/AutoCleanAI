from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


def _default_project_root() -> Path:
    p = Path(__file__).resolve()
    parts = p.parts
    if len(parts) >= 3 and parts[-3] == "backend" and parts[-2] == "app":
        return p.parents[2]
    # Docker layout: /app/app/config.py -> data lives in /app
    return p.parents[1]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    secret_key: str = "change-me-in-production-use-long-random-string"
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24 * 7

    # Single-user password (only when AUTOCLEAN_DISABLE_AUTH=false)
    autoclean_password: str = "changeme"
    # Set to true only for local single-user use. MUST be false for any shared/public deployment.
    autoclean_disable_auth: bool = False
    # Set to true to prevent new user self-registration (admin creates accounts manually)
    disable_registration: bool = False
    # Comma-separated list of allowed CORS origins. Defaults to localhost only.
    allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"
    # Max datasets per user (0 = unlimited). Prevents storage abuse.
    max_datasets_per_user: int = 0

    openai_api_key: str | None = None
    openai_model: str = "gpt-4o-mini"
    ollama_base_url: str = "http://127.0.0.1:11434"
    ollama_model: str = "phi3:mini"
    ollama_timeout: float = 300.0  # seconds; raise if model cold-starts slowly

    ai_provider: str = "ollama"  # openai | ollama | none

    # ── Database ─────────────────────────────────────────────────────────────
    # Leave empty to use the default SQLite file.
    # Set to a PostgreSQL URL to switch to Postgres:
    #   DATABASE_URL=postgresql://user:pass@host:5432/dbname
    # Requires psycopg2 or psycopg2-binary to be installed separately.
    database_url: str | None = None

    # ── SMTP / Email ─────────────────────────────────────────────────────────
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    smtp_tls: bool = True   # STARTTLS when True, plain when False

    # ── Upload limits ────────────────────────────────────────────────────────
    max_upload_mb: int = 500  # 0 = unlimited

    @property
    def cors_origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    project_root: Path = Field(default_factory=_default_project_root)

    @property
    def data_dir(self) -> Path:
        return self.project_root / "data" / "uploads"

    @property
    def exports_dir(self) -> Path:
        return self.project_root / "exports"

    @property
    def history_db(self) -> Path:
        return self.project_root / "history" / "autoclean.db"


settings = Settings()
settings.data_dir.mkdir(parents=True, exist_ok=True)
settings.exports_dir.mkdir(parents=True, exist_ok=True)
settings.history_db.parent.mkdir(parents=True, exist_ok=True)
