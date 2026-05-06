"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached } from "@/lib/api";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { InsightNav } from "@/components/InsightNav";
import { useTheme } from "@/contexts/ThemeContext";

interface OverviewStats {
  total_datasets: number;
  total_rows: number;
  average_quality_score: number;
  cleaned_datasets: number;
  pipeline_count: number;
  rule_set_count: number;
  pipeline_success_rate: number;
  avg_quality_improvement: number;
  total_pipeline_runs: number;
}

interface QualityTrend {
  dataset_id: string;
  filename: string;
  quality_score: number;
  analyzed_at: string;
}

interface PipelineUsage {
  pipeline_id: number;
  name: string;
  usage_count: number;
  is_template: boolean;
  created_at: string;
}

interface ObjectiveStats {
  total_objectives: number;
  completed_objectives: number;
  failed_objectives: number;
  pending_objectives: number;
  completion_rate: number;
  objective_type_stats: Record<string, { total: number; completed: number; failed: number; pending: number }>;
}

export default function AnalyticsDashboardPage() {
  const { theme } = useTheme();
  const cc = theme === "light"
    ? { grid: "#e2e8f0", axis: "#64748b", ttBg: "#ffffff", ttBorder: "#cbd5e1", ttText: "#0f172a" }
    : { grid: "#1c2330", axis: "#64748b", ttBg: "#11151c", ttBorder: "#1c2330", ttText: "#edf2f7" };
  const [overview, setOverview] = useState<OverviewStats | null>(
    () => getCached<OverviewStats>("/analytics/overview")
  );
  const [trends, setTrends] = useState<QualityTrend[]>(
    () => getCached<{ trends: QualityTrend[] }>("/analytics/quality-trends")?.trends ?? []
  );
  const [pipelineUsage, setPipelineUsage] = useState<PipelineUsage[]>(
    () => getCached<{ pipeline_usage: PipelineUsage[] }>("/analytics/pipeline-usage")?.pipeline_usage ?? []
  );
  const [objectiveStats, setObjectiveStats] = useState<ObjectiveStats | null>(
    () => getCached<ObjectiveStats>("/analytics/objective-completion")
  );
  const [loading, setLoading] = useState(
    () => getCached("/analytics/overview") === null
  );

  useEffect(() => {
    loadAnalytics();
  }, []);

  const loadAnalytics = async () => {
    try {
      const [overviewData, trendsData, pipelineData, objectiveData] = await Promise.all([
        apiFetch("/analytics/overview"),
        apiFetch("/analytics/quality-trends"),
        apiFetch("/analytics/pipeline-usage"),
        apiFetch("/analytics/objective-completion"),
      ]);
      setOverview(overviewData);
      setTrends(trendsData.trends || []);
      setPipelineUsage(pipelineData.pipeline_usage || []);
      setObjectiveStats(objectiveData);
    } catch (e) {
      console.error("Failed to load analytics:", e);
    } finally {
      setLoading(false);
    }
  };

  if (loading && overview === null) {
    return (
      <AuthGate>
        <Shell>
          <InsightNav active="analytics" />
          <div className="space-y-6">
            <div className="h-16 skeleton rounded-2xl" />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[...Array(8)].map((_, i) => <div key={i} className="h-20 skeleton rounded-xl" />)}
            </div>
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="h-72 skeleton rounded-xl" />
              <div className="h-72 skeleton rounded-xl" />
            </div>
          </div>
        </Shell>
      </AuthGate>
    );
  }

  const chartData = trends.slice(0, 10).map((t) => ({
    name: t.filename.substring(0, 15),
    score: t.quality_score,
  }));

  const pipelineChartData = pipelineUsage.slice(0, 5).map((p) => ({
    name: p.name.substring(0, 15),
    count: p.usage_count,
  }));

  return (
    <AuthGate>
      <Shell>
        <InsightNav active="analytics" />
        <div className="mb-6 animate-fade-in-down">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
            <span>Analytics</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            <span className="gradient-text">Analytics Dashboard</span>
          </h1>
          <p className="text-sm text-app-muted mt-1.5">Overview of your data cleaning operations</p>
        </div>

        {/* Overview Stats */}
        {overview && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mb-8">
            {[
              { label: "Total Datasets",         value: overview.total_datasets,                                                                color: "text-app-text" },
              { label: "Total Rows",              value: overview.total_rows.toLocaleString(),                                                  color: "text-accent" },
              { label: "Avg Quality",             value: overview.average_quality_score.toFixed(1) + "%",                                      color: "text-accent" },
              { label: "Cleaned",                 value: overview.cleaned_datasets,                                                             color: "text-accent2" },
              { label: "Pipelines",               value: overview.pipeline_count,                                                               color: "text-accent2" },
              { label: "Rule Sets",               value: overview.rule_set_count,                                                               color: "text-warn" },
              { label: "Pipeline Success",        value: (overview.pipeline_success_rate ?? 0).toFixed(1) + "%",                               color: "text-accent2" },
              { label: "Quality Improvement",     value: (overview.avg_quality_improvement > 0 ? "+" : "") + (overview.avg_quality_improvement ?? 0).toFixed(1) + "%", color: "text-accent" },
            ].map(({ label, value, color }, i) => (
              <div key={label} className={`glass-card rounded-xl p-4 animate-fade-in-up stagger-${(i % 6) + 1}`}>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">{label}</div>
                <div className={`text-2xl font-bold tracking-tight ${color}`}>{value}</div>
              </div>
            ))}
          </div>
        )}

        {objectiveStats && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            {[
              { label: "Total Objectives", value: objectiveStats.total_objectives,              color: "text-app-text" },
              { label: "Completed",         value: objectiveStats.completed_objectives,          color: "text-accent" },
              { label: "Failed",             value: objectiveStats.failed_objectives,            color: "text-danger" },
              { label: "Completion Rate",   value: objectiveStats.completion_rate.toFixed(1) + "%", color: "text-accent" },
            ].map(({ label, value, color }, i) => (
              <div key={label} className={`glass-card rounded-xl p-4 animate-fade-in-up stagger-${i + 1}`}>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">{label}</div>
                <div className={`text-2xl font-bold tracking-tight ${color}`}>{value}</div>
              </div>
            ))}
          </div>
        )}

        {/* Charts */}
        <div className="grid lg:grid-cols-2 gap-6 mb-8">
          {chartData.length > 0 && (
            <div className="glass-card rounded-xl p-5">
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-4">Recent Quality Scores</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} />
                    <XAxis dataKey="name" tick={{ fill: cc.axis, fontSize: 10 }} />
                    <YAxis tick={{ fill: cc.axis, fontSize: 10 }} domain={[0, 100]} />
                    <Tooltip contentStyle={{ background: cc.ttBg, border: `1px solid ${cc.ttBorder}`, color: cc.ttText }} />
                    <Line type="monotone" dataKey="score" stroke="#00d9a5" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {pipelineChartData.length > 0 && (
            <div className="glass-card rounded-xl p-5">
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-4">Pipeline Usage</h2>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={pipelineChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} />
                    <XAxis dataKey="name" tick={{ fill: cc.axis, fontSize: 10 }} />
                    <YAxis tick={{ fill: cc.axis, fontSize: 10 }} />
                    <Tooltip contentStyle={{ background: cc.ttBg, border: `1px solid ${cc.ttBorder}`, color: cc.ttText }} />
                    <Bar dataKey="count" fill="#ffb020" radius={[2, 2, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        {/* Pipeline Usage Table */}
        {pipelineUsage.length > 0 && (
          <div className="glass-card rounded-xl p-5">
            <h2 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-4">Pipeline Usage Statistics</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-edge/40">
                    <th className="py-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-app-subtle">Pipeline Name</th>
                    <th className="py-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-app-subtle">Usage Count</th>
                    <th className="py-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-app-subtle">Type</th>
                    <th className="py-2 px-3 text-[10px] font-semibold uppercase tracking-wider text-app-subtle">Created At</th>
                  </tr>
                </thead>
                <tbody>
                  {pipelineUsage.map((pipeline) => (
                    <tr key={pipeline.pipeline_id} className="border-b border-edge/20 hover:bg-accent/5 transition-colors">
                      <td className="py-2.5 px-3 text-sm text-app-text font-medium">{pipeline.name}</td>
                      <td className="py-2.5 px-3 text-sm text-accent font-semibold">{pipeline.usage_count}</td>
                      <td className="py-2.5 px-3 text-sm text-app-muted">
                        {pipeline.is_template ? (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-accent2/10 text-accent2">Template</span>
                        ) : (
                          <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-edge/40 text-app-subtle">Custom</span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-xs text-app-subtle">
                        {new Date(pipeline.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Shell>
    </AuthGate>
  );
}
