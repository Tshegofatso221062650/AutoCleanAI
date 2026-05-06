"use client";

import { useEffect, useState, useCallback, Fragment } from "react";
import { useRouter } from "next/navigation";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch } from "@/lib/api";
import { showConfirm } from "@/lib/confirm";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import {
  Shield, Users, ScrollText, Settings, Loader2, Trash2,
  ChevronUp, ChevronDown, RefreshCw, Database, KeyRound, X,
  Monitor, LogOut, Search, Mail, UserPlus, Download,
} from "lucide-react";

type Tab = "users" | "audit" | "sessions" | "settings";

interface User {
  username: string;
  email: string | null;
  role: string;
  created_at: string;
  dataset_count: number;
}

interface AuditEntry {
  id: number;
  action: string;
  actor: string;
  resource_type: string | null;
  resource_id: string | null;
  detail: string | null;
  ip: string | null;
  ts: string;
}

interface AISettings {
  ai_provider: string;
  ollama_model: string;
  ollama_timeout: number;
  openai_model: string;
  ollama_base_url: string;
  has_openai_key: boolean;
}

interface AdminSession {
  jti: string;
  username: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  expires_at: string;
  revoked: number;
}

export default function AdminPage() {
  const [tab, setTab] = useState<Tab>("users");
  const [users, setUsers] = useState<User[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [aiSettings, setAiSettings] = useState<AISettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const router = useRouter();

  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsForm, setSettingsForm] = useState({ ai_provider: "ollama", ollama_model: "", ollama_timeout: 300, openai_model: "", allow_registration: true });
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [resetPw, setResetPw] = useState("");
  const [resetting, setResetting] = useState(false);

  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [sessionFilter, setSessionFilter] = useState("");
  const [testEmailAddr, setTestEmailAddr] = useState("");
  const [testEmailSending, setTestEmailSending] = useState(false);
  const [auditSearch, setAuditSearch] = useState("");

  const [showCreateUser, setShowCreateUser] = useState(false);
  const [newUser, setNewUser] = useState({ username: "", password: "", email: "", role: "user" });
  const [creatingUser, setCreatingUser] = useState(false);

  useEffect(() => {
    apiFetch("/auth/me")
      .then((me) => {
        if (me.role === "admin") {
          setIsAdmin(true);
        } else {
          router.replace("/home");
        }
      })
      .catch(() => router.replace("/home"));
  }, []);

  const loadUsers = useCallback(() => {
    setLoading(true);
    apiFetch("/users")
      .then((d) => setUsers(d.users || []))
      .catch(() => showToast("Failed to load users", "error"))
      .finally(() => setLoading(false));
  }, []);

  const loadAudit = useCallback(() => {
    setLoading(true);
    apiFetch("/auth/audit-log?limit=200")
      .then((d) => setAudit(d.entries || []))
      .catch(() => showToast("Failed to load audit log", "error"))
      .finally(() => setLoading(false));
  }, []);

  const loadSettings = useCallback(() => {
    apiFetch("/settings")
      .then((d) => {
        setAiSettings(d);
        setSettingsForm({
          ai_provider: d.ai_provider || "ollama",
          ollama_model: d.ollama_model || "",
          ollama_timeout: d.ollama_timeout ?? 300,
          openai_model: d.openai_model || "",
          allow_registration: d.allow_registration !== false,
        });
      })
      .catch(() => {});
  }, []);

  const loadSessions = useCallback(() => {
    setLoading(true);
    apiFetch("/auth/sessions/all?active_only=true")
      .then((d) => setSessions(d.sessions || []))
      .catch(() => showToast("Failed to load sessions", "error"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (isAdmin !== true) return;
    if (tab === "users") loadUsers();
    else if (tab === "audit") loadAudit();
    else if (tab === "sessions") loadSessions();
    else if (tab === "settings") loadSettings();
  }, [tab, isAdmin, loadUsers, loadAudit, loadSessions, loadSettings]);

  async function setRole(username: string, role: string) {
    try {
      await apiFetch(`/users/${username}/role`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      });
      showToast(`${username} is now ${role}`, "success");
      loadUsers();
    } catch (err) {
      showToast(String(err), "error");
    }
  }

  async function resetPassword(username: string) {
    if (resetPw.length < 8) { showToast("Password must be at least 8 characters", "error"); return; }
    setResetting(true);
    try {
      await apiFetch(`/users/${username}/reset-password`, {
        method: "POST",
        body: JSON.stringify({ new_password: resetPw }),
      });
      showToast(`Password reset for ${username}`, "success");
      setResetTarget(null);
      setResetPw("");
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setResetting(false);
    }
  }

  async function deleteUser(username: string) {
    if (!await showConfirm(`Delete user "${username}"? Their datasets will remain but be unowned.`)) return;
    try {
      await apiFetch(`/users/${username}`, { method: "DELETE" });
      showToast(`${username} deleted`, "success");
      loadUsers();
    } catch (err) {
      showToast(String(err), "error");
    }
  }

  async function createUser(e: React.FormEvent) {
    e.preventDefault();
    setCreatingUser(true);
    try {
      await apiFetch("/users/create", {
        method: "POST",
        body: JSON.stringify({
          username: newUser.username.trim().toLowerCase(),
          password: newUser.password,
          email: newUser.email.trim() || undefined,
          role: newUser.role,
        }),
      });
      showToast(`User "${newUser.username}" created`, "success");
      setNewUser({ username: "", password: "", email: "", role: "user" });
      setShowCreateUser(false);
      loadUsers();
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setCreatingUser(false);
    }
  }

  function exportAuditCsv() {
    const header = ["Time", "User", "Action", "Resource", "Detail", "IP"];
    const rows = filteredAudit.map((e) => [
      new Date(e.ts).toISOString(),
      e.actor,
      e.action,
      e.resource_type || "",
      (e.detail || "").replace(/,/g, ";"),
      e.ip || "",
    ]);
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `audit-log-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  async function saveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSavingSettings(true);
    try {
      await apiFetch("/settings", {
        method: "POST",
        body: JSON.stringify(settingsForm),
      });
      showToast("Settings saved", "success");
      loadSettings();
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setSavingSettings(false);
    }
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: "users",    label: "Users",     icon: <Users className="w-4 h-4" /> },
    { id: "audit",   label: "Audit Log", icon: <ScrollText className="w-4 h-4" /> },
    { id: "sessions",label: "Sessions",  icon: <Monitor className="w-4 h-4" /> },
    { id: "settings",label: "Settings",  icon: <Settings className="w-4 h-4" /> },
  ];

  const filteredSessions = sessions.filter((s) =>
    !sessionFilter || s.username.includes(sessionFilter) || (s.ip || "").includes(sessionFilter)
  );

  const filteredAudit = audit.filter((e) => {
    if (!auditSearch) return true;
    const q = auditSearch.toLowerCase();
    return (
      e.actor.toLowerCase().includes(q) ||
      e.action.toLowerCase().includes(q) ||
      (e.resource_type || "").toLowerCase().includes(q) ||
      (e.detail || "").toLowerCase().includes(q) ||
      (e.ip || "").includes(q)
    );
  });

  if (isAdmin === null) {
    return (
      <AuthGate>
        <Shell>
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 text-accent animate-spin" />
          </div>
        </Shell>
      </AuthGate>
    );
  }

  if (isAdmin === false) return null;

  return (
    <AuthGate>
      <Shell>
        <div className="max-w-5xl mx-auto space-y-6">
          {/* Header */}
          <div className="animate-fade-in-down">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
              <Shield className="w-3 h-3" />
              <span>Administration</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="gradient-text">Admin Panel</span>
            </h1>
            <p className="text-sm text-app-muted mt-1.5">Manage users, review audit trails, and configure global settings</p>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 p-1 bg-panel/40 border border-edge/30 rounded-xl w-fit">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                  tab === t.id
                    ? "bg-accent/15 text-accent border border-accent/20"
                    : "text-app-muted hover:text-app-text hover:bg-edge/20"
                }`}
              >
                {t.icon}{t.label}
              </button>
            ))}
          </div>

          {/* Users Tab */}
          {tab === "users" && (
            <div className="glass-card rounded-2xl overflow-hidden animate-fade-in-up">
              <div className="flex items-center justify-between px-5 py-4 border-b border-edge/20">
                <p className="text-sm font-semibold text-app-text flex items-center gap-2">
                  <Users className="w-4 h-4 text-accent" /> Registered Users
                  <span className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[11px] font-semibold">{users.length}</span>
                </p>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={loadUsers} className="flex items-center gap-1.5 text-xs">
                    <RefreshCw className="w-3.5 h-3.5" /> Refresh
                  </Button>
                  <Button variant="primary" size="sm"
                    onClick={() => setShowCreateUser((v) => !v)}
                    className="flex items-center gap-1.5 text-xs">
                    <UserPlus className="w-3.5 h-3.5" /> Create User
                  </Button>
                </div>
              </div>

              {showCreateUser && (
                <form onSubmit={createUser} className="px-5 py-4 border-b border-edge/20 bg-panel/30 space-y-3">
                  <p className="text-xs font-semibold text-app-text">New User</p>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      type="text" required placeholder="Username (min 3 chars)"
                      value={newUser.username}
                      onChange={(e) => setNewUser((u) => ({ ...u, username: e.target.value }))}
                      className="bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-xs font-mono text-app-text focus:outline-none focus:ring-1 focus:ring-accent/40"
                    />
                    <input
                      type="password" required placeholder="Password (min 8 chars)"
                      value={newUser.password}
                      onChange={(e) => setNewUser((u) => ({ ...u, password: e.target.value }))}
                      className="bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-xs font-mono text-app-text focus:outline-none focus:ring-1 focus:ring-accent/40"
                    />
                    <input
                      type="email" placeholder="Email (optional)"
                      value={newUser.email}
                      onChange={(e) => setNewUser((u) => ({ ...u, email: e.target.value }))}
                      className="bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-xs text-app-text focus:outline-none focus:ring-1 focus:ring-accent/40"
                    />
                    <select
                      value={newUser.role}
                      onChange={(e) => setNewUser((u) => ({ ...u, role: e.target.value }))}
                      className="bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-2 text-xs text-app-text focus:outline-none focus:ring-1 focus:ring-accent/40"
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <Button type="submit" variant="primary" size="sm" disabled={creatingUser || newUser.username.length < 3 || newUser.password.length < 8}
                      className="flex items-center gap-1.5 text-xs">
                      {creatingUser ? <Loader2 className="w-3 h-3 animate-spin" /> : <UserPlus className="w-3 h-3" />} Create
                    </Button>
                    <Button type="button" variant="ghost" size="sm"
                      onClick={() => { setShowCreateUser(false); setNewUser({ username: "", password: "", email: "", role: "user" }); }}
                      className="text-xs">
                      Cancel
                    </Button>
                  </div>
                </form>
              )}

              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 text-accent animate-spin" />
                </div>
              ) : users.length === 0 ? (
                <div className="text-center py-12 text-app-muted text-sm">No registered users yet.</div>
              ) : (
                <div className="divide-y divide-edge/10">
                  {users.map((u) => (
                    <Fragment key={u.username}>
                    <div className="flex items-center gap-4 px-5 py-4 hover:bg-panel/30 transition-colors">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                        u.role === "admin" ? "bg-accent/20 text-accent" : "bg-edge/40 text-app-muted"
                      }`}>
                        {u.username[0].toUpperCase()}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-app-text font-mono">{u.username}</span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                            u.role === "admin" ? "bg-accent/15 text-accent" : "bg-edge/30 text-app-subtle"
                          }`}>{u.role}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-0.5">
                          <span className="text-xs text-app-subtle">{u.email || "No email"}</span>
                          <span className="text-xs text-app-subtle flex items-center gap-1">
                            <Database className="w-3 h-3" />{u.dataset_count} datasets
                          </span>
                          {u.created_at && (
                            <span className="text-xs text-app-subtle">Joined {new Date(u.created_at).toLocaleDateString()}</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        {u.role === "admin" ? (
                          <Button variant="ghost" size="sm" onClick={() => setRole(u.username, "user")}
                            className="flex items-center gap-1 text-xs text-app-muted hover:text-warn">
                            <ChevronDown className="w-3.5 h-3.5" /> Demote
                          </Button>
                        ) : (
                          <Button variant="ghost" size="sm" onClick={() => setRole(u.username, "admin")}
                            className="flex items-center gap-1 text-xs text-app-muted hover:text-accent">
                            <ChevronUp className="w-3.5 h-3.5" /> Promote
                          </Button>
                        )}
                        <Button variant="ghost" size="sm"
                          onClick={() => { setResetTarget(u.username === resetTarget ? null : u.username); setResetPw(""); }}
                          className="flex items-center gap-1 text-xs text-app-muted hover:text-accent2"
                          title="Reset password">
                          <KeyRound className="w-3.5 h-3.5" />
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => deleteUser(u.username)}
                          className="flex items-center gap-1 text-xs text-app-muted hover:text-danger">
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    </div>
                    {resetTarget === u.username && (
                      <div className="flex items-center gap-2 px-5 pb-3">
                        <KeyRound className="w-3.5 h-3.5 text-app-subtle flex-shrink-0" />
                        <input
                          type="password"
                          autoFocus
                          placeholder="New password (min 8 chars)"
                          value={resetPw}
                          onChange={(e) => setResetPw(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") void resetPassword(u.username); if (e.key === "Escape") { setResetTarget(null); setResetPw(""); } }}
                          className="flex-1 bg-[var(--app-input-bg)] border border-edge/60 rounded-lg px-3 py-1.5 text-xs font-mono text-app-text focus:outline-none focus:ring-1 focus:ring-accent/40"
                        />
                        <Button variant="primary" size="sm" disabled={resetting || resetPw.length < 8}
                          onClick={() => void resetPassword(u.username)}
                          className="text-xs px-3 py-1.5">
                          {resetting ? <Loader2 className="w-3 h-3 animate-spin" /> : "Set"}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => { setResetTarget(null); setResetPw(""); }}>
                          <X className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    )}
                    </Fragment>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Sessions Tab */}
          {tab === "sessions" && (
            <div className="glass-card rounded-2xl overflow-hidden animate-fade-in-up">
              <div className="flex items-center justify-between px-5 py-4 border-b border-edge/20 gap-3">
                <p className="text-sm font-semibold text-app-text flex items-center gap-2">
                  <Monitor className="w-4 h-4 text-accent" /> Active Sessions
                  <span className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[11px] font-semibold">{filteredSessions.length}</span>
                </p>
                <div className="flex items-center gap-2 flex-1 max-w-xs">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-app-subtle pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Filter by user or IP"
                      value={sessionFilter}
                      onChange={(e) => setSessionFilter(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--app-input-bg)] border border-edge/60 rounded-lg text-app-text focus:outline-none focus:ring-1 focus:ring-accent/40"
                    />
                  </div>
                  <Button variant="ghost" size="sm" onClick={loadSessions} className="flex items-center gap-1 text-xs">
                    <RefreshCw className="w-3 h-3" />
                  </Button>
                </div>
              </div>

              {loading ? (
                <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 text-accent animate-spin" /></div>
              ) : filteredSessions.length === 0 ? (
                <p className="text-center py-12 text-app-muted text-sm">No active sessions found.</p>
              ) : (
                <div className="divide-y divide-edge/10">
                  {filteredSessions.map((s) => (
                    <div key={s.jti} className="flex items-start gap-4 px-5 py-3 hover:bg-panel/30 transition-colors">
                      <div className="w-7 h-7 rounded-full bg-edge/40 flex items-center justify-center text-[11px] font-bold text-app-muted flex-shrink-0 mt-0.5">
                        {s.username[0]?.toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-mono text-app-text">{s.username}</span>
                          <span className="text-[10px] text-app-subtle font-mono">{s.ip || "unknown IP"}</span>
                        </div>
                        {s.user_agent && (
                          <p className="text-[11px] text-app-subtle truncate max-w-md">{s.user_agent}</p>
                        )}
                        <p className="text-[10px] text-app-subtle mt-0.5">
                          Signed in {new Date(s.created_at).toLocaleString()} · expires {new Date(s.expires_at).toLocaleString()}
                        </p>
                      </div>
                      <button
                        type="button"
                        title="Force revoke session"
                        onClick={async () => {
                          try {
                            await apiFetch(`/auth/sessions/${s.jti}/force`, { method: "DELETE" });
                            setSessions((prev) => prev.filter((x) => x.jti !== s.jti));
                            showToast(`Session revoked for ${s.username}`, "success");
                          } catch (err) { showToast(String(err), "error"); }
                        }}
                        className="p-1.5 rounded-lg text-app-muted hover:text-danger hover:bg-danger/10 transition-colors flex-shrink-0"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Audit Log Tab */}
          {tab === "audit" && (
            <div className="glass-card rounded-2xl overflow-hidden animate-fade-in-up">
              <div className="flex items-center justify-between px-5 py-4 border-b border-edge/20 gap-3">
                <p className="text-sm font-semibold text-app-text flex items-center gap-2">
                  <ScrollText className="w-4 h-4 text-accent" /> Audit Log
                  <span className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-[11px] font-semibold">{filteredAudit.length}{auditSearch ? `/${audit.length}` : ""}</span>
                </p>
                <div className="flex items-center gap-2 flex-1 max-w-sm">
                  <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-app-subtle pointer-events-none" />
                    <input
                      type="text"
                      placeholder="Search user, action, detail…"
                      value={auditSearch}
                      onChange={(e) => setAuditSearch(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-xs bg-[var(--app-input-bg)] border border-edge/60 rounded-lg text-app-text focus:outline-none focus:ring-1 focus:ring-accent/40"
                    />
                  </div>
                  <Button variant="ghost" size="sm" onClick={loadAudit} className="flex items-center gap-1 text-xs">
                    <RefreshCw className="w-3 h-3" />
                  </Button>
                  <Button variant="ghost" size="sm" onClick={exportAuditCsv} title="Download CSV"
                    className="flex items-center gap-1 text-xs">
                    <Download className="w-3 h-3" /> CSV
                  </Button>
                </div>
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="w-6 h-6 text-accent animate-spin" />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-edge/20 bg-panel/30">
                        <th className="text-left px-4 py-3 text-app-subtle font-semibold uppercase tracking-wide">Time</th>
                        <th className="text-left px-4 py-3 text-app-subtle font-semibold uppercase tracking-wide">User</th>
                        <th className="text-left px-4 py-3 text-app-subtle font-semibold uppercase tracking-wide">Action</th>
                        <th className="text-left px-4 py-3 text-app-subtle font-semibold uppercase tracking-wide">Resource</th>
                        <th className="text-left px-4 py-3 text-app-subtle font-semibold uppercase tracking-wide">Detail</th>
                        <th className="text-left px-4 py-3 text-app-subtle font-semibold uppercase tracking-wide">IP</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-edge/10">
                      {filteredAudit.map((e) => (
                        <tr key={e.id} className="hover:bg-panel/30 transition-colors">
                          <td className="px-4 py-2.5 text-app-subtle font-mono whitespace-nowrap">
                            {new Date(e.ts).toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5 text-app-text font-mono">{e.actor}</td>
                          <td className="px-4 py-2.5">
                            <span className={`px-1.5 py-0.5 rounded font-semibold ${
                              e.action.includes("fail") || e.action.includes("delete") ? "text-danger bg-danger/10" :
                              e.action.includes("login") ? "text-accent bg-accent/10" :
                              "text-app-muted bg-panel/60"
                            }`}>{e.action}</span>
                          </td>
                          <td className="px-4 py-2.5 text-app-subtle font-mono">
                            {e.resource_type ? `${e.resource_type}` : "—"}
                          </td>
                          <td className="px-4 py-2.5 text-app-subtle max-w-xs truncate">{e.detail || "—"}</td>
                          <td className="px-4 py-2.5 text-app-subtle font-mono">{e.ip || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {filteredAudit.length === 0 && (
                    <p className="text-center py-12 text-app-muted">{auditSearch ? "No entries match your search." : "No audit entries found."}</p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* AI Settings Tab */}
          {tab === "settings" && (
            <form onSubmit={saveSettings} className="glass-card rounded-2xl p-6 space-y-6 animate-fade-in-up">
              <h2 className="text-sm font-semibold text-app-text flex items-center gap-2">
                <Settings className="w-4 h-4 text-accent" /> Global AI Configuration
                <span className="text-[11px] text-app-subtle font-normal ml-1">(applies to all users)</span>
              </h2>

              <div className="space-y-2">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle">AI Provider</label>
                <select
                  className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-xl px-4 py-3 text-app-text text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                  value={settingsForm.ai_provider}
                  onChange={(e) => setSettingsForm((f) => ({ ...f, ai_provider: e.target.value }))}
                >
                  <option value="ollama">Ollama (local, free)</option>
                  <option value="openai">OpenAI (requires API key)</option>
                  <option value="none">None (heuristics only)</option>
                </select>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle">Ollama Model</label>
                  <input
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-xl px-4 py-3 text-app-text font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                    value={settingsForm.ollama_model}
                    onChange={(e) => setSettingsForm((f) => ({ ...f, ollama_model: e.target.value }))}
                    placeholder="phi3:mini, mistral, llama3"
                  />
                </div>
                <div className="space-y-2">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle">Ollama Timeout (s)</label>
                  <input
                    type="number" min={10} max={3600}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-xl px-4 py-3 text-app-text font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                    value={settingsForm.ollama_timeout}
                    onChange={(e) => setSettingsForm((f) => ({ ...f, ollama_timeout: Number(e.target.value) }))}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle">OpenAI Model</label>
                <input
                  className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-xl px-4 py-3 text-app-text font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
                  value={settingsForm.openai_model}
                  onChange={(e) => setSettingsForm((f) => ({ ...f, openai_model: e.target.value }))}
                  placeholder="gpt-4o-mini, gpt-4"
                />
              </div>

              {aiSettings && (
                <div className="flex items-center gap-2 p-4 rounded-xl bg-panel/60 border border-edge/40 text-sm">
                  <span className="text-app-muted">Ollama URL:</span>
                  <span className="font-mono text-app-text">{aiSettings.ollama_base_url}</span>
                  <span className="text-app-subtle text-xs ml-2">(env var)</span>
                  <span className="ml-auto text-xs text-app-subtle">
                    OpenAI key: {aiSettings.has_openai_key
                      ? <span className="text-accent font-semibold">Configured</span>
                      : <span className="text-danger">Not set</span>}
                  </span>
                </div>
              )}

              <div className="flex items-center justify-between p-4 rounded-xl bg-panel/60 border border-edge/40">
                <div>
                  <p className="text-sm font-semibold text-app-text">User Self-Registration</p>
                  <p className="text-xs text-app-muted mt-0.5">Allow new users to create accounts from the login page</p>
                </div>
                <button
                  type="button"
                  onClick={() => setSettingsForm((f) => ({ ...f, allow_registration: !f.allow_registration }))}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    settingsForm.allow_registration ? "bg-accent" : "bg-edge/60"
                  }`}
                >
                  <span className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    settingsForm.allow_registration ? "translate-x-6" : "translate-x-1"
                  }`} />
                </button>
              </div>

              <Button type="submit" variant="primary" disabled={savingSettings} className="flex items-center gap-2">
                {savingSettings ? <Loader2 className="w-4 h-4 animate-spin" /> : <Settings className="w-4 h-4" />}
                Save Global Settings
              </Button>
            </form>
          )}

          {/* SMTP Test — shown in settings tab below main form */}
          {tab === "settings" && (
            <div className="glass-card rounded-2xl p-6 space-y-4 animate-fade-in-up">
              <h2 className="text-sm font-semibold text-app-text flex items-center gap-2">
                <Mail className="w-4 h-4 text-accent" /> SMTP Email Test
                <span className="text-[11px] text-app-subtle font-normal ml-1">(configure via env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM)</span>
              </h2>
              <p className="text-xs text-app-muted">Send a test email to verify your SMTP configuration is working correctly.</p>
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  placeholder="Send test to…"
                  value={testEmailAddr}
                  onChange={(e) => setTestEmailAddr(e.target.value)}
                  className="flex-1 bg-[var(--app-input-bg)] border border-edge/60 rounded-xl px-4 py-2.5 text-app-text text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition-all"
                />
                <Button
                  variant="primary"
                  disabled={testEmailSending || !testEmailAddr.includes("@")}
                  onClick={async () => {
                    setTestEmailSending(true);
                    try {
                      await apiFetch("/auth/test-email", {
                        method: "POST",
                        body: JSON.stringify({ to: testEmailAddr }),
                      });
                      showToast(`Test email sent to ${testEmailAddr}`, "success");
                      setTestEmailAddr("");
                    } catch (err) {
                      showToast(String(err), "error");
                    } finally {
                      setTestEmailSending(false);
                    }
                  }}
                  className="flex items-center gap-2 whitespace-nowrap"
                >
                  {testEmailSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                  Send Test
                </Button>
              </div>
            </div>
          )}
        </div>
      </Shell>
    </AuthGate>
  );
}
