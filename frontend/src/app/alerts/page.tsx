"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached } from "@/lib/api";
import { showConfirm } from "@/lib/confirm";
import { Bell, Plus, Trash2, Pencil, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import { ModalPortal } from "@/components/ModalPortal";

interface QualityAlert {
  id: number;
  name: string;
  alert_type: string;
  threshold_value: number;
  metric_type: string;
  is_active: boolean;
  created_by: string;
  created_at: string;
  last_triggered_at: string | null;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<QualityAlert[]>(
    () => getCached<{ alerts: QualityAlert[] }>("/alerts")?.alerts ?? []
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingAlert, setEditingAlert] = useState<QualityAlert | null>(null);
  const [loading, setLoading] = useState(
    () => getCached("/alerts") === null
  );
  
  const [formData, setFormData] = useState({
    name: "",
    alert_type: "quality_below",
    threshold_value: "80",
    metric_type: "quality_score",
    is_active: true,
  });

  useEffect(() => {
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    try {
      const data = await apiFetch("/alerts");
      setAlerts(data.alerts || []);
    } catch (error) {
      console.error("Failed to load alerts:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body = {
        ...formData,
        threshold_value: parseFloat(formData.threshold_value),
      };
      
      if (editingAlert) {
        await apiFetch(`/alerts/${editingAlert.id}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        showToast("Alert updated successfully", "success");
      } else {
        await apiFetch("/alerts", {
          method: "POST",
          body: JSON.stringify(body),
        });
        showToast("Alert created successfully", "success");
      }
      
      setShowCreateModal(false);
      setEditingAlert(null);
      resetForm();
      loadAlerts();
    } catch (error) {
      console.error("Failed to save alert:", error);
      showToast("Failed to save alert", "error");
    }
  };

  const handleDelete = async (id: number) => {
    if (!await showConfirm("Delete this alert? This cannot be undone.")) return;
    
    try {
      await apiFetch(`/alerts/${id}`, { method: "DELETE" });
      showToast("Alert deleted successfully", "success");
      loadAlerts();
    } catch (error) {
      console.error("Failed to delete alert:", error);
      showToast("Failed to delete alert", "error");
    }
  };

  const handleToggleActive = async (alert: QualityAlert) => {
    try {
      await apiFetch(`/alerts/${alert.id}`, {
        method: "PUT",
        body: JSON.stringify({ is_active: !alert.is_active }),
      });
      showToast(`Alert ${alert.is_active ? "disabled" : "enabled"} successfully`, "success");
      loadAlerts();
    } catch (error) {
      console.error("Failed to toggle alert:", error);
      showToast("Failed to toggle alert", "error");
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      alert_type: "quality_below",
      threshold_value: "80",
      metric_type: "quality_score",
      is_active: true,
    });
  };

  const handleEdit = (alert: QualityAlert) => {
    setEditingAlert(alert);
    setFormData({
      name: alert.name,
      alert_type: alert.alert_type,
      threshold_value: alert.threshold_value.toString(),
      metric_type: alert.metric_type,
      is_active: alert.is_active,
    });
    setShowCreateModal(true);
  };

  const getAlertTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      quality_below: "Quality Below",
      missing_above: "Missing Above",
      duplicate_above: "Duplicate Above",
    };
    return labels[type] || type;
  };

  const getMetricTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      quality_score: "Quality Score",
      missing_pct: "Missing Percentage",
      duplicate_pct: "Duplicate Percentage",
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
              <Bell className="w-3 h-3" />
              <span>Monitoring</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Quality Alerts</span></h1>
            <p className="text-sm text-app-muted mt-1">Set thresholds and get notified when data quality drops</p>
          </div>
          <Button
            onClick={() => {
              resetForm();
              setEditingAlert(null);
              setShowCreateModal(true);
            }}
            variant="primary"
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm"
          >
            <Plus className="w-4 h-4" />
            Create Alert
          </Button>
        </div>

        {alerts.length === 0 ? (
          <div className="glass-card rounded-xl p-10 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-edge/30 flex items-center justify-center mx-auto">
              <Bell className="w-6 h-6 text-app-subtle" />
            </div>
            <h3 className="text-base font-semibold text-app-text">No quality alerts yet</h3>
            <p className="text-sm text-app-muted">Create your first quality alert to monitor data quality</p>
            <Button
              onClick={() => {
                resetForm();
                setEditingAlert(null);
                setShowCreateModal(true);
              }}
              variant="primary"
              className="px-4 py-2 rounded-lg font-semibold text-sm"
            >
              Create First Alert
            </Button>
          </div>
        ) : (
          <div className="glass-card rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-edge/40">
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Name</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Type</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Metric</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Threshold</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Status</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Last Triggered</th>
                  <th className="p-4 text-right text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((alert) => (
                  <tr key={alert.id} className="border-t border-edge/20 hover:bg-accent/5 transition-colors">
                    <td className="p-4">
                      <div className="font-medium text-app-text">{alert.name}</div>
                    </td>
                    <td className="p-4">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-accent/10 text-accent">
                        {getAlertTypeLabel(alert.alert_type)}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-app-muted">{getMetricTypeLabel(alert.metric_type)}</td>
                    <td className="p-4 text-sm text-app-muted">{alert.threshold_value}%</td>
                    <td className="p-4">
                      <Button
                        onClick={() => handleToggleActive(alert)}
                        variant="ghost"
                        size="sm"
                        className={`px-3 py-1 rounded-full text-xs font-medium ${
                          alert.is_active ? "bg-accent/15 text-accent" : "bg-edge/50 text-app-muted"
                        }`}
                      >
                        {alert.is_active ? (
                          <>
                            <CheckCircle className="w-3 h-3" />
                            Active
                          </>
                        ) : (
                          <>
                            <XCircle className="w-3 h-3" />
                            Disabled
                          </>
                        )}
                      </Button>
                    </td>
                    <td className="p-4 text-xs text-app-subtle">
                      {alert.last_triggered_at ? new Date(alert.last_triggered_at).toLocaleString() : "Never"}
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          onClick={() => handleEdit(alert)}
                          variant="ghost"
                          size="sm"
                          className="p-1.5 rounded text-app-subtle hover:text-app-muted transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          onClick={() => handleDelete(alert.id)}
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

        <ModalPortal open={showCreateModal} onClose={() => { setShowCreateModal(false); setEditingAlert(null); }}>
            <div className="modal-card rounded-2xl p-6 w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto custom-scrollbar">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-base font-semibold text-app-text">
                  {editingAlert ? "Edit Alert" : "Create Alert"}
                </h2>
                <Button
                  onClick={() => {
                    setShowCreateModal(false);
                    setEditingAlert(null);
                  }}
                  variant="ghost"
                  size="sm"
                  className="p-1 rounded text-app-muted hover:text-app-text"
                >
                  <XCircle className="w-5 h-5" />
                </Button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm text-app-muted mb-1">Alert Name</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                    placeholder="e.g., Low Quality Alert"
                  />
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-app-muted mb-1">Alert Type</label>
                    <select
                      value={formData.alert_type}
                      onChange={(e) => setFormData({ ...formData, alert_type: e.target.value })}
                      className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                    >
                      <option value="quality_below">Quality Below</option>
                      <option value="missing_above">Missing Above</option>
                      <option value="duplicate_above">Duplicate Above</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-app-muted mb-1">Metric</label>
                    <select
                      value={formData.metric_type}
                      onChange={(e) => setFormData({ ...formData, metric_type: e.target.value })}
                      className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                    >
                      <option value="quality_score">Quality Score</option>
                      <option value="missing_pct">Missing Percentage</option>
                      <option value="duplicate_pct">Duplicate Percentage</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-sm text-app-muted mb-1">Threshold Value (%)</label>
                  <input
                    type="number"
                    required
                    min="0"
                    max="100"
                    step="0.1"
                    value={formData.threshold_value}
                    onChange={(e) => setFormData({ ...formData, threshold_value: e.target.value })}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                    placeholder="e.g., 80"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="rounded border-edge"
                  />
                  <label className="text-sm text-app-muted">Active (alert will trigger when condition is met)</label>
                </div>

                <div className="flex gap-2 pt-4">
                  <Button
                    type="button"
                    onClick={() => {
                      setShowCreateModal(false);
                      setEditingAlert(null);
                    }}
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
                    {editingAlert ? "Update" : "Create"}
                  </Button>
                </div>
              </form>
            </div>
        </ModalPortal>
      </Shell>
    </AuthGate>
  );
}
