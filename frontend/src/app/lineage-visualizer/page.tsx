"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached } from "@/lib/api";
import { GitBranch, Search, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface LineageEntry {
  id: number;
  operation: string;
  operation_details: string;
  input_columns: string;
  output_columns: string;
  rows_affected: number;
  created_at: string;
  source_dataset_id: string;
}

interface DatasetNode {
  id: string;
  filename: string;
  created_at: string;
  children: DatasetNode[];
}

export default function LineageVisualizerPage() {
  const [datasets, setDatasets] = useState<any[]>(
    () => getCached<{ items: any[] }>("/history")?.items ?? []
  );
  const [selectedDataset, setSelectedDataset] = useState<string>("");
  const [lineage, setLineage] = useState<LineageEntry[]>([]);
  const [fullLineage, setFullLineage] = useState<DatasetNode | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadDatasets();
  }, []);

  const loadDatasets = async () => {
    try {
      const data = await apiFetch("/history");
      setDatasets(data.items || []);
    } catch (error) {
      console.error("Failed to load datasets:", error);
    }
  };

  const loadLineage = async (datasetId: string) => {
    setLoading(true);
    try {
      const [lineageData, fullData] = await Promise.all([
        apiFetch(`/datasets/${datasetId}/lineage`),
        apiFetch(`/datasets/${datasetId}/lineage/full`),
      ]);
      setLineage(lineageData.lineage || []);
      setFullLineage(fullData.full_lineage || null);
    } catch (error) {
      console.error("Failed to load lineage:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleString();
  };

  const renderNode = (node: DatasetNode, level: number = 0) => {
    const indent = level * 24;
    return (
      <div key={node.id} className="ml-4">
        <div 
          className="flex items-center gap-2 p-2 rounded-lg bg-panel/40 border border-edge/40 hover:border-accent/50 cursor-pointer transition-all"
          style={{ marginLeft: `${indent}px` }}
          onClick={() => {
            setSelectedDataset(node.id);
            loadLineage(node.id);
          }}
        >
          <GitBranch className="w-4 h-4 text-accent" />
          <span className="text-sm text-app-text">{node.filename}</span>
          <span className="text-xs text-app-subtle">{formatDate(node.created_at)}</span>
        </div>
        {node.children && node.children.map(child => renderNode(child, level + 1))}
      </div>
    );
  };

  return (
    <AuthGate>
      <Shell>
        <div className="mb-6 animate-fade-in-down">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
            <GitBranch className="w-3 h-3" />
            <span>Lineage</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Data Lineage Visualizer</span></h1>
          <p className="text-sm text-app-muted mt-1">Visualize dataset relationships and transformation history</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-4">
            <div className="glass-card rounded-xl p-4">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-3">Select Dataset</h3>
              <div className="space-y-2">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-app-subtle" />
                  <select
                    value={selectedDataset}
                    onChange={(e) => {
                      setSelectedDataset(e.target.value);
                      if (e.target.value) loadLineage(e.target.value);
                    }}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg pl-10 pr-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                  >
                    <option value="">Choose a dataset...</option>
                    {datasets.map((d) => (
                      <option key={d.id} value={d.id}>{d.original_filename}</option>
                    ))}
                  </select>
                </div>
                <Button
                  onClick={() => selectedDataset && loadLineage(selectedDataset)}
                  disabled={!selectedDataset}
                  variant="secondary"
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-accent/20 text-accent border border-accent/30 text-sm hover:bg-accent/30"
                >
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </Button>
              </div>
            </div>

            {fullLineage && (
              <div className="glass-card rounded-xl p-4">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-3">Lineage Tree</h3>
                <div className="max-h-96 overflow-y-auto">
                  {renderNode(fullLineage)}
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-2 space-y-4">
            {selectedDataset ? (
              <>
                {loading ? (
                  <div className="glass-card rounded-xl p-8 text-center space-y-3">
                    <RefreshCw className="w-8 h-8 text-app-subtle mx-auto animate-spin" />
                    <p className="text-app-muted text-sm">Loading lineage data...</p>
                  </div>
                ) : lineage.length > 0 ? (
                  <div className="glass-card rounded-xl p-4">
                    <h3 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-3">Transformation History</h3>
                    <div className="space-y-3">
                      {lineage.map((entry) => (
                        <div key={entry.id} className="p-4 rounded-lg bg-panel/40 border border-edge/40">
                          <div className="flex items-start justify-between mb-2">
                            <div>
                              <div className="flex items-center gap-2">
                                <GitBranch className="w-4 h-4 text-accent" />
                                <span className="font-medium text-app-text">{entry.operation}</span>
                              </div>
                              <p className="text-xs text-app-subtle mt-1">{formatDate(entry.created_at)}</p>
                            </div>
                            {entry.rows_affected && (
                              <span className="text-xs text-app-muted">{entry.rows_affected} rows affected</span>
                            )}
                          </div>
                          {entry.operation_details && (
                            <p className="text-sm text-app-muted mb-2">{entry.operation_details}</p>
                          )}
                          <div className="grid grid-cols-2 gap-2 mt-3">
                            {entry.input_columns && (
                              <div>
                                <div className="text-xs text-app-subtle">Input Columns</div>
                                <div className="text-xs text-app-muted font-mono">{entry.input_columns}</div>
                              </div>
                            )}
                            {entry.output_columns && (
                              <div>
                                <div className="text-xs text-app-subtle">Output Columns</div>
                                <div className="text-xs text-app-muted font-mono">{entry.output_columns}</div>
                              </div>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="glass-card rounded-xl p-10 text-center space-y-3">
                    <div className="w-12 h-12 rounded-2xl bg-edge/30 flex items-center justify-center mx-auto">
                      <GitBranch className="w-6 h-6 text-app-subtle" />
                    </div>
                    <h3 className="text-base font-semibold text-app-text">No lineage data</h3>
                    <p className="text-sm text-app-muted">This dataset has no transformation history yet</p>
                  </div>
                )}
              </>
            ) : (
              <div className="glass-card rounded-xl p-10 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-edge/30 flex items-center justify-center mx-auto">
                  <GitBranch className="w-6 h-6 text-app-subtle" />
                </div>
                <h3 className="text-base font-semibold text-app-text">No dataset selected</h3>
                <p className="text-sm text-app-muted">Select a dataset to view its lineage</p>
              </div>
            )}
          </div>
        </div>
      </Shell>
    </AuthGate>
  );
}
