"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch } from "@/lib/api";
import { showConfirm } from "@/lib/confirm";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import { PipelineNav } from "@/components/PipelineNav";
import { ModalPortal } from "@/components/ModalPortal";
import { XCircle } from "lucide-react";

interface TransformationRule {
  rule_type: "filter" | "map" | "calculate" | "format" | "validate";
  column: string;
  condition: string | null;
  operation: string;
  value: any;
  new_column: string | null;
}

interface RuleSet {
  id: number;
  name: string;
  description: string | null;
  rules: TransformationRule[];
  created_by: string;
  created_at: string;
  updated_at: string;
}

export default function TransformationRulesPage() {
  const [ruleSets, setRuleSets] = useState<RuleSet[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newRuleSetName, setNewRuleSetName] = useState("");
  const [newRuleSetDesc, setNewRuleSetDesc] = useState("");
  const [selectedRules, setSelectedRules] = useState<TransformationRule[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadRuleSets();
  }, []);

  const loadRuleSets = async () => {
    try {
      const data = await apiFetch("/transformation-rules");
      setRuleSets(data);
    } catch (e) {
      console.error("Failed to load rule sets:", e);
    } finally {
      setLoading(false);
    }
  };

  const createRuleSet = async () => {
    try {
      await apiFetch("/transformation-rules", {
        method: "POST",
        body: JSON.stringify({
          name: newRuleSetName,
          description: newRuleSetDesc || null,
          rules: selectedRules,
        }),
      });
      setShowCreateModal(false);
      setNewRuleSetName("");
      setNewRuleSetDesc("");
      setSelectedRules([]);
      loadRuleSets();
    } catch (e) {
      showToast("Failed to create rule set: " + e, "error");
    }
  };

  const deleteRuleSet = async (id: number) => {
    if (!await showConfirm("Delete this rule set? This cannot be undone.")) return;
    try {
      await apiFetch(`/transformation-rules/${id}`, { method: "DELETE" });
      loadRuleSets();
    } catch (e) {
      showToast("Failed to delete rule set: " + e, "error");
    }
  };

  const addRule = (ruleType: string) => {
    const newRule: TransformationRule = {
      rule_type: ruleType as any,
      column: "",
      condition: null,
      operation: "",
      value: null,
      new_column: null,
    };
    setSelectedRules([...selectedRules, newRule]);
  };

  const removeRule = (index: number) => {
    setSelectedRules(selectedRules.filter((_, i) => i !== index));
  };

  const updateRule = (index: number, field: keyof TransformationRule, value: any) => {
    const updated = [...selectedRules];
    updated[index] = { ...updated[index], [field]: value };
    setSelectedRules(updated);
  };

  const availableRuleTypes = [
    { type: "filter", label: "Filter Rows", description: "Filter rows based on condition" },
    { type: "map", label: "Map Values", description: "Map column values to new values" },
    { type: "calculate", label: "Calculate Column", description: "Create calculated column" },
    { type: "format", label: "Format Values", description: "Format column values" },
    { type: "validate", label: "Validate Data", description: "Validate data against rules" },
  ];

  if (loading) {
    return (
      <AuthGate>
        <Shell>
          <PipelineNav active="rules" />
          <div className="space-y-6">
            <div className="h-16 skeleton rounded-2xl" />
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(3)].map((_, i) => <div key={i} className="h-28 skeleton rounded-xl" />)}
            </div>
          </div>
        </Shell>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <Shell>
        <PipelineNav active="rules" />
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6 animate-fade-in-down">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
              <span>Rules</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Transformation Rules</span></h1>
            <p className="text-sm text-app-muted mt-1">Create custom data transformation rules</p>
          </div>
          <Button
            onClick={() => setShowCreateModal(true)}
            variant="primary"
            className="px-4 py-2 rounded-lg font-semibold text-sm"
          >
            + Create Rule Set
          </Button>
        </div>

        <div>
          <h2 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-3">My Rule Sets</h2>
          {ruleSets.length === 0 ? (
            <div className="glass-card rounded-xl p-8 text-center">
              <p className="text-app-muted text-sm">No rule sets yet. Create one to get started.</p>
            </div>
          ) : (
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {ruleSets.map((ruleSet, i) => (
                <div key={ruleSet.id} className={`glass-card rounded-xl p-4 animate-fade-in-up stagger-${(i % 6) + 1}`}>
                  <div className="flex justify-between items-start mb-2">
                    <h3 className="font-semibold text-app-text">{ruleSet.name}</h3>
                    <Button
                      onClick={() => deleteRuleSet(ruleSet.id)}
                      variant="ghost"
                      size="sm"
                      className="text-xs text-app-subtle hover:text-danger p-0"
                    >
                      Delete
                    </Button>
                  </div>
                  {ruleSet.description && (
                    <p className="text-xs text-app-muted mb-2">{ruleSet.description}</p>
                  )}
                  <div className="text-[10px] text-app-subtle mb-3">
                    {ruleSet.rules.length} rules
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {ruleSet.rules.slice(0, 3).map((rule, ri) => (
                      <span key={ri} className="text-[10px] px-2 py-0.5 rounded-full bg-edge/40 text-app-subtle">
                        {rule.rule_type}
                      </span>
                    ))}
                    {ruleSet.rules.length > 3 && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-edge/40 text-app-subtle">
                        +{ruleSet.rules.length - 3} more
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Create Rule Set Modal */}
        <ModalPortal open={showCreateModal} onClose={() => setShowCreateModal(false)}>
            <div className="modal-card rounded-2xl p-6 w-full max-w-3xl max-h-[calc(100vh-2rem)] overflow-y-auto custom-scrollbar">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-base font-semibold text-app-text">Create Transformation Rule Set</h2>
                <Button onClick={() => setShowCreateModal(false)} variant="ghost" size="sm" className="p-1 rounded text-app-subtle hover:text-app-muted">
                  <XCircle className="w-5 h-5" />
                </Button>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Rule Set Name</label>
                  <input
                    type="text"
                    value={newRuleSetName}
                    onChange={(e) => setNewRuleSetName(e.target.value)}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                    placeholder="e.g., Customer Data Standardization"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Description (optional)</label>
                  <textarea
                    value={newRuleSetDesc}
                    onChange={(e) => setNewRuleSetDesc(e.target.value)}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text h-20 focus:outline-none focus:ring-2 focus:ring-accent/40"
                    placeholder="Describe what this rule set does"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-2">Add Rules</label>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {availableRuleTypes.map((ruleType) => (
                      <Button
                        key={ruleType.type}
                        onClick={() => addRule(ruleType.type)}
                        variant="secondary"
                        size="sm"
                        className="w-full justify-start text-left text-xs px-3 py-2 rounded border border-edge/40 text-accent2 hover:bg-edge/40"
                      >
                        <div className="font-medium">{ruleType.label}</div>
                        <div className="text-[10px] text-app-subtle">{ruleType.description}</div>
                      </Button>
                    ))}
                  </div>
                </div>

                {selectedRules.length > 0 && (
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-2">Selected Rules</label>
                    <div className="space-y-3">
                      {selectedRules.map((rule, index) => (
                        <div key={index} className="bg-panel/40 rounded-lg p-3 border border-edge/40">
                          <div className="flex justify-between items-center mb-2">
                            <span className="text-sm font-medium text-app-text">{rule.rule_type}</span>
                            <Button
                              onClick={() => removeRule(index)}
                              variant="ghost"
                              size="sm"
                              className="text-xs text-app-subtle hover:text-danger p-0"
                            >
                              Remove
                            </Button>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-[10px] font-semibold uppercase tracking-wider text-app-subtle mb-1">Column</label>
                              <input
                                type="text"
                                value={rule.column}
                                onChange={(e) => updateRule(index, "column", e.target.value)}
                                className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded px-2 py-1 text-xs text-app-text focus:outline-none focus:ring-1 focus:ring-accent/40"
                                placeholder="column_name"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold uppercase tracking-wider text-app-subtle mb-1">Operation</label>
                              <input
                                type="text"
                                value={rule.operation}
                                onChange={(e) => updateRule(index, "operation", e.target.value)}
                                className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded px-2 py-1 text-xs text-app-text focus:outline-none focus:ring-1 focus:ring-accent/40"
                                placeholder="e.g., upper, replace"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold uppercase tracking-wider text-app-subtle mb-1">Condition (optional)</label>
                              <input
                                type="text"
                                value={rule.condition || ""}
                                onChange={(e) => updateRule(index, "condition", e.target.value)}
                                className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded px-2 py-1 text-xs text-app-text focus:outline-none focus:ring-1 focus:ring-accent/40"
                                placeholder="e.g., age > 18"
                              />
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold uppercase tracking-wider text-app-subtle mb-1">Value (optional)</label>
                              <input
                                type="text"
                                value={rule.value || ""}
                                onChange={(e) => updateRule(index, "value", e.target.value)}
                                className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded px-2 py-1 text-xs text-app-text focus:outline-none focus:ring-1 focus:ring-accent/40"
                                placeholder="e.g., value_to_use"
                              />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-2 pt-4">
                  <Button
                    onClick={createRuleSet}
                    disabled={!newRuleSetName || selectedRules.length === 0}
                    variant="primary"
                    className="flex-1 px-4 py-2 rounded-lg font-semibold"
                  >
                    Create Rule Set
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
