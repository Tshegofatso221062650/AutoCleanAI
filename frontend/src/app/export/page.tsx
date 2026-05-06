"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached } from "@/lib/api";
import { showConfirm } from "@/lib/confirm";
import { Download, Database, Trash2, Plus, XCircle, CheckCircle, Pencil, Play } from "lucide-react";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import { ModalPortal } from "@/components/ModalPortal";

interface DatabaseConnection {
  id: number;
  name: string;
  db_type: string;
  host: string | null;
  port: number | null;
  database: string | null;
  username: string | null;
  connection_string: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface Dataset {
  id: string;
  original_filename: string;
}

export default function ExportPage() {
  const [connections, setConnections] = useState<DatabaseConnection[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>(
    () => getCached<{ items: Dataset[] }>("/history")?.items ?? []
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportingConn, setExportingConn] = useState<DatabaseConnection | null>(null);
  const [exportForm, setExportForm] = useState({ dataset_id: "", table_name: "" });
  const [exporting, setExporting] = useState(false);
  const [editingConn, setEditingConn] = useState<DatabaseConnection | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [formData, setFormData] = useState({
    name: "",
    db_type: "postgresql",
    host: "",
    port: "5432",
    database: "",
    username: "",
    password: "",
    connection_string: "",
  });

  useEffect(() => {
    loadConnections();
    loadDatasets();
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showCreateModal) {
        setShowCreateModal(false);
        setEditingConn(null);
      }
    };
    if (showCreateModal) {
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }
  }, [showCreateModal]);

  const loadConnections = async () => {
    try {
      const data = await apiFetch("/export/connections");
      setConnections(data.connections || []);
    } catch (error) {
      console.error("Failed to load database connections:", error);
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

  const openExportModal = (conn: DatabaseConnection) => {
    setExportingConn(conn);
    setExportForm({ dataset_id: "", table_name: "" });
    setShowExportModal(true);
  };

  const handleExportNow = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!exportingConn || !exportForm.dataset_id || !exportForm.table_name) return;
    setExporting(true);
    try {
      await apiFetch("/export/export", {
        method: "POST",
        body: JSON.stringify({
          dataset_id: exportForm.dataset_id,
          connection_id: exportingConn.id,
          table_name: exportForm.table_name,
        }),
      });
      showToast("Export job queued successfully", "success");
      setShowExportModal(false);
    } catch (error) {
      console.error("Failed to trigger export:", error);
      showToast("Failed to queue export job", "error");
    } finally {
      setExporting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      if (editingConn) {
        await apiFetch(`/export/connections/${editingConn.id}`, {
          method: "PUT",
          body: JSON.stringify(formData),
        });
      } else {
        await apiFetch("/export/connections", {
          method: "POST",
          body: JSON.stringify(formData),
        });
      }
      showToast(`Database connection ${editingConn ? "updated" : "created"} successfully`, "success");
      setShowCreateModal(false);
      setEditingConn(null);
      resetForm();
      loadConnections();
    } catch (error) {
      console.error("Failed to save database connection:", error);
      showToast("Failed to save database connection", "error");
    }
  };

  const handleDelete = async (id: number) => {
    if (!await showConfirm("Delete this database connection? This cannot be undone.")) return;
    
    try {
      await apiFetch(`/export/connections/${id}`, { method: "DELETE" });
      showToast("Database connection deleted successfully", "success");
      loadConnections();
    } catch (error) {
      console.error("Failed to delete database connection:", error);
      showToast("Failed to delete database connection", "error");
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      db_type: "postgresql",
      host: "",
      port: "5432",
      database: "",
      username: "",
      password: "",
      connection_string: "",
    });
  };

  const handleEdit = (conn: DatabaseConnection) => {
    setEditingConn(conn);
    setFormData({
      name: conn.name,
      db_type: conn.db_type,
      host: conn.host || "",
      port: conn.port?.toString() || "5432",
      database: conn.database || "",
      username: conn.username || "",
      password: "",
      connection_string: conn.connection_string || "",
    });
    setShowCreateModal(true);
  };

  const getDbTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      postgresql: "PostgreSQL",
      mysql: "MySQL",
      sqlite: "SQLite",
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
              <Database className="w-3 h-3" />
              <span>Database Export</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Export to Database</span></h1>
            <p className="text-sm text-app-muted mt-1">Configure database connections for direct data export</p>
          </div>
          <Button
            onClick={() => {
              resetForm();
              setEditingConn(null);
              setShowCreateModal(true);
            }}
            variant="primary"
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm"
          >
            <Plus className="w-4 h-4" />
            Add Connection
          </Button>
        </div>

        {connections.length === 0 ? (
          <div className="glass-card rounded-xl p-10 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-edge/30 flex items-center justify-center mx-auto">
              <Database className="w-6 h-6 text-app-subtle" />
            </div>
            <h3 className="text-base font-semibold text-app-text">No database connections</h3>
            <p className="text-sm text-app-muted">Add a database connection to enable direct data export</p>
            <Button
              onClick={() => {
                resetForm();
                setEditingConn(null);
                setShowCreateModal(true);
              }}
              variant="primary"
              className="px-4 py-2 rounded-lg font-semibold text-sm"
            >
              Add First Connection
            </Button>
          </div>
        ) : (
          <div className="glass-card rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-edge/40">
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Name</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Type</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Host</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Database</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Status</th>
                  <th className="p-4 text-right text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {connections.map((conn) => (
                  <tr key={conn.id} className="border-t border-edge/20 hover:bg-accent/5 transition-colors">
                    <td className="p-4">
                      <div className="font-medium text-app-text">{conn.name}</div>
                    </td>
                    <td className="p-4">
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-accent2/10 text-accent2">
                        {getDbTypeLabel(conn.db_type)}
                      </span>
                    </td>
                    <td className="p-4 text-sm text-app-muted">
                      {conn.host || conn.connection_string ? (conn.host || "Connection string") : "—"}
                    </td>
                    <td className="p-4 text-sm text-app-muted">{conn.database || "—"}</td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-accent" />
                        <span className="text-xs text-app-muted">Configured</span>
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          onClick={() => openExportModal(conn)}
                          variant="ghost"
                          size="sm"
                          className="p-1.5 rounded text-app-subtle hover:text-accent transition-colors"
                          title="Export dataset to this connection"
                        >
                          <Play className="w-4 h-4" />
                        </Button>
                        <Button
                          onClick={() => handleEdit(conn)}
                          variant="ghost"
                          size="sm"
                          className="p-1.5 rounded text-app-subtle hover:text-app-muted transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          onClick={() => handleDelete(conn.id)}
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

        {/* Export Now Modal */}
        {exportingConn && <ModalPortal open={showExportModal} onClose={() => setShowExportModal(false)}>
            <div className="modal-card rounded-2xl p-6 w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto custom-scrollbar">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-base font-semibold text-app-text">Export to {exportingConn.name}</h2>
                <Button onClick={() => setShowExportModal(false)} variant="ghost" size="sm" className="p-1 rounded text-app-subtle hover:text-app-muted">
                  <XCircle className="w-5 h-5" />
                </Button>
              </div>
              <form onSubmit={handleExportNow} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Dataset to Export</label>
                  <select
                    required
                    value={exportForm.dataset_id}
                    onChange={(e) => setExportForm({ ...exportForm, dataset_id: e.target.value })}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                  >
                    <option value="">Select a dataset...</option>
                    {datasets.map((d) => (
                      <option key={d.id} value={d.id}>{d.original_filename}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Target Table Name</label>
                  <input
                    type="text"
                    required
                    value={exportForm.table_name}
                    onChange={(e) => setExportForm({ ...exportForm, table_name: e.target.value })}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text font-mono focus:outline-none focus:ring-2 focus:ring-accent/40"
                    placeholder="e.g., cleaned_customers"
                  />
                </div>
                <div className="flex gap-2 pt-2">
                  <Button type="button" onClick={() => setShowExportModal(false)} variant="secondary" className="flex-1 px-4 py-2 rounded-lg border border-edge/40 text-app-muted">
                    Cancel
                  </Button>
                  <Button type="submit" variant="primary" disabled={exporting} className="flex-1 px-4 py-2 rounded-lg flex items-center justify-center gap-2">
                    <Download className="w-4 h-4" />
                    {exporting ? "Queuing..." : "Export Now"}
                  </Button>
                </div>
              </form>
            </div>
        </ModalPortal>}

        <ModalPortal open={showCreateModal} onClose={() => { setShowCreateModal(false); setEditingConn(null); }}>
            <div className="modal-card rounded-2xl p-6 w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto custom-scrollbar">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-base font-semibold text-app-text">
                  {editingConn ? "Edit Database Connection" : "Add Database Connection"}
                </h2>
                <Button
                  onClick={() => {
                    setShowCreateModal(false);
                    setEditingConn(null);
                  }}
                  variant="ghost"
                  size="sm"
                  className="p-1 rounded text-app-subtle hover:text-app-muted"
                >
                  <XCircle className="w-5 h-5" />
                </Button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Connection Name</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                    placeholder="e.g., Production Database"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Database Type</label>
                  <select
                    value={formData.db_type}
                    onChange={(e) => setFormData({ ...formData, db_type: e.target.value })}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                  >
                    <option value="postgresql">PostgreSQL</option>
                    <option value="mysql">MySQL</option>
                    <option value="sqlite">SQLite</option>
                  </select>
                </div>

                {formData.db_type !== "sqlite" && (
                  <>                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Host</label>
                      <input
                        type="text"
                        value={formData.host}
                        onChange={(e) => setFormData({ ...formData, host: e.target.value })}
                        className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                        placeholder="e.g., localhost"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Port</label>
                      <input
                        type="text"
                        value={formData.port}
                        onChange={(e) => setFormData({ ...formData, port: e.target.value })}
                        className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                        placeholder="e.g., 5432"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Database Name</label>
                      <input
                        type="text"
                        value={formData.database}
                        onChange={(e) => setFormData({ ...formData, database: e.target.value })}
                        className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                        placeholder="e.g., mydatabase"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Username</label>
                      <input
                        type="text"
                        value={formData.username}
                        onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                        className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                        placeholder="e.g., admin"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Password</label>
                      <input
                        type="password"
                        value={formData.password}
                        onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                        className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                        placeholder="••••••••"
                      />
                    </div>
                  </>
                )}

                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Connection String (optional)</label>
                  <input
                    type="text"
                    value={formData.connection_string}
                    onChange={(e) => setFormData({ ...formData, connection_string: e.target.value })}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text font-mono focus:outline-none focus:ring-2 focus:ring-accent/40"
                    placeholder="postgresql://user:pass@localhost:5432/db"
                  />
                </div>

                <div className="flex gap-2 pt-4">
                  <Button
                    type="button"
                    onClick={() => {
                      setShowCreateModal(false);
                      setEditingConn(null);
                    }}
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
                    {editingConn ? "Update" : "Create"}
                  </Button>
                </div>
              </form>
            </div>
        </ModalPortal>
      </Shell>
    </AuthGate>
  );
}
