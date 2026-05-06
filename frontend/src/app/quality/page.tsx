"use client";

import { useState, useEffect, useCallback } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch } from "@/lib/api";
import {
  TrendingUp, TrendingDown, Minus, BarChart3, AlertTriangle,
  CheckCircle, Activity, ShieldAlert, Lightbulb, ChevronRight,
  Loader2, RefreshCw, ArrowUpRight, ArrowDownRight,
} from "lucide-react";
import { InsightNav } from "@/components/InsightNav";

// ── Types ──────────────────────────────────────────────────────────────────

interface Metric {
  dataset_id: string;
  avg_quality: number;
  min_quality: number;
  max_quality: number;
  avg_missing: number;
  avg_duplicate: number;
  snapshot_count: number;
}

interface Snapshot {
  id: number;
  quality_score: number;
  missing_pct: number;
  duplicate_pct: number;
  row_count: number;
  col_count: number;
  timestamp: string;
}

interface Trend {
  trend: "improving" | "degrading" | "stable" | "insufficient_data";
  current_score: number;
  change: number;
  change_pct: number;
  snapshots_count: number;
}

interface Anomaly {
  quality_score: number;
  timestamp: string;
  z_score: number;
  deviation: "high" | "low";
}

interface ShiftAlert {
  column: string;
  type: string;
  severity: "high" | "medium";
  message: string;
}

type Tab = "history" | "anomalies" | "shifts" | "suggestions";

// ── Sparkline ──────────────────────────────────────────────────────────────

function Sparkline({ values, color = "#00d9a5" }: { values: number[]; color?: string }) {
  if (values.length < 2) return <span className="text-xs text-app-subtle">—</span>;
  const w = 80, h = 28, pad = 2;
  const mn = Math.min(...values), mx = Math.max(...values);
  const range = mx - mn || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - mn) / range) * (h - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

function SevBadge({ sev }: { sev: string }) {
  return (
    <span className={`text-[10px] font-bold uppercase px-2 py-0.5 rounded-full ${
      sev === "high" ? "bg-danger/20 text-danger" : "bg-warn/20 text-warn"
    }`}>{sev}</span>
  );
}

function shiftTypeLabel(t: string) {
  return ({
    numeric_mean_drift: "Mean Drift",
    numeric_variance_shift: "Variance Shift",
    missing_rate_spike: "Missing Rate Spike",
    category_proportion_shift: "Proportion Shift",
  } as Record<string, string>)[t] ?? t;
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function QualityPage() {
  const [metrics, setMetrics]         = useState<Metric[]>([]);
  const [selected, setSelected]       = useState<string | null>(null);
  const [tab, setTab]                 = useState<Tab>("history");
  const [history, setHistory]         = useState<Snapshot[]>([]);
  const [trend, setTrend]             = useState<Trend | null>(null);
  const [anomalies, setAnomalies]     = useState<Anomaly[]>([]);
  const [shifts, setShifts]           = useState<ShiftAlert[]>([]);
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadMetrics = useCallback(async () => {
    setLoadingList(true);
    try {
      const d = await apiFetch("/quality/metrics?days=90");
      setMetrics(d.metrics ?? []);
    } catch { /* ignore */ } finally { setLoadingList(false); }
  }, []);

  useEffect(() => { loadMetrics(); }, [loadMetrics]);

  const loadDetail = useCallback(async (id: string) => {
    setLoadingDetail(true);
    setHistory([]); setTrend(null); setAnomalies([]); setShifts([]); setSuggestions([]);
    const [hist, tr, anom, shift, report] = await Promise.allSettled([
      apiFetch(`/analytics/dataset/${id}/quality-history?days=90`),
      apiFetch(`/analytics/dataset/${id}/quality-trend`),
      apiFetch(`/analytics/dataset/${id}/anomalies`),
      apiFetch(`/analytics/dataset/${id}/distribution-shift`),
      apiFetch(`/analytics/dataset/${id}/quality-report`),
    ]);
    if (hist.status   === "fulfilled") setHistory(hist.value.history ?? []);
    if (tr.status     === "fulfilled") setTrend(tr.value);
    if (anom.status   === "fulfilled") setAnomalies(anom.value.anomalies ?? []);
    if (shift.status  === "fulfilled") setShifts(shift.value.alerts ?? []);
    if (report.status === "fulfilled") setSuggestions(report.value.suggestions ?? []);
    setLoadingDetail(false);
  }, []);

  const selectDataset = (id: string) => { setSelected(id); setTab("history"); loadDetail(id); };

  const trendColor = (t?: string) =>
    t === "improving" ? "text-accent" : t === "degrading" ? "text-danger" : "text-app-muted";
  const TIcon = trend?.trend === "improving" ? TrendingUp : trend?.trend === "degrading" ? TrendingDown : Minus;
  const highShifts = shifts.filter((s) => s.severity === "high").length;
  const histScores = history.map((h) => h.quality_score);

  const tabs: { id: Tab; label: string; icon: React.ElementType; count?: number }[] = [
    { id: "history",     label: "History",             icon: BarChart3,   count: history.length },
    { id: "anomalies",   label: "Anomalies",           icon: Activity,    count: anomalies.length },
    { id: "shifts",      label: "Distribution Shifts", icon: ShieldAlert, count: shifts.length },
    { id: "suggestions", label: "Suggestions",         icon: Lightbulb,   count: suggestions.length },
  ];

  return (
    <AuthGate>
      <Shell>
        <div className="max-w-6xl mx-auto space-y-6">
          <InsightNav active="quality" />

          {/* Header */}
          <div className="flex items-center justify-between animate-fade-in-down">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
                <ShieldAlert className="w-3 h-3" />
                <span>Quality</span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Quality Monitoring</span></h1>
              <p className="text-sm text-app-muted mt-1">
                Track quality trends, detect anomalies and distribution shifts across datasets.
              </p>
            </div>
            <button onClick={loadMetrics} className="flex items-center gap-1.5 text-xs text-app-muted hover:text-accent transition-colors">
              <RefreshCw className="w-3.5 h-3.5" /> Refresh
            </button>
          </div>

          {/* Dataset grid */}
          <div className="glass-card rounded-xl p-5">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-app-subtle mb-3">
              All Datasets — 90-day window
            </p>
            {loadingList ? (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {[...Array(6)].map((_, i) => <div key={i} className="h-20 skeleton rounded-xl" />)}
              </div>
            ) : metrics.length === 0 ? (
              <p className="text-sm text-app-muted text-center py-8">
                No quality snapshots yet — run <strong className="text-app-text">Auto Clean</strong> on a dataset to begin tracking.
              </p>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {metrics.map((m) => {
                  const qColor = m.avg_quality >= 80 ? "text-accent" : m.avg_quality >= 60 ? "text-warn" : "text-danger";
                  const isSelected = selected === m.dataset_id;
                  return (
                    <button
                      key={m.dataset_id}
                      onClick={() => selectDataset(m.dataset_id)}
                      className={`rounded-xl border p-4 text-left transition-all ${
                        isSelected ? "border-accent bg-accent/5" : "border-edge/40 bg-panel/40 hover:border-accent/40"
                      }`}
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-mono text-app-muted truncate max-w-[140px]">{m.dataset_id}</span>
                        <span className={`text-sm font-bold ${qColor}`}>{m.avg_quality.toFixed(1)}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1 text-[11px] text-app-subtle">
                        <div>Missing<br /><span className="text-app-muted font-medium">{m.avg_missing.toFixed(1)}%</span></div>
                        <div>Dupes<br /><span className="text-app-muted font-medium">{m.avg_duplicate.toFixed(1)}%</span></div>
                        <div>Snaps<br /><span className="text-app-muted font-medium">{m.snapshot_count}</span></div>
                      </div>
                      {isSelected && <ChevronRight className="w-3.5 h-3.5 text-accent mt-2" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Detail panel */}
          {selected && (
            <div className="glass-card rounded-xl overflow-hidden">

              {/* Trend hero bar */}
              {trend && trend.trend !== "insufficient_data" && (
                <div className="px-5 py-4 border-b border-edge/40 flex flex-wrap items-center gap-6">
                  <div className="flex items-center gap-2">
                    <TIcon className={`w-5 h-5 ${trendColor(trend.trend)}`} />
                    <span className={`text-sm font-bold capitalize ${trendColor(trend.trend)}`}>{trend.trend}</span>
                  </div>
                  <div className="text-sm text-app-muted">
                    Score: <span className="text-app-text font-semibold">{trend.current_score.toFixed(1)}</span>
                    <span className={`ml-2 text-xs font-medium ${trend.change >= 0 ? "text-accent" : "text-danger"}`}>
                      {trend.change >= 0 ? "+" : ""}{trend.change.toFixed(1)} ({trend.change_pct.toFixed(1)}%)
                    </span>
                  </div>
                  {histScores.length > 1 && (
                    <div className="ml-auto">
                      <Sparkline values={histScores} color={trend.trend === "degrading" ? "#ef4444" : "#00d9a5"} />
                    </div>
                  )}
                  {highShifts > 0 && (
                    <span className="flex items-center gap-1 text-xs text-danger font-medium">
                      <ShieldAlert className="w-3.5 h-3.5" /> {highShifts} high-severity shift{highShifts > 1 ? "s" : ""}
                    </span>
                  )}
                </div>
              )}

              {/* Tabs */}
              <div className="flex overflow-x-auto border-b border-edge/40">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors ${
                      tab === t.id ? "border-accent text-accent bg-accent/5" : "border-transparent text-app-muted hover:text-app-text"
                    }`}
                  >
                    <t.icon className="w-3.5 h-3.5" />
                    {t.label}
                    {(t.count ?? 0) > 0 && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                        tab === t.id ? "bg-accent/20 text-accent" : "bg-edge/40 text-app-subtle"
                      }`}>{t.count}</span>
                    )}
                  </button>
                ))}
              </div>

              {loadingDetail ? (
                <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-accent animate-spin" /></div>
              ) : (
                <div className="p-5">

                  {/* History */}
                  {tab === "history" && (
                    history.length === 0
                      ? <p className="text-sm text-app-muted text-center py-8">No snapshots recorded yet.</p>
                      : (
                        <div className="overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="text-[10px] uppercase tracking-widest text-app-subtle border-b border-edge/40">
                                {["Timestamp","Quality","Missing %","Dupe %","Rows","Cols"].map((h) => (
                                  <th key={h} className={`pb-2 font-semibold ${h === "Timestamp" ? "text-left" : "text-right"}`}>{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-edge/30">
                              {[...history].reverse().map((h, i) => (
                                <tr key={i} className="hover:bg-accent/5 transition-colors">
                                  <td className="py-2 text-app-muted text-[11px]">{new Date(h.timestamp).toLocaleString()}</td>
                                  <td className={`py-2 text-right font-bold ${h.quality_score >= 80 ? "text-accent" : h.quality_score >= 60 ? "text-warn" : "text-danger"}`}>
                                    {h.quality_score.toFixed(1)}
                                  </td>
                                  <td className="py-2 text-right text-app-muted">{h.missing_pct.toFixed(2)}%</td>
                                  <td className="py-2 text-right text-app-muted">{h.duplicate_pct.toFixed(2)}%</td>
                                  <td className="py-2 text-right text-app-subtle">{h.row_count.toLocaleString()}</td>
                                  <td className="py-2 text-right text-app-subtle">{h.col_count}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                  )}

                  {/* Anomalies */}
                  {tab === "anomalies" && (
                    anomalies.length === 0
                      ? <div className="flex items-center gap-3 py-8 justify-center text-sm text-app-muted"><CheckCircle className="w-5 h-5 text-accent" /> No anomalies detected.</div>
                      : (
                        <div className="space-y-3">
                          <p className="text-xs text-app-muted mb-4">Snapshots whose quality score deviated significantly from the 90-day mean (z-score &gt; 2).</p>
                          {anomalies.map((a, i) => (
                            <div key={i} className={`rounded-lg border p-4 flex items-center gap-4 ${a.deviation === "low" ? "border-danger/30 bg-danger/5" : "border-warn/30 bg-warn/5"}`}>
                              {a.deviation === "low" ? <ArrowDownRight className="w-5 h-5 text-danger flex-shrink-0" /> : <ArrowUpRight className="w-5 h-5 text-warn flex-shrink-0" />}
                              <div className="flex-1">
                                <p className="text-sm font-medium text-app-text">Quality {a.deviation === "low" ? "drop" : "spike"} — score {a.quality_score.toFixed(1)}</p>
                                <p className="text-xs text-app-subtle mt-0.5">{new Date(a.timestamp).toLocaleString()}</p>
                              </div>
                              <div className="text-right">
                                <p className="text-xs text-app-subtle">Z-score</p>
                                <p className={`text-sm font-bold ${a.deviation === "low" ? "text-danger" : "text-warn"}`}>{a.z_score.toFixed(2)}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                  )}

                  {/* Distribution shifts */}
                  {tab === "shifts" && (
                    shifts.length === 0
                      ? <div className="flex items-center gap-3 py-8 justify-center text-sm text-app-muted"><CheckCircle className="w-5 h-5 text-accent" /> No significant distribution shifts detected.</div>
                      : (
                        <div className="space-y-3">
                          <p className="text-xs text-app-muted mb-4">Column-level shifts between the latest snapshot and the historical baseline.</p>
                          {shifts.map((s, i) => (
                            <div key={i} className={`rounded-lg border p-4 ${s.severity === "high" ? "border-danger/30 bg-danger/5" : "border-warn/30 bg-warn/5"}`}>
                              <div className="flex items-center gap-3 mb-1">
                                <SevBadge sev={s.severity} />
                                <span className="text-xs text-app-muted font-medium">{shiftTypeLabel(s.type)}</span>
                                <span className="ml-auto font-mono text-xs text-app-muted">{s.column}</span>
                              </div>
                              <p className="text-sm text-app-text">{s.message}</p>
                            </div>
                          ))}
                        </div>
                      )
                  )}

                  {/* Suggestions */}
                  {tab === "suggestions" && (
                    suggestions.length === 0
                      ? <div className="flex items-center gap-3 py-8 justify-center text-sm text-app-muted"><CheckCircle className="w-5 h-5 text-accent" /> No improvement suggestions at this time.</div>
                      : (
                        <div className="space-y-3">
                          {suggestions.map((s, i) => (
                            <div key={i} className={`rounded-lg border p-4 ${s.severity === "high" ? "border-danger/30 bg-danger/5" : "border-warn/30 bg-warn/5"}`}>
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-sm font-medium text-app-text capitalize">{(s.issue as string).replace(/_/g, " ")}</span>
                                <SevBadge sev={s.severity} />
                              </div>
                              <p className="text-xs text-app-muted">{s.suggestion}</p>
                            </div>
                          ))}
                        </div>
                      )
                  )}

                </div>
              )}
            </div>
          )}

        </div>
      </Shell>
    </AuthGate>
  );
}
