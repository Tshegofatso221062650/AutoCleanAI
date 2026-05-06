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
    """Return the best available file path for a dataset.

    Prefers the cleaned CSV (from export_paths) when cleaning has been run,
    so all downstream operations (analyze, chat, transform, export) work on
    the clean data.  Falls back to the original upload if no cleaned file exists
    or the cleaned file has been deleted.
    """
    import json as _json
    row = get_dataset(dataset_id)
    if not row:
        return None
    export_paths_raw = row.get("export_paths")
    if export_paths_raw:
        try:
            paths = _json.loads(export_paths_raw)
            for fmt in ("csv", "xlsx", "json"):
                p = paths.get(fmt)
                if p and Path(p).exists():
                    return Path(p)
        except Exception:
            pass
    p = Path(row["stored_path"])
    if p.exists():
        return p
    return None


def infer_format_from_name(name: str) -> str:
    n = name.lower()
    if n.endswith(".csv"):
        return "csv"
    if n.endswith(".tsv"):
        return "tsv"
    if n.endswith(".xlsx"):
        return "xlsx"
    if n.endswith(".xls"):
        return "xls"
    if n.endswith(".json"):
        return "json"
    if n.endswith(".parquet"):
        return "parquet"
    return "csv"
