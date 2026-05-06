import pandas as pd
import pytest

from app.services.cleaning_engine import clean_dataframe


def _base_options() -> dict:
    return {
        "fix_missing": False,
        "remove_duplicates": False,
        "coerce_types": False,
        "normalize_strings": False,
        "fix_typos": False,
        "clip_outliers": False,
        "validate_emails": False,
        "cross_field_validation": False,
        "auto_standardize": False,
        "split_columns": False,
        "reconcile_categories": False,
        "normalize_column_names": False,
        "drop_constant_columns": False,
        "quarantine_failed": False,
        "strict_schema": {},
    }


def test_confidence_gate_blocks_low_confidence_typo_fix() -> None:
    df = pd.DataFrame({"city": ["new yrok", "cape twon"]})
    opts = _base_options()
    opts.update({"fix_typos": True, "min_transform_confidence": 0.8})

    cleaned, report = clean_dataframe(df, opts)

    assert cleaned["city"].tolist() == ["new yrok", "cape twon"]
    assert any(
        e["category"] == "guardrail" and "fix_typos blocked" in e["what_was_wrong"]
        for e in report["fixes"]
    )


def test_strict_schema_type_mismatches_go_to_quarantine() -> None:
    df = pd.DataFrame({"age": ["10", "oops"], "name": ["A", "B"]})
    opts = _base_options()
    opts.update(
        {
            "coerce_types": True,
            "quarantine_failed": True,
            "quarantine_on_schema_failure": True,
            "strict_schema": {"column_types": {"age": "numeric"}},
        }
    )

    cleaned, report = clean_dataframe(df, opts)

    assert pd.api.types.is_numeric_dtype(cleaned["age"])
    assert report["quarantine_count"] >= 1


def test_strict_schema_required_column_can_fail_hard() -> None:
    df = pd.DataFrame({"name": ["A"]})
    opts = _base_options()
    opts.update(
        {
            "fail_on_schema_error": True,
            "strict_schema": {"required_columns": ["name", "age"]},
        }
    )

    with pytest.raises(ValueError, match="Missing required columns"):
        clean_dataframe(df, opts)
