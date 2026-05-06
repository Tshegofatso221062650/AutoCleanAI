"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached } from "@/lib/api";
import { OnboardingTour, useOnboardingTour } from "@/components/OnboardingTour";
import {
  Upload, FileSpreadsheet, BarChart3, Zap, Database,
  Sparkles, ArrowRight, CheckCircle, Wand2, Download,
  TrendingUp, Clock, ChevronRight, Activity,
} from "lucide-react";

interface OverviewStats {
  total_datasets: number;
  cleaned_datasets: number;
  pipeline_count: number;
}

interface ActivityEvent {
  id: number;
  actor: string;
  action: string;
  human_action: string;
  resource_type: string | null;
  resource_id: string | null;
  ts: string;
}

interface RecentDataset {
  id: string;
  original_filename: string;
  quality_score: number | null;
  last_cleaned_at: string | null;
  created_at: string;
}

const WORKFLOW_STEPS = [
  { num: 1, label: "Upload", desc: "Add a CSV, Excel, or JSON file", href: "/upload", linkLabel: "Upload →", icon: Upload, color: "accent" },
  { num: 2, label: "Analyse", desc: "Inspect quality metrics & column types", href: "/history", linkLabel: "Inspect →", icon: BarChart3, color: "accent2" },
  { num: 3, label: "Clean", desc: "Auto-fix issues with one click", href: "/cleaning", linkLabel: "Clean →", icon: Wand2, color: "warn" },
  { num: 4, label: "Export", desc: "Download cleaned CSV, Excel or JSON", href: "/history", linkLabel: "Download →", icon: Download, color: "accent" },
];

const TOUR_STEPS = [
  {
    target: "h1",
    title: "Welcome to AutoClean AI",
    content: "This is your data cleaning workspace. Upload messy datasets and get clean, analysis-ready data in minutes — your original files are never touched.",
  },
  {
    target: "[href=\"/upload\"]",
    title: "Step 1 — Upload a Dataset",
    content: "Start by uploading any CSV, Excel (.xlsx), or JSON file. There is no size limit. Drag & drop or click to browse.",
  },
  {
    target: "[href=\"/history\"]",
    title: "Step 2 — Inspect & Analyse",
    content: "Once uploaded, open a dataset to see quality scores, column types, missing value charts, and a correlation heatmap.",
  },
  {
    target: "[href=\"/cleaning\"]",
    title: "Step 3 — Auto-Clean",
    content: "The cleaning engine automatically fixes missing values, removes duplicates, corrects typos, standardises formats, and much more.",
  },
  {
    target: "[href=\"/chat\"]",
    title: "Explore More",
    content: "Use the sidebar to access AI Chat, Pipelines, Anomaly Detection, Reports, and many other tools. Press Ctrl+K anytime to quickly jump to a dataset.",
  },
];

export default function HomePage() {
  const [stats, setStats] = useState<OverviewStats | null>(
    () => getCached<OverviewStats>("/analytics/overview")
  );
  const [recent, setRecent] = useState<RecentDataset[]>(
    () => getCached<{ items: RecentDataset[] }>("/history")?.items?.slice(0, 4) ?? []
  );
  const [loading, setLoading] = useState(
    () => getCached("/analytics/overview") === null
  );
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const { showTour, completeTour, resetTour: _resetTour } = useOnboardingTour();

  useEffect(() => {
    const load = async () => {
      try {
        const [statsData, histRes, actRes, meRes] = await Promise.all([
          apiFetch("/analytics/overview"),
          apiFetch("/history"),
          apiFetch("/activity/feed?limit=12").catch(() => ({ events: [] })),
          apiFetch("/auth/me").catch(() => ({ role: "user" })),
        ]);
        setStats(statsData);
        const hist = histRes.items || [];
        setRecent(hist.slice(0, 4));
        setIsAdmin(meRes.role === "admin");
        setActivity(actRes.events || []);
      } catch {
        // silently ignore
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const isFirstTime = stats !== null && (stats?.total_datasets ?? 0) === 0;
  const hasUncleaned = recent.some((d) => !d.last_cleaned_at);

  return (
    <AuthGate>
      <Shell>
        <OnboardingTour
          steps={TOUR_STEPS}
          showTour={showTour}
          onComplete={completeTour}
          onSkip={completeTour}
        />
        <div className="max-w-4xl mx-auto space-y-8">

          {/* Header */}
          <div className="animate-fade-in-down">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
              <Zap className="w-3 h-3" />
              <span>AI-Powered Data Intelligence</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="text-app-text">
                {isFirstTime ? "Welcome to " : ""}
              </span>
              <span className="gradient-text">
                {isFirstTime ? "AutoClean AI" : "Dashboard"}
              </span>
            </h1>
            <p className="text-sm text-app-muted mt-1.5 max-w-lg">
              {isFirstTime
                ? "Upload a messy dataset and let the system detect issues, suggest fixes, and export a clean version — your originals are never touched."
                : "Your data cleaning workspace. Upload, analyse, clean, and export."}
            </p>
          </div>

          {/* First-time CTA */}
          {isFirstTime && (
            <div className="rounded-2xl border border-accent/25 bg-gradient-to-r from-accent/8 to-accent2/5 p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 glow-border animate-fade-in-up">
              <div>
                <p className="font-semibold text-app-text">Ready to clean your first dataset?</p>
                <p className="text-sm text-app-muted mt-1">Takes less than a minute. Drag & drop a file to get started.</p>
              </div>
              <Link
                href="/upload"
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-accent to-accent2 text-void font-semibold text-sm hover:opacity-90 active:scale-[0.98] transition-all shadow-glow-accent whitespace-nowrap"
              >
                <Upload className="w-4 h-4" />
                Upload your first file
              </Link>
            </div>
          )}

          {/* Resume banner — uncleaned datasets */}
          {!isFirstTime && hasUncleaned && (
            <div className="rounded-2xl border border-warn/20 bg-warn/5 p-4 flex items-center justify-between gap-4 animate-fade-in-up">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-warn/10 flex items-center justify-center flex-shrink-0">
                  <Clock className="w-4 h-4 text-warn" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-app-text">You have datasets pending cleaning</p>
                  <p className="text-xs text-app-muted mt-0.5">Pick up where you left off</p>
                </div>
              </div>
              <Link
                href="/history"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-warn hover:text-warn/80 transition-colors whitespace-nowrap"
              >
                View Datasets <ChevronRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          )}

          {/* How it works — 4-step workflow */}
          <div className="glass-card rounded-2xl p-6">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-app-subtle mb-5">How it works</p>
            <div className="grid sm:grid-cols-4 gap-4">
              {WORKFLOW_STEPS.map((step, i) => {
                const Icon = step.icon;
                const done = !isFirstTime && (
                  step.num === 1 ? (stats?.total_datasets ?? 0) > 0 :
                  step.num === 3 ? (stats?.cleaned_datasets ?? 0) > 0 :
                  step.num === 4 ? (stats?.cleaned_datasets ?? 0) > 0 :
                  false
                );
                return (
                  <div key={step.num} className={`flex flex-col items-center text-center gap-2 relative animate-fade-in-up stagger-${i + 1}`}>
                    {i < WORKFLOW_STEPS.length - 1 && (
                      <div className="hidden sm:block absolute top-5 left-[58%] w-full h-px border-t border-dashed border-edge/40" />
                    )}
                    <div className={`relative z-10 w-10 h-10 rounded-xl flex items-center justify-center transition-all ${
                      done
                        ? "bg-gradient-to-br from-accent to-accent2 text-void shadow-glow-accent"
                        : "bg-panel/80 border border-edge/60 text-app-muted"
                    }`}>
                      {done ? <CheckCircle className="w-5 h-5" /> : <Icon className="w-4 h-4" />}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-app-text">{step.label}</p>
                      <p className="text-[11px] text-app-muted mt-0.5 leading-relaxed">{step.desc}</p>
                    </div>
                    {!done && step.href && (
                      <Link href={step.href} className="text-[11px] text-accent hover:text-accent/80 font-semibold transition-colors">
                        {step.linkLabel}
                      </Link>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Stats */}
          <div className="grid sm:grid-cols-3 gap-4">
            {loading ? (
              <>
                {[0,1,2].map(i => (
                  <div key={i} className="rounded-xl border border-edge/20 bg-panel/20 p-4 h-[76px] skeleton" />
                ))}
              </>
            ) : (
              <>
                {[
                  { label: "Total Datasets", value: stats?.total_datasets ?? 0, icon: Database,   color: "accent",  pct: null },
                  { label: "Cleaned",         value: stats?.cleaned_datasets ?? 0, icon: Sparkles, color: "accent",  pct: stats && stats.total_datasets > 0 ? Math.round((stats.cleaned_datasets / stats.total_datasets) * 100) : null },
                  { label: "Pipelines",       value: stats?.pipeline_count ?? 0,   icon: TrendingUp, color: "accent2", pct: null },
                ].map(({ label, value, icon: Icon, color, pct }, i) => (
                  <div key={label} className={`glass-card rounded-xl p-4 flex items-center gap-4 animate-fade-in-up stagger-${i + 1}`}>
                    <div className="relative flex-shrink-0">
                      {pct !== null ? (
                        <svg className="w-12 h-12 -rotate-90" viewBox="0 0 36 36">
                          <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(0,217,165,0.12)" strokeWidth="2.5" />
                          <circle cx="18" cy="18" r="15" fill="none" stroke="#00d9a5" strokeWidth="2.5"
                            strokeDasharray={`${(pct / 100) * 94.25} 94.25`}
                            strokeLinecap="round" />
                        </svg>
                      ) : (
                        <div className={`w-10 h-10 rounded-xl bg-${color}/10 flex items-center justify-center`}>
                          <Icon className={`w-5 h-5 text-${color}`} />
                        </div>
                      )}
                      {pct !== null && (
                        <Icon className="w-4 h-4 text-accent absolute inset-0 m-auto" style={{ top: '50%', left: '50%', transform: 'translate(-50%,-50%) rotate(90deg)' }} />
                      )}
                    </div>
                    <div>
                      <div className="text-2xl font-bold text-app-text tracking-tight animate-count-up">{value}</div>
                      <div className="text-xs text-app-muted mt-0.5">{label}</div>
                      {pct !== null && value > 0 && (
                        <div className="text-[10px] text-accent mt-0.5 font-medium">{pct}% clean rate</div>
                      )}
                    </div>
                  </div>
                ))}
              </>
            )}
          </div>

          {/* Recent datasets */}
          {recent.length > 0 && (
            <div className="glass-card rounded-2xl p-6 animate-fade-in-up stagger-4">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-app-subtle">Recent Datasets</p>
                <Link href="/history" className="inline-flex items-center gap-1 text-xs text-accent hover:text-accent/80 font-semibold transition-colors">
                  View all <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
              <div className="space-y-1.5">
                {recent.map((d, i) => (
                  <Link
                    key={d.id}
                    href={`/analysis/${d.id}`}
                    className={`flex items-center justify-between gap-4 p-3 rounded-xl border border-edge/20 hover:border-accent/30 hover:bg-accent/5 transition-all duration-200 group animate-fade-in-up stagger-${i + 1}`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-7 h-7 rounded-lg bg-panel/80 border border-edge/40 flex items-center justify-center flex-shrink-0 group-hover:border-accent/30 transition-colors">
                        <FileSpreadsheet className="w-3.5 h-3.5 text-app-muted group-hover:text-accent transition-colors" />
                      </div>
                      <span className="text-sm text-app-text truncate font-medium">{d.original_filename}</span>
                    </div>
                    <div className="flex items-center gap-2.5 flex-shrink-0">
                      {d.quality_score != null && (
                        <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                          d.quality_score >= 80 ? "bg-accent/10 text-accent" :
                          d.quality_score >= 60 ? "bg-accent2/10 text-accent2" :
                          d.quality_score >= 40 ? "bg-warn/10 text-warn" : "bg-danger/10 text-danger"
                        }`}>
                          {Math.round(d.quality_score)}%
                        </span>
                      )}
                      {!d.last_cleaned_at ? (
                        <span className="text-[11px] text-accent font-semibold whitespace-nowrap">Clean →</span>
                      ) : (
                        <span className="text-[11px] text-accent flex items-center gap-1 font-medium">
                          <CheckCircle className="w-3 h-3" /> Cleaned
                        </span>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Team Activity Feed — admin only */}
          {isAdmin && activity.length > 0 && (
            <div className="glass-card rounded-2xl p-6 animate-fade-in-up">
              <div className="flex items-center justify-between mb-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-app-subtle flex items-center gap-2">
                  <Activity className="w-3.5 h-3.5 text-accent" /> Recent Activity
                </p>
              </div>
              <div className="space-y-0 divide-y divide-edge/10">
                {activity.map((e) => {
                  const initials = e.actor.slice(0, 2).toUpperCase();
                  const rel = (() => {
                    const diff = Date.now() - new Date(e.ts).getTime();
                    if (diff < 60_000) return "just now";
                    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
                    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
                    return new Date(e.ts).toLocaleDateString();
                  })();
                  return (
                    <div key={e.id} className="flex items-center gap-3 py-2.5 group">
                      <div className="w-7 h-7 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0">
                        <span className="text-[10px] font-bold text-accent">{initials}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-app-text font-medium">{e.actor}</span>
                        <span className="text-xs text-app-muted"> {e.human_action}</span>
                        {e.resource_id && (
                          <span className="text-xs text-app-subtle font-mono ml-1 truncate">
                            · {e.resource_type === "dataset" ? (
                              <a href={`/analysis/${e.resource_id}`} className="hover:text-accent transition-colors">{e.resource_id.slice(0, 8)}</a>
                            ) : e.resource_id}
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-app-subtle whitespace-nowrap flex-shrink-0">{rel}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Quick access */}
          <div className="grid sm:grid-cols-2 gap-4">
            <Link href="/upload" className="group glass-card rounded-xl p-4 flex items-center gap-4 hover:border-accent/40 card-hover animate-fade-in-up stagger-5">
              <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center group-hover:bg-accent/20 group-hover:scale-105 transition-all duration-200">
                <Upload className="w-5 h-5 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-app-text">Upload Dataset</p>
                <p className="text-xs text-app-muted">CSV, XLSX, XLS, JSON, Parquet</p>
              </div>
              <ArrowRight className="w-4 h-4 text-app-subtle group-hover:text-accent group-hover:translate-x-0.5 transition-all duration-200" />
            </Link>
            <Link href="/sample-datasets" className="group glass-card rounded-xl p-4 flex items-center gap-4 hover:border-accent2/40 card-hover animate-fade-in-up stagger-6">
              <div className="w-10 h-10 rounded-xl bg-accent2/10 flex items-center justify-center group-hover:bg-accent2/20 group-hover:scale-105 transition-all duration-200">
                <Database className="w-5 h-5 text-accent2" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-app-text">Try a Sample Dataset</p>
                <p className="text-xs text-app-muted">Pre-loaded datasets to explore</p>
              </div>
              <ArrowRight className="w-4 h-4 text-app-subtle group-hover:text-accent2 group-hover:translate-x-0.5 transition-all duration-200" />
            </Link>
          </div>

        </div>
      </Shell>
    </AuthGate>
  );
}
