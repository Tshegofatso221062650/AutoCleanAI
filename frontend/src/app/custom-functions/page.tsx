"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached } from "@/lib/api";
import { showConfirm } from "@/lib/confirm";
import { Code, Plus, Trash2, Pencil, Play, FileCode, CheckCircle, XCircle } from "lucide-react";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import { PipelineNav } from "@/components/PipelineNav";
import { ModalPortal } from "@/components/ModalPortal";

interface CustomFunction {
  id: number;
  name: string;
  description: string | null;
  function_type: string;
  function_code: string;
  language: string;
  parameters: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export default function CustomFunctionsPage() {
  const [functions, setFunctions] = useState<CustomFunction[]>(
    () => getCached<{ functions: CustomFunction[] }>("/custom-functions")?.functions ?? []
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingFunc, setEditingFunc] = useState<CustomFunction | null>(null);
  const [loading, setLoading] = useState(
    () => getCached("/custom-functions") === null
  );
  
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    function_type: "transform",
    function_code: "",
    language: "python",
    parameters: "",
  });

  useEffect(() => {
    loadFunctions();
  }, []);

  const loadFunctions = async () => {
    try {
      const data = await apiFetch("/custom-functions");
      setFunctions(data.functions || []);
    } catch (error) {
      console.error("Failed to load custom functions:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingFunc) {
        await apiFetch(`/custom-functions/${editingFunc.id}`, {
          method: "PUT",
          body: JSON.stringify(formData),
        });
        showToast("Custom function updated successfully", "success");
      } else {
        await apiFetch("/custom-functions", {
          method: "POST",
          body: JSON.stringify(formData),
        });
        showToast("Custom function created successfully", "success");
      }
      
      setShowCreateModal(false);
      setEditingFunc(null);
      resetForm();
      loadFunctions();
    } catch (error) {
      console.error("Failed to save custom function:", error);
      showToast("Failed to save custom function", "error");
    }
  };

  const handleDelete = async (id: number) => {
    if (!await showConfirm("Delete this custom function? This cannot be undone.")) return;
    
    try {
      await apiFetch(`/custom-functions/${id}`, { method: "DELETE" });
      showToast("Custom function deleted successfully", "success");
      loadFunctions();
    } catch (error) {
      console.error("Failed to delete custom function:", error);
      showToast("Failed to delete custom function", "error");
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      description: "",
      function_type: "transform",
      function_code: "",
      language: "python",
      parameters: "",
    });
  };

  const handleEdit = (func: CustomFunction) => {
    setEditingFunc(func);
    setFormData({
      name: func.name,
      description: func.description || "",
      function_type: func.function_type,
      function_code: func.function_code,
      language: func.language,
      parameters: func.parameters || "",
    });
    setShowCreateModal(true);
  };

  const getFunctionTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      transform: "Transform",
      validate: "Validate",
      aggregate: "Aggregate",
    };
    return labels[type] || type;
  };

  if (loading) {
    return (
      <AuthGate>
        <Shell>
          <PipelineNav active="functions" />
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
        <PipelineNav active="functions" />
        <div className="flex flex-wrap items-center justify-between gap-4 mb-6 animate-fade-in-down">
          <div>
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
              <FileCode className="w-3 h-3" />
              <span>Custom Functions</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Custom Functions</span></h1>
            <p className="text-sm text-app-muted mt-1">Write Python/JavaScript functions for complex transformations</p>
          </div>
          <Button
            onClick={() => {
              resetForm();
              setEditingFunc(null);
              setShowCreateModal(true);
            }}
            variant="primary"
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm"
          >
            <Plus className="w-4 h-4" />
            Create Function
          </Button>
        </div>

        {functions.length === 0 ? (
          <div className="glass-card rounded-xl p-10 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-edge/30 flex items-center justify-center mx-auto">
              <FileCode className="w-6 h-6 text-app-subtle" />
            </div>
            <h3 className="text-base font-semibold text-app-text">No custom functions yet</h3>
            <p className="text-sm text-app-muted">Create your first custom function for complex data transformations</p>
            <Button
              onClick={() => {
                resetForm();
                setEditingFunc(null);
                setShowCreateModal(true);
              }}
              variant="primary"
              className="px-4 py-2 rounded-lg font-semibold text-sm"
            >
              Create First Function
            </Button>
          </div>
        ) : (
          <div className="glass-card rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-edge/40">
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Name</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Type</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Language</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Description</th>
                  <th className="p-4 text-right text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {functions.map((func) => (
                  <tr key={func.id} className="border-t border-edge/20 hover:bg-accent/5 transition-colors">
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <Code className="w-4 h-4 text-accent" />
                        <div className="font-medium text-app-text">{func.name}</div>
                      </div>
                    </td>
                    <td className="p-4">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-accent2/10 text-accent2">
                        {getFunctionTypeLabel(func.function_type)}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-app-muted">{func.language}</td>
                    <td className="p-4 text-sm text-app-muted max-w-xs truncate">{func.description || "—"}</td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          onClick={() => handleEdit(func)}
                          variant="ghost"
                          size="sm"
                          className="p-1.5 rounded text-app-subtle hover:text-app-muted transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          onClick={() => handleDelete(func.id)}
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

        <ModalPortal open={showCreateModal} onClose={() => { setShowCreateModal(false); setEditingFunc(null); }}>
            <div className="modal-card rounded-2xl p-6 w-full max-w-3xl max-h-[calc(100vh-2rem)] overflow-y-auto custom-scrollbar">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-base font-semibold text-app-text">
                  {editingFunc ? "Edit Custom Function" : "Create Custom Function"}
                </h2>
                <Button
                  onClick={() => { setShowCreateModal(false); setEditingFunc(null); }}
                  variant="ghost"
                  size="sm"
                  className="p-1 rounded text-app-subtle hover:text-app-muted"
                >
                  <XCircle className="w-5 h-5" />
                </Button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Function Name</label>
                    <input
                      type="text"
                      required
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                      placeholder="e.g., CleanPhoneNumbers"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Function Type</label>
                    <select
                      value={formData.function_type}
                      onChange={(e) => setFormData({ ...formData, function_type: e.target.value })}
                      className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                    >
                      <option value="transform">Transform</option>
                      <option value="validate">Validate</option>
                      <option value="aggregate">Aggregate</option>
                    </select>
                  </div>
                </div>
                
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Description</label>
                  <input
                    type="text"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                    placeholder="Brief description of what this function does"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Language</label>
                    <select
                      value={formData.language}
                      onChange={(e) => setFormData({ ...formData, language: e.target.value })}
                      className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                    >
                      <option value="python">Python</option>
                      <option value="javascript">JavaScript</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Parameters (JSON)</label>
                    <input
                      type="text"
                      value={formData.parameters}
                      onChange={(e) => setFormData({ ...formData, parameters: e.target.value })}
                      className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text font-mono focus:outline-none focus:ring-2 focus:ring-accent/40"
                      placeholder='{"column": "phone", "format": "international"}'
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Function Code</label>
                  <textarea
                    required
                    value={formData.function_code}
                    onChange={(e) => setFormData({ ...formData, function_code: e.target.value })}
                    className="w-full h-64 bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text font-mono focus:outline-none focus:ring-2 focus:ring-accent/40"
                    placeholder="def transform_function(df, **kwargs):
    # Your transformation logic here
    return df"
                  />
                </div>

                <div className="flex gap-2 pt-4">
                  <Button
                    type="button"
                    onClick={() => { setShowCreateModal(false); setEditingFunc(null); }}
                    variant="secondary"
                    className="flex-1 px-4 py-2 rounded-lg border border-edge/40 text-app-muted"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    className="flex-1 px-4 py-2 rounded-lg"
                  >
                    {editingFunc ? "Update" : "Create"}
                  </Button>
                </div>
              </form>
            </div>
        </ModalPortal>
      </Shell>
    </AuthGate>
  );
}
