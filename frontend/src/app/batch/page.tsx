"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached } from "@/lib/api";
import { showConfirm } from "@/lib/confirm";
import { Layers, Plus, Play, CheckCircle, XCircle, Clock, AlertTriangle, Loader2, Trash2 } from "lucide-react";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import { ModalPortal } from "@/components/ModalPortal";
import { PipelineNav } from "@/components/PipelineNav";

interface BatchOperation {
  id: number;
  name: string;
  operation_type: string;
  operation_config: string;
  status: string;
  total_datasets: number;
  completed_datasets: number;
  failed_datasets: number;
  created_by: string;
  created_at: string;
  completed_at: string | null;
  error_message: string | null;
}

export default function BatchPage() {
  const [batches, setBatches] = useState<BatchOperation[]>([]);
  const [datasets, setDatasets] = useState<any[]>(
    () => getCached<{ items: any[] }>("/history")?.items ?? []
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [loading, setLoading] = useState(
    () => getCached("/history") === null
  );
  const [runningId, setRunningId] = useState<number | null>(null);
  const [selectedDatasets, setSelectedDatasets] = useState<string[]>([]);
  
  const [formData, setFormData] = useState({
    name: "",
    operation_type: "clean",
    operation_config: {},
  });

  useEffect(() => {
    loadBatches();
    loadDatasets();
  }, []);

  const loadBatches = async () => {
    try {
      const data = await apiFetch("/batch");
      setBatches(data.batches || []);
    } catch (error) {
      console.error("Failed to load batch operations:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadDatasets = async () => {
    try {
      const data = await apiFetch("/history");
      setDatasets(data.items || []);
    } catch (error) {
      console.error("Failed to load datasets:", error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedDatasets.length === 0) {
      showToast("Please select at least one dataset", "error");
      return;
    }
    
    try {
      await apiFetch("/batch", {
        method: "POST",
        body: JSON.stringify({
          ...formData,
          dataset_ids: selectedDatasets,
        }),
      });
      showToast("Batch operation created successfully", "success");
      setShowCreateModal(false);
      setSelectedDatasets([]);
      setFormData({ name: "", operation_type: "clean", operation_config: {} });
      loadBatches();
    } catch (error) {
      console.error("Failed to create batch operation:", error);
      showToast("Failed to create batch operation", "error");
    }
  };

  const handleDelete = async (batchId: number) => {
    if (!await showConfirm("Delete this batch operation? This cannot be undone.")) return;
    try {
      await apiFetch(`/batch/${batchId}`, { method: "DELETE" });
      showToast("Batch operation deleted", "success");
      loadBatches();
    } catch (error) {
      showToast("Failed to delete batch operation", "error");
    }
  };

  const handleRun = async (batchId: number) => {
    setRunningId(batchId);
    try {
      const result = await apiFetch(`/batch/${batchId}/run`, { method: "POST" });
      showToast(`Batch complete — ${result.completed} succeeded, ${result.failed} failed`, result.failed === 0 ? "success" : "error");
      loadBatches();
    } catch (error) {
      console.error("Failed to run batch:", error);
      showToast("Failed to run batch operation", "error");
    } finally {
      setRunningId(null);
    }
  };

  const toggleDatasetSelection = (datasetId: string) => {
    setSelectedDatasets(prev => 
      prev.includes(datasetId) 
        ? prev.filter(id => id !== datasetId)
        : [...prev, datasetId]
    );
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: "bg-warn/15 text-warn",
      running: "bg-accent2/15 text-accent2",
      completed: "bg-accent/15 text-accent",
      failed: "bg-danger/15 text-danger",
    };
    return styles[status] || "bg-edge/30 text-app-muted";
  };

  if (loading) {
    return (
      <AuthGate>
        <Shell>
          <PipelineNav active="bulk" />
          <div className="space-y-6">
            <div className="h-16 skeleton rounded-2xl" />
            <div className="h-64 skeleton rounded-xl" />
          </div>
        </Shell>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <Shell>
        <PipelineNav active="bulk" />
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6 animate-fade-in-down">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
              <Layers className="w-3 h-3" />
              <span>Bulk Operations</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Bulk Processing</span></h1>
            <p className="text-sm text-app-muted mt-1">Select multiple datasets and run the same operation on all of them in one go</p>
          </div>
          <Button
            onClick={() => setShowCreateModal(true)}
            variant="primary"
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm"
          >
            <Plus className="w-4 h-4" />
            Create Batch
          </Button>
        </div>

        {batches.length === 0 ? (
          <div className="glass-card rounded-xl p-10 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-edge/30 flex items-center justify-center mx-auto">
              <Layers className="w-6 h-6 text-app-subtle" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-app-text mb-1">No bulk jobs yet</h3>
              <p className="text-sm text-app-muted max-w-sm mx-auto">
                Pick two or more datasets, choose an operation (clean, validate, export), and run them all at once — results tracked per dataset.
              </p>
            </div>
            <Button
              onClick={() => setShowCreateModal(true)}
              variant="primary"
              className="px-4 py-2 rounded-lg font-semibold text-sm"
            >
              Create First Batch
            </Button>
          </div>
        ) : (
          <div className="glass-card rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-edge/40">
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Name</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Type</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Progress</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Status</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Created</th>
                  <th className="p-4 text-right text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {batches.map((batch) => (
                  <tr key={batch.id} className="border-t border-edge/20 hover:bg-accent/5 transition-colors">
                    <td className="p-4">
                      <div className="font-medium text-app-text">{batch.name}</div>
                      {batch.error_message && (
                        <div className="text-xs text-danger mt-1">{batch.error_message}</div>
                      )}
                    </td>
                    <td className="p-4">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-accent2/10 text-accent2">
                        {batch.operation_type}
                      </span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 w-32 h-1.5 rounded-full bg-edge/60 overflow-hidden">
                          <div
                            className="h-full bg-accent rounded-full"
                            style={{ width: `${(batch.completed_datasets / batch.total_datasets) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs text-app-muted">
                          {batch.completed_datasets}/{batch.total_datasets}
                        </span>
                      </div>
                      {batch.failed_datasets > 0 && (
                        <div className="text-xs text-danger mt-1">{batch.failed_datasets} failed</div>
                      )}
                    </td>
                    <td className="p-4">
                      <span className={`px-2 py-1 rounded text-xs font-medium ${getStatusBadge(batch.status)}`}>
                        {batch.status}
                      </span>
                    </td>
                    <td className="p-4 text-xs text-app-subtle">
                      {new Date(batch.created_at).toLocaleString()}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        {batch.status === "pending" && (
                          <Button
                            onClick={() => handleRun(batch.id)}
                            disabled={runningId === batch.id}
                            variant="primary"
                            size="sm"
                            className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold"
                          >
                            {runningId === batch.id
                              ? <Loader2 className="w-3 h-3 animate-spin" />
                              : <Play className="w-3 h-3" />}
                            {runningId === batch.id ? "Running..." : "Run"}
                          </Button>
                        )}
                        {batch.status !== "running" && (
                          <button
                            type="button"
                            onClick={() => handleDelete(batch.id)}
                            className="p-1.5 rounded-lg text-app-subtle hover:text-danger hover:bg-danger/10 transition-colors"
                            title="Delete batch"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ModalPortal open={showCreateModal} onClose={() => setShowCreateModal(false)}>
            <div className="modal-card rounded-2xl p-6 w-full max-w-2xl max-h-[calc(100vh-2rem)] overflow-y-auto custom-scrollbar">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-base font-semibold text-app-text">Create Batch Operation</h2>
                <Button
                  onClick={() => setShowCreateModal(false)}
                  variant="ghost"
                  size="sm"
                  className="p-1 rounded text-app-muted hover:text-app-text"
                >
                  <XCircle className="w-5 h-5" />
                </Button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm text-app-muted mb-1">Batch Name</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                    placeholder="e.g., Clean All Customer Datasets"
                  />
                </div>
                
                <div>
                  <label className="block text-sm text-app-muted mb-1">Operation Type</label>
                  <select
                    value={formData.operation_type}
                    onChange={(e) => setFormData({ ...formData, operation_type: e.target.value })}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                  >
                    <option value="clean">Clean</option>
                    <option value="transform">Transform</option>
                    <option value="export">Export</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm text-app-muted mb-2">Select Datasets ({selectedDatasets.length} selected)</label>
                  <div className="max-h-48 overflow-y-auto border border-edge rounded-lg p-2 space-y-1">
                    {datasets.map((dataset) => (
                      <label key={dataset.id} className="flex items-center gap-2 p-2 rounded hover:bg-edge/50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedDatasets.includes(dataset.id)}
                          onChange={() => toggleDatasetSelection(dataset.id)}
                          className="rounded border-edge"
                        />
                        <span className="text-sm text-app-text">{dataset.original_filename}</span>
                        <span className="text-xs text-app-subtle ml-auto">{dataset.row_count || 0} rows</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 pt-4">
                  <Button
                    type="button"
                    onClick={() => setShowCreateModal(false)}
                    variant="ghost"
                    className="flex-1 px-4 py-2 rounded-lg border border-edge text-app-muted"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    className="flex-1 px-4 py-2 rounded-lg font-medium"
                  >
                    Create Batch
                  </Button>
                </div>
              </form>
            </div>
        </ModalPortal>
      </Shell>
    </AuthGate>
  );
}
