from __future__ import annotations

import difflib
import json
import re
import unicodedata
import warnings
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

# pandas 3.x defaults to StringDtype for string columns; disable that so every
# dtype==object check in the cleaning pipeline works correctly.
try:
    pd.options.future.infer_string = False
except AttributeError:
    pass  # pandas < 2.0 — no-op

from email_validator import EmailNotValidError, validate_email
from sklearn.impute import SimpleImputer, KNNImputer
from sklearn.preprocessing import StandardScaler
from sklearn.ensemble import RandomForestRegressor
from sklearn.neighbors import KNeighborsRegressor
from Levenshtein import distance as levenshtein_distance
from jellyfish import jaro_winkler_similarity

# Null-like string values that should be treated as missing data
_NULL_LIKE_VALUES: frozenset[str] = frozenset({
    # ── Core English ────────────────────────────────────────────────────────
    "", "n/a", "na", "n.a.", "n.a", "na.", "n/a.", "null", "none", "nil",
    "#n/a", "#null!", "#na", "#ref!", "#value!", "#div/0!", "#num!", "#name?",
    "#error!", "not available", "not applicable", "not set", "not provided",
    "not given", "not recorded", "not reported", "not stated", "not known",
    "missing", "missing value", "missing data", "unknown", "undefined",
    "unspecified", "unavailable", "not found", "no data", "no value",
    "no info", "no information", "no record", "no response", "no entry",
    "-", "--", "---", "----", "?", "??", ".", "..", "...", "****",
    "nan", "inf", "-inf", "none", "null", "empty", "void", "blank",
    "tbd", "tba", "tbf", "tbv",  # to be determined/announced/filled/verified
    # ── Symbol variants ─────────────────────────────────────────────────────
    "\u2205 null", "\u2205null", "\u2205",  # ∅ null / ∅null / ∅
    "\u2014", "\u2013",  # em-dash and en-dash standing alone
    # ── Excel / spreadsheet sentinels ───────────────────────────────────────
    "!null", "!none", "!na", "!n/a", "(null)", "(none)", "(na)", "(n/a)",
    "(blank)", "(empty)", "(missing)", "[null]", "[none]", "[n/a]",
    "[blank]", "[empty]", "[missing]", "<null>", "<none>", "<na>",
    "<blank>", "<empty>", "<missing>", "<undefined>",
    # ── Multi-language equivalents ──────────────────────────────────────────
    # French
    "nul", "nule", "néant", "vide", "inconnu", "non disponible", "non renseigné",
    # Spanish / Portuguese
    "nulo", "nula", "vacío", "vacía", "desconocido", "desconocida",
    "no disponible", "não disponível", "n/d",
    # German
    "leer", "unbekannt", "nicht verfügbar", "nicht angegeben", "fehlend",
    # Italian
    "vuoto", "sconosciuto", "non disponibile", "mancante",
    # Dutch
    "leeg", "onbekend", "niet beschikbaar",
    # Chinese (simplified)
    "无", "空", "未知",
    # Japanese
    "なし", "不明",
    # Arabic
    "لا يوجد", "غير متاح",
    # Russian
    "нет", "неизвестно",
    # ── Data entry shorthand ────────────────────────────────────────────────
    "x", "xx", "xxx", "zzz", "000", "0000", "99", "999", "9999",
    "test", "foo", "bar", "baz", "lorem", "ipsum",
    "asdf", "aaa", "aaaa", "abc", "abcd", "abcde",
    # ── Numeric sentinels commonly used in legacy data ───────────────────────
    "-999", "-9999", "-99999", "-1",  # common missing-value codes
    "99999", "9999999",               # positive infinity sentinels
})


# Ambiguous null-like values: valid as a category in some columns (e.g. medication=NONE)
# but genuinely null in others (e.g. name=null).  Only convert these when they appear
# rarely in the column (< 15 % of non-empty values) — i.e. they are stray null markers,
# not a real category.
_AMBIGUOUS_NULL = frozenset({"none", "null", "na", "nil", "nan"})

# Columns where "NONE", "N/A", "null" are ALWAYS preserved as legitimate category values
# regardless of frequency.  For example: medication=NONE means "no medication prescribed",
# status=NA means "not applicable", treatment=NONE means "untreated".
_PRESERVE_AMBIGUOUS_COL = re.compile(
    r"(medication|drug|medicine|treatment|prescription|therapy"
    r"|status|flag|type$|_type$|category|class$|_class$|tier|level$|_level$"
    r"|result|outcome|disposition|decision|action|response)",
    re.IGNORECASE,
)


def _normalize_null_strings(df: pd.DataFrame) -> pd.DataFrame:
    """Replace null-like strings ('N/A', 'null', '\u2205 null', etc.) with real NaN so
    deduplication and imputation operate on consistent missing values."""
    out = df.copy()
    for c in out.columns:
        if out[c].dtype != object:
            continue
        col = out[c]
        # Columns that legitimately use "NONE/NA/null" as a category value —
        # always preserve them to avoid converting valid data to missing.
        if _PRESERVE_AMBIGUOUS_COL.search(str(c)):
            # Only convert unambiguous null markers (e.g. "N/A", "∅ null", "—").
            # Never convert plain "NONE", "NA", "null", "nan" in these columns.
            out[c] = col.apply(lambda x: _is_null_like(x, drop_ambiguous=False))
            continue
        # For ambiguous words (none/null/na/nan), only treat as null if they appear in
        # < 15 % of the non-empty values — otherwise they are a legitimate category.
        total_nonempty = col.apply(
            lambda x: isinstance(x, str) and x.strip() != ""
        ).sum()
        ambiguous_count = col.apply(
            lambda x: isinstance(x, str) and x.strip().lower() in _AMBIGUOUS_NULL
        ).sum()
        drop_ambiguous = (total_nonempty == 0) or (
            ambiguous_count / total_nonempty < 0.15
        )
        out[c] = col.apply(lambda x: _is_null_like(x, drop_ambiguous=drop_ambiguous))
    return out


# Regex: strings that are purely punctuation / symbols / whitespace with no
# alphanumeric content — treated as null regardless of the exact characters.
_NULL_PUNCT_RE = re.compile(r"^[\s\-_=+/*\\|<>~`!@#$%^&*()\[\]{};:'\",\.?]+$")

# Regex: bracketed/parenthesised null indicators like "(none)", "[N/A]", "<blank>"
_NULL_BRACKET_RE = re.compile(
    r"^[\[\(<{]?\s*(null|none|na|n/?a|nil|nan|missing|blank|empty|void|undefined)\s*[\]\)>}]?$",
    re.IGNORECASE,
)


def _is_null_like(x: Any, drop_ambiguous: bool = True) -> Any:
    """Return np.nan if x is a null-like string, otherwise return x unchanged.

    When drop_ambiguous=False, ambiguous words like 'none'/'null'/'na' are kept
    as-is (they are a real category in this column, e.g. medication = NONE).
    """
    if not isinstance(x, str):
        return x
    s = x.strip()
    # Whitespace-only strings (tabs, spaces, zero-width spaces, etc.)
    if not s:
        return np.nan
    s_lower = s.lower()
    # Strip leading ∅ / whitespace variants then re-check
    s_clean = s.lstrip("\u2205").strip()
    # Unambiguously null-like (∅ null, n/a, #null!, "not available", …)
    if s_clean.lower() in _NULL_LIKE_VALUES or s_lower in _NULL_LIKE_VALUES:
        if s_lower in _AMBIGUOUS_NULL and not drop_ambiguous:
            return x
        return np.nan
    # Bracketed null patterns: "[N/A]", "(none)", "<blank>" etc.
    if _NULL_BRACKET_RE.match(s):
        return np.nan
    # Strings with no alphanumeric content are not data (e.g. "---", "...", "***")
    if _NULL_PUNCT_RE.match(s):
        return np.nan
    return x


# Reference corrections: common typos / canonical spellings
TYPO_CANONICAL: dict[str, str] = {
    # ── Cities ──────────────────────────────────────────────────────────
    "johannesburg": "Johannesburg", "johanesburg": "Johannesburg",
    "johhanesburg": "Johannesburg", "johannesberg": "Johannesburg",
    "cape town": "Cape Town", "capetown": "Cape Town", "cape twon": "Cape Town",
    "pretoria": "Pretoria", "pretoira": "Pretoria",
    "durban": "Durban", "drban": "Durban",
    "new york": "New York", "newyork": "New York", "nwe york": "New York",
    "los angeles": "Los Angeles", "los angelas": "Los Angeles",
    "san francisco": "San Francisco", "san fransisco": "San Francisco",
    "chicago": "Chicago", "chigago": "Chicago",
    "london": "London", "londn": "London",
    "paris": "Paris", "paaris": "Paris",
    "berlin": "Berlin", "berln": "Berlin",
    "sydney": "Sydney", "sydeny": "Sydney",
    "melbourne": "Melbourne", "melborne": "Melbourne",
    "toronto": "Toronto", "toronot": "Toronto",
    "nairobi": "Nairobi", "nairobii": "Nairobi",
    "lagos": "Lagos", "lagoss": "Lagos",
    "accra": "Accra", "acra": "Accra",
    "cairo": "Cairo", "caior": "Cairo",
    "mumbai": "Mumbai", "mumbay": "Mumbai",
    "delhi": "Delhi", "dellhi": "Delhi",
    "beijing": "Beijing", "bejing": "Beijing",
    "shanghai": "Shanghai", "shangai": "Shanghai",
    "tokyo": "Tokyo", "tokio": "Tokyo",
    "dubai": "Dubai", "dubay": "Dubai",
    # ── Countries ────────────────────────────────────────────────────────
    "south africa": "South Africa", "sout africa": "South Africa",
    "united states": "United States", "united sates": "United States",
    "united kingdom": "United Kingdom", "unitd kingdom": "United Kingdom",
    "australia": "Australia", "austrailia": "Australia", "australa": "Australia",
    "germany": "Germany", "germny": "Germany",
    "france": "France", "frnace": "France",
    "brazil": "Brazil", "braizl": "Brazil",
    "canada": "Canada", "cananda": "Canada",
    "nigeria": "Nigeria", "nigria": "Nigeria",
    "kenya": "Kenya", "keny": "Kenya",
    "india": "India", "inida": "India",
    "china": "China", "chian": "China",
    "japan": "Japan", "jaapn": "Japan",
    # ── Common English words / data fields ──────────────────────────────
    "received": "Received", "recieved": "Received",
    "achieved": "Achieved", "acheived": "Achieved",
    "beginning": "Beginning", "beggining": "Beginning",
    "business": "Business", "bussiness": "Business",
    "calendar": "Calendar", "calender": "Calendar",
    "category": "Category", "catagory": "Category",
    "committee": "Committee", "comittee": "Committee",
    "customer": "Customer", "custmer": "Customer",
    "database": "Database", "databse": "Database",
    "decision": "Decision", "desicion": "Decision",
    "different": "Different", "diffrent": "Different",
    "employee": "Employee", "employe": "Employee",
    "environment": "Environment", "enviroment": "Environment",
    "february": "February", "febuary": "February",
    "government": "Government", "goverment": "Government",
    "immediately": "Immediately", "imediately": "Immediately",
    "management": "Management", "managment": "Management",
    "necessary": "Necessary", "neccessary": "Necessary",
    "occurred": "Occurred", "occured": "Occurred",
    "occurrence": "Occurrence", "occurence": "Occurrence",
    "percentage": "Percentage", "percentge": "Percentage",
    "reference": "Reference", "refrence": "Reference",
    "separate": "Separate", "seperate": "Separate",
    "successful": "Successful", "succesful": "Successful",
    "temperature": "Temperature", "temparature": "Temperature",
    "transferred": "Transferred", "transfered": "Transferred",
    "wednesday": "Wednesday", "wednessday": "Wednesday",
    "whether": "Whether", "wether": "Whether",
}


@dataclass
class FixLog:
    entries: list[dict[str, Any]] = field(default_factory=list)

    def add(
        self,
        category: str,
        detail: str,
        fix: str,
        reason: str,
        confidence: float,
        affected: int | None = None,
    ) -> None:
        self.entries.append(
            {
                "category": category,
                "what_was_wrong": detail,
                "what_was_fixed": fix,
                "why": reason,
                "confidence": round(confidence, 3),
                "rows_affected": affected,
            }
        )


def _coerce_schema_type(series: pd.Series, expected_type: str) -> tuple[pd.Series, int]:
    """Best-effort coercion for schema contracts. Returns (series, newly_invalid_count)."""
    before_missing = int(series.isna().sum())
    et = expected_type.lower()
    if et == "numeric":
        coerced = pd.to_numeric(series, errors="coerce")
    elif et == "datetime":
        coerced = pd.to_datetime(series, errors="coerce")
    elif et in ("string", "text"):
        coerced = series.astype("string").astype(object)
    elif et in ("bool", "boolean"):
        mapping = {
            "true": True, "false": False, "1": True, "0": False,
            "yes": True, "no": False, "y": True, "n": False,
        }
        coerced = series.apply(
            lambda v: mapping.get(str(v).strip().lower(), np.nan) if pd.notna(v) else np.nan
        )
    else:
        return series, 0
    after_missing = int(coerced.isna().sum())
    newly_invalid = max(0, after_missing - before_missing)
    return coerced, newly_invalid


def _enforce_schema_contract(
    df: pd.DataFrame,
    options: dict[str, Any],
    log: FixLog,
) -> tuple[pd.DataFrame, pd.DataFrame | None]:
    """Apply optional strict schema checks/coercions before cleaning."""
    schema = options.get("strict_schema") or {}
    if not schema:
        return df, None
    out = df.copy()
    quarantine_rows = pd.DataFrame()
    required = set(schema.get("required_columns") or [])
    expected_cols = set(schema.get("expected_columns") or [])
    expected_types = schema.get("column_types") or {}
    fail_on_schema_error = bool(options.get("fail_on_schema_error", False))
    quarantine_on_schema_failure = bool(options.get("quarantine_on_schema_failure", True))
    forbid_unknown = bool(schema.get("forbid_unknown_columns", False))

    missing_required = sorted(list(required - set(out.columns)))
    if missing_required:
        msg = f"Missing required columns: {', '.join(missing_required)}"
        if fail_on_schema_error:
            raise ValueError(msg)
        log.add("schema", msg, "Schema contract violation recorded", "Strict schema required columns", 1.0, len(missing_required))

    if forbid_unknown and expected_cols:
        unknown = sorted(list(set(out.columns) - expected_cols))
        if unknown:
            msg = f"Unexpected columns: {', '.join(unknown)}"
            if fail_on_schema_error:
                raise ValueError(msg)
            log.add("schema", msg, "Unknown columns retained", "Schema contract expected columns", 1.0, len(unknown))

    for col, typ in expected_types.items():
        if col not in out.columns:
            continue
        coerced, newly_invalid = _coerce_schema_type(out[col], str(typ))
        out[col] = coerced
        if newly_invalid > 0:
            log.add(
                "schema",
                f"Type coercion issues in '{col}'",
                f"{newly_invalid} value(s) could not be coerced to {typ}",
                "Strict schema type enforcement",
                0.98,
                newly_invalid,
            )
            if quarantine_on_schema_failure:
                bad_mask = out[col].isna() & df[col].notna()
                if int(bad_mask.sum()) > 0:
                    q = df.loc[bad_mask].copy()
                    q["reason"] = f"Schema type mismatch in {col} ({typ})"
                    quarantine_rows = pd.concat([quarantine_rows, q], ignore_index=True)
    return out, quarantine_rows if len(quarantine_rows) > 0 else None


def _apply_confidence_gate(
    out: pd.DataFrame,
    log: FixLog,
    options: dict[str, Any],
    enabled_option: str,
    step_name: str,
    transform_fn,
) -> pd.DataFrame:
    """Run a transform and rollback when confidence is below threshold."""
    if not options.get(enabled_option, True):
        return out
    min_conf = float(options.get("min_transform_confidence", 0.0) or 0.0)
    if min_conf <= 0:
        return transform_fn(out)
    before_entries = len(log.entries)
    before_df = out.copy()
    transformed = transform_fn(out)
    step_entries = log.entries[before_entries:]
    if not step_entries:
        return transformed
    step_conf = min(float(e.get("confidence", 0.0)) for e in step_entries)
    if step_conf < min_conf:
        log.entries = log.entries[:before_entries]
        log.add(
            "guardrail",
            f"{step_name} blocked",
            f"Skipped because confidence {step_conf:.2f} < threshold {min_conf:.2f}",
            "Confidence gate protects against low-certainty transformations",
            1.0,
            None,
        )
        return before_df
    return transformed


def load_dataframe(path: Path, fmt: str) -> pd.DataFrame:
    fmt = fmt.lower().lstrip(".")
    if fmt == "csv":
        df = pd.read_csv(path)
        # pandas 3.x defaults to StringDtype for string columns; normalise to
        # plain object so every dtype==object check in the pipeline works.
        str_cols = df.select_dtypes(include=["string"]).columns.tolist()
        if str_cols:
            df[str_cols] = df[str_cols].astype(object)
        return df
    if fmt == "xlsx":
        return pd.read_excel(path, engine="openpyxl")
    if fmt == "xls":
        return pd.read_excel(path, engine="xlrd")
    if fmt == "json":
        text = path.read_text(encoding="utf-8", errors="replace")
        try:
            return pd.read_json(path)
        except ValueError:
            pass
        try:
            return pd.read_json(path, lines=True)
        except ValueError:
            pass
        data = json.loads(text)
        if isinstance(data, list):
            return pd.DataFrame(data)
        if isinstance(data, dict):
            return pd.json_normalize(data)
        raise ValueError("Unsupported JSON structure")
    raise ValueError(f"Unsupported format: {fmt}")


def _looks_like_email_col(name: str) -> bool:
    n = name.lower()
    return "email" in n or "e-mail" in n or n.endswith("mail")


def _looks_like_age_col(name: str) -> bool:
    n = name.lower().replace(" ", "_")
    return (
        n in ("age", "yrs", "years", "years_old")
        or n.endswith(("_age", "_yrs", "_years"))
        or n.startswith(("age_", "yrs_"))
        or "age_at" in n
    )


# Unix epoch range: 1970-01-01 → ~2100-01-01 in seconds
_UNIX_TS_MIN = 0
_UNIX_TS_MAX = 4_102_444_800
# Unix epoch range in milliseconds (ms)
_UNIX_TS_MS_MIN = _UNIX_TS_MIN * 1_000
_UNIX_TS_MS_MAX = _UNIX_TS_MAX * 1_000

# Token-level hints that strongly suggest a date/time column.
# We split the column name on non-alphanumeric characters and check each token
# so that 'customer' (containing 'to') does NOT match, but 'to_date' does.
_DATE_TOKEN_HINTS: frozenset[str] = frozenset({
    "date", "time", "datetime", "timestamp",
    "created", "updated", "modified", "deleted",
    "dob", "birth", "issued", "registered", "joined",
    "start", "end", "from", "to", "since", "at",
})
# Infix substrings that are unambiguous even inside a longer token
_DATE_INFIX_RE = re.compile(r"expir|datetime|timestamp", re.IGNORECASE)


def _is_date_col_hint(col_name: str) -> bool:
    """Return True if col_name, by token, hints at a date/time field.

    Splitting on non-alphanumeric separators (underscores, spaces, dashes …)
    before checking ensures that 'customer_age' (token 'customer') does NOT
    match the two-letter token 'to', while 'to_date' (token 'to') does.
    """
    tokens = re.split(r"[^a-zA-Z0-9]+", col_name.lower())
    if any(t in _DATE_TOKEN_HINTS for t in tokens if t):
        return True
    return bool(_DATE_INFIX_RE.search(col_name))


# ISO-8601 datetime with optional time component
_ISO_DATETIME_RE = re.compile(
    r"^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$"
)


def _infer_date_columns(df: pd.DataFrame) -> list[str]:
    out: list[str] = []
    for c in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[c]):
            out.append(str(c))
            continue
        col_name = str(c)
        # ── Unix timestamps stored as integers ──────────────────────────────
        if pd.api.types.is_numeric_dtype(df[c]):
            # Skip columns that are clearly not date columns by name
            if _looks_like_age_col(col_name):
                continue
            # Only consider columns whose name hints at a date/time
            if _is_date_col_hint(col_name):
                nums = df[c].dropna()
                if len(nums) >= 2:
                    mn, mx = float(nums.min()), float(nums.max())
                    # Seconds-since-epoch range
                    if _UNIX_TS_MIN <= mn and mx <= _UNIX_TS_MAX:
                        out.append(col_name)
                    # Milliseconds-since-epoch range
                    elif _UNIX_TS_MS_MIN <= mn and mx <= _UNIX_TS_MS_MAX:
                        out.append(col_name)
            continue
        if df[c].dtype == object:
            sample = df[c].dropna().head(50)
            if len(sample) == 0:
                continue
            # Guard: if the majority of values are bare integers/floats they are
            # NOT dates — skip to avoid converting ID or year columns.
            numeric_hits = pd.to_numeric(sample, errors="coerce").notna().sum()
            if numeric_hits / max(len(sample), 1) > 0.5:
                continue
            # Skip pure month-name or day-name columns ("December", "Monday").
            # dateutil happily parses them as dates but they are NOT date columns.
            sample_lower = sample.astype(str).str.strip().str.lower()
            if sample_lower.isin(_TEMPORAL_LABELS).sum() / max(len(sample), 1) > 0.5:
                continue
            # Skip "YYYY-MM" period columns (year-month without a day component).
            # pd.to_datetime("2020-02") silently adds day=01, changing semantics.
            if sample.astype(str).str.match(r"^\d{4}-\d{2}$").sum() / max(len(sample), 1) > 0.7:
                continue
            # At least the value must look like it contains a date separator
            # (dash, slash, dot, space, or month name) — this prevents short
            # numeric strings like "12" from being parsed as 1900-01-12.
            has_sep = sample.astype(str).str.contains(_DATE_SEP, regex=True)
            if has_sep.sum() / max(len(sample), 1) < 0.6:
                continue
            ok = 0
            for v in sample:
                with warnings.catch_warnings():
                    warnings.simplefilter("ignore", UserWarning)
                    parsed = pd.to_datetime(str(v), errors="coerce")
                if parsed is not pd.NaT and str(v).strip():
                    ok += 1
            if ok / max(len(sample), 1) > 0.7:
                out.append(str(c))
    return out


# Pre-compiled date-separator detector used by _infer_date_columns
_DATE_SEP = re.compile(r"[-/.]|[A-Za-z]{3}")

# Month and day names that look like valid dates to dateutil but are NOT date columns
_MONTH_NAMES: frozenset[str] = frozenset({
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "oct", "nov", "dec",
})
_DAY_NAMES: frozenset[str] = frozenset({
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "mon", "tue", "wed", "thu", "fri", "sat", "sun",
})
_TEMPORAL_LABELS = _MONTH_NAMES | _DAY_NAMES

# Words-to-numbers for common English number words found in data
_WORD_TO_NUM: dict[str, int] = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5,
    "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10,
    "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19,
    "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50,
    "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
    "hundred": 100, "thousand": 1_000, "million": 1_000_000,
}


def _word_phrase_to_num(s: str) -> str | None:
    """Convert a multi-word English number phrase to a numeric string.

    Examples: 'two hundred' → '200', 'three hundred fifty' → '350',
              'one thousand' → '1000', 'forty five' → '45'.
    Returns None if the phrase is not a recognisable number.
    """
    tokens = s.strip().lower().split()
    if not (2 <= len(tokens) <= 6):
        return None
    if not all(t in _WORD_TO_NUM for t in tokens):
        return None
    result = 0
    current = 0
    for t in tokens:
        v = _WORD_TO_NUM[t]
        if v == 1_000_000:
            result += (current or 1) * 1_000_000
            current = 0
        elif v == 1_000:
            result += (current or 1) * 1_000
            current = 0
        elif v == 100:
            current = (current or 1) * 100
        else:
            current += v
    total = result + current
    return str(total) if total > 0 or tokens == ["zero"] else None


_SKIP_COERCE_ID = re.compile(
    r"(^id$|_id$|^id_|\bid\b|uuid|guid|sku|isbn|serial|barcode|token|hash|ref|code"
    r"|zip|postal|postcode|pincode|ean|upc|npi|ein|ssn|passport|license|plate)",
    re.IGNORECASE,
)

# European number format: dot as thousands-separator, comma as decimal
# Example: "1.234,56" → "1234.56"
_EURO_NUM_RE = re.compile(r"^-?(\d{1,3})(\.\d{3})+(,\d+)?$")

# Unit-suffixed numeric: "100 kg", "15.5 USD", "3 pcs", "42°C"
_UNIT_SUFFIX_RE = re.compile(
    r"^(-?[\d,\.]+)\s*"
    r"(kg|g|mg|lb|lbs|oz|km|m|cm|mm|mi|ft|in|l|ml|cl|dl"
    r"|usd|eur|gbp|jpy|cad|aud|chf|cny|inr|zar|brl|mxn"
    r"|%|pct|pc|pcs|units?|items?|ea|doz"
    r"|°c|°f|celsius|fahrenheit|k|kelvin"
    r"|hz|khz|mhz|ghz|kb|mb|gb|tb|w|kw|mw|v|kv|a|ma)$",
    re.IGNORECASE,
)

# Preserve leading-zero strings as strings (zip codes, phone numbers, IDs like "007")
_LEADING_ZERO_RE = re.compile(r"^0\d+$")


def _coerce_numeric_columns(df: pd.DataFrame, log: FixLog) -> pd.DataFrame:
    out = df.copy()
    for c in out.columns:
        if out[c].dtype == object:
            # Pre-convert word numbers ("forty" → "40") and
            # parenthetical negatives ("(100)" → "-100") before numeric coercion
            def _pre_num(x: Any) -> Any:
                if not isinstance(x, str):
                    return x
                s = x.strip()
                if not s:
                    return x
                # Multi-word number phrase ("two hundred" → "200", "forty five" → "45")
                if " " in s:
                    multi = _word_phrase_to_num(s)
                    if multi is not None:
                        return multi
                # Single word number (forty, twenty, …)
                if s.lower() in _WORD_TO_NUM:
                    return str(_WORD_TO_NUM[s.lower()])
                # Parenthetical negative: (100) → -100, ($1,000) → -1000
                m = re.match(r"^\(([\$€£¥₹₩₽]?[\d,\.]+)\)$", s)
                if m:
                    return "-" + m.group(1).replace(",", "").replace(".", "")
                # European decimal format: "1.234,56" → "1234.56"
                if _EURO_NUM_RE.match(s):
                    return s.replace(".", "").replace(",", ".")
                # Unit-suffixed value: "100 kg" → "100"
                um = _UNIT_SUFFIX_RE.match(s)
                if um:
                    return um.group(1).replace(",", "")
                # Scientific notation: "1.5e3", "2E6" → keep as-is (pd.to_numeric handles)
                # En-dash / em-dash as minus: −100 → -100
                s = s.replace("\u2212", "-").replace("\u2013", "-")
                return s
            # Skip all-unique columns whose name hints at an ID / code — converting
            # them to numeric would corrupt identifiers like "0001", "007", etc.
            if _SKIP_COERCE_ID.search(str(c)):
                continue
            # Skip columns where the majority of non-null values have leading zeros
            # (zip codes, order numbers, item codes stored as "00123").
            sample_vals = out[c].dropna().astype(str).str.strip()
            if len(sample_vals) > 0:
                leading_zero_frac = sample_vals.apply(
                    lambda v: bool(_LEADING_ZERO_RE.match(v))
                ).mean()
                if leading_zero_frac > 0.3:
                    continue
            pre = out[c].apply(_pre_num)
            conv = pd.to_numeric(pre.astype(str).str.replace(",", "", regex=False), errors="coerce")
            # Only convert if majority of non-null values parse as numbers
            n_nonnull = int(out[c].notna().sum())
            n_numeric = int(conv.notna().sum())
            if n_nonnull > 0 and n_numeric > 0.5 * n_nonnull:
                before = out[c].dtype
                out[c] = conv
                log.add(
                    "format",
                    f"Column '{c}' looked numeric but was {before}",
                    "Converted to numeric (word numbers resolved; invalid → NaN)",
                    "High fraction of values parsed as numbers",
                    0.85,
                    None,
                )
    return out


def _detect_slash_date_format(col: pd.Series) -> str | None:
    """Inspect a column of slash-separated date strings (D/M/Y or M/D/Y) and
    return the unambiguous strftime format when the data is conclusive.

    Strategy:
    - If ANY first component is > 12  → must be DD/MM/YYYY
    - If ANY second component is > 12 → must be MM/DD/YYYY
    - If both components always ≤ 12  → ambiguous; return None (let pandas decide)
    """
    sample = col.dropna().astype(str).str.strip()
    mask = sample.str.match(r"^\d{1,2}/\d{1,2}/\d{4}$")
    slash = sample[mask]
    if len(slash) < 2:
        return None
    parts = slash.str.split("/", expand=True)
    try:
        first  = pd.to_numeric(parts[0], errors="coerce").dropna()
        second = pd.to_numeric(parts[1], errors="coerce").dropna()
    except Exception:
        return None
    if (first > 12).any():
        return "%d/%m/%Y"
    if (second > 12).any():
        return "%m/%d/%Y"
    return None  # ambiguous — caller falls back to format="mixed"


def _parse_dates(df: pd.DataFrame, cols: list[str], log: FixLog, timezone: str | None = None) -> pd.DataFrame:
    out = df.copy()
    for c in cols:
        if c not in out.columns:
            continue
        if pd.api.types.is_datetime64_any_dtype(out[c]):
            continue
        # ── Unix timestamp columns (integer / float) ──────────────────────
        if pd.api.types.is_numeric_dtype(out[c]):
            nums = out[c].dropna()
            if len(nums) == 0:
                continue
            mn, mx = float(nums.min()), float(nums.max())
            if _UNIX_TS_MIN <= mn and mx <= _UNIX_TS_MAX:
                parsed = pd.to_datetime(out[c], unit="s", errors="coerce")
            elif _UNIX_TS_MS_MIN <= mn and mx <= _UNIX_TS_MS_MAX:
                parsed = pd.to_datetime(out[c], unit="ms", errors="coerce")
            else:
                continue
            # Plausibility guard: if the median converted date is before 1990 the
            # values are almost certainly NOT Unix timestamps (e.g. a bare 'year'
            # column with value 2021 maps to 1970-01-01 00:33:41, an age column
            # with value 39 maps to 1970-01-01 00:00:39).  Reject silently.
            n_valid = parsed.notna().sum()
            if n_valid > 0:
                median_ts = parsed.dropna().astype("int64").median()
                if median_ts < pd.Timestamp("1990-01-01").value:
                    continue
            if n_valid > 0:
                if timezone:
                    try:
                        parsed = parsed.dt.tz_localize("UTC").dt.tz_convert(timezone)
                    except Exception:
                        pass
                out[c] = parsed
                log.add(
                    "format",
                    f"Unix timestamp column '{c}'",
                    "Converted epoch seconds/ms to datetime",
                    "Numeric values in Unix epoch range",
                    0.90, int(parsed.notna().sum()),
                )
            continue

        # ── String / object date columns ───────────────────────────────────
        # Comprehensive format list covering global date representations.
        _DATE_FMTS = [
            # Slash-separated
            "%m/%d/%Y", "%d/%m/%Y", "%Y/%m/%d",
            "%m/%d/%y", "%d/%m/%y",               # 2-digit year
            "%m/%d/%Y %H:%M:%S", "%d/%m/%Y %H:%M:%S",
            "%m/%d/%Y %H:%M", "%d/%m/%Y %H:%M",
            # Dash-separated
            "%Y-%m-%d", "%m-%d-%Y", "%d-%m-%Y",
            "%y-%m-%d", "%d-%m-%y",
            "%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M",
            "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M",
            "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S.%fZ",
            # Dot-separated
            "%Y.%m.%d", "%d.%m.%Y", "%m.%d.%Y",
            "%d.%m.%y", "%y.%m.%d",
            "%d.%m.%Y %H:%M:%S", "%d.%m.%Y %H:%M",
            # Space-separated with month name
            "%B %d, %Y", "%b %d, %Y",              # April 5, 2020
            "%d %B %Y", "%d %b %Y",                # 5 April 2020
            "%B %d %Y", "%b %d %Y",
            "%d-%B-%Y", "%d-%b-%Y",                # 05-April-2020
            "%d %B, %Y", "%d %b, %Y",
            # Compact
            "%Y%m%d", "%d%m%Y",
            # With weekday prefix (e.g. "Mon, 01 Jan 2024")
            "%a, %d %b %Y", "%A, %d %B %Y",
            "%a, %d %b %Y %H:%M:%S",
            # Time-only → skip (would produce epoch date)
        ]

        # Detect unambiguous DD/MM vs MM/DD before handing to pandas.
        forced_fmt = _detect_slash_date_format(out[c])
        if forced_fmt:
            parsed = pd.to_datetime(out[c], format=forced_fmt, errors="coerce")
        else:
            try:
                parsed = pd.to_datetime(out[c], format="mixed", errors="coerce")
            except ValueError:
                # Mixed-timezone column (some values have tz offset, some are naive).
                # Convert everything to UTC so they are comparable, then strip tz info
                # so the column stays as tz-naive datetime (consistent with the rest).
                try:
                    parsed = pd.to_datetime(out[c], format="mixed", utc=True, errors="coerce")
                    parsed = parsed.dt.tz_convert(None)  # strip UTC → naive
                except Exception:
                    parsed = pd.to_datetime(out[c], errors="coerce")
        still_null = parsed.isna() & out[c].notna()
        if still_null.any():
            for fmt in _DATE_FMTS:
                subset = out[c][still_null]
                attempt = pd.to_datetime(subset, format=fmt, errors="coerce")
                parsed.update(attempt.dropna())
                still_null = parsed.isna() & out[c].notna()
                if not still_null.any():
                    break
        if parsed.notna().sum() > 0:
            if timezone:
                try:
                    if parsed.dt.tz is None:
                        parsed = parsed.dt.tz_localize(timezone)
                    else:
                        parsed = parsed.dt.tz_convert(timezone)
                except Exception:
                    pass
            out[c] = parsed
            log.add(
                "format",
                f"Mixed or string dates in '{c}'",
                f"Normalized to datetime{f' with timezone {timezone}' if timezone else ''}",
                "pandas to_datetime with coerce",
                0.8,
                int((~parsed.isna()).sum()),
            )
    return out


_SKIP_CASE_COL = re.compile(
    r"(^id$|_id$|^id_|\bid\b|code|email|e.mail|url|link|uri|phone|tel|mobile"
    r"|sku|isbn|uuid|ref|token|key|hash|serial|barcode|account|ssn|passport"
    r"|license|postcode|zipcode|zip|iban|swift|npi|ein)",
    re.IGNORECASE,
)


# Domain extension pattern — catches URLs without a protocol prefix
_DOMAIN_EXT_RE = re.compile(
    r"\b\w+\.(com|org|net|gov|edu|io|co|uk|au|de|fr|ca|nz|in|us)\b",
    re.IGNORECASE,
)


def _should_preserve_case(s: str) -> bool:
    """Return True when the value should NOT be title-cased.

    Preserves:
    - Long free-text values (> 60 chars) — likely descriptive sentences
    - Domain names / URLs (TobaccoMonitoring.org, https://...)
    - Email addresses (contain @)
    - Values with digits mixed in (product codes, dates: ABC-123)
    - CamelCase words (DevOps, iPhone, JavaScript, LinkedIn)
    - Any token of 2+ chars that is all-uppercase when split on
      spaces AND common delimiters (–/., ;) e.g. 'HR-New York', 'CDC/FDA'
    - Entire value is a short all-uppercase abbreviation (AK, HTTP, CEO)
    """
    # Long text: sentence-like descriptions should not be title-cased
    if len(s) > 60:
        return True
    # URLs with protocol or www prefix
    if re.search(r"(https?://|ftp://|www\.)", s, re.IGNORECASE):
        return True
    # Domain names without protocol (e.g. TobaccoMonitoring.org)
    if _DOMAIN_EXT_RE.search(s):
        return True
    if "@" in s:
        return True
    if re.search(r"\d", s):
        return True
    # CamelCase: an uppercase letter immediately following a lowercase letter
    # Examples: DevOps, iPhone, JavaScript, LinkedIn, McCarthyism
    if re.search(r"[a-z][A-Z]", s):
        return True
    # Token-level acronym detection: split on spaces AND hyphens/slashes/dots
    # so 'HR-New York' → tokens ['HR', 'New', 'York'] → 'HR' is all-uppercase
    tokens = re.split(r"[\s\-/.,;]+", s)
    if any(t.isupper() and len(t) >= 2 for t in tokens if t):
        return True
    # Entire value is a short all-uppercase abbreviation (AK, HTTP, CEO)
    words = s.split()
    if all(w.isupper() and 1 <= len(w) <= 6 for w in words):
        return True
    return False


try:
    import html as _html_module
    _HTML_UNESCAPE = _html_module.unescape
except ImportError:
    _HTML_UNESCAPE = lambda s: s  # type: ignore[assignment]

# Common mojibake patterns: UTF-8 bytes mis-decoded as Latin-1 / Windows-1252.
# All keys use explicit Unicode escapes to avoid parser confusion with look-alike
# curly quotes or control characters in source code.
_MOJIBAKE_MAP: dict[str, str] = {
    # Right single quotation mark '  (UTF-8 E2 80 99 decoded as W1252)
    "\u00e2\u20ac\u2122": "\u2019",
    # Left double quotation mark "  (UTF-8 E2 80 9C decoded as W1252)
    "\u00e2\u20ac\u0153": "\u201c",
    # Right double quotation mark " (UTF-8 E2 80 9D decoded as W1252)
    "\u00e2\u20ac\u009d": "\u201d",
    # En dash –  (UTF-8 E2 80 93 decoded as W1252)
    "\u00e2\u20ac\u201c": "\u2013",
    # Em dash —  (UTF-8 E2 80 94 decoded as W1252)
    "\u00e2\u20ac\u201d": "\u2014",
    # Common Latin-1 accented characters
    "\u00c3\u00a9": "\u00e9",   # é
    "\u00c3\u00a8": "\u00e8",   # è
    "\u00c3\u00a0": "\u00e0",   # à
    "\u00c3\u00a2": "\u00e2",   # â
    "\u00c3\u00ae": "\u00ee",   # î
    "\u00c3\u00b4": "\u00f4",   # ô
    "\u00c3\u00bb": "\u00fb",   # û
    "\u00c3\u00a7": "\u00e7",   # ç
    "\u00c3\u00bc": "\u00fc",   # ü
    "\u00c3\u00b6": "\u00f6",   # ö
    "\u00c3\u00a4": "\u00e4",   # ä
    "\u00c3\u00b1": "\u00f1",   # ñ
    "\u00c3\u0081": "\u00c1",   # Á
    "\u00c3\u0089": "\u00c9",   # É
}

# Zero-width and invisible Unicode characters
_ZERO_WIDTH_RE = re.compile(
    r"[\u200b\u200c\u200d\u200e\u200f\u00ad\ufeff\u2060\u2061\u2062\u2063]"
)


# Person-name columns must always be title-cased regardless of whether the value
# looks like an acronym.  "LAURA MARTINEZ" is a name, not an abbreviation.
_NAME_COL_RE = re.compile(
    r"(^name$|_name$|^name_|first.name|last.name|full.name|given.name"
    r"|family.name|surname|_first$|_last$|^first$|^last$"
    r"|patient.name|employee.name|customer.name|driver.name|contact.name"
    r"|client.name|staff.name|passenger.name|owner.name|agent.name)",
    re.IGNORECASE,
)


def _normalize_strings(df: pd.DataFrame, log: FixLog, normalize_special_chars: bool = True) -> pd.DataFrame:
    out = df.copy()

    for c in out.columns:
        if out[c].dtype != object:
            continue
        col_skip_case = bool(_SKIP_CASE_COL.search(str(c)))
        col_force_title = bool(_NAME_COL_RE.search(str(c)))  # person name → always Title Case

        def _norm(x: Any, _col_skip: bool = col_skip_case, _force_title: bool = col_force_title) -> Any:
            if x is None or (isinstance(x, float) and np.isnan(x)):
                return x
            s = str(x).strip()
            if not s:
                return np.nan
            # 0. Strip zero-width / invisible Unicode characters
            s = _ZERO_WIDTH_RE.sub("", s)
            # 0b. Decode HTML entities (&amp; → &, &lt; → <, &#39; → ', etc.)
            if "&" in s:
                s = _HTML_UNESCAPE(s)
            # 0c. Fix common mojibake (UTF-8 decoded as Latin-1)
            for bad, good in _MOJIBAKE_MAP.items():
                if bad in s:
                    s = s.replace(bad, good)
            # 1. Remove non-printing / control characters
            #    (ASCII 0-31, DEL 127, and Unicode non-breaking space 160)
            #    but keep printable ASCII and all valid Unicode letters/symbols.
            s = "".join(
                ch for ch in s
                if (ord(ch) >= 32 and ord(ch) != 127 and ord(ch) != 160)
                or ch in ("\t",)
            )
            s = s.strip()
            if not s:
                return np.nan
            # 2. Normalise Unicode (NFKC: compatibility + composition)
            #    Preserves accented chars (é, ü, ñ) — only normalises encoding.
            if normalize_special_chars:
                s = unicodedata.normalize("NFKC", s)
            # 3. Collapse multiple internal whitespace to single space
            s = re.sub(r"[\t ]+", " ", s).strip()
            # 3b. Collapse repeated punctuation: "!!" → "!", "..." → "…"
            s = re.sub(r"\.{3,}", "…", s)
            s = re.sub(r"!{2,}", "!", s)
            s = re.sub(r"\?{2,}", "?", s)
            # 4. Title-case for plain text columns (states, countries, categories).
            #    After applying .title() we restore any word that was fully
            #    uppercase in the original (acronyms: CDC, FDA, WHO) and fix
            #    the apostrophe artefact that .title() introduces (It'S → It's).
            #    Exception: person-name columns always get title-cased — "LAURA"
            #    is a name, not an acronym, so we never restore its all-caps form.
            if not _col_skip and _force_title:
                # Force title case unconditionally; skip acronym-restore for names.
                s = s.title()
                s = re.sub(r"(?<=[''])([A-Z])", lambda m: m.group(1).lower(), s)
            elif not _col_skip and not _should_preserve_case(s):
                original_words = s.split()
                titled_words   = s.title().split()
                if len(original_words) == len(titled_words):
                    merged = []
                    for orig, new in zip(original_words, titled_words):
                        if orig.isupper() and len(orig) >= 2:
                            merged.append(orig)          # restore acronym
                        else:
                            # Fix apostrophe artefact: It'S → It's
                            merged.append(re.sub(r"(?<=[''])([A-Z])", lambda m: m.group(1).lower(), new))
                    s = " ".join(merged)
                else:
                    s = s.title()
            return s

        new_series = out[c].map(_norm)
        changed = (new_series != out[c]) & ~(new_series.isna() & out[c].isna())
        if changed.any():
            log.add(
                "format",
                f"Inconsistent casing / whitespace in '{c}'",
                "Normalized whitespace; applied sentence-case to plain-text values",
                "Skips IDs, codes, acronyms, emails, URLs, and numeric-mixed strings",
                0.65,
                int(changed.sum()),
            )
        out[c] = new_series
    return out


def _fix_typos(df: pd.DataFrame, log: FixLog) -> pd.DataFrame:
    out = df.copy()
    choices = list(TYPO_CANONICAL.keys())
    for c in out.columns:
        if out[c].dtype != object:
            continue
        # Build correction map from unique values only — avoids calling
        # difflib.get_close_matches once per row (huge speedup for large datasets).
        unique_vals = [v for v in out[c].dropna().unique() if isinstance(v, str)]
        correction: dict[str, str] = {}
        for v in unique_vals:
            s = v.strip()
            low = s.lower()
            # Skip values that are too short (single chars, codes) or too long
            # (free-text sentences) — they produce false-positive typo matches.
            if len(low) < 3 or len(low) > 60:
                continue
            if low in TYPO_CANONICAL:
                correction[v] = TYPO_CANONICAL[low]
            else:
                close = difflib.get_close_matches(low, choices, n=1, cutoff=0.82)
                if close:
                    # Length-ratio guard: reject if the matched key is >30 % shorter
                    # or longer than the value.  This prevents 'hr-new york' (11)
                    # from matching 'new york' (8) and being rewritten to 'New York'.
                    matched_key = close[0]
                    len_ratio = max(len(low), len(matched_key)) / max(min(len(low), len(matched_key)), 1)
                    if len_ratio <= 1.30:
                        correction[v] = TYPO_CANONICAL[matched_key]
        if not correction:
            continue
        new_series = out[c].map(lambda x: correction.get(x, x) if isinstance(x, str) else x)
        changed = (new_series != out[c]) & out[c].notna()
        if changed.any():
            log.add(
                "typo",
                f"Possible typos in '{c}'",
                "Mapped to canonical spellings via fuzzy match / dictionary",
                "difflib.get_close_matches against known city/name list",
                0.75,
                int(changed.sum()),
            )
        out[c] = new_series
    return out


_SKIP_NUMERIC_IMPUTE = re.compile(
    r"(age|cholesterol|glucose|bmi|body.mass|heart_rate|pulse|weight|height"
    r"|blood_pressure|blood.pressure|bp$|_bp$"
    r"|oxygen|saturation|temperature|dosage|dose|lab|result|score"
    r"|count|measurement|reading|level$|_level$)",
    re.IGNORECASE,
)


def _impute_missing(df: pd.DataFrame, strategy: str, log: FixLog, add_missing_indicators: bool = False) -> pd.DataFrame:
    out = df.copy()
    # Sensitive numeric columns must never be filled with a population statistic —
    # assigning another patient's age / cholesterol / BMI is medically inaccurate.
    all_num = out.select_dtypes(include=[np.number]).columns
    num = pd.Index([c for c in all_num if not _SKIP_NUMERIC_IMPUTE.search(str(c))])
    if len(num) == 0:
        return out
    before = out[num].isna().sum().sum()
    if before == 0:
        return out

    # Add missing indicator columns if requested
    if add_missing_indicators:
        for c in num:
            if out[c].isna().any():
                out[f"is_missing_{c}"] = out[c].isna().astype(int)
    
    if strategy in ("ffill", "bfill"):
        # Forward / backward fill — designed for time-series where values change gradually
        direction = "ffill" if strategy == "ffill" else "bfill"
        filled_before = int(out[num].isna().sum().sum())
        out[list(num)] = out[list(num)].ffill() if direction == "ffill" else out[list(num)].bfill()
        # Any still-missing (at edges) fall back to the opposite direction
        opposite = "bfill" if direction == "ffill" else "ffill"
        out[list(num)] = out[list(num)].bfill() if opposite == "bfill" else out[list(num)].ffill()
        filled_after = int(out[num].isna().sum().sum())
        n_filled = filled_before - filled_after
        if n_filled > 0:
            log.add(
                "missing",
                f"Time-series missing values ({filled_before} cells)",
                f"Filled with {direction.upper()} on {len(num)} numeric column(s)",
                "Forward/backward fill for gradually-changing series",
                0.85,
                n_filled,
            )
        return out  # skip the categorical section — ffill already handled everything

    if strategy == "knn":
        # KNN imputation for context-aware filling.
        # Build one joint imputer over all usable numeric columns so each
        # column's missing values are predicted from its neighbours — but
        # we ONLY write back the columns that actually had missing values
        # to avoid silently overwriting clean data.
        usable = [c for c in num if not out[c].isna().all()]
        missing_cols = [c for c in usable if out[c].isna().any()]
        filled_cols = []
        if len(usable) >= 2 and missing_cols:
            try:
                n_neighbors = min(5, int(out[usable].dropna().shape[0]) - 1)
                if n_neighbors >= 1:
                    knn_imp = KNNImputer(n_neighbors=n_neighbors)
                    imputed_matrix = knn_imp.fit_transform(out[usable])
                    imputed_df = pd.DataFrame(imputed_matrix, columns=usable, index=out.index)
                    for c in missing_cols:
                        was_missing = out[c].isna()
                        out.loc[was_missing, c] = imputed_df.loc[was_missing, c]
                        filled_cols.append(c)
            except Exception:
                pass
        after = out[num].isna().sum().sum()
        if filled_cols:
            log.add(
                "missing",
                f"Numeric missing values ({before} cells)",
                f"Imputed with KNN on {len(filled_cols)} column(s)",
                "KNN fills only the missing cells; clean values are untouched",
                0.88,
                int(max(0, before - after)),
            )
    elif strategy == "regression":
        # Regression-based imputation
        filled_cols = []
        for c in num:
            if out[c].isna().all():
                continue
            try:
                feature_cols = [col for col in num if col != c and not out[col].isna().all()]
                if len(feature_cols) == 0:
                    continue
                train_mask = out[c].notna()
                if train_mask.sum() < 10:
                    continue
                
                X_train = out.loc[train_mask, feature_cols].fillna(out[feature_cols].median())
                y_train = out.loc[train_mask, c]
                
                model = RandomForestRegressor(n_estimators=50, random_state=42)
                model.fit(X_train, y_train)
                
                missing_mask = out[c].isna()
                if missing_mask.any():
                    X_missing = out.loc[missing_mask, feature_cols].fillna(out[feature_cols].median())
                    out.loc[missing_mask, c] = model.predict(X_missing)
                    filled_cols.append(c)
            except Exception:
                continue
        after = out[num].isna().sum().sum()
        if filled_cols:
            log.add(
                "missing",
                f"Numeric missing values ({before} cells)",
                f"Imputed with regression on {len(filled_cols)} column(s)",
                "RandomForest regression considers feature relationships",
                0.87,
                int(max(0, before - after)),
            )
    else:
        # Traditional strategies
        strat = strategy if strategy in ("mean", "median", "most_frequent") else "median"
        filled_cols = []
        for c in num:
            if out[c].isna().all():
                continue
            try:
                imp = SimpleImputer(strategy=strat)
                out[[c]] = imp.fit_transform(out[[c]])
                filled_cols.append(c)
            except Exception:
                continue
        after = out[num].isna().sum().sum()
        if filled_cols:
            log.add(
                "missing",
                f"Numeric missing values ({before} cells)",
                f"Imputed with {strat} on {len(filled_cols)} column(s)",
                "sklearn SimpleImputer per numeric column (skips all-NaN)",
                0.9 if strat != "mean" else 0.85,
                int(max(0, before - after)),
            )
    
    cat = out.select_dtypes(include=["object"]).columns
    # Columns that should NEVER be filled with mode — filling them with another
    # row's value is misleading (e.g. one patient's email used for another).
    # Clinical/personal columns are especially dangerous to impute: giving a patient
    # the wrong condition, medication, or gender is worse than leaving it null.
    _SKIP_MODE = re.compile(
        r"(email|e.mail|phone|tel|mobile|cell|fax|name|address|addr"
        r"|id$|_id$|identifier|ssn|passport|license"
        r"|condition|diagnosis|diagnos|disease|disorder|symptom|complaint"
        r"|medication|medicine|drug|treatment|prescription|therapy|dosage|dose"
        r"|gender|sex|biological_sex"
        r"|blood_pressure|blood.pressure|bp$|_bp$"
        r"|cholesterol|glucose|bmi|heart_rate|pulse|oxygen|saturation"
        r"|lab_result|lab.result|test_result|test.result|outcome|prognosis)",
        re.IGNORECASE,
    )
    for c in cat:
        if not out[c].isna().any():
            continue
        if _SKIP_MODE.search(str(c)):
            continue  # leave personal / unique-value columns as NaN
        # Only fill low-cardinality categorical columns (true categories)
        n_unique = int(out[c].nunique(dropna=True))
        n_total  = int(out[c].notna().sum())
        if n_unique > 30 or (n_total > 0 and n_unique / n_total > 0.5):
            continue  # too many unique values — not a real category column
        if add_missing_indicators:
            out[f"is_missing_{c}"] = out[c].isna().astype(int)
        mode = out[c].mode(dropna=True)
        if len(mode):
            fill = mode.iloc[0]
            n = int(out[c].isna().sum())
            out[c] = out[c].fillna(fill)
            log.add(
                "missing",
                f"Missing categorical in '{c}'",
                f"Filled with mode: '{fill}'",
                "Mode fill on low-cardinality category column",
                0.7,
                n,
            )
    return out


def _drop_duplicates(df: pd.DataFrame, log: FixLog, uniqueness_cols: list[str] | None = None,
                     survivorship: str = "first", fuzzy_threshold: float = 0.0) -> pd.DataFrame:
    out = df.copy()

    if uniqueness_cols:
        available_cols = [c for c in uniqueness_cols if c in out.columns]
        subset = available_cols if available_cols else None
    else:
        # Exclude all-unique columns (e.g. ID, row-number) — they make every row look
        # unique even when all real data columns are identical.
        non_id = [c for c in out.columns if out[c].nunique(dropna=False) < len(out)]
        subset = non_id if non_id else None

    # ── Build a normalised comparison frame ─────────────────────────────
    # Strips whitespace and lowercases string columns so that rows differing
    # only by case or surrounding spaces are treated as duplicates.
    # This keeps the original data intact — we only use cmp_out for the
    # duplicated() call, then apply the resulting mask to `out`.
    def _make_cmp(frame: pd.DataFrame, cols: list[str] | None) -> pd.DataFrame:
        cmp = frame.copy()
        for c in (cols or list(frame.columns)):
            if cmp[c].dtype == object:
                cmp[c] = cmp[c].str.strip().str.lower()
        return cmp

    cmp_out = _make_cmp(out, subset)

    # ── Exact (normalised) duplicates ────────────────────────────────────
    n_exact = int(cmp_out.duplicated(subset=subset).sum())
    if n_exact > 0:
        if survivorship == "most_complete":
            # For each duplicate group keep the row with the most non-null values.
            dup_mask = cmp_out.duplicated(subset=subset, keep=False)
            dup_df = out[dup_mask].copy()
            dup_df["_non_null_count"] = dup_df.notna().sum(axis=1)
            dup_df["_orig_idx"] = dup_df.index
            keep_indices: set[int] = set()
            # Use normalised keys for grouping to handle mixed-type edge cases
            cmp_dup_df = cmp_out[dup_mask].copy()
            cmp_dup_df["_non_null_count"] = dup_df["_non_null_count"].values
            cmp_dup_df["_orig_idx"] = dup_df["_orig_idx"].values
            group_keys = subset if subset else list(out.columns)
            try:
                for _, grp in cmp_dup_df.groupby(group_keys, sort=False, dropna=False):
                    best_pos = grp["_non_null_count"].idxmax()
                    keep_indices.add(int(cmp_dup_df.loc[best_pos, "_orig_idx"]))
            except Exception:
                # Fallback: keep the first occurrence per group (never keep all)
                first_mask = cmp_out.duplicated(subset=subset, keep="first")
                keep_indices = set(out.loc[~first_mask].index)
            drop_indices = set(dup_df["_orig_idx"].values) - keep_indices
            out = out.drop(index=list(drop_indices))
        elif survivorship == "last":
            drop_mask = cmp_out.duplicated(subset=subset, keep="last")
            out = out[~drop_mask]
        else:
            drop_mask = cmp_out.duplicated(subset=subset, keep="first")
            out = out[~drop_mask]
        log.add(
            "duplicates",
            f"{n_exact} duplicate rows (case/whitespace-normalised match)",
            f"Removed duplicates (keep {survivorship})",
            f"Normalised comparison on columns: {subset or 'all'}",
            0.99,
            n_exact,
        )

    # ── Fuzzy matching for string columns ────────────────────────────────
    # Hard caps to prevent O(n²) hangs on large datasets.
    _FUZZY_PAIR_LIMIT = 5_000
    if fuzzy_threshold > 0 and subset is not None:
        string_cols = [
            c for c in (subset or list(out.columns))
            if out[c].dtype == object and out[c].nunique(dropna=False) <= 50
        ]
        if string_cols:
            fuzzy_removed = 0
            indices_to_keep = set(out.index)   # label-based index set
            pairs_checked = 0
            last_col = string_cols[0]

            for col in string_cols:
                if pairs_checked >= _FUZZY_PAIR_LIMIT:
                    break
                values = out[col].fillna("").astype(str).tolist()
                labels = out.index.tolist()   # label for each positional slot

                for i in range(len(values)):
                    if pairs_checked >= _FUZZY_PAIR_LIMIT:
                        break
                    # Bug fix: compare label (labels[i]), not positional i
                    if labels[i] not in indices_to_keep:
                        continue
                    for j in range(i + 1, len(values)):
                        if pairs_checked >= _FUZZY_PAIR_LIMIT:
                            break
                        if labels[j] not in indices_to_keep:
                            continue

                        # Other subset columns must match exactly
                        if subset and subset != [col]:
                            other_match = all(
                                out.loc[labels[i], sc] == out.loc[labels[j], sc]
                                for sc in subset if sc != col
                            )
                            if not other_match:
                                pairs_checked += 1
                                continue

                        similarity = jaro_winkler_similarity(
                            values[i].lower(), values[j].lower()
                        )
                        pairs_checked += 1
                        if similarity >= fuzzy_threshold:
                            # discard() instead of remove() avoids KeyError on
                            # race-condition where label was already removed
                            if survivorship == "last":
                                indices_to_keep.discard(labels[i])
                            else:
                                indices_to_keep.discard(labels[j])
                            fuzzy_removed += 1
                            last_col = col
                            break

            if fuzzy_removed > 0:
                out = out.loc[list(indices_to_keep)]
                log.add(
                    "duplicates",
                    f"{fuzzy_removed} near-duplicate rows",
                    f"Removed near-duplicates (Jaro-Winkler ≥ {fuzzy_threshold})",
                    f"Fuzzy match on: {last_col}",
                    0.85,
                    fuzzy_removed,
                )

    return out.reset_index(drop=True)


def _validate_emails(df: pd.DataFrame, log: FixLog) -> pd.DataFrame:
    out = df.copy()
    for c in out.columns:
        if not _looks_like_email_col(str(c)):
            continue
        invalid = 0

        def _check(v: Any) -> Any:
            nonlocal invalid
            if v is None or (isinstance(v, float) and np.isnan(v)):
                return v
            s = str(v).strip()
            if not s:
                invalid += 1
                return np.nan
            try:
                validate_email(s, check_deliverability=False)
                return s
            except EmailNotValidError:
                invalid += 1
                return np.nan

        out[c] = out[c].map(_check)
        if invalid:
            log.add(
                "invalid",
                f"Invalid email strings in '{c}'",
                "Invalid values set to NaN for later imputation or review",
                "email-validator syntax check",
                0.95,
                invalid,
            )
    return out


def _validate_age(df: pd.DataFrame, vmin: int | None, vmax: int | None, log: FixLog) -> pd.DataFrame:
    out = df.copy()
    for c in out.columns:
        if not _looks_like_age_col(str(c)):
            continue
        col = pd.to_numeric(out[c], errors="coerce")
        mask_bad = pd.Series(False, index=out.index)
        if vmin is not None:
            mask_bad |= col < vmin
        if vmax is not None:
            mask_bad |= col > vmax
        n = int(mask_bad.sum())
        if n:
            col = col.where(~mask_bad, np.nan)
            out[c] = col
            log.add(
                "invalid",
                f"Out-of-range age in '{c}'",
                "Values outside plausible range nulled",
                f"Expected between {vmin} and {vmax}",
                0.92,
                n,
            )
    return out


def _clip_outliers(df: pd.DataFrame, method: str, z_thr: float, log: FixLog, 
                distinguish_impossible: bool = True, quarantine: pd.DataFrame | None = None) -> tuple[pd.DataFrame, pd.DataFrame | None]:
    out = df.copy()
    quarantine_df = quarantine.copy() if quarantine is not None else None
    num = out.select_dtypes(include=[np.number]).columns
    
    # Impossible value ranges — matched by SUBSTRING so patient_age, unit_price, item_qty etc. are caught
    _IMPOSSIBLE_SUBSTRINGS: list[tuple[str, tuple[float, float]]] = [
        ("age",        (0, 150)),
        ("salary",     (0, 1_000_000_000)),
        ("wage",       (0, 1_000_000_000)),
        ("price",      (0, 1_000_000_000)),
        ("cost",       (0, 1_000_000_000)),
        ("amount",     (0, 1_000_000_000)),
        ("revenue",    (0, 1_000_000_000)),
        ("qty",        (0, 10_000_000)),
        ("quantity",   (0, 10_000_000)),
        ("count",      (0, 10_000_000)),
        ("percent",    (0, 100)),
        ("pct",        (0, 100)),
        ("percentage", (0, 100)),
        ("rate",       (0, 100)),
        ("score",      (0, 100)),
    ]

    def _impossible_range(col_name: str) -> tuple[float, float] | None:
        n = col_name.lower()
        for keyword, bounds in _IMPOSSIBLE_SUBSTRINGS:
            if keyword in n:
                return bounds
        return None

    for c in num:
        col_lower = str(c).lower()
        s = out[c].dropna()
        if len(s) < 10:
            continue

        # Check for impossible values first
        impossible_mask = pd.Series(False, index=out.index)
        _range = _impossible_range(col_lower)
        if distinguish_impossible and _range is not None:
            min_val, max_val = _range
            impossible_mask = (out[c] < min_val) | (out[c] > max_val)
            n_impossible = int(impossible_mask.sum())
            if n_impossible > 0:
                out.loc[impossible_mask, c] = np.nan
                log.add(
                    "invalid",
                    f"Impossible values in '{c}'",
                    f"Values outside range [{min_val}, {max_val}] set to NaN",
                    "Domain-specific validation",
                    0.98,
                    n_impossible,
                )
                # Add to quarantine if provided
                if quarantine_df is not None:
                    quarantine_rows = out.loc[impossible_mask].copy()
                    quarantine_rows["reason"] = f"Impossible value in {c}"
                    quarantine_rows["original_value"] = out.loc[impossible_mask, c].values
                    quarantine_df = pd.concat([quarantine_df, quarantine_rows], ignore_index=True)
        
        # Statistical outlier detection for remaining values.
        # Cast to float64 first so boolean/integer quantile arithmetic never crashes.
        col_f64 = out[c].astype("float64")
        if method == "zscore":
            s_vals = col_f64.dropna().values.reshape(-1, 1)
            z = np.abs(StandardScaler().fit_transform(s_vals).ravel())
            mu, sigma = float(col_f64.mean()), float(col_f64.std()) or 1.0
            low, high = mu - z_thr * sigma, mu + z_thr * sigma
            bad = ((col_f64 < low) | (col_f64 > high)) & ~impossible_mask
        else:
            q1 = float(col_f64.quantile(0.25))
            q3 = float(col_f64.quantile(0.75))
            iqr = q3 - q1
            low, high = q1 - 1.5 * iqr, q3 + 1.5 * iqr
            bad = ((col_f64 < low) | (col_f64 > high)) & ~impossible_mask
        
        n_anomalous = int(bad.sum())
        if n_anomalous > 0:
            # Flag anomalous values instead of removing
            out.loc[bad, f"{c}_anomalous_flag"] = True
            # Cap at the boundary values — cast int columns to float first so the
            # float boundary value can be stored without a LossySetitemError
            if out[c].dtype.kind in ("i", "u"):
                out[c] = out[c].astype(float)
            if method == "zscore":
                out.loc[bad & (out[c] < low), c] = low
                out.loc[bad & (out[c] > high), c] = high
            else:
                out.loc[bad & (out[c] < low), c] = low
                out.loc[bad & (out[c] > high), c] = high
            log.add(
                "outlier",
                f"Anomalous values in '{c}'",
                f"Capped at boundary values (flagged as anomalous)",
                f"{method.upper()} - distinguished from impossible values",
                0.75,
                n_anomalous,
            )
    
    return out, quarantine_df


def _cross_field_validation(df: pd.DataFrame, log: FixLog, quarantine: pd.DataFrame | None = None) -> tuple[pd.DataFrame, pd.DataFrame | None]:
    out = df.copy()
    quarantine_df = quarantine.copy() if quarantine is not None else None
    
    # Date validations
    date_cols = [c for c in out.columns if pd.api.types.is_datetime64_any_dtype(out[c])]
    
    # Start date < End date validation
    for i, col1 in enumerate(date_cols):
        for col2 in date_cols[i+1:]:
            col1_lower, col2_lower = str(col1).lower(), str(col2).lower()
            
            # Check for start/end patterns
            if ("start" in col1_lower or "begin" in col1_lower or "from" in col1_lower) and \
               ("end" in col2_lower or "finish" in col2_lower or "to" in col2_lower):
                bad = out[col1] > out[col2]
                n = int(bad.sum())
                if n > 0:
                    out.loc[bad, f"{col1}_{col2}_validation_error"] = True
                    log.add(
                        "cross_field",
                        f"{col1} > {col2} for {n} rows",
                        "Flagged for review",
                        "Start date should be before end date",
                        0.95,
                        n,
                    )
                    if quarantine_df is not None:
                        quarantine_rows = out.loc[bad].copy()
                        quarantine_rows["reason"] = f"Cross-field error: {col1} > {col2}"
                        quarantine_df = pd.concat([quarantine_df, quarantine_rows], ignore_index=True)
    
    # Numeric validations
    num_cols = out.select_dtypes(include=[np.number]).columns
    
    # Discount < Total Price
    for i, col1 in enumerate(num_cols):
        for col2 in num_cols[i+1:]:
            col1_lower, col2_lower = str(col1).lower(), str(col2).lower()
            
            if "discount" in col1_lower and ("price" in col2_lower or "total" in col2_lower):
                bad = out[col1] > out[col2]
                n = int(bad.sum())
                if n > 0:
                    out.loc[bad, f"{col1}_{col2}_validation_error"] = True
                    log.add(
                        "cross_field",
                        f"{col1} > {col2} for {n} rows",
                        "Flagged for review",
                        "Discount should not exceed price",
                        0.95,
                        n,
                    )
                    if quarantine_df is not None:
                        quarantine_rows = out.loc[bad].copy()
                        quarantine_rows["reason"] = f"Cross-field error: {col1} > {col2}"
                        quarantine_df = pd.concat([quarantine_df, quarantine_rows], ignore_index=True)
    
    # ── Percentage columns: values must be in [0, 100] ──────────────────────
    _PCT_HINT = re.compile(
        r"(percent|pct|rate|ratio|score|share|proportion)", re.IGNORECASE
    )
    for col in num_cols:
        if not _PCT_HINT.search(str(col)):
            continue
        bad = (out[col] < 0) | (out[col] > 100)
        bad = bad & out[col].notna()
        n = int(bad.sum())
        if n > 0:
            out.loc[bad, col] = np.nan  # nullify impossible percentages
            log.add(
                "invalid",
                f"Out-of-range percentage values in '{col}'",
                f"{n} value(s) outside [0, 100] set to NaN",
                "Percentages/rates must be 0–100",
                0.97,
                n,
            )

    # ── Non-negative columns: price / amount / cost / qty should be ≥ 0 ────
    _NON_NEG_HINT = re.compile(
        r"(price|amount|total|cost|revenue|sales|qty|quantity|count|fee|salary|wage|budget|spend)",
        re.IGNORECASE,
    )
    for col in num_cols:
        if not _NON_NEG_HINT.search(str(col)):
            continue
        bad = (out[col] < 0) & out[col].notna()
        n = int(bad.sum())
        if n > 0:
            out.loc[bad, f"{col}_negative_flag"] = True
            log.add(
                "invalid",
                f"Unexpected negative values in '{col}'",
                f"{n} row(s) flagged — negative {col} may be a data entry error",
                "Price/amount/quantity columns should be ≥ 0",
                0.90,
                n,
            )

    return out, quarantine_df


def _apply_custom_rules(df: pd.DataFrame, rules: list[dict[str, Any]], log: FixLog) -> pd.DataFrame:
    out = df.copy()
    for r in rules:
        col = r.get("column")
        rule = (r.get("rule") or "").lower()
        if not col or col not in out.columns:
            continue
        if rule == "not_null":
            n = int(out[col].isna().sum())
            if n:
                log.add("rule", f"Rule: {col} not null", f"{n} rows still missing", "User custom rule noted", 1.0, n)
        elif rule == "email":
            pass  # handled elsewhere
        elif rule in ("gt", "gte", "lt", "lte"):
            val = float(r.get("value", 0))
            s = pd.to_numeric(out[col], errors="coerce")
            if rule == "gt":
                bad = s <= val
            elif rule == "gte":
                bad = s < val
            elif rule == "lt":
                bad = s >= val
            else:
                bad = s > val
            n = int(bad.sum())
            if n:
                out.loc[bad, col] = np.nan
                log.add(
                    "rule",
                    f"Rule: {col} {rule} {val}",
                    "Violations set to NaN",
                    "Custom validation rule",
                    0.95,
                    n,
                )
    return out


_CURRENCY_RE = re.compile(r"^[\$£€¥₹₩₽]?\s*-?[\d,]+(\.\d+)?$")
_PCT_RE      = re.compile(r"^-?[\d,]+(\.\d+)?\s*%$")
_BOOL_TRUE   = frozenset({"yes", "y", "true", "t", "1", "on", "si", "oui", "ja"})
_BOOL_FALSE  = frozenset({"no", "n", "false", "f", "0", "off", "non", "nein"})
_BOOL_ALL    = _BOOL_TRUE | _BOOL_FALSE
# Columns whose semantics are NOT boolean — skip the boolean standardisation step
_NON_BOOL_COL = re.compile(
    r"(gender|sex|country|nation|state|province|region|type|category|class"
    r"|status|code|group|tier|segment|level|grade|race|ethnicity|language"
    r"|currency|unit|role|department|division|brand|model|size|color|colour)",
    re.IGNORECASE,
)


def _auto_standardize_values(df: pd.DataFrame, log: FixLog) -> pd.DataFrame:
    """Find-and-replace pass:
    - Boolean-like text columns → True / False
    - Currency columns ($100, £50) → numeric
    - Percentage columns (45%) → numeric
    """
    out = df.copy()
    for c in out.columns:
        if out[c].dtype != object:
            continue
        sample = out[c].dropna()
        if len(sample) < 2:
            continue
        low = sample.astype(str).str.strip().str.lower()
        unique_low = set(low.unique())

        # ── Boolean standardisation ──────────────────────────────────────
        # Require at least one true-like AND one false-like value so that a
        # column with only "F" values (all female) is not converted to "No".
        # Guard: skip columns whose name signals they are NOT boolean flags.
        _skip_bool = bool(_NON_BOOL_COL.search(str(c)))
        _has_true  = bool(unique_low & _BOOL_TRUE)
        _has_false = bool(unique_low & _BOOL_FALSE)
        if not _skip_bool and unique_low.issubset(_BOOL_ALL) and _has_true and _has_false:
            _orig_null = out[c].isna().copy()
            mapping = {v: ("Yes" if v in _BOOL_TRUE else "No") for v in unique_low}
            out[c] = out[c].astype(str).str.strip().str.lower().map(mapping)
            out[c] = out[c].where(~_orig_null, other=None)
            log.add(
                "format",
                f"Inconsistent boolean representations in '{c}'",
                "Standardised to True / False",
                "Uniform boolean representation across dataset",
                0.92, int(len(sample)),
            )
            continue

        # ── Currency stripping ───────────────────────────────────────────
        currency_hits = sample.astype(str).str.strip().apply(
            lambda x: bool(_CURRENCY_RE.match(x)) and any(s in x for s in "$£€¥₹₩₽")
        )
        if currency_hits.sum() > len(sample) * 0.6:
            sym_series = sample.astype(str).str.extract(r"([\$£€¥₹₩₽])")[0].dropna()
            sym = sym_series.mode()[0] if len(sym_series) else "$"
            cleaned = (
                out[c].astype(str)
                .str.replace(r"[\$£€¥₹₩₽,\s]", "", regex=True)
                .replace({"nan": np.nan, "None": np.nan})
            )
            out[c] = pd.to_numeric(cleaned, errors="coerce")
            log.add(
                "format",
                f"Currency values in '{c}' (symbol: {sym})",
                "Stripped currency symbol, converted to numeric",
                "Column contains monetary values",
                0.85, int(currency_hits.sum()),
            )
            continue

        # ── Percentage stripping ─────────────────────────────────────────
        pct_hits = sample.astype(str).str.strip().apply(lambda x: bool(_PCT_RE.match(x)))
        if pct_hits.sum() > len(sample) * 0.6:
            cleaned = (
                out[c].astype(str)
                .str.replace(r"[%,\s]", "", regex=True)
                .replace({"nan": np.nan, "None": np.nan})
            )
            out[c] = pd.to_numeric(cleaned, errors="coerce")
            log.add(
                "format",
                f"Percentage values in '{c}'",
                "Stripped '%', converted to numeric (0–100 scale)",
                "Column contains percentage values",
                0.85, int(pct_hits.sum()),
            )

    return out


_NAME_HINTS = frozenset({
    "full name", "fullname", "full_name", "name", "contact name",
    "employee name", "customer name", "client name", "person name",
    "passenger name", "contact", "full name",
    # additional common patterns
    "patient name", "patient_name", "driver name", "driver_name",
    "user name", "user_name", "username", "staff name", "staff_name",
    "owner name", "owner_name", "rep name", "rep_name",
    "agent name", "agent_name",
})

# Substring fallback: any column whose lowercased name ends with 'name' or '_name'
# and has not already been matched above is also treated as a full-name candidate.
_NAME_SUFFIX_HINT = re.compile(r"(^|_| )name$", re.IGNORECASE)

# Columns that commonly contain commas as part of their natural content — never split these
_SPLIT_EXCLUSIONS = frozenset({
    "address", "addr", "street", "location", "description", "notes", "note",
    "comment", "comments", "details", "remarks", "text", "body", "message",
    "summary", "info", "information", "label", "title", "subject",
    # List / multi-value columns that use commas as list separators, not compound delimiters
    "flavor", "flavors", "tags", "keywords", "categories", "items", "values",
    "authorized", "permissions", "roles", "features",
    # Citation / provenance columns
    "source", "sources", "citation", "reference", "references",
    "methodology", "derivation", "provenance",
    # Date / time columns (hyphen in dates must never be a split signal)
    "date", "time", "timestamp", "datetime", "created", "updated", "modified",
    # Phone / contact — hyphens are formatting, not delimiters
    "phone", "tel", "telephone", "mobile", "cell", "fax", "whatsapp",
    "phone_number", "phone_no", "contact_number", "contact_no",
    # Medical / clinical — slash/hyphen in readings (140/90, 36-37) are not delimiters
    "blood_pressure", "bp", "pressure", "reading",
    "ssn", "social_security", "npi", "ein", "iban", "swift",
    # Postal / identity codes
    "zip", "zipcode", "postal", "postcode", "sku", "isbn", "barcode",
})

# Column name substring patterns that should NEVER have constant-column drop applied
_NEVER_DROP_RE = re.compile(
    r"(source|citation|reference|methodology|derivation|provenance|note|comment|remark)",
    re.IGNORECASE,
)


# ── Semantic reference sets for intelligent split-column naming ───────────────
_US_STATES_SET: frozenset[str] = frozenset({
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado",
    "connecticut", "delaware", "florida", "georgia", "hawaii", "idaho",
    "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana",
    "maine", "maryland", "massachusetts", "michigan", "minnesota",
    "mississippi", "missouri", "montana", "nebraska", "nevada",
    "new hampshire", "new jersey", "new mexico", "new york",
    "north carolina", "north dakota", "ohio", "oklahoma", "oregon",
    "pennsylvania", "rhode island", "south carolina", "south dakota",
    "tennessee", "texas", "utah", "vermont", "virginia", "washington",
    "west virginia", "wisconsin", "wyoming", "district of columbia",
    # State abbreviations
    "al", "ak", "az", "ar", "ca", "co", "ct", "de", "fl", "ga", "hi", "id",
    "il", "in", "ia", "ks", "ky", "la", "me", "md", "ma", "mi", "mn", "ms",
    "mo", "mt", "ne", "nv", "nh", "nj", "nm", "ny", "nc", "nd", "oh", "ok",
    "or", "pa", "ri", "sc", "sd", "tn", "tx", "ut", "vt", "va", "wa", "wv",
    "wi", "wy", "dc",
})

_WORLD_COUNTRIES_SET: frozenset[str] = frozenset({
    "united states", "usa", "us", "canada", "mexico", "brazil", "argentina",
    "colombia", "chile", "peru", "venezuela", "united kingdom", "uk",
    "england", "scotland", "wales", "ireland", "france", "germany", "italy",
    "spain", "portugal", "netherlands", "belgium", "switzerland", "austria",
    "sweden", "norway", "denmark", "finland", "poland", "czech republic",
    "hungary", "romania", "bulgaria", "greece", "turkey", "russia",
    "ukraine", "china", "japan", "south korea", "india", "pakistan",
    "bangladesh", "indonesia", "philippines", "vietnam", "thailand",
    "malaysia", "singapore", "australia", "new zealand", "south africa",
    "nigeria", "kenya", "ghana", "egypt", "morocco", "saudi arabia",
    "uae", "israel", "iran", "iraq",
})

_WORLD_REGIONS_SET: frozenset[str] = frozenset({
    "africa", "asia", "europe", "north america", "south america",
    "latin america", "oceania", "middle east", "east asia", "southeast asia",
    "central asia", "south asia", "caribbean", "north africa",
    "sub-saharan africa", "western europe", "eastern europe",
    "northern europe", "southern europe",
})

_DEPT_KEYWORDS_SET: frozenset[str] = frozenset({
    "sales", "finance", "hr", "human resources", "admin", "administration",
    "devops", "engineering", "marketing", "operations", "it", "cloud",
    "cloud tech", "technology", "support", "customer service", "logistics",
    "legal", "accounting", "procurement", "development", "research",
    "product", "design", "analytics", "security", "compliance",
    "infrastructure", "data", "business development", "bd", "qa",
    "quality assurance", "manufacturing", "supply chain", "retail",
    "purchasing", "warehouse", "distribution", "training", "recruitment",
})

# Ordered: first match wins; labels become the new column names
_PART_SEMANTIC_MAP: list[tuple[frozenset[str], str]] = [
    (_US_STATES_SET,       "state"),
    (_WORLD_COUNTRIES_SET, "country"),
    (_WORLD_REGIONS_SET,   "region"),
    (_DEPT_KEYWORDS_SET,   "department"),
]


def _infer_split_names(col_name: str, parts_df: pd.DataFrame, n_parts: int) -> dict[int, str]:
    """Derive semantically meaningful column names for each split part.

    Priority:
    1. Semantic match against known value sets (states, countries, departments …)
    2. Tokens parsed from the original column name
       e.g. 'department_region' → ['department', 'region']
    3. Fall back to 'part1', 'part2' …
    """
    semantic: dict[int, str] = {}
    for i in range(min(n_parts, parts_df.shape[1])):
        part_vals = set(
            parts_df.iloc[:, i].dropna().astype(str).str.strip().str.lower().unique()
        )
        if not part_vals:
            continue
        for ref_set, label in _PART_SEMANTIC_MAP:
            if len(part_vals & ref_set) / len(part_vals) > 0.50:
                semantic[i] = label
                break

    col_tokens = [t for t in re.split(r"[_\s]+", str(col_name).strip().lower()) if t]

    result: dict[int, str] = {}
    for i in range(n_parts):
        if i in semantic:
            result[i] = semantic[i]
        elif i < len(col_tokens):
            result[i] = col_tokens[i]
        else:
            result[i] = f"part{i + 1}"
    return result


def _split_compound_columns(df: pd.DataFrame, log: FixLog) -> pd.DataFrame:
    """Split compound / multi-value columns:
    - 'Full Name' style columns              → <col>_first + <col>_last
    - Consistently comma / semicolon / pipe  → semantically named parts
    - Hyphen-joined categorical pairs        → meaningful labels inferred
      from value semantics and column name tokens
      e.g. 'DevOps-California' in 'department_region' → 'department' + 'state'
    """
    out = df.copy()
    for c in list(out.columns):
        if out[c].dtype != object:
            continue
        sample = out[c].dropna()
        if len(sample) < 2:
            continue
        col_key = str(c).lower().strip()

        # ── Full Name splitting ──────────────────────────────────────────
        if col_key in _NAME_HINTS or _NAME_SUFFIX_HINT.search(col_key):
            # Only split when the column is genuinely a *person* name column.
            # "Product Name", "Item Name", "Company Name" etc. end with "name"
            # but are NOT full-name fields — splitting them corrupts the data.
            _PERSON_ROLE_PREFIXES = frozenset({
                "full", "first", "last", "person", "employee", "customer",
                "client", "patient", "driver", "contact", "staff", "passenger",
                "owner", "agent", "rep", "user",
            })
            # If the column already carries a component suffix it IS a component,
            # not a full name: patient_name_first, name_last, first_name, etc.
            _ALREADY_COMPONENT = re.compile(
                r"(_first|_last|_middle|_given|_family|_maiden|_suffix|_prefix"
                r"|^first_|^last_|^given_|^family_|^middle_)",
                re.IGNORECASE,
            )
            if _ALREADY_COMPONENT.search(col_key):
                continue
            _col_base = re.sub(r"[\s_]+name$", "", col_key).strip("_ ")
            _is_person_name = (
                not _col_base                          # bare "name" column
                or col_key in _NAME_HINTS              # explicit whitelist hit
                or _col_base in _PERSON_ROLE_PREFIXES  # known person-role prefix
            )
            if not _is_person_name:
                continue
            two_word = sample.str.strip().str.split().str.len() == 2
            if two_word.sum() >= len(sample) * 0.70:
                split_df = out[c].str.strip().str.split(n=1, expand=True)
                fn, ln = f"{c}_first", f"{c}_last"
                if fn not in out.columns and ln not in out.columns:
                    pos = out.columns.get_loc(c)
                    out.insert(pos + 1, ln, split_df[1])
                    out.insert(pos + 1, fn, split_df[0])
                    out = out.drop(columns=[c])
                    log.add(
                        "format",
                        f"Compound name column '{c}'",
                        f"Split into '{fn}' and '{ln}'",
                        "Full-name pattern detected; split into first/last components",
                        0.82, int(two_word.sum()),
                    )
            continue

        # ── Consistent delimiter splitting ───────────────────────────────
        # Skip columns that naturally contain the delimiter as content.
        if any(excl in col_key for excl in _SPLIT_EXCLUSIONS):
            continue

        # Hyphen (last) uses stricter guards; comma/semicolon/pipe use 90 %.
        for delim, delim_name, min_hit in [
            (",",  "comma",     0.90),
            (";",  "semicolon", 0.90),
            ("|",  "pipe",      0.90),
            ("-",  "hyphen",    0.95),
        ]:
            hits = sample.str.contains(re.escape(delim), na=False)
            if hits.sum() < len(sample) * min_hit:
                continue

            # For hyphen split at most once so 'Cloud Tech-New York' gives
            # exactly 2 parts even if a value contains two hyphens.
            n_max = 1 if delim == "-" else None
            parts = sample.str.split(re.escape(delim), n=n_max, expand=True)

            if parts.shape[1] < 2 or parts.shape[1] > 8:
                continue

            # ── Consistency guards ────────────────────────────────────────
            if delim != "-":
                # Non-hyphen: every delimiter-containing row must produce the
                # same number of parts (rejects list-value columns).
                part_counts = sample[hits].str.count(re.escape(delim)) + 1
                if part_counts.nunique() > 1:
                    continue
            else:
                # Hyphen: every delimiter-containing row must have exactly 1
                # hyphen (rejects 'YYYY-MM-DD' date strings with 2 hyphens).
                if not (sample[hits].str.count(r"-") == 1).all():
                    continue

                # Skip if any split part is predominantly bare numbers
                # (date components: '2021', '04', '02').
                _numeric_part = False
                for _pi in range(parts.shape[1]):
                    _p = parts.iloc[:, _pi].dropna().str.strip()
                    if _p.str.match(r"^\d+$").sum() / max(len(_p), 1) > 0.30:
                        _numeric_part = True
                        break
                if _numeric_part:
                    continue

                # Both parts must have substantially lower cardinality than
                # the original column — confirms categorical combination.
                orig_u = sample.nunique()
                p0_u   = parts.iloc[:, 0].str.strip().nunique()
                p1_u   = parts.iloc[:, 1].str.strip().nunique()
                if max(p0_u, p1_u) / max(orig_u, 1) > 0.70:
                    continue

                # Minimum average token length — rejects 'A-B' style codes.
                if (parts.iloc[:, 0].str.strip().str.len().mean() < 2 or
                        parts.iloc[:, 1].str.strip().str.len().mean() < 2):
                    continue

            # ── Intelligent column naming ─────────────────────────────────
            n_parts = parts.shape[1]
            labels  = _infer_split_names(str(c), parts, n_parts)
            existing = set(out.columns)

            # Try: short semantic/token names → prefixed names → _partN
            final: dict[int, str] | None = None
            for option in [
                {i: labels[i]             for i in range(n_parts)},
                {i: f"{c}_{labels[i]}"   for i in range(n_parts)},
                {i: f"{c}_part{i + 1}"   for i in range(n_parts)},
            ]:
                if not any(v in existing for v in option.values()):
                    final = option
                    break
            if final is None:
                continue

            pos = out.columns.get_loc(c)
            for i in reversed(range(n_parts)):
                out.insert(pos + 1, final[i], parts.iloc[:, i].str.strip())
            out = out.drop(columns=[c])
            log.add(
                "format",
                f"Compound column '{c}' (delimiter: {delim_name})",
                f"Split into: {', '.join(final[i] for i in range(n_parts))}",
                f"{int(hits.sum() / len(sample) * 100)}% of values contained '{delim}'",
                0.80, int(hits.sum()),
            )
            break

    return out


def _normalize_column_names(df: pd.DataFrame, log: FixLog) -> pd.DataFrame:
    """Rename columns to clean snake_case: strip whitespace, lowercase,
    replace spaces/hyphens/dots with underscores, collapse repeated underscores."""
    out = df.copy()
    rename_map: dict[str, str] = {}
    for c in out.columns:
        clean = str(c).strip().lower()
        clean = re.sub(r"[\s\-\.]+", "_", clean)
        clean = re.sub(r"_+", "_", clean).strip("_")
        if clean != str(c):
            rename_map[c] = clean
    if rename_map:
        out = out.rename(columns=rename_map)
        log.add(
            "format",
            f"Inconsistent column names ({len(rename_map)} columns)",
            "Renamed to snake_case (lowercase, spaces → underscores)",
            "Uniform column naming convention",
            0.95, len(rename_map),
        )
    return out


def _drop_constant_columns(df: pd.DataFrame, log: FixLog) -> pd.DataFrame:
    """Remove columns that carry no information: all-null columns or
    columns with exactly one unique non-null value across all rows."""
    out = df.copy()
    to_drop: list[str] = []
    for c in out.columns:
        non_null = out[c].dropna()
        if len(non_null) == 0:
            to_drop.append(c)
        elif non_null.nunique() == 1 and len(non_null) > 1:
            # Never silently drop source / citation / provenance columns even
            # when constant — users expect them to survive in the output.
            if _NEVER_DROP_RE.search(str(c)):
                continue
            to_drop.append(c)
    if to_drop:
        out = out.drop(columns=to_drop)
        log.add(
            "format",
            f"{len(to_drop)} constant / all-null column(s): {', '.join(to_drop)}",
            "Dropped — carry no analytical value",
            "All values identical or all missing",
            0.90, len(to_drop),
        )
    return out


def _reconcile_categories(df: pd.DataFrame, log: FixLog, threshold: float = 0.95) -> pd.DataFrame:
    """Within each low-cardinality categorical column, cluster near-duplicate
    labels (e.g. 'USA' / 'U.S.A.' / 'United States') and map each alias to the
    most-frequent spelling using Jaro-Winkler similarity.
    """
    out = df.copy()
    for c in out.columns:
        if out[c].dtype != object:
            continue
        freq = out[c].dropna().value_counts()
        n_unique = len(freq)
        n_total  = int(out[c].notna().sum())
        if n_unique < 2 or n_unique > 50 or n_unique >= n_total * 0.90:
            continue

        labels  = list(freq.index)
        mapping: dict[str, str] = {}
        # Pre-compile once per column iteration (not per pair)
        _enum_sfx_re = re.compile(r"\s+([0-9]+|[A-Za-z]{1,3})$")
        for i, a in enumerate(labels):
            if a in mapping:
                continue
            for b in labels[i + 1:]:
                if b in mapping:
                    continue
                la, lb = str(a).lower(), str(b).lower()
                # Guard: never merge when one label is a prefix-extension of
                # the other (e.g. 'Pending' vs 'Pending MDO') — they are
                # distinct categories, not typos of each other.
                if la.startswith(lb + " ") or lb.startswith(la + " "):
                    continue
                # Guard: never merge enumerated codes that share the same root
                # but differ only by a trailing number or short alpha suffix.
                # Examples: 'Warehouse 1'/'Warehouse 2', 'Supplier A'/'Supplier B',
                # 'Tier 1'/'Tier 2', 'Phase IV'/'Phase V'.
                # These are distinct entities, not variant spellings of each other.
                _base_a = _enum_sfx_re.sub("", la).strip()
                _base_b = _enum_sfx_re.sub("", lb).strip()
                if _base_a and _base_a == _base_b:
                    continue
                sim = jaro_winkler_similarity(la, lb)
                if sim >= threshold:
                    canonical = a if freq[a] >= freq[b] else b
                    alias     = b if canonical == a else a
                    mapping[alias] = canonical

        if mapping:
            out[c] = out[c].replace(mapping)
            log.add(
                "format",
                f"Near-duplicate category labels in '{c}'",
                f"Reconciled {len(mapping)} variant(s) to canonical spelling",
                f"Jaro-Winkler ≥ {threshold:.0%} similarity threshold",
                0.80, len(mapping),
            )
    return out


def _clean_column_headers(df: pd.DataFrame, log: FixLog) -> pd.DataFrame:
    """Repair common column-header problems found in real-world datasets:

    1. Unnamed columns (pandas default "Unnamed: 0", "Unnamed: 1", …)
       → rename to "col_1", "col_2" … unless the column is an auto-index
         (monotonically increasing integers starting at 0/1) in which case drop it.
    2. Purely numeric column names ("0", "1", "2") → prefix with "col_"
    3. Whitespace-only or empty headers → replace with "col_N"
    4. Duplicate column names ("Name", "Name.1", "Name.2") → "Name", "Name_2", "Name_3"
    5. Leading / trailing whitespace in header strings
    """
    out = df.copy()
    rename_map: dict[str, str] = {}
    drop_cols: list[str] = []

    # ── Pass 1: unnamed / numeric / blank ─────────────────────────────────
    col_counter = 1
    for c in list(out.columns):
        cs = str(c).strip()
        is_unnamed = re.match(r"^Unnamed:\s*\d+$", cs, re.IGNORECASE)
        is_numeric = re.match(r"^\d+$", cs)
        is_blank   = cs == ""

        if is_unnamed or is_blank:
            col = out[c]
            # Drop if it looks like a redundant auto-index (0, 1, 2, … or 1, 2, 3, …)
            num = pd.to_numeric(col, errors="coerce")
            if num.notna().sum() == len(col) and col.notna().sum() == len(col):
                expected_0 = pd.Series(range(len(col)), index=col.index)
                expected_1 = pd.Series(range(1, len(col) + 1), index=col.index)
                if num.reset_index(drop=True).equals(expected_0.reset_index(drop=True)) \
                        or num.reset_index(drop=True).equals(expected_1.reset_index(drop=True)):
                    drop_cols.append(c)
                    continue
            rename_map[c] = f"col_{col_counter}"
            col_counter += 1
        elif is_numeric:
            rename_map[c] = f"col_{cs}"

    if drop_cols:
        out = out.drop(columns=drop_cols)
        log.add("format", f"Dropped {len(drop_cols)} redundant auto-index column(s)",
                "Auto-index columns carry no analytical value",
                "Column contained sequential 0-based or 1-based integers", 0.90, len(drop_cols))

    if rename_map:
        out = out.rename(columns=rename_map)
        log.add("format", f"Renamed {len(rename_map)} unnamed/numeric column header(s)",
                "Headers renamed to descriptive col_N names",
                "Unnamed: N or purely numeric headers detected", 0.90, len(rename_map))

    # ── Pass 2: deduplicate headers (Name, Name → Name, Name_2) ──────────
    seen: dict[str, int] = {}
    dedup_map: dict[str, str] = {}
    for c in list(out.columns):
        base = str(c)
        # Strip .N suffix that pandas adds on duplicate import
        stripped = re.sub(r"\.\d+$", "", base)
        if stripped in seen:
            seen[stripped] += 1
            dedup_map[base] = f"{stripped}_{seen[stripped]}"
        else:
            seen[stripped] = 1
            if stripped != base:
                dedup_map[base] = stripped  # clean off ".1" suffix regardless

    if dedup_map:
        out = out.rename(columns=dedup_map)
        log.add("format", f"Resolved {len(dedup_map)} duplicate/suffixed column name(s)",
                "Deduplicated column headers",
                "Duplicate names cause silent data loss in downstream tools", 0.95, len(dedup_map))

    return out


def _drop_empty_rows_cols(df: pd.DataFrame, log: FixLog,
                           row_threshold: float = 1.0,
                           col_threshold: float = 1.0) -> pd.DataFrame:
    """Remove rows and columns that are entirely (or almost entirely) null.

    row_threshold=1.0 means drop rows where ALL values are null.
    col_threshold=1.0 means drop columns where ALL values are null.
    Use 0.95 to also drop rows/cols that are 95 %+ null.
    """
    out = df.copy()

    # ── Empty columns ──────────────────────────────────────────────────────
    n_rows = len(out)
    empty_cols = [
        c for c in out.columns
        if n_rows > 0 and out[c].isna().sum() / n_rows >= col_threshold
    ]
    if empty_cols:
        out = out.drop(columns=empty_cols)
        log.add("format",
                f"{len(empty_cols)} completely empty column(s): {', '.join(str(c) for c in empty_cols)}",
                "Dropped — no data to analyse",
                "All values null",
                0.99, len(empty_cols))

    # ── Empty rows ─────────────────────────────────────────────────────────
    n_cols = len(out.columns)
    if n_cols > 0:
        null_frac = out.isna().sum(axis=1) / n_cols
        empty_rows = int((null_frac >= row_threshold).sum())
        if empty_rows > 0:
            out = out[null_frac < row_threshold].reset_index(drop=True)
            log.add("format",
                    f"{empty_rows} completely empty row(s)",
                    "Dropped — no data to analyse",
                    "All values null",
                    0.99, empty_rows)

    return out


# Phone number normalization
_PHONE_COL_RE = re.compile(
    r"(phone|tel|mobile|cell|fax|contact.?number|whatsapp|sms)",
    re.IGNORECASE,
)
# Digits-only phone value (after stripping formatting)
_PHONE_DIGITS_RE = re.compile(r"^[+]?[\d\s\-().]{7,20}$")


def _normalize_phones(df: pd.DataFrame, log: FixLog) -> pd.DataFrame:
    """Detect phone number columns and standardize their format.

    Strategy: strip all formatting characters, keep digits and leading +.
    Result: "+12025551234" or "2025551234" — consistent, machine-readable.
    """
    out = df.copy()
    for c in out.columns:
        if out[c].dtype != object:
            continue
        if not _PHONE_COL_RE.search(str(c)):
            continue
        sample = out[c].dropna().astype(str).str.strip()
        if len(sample) == 0:
            continue
        # Confirm the column actually contains phone-like values
        phone_frac = sample.apply(lambda v: bool(_PHONE_DIGITS_RE.match(v))).mean()
        if phone_frac < 0.5:
            continue

        def _fmt_phone(v: Any) -> Any:
            if v is None or (isinstance(v, float) and np.isnan(v)):
                return v
            s = str(v).strip()
            has_plus = s.startswith("+")
            digits = re.sub(r"[^\d]", "", s)
            if not digits:
                return v
            return ("+" if has_plus else "") + digits

        original = out[c].copy()
        out[c] = out[c].apply(_fmt_phone)
        changed = int((out[c] != original).sum())
        if changed:
            log.add("format", f"Phone numbers in '{c}'",
                    f"Stripped formatting from {changed} value(s)",
                    "Digits + optional leading + retained; separators removed",
                    0.88, changed)
    return out


def _whitespace_prepass(df: pd.DataFrame) -> pd.DataFrame:
    """Strip leading/trailing whitespace from EVERY string value in every object column.
    Runs as the very first step so null detection, deduplication, and type coercion
    always operate on trimmed strings with no invisible padding.
    """
    out = df.copy()
    for c in out.columns:
        if out[c].dtype == object:
            out[c] = out[c].map(lambda x: x.strip() if isinstance(x, str) else x)
    return out


def _handle_infinities(df: pd.DataFrame, log: FixLog) -> pd.DataFrame:
    """Replace +inf and -inf in every float column with NaN.
    Infinities silently corrupt descriptive stats, ML pipelines, and export files.
    """
    out = df.copy()
    total = 0
    for c in out.select_dtypes(include=["float32", "float64"]).columns:
        inf_mask = np.isinf(out[c])
        n = int(inf_mask.sum())
        if n > 0:
            out.loc[inf_mask, c] = np.nan
            total += n
    if total > 0:
        log.add(
            "missing",
            f"{total} infinite value(s) across numeric columns",
            "Replaced ±inf with NaN",
            "Infinities break statistics and model training",
            0.99, total,
        )
    return out


# URL column detection
_URL_COL_RE = re.compile(
    r"(url|uri|link|href|website|webpage|web_address|homepage|site|domain|source_url|target_url)",
    re.IGNORECASE,
)
_URL_VALUE_RE = re.compile(r"^(https?://|ftp://|//|www\.)", re.IGNORECASE)
_SCHEME_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9+\-.]*://")


def _normalize_urls(df: pd.DataFrame, log: FixLog) -> pd.DataFrame:
    """Detect URL columns and normalize:
    - Add https:// scheme when missing (www.example.com → https://www.example.com)
    - Lowercase scheme and host
    - Remove redundant trailing slashes from the path
    - Strip surrounding whitespace
    """
    out = df.copy()
    for c in out.columns:
        if out[c].dtype != object:
            continue
        col_is_url = bool(_URL_COL_RE.search(str(c)))
        if not col_is_url:
            sample = out[c].dropna().astype(str).str.strip().head(50)
            if len(sample) == 0:
                continue
            url_frac = sample.apply(lambda v: bool(_URL_VALUE_RE.match(v))).mean()
            if url_frac < 0.6:
                continue

        def _fmt_url(v: Any) -> Any:
            if v is None or (isinstance(v, float) and np.isnan(v)):
                return v
            s = str(v).strip()
            if not s:
                return np.nan
            if not _SCHEME_RE.match(s):
                s = "https://" + s.lstrip("/")
            try:
                from urllib.parse import urlparse, urlunparse
                p = urlparse(s)
                if p.scheme and p.netloc:
                    path = p.path.rstrip("/") or "/"
                    s = urlunparse((
                        p.scheme.lower(), p.netloc.lower(),
                        path, p.params, p.query, p.fragment,
                    ))
            except Exception:
                pass
            return s

        original = out[c].copy()
        out[c] = out[c].apply(_fmt_url)
        changed = int((out[c].fillna("__∅__") != original.fillna("__∅__")).sum())
        if changed > 0:
            log.add("format", f"URL column '{c}'",
                    f"Normalized {changed} URL(s): scheme ensured, host lowercased, trailing slash removed",
                    "Consistent URL format", 0.85, changed)
    return out


# Gender/sex column normalization
_GENDER_COL_RE = re.compile(
    r"^(gender|sex|biological_sex|gender_identity|gen)$",
    re.IGNORECASE,
)

_GENDER_MAP: dict[str, str] = {
    "m": "Male", "male": "Male", "man": "Male", "men": "Male",
    "boy": "Male", "gentleman": "Male", "masc": "Male", "masculine": "Male",
    "masculin": "Male", "masculino": "Male", "männlich": "Male", "maschio": "Male",
    "1": "Male",
    "f": "Female", "female": "Female", "woman": "Female", "women": "Female",
    "girl": "Female", "lady": "Female", "fem": "Female", "feminine": "Female",
    "féminin": "Female", "femenino": "Female", "weiblich": "Female", "femmina": "Female",
    "2": "Female",
    "nb": "Non-Binary", "nonbinary": "Non-Binary", "non-binary": "Non-Binary",
    "non binary": "Non-Binary", "enby": "Non-Binary", "genderqueer": "Non-Binary",
    "genderfluid": "Non-Binary", "agender": "Non-Binary",
    "x": "Other", "other": "Other", "diverse": "Other", "divers": "Other",
    "prefer not to say": "Prefer Not to Say",
    "not disclosed": "Prefer Not to Say",
    "pnts": "Prefer Not to Say",
    "unknown": "Prefer Not to Say",
}


def _normalize_gender_columns(df: pd.DataFrame, log: FixLog) -> pd.DataFrame:
    """Detect gender/sex columns and standardize all values to canonical forms.
    Only applies to columns whose name is an unambiguous gender field.
    """
    out = df.copy()
    for c in out.columns:
        if out[c].dtype != object:
            continue
        if not _GENDER_COL_RE.search(str(c)):
            continue
        sample = out[c].dropna().astype(str).str.strip()
        if len(sample) == 0:
            continue
        mapped_frac = sample.apply(lambda v: v.lower() in _GENDER_MAP).mean()
        if mapped_frac < 0.5:
            continue
        original = out[c].copy()
        out[c] = out[c].apply(
            lambda v: _GENDER_MAP.get(str(v).strip().lower(), str(v).strip())
            if isinstance(v, str) and str(v).strip() else v
        )
        changed = int((out[c].fillna("__∅__") != original.fillna("__∅__")).sum())
        if changed > 0:
            log.add("format", f"Gender column '{c}'",
                    f"Standardized {changed} value(s) → Male / Female / Non-Binary / Other",
                    "M/F/m/f/male/female/man/woman etc. all mapped to canonical form",
                    0.95, changed)
    return out


# ── Postal / ZIP code normalization ─────────────────────────────────────────
_POSTAL_COL_RE = re.compile(
    r"(zip|postal|postcode|post_code|zipcode|zip_code|pin_code|pincode|eircode|plz)",
    re.IGNORECASE,
)
_US_ZIP_CORE_RE = re.compile(r"^(\d{1,5})(-\d{4})?$")


def _normalize_postal_codes(df: pd.DataFrame, log: FixLog) -> pd.DataFrame:
    """Ensure postal / ZIP code columns are kept as strings and correctly formatted.

    - Numeric columns that were incorrectly coerced are restored to zero-padded strings.
    - US ZIP codes shorter than 5 digits are left-padded with zeros ("1234" → "01234").
    - Trailing .0 artifacts from float coercion are stripped.
    """
    out = df.copy()
    for c in out.columns:
        if not _POSTAL_COL_RE.search(str(c)):
            continue
        col = out[c]

        # Case 1: was wrongly coerced to numeric (int/float) — restore as string
        if pd.api.types.is_numeric_dtype(col):
            restored = col.apply(
                lambda v: (
                    str(int(v)).zfill(5) if (not pd.isna(v) and int(v) < 100_000)
                    else (str(int(v)) if not pd.isna(v) else np.nan)
                )
            )
            n = int(col.notna().sum())
            out[c] = restored
            log.add("format", f"Postal code column '{c}' was numeric",
                    f"Restored {n} value(s) to zero-padded string",
                    "Postal codes MUST be strings — leading zeros are significant",
                    0.99, n)
            continue

        # Case 2: string column — clean up and zero-pad US ZIPs
        if col.dtype != object:
            continue

        def _fix_postal(v: Any) -> Any:
            if v is None or (isinstance(v, float) and np.isnan(v)):
                return v
            s = str(v).strip().split(".")[0]  # remove .0 artifact
            m = _US_ZIP_CORE_RE.match(s)
            if m:
                core = m.group(1).zfill(5)
                suffix = m.group(2) or ""
                return core + suffix
            return s

        original = out[c].copy()
        out[c] = out[c].apply(_fix_postal)
        changed = int((out[c].fillna("") != original.fillna("")).sum())
        if changed > 0:
            log.add("format", f"Postal codes in '{c}'",
                    f"Normalized {changed} value(s) (zero-padded US ZIPs, stripped .0 artifacts)",
                    "Consistent postal code format", 0.90, changed)
    return out


# ── Country name normalization ────────────────────────────────────────────────
_COUNTRY_COL_RE = re.compile(
    r"^(country|nation|country_name|nationality|country_of_origin|country_of_residence"
    r"|country_code|ctry)$",
    re.IGNORECASE,
)

_COUNTRY_MAP: dict[str, str] = {
    "us": "United States", "usa": "United States", "u.s.": "United States",
    "u.s.a.": "United States", "united states of america": "United States",
    "america": "United States",
    "uk": "United Kingdom", "u.k.": "United Kingdom", "great britain": "United Kingdom",
    "britain": "United Kingdom", "gb": "United Kingdom", "england": "United Kingdom",
    "uae": "United Arab Emirates", "u.a.e.": "United Arab Emirates",
    "emirates": "United Arab Emirates",
    "sa": "Saudi Arabia", "ksa": "Saudi Arabia",
    "prc": "China", "pr china": "China", "peoples republic of china": "China",
    "rok": "South Korea", "korea (republic of)": "South Korea",
    "dprk": "North Korea", "north korea": "North Korea",
    "au": "Australia", "aus": "Australia",
    "ca": "Canada", "can": "Canada",
    "de": "Germany", "ger": "Germany", "deutschland": "Germany",
    "fr": "France",
    "it": "Italy", "ita": "Italy",
    "es": "Spain", "esp": "Spain",
    "pt": "Portugal", "por": "Portugal",
    "nl": "Netherlands", "nld": "Netherlands", "the netherlands": "Netherlands",
    "be": "Belgium", "bel": "Belgium",
    "ch": "Switzerland", "che": "Switzerland",
    "at": "Austria", "aut": "Austria",
    "se": "Sweden", "swe": "Sweden", "sverige": "Sweden",
    "no": "Norway", "nor": "Norway", "norge": "Norway",
    "dk": "Denmark", "dnk": "Denmark", "danmark": "Denmark",
    "fi": "Finland", "fin": "Finland", "suomi": "Finland",
    "ru": "Russia", "rus": "Russia", "russian federation": "Russia",
    "cn": "China", "chn": "China",
    "in": "India", "ind": "India",
    "jp": "Japan", "jpn": "Japan",
    "br": "Brazil", "bra": "Brazil", "brasil": "Brazil",
    "mx": "Mexico", "mex": "Mexico",
    "ar": "Argentina", "arg": "Argentina",
    "cl": "Chile", "chl": "Chile",
    "co": "Colombia", "col": "Colombia",
    "pe": "Peru", "per": "Peru",
    "za": "South Africa", "rsa": "South Africa",
    "ng": "Nigeria", "nga": "Nigeria",
    "ke": "Kenya", "ken": "Kenya",
    "eg": "Egypt", "egy": "Egypt",
    "gh": "Ghana", "gha": "Ghana",
    "nz": "New Zealand", "nzl": "New Zealand",
    "sg": "Singapore", "sgp": "Singapore",
    "my": "Malaysia", "mys": "Malaysia",
    "th": "Thailand", "tha": "Thailand",
    "id": "Indonesia", "idn": "Indonesia",
    "ph": "Philippines", "phl": "Philippines",
    "vn": "Vietnam", "vnm": "Vietnam", "viet nam": "Vietnam",
    "tr": "Turkey", "tur": "Turkey",
    "il": "Israel", "isr": "Israel",
    "ir": "Iran", "irn": "Iran",
    "iq": "Iraq", "irq": "Iraq",
    "pk": "Pakistan", "pak": "Pakistan",
    "bd": "Bangladesh", "bgd": "Bangladesh",
    "lk": "Sri Lanka", "lka": "Sri Lanka",
    "np": "Nepal", "npl": "Nepal",
    "mm": "Myanmar", "mmr": "Myanmar", "burma": "Myanmar",
    "tw": "Taiwan", "twn": "Taiwan",
    "hk": "Hong Kong", "hkg": "Hong Kong",
    "pl": "Poland", "pol": "Poland",
    "cz": "Czech Republic", "cze": "Czech Republic", "czechia": "Czech Republic",
    "sk": "Slovakia", "svk": "Slovakia",
    "hu": "Hungary", "hun": "Hungary",
    "ro": "Romania", "rou": "Romania",
    "bg": "Bulgaria", "bgr": "Bulgaria",
    "hr": "Croatia", "hrv": "Croatia",
    "rs": "Serbia", "srb": "Serbia",
    "gr": "Greece", "grc": "Greece",
    "ua": "Ukraine", "ukr": "Ukraine",
    "by": "Belarus", "blr": "Belarus",
    "kz": "Kazakhstan", "kaz": "Kazakhstan",
    "uz": "Uzbekistan", "uzb": "Uzbekistan",
    "ma": "Morocco", "mar": "Morocco",
    "tz": "Tanzania", "tza": "Tanzania",
    "et": "Ethiopia", "eth": "Ethiopia",
    "ug": "Uganda", "uga": "Uganda",
    "sn": "Senegal", "sen": "Senegal",
    "ci": "Ivory Coast", "civ": "Ivory Coast",
    "cm": "Cameroon", "cmr": "Cameroon",
    "ao": "Angola", "ago": "Angola",
    "mz": "Mozambique", "moz": "Mozambique",
    "zw": "Zimbabwe", "zwe": "Zimbabwe",
    "zm": "Zambia", "zmb": "Zambia",
    "sd": "Sudan", "sdn": "Sudan",
}


def _normalize_country_columns(df: pd.DataFrame, log: FixLog) -> pd.DataFrame:
    """Detect country name columns and map abbreviations / variants to ISO common names.
    Only activates when ≥20 % of values match a known country abbreviation.
    """
    out = df.copy()
    for c in out.columns:
        if out[c].dtype != object:
            continue
        if not _COUNTRY_COL_RE.search(str(c)):
            continue
        sample = out[c].dropna().astype(str).str.strip()
        if len(sample) == 0:
            continue
        mapped_frac = sample.apply(lambda v: v.lower() in _COUNTRY_MAP).mean()
        if mapped_frac < 0.20:
            continue
        original = out[c].copy()
        out[c] = out[c].apply(
            lambda v: _COUNTRY_MAP.get(str(v).strip().lower(), str(v).strip())
            if isinstance(v, str) and str(v).strip() else v
        )
        changed = int((out[c].fillna("") != original.fillna("")).sum())
        if changed > 0:
            log.add("format", f"Country column '{c}'",
                    f"Normalized {changed} country name(s) to ISO common names",
                    "e.g. US→United States, UK→United Kingdom, UAE→United Arab Emirates",
                    0.90, changed)
    return out


# ── Geographic coordinate validation ─────────────────────────────────────────
_LAT_COL_RE = re.compile(r"(^lat$|latitude|lat_|_lat)", re.IGNORECASE)
_LON_COL_RE = re.compile(r"(^lon$|^lng$|longitude|lon_|_lon|lng_|_lng)", re.IGNORECASE)


def _validate_lat_lon(df: pd.DataFrame, log: FixLog) -> pd.DataFrame:
    """Validate latitude (−90 to 90) and longitude (−180 to 180) columns.
    Out-of-range values are set to NaN and logged.
    """
    out = df.copy()
    for c in out.columns:
        if not pd.api.types.is_numeric_dtype(out[c]):
            continue
        col_lower = str(c).lower()
        if _LAT_COL_RE.search(col_lower):
            bad = (out[c] < -90) | (out[c] > 90)
            n = int(bad.sum())
            if n > 0:
                out.loc[bad, c] = np.nan
                log.add("invalid", f"Out-of-range latitude in '{c}'",
                        f"{n} value(s) outside [−90, 90] set to NaN",
                        "Valid latitude range is −90 to +90 degrees", 0.99, n)
        elif _LON_COL_RE.search(col_lower):
            bad = (out[c] < -180) | (out[c] > 180)
            n = int(bad.sum())
            if n > 0:
                out.loc[bad, c] = np.nan
                log.add("invalid", f"Out-of-range longitude in '{c}'",
                        f"{n} value(s) outside [−180, 180] set to NaN",
                        "Valid longitude range is −180 to +180 degrees", 0.99, n)
    return out


# ── Integer-float cleanup ─────────────────────────────────────────────────────
_SKIP_INT_FIX_RE = re.compile(
    r"(price|rate|ratio|percent|pct|lat|lon|longitude|latitude|amount|revenue"
    r"|salary|wage|gpa|score|coefficient|factor|weight|prob)",
    re.IGNORECASE,
)


def _fix_integer_floats(df: pd.DataFrame, log: FixLog) -> pd.DataFrame:
    """Convert float64 columns whose values are all whole numbers to Int64
    (pandas nullable integer). This cleans output like 200.0 → 200.

    Skips columns where decimal precision is semantically meaningful
    (prices, rates, ratios, probabilities, coordinates, etc.).
    """
    out = df.copy()
    for c in out.select_dtypes(include=["float64", "float32"]).columns:
        if _SKIP_INT_FIX_RE.search(str(c)):
            continue
        vals = out[c].dropna()
        if len(vals) == 0:
            continue
        if not ((vals % 1) == 0).all():
            continue
        if vals.abs().max() > 2 ** 53:
            continue
        try:
            out[c] = out[c].astype("Int64")
            log.add("format", f"Whole-number float column '{c}'",
                    f"Converted float64 → Int64 ({len(vals)} values: e.g. 200.0 → 200)",
                    "All values are integers — no fractional information", 0.88, len(vals))
        except Exception:
            pass
    return out


# ── Final null scrub ──────────────────────────────────────────────────────────

def _final_null_scrub(df: pd.DataFrame, log: FixLog) -> pd.DataFrame:
    """Very last safety sweep before export:

    1. Replace any empty strings that appeared after transformations with NaN.
    2. Replace literal 'nan', 'none', 'null', 'nat' strings from repr() leakage.
    3. Replace ±inf that may have appeared from arithmetic inside transforms.
    4. Normalize None/np.nan inconsistency in object columns.

    Fully vectorized — no per-cell Python loops — scales to millions of rows.
    """
    out = df.copy()
    _STR_NULL_LITERALS = frozenset({"nan", "none", "null", "nat", "pd.nat", "<na>", "inf", "-inf"})

    empty_total, inf_total = 0, 0

    for c in out.select_dtypes(include=["object"]).columns:
        not_null = out[c].notna()
        if not not_null.any():
            continue
        # Operate only on the non-null slice to avoid converting NaN → "nan"
        str_vals = out[c][not_null].astype(str).str.strip()
        # For columns where NONE/NA is a real category value (e.g. medication=NONE,
        # status=NA) only replace empty strings, not the ambiguous null literals.
        if _PRESERVE_AMBIGUOUS_COL.search(str(c)):
            bad = str_vals == ""
        else:
            bad = (str_vals == "") | str_vals.str.lower().isin(_STR_NULL_LITERALS)
        if bad.any():
            out.loc[str_vals.index[bad], c] = np.nan
            empty_total += int(bad.sum())

    for c in out.select_dtypes(include=["float32", "float64"]).columns:
        inf_mask = np.isinf(out[c].fillna(0))
        n = int(inf_mask.sum())
        if n > 0:
            out.loc[inf_mask, c] = np.nan
            inf_total += n

    if empty_total > 0:
        log.add("missing", f"{empty_total} residual empty/literal-null string(s)",
                "Converted to NaN in final scrub",
                "Strings like '', 'nan', 'None', 'NaT' replaced with real NaN",
                0.99, empty_total)
    if inf_total > 0:
        log.add("missing", f"{inf_total} infinite value(s) found post-transform",
                "Converted to NaN in final scrub",
                "Arithmetic during cleaning can introduce inf values",
                0.99, inf_total)
    return out


def prepare_export(df: pd.DataFrame) -> pd.DataFrame:
    """Final polish applied to the cleaned DataFrame right before writing to file.

    • Drops internal / flag columns (_anomalous_flag, is_missing_*, _is_duplicate)
    • Converts datetime columns to ISO-8601 date strings  (YYYY-MM-DD)
    • Converts boolean columns to Yes / No  (more legible in Excel / CSV)
    • Ensures no pandas NA / NaN leaks as the literal string 'nan' in object columns
    • Strips any residual ∅-prefixed null-like strings that were missed upstream
    """
    out = df.copy()

    # ── 1. Drop internal metadata columns ───────────────────────────────
    # Covers: _anomalous_flag, is_missing_*, *_negative_flag, *_validation_error
    _INTERNAL_FLAG_RE = re.compile(
        r"(_anomalous_flag|_negative_flag|_validation_error|_is_duplicate)$",
        re.IGNORECASE,
    )
    drop_cols = [
        c for c in out.columns
        if str(c).startswith("_")
        or str(c).startswith("is_missing_")
        or bool(_INTERNAL_FLAG_RE.search(str(c)))
    ]
    if drop_cols:
        out = out.drop(columns=drop_cols, errors="ignore")

    # ── 2. Datetime → YYYY-MM-DD string ────────────────────────────────
    for c in out.columns:
        if pd.api.types.is_datetime64_any_dtype(out[c]):
            out[c] = out[c].dt.strftime("%Y-%m-%d").where(out[c].notna(), other=None)

    # ── 3. Boolean → Yes / No ───────────────────────────────────────────
    for c in out.columns:
        if out[c].dtype == bool or str(out[c].dtype) in ("boolean", "bool"):
            out[c] = out[c].map({True: "Yes", False: "No"})

    # ── 4. Scrub residual null-like strings (vectorized) ────────────────
    _RESIDUAL_PAT = r"^[\u2205\s]*(null|none|na|n/a|nan|nil)[\u2205\s]*$"
    for c in out.columns:
        if out[c].dtype == object:
            # Skip columns where NONE/NA/null are legitimate category values.
            if _PRESERVE_AMBIGUOUS_COL.search(str(c)):
                continue
            not_null = out[c].notna()
            if not not_null.any():
                continue
            matched = out[c][not_null].astype(str).str.strip().str.match(
                _RESIDUAL_PAT, case=False, na=False
            )
            if matched.any():
                out.loc[out[c].index[not_null][matched], c] = None

    # ── 5. Replace numpy NaN in object columns with None (→ empty in Excel/CSV) ─
    for c in out.columns:
        if out[c].dtype == object:
            out[c] = out[c].where(out[c].notna(), other=None)

    return out


def clean_dataframe(df: pd.DataFrame, options: dict[str, Any]) -> tuple[pd.DataFrame, dict[str, Any]]:
    log = FixLog()
    # Normalise pandas StringDtype (dtype='str'/'string') → plain object so that
    # every downstream dtype check (out[c].dtype == object) works correctly on
    # any pandas version.  Numeric / datetime columns are left untouched.
    _str_cols = [
        c for c in df.columns
        if str(df[c].dtype) in ("string", "str")
        or isinstance(df[c].dtype, pd.StringDtype)
    ]
    if _str_cols:
        df = df.copy()
        for c in _str_cols:
            df[c] = df[c].astype(object)

    # ── Step 0: Structural repairs ───────────────────────────────────────
    # Fix column headers FIRST — everything else depends on reliable column names.
    out_pre = _clean_column_headers(df, log)
    # Drop completely empty rows and columns before any analysis.
    out_pre = _drop_empty_rows_cols(out_pre, log)
    # Strip all string whitespace unconditionally so every downstream step
    # sees clean, trimmed values (null detection, dedup, type coercion).
    out_pre = _whitespace_prepass(out_pre)

    # Optional strict schema enforcement before heuristic transforms.
    out, schema_quarantine = _enforce_schema_contract(out_pre, options, log)
    pre_null_like_fixed = 0
    for _c in out.select_dtypes(include=["object"]).columns:
        _nn = out[_c].notna()
        if _nn.any():
            pre_null_like_fixed += int(
                out[_c][_nn].astype(str).str.strip().str.lower().isin(_NULL_LIKE_VALUES).sum()
            )

    # Normalise null-like strings to real NaN FIRST so every downstream step
    # (deduplication, imputation, validation) sees consistent missing values.
    out = _normalize_null_strings(out)

    # Count how many null-like strings were converted so we can log it
    null_like_fixed = pre_null_like_fixed
    if null_like_fixed > 0:
        log.add(
            "missing",
            f"{null_like_fixed} null-like strings ('N/A', 'null', 'none', etc.)",
            "Converted to real NaN for proper imputation",
            "Standardise missing representation before cleaning",
            0.99,
            null_like_fixed,
        )

    # Initialize quarantine dataframe
    quarantine_df = None
    if options.get("quarantine_failed", False):
        quarantine_df = pd.DataFrame()
    if schema_quarantine is not None:
        if quarantine_df is None:
            quarantine_df = schema_quarantine.copy()
        else:
            quarantine_df = pd.concat([quarantine_df, schema_quarantine], ignore_index=True)

    # Deduplication with new options
    if options.get("remove_duplicates", True):
        uniqueness_cols = options.get("uniqueness_cols")
        survivorship = options.get("survivorship", "first")
        fuzzy_threshold = options.get("fuzzy_threshold", 0.0)
        out = _drop_duplicates(out, log, uniqueness_cols, survivorship, fuzzy_threshold)

    if options.get("coerce_types", True):
        out = _coerce_numeric_columns(out, log)
        # Postal codes must be fixed BEFORE infinity handling so numeric
        # postal columns are converted back to strings first.
        out = _normalize_postal_codes(out, log)
        out = _handle_infinities(out, log)
        date_cols = _infer_date_columns(out)
        timezone = options.get("timezone")
        out = _parse_dates(out, date_cols, log, timezone)

    if options.get("normalize_strings", True):
        normalize_special_chars = options.get("normalize_special_chars", True)
        out = _apply_confidence_gate(
            out,
            log,
            options,
            "normalize_strings",
            "normalize_strings",
            lambda frame: _normalize_strings(frame, log, normalize_special_chars),
        )

    if options.get("fix_typos", True):
        out = _apply_confidence_gate(
            out,
            log,
            options,
            "fix_typos",
            "fix_typos",
            lambda frame: _fix_typos(frame, log),
        )

    if options.get("auto_standardize", True):
        out = _apply_confidence_gate(
            out,
            log,
            options,
            "auto_standardize",
            "auto_standardize",
            lambda frame: _auto_standardize_values(frame, log),
        )

    if options.get("normalize_phones", True):
        out = _normalize_phones(out, log)

    if options.get("normalize_urls", True):
        out = _normalize_urls(out, log)

    if options.get("normalize_gender", True):
        out = _normalize_gender_columns(out, log)

    if options.get("normalize_countries", True):
        out = _normalize_country_columns(out, log)

    if options.get("split_columns", True):
        out = _apply_confidence_gate(
            out,
            log,
            options,
            "split_columns",
            "split_columns",
            lambda frame: _split_compound_columns(frame, log),
        )

    if options.get("reconcile_categories", True):
        out = _apply_confidence_gate(
            out,
            log,
            options,
            "reconcile_categories",
            "reconcile_categories",
            lambda frame: _reconcile_categories(frame, log),
        )

    if options.get("normalize_column_names", True):
        out = _normalize_column_names(out, log)

    if options.get("drop_constant_columns", False):
        out = _drop_constant_columns(out, log)

    if options.get("validate_emails", True):
        out = _validate_emails(out, log)

    if options.get("validate_geo", True):
        out = _validate_lat_lon(out, log)

    vmin = options.get("validate_age_min")
    vmax = options.get("validate_age_max")
    if vmin is not None or vmax is not None:
        out = _validate_age(out, vmin, vmax, log)

    rules = options.get("custom_rules") or []
    if rules:
        out = _apply_custom_rules(out, rules, log)
    
    # Cross-field validation
    if options.get("cross_field_validation", True):
        out, quarantine_df = _cross_field_validation(out, log, quarantine_df)

    if options.get("clip_outliers", False):
        distinguish_impossible = options.get("distinguish_impossible", True)
        out, quarantine_df = _clip_outliers(
            out,
            options.get("outlier_method", "iqr"),
            float(options.get("outlier_z_threshold", 3.0)),
            log,
            distinguish_impossible,
            quarantine_df,
        )

    if options.get("fix_missing", True):
        strat = options.get("missing_strategy", "median")
        add_missing_indicators = options.get("add_missing_indicators", False)
        use_placeholder = options.get("use_placeholder", False)
        
        if strat == "drop":
            before = len(out)
            out = out.dropna()
            log.add("missing", "drop strategy", f"Rows reduced {before} -> {len(out)}", "dropna()", 0.85, before - len(out))
        elif strat in ("forward_fill", "ffill"):
            out = out.ffill().bfill()
            log.add("missing", "ffill/bfill", "Propagated adjacent values (all columns)", "Time-series friendly", 0.6, None)
        elif strat == "bfill":
            out = out.bfill().ffill()
            log.add("missing", "bfill/ffill", "Back-propagated adjacent values (all columns)", "Time-series friendly", 0.6, None)
        else:
            out = _impute_missing(out, strat, log, add_missing_indicators)
            
        # Add placeholders for non-critical categorical data
        if use_placeholder:
            cat_cols = out.select_dtypes(include=["object"]).columns
            for c in cat_cols:
                if out[c].isna().any():
                    placeholder = options.get("placeholder_value", "Unknown")
                    n = int(out[c].isna().sum())
                    out[c] = out[c].fillna(placeholder)
                    log.add(
                        "missing",
                        f"Missing categorical in '{c}'",
                        f"Filled with placeholder: {placeholder}",
                        "Placeholder preserves row while indicating missingness",
                        0.75,
                        n,
                    )

    # Fix integer-valued float columns (200.0 → 200) before export.
    out = _fix_integer_floats(out, log)

    # Final safety sweep: empty strings, repr-leaked 'nan'/'None' strings, ±inf.
    out = _final_null_scrub(out, log)

    # Final polish: strip internal metadata columns (_anomalous_flag, is_missing_*, etc.),
    # convert datetimes to ISO strings, booleans to Yes/No, and scrub residual null-like
    # strings — do this unconditionally so the output is always clean regardless of how
    # clean_dataframe is invoked.
    out = prepare_export(out)

    report = {
        "fixes": log.entries,
        "row_count_before": len(df),
        "row_count_after": len(out),
        "column_count": len(out.columns),
        "quarantine_count": len(quarantine_df) if quarantine_df is not None else 0,
    }
    guardrail_events = [e for e in log.entries if e.get("category") == "guardrail"]
    schema_events = [e for e in log.entries if e.get("category") == "schema"]
    report["guardrails"] = {
        "min_transform_confidence": float(options.get("min_transform_confidence", 0.0) or 0.0),
        "blocked_steps": [str(e.get("what_was_wrong", "")) for e in guardrail_events],
        "blocked_steps_count": len(guardrail_events),
    }
    report["schema_validation"] = {
        "enabled": bool(options.get("strict_schema")),
        "issues_count": len(schema_events),
        "issues": schema_events[:50],
    }

    if quarantine_df is not None and len(quarantine_df) > 0:
        report["quarantine_available"] = True
        report["quarantine_sample"] = quarantine_df.head(5).to_dict("records")

    return out, report


def run_great_expectations_smoke(df: pd.DataFrame) -> dict[str, Any] | None:
    try:
        import great_expectations as ge
    except Exception:
        return None
    try:
        gdf = ge.from_pandas(df)
        results = []
        for c in df.columns[: min(20, len(df.columns))]:
            try:
                r = gdf.expect_column_values_to_not_be_null(column=c, mostly=0.6)
                results.append({"column": c, "success": bool(r.success), "expectation": "not_null_mostly_60"})
            except Exception:
                continue
        ok = sum(1 for x in results if x["success"])
        return {"expectations_run": len(results), "passed": ok, "details": results[:50]}
    except Exception as e:
        return {"error": str(e)}
