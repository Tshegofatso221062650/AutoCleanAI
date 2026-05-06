"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached } from "@/lib/api";
import { Tag, Plus, X, Search } from "lucide-react";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";

interface Dataset {
  id: string;
  original_filename: string;
}

export default function TagsPage() {
  const [datasets, setDatasets] = useState<Dataset[]>(
    () => getCached<{ items: Dataset[] }>("/history")?.items ?? []
  );
  const [selectedDataset, setSelectedDataset] = useState<string>("");
  const [datasetTags, setDatasetTags] = useState<string[]>([]);
  const [allTags, setAllTags] = useState<string[]>([]);
  const [newTag, setNewTag] = useState("");
  const [loading, setLoading] = useState(
    () => getCached("/history") === null
  );

  useEffect(() => {
    loadDatasets();
    loadAllTags();
  }, []);

  useEffect(() => {
    if (selectedDataset) {
      loadDatasetTags(selectedDataset);
    }
  }, [selectedDataset]);

  const loadDatasets = async () => {
    try {
      const data = await apiFetch("/history");
      setDatasets(data.items || []);
    } catch (error) {
      console.error("Failed to load datasets:", error);
    } finally {
      setLoading(false);
    }
  };

  const loadDatasetTags = async (datasetId: string) => {
    try {
      const data = await apiFetch(`/tags/dataset/${datasetId}`);
      setDatasetTags(data.tags || []);
    } catch (error) {
      console.error("Failed to load dataset tags:", error);
    }
  };

  const loadAllTags = async () => {
    try {
      const data = await apiFetch("/tags");
      setAllTags(data.tags || []);
    } catch (error) {
      console.error("Failed to load all tags:", error);
    }
  };

  const handleAddTag = async () => {
    if (!newTag.trim() || !selectedDataset) return;
    
    try {
      await apiFetch("/tags", {
        method: "POST",
        body: JSON.stringify({ dataset_id: selectedDataset, tag: newTag.trim() }),
      });
      showToast("Tag added successfully", "success");
      setNewTag("");
      loadDatasetTags(selectedDataset);
      loadAllTags();
    } catch (error) {
      console.error("Failed to add tag:", error);
      showToast("Failed to add tag", "error");
    }
  };

  const handleRemoveTag = async (tag: string) => {
    if (!selectedDataset) return;
    
    try {
      await apiFetch(`/tags/${selectedDataset}/${tag}`, { method: "DELETE" });
      showToast("Tag removed successfully", "success");
      loadDatasetTags(selectedDataset);
      loadAllTags();
    } catch (error) {
      console.error("Failed to remove tag:", error);
      showToast("Failed to remove tag", "error");
    }
  };

  const handleAddExistingTag = async (tag: string) => {
    if (!selectedDataset) return;
    
    try {
      await apiFetch("/tags", {
        method: "POST",
        body: JSON.stringify({ dataset_id: selectedDataset, tag }),
      });
      showToast("Tag added successfully", "success");
      loadDatasetTags(selectedDataset);
    } catch (error) {
      console.error("Failed to add tag:", error);
      showToast("Failed to add tag", "error");
    }
  };

  const getDatasetName = (id: string) => {
    const dataset = datasets.find(d => d.id === id);
    return dataset ? dataset.original_filename : "Unknown";
  };

  if (loading) {
    return (
      <AuthGate>
        <Shell>
          <div className="space-y-6">
            <div className="h-16 skeleton rounded-2xl" />
            <div className="grid lg:grid-cols-3 gap-6">
              <div className="h-48 skeleton rounded-xl" />
              <div className="lg:col-span-2 h-48 skeleton rounded-xl" />
            </div>
          </div>
        </Shell>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <Shell>
        <div className="mb-6 animate-fade-in-down">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
            <Tag className="w-3 h-3" />
            <span>Tags</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Dataset Tagging</span></h1>
          <p className="text-sm text-app-muted mt-1">Organize datasets with tags and custom metadata</p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          <div className="lg:col-span-1 space-y-4">
            <div className="glass-card rounded-xl p-4">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-3">Select Dataset</h3>
              <select
                value={selectedDataset}
                onChange={(e) => setSelectedDataset(e.target.value)}
                className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <option value="">Choose a dataset...</option>
                {datasets.map((d) => (
                  <option key={d.id} value={d.id}>{d.original_filename}</option>
                ))}
              </select>
            </div>

            {allTags.length > 0 && (
              <div className="glass-card rounded-xl p-4">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-3">All Tags</h3>
                <div className="flex flex-wrap gap-2">
                  {allTags.map((tag) => (
                    <Button
                      key={tag}
                      onClick={() => selectedDataset && handleAddExistingTag(tag)}
                      disabled={!selectedDataset}
                      variant="secondary"
                      size="sm"
                      className="px-2 py-1 rounded bg-accent/20 text-accent text-xs hover:bg-accent/30 disabled:opacity-50"
                    >
                      + {tag}
                    </Button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="lg:col-span-2">
            {selectedDataset ? (
              <div className="glass-card rounded-xl p-4">
                <h3 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-3">
                  Tags — {getDatasetName(selectedDataset)}
                </h3>

                <div className="mb-4">
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={newTag}
                      onChange={(e) => setNewTag(e.target.value)}
                      onKeyPress={(e) => e.key === "Enter" && handleAddTag()}
                      className="flex-1 bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                      placeholder="Add new tag..."
                    />
                    <Button
                      onClick={handleAddTag}
                      disabled={!newTag.trim()}
                      variant="primary"
                      className="px-4 py-2 rounded-lg font-semibold text-sm"
                    >
                      Add
                    </Button>
                  </div>
                </div>

                {datasetTags.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {datasetTags.map((tag) => (
                      <div
                        key={tag}
                        className="flex items-center gap-1 px-3 py-1 rounded bg-accent/20 text-accent text-sm"
                      >
                        <Tag className="w-3 h-3" />
                        {tag}
                        <Button
                          onClick={() => handleRemoveTag(tag)}
                          variant="ghost"
                          size="sm"
                          className="ml-1 p-0 text-accent hover:text-app-text transition-colors"
                        >
                          <X className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8">
                    <Tag className="w-8 h-8 text-app-subtle mx-auto mb-2" />
                    <p className="text-sm text-app-muted">No tags yet. Add tags to organize this dataset.</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="glass-card rounded-xl p-10 text-center">
                <div className="w-12 h-12 rounded-2xl bg-edge/30 flex items-center justify-center mx-auto mb-3">
                  <Tag className="w-6 h-6 text-app-subtle" />
                </div>
                <h3 className="text-base font-semibold text-app-text mb-1">No dataset selected</h3>
                <p className="text-sm text-app-muted">Select a dataset to view and manage its tags</p>
              </div>
            )}
          </div>
        </div>
      </Shell>
    </AuthGate>
  );
}
