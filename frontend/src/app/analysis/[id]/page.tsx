"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { useTheme } from "@/contexts/ThemeContext";
import { apiFetch } from "@/lib/api";
import { QualityScore, QualityBreakdown } from "@/components/QualityScore";
import { CommentsPanel } from "@/components/CommentsPanel";
import { Target, CheckCircle, XCircle, Clock, Wand2, ArrowRight, TableProperties } from "lucide-react";

interface Profile {
  total_rows: number;
  total_columns: number;
  column_names: string[];
  missing_cells_pct: number;
  duplicate_rows: number;
  dtypes: Record<string, string>;
  unique_values: Record<string, number>;
  memory_usage_mb: number;
  quality_score: number;
  missing_per_column: Record<string, number>;
  correlation_matrix?: Record<string, Record<string, number>> | null;
}

export default function AnalysisPage() {
  const params = useParams();
  const id = String(params.id);
  const { theme } = useTheme();
  const cc = theme === "light"
    ? { grid: "#e2e8f0", axis: "#64748b", ttBg: "#ffffff", ttBorder: "#cbd5e1", ttText: "#0f172a" }
    : { grid: "#1c2330", axis: "#64748b", ttBg: "#11151c", ttBorder: "#1c2330", ttText: "#edf2f7" };
  const [currentUser, setCurrentUser] = useState<string | undefined>(undefined);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [charts, setCharts] = useState<{
    missing_by_column: { column: string; missing: number }[];
    histogram: { column: string; counts: number[]; bin_edges: number[] } | null;
    correlation: Record<string, Record<string, number>> | null;
    dtypes_distribution: { type: string; count: number }[] | null;
  } | null>(null);
  const [preview, setPreview] = useState<Record<string, any>[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [objectives, setObjectives] = useState<any[] | null>(null);
  const [isCleaned, setIsCleaned] = useState(false);

  useEffect(() => {
    apiFetch("/users/me")
      .then((d) => setCurrentUser(d?.username))
      .catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // ── Fast path: use cached analysis_json if the dataset was already analysed ──
        // This avoids an expensive full re-analysis on every navigation back to this page.
        const [ds, objectivesData] = await Promise.all([
          apiFetch(`/datasets/${id}`),
          apiFetch(`/datasets/${id}/objectives`),
        ]);
        if (cancelled) return;
        if (ds?.last_cleaned_at) setIsCleaned(true);

        const cachedProfile =
          ds?.analysis_json && typeof ds.analysis_json === "object"
            ? ds.analysis_json
            : ds?.analysis_json && typeof ds.analysis_json === "string"
            ? JSON.parse(ds.analysis_json)
            : null;

        if (cachedProfile && ds?.last_analyzed_at) {
          // Reconstruct chart payloads from the stored profile
          const missingChart = Object.entries(
            (cachedProfile.missing_per_column as Record<string, number>) ?? {}
          )
            .map(([column, missing]) => ({ column, missing }))
            .sort((a, b) => b.missing - a.missing)
            .slice(0, 25);

          const dtypesDist = Object.values(
            (cachedProfile.dtypes as Record<string, string>) ?? {}
          ).reduce<{ type: string; count: number }[]>((acc, dtype) => {
            const existing = acc.find((x) => x.type === dtype);
            if (existing) existing.count++;
            else acc.push({ type: dtype, count: 1 });
            return acc;
          }, []);

          setProfile(cachedProfile as Profile);
          setCharts({
            missing_by_column: missingChart,
            histogram: null,          // refreshed below via background POST
            correlation: (cachedProfile.correlation_matrix as Record<string, Record<string, number>>) ?? null,
            dtypes_distribution: dtypesDist,
          });
          setPreview((cachedProfile.preview as Record<string, any>[] | null) ?? null);
          setObjectives(objectivesData.objectives || []);
        }

        // ── Background refresh: always run a fresh analysis to get the histogram
        //    and update any stale quality metrics.  Results overlay the cached data. ──
        const fresh = await apiFetch("/analyze", {
          method: "POST",
          body: JSON.stringify({ dataset_id: id }),
        });
        if (!cancelled) {
          setProfile(fresh.profile);
          setCharts(fresh.charts);
          setPreview(fresh.preview || null);
        }
      } catch (e) {
        if (!cancelled) setErr(String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const histData = useMemo(() => {
    const h = charts?.histogram;
    if (!h) return [];
    return h.counts.map((c, i) => ({
      bin: `${h.bin_edges[i]?.toFixed(2) ?? i}`,
      count: c,
    }));
  }, [charts]);

  const corrCells = useMemo(() => {
    const m = charts?.correlation || profile?.correlation_matrix;
    if (!m) return [];
    const cols = Object.keys(m);
    return cols.flatMap((ci) =>
      cols.map((cj) => ({
        row: ci,
        col: cj,
        v: m[ci][cj],
      })),
    );
  }, [charts, profile]);

  const dtypeDistribution = useMemo(() => {
    if (charts?.dtypes_distribution) {
      return charts.dtypes_distribution;
    }
    if (!profile) return [];
    const typeCounts: Record<string, number> = {};
    Object.values(profile.dtypes).forEach((type) => {
      typeCounts[type] = (typeCounts[type] || 0) + 1;
    });
    return Object.entries(typeCounts).map(([type, count]) => ({ type, count }));
  }, [charts, profile]);

  function corrColor(v: number) {
    const t = (v + 1) / 2;
    const r = Math.round(255 * (1 - t));
    const g = Math.round(180 * t);
    const b = Math.round(200 * (1 - Math.abs(v)));
    return `rgb(${r},${g},${b})`;
  }

  return (
    <AuthGate>
      <Shell>
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6 animate-fade-in-down">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest ${
                isCleaned
                  ? "bg-accent/10 text-accent border border-accent/30"
                  : "bg-warn/10 text-warn border border-warn/30"
              }`}>
                {isCleaned ? "Cleaned" : "Raw · Uncleaned"}
              </span>
              <span className="text-xs text-app-subtle font-mono">{id}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Dataset Analysis</span></h1>
            <p className="text-sm text-app-muted mt-1">
              {isCleaned
                ? "Showing post-cleaning metrics — your original file is preserved"
                : "This is your original dataset exactly as uploaded — no changes applied yet"}
            </p>
          </div>
          <Link
            href={`/cleaning/${id}`}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent text-void text-sm font-semibold hover:bg-accent/90 transition-colors"
          >
            Clean this dataset →
          </Link>
        </div>

        {err && <p className="text-danger text-sm mb-4">{err}</p>}

        {!profile && !err && (
          <div className="space-y-6">
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[...Array(6)].map((_, i) => <div key={i} className="h-16 skeleton rounded-xl" />)}
            </div>
            <div className="h-48 skeleton rounded-xl" />
          </div>
        )}

        {profile && (
          <div className="space-y-8">
            <div className="grid lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <Stat label="Rows" value={profile.total_rows} />
                <Stat label="Columns" value={profile.total_columns} />
                <Stat label="Missing %" value={profile.missing_cells_pct} suffix="%" />
                <Stat label="Duplicates" value={profile.duplicate_rows} />
                <Stat label="Null-like Strings %" value={(profile as any).null_like_string_pct ?? 0} suffix="%" />
                <Stat label="Memory MB" value={profile.memory_usage_mb} />
              </div>
              <div className="flex items-center justify-center">
                <QualityScore score={profile.quality_score} size="lg" />
              </div>
            </div>

            <div className="glass-card rounded-2xl p-6">
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-4">Quality Breakdown</h2>
              <QualityBreakdown
                completeness={Math.max(0, 100 - profile.missing_cells_pct - ((profile as any).null_like_string_pct ?? 0))}
                accuracy={profile.quality_score}
                consistency={Math.max(0, 100
                  - ((profile as any).duplicate_rows_pct   ?? 0) * 2
                  - ((profile as any).constant_columns_ratio ?? 0) * 30
                )}
                validity={Math.max(0, 100
                  - ((profile as any).null_like_string_pct  ?? 0) * 1.5
                  - ((profile as any).type_mismatch_pct     ?? 0) * 2
                )}
              />
            </div>

            {(profile as any).constant_columns?.length > 0 && (
              <div className="rounded-xl border border-warn/30 bg-warn/5 p-4">
                <p className="text-xs font-semibold text-warn mb-1">⚠ Constant columns detected</p>
                <p className="text-xs text-app-muted">
                  These columns have the same value in every row and carry no information:{" "}
                  <span className="font-mono text-warn">{(profile as any).constant_columns.join(", ")}</span>
                </p>
              </div>
            )}

            {objectives && objectives.length > 0 && (
              <div className="glass-card rounded-xl p-4">
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle flex items-center gap-2 mb-3">
                  <Target className="w-3.5 h-3.5" />
                  Assigned Objectives
                </h2>
                <div className="space-y-2">
                  {objectives.map((obj) => (
                    <div key={obj.id} className="flex items-center justify-between p-3 rounded-lg bg-panel/40 border border-edge/40">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          {obj.status === "completed" ? (
                            <CheckCircle className="w-4 h-4 text-accent" />
                          ) : obj.status === "failed" ? (
                            <XCircle className="w-4 h-4 text-danger" />
                          ) : (
                            <Clock className="w-4 h-4 text-app-subtle" />
                          )}
                          <span className="font-medium text-app-text">{obj.name}</span>
                        </div>
                        <p className="text-xs text-app-muted mt-1">{obj.objective_type}</p>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-app-subtle">Status</div>
                        <div className={`text-sm font-medium ${
                          obj.status === "completed" ? "text-accent" : 
                          obj.status === "failed" ? "text-danger" : 
                          "text-app-muted"
                        }`}>
                          {obj.status}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <section className="glass-card rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle">Data Preview (First 5 Rows)</h2>
                {preview && preview.some((r) => (r as any)._is_duplicate) && (
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-warn/10 border border-warn/30 text-warn text-[10px] font-semibold">
                    <span className="w-2 h-2 rounded-full bg-warn inline-block" />
                    Duplicate rows highlighted
                  </span>
                )}
              </div>
              <div className="overflow-x-auto max-h-64 text-xs font-mono">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-app-subtle border-b border-edge/40 bg-panel/50 sticky top-0">
                      <th className="py-2 px-3 text-app-subtle">#</th>
                      {profile.column_names.map((c) => (
                        <th key={c} className="py-2 px-3 whitespace-nowrap">{c}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview && preview.length > 0 ? (
                      preview.map((row, rowIdx) => {
                        const isDup = !!(row as any)._is_duplicate;
                        return (
                          <tr
                            key={rowIdx}
                            className={`border-b border-edge/60 transition-colors ${
                              isDup
                                ? "bg-warn/8 hover:bg-warn/12"
                                : "hover:bg-panel/30"
                            }`}
                          >
                            <td className="py-1.5 px-3 text-app-subtle select-none">
                              {isDup ? (
                                <span title="Duplicate row" className="inline-flex items-center gap-1 text-warn">
                                  <span className="w-1.5 h-1.5 rounded-full bg-warn" />
                                  {rowIdx + 1}
                                </span>
                              ) : (
                                <span className="text-app-subtle">{rowIdx + 1}</span>
                              )}
                            </td>
                            {profile.column_names.map((c) => (
                              <td key={c} className={`py-1.5 px-3 whitespace-nowrap ${isDup ? "text-warn/90" : "text-app-muted"}`}>
                                {row[c] === null || row[c] === undefined ? (
                                  <span className="text-danger/50 italic">∅ null</span>
                                ) : typeof row[c] === 'object' ? (
                                  JSON.stringify(row[c])
                                ) : (
                                  String(row[c])
                                )}
                              </td>
                            ))}
                          </tr>
                        );
                      })
                    ) : (
                      <tr>
                        <td colSpan={profile.column_names.length + 1} className="py-4 text-center text-app-muted">
                          No preview data available
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>

            <section className="glass-card rounded-xl p-4">
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-3">Columns & types</h2>
              <div className="overflow-x-auto max-h-64 text-xs font-mono">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-app-subtle border-b border-edge/40">
                      <th className="py-2 pr-4 font-semibold">name</th>
                      <th className="py-2 pr-4 font-semibold">dtype</th>
                      <th className="py-2 pr-4 font-semibold">unique</th>
                      <th className="py-2 font-semibold">missing</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profile.column_names.map((c) => (
                      <tr key={c} className="border-b border-edge/30">
                        <td className="py-1.5 pr-4 text-app-text">{c}</td>
                        <td className="py-1.5 pr-4 text-app-muted">{profile.dtypes[c]}</td>
                        <td className="py-1.5 pr-4">{profile.unique_values[c]}</td>
                        <td className="py-1.5 text-warn">{profile.missing_per_column[c]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            {charts?.missing_by_column?.length ? (
              <section className="glass-card rounded-xl p-4">
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-3">Missing Values by Column</h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={charts.missing_by_column}>
                      <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} />
                      <XAxis dataKey="column" tick={{ fill: cc.axis, fontSize: 10 }} angle={-30} textAnchor="end" height={60} />
                      <YAxis tick={{ fill: cc.axis, fontSize: 10 }} />
                      <Tooltip contentStyle={{ background: cc.ttBg, border: `1px solid ${cc.ttBorder}`, color: cc.ttText }} />
                      <Bar dataKey="missing" radius={[4, 4, 0, 0]}>
                        {charts.missing_by_column.map((_, i) => (
                          <Cell key={i} fill={i % 2 === 0 ? "#00d9a5" : "#00b8ff"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            ) : null}

            {histData.length > 0 && (
              <section className="glass-card rounded-xl p-4">
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-3">Histogram (first numeric column)</h2>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={histData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} />
                      <XAxis dataKey="bin" tick={{ fill: cc.axis, fontSize: 9 }} />
                      <YAxis tick={{ fill: cc.axis, fontSize: 10 }} />
                      <Tooltip contentStyle={{ background: cc.ttBg, border: `1px solid ${cc.ttBorder}`, color: cc.ttText }} />
                      <Bar dataKey="count" fill="#00b8ff" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}

            {corrCells.length > 0 && (
              <section className="glass-card rounded-xl p-4 overflow-x-auto">
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-3">Correlation Heatmap</h2>
                <CorrelationGrid cells={corrCells} colorFn={corrColor} />
              </section>
            )}

            {dtypeDistribution.length > 0 && (
              <section className="glass-card rounded-xl p-4">
                <h2 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-3">Data Types Distribution</h2>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={dtypeDistribution}
                        cx="50%"
                        cy="50%"
                        labelLine={false}
                        label={({ type, percent }) => `${type}: ${(percent * 100).toFixed(0)}%`}
                        outerRadius={80}
                        fill="#8884d8"
                        dataKey="count"
                      >
                        {dtypeDistribution.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ background: cc.ttBg, border: `1px solid ${cc.ttBorder}`, color: cc.ttText }} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </section>
            )}
            {/* What's Next */}
            {profile && (
              <section className="rounded-xl border border-accent/30 bg-accent/5 p-5">
                <p className="text-xs font-semibold uppercase tracking-widest text-accent mb-3">What to do next</p>
                <div className="grid sm:grid-cols-3 gap-3">
                  <Link
                    href={`/cleaning/${id}`}
                    className="flex items-center gap-3 p-3 rounded-lg bg-panel/60 border border-accent/20 hover:border-accent/50 transition-colors group"
                  >
                    <Wand2 className="w-5 h-5 text-accent flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-app-text">Clean this dataset</p>
                      <p className="text-xs text-app-muted">Fix issues automatically</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-app-subtle ml-auto group-hover:text-accent transition-colors flex-shrink-0" />
                  </Link>
                  <Link
                    href="/validation"
                    className="flex items-center gap-3 p-3 rounded-lg bg-panel/60 border border-edge/30 hover:border-edge/60 transition-colors group"
                  >
                    <CheckCircle className="w-5 h-5 text-accent2 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-app-text">Set validation rules</p>
                      <p className="text-xs text-app-muted">Define what valid data looks like</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-app-subtle ml-auto group-hover:text-accent2 transition-colors flex-shrink-0" />
                  </Link>
                  <Link
                    href={`/review/${id}`}
                    className="flex items-center gap-3 p-3 rounded-lg bg-panel/60 border border-edge/30 hover:border-edge/60 transition-colors group"
                  >
                    <TableProperties className="w-5 h-5 text-accent2 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-app-text">Review all rows</p>
                      <p className="text-xs text-app-muted">Browse & search every row</p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-app-subtle ml-auto group-hover:text-accent2 transition-colors flex-shrink-0" />
                  </Link>
                </div>
              </section>
            )}

            <CommentsPanel datasetId={id} currentUser={currentUser} />
          </div>
        )}
      </Shell>
    </AuthGate>
  );
}

function Stat({
  label,
  value,
  suffix = "",
  accent: a,
}: {
  label: string;
  value: number;
  suffix?: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-lg border border-edge/40 bg-panel/40 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-app-subtle">{label}</div>
      <div className={`text-lg font-semibold ${a ? "text-accent" : "text-app-text"}`}>
        {typeof value === "number" && !Number.isInteger(value) ? value.toFixed(3) : value}
        {suffix}
      </div>
    </div>
  );
}

const COLORS = ["#00d9a5", "#00b8ff", "#a855f7", "#f97316", "#ef4444", "#22c55e", "#eab308"];

function CorrelationGrid({
  cells,
  colorFn,
}: {
  cells: { row: string; col: string; v: number }[];
  colorFn: (v: number) => string;
}) {
  const rows = Array.from(new Set(cells.map((c) => c.row)));
  const map = new Map(cells.map((c) => [`${c.row}||${c.col}`, c.v] as const));
  return (
    <table className="text-[10px] border-collapse">
      <thead>
        <tr>
          <th className="p-1" />
          {rows.map((h) => (
            <th key={h} className="p-1 text-app-subtle font-normal max-w-[64px] truncate" title={h}>
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r}>
            <td className="p-1 text-app-subtle max-w-[80px] truncate align-middle" title={r}>
              {r}
            </td>
            {rows.map((c) => {
              const v = map.get(`${r}||${c}`) ?? 0;
              return (
                <td
                  key={`${r}-${c}`}
                  className="p-1 text-center font-mono align-middle min-w-[40px]"
                  style={{ background: colorFn(v), color: "#0a0c10" }}
                  title={`${r} vs ${c}: ${v.toFixed(3)}`}
                >
                  {v.toFixed(1)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
