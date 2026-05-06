from __future__ import annotations

from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.config import settings
from ..auth import require_auth
from ..db import _utc_now, get_conn, get_dataset
from app.services.access_control import require_item_access

router = APIRouter()

class ReportRequest(BaseModel):
    dataset_id: str
    report_type: str  # 'cleaning', 'quality', 'comparison'
    format: str  # 'pdf', 'html'


def _reports_dir(dataset_id: str) -> Path:
    d = settings.exports_dir / "reports" / dataset_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _report_id(dataset_id: str, filename: str) -> str:
    # No slashes to keep it URL-safe.
    return f"{dataset_id}__{filename}"


def _parse_report_id(report_id: str) -> tuple[str, str]:
    if "__" not in report_id:
        raise HTTPException(400, "Invalid report_id")
    dataset_id, filename = report_id.split("__", 1)
    if not dataset_id or not filename:
        raise HTTPException(400, "Invalid report_id")
    return dataset_id, filename


def _render_html(report: dict) -> str:
    title = f"Report: {report.get('report_type', 'report').title()}"
    dataset_id = report.get("dataset_id", "")
    filename = report.get("filename", "")
    generated_at = report.get("generated_at", "")
    summary = report.get("summary") or {}
    qs = summary.get("quality_score", "—")
    rows = summary.get("row_count", "—")
    cols = summary.get("col_count", "—")

    def _esc(v: object) -> str:
        s = str(v)
        return (
            s.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
        )

    quality_rows = "".join(
        f"<tr><td>{_esc(r.get('timestamp'))}</td><td>{_esc(r.get('quality_score'))}</td><td>{_esc(r.get('missing_pct'))}</td><td>{_esc(r.get('duplicate_pct'))}</td></tr>"
        for r in (report.get("quality_history") or [])
    )

    return f"""<!doctype html>
<html lang=\"en\">
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" />
  <title>{_esc(title)}</title>
  <style>
    body {{ font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; margin: 24px; color: #111; }}
    h1 {{ margin: 0 0 8px; }}
    .meta {{ color: #555; margin-bottom: 16px; }}
    .grid {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin: 16px 0; }}
    .card {{ border: 1px solid #ddd; border-radius: 10px; padding: 12px; }}
    table {{ width: 100%; border-collapse: collapse; margin-top: 10px; }}
    th, td {{ border: 1px solid #ddd; padding: 8px; font-size: 12px; }}
    th {{ background: #f6f6f6; text-align: left; }}
  </style>
</head>
<body>
  <h1>{_esc(title)}</h1>
  <div class=\"meta\">Dataset: <b>{_esc(filename)}</b> ({_esc(dataset_id)})<br/>Generated: {_esc(generated_at)}</div>

  <div class=\"grid\">
    <div class=\"card\"><div><b>Quality Score</b></div><div>{_esc(qs)}</div></div>
    <div class=\"card\"><div><b>Rows</b></div><div>{_esc(rows)}</div></div>
    <div class=\"card\"><div><b>Columns</b></div><div>{_esc(cols)}</div></div>
  </div>

  <h2>Recent Quality History</h2>
  <table>
    <thead><tr><th>Timestamp</th><th>Quality</th><th>Missing %</th><th>Duplicate %</th></tr></thead>
    <tbody>
      {quality_rows or '<tr><td colspan="4">No history available</td></tr>'}
    </tbody>
  </table>
</body>
</html>"""


def _write_pdf_from_html(html: str, pdf_path: Path, report: dict | None = None) -> bool:
    """Generate a properly styled PDF using reportlab Platypus."""
    try:
        from reportlab.lib.pagesizes import letter
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import inch
        from reportlab.lib import colors
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable,
        )
    except Exception:
        raise HTTPException(500, "PDF generation dependency missing: reportlab")

    doc = SimpleDocTemplate(
        str(pdf_path),
        pagesize=letter,
        rightMargin=0.75 * inch, leftMargin=0.75 * inch,
        topMargin=1 * inch,     bottomMargin=0.75 * inch,
    )

    styles = getSampleStyleSheet()
    BRAND  = colors.HexColor("#6366f1")
    GREY   = colors.HexColor("#64748b")
    LGREY  = colors.HexColor("#f1f5f9")
    BLACK  = colors.HexColor("#0f172a")

    h1 = ParagraphStyle("H1", parent=styles["Heading1"], textColor=BRAND, fontSize=20, spaceAfter=4)
    h2 = ParagraphStyle("H2", parent=styles["Heading2"], textColor=BLACK, fontSize=13, spaceBefore=12, spaceAfter=4)
    meta_style = ParagraphStyle("Meta", parent=styles["Normal"], textColor=GREY, fontSize=9)
    body_style = ParagraphStyle("Body", parent=styles["Normal"], fontSize=10, textColor=BLACK)

    rep = report or {}
    summary = rep.get("summary") or {}
    q_history = rep.get("quality_history") or []
    v_results  = rep.get("validation_results") or []

    story = []

    # ── Title block ────────────────────────────────────────────────────────────
    rtype = (rep.get("report_type") or "report").title()
    story.append(Paragraph(f"AutoClean AI — {rtype} Report", h1))
    story.append(Paragraph(
        f"Dataset: <b>{rep.get('filename', '—')}</b> &nbsp;|&nbsp; "
        f"Generated: {rep.get('generated_at', '—')}",
        meta_style,
    ))
    story.append(HRFlowable(width="100%", thickness=1, color=BRAND, spaceAfter=12))

    # ── Summary cards ─────────────────────────────────────────────────────────
    story.append(Paragraph("Summary", h2))
    card_data = [
        ["Quality Score", "Rows", "Columns"],
        [
            str(summary.get("quality_score", "—")),
            str(summary.get("row_count", "—")),
            str(summary.get("col_count", "—")),
        ],
    ]
    card_tbl = Table(card_data, colWidths=[2.1 * inch, 2.1 * inch, 2.1 * inch])
    card_tbl.setStyle(TableStyle([
        ("BACKGROUND",   (0, 0), (-1, 0), BRAND),
        ("TEXTCOLOR",    (0, 0), (-1, 0), colors.white),
        ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE",     (0, 0), (-1, 0), 10),
        ("ALIGN",        (0, 0), (-1, -1), "CENTER"),
        ("FONTSIZE",     (0, 1), (-1, 1), 16),
        ("FONTNAME",     (0, 1), (-1, 1), "Helvetica-Bold"),
        ("TEXTCOLOR",    (0, 1), (-1, 1), BLACK),
        ("BACKGROUND",   (0, 1), (-1, 1), LGREY),
        ("ROWBACKGROUNDS", (0, 1), (-1, 1), [LGREY]),
        ("BOX",          (0, 0), (-1, -1), 0.5, GREY),
        ("INNERGRID",    (0, 0), (-1, -1), 0.25, GREY),
        ("TOPPADDING",   (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING",(0, 0), (-1, -1), 8),
    ]))
    story.append(card_tbl)
    story.append(Spacer(1, 14))

    # ── Quality history table ─────────────────────────────────────────────────
    story.append(Paragraph("Quality History", h2))
    if q_history:
        hdr = ["Timestamp", "Quality Score", "Missing %", "Duplicate %"]
        rows = [[
            str(r.get("timestamp", ""))[:19],
            str(r.get("quality_score", "—")),
            str(r.get("missing_pct", "—")),
            str(r.get("duplicate_pct", "—")),
        ] for r in q_history]
        tbl = Table([hdr] + rows, colWidths=[2.2*inch, 1.5*inch, 1.3*inch, 1.3*inch])
        tbl.setStyle(TableStyle([
            ("BACKGROUND",   (0, 0), (-1, 0), colors.HexColor("#1e293b")),
            ("TEXTCOLOR",    (0, 0), (-1, 0), colors.white),
            ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE",     (0, 0), (-1, -1), 9),
            ("ROWBACKGROUNDS", (1, 0), (-1, -1), [colors.white, LGREY]),
            ("BOX",          (0, 0), (-1, -1), 0.5, GREY),
            ("INNERGRID",    (0, 0), (-1, -1), 0.25, GREY),
            ("TOPPADDING",   (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING",(0, 0), (-1, -1), 5),
        ]))
        story.append(tbl)
    else:
        story.append(Paragraph("No quality history available.", body_style))

    # ── Validation results ────────────────────────────────────────────────────
    if v_results:
        story.append(Spacer(1, 12))
        story.append(Paragraph("Validation Results", h2))
        vhdr = ["Rule", "Status", "Validated At"]
        vrows = [[
            str(r.get("rule_name") or r.get("validation_rule", "—")),
            str(r.get("status", "—")),
            str(r.get("validated_at", ""))[:19],
        ] for r in v_results]
        vtbl = Table([vhdr] + vrows, colWidths=[3.2*inch, 1.4*inch, 1.7*inch])
        vtbl.setStyle(TableStyle([
            ("BACKGROUND",   (0, 0), (-1, 0), colors.HexColor("#1e293b")),
            ("TEXTCOLOR",    (0, 0), (-1, 0), colors.white),
            ("FONTNAME",     (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE",     (0, 0), (-1, -1), 9),
            ("ROWBACKGROUNDS", (1, 0), (-1, -1), [colors.white, LGREY]),
            ("BOX",          (0, 0), (-1, -1), 0.5, GREY),
            ("INNERGRID",    (0, 0), (-1, -1), 0.25, GREY),
            ("TOPPADDING",   (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING",(0, 0), (-1, -1), 5),
        ]))
        story.append(vtbl)

    story.append(Spacer(1, 24))
    story.append(Paragraph("Generated by AutoClean AI — autoclean.ai", meta_style))

    doc.build(story)
    return True

def generate_cleaning_report(dataset_id: str) -> dict:
    """Generate a cleaning report for a dataset."""
    dataset = get_dataset(dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset not found")
    
    with get_conn() as conn:
        # Get quality history
        quality_history = conn.execute(
            "SELECT * FROM quality_history WHERE dataset_id = ? ORDER BY timestamp DESC LIMIT 10",
            (dataset_id,)
        ).fetchall()
        
        # Get validation results (ordered by latest validation time)
        validation_results = conn.execute(
            "SELECT * FROM dataset_validations WHERE dataset_id = ? ORDER BY validated_at DESC LIMIT 10",
            (dataset_id,)
        ).fetchall()
    
    report = {
        "dataset_id": dataset_id,
        "filename": dataset.get("original_filename"),
        "generated_at": _utc_now(),
        "summary": {
            "quality_score": dataset.get("quality_score") or 0,
            "row_count": dataset.get("row_count") or 0,
            "col_count": dataset.get("col_count") or 0,
        },
        "quality_history": [dict(row) for row in quality_history],
        "validation_results": [dict(row) for row in validation_results],
    }
    
    return report

def generate_quality_report(dataset_id: str) -> dict:
    """Generate a quality report for a dataset."""
    dataset = get_dataset(dataset_id)
    if not dataset:
        raise HTTPException(404, "Dataset not found")
    
    with get_conn() as conn:
        # Get latest quality history
        latest_quality = conn.execute(
            "SELECT * FROM quality_history WHERE dataset_id = ? ORDER BY timestamp DESC LIMIT 1",
            (dataset_id,)
        ).fetchone()
    
    report = {
        "dataset_id": dataset_id,
        "filename": dataset.get("original_filename"),
        "generated_at": _utc_now(),
        "quality_metrics": dict(latest_quality) if latest_quality else {},
    }
    
    return report

@router.get("/list")
def list_all_reports(user: str = Depends(require_auth)):
    """List all generated report files the authenticated user has access to."""
    import time as _time
    base = settings.exports_dir / "reports"
    reports = []
    if base.exists():
        for dataset_dir in base.iterdir():
            if not dataset_dir.is_dir():
                continue
            dataset_id = dataset_dir.name
            dataset = get_dataset(dataset_id)
            if not dataset:
                continue
            dataset_name = dataset.get("original_filename", dataset_id)
            for rfile in sorted(
                dataset_dir.iterdir(),
                key=lambda p: p.stat().st_mtime,
                reverse=True,
            ):
                if not rfile.is_file() or rfile.suffix not in (".html", ".pdf"):
                    continue
                stem = rfile.stem
                rtype = stem.split("_", 1)[0] if "_" in stem else "report"
                rid = _report_id(dataset_id, rfile.name)
                reports.append({
                    "report_id": rid,
                    "dataset_id": dataset_id,
                    "dataset_name": dataset_name,
                    "report_type": rtype,
                    "format": rfile.suffix.lstrip("."),
                    "filename": rfile.name,
                    "size_bytes": rfile.stat().st_size,
                    "generated_at": _time.strftime(
                        "%Y-%m-%dT%H:%M:%SZ",
                        _time.gmtime(rfile.stat().st_mtime),
                    ),
                    "download_url": f"/reports/download/{rid}",
                })
    reports.sort(key=lambda r: r["generated_at"], reverse=True)
    return {"reports": reports}


@router.post("/generate")
def generate_report(request: ReportRequest, user: str = Depends(require_auth)):
    """Generate a report for a dataset."""
    require_item_access(user, "dataset", request.dataset_id)
    fmt = (request.format or "html").lower()
    if fmt not in ("html", "pdf"):
        raise HTTPException(400, "format must be html or pdf")

    if request.report_type == "cleaning":
        report = generate_cleaning_report(request.dataset_id)
    elif request.report_type == "quality":
        report = generate_quality_report(request.dataset_id)
    else:
        raise HTTPException(400, "Invalid report type")

    report["report_type"] = request.report_type
    report["format"] = fmt

    # Use a filesystem- and URL-safe timestamp in the filename.
    # _utc_now() returns an ISO string like "2026-05-01T20:05:12.645179+00:00";
    # normalize by replacing characters that can be problematic in paths/URLs.
    raw_ts = _utc_now()
    ts = (
        raw_ts.replace(":", "-")
              .replace("+", "-")
              .replace(".", "-")
    )
    base = f"{request.report_type}_{ts}"
    out_dir = _reports_dir(request.dataset_id)
    html = _render_html(report)
    html_name = f"{base}.html"
    html_path = out_dir / html_name
    html_path.write_text(html, encoding="utf-8")

    if fmt == "pdf":
        pdf_name = f"{base}.pdf"
        pdf_path = out_dir / pdf_name
        _write_pdf_from_html(html, pdf_path, report=report)
        report_id = _report_id(request.dataset_id, pdf_name)
        return {
            "report_id": report_id,
            "format": "pdf",
            "download_url": f"/reports/download/{report_id}",
        }

    report_id = _report_id(request.dataset_id, html_name)
    return {
        "report_id": report_id,
        "format": "html",
        "download_url": f"/reports/download/{report_id}",
    }

@router.get("/download/{report_id}")
def download_report(report_id: str, user: str = Depends(require_auth)):
    """Download a generated report file."""
    dataset_id, filename = _parse_report_id(report_id)
    require_item_access(user, "dataset", dataset_id)
    reports_dir = _reports_dir(dataset_id)
    p = reports_dir / filename

    # If the report file is missing (e.g. cleaned up, or generation failed
    # after the ID was issued), lazily regenerate it when possible instead of
    # immediately returning 404.
    if not p.exists():
        stem = Path(filename).stem
        suffix = Path(filename).suffix.lower()
        fmt = "pdf" if suffix == ".pdf" else "html"
        # Expect filenames like "cleaning_2026-..." or "quality_2026-...".
        if "_" not in stem:
            raise HTTPException(404, "Report not found")
        report_type = stem.split("_", 1)[0]

        if report_type == "cleaning":
            report = generate_cleaning_report(dataset_id)
        elif report_type == "quality":
            report = generate_quality_report(dataset_id)
        else:
            raise HTTPException(404, "Report not found")

        report["report_type"] = report_type
        report["format"] = fmt
        html = _render_html(report)

        if fmt == "html":
            p.write_text(html, encoding="utf-8")
        else:
            # For PDF, emit a sibling HTML (for debugging) and then the PDF.
            html_path = reports_dir / f"{stem}.html"
            html_path.write_text(html, encoding="utf-8")
            _write_pdf_from_html(html, p, report=report)

    media = "text/html" if p.suffix.lower() == ".html" else "application/pdf"
    return FileResponse(str(p), filename=p.name, media_type=media)
