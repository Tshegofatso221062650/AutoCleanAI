"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch } from "@/lib/api";
import {
  Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight,
  ArrowUp, ArrowDown, ArrowUpDown, Wand2, BarChart3, Loader2,
  TableProperties, X, Columns3,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

interface RowsResponse {
  columns: string[];
  rows: Record<string, unknown>[];
  total_rows: number;
  total_pages: number;
  page: number;
  page_size: number;
}

const PAGE_SIZES = [50, 100, 200, 500];

export default function DataReviewPage() {
  const { id } = useParams<{ id: string }>();

  const [data, setData] = useState<RowsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [hiddenCols, setHiddenCols] = useState<Set<string>>(new Set());
  const [showColPicker, setShowColPicker] = useState(false);
  const [pageJump, setPageJump] = useState("");

  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const colPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) {
        setShowColPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const load = useCallback(
    async (p: number, ps: number, q: string, sb: string | null, sd: string) => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({
          page: String(p),
          page_size: String(ps),
          sort_dir: sd,
        });
        if (q) params.set("search", q);
        if (sb) params.set("sort_by", sb);
        const res = await apiFetch(`/datasets/${id}/rows?${params}`);
        setData(res);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : "Failed to load rows");
      } finally {
        setLoading(false);
      }
    },
    [id],
  );

  useEffect(() => {
    void load(page, pageSize, search, sortBy, sortDir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize, sortBy, sortDir]);

  // Debounce search
  useEffect(() => {
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(() => {
      setPage(1);
      setSearch(searchInput);
      void load(1, pageSize, searchInput, sortBy, sortDir);
    }, 350);
    return () => { if (searchRef.current) clearTimeout(searchRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const handleSort = (col: string) => {
    if (sortBy === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(col);
      setSortDir("asc");
    }
    setPage(1);
  };

  const SortIcon = ({ col }: { col: string }) => {
    if (sortBy !== col) return <ArrowUpDown className="w-3 h-3 text-app-subtle opacity-50" />;
    return sortDir === "asc"
      ? <ArrowUp className="w-3 h-3 text-accent" />
      : <ArrowDown className="w-3 h-3 text-accent" />;
  };

  const columns = data?.columns ?? [];
  const rows = data?.rows ?? [];
  const totalRows = data?.total_rows ?? 0;
  const totalPages = data?.total_pages ?? 1;
  const start = totalRows === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, totalRows);

  const cellValue = (v: unknown): string => {
    if (v === null || v === undefined) return "";
    return String(v);
  };

  const isMissing = (v: unknown) => v === null || v === undefined || v === "";

  const displayCols = columns.filter(c => !hiddenCols.has(c));
  const dupCount = rows.filter(r => r._is_duplicate).length;
  const missingCells = rows.reduce((n, r) => n + columns.filter(c => isMissing(r[c])).length, 0);
  const totalCells = rows.length * columns.length;
  const missingPct = totalCells > 0 ? (missingCells / totalCells * 100).toFixed(1) : "0.0";

  const toggleCol = (col: string) => {
    setHiddenCols(prev => {
      const next = new Set(prev);
      next.has(col) ? next.delete(col) : next.add(col);
      return next;
    });
  };

  return (
    <AuthGate>
      <Shell>
        <div className="space-y-4">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-accent/10">
                <TableProperties className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h1 className="text-lg font-semibold text-app-text">Data Review</h1>
                <p className="text-xs text-app-muted">
                  {loading ? "Loading…" : `${totalRows.toLocaleString()} rows · ${columns.length} columns`}
                  {hiddenCols.size > 0 && ` · ${hiddenCols.size} hidden`}
                  {search && ` · filtered by "${search}"`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Link
                href={`/analysis/${id}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-edge/40 text-xs text-app-muted hover:text-app-text hover:border-edge/70 transition-colors"
              >
                <BarChart3 className="w-3.5 h-3.5" /> Analysis
              </Link>
              <Link
                href={`/cleaning/${id}`}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent/10 border border-accent/30 text-xs text-accent hover:bg-accent/20 transition-colors"
              >
                <Wand2 className="w-3.5 h-3.5" /> Clean this dataset
              </Link>
            </div>
          </div>

          {/* Stats bar */}
          {!loading && totalRows > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              <div className="rounded-xl bg-panel/50 border border-edge/40 px-4 py-2.5">
                <div className="text-[9px] text-app-subtle font-semibold uppercase tracking-wider mb-0.5">Total Rows</div>
                <div className="text-xl font-bold text-app-text">{totalRows.toLocaleString()}</div>
              </div>
              <div className="rounded-xl bg-panel/50 border border-edge/40 px-4 py-2.5">
                <div className="text-[9px] text-app-subtle font-semibold uppercase tracking-wider mb-0.5">Columns</div>
                <div className="text-xl font-bold text-app-text">{columns.length}{hiddenCols.size > 0 && <span className="text-sm text-app-subtle ml-1">({columns.length - hiddenCols.size} shown)</span>}</div>
              </div>
              <div className="rounded-xl bg-panel/50 border border-edge/40 px-4 py-2.5">
                <div className="text-[9px] text-app-subtle font-semibold uppercase tracking-wider mb-0.5">Missing (page)</div>
                <div className="flex items-baseline gap-1">
                  <span className={`text-xl font-bold ${parseFloat(missingPct) > 5 ? "text-warn" : "text-accent"}`}>{missingPct}%</span>
                  <span className="text-[10px] text-app-subtle">{missingCells} cells</span>
                </div>
              </div>
              <div className="rounded-xl bg-panel/50 border border-edge/40 px-4 py-2.5">
                <div className="text-[9px] text-app-subtle font-semibold uppercase tracking-wider mb-0.5">Duplicates (page)</div>
                <div className={`text-xl font-bold ${dupCount > 0 ? "text-warn" : "text-accent"}`}>{dupCount}</div>
              </div>
            </div>
          )}

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-3">
            {/* Search */}
            <div className="relative flex-1 min-w-[200px] max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-app-subtle" />
              <input
                type="text"
                placeholder="Search all columns…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full pl-8 pr-8 py-1.5 bg-[var(--app-input-bg)] border border-edge/40 rounded-lg text-sm text-app-text placeholder:text-app-subtle focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
              {searchInput && (
                <button
                  onClick={() => { setSearchInput(""); }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-app-subtle hover:text-app-muted"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            {/* Page size */}
            <div className="flex items-center gap-1.5 text-xs text-app-muted">
              <span>Rows:</span>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="bg-panel border border-edge/40 rounded-lg px-2 py-1 text-app-text text-xs"
              >
                {PAGE_SIZES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>

            {/* Column picker */}
            <div className="relative" ref={colPickerRef}>
              <button
                onClick={() => setShowColPicker(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                  hiddenCols.size > 0
                    ? "border-accent/40 bg-accent/10 text-accent"
                    : "border-edge/40 text-app-muted hover:text-app-text"
                }`}
              >
                <Columns3 className="w-3.5 h-3.5" />
                Columns{hiddenCols.size > 0 ? ` (${columns.length - hiddenCols.size}/${columns.length})` : ""}
              </button>
              {showColPicker && (
                <div className="absolute left-0 top-full mt-1 z-30 w-56 max-h-72 overflow-y-auto rounded-xl border border-edge bg-panel shadow-2xl shadow-black/40 p-2">
                  <div className="flex items-center justify-between px-2 pb-2 mb-1 border-b border-edge/40">
                    <span className="text-[10px] text-app-subtle font-semibold uppercase tracking-wider">Show / Hide Columns</span>
                    <button onClick={() => setHiddenCols(new Set())} className="text-[10px] text-accent hover:text-accent/80">Show all</button>
                  </div>
                  {columns.map(col => (
                    <label key={col} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-edge/20 cursor-pointer">
                      <input type="checkbox" checked={!hiddenCols.has(col)} onChange={() => toggleCol(col)} className="accent-accent" />
                      <span className="text-xs text-app-muted truncate" title={col}>{col}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            {/* Pagination info */}
            {totalRows > 0 && (
              <span className="text-xs text-app-muted ml-auto">
                {start}–{end} of {totalRows.toLocaleString()}
              </span>
            )}
          </div>

          {/* Error */}
          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger/5 p-4 text-sm text-danger">{error}</div>
          )}

          {/* Legend */}
          {rows.some((r) => r._is_duplicate) && (
            <div className="flex items-center gap-4 text-[11px] text-app-muted">
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-warn/20 border border-warn/40 inline-block" />
                Duplicate row (matches another row in dataset)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded bg-danger/10 inline-block" />
                <span className="text-danger/60 italic">∅ null</span> = missing value
              </span>
            </div>
          )}

          {/* Table */}
          <div className="rounded-xl border border-edge/40 overflow-hidden">
            <div className="overflow-x-auto overflow-y-auto max-h-[calc(100vh-300px)]">
              <table className="w-full text-xs border-separate border-spacing-0">
                <thead className="sticky top-0 z-10">
                  <tr className="shadow-[0_1px_0_0_var(--app-edge)]">
                    {/* Row number */}
                    <th className="px-3 py-2.5 text-left font-semibold text-app-subtle w-12 bg-panel">
                      #
                    </th>
                    {displayCols.map((col) => (
                      <th
                        key={col}
                        onClick={() => handleSort(col)}
                        className="px-3 py-2.5 text-left font-semibold text-app-text cursor-pointer hover:bg-[var(--app-hover-bg)] whitespace-nowrap select-none bg-panel"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="truncate max-w-[180px]" title={col}>{col}</span>
                          <SortIcon col={col} />
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading && rows.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length + 1} className="py-20 text-center">
                        <Loader2 className="w-6 h-6 text-accent animate-spin mx-auto" />
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length + 1} className="py-20 text-center text-app-muted">
                        {search ? `No rows match "${search}"` : "No data found."}
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, ri) => {
                      const isDup = !!row._is_duplicate;
                      return (
                        <tr
                          key={ri}
                          className={`border-b border-edge/20 transition-colors ${
                            isDup
                              ? "bg-warn/8 hover:bg-warn/12"
                              : "hover:bg-accent/5 even:bg-panel/20"
                          }`}
                        >
                          <td className="px-3 py-1.5 font-mono select-none">
                            {isDup ? (
                              <span className="flex items-center gap-1 text-warn" title="Duplicate row">
                                <span className="w-1.5 h-1.5 rounded-full bg-warn flex-shrink-0" />
                                {start + ri}
                              </span>
                            ) : (
                              <span className="text-app-subtle">{start + ri}</span>
                            )}
                          </td>
                          {displayCols.map((col) => {
                            const val = row[col];
                            const missing = isMissing(val);
                            return (
                              <td
                                key={col}
                                className={`px-3 py-1.5 whitespace-nowrap max-w-[260px] truncate ${
                                  missing
                                    ? "text-danger/50 italic"
                                    : isDup
                                    ? "text-warn/80"
                                    : "text-app-text"
                                }`}
                                title={missing ? "null / missing" : cellValue(val)}
                              >
                                {missing ? <span className="text-[10px]">∅ null</span> : cellValue(val)}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>

          {/* Pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-1">
              <Button
                variant="ghost" size="sm"
                onClick={() => setPage(1)}
                disabled={page === 1 || loading}
                className="p-1.5"
              >
                <ChevronsLeft className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost" size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page === 1 || loading}
                className="p-1.5"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>

              {/* Go to page */}
              <form onSubmit={(e) => {
                e.preventDefault();
                const n = parseInt(pageJump, 10);
                if (n >= 1 && n <= totalPages) { setPage(n); setPageJump(""); }
              }} className="flex items-center gap-1.5">
                <input
                  type="number" min={1} max={totalPages}
                  value={pageJump} placeholder="pg"
                  onChange={e => setPageJump(e.target.value)}
                  className="w-14 bg-panel border border-edge/40 rounded-lg px-2 py-1 text-xs text-app-text text-center focus:border-accent/50 focus:outline-none"
                />
              </form>

              {/* Page numbers */}
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                let p = i + 1;
                if (totalPages > 7) {
                  if (page <= 4) p = i + 1;
                  else if (page >= totalPages - 3) p = totalPages - 6 + i;
                  else p = page - 3 + i;
                }
                return (
                  <button
                    key={p}
                    onClick={() => setPage(p)}
                    disabled={loading}
                    className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                      p === page
                        ? "bg-accent text-void"
                        : "text-app-muted hover:text-app-text hover:bg-edge/30"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}

              <Button
                variant="ghost" size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page === totalPages || loading}
                className="p-1.5"
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
              <Button
                variant="ghost" size="sm"
                onClick={() => setPage(totalPages)}
                disabled={page === totalPages || loading}
                className="p-1.5"
              >
                <ChevronsRight className="w-4 h-4" />
              </Button>
            </div>
          )}

          {/* Loading overlay indicator */}
          {loading && rows.length > 0 && (
            <div className="fixed bottom-6 right-6 flex items-center gap-2 px-3 py-1.5 bg-panel border border-edge/40 rounded-full text-xs text-app-muted shadow-lg">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" /> Loading…
            </div>
          )}
        </div>
      </Shell>
    </AuthGate>
  );
}
