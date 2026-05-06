"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached } from "@/lib/api";
import { GitCompare, ArrowRight, AlertTriangle, FileText, CheckCircle, TrendingUp, TrendingDown } from "lucide-react";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";

interface Dataset {
  id: string;
  original_filename: string;
  row_count: number | null;
  col_count: number | null;
  quality_score: number | null;
}

interface ColumnStat {
  column: string;
  missing_pct_1: number;
  missing_pct_2: number;
  mean_1?: number;
  mean_2?: number;
  std_1?: number;
  std_2?: number;
}

interface ComparisonResult {
  id: number;
  dataset1_name: string;
  dataset2_name: string;
  dataset1_quality: number | null;
  dataset2_quality: number | null;
  comparison: {
    row_count_1: number;
    row_count_2: number;
    row_count_diff: number;
    col_count_1: number;
    col_count_2: number;
    columns_only_in_1: string[];
    columns_only_in_2: string[];
    type_changes: { column: string; type1: string; type2: string }[];
    column_stats: ColumnStat[];
    duplicate_count_1: number;
    duplicate_count_2: number;
    schema_identical: boolean;
  };
}

export default function ComparisonPage() {
  const searchParams = useSearchParams();
  const [datasets, setDatasets] = useState<Dataset[]>(
    () => getCached<{ items: Dataset[] }>("/history")?.items ?? []
  );
  const [dataset1, setDataset1] = useState<string>("");
  const [dataset2, setDataset2] = useState<string>("");
  const [comparing, setComparing] = useState(false);
  const [result, setResult] = useState<ComparisonResult | null>(null);

  useEffect(() => {
    loadDatasets();
    const d1 = searchParams.get("d1");
    if (d1) setDataset1(d1);
  }, [searchParams]);

  const loadDatasets = async () => {
    try {
      const data = await apiFetch("/history");
      setDatasets(data.items || []);
    } catch (error) {
      console.error("Failed to load datasets:", error);
    }
  };

  const handleCompare = async () => {
    if (!dataset1 || !dataset2) {
      showToast("Please select two datasets to compare", "error");
      return;
    }
    if (dataset1 === dataset2) {
      showToast("Please select different datasets", "error");
      return;
    }

    setComparing(true);
    setResult(null);
    try {
      const data = await apiFetch("/comparison", {
        method: "POST",
        body: JSON.stringify({ dataset1_id: dataset1, dataset2_id: dataset2 }),
      });
      setResult(data as ComparisonResult);
      showToast("Comparison complete", "success");
    } catch (error) {
      console.error("Failed to compare:", error);
      showToast("Failed to compare datasets", "error");
    } finally {
      setComparing(false);
    }
  };

  const getDatasetName = (id: string) =>
    datasets.find(d => d.id === id)?.original_filename ?? "Unknown";

  const diffColor = (diff: number) =>
    diff > 0 ? "text-accent" : diff < 0 ? "text-danger" : "text-app-muted";

  return (
    <AuthGate>
      <Shell>
        <div className="mb-6 animate-fade-in-down">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
            <GitCompare className="w-3 h-3" />
            <span>Comparison</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Data Comparison Tool</span></h1>
          <p className="text-sm text-app-muted mt-1">Side-by-side diff between two datasets</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Selector panel */}
          <div className="lg:col-span-1 space-y-4">
            <div className="glass-card rounded-xl p-4">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-3">Select Datasets</h3>
              <div className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Dataset 1</label>
                  <select
                    value={dataset1}
                    onChange={(e) => { setDataset1(e.target.value); setResult(null); }}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                  >
                    <option value="">Select first dataset...</option>
                    {datasets.map((d) => (
                      <option key={d.id} value={d.id}>{d.original_filename}</option>
                    ))}
                  </select>
                </div>

                <div className="flex justify-center">
                  <ArrowRight className="w-5 h-5 text-app-subtle" />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Dataset 2</label>
                  <select
                    value={dataset2}
                    onChange={(e) => { setDataset2(e.target.value); setResult(null); }}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                  >
                    <option value="">Select second dataset...</option>
                    {datasets.map((d) => (
                      <option key={d.id} value={d.id}>{d.original_filename}</option>
                    ))}
                  </select>
                </div>

                <Button
                  onClick={handleCompare}
                  disabled={comparing || !dataset1 || !dataset2}
                  variant="primary"
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm"
                >
                  <GitCompare className="w-4 h-4" />
                  {comparing ? "Comparing..." : "Compare Datasets"}
                </Button>
              </div>
            </div>
          </div>

          {/* Results panel */}
          <div className="lg:col-span-2 space-y-4">
            {result ? (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: result.dataset1_name, rows: result.comparison.row_count_1, cols: result.comparison.col_count_1, dups: result.comparison.duplicate_count_1, quality: result.dataset1_quality, accent: "text-accent2" },
                    { label: result.dataset2_name, rows: result.comparison.row_count_2, cols: result.comparison.col_count_2, dups: result.comparison.duplicate_count_2, quality: result.dataset2_quality, accent: "text-accent" },
                  ].map((d, i) => (
                    <div key={i} className="glass-card rounded-xl p-4">
                      <div className={`flex items-center gap-2 mb-3 ${d.accent}`}>
                        <FileText className="w-4 h-4" />
                        <span className="text-sm font-medium text-app-text truncate">{d.label}</span>
                      </div>
                      <div className="space-y-1 text-xs">
                        <div className="flex justify-between"><span className="text-app-subtle">Rows</span><span className="text-app-muted">{d.rows.toLocaleString()}</span></div>
                        <div className="flex justify-between"><span className="text-app-subtle">Columns</span><span className="text-app-muted">{d.cols}</span></div>
                        <div className="flex justify-between"><span className="text-app-subtle">Duplicates</span><span className="text-app-muted">{d.dups}</span></div>
                        {d.quality != null && <div className="flex justify-between"><span className="text-app-subtle">Quality</span><span className="text-app-muted">{d.quality.toFixed(1)}%</span></div>}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Diff stats */}
                <div className="glass-card rounded-xl p-4">
                  <h3 className="text-sm font-semibold text-app-text mb-3">Differences</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs mb-4">
                    <div className="p-3 rounded-lg bg-panel/40 border border-edge/40">
                      <div className="text-app-subtle mb-1">Row Δ</div>
                      <div className={`text-lg font-bold ${diffColor(result.comparison.row_count_diff)}`}>
                        {result.comparison.row_count_diff > 0 ? "+" : ""}{result.comparison.row_count_diff.toLocaleString()}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-panel/40 border border-edge/40">
                      <div className="text-app-subtle mb-1">Schema</div>
                      <div className="flex items-center gap-1 mt-1">
                        {result.comparison.schema_identical
                          ? <><CheckCircle className="w-4 h-4 text-accent" /><span className="text-accent font-medium">Identical</span></>
                          : <><AlertTriangle className="w-4 h-4 text-warn" /><span className="text-warn font-medium">Changed</span></>}
                      </div>
                    </div>
                    <div className="p-3 rounded-lg bg-panel/40 border border-edge/40">
                      <div className="text-app-subtle mb-1">Quality Δ</div>
                      {result.dataset1_quality != null && result.dataset2_quality != null ? (
                        <div className={`text-lg font-bold ${diffColor(result.dataset2_quality - result.dataset1_quality)}`}>
                          {(result.dataset2_quality - result.dataset1_quality) >= 0 ? "+" : ""}{(result.dataset2_quality - result.dataset1_quality).toFixed(1)}%
                        </div>
                      ) : <span className="text-app-subtle">N/A</span>}
                    </div>
                  </div>

                  {/* Schema changes */}
                  {(result.comparison.columns_only_in_1.length > 0 || result.comparison.columns_only_in_2.length > 0 || result.comparison.type_changes.length > 0) && (
                    <div className="space-y-2 mb-4">
                      {result.comparison.columns_only_in_1.length > 0 && (
                        <div className="p-2 rounded bg-danger/10 border border-danger/20 text-xs">
                          <span className="text-danger font-medium">Only in Dataset 1: </span>
                          <span className="text-app-muted">{result.comparison.columns_only_in_1.join(", ")}</span>
                        </div>
                      )}
                      {result.comparison.columns_only_in_2.length > 0 && (
                        <div className="p-2 rounded bg-accent/10 border border-accent/20 text-xs">
                          <span className="text-accent font-medium">Only in Dataset 2: </span>
                          <span className="text-app-muted">{result.comparison.columns_only_in_2.join(", ")}</span>
                        </div>
                      )}
                      {result.comparison.type_changes.map((tc, i) => (
                        <div key={i} className="p-2 rounded bg-warn/10 border border-warn/20 text-xs">
                          <span className="text-warn font-medium">{tc.column}: </span>
                          <span className="text-app-muted">{tc.type1}</span>
                          <span className="text-app-subtle mx-1">→</span>
                          <span className="text-app-muted">{tc.type2}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Column stats table */}
                  {result.comparison.column_stats.length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-edge/40">
                            <th className="p-2 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Column</th>
                            <th className="p-2 text-right text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Missing% D1</th>
                            <th className="p-2 text-right text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Missing% D2</th>
                            <th className="p-2 text-right text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Mean D1</th>
                            <th className="p-2 text-right text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Mean D2</th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.comparison.column_stats.map((stat) => {
                            const missingDiff = stat.missing_pct_2 - stat.missing_pct_1;
                            return (
                              <tr key={stat.column} className="border-t border-edge/20 hover:bg-panel/40">
                                <td className="p-2 text-app-text font-mono">{stat.column}</td>
                                <td className="p-2 text-right text-app-muted">{stat.missing_pct_1}%</td>
                                <td className={`p-2 text-right font-medium ${missingDiff > 0 ? "text-danger" : missingDiff < 0 ? "text-accent" : "text-app-muted"}`}>
                                  {stat.missing_pct_2}%
                                </td>
                                <td className="p-2 text-right text-app-muted">{stat.mean_1 ?? "—"}</td>
                                <td className="p-2 text-right text-app-muted">{stat.mean_2 ?? "—"}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="glass-card rounded-xl p-10 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-edge/30 flex items-center justify-center mx-auto">
                  <GitCompare className="w-6 h-6 text-app-subtle" />
                </div>
                <h3 className="text-base font-semibold text-app-text">
                  {dataset1 && dataset2 ? "Ready to compare" : "No datasets selected"}
                </h3>
                <p className="text-sm text-app-muted">
                  {dataset1 && dataset2
                    ? "Click \"Compare Datasets\" to generate a full diff report"
                    : "Select two datasets to compare their structure and content"}
                </p>
              </div>
            )}
          </div>
        </div>
      </Shell>
    </AuthGate>
  );
}
