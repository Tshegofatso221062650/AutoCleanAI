"use client";

import { useState, useEffect, useCallback } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached } from "@/lib/api";
import { Plus, Trash2, Play, Loader2, CheckCircle, ChevronRight, Columns, Sparkles, FileWarning } from "lucide-react";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";

const AGG_FNS = ["sum", "mean", "count", "min", "max", "first", "last", "std", "median"];
const FILTER_OPS = [
  { value: "eq", label: "= equals" },
  { value: "ne", label: "≠ not equals" },
  { value: "gt", label: "> greater than" },
  { value: "gte", label: "≥ at least" },
  { value: "lt", label: "< less than" },
  { value: "lte", label: "≤ at most" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "not contains" },
  { value: "is_null", label: "is empty" },
  { value: "not_null", label: "is not empty" },
];

const inputCls = "w-full px-3 py-2 rounded-lg bg-[var(--app-input-bg)] border border-edge/40 text-app-text placeholder:text-app-subtle focus:outline-none focus:ring-2 focus:ring-accent/40 text-sm";
const selectCls = "w-full px-3 py-2 rounded-lg bg-[var(--app-input-bg)] border border-edge/40 text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40 text-sm";
const labelCls = "block text-xs text-app-muted mb-1";

function ColSelect({ cols, value, onChange, placeholder = "Select column…" }: {
  cols: string[]; value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={selectCls}>
      <option value="">{placeholder}</option>
      {cols.map((c) => <option key={c} value={c}>{c}</option>)}
    </select>
  );
}

function MultiColSelect({ cols, selected, onChange, label }: {
  cols: string[]; selected: string[]; onChange: (v: string[]) => void; label: string;
}) {
  const toggle = (col: string) =>
    onChange(selected.includes(col) ? selected.filter((c) => c !== col) : [...selected, col]);
  return (
    <div>
      <p className={labelCls}>{label}</p>
      <div className="flex flex-wrap gap-2 p-3 rounded-lg bg-panel border border-edge/30 min-h-[44px]">
        {cols.map((col) => (
          <button key={col} type="button" onClick={() => toggle(col)}
                className={`px-2 py-1 rounded text-xs font-mono transition-all border ${
              selected.includes(col)
                ? "bg-accent/20 border-accent text-accent"
                : "bg-panel/50 border-edge/30 text-app-muted hover:border-accent/50 hover:text-app-text"
            }`}>
            {col}
          </button>
        ))}
      </div>
      {selected.length > 0 && (
        <p className="text-xs text-app-subtle mt-1">Selected: {selected.join(", ")}</p>
      )}
    </div>
  );
}

function StepConfig({ step, index, cols, updateStep }: {
  step: TransformationStep; index: number; cols: string[];
  updateStep: (i: number, u: Partial<TransformationStep>) => void;
}) {
  if (cols.length === 0) {
    return <p className="text-xs text-app-muted italic">Select a dataset above to configure this step.</p>;
  }

  if (step.type === "filter") {
    const noVal = step.operator === "is_null" || step.operator === "not_null";
    return (
      <div className="grid sm:grid-cols-3 gap-3">
        <div><p className={labelCls}>Column</p>
          <ColSelect cols={cols} value={step.column || ""} onChange={(v) => updateStep(index, { column: v })} /></div>
        <div><p className={labelCls}>Operator</p>
          <select value={step.operator || "eq"} onChange={(e) => updateStep(index, { operator: e.target.value })} className={selectCls}>
            {FILTER_OPS.map((op) => <option key={op.value} value={op.value}>{op.label}</option>)}
          </select></div>
        {!noVal && <div><p className={labelCls}>Value</p>
          <input type="text" placeholder="e.g. 100" value={step.value ?? ""} onChange={(e) => updateStep(index, { value: e.target.value })} className={inputCls} /></div>}
      </div>
    );
  }

  if (step.type === "aggregate") {
    const groupBy: string[] = step.group_by || [];
    const aggCols = cols.filter((c) => !groupBy.includes(c));
    const aggs: Record<string, string> = step.aggregations || {};
    return (
      <div className="space-y-4">
        <MultiColSelect cols={cols} selected={groupBy} onChange={(v) => updateStep(index, { group_by: v })} label="Group by columns" />
        {aggCols.length > 0 && (<div>
          <p className={labelCls}>Aggregate remaining columns</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {aggCols.map((col) => (
              <div key={col} className="flex items-center gap-2 p-2 rounded-lg bg-panel/30 border border-edge/20">
                <span className="text-xs font-mono text-app-muted flex-1 truncate">{col}</span>
                <select value={aggs[col] || ""} onChange={(e) => updateStep(index, { aggregations: { ...aggs, [col]: e.target.value || undefined } })}
                  className="px-2 py-1 rounded bg-panel border border-edge/30 text-app-text text-xs focus:outline-none focus:ring-1 focus:ring-accent/40">
                  <option value="">— skip —</option>
                  {AGG_FNS.map((fn) => <option key={fn} value={fn}>{fn}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>)}
      </div>
    );
  }

  if (step.type === "pivot") {
    return (
      <div className="grid sm:grid-cols-3 gap-3">
        <div><p className={labelCls}>Index column (rows)</p><ColSelect cols={cols} value={step.index || ""} onChange={(v) => updateStep(index, { index: v })} /></div>
        <div><p className={labelCls}>Columns (pivot header)</p><ColSelect cols={cols} value={step.columns || ""} onChange={(v) => updateStep(index, { columns: v })} /></div>
        <div><p className={labelCls}>Values column</p><ColSelect cols={cols} value={step.values || ""} onChange={(v) => updateStep(index, { values: v })} /></div>
      </div>
    );
  }

  if (step.type === "melt") {
    return (
      <div className="space-y-4">
        <MultiColSelect cols={cols} selected={step.id_vars || []} onChange={(v) => updateStep(index, { id_vars: v })} label="ID columns (kept as-is)" />
        <MultiColSelect cols={cols.filter((c) => !(step.id_vars || []).includes(c))} selected={step.value_vars || []} onChange={(v) => updateStep(index, { value_vars: v })} label="Value columns to melt (blank = all non-ID)" />
      </div>
    );
  }

  if (step.type === "sort") {
    return (
      <div className="space-y-3">
        <MultiColSelect cols={cols} selected={step.sort_by || []} onChange={(v) => updateStep(index, { sort_by: v })} label="Sort by columns (in priority order)" />
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={step.ascending !== false} onChange={(e) => updateStep(index, { ascending: e.target.checked })} className="accent-accent" />
          <span className="text-xs text-app-muted">Ascending order</span>
        </label>
      </div>
    );
  }

  if (step.type === "derive") {
    return (
      <div className="space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div><p className={labelCls}>New column name</p>
            <input type="text" placeholder="e.g. total_value" value={step.column_name || ""} onChange={(e) => updateStep(index, { column_name: e.target.value })} className={inputCls} /></div>
          <div><p className={labelCls}>Expression</p>
            <input type="text" placeholder="e.g. price * quantity" value={step.expression || ""} onChange={(e) => updateStep(index, { expression: e.target.value })} className={inputCls} /></div>
        </div>
        <div>
          <p className={labelCls}>Click a column name to insert it into the expression</p>
          <div className="flex flex-wrap gap-2">
            {cols.map((col) => (
              <button key={col} type="button"
                onClick={() => updateStep(index, { expression: (step.expression || "") + (step.expression ? " " : "") + col })}
                className="px-2 py-1 rounded text-xs font-mono bg-panel/50 border border-edge/30 text-app-muted hover:border-accent/50 hover:text-app-text transition-all">
                {col}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (step.type === "bin") {
    return (
      <div className="grid sm:grid-cols-2 gap-3">
        <div><p className={labelCls}>Column to bin</p><ColSelect cols={cols} value={step.column || ""} onChange={(v) => updateStep(index, { column: v })} /></div>
        <div><p className={labelCls}>Number of bins</p><input type="number" min={2} placeholder="e.g. 5" value={step.bins || ""} onChange={(e) => updateStep(index, { bins: parseInt(e.target.value) || undefined })} className={inputCls} /></div>
      </div>
    );
  }

  if (step.type === "normalize") {
    return (
      <div className="grid sm:grid-cols-2 gap-3">
        <div><p className={labelCls}>Column to normalize</p><ColSelect cols={cols} value={step.column || ""} onChange={(v) => updateStep(index, { column: v })} /></div>
        <div><p className={labelCls}>Method</p>
          <select value={step.method || "minmax"} onChange={(e) => updateStep(index, { method: e.target.value })} className={selectCls}>
            <option value="minmax">Min-Max (scale to 0–1)</option>
            <option value="zscore">Z-Score (mean=0, std=1)</option>
          </select></div>
      </div>
    );
  }

  return null;
}

interface Dataset {
  id: string;
  original_filename: string;
  row_count: number;
  col_count: number;
  last_cleaned_at?: string | null;
}

interface TransformationStep {
  type: string;
  [key: string]: any;
}

const STEP_TYPES = [
  { type: "filter",    desc: "Keep rows matching a condition" },
  { type: "aggregate", desc: "Group & summarise" },
  { type: "pivot",     desc: "Reshape wide → tall" },
  { type: "melt",      desc: "Reshape tall → wide" },
  { type: "sort",      desc: "Order rows" },
  { type: "derive",    desc: "Create a computed column" },
  { type: "bin",       desc: "Bucket a numeric column" },
  { type: "normalize", desc: "Scale column values" },
];

export default function TransformPage() {
  const [datasets, setDatasets]           = useState<Dataset[]>(
    () => getCached<{ items: Dataset[] }>("/history")?.items ?? []
  );
  const [selectedDataset, setSelectedDataset] = useState<string | null>(null);
  const [columns, setColumns]             = useState<string[]>([]);
  const [columnsLoading, setColumnsLoading] = useState(false);
  const [pipeline, setPipeline]           = useState<TransformationStep[]>([]);
  const [loading, setLoading]             = useState(false);
  const [result, setResult]               = useState<any>(null);
  const [useCleaned, setUseCleaned]       = useState(true);

  useEffect(() => { fetchDatasets(); }, []);

  const fetchDatasets = async () => {
    try {
      const data = await apiFetch("/history");
      setDatasets(data.items || []);
    } catch (error) {
      console.error("Failed to fetch datasets:", error);
    }
  };

  const selectDataset = useCallback(async (id: string) => {
    setSelectedDataset(id);
    setColumns([]);
    setPipeline([]);
    setResult(null);
    setColumnsLoading(true);
    try {
      const data = await apiFetch(`/datasets/${id}/rows?page=1&page_size=1`);
      setColumns(data.columns || []);
    } catch {
      showToast("Could not load column names for this dataset", "error");
    } finally {
      setColumnsLoading(false);
    }
  }, []);

  const addStep    = (type: string) => setPipeline((p) => [...p, { type }]);
  const removeStep = (i: number)    => setPipeline((p) => p.filter((_, idx) => idx !== i));
  const updateStep = (i: number, updates: Partial<TransformationStep>) =>
    setPipeline((p) => p.map((s, idx) => idx === i ? { ...s, ...updates } : s));

  const executePipeline = async () => {
    if (!selectedDataset || pipeline.length === 0) return;
    setLoading(true);
    try {
      const data = await apiFetch("/transform", {
        method: "POST",
        body: JSON.stringify({ dataset_id: selectedDataset, pipeline, use_cleaned: useCleaned }),
      });
      setResult(data);
      const src = data.data_source === "cleaned" ? "cleaned data" : "raw data";
      showToast(`Transformation complete — applied to ${src}`, "success", 5000);
    } catch {
      showToast("Transformation failed", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthGate>
      <Shell>
        <div className="max-w-5xl mx-auto space-y-6">
          <div className="animate-fade-in-down">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
              <Play className="w-3 h-3" />
              <span>Transform</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Data Transformation</span></h1>
            <p className="text-sm text-app-muted mt-1">
              Select a dataset — column names load automatically for every step.
            </p>
          </div>

          {/* Step 1 — Dataset */}
          <div className="glass-card rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-app-subtle uppercase tracking-wide mb-4">1 · Choose dataset</h3>
            {datasets.length === 0 ? (
              <p className="text-sm text-app-muted">No datasets yet. <a href="/upload" className="text-accent hover:underline">Upload one first.</a></p>
            ) : (
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {datasets.map((ds) => (
                  <button
                    key={ds.id}
                    type="button"
                    onClick={() => selectDataset(ds.id)}
                    className={`p-4 rounded-xl border text-left transition-all ${
                      selectedDataset === ds.id
                        ? "border-accent bg-accent/10 ring-1 ring-accent/30"
                        : "border-edge/30 bg-panel/20 hover:border-accent/50 hover:bg-panel/40"
                    }`}
                  >
                    <div className="font-medium text-app-text text-sm truncate">{ds.original_filename}</div>
                    <div className="text-xs text-app-subtle mt-1">
                      {ds.row_count?.toLocaleString()} rows · {ds.col_count} cols
                    </div>
                    <div className="mt-1.5">
                      {ds.last_cleaned_at ? (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent font-medium">
                          <Sparkles className="w-2.5 h-2.5" /> Cleaned
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-amber-500/10 text-amber-400 font-medium">
                          <FileWarning className="w-2.5 h-2.5" /> Raw only
                        </span>
                      )}
                    </div>
                    {selectedDataset === ds.id && (
                      <div className="mt-2 flex items-center gap-1.5">
                        {columnsLoading
                          ? <><Loader2 className="w-3 h-3 text-accent animate-spin" /><span className="text-xs text-accent">Loading columns…</span></>
                          : <><Columns className="w-3 h-3 text-accent" /><span className="text-xs text-accent">{columns.length} columns ready</span></>
                        }
                      </div>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Column preview bar */}
          {columns.length > 0 && (
            <div className="rounded-xl border border-edge/20 bg-panel/20 px-4 py-3">
              <p className="text-xs text-app-muted mb-2 font-semibold uppercase tracking-wide">Available columns</p>
              <div className="flex flex-wrap gap-2">
                {columns.map((c) => (
                  <span key={c} className="px-2 py-0.5 rounded bg-panel border border-edge/30 text-xs font-mono text-app-muted">{c}</span>
                ))}
              </div>
            </div>
          )}

          {/* Step 2 — Add steps */}
          {selectedDataset && (
            <div className="glass-card rounded-2xl p-6">
              <h3 className="text-sm font-semibold text-app-subtle uppercase tracking-wide mb-4">2 · Add transformation steps</h3>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                {STEP_TYPES.map(({ type, desc }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => addStep(type)}
                    disabled={columnsLoading}
                    className="flex flex-col gap-1 p-3 rounded-xl border border-edge/30 bg-panel/20 hover:bg-accent/10 hover:border-accent/50 transition-all text-left disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <div className="flex items-center gap-2">
                      <Plus className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                      <span className="text-sm font-medium text-app-text capitalize">{type}</span>
                    </div>
                    <span className="text-xs text-app-subtle pl-5">{desc}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 3 — Configure & run */}
          {pipeline.length > 0 && (
            <div className="glass-card rounded-2xl p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-app-subtle uppercase tracking-wide">3 · Configure &amp; run</h3>
                <Button
                  onClick={executePipeline}
                  disabled={loading || !selectedDataset || columnsLoading}
                  variant="primary"
                  className="flex items-center gap-2 px-4 py-2 rounded-lg"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
                  Run pipeline
                </Button>
              </div>
              <div className="space-y-4">
                {pipeline.map((step, index) => (
                  <div key={index} className="rounded-xl border border-edge/30 bg-panel/20 overflow-hidden">
                    <div className="flex items-center justify-between px-4 py-3 border-b border-edge/20">
                      <div className="flex items-center gap-3">
                        <span className="w-6 h-6 rounded-md bg-accent/15 flex items-center justify-center text-accent text-xs font-bold">{index + 1}</span>
                        <ChevronRight className="w-3.5 h-3.5 text-app-subtle" />
                        <span className="font-semibold text-app-text text-sm capitalize">{step.type}</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => removeStep(index)}
                        className="p-1.5 rounded-lg text-app-subtle hover:text-danger hover:bg-danger/10 transition-colors"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="p-4">
                      <StepConfig step={step} index={index} cols={columns} updateStep={updateStep} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* use_cleaned toggle */}
          {selectedDataset && (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl border border-edge/30 bg-panel/20">
              <button
                type="button"
                onClick={() => setUseCleaned((v) => !v)}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                  useCleaned ? "bg-accent" : "bg-edge/40"
                }`}
              >
                <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                  useCleaned ? "translate-x-4" : "translate-x-0"
                }`} />
              </button>
              <div>
                <p className="text-sm text-app-text font-medium">
                  {useCleaned ? "Using cleaned data" : "Using raw data"}
                </p>
                <p className="text-xs text-app-muted">
                  {useCleaned
                    ? "Transform will use the cleaned export if one exists, otherwise falls back to the original."
                    : "Transform will always use the original uploaded file."}
                </p>
              </div>
            </div>
          )}

          {/* Result */}
          {result && (
            <div className="rounded-2xl border border-accent/30 bg-accent/5 p-6">
              <div className="flex items-center gap-3 mb-4">
                <CheckCircle className="w-5 h-5 text-accent" />
                <h3 className="text-sm font-semibold text-app-text">Transformation complete</h3>
                {result.data_source && (
                  <span className={`ml-auto text-[11px] px-2 py-0.5 rounded-full font-medium ${
                    result.data_source === "cleaned"
                      ? "bg-accent/15 text-accent"
                      : "bg-amber-500/10 text-amber-400"
                  }`}>
                    {result.data_source === "cleaned" ? "✦ Applied to cleaned data" : "⚠ Applied to raw data"}
                  </span>
                )}
              </div>
              <div className="grid sm:grid-cols-3 gap-4">
                <div className="p-4 rounded-xl bg-panel/30 border border-edge/20">
                  <p className="text-xs text-app-muted">New Dataset ID</p>
                  <p className="text-sm font-mono text-app-text mt-1 truncate">{result.transformed_dataset_id}</p>
                </div>
                <div className="p-4 rounded-xl bg-panel/30 border border-edge/20">
                  <p className="text-xs text-app-muted">Rows</p>
                  <p className="text-xl font-bold text-accent mt-1">{result.row_count?.toLocaleString()}</p>
                </div>
                <div className="p-4 rounded-xl bg-panel/30 border border-edge/20">
                  <p className="text-xs text-app-muted">Columns</p>
                  <p className="text-xl font-bold text-accent mt-1">{result.column_count}</p>
                </div>
              </div>
              <div className="mt-4">
                <a href={`/analysis/${result.transformed_dataset_id}`} className="inline-flex items-center gap-2 text-sm text-accent hover:underline">
                  View in Analysis →
                </a>
              </div>
            </div>
          )}
        </div>
      </Shell>
    </AuthGate>
  );
}
