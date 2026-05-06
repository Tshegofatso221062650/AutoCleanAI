"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch } from "@/lib/api";
import { Database, Play, CheckCircle } from "lucide-react";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";

interface SampleDataset {
  id: string;
  name: string;
  description: string;
  rows: number;
  columns: string[];
}

export default function SampleDatasetsPage() {
  const [datasets, setDatasets] = useState<SampleDataset[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSampleDatasets();
  }, []);

  const loadSampleDatasets = async () => {
    try {
      const data = await apiFetch("/sample-datasets");
      setDatasets(data.datasets || []);
    } catch (error) {
      console.error("Failed to load sample datasets:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadDataset = async (datasetId: string) => {
    setLoading(true);
    try {
      const data = await apiFetch(`/sample-datasets/${datasetId}/load`, {
        method: "POST",
      });
      showToast("Sample dataset loaded successfully", "success");
    } catch (error) {
      console.error("Failed to load sample dataset:", error);
      showToast("Failed to load sample dataset", "error");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <AuthGate>
        <Shell>
          <div className="space-y-6">
            <div className="h-16 skeleton rounded-2xl" />
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
              {[...Array(6)].map((_, i) => <div key={i} className="h-48 skeleton rounded-xl" />)}
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
            <Database className="w-3 h-3" />
            <span>Samples</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Sample Datasets</span></h1>
          <p className="text-sm text-app-muted mt-1">Pre-loaded datasets for testing and onboarding</p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {datasets.map((dataset) => (
            <div key={dataset.id} className="glass-card rounded-xl p-6 flex flex-col">
              <div className="flex items-start justify-between mb-4">
                <div className="p-3 rounded-xl bg-accent/10">
                  <Database className="w-6 h-6 text-accent" />
                </div>
              </div>
              <h3 className="text-base font-semibold text-app-text mb-1">{dataset.name}</h3>
              <p className="text-sm text-app-muted mb-4 flex-1">{dataset.description}</p>
              <div className="space-y-1.5 mb-4">
                <div className="flex justify-between text-xs">
                  <span className="text-app-subtle">Rows</span>
                  <span className="text-app-muted font-medium">{dataset.rows}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-app-subtle">Columns</span>
                  <span className="text-app-muted font-medium">{dataset.columns.length}</span>
                </div>
              </div>
              <div className="flex flex-wrap gap-1 mb-4">
                {dataset.columns.slice(0, 4).map((col) => (
                  <span key={col} className="px-2 py-0.5 rounded-md bg-edge/30 text-xs text-app-subtle">
                    {col}
                  </span>
                ))}
                {dataset.columns.length > 4 && (
                  <span className="px-2 py-0.5 rounded-md bg-edge/30 text-xs text-app-subtle">
                    +{dataset.columns.length - 4} more
                  </span>
                )}
              </div>
              <Button
                onClick={() => handleLoadDataset(dataset.id)}
                disabled={loading}
                variant="primary"
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm"
              >
                {loading ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Loading...
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    Load Dataset
                  </>
                )}
              </Button>
            </div>
          ))}
        </div>
      </Shell>
    </AuthGate>
  );
}
