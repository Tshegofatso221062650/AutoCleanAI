"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch } from "@/lib/api";

interface LineageEntry {
  id: number;
  dataset_id: string;
  source_dataset_id: string | null;
  operation: string;
  operation_details: string | null;
  input_columns: string[] | null;
  output_columns: string[] | null;
  rows_affected: number | null;
  created_at: string;
  source_lineage?: LineageEntry[];
}

export default function LineagePage() {
  const params = { id: "default" };
  const datasetId = String(params.id);
  const [lineage, setLineage] = useState<LineageEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDatasetId, setSelectedDatasetId] = useState<string | null>(null);

  useEffect(() => {
    if (selectedDatasetId) {
      loadLineage(selectedDatasetId);
    }
  }, [selectedDatasetId]);

  const loadLineage = async (id: string) => {
    try {
      const data = await apiFetch(`/datasets/${id}/lineage/full`);
      setLineage(data.full_lineage || []);
    } catch (e) {
      console.error("Failed to load lineage:", e);
    } finally {
      setLoading(false);
    }
  };

  const renderLineageTree = (entries: LineageEntry[], depth: number = 0) => {
    return entries.map((entry, index) => (
      <div key={entry.id} className="ml-4">
        <div className="border-l-2 border-accent/30 pl-4 py-2">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-3 h-3 rounded-full bg-accent"></div>
            <span className="text-sm font-semibold text-app-text">{entry.operation}</span>
            <span className="text-xs text-app-subtle">
              {new Date(entry.created_at).toLocaleString()}
            </span>
          </div>
          <div className="text-xs text-app-muted mb-2">
            {entry.operation_details && JSON.parse(entry.operation_details || "{}").pipeline_name && (
              <span>Pipeline: {JSON.parse(entry.operation_details).pipeline_name}</span>
            )}
          </div>
          {entry.rows_affected && (
            <div className="text-xs text-app-subtle">
              Rows affected: {entry.rows_affected}
            </div>
          )}
          {entry.input_columns && (
            <div className="text-xs text-app-subtle mt-1">
              Input: {entry.input_columns.join(", ")}
            </div>
          )}
          {entry.output_columns && (
            <div className="text-xs text-app-subtle">
              Output: {entry.output_columns.join(", ")}
            </div>
          )}
          {entry.source_lineage && entry.source_lineage.length > 0 && (
            <div className="mt-2">
              <div className="text-xs text-app-subtle mb-1">Source operations:</div>
              {renderLineageTree(entry.source_lineage, depth + 1)}
            </div>
          )}
        </div>
      </div>
    ));
  };

  return (
    <AuthGate>
      <Shell>
        <div className="mb-6 animate-fade-in-down">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
            <span>Lineage</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Data Lineage</span></h1>
          <p className="text-sm text-app-muted mt-1">Track data flow through operations</p>
        </div>

        <div className="mb-6">
          <label className="block text-xs text-app-subtle font-semibold mb-2">Select Dataset:</label>
          <input
            type="text"
            value={selectedDatasetId || ""}
            onChange={(e) => setSelectedDatasetId(e.target.value)}
            placeholder="Enter dataset ID"
            className="bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-app-text w-full max-w-md focus:outline-none focus:ring-2 focus:ring-accent/40 text-sm"
          />
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : lineage.length === 0 ? (
          <div className="glass-card rounded-xl p-8 text-center">
            <p className="text-app-muted text-sm">No lineage data available for this dataset.</p>
            <p className="text-app-subtle text-xs mt-2">Enter a dataset ID above to view its data lineage.</p>
          </div>
        ) : (
          <div className="glass-card rounded-xl p-4">
            <h2 className="text-sm font-semibold text-app-subtle uppercase tracking-widest mb-4">Lineage Tree</h2>
            <div className="space-y-2">
              {renderLineageTree(lineage)}
            </div>
          </div>
        )}
      </Shell>
    </AuthGate>
  );
}
