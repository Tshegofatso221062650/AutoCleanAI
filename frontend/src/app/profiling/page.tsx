"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch } from "@/lib/api";
import { LineChart, Line, AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { TrendingUp, Database, Activity, AlertTriangle, CheckCircle } from "lucide-react";
import { InsightNav } from "@/components/InsightNav";
import { useTheme } from "@/contexts/ThemeContext";

interface ProfilingData {
  overview: {
    total_datasets: number;
    cleaned_datasets: number;
    avg_quality_score: number;
    total_history_entries: number;
  };
  quality_trend: Array<{
    timestamp: string;
    quality_score: number;
    missing_pct: number;
    duplicate_pct: number;
  }>;
  quality_by_dataset: Array<{
    id: string;
    filename: string;
    quality_score: number;
    created_at: string;
  }>;
  missing_trend: Array<{
    timestamp: string;
    missing_pct: number;
  }>;
}

export default function ProfilingPage() {
  const { theme } = useTheme();
  const cc = theme === "light"
    ? { grid: "#e2e8f0", axis: "#64748b", ttBg: "#ffffff", ttBorder: "#cbd5e1", ttText: "#0f172a" }
    : { grid: "#1c2330", axis: "#64748b", ttBg: "#11151c", ttBorder: "#1c2330", ttText: "#edf2f7" };
  const [data, setData] = useState<ProfilingData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadProfilingData();
  }, []);

  const loadProfilingData = async () => {
    try {
      const response = await apiFetch("/profiling/overview");
      setData(response);
    } catch (error) {
      console.error("Failed to load profiling data:", error);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString();
  };

  if (loading) {
    return (
      <AuthGate>
        <Shell>
          <InsightNav active="profiling" />
          <div className="space-y-6">
            <div className="h-16 skeleton rounded-2xl" />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {[...Array(4)].map((_, i) => <div key={i} className="h-24 skeleton rounded-xl" />)}
            </div>
            <div className="grid lg:grid-cols-2 gap-6">
              <div className="h-80 skeleton rounded-xl" />
              <div className="h-80 skeleton rounded-xl" />
            </div>
          </div>
        </Shell>
      </AuthGate>
    );
  }

  if (!data) {
    return (
      <AuthGate>
        <Shell>
          <p className="text-app-muted">Failed to load profiling data</p>
        </Shell>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <Shell>
        <InsightNav active="profiling" />
        <div className="mb-6 animate-fade-in-down">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
            <Activity className="w-3 h-3" />
            <span>Profiling</span>
          </div>
          <h1 className="text-2xl font-bold tracking-tight"><span className="gradient-text">Data Profiling Dashboard</span></h1>
          <p className="text-sm text-app-muted mt-1">Comprehensive data quality trends and metrics</p>
        </div>

        {/* Overview Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[
            { icon: Database,     color: "text-accent2", bg: "bg-accent2/15", value: data.overview.total_datasets,        label: "Total Datasets" },
            { icon: CheckCircle,  color: "text-accent",  bg: "bg-accent/15",  value: data.overview.cleaned_datasets,      label: "Cleaned Datasets" },
            { icon: TrendingUp,   color: "text-accent",  bg: "bg-accent/15",  value: data.overview.avg_quality_score + "%",label: "Avg Quality Score" },
            { icon: Activity,     color: "text-accent2", bg: "bg-accent2/15", value: data.overview.total_history_entries,  label: "History Entries" },
          ].map(({ icon: Icon, color, bg, value, label }, i) => (
            <div key={label} className={`glass-card rounded-xl p-4 animate-fade-in-up stagger-${i + 1}`}>
              <div className="flex items-center gap-3">
                <div className={`p-2 rounded-lg ${bg}`}>
                  <Icon className={`w-5 h-5 ${color}`} />
                </div>
                <div>
                  <div className={`text-2xl font-bold tracking-tight ${color}`}>{value}</div>
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-app-subtle mt-0.5">{label}</div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Charts */}
        <div className="grid lg:grid-cols-2 gap-6 mb-6">
          <div className="glass-card rounded-xl p-5">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-4">Quality Score Trend</h3>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={data.quality_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} />
                <XAxis 
                  dataKey="timestamp" 
                  tick={{ fill: cc.axis, fontSize: 10 }}
                  tickFormatter={formatDate}
                />
                <YAxis tick={{ fill: cc.axis, fontSize: 10 }} domain={[0, 100]} />
                <Tooltip 
                  contentStyle={{ background: cc.ttBg, border: `1px solid ${cc.ttBorder}`, color: cc.ttText }}
                  labelFormatter={formatDate}
                />
                <Line type="monotone" dataKey="quality_score" stroke="#00d9a5" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="glass-card rounded-xl p-5">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-4">Missing Values Trend</h3>
            <ResponsiveContainer width="100%" height={300}>
              <AreaChart data={data.missing_trend}>
                <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} />
                <XAxis 
                  dataKey="timestamp" 
                  tick={{ fill: cc.axis, fontSize: 10 }}
                  tickFormatter={formatDate}
                />
                <YAxis tick={{ fill: cc.axis, fontSize: 10 }} domain={[0, 100]} />
                <Tooltip 
                  contentStyle={{ background: cc.ttBg, border: `1px solid ${cc.ttBorder}`, color: cc.ttText }}
                  labelFormatter={formatDate}
                  formatter={(value: number) => [`${value.toFixed(1)}%`, "Missing"]}
                />
                <Area type="monotone" dataKey="missing_pct" stroke="#ffb020" fill="#ffb020" fillOpacity={0.3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Quality by Dataset */}
        <div className="glass-card rounded-xl p-5">
          <h3 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle mb-4">Quality Score by Dataset</h3>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={data.quality_by_dataset.slice(0, 10)}>
              <CartesianGrid strokeDasharray="3 3" stroke={cc.grid} />
              <XAxis 
                dataKey="filename" 
                tick={{ fill: cc.axis, fontSize: 9 }}
                angle={-45}
                textAnchor="end"
                height={60}
              />
              <YAxis tick={{ fill: cc.axis, fontSize: 10 }} domain={[0, 100]} />
              <Tooltip 
                contentStyle={{ background: cc.ttBg, border: `1px solid ${cc.ttBorder}`, color: cc.ttText }}
                formatter={(value: number) => [`${value}%`, "Quality Score"]}
              />
              <Bar dataKey="quality_score" fill="#00d9a5" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Shell>
    </AuthGate>
  );
}
