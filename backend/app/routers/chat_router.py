from fastapi import APIRouter, Depends, HTTPException

from app.auth import require_auth
from app.db import get_dataset
from app.services.access_control import require_item_access
from app.services.security import chat_limiter
from app.services.ai_service import chat_about_dataset, recommend_missing_strategy
from app.services.cleaning_engine import load_dataframe
from app.services.storage import infer_format_from_name, resolve_original_path
from app.routers.analyze_router import _get_cached_df
from app.schemas import ChatRequest, ChatResponse

router = APIRouter(tags=["chat"])


@router.post("/chat", response_model=ChatResponse)
def chat(body: ChatRequest, user: str = Depends(require_auth)):
    if not chat_limiter.allow(user):
        raise HTTPException(429, "Too many chat requests — please slow down")
    require_item_access(user, "dataset", body.dataset_id)
    path = resolve_original_path(body.dataset_id)
    if not path:
        raise HTTPException(404, "Dataset not found")
    row = get_dataset(body.dataset_id)
    if not row:
        raise HTTPException(404, "Dataset not found")
    fmt = row["file_format"] or infer_format_from_name(row["original_filename"])
    try:
        df, _ = _get_cached_df(body.dataset_id, str(path), fmt)
    except Exception as e:
        raise HTTPException(400, str(e)) from e
    reply, provider = chat_about_dataset(df, body.message)
    return ChatResponse(reply=reply, provider=provider)


@router.post("/ai/missing-strategy")
def missing_strategy(dataset_id: str, column: str, user: str = Depends(require_auth)):
    require_item_access(user, "dataset", dataset_id)
    path = resolve_original_path(dataset_id)
    if not path:
        raise HTTPException(404, "Dataset not found")
    row = get_dataset(dataset_id)
    if not row:
        raise HTTPException(404, "Dataset not found")
    fmt = row["file_format"] or infer_format_from_name(row["original_filename"])
    df, _ = _get_cached_df(dataset_id, str(path), fmt)
    return recommend_missing_strategy(df, column)
