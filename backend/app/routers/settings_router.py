from fastapi import APIRouter, Depends

import httpx

from app.auth import require_admin, require_auth
from app.config import settings
from app.db import get_setting, set_setting
from app.schemas import SettingsPayload

router = APIRouter(prefix="/settings", tags=["settings"])


def _effective_ollama_url() -> str:
    return get_setting("ollama_base_url") or settings.ollama_base_url


@router.get("")
def get_settings(_: str = Depends(require_auth)):
    allow_reg_stored = get_setting("allow_registration")
    allow_registration = (allow_reg_stored != "false") if allow_reg_stored is not None else (not settings.disable_registration)
    return {
        "ai_provider": get_setting("ai_provider") or settings.ai_provider,
        "ollama_model": get_setting("ollama_model") or settings.ollama_model,
        "ollama_timeout": float(get_setting("ollama_timeout") or settings.ollama_timeout),
        "openai_model": get_setting("openai_model") or settings.openai_model,
        "ollama_base_url": _effective_ollama_url(),
        "has_openai_key": bool(settings.openai_api_key),
        "allow_registration": allow_registration,
    }


@router.post("")
def post_settings(body: SettingsPayload, _: str = Depends(require_admin)):
    if body.ai_provider:
        set_setting("ai_provider", body.ai_provider)
    if body.ollama_model:
        set_setting("ollama_model", body.ollama_model)
    if body.ollama_base_url:
        set_setting("ollama_base_url", body.ollama_base_url.rstrip("/"))
    if body.openai_model:
        set_setting("openai_model", body.openai_model)
    if body.ollama_timeout is not None:
        set_setting("ollama_timeout", str(body.ollama_timeout))
    if body.allow_registration is not None:
        set_setting("allow_registration", "true" if body.allow_registration else "false")
    return {"ok": True}


@router.get("/test-ollama")
def test_ollama(_: str = Depends(require_auth)):
    """Ping the configured Ollama instance and return available models."""
    url = _effective_ollama_url().rstrip("/")
    try:
        with httpx.Client(timeout=5.0) as client:
            r = client.get(f"{url}/api/tags")
            r.raise_for_status()
            data = r.json()
            models = [m["name"] for m in (data.get("models") or [])]
            return {"ok": True, "url": url, "models": models}
    except httpx.TimeoutException:
        return {"ok": False, "url": url, "error": f"Timed out connecting to {url}"}
    except Exception as exc:
        return {"ok": False, "url": url, "error": str(exc)}
