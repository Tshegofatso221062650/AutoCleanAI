from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from app.auth import require_auth
from app.db import get_dataset
from app.services.access_control import require_item_access

router = APIRouter(tags=["download"])


@router.get("/download/{dataset_id}/{fmt}")
def download(dataset_id: str, fmt: str, user: str = Depends(require_auth)):
    require_item_access(user, "dataset", dataset_id)
    fmt = fmt.lower()
    if fmt not in ("csv", "json", "xlsx"):
        raise HTTPException(400, "fmt must be csv, json, or xlsx")
    row = get_dataset(dataset_id)
    if not row:
        raise HTTPException(404, "Dataset not found")
    import json

    paths = json.loads(row["export_paths"]) if row.get("export_paths") else {}
    p = paths.get(fmt)
    if not p or not Path(p).exists():
        raise HTTPException(404, "Export not found — run clean first")
    path = Path(p)
    media = {
        "csv": "text/csv",
        "json": "application/json",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }[fmt]
    return FileResponse(str(path), filename=path.name, media_type=media)
