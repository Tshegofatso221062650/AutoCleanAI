"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached } from "@/lib/api";
import { showConfirm } from "@/lib/confirm";
import { Shield, Plus, Trash2, Pencil, CheckCircle, XCircle } from "lucide-react";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import { ModalPortal } from "@/components/ModalPortal";

interface ValidationRule {
  id: number;
  name: string;
  rule_type: string;
  column_name: string;
  pattern: string | null;
  min_value: number | null;
  max_value: number | null;
  allowed_values: string | null;
  is_required: boolean;
  error_message: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export default function ValidationPage() {
  const [rules, setRules] = useState<ValidationRule[]>(
    () => getCached<{ rules: ValidationRule[] }>("/validation")?.rules ?? []
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingRule, setEditingRule] = useState<ValidationRule | null>(null);
  const [loading, setLoading] = useState(
    () => getCached("/validation") === null
  );
  
  const [formData, setFormData] = useState({
    name: "",
    rule_type: "regex",
    column_name: "",
    pattern: "",
    min_value: "",
    max_value: "",
    allowed_values: "",
    is_required: false,
    error_message: "",
  });

  useEffect(() => {
    loadRules();
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showCreateModal) {
        setShowCreateModal(false);
        setEditingRule(null);
      }
    };
    if (showCreateModal) {
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }
  }, [showCreateModal]);

  const loadRules = async () => {
    try {
      const data = await apiFetch("/validation");
      setRules(data.rules || []);
    } catch (error) {
      console.error("Failed to load validation rules:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body = {
        ...formData,
        min_value: formData.min_value ? parseFloat(formData.min_value) : null,
        max_value: formData.max_value ? parseFloat(formData.max_value) : null,
      };
      
      if (editingRule) {
        await apiFetch(`/validation/${editingRule.id}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        showToast("Validation rule updated successfully", "success");
      } else {
        await apiFetch("/validation", {
          method: "POST",
          body: JSON.stringify(body),
        });
        showToast("Validation rule created successfully", "success");
      }
      
      setShowCreateModal(false);
      setEditingRule(null);
      resetForm();
      loadRules();
    } catch (error) {
      console.error("Failed to save validation rule:", error);
      showToast("Failed to save validation rule", "error");
    }
  };

  const handleDelete = async (id: number) => {
    if (!await showConfirm("Delete this validation rule? This cannot be undone.")) return;
    
    try {
      await apiFetch(`/validation/${id}`, { method: "DELETE" });
      showToast("Validation rule deleted successfully", "success");
      loadRules();
    } catch (error) {
      console.error("Failed to delete validation rule:", error);
      showToast("Failed to delete validation rule", "error");
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      rule_type: "regex",
      column_name: "",
      pattern: "",
      min_value: "",
      max_value: "",
      allowed_values: "",
      is_required: false,
      error_message: "",
    });
  };

  const handleEdit = (rule: ValidationRule) => {
    setEditingRule(rule);
    setFormData({
      name: rule.name,
      rule_type: rule.rule_type,
      column_name: rule.column_name,
      pattern: rule.pattern || "",
      min_value: rule.min_value?.toString() || "",
      max_value: rule.max_value?.toString() || "",
      allowed_values: rule.allowed_values || "",
      is_required: rule.is_required,
      error_message: rule.error_message || "",
    });
    setShowCreateModal(true);
  };

  const getRuleTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      regex: "Regex Pattern",
      range: "Numeric Range",
      enum: "Allowed Values",
      email: "Email Format",
      phone: "Phone Format",
      required: "Required Field",
    };
    return labels[type] || type;
  };

  if (loading) {
    return (
      <AuthGate>
        <Shell>
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
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6 animate-fade-in-down">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
              <Shield className="w-3 h-3" />
              <span>Validation</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Validation Rules</span></h1>
            <p className="text-sm text-app-muted mt-1">Define data validation rules to ensure data quality</p>
          </div>
          <Button
            onClick={() => {
              resetForm();
              setEditingRule(null);
              setShowCreateModal(true);
            }}
            variant="primary"
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm"
          >
            <Plus className="w-4 h-4" />
            Create Rule
          </Button>
        </div>

        {rules.length === 0 ? (
          <div className="glass-card rounded-xl p-10 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-edge/30 flex items-center justify-center mx-auto">
              <Shield className="w-6 h-6 text-app-subtle" />
            </div>
            <h3 className="text-base font-semibold text-app-text">No validation rules yet</h3>
            <p className="text-sm text-app-muted">Create your first validation rule to start ensuring data quality</p>
            <Button
              onClick={() => {
                resetForm();
                setEditingRule(null);
                setShowCreateModal(true);
              }}
              variant="primary"
              className="px-4 py-2 rounded-lg font-semibold text-sm"
            >
              Create First Rule
            </Button>
          </div>
        ) : (
          <div className="glass-card rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-edge/40">
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Name</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Type</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Column</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Details</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Required</th>
                  <th className="p-4 text-right text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule) => (
                  <tr key={rule.id} className="border-t border-edge/20 hover:bg-accent/5 transition-colors">
                    <td className="p-4">
                      <div className="font-medium text-app-text">{rule.name}</div>
                      {rule.error_message && (
                        <div className="text-xs text-app-muted mt-1">{rule.error_message}</div>
                      )}
                    </td>
                    <td className="p-4">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-accent/10 text-accent">
                        {getRuleTypeLabel(rule.rule_type)}
                      </span>
                    </td>
                    <td className="p-4">
                      <code className="text-xs text-app-muted font-mono">{rule.column_name}</code>
                    </td>
                    <td className="p-4 text-xs text-app-muted">
                      {rule.pattern && <div>Pattern: {rule.pattern}</div>}
                      {rule.min_value !== null && <div>Min: {rule.min_value}</div>}
                      {rule.max_value !== null && <div>Max: {rule.max_value}</div>}
                      {rule.allowed_values && <div>Values: {rule.allowed_values}</div>}
                    </td>
                    <td className="p-4">
                      {rule.is_required ? (
                        <CheckCircle className="w-4 h-4 text-accent" />
                      ) : (
                        <XCircle className="w-4 h-4 text-app-subtle" />
                      )}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          onClick={() => handleEdit(rule)}
                          variant="ghost"
                          size="sm"
                          className="p-1.5 rounded text-app-subtle hover:text-app-muted transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          onClick={() => handleDelete(rule.id)}
                          variant="ghost"
                          size="sm"
                          className="p-1.5 rounded text-app-subtle hover:text-danger transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ModalPortal open={showCreateModal} onClose={() => { setShowCreateModal(false); setEditingRule(null); }}>
            <div className="modal-card rounded-2xl p-6 w-full max-w-2xl max-h-[calc(100vh-2rem)] overflow-y-auto custom-scrollbar">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-base font-semibold text-app-text">
                  {editingRule ? "Edit Validation Rule" : "Create Validation Rule"}
                </h2>
                <Button
                  onClick={() => { setShowCreateModal(false); setEditingRule(null); }}
                  variant="ghost"
                  size="sm"
                  className="p-1 rounded text-app-subtle hover:text-app-muted"
                >
                  <XCircle className="w-5 h-5" />
                </Button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Rule Name</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                    placeholder="e.g., Valid Email Format"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Rule Type</label>
                    <select
                      value={formData.rule_type}
                      onChange={(e) => setFormData({ ...formData, rule_type: e.target.value })}
                      className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                    >
                      <option value="regex">Regex Pattern</option>
                      <option value="range">Numeric Range</option>
                      <option value="enum">Allowed Values</option>
                      <option value="email">Email Format</option>
                      <option value="phone">Phone Format</option>
                      <option value="required">Required Field</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Column Name</label>
                    <input
                      type="text"
                      required
                      value={formData.column_name}
                      onChange={(e) => setFormData({ ...formData, column_name: e.target.value })}
                      className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                      placeholder="e.g., email"
                    />
                  </div>
                </div>

                {formData.rule_type === "regex" && (
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Regex Pattern</label>
                    <input
                      type="text"
                      value={formData.pattern}
                      onChange={(e) => setFormData({ ...formData, pattern: e.target.value })}
                      className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text font-mono focus:outline-none focus:ring-2 focus:ring-accent/40"
                      placeholder="e.g., ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$"
                    />
                  </div>
                )}

                {formData.rule_type === "range" && (
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Min Value</label>
                      <input
                        type="number"
                        step="any"
                        value={formData.min_value}
                        onChange={(e) => setFormData({ ...formData, min_value: e.target.value })}
                        className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Max Value</label>
                      <input
                        type="number"
                        step="any"
                        value={formData.max_value}
                        onChange={(e) => setFormData({ ...formData, max_value: e.target.value })}
                        className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                      />
                    </div>
                  </div>
                )}

                {formData.rule_type === "enum" && (
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Allowed Values (comma-separated)</label>
                    <input
                      type="text"
                      value={formData.allowed_values}
                      onChange={(e) => setFormData({ ...formData, allowed_values: e.target.value })}
                      className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                      placeholder="e.g., active, inactive, pending"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Error Message</label>
                  <input
                    type="text"
                    value={formData.error_message}
                    onChange={(e) => setFormData({ ...formData, error_message: e.target.value })}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                    placeholder="e.g., Invalid email format"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_required}
                    onChange={(e) => setFormData({ ...formData, is_required: e.target.checked })}
                    className="rounded border-edge accent-accent"
                  />
                  <label className="text-sm text-app-muted">Required field (cannot be null/empty)</label>
                </div>

                <div className="flex gap-2 pt-4">
                  <Button
                    type="button"
                    onClick={() => { setShowCreateModal(false); setEditingRule(null); }}
                    variant="ghost"
                    className="flex-1 px-4 py-2 rounded-lg border border-edge/40 text-app-muted"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    className="flex-1 px-4 py-2 rounded-lg font-medium"
                  >
                    {editingRule ? "Update" : "Create"}
                  </Button>
                </div>
              </form>
            </div>
        </ModalPortal>
      </Shell>
    </AuthGate>
  );
}
