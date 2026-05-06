"""Activity feed — recent platform events relevant to the authenticated user."""
from fastapi import APIRouter, Depends

from app.auth import require_auth
from app.db import get_conn, get_user_by_username

router = APIRouter(tags=["activity"])

_ACTION_LABELS: dict[str, str] = {
    "upload":               "uploaded a dataset",
    "clean":                "cleaned a dataset",
    "analyze":              "analyzed a dataset",
    "analyze_dataset":      "analyzed a dataset",
    "login":                "signed in",
    "logout":               "signed out",
    "register":             "registered",
    "delete_dataset":       "deleted a dataset",
    "batch_run":            "ran a batch job",
    "pipeline_execute":     "ran a pipeline",
    "role_change":          "role was changed",
    "admin_password_reset": "had password reset by admin",
    "password_changed":     "changed password",
    "delete_user":          "account was deleted",
    "comment_added":        "commented on a dataset",
}


@router.get("/activity/feed")
def activity_feed(limit: int = 40, user: str = Depends(require_auth)):
    """
    Return recent activity events relevant to the authenticated user.
    Admins and owner see all events; regular users see only their own.
    """
    record = get_user_by_username(user) if user != "owner" else None
    is_admin = user == "owner" or (record and record.get("role") == "admin")

    with get_conn() as conn:
        if is_admin:
            rows = conn.execute(
                "SELECT * FROM audit_log ORDER BY ts DESC LIMIT ?",
                (min(limit, 200),),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT * FROM audit_log WHERE actor = ? ORDER BY ts DESC LIMIT ?",
                (user, min(limit, 100)),
            ).fetchall()

    events = []
    for row in rows:
        e = dict(row)
        action = e.get("action", "")
        e["human_action"] = _ACTION_LABELS.get(action, action.replace("_", " "))
        events.append(e)

    return {"events": events}
