from typing import Any
import json
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from app.db import get_conn, _utc_now


def _compute_column_stats(analysis: dict) -> dict:
    """
    Derive per-column distribution stats from an analysis profile dict.
    Numeric columns: mean, std, skew, p25, p75.
    Categorical columns: top-value proportions (up to 10 values).
    """
    stats: dict[str, Any] = {}
    dtypes: dict[str, str] = analysis.get("dtypes") or {}
    missing_per_col: dict[str, int] = analysis.get("missing_per_column") or {}
    total_rows: int = max(analysis.get("total_rows") or 1, 1)

    # Numeric columns — pull from profile if pre-computed, otherwise skip gracefully
    numeric_cols: list[str] = analysis.get("numeric_columns") or []
    col_stats_raw: dict = analysis.get("column_stats_raw") or {}  # populated by clean router if available

    for col in numeric_cols:
        raw = col_stats_raw.get(col, {})
        entry: dict[str, Any] = {
            "type": "numeric",
            "missing_pct": round(100.0 * missing_per_col.get(col, 0) / total_rows, 4),
        }
        for k in ("mean", "std", "skew", "p25", "p75", "min", "max"):
            if k in raw:
                entry[k] = raw[k]
        stats[col] = entry

    # Categorical columns — top-value proportions
    cat_proportions: dict[str, dict] = analysis.get("category_proportions") or {}
    for col, dtype in dtypes.items():
        if dtype != "object":
            continue
        entry = {
            "type": "categorical",
            "missing_pct": round(100.0 * missing_per_col.get(col, 0) / total_rows, 4),
        }
        if col in cat_proportions:
            entry["top_proportions"] = cat_proportions[col]
        stats[col] = entry

    return stats


def record_quality_snapshot(dataset_id: str, analysis: dict) -> None:
    """Record a quality snapshot including per-column distribution stats."""
    column_stats = _compute_column_stats(analysis)
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO quality_history
            (dataset_id, quality_score, missing_pct, duplicate_pct, row_count, col_count, timestamp, column_stats)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dataset_id,
                analysis.get("quality_score", 0),
                analysis.get("missing_cells_pct", 0),
                analysis.get("duplicate_rows_pct", 0),
                analysis.get("total_rows", 0),
                analysis.get("total_columns", 0),
                _utc_now(),
                json.dumps(column_stats),
            ),
        )


def get_quality_history(dataset_id: str, days: int = 30) -> list[dict]:
    """Get quality history for a dataset over the specified period."""
    cutoff = (datetime.now() - timedelta(days=days)).isoformat()
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT * FROM quality_history 
            WHERE dataset_id = ? AND timestamp >= ?
            ORDER BY timestamp ASC
            """,
            (dataset_id, cutoff)
        ).fetchall()
        return [dict(r) for r in rows]


def get_quality_trend(dataset_id: str) -> dict[str, Any]:
    """Calculate quality trend metrics."""
    history = get_quality_history(dataset_id, days=90)
    
    if len(history) < 2:
        return {
            'trend': 'insufficient_data',
            'current_score': history[0]['quality_score'] if history else 0,
            'change': 0,
            'change_pct': 0
        }
    
    current = history[-1]
    previous = history[0]
    
    score_change = current['quality_score'] - previous['quality_score']
    score_change_pct = (score_change / previous['quality_score'] * 100) if previous['quality_score'] > 0 else 0
    
    missing_change = current['missing_pct'] - previous['missing_pct']
    duplicate_change = current['duplicate_pct'] - previous['duplicate_pct']
    
    trend = 'stable'
    if abs(score_change_pct) > 5:
        trend = 'improving' if score_change > 0 else 'degrading'
    
    return {
        'trend': trend,
        'current_score': current['quality_score'],
        'previous_score': previous['quality_score'],
        'change': score_change,
        'change_pct': score_change_pct,
        'missing_change': missing_change,
        'duplicate_change': duplicate_change,
        'snapshots_count': len(history),
        'period_days': 90
    }


def get_all_quality_metrics(days: int = 30) -> list[dict]:
    """Get quality metrics for all datasets over the specified period."""
    cutoff = (datetime.now() - timedelta(days=days)).isoformat()
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT 
                dataset_id,
                AVG(quality_score) as avg_quality,
                MIN(quality_score) as min_quality,
                MAX(quality_score) as max_quality,
                AVG(missing_pct) as avg_missing,
                AVG(duplicate_pct) as avg_duplicate,
                COUNT(*) as snapshot_count
            FROM quality_history
            WHERE timestamp >= ?
            GROUP BY dataset_id
            ORDER BY avg_quality DESC
            """,
            (cutoff,)
        ).fetchall()
        return [dict(r) for r in rows]


def detect_quality_anomalies(dataset_id: str, threshold: float = 2.0) -> list[dict]:
    """
    Detect quality anomalies using statistical methods.
    
    Returns list of snapshots that deviate significantly from the norm.
    """
    history = get_quality_history(dataset_id, days=90)
    
    if len(history) < 5:
        return []
    
    scores = [h['quality_score'] for h in history]
    mean_score = sum(scores) / len(scores)
    std_score = (sum((s - mean_score) ** 2 for s in scores) / len(scores)) ** 0.5
    
    anomalies = []
    for h in history:
        z_score = (h['quality_score'] - mean_score) / std_score if std_score > 0 else 0
        if abs(z_score) > threshold:
            anomalies.append({
                **h,
                'z_score': z_score,
                'deviation': 'high' if z_score > 0 else 'low'
            })
    
    return anomalies


def generate_quality_report(dataset_id: str) -> dict[str, Any]:
    """Generate a comprehensive quality report."""
    trend = get_quality_trend(dataset_id)
    history = get_quality_history(dataset_id, days=30)
    anomalies = detect_quality_anomalies(dataset_id)
    
    latest_snapshot = history[-1] if history else None
    
    return {
        'current_status': latest_snapshot,
        'trend_analysis': trend,
        'anomalies_detected': len(anomalies),
        'anomaly_details': anomalies[:10],  # Limit to top 10
        'snapshot_count': len(history),
        'report_generated_at': _utc_now()
    }


def detect_distribution_shift(dataset_id: str, mean_drift_threshold: float = 0.2,
                               proportion_shift_threshold: float = 0.10) -> list[dict]:
    """
    Compare the latest snapshot's per-column stats against the historical baseline
    (mean of all previous snapshots) to surface distribution and proportion shifts.

    mean_drift_threshold: flag numeric column if |Δmean| > threshold × historical_std
    proportion_shift_threshold: flag categorical column if any value's proportion shifted by > this amount (0–1)
    """
    history = get_quality_history(dataset_id, days=90)
    if len(history) < 2:
        return []

    # Parse column_stats JSON for each snapshot that has it
    parsed: list[dict] = []
    for snap in history:
        raw = snap.get("column_stats")
        if raw:
            try:
                parsed.append({"timestamp": snap["timestamp"], "stats": json.loads(raw)})
            except Exception:
                pass

    if len(parsed) < 2:
        return []

    latest = parsed[-1]
    baseline_snaps = parsed[:-1]
    alerts: list[dict] = []

    all_cols = set(latest["stats"].keys())

    for col in all_cols:
        latest_col = latest["stats"].get(col, {})
        col_type = latest_col.get("type")

        # ── Numeric drift ───────────────────────────────────────────────────
        if col_type == "numeric":
            hist_means = [
                s["stats"][col]["mean"]
                for s in baseline_snaps
                if col in s["stats"] and "mean" in s["stats"][col]
            ]
            if len(hist_means) < 1:
                continue
            baseline_mean = float(np.mean(hist_means))
            baseline_std  = float(np.std(hist_means)) if len(hist_means) > 1 else 0.0
            current_mean  = latest_col.get("mean")
            if current_mean is None:
                continue
            delta = abs(current_mean - baseline_mean)
            # Use std of historical means as the scale; fall back to 10% of baseline
            scale = baseline_std if baseline_std > 0 else max(abs(baseline_mean) * 0.1, 1e-9)
            if delta / scale > mean_drift_threshold * 10:
                alerts.append({
                    "column": col,
                    "type": "numeric_mean_drift",
                    "severity": "high" if delta / scale > mean_drift_threshold * 20 else "medium",
                    "baseline_mean": round(baseline_mean, 4),
                    "current_mean": round(current_mean, 4),
                    "delta": round(delta, 4),
                    "message": f"'{col}' mean shifted from {baseline_mean:.2f} → {current_mean:.2f}",
                })

            # Std (variance) shift
            hist_stds = [
                s["stats"][col]["std"]
                for s in baseline_snaps
                if col in s["stats"] and "std" in s["stats"][col]
            ]
            if hist_stds:
                baseline_std_val = float(np.mean(hist_stds))
                current_std = latest_col.get("std")
                if current_std is not None and baseline_std_val > 0:
                    std_ratio = current_std / baseline_std_val
                    if std_ratio > 2.0 or std_ratio < 0.5:
                        alerts.append({
                            "column": col,
                            "type": "numeric_variance_shift",
                            "severity": "medium",
                            "baseline_std": round(baseline_std_val, 4),
                            "current_std": round(current_std, 4),
                            "ratio": round(std_ratio, 3),
                            "message": f"'{col}' variance changed {baseline_std_val:.2f} → {current_std:.2f} (×{std_ratio:.1f})",
                        })

        # ── Missing-rate spike ───────────────────────────────────────────────
        hist_missing = [
            s["stats"][col]["missing_pct"]
            for s in baseline_snaps
            if col in s["stats"] and "missing_pct" in s["stats"][col]
        ]
        if hist_missing and "missing_pct" in latest_col:
            baseline_missing = float(np.mean(hist_missing))
            current_missing  = latest_col["missing_pct"]
            delta_missing = current_missing - baseline_missing
            if delta_missing > 5.0:  # absolute pct-point threshold
                alerts.append({
                    "column": col,
                    "type": "missing_rate_spike",
                    "severity": "high" if delta_missing > 15.0 else "medium",
                    "baseline_missing_pct": round(baseline_missing, 2),
                    "current_missing_pct": round(current_missing, 2),
                    "message": f"'{col}' missing rate jumped {baseline_missing:.1f}% → {current_missing:.1f}%",
                })

        # ── Categorical proportion shift ─────────────────────────────────────
        if col_type == "categorical":
            current_props = latest_col.get("top_proportions") or {}
            all_values: set = set(current_props.keys())
            for s in baseline_snaps:
                if col in s["stats"]:
                    all_values |= set((s["stats"][col].get("top_proportions") or {}).keys())

            for val in all_values:
                cur_p = current_props.get(val, 0.0)
                hist_ps = [
                    s["stats"][col].get("top_proportions", {}).get(val, 0.0)
                    for s in baseline_snaps
                    if col in s["stats"]
                ]
                if not hist_ps:
                    continue
                baseline_p = float(np.mean(hist_ps))
                shift = abs(cur_p - baseline_p)
                if shift >= proportion_shift_threshold:
                    alerts.append({
                        "column": col,
                        "type": "category_proportion_shift",
                        "severity": "high" if shift >= 0.20 else "medium",
                        "value": val,
                        "baseline_proportion": round(baseline_p, 4),
                        "current_proportion": round(cur_p, 4),
                        "shift": round(shift, 4),
                        "message": (
                            f"'{col}' value '{val}' proportion: "
                            f"{baseline_p*100:.1f}% → {cur_p*100:.1f}% (Δ{shift*100:.1f}pp)"
                        ),
                    })

    return sorted(alerts, key=lambda a: ("high" != a["severity"], a["column"]))


def suggest_quality_improvements(dataset_id: str) -> list[dict[str, Any]]:
    """Suggest improvements based on quality history."""
    history = get_quality_history(dataset_id, days=30)
    
    if not history:
        return []
    
    latest = history[-1]
    suggestions = []
    
    # Check for high missing values
    if latest['missing_pct'] > 20:
        suggestions.append({
            'issue': 'high_missing_values',
            'severity': 'high' if latest['missing_pct'] > 40 else 'medium',
            'current_value': latest['missing_pct'],
            'suggestion': 'Consider using advanced imputation (KNN or regression) or investigate data source issues',
            'priority': 1
        })
    
    # Check for high duplicates
    if latest['duplicate_pct'] > 10:
        suggestions.append({
            'issue': 'high_duplicates',
            'severity': 'high' if latest['duplicate_pct'] > 30 else 'medium',
            'current_value': latest['duplicate_pct'],
            'suggestion': 'Review deduplication strategy and consider fuzzy matching for near-duplicates',
            'priority': 2
        })
    
    # Check quality trend
    trend = get_quality_trend(dataset_id)
    if trend['trend'] == 'degrading':
        suggestions.append({
            'issue': 'quality_degrading',
            'severity': 'high',
            'current_change': trend['change_pct'],
            'suggestion': 'Investigate recent data source changes or pipeline modifications',
            'priority': 0
        })
    
    # Check for anomalies
    anomalies = detect_quality_anomalies(dataset_id)
    if anomalies:
        suggestions.append({
            'issue': 'quality_anomalies',
            'severity': 'medium',
            'anomaly_count': len(anomalies),
            'suggestion': 'Review anomalous data points and validate against business rules',
            'priority': 3
        })
    
    return sorted(suggestions, key=lambda x: x['priority'])
