"use client";

import { useState, useEffect } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached } from "@/lib/api";
import { Merge, Plus, Database, Loader2, CheckCircle, AlertCircle } from "lucide-react";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";

interface Dataset {
  id: string;
  original_filename: string;
  row_count: number;
  col_count: number;
}

interface ConsolidationGroup {
  id: string;
  name: string;
  description: string | null;
  status: string;
  created_at: string;
}

export default function ConsolidationPage() {
  const [groups, setGroups] = useState<ConsolidationGroup[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>(
    () => getCached<{ items: Dataset[] }>("/history")?.items ?? []
  );
  const [selectedGroup, setSelectedGroup] = useState<string | null>(null);
  const [selectedDatasets, setSelectedDatasets] = useState<string[]>([]);
  const [newGroupName, setNewGroupName] = useState("");
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchGroups();
    fetchDatasets();
  }, []);

  const fetchGroups = async () => {
    try {
      const data = await apiFetch("/consolidation/groups");
      setGroups(data.groups);
    } catch (error) {
      console.error("Failed to fetch groups:", error);
    }
  };

  const fetchDatasets = async () => {
    try {
      const data = await apiFetch("/history");
      setDatasets(data.items || []);
    } catch (error) {
      console.error("Failed to fetch datasets:", error);
    }
  };

  const createGroup = async () => {
    if (!newGroupName.trim()) return;
    
    setLoading(true);
    try {
      const data = await apiFetch("/consolidation/groups", {
        method: "POST",
        body: JSON.stringify({ name: newGroupName, description: "" }),
      });
      setNewGroupName("");
      setShowCreateGroup(false);
      fetchGroups();
      setSelectedGroup(data.group_id);
      showToast("Group created successfully!", "success");
    } catch (error) {
      showToast("Failed to create group", "error");
    } finally {
      setLoading(false);
    }
  };

  const addToGroup = async (datasetId: string) => {
    if (!selectedGroup) return;
    
    setLoading(true);
    try {
      await apiFetch(`/consolidation/groups/${selectedGroup}/datasets`, {
        method: "POST",
        body: JSON.stringify({ dataset_id: datasetId }),
      });
      showToast("Dataset added to group!", "success");
    } catch (error) {
      showToast("Failed to add dataset", "error");
    } finally {
      setLoading(false);
    }
  };

  const executeConsolidation = async () => {
    if (!selectedGroup) return;
    
    setLoading(true);
    try {
      const data = await apiFetch(`/consolidation/groups/${selectedGroup}/execute`, {
        method: "POST",
        body: JSON.stringify({ merge_strategy: "concat" }),
      });
      showToast(`Consolidation complete! New dataset: ${data.consolidated_dataset_id}`, "success");
      fetchGroups();
    } catch (error) {
      showToast("Consolidation failed", "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthGate>
      <Shell>
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="mb-6 animate-fade-in-down">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
              <Merge className="w-3 h-3" />
              <span>Consolidation</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Data Consolidation</span></h1>
            <p className="text-sm text-app-muted mt-1">Group multiple datasets together and merge them into one unified dataset</p>
          </div>

          {/* Create New Group */}
          <div className="glass-card rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Database className="w-5 h-5 text-accent" />
                <h3 className="text-sm font-semibold text-app-muted uppercase tracking-wide">Consolidation Groups</h3>
              </div>
              <Button
                onClick={() => setShowCreateGroup(!showCreateGroup)}
                variant="primary"
                className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium"
              >
                <Plus className="w-4 h-4" />
                New Group
              </Button>
            </div>

            {showCreateGroup && (
              <div className="flex gap-3 mb-4">
                <input
                  type="text"
                  placeholder="Group name"
                  value={newGroupName}
                  onChange={(e) => setNewGroupName(e.target.value)}
                  className="flex-1 px-4 py-2 rounded-lg bg-[var(--app-input-bg)] border border-edge/60 text-app-text placeholder:text-app-subtle focus:outline-none focus:ring-2 focus:ring-accent/40"
                />
                <Button
                  onClick={createGroup}
                  disabled={loading || !newGroupName.trim()}
                  variant="primary"
                  className="px-4 py-2 rounded-lg font-medium"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : "Create"}
                </Button>
              </div>
            )}

            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {groups.map((group) => (
                <Button
                  key={group.id}
                  onClick={() => setSelectedGroup(group.id)}
                  variant="secondary"
                  className={`w-full justify-start text-left p-4 rounded-xl border transition-all ${
                    selectedGroup === group.id
                      ? "border-accent bg-accent/10"
                      : "border-edge/30 bg-panel/20 hover:border-accent/50"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium text-app-text">{group.name}</div>
                    <div className={`flex items-center gap-1 text-xs ${
                      group.status === "completed" ? "text-accent" : "text-app-muted"
                    }`}>
                      {group.status === "completed" ? <CheckCircle className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                      {group.status}
                    </div>
                  </div>
                  {group.description && (
                    <div className="text-xs text-app-muted">{group.description}</div>
                  )}
                </Button>
              ))}
            </div>
          </div>

          {/* Available Datasets */}
          <div className="glass-card rounded-2xl p-6">
            <div className="flex items-center gap-3 mb-4">
              <Database className="w-5 h-5 text-accent2" />
              <h3 className="text-lg font-semibold text-app-text">Available Datasets</h3>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {datasets.map((dataset) => (
                <div
                  key={dataset.id}
                  className={`p-4 rounded-xl border transition-all ${
                    selectedDatasets.includes(dataset.id)
                      ? "border-accent bg-accent/10"
                      : "border-edge/30 bg-panel/20"
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="font-medium text-app-text truncate">{dataset.original_filename}</div>
                    {selectedGroup && (
                      <Button
                        onClick={() => addToGroup(dataset.id)}
                        disabled={loading}
                        variant="secondary"
                        size="sm"
                        className="px-2 py-1 rounded bg-accent/20 text-accent text-xs hover:bg-accent/30"
                      >
                        Add
                      </Button>
                    )}
                  </div>
                  <div className="text-xs text-app-muted">
                    {dataset.row_count} rows × {dataset.col_count} columns
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Execute Consolidation */}
          {selectedGroup && (
            <div className="flex justify-center">
              <Button
                onClick={executeConsolidation}
                disabled={loading}
                variant="primary"
                className="flex items-center gap-2 px-8 py-3 rounded-xl font-medium disabled:opacity-50"
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Merge className="w-5 h-5" />}
                Execute Consolidation
              </Button>
            </div>
          )}
        </div>
      </Shell>
    </AuthGate>
  );
}
