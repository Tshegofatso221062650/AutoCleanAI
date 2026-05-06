"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached } from "@/lib/api";
import { GitBranch, Clock, FileText } from "lucide-react";

interface SchemaHistory {
  id: number;
  dataset_id: string;
  schema_snapshot: any;
  change_type: string;
  changed_at: string;
}

export default function SchemaEvolutionPage() {
  const [datasets, setDatasets] = useState<any[]>(
    () => getCached<{ items: any[] }>("/history")?.items ?? []
  );
  const [selectedDataset, setSelectedDataset] = useState("");
  const [history, setHistory] = useState<SchemaHistory[]>([]);
  const [loading, setLoading] = useState(
    () => getCached("/history") === null
  );

  useEffect(() => {
    loadDatasets();
  }, []);

  useEffect(() => {
    if (selectedDataset) {
      loadSchemaHistory(selectedDataset);
    }
  }, [selectedDataset]);

  const loadDatasets = async () => {
    try {
      const data = await apiFetch("/history");
      setDatasets(data.items || []);
    } catch (error) {
      console.error("Failed to load datasets:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadSchemaHistory = async (datasetId: string) => {
    try {
      const data = await apiFetch(`/schema/${datasetId}`);
      setHistory(data.history || []);
    } catch (error) {
      console.error("Failed to load schema history:", error);
    }
  };

  if (loading) {
    return (
      <AuthGate>
        <Shell>
          <div className="space-y-6">
            <div className="h-16 skeleton rounded-2xl" />
            <div className="grid lg:grid-cols-3 gap-6">
              <div className="h-20 skeleton rounded-xl" />
              <div className="lg:col-span-2 h-48 skeleton rounded-xl" />
            </div>
          </div>
        </Shell>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <Shell>
        <div className="mb-6 animate-fade-in-down">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
            <GitBranch className="w-3 h-3" />
            <span>Schema</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Schema Evolution Tracking</span></h1>
          <p className="text-sm text-app-muted mt-1">Track how data schemas change over time</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1">
            <div className="glass-card rounded-xl p-4">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-3">Select Dataset</h3>
              <select
                value={selectedDataset}
                onChange={(e) => setSelectedDataset(e.target.value)}
                className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <option value="">Choose a dataset...</option>
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>{d.original_filename}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="lg:col-span-2">
            {selectedDataset ? (
              <div className="glass-card rounded-xl overflow-hidden">
                <div className="p-4 border-b border-edge/40">
                  <h3 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle">Schema History</h3>
                </div>
                <div className="p-4">
                  {history.length === 0 ? (
                    <div className="text-center py-8 space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-edge/30 flex items-center justify-center mx-auto">
                        <GitBranch className="w-6 h-6 text-app-subtle" />
                      </div>
                      <h3 className="text-base font-semibold text-app-text">No schema history</h3>
                      <p className="text-sm text-app-muted">Schema changes will be tracked automatically</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {history.map((entry) => (
                        <div key={entry.id} className="p-4 rounded-lg bg-panel/40 border border-edge/40">
                          <div className="flex items-start gap-3 mb-2">
                            <div className="p-2 rounded-lg bg-accent/10">
                              <FileText className="w-4 h-4 text-accent" />
                            </div>
                            <div className="flex-1">
                              <div className="flex justify-between items-start">
                                <div>
                                  <div className="font-medium text-app-text">
                                    {entry.change_type || "Schema Snapshot"}
                                  </div>
                                  <div className="text-sm text-app-muted">
                                    {entry.schema_snapshot?.column_names?.length || 0} columns
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 text-xs text-app-subtle">
                                  <Clock className="w-3 h-3" />
                                  {new Date(entry.changed_at).toLocaleString()}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="glass-card rounded-xl p-10 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-edge/30 flex items-center justify-center mx-auto">
                  <GitBranch className="w-6 h-6 text-app-subtle" />
                </div>
                <h3 className="text-base font-semibold text-app-text">No dataset selected</h3>
                <p className="text-sm text-app-muted">Select a dataset to view its schema evolution</p>
              </div>
            )}
          </div>
        </div>
      </Shell>
    </AuthGate>
  );
}
