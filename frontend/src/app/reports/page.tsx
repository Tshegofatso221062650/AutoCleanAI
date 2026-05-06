"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached, apiUrl } from "@/lib/api";
import { FileText, Download, Loader2, ExternalLink, Filter } from "lucide-react";
import { showToast } from "@/components/Toast";

interface Report {
  report_id: string;
  dataset_id: string;
  dataset_name: string;
  report_type: string;
  format: string;
  filename: string;
  size_bytes: number;
  generated_at: string;
  download_url: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

export default function ReportsPage() {
  const [reports, setReports]   = useState<Report[]>(
    () => getCached<{ reports: Report[] }>("/reports/list")?.reports ?? []
  );
  const [loading, setLoading]   = useState(
    () => getCached("/reports/list") === null
  );
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [fmtFilter, setFmtFilter]   = useState<string>("all");

  useEffect(() => {
    apiFetch("/reports/list")
      .then((d) => setReports(d.reports || []))
      .catch(() => showToast("Failed to load reports", "error"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = reports.filter((r) => {
    if (typeFilter !== "all" && r.report_type !== typeFilter) return false;
    if (fmtFilter  !== "all" && r.format       !== fmtFilter)  return false;
    return true;
  });

  const types   = Array.from(new Set(reports.map((r) => r.report_type)));
  const formats = Array.from(new Set(reports.map((r) => r.format)));

  return (
    <AuthGate>
      <Shell>
        <div className="max-w-5xl mx-auto space-y-6">

          {/* Header */}
          <div className="animate-fade-in-down">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
              <FileText className="w-3 h-3" />
              <span>Reports</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Generated Reports</span></h1>
            <p className="text-sm text-app-muted mt-1">
              All generated cleaning and quality reports. Generate new ones from the{" "}
              <a href="/history" className="text-accent hover:underline">Datasets</a> page.
            </p>
          </div>

          {/* Filters */}
          {reports.length > 0 && (
            <div className="flex items-center gap-3 flex-wrap">
              <Filter className="w-4 h-4 text-app-muted flex-shrink-0" />
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className="bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-1.5 text-xs text-app-text focus:outline-none focus:ring-1 focus:ring-accent/40"
              >
                <option value="all">All types</option>
                {types.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <select
                value={fmtFilter}
                onChange={(e) => setFmtFilter(e.target.value)}
                className="bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-1.5 text-xs text-app-text focus:outline-none focus:ring-1 focus:ring-accent/40"
              >
                <option value="all">All formats</option>
                {formats.map((f) => (
                  <option key={f} value={f}>{f.toUpperCase()}</option>
                ))}
              </select>
              <span className="text-xs text-app-subtle ml-auto">
                {filtered.length} of {reports.length} report{reports.length !== 1 ? "s" : ""}
              </span>
            </div>
          )}

          {/* Table */}
          {loading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <div key={i} className="h-14 skeleton rounded-xl" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="glass-card rounded-2xl p-12 text-center">
              <div className="w-12 h-12 rounded-2xl bg-edge/30 flex items-center justify-center mx-auto mb-3">
                <FileText className="w-6 h-6 text-app-subtle" />
              </div>
              <p className="text-sm font-semibold text-app-muted">
                {reports.length === 0 ? "No reports generated yet" : "No reports match your filters"}
              </p>
              {reports.length === 0 && (
                <p className="text-xs text-app-subtle mt-2">
                  Open a dataset from the{" "}
                  <a href="/history" className="text-accent hover:underline">Datasets</a>{" "}
                  page and click &quot;Generate Report&quot;.
                </p>
              )}
            </div>
          ) : (
            <div className="glass-card rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-edge/40 text-[10px] uppercase tracking-wider text-app-subtle">
                    <th className="text-left px-5 py-3 font-semibold">Dataset</th>
                    <th className="text-left px-4 py-3 font-semibold">Type</th>
                    <th className="text-left px-4 py-3 font-semibold">Format</th>
                    <th className="text-left px-4 py-3 font-semibold">Size</th>
                    <th className="text-left px-4 py-3 font-semibold">Generated</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr
                      key={r.report_id}
                      className="border-b border-edge/20 last:border-0 hover:bg-edge/10 transition-colors"
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2 min-w-0">
                          <FileText className="w-4 h-4 text-app-muted flex-shrink-0" />
                          <span className="text-app-text truncate max-w-[200px]" title={r.dataset_name}>
                            {r.dataset_name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-[11px] font-semibold capitalize ${
                          r.report_type === "cleaning"
                            ? "bg-accent/10 text-accent"
                            : "bg-accent2/10 text-accent2"
                        }`}>
                          {r.report_type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold uppercase bg-edge/40 text-app-subtle">
                          {r.format}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-app-subtle text-xs">
                        {formatBytes(r.size_bytes)}
                      </td>
                      <td className="px-4 py-3 text-app-subtle text-xs whitespace-nowrap">
                        {formatDate(r.generated_at)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2 justify-end">
                          <a
                            href={apiUrl(r.download_url)}
                            target="_blank"
                            rel="noreferrer"
                            className="flex items-center gap-1 text-xs text-accent hover:underline font-medium"
                            title="Open report"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            Open
                          </a>
                          <a
                            href={apiUrl(r.download_url)}
                            download={r.filename}
                            className="flex items-center gap-1 text-xs text-app-muted hover:text-app-text transition-colors font-medium"
                            title="Download report"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Save
                          </a>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Shell>
    </AuthGate>
  );
}
