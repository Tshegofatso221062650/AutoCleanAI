"use client";

import { createContext, memo, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { clearToken, apiFetch } from "@/lib/api";
import { _registerConfirmListener } from "@/lib/confirm";
import { invalidateAuthCache } from "@/components/AuthGate";
import { Home, Upload, History, Settings, LogOut, Sparkles, TrendingUp, Workflow, BarChart3, ChevronLeft, ChevronRight, Shield, GitCompare, Moon, Sun, Keyboard, FileText, MessageSquare, Wand2, Search, X, Loader2, FileSpreadsheet, Bell, CheckCircle2, XCircle, RefreshCw, Zap, Layers, Calendar, Users, Target, Activity, Code, AlertTriangle, EyeOff, GitBranch, Network, Merge, Tag, ListFilter, DatabaseZap, Menu } from "lucide-react";
import { Logo } from "@/components/Logo";
import { useJobSocket, type JobEvent } from "@/lib/useJobSocket";
import { useToasts, Toast } from "@/components/Toast";
import { useNavigationShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useTheme } from "@/contexts/ThemeContext";
import { KeyboardShortcuts } from "@/components/KeyboardShortcuts";
import { Button } from "@/components/ui/Button";
import FocusTrap from "focus-trap-react";

const PRIMARY_SECTIONS = ["Overview", "Data", "Prepare", "Automate", "Insights", "System"] as const;

const links = [
  // ── Overview ──────────────────────────────────────────
  { href: "/home",          label: "Home",       icon: Home,          section: "Overview" },

  // ── Data ──────────────────────────────────────────────
  { href: "/upload",        label: "Upload",     icon: Upload,        section: "Data" },
  { href: "/history",       label: "Datasets",   icon: History,       section: "Data" },
  { href: "/export",        label: "Export DB",  icon: DatabaseZap,   section: "Data" },

  // ── Prepare ───────────────────────────────────────────
  { href: "/cleaning",      label: "Clean",      icon: Wand2,         section: "Prepare" },
  { href: "/transform",     label: "Transform",  icon: Sparkles,      section: "Prepare" },
  { href: "/anonymization", label: "Anonymize",  icon: EyeOff,        section: "Prepare" },
  { href: "/consolidation", label: "Consolidate",icon: Merge,         section: "Prepare" },
  { href: "/validation",    label: "Validate",   icon: Shield,        section: "Prepare" },
  { href: "/quality",       label: "Quality",    icon: TrendingUp,    section: "Prepare" },
  { href: "/objectives",    label: "Objectives", icon: Target,        section: "Prepare" },

  // ── Automate ──────────────────────────────────────────
  { href: "/pipelines",            label: "Pipelines",   icon: Workflow,    section: "Automate" },
  { href: "/transformation-rules", label: "Rules",        icon: ListFilter,  section: "Automate" },
  { href: "/batch",                label: "Batch",        icon: Layers,      section: "Automate" },
  { href: "/scheduler",            label: "Scheduler",    icon: Calendar,    section: "Automate" },
  { href: "/custom-functions",     label: "Functions",    icon: Code,        section: "Automate" },

  // ── Insights ──────────────────────────────────────────
  { href: "/analytics",         label: "Analytics",  icon: BarChart3,      section: "Insights" },
  { href: "/profiling",         label: "Profiling",  icon: Activity,       section: "Insights" },
  { href: "/anomaly-detection",  label: "Anomaly",    icon: AlertTriangle,  section: "Insights" },
  { href: "/comparison",        label: "Compare",    icon: GitCompare,     section: "Insights" },
  { href: "/schema-evolution",  label: "Schema",     icon: GitBranch,      section: "Insights" },
  { href: "/lineage-visualizer",label: "Lineage",    icon: Network,        section: "Insights" },
  { href: "/reports",           label: "Reports",    icon: FileText,       section: "Insights" },
  { href: "/alerts",            label: "Alerts",     icon: Bell,           section: "Insights" },
  { href: "/chat",              label: "AI Chat",    icon: MessageSquare,  section: "Insights" },

  // ── System ────────────────────────────────────────────
  { href: "/tags",          label: "Tags",       icon: Tag,           section: "System" },
  { href: "/collaboration", label: "Collaborate",icon: Users,         section: "System" },
  { href: "/webhooks",      label: "Webhooks",   icon: Zap,           section: "System" },
  { href: "/admin",         label: "Admin",      icon: Shield,        section: "System", adminOnly: true },
  { href: "/settings",      label: "Settings",   icon: Settings,      section: "System" },
];

/**
 * Context that is true when a Shell is already rendered by an ancestor.
 * Any descendant <Shell> will see this and short-circuit to a plain wrapper,
 * so re-using <Shell> in every page component costs nothing extra and the
 * sidebar is only ever mounted once (from the root layout).
 */
const ShellMountedCtx = createContext(false);

interface DatasetItem {
  id: string;
  original_filename: string;
  row_count: number | null;
  quality_score: number | null;
}

const ShellImpl = memo(function ShellImpl({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router   = useRouter();
  const { toasts, removeToast } = useToasts();
  useNavigationShortcuts();
  const { theme, toggleTheme } = useTheme();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [userRole, setUserRole] = useState<string>("user");
  const [userName, setUserName] = useState<string>("");
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [confirmReq, setConfirmReq] = useState<{ message: string; resolve: (ok: boolean) => void } | null>(null);

  useEffect(() => {
    const unsub = _registerConfirmListener((req) => setConfirmReq(req));
    return () => { unsub(); };
  }, []);

  useEffect(() => {
    apiFetch("/auth/me").then((me) => { setUserRole(me?.role ?? "user"); setUserName(me?.username ?? ""); }).catch(() => {});
  }, []);

  function avatarColors(u: string): [string, string] {
    const palette: [string, string][] = [["#00d9a5","#00b8ff"],["#6366f1","#a855f7"],["#f59e0b","#ef4444"],["#10b981","#3b82f6"],["#ec4899","#8b5cf6"],["#14b8a6","#0ea5e9"]];
    let h = 0; for (let i = 0; i < u.length; i++) h = u.charCodeAt(i) + ((h << 5) - h);
    return palette[Math.abs(h) % palette.length];
  }
  function initials(u: string) {
    const p = u.replace(/[._-]/g, " ").split(" ").filter(Boolean);
    return p.length >= 2 ? (p[0][0] + p[1][0]).toUpperCase() : u.slice(0, 2).toUpperCase();
  }

  // ── Live Job Status (WebSocket) ────────────────────────────────────────
  const { events: jobEvents, connected: wsConnected, clearEvents } = useJobSocket();
  const [showNotifs, setShowNotifs] = useState(false);
  const [seenCount,  setSeenCount]  = useState(0);
  const unread = jobEvents.length - seenCount;
  const notifRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!showNotifs) return;
    const handle = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) {
        setShowNotifs(false);
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [showNotifs]);

  const navRef = useRef<HTMLElement>(null);

  // ── Dataset Quick-Search (Ctrl+K) ──────────────────────────────────────
  const [showSearch, setShowSearch]         = useState(false);
  const [searchQuery, setSearchQuery]       = useState("");
  const [searchDatasets, setSearchDatasets] = useState<DatasetItem[]>([]);
  const [searchLoading, setSearchLoading]   = useState(false);
  const [searchIdx, setSearchIdx]           = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const filteredDatasets = useMemo(() => {
    if (!searchQuery.trim()) return searchDatasets;
    const q = searchQuery.toLowerCase();
    return searchDatasets.filter((d) => d.original_filename.toLowerCase().includes(q));
  }, [searchDatasets, searchQuery]);

  const openSearch = async () => {
    setShowSearch(true);
    setSearchQuery("");
    setSearchIdx(0);
    setSearchLoading(true);
    try {
      const d = await apiFetch("/history");
      setSearchDatasets(d.items || []);
    } catch {
      setSearchDatasets([]);
    } finally {
      setSearchLoading(false);
    }
    setTimeout(() => searchInputRef.current?.focus(), 30);
  };

  const closeSearch = () => {
    setShowSearch(false);
    setSearchQuery("");
  };

  // Shell-owned keyboard shortcuts (need access to Shell state)
  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === "k") { e.preventDefault(); openSearch(); return; }
      if (mod && e.key === "b") { e.preventDefault(); setSidebarCollapsed((c) => !c); return; }
      if (mod && e.key === "/") { e.preventDefault(); setShowShortcuts((s) => !s); return; }
      if (e.key === "Escape") {
        if (showSearch) { closeSearch(); return; }
      }
      if (showSearch) {
        if (e.key === "ArrowDown") {
          e.preventDefault();
          setSearchIdx((i) => Math.min(i + 1, filteredDatasets.length - 1));
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          setSearchIdx((i) => Math.max(i - 1, 0));
        } else if (e.key === "Enter" && filteredDatasets[searchIdx]) {
          e.preventDefault();
          router.push(`/analysis/${filteredDatasets[searchIdx].id}`);
          closeSearch();
        }
      }
    };
    window.addEventListener("keydown", handle);
    return () => window.removeEventListener("keydown", handle);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showSearch, filteredDatasets, searchIdx]);

  // Restore scroll BEFORE first paint so there is zero visible jump.
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const saved = sessionStorage.getItem("ac_nav_scroll");
    if (saved) nav.scrollTop = parseInt(saved, 10);
  }, []);

  // Persist scroll position on every scroll event.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const save = () => sessionStorage.setItem("ac_nav_scroll", String(nav.scrollTop));
    nav.addEventListener("scroll", save, { passive: true });
    return () => nav.removeEventListener("scroll", save);
  }, []);

  return (
    <ShellMountedCtx.Provider value={true}>
    <div className="h-screen flex overflow-hidden bg-[var(--app-bg)]">
      {/* Skip to content — keyboard nav a11y */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[999] focus:px-4 focus:py-2 focus:rounded-lg focus:bg-accent focus:text-void focus:text-sm focus:font-semibold"
      >
        Skip to content
      </a>
      {/* Mobile overlay backdrop */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Sidebar — fixed to viewport height, never scrolls with content */}
      <aside
        className={`h-full flex-none flex flex-col transition-all duration-300 ease-in-out ${
          sidebarCollapsed ? "w-16" : "w-60"
        } ${
          mobileOpen ? "fixed inset-y-0 left-0 z-50" : "hidden md:flex"
        }`}
        style={{
          background: "linear-gradient(180deg, var(--app-panel) 0%, color-mix(in srgb, var(--app-panel) 95%, var(--app-bg)) 100%)",
          borderRight: "1px solid color-mix(in srgb, var(--app-edge) 30%, transparent)",
          boxShadow: "2px 0 24px rgba(0,0,0,0.2)",
        }}
      >
        {/* Logo / Brand */}
        <div className={`flex-none flex items-center h-14 px-3 ${sidebarCollapsed ? "justify-center" : "justify-between"}`}>
          {sidebarCollapsed ? (
            <button
              onClick={() => setSidebarCollapsed(false)}
              title="Expand sidebar"
              className="group flex-none w-8 h-8 rounded-lg bg-void flex items-center justify-center shadow-glow-accent hover:opacity-90 group-hover:scale-105 transition-all duration-200"
            >
              <Logo size={28} standalone={false} />
            </button>
          ) : (
            <>
              <Link href="/home" className="flex items-center gap-2.5 group min-w-0">
                <div className="flex-none w-8 h-8 rounded-lg bg-void flex items-center justify-center shadow-glow-accent group-hover:scale-105 transition-transform duration-200">
                  <Logo size={28} standalone={false} />
                </div>
                <div className="min-w-0">
                  <span className="block text-fluid-sm font-semibold text-app-text tracking-tight truncate">AutoClean AI</span>
                  <span className="block text-fluid-2xs text-app-subtle tracking-wide">Data Intelligence</span>
                </div>
              </Link>
              <Button
                onClick={() => setSidebarCollapsed(true)}
                variant="ghost"
                size="sm"
                className="flex-none p-1.5 rounded-md text-app-subtle hover:text-app-muted hover:bg-edge/30"
                title="Collapse sidebar"
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
            </>
          )}
        </div>

        {/* Navigation — only this area scrolls */}
        <nav ref={navRef} className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-2 py-2 custom-scrollbar">
          {PRIMARY_SECTIONS.map((section, idx) => {
            const sectionLinks = links.filter(l => l.section === section && (!('adminOnly' in l && l.adminOnly) || userRole === 'admin'));
            if (sectionLinks.length === 0) return null;
            return (
              <div key={section} className={idx > 0 ? "mt-4" : ""}>
                {!sidebarCollapsed && (
                  <p className="px-3 mb-1 text-fluid-2xs font-semibold uppercase tracking-widest text-app-subtle select-none">
                    {section}
                  </p>
                )}
                <div className="space-y-0.5">
                  {sectionLinks.map((l) => {
                    const Icon = l.icon;
                    const isActive = pathname === l.href;
                    return (
                      <Link
                        key={l.href}
                        href={l.href}
                        title={sidebarCollapsed ? l.label : undefined}
                        onClick={() => setMobileOpen(false)}
                        className={`flex items-center gap-2.5 rounded-lg text-fluid-sm font-medium transition-all duration-150 ${
                          sidebarCollapsed ? "justify-center w-10 h-10 mx-auto" : "px-3 py-[7px]"
                        } ${
                          isActive
                            ? "nav-active"
                            : "text-app-muted hover:text-app-text hover:bg-[var(--app-hover-bg)]"
                        }`}
                      >
                        <Icon className="w-4 h-4 flex-shrink-0" />
                        {!sidebarCollapsed && <span className="truncate">{l.label}</span>}
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* User identity — pinned to bottom */}
        <div className="flex-none px-2 pb-3 pt-1" style={{ borderTop: "1px solid color-mix(in srgb, var(--app-edge) 20%, transparent)" }}>
          {sidebarCollapsed ? (
            /* Collapsed: avatar only, tooltip shows name */
            <div className="flex flex-col items-center gap-1 pt-2">
              <Link href="/profile" title={userName} className="flex-none w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-bold text-white hover:opacity-85 transition-opacity"
                style={{ background: userName ? `linear-gradient(135deg, ${avatarColors(userName)[0]}, ${avatarColors(userName)[1]})` : "var(--app-edge)" }}>
                {userName ? initials(userName) : "?"}
              </Link>
              <button onClick={() => setShowLogoutConfirm(true)}
                title="Log out" className="w-9 h-9 flex items-center justify-center rounded-xl text-app-subtle hover:text-danger hover:bg-danger/10 transition-all">
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            /* Expanded: single row — avatar + name/role + logout icon on far right */
            <div className="flex items-center gap-2.5 px-1 pt-2 group">
              <Link href="/profile" className="flex items-center gap-2.5 flex-1 min-w-0 rounded-xl px-2 py-2 hover:bg-[var(--app-hover-bg)] transition-all duration-150">
                <div className="flex-none w-8 h-8 rounded-xl flex items-center justify-center text-[11px] font-bold text-white shadow-sm"
                  style={{ background: userName ? `linear-gradient(135deg, ${avatarColors(userName)[0]}, ${avatarColors(userName)[1]})` : "var(--app-edge)" }}>
                  {userName ? initials(userName) : "?"}
                </div>
                <div className="min-w-0">
                  <p className="text-fluid-xs font-semibold text-app-text truncate leading-tight">{userName || "Account"}</p>
                  <p className="text-fluid-2xs text-app-subtle capitalize leading-tight">{userRole}</p>
                </div>
              </Link>
              <button
                onClick={() => setShowLogoutConfirm(true)}
                title="Log out"
                className="flex-none w-8 h-8 flex items-center justify-center rounded-xl text-app-subtle hover:text-danger hover:bg-danger/10 transition-all duration-150 opacity-0 group-hover:opacity-100"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>

        {/* Logout confirmation modal */}
        {showLogoutConfirm && (
          <FocusTrap focusTrapOptions={{ allowOutsideClick: true, escapeDeactivates: () => { setShowLogoutConfirm(false); return true; } }}>
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }} role="dialog" aria-modal="true" aria-label="Confirm logout">
              <div className="w-full max-w-sm rounded-2xl p-6 space-y-4 shadow-2xl" style={{ background: "var(--app-panel)", border: "1px solid var(--app-edge)" }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-danger/10 flex items-center justify-center flex-shrink-0">
                    <LogOut className="w-5 h-5 text-danger" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-app-text">Log out?</p>
                    <p className="text-xs text-app-muted mt-0.5">You'll need to sign in again to continue.</p>
                  </div>
                </div>
                <div className="flex gap-2 pt-1">
                  <button onClick={() => setShowLogoutConfirm(false)}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium text-app-subtle hover:text-app-text transition-colors"
                    style={{ background: "var(--app-hover-bg)", border: "1px solid var(--app-edge)" }}>
                    Cancel
                  </button>
                  <button onClick={() => { setShowLogoutConfirm(false); apiFetch("/auth/logout", { method: "POST" }).catch(() => {}).finally(() => { clearToken(); invalidateAuthCache(); window.location.href = "/login"; }); }}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-danger hover:bg-danger/85 transition-colors">
                    Log out
                  </button>
                </div>
              </div>
            </div>
          </FocusTrap>
        )}
      </aside>

      {/* Main area — scrolls independently from sidebar */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Header */}
        <header
          className="flex-none h-14 flex items-center px-5 gap-4"
          style={{
            background: "color-mix(in srgb, var(--app-panel) 85%, transparent)",
            backdropFilter: "blur(20px) saturate(160%)",
            borderBottom: "1px solid color-mix(in srgb, var(--app-edge) 25%, transparent)",
            boxShadow: "0 1px 0 rgba(0,0,0,0.15)",
          }}
        >
          <button
            onClick={() => setMobileOpen(true)}
            className="md:hidden flex-none p-2 -ml-2 rounded-lg text-app-muted hover:text-app-text hover:bg-[var(--app-hover-bg)] transition-colors"
            title="Open menu"
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          <h1 className="flex-1 text-fluid-md font-semibold text-app-text truncate tracking-tight">
            {links.find(l => l.href === pathname)?.label || "Dashboard"}
          </h1>
          <div className="flex-none flex items-center gap-0.5">
            <button
              onClick={openSearch}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-fluid-xs text-app-subtle hover:text-app-muted hover:bg-[var(--app-hover-bg)] transition-all duration-150 border border-transparent hover:border-edge/30"
              title="Search datasets (Ctrl+K)"
            >
              <Search className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Search</span>
              <kbd className="hidden sm:inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono bg-edge/40 text-app-subtle ml-0.5">⌃K</kbd>
            </button>

            {/* Live Job Notifications Bell */}
            <div className="relative" ref={notifRef}>
              <Button
                variant="ghost" size="sm"
                className="relative p-2 rounded-lg text-app-subtle hover:text-app-muted"
                title={wsConnected ? "Live job status (connected)" : "Live job status (reconnecting…)"}
                onClick={() => { setShowNotifs(n => !n); setSeenCount(jobEvents.length); }}
              >
                <Bell className={`w-4 h-4 ${wsConnected ? "text-app-subtle" : "text-amber-500 animate-pulse"}`} />
                {unread > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 flex items-center justify-center min-w-[16px] h-4 px-0.5 rounded-full bg-accent text-void text-[9px] font-bold">
                    {unread > 9 ? "9+" : unread}
                  </span>
                )}
              </Button>
              {showNotifs && (
                <div className="absolute right-0 top-11 w-80 rounded-2xl shadow-card-lg z-50 overflow-hidden" style={{ background: "var(--app-panel)", backdropFilter: "blur(20px)", border: "1px solid var(--app-edge)" }}>
                  <div className="flex items-center justify-between px-4 py-3 border-b border-edge/30">
                    <span className="text-sm font-semibold text-app-text">Job Notifications</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${wsConnected ? "bg-accent/15 text-accent" : "bg-warn/15 text-warn"}`}>
                        {wsConnected ? "Live" : "Reconnecting"}
                      </span>
                      {jobEvents.length > 0 && (
                        <button onClick={clearEvents} className="text-xs text-app-subtle hover:text-app-muted">Clear</button>
                      )}
                    </div>
                  </div>
                  <div className="max-h-72 overflow-y-auto divide-y divide-edge/20">
                    {jobEvents.length === 0 ? (
                      <p className="px-4 py-6 text-xs text-center text-app-subtle">No recent events</p>
                    ) : (
                      jobEvents.slice(0, 20).map((ev: JobEvent, i) => (
                        <div key={i} className="px-4 py-3 flex items-start gap-3">
                          {ev.status === "completed" ? (
                            <CheckCircle2 className="w-4 h-4 text-accent mt-0.5 shrink-0" />
                          ) : ev.status === "failed" ? (
                            <XCircle className="w-4 h-4 text-danger mt-0.5 shrink-0" />
                          ) : (
                            <RefreshCw className="w-4 h-4 text-accent mt-0.5 shrink-0 animate-spin" />
                          )}
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-app-text truncate">
                              {ev.event === "job_update"
                                ? `Job: ${ev.job_name || (ev.job_id != null ? `#${ev.job_id}` : "Scheduled")}`
                                : ev.event === "batch_update"
                                ? `Batch${ev.batch_id != null ? ` #${ev.batch_id}` : ""}`
                                : ev.event}
                            </p>
                            <p className="text-xs text-app-subtle mt-0.5">
                              {ev.event === "batch_update"
                                ? `${ev.completed ?? 0} / ${ev.total ?? "?"} completed${ev.failed ? ` · ${ev.failed} failed` : ""}`
                                : ev.message ?? ev.status}
                            </p>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>
            <Button
              onClick={() => setShowShortcuts(true)}
              variant="ghost"
              size="sm"
              className="p-2 rounded-lg text-app-subtle hover:text-app-muted"
              title="Keyboard Shortcuts (Ctrl+/)"
            >
              <Keyboard className="w-4 h-4" />
            </Button>
            <Button
              onClick={toggleTheme}
              variant="ghost"
              size="sm"
              className="p-2 rounded-lg text-app-subtle hover:text-app-muted"
              title={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
              aria-label={theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode"}
            >
              {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </Button>
          </div>
        </header>

        {/* Page content — only this scrolls */}
        <main id="main-content" className="flex-1 min-h-0 overflow-y-auto p-6 custom-scrollbar">
          <div className="page-enter">{children}</div>
        </main>
      </div>

      {/* Toasts */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {Array.from(toasts.entries()).map(([id, toast]) => (
          <Toast
            key={id}
            message={toast.message}
            type={toast.type}
            duration={toast.duration}
            onClose={() => removeToast(id)}
          />
        ))}
      </div>

      {/* Keyboard Shortcuts Modal */}
      <KeyboardShortcuts isOpen={showShortcuts} onClose={() => setShowShortcuts(false)} />

      {/* Dataset Quick-Search Modal (Ctrl+K) */}
      {showSearch && (
        <FocusTrap focusTrapOptions={{ allowOutsideClick: true, escapeDeactivates: () => { closeSearch(); return true; }, initialFocus: false }}>
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-[14vh] bg-black/60 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget) closeSearch(); }}
          role="dialog"
          aria-modal="true"
          aria-label="Search datasets"
        >
          <div className="w-full max-w-lg mx-4 rounded-xl border border-edge/60 bg-panel shadow-2xl overflow-hidden">
            {/* Search input */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-edge/30">
              <Search className="w-4 h-4 text-app-muted flex-shrink-0" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setSearchIdx(0); }}
                placeholder="Search datasets…"
                className="flex-1 bg-transparent text-sm text-app-text placeholder:text-app-subtle focus:outline-none"
              />
              <button
                onClick={closeSearch}
                className="p-1 rounded text-app-subtle hover:text-app-muted transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Results */}
            <div className="max-h-72 overflow-y-auto custom-scrollbar">
              {searchLoading ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="w-5 h-5 text-accent animate-spin" />
                </div>
              ) : filteredDatasets.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-app-muted">
                  {searchQuery ? `No datasets matching "${searchQuery}"` : "No datasets uploaded yet"}
                </div>
              ) : (
                filteredDatasets.map((ds, idx) => (
                  <Link
                    key={ds.id}
                    href={`/analysis/${ds.id}`}
                    onClick={closeSearch}
                    className={`flex items-center gap-3 px-4 py-3 text-sm transition-colors hover:bg-accent/10 ${
                      searchIdx === idx ? "bg-accent/10" : ""
                    }`}
                  >
                    <FileSpreadsheet className="w-4 h-4 text-app-muted flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-app-text truncate font-medium">{ds.original_filename}</p>
                      {ds.row_count != null && (
                        <p className="text-[11px] text-app-subtle">{ds.row_count.toLocaleString()} rows</p>
                      )}
                    </div>
                    {ds.quality_score != null && (
                      <span className={`text-xs font-semibold ${
                        ds.quality_score >= 80 ? "text-accent" :
                        ds.quality_score >= 60 ? "text-warn" : "text-danger"
                      }`}>
                        {Math.round(ds.quality_score)}%
                      </span>
                    )}
                  </Link>
                ))
              )}
            </div>

            {/* Footer hints */}
            {!searchLoading && filteredDatasets.length > 0 && (
              <div className="px-4 py-2 border-t border-edge/30 flex items-center gap-4 text-[10px] text-app-subtle">
                <span><kbd className="font-mono bg-edge/40 px-1 rounded">↑↓</kbd> navigate</span>
                <span><kbd className="font-mono bg-edge/40 px-1 rounded">↵</kbd> open analysis</span>
                <span><kbd className="font-mono bg-edge/40 px-1 rounded">Esc</kbd> close</span>
              </div>
            )}
          </div>
        </div>
        </FocusTrap>
      )}
      {/* Global confirm dialog */}
      {confirmReq && (
        <FocusTrap focusTrapOptions={{ allowOutsideClick: true, escapeDeactivates: () => { confirmReq.resolve(false); setConfirmReq(null); return true; } }}>
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(4px)" }} role="dialog" aria-modal="true" aria-label="Confirm action">
          <div className="w-full max-w-sm rounded-2xl p-6 space-y-4 shadow-2xl" style={{ background: "var(--app-panel)", border: "1px solid var(--app-edge)" }}>
            <p className="text-sm text-app-text leading-relaxed">{confirmReq.message}</p>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { confirmReq.resolve(false); setConfirmReq(null); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-medium text-app-subtle hover:text-app-text transition-colors"
                style={{ background: "var(--app-hover-bg)", border: "1px solid var(--app-edge)" }}
              >Cancel</button>
              <button
                onClick={() => { confirmReq.resolve(true); setConfirmReq(null); }}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white bg-danger hover:bg-danger/85 transition-colors"
              >Confirm</button>
            </div>
          </div>
        </div>
        </FocusTrap>
      )}
    </div>
    </ShellMountedCtx.Provider>
  );
});

/**
 * Public Shell export.  When a parent Shell is already mounted (e.g., the one
 * placed in the root layout) this renders only its children, avoiding a
 * second sidebar, second set of keyboard listeners, second toast container etc.
 */
export const Shell = memo(function Shell({ children }: { children: ReactNode }) {
  const alreadyMounted = useContext(ShellMountedCtx);
  if (alreadyMounted) return <>{children}</>;
  return <ShellImpl>{children}</ShellImpl>;
});
