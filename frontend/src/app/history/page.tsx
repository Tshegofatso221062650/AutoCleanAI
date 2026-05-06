"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { Button } from "@/components/ui/Button";
import { apiFetch, apiUrl, getCached } from "@/lib/api";
import { showConfirm } from "@/lib/confirm";
import { showToast } from "@/components/Toast";
import { History as HistoryIcon, FileSpreadsheet, Calendar, Grid, TrendingUp, ExternalLink, Sparkles, FolderOpen, Trash2, ChevronDown, ChevronRight, GitBranch, Clock, FileText, Undo2, Redo2, Upload, GitCompare, TableProperties, User, Pencil, Check, X } from "lucide-react";

interface Item {
  id: string;
  original_filename: string;
  created_at: string;
  created_by: string | null;
  last_cleaned_at: string | null;
  row_count: number | null;
  col_count: number | null;
  quality_score: number | null;
  versions?: number;
}

interface Version {
  id: number;
  version_number: number;
  quality_score: number;
  operation_type: string;
  created_at: string;
}

interface LineageEntry {
  id: number;
  operation: string;
  operation_details: string;
  created_at: string;
}

export default function HistoryPage() {
  const [items, setItems] = useState<Item[]>(
    () => getCached<{ items: Item[] }>("/history")?.items ?? []
  );
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [versions, setVersions] = useState<Record<string, Version[]>>({});
  const [lineage, setLineage] = useState<Record<string, LineageEntry[]>>({});
  const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({});
  const [previews, setPreviews] = useState<Record<string, Record<string, unknown>[]>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [sortBy, setSortBy] = useState<"date" | "name" | "quality" | "rows">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const startRename = (id: string, currentName: string) => {
    setRenamingId(id);
    setRenameValue(currentName);
  };

  const submitRename = async () => {
    if (!renamingId || !renameValue.trim()) return;
    try {
      await apiFetch(`/datasets/${renamingId}/rename`, {
        method: "PATCH",
        body: JSON.stringify({ name: renameValue.trim() }),
      });
      setItems((prev) => prev.map((it) => it.id === renamingId ? { ...it, original_filename: renameValue.trim() } : it));
      showToast("Dataset renamed", "success");
    } catch {
      showToast("Rename failed", "error");
    } finally {
      setRenamingId(null);
    }
  };

  useEffect(() => {
    void apiFetch("/history").then((d) => setItems(d.items || []));
  }, []);

  const sortedItems = [...items].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortBy) {
      case "name": return dir * a.original_filename.localeCompare(b.original_filename);
      case "quality": return dir * ((a.quality_score ?? -1) - (b.quality_score ?? -1));
      case "rows": return dir * ((a.row_count ?? 0) - (b.row_count ?? 0));
      default: return dir * (new Date(a.created_at).getTime() - new Date(b.created_at).getTime());
    }
  });
  const paginatedItems = sortedItems.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(sortedItems.length / itemsPerPage);

  const loadDetails = async (datasetId: string) => {
    if (versions[datasetId] && lineage[datasetId]) {
      return;
    }
    
    setLoadingDetails((prev) => ({ ...prev, [datasetId]: true }));
    try {
      const [versionsData, lineageData, previewData] = await Promise.all([
        apiFetch(`/datasets/${datasetId}/versions`),
        apiFetch(`/datasets/${datasetId}/lineage`),
        apiFetch(`/datasets/${datasetId}/preview?rows=5`).catch(() => ({ rows: [] })),
      ]);
      setVersions((prev) => ({ ...prev, [datasetId]: versionsData.versions || [] }));
      setLineage((prev) => ({ ...prev, [datasetId]: lineageData.lineage || [] }));
      if (previewData?.rows?.length) {
        setPreviews((prev) => ({ ...prev, [datasetId]: previewData.rows }));
      }
    } catch (e) {
      console.error("Failed to load details:", e);
    } finally {
      setLoadingDetails((prev) => ({ ...prev, [datasetId]: false }));
    }
  };

  const handleGenerateReport = async (datasetId: string, reportType: "quality" | "cleaning") => {
    try {
      const res = await apiFetch("/reports/generate", {
        method: "POST",
        body: JSON.stringify({ dataset_id: datasetId, report_type: reportType, format: "html" }),
      });
      if (res?.download_url) {
        window.open(apiUrl(res.download_url), "_blank");
        showToast("Report generated", "success");
      } else {
        showToast("Report generated but no download URL returned", "error");
      }
    } catch (e) {
      console.error(e);
      showToast("Failed to generate report", "error");
    }
  };

  const handleUndo = async (datasetId: string) => {
    try {
      await apiFetch(`/undo/${datasetId}/undo`, { method: "POST" });
      showToast("Undo completed", "success");
      setVersions((prev) => ({ ...prev, [datasetId]: [] }));
      setLineage((prev) => ({ ...prev, [datasetId]: [] }));
      loadDetails(datasetId);
      void apiFetch("/history").then((d) => setItems(d.items || []));
    } catch (e) {
      console.error(e);
      showToast("Undo failed", "error");
    }
  };

  const handleRedo = async (datasetId: string) => {
    try {
      await apiFetch(`/undo/${datasetId}/redo`, { method: "POST" });
      showToast("Redo completed", "success");
      setVersions((prev) => ({ ...prev, [datasetId]: [] }));
      setLineage((prev) => ({ ...prev, [datasetId]: [] }));
      loadDetails(datasetId);
      void apiFetch("/history").then((d) => setItems(d.items || []));
    } catch (e) {
      console.error(e);
      showToast("Redo failed", "error");
    }
  };

  const toggleRow = (datasetId: string) => {
    if (expandedRow === datasetId) {
      setExpandedRow(null);
    } else {
      setExpandedRow(datasetId);
      loadDetails(datasetId);
    }
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const allSelected = items.length > 0 && items.every((it) => selectedIds.has(it.id));
  const someSelected = selectedIds.size > 0;

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(items.map((it) => it.id)));
    }
  };

  const handleBulkDelete = async () => {
    const count = selectedIds.size;
    if (!await showConfirm(`Delete ${count} dataset${count > 1 ? "s" : ""}? This cannot be undone.`)) return;
    setBulkDeleting(true);
    try {
      await Promise.all([...selectedIds].map((id) => apiFetch(`/dataset/${id}`, { method: "DELETE" })));
      setItems((prev) => prev.filter((it) => !selectedIds.has(it.id)));
      setSelectedIds(new Set());
      showToast(`${count} dataset${count > 1 ? "s" : ""} deleted`, "success");
    } catch {
      showToast("Some deletions failed — refresh and try again", "error");
    } finally {
      setBulkDeleting(false);
    }
  };

  const handleDelete = async (id: string, filename: string) => {
    if (!await showConfirm(`Delete "${filename}"? This action cannot be undone.`)) {
      return;
    }

    setDeletingId(id);
    try {
      await apiFetch(`/dataset/${id}`, { method: "DELETE" });
      setItems((prev) => prev.filter((item) => item.id !== id));
      showToast("Dataset deleted successfully", "success");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Failed to delete dataset", "error");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <AuthGate>
      <Shell>
        <div className="space-y-8">
          <div className="flex flex-wrap items-start justify-between gap-4 animate-fade-in-down">
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
                <HistoryIcon className="w-3 h-3" />
                <span>Datasets</span>
              </div>
              <h1 className="text-2xl font-bold tracking-tight">
                <span className="gradient-text">Your Datasets</span>
              </h1>
              <p className="text-sm text-app-muted mt-1.5">All your uploaded datasets — inspect, clean, compare, or download</p>
            </div>
            <Link href="/upload">
              <Button variant="primary" size="sm" className="flex items-center gap-2">
                <Upload className="w-4 h-4" />
                Upload New
              </Button>
            </Link>
          </div>

          {/* Bulk action bar */}
          {someSelected && (
            <div className="flex items-center justify-between gap-4 px-4 py-2.5 rounded-xl bg-accent/10 border border-accent/25 text-sm">
              <div className="flex items-center gap-3">
                <span className="font-medium text-accent">{selectedIds.size} selected</span>
                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="text-xs text-app-muted hover:text-app-text underline underline-offset-2"
                >
                  Clear
                </button>
                {!allSelected && (
                  <button
                    onClick={toggleSelectAll}
                    className="text-xs text-app-muted hover:text-app-text underline underline-offset-2"
                  >
                    Select all {items.length}
                  </button>
                )}
              </div>
              <Button
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                variant="danger"
                size="sm"
                className="flex items-center gap-1.5 text-xs font-medium"
              >
                {bulkDeleting ? (
                  <div className="w-3 h-3 border-2 border-danger border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Trash2 className="w-3 h-3" />
                )}
                Delete {selectedIds.size}
              </Button>
            </div>
          )}

          {items.length === 0 ? (
            <div className="text-center py-16 space-y-4">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-edge/30">
                <FolderOpen className="w-8 h-8 text-app-subtle" />
              </div>
              <div>
                <h3 className="text-base font-semibold text-app-text">No datasets yet</h3>
                <p className="text-sm text-app-muted mt-1">Upload your first dataset to get started</p>
              </div>
              <Link
                href="/upload"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-accent text-void border border-accent/50 font-medium hover:bg-accent/90 hover:border-accent/60 transition-all"
              >
                <Sparkles className="w-4 h-4" />
                Upload Dataset
              </Link>
            </div>
          ) : (
            <div className="glass-card rounded-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-edge/30">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-app-subtle">Sort by</span>
                {(["date", "name", "quality", "rows"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => { if (sortBy === s) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortBy(s); setSortDir(s === "quality" ? "desc" : "asc"); } setCurrentPage(1); }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${sortBy === s ? "bg-accent/15 text-accent" : "text-app-muted hover:text-app-text hover:bg-edge/40"}`}
                  >
                    {s.charAt(0).toUpperCase() + s.slice(1)} {sortBy === s ? (sortDir === "asc" ? "↑" : "↓") : ""}
                  </button>
                ))}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-panel/50 border-b border-edge/50">
                    <tr>
                      <th className="pl-4 pr-2 py-4 w-8">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          onChange={toggleSelectAll}
                          className="w-4 h-4 rounded border-edge accent-accent cursor-pointer"
                          title={allSelected ? "Deselect all" : "Select all"}
                        />
                      </th>
                      <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">
                        <div className="flex items-center gap-2">
                          <FileSpreadsheet className="w-4 h-4" />
                          File
                        </div>
                      </th>
                      <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4" />
                          Created
                        </div>
                      </th>
                      <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">
                        <div className="flex items-center gap-2">
                          <Grid className="w-4 h-4" />
                          Shape
                        </div>
                      </th>
                      <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">
                        <div className="flex items-center gap-2">
                          <TrendingUp className="w-4 h-4" />
                          Quality
                        </div>
                      </th>
                      <th className="p-4 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">
                        <div className="flex items-center gap-2">
                          <GitBranch className="w-4 h-4" />
                          Versions
                        </div>
                      </th>
                      <th className="p-4 text-right text-[10px] font-semibold text-app-subtle uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedItems.map((it) => (
                      <>
                        <tr key={it.id} className={`border-t border-edge/30 transition-colors ${selectedIds.has(it.id) ? "bg-accent/5" : "hover:bg-panel/60"}`}>
                          <td className="pl-4 pr-2 py-4 w-8">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(it.id)}
                              onChange={() => toggleSelect(it.id)}
                              className="w-4 h-4 rounded border-edge accent-accent cursor-pointer"
                            />
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <Button
                                onClick={() => toggleRow(it.id)}
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="p-1 hover:bg-edge/50 rounded transition-colors"
                              >
                                {expandedRow === it.id ? (
                                  <ChevronDown className="w-4 h-4 text-app-muted" />
                                ) : (
                                  <ChevronRight className="w-4 h-4 text-app-muted" />
                                )}
                              </Button>
                              <div>
                                {renamingId === it.id ? (
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      autoFocus
                                      value={renameValue}
                                      onChange={(e) => setRenameValue(e.target.value)}
                                      onKeyDown={(e) => { if (e.key === "Enter") void submitRename(); if (e.key === "Escape") setRenamingId(null); }}
                                      className="px-2 py-0.5 rounded-md border border-accent/50 bg-[var(--app-input-bg)] text-sm text-app-text focus:outline-none focus:ring-1 focus:ring-accent/40 w-48"
                                    />
                                    <button onClick={() => void submitRename()} className="p-0.5 rounded hover:bg-accent/20 text-accent"><Check className="w-3.5 h-3.5" /></button>
                                    <button onClick={() => setRenamingId(null)} className="p-0.5 rounded hover:bg-danger/20 text-app-subtle hover:text-danger"><X className="w-3.5 h-3.5" /></button>
                                  </div>
                                ) : (
                                  <div className="flex items-center gap-2 group/name">
                                    <span className="text-app-text font-medium">{it.original_filename}</span>
                                    <button
                                      onClick={(e) => { e.stopPropagation(); startRename(it.id, it.original_filename); }}
                                      className="opacity-0 group-hover/name:opacity-100 p-0.5 rounded hover:bg-edge/50 text-app-subtle hover:text-accent transition-all"
                                      title="Rename dataset"
                                    >
                                      <Pencil className="w-3 h-3" />
                                    </button>
                                    {it.last_cleaned_at && (
                                      <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-accent/10 text-accent text-[9px] font-bold uppercase tracking-wider border border-accent/20">
                                        Cleaned
                                      </span>
                                    )}
                                  </div>
                                )}
                                {it.created_by && (
                                  <div className="flex items-center gap-1 mt-0.5">
                                    <User className="w-2.5 h-2.5 text-app-subtle" />
                                    <span className="text-[10px] text-app-subtle font-mono">{it.created_by}</span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </td>
                          <td className="p-4">
                            <div className="text-app-muted text-xs">{formatDate(it.created_at)}</div>
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <span className="text-app-muted text-xs font-medium">
                                {it.row_count ?? "—"} rows
                              </span>
                              <span className="text-app-subtle">×</span>
                              <span className="text-app-muted text-xs font-medium">
                                {it.col_count ?? "—"} cols
                              </span>
                            </div>
                          </td>
                          <td className="p-4">
                            {it.quality_score !== null ? (
                              <div className="flex items-center gap-2">
                                <div className="w-16 h-2 rounded-full bg-edge overflow-hidden">
                                  <div
                                    className="h-full bg-gradient-to-r from-accent to-accent2"
                                    style={{ width: `${it.quality_score}%` }}
                                  />
                                </div>
                                <span className="text-accent text-xs font-medium">{it.quality_score}%</span>
                              </div>
                            ) : (
                              <span className="text-app-subtle text-xs">—</span>
                            )}
                          </td>
                          <td className="p-4">
                            <div className="flex items-center gap-2">
                              <span className="text-app-muted text-xs font-medium">
                                {versions[it.id]?.length || 0} versions
                              </span>
                            </div>
                          </td>
                          <td className="p-4 text-right">
                            <div className="flex items-center justify-end gap-2">
                              <Link
                                href={`/review/${it.id}`}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-edge/40 text-app-muted text-xs font-medium hover:bg-edge/60 hover:text-app-text transition-colors"
                              >
                                <TableProperties className="w-3 h-3" />
                                Review
                              </Link>
                              <Link
                                href={`/analysis/${it.id}`}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent2/10 text-accent2 text-xs font-medium hover:bg-accent2/20 transition-colors"
                              >
                                <ExternalLink className="w-3 h-3" />
                                Inspect
                              </Link>
                              <Link
                                href={`/cleaning/${it.id}`}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-accent/10 text-accent text-xs font-medium hover:bg-accent/20 transition-colors"
                              >
                                <Sparkles className="w-3 h-3" />
                                Clean
                              </Link>
                              <Link
                                href={`/comparison?d1=${it.id}`}
                                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-edge/40 text-app-muted text-xs font-medium hover:bg-edge/60 transition-colors"
                              >
                                <GitCompare className="w-3 h-3" />
                                Compare
                              </Link>
                              <Button
                                onClick={() => handleDelete(it.id, it.original_filename)}
                                disabled={deletingId === it.id}
                                variant="danger"
                                size="sm"
                                className="text-xs font-medium"
                              >
                                {deletingId === it.id ? (
                                  <div className="w-3 h-3 border-2 border-danger border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <Trash2 className="w-3 h-3" />
                                )}
                                Delete
                              </Button>
                            </div>
                          </td>
                        </tr>
                        {expandedRow === it.id && (
                          <tr className="bg-panel/40 border-t border-edge/30">
                            <td colSpan={7} className="p-4">
                              {loadingDetails[it.id] ? (
                                <div className="flex items-center justify-center py-4">
                                  <div className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                                </div>
                              ) : (
                                <div className="space-y-4">
                                  <div className="flex flex-wrap gap-2">
                                    <Button
                                      onClick={() => handleGenerateReport(it.id, "quality")}
                                      variant="secondary"
                                      size="sm"
                                      className="text-xs font-medium"
                                    >
                                      <FileText className="w-3 h-3" />
                                      Quality Report
                                    </Button>
                                    <Button
                                      onClick={() => handleGenerateReport(it.id, "cleaning")}
                                      variant="secondary"
                                      size="sm"
                                      className="text-xs font-medium"
                                    >
                                      <FileText className="w-3 h-3" />
                                      Cleaning Report
                                    </Button>
                                    <Button
                                      onClick={() => handleUndo(it.id)}
                                      disabled={(versions[it.id]?.length || 0) < 2}
                                      variant="ghost"
                                      size="sm"
                                      className="text-xs font-medium"
                                    >
                                      <Undo2 className="w-3 h-3" />
                                      Undo
                                    </Button>
                                    <Button
                                      onClick={() => handleRedo(it.id)}
                                      variant="ghost"
                                      size="sm"
                                      className="text-xs font-medium"
                                    >
                                      <Redo2 className="w-3 h-3" />
                                      Redo
                                    </Button>
                                  </div>
                                  {/* Data Preview */}
                                  {previews[it.id] && previews[it.id].length > 0 && (
                                    <div>
                                      <h3 className="text-sm font-semibold text-accent mb-2 flex items-center gap-2">
                                        <FileSpreadsheet className="w-4 h-4" />
                                        Data Preview <span className="text-app-subtle font-normal text-xs">(first {previews[it.id].length} rows)</span>
                                      </h3>
                                      <div className="overflow-x-auto rounded-lg border border-edge/50">
                                        <table className="text-xs w-full">
                                          <thead className="bg-panel/60">
                                            <tr>
                                              {Object.keys(previews[it.id][0]).map((col) => (
                                                <th key={col} className="px-3 py-2 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider whitespace-nowrap border-b border-edge/30">{col}</th>
                                              ))}
                                            </tr>
                                          </thead>
                                          <tbody className="divide-y divide-edge/20">
                                            {previews[it.id].map((row, ri) => (
                                              <tr key={ri} className="hover:bg-accent/5">
                                                {Object.values(row).map((val, ci) => (
                                                  <td key={ci} className="px-3 py-1.5 text-app-muted whitespace-nowrap max-w-[200px] truncate">{val == null ? <span className="text-app-subtle italic">null</span> : String(val)}</td>
                                                ))}
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  )}

                                  {/* Versions */}
                                  <div>
                                    <h3 className="text-sm font-semibold text-accent mb-2 flex items-center gap-2">
                                      <GitBranch className="w-4 h-4" />
                                      Version History
                                    </h3>
                                    {versions[it.id] && versions[it.id].length > 0 ? (
                                      <div className="space-y-2">
                                        {versions[it.id].map((v) => (
                                          <div key={v.id} className="flex items-center gap-4 p-3 rounded-lg bg-panel/50 border border-edge/50">
                                            <div className="flex items-center gap-2">
                                              <Clock className="w-3 h-3 text-app-subtle" />
                                              <span className="text-xs text-app-muted">
                                                {new Date(v.created_at).toLocaleString()}
                                              </span>
                                            </div>
                                            <span className="text-xs font-mono text-app-subtle">v{v.version_number}</span>
                                            <span className="text-xs text-app-muted">{v.operation_type}</span>
                                            <div className="flex items-center gap-2">
                                              <div className="w-12 h-1.5 rounded-full bg-edge overflow-hidden">
                                                <div
                                                  className="h-full bg-gradient-to-r from-accent to-accent2"
                                                  style={{ width: `${v.quality_score}%` }}
                                                />
                                              </div>
                                              <span className="text-xs text-accent">{v.quality_score}%</span>
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="text-xs text-app-subtle">No versions available</div>
                                    )}
                                  </div>

                                  {/* Lineage */}
                                  <div>
                                    <h3 className="text-sm font-semibold text-accent mb-2 flex items-center gap-2">
                                      <GitBranch className="w-4 h-4" />
                                      Data Lineage
                                    </h3>
                                    {lineage[it.id] && lineage[it.id].length > 0 ? (
                                      <div className="space-y-2">
                                        {lineage[it.id].map((l) => (
                                          <div key={l.id} className="flex items-center gap-4 p-3 rounded-lg bg-panel/50 border border-edge/50">
                                            <span className="text-xs text-app-muted">{l.operation}</span>
                                            <span className="text-xs text-app-subtle">
                                              {new Date(l.created_at).toLocaleString()}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <div className="text-xs text-app-subtle">No lineage data available</div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                      </>
                    ))}
                  </tbody>
                </table>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4 pt-4 border-t border-edge/50">
                    <div className="text-xs text-app-subtle">
                      Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, items.length)} of {items.length}
                    </div>
                    <div className="flex gap-2">
                      <Button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        variant="ghost"
                        size="sm"
                        className="text-xs text-app-muted border border-edge"
                      >
                        Previous
                      </Button>
                      <span className="px-3 py-1 text-xs text-app-subtle">
                        Page {currentPage} of {totalPages}
                      </span>
                      <Button
                        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={currentPage === totalPages}
                        variant="ghost"
                        size="sm"
                        className="text-xs text-app-muted border border-edge"
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </Shell>
    </AuthGate>
  );
}
