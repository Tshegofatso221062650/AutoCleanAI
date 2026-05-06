"use client";

import { useCallback, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { apiFetch, apiUrl, getToken } from "@/lib/api";
import { UploadCloud, FileSpreadsheet, FileText, Database, Loader2, AlertCircle, Shield, FileIcon, X, Target, CheckCircle, Play, ChevronRight } from "lucide-react";
import { showToast } from "@/components/Toast";

interface Objective {
  id: number;
  name: string;
  description: string | null;
  objective_type: string;
  target_value: string | null;
  column_name: string | null;
  validation_rule: string | null;
  is_template: boolean;
}

export default function UploadPage() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedObjectiveId, setSelectedObjectiveId] = useState<number | null>(null);
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [samples, setSamples] = useState<{ id: string; name: string; description: string; rows: number; columns: string[] }[]>([]);
  const [loadingSample, setLoadingSample] = useState<string | null>(null);

  useEffect(() => {
    fetchObjectives();
    apiFetch("/sample-datasets")
      .then((d) => setSamples(d.datasets || []))
      .catch(() => {});
  }, []);

  const fetchObjectives = async () => {
    try {
      const data = await apiFetch("/objectives");
      setObjectives(data.objectives || []);
    } catch (error) {
      console.error("Failed to fetch objectives:", error);
    }
  };

  const uploadFile = useCallback(
    async (file: File) => {
      setBusy(true);
      setUploadProgress(0);
      setCurrentStep("Validating file format...");
      setMsg(null);
      setSelectedFile(file);
      
      const fd = new FormData();
      fd.append("file", file);
      const t = getToken();
      
      try {
        setCurrentStep("Uploading file...");
        setUploadProgress(30);
        
        const res = await fetch(`${apiUrl("")}/upload`, {
          method: "POST",
          headers: t ? { Authorization: `Bearer ${t}` } : undefined,
          body: fd,
        });
        
        setUploadProgress(70);
        setCurrentStep("Processing dataset...");
        
        if (!res.ok) {
          const errorText = await res.text();
          setMsg(errorText);
          showToast(errorText, "error");
          setBusy(false);
          setSelectedFile(null);
          return;
        }
        
        setUploadProgress(90);
        setCurrentStep("Redirecting to analysis...");
        
        const data = await res.json();
        setUploadProgress(100);
        showToast("Dataset uploaded successfully!", "success");
        
        // Assign objective if selected
        if (selectedObjectiveId) {
          try {
            await apiFetch(`/objectives/datasets/${data.dataset_id}/objectives/${selectedObjectiveId}`, {
              method: "POST",
            });
          } catch (error) {
            console.error("Failed to assign objective:", error);
          }
        }
        
        setTimeout(() => {
          router.push(`/analysis/${data.dataset_id}`);
        }, 500);
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : "Upload failed";
        setMsg(errorMessage);
        showToast(errorMessage, "error");
        setBusy(false);
        setSelectedFile(null);
      }
    },
    [router, selectedObjectiveId],
  );

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + " " + sizes[i];
  };

  return (
    <AuthGate>
      <Shell>
        <div className="max-w-3xl mx-auto space-y-6">
          <div className="mb-2 animate-fade-in-down">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
              <UploadCloud className="w-3 h-3" />
              <span>Upload Dataset</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="gradient-text">Import Your Data</span>
            </h1>
            <p className="text-sm text-app-muted mt-1.5">
              Upload any CSV, Excel, JSON or Parquet file — we'll analyse quality and suggest smart fixes.
            </p>
          </div>

          {/* Objective Selection */}
          <div className="glass-card rounded-2xl p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-lg bg-accent/10 flex items-center justify-center">
                  <Target className="w-3.5 h-3.5 text-accent" />
                </div>
                <div>
                  <h3 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle">
                    Cleaning Objective
                  </h3>
                </div>
                <span className="text-[10px] text-app-subtle/60 font-normal">optional</span>
              </div>
              {selectedObjectiveId && (
                <button
                  onClick={() => setSelectedObjectiveId(null)}
                  className="text-[11px] font-medium text-app-muted hover:text-danger transition-colors"
                >
                  Clear
                </button>
              )}
            </div>

            {objectives.length === 0 ? (
              <p className="text-sm text-app-muted">
                No objectives yet.{" "}
                <a href="/objectives" className="text-accent hover:underline">
                  Create one
                </a>{" "}
                to guide the cleaning process, or skip and upload now.
              </p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-3">
                {objectives.map((obj) => {
                  const isSelected = selectedObjectiveId === obj.id;
                  return (
                    <button
                      key={obj.id}
                      type="button"
                      onClick={() => setSelectedObjectiveId(isSelected ? null : obj.id)}
                      className={`w-full text-left rounded-xl p-4 border transition-all ${
                        isSelected
                          ? "border-accent bg-accent/10 ring-1 ring-accent/30"
                          : "border-edge/30 bg-panel/20 hover:border-accent/50 hover:bg-panel/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="font-medium text-app-text text-sm">{obj.name}</div>
                        {isSelected && <CheckCircle className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />}
                      </div>
                      <div className="text-xs text-app-muted mt-1">
                        {obj.description || obj.objective_type}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {selectedFile && busy && (
            <div className="glass-card rounded-2xl p-5 space-y-4 animate-fade-in">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-accent/10 flex items-center justify-center">
                    <FileIcon className="w-4.5 h-4.5 text-accent" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-app-text truncate max-w-[260px]">{selectedFile.name}</p>
                    <p className="text-xs text-app-muted">{formatFileSize(selectedFile.size)}</p>
                  </div>
                </div>
                <Button
                  onClick={() => {
                    setBusy(false);
                    setSelectedFile(null);
                    setUploadProgress(0);
                    showToast("Upload cancelled", "warning");
                  }}
                  variant="ghost"
                  size="sm"
                  className="p-2 rounded-lg text-app-subtle hover:text-danger"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-app-muted mb-1">
                  <span>{currentStep}</span>
                  <span className="font-semibold text-accent">{uploadProgress}%</span>
                </div>
                <div className="h-1.5 rounded-full bg-edge/60 overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-accent to-accent2 transition-all duration-500 ease-out rounded-full"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              </div>
            </div>
          )}

          <div
            className={`relative overflow-hidden rounded-2xl border-2 border-dashed p-12 text-center transition-all duration-300 cursor-pointer ${
              busy
                ? "border-edge/30 bg-panel/20 cursor-not-allowed opacity-50"
                : dragActive
                ? "border-accent bg-accent/8 shadow-glow-accent"
                : "border-edge/40 bg-panel/20 hover:border-accent/40 hover:bg-accent/5"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              if (!busy) setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragActive(false);
              if (!busy) {
                const f = e.dataTransfer.files[0];
                if (f) void uploadFile(f);
              }
            }}
            onClick={() => {
              if (busy) return;
              const input = document.createElement("input");
              input.type = "file";
              input.accept = ".csv,.xlsx,.xls,.json";
              input.onchange = () => {
                const f = input.files?.[0];
                if (f) void uploadFile(f);
              };
              input.click();
            }}
          >
            {busy ? (
              <div className="flex flex-col items-center gap-4">
                <Loader2 className="w-12 h-12 text-accent animate-spin" />
                <div>
                  <p className="font-medium text-app-text">Processing your dataset...</p>
                  <p className="text-sm text-app-muted mt-1">{currentStep}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex justify-center">
                  <div className={`w-16 h-16 rounded-2xl flex items-center justify-center transition-all duration-300 ${
                    dragActive
                      ? "bg-gradient-to-br from-accent to-accent2 shadow-glow-accent scale-110"
                      : "bg-panel/80 border border-edge/50"
                  }`}>
                    <UploadCloud className={`w-8 h-8 transition-colors duration-300 ${
                      dragActive ? "text-void" : "text-app-muted"
                    }`} />
                  </div>
                </div>
                <div>
                  <p className="text-base font-semibold text-app-text">
                    {dragActive ? "Drop to upload" : "Drop file here or click to browse"}
                  </p>
                  <p className="text-sm text-app-muted mt-1.5">CSV, XLSX, XLS, JSON, Parquet, TSV</p>
                </div>
                <div className="inline-flex items-center gap-1.5 text-[11px] text-app-subtle">
                  <Shield className="w-3 h-3" />
                  <span>Safe mode — source files are never modified</span>
                </div>
              </div>
            )}
          </div>

          {msg && (
            <div className="flex items-center gap-3 p-4 rounded-xl bg-danger/8 border border-danger/20 text-danger animate-fade-in">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <p className="text-sm font-medium">{msg}</p>
            </div>
          )}

          {/* Sample Datasets */}
          {samples.length > 0 && (
            <div className="pt-2">
              <div className="divider-label mb-4">or try a sample dataset</div>
              <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {samples.map((s, i) => (
                  <button
                    key={s.id}
                    disabled={loadingSample === s.id || busy}
                    onClick={async () => {
                      setLoadingSample(s.id);
                      try {
                        await apiFetch(`/sample-datasets/${s.id}/load`, { method: "POST" });
                        showToast(`${s.name} loaded — ready to explore`, "success");
                        router.push("/history");
                      } catch {
                        showToast("Failed to load sample", "error");
                      } finally {
                        setLoadingSample(null);
                      }
                    }}
                    className={`text-left glass-card rounded-xl p-3.5 hover:border-accent/40 hover:bg-accent/5 transition-all group disabled:opacity-50 animate-fade-in-up stagger-${(i % 6) + 1}`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-sm font-semibold text-app-text group-hover:text-accent transition-colors">{s.name}</span>
                      {loadingSample === s.id
                        ? <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
                        : <ChevronRight className="w-3.5 h-3.5 text-app-muted group-hover:text-accent transition-colors" />}
                    </div>
                    <p className="text-xs text-app-muted line-clamp-1">{s.description}</p>
                    <p className="text-[11px] text-app-subtle mt-1 font-medium">{s.rows.toLocaleString()} rows · {s.columns.length} cols</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid sm:grid-cols-3 gap-3 pt-2">
            {[
              { label: "CSV / TSV",   sub: "Comma or tab separated", icon: FileSpreadsheet, color: "accent" },
              { label: "Excel",        sub: "XLSX, XLS",              icon: Database,        color: "accent2" },
              { label: "JSON / Parquet", sub: "Structured data",      icon: FileText,        color: "warn" },
            ].map(({ label, sub, icon: Icon, color }, i) => (
              <div key={label} className={`glass-card rounded-xl p-4 text-center animate-fade-in-up stagger-${i + 1}`}>
                <div className={`w-9 h-9 mx-auto mb-2.5 rounded-lg bg-${color}/10 flex items-center justify-center`}>
                  <Icon className={`w-4.5 h-4.5 text-${color}`} />
                </div>
                <div className="text-sm font-semibold text-app-text">{label}</div>
                <div className="text-[11px] text-app-muted mt-0.5">{sub}</div>
              </div>
            ))}
          </div>
        </div>
      </Shell>
    </AuthGate>
  );
}
