import re
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from app.auth import require_admin, require_auth, hash_password
from app.db import list_all_users, get_user_by_username, update_user_role, delete_user, count_datasets_for_user, update_user_password, register_user, username_exists
from app.db import write_audit_log
from app.services import email_service

router = APIRouter(tags=["users"])


class RoleUpdate(BaseModel):
    role: str  # "user" | "admin"


class PasswordResetRequest(BaseModel):
    new_password: str


class CreateUserRequest(BaseModel):
    username: str
    password: str
    email: str | None = None
    role: str = "user"


@router.post("/users/create")
def admin_create_user(body: CreateUserRequest, admin: str = Depends(require_admin)):
    """Admin: directly create a new user account."""
    username = (body.username or "").strip().lower()
    if not username or len(username) < 3:
        raise HTTPException(400, "Username must be at least 3 characters")
    if len(username) > 50:
        raise HTTPException(400, "Username too long")
    if not re.match(r"^[a-z0-9_\-\.]+$", username):
        raise HTTPException(400, "Username may only contain letters, digits, _ - .")
    if not body.password or len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    if body.role not in ("user", "admin"):
        raise HTTPException(400, "role must be 'user' or 'admin'")
    if username_exists(username):
        raise HTTPException(409, "Username already taken")
    register_user(username=username, password_hash=hash_password(body.password), email=body.email)
    if body.role == "admin":
        update_user_role(username, "admin")
    write_audit_log("admin_create_user", admin, resource_type="user", resource_id=username, detail=body.email)
    if body.email:
        import threading
        threading.Thread(
            target=email_service.send_welcome_email,
            args=(body.email, username),
            daemon=True,
        ).start()
    return {"ok": True, "username": username, "role": body.role}


@router.get("/users")
def list_users(admin: str = Depends(require_admin)):
    """Admin: list all registered users with dataset counts."""
    users = list_all_users()
    for u in users:
        u["dataset_count"] = count_datasets_for_user(u["username"])
    return {"users": users}


@router.get("/users/names")
def list_usernames(user: str = Depends(require_auth)):
    """Return just usernames for sharing autocomplete (available to all authenticated users)."""
    users = list_all_users()
    return {"users": [{"username": u["username"]} for u in users if u["username"] != user]}


@router.get("/users/me")
def get_my_profile(user: str = Depends(require_auth)):
    """Return the current user's own profile."""
    if user == "owner":
        return {"username": "owner", "role": "admin", "email": None}
    record = get_user_by_username(user)
    if not record:
        raise HTTPException(404, "User not found")
    return {"username": record["username"], "email": record.get("email"), "role": record.get("role", "user"), "created_at": record["created_at"]}


@router.patch("/users/{username}/role")
def set_user_role(username: str, body: RoleUpdate, admin: str = Depends(require_admin)):
    """Admin: promote or demote a user."""
    if body.role not in ("user", "admin"):
        raise HTTPException(400, "role must be 'user' or 'admin'")
    if username == "owner":
        raise HTTPException(400, "Cannot change role of built-in owner account")
    record = get_user_by_username(username)
    if not record:
        raise HTTPException(404, "User not found")
    update_user_role(username, body.role)
    write_audit_log("role_change", admin, resource_type="user", resource_id=username, detail=body.role)
    return {"username": username, "role": body.role}


@router.post("/users/{username}/reset-password")
def reset_user_password(username: str, body: PasswordResetRequest, admin: str = Depends(require_admin)):
    """Admin: force-set a new password for any user."""
    if username == "owner":
        raise HTTPException(400, "Use /auth/change-password to change the owner password")
    record = get_user_by_username(username)
    if not record:
        raise HTTPException(404, "User not found")
    if not body.new_password or len(body.new_password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")
    update_user_password(username, hash_password(body.new_password))
    write_audit_log("admin_password_reset", admin, resource_type="user", resource_id=username)
    email_addr = record.get("email")
    if email_addr:
        import threading
        threading.Thread(
            target=email_service.send_password_reset_notification,
            args=(email_addr, username),
            daemon=True,
        ).start()
    return {"ok": True, "username": username}


@router.delete("/users/{username}")
def remove_user(username: str, admin: str = Depends(require_admin)):
    """Admin: delete a user account."""
    if username == "owner":
        raise HTTPException(400, "Cannot delete built-in owner account")
    record = get_user_by_username(username)
    if not record:
        raise HTTPException(404, "User not found")
    delete_user(username)
    write_audit_log("delete_user", admin, resource_type="user", resource_id=username)
    return {"ok": True, "username": username}
