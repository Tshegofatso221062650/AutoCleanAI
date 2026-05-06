from pathlib import Path

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile

from app.auth import require_auth
from app.config import settings
from app.db import insert_dataset, new_dataset_id, count_datasets_for_user
from app.services.cleaning_engine import load_dataframe
from app.services.schema_tracker import record_schema_snapshot
from app.services.storage import dataset_dir, infer_format_from_name
from app.services.security import sanitize_filename, check_magic_bytes
from app.db import write_audit_log
from app.services import webhook_dispatcher

router = APIRouter(tags=["upload"])

_ALLOWED_FORMATS = {"csv", "tsv", "json", "xlsx", "xls", "parquet"}
_CHUNK = 1024 * 1024  # 1 MB


@router.post("/upload")
async def upload(file: UploadFile = File(...), user: str = Depends(require_auth)):
    if not file.filename:
        raise HTTPException(400, "No filename")

    safe_name = sanitize_filename(file.filename)
    fmt = infer_format_from_name(safe_name)
    if fmt not in _ALLOWED_FORMATS:
        raise HTTPException(400, f"Unsupported file type '{fmt}'. Allowed: {', '.join(sorted(_ALLOWED_FORMATS))}")

    limit = settings.max_datasets_per_user
    if limit > 0 and user != "owner":
        current = count_datasets_for_user(user)
        if current >= limit:
            raise HTTPException(403, f"Dataset limit reached ({limit}). Delete some datasets first.")

    dataset_id = new_dataset_id()
    ddir = dataset_dir(dataset_id)
    ddir.mkdir(parents=True, exist_ok=True)
    ext = Path(safe_name).suffix or f".{fmt}"
    dest = ddir / f"original{ext}"

    max_bytes = (settings.max_upload_mb or 500) * 1024 * 1024
    total_bytes = 0
    header_buf = b""
    with dest.open("wb") as _fh:
        while True:
            chunk = await file.read(_CHUNK)
            if not chunk:
                break
            total_bytes += len(chunk)
            if total_bytes > max_bytes:
                dest.unlink(missing_ok=True)
                raise HTTPException(413, f"File exceeds {settings.max_upload_mb} MB limit")
            if len(header_buf) < 16:
                header_buf += chunk[:16]
            _fh.write(chunk)

    try:
        check_magic_bytes(header_buf, fmt, safe_name)
    except ValueError as exc:
        dest.unlink(missing_ok=True)
        raise HTTPException(400, str(exc))
    try:
        df = load_dataframe(dest, fmt.replace("xlsx", "xlsx") if fmt != "xls" else "xlsx")
        rows, cols = len(df), len(df.columns)
    except Exception as e:
        raise HTTPException(400, f"Could not parse file: {e}") from e

    insert_dataset(
        dataset_id=dataset_id,
        original_filename=safe_name,
        stored_path=str(dest.resolve()),
        file_format=fmt,
        row_count=rows,
        col_count=cols,
        created_by=user,
    )
    record_schema_snapshot(dataset_id, list(df.columns), "upload")
    write_audit_log("upload", user, resource_type="dataset", resource_id=dataset_id, detail=f"{safe_name} ({total_bytes:,} bytes)")
    webhook_dispatcher.on_dataset_uploaded(dataset_id, safe_name, user)
    return {
        "dataset_id": dataset_id,
        "filename": safe_name,
        "format": fmt,
        "rows": rows,
        "columns": cols,
    }
