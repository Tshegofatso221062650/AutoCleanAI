"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached } from "@/lib/api";
import { AlertTriangle, Search, Zap } from "lucide-react";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";

interface AnomalyDetection {
  id: number;
  dataset_id: string;
  column_name: string;
  anomaly_type: string;
  anomaly_value: string;
  confidence: number;
  detected_at: string;
}

export default function AnomalyDetectionPage() {
  const [datasets, setDatasets] = useState<any[]>(
    () => getCached<{ items: any[] }>("/history")?.items ?? []
  );
  const [selectedDataset, setSelectedDataset] = useState("");
  const [detections, setDetections] = useState<AnomalyDetection[]>([]);
  const [loading, setLoading] = useState(
    () => getCached("/history") === null
  );
  const [detecting, setDetecting] = useState(false);
  const [method, setMethod] = useState("statistical");

  useEffect(() => {
    loadDatasets();
  }, []);

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

  const handleDetectAnomalies = async () => {
    if (!selectedDataset) return;
    
    setDetecting(true);
    try {
      const data = await apiFetch("/anomaly/detect", {
        method: "POST",
        body: JSON.stringify({ dataset_id: selectedDataset, method }),
      });
      setDetections(data.detections || []);
      showToast(`Detected ${data.count} anomalies`, "success");
    } catch (error) {
      console.error("Failed to detect anomalies:", error);
      showToast("Failed to detect anomalies", "error");
    } finally {
      setDetecting(false);
    }
  };

  const handleClearDetections = async () => {
    if (!selectedDataset) return;
    
    try {
      await apiFetch(`/anomaly/${selectedDataset}`, { method: "DELETE" });
      setDetections([]);
      showToast("Anomaly detections cleared", "success");
    } catch (error) {
      console.error("Failed to clear detections:", error);
      showToast("Failed to clear detections", "error");
    }
  };

  if (loading) {
    return (
      <AuthGate>
        <Shell>
          <div className="space-y-6">
            <div className="h-16 skeleton rounded-2xl" />
            <div className="grid lg:grid-cols-3 gap-6">
              <div className="space-y-4">
                <div className="h-24 skeleton rounded-xl" />
                <div className="h-24 skeleton rounded-xl" />
              </div>
              <div className="lg:col-span-2 h-64 skeleton rounded-xl" />
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
            <AlertTriangle className="w-3 h-3" />
            <span>Anomaly Detection</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">ML-based Anomaly Detection</span></h1>
          <p className="text-sm text-app-muted mt-1">Automatically flag unusual data patterns using machine learning</p>
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

            <div className="glass-card rounded-xl p-4">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-3">Detection Method</h3>
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value)}
                className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
              >
                <option value="statistical">Statistical (Z-Score)</option>
                <option value="isolation_forest">Isolation Forest</option>
              </select>
            </div>

            <div className="space-y-2">
              <Button
                onClick={handleDetectAnomalies}
                disabled={!selectedDataset || detecting}
                variant="primary"
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm"
              >
                <Search className="w-4 h-4" />
                {detecting ? "Detecting..." : "Detect Anomalies"}
              </Button>
              <Button
                onClick={handleClearDetections}
                disabled={!selectedDataset}
                variant="secondary"
                className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg border border-edge/40 text-app-muted"
              >
                <Zap className="w-4 h-4" />
                Clear Detections
              </Button>
            </div>
          </div>

          <div className="lg:col-span-2">
            {selectedDataset ? (
              <div className="glass-card rounded-xl overflow-hidden">
                <div className="p-4 border-b border-edge/40">
                  <h3 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle">Anomaly Detections</h3>
                </div>
                <div className="p-4">
                  {detections.length === 0 ? (
                    <div className="text-center py-8 space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-edge/30 flex items-center justify-center mx-auto">
                        <AlertTriangle className="w-6 h-6 text-app-subtle" />
                      </div>
                      <h3 className="text-base font-semibold text-app-text">No anomalies detected</h3>
                      <p className="text-sm text-app-muted">Click "Detect Anomalies" to scan the selected dataset</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {detections.map((detection) => (
                        <div key={detection.id} className="p-4 rounded-lg bg-panel/40 border border-edge/40">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <div className="font-medium text-app-text">{detection.column_name}</div>
                              <div className="text-sm text-app-muted">Type: {detection.anomaly_type}</div>
                            </div>
                            <div className="flex flex-col items-end">
                              <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-accent/10 text-accent">
                                {(detection.confidence * 100).toFixed(0)}% confidence
                              </span>
                            </div>
                          </div>
                          {detection.anomaly_value && (
                            <div className="text-xs text-app-subtle mt-1">
                              Value: {detection.anomaly_value}
                            </div>
                          )}
                          <div className="text-xs text-app-subtle mt-1">
                            Detected at: {new Date(detection.detected_at).toLocaleString()}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="glass-card rounded-xl p-10 text-center space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-edge/30 flex items-center justify-center mx-auto">
                  <AlertTriangle className="w-6 h-6 text-app-subtle" />
                </div>
                <h3 className="text-base font-semibold text-app-text">No dataset selected</h3>
                <p className="text-sm text-app-muted">Select a dataset to detect anomalies</p>
              </div>
            )}
          </div>
        </div>
      </Shell>
    </AuthGate>
  );
}
