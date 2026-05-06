"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached } from "@/lib/api";
import { showConfirm } from "@/lib/confirm";
import { Target, Plus, Trash2, Edit, Shield, XCircle, TrendingUp } from "lucide-react";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import { ModalPortal } from "@/components/ModalPortal";

interface Objective {
  id: number;
  name: string;
  description: string | null;
  objective_type: string;
  target_value: string | null;
  column_name: string | null;
  validation_rule: string | null;
  is_template: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export default function ObjectivesPage() {
  const [objectives, setObjectives] = useState<Objective[]>(
    () => getCached<{ objectives: Objective[] }>("/objectives")?.objectives ?? []
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingObjective, setEditingObjective] = useState<Objective | null>(null);
  const [loading, setLoading] = useState(
    () => getCached("/objectives") === null
  );
  
  // Form state
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    objective_type: "quality_target",
    target_value: "",
    column_name: "",
    validation_rule: "",
    is_template: false,
  });

  useEffect(() => {
    loadObjectives();
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showCreateModal) {
        setShowCreateModal(false);
        setEditingObjective(null);
      }
    };
    if (showCreateModal) {
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }
  }, [showCreateModal]);

  const loadObjectives = async () => {
    try {
      const data = await apiFetch("/objectives");
      setObjectives(data.objectives || []);
    } catch (e) {
      console.error("Failed to load objectives:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingObjective) {
        await apiFetch(`/objectives/${editingObjective.id}`, {
          method: "PUT",
          body: JSON.stringify(formData),
        });
        showToast("Objective updated successfully", "success");
      } else {
        await apiFetch("/objectives", {
          method: "POST",
          body: JSON.stringify(formData),
        });
        showToast("Objective created successfully", "success");
      }
      setShowCreateModal(false);
      setEditingObjective(null);
      setFormData({
        name: "",
        description: "",
        objective_type: "quality_target",
        target_value: "",
        column_name: "",
        validation_rule: "",
        is_template: false,
      });
      loadObjectives();
    } catch (e) {
      showToast("Failed to save objective", "error");
    }
  };

  const handleDelete = async (id: number) => {
    if (!await showConfirm("Delete this objective? This cannot be undone.")) return;
    try {
      await apiFetch(`/objectives/${id}`, { method: "DELETE" });
      showToast("Objective deleted successfully", "success");
      loadObjectives();
    } catch (e) {
      showToast("Failed to delete objective", "error");
    }
  };

  const handleEdit = (objective: Objective) => {
    setEditingObjective(objective);
    setFormData({
      name: objective.name,
      description: objective.description || "",
      objective_type: objective.objective_type,
      target_value: objective.target_value || "",
      column_name: objective.column_name || "",
      validation_rule: objective.validation_rule || "",
      is_template: objective.is_template,
    });
    setShowCreateModal(true);
  };

  const getObjectiveIcon = (type: string) => {
    switch (type) {
      case "quality_target":
        return <TrendingUp className="w-4 h-4" />;
      case "data_requirement":
        return <Shield className="w-4 h-4" />;
      default:
        return <Target className="w-4 h-4" />;
    }
  };

  const getObjectiveTypeLabel = (type: string) => {
    switch (type) {
      case "quality_target":
        return "Quality Target";
      case "data_requirement":
        return "Data Requirement";
      case "business_rule":
        return "Business Rule";
      default:
        return type;
    }
  };

  if (loading) {
    return (
      <AuthGate>
        <Shell>
          <div className="flex items-center justify-center py-12">
            <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          </div>
        </Shell>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <Shell>
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Plain-English explainer */}
          <div className="glass-card rounded-xl p-4 text-sm text-app-muted space-y-1">
            <p className="font-semibold text-app-text text-sm">What are Objectives?</p>
            <p>
              An <strong className="text-app-text">Objective</strong> is a goal you set for a dataset — for example:
              &ldquo;the <code className="bg-void px-1 rounded text-xs">email</code> column must never be empty&rdquo; or
              &ldquo;quality score must reach at least 90%&rdquo;.
            </p>
            <p>
              Assign objectives to a dataset during upload. After cleaning, the system checks whether each objective was met
              and shows a pass / fail result on the Cleaning page.
            </p>
          </div>

          <div className="flex items-center justify-between animate-fade-in-down">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
                <Target className="w-3 h-3" />
                <span>Objectives</span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight">
                <span className="gradient-text">Cleaning Objectives</span>
              </h1>
              <p className="text-sm text-app-muted mt-1">Define quality targets and validation rules for your datasets</p>
            </div>
            <Button
              onClick={() => {
                setEditingObjective(null);
                setFormData({
                  name: "",
                  description: "",
                  objective_type: "quality_target",
                  target_value: "",
                  column_name: "",
                  validation_rule: "",
                  is_template: false,
                });
                setShowCreateModal(true);
              }}
              variant="primary"
              className="flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              New Objective
            </Button>
          </div>

          {objectives.length === 0 ? (
            <div className="glass-card rounded-xl p-10 text-center">
              <div className="w-12 h-12 rounded-2xl bg-edge/30 flex items-center justify-center mx-auto mb-3">
                <Target className="w-6 h-6 text-app-subtle" />
              </div>
              <p className="text-sm text-app-muted">No objectives yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {objectives.map((objective, i) => (
                <div key={objective.id} className={`glass-card rounded-xl p-4 animate-fade-in-up stagger-${(i % 6) + 1}`}>
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <div className="p-2 rounded-lg bg-accent/10">
                        {getObjectiveIcon(objective.objective_type)}
                      </div>
                      <div>
                        <h3 className="font-semibold text-app-text">{objective.name}</h3>
                        <span className="text-[11px] text-app-subtle">{getObjectiveTypeLabel(objective.objective_type)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        onClick={() => handleEdit(objective)}
                        variant="ghost"
                        size="sm"
                        className="p-1.5 rounded text-app-subtle hover:text-app-muted"
                      >
                        <Edit className="w-4 h-4" />
                      </Button>
                      <Button
                        onClick={() => handleDelete(objective.id)}
                        variant="ghost"
                        size="sm"
                        className="p-1.5 rounded text-app-subtle hover:text-danger"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {objective.description && (
                    <p className="text-xs text-app-muted mb-2">{objective.description}</p>
                  )}

                  <div className="space-y-1 text-[10px] text-app-subtle">
                    {objective.target_value && <div>Target: {objective.target_value}</div>}
                    {objective.column_name && <div>Column: {objective.column_name}</div>}
                    {objective.validation_rule && <div>Rule: {objective.validation_rule}</div>}
                    {objective.is_template && (
                      <div className="flex items-center gap-1 text-accent">
                        <Shield className="w-3 h-3" />
                        <span>Template</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Create/Edit Modal */}
          <ModalPortal open={showCreateModal} onClose={() => { setShowCreateModal(false); setEditingObjective(null); }}>
              <div className="modal-card rounded-2xl w-full max-w-md flex flex-col max-h-[calc(100vh-2rem)] overflow-y-auto custom-scrollbar">
                <div className="flex justify-between items-center p-6 pb-4">
                  <h2 className="text-xl font-bold text-app-text">
                    {editingObjective ? "Edit Objective" : "New Objective"}
                  </h2>
                  <Button
                    onClick={() => {
                      setShowCreateModal(false);
                      setEditingObjective(null);
                    }}
                    variant="ghost"
                    size="sm"
                    className="p-1 rounded hover:bg-edge/50 text-app-muted hover:text-app-text"
                  >
                    <XCircle className="w-5 h-5" />
                  </Button>
                </div>
                <form onSubmit={handleSubmit} className="space-y-4 px-6 overflow-y-auto flex-1">
                  <div>
                    <label className="block text-sm text-app-muted mb-1">Name</label>
                    <input
                      type="text"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-app-muted mb-1">Description</label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-app-text h-20 focus:outline-none focus:ring-2 focus:ring-accent/40"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-app-muted mb-1">Type</label>
                    <select
                      value={formData.objective_type}
                      onChange={(e) => setFormData({ ...formData, objective_type: e.target.value })}
                      className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                    >
                      <option value="quality_target">Quality Target</option>
                      <option value="data_requirement">Data Requirement</option>
                      <option value="business_rule">Business Rule</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-app-muted mb-1">Target Value</label>
                    <input
                      type="text"
                      value={formData.target_value}
                      onChange={(e) => setFormData({ ...formData, target_value: e.target.value })}
                      className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                      placeholder="e.g., 90"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-app-muted mb-1">Column Name (optional)</label>
                    <input
                      type="text"
                      value={formData.column_name}
                      onChange={(e) => setFormData({ ...formData, column_name: e.target.value })}
                      className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                      placeholder="e.g., email"
                    />
                  </div>
                  <div>
                    <label className="block text-sm text-app-muted mb-1">Validation Rule (optional)</label>
                    <input
                      type="text"
                      value={formData.validation_rule}
                      onChange={(e) => setFormData({ ...formData, validation_rule: e.target.value })}
                      className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                      placeholder="e.g., no_nulls"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      id="is_template"
                      checked={formData.is_template}
                      onChange={(e) => setFormData({ ...formData, is_template: e.target.checked })}
                      className="rounded"
                    />
                    <label htmlFor="is_template" className="text-sm text-app-muted">
                      Make this a template (available to all users)
                    </label>
                  </div>
                  <div className="flex gap-2 pt-4 pb-6">
                    <Button
                      type="button"
                      onClick={() => {
                        setShowCreateModal(false);
                        setEditingObjective(null);
                      }}
                      variant="secondary"
                      className="flex-1 px-4 py-2 rounded-lg border border-edge text-app-muted hover:bg-edge/50"
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      className="flex-1 px-4 py-2 rounded-lg"
                    >
                      {editingObjective ? "Update" : "Create"}
                    </Button>
                  </div>
                </form>
              </div>
          </ModalPortal>
        </div>
      </Shell>
    </AuthGate>
  );
}
