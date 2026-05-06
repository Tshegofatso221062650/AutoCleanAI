from pathlib import Path

from app.config import settings
from app.db import get_dataset


def dataset_dir(dataset_id: str) -> Path:
    return settings.data_dir / dataset_id


def exported_dir(dataset_id: str) -> Path:
    p = settings.exports_dir / dataset_id
    p.mkdir(parents=True, exist_ok=True)
    return p


def resolve_original_path(dataset_id: str) -> Path | None:
    row = get_dataset(dataset_id)
    if not row:
        return None
    p = Path(row["stored_path"])
    if p.exists():
        return p
    return None


def infer_format_from_name(name: str) -> str:
    n = name.lower()
    if n.endswith(".csv"):
        return "csv"
    if n.endswith(".xlsx"):
        return "xlsx"
    if n.endswith(".xls"):
        return "xls"
    if n.endswith(".json"):
        return "json"
    return "csv"
