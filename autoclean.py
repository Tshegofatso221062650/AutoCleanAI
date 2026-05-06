#!/usr/bin/env python3
"""
AutoClean AI — CLI (bonus mode).
Usage: python autoclean.py path/to/dataset.csv [--out cleaned.csv] [--report report.txt]
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Resolve backend on path
ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / "backend"))

from app.services.analysis import analyze_dataframe, quality_score_from_profile  # noqa: E402
from app.services.cleaning_engine import clean_dataframe, load_dataframe  # noqa: E402


def infer_fmt(p: Path) -> str:
    s = p.suffix.lower().lstrip(".")
    if s in ("csv", "json", "xlsx", "xls"):
        return "xlsx" if s == "xlsx" else "xls" if s == "xls" else s
    raise SystemExit(f"Unsupported extension: {p.suffix}")


def main() -> None:
    ap = argparse.ArgumentParser(description="AutoClean AI Personal — CLI")
    ap.add_argument("input", type=Path, help="Input CSV / XLSX / JSON")
    ap.add_argument("--out", type=Path, default=None, help="Output CSV path")
    ap.add_argument("--report", type=Path, default=None, help="Text report path")
    args = ap.parse_args()
    src: Path = args.input
    if not src.exists():
        raise SystemExit(f"File not found: {src}")

    fmt = infer_fmt(src)
    df = load_dataframe(src, fmt)
    before_profile = analyze_dataframe(df)
    opts = {
        "fix_missing": True,
        "missing_strategy": "median",
        "remove_duplicates": True,
        "coerce_types": True,
        "normalize_strings": True,
        "fix_typos": True,
        "clip_outliers": False,
        "outlier_method": "iqr",
        "outlier_z_threshold": 3.0,
        "validate_emails": True,
        "validate_age_min": 0,
        "validate_age_max": 120,
        "custom_rules": [],
        "safe_mode": True,
    }
    cleaned, report = clean_dataframe(df, opts)
    after_profile = analyze_dataframe(cleaned)

    out_csv = args.out or src.with_name(f"{src.stem}_cleaned.csv")
    cleaned.to_csv(out_csv, index=False)

    rep_path = args.report or src.with_name("report.txt")
    lines = [
        "AutoClean AI — CLI Report",
        f"Input: {src}",
        f"Rows: {before_profile['total_rows']} -> {after_profile['total_rows']}",
        f"Quality score: {before_profile.get('quality_score')} -> {after_profile.get('quality_score')}",
        "",
        "Fixes:",
    ]
    for e in report.get("fixes") or []:
        lines.append(
            f"- [{e.get('category')}] {e.get('what_was_wrong')} => {e.get('what_was_fixed')} "
            f"(confidence {e.get('confidence')})"
        )
    rep_path.write_text("\n".join(lines), encoding="utf-8")

    print(f"Wrote {out_csv}")
    print(f"Wrote {rep_path}")
    print(f"Quality: {quality_score_from_profile(before_profile)} -> {quality_score_from_profile(after_profile)}")


if __name__ == "__main__":
    main()
