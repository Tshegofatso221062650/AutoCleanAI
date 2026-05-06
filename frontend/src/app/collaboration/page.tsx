"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached } from "@/lib/api";
import { showConfirm } from "@/lib/confirm";
import { Users, Share2, X } from "lucide-react";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import { ModalPortal } from "@/components/ModalPortal";

interface Dataset {
  id: string;
  original_filename: string;
}

interface SharedItem {
  id: number;
  item_type: string;
  item_id: string;
  shared_with: string;
  shared_by: string;
  permissions: string;
  created_at: string;
}

export default function CollaborationPage() {
  const [sharedWithMe, setSharedWithMe] = useState<SharedItem[]>([]);
  const [sharedByMe, setSharedByMe] = useState<SharedItem[]>([]);
  const [datasets, setDatasets] = useState<Dataset[]>(
    () => getCached<{ items: Dataset[] }>("/history")?.items ?? []
  );
  const [users, setUsers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [showShareModal, setShowShareModal] = useState(false);

  const [formData, setFormData] = useState({
    item_type: "dataset",
    item_id: "",
    shared_with: "",
    permissions: "view",
  });

  useEffect(() => {
    loadSharedItems();
    apiFetch("/history")
      .then((d) => setDatasets(d.items || []))
      .catch(() => {});
    apiFetch("/users/names")
      .then((d) => setUsers((d.users || []).map((u: { username: string }) => u.username)))
      .catch(() => {});
  }, []);

  const loadSharedItems = async () => {
    try {
      const [withMe, byMe] = await Promise.all([
        apiFetch("/collaboration/shared-with-me"),
        apiFetch("/collaboration/shared-by-me"),
      ]);
      setSharedWithMe(withMe.items || []);
      setSharedByMe(byMe.items || []);
    } catch (error) {
      console.error("Failed to load shared items:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/collaboration/share", {
        method: "POST",
        body: JSON.stringify(formData),
      });
      showToast("Item shared successfully", "success");
      setShowShareModal(false);
      setFormData({ item_type: "dataset", item_id: "", shared_with: "", permissions: "view" });
      loadSharedItems();
    } catch (error) {
      console.error("Failed to share item:", error);
      showToast("Failed to share item", "error");
    }
  };

  const handleUnshare = async (shareId: number) => {
    if (!await showConfirm("Unshare this item? The other user will lose access.")) return;
    
    try {
      await apiFetch(`/collaboration/${shareId}`, { method: "DELETE" });
      showToast("Item unshared successfully", "success");
      loadSharedItems();
    } catch (error) {
      console.error("Failed to unshare item:", error);
      showToast("Failed to unshare item", "error");
    }
  };

  if (loading) {
    return (
      <AuthGate>
        <Shell>
          <div className="space-y-6">
            <div className="h-16 skeleton rounded-2xl" />
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="h-48 skeleton rounded-xl" />
              <div className="h-48 skeleton rounded-xl" />
            </div>
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
              <Users className="w-3 h-3" />
              <span>Collaboration</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="gradient-text">Sharing &amp; Collaboration</span>
            </h1>
            <p className="text-sm text-app-muted mt-1">Share datasets, pipelines, and reports with team members</p>
          </div>
          <Button
            onClick={() => setShowShareModal(true)}
            variant="primary"
            className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm"
          >
            <Share2 className="w-4 h-4" />
            Share Item
          </Button>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {[
            { title: "Shared With Me", items: sharedWithMe, emptyIcon: Users, emptyMsg: "No items shared with you yet" },
            { title: "Shared By Me",   items: sharedByMe,   emptyIcon: Share2, emptyMsg: "You haven't shared any items yet" },
          ].map(({ title, items, emptyIcon: Icon, emptyMsg }) => (
            <div key={title} className="glass-card rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-edge/30">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle">{title}</h3>
              </div>
              <div className="p-4">
                {items.length === 0 ? (
                  <div className="text-center py-8">
                    <Icon className="w-8 h-8 text-app-subtle mx-auto mb-2" />
                    <p className="text-sm text-app-muted">{emptyMsg}</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {items.map((item) => (
                      <div key={item.id} className="p-3 rounded-lg bg-panel/40 border border-edge/30 hover:bg-accent/5 transition-colors">
                        <div className="flex justify-between items-start mb-1.5">
                          <div>
                            <div className="text-sm font-semibold text-app-text capitalize">{item.item_type}</div>
                            <div className="text-xs text-app-subtle font-mono">ID: {item.item_id.slice(0, 12)}…</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent/10 text-accent">{item.permissions}</span>
                            {title === "Shared By Me" && (
                              <Button onClick={() => handleUnshare(item.id)} variant="ghost" size="sm" className="p-1 rounded text-app-subtle hover:text-danger">
                                <X className="w-3.5 h-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                        <div className="text-xs text-app-muted">
                          {title === "Shared With Me" ? `Shared by: ${item.shared_by}` : `Shared with: ${item.shared_with}`}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <ModalPortal open={showShareModal} onClose={() => setShowShareModal(false)}>
            <div className="modal-card rounded-2xl p-6 w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto custom-scrollbar">
              <div className="flex justify-between items-center mb-5">
                <h2 className="text-base font-semibold text-app-text">Share Item</h2>
                <Button onClick={() => setShowShareModal(false)} variant="ghost" size="sm" className="p-1 rounded text-app-subtle hover:text-app-muted">
                  <X className="w-5 h-5" />
                </Button>
              </div>
              <form onSubmit={handleShare} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Item Type</label>
                  <select
                    value={formData.item_type}
                    onChange={(e) => setFormData({ ...formData, item_type: e.target.value, item_id: "" })}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                  >
                    <option value="dataset">Dataset</option>
                    <option value="pipeline">Pipeline</option>
                    <option value="report">Report</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Item</label>
                  {formData.item_type === "dataset" ? (
                    <select
                      required
                      value={formData.item_id}
                      onChange={(e) => setFormData({ ...formData, item_id: e.target.value })}
                      className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                    >
                      <option value="">Select a dataset…</option>
                      {datasets.map((d) => (
                        <option key={d.id} value={d.id}>{d.original_filename}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      required
                      value={formData.item_id}
                      onChange={(e) => setFormData({ ...formData, item_id: e.target.value })}
                      className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                      placeholder="Enter item ID…"
                    />
                  )}
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Share With (Username)</label>
                  <input
                    type="text"
                    list="users-datalist"
                    required
                    value={formData.shared_with}
                    onChange={(e) => setFormData({ ...formData, shared_with: e.target.value })}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                    placeholder="Type or select a username…"
                  />
                  <datalist id="users-datalist">
                    {users.map((u) => <option key={u} value={u} />)}
                  </datalist>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Permissions</label>
                  <select
                    value={formData.permissions}
                    onChange={(e) => setFormData({ ...formData, permissions: e.target.value })}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                  >
                    <option value="view">View Only</option>
                    <option value="edit">Edit</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div className="flex gap-2 pt-2">
                  <Button
                    type="button"
                    onClick={() => setShowShareModal(false)}
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
                    Share
                  </Button>
                </div>
              </form>
            </div>
        </ModalPortal>
      </Shell>
    </AuthGate>
  );
}
