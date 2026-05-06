# AutoClean AI — Multi-User Platform

A full-stack data cleaning and profiling platform supporting **multiple users**, JWT authentication, TOTP 2FA, webhook integrations, SMTP email, and a rich admin panel. Upload, profile, clean, visualize, and export datasets (CSV, XLSX, JSON). Original files are never overwritten; cleaned copies go to `exports/`.

## Architecture

| Layer | Stack |
|-------|-------|
| Frontend | Next.js 14, TypeScript, Tailwind CSS, Recharts, lucide-react |
| API | FastAPI, JWT bearer auth, SQLite (or PostgreSQL via `DATABASE_URL`) |
| Engine | Pandas, NumPy, scikit-learn, `difflib` (typos), optional Great Expectations |
| AI chat | OpenAI API or Ollama (local); heuristic fallback |
| 2FA | pyotp (TOTP — Google Authenticator compatible) |
| Email | SMTP via stdlib `smtplib` (STARTTLS / SSL) |

```
dataset AI/
├── frontend/              # Next.js UI
│   └── src/app/
│       ├── admin/         # Admin panel (users, sessions, audit, settings)
│       ├── profile/       # User profile, active sessions, TOTP 2FA, API keys
│       ├── webhooks/      # Webhook management
│       └── ...            # upload, analysis, cleaning, history, reports, etc.
├── backend/app/
│   ├── routers/           # FastAPI route handlers
│   ├── services/          # cleaning engine, analysis, webhooks, email, ACL
│   └── db.py              # SQLite helpers (sessions, webhooks, TOTP, audit log…)
├── data/uploads/          # Original uploads (per dataset UUID)
├── exports/               # Cleaned / transformed outputs
├── history/               # SQLite DB file
└── autoclean.py           # CLI mode
```

## Quick Start (Windows)

### 1. Backend

Requires **Python 3.11–3.14**.

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy ..\.env.example .env   # then edit .env
uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Health check: http://127.0.0.1:8000/health

### 2. Frontend

```powershell
cd frontend
npm install
$env:NEXT_PUBLIC_API_URL="http://127.0.0.1:8000"
npm run dev
```

Open http://localhost:3000

### 3. CLI (optional)

```powershell
python autoclean.py .\data\example\customers_messy.csv
```

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SECRET_KEY` | *(required)* | JWT signing secret |
| `AUTOCLEAN_PASSWORD` | `changeme` | Owner account password |
| `AUTOCLEAN_DISABLE_AUTH` | `false` | Skip auth entirely (local dev only) |
| `DISABLE_REGISTRATION` | `false` | Block self-registration (overridden by admin toggle) |
| `DATABASE_URL` | SQLite | PostgreSQL connection string (e.g. `postgresql://user:pw@host/db`) |
| `SMTP_HOST` | — | SMTP server hostname |
| `SMTP_PORT` | `587` | SMTP port |
| `SMTP_USER` | — | SMTP username |
| `SMTP_PASSWORD` | — | SMTP password |
| `SMTP_FROM` | — | From address for outgoing email |
| `SMTP_TLS` | `true` | Use STARTTLS |
| `OPENAI_API_KEY` | — | OpenAI key (optional, for AI chat) |
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama endpoint |

## Features

### Data Pipeline
- Upload CSV, XLSX, JSON (streaming, no size limit)
- Automatic schema detection and profiling
- AI-assisted cleaning: missing values, duplicates, outliers, typos, email validation
- Before/after diff view, column health grid, quality score arc
- Batch operations: run the same pipeline across multiple datasets
- Transformation pipeline: filter, rename, cast, derive columns
- Export to CSV, JSON, XLSX; download signed reports

### Authentication & Security
- **Owner account** (password in env) + **multi-user** registration
- JWT bearer tokens with JTI session tracking
- **TOTP 2FA** — setup via profile page, enforced at login (Google Authenticator / Authy)
- Account lockout after repeated failures, rate limiting on login/register
- Token blocklist on logout / session revoke
- Per-resource ACL (users see only their own datasets unless shared)

### User Management (Admin Panel `/admin`)
- List, promote/demote, delete users
- **Create users directly** (critical when self-registration is disabled)
- Force-reset passwords (triggers password reset email if SMTP configured)
- Toggle self-registration on/off at runtime (no restart needed)
- View and force-revoke all active sessions platform-wide
- Full audit log with search/filter + CSV export

### Sessions
- Every login records IP, User-Agent, expiry
- Profile page shows your own active sessions with per-session revoke
- Admin panel shows all sessions across all users

### SMTP Email
- Welcome email on registration
- Password reset notification when admin changes a password
- SMTP test button in admin panel to verify configuration

### Webhooks
- Per-user webhook subscriptions with HMAC-SHA256 signatures
- Events: `dataset.uploaded`, `dataset.analyzed`, `dataset.cleaned`, `pipeline.run`, `*` (wildcard)
- Enable/disable per webhook; tracks last fired and failure count
- Manage from `/webhooks` page with one-time secret reveal on creation

### Collaboration
- Share datasets and annotations with other users
- Comments and annotations per dataset

### Insights
- Analytics, profiling, and quality dashboards
- Quality score trends over time
- Reports listing with filters and download

## API Reference (key endpoints)

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/auth/status` | no | Auth config |
| POST | `/auth/login` | no | Owner login |
| POST | `/auth/login/user` | no | User login (supports `totp_code`) |
| POST | `/auth/register` | no | Self-registration |
| POST | `/auth/logout` | Bearer | Revoke current token |
| GET | `/auth/sessions` | Bearer | Own active sessions |
| DELETE | `/auth/sessions/{jti}` | Bearer | Revoke own session |
| GET | `/auth/sessions/all` | Admin | All platform sessions |
| DELETE | `/auth/sessions/{jti}/force` | Admin | Force-revoke any session |
| GET | `/auth/totp/status` | Bearer | TOTP enabled? |
| POST | `/auth/totp/setup` | Bearer | Generate TOTP secret |
| POST | `/auth/totp/verify` | Bearer | Verify + enable TOTP |
| DELETE | `/auth/totp` | Bearer | Disable TOTP |
| POST | `/auth/test-email` | Admin | Test SMTP config |
| GET | `/users` | Admin | List all users |
| POST | `/users/create` | Admin | Create user directly |
| PATCH | `/users/{u}/role` | Admin | Promote / demote |
| POST | `/users/{u}/reset-password` | Admin | Force-reset password |
| POST | `/upload` | Bearer | Upload dataset |
| POST | `/analyze` | Bearer | Profile dataset |
| POST | `/clean` | Bearer | Clean dataset |
| POST | `/transform` | Bearer | Apply transformation pipeline |
| GET | `/history` | Bearer | Dataset list |
| GET | `/download/{id}/{fmt}` | Bearer | Export CSV/JSON/XLSX |
| GET | `/webhooks/` | Bearer | List own webhooks |
| POST | `/webhooks/` | Bearer | Create webhook |
| PATCH | `/webhooks/{id}` | Bearer | Update webhook |
| DELETE | `/webhooks/{id}` | Bearer | Delete webhook |
| GET | `/settings` | Bearer | Get settings |
| POST | `/settings` | Admin | Update settings incl. registration toggle |

## Docker

```bash
docker compose up --build
```

Set `NEXT_PUBLIC_API_URL` in `docker-compose.yml` to the API URL visible from the browser.

## Great Expectations (optional)

```powershell
pip install -r backend/requirements-optional-ge.txt
```

Used automatically if importable; adds a smoke summary to `analyze` results.

## Example data

See `data/example/customers_messy.csv` and `data/example/sales.json`.
