"use client";

import { useEffect, useState } from "react";
import { AuthGate, invalidateAuthCache } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, clearToken } from "@/lib/api";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import { User, Lock, Mail, Shield, Database, CheckCircle, Loader2, KeyRound, Plus, Trash2, Copy, Monitor, ShieldCheck, ShieldOff, Globe, LogOut } from "lucide-react";

interface Profile {
  username: string;
  email: string | null;
  role: string;
  created_at: string;
  dataset_count?: number;
}

interface Session {
  jti: string;
  ip: string | null;
  user_agent: string | null;
  created_at: string;
  is_current: boolean;
}

interface ApiKey {
  id: number;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
}

const AVATAR_COLORS = [
  ["#00d9a5", "#00b8ff"],
  ["#6366f1", "#a855f7"],
  ["#f59e0b", "#ef4444"],
  ["#10b981", "#3b82f6"],
  ["#ec4899", "#8b5cf6"],
  ["#14b8a6", "#0ea5e9"],
];

function getAvatarColors(username: string): [string, string] {
  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = username.charCodeAt(i) + ((hash << 5) - hash);
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function getInitials(username: string): string {
  const parts = username.replace(/[._-]/g, " ").split(" ").filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return username.slice(0, 2).toUpperCase();
}

export default function ProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwSaving, setPwSaving] = useState(false);

  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [newKeyName, setNewKeyName] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [revealedKey, setRevealedKey] = useState<{ id: number; key: string } | null>(null);

  const [sessions, setSessions] = useState<Session[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  const [totpEnabled, setTotpEnabled] = useState(false);
  const [totpSetup, setTotpSetup] = useState<{ secret: string; provisioning_uri: string } | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpDisableCode, setTotpDisableCode] = useState("");
  const [totpSaving, setTotpSaving] = useState(false);
  const [showDisableTotp, setShowDisableTotp] = useState(false);

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);

  function loadSessions() {
    setSessionsLoading(true);
    apiFetch("/auth/sessions")
      .then((d) => setSessions(d.sessions || []))
      .catch(() => {})
      .finally(() => setSessionsLoading(false));
  }

  function loadApiKeys() {
    apiFetch("/api-keys")
      .then((d) => setApiKeys(d.keys || []))
      .catch(() => {});
  }

  useEffect(() => {
    Promise.all([
      apiFetch("/users/me"),
      apiFetch("/history"),
      apiFetch("/api-keys").catch(() => ({ keys: [] })),
      apiFetch("/auth/sessions").catch(() => ({ sessions: [] })),
      apiFetch("/auth/totp/status").catch(() => ({ enabled: false })),
    ])
      .then(([me, hist, keys, sess, totp]) => {
        setProfile({ ...me, dataset_count: (hist.items || []).length });
        setApiKeys(keys.keys || []);
        setSessions(sess.sessions || []);
        setTotpEnabled(!!totp.enabled);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function createApiKey(e: React.FormEvent) {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setCreatingKey(true);
    try {
      const res = await apiFetch("/api-keys", {
        method: "POST",
        body: JSON.stringify({ name: newKeyName.trim() }),
      });
      setRevealedKey({ id: res.id, key: res.key });
      setNewKeyName("");
      loadApiKeys();
      showToast("API key created — copy it now, it won't be shown again", "success");
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setCreatingKey(false);
    }
  }

  async function revokeApiKey(id: number) {
    try {
      await apiFetch(`/api-keys/${id}`, { method: "DELETE" });
      if (revealedKey?.id === id) setRevealedKey(null);
      loadApiKeys();
      showToast("API key revoked", "success");
    } catch (err) {
      showToast(String(err), "error");
    }
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    if (newPw !== confirmPw) { showToast("Passwords do not match", "error"); return; }
    if (newPw.length < 8) { showToast("Password must be at least 8 characters", "error"); return; }
    setPwSaving(true);
    try {
      await apiFetch("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ current_password: currentPw, new_password: newPw }),
      });
      showToast("Password updated successfully", "success");
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <AuthGate>
      <Shell>
        <div className="max-w-2xl mx-auto space-y-8">
          <div className="animate-fade-in-down">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
              <User className="w-3 h-3" />
              <span>My Account</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="gradient-text">Profile</span>
            </h1>
            <p className="text-sm text-app-muted mt-1.5">Manage your account details and security</p>
          </div>

          {loading ? (
            <div className="glass-card rounded-2xl p-8 flex items-center justify-center">
              <Loader2 className="w-6 h-6 text-accent animate-spin" />
            </div>
          ) : profile ? (
            <>
              {/* Identity card */}
              <div className="glass-card rounded-2xl p-6 space-y-5 animate-fade-in-up">
                <h2 className="text-sm font-semibold text-app-text flex items-center gap-2">
                  <User className="w-4 h-4 text-accent" /> Account Info
                </h2>

                {/* Avatar */}
                <div className="flex items-center gap-5">
                  {(() => {
                    const [c1, c2] = getAvatarColors(profile.username);
                    return (
                      <div
                        className="flex-none w-20 h-20 rounded-2xl flex items-center justify-center text-2xl font-bold text-white shadow-lg select-none"
                        style={{ background: `linear-gradient(135deg, ${c1}, ${c2})` }}
                      >
                        {getInitials(profile.username)}
                      </div>
                    );
                  })()}
                  <div className="min-w-0">
                    <p className="text-xl font-bold text-app-text truncate">{profile.username}</p>
                    <p className="text-sm text-app-muted truncate">{profile.email || "No email set"}</p>
                    <span className={`inline-flex items-center gap-1 mt-1.5 px-2 py-0.5 rounded-full text-[11px] font-semibold ${
                      profile.role === "admin" ? "bg-accent/15 text-accent" : "bg-edge/40 text-app-subtle"
                    }`}>
                      <Shield className="w-3 h-3" />{profile.role}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-app-subtle">Username</p>
                    <p className="text-sm font-mono text-app-text">{profile.username}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-app-subtle">Role</p>
                    <div className="flex items-center gap-1.5">
                      <Shield className={`w-3.5 h-3.5 ${profile.role === "admin" ? "text-accent" : "text-app-subtle"}`} />
                      <span className={`text-sm capitalize ${profile.role === "admin" ? "text-accent font-semibold" : "text-app-text"}`}>
                        {profile.role}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-app-subtle">Email</p>
                    <div className="flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-app-subtle" />
                      <span className="text-sm text-app-muted">{profile.email || "Not set"}</span>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <p className="text-[11px] font-semibold uppercase tracking-wider text-app-subtle">Member since</p>
                    <p className="text-sm text-app-muted">
                      {profile.created_at ? new Date(profile.created_at).toLocaleDateString() : "—"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 p-4 rounded-xl bg-panel/60 border border-edge/40">
                  <Database className="w-4 h-4 text-accent" />
                  <span className="text-sm text-app-muted">Your datasets:</span>
                  <span className="text-sm font-semibold text-app-text">{profile.dataset_count ?? 0}</span>
                </div>
              </div>

              {/* Change password */}
              <form onSubmit={changePassword} className="glass-card rounded-2xl p-6 space-y-5 animate-fade-in-up">
                <h2 className="text-sm font-semibold text-app-text flex items-center gap-2">
                  <Lock className="w-4 h-4 text-accent" /> Change Password
                </h2>

                <div className="space-y-2">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle">Current Password</label>
                  <input
                    type="password"
                    value={currentPw}
                    onChange={(e) => setCurrentPw(e.target.value)}
                    required
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-xl px-4 py-3 text-app-text text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition-all"
                    placeholder="••••••••"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle">New Password</label>
                  <input
                    type="password"
                    value={newPw}
                    onChange={(e) => setNewPw(e.target.value)}
                    required
                    minLength={8}
                    className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-xl px-4 py-3 text-app-text text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition-all"
                    placeholder="Min 8 characters"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle">Confirm New Password</label>
                  <input
                    type="password"
                    value={confirmPw}
                    onChange={(e) => setConfirmPw(e.target.value)}
                    required
                    className={`w-full bg-[var(--app-input-bg)] border rounded-xl px-4 py-3 text-app-text text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 transition-all ${
                      confirmPw && newPw !== confirmPw ? "border-danger/60" : "border-edge/60 focus:border-accent/40"
                    }`}
                    placeholder="Repeat new password"
                  />
                  {confirmPw && newPw !== confirmPw && (
                    <p className="text-[11px] text-danger">Passwords do not match</p>
                  )}
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  disabled={pwSaving || !currentPw || !newPw || newPw !== confirmPw}
                  className="flex items-center gap-2"
                >
                  {pwSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
                  Update Password
                </Button>
              </form>

              {/* Sessions */}
              <div className="glass-card rounded-2xl p-6 space-y-5 animate-fade-in-up">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold text-app-text flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-accent" /> Active Sessions
                  </h2>
                  <button
                    type="button"
                    onClick={loadSessions}
                    className="text-[11px] text-app-subtle hover:text-accent transition-colors"
                  >
                    Refresh
                  </button>
                </div>

                {sessionsLoading ? (
                  <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-accent" /></div>
                ) : sessions.length === 0 ? (
                  <p className="text-xs text-app-muted py-2">No session data — sessions are recorded from the next login.</p>
                ) : (
                  <div className="divide-y divide-edge/10">
                    {sessions.map((s) => (
                      <div key={s.jti} className="flex items-start gap-3 py-3">
                        <Globe className="w-3.5 h-3.5 text-app-subtle flex-shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm text-app-text font-mono">{s.ip || "unknown IP"}</span>
                            {s.is_current && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30 font-semibold">
                                Current
                              </span>
                            )}
                          </div>
                          {s.user_agent && (
                            <p className="text-[11px] text-app-subtle truncate max-w-xs">{s.user_agent}</p>
                          )}
                          <p className="text-[10px] text-app-subtle mt-0.5">
                            Signed in {new Date(s.created_at).toLocaleString()}
                          </p>
                        </div>
                        {!s.is_current && (
                          <button
                            type="button"
                            title="Revoke session"
                            onClick={async () => {
                              try {
                                await apiFetch(`/auth/sessions/${s.jti}`, { method: "DELETE" });
                                setSessions((prev) => prev.filter((x) => x.jti !== s.jti));
                                showToast("Session revoked", "success");
                              } catch (err) { showToast(String(err), "error"); }
                            }}
                            className="p-1.5 rounded-lg text-app-muted hover:text-danger hover:bg-danger/10 transition-colors flex-shrink-0"
                          >
                            <LogOut className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 2FA / TOTP */}
              {profile.username !== "owner" && (
                <div className="glass-card rounded-2xl p-6 space-y-5 animate-fade-in-up">
                  <h2 className="text-sm font-semibold text-app-text flex items-center gap-2">
                    {totpEnabled
                      ? <ShieldCheck className="w-4 h-4 text-accent" />
                      : <ShieldOff className="w-4 h-4 text-app-subtle" />}
                    Two-Factor Authentication (TOTP)
                    {totpEnabled && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30 font-semibold ml-1">Enabled</span>
                    )}
                  </h2>

                  {totpEnabled ? (
                    <div className="space-y-4">
                      <p className="text-xs text-app-muted">2FA is active. Your account requires a TOTP code on every login.</p>
                      {!showDisableTotp ? (
                        <button
                          type="button"
                          onClick={() => setShowDisableTotp(true)}
                          className="text-sm px-4 py-2 rounded-xl border border-danger/40 text-danger hover:bg-danger/10 transition-colors"
                        >
                          Disable 2FA
                        </button>
                      ) : (
                        <div className="space-y-3 p-4 rounded-xl bg-danger/5 border border-danger/20">
                          <p className="text-xs text-danger">Enter your current TOTP code to confirm disabling 2FA:</p>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              maxLength={6}
                              value={totpDisableCode}
                              onChange={(e) => setTotpDisableCode(e.target.value.replace(/\D/g, ""))}
                              placeholder="6-digit code"
                              className="flex-1 bg-[var(--app-input-bg)] border border-edge/60 rounded-xl px-4 py-2 text-app-text text-sm font-mono focus:outline-none focus:ring-2 focus:ring-danger/40 transition-all"
                            />
                            <button
                              type="button"
                              disabled={totpSaving || totpDisableCode.length !== 6}
                              onClick={async () => {
                                setTotpSaving(true);
                                try {
                                  await apiFetch("/auth/totp", { method: "DELETE", body: JSON.stringify({ code: totpDisableCode }) });
                                  setTotpEnabled(false); setShowDisableTotp(false); setTotpDisableCode("");
                                  showToast("2FA disabled", "success");
                                } catch (err) { showToast(String(err), "error"); }
                                finally { setTotpSaving(false); }
                              }}
                              className="px-4 py-2 rounded-xl bg-danger/10 border border-danger/40 text-danger text-sm font-semibold disabled:opacity-40 hover:bg-danger/20 transition-colors"
                            >
                              {totpSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Disable"}
                            </button>
                          </div>
                          <button type="button" onClick={() => setShowDisableTotp(false)} className="text-[11px] text-app-subtle hover:text-app-muted underline">Cancel</button>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      <p className="text-xs text-app-muted">Add an extra layer of security. Use any TOTP app (Google Authenticator, Authy, 1Password).</p>

                      {!totpSetup ? (
                        <button
                          type="button"
                          disabled={totpSaving}
                          onClick={async () => {
                            setTotpSaving(true);
                            try {
                              const res = await apiFetch("/auth/totp/setup", { method: "POST" });
                              setTotpSetup(res); setTotpCode("");
                            } catch (err) { showToast(String(err), "error"); }
                            finally { setTotpSaving(false); }
                          }}
                          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-accent/10 border border-accent/30 text-accent text-sm font-semibold hover:bg-accent/20 disabled:opacity-40 transition-colors"
                        >
                          {totpSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                          Set up 2FA
                        </button>
                      ) : (
                        <div className="space-y-4">
                          <div className="p-4 rounded-xl bg-panel/60 border border-edge/40 space-y-3">
                            <p className="text-xs font-semibold text-app-text">1. Open your authenticator app and add a new account manually</p>
                            <div className="space-y-1">
                              <p className="text-[11px] text-app-subtle uppercase tracking-wider">Secret key (base32)</p>
                              <div className="flex items-center gap-2">
                                <code className="flex-1 text-xs font-mono text-accent bg-accent/5 border border-accent/20 rounded-lg px-3 py-2 break-all">
                                  {totpSetup.secret}
                                </code>
                                <button
                                  type="button"
                                  onClick={() => { void navigator.clipboard.writeText(totpSetup.secret); showToast("Copied!", "success"); }}
                                  className="p-2 rounded-lg border border-edge/40 text-app-muted hover:text-accent transition-colors"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                            <p className="text-[11px] text-app-subtle">Issuer: <strong>AutoClean AI</strong> · Account: <strong>{profile.username}</strong></p>
                          </div>

                          <div className="space-y-2">
                            <p className="text-xs font-semibold text-app-text">2. Enter the 6-digit code from your app to confirm</p>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                inputMode="numeric"
                                maxLength={6}
                                value={totpCode}
                                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                                placeholder="000000"
                                className="flex-1 bg-[var(--app-input-bg)] border border-edge/60 rounded-xl px-4 py-2 text-app-text text-sm font-mono text-center tracking-widest focus:outline-none focus:ring-2 focus:ring-accent/40 transition-all"
                              />
                              <button
                                type="button"
                                disabled={totpSaving || totpCode.length !== 6}
                                onClick={async () => {
                                  setTotpSaving(true);
                                  try {
                                    await apiFetch("/auth/totp/verify", { method: "POST", body: JSON.stringify({ code: totpCode }) });
                                    setTotpEnabled(true); setTotpSetup(null); setTotpCode("");
                                    showToast("2FA enabled successfully!", "success");
                                  } catch (err) { showToast(String(err), "error"); }
                                  finally { setTotpSaving(false); }
                                }}
                                className="px-4 py-2 rounded-xl bg-accent/10 border border-accent/30 text-accent text-sm font-semibold disabled:opacity-40 hover:bg-accent/20 transition-colors"
                              >
                                {totpSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : "Verify & Enable"}
                              </button>
                            </div>
                          </div>
                          <button type="button" onClick={() => setTotpSetup(null)} className="text-[11px] text-app-subtle hover:text-app-muted underline">Cancel</button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* API Keys */}
              <div className="glass-card rounded-2xl p-6 space-y-5 animate-fade-in-up">
                <h2 className="text-sm font-semibold text-app-text flex items-center gap-2">
                  <KeyRound className="w-4 h-4 text-accent" /> API Keys
                  <span className="text-[11px] text-app-subtle font-normal ml-1">
                    — use <code className="font-mono text-accent/80">X-Api-Key: sk-…</code> header
                  </span>
                </h2>

                {revealedKey && (
                  <div className="p-4 rounded-xl bg-accent/8 border border-accent/25 space-y-2">
                    <p className="text-[11px] font-semibold text-accent uppercase tracking-wider">
                      ⚠ Copy your key now — it won&apos;t be shown again
                    </p>
                    <div className="flex items-center gap-2">
                      <code className="flex-1 text-xs font-mono text-app-text bg-panel/80 border border-edge/40 rounded-lg px-3 py-2 break-all">
                        {revealedKey.key}
                      </code>
                      <button
                        type="button"
                        onClick={() => {
                          void navigator.clipboard.writeText(revealedKey.key);
                          showToast("Copied!", "success");
                        }}
                        className="p-2 rounded-lg border border-edge/40 text-app-muted hover:text-accent hover:border-accent/40 transition-colors"
                        title="Copy to clipboard"
                      >
                        <Copy className="w-4 h-4" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setRevealedKey(null)}
                      className="text-[11px] text-app-subtle hover:text-app-muted underline"
                    >
                      Dismiss
                    </button>
                  </div>
                )}

                {apiKeys.length > 0 && (
                  <div className="divide-y divide-edge/10">
                    {apiKeys.map((k) => (
                      <div key={k.id} className="flex items-center gap-3 py-3">
                        <KeyRound className="w-3.5 h-3.5 text-app-subtle flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-app-text">{k.name}</p>
                          <p className="text-[11px] font-mono text-app-subtle">{k.key_prefix}••••••••••••••••</p>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="text-[10px] text-app-subtle">
                            Created {new Date(k.created_at).toLocaleDateString()}
                          </p>
                          {k.last_used_at && (
                            <p className="text-[10px] text-accent">
                              Last used {new Date(k.last_used_at).toLocaleDateString()}
                            </p>
                          )}
                        </div>
                        <button
                          type="button"
                          onClick={() => void revokeApiKey(k.id)}
                          className="p-1.5 rounded-lg text-app-muted hover:text-danger hover:bg-danger/10 transition-colors"
                          title="Revoke key"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {apiKeys.length === 0 && !revealedKey && (
                  <p className="text-xs text-app-muted py-2">
                    No API keys yet. Create one below to access the platform programmatically.
                  </p>
                )}

                <form onSubmit={createApiKey} className="flex items-center gap-2 pt-2 border-t border-edge/20">
                  <input
                    type="text"
                    placeholder="Key label (e.g. CI pipeline, Jupyter)"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    className="flex-1 bg-[var(--app-input-bg)] border border-edge/60 rounded-xl px-4 py-2.5 text-app-text text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition-all"
                  />
                  <Button
                    type="submit"
                    variant="primary"
                    disabled={creatingKey || !newKeyName.trim()}
                    className="flex items-center gap-1.5 whitespace-nowrap"
                  >
                    {creatingKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Generate
                  </Button>
                </form>
              </div>

              {/* Danger zone */}
              {profile.role !== "admin" && (
                <div className="glass-card rounded-2xl p-6 space-y-4 animate-fade-in-up" style={{ border: "1px solid color-mix(in srgb, var(--app-danger, #ef4444) 30%, transparent)" }}>
                  <h2 className="text-sm font-semibold text-danger flex items-center gap-2">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                    Danger Zone
                  </h2>
                  <div className="flex items-center justify-between p-4 rounded-xl" style={{ background: "color-mix(in srgb, var(--app-danger, #ef4444) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--app-danger, #ef4444) 20%, transparent)" }}>
                    <div>
                      <p className="text-sm font-medium text-app-text">Delete my account</p>
                      <p className="text-xs text-app-muted mt-0.5">Permanently removes your account and all your datasets. This cannot be undone.</p>
                    </div>
                    <button onClick={() => setShowDeleteModal(true)}
                      className="ml-4 flex-shrink-0 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-danger hover:bg-danger/85 transition-colors">
                      Delete account
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="glass-card rounded-2xl p-8 text-center text-app-muted text-sm">
              Failed to load profile.
            </div>
          )}

          {/* Delete account modal */}
          {showDeleteModal && profile && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}>
              <div className="w-full max-w-sm rounded-2xl p-6 space-y-5 shadow-2xl" style={{ background: "var(--app-panel)", border: "1px solid color-mix(in srgb, var(--app-danger,#ef4444) 40%, transparent)" }}>
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-xl bg-danger/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <svg className="w-5 h-5 text-danger" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" /></svg>
                  </div>
                  <div>
                    <p className="text-sm font-bold text-app-text">Delete account permanently?</p>
                    <p className="text-xs text-app-muted mt-1">This will delete your account and <strong>all your datasets</strong>. There is no way to recover this data.</p>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Type <span className="text-danger font-mono">{profile.username}</span> to confirm</label>
                    <input type="text" value={deleteConfirmText} onChange={(e) => setDeleteConfirmText(e.target.value)}
                      placeholder={profile.username}
                      className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-xl px-4 py-2.5 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-danger/40 focus:border-danger/40 transition-all" />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle mb-1.5">Confirm password</label>
                    <input type="password" value={deletePassword} onChange={(e) => setDeletePassword(e.target.value)}
                      placeholder="Your current password"
                      className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-xl px-4 py-2.5 text-sm text-app-text focus:outline-none focus:ring-2 focus:ring-danger/40 focus:border-danger/40 transition-all" />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setShowDeleteModal(false); setDeletePassword(""); setDeleteConfirmText(""); }}
                    className="flex-1 py-2.5 rounded-xl text-sm font-medium text-app-subtle hover:text-app-text transition-colors"
                    style={{ background: "var(--app-hover-bg)", border: "1px solid var(--app-edge)" }}>
                    Cancel
                  </button>
                  <button
                    disabled={deleteConfirmText !== profile.username || !deletePassword || deleting}
                    onClick={async () => {
                      setDeleting(true);
                      try {
                        await apiFetch("/auth/me", { method: "DELETE", body: JSON.stringify({ password: deletePassword }) });
                        clearToken();
                        invalidateAuthCache();
                        window.location.href = "/login";
                      } catch (err) {
                        showToast(String(err), "error");
                        setDeleting(false);
                      }
                    }}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-danger hover:bg-danger/85">
                    {deleting ? "Deleting…" : "Delete my account"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </Shell>
    </AuthGate>
  );
}
