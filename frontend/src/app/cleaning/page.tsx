"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached } from "@/lib/api";
import { Wand2, Database, Search, TrendingUp, AlertTriangle } from "lucide-react";

interface Dataset {
  id: string;
  original_filename: string;
  row_count: number | null;
  col_count: number | null;
  quality_score: number | null;
  created_at: string;
}

export default function CleaningIndexPage() {
  const [datasets, setDatasets] = useState<Dataset[]>(
    () => getCached<{ items: Dataset[] }>("/history")?.items ?? []
  );
  const [loading, setLoading] = useState(
    () => getCached("/history") === null
  );
  const [search, setSearch]     = useState("");
  const router = useRouter();

  useEffect(() => {
    apiFetch("/history")
      .then((d) => setDatasets(d.items || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = datasets.filter((d) =>
    d.original_filename.toLowerCase().includes(search.toLowerCase())
  );

  function qColor(score: number | null) {
    if (score === null) return "text-app-subtle";
    if (score >= 80)   return "text-green-400";
    if (score >= 60)   return "text-yellow-400";
    return "text-red-400";
  }

  return (
    <AuthGate>
      <Shell>
        <div className="max-w-4xl mx-auto space-y-6">
          <div className="mb-6 animate-fade-in-down">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
              <Wand2 className="w-3 h-3" />
              <span>Clean</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Auto-Clean</span></h1>
            <p className="text-sm text-app-muted mt-1">Select a dataset to analyse and clean</p>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-app-subtle" />
            <input
              type="text"
              placeholder="Search datasets…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-[var(--app-input-bg)] border border-edge/40 text-sm text-app-text placeholder:text-app-subtle focus:outline-none focus:ring-2 focus:ring-accent/40"
            />
          </div>

          {loading ? (
            <div className="grid gap-3 sm:grid-cols-2">
              {[...Array(6)].map((_, i) => <div key={i} className="h-20 skeleton rounded-2xl" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="glass-card rounded-2xl p-10 text-center space-y-3">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-edge/30 mx-auto">
                <Database className="w-6 h-6 text-app-subtle" />
              </div>
              <p className="text-sm text-app-muted">No datasets found. <a href="/upload" className="text-accent hover:underline">Upload one first.</a></p>
            </div>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {filtered.map((ds) => (
                <button
                  key={ds.id}
                  type="button"
                  onClick={() => router.push(`/cleaning/${ds.id}`)}
                  className="text-left p-4 rounded-2xl glass-card hover:border-accent/50 hover:bg-accent/5 transition-all group"
                >
                  <div className="flex items-start gap-3">
                    <Database className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-app-text text-sm truncate group-hover:text-accent transition-colors">
                        {ds.original_filename}
                      </p>
                      <p className="text-xs text-app-subtle mt-0.5">
                        {ds.row_count?.toLocaleString() ?? "?"} rows · {ds.col_count ?? "?"} cols
                      </p>
                    </div>
                    {ds.quality_score !== null && (
                      <div className={`flex items-center gap-1 text-xs font-semibold ${qColor(ds.quality_score)}`}>
                        <TrendingUp className="w-3.5 h-3.5" />
                        {ds.quality_score.toFixed(0)}
                      </div>
                    )}
                    {ds.quality_score !== null && ds.quality_score < 70 && (
                      <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </Shell>
    </AuthGate>
  );
}
