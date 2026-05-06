import json
import re
from typing import Any

import numpy as np
import pandas as pd

# Common null-like strings found in CSV/Excel exports
NULL_LIKE_VALUES = {
    "", "n/a", "na", "n.a.", "null", "none", "nil",
    "#n/a", "#null!", "not available", "missing", "unknown",
    "undefined", "-", "--", "---", "?", ".", "nan", "not applicable",
    "not stated", "ns", "nr", "no data",
}


def _replace_null_likes(df: pd.DataFrame) -> pd.DataFrame:
    """Replace common null-like string values with actual NaN so they are counted as missing.

    Uses vectorised pandas str accessors instead of row-wise apply() for a
    10–50× speed-up on wide / long dataframes.  The str accessor silently
    returns NaN for non-string cells so numeric/datetime values are unaffected.
    """
    out = df.copy()
    for c in out.columns:
        if out[c].dtype != object:
            continue
        # str.strip().str.lower() returns NaN for non-string entries — safe to isin()
        null_mask = out[c].str.strip().str.lower().isin(NULL_LIKE_VALUES)
        if null_mask.any():
            out.loc[null_mask, c] = np.nan
    return out

# Critical field patterns for prioritization
CRITICAL_FIELD_PATTERNS = {
    "primary_key": ["id", "key", "uuid", "identifier", "pk"],
    "financial": ["price", "cost", "amount", "revenue", "expense", "salary", "wage", "budget", "profit", "loss"],
    "temporal": ["date", "time", "timestamp", "created", "updated", "modified"],
    "personal": ["name", "email", "phone", "address", "ssn", "social"],
    "quantitative": ["quantity", "count", "number", "amount", "total", "sum"],
}


def _identify_critical_fields(df: pd.DataFrame) -> dict[str, list[str]]:
    """Identify critical fields based on column name patterns."""
    critical = {category: [] for category in CRITICAL_FIELD_PATTERNS}
    
    for col in df.columns:
        col_lower = str(col).lower()
        for category, patterns in CRITICAL_FIELD_PATTERNS.items():
            if any(pattern in col_lower for pattern in patterns):
                critical[category].append(str(col))
                break
    
    # Also check for columns with very high cardinality (potential keys)
    for col in df.columns:
        if df[col].nunique() == len(df) and len(df) > 10:
            if str(col) not in sum(critical.values(), []):
                critical["primary_key"].append(str(col))
    
    return critical


def _calculate_field_priority_score(df: pd.DataFrame, critical_fields: dict[str, list[str]]) -> dict[str, float]:
    """Calculate priority score for each column based on criticality."""
    priority_scores = {}
    
    priority_weights = {
        "primary_key": 1.0,
        "financial": 0.9,
        "temporal": 0.8,
        "personal": 0.85,
        "quantitative": 0.75,
    }
    
    for col in df.columns:
        col_str = str(col)
        score = 0.5  # Base score
        
        for category, cols in critical_fields.items():
            if col_str in cols:
                score = max(score, priority_weights.get(category, 0.5))
        
        # Boost score for columns with low missing values
        missing_pct = df[col].isna().sum() / len(df)
        if missing_pct < 0.1:
            score += 0.1
        
        # Boost score for numeric columns
        if pd.api.types.is_numeric_dtype(df[col]):
            score += 0.05
        
        priority_scores[col_str] = min(1.0, score)
    
    return priority_scores


def memory_usage_mb(df: pd.DataFrame) -> float:
    return float(df.memory_usage(deep=True).sum() / (1024 * 1024))


def _dup_subset(frame: pd.DataFrame) -> list[str]:
    """Columns to use for duplicate detection — excludes all-unique columns (IDs)."""
    non_id = [c for c in frame.columns if frame[c].nunique(dropna=False) < len(frame)]
    return non_id if non_id else list(frame.columns)


def get_duplicate_mask(df: pd.DataFrame) -> "pd.Series[bool]":
    """Return a boolean Series (index-aligned with df) where True = this row is part
    of a duplicate group.  Uses keep=False so BOTH the original and the copy are flagged.
    Applies null-like replacement and case/whitespace normalisation before comparison."""
    df_clean = _replace_null_likes(df)
    # Build the most normalised version we can
    try:
        df_norm = df_clean.apply(
            lambda x: x.str.strip().str.lower() if x.dtype == object else x
        )
    except Exception:
        df_norm = df_clean

    subset = _dup_subset(df_norm)
    return df_norm.duplicated(subset=subset, keep=False)


def quality_score_from_profile(profile: dict[str, Any]) -> float:
    """0-100 honest composite quality score (higher is better)."""
    score = 100.0

    # Missing values: 10% missing = -15 pts, 33%+ = max -50 pts
    missing_pct = float(profile.get("missing_cells_pct") or 0)
    score -= min(missing_pct * 1.5, 50)

    # Duplicates: 5% = -10 pts, 15%+ = max -30 pts
    dup_pct = float(profile.get("duplicate_rows_pct") or 0)
    score -= min(dup_pct * 2.0, 30)

    # Null-like strings ("N/A", "null", etc.) not yet replaced
    empty_pct = float(profile.get("null_like_string_pct") or 0)
    score -= min(empty_pct * 1.2, 20)

    # Constant / zero-variance columns (carry no information)
    constant_ratio = float(profile.get("constant_columns_ratio") or 0)
    score -= min(constant_ratio * 20, 10)

    # Type mismatches (numeric data stored as strings)
    type_mismatch_pct = float(profile.get("type_mismatch_pct") or 0)
    score -= min(type_mismatch_pct * 0.8, 10)

    # Outliers: penalise if > 5% of numeric cells are outliers
    outlier_pct = float(profile.get("outlier_cells_pct") or 0)
    if outlier_pct > 5:
        score -= min((outlier_pct - 5) * 0.5, 10)

    # Heavily text-heavy schema is harder to validate
    dtypes = profile.get("dtypes") or {}
    object_cols = sum(1 for t in dtypes.values() if str(t) == "object")
    total_cols = max(len(dtypes), 1)
    object_ratio = object_cols / total_cols
    if object_ratio > 0.7:
        score -= 5
    elif object_ratio > 0.5:
        score -= 2

    return float(max(0, min(100, round(score, 2))))


_PHONE_RE  = re.compile(r"^\+?[\d\s\-\(\)]{7,15}$")
_URL_RE    = re.compile(r"https?://|www\.", re.IGNORECASE)
_EMAIL_RE  = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _detect_pattern(series: "pd.Series") -> str | None:
    """Return a detected pattern label for an object column sample, or None."""
    sample = series.dropna().astype(str).head(50)
    if len(sample) == 0:
        return None
    n = len(sample)
    email_hits  = sample.apply(lambda x: bool(_EMAIL_RE.match(x.strip()))).sum()
    url_hits    = sample.apply(lambda x: bool(_URL_RE.search(x))).sum()
    phone_hits  = sample.apply(lambda x: bool(_PHONE_RE.match(x.strip()))).sum()
    # Guard: skip date inference when the column is mostly numeric plain numbers —
    # e.g. year columns "2020", "2021" would otherwise be parsed as dates.
    numeric_hits = pd.to_numeric(sample, errors="coerce").notna().sum()
    date_hits = 0 if numeric_hits / n > 0.5 else pd.to_datetime(sample, format="mixed", errors="coerce").notna().sum()
    if email_hits / n > 0.7:
        return "email"
    if url_hits / n > 0.7:
        return "url"
    if phone_hits / n > 0.7:
        return "phone"
    if date_hits / n > 0.7:
        return "date_string"
    return None


def _column_stats(df: pd.DataFrame) -> dict[str, dict]:
    """Return detailed per-column statistics used for accurate analysis."""
    import re as _re
    stats: dict[str, dict] = {}
    for c in df.columns:
        col = df[c]
        n_total   = len(col)
        n_missing = int(col.isna().sum())
        n_present = n_total - n_missing
        missing_pct = round(100.0 * n_missing / max(n_total, 1), 2)
        col_stat: dict[str, Any] = {
            "dtype":       str(col.dtype),
            "count":       n_present,
            "missing":     n_missing,
            "missing_pct": missing_pct,
            "unique":      int(col.nunique(dropna=True)),
        }

        if pd.api.types.is_numeric_dtype(col):
            s = col.dropna().astype("float64")
            if len(s) > 0:
                col_stat["min"]    = _safe_scalar(s.min())
                col_stat["max"]    = _safe_scalar(s.max())
                col_stat["mean"]   = round(float(s.mean()), 4)
                col_stat["median"] = round(float(s.median()), 4)
                col_stat["std"]    = round(float(s.std()), 4) if len(s) > 1 else 0.0
                try:
                    col_stat["skew"] = round(float(s.skew()), 4)
                except Exception:
                    col_stat["skew"] = None
                # IQR-based outlier count
                q1, q3 = float(s.quantile(0.25)), float(s.quantile(0.75))
                iqr = q3 - q1
                if iqr > 0:
                    outlier_mask = (s < q1 - 1.5 * iqr) | (s > q3 + 1.5 * iqr)
                    col_stat["outlier_count"] = int(outlier_mask.sum())
                    col_stat["outlier_pct"]   = round(100.0 * col_stat["outlier_count"] / max(len(s), 1), 2)
                else:
                    col_stat["outlier_count"] = 0
                    col_stat["outlier_pct"]   = 0.0
                col_stat["zeros"] = int((s == 0).sum())
                col_stat["negatives"] = int((s < 0).sum())
        elif col.dtype == object:
            s = col.dropna()
            if len(s) > 0:
                vc = s.value_counts(normalize=False)
                col_stat["top_values"] = {str(k): int(v) for k, v in vc.head(10).items()}
                col_stat["cardinality_ratio"] = round(col_stat["unique"] / max(n_present, 1), 4)
                avg_len = float(s.astype(str).str.len().mean())
                col_stat["avg_length"] = round(avg_len, 2)
                pattern = _detect_pattern(s)
                if pattern:
                    col_stat["detected_pattern"] = pattern
        elif pd.api.types.is_datetime64_any_dtype(col):
            s = col.dropna()
            if len(s) > 0:
                col_stat["min_date"] = str(s.min())
                col_stat["max_date"] = str(s.max())
                col_stat["date_range_days"] = int((s.max() - s.min()).days) if len(s) > 1 else 0

        stats[str(c)] = col_stat
    return stats


def _safe_scalar(v: Any) -> Any:
    try:
        if pd.isna(v):
            return None
    except Exception:
        pass
    if isinstance(v, (np.integer,)):
        return int(v)
    if isinstance(v, (np.floating,)):
        return round(float(v), 4)
    return v


def analyze_dataframe(df: pd.DataFrame) -> dict[str, Any]:
    n_rows, n_cols = len(df), len(df.columns)

    # --- Step 1: count null-like strings BEFORE replacing them ---
    null_like_per_col: dict[str, int] = {}
    for c in df.columns:
        if df[c].dtype == object:
            null_like_per_col[str(c)] = int(
                df[c].apply(
                    lambda x: isinstance(x, str) and x.strip().lower() in NULL_LIKE_VALUES
                ).sum()
            )
        else:
            null_like_per_col[str(c)] = 0
    null_like_total = sum(null_like_per_col.values())
    null_like_pct = round(100.0 * null_like_total / max(n_rows * n_cols, 1), 4)

    # --- Step 2: replace null-likes so downstream stats are honest ---
    df_clean = _replace_null_likes(df)

    # --- Step 3: missing values (after null-like replacement) ---
    missing_per_col = {c: int(df_clean[c].isna().sum()) for c in df_clean.columns}
    missing_total = int(df_clean.isna().sum().sum())
    missing_cells_pct = round(100.0 * missing_total / max(n_rows * n_cols, 1), 4)

    # --- Step 4: critical fields ---
    critical_fields = _identify_critical_fields(df_clean)
    priority_scores = _calculate_field_priority_score(df_clean, critical_fields)

    # --- Step 5: duplicate detection (exact, whitespace-normalised, case-insensitive) ---
    subset = _dup_subset(df_clean)
    dup_count = int(df_clean.duplicated(subset=subset).sum())

    # Whitespace-normalised check
    try:
        df_ws = df_clean.apply(lambda x: x.str.strip() if x.dtype == object else x)
        ws_subset = _dup_subset(df_ws)
        dup_count = max(dup_count, int(df_ws.duplicated(subset=ws_subset).sum()))
    except Exception:
        pass

    # Case + whitespace normalised check
    try:
        df_norm = df_clean.apply(
            lambda x: x.str.strip().str.lower() if x.dtype == object else x
        )
        norm_subset = _dup_subset(df_norm)
        dup_count = max(dup_count, int(df_norm.duplicated(subset=norm_subset).sum()))
    except Exception:
        pass

    dup_pct = round(100.0 * dup_count / max(n_rows, 1), 4)

    # --- Step 5b: type-mismatch detection ---
    # Object columns that contain numeric-looking strings (e.g. "forty", "1,200") are
    # type mismatches — the value exists but is in the wrong format.
    type_mismatch_cells = 0
    mixed_type_columns: list[str] = []
    for c in df_clean.columns:
        if df_clean[c].dtype != object:
            continue
        non_null = df_clean[c].dropna()
        if len(non_null) == 0:
            continue
        numeric_ok = pd.to_numeric(non_null, errors="coerce").notna().sum()
        if numeric_ok > 0:
            # Any non-convertible cell in a "should-be-numeric" column is a mismatch
            mismatched = int(len(non_null) - numeric_ok)
            if mismatched > 0:
                type_mismatch_cells += mismatched
                mixed_type_columns.append(str(c))
            elif numeric_ok == len(non_null):
                # Whole column stored as string but is numeric
                type_mismatch_cells += int(numeric_ok)
                mixed_type_columns.append(str(c))
    type_mismatch_pct = round(100.0 * type_mismatch_cells / max(n_rows * n_cols, 1), 4)

    # --- Step 6: constant (zero-variance) columns ---
    constant_cols = [
        str(c) for c in df_clean.columns
        if df_clean[c].nunique(dropna=True) <= 1
    ]
    constant_columns_ratio = round(len(constant_cols) / max(n_cols, 1), 4)

    dtypes = {str(c): str(df_clean[c].dtype) for c in df_clean.columns}
    uniques = {}
    for c in df_clean.columns:
        try:
            uniques[str(c)] = int(df_clean[c].nunique(dropna=True))
        except Exception:
            uniques[str(c)] = 0

    numeric_cols = df_clean.select_dtypes(include=[np.number]).columns.tolist()
    corr = None
    if len(numeric_cols) >= 2:
        c = df_clean[numeric_cols].corr(numeric_only=True)
        corr = json.loads(c.round(4).to_json())

    sample_rows = min(5, n_rows)
    preview = json.loads(df.head(sample_rows).to_json(orient="records", date_format="iso"))

    # Per-column detailed stats
    col_stats = _column_stats(df_clean)

    # Aggregate outlier count across all numeric columns
    total_outlier_cells = sum(
        v.get("outlier_count", 0)
        for v in col_stats.values()
        if isinstance(v.get("outlier_count"), int)
    )
    outlier_cells_pct = round(100.0 * total_outlier_cells / max(n_rows * n_cols, 1), 4)

    profile: dict[str, Any] = {
        "total_rows": n_rows,
        "total_columns": n_cols,
        "column_names": [str(c) for c in df_clean.columns],
        "missing_per_column": {str(k): v for k, v in missing_per_col.items()},
        "missing_cells_pct": missing_cells_pct,
        "null_like_per_column": null_like_per_col,
        "null_like_string_pct": null_like_pct,
        "duplicate_rows": dup_count,
        "duplicate_rows_pct": dup_pct,
        "constant_columns": constant_cols,
        "constant_columns_ratio": constant_columns_ratio,
        "type_mismatch_pct": type_mismatch_pct,
        "mixed_type_columns": mixed_type_columns,
        "outlier_cells_total": total_outlier_cells,
        "outlier_cells_pct": outlier_cells_pct,
        "dtypes": dtypes,
        "unique_values": {str(k): v for k, v in uniques.items()},
        "memory_usage_mb": round(memory_usage_mb(df_clean), 4),
        "numeric_columns": [str(c) for c in numeric_cols],
        "correlation_matrix": corr,
        "preview": preview,
        "critical_fields": critical_fields,
        "field_priority_scores": priority_scores,
        "column_stats": col_stats,
    }
    profile["quality_score"] = quality_score_from_profile(profile)
    return profile


def histogram_data(df: pd.DataFrame, column: str, bins: int = 30) -> dict[str, Any] | None:  # noqa: E501
    if column not in df.columns:
        return None
    s = df[column]
    if not pd.api.types.is_numeric_dtype(s):
        s = pd.to_numeric(s, errors="coerce")
    s = s.dropna()
    if len(s) < 2:
        return None
    counts, edges = np.histogram(s.astype(float), bins=min(bins, len(s)))
    return {"column": column, "counts": counts.tolist(), "bin_edges": edges.tolist()}
