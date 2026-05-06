"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, apiUrl, getToken } from "@/lib/api";
import {
  CheckCircle, XCircle, Target, Sparkles, ChevronDown, ChevronRight,
  Loader2, Download, Table, FileText, ArrowRight, Zap, Layers,
} from "lucide-react";
import {
  FixEntry, QualityArc, CleaningPhases, ColumnHealthGrid,
  UnifiedDiffTable, FloatingExportBar,
} from "@/components/CleaningHelpers";
import { showToast } from "@/components/Toast";

interface CleanReport {
  fixes: FixEntry[];
  row_count_before: number;
  row_count_after: number;
  guardrails?: {
    min_transform_confidence?: number;
    blocked_steps?: string[];
    blocked_steps_count?: number;
  };
  schema_validation?: {
    enabled?: boolean;
    issues_count?: number;
    issues?: FixEntry[];
  };
}

type ActiveTab = "diff" | "colhealth" | "log" | "export" | "objectives" | "guardrails";

const CAT_META: Record<string, { color: string; label: string }> = {
  missing:     { color: "text-warn",       label: "Missing Values" },
  duplicates:  { color: "text-accent2",    label: "Duplicates" },
  format:      { color: "text-accent",     label: "Format / Types" },
  typo:        { color: "text-purple-400", label: "Typos / Spelling" },
  email:       { color: "text-blue-400",   label: "Email Validation" },
  rule:        { color: "text-pink-400",   label: "Custom Rule" },
  cross_field: { color: "text-orange-400", label: "Cross-field Logic" },
  invalid:     { color: "text-red-400",    label: "Invalid Values" },
  outlier:     { color: "text-yellow-400", label: "Outliers" },
  schema:      { color: "text-cyan-400",   label: "Schema Validation" },
  guardrail:   { color: "text-emerald-400", label: "Guardrails" },
};


export default function CleaningPage() {
  const params = useParams();
  const id = String(params.id);

  const CACHE_KEY = `clean_results_${id}`;

  const [preCleanMeta, setPreCleanMeta] = useState<any | null>(null);
  const [busyMode, setBusyMode] = useState<"auto" | "custom" | null>(null);
  const [report, setReport] = useState<CleanReport | null>(null);
  const [qualityBefore, setQualityBefore] = useState<number | null>(null);
  const [qualityAfter, setQualityAfter]   = useState<number | null>(null);
  const [profileBefore, setProfileBefore] = useState<any | null>(null);
  const [profileAfter,  setProfileAfter]  = useState<any | null>(null);
  const [previewBefore, setPreviewBefore] = useState<Record<string, any>[] | null>(null);
  const [previewAfter,  setPreviewAfter]  = useState<Record<string, any>[] | null>(null);
  const [exportsMap, setExportsMap]       = useState<Record<string, string> | null>(null);
  const [objectiveResults, setObjectiveResults] = useState<any[] | null>(null);
  const [performanceMeta, setPerformanceMeta] = useState<{ fast_mode?: boolean; preview_rows?: number; dataset_rows?: number } | null>(null);
  const [cleanError, setCleanError]       = useState<string | null>(null);
  const [activeTab, setActiveTab]         = useState<ActiveTab>("diff");
  const [showAdvanced, setShowAdvanced]   = useState(false);
  const [lastCleanedAt, setLastCleanedAt] = useState<string | null>(null);
  const [uniquenessCols, setUniquenessCols] = useState<Set<string>>(new Set());
  const [survivorship, setSurvivorship]     = useState<"first" | "last" | "most_complete">("first");
  const [rulesJson, setRulesJson] = useState(`[\n  { "column": "age", "rule": "gte", "value": 18 }\n]`);
  const [schemaJson, setSchemaJson] = useState(`{\n  "required_columns": [],\n  "column_types": {}\n}`);

  // Restore previous results from localStorage on mount
  useEffect(() => {
    try {
      const cached = localStorage.getItem(CACHE_KEY);
      if (cached) {
        const d = JSON.parse(cached);
        setReport(d.report);
        setQualityBefore(d.quality_score_before);
        setQualityAfter(d.quality_score_after);
        setProfileBefore(d.profile_before);
        setProfileAfter(d.profile_after);
        setPreviewBefore(d.preview_before);
        setPreviewAfter(d.preview_after);
        setExportsMap(d.export_paths);
        setObjectiveResults(d.objective_results || null);
        setPerformanceMeta(d.performance || null);
        setLastCleanedAt(d.cleaned_at || null);
      }
    } catch { /* ignore corrupt cache */ }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  const [opts, setOpts] = useState({
    missing_strategy: "median",
    clip_outliers: false,
    outlier_method: "iqr",
    fix_missing: true,
    remove_duplicates: true,
    fix_typos: true,
    validate_emails: true,
    coerce_types: true,
    normalize_strings: true,
    auto_standardize: true,
    split_columns: true,
    reconcile_categories: true,
    normalize_column_names: true,
    drop_constant_columns: false,
    min_transform_confidence: 0.75,
    fail_on_schema_error: false,
    quarantine_on_schema_failure: true,
    performance_mode: false,
  });

  const [originalFilename, setOriginalFilename] = useState<string>("dataset");
  useEffect(() => {
    apiFetch(`/datasets/${id}`)
      .then((d) => {
        const profile = d.analysis_json ? (typeof d.analysis_json === "string" ? JSON.parse(d.analysis_json) : d.analysis_json) : null;
        if (profile) setPreCleanMeta(profile);
        if (d.original_filename) setOriginalFilename(d.original_filename.replace(/\.[^.]+$/, ""));
      })
      .catch(() => {});
  }, [id]);

  const runClean = useCallback(
    async (safeAll: boolean) => {
      setBusyMode(safeAll ? "auto" : "custom");
      setReport(null);
      setCleanError(null);
      try {
        let custom_rules: unknown[] = [];
        try { custom_rules = JSON.parse(rulesJson) as unknown[]; } catch { custom_rules = []; }
        let strict_schema: Record<string, unknown> = {};
        try { strict_schema = JSON.parse(schemaJson) as Record<string, unknown>; } catch { strict_schema = {}; }
        const body = {
          dataset_id: id,
          fix_missing: safeAll ? true : opts.fix_missing,
          missing_strategy: opts.missing_strategy,
          remove_duplicates: safeAll ? true : opts.remove_duplicates,
          coerce_types: safeAll ? true : opts.coerce_types,
          normalize_strings: safeAll ? true : opts.normalize_strings,
          fix_typos: safeAll ? true : opts.fix_typos,
          clip_outliers: safeAll ? false : opts.clip_outliers,
          outlier_method: opts.outlier_method,
          auto_standardize: safeAll ? true : opts.auto_standardize,
          split_columns: safeAll ? true : opts.split_columns,
          reconcile_categories: safeAll ? true : opts.reconcile_categories,
          normalize_column_names: safeAll ? true : opts.normalize_column_names,
          drop_constant_columns: safeAll ? false : opts.drop_constant_columns,
          validate_emails: safeAll ? true : opts.validate_emails,
          validate_age_min: 0,
          validate_age_max: 120,
          custom_rules,
          safe_mode: true,
          fuzzy_threshold: 0,
          uniqueness_cols: uniquenessCols.size > 0 ? Array.from(uniquenessCols) : undefined,
          survivorship,
          min_transform_confidence: opts.min_transform_confidence,
          fail_on_schema_error: opts.fail_on_schema_error,
          quarantine_on_schema_failure: opts.quarantine_on_schema_failure,
          performance_mode: opts.performance_mode,
          strict_schema,
        };
        const data = await apiFetch(safeAll ? "/clean/safe-all" : "/clean", {
          method: "POST",
          body: JSON.stringify(body),
        });
        const cleanedAt = new Date().toLocaleString();
        setReport(data.report);
        setQualityBefore(data.quality_score_before);
        setQualityAfter(data.quality_score_after);
        setProfileBefore(data.profile_before);
        setProfileAfter(data.profile_after);
        setPreviewBefore(data.preview_before);
        setPreviewAfter(data.preview_after);
        setExportsMap(data.export_paths);
        setObjectiveResults(data.objective_results || null);
        setPerformanceMeta(data.performance || null);
        setLastCleanedAt(cleanedAt);
        setActiveTab("diff");

        // ── Success notification ─────────────────────────────────────────
        const fixCount = data.report?.fixes?.length ?? 0;
        const scoreBefore = data.quality_score_before ?? null;
        const scoreAfter  = data.quality_score_after  ?? null;
        const scoreLine =
          scoreBefore !== null && scoreAfter !== null
            ? ` · Quality ${scoreBefore}% → ${scoreAfter}%`
            : "";
        showToast(
          `Dataset cleaned — ${fixCount} fix${fixCount !== 1 ? "es" : ""} applied${scoreLine}`,
          "success",
          6000,
        );

        try {
          // Only persist the lightweight parts of the response.
          // profile_before / profile_after can be hundreds of KB each and
          // JSON.stringify on the main thread will cause a visible stutter.
          const slim = {
            report:               data.report,
            quality_score_before: data.quality_score_before,
            quality_score_after:  data.quality_score_after,
            preview_before:       data.preview_before,
            preview_after:        data.preview_after,
            export_paths:         data.export_paths,
            objective_results:    data.objective_results,
            performance:          data.performance,
            cleaned_at:           cleanedAt,
          };
          localStorage.setItem(CACHE_KEY, JSON.stringify(slim));
        } catch { /* storage full — ignore */ }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setCleanError(msg);
        showToast(`Cleaning failed: ${msg}`, "error", 8000);
      } finally {
        setBusyMode(null);
      }
    },
    [id, opts, rulesJson, schemaJson, uniquenessCols, survivorship],
  );

  const colsBefore = useMemo(
    () => previewBefore?.length ? Object.keys(previewBefore[0]).filter((c) => c !== "_is_duplicate") : [],
    [previewBefore],
  );
  const colsAfter = useMemo(
    () => previewAfter?.length ? Object.keys(previewAfter[0]).filter((c) => c !== "_is_duplicate") : [],
    [previewAfter],
  );

  const fixesByCategory = useMemo(() => {
    if (!report?.fixes) return {} as Record<string, FixEntry[]>;
    return report.fixes.reduce<Record<string, FixEntry[]>>((acc, f) => {
      const k = f.category || "other";
      (acc[k] = acc[k] || []).push(f);
      return acc;
    }, {});
  }, [report]);

  const changedCellCount = useMemo(() => {
    if (!previewBefore || !previewAfter) return 0;
    let n = 0;
    previewAfter.forEach((aRow, ri) => {
      const bRow = previewBefore[ri];
      if (!bRow) return;
      colsAfter.forEach(c => {
        const bv = bRow[c] == null ? "" : String(bRow[c]);
        const av = aRow[c] == null ? "" : String(aRow[c]);
        if (bv !== av) n++;
      });
    });
    return n;
  }, [previewBefore, previewAfter, colsAfter]);

  function downloadFmt(fmt: string) {
    void fetch(`${apiUrl("")}/download/${id}/${fmt}`, {
      headers: { Authorization: `Bearer ${getToken() || ""}` },
    })
      .then((r) => r.blob())
      .then((b) => {
        const url = URL.createObjectURL(b);
        const a = document.createElement("a");
        a.href = url;
        a.download = `${originalFilename}_cleaned.${fmt}`;
        a.click();
        URL.revokeObjectURL(url);
      });
  }

  const tabs: { id: ActiveTab; icon: React.ElementType; label: string }[] = [
    { id: "diff",       icon: Table,       label: `Inline Diff${changedCellCount > 0 ? ` · ${changedCellCount.toLocaleString()} cells` : ""}` },
    { id: "colhealth",  icon: Layers,      label: "Column Health" },
    { id: "log",        icon: FileText,    label: `Fix Log (${report?.fixes.length ?? 0})` },
    { id: "guardrails", icon: CheckCircle, label: `Guardrails (${report?.guardrails?.blocked_steps_count ?? 0})` },
    { id: "export",     icon: Download,    label: "Export" },
    ...(objectiveResults?.length ? [{ id: "objectives" as ActiveTab, icon: Target, label: `Objectives (${objectiveResults.length})` }] : []),
  ];

  return (
    <AuthGate>
      <Shell>

        {/* ── Breadcrumb ── */}
        <div className="flex items-center gap-2 text-xs text-app-muted mb-5">
          <Link href={`/analysis/${id}`} className="hover:text-accent transition-colors">Raw Analysis</Link>
          <ArrowRight className="w-3 h-3" />
          <span className="text-accent font-semibold">Clean</span>
          <ArrowRight className="w-3 h-3" />
          <span>Export</span>
        </div>

        {/* ── Page header ── */}
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-1">
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest bg-accent/10 text-accent border border-accent/30">
              Step 2 · Cleaning
            </span>
            <span className="text-xs text-app-subtle font-mono">{id}</span>
          </div>
          <h1 className="text-2xl font-bold text-app-text">Clean Dataset</h1>
          <p className="text-sm text-app-muted mt-1">
            Your original file is <strong className="text-app-text">never modified</strong>. Configure options, run cleaning, then compare the full before/after preview and export.
          </p>
        </div>

        {/* ── Pre-Cleaning Assessment ── */}
        {preCleanMeta && (() => {
          const issues: { label: string; value: string; sev: "high" | "med" | "low"; tip: string }[] = [];
          const missingPct = preCleanMeta.missing_cells_pct ?? 0;
          const dupRows    = preCleanMeta.duplicate_rows    ?? 0;
          const totalRows  = preCleanMeta.total_rows        ?? 1;
          const qs         = preCleanMeta.quality_score     ?? 100;

          if (missingPct > 10)  issues.push({ label: "Missing values",  value: `${missingPct.toFixed(1)}%`,            sev: "high", tip: "High missing rate — choose an imputation strategy below" });
          else if (missingPct > 2) issues.push({ label: "Missing values", value: `${missingPct.toFixed(1)}%`,           sev: "med",  tip: "Some missing values detected — median fill recommended" });

          if (dupRows > 0)       issues.push({ label: "Duplicate rows",  value: dupRows.toLocaleString(),               sev: dupRows / totalRows > 0.1 ? "high" : "med", tip: "Duplicates inflate row counts and distort metrics" });

          if (qs < 60)           issues.push({ label: "Quality score",   value: `${qs.toFixed(0)} / 100`,               sev: "high", tip: "Low quality — Auto Clean is strongly recommended" });
          else if (qs < 80)      issues.push({ label: "Quality score",   value: `${qs.toFixed(0)} / 100`,               sev: "med",  tip: "Moderate quality — review options before cleaning" });
          else                   issues.push({ label: "Quality score",   value: `${qs.toFixed(0)} / 100`,               sev: "low",  tip: "Data is in good shape — Auto Clean will apply light fixes" });

          const typeMismatch = preCleanMeta.type_mismatch_pct ?? 0;
          const outlierPct   = preCleanMeta.outlier_cells_pct ?? 0;
          if (typeMismatch > 5)  issues.push({ label: "Type mismatches",  value: `${typeMismatch.toFixed(1)}%`,            sev: "high", tip: "Numeric data stored as strings — coerce types to fix" });
          else if (typeMismatch > 0) issues.push({ label: "Type mismatches", value: `${typeMismatch.toFixed(1)}%`,         sev: "med",  tip: "Some columns have mixed types" });
          if (outlierPct > 10)  issues.push({ label: "Outlier cells",    value: `${outlierPct.toFixed(1)}%`,             sev: "high", tip: "High outlier density — enable Clip Outliers" });
          else if (outlierPct > 3) issues.push({ label: "Outlier cells",  value: `${outlierPct.toFixed(1)}%`,            sev: "med",  tip: "Moderate outlier rate detected" });

          const numCols   = (preCleanMeta.numeric_columns  ?? []).length;
          const dateCols  = (preCleanMeta.date_columns      ?? []).length;
          if (dateCols > 0)     issues.push({ label: "Date columns",    value: `${dateCols} detected`,                  sev: "low",  tip: "Dates will be normalised to YYYY-MM-DD" });
          if (numCols > 0)      issues.push({ label: "Numeric columns", value: `${numCols} detected`,                   sev: "low",  tip: "Numeric coercion + word-number conversion will run" });

          const sevColor = { high: "border-danger/40 bg-danger/5 text-danger", med: "border-warn/40 bg-warn/5 text-warn", low: "border-edge bg-void/60 text-app-subtle" };

          return (
            <div className="rounded-xl border border-edge bg-panel p-5 mb-4">
              <div className="flex items-center gap-2 mb-4">
                <span className="text-sm font-semibold text-app-text">Pre-Cleaning Assessment</span>
                <span className="text-[10px] text-app-subtle ml-auto">Based on last analysis · {(preCleanMeta.total_rows ?? 0).toLocaleString()} rows · {(preCleanMeta.total_columns ?? 0)} columns</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {issues.map((iss) => (
                  <span
                    key={iss.label}
                    title={iss.tip}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium cursor-default ${sevColor[iss.sev]}`}
                  >
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      iss.sev === "high" ? "bg-danger" : iss.sev === "med" ? "bg-warn" : "bg-edge/60"
                    } flex-shrink-0`} />
                    {iss.label}: <strong>{iss.value}</strong>
                  </span>
                ))}
              </div>
              {issues.some((i) => i.sev === "high") && (
                <p className="text-[11px] text-danger/70 mt-3">
                  High-severity issues detected — <strong>Auto Clean</strong> addresses all of them automatically.
                </p>
              )}
            </div>
          );
        })()}

        {/* ── Engine options ── */}
        <div className="rounded-xl border border-edge bg-panel p-5 mb-4">
          <h2 className="text-sm font-semibold text-app-text mb-4 flex items-center gap-2">
            <Zap className="w-4 h-4 text-accent" />
            Engine Options
          </h2>

          <div className="flex flex-wrap gap-5 items-end">
            <label className="flex flex-col gap-1 text-xs text-app-muted">
              Missing strategy
              <select
                className="bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                value={opts.missing_strategy}
                onChange={(e) => setOpts((o) => ({ ...o, missing_strategy: e.target.value }))}
              >
                <option value="median">Median</option>
                <option value="mean">Mean</option>
                <option value="most_frequent">Most Frequent</option>
                <option value="knn">KNN</option>
                <option value="regression">Regression</option>
                <option value="ffill">Forward Fill (time-series)</option>
                <option value="bfill">Backward Fill (time-series)</option>
              </select>
            </label>

            <label className="flex flex-col gap-1 text-xs text-app-muted">
              Outlier method
              <select
                className="bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-1.5 text-app-text text-sm min-w-[120px]"
                value={opts.outlier_method}
                onChange={(e) => setOpts((o) => ({ ...o, outlier_method: e.target.value }))}
              >
                <option value="iqr">IQR</option>
                <option value="zscore">Z-score</option>
              </select>
            </label>

            <label className="flex items-center gap-2 text-sm text-app-muted pb-1 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={opts.clip_outliers}
                onChange={(e) => setOpts((o) => ({ ...o, clip_outliers: e.target.checked }))}
                className="accent-accent"
              />
              Clip outliers
            </label>

            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-1.5 text-xs text-app-muted hover:text-accent transition-colors pb-1"
            >
              {showAdvanced ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
              Advanced safety (rules + schema)
            </button>
          </div>

          {/* New feature toggles */}
          <div className="mt-4 pt-4 border-t border-edge/50">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-app-subtle mb-3">Cleaning Features</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-2.5">
              {([
                { key: "fix_missing",            label: "Impute missing values",    tip: "Fill null/NaN cells using the chosen strategy" },
                { key: "remove_duplicates",      label: "Remove duplicates",        tip: "Drop exact duplicate rows" },
                { key: "coerce_types",           label: "Coerce numeric types",     tip: "Convert text numbers (e.g. 'forty') to numeric" },
                { key: "normalize_strings",      label: "Normalise strings",        tip: "Trim whitespace, fix Unicode, title-case names" },
                { key: "fix_typos",              label: "Fix typos",                tip: "Map known misspellings to canonical forms" },
                { key: "validate_emails",        label: "Validate emails",          tip: "Flag / nullify malformed email addresses" },
                { key: "auto_standardize",       label: "Auto find & replace",      tip: "Standardise booleans, strip currency/% symbols" },
                { key: "split_columns",          label: "Split compound columns",   tip: "Split Full Name → first/last; delimiter-separated values" },
                { key: "reconcile_categories",   label: "Reconcile categories",     tip: "Merge near-duplicate labels (USA / U.S.A. → USA)" },
                { key: "normalize_column_names", label: "Normalise column names",   tip: "Rename headers to snake_case" },
                { key: "drop_constant_columns",  label: "Drop constant columns",    tip: "Remove columns with only 1 unique value (off by default)" },
                { key: "performance_mode",       label: "Performance mode",         tip: "Faster run with lighter profiling and smaller previews" },
              ] as { key: keyof typeof opts; label: string; tip: string }[]).map(({ key, label, tip }) => (
                <label key={key} className="flex items-start gap-2 cursor-pointer select-none group" title={tip}>
                  <input
                    type="checkbox"
                    checked={opts[key] as boolean}
                    onChange={(e) => setOpts((o) => ({ ...o, [key]: e.target.checked }))}
                    className="accent-accent mt-0.5 flex-shrink-0"
                  />
                  <span className="text-xs text-app-muted group-hover:text-app-text transition-colors leading-tight">{label}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Deduplication settings — shown when remove_duplicates is on */}
          {opts.remove_duplicates && (() => {
            const availCols: string[] = preCleanMeta?.column_names ?? [];
            return (
              <div className="mt-4 pt-4 border-t border-edge/50">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-app-subtle mb-3">Deduplication Settings</p>
                <div className="flex flex-wrap gap-5 items-start">
                  {/* Column selector */}
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-app-muted">
                      Match columns
                      <span className="ml-1 text-app-subtle font-normal">(leave empty = all non-ID columns)</span>
                    </span>
                    {availCols.length === 0 ? (
                      <span className="text-xs text-app-subtle italic">Run analysis first to see columns</span>
                    ) : (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-5 gap-y-1.5 max-h-36 overflow-y-auto pr-1">
                        {availCols.map((col) => (
                          <label key={col} className="flex items-center gap-2 cursor-pointer select-none group">
                            <input
                              type="checkbox"
                              className="accent-accent"
                              checked={uniquenessCols.has(col)}
                              onChange={(e) => {
                                setUniquenessCols((prev) => {
                                  const next = new Set(prev);
                                  e.target.checked ? next.add(col) : next.delete(col);
                                  return next;
                                });
                              }}
                            />
                            <span className="text-xs text-app-muted group-hover:text-app-text transition-colors truncate max-w-[120px]">{col}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Survivorship */}
                  <label className="flex flex-col gap-1 text-xs text-app-muted">
                    Keep which row?
                    <select
                      className="bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                      value={survivorship}
                      onChange={(e) => setSurvivorship(e.target.value as typeof survivorship)}
                    >
                      <option value="first">First occurrence</option>
                      <option value="last">Last occurrence</option>
                      <option value="most_complete">Most complete (fewest nulls)</option>
                    </select>
                  </label>
                </div>

                {uniquenessCols.size > 0 && (
                  <p className="mt-2 text-[11px] text-accent/80">
                    Partial match: rows are duplicates when <strong className="text-accent">{Array.from(uniquenessCols).join(", ")}</strong> are identical — other columns are ignored.
                  </p>
                )}
              </div>
            );
          })()}

          {showAdvanced && (
            <div className="mt-3">
              <p className="text-[11px] text-app-muted mb-1">
                Column-level rules — e.g.{" "}
                <code className="bg-void px-1 rounded">{"{ \"column\": \"age\", \"rule\": \"gte\", \"value\": 18 }"}</code>
              </p>
              <textarea
                className="w-full h-24 bg-[var(--app-input-bg)] border border-edge/60 rounded-lg p-2 text-xs text-app-text font-mono resize-y focus:outline-none focus:ring-2 focus:ring-accent/40"
                value={rulesJson}
                onChange={(e) => setRulesJson(e.target.value)}
              />
              <div className="grid md:grid-cols-3 gap-3 mt-3">
                <label className="flex flex-col gap-1 text-xs text-app-muted">
                  Minimum transform confidence
                  <input
                    type="number"
                    min={0}
                    max={1}
                    step={0.05}
                    value={opts.min_transform_confidence}
                    onChange={(e) => setOpts((o) => ({ ...o, min_transform_confidence: Number(e.target.value) || 0 }))}
                    className="bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-2 py-1.5 text-app-text text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                  />
                </label>
                <label className="flex items-center gap-2 text-xs text-app-muted pt-5">
                  <input
                    type="checkbox"
                    checked={opts.fail_on_schema_error}
                    onChange={(e) => setOpts((o) => ({ ...o, fail_on_schema_error: e.target.checked }))}
                    className="accent-accent"
                  />
                  Fail on schema errors
                </label>
                <label className="flex items-center gap-2 text-xs text-app-muted pt-5">
                  <input
                    type="checkbox"
                    checked={opts.quarantine_on_schema_failure}
                    onChange={(e) => setOpts((o) => ({ ...o, quarantine_on_schema_failure: e.target.checked }))}
                    className="accent-accent"
                  />
                  Quarantine schema failures
                </label>
              </div>
              <p className="text-[11px] text-app-muted mt-3 mb-1">
                Strict schema JSON (optional)
              </p>
              <textarea
                className="w-full h-24 bg-[var(--app-input-bg)] border border-edge/60 rounded-lg p-2 text-xs text-app-text font-mono resize-y focus:outline-none focus:ring-2 focus:ring-accent/40"
                value={schemaJson}
                onChange={(e) => setSchemaJson(e.target.value)}
              />
            </div>
          )}

          <div className="flex flex-wrap gap-3 mt-5 pt-4 border-t border-edge">
            <button
              type="button"
              disabled={busyMode !== null}
              onClick={() => runClean(true)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-accent text-void font-bold text-sm hover:bg-accent/85 disabled:opacity-50 transition-colors shadow-sm"
            >
              {busyMode === "auto" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              Auto Clean
            </button>
            <button
              type="button"
              disabled={busyMode !== null}
              onClick={() => runClean(false)}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-void border border-edge text-app-text font-medium text-sm hover:border-accent/50 disabled:opacity-50 transition-colors"
            >
              {busyMode === "custom" && <Loader2 className="w-4 h-4 animate-spin" />}
              Run Custom Clean
            </button>
            {report && (
              <Link
                href={`/review/${id}`}
                className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-void border border-edge text-app-muted font-medium text-sm hover:border-accent/40 transition-colors"
              >
                <Table className="w-4 h-4" />
                Review Original Rows
              </Link>
            )}
          </div>

          <p className="text-[11px] text-app-subtle mt-3">
            <strong className="text-app-muted">Auto Clean</strong> — normalises nulls, deduplicates, coerces types, standardises formats, reconciles categories, validates emails &amp; ranges.&nbsp;
            <strong className="text-app-muted">Custom Clean</strong> — uses your options above (outlier clipping, imputation strategy, feature toggles).&nbsp;
            <strong className="text-app-muted">Performance mode</strong> — faster on large datasets by reducing profiling/preview overhead.&nbsp;
            Originals are <strong className="text-app-muted">never modified</strong>.
          </p>
        </div>

        {/* ── Cached results notice ── */}
        {report && busyMode === null && lastCleanedAt && (
          <div className="rounded-xl border border-accent/20 bg-accent/5 px-4 py-2.5 flex items-center gap-3 mb-3 text-xs text-app-muted">
            <CheckCircle className="w-4 h-4 text-accent flex-shrink-0" />
            <span>Results restored from last clean · <strong className="text-app-text">{lastCleanedAt}</strong></span>
            <button
              onClick={() => {
                localStorage.removeItem(CACHE_KEY);
                setReport(null); setQualityBefore(null); setQualityAfter(null);
                setProfileBefore(null); setProfileAfter(null);
                setPreviewBefore(null); setPreviewAfter(null);
                setExportsMap(null); setObjectiveResults(null); setPerformanceMeta(null); setLastCleanedAt(null);
              }}
              className="ml-auto text-app-subtle hover:text-danger transition-colors"
              title="Clear cached results"
            >
              Clear
            </button>
          </div>
        )}

        {/* ── Error ── */}
        {cleanError && (
          <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 flex items-start gap-3 mb-4">
            <XCircle className="w-5 h-5 text-danger flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-danger">Cleaning failed</p>
              <p className="text-xs text-app-muted mt-1 font-mono break-all">{cleanError}</p>
            </div>
          </div>
        )}

        {/* ── In-progress ── */}
        {busyMode !== null && <div className="mb-4"><CleaningPhases /></div>}

        {/* ══════════ RESULTS ══════════ */}
        {report && busyMode === null && (
          <div className="space-y-5">
            {(performanceMeta?.fast_mode || false) && (
              <div className="rounded-xl border border-accent2/30 bg-accent2/5 px-4 py-3 text-xs text-app-muted">
                Performance mode active: using lighter profiling and {performanceMeta?.preview_rows ?? 20} preview rows for faster execution.
              </div>
            )}

            {/* ── Hero summary bar ── */}
            <div className="rounded-xl border border-accent/30 bg-gradient-to-br from-accent/8 to-transparent p-5">
              <div className="flex flex-wrap items-center gap-2 mb-4">
                <Sparkles className="w-4 h-4 text-accent" />
                <span className="text-sm font-bold text-accent">Cleaning Complete</span>
                <span className="text-xs text-app-muted">
                  · {report.fixes.length} operation{report.fixes.length !== 1 ? "s" : ""} applied · original file unchanged
                </span>
                {(report.guardrails?.blocked_steps_count || 0) > 0 && (
                  <span className="ml-auto text-[11px] text-emerald-400 font-semibold">
                    🛡 {report.guardrails?.blocked_steps_count} guardrail block{(report.guardrails?.blocked_steps_count ?? 0) !== 1 ? "s" : ""}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap gap-6 items-start">
                {qualityBefore != null && qualityAfter != null && (
                  <div className="flex-shrink-0">
                    <QualityArc before={qualityBefore} after={qualityAfter} size={210} />
                  </div>
                )}

                <div className="flex-1 min-w-[260px] grid grid-cols-2 gap-3 content-start pt-2">
                  <div className="rounded-xl bg-void/70 border border-edge p-4">
                    <div className="text-[10px] text-app-subtle uppercase tracking-wider mb-2">Rows</div>
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-2xl font-bold text-warn">{report.row_count_before.toLocaleString()}</span>
                      <span className="text-app-subtle text-sm">→</span>
                      <span className="text-2xl font-bold text-accent">{report.row_count_after.toLocaleString()}</span>
                    </div>
                    <div className="text-xs text-app-subtle mt-1">
                      {report.row_count_before - report.row_count_after > 0
                        ? `${(report.row_count_before - report.row_count_after).toLocaleString()} removed`
                        : "no rows removed"}
                    </div>
                  </div>

                  {profileBefore && profileAfter && (
                    <div className="rounded-xl bg-void/70 border border-edge p-4">
                      <div className="text-[10px] text-app-subtle uppercase tracking-wider mb-2">Missing %</div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-bold text-warn">{profileBefore.missing_cells_pct.toFixed(1)}<span className="text-sm">%</span></span>
                        <span className="text-app-subtle text-sm">→</span>
                        <span className="text-2xl font-bold text-accent">{profileAfter.missing_cells_pct.toFixed(1)}<span className="text-sm">%</span></span>
                      </div>
                      <div className="text-xs text-app-subtle mt-1">{(profileBefore.missing_cells_pct - profileAfter.missing_cells_pct).toFixed(2)}% resolved</div>
                    </div>
                  )}

                  {profileBefore && profileAfter && (
                    <div className="rounded-xl bg-void/70 border border-edge p-4">
                      <div className="text-[10px] text-app-subtle uppercase tracking-wider mb-2">Duplicates</div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-bold text-warn">{profileBefore.duplicate_rows}</span>
                        <span className="text-app-subtle text-sm">→</span>
                        <span className="text-2xl font-bold text-accent">{profileAfter.duplicate_rows}</span>
                      </div>
                      <div className="text-xs text-app-subtle mt-1">{profileBefore.duplicate_rows - profileAfter.duplicate_rows} removed</div>
                    </div>
                  )}

                  {profileBefore && profileAfter && (
                    <div className="rounded-xl bg-void/70 border border-edge p-4">
                      <div className="text-[10px] text-app-subtle uppercase tracking-wider mb-2">Columns</div>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-bold text-app-muted">{profileBefore.total_columns}</span>
                        <span className="text-app-subtle text-sm">→</span>
                        <span className={`text-2xl font-bold ${
                          profileAfter.total_columns > profileBefore.total_columns ? "text-accent" :
                          profileAfter.total_columns < profileBefore.total_columns ? "text-warn" : "text-app-muted"
                        }`}>{profileAfter.total_columns}</span>
                      </div>
                      <div className="text-xs text-app-subtle mt-1">
                        {profileAfter.total_columns === profileBefore.total_columns ? "no change" :
                          profileAfter.total_columns > profileBefore.total_columns
                            ? `+${profileAfter.total_columns - profileBefore.total_columns} split`
                            : `${profileBefore.total_columns - profileAfter.total_columns} dropped`}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ── Tabbed panel ── */}
            <div className="rounded-xl border border-edge bg-panel overflow-hidden">

              {/* Tab bar */}
              <div className="flex overflow-x-auto border-b border-edge">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex items-center gap-2 px-5 py-3 text-sm font-medium whitespace-nowrap transition-colors border-b-2 -mb-px ${
                      activeTab === tab.id
                        ? "border-accent text-accent bg-accent/5"
                        : "border-transparent text-app-muted hover:text-app-text"
                    }`}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* ── Tab: Inline Diff ── */}
              {activeTab === "diff" && previewBefore && previewAfter && (
                <div className="p-5">
                  <UnifiedDiffTable
                    before={previewBefore}
                    after={previewAfter}
                    colsBefore={colsBefore}
                    colsAfter={colsAfter}
                  />

                </div>
              )}

              {/* ── Tab: Analysis Log ── */}
              {activeTab === "log" && (
                <div className="p-5">
                  <p className="text-xs text-app-muted mb-5">
                    {report.row_count_before.toLocaleString()} rows in &nbsp;→&nbsp; {report.row_count_after.toLocaleString()} rows out &nbsp;·&nbsp; {report.fixes.length} operations
                  </p>
                  {report.fixes.length === 0 ? (
                    <p className="text-sm text-app-subtle text-center py-12">No issues found — dataset was already clean.</p>
                  ) : (
                    <div className="space-y-6">
                      {Object.entries(fixesByCategory).map(([cat, fixes]) => {
                        const meta = CAT_META[cat] ?? { color: "text-app-muted", label: cat };
                        return (
                          <div key={cat}>
                            <h3 className={`text-xs font-bold uppercase tracking-widest ${meta.color} mb-3 flex items-center gap-2`}>
                              <span className={`w-1.5 h-1.5 rounded-full bg-current inline-block`} />
                              {meta.label} <span className="text-app-subtle font-normal">({fixes.length})</span>
                            </h3>
                            <div className="space-y-2">
                              {fixes.map((f, i) => (
                                <div key={i} className="rounded-lg border border-edge bg-void/40 p-3.5">
                                  <div className="flex items-start justify-between gap-3 mb-2">
                                    <div className="flex-1 min-w-0">
                                      <p className="text-sm text-app-text font-medium">{f.what_was_wrong}</p>
                                      <p className="text-xs text-app-muted mt-1">Fix: {f.what_was_fixed}</p>
                                      <p className="text-xs text-app-subtle mt-0.5">Why: {f.why}</p>
                                    </div>
                                    <div className="text-right flex-shrink-0 space-y-0.5">
                                      <div className={`text-xs font-semibold font-mono ${meta.color}`}>{Math.round(f.confidence * 100)}%</div>
                                      {f.rows_affected != null && (
                                        <div className="text-[10px] text-app-subtle">{f.rows_affected.toLocaleString()} rows</div>
                                      )}
                                    </div>
                                  </div>
                                  <div className="h-0.5 rounded-full bg-edge/60 overflow-hidden">
                                    <div className="h-full rounded-full bg-accent/50 transition-all duration-700"
                                      style={{ width: `${Math.round(f.confidence * 100)}%` }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* ── Tab: Guardrails ── */}
              {activeTab === "guardrails" && (
                <div className="p-5 space-y-4">
                  <div className="rounded-lg border border-edge bg-void/40 p-3">
                    <p className="text-xs text-app-muted">
                      Confidence threshold: <span className="text-app-text font-mono">{(report.guardrails?.min_transform_confidence ?? 0).toFixed(2)}</span>
                    </p>
                    <p className="text-xs text-app-muted mt-1">
                      Blocked transform steps: <span className="text-emerald-300 font-semibold">{report.guardrails?.blocked_steps_count ?? 0}</span>
                    </p>
                    <p className="text-xs text-app-muted mt-1">
                      Schema validation issues: <span className="text-cyan-300 font-semibold">{report.schema_validation?.issues_count ?? 0}</span>
                    </p>
                  </div>
                  {((report.guardrails?.blocked_steps_count ?? 0) === 0) && ((report.schema_validation?.issues_count ?? 0) === 0) ? (
                    <p className="text-sm text-app-subtle">No guardrail blocks or schema issues were recorded.</p>
                  ) : (
                    <div className="space-y-3">
                      {(report.guardrails?.blocked_steps ?? []).map((s, i) => (
                        <div key={`${s}-${i}`} className="rounded-lg border border-emerald-400/25 bg-emerald-400/5 p-3">
                          <p className="text-sm text-emerald-300 font-medium">{s}</p>
                        </div>
                      ))}
                      {(report.schema_validation?.issues ?? []).map((issue, i) => (
                        <div key={`schema-${i}`} className="rounded-lg border border-cyan-400/25 bg-cyan-400/5 p-3">
                          <p className="text-sm text-cyan-200 font-medium">{issue.what_was_wrong}</p>
                          <p className="text-xs text-app-muted mt-1">Fix: {issue.what_was_fixed}</p>
                          <p className="text-xs text-app-subtle mt-0.5">Why: {issue.why}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* ── Tab: Column Health ── */}
              {activeTab === "colhealth" && (
                <div className="p-5">
                  <p className="text-xs text-app-subtle mb-4">
                    Per-column health after cleaning —{" "}
                    <span className="text-accent font-semibold">■ improved</span> ·{" "}
                    <span className="text-danger font-semibold">■ issues remain</span> ·{" "}
                    <span className="text-app-subtle">■ no change</span>
                  </p>
                  <ColumnHealthGrid
                    profileBefore={profileBefore}
                    profileAfter={profileAfter}
                    fixes={report?.fixes ?? []}
                  />
                </div>
              )}

              {/* ── Tab: Export ── */}
              {activeTab === "export" && (
                <div className="p-6">
                  <h3 className="text-sm font-semibold text-app-text mb-1">Download Cleaned Dataset</h3>
                  <p className="text-xs text-app-muted mb-6">
                    {report.row_count_after.toLocaleString()} rows · choose your format below
                  </p>
                  <div className="grid sm:grid-cols-3 gap-4">
                    {exportsMap && Object.keys(exportsMap).map((fmt) => (
                      <button
                        key={fmt}
                        onClick={() => downloadFmt(fmt)}
                        className="flex flex-col items-center gap-2.5 p-5 rounded-xl border border-edge bg-void/40 hover:border-accent/50 hover:bg-accent/5 transition-all group"
                      >
                        <Download className="w-6 h-6 text-app-muted group-hover:text-accent transition-colors" />
                        <span className="text-sm font-bold text-app-text">.{fmt.toUpperCase()}</span>
                        <span className="text-[10px] text-app-subtle text-center leading-relaxed">
                          {fmt === "xlsx"
                            ? "Excel — recommended, preserves column types"
                            : fmt === "csv"
                            ? "CSV — universal plain-text format"
                            : "JSON — records array for APIs / code"}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* ── Tab: Objectives ── */}
              {activeTab === "objectives" && objectiveResults && (
                <div className="p-5 space-y-2">
                  {objectiveResults.map((result, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3.5 rounded-lg bg-void border border-edge">
                      <div className="flex items-start gap-3">
                        {result.passed
                          ? <CheckCircle className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
                          : <XCircle    className="w-4 h-4 text-danger flex-shrink-0 mt-0.5" />}
                        <div>
                          <p className="text-sm font-medium text-app-text">{result.objective_name}</p>
                          <p className="text-xs text-app-muted mt-0.5">{result.message}</p>
                        </div>
                      </div>
                      <div className={`text-sm font-semibold ${result.passed ? "text-accent" : "text-danger"}`}>
                        {result.result_value}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}

        {report && busyMode === null && exportsMap && qualityBefore != null && qualityAfter != null && (
          <FloatingExportBar
            fixes={report.fixes.length}
            qualityBefore={qualityBefore}
            qualityAfter={qualityAfter}
            rowsAfter={report.row_count_after}
            onDownload={downloadFmt}
            formats={Object.keys(exportsMap)}
          />
        )}

      </Shell>
    </AuthGate>
  );
}
