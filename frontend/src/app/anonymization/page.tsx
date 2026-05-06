"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached } from "@/lib/api";
import { Shield, Eye, EyeOff, Search, Wand2 } from "lucide-react";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";

interface PIIDetection {
  id: number;
  column_name: string;
  pii_type: string;
  detection_method: string;
  detected_at: string;
}

export default function AnonymizationPage() {
  const [datasets, setDatasets] = useState<any[]>(
    () => getCached<{ items: any[] }>("/history")?.items ?? []
  );
  const [selectedDataset, setSelectedDataset] = useState("");
  const [detections, setDetections] = useState<PIIDetection[]>([]);
  const [loading, setLoading] = useState(
    () => getCached("/history") === null
  );
  const [scanning, setScanning] = useState(false);
  const [masking, setMasking] = useState(false);
  const [maskColumn, setMaskColumn] = useState("");
  const [maskMethod, setMaskMethod] = useState("replace");
  const [maskResult, setMaskResult] = useState<any | null>(null);

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

  const handleMask = async () => {
    if (!selectedDataset || !maskColumn) {
      showToast("Select a dataset and column to mask", "error");
      return;
    }
    setMasking(true);
    try {
      const res = await apiFetch("/anonymization/mask", {
        method: "POST",
        body: JSON.stringify({
          dataset_id: selectedDataset,
          column_name: maskColumn,
          masking_method: maskMethod,
        }),
      });
      setMaskResult(res);
      showToast("Masking completed", "success");
    } catch (error) {
      console.error("Failed to mask:", error);
      showToast("Failed to mask column", "error");
    } finally {
      setMasking(false);
    }
  };

  const handleDetectPII = async () => {
    if (!selectedDataset) return;
    
    setScanning(true);
    try {
      const data = await apiFetch("/anonymization/detect", {
        method: "POST",
        body: JSON.stringify({ dataset_id: selectedDataset }),
      });
      setDetections(data.detections || []);
      const firstCol = (data.detections || [])[0]?.column_name;
      if (firstCol) setMaskColumn(firstCol);
      showToast(`Detected ${data.count} PII instances`, "success");
    } catch (error) {
      console.error("Failed to detect PII:", error);
      showToast("Failed to detect PII", "error");
    } finally {
      setScanning(false);
    }
  };

  const getPIITypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      email: "Email Address",
      phone: "Phone Number",
      ssn: "Social Security Number",
      credit_card: "Credit Card",
    };
    return labels[type] || type;
  };

  if (loading) {
    return (
      <AuthGate>
        <Shell>
          <div className="space-y-6">
            <div className="h-16 skeleton rounded-2xl" />
            <div className="grid lg:grid-cols-3 gap-6">
              <div className="space-y-4">
                <div className="h-28 skeleton rounded-xl" />
                <div className="h-28 skeleton rounded-xl" />
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
            <Shield className="w-3 h-3" />
            <span>Privacy</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Data Anonymization</span></h1>
          <p className="text-sm text-app-muted mt-1">Automatic PII detection and masking/anonymization</p>
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
              <Button
                onClick={handleDetectPII}
                disabled={!selectedDataset || scanning}
                variant="primary"
                className="w-full mt-3 flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm"
              >
                <Search className="w-4 h-4" />
                {scanning ? "Scanning..." : "Detect PII"}
              </Button>
            </div>

            <div className="glass-card rounded-xl p-4">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-3">Mask / Anonymize</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Column</label>
                  <select
                    value={maskColumn}
                    onChange={(e) => setMaskColumn(e.target.value)}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40 disabled:opacity-50"
                    disabled={!selectedDataset}
                  >
                    <option value="">Select column...</option>
                    {Array.from(new Set(detections.map((d) => d.column_name))).map((col) => (
                      <option key={col} value={col}>
                        {col}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Method</label>
                  <select
                    value={maskMethod}
                    onChange={(e) => setMaskMethod(e.target.value)}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-accent/40"
                  >
                    <option value="replace">Replace (*** )</option>
                    <option value="partial">Partial (keep last 4)</option>
                    <option value="hash">Hash (sha256)</option>
                  </select>
                </div>
                <Button
                  onClick={handleMask}
                  disabled={!selectedDataset || !maskColumn || masking}
                  variant="primary"
                  className="w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm"
                >
                  <Wand2 className="w-4 h-4" />
                  {masking ? "Masking..." : "Mask Column"}
                </Button>
              </div>
            </div>

            <div className="glass-card rounded-xl p-4">
              <h3 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-3">PII Types</h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-app-muted">
                  <EyeOff className="w-4 h-4 text-accent" />
                  <span>Email Addresses</span>
                </div>
                <div className="flex items-center gap-2 text-app-muted">
                  <EyeOff className="w-4 h-4 text-accent" />
                  <span>Phone Numbers</span>
                </div>
                <div className="flex items-center gap-2 text-app-muted">
                  <Shield className="w-4 h-4 text-accent" />
                  <span>Social Security Numbers</span>
                </div>
                <div className="flex items-center gap-2 text-app-muted">
                  <Eye className="w-4 h-4 text-accent" />
                  <span>Credit Card Numbers</span>
                </div>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2">
            {selectedDataset ? (
              <div className="glass-card rounded-xl overflow-hidden">
                <div className="p-4 border-b border-edge/40">
                  <h3 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle">PII Detections</h3>
                </div>
                <div className="p-4">
                  {maskResult?.export_paths?.xlsx && (
                    <div className="mb-4 p-3 rounded-lg bg-accent/5 border border-accent/20">
                      <div className="text-sm text-app-muted">Masked export created.</div>
                      <div className="text-xs text-app-subtle break-all">{maskResult.export_paths.xlsx}</div>
                    </div>
                  )}
                  {detections.length === 0 ? (
                    <div className="text-center py-8 space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-edge/30 flex items-center justify-center mx-auto">
                        <Search className="w-6 h-6 text-app-subtle" />
                      </div>
                      <h3 className="text-base font-semibold text-app-text">No PII detected</h3>
                      <p className="text-sm text-app-muted">Click "Detect PII" to scan the selected dataset</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {detections.map((detection) => (
                        <div key={detection.id} className="p-4 rounded-lg bg-panel/40 border border-edge/40">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <div className="font-medium text-app-text">{detection.column_name}</div>
                              <div className="text-sm text-app-muted">Method: {detection.detection_method}</div>
                            </div>
                            <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-accent/10 text-accent">
                              {getPIITypeLabel(detection.pii_type)}
                            </span>
                          </div>
                          <div className="text-xs text-app-subtle">
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
                  <Shield className="w-6 h-6 text-app-subtle" />
                </div>
                <h3 className="text-base font-semibold text-app-text">No dataset selected</h3>
                <p className="text-sm text-app-muted">Select a dataset to scan for PII</p>
              </div>
            )}
          </div>
        </div>
      </Shell>
    </AuthGate>
  );
}
