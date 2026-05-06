"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Layout, Eraser, Hash, Calendar, Type, Globe, Shield, Package,
  CheckCircle, CheckCheck, Loader2, Download, TrendingUp,
} from "lucide-react";

export interface FixEntry {
  category: string;
  what_was_wrong: string;
  what_was_fixed: string;
  why: string;
  confidence: number;
  rows_affected?: number | null;
}

// ── Quality Arc (SVG semi-circle gauge) ──────────────────────────────────────
export function QualityArc({ before, after, size = 220 }: { before: number; after: number; size?: number }) {
  const [displayed, setDisplayed] = useState(before);

  useEffect(() => {
    setDisplayed(before);
    const steps = 60;
    const diff = after - before;
    let frame = 0;
    const id = setInterval(() => {
      frame++;
      const t = frame / steps;
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      setDisplayed(before + diff * ease);
      if (frame >= steps) { setDisplayed(after); clearInterval(id); }
    }, 22);
    return () => clearInterval(id);
  }, [before, after]);

  const cx = size / 2;
  const cy = size * 0.52;   // moved up so labels have room below
  const r  = size * 0.38;
  const sw = size * 0.072;
  const sx = cx - r, sy = cy, ex = cx + r;
  const C = Math.PI * r;
  const pct = Math.min(Math.max(displayed / 100, 0), 1);
  const color = displayed >= 80 ? "#00d9a5" : displayed >= 60 ? "#f59e0b" : "#ef4444";
  const delta = after - before;
  const svgH = cy + sw / 2 + size * 0.24; // enough room for labels below the track

  return (
    <div className="flex flex-col items-center">
      <svg width={size} height={svgH} style={{ overflow: "visible" }}>
        {/* Track */}
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 0 1 ${ex} ${sy}`}
          fill="none" strokeWidth={sw} strokeLinecap="round" style={{ stroke: "var(--app-edge2)" }} />
        {/* Fill */}
        <path d={`M ${sx} ${sy} A ${r} ${r} 0 0 1 ${ex} ${sy}`}
          fill="none" stroke={color} strokeWidth={sw} strokeLinecap="round"
          strokeDasharray={C} strokeDashoffset={C * (1 - pct)}
          style={{ transition: "stroke-dashoffset 1.4s cubic-bezier(.34,1.56,.64,1), stroke 0.8s ease" }} />
        {/* Main score */}
        <text x={cx} y={cy - size * 0.04} textAnchor="middle" fill={color}
          fontSize={size * 0.175} fontWeight="800" fontFamily="ui-monospace,monospace">
          {displayed.toFixed(1)}
        </text>
        {/* Label */}
        <text x={cx} y={cy + size * 0.05} textAnchor="middle"
          fontSize={size * 0.056} letterSpacing="0.08em" style={{ fill: "var(--app-text-subtle)" }}>QUALITY SCORE</text>
        {/* Before → After labels */}
        <text x={sx} y={sy + sw * 0.75} textAnchor="middle" fontSize={size * 0.052} style={{ fill: "var(--app-text-subtle)" }}>{before.toFixed(1)}</text>
        <text x={ex} y={sy + sw * 0.75} textAnchor="middle" fontSize={size * 0.052} style={{ fill: "var(--app-text-subtle)" }}>100</text>
        {/* Delta line below */}
        <text x={cx} y={sy + sw * 0.75 + size * 0.10} textAnchor="middle"
          fill={delta >= 0 ? "#00d9a5" : "#ef4444"}
          fontSize={size * 0.068} fontWeight="700" fontFamily="ui-monospace,monospace">
          {delta >= 0 ? "+" : ""}{delta.toFixed(2)} pts
        </text>
        <text x={cx} y={sy + sw * 0.75 + size * 0.18} textAnchor="middle" fontSize={size * 0.052} style={{ fill: "var(--app-text-subtle)" }}>
          {delta >= 0 ? "improvement" : "change"}
        </text>
      </svg>
    </div>
  );
}

// ── Cleaning phase progress ──────────────────────────────────────────────────
const PHASES = [
  { id: "structure", icon: Layout,  label: "Structural Repairs",  desc: "Column headers, empty rows/cols" },
  { id: "nulls",     icon: Eraser,  label: "Null Detection",      desc: "80+ null-like patterns" },
  { id: "types",     icon: Hash,    label: "Type Coercion",       desc: "Word numbers, euro decimals, units" },
  { id: "dates",     icon: Calendar,label: "Date Parsing",        desc: "40+ international date formats" },
  { id: "strings",   icon: Type,    label: "String Normalization",desc: "HTML decode, mojibake, title-case" },
  { id: "domain",    icon: Globe,   label: "Domain Validation",   desc: "Phone, URL, gender, country, postal" },
  { id: "integrity", icon: Shield,  label: "Data Integrity",      desc: "Cross-field validation, outliers" },
  { id: "export",    icon: Package, label: "Finalizing Export",   desc: "Integer cleanup, final null scrub" },
];

export function CleaningPhases() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const DURATIONS = [500, 650, 900, 750, 650, 600, 750, 500];

    function runPhase(idx: number) {
      if (cancelled || idx >= PHASES.length) return;
      setActiveIdx(idx);
      setProgress(0);
      const steps = 36, stepMs = DURATIONS[idx] / steps;
      let s = 0;
      const iv = setInterval(() => {
        s++;
        setProgress(Math.min((s / steps) * 100, 100));
        if (s >= steps) { clearInterval(iv); if (!cancelled) setTimeout(() => runPhase(idx + 1), 60); }
      }, stepMs);
    }
    runPhase(0);
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="rounded-2xl border border-accent/20 bg-gradient-to-b from-accent/5 to-transparent p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="relative w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-accent animate-spin" />
          <div className="absolute inset-0 rounded-xl bg-accent/10 animate-ping opacity-25" />
        </div>
        <div>
          <p className="font-bold text-accent text-sm">Cleaning engine running…</p>
          <p className="text-[11px] text-app-muted">Executing {PHASES.length} pipeline phases</p>
        </div>
      </div>

      <div className="space-y-1.5">
        {PHASES.map((ph, idx) => {
          const Icon = ph.icon;
          const done = idx < activeIdx, active = idx === activeIdx, pending = idx > activeIdx;
          return (
            <div key={ph.id} className={`flex items-center gap-3 rounded-xl px-3 py-2 transition-all duration-300 ${active ? "bg-accent/10 border border-accent/20" : done ? "opacity-55" : "opacity-25"}`}>
              <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${done ? "bg-accent/15" : active ? "bg-accent/20" : "bg-edge/40"}`}>
                {done ? <CheckCircle className="w-4 h-4 text-accent" /> : <Icon className={`w-4 h-4 ${active ? "text-accent" : "text-app-subtle"}`} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className={`text-xs font-semibold ${done ? "text-app-muted" : active ? "text-app-text" : "text-app-subtle"}`}>{ph.label}</span>
                  {active && <span className="text-[10px] text-accent/70 font-mono">{Math.round(progress)}%</span>}
                  {done && <CheckCheck className="w-3 h-3 text-accent/50 flex-shrink-0" />}
                </div>
                {active && (
                  <>
                    <p className="text-[10px] text-app-muted mt-0.5">{ph.desc}</p>
                    <div className="mt-1.5 h-1 rounded-full bg-edge/60 overflow-hidden">
                      <div className="h-full rounded-full bg-accent transition-all duration-75" style={{ width: `${progress}%` }} />
                    </div>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Column Health Grid ───────────────────────────────────────────────────────
export function ColumnHealthGrid({ profileBefore, profileAfter, fixes }: {
  profileBefore: Record<string, any> | null;
  profileAfter: Record<string, any> | null;
  fixes: FixEntry[];
}) {
  const sb = profileBefore?.column_stats ?? {};
  const sa = profileAfter?.column_stats  ?? {};
  const fixMap: Record<string, number> = {};
  fixes.forEach(f => {
    const m = f.what_was_wrong.match(/['"`]([^'"`]+)['"`]/);
    if (m) fixMap[m[1]] = (fixMap[m[1]] ?? 0) + 1;
  });

  const cols = Array.from(new Set([...Object.keys(sb), ...Object.keys(sa)]));

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
      {cols.map(col => {
        const b = sb[col], a = sa[col];
        const missBefore = b?.missing_pct ?? 0, missAfter = a?.missing_pct ?? 0;
        const fxCount = fixMap[col] ?? 0;
        const isNew = !b && !!a;
        const isDropped = !!b && !a;
        const improved = missBefore > missAfter || fxCount > 0;
        const hasIssue = missAfter > 5;
        const border = hasIssue ? "border-danger/30 bg-danger/5" : improved ? "border-accent/25 bg-accent/5" : "border-edge/30 bg-void/20";
        const dot = hasIssue ? "bg-danger" : improved ? "bg-accent" : "bg-edge/50";

        return (
          <div key={col} className={`rounded-xl border p-3 ${border} ${isDropped ? "opacity-40" : ""}`}>
            <div className="flex items-start gap-1.5 mb-1.5">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-0.5 ${dot}`} />
              <span className="text-[11px] font-mono font-semibold text-app-muted truncate" title={col}>{col}</span>
              {isNew     && <span className="ml-auto text-[9px] text-accent">new</span>}
              {isDropped && <span className="ml-auto text-[9px] text-app-subtle">dropped</span>}
            </div>
            {(a?.detected_pattern ?? b?.detected_pattern) && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent/80 font-medium">
                {a?.detected_pattern ?? b?.detected_pattern}
              </span>
            )}
            {missBefore > 0 && (
              <div className="mt-2 space-y-1">
                <div className="flex justify-between text-[9px]">
                  <span className="text-app-subtle">missing</span>
                  <span className={missAfter < missBefore ? "text-accent" : "text-warn"}>{missAfter.toFixed(1)}%</span>
                </div>
                <div className="h-1 rounded-full bg-edge/60">
                  <div className={`h-full rounded-full ${missAfter < missBefore ? "bg-accent" : "bg-danger"}`}
                    style={{ width: `${Math.min(missAfter, 100)}%` }} />
                </div>
              </div>
            )}
            {fxCount > 0 && <p className="mt-1.5 text-[9px] font-semibold text-accent/70">{fxCount} fix{fxCount !== 1 ? "es" : ""}</p>}
          </div>
        );
      })}
    </div>
  );
}

// ── Unified Diff Table ───────────────────────────────────────────────────────
function cellStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v);
}

export function UnifiedDiffTable({ before, after, colsBefore, colsAfter }: {
  before: Record<string, unknown>[];
  after: Record<string, unknown>[];
  colsBefore: string[];
  colsAfter: string[];
}) {
  const [changedOnly, setChangedOnly] = useState(false);

  // Match before-row values by column INDEX so renamed columns still resolve correctly
  const getBefore = useMemo(() => (
    (bRow: Record<string, unknown> | undefined, ci: number): unknown => {
      if (!bRow) return undefined;
      const beforeKey = colsBefore[ci];
      return beforeKey !== undefined ? bRow[beforeKey] : undefined;
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [colsBefore]);

  // Memoize expensive diff pass — only reruns when data props change
  const rows = useMemo(() =>
    after.map((aRow, ri) => {
      const bRow = before[ri];
      const changed = colsAfter.some((c, ci) => cellStr(aRow[c]) !== cellStr(getBefore(bRow, ci) ?? ""));
      return { aRow, bRow, changed, ri };
    }),
  [after, before, colsAfter, getBefore]);

  const changedCells = useMemo(() =>
    rows.reduce((n, { aRow, bRow }) =>
      n + colsAfter.filter((c, ci) => cellStr(aRow[c]) !== cellStr(getBefore(bRow, ci) ?? "")).length, 0),
  [rows, colsAfter, getBefore]);

  const visible = useMemo(() =>
    changedOnly ? rows.filter(r => r.changed) : rows,
  [rows, changedOnly]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-3 text-[11px] text-app-muted">
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded bg-warn/20 border border-warn/30" />Old value (struck)</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded bg-accent/20 border border-accent/30" />New value</span>
          <span className="flex items-center gap-1.5"><span className="text-danger/50 italic text-[10px]">∅</span>missing</span>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[11px] text-app-subtle">{changedCells.toLocaleString()} cells changed</span>
          <label className="flex items-center gap-1.5 text-[11px] text-app-muted cursor-pointer select-none">
            <input type="checkbox" checked={changedOnly} onChange={e => setChangedOnly(e.target.checked)} className="accent-accent" />
            Changed rows only
          </label>
        </div>
      </div>

      <div className="rounded-xl border border-edge/40 overflow-hidden">
        <div className="overflow-x-auto overflow-y-auto" style={{ maxHeight: 520 }}>
          <table className="w-full text-xs font-mono border-collapse">
            <thead className="sticky top-0 z-10 bg-panel/95 backdrop-blur">
              <tr className="border-b border-edge/40">
                <th className="px-3 py-2.5 text-left text-app-subtle w-10">#</th>
                {colsAfter.map((c, ci) => (
                  <th key={c} className="px-3 py-2.5 text-left text-app-muted font-semibold whitespace-nowrap">
                    {c}{ci >= colsBefore.length && <span className="ml-1 text-[9px] text-accent font-normal">new</span>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map(({ aRow, bRow, changed, ri }) => (
                <tr key={ri} className={`border-b border-edge/15 transition-colors ${changed ? "" : "hover:bg-accent/3 even:bg-void/15"}`}>
                  <td className="px-3 py-1 text-app-subtle select-none">{ri + 1}</td>
                  {colsAfter.map((c, ci) => {
                    const bVal = getBefore(bRow, ci), aVal = aRow[c];
                    const bStr = cellStr(bVal), aStr = cellStr(aVal);
                    const diff = bStr !== aStr;
                    const aMiss = aVal === null || aVal === undefined;
                    const bMiss = bVal === null || bVal === undefined;
                    return (
                      <td key={c} className={`px-3 py-1 max-w-[200px] whitespace-nowrap ${diff ? "bg-accent/4" : ""}`}>
                        {diff ? (
                          <div className="flex flex-col gap-0.5">
                            <span className="text-[10px] line-through text-warn/55 truncate">
                              {bMiss ? "∅ null" : bStr}
                            </span>
                            <span className={`truncate ${aMiss ? "text-danger/50 italic text-[10px]" : "text-accent font-semibold"}`}>
                              {aMiss ? "∅ null" : aStr}
                            </span>
                          </div>
                        ) : (
                          <span className={`truncate block ${aMiss ? "text-danger/40 italic text-[10px]" : "text-app-muted"}`}>
                            {aMiss ? "∅ null" : aStr}
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Floating Export Bar ──────────────────────────────────────────────────────
export function FloatingExportBar({ fixes, qualityBefore, qualityAfter, rowsAfter, onDownload, formats }: {
  fixes: number;
  qualityBefore: number;
  qualityAfter: number;
  rowsAfter: number;
  onDownload: (fmt: string) => void;
  formats: string[];
}) {
  const delta = qualityAfter - qualityBefore;
  return (
    <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-2.5 rounded-2xl border border-accent/30 bg-panel/90 backdrop-blur-xl shadow-2xl shadow-black/50">
      <div className="flex items-center gap-2 pr-3 border-r border-edge">
        <div className="w-2 h-2 rounded-full bg-accent animate-pulse" />
        <span className="text-xs text-app-text">
          <span className="font-bold text-accent">{fixes}</span> fixes ·{" "}
          <span className="font-bold text-accent">{rowsAfter.toLocaleString()}</span> rows
        </span>
        {delta > 0 && (
          <span className="flex items-center gap-0.5 text-xs text-accent font-bold">
            <TrendingUp className="w-3.5 h-3.5" />+{delta.toFixed(1)} pts
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {formats.map(fmt => (
          <button key={fmt} onClick={() => onDownload(fmt)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-accent text-void text-xs font-bold hover:bg-accent/85 transition-colors shadow-sm">
            <Download className="w-3.5 h-3.5" />.{fmt.toUpperCase()}
          </button>
        ))}
      </div>
    </div>
  );
}
