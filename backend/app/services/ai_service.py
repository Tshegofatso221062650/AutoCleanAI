from __future__ import annotations

import json
from typing import Any

import httpx
import pandas as pd

from app.config import settings
from app.db import get_setting
from app.services.analysis import analyze_dataframe


def _provider() -> str:
    return (get_setting("ai_provider") or settings.ai_provider or "none").lower()


def _ollama_chat(messages: list[dict[str, str]], model: str | None = None) -> str:
    m = model or get_setting("ollama_model") or settings.ollama_model
    base_url = get_setting("ollama_base_url") or settings.ollama_base_url
    url = f"{base_url.rstrip('/')}/api/chat"
    payload = {"model": m, "messages": messages, "stream": False}
    timeout = float(get_setting("ollama_timeout") or settings.ollama_timeout)
    with httpx.Client(timeout=timeout) as client:
        r = client.post(url, json=payload)
        r.raise_for_status()
        data = r.json()
        return (data.get("message") or {}).get("content") or json.dumps(data)


def _openai_chat(messages: list[dict[str, str]], model: str | None = None) -> str:
    key = settings.openai_api_key
    if not key:
        raise RuntimeError("OPENAI_API_KEY not set")
    m = model or get_setting("openai_model") or settings.openai_model
    with httpx.Client(timeout=120.0) as client:
        r = client.post(
            "https://api.openai.com/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json={"model": m, "messages": messages, "temperature": 0.2},
        )
        r.raise_for_status()
        data = r.json()
        return data["choices"][0]["message"]["content"]


def build_dataset_context(df: pd.DataFrame, max_chars: int = 12000) -> str:
    profile = analyze_dataframe(df)
    slim = {
        "rows": profile["total_rows"],
        "columns": profile["total_columns"],
        "dtypes": profile["dtypes"],
        "missing_pct": profile["missing_cells_pct"],
        "duplicates": profile["duplicate_rows"],
        "quality_score": profile["quality_score"],
        "preview": profile.get("preview") or [],
    }
    s = json.dumps(slim, indent=2)
    if len(s) > max_chars:
        return s[: max_chars - 80] + "\n... (truncated)"
    return s


def chat_about_dataset(df: pd.DataFrame, user_message: str) -> tuple[str, str]:
    ctx = build_dataset_context(df)
    system = (
        "You are AutoClean AI, a precise data assistant for a solo technical user. "
        "Answer using the dataset summary JSON. If uncertain, say so. Be concise."
    )
    messages = [
        {"role": "system", "content": system},
        {"role": "user", "content": f"Dataset summary:\n{ctx}\n\nQuestion:\n{user_message}"},
    ]
    prov = _provider()
    if prov == "openai":
        return _openai_chat(messages), "openai"
    if prov == "ollama":
        try:
            return _ollama_chat(messages), "ollama"
        except Exception as e:
            return (
                f"Ollama error ({e}). Is Ollama running? Fallback answer: "
                f"Rows={len(df)}, Cols={len(df.columns)}. Check missing % in analysis view.",
                "ollama_error",
            )
    # none: heuristic replies
    profile = analyze_dataframe(df)
    q = user_message.lower()
    if "missing" in q or "error" in q:
        worst = None
        best_n = -1
        for col, n in (profile.get("missing_per_column") or {}).items():
            if n > best_n:
                best_n = n
                worst = col
        return (
            f"Heuristic (no LLM): column with most missing values: {worst} ({best_n} cells). "
            f"Overall missing cell %: {profile['missing_cells_pct']}%.",
            "none",
        )
    if "summar" in q:
        return (
            f"Heuristic: {profile['total_rows']} rows, {profile['total_columns']} columns, "
            f"quality score {profile['quality_score']}, duplicates {profile['duplicate_rows']}.",
            "none",
        )
    return (
        "LLM disabled. Set ai_provider to ollama or openai in Settings, or ask about missing values / summary.",
        "none",
    )


def recommend_missing_strategy(df: pd.DataFrame, column: str) -> dict[str, Any]:
    if column not in df.columns:
        return {"strategy": "median", "reason": "Column not found", "confidence": 0.0}
    s = df[column]
    if pd.api.types.is_numeric_dtype(s):
        skew = float(s.dropna().skew()) if s.dropna().size > 2 else 0.0
        strat = "median" if abs(skew) > 1.0 else "mean"
        return {
            "strategy": strat,
            "reason": f"Numeric column; skew={skew:.3f} → prefer {'median' if abs(skew) > 1 else 'mean'}",
            "confidence": 0.78,
        }
    return {
        "strategy": "mode",
        "reason": "Non-numeric → mode / most frequent category",
        "confidence": 0.65,
    }
