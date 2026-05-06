import re

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from typing import Optional

from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from app.auth import create_access_token, hash_password, require_admin, require_auth, verify_password, decode_token

_security = HTTPBearer(auto_error=False)
from app.db import (
    get_setting, set_setting, register_user, get_user_by_username, username_exists,
    update_user_password, revoke_token, cleanup_expired_tokens,
    record_session, get_user_sessions, revoke_session, get_all_sessions, force_revoke_session,
    set_totp_secret, enable_totp, disable_totp, get_totp_info, delete_user, get_conn,
)
from app.config import settings
from app.schemas import ChangePasswordRequest, LoginRequest, TokenResponse
from app.services.security import login_limiter, register_limiter, account_lockout
from app.services import email_service
from app.db import write_audit_log

router = APIRouter(prefix="/auth", tags=["auth"])


class RegisterRequest(BaseModel):
    username: str
    password: str
    email: str


class UserLoginRequest(BaseModel):
    username: str
    password: str
    totp_code: str | None = None


@router.post("/logout")
def logout(credentials: HTTPAuthorizationCredentials | None = Depends(_security), user: str = Depends(require_auth)):
    """Invalidate the current JWT so it cannot be reused after logout."""
    cleanup_expired_tokens()
    if credentials and credentials.credentials:
        try:
            from datetime import datetime, timezone
            payload = decode_token(credentials.credentials)
            jti = payload.get("jti")
            exp = payload.get("exp")
            if jti and exp:
                expires_iso = datetime.fromtimestamp(exp, tz=timezone.utc).isoformat()
                revoke_token(jti, expires_iso)
        except Exception:
            pass
    write_audit_log("logout", user)
    return {"ok": True}


@router.get("/status")
def auth_status():
    """Public: tells the UI whether a password is required."""
    return {"disable_auth": settings.autoclean_disable_auth}


@router.post("/login", response_model=TokenResponse)
def login(request: Request, body: LoginRequest):
    if settings.autoclean_disable_auth:
        return TokenResponse(access_token=create_access_token())
    client_ip = request.client.host if request.client else "unknown"
    rate_key = f"{client_ip}:login"
    if not login_limiter.allow(rate_key):
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again in a minute.")
    if account_lockout.is_locked("owner"):
        secs = account_lockout.seconds_until_unlock("owner")
        raise HTTPException(status_code=429, detail=f"Account locked. Try again in {secs}s.")
    stored_hash = get_setting("password_hash")
    if not stored_hash:
        set_setting("password_hash", hash_password(settings.autoclean_password))
        stored_hash = get_setting("password_hash")
    assert stored_hash
    if not verify_password(body.password, stored_hash):
        account_lockout.record_failure("owner")
        write_audit_log("login_failed", "owner", ip=client_ip)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    account_lockout.record_success("owner")
    login_limiter.reset(rate_key)
    write_audit_log("login_success", "owner", ip=client_ip)
    token = create_access_token()
    return TokenResponse(access_token=token)


@router.post("/login/user", response_model=TokenResponse)
def login_user(request: Request, body: UserLoginRequest):
    """Multi-user login: authenticate with username + password."""
    client_ip = request.client.host if request.client else "unknown"
    rate_key = f"{client_ip}:login"
    if not login_limiter.allow(rate_key):
        raise HTTPException(status_code=429, detail="Too many login attempts. Try again in a minute.")
    username = (body.username or "").strip().lower()
    if not username:
        raise HTTPException(status_code=400, detail="username is required")
    if account_lockout.is_locked(username):
        secs = account_lockout.seconds_until_unlock(username)
        raise HTTPException(status_code=429, detail=f"Account locked. Try again in {secs}s.")
    user = get_user_by_username(username)
    # Constant-time: always attempt verify even if user missing to prevent timing attacks
    dummy_hash = "$2b$12$placeholder000000000000000000000000000000000000000000"
    pw_hash = user["password_hash"] if (user and user.get("password_hash")) else dummy_hash
    if not user or not user.get("password_hash") or not verify_password(body.password, pw_hash):
        account_lockout.record_failure(username)
        write_audit_log("login_failed", username, ip=client_ip)
        raise HTTPException(status_code=401, detail="Invalid credentials")
    account_lockout.record_success(username)
    login_limiter.reset(rate_key)

    totp_info = get_totp_info(username)
    if totp_info and totp_info.get("totp_enabled"):
        if not body.totp_code:
            return {"totp_required": True}
        try:
            import pyotp
            totp_obj = pyotp.TOTP(totp_info["totp_secret"])
            if not totp_obj.verify(body.totp_code, valid_window=1):
                write_audit_log("totp_failed", username, ip=client_ip)
                raise HTTPException(status_code=401, detail="Invalid TOTP code")
        except ImportError:
            pass

    write_audit_log("login_success", username, ip=client_ip)
    token = create_access_token(sub=username)
    try:
        from datetime import datetime, timezone, timedelta
        payload = decode_token(token)
        jti = payload.get("jti", "")
        exp = payload.get("exp", 0)
        expires_iso = datetime.fromtimestamp(exp, tz=timezone.utc).isoformat()
        ua = request.headers.get("user-agent", "")[:256]
        record_session(jti, username, client_ip, ua, expires_iso)
    except Exception:
        pass
    return TokenResponse(access_token=token)


@router.post("/register")
def register(request: Request, body: RegisterRequest):
    """Register a new user account (multi-user mode)."""
    allow_reg_stored = get_setting("allow_registration")
    if allow_reg_stored == "false" or (allow_reg_stored is None and settings.disable_registration):
        raise HTTPException(status_code=403, detail="Registration is disabled. Contact an administrator.")
    client_ip = request.client.host if request.client else "unknown"
    if not register_limiter.allow(f"{client_ip}:register"):
        raise HTTPException(status_code=429, detail="Too many registration attempts. Try again later.")
    username = (body.username or "").strip().lower()
    if not username or len(username) < 3:
        raise HTTPException(status_code=400, detail="Username must be at least 3 characters")
    if len(username) > 50:
        raise HTTPException(status_code=400, detail="Username too long (max 50 chars)")
    if not re.match(r"^[a-z0-9_\-\.]+$", username):
        raise HTTPException(status_code=400, detail="Username may only contain letters, digits, _ - .")
    password = body.password or ""
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if len(password) > 128:
        raise HTTPException(status_code=400, detail="Password too long")
    email = (body.email or "").strip().lower()
    if not email or "@" not in email or "." not in email.split("@")[-1]:
        raise HTTPException(status_code=400, detail="A valid email address is required")
    if username_exists(username):
        raise HTTPException(status_code=409, detail="Username already taken")
    register_user(username=username, password_hash=hash_password(password), email=email)
    write_audit_log("register", username, detail=body.email, ip=client_ip)
    if body.email:
        import threading
        threading.Thread(
            target=email_service.send_welcome_email,
            args=(body.email, username),
            daemon=True,
        ).start()
    token = create_access_token(sub=username)
    return {"username": username, "access_token": token, "message": "Account created successfully"}


@router.get("/me")
def me(user: str = Depends(require_auth)):
    """Return the currently authenticated user."""
    if user == "owner":
        return {"username": "owner", "role": "admin"}
    record = get_user_by_username(user)
    if not record:
        return {"username": user, "role": "user"}
    return {"username": record["username"], "email": record.get("email"), "role": record.get("role", "user"), "created_at": record["created_at"]}


@router.get("/audit-log")
def audit_log(limit: int = 100, user: str = Depends(require_admin)):
    """Return recent audit log entries (admin/owner only)."""
    from app.db import get_conn
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?", (min(limit, 1000),)
        ).fetchall()
    return {"entries": [dict(r) for r in rows]}


@router.get("/sessions")
def list_sessions(
    credentials: HTTPAuthorizationCredentials | None = Depends(_security),
    user: str = Depends(require_auth),
):
    """List active sessions for the current user."""
    current_jti = None
    if credentials and credentials.credentials:
        try:
            current_jti = decode_token(credentials.credentials).get("jti")
        except Exception:
            pass
    sessions = get_user_sessions(user)
    return {
        "sessions": [
            {**s, "is_current": s["jti"] == current_jti}
            for s in sessions
        ]
    }


@router.delete("/sessions/{jti}")
def revoke_session_endpoint(jti: str, user: str = Depends(require_auth)):
    """Revoke a specific session by its JTI."""
    revoke_session(jti, user)
    revoke_token(jti, "")
    write_audit_log("session_revoked", user, detail=jti)
    return {"ok": True}


@router.get("/totp/status")
def totp_status(user: str = Depends(require_auth)):
    """Return whether TOTP is enabled for the current user."""
    if user == "owner":
        return {"enabled": False, "available": False}
    info = get_totp_info(user)
    enabled = bool(info and info.get("totp_enabled"))
    return {"enabled": enabled}


@router.post("/totp/setup")
def totp_setup(user: str = Depends(require_auth)):
    """Generate a new TOTP secret and return a provisioning URI."""
    if user == "owner":
        raise HTTPException(400, "TOTP not available for the owner account")
    try:
        import pyotp
    except ImportError:
        raise HTTPException(501, "pyotp not installed — run: pip install pyotp")
    secret = pyotp.random_base32()
    set_totp_secret(user, secret)
    totp = pyotp.TOTP(secret)
    uri = totp.provisioning_uri(name=user, issuer_name="AutoClean AI")
    return {"secret": secret, "provisioning_uri": uri}


class TotpVerifyRequest(BaseModel):
    code: str


@router.post("/totp/verify")
def totp_verify(body: TotpVerifyRequest, user: str = Depends(require_auth)):
    """Verify a TOTP code and enable 2FA on success."""
    try:
        import pyotp
    except ImportError:
        raise HTTPException(501, "pyotp not installed")
    info = get_totp_info(user)
    if not info or not info.get("totp_secret"):
        raise HTTPException(400, "No TOTP secret set — call /auth/totp/setup first")
    totp = pyotp.TOTP(info["totp_secret"])
    if not totp.verify(body.code, valid_window=1):
        raise HTTPException(400, "Invalid TOTP code")
    enable_totp(user)
    write_audit_log("totp_enabled", user)
    return {"ok": True, "message": "2FA enabled"}


@router.delete("/totp")
def totp_disable(body: TotpVerifyRequest, user: str = Depends(require_auth)):
    """Disable TOTP — requires a valid code to confirm."""
    try:
        import pyotp
    except ImportError:
        raise HTTPException(501, "pyotp not installed")
    info = get_totp_info(user)
    if not info or not info.get("totp_enabled"):
        raise HTTPException(400, "2FA is not enabled")
    totp = pyotp.TOTP(info["totp_secret"])
    if not totp.verify(body.code, valid_window=1):
        raise HTTPException(400, "Invalid TOTP code")
    disable_totp(user)
    write_audit_log("totp_disabled", user)
    return {"ok": True, "message": "2FA disabled"}


@router.post("/change-password")
def change_password(body: ChangePasswordRequest, user: str = Depends(require_auth)):
    if user == "owner":
        stored_hash = get_setting("password_hash")
        if not stored_hash:
            set_setting("password_hash", hash_password(settings.autoclean_password))
            stored_hash = get_setting("password_hash")
        if not verify_password(body.current_password, stored_hash):
            raise HTTPException(status_code=401, detail="Invalid current password")
        set_setting("password_hash", hash_password(body.new_password))
    else:
        record = get_user_by_username(user)
        if not record or not record.get("password_hash") or not verify_password(body.current_password, record["password_hash"]):
            raise HTTPException(status_code=401, detail="Invalid current password")
        update_user_password(user, hash_password(body.new_password))
    write_audit_log("password_changed", user)
    return {"ok": True}


class DeleteAccountRequest(BaseModel):
    password: str


@router.delete("/me")
def delete_own_account(body: DeleteAccountRequest, user: str = Depends(require_auth)):
    """Self-service account deletion. Requires current password. Purges all user data."""
    if user == "owner":
        raise HTTPException(400, "The owner account cannot be deleted. Change the password in .env instead.")
    record = get_user_by_username(user)
    if not record:
        raise HTTPException(404, "User not found")
    if not verify_password(body.password, record.get("password_hash", "")):
        raise HTTPException(401, "Incorrect password")
    import shutil
    from pathlib import Path
    from app.services.storage import dataset_dir
    # Revoke all sessions
    for s in get_user_sessions(user):
        try:
            revoke_token(s["jti"], "")
        except Exception:
            pass
    # Delete all datasets owned by the user (files + DB rows)
    with get_conn() as conn:
        rows = conn.execute(
            "SELECT id, stored_path FROM datasets WHERE created_by = ?", (user,)
        ).fetchall()
    for row in rows:
        try:
            d = dataset_dir(row["id"])
            if d.exists():
                shutil.rmtree(d, ignore_errors=True)
        except Exception:
            pass
    with get_conn() as conn:
        conn.execute("DELETE FROM datasets WHERE created_by = ?", (user,))
    write_audit_log("account_deleted", user)
    delete_user(user)
    return {"ok": True}


# ── Admin endpoints ───────────────────────────────────────────────────────────

@router.get("/sessions/all")
def list_all_sessions_admin(active_only: bool = True, admin: str = Depends(require_admin)):
    """Admin: list all active sessions across all users."""
    sessions = get_all_sessions(active_only=active_only)
    return {"sessions": sessions, "count": len(sessions)}


@router.delete("/sessions/{jti}/force")
def force_revoke_session_admin(jti: str, admin: str = Depends(require_admin)):
    """Admin: forcibly revoke any session by JTI."""
    force_revoke_session(jti)
    revoke_token(jti, "")
    write_audit_log("admin_session_revoked", admin, detail=jti)
    return {"ok": True}


class TestEmailRequest(BaseModel):
    to: str


@router.post("/test-email")
def send_test_email(body: TestEmailRequest, admin: str = Depends(require_admin)):
    """Admin: send a test email to verify SMTP configuration."""
    if not body.to or "@" not in body.to:
        raise HTTPException(400, "Invalid email address")
    ok = email_service.send_test_email(body.to)
    if not ok:
        raise HTTPException(503, "Failed to send email — check SMTP configuration in environment variables (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM)")
    write_audit_log("test_email_sent", admin, detail=body.to)
    return {"ok": True, "message": f"Test email sent to {body.to}"}
