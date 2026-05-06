"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached } from "@/lib/api";
import { showConfirm } from "@/lib/confirm";
import { showToast } from "@/components/Toast";
import { XCircle, Plus } from "lucide-react";
import { PipelineNav } from "@/components/PipelineNav";
import { Button } from "@/components/ui/Button";
import { ModalPortal } from "@/components/ModalPortal";

interface PipelineStep {
  step_type: string;
  params: Record<string, any>;
  enabled: boolean;
  order: number;
  transformation_rule_id?: number;
  consolidation_group_id?: number | string;
}

interface Pipeline {
  id: number;
  name: string;
  description: string | null;
  steps: PipelineStep[];
  is_template: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
  usage_count: number;
}

export default function PipelinesPage() {
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [templates, setTemplates] = useState<Pipeline[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newPipelineName, setNewPipelineName] = useState("");
  const [newPipelineDesc, setNewPipelineDesc] = useState("");
  const [selectedSteps, setSelectedSteps] = useState<PipelineStep[]>([]);
  const [loading, setLoading] = useState(
    () => getCached("/pipelines") === null
  );
  const [transformationRules, setTransformationRules] = useState<any[]>([]);
  const [consolidationGroups, setConsolidationGroups] = useState<any[]>([]);

  useEffect(() => {
    loadPipelines();
    loadTemplates();
    loadTransformationRules();
    loadConsolidationGroups();
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showCreateModal) {
        setShowCreateModal(false);
      }
    };
    if (showCreateModal) {
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }
  }, [showCreateModal]);

  const loadPipelines = async () => {
    try {
      const data = await apiFetch("/pipelines");
      const parsed = data.map((p: any) => ({
        ...p,
        steps: typeof p.steps === 'string' ? JSON.parse(p.steps) : p.steps,
      }));
      setPipelines(parsed);
    } catch (e) {
      console.error("Failed to load pipelines:", e);
    } finally {
      setLoading(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const data = await apiFetch("/pipelines/templates");
      const parsed = data.map((p: any) => ({
        ...p,
        steps: typeof p.steps === 'string' ? JSON.parse(p.steps) : p.steps,
      }));
      setTemplates(parsed);
    } catch (e) {
      console.error("Failed to load templates:", e);
    }
  };

  const loadTransformationRules = async () => {
    try {
      const data = await apiFetch("/transformation-rules");
      setTransformationRules(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error("Failed to load transformation rules:", e);
    }
  };

  const loadConsolidationGroups = async () => {
    try {
      const data = await apiFetch("/consolidation/groups");
      setConsolidationGroups(data.groups || []);
    } catch (e) {
      console.error("Failed to load consolidation groups:", e);
    }
  };

  const createPipeline = async () => {
    try {
      await apiFetch("/pipelines", {
        method: "POST",
        body: JSON.stringify({
          name: newPipelineName,
          description: newPipelineDesc || null,
          steps: selectedSteps,
          is_template: false,
        }),
      });
      setShowCreateModal(false);
      setNewPipelineName("");
      setNewPipelineDesc("");
      setSelectedSteps([]);
      loadPipelines();
    } catch (e) {
      showToast("Failed to create pipeline: " + e, "error");
    }
  };

  const deletePipeline = async (id: number) => {
    if (!await showConfirm("Delete this pipeline? This cannot be undone.")) return;
    try {
      await apiFetch(`/pipelines/${id}`, { method: "DELETE" });
      loadPipelines();
    } catch (e) {
      showToast("Failed to delete pipeline: " + e, "error");
    }
  };

  const addStep = (stepType: string) => {
    const newStep: PipelineStep = {
      step_type: stepType,
      params: {},
      enabled: true,
      order: selectedSteps.length,
    };

    if (stepType === "transformation_rule" && transformationRules.length > 0) {
      newStep.transformation_rule_id = transformationRules[0].id;
    } else if (stepType === "consolidation" && consolidationGroups.length > 0) {
      newStep.consolidation_group_id = consolidationGroups[0].id;
    }

    setSelectedSteps([...selectedSteps, newStep]);
  };

  const removeStep = (index: number) => {
    setSelectedSteps(selectedSteps.filter((_, i) => i !== index));
  };

  const toggleStep = (index: number) => {
    const updated = [...selectedSteps];
    updated[index].enabled = !updated[index].enabled;
    setSelectedSteps(updated);
  };

  const availableSteps = [
    { type: "fix_missing", label: "Fix Missing Values" },
    { type: "remove_duplicates", label: "Remove Duplicates" },
    { type: "coerce_types", label: "Coerce Data Types" },
    { type: "normalize_strings", label: "Normalize Strings" },
    { type: "fix_typos", label: "Fix Typos" },
    { type: "clip_outliers", label: "Clip Outliers" },
    { type: "validate_emails", label: "Validate Emails" },
    { type: "transformation_rule", label: "Transformation Rule" },
    { type: "consolidation", label: "Consolidation" },
  ];

  if (loading) {
    return (
      <AuthGate>
        <Shell>
          <PipelineNav active="pipelines" />
          <div className="space-y-6">
            <div className="h-16 skeleton rounded-2xl" />
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => <div key={i} className="h-32 skeleton rounded-xl" />)}
            </div>
          </div>
        </Shell>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <Shell>
        <PipelineNav active="pipelines" />
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6 animate-fade-in-down">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
              <span>Pipelines</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Pipelines</span></h1>
            <p className="text-sm text-app-muted mt-1">Manage reusable cleaning workflows</p>
          </div>
          <Button
            onClick={() => setShowCreateModal(true)}
            variant="primary"
            className="px-4 py-2 rounded-lg font-semibold text-sm flex items-center gap-2"
          >
            <Plus className="w-4 h-4" />
            Create Pipeline
          </Button>
        </div>

        {/* Templates Section */}
        {templates.length > 0 && (
          <div className="mb-8">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-3">Template Pipelines</h2>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {templates.map((pipeline, i) => (
                <div key={pipeline.id} className={`glass-card rounded-xl p-4 animate-fade-in-up stagger-${(i % 6) + 1}`}>
                  <h3 className="font-semibold text-app-text mb-1">{pipeline.name}</h3>
                  {pipeline.description && (
                    <p className="text-xs text-app-muted mb-2">{pipeline.description}</p>
                  )}
                  <div className="text-[10px] text-app-subtle">
                    {pipeline.steps.length} steps • Used {pipeline.usage_count} times
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* My Pipelines Section */}
        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-3">My Pipelines</h2>
          {pipelines.length === 0 ? (
            <div className="glass-card rounded-xl p-8 text-center">
              <p className="text-app-muted text-sm">No pipelines yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {pipelines.map((pipeline, i) => (
                <div key={pipeline.id} className={`glass-card rounded-xl p-4 animate-fade-in-up stagger-${(i % 6) + 1}`}>
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold text-app-text">{pipeline.name}</h3>
                    <Button
                      onClick={() => deletePipeline(pipeline.id)}
                      variant="ghost"
                      size="sm"
                      className="text-xs text-app-subtle hover:text-danger p-0"
                    >
                      Delete
                    </Button>
                  </div>
                  {pipeline.description && (
                    <p className="text-xs text-app-muted mb-2">{pipeline.description}</p>
                  )}
                  <div className="text-[10px] text-app-subtle mb-3">
                    {pipeline.steps.length} steps • Used {pipeline.usage_count} times
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {pipeline.steps.slice(0, 3).map((step, si) => (
                      <span key={si} className="text-[10px] px-2 py-0.5 rounded-full bg-edge/40 text-app-subtle">
                        {step.step_type}
                      </span>
                    ))}
                    {pipeline.steps.length > 3 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-edge/40 text-app-subtle">
                        +{pipeline.steps.length - 3} more
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Create Pipeline Modal */}
        <ModalPortal open={showCreateModal} onClose={() => setShowCreateModal(false)}>
            <div className="modal-card rounded-2xl p-6 w-full max-w-2xl max-h-[calc(100vh-2rem)] overflow-y-auto custom-scrollbar">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-base font-semibold text-app-text">Create Pipeline</h2>
                <Button
                  onClick={() => setShowCreateModal(false)}
                  variant="ghost"
                  size="sm"
                  className="p-1 rounded text-app-subtle hover:text-app-muted"
                >
                  <XCircle className="w-5 h-5" />
                </Button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Pipeline Name</label>
                  <input
                    type="text"
                    value={newPipelineName}
                    onChange={(e) => setNewPipelineName(e.target.value)}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                    placeholder="e.g., Standard Data Cleaning"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Description (optional)</label>
                  <textarea
                    value={newPipelineDesc}
                    onChange={(e) => setNewPipelineDesc(e.target.value)}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40 h-20"
                    placeholder="Describe what this pipeline does"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-2">Add Steps</label>
                  <div className="flex flex-wrap gap-2">
                    {availableSteps.map((step) => (
                      <Button
                        key={step.type}
                        onClick={() => addStep(step.type)}
                        variant="secondary"
                        size="sm"
                        className="text-xs px-3 py-1.5 rounded border border-edge text-accent2 hover:bg-edge"
                      >
                        + {step.label}
                      </Button>
                    ))}
                  </div>
                </div>

                {selectedSteps.length > 0 && (
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-2">Selected Steps</label>
                    <div className="space-y-2">
                      {selectedSteps.map((step, index) => (
                        <div key={index} className="flex items-center gap-2 bg-panel/40 rounded-lg p-2 border border-edge/40">
                          <input
                            type="checkbox"
                            checked={step.enabled}
                            onChange={() => toggleStep(index)}
                            className="rounded accent-accent"
                          />
                          <span className="text-sm text-app-text flex-1">{step.step_type}</span>
                          {step.step_type === "transformation_rule" && (
                            <select
                              value={step.transformation_rule_id || ""}
                              onChange={(e) => {
                                const updated = [...selectedSteps];
                                updated[index].transformation_rule_id = parseInt(e.target.value);
                                setSelectedSteps(updated);
                              }}
                              className="text-xs bg-[var(--app-input-bg)] border border-edge/60 rounded px-2 py-1 text-app-text"
                            >
                              <option value="">Select Rule</option>
                              {transformationRules.map((rule) => (
                                <option key={rule.id} value={rule.id}>{rule.name}</option>
                              ))}
                            </select>
                          )}
                          {step.step_type === "consolidation" && (
                            <select
                              value={step.consolidation_group_id || ""}
                              onChange={(e) => {
                                const updated = [...selectedSteps];
                                updated[index].consolidation_group_id = e.target.value;
                                setSelectedSteps(updated);
                              }}
                              className="text-xs bg-[var(--app-input-bg)] border border-edge/60 rounded px-2 py-1 text-app-text"
                            >
                              <option value="">Select Group</option>
                              {consolidationGroups.map((group) => (
                                <option key={group.id} value={group.id}>{group.name}</option>
                              ))}
                            </select>
                          )}
                          <Button
                            onClick={() => removeStep(index)}
                            variant="ghost"
                            size="sm"
                            className="text-xs text-danger p-0"
                          >
                            Remove
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-4">
                  <Button
                    onClick={createPipeline}
                    disabled={!newPipelineName || selectedSteps.length === 0}
                    variant="primary"
                    className="flex-1 px-4 py-2 rounded-lg font-semibold"
                  >
                    Create Pipeline
                  </Button>
                  <Button
                    onClick={() => setShowCreateModal(false)}
                    variant="ghost"
                    className="px-4 py-2 rounded-lg border border-edge/40 text-app-muted"
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            </div>
        </ModalPortal>
      </Shell>
    </AuthGate>
  );
}
