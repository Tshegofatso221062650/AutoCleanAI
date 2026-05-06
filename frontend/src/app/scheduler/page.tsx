"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached } from "@/lib/api";
import { showConfirm } from "@/lib/confirm";
import { Calendar, Clock, Plus, Trash2, Edit, Pencil, Play, Pause } from "lucide-react";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import { ModalPortal } from "@/components/ModalPortal";

interface ScheduledJob {
  id: number;
  name: string;
  pipeline_id: number;
  schedule_type: string;
  schedule_value: string;
  last_run_at: string | null;
  next_run_at: string;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export default function SchedulerPage() {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [pipelines, setPipelines] = useState<any[]>(
    () => (getCached<any[]>("/pipelines") as any[]) ?? []
  );
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingJob, setEditingJob] = useState<ScheduledJob | null>(null);
  const [loading, setLoading] = useState(
    () => getCached("/scheduler") === null
  );
  
  const [formData, setFormData] = useState({
    name: "",
    pipeline_id: "",
    schedule_type: "daily",
    schedule_value: "09:00",
    is_active: true,
  });

  useEffect(() => {
    loadJobs();
    loadPipelines();
  }, []);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showCreateModal) {
        setShowCreateModal(false);
        setEditingJob(null);
      }
    };
    if (showCreateModal) {
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }
  }, [showCreateModal]);

  const loadJobs = async () => {
    try {
      const data = await apiFetch("/scheduler");
      setJobs(data.jobs || []);
    } catch (error) {
      console.error("Failed to load scheduled jobs:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadPipelines = async () => {
    try {
      const data = await apiFetch("/pipelines");
      setPipelines(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Failed to load pipelines:", error);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const body = {
        ...formData,
        pipeline_id: parseInt(formData.pipeline_id),
      };
      
      if (editingJob) {
        await apiFetch(`/scheduler/${editingJob.id}`, {
          method: "PUT",
          body: JSON.stringify(body),
        });
        showToast("Scheduled job updated successfully", "success");
      } else {
        await apiFetch("/scheduler", {
          method: "POST",
          body: JSON.stringify(body),
        });
        showToast("Scheduled job created successfully", "success");
      }
      
      setShowCreateModal(false);
      setEditingJob(null);
      resetForm();
      loadJobs();
    } catch (error) {
      console.error("Failed to save scheduled job:", error);
      showToast("Failed to save scheduled job", "error");
    }
  };

  const handleDelete = async (id: number) => {
    if (!await showConfirm("Delete this scheduled job? This cannot be undone.")) return;
    
    try {
      await apiFetch(`/scheduler/${id}`, { method: "DELETE" });
      showToast("Scheduled job deleted successfully", "success");
      loadJobs();
    } catch (error) {
      console.error("Failed to delete scheduled job:", error);
      showToast("Failed to delete scheduled job", "error");
    }
  };

  const handleToggleActive = async (job: ScheduledJob) => {
    try {
      await apiFetch(`/scheduler/${job.id}`, {
        method: "PUT",
        body: JSON.stringify({ is_active: !job.is_active }),
      });
      showToast(`Job ${job.is_active ? "paused" : "activated"} successfully`, "success");
      loadJobs();
    } catch (error) {
      console.error("Failed to toggle job status:", error);
      showToast("Failed to toggle job status", "error");
    }
  };

  const resetForm = () => {
    setFormData({
      name: "",
      pipeline_id: "",
      schedule_type: "daily",
      schedule_value: "09:00",
      is_active: true,
    });
  };

  const handleEdit = (job: ScheduledJob) => {
    setEditingJob(job);
    setFormData({
      name: job.name,
      pipeline_id: job.pipeline_id.toString(),
      schedule_type: job.schedule_type,
      schedule_value: job.schedule_value,
      is_active: job.is_active,
    });
    setShowCreateModal(true);
  };

  const getScheduleLabel = (type: string, value: string) => {
    if (type === "daily") return `Daily at ${value}`;
    if (type === "weekly") return `Every ${value}`;
    if (type === "monthly") return `Monthly on day ${value}`;
    return type;
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return "Never";
    return new Date(dateStr).toLocaleString();
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
              <Calendar className="w-3 h-3" />
              <span>Automation</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Scheduled Jobs</span></h1>
            <p className="text-sm text-app-muted mt-1">Automate data cleaning with scheduled pipelines</p>
          </div>
          <Button
            onClick={() => {
              resetForm();
              setEditingJob(null);
              setShowCreateModal(true);
            }}
            variant="primary"
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm"
          >
            <Plus className="w-4 h-4" />
            Schedule Job
          </Button>
        </div>

        {jobs.length === 0 ? (
          <div className="glass-card rounded-xl p-10 text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-edge/30 flex items-center justify-center mx-auto">
              <Clock className="w-6 h-6 text-app-subtle" />
            </div>
            <div>
              <h3 className="text-base font-semibold text-app-text mb-1">No scheduled jobs yet</h3>
              <p className="text-sm text-app-muted max-w-sm mx-auto">
                Scheduled jobs automatically run a <strong>Pipeline</strong> on your latest dataset at a set time.
              </p>
            </div>
            {pipelines.length === 0 ? (
              <div className="inline-flex flex-col items-center gap-3">
                <p className="text-xs text-warn font-medium">You need a Pipeline before you can schedule anything.</p>
                <a
                  href="/pipelines"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/10 text-accent text-sm font-medium hover:bg-accent/20 transition-colors"
                >
                  Create a Pipeline first →
                </a>
              </div>
            ) : (
              <Button
                onClick={() => {
                  resetForm();
                  setEditingJob(null);
                  setShowCreateModal(true);
                }}
                variant="primary"
                className="px-4 py-2 rounded-lg font-semibold text-sm"
              >
                Schedule First Job
              </Button>
            )}
          </div>
        ) : (
          <div className="glass-card rounded-xl overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-edge/40">
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Name</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Pipeline</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Schedule</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Next Run</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Last Run</th>
                  <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Status</th>
                  <th className="p-4 text-right text-[10px] font-semibold text-app-subtle uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => (
                  <tr key={job.id} className="border-t border-edge/20 hover:bg-accent/5 transition-colors">
                    <td className="p-4">
                      <div className="font-medium text-app-text">{job.name}</div>
                    </td>
                    <td className="p-4">
                      <span className="text-xs text-app-subtle font-mono">#{job.pipeline_id}</span>
                    </td>
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-3.5 h-3.5 text-accent" />
                        <span className="text-sm text-app-text">{getScheduleLabel(job.schedule_type, job.schedule_value)}</span>
                      </div>
                    </td>
                    <td className="p-4 text-xs text-app-text">{formatDate(job.next_run_at)}</td>
                    <td className="p-4 text-xs text-app-subtle">{formatDate(job.last_run_at)}</td>
                    <td className="p-4">
                      <Button
                        onClick={() => handleToggleActive(job)}
                        variant="ghost"
                        size="sm"
                        className={`px-3 py-1 rounded-full text-xs font-medium ${
                          job.is_active ? "bg-accent/15 text-accent" : "bg-edge/50 text-app-muted"
                        }`}
                      >
                        {job.is_active ? (
                          <>
                            <Play className="w-3 h-3" />
                            Active
                          </>
                        ) : (
                          <>
                            <Pause className="w-3 h-3" />
                            Paused
                          </>
                        )}
                      </Button>
                    </td>
                    <td className="p-4 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          onClick={() => handleEdit(job)}
                          variant="ghost"
                          size="sm"
                          className="p-1.5 rounded text-app-muted hover:text-app-text transition-colors"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          onClick={() => handleDelete(job.id)}
                          variant="ghost"
                          size="sm"
                          className="p-1.5 rounded text-app-muted hover:text-danger transition-colors"
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

        <ModalPortal open={showCreateModal} onClose={() => { setShowCreateModal(false); setEditingJob(null); }}>
            <div className="modal-card rounded-2xl p-6 w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto custom-scrollbar">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-base font-semibold text-app-text">
                  {editingJob ? "Edit Scheduled Job" : "Create Scheduled Job"}
                </h2>
                <Button
                  onClick={() => {
                    setShowCreateModal(false);
                    setEditingJob(null);
                  }}
                  variant="ghost"
                  size="sm"
                  className="p-1 rounded hover:bg-edge/50 text-app-muted hover:text-app-text"
                >
                  <Trash2 className="w-5 h-5" />
                </Button>
              </div>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm text-app-muted mb-1">Job Name</label>
                  <input
                    type="text"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                    placeholder="e.g., Daily Data Cleaning"
                  />
                </div>
                
                <div>
                  <label className="block text-sm text-app-muted mb-1">Pipeline</label>
                  <select
                    required
                    value={formData.pipeline_id}
                    onChange={(e) => setFormData({ ...formData, pipeline_id: e.target.value })}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                  >
                    <option value="">Select a pipeline</option>
                    {pipelines.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
                
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm text-app-muted mb-1">Schedule Type</label>
                    <select
                      value={formData.schedule_type}
                      onChange={(e) => setFormData({ ...formData, schedule_type: e.target.value })}
                      className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                    >
                      <option value="daily">Daily</option>
                      <option value="weekly">Weekly</option>
                      <option value="monthly">Monthly</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm text-app-muted mb-1">
                      {formData.schedule_type === "daily" ? "Time (HH:MM)" : 
                       formData.schedule_type === "weekly" ? "Day" : "Day of Month"}
                    </label>
                    {formData.schedule_type === "daily" ? (
                      <input
                        type="time"
                        value={formData.schedule_value}
                        onChange={(e) => setFormData({ ...formData, schedule_value: e.target.value })}
                        className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                      />
                    ) : formData.schedule_type === "weekly" ? (
                      <select
                        value={formData.schedule_value}
                        onChange={(e) => setFormData({ ...formData, schedule_value: e.target.value })}
                        className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                      >
                        <option value="Monday">Monday</option>
                        <option value="Tuesday">Tuesday</option>
                        <option value="Wednesday">Wednesday</option>
                        <option value="Thursday">Thursday</option>
                        <option value="Friday">Friday</option>
                        <option value="Saturday">Saturday</option>
                        <option value="Sunday">Sunday</option>
                      </select>
                    ) : (
                      <input
                        type="number"
                        min="1"
                        max="31"
                        value={formData.schedule_value}
                        onChange={(e) => setFormData({ ...formData, schedule_value: e.target.value })}
                        className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                        placeholder="1-31"
                      />
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={formData.is_active}
                    onChange={(e) => setFormData({ ...formData, is_active: e.target.checked })}
                    className="rounded border-edge"
                  />
                  <label className="text-sm text-app-muted">Active (job will run automatically)</label>
                </div>

                <div className="flex gap-2 pt-4">
                  <Button
                    type="button"
                    onClick={() => {
                      setShowCreateModal(false);
                      setEditingJob(null);
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
                    {editingJob ? "Update" : "Create"}
                  </Button>
                </div>
              </form>
            </div>
        </ModalPortal>
      </Shell>
    </AuthGate>
  );
}
