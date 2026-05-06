"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, getAuthStatus, setToken } from "@/lib/api";
import { Lock, AlertCircle, Loader2, User, Mail, ArrowRight, ShieldCheck, Eye, EyeOff, Sparkles } from "lucide-react";
import { Logo } from "@/components/Logo";

type Mode = "login" | "register";

function pwStrength(pw: string): { score: number; label: string; color: string } {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw)) score++;
  if (/[0-9]/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  const labels = ["Very weak", "Weak", "Fair", "Good", "Strong", "Very strong"];
  const colors = ["bg-danger", "bg-danger", "bg-warn", "bg-warn", "bg-accent", "bg-accent"];
  return { score, label: labels[score] ?? labels[0], color: colors[score] ?? colors[0] };
}

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [ownerMode, setOwnerMode] = useState(false);

  const [username, setUsername]         = useState("");
  const [email, setEmail]               = useState("");
  const [password, setPassword]         = useState("");
  const [showPw, setShowPw]             = useState(false);
  const [regPassword, setRegPassword]   = useState("");
  const [showRegPw, setShowRegPw]       = useState(false);
  const [regPassword2, setRegPassword2] = useState("");
  const [showRegPw2, setShowRegPw2]     = useState(false);

  const [err, setErr]         = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [totpRequired, setTotpRequired] = useState(false);
  const [totpCode, setTotpCode]         = useState("");

  useEffect(() => {
    void getAuthStatus().then((s) => {
      if (s.disable_auth) router.replace("/home");
    });
  }, [router]);

  function switchMode(m: Mode) {
    setMode(m);
    setErr(null);
    setSuccess(null);
    setTotpRequired(false);
    setTotpCode("");
    setOwnerMode(false);
  }

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      if (!ownerMode && username.trim()) {
        const body: Record<string, string> = { username: username.trim(), password };
        if (totpRequired && totpCode) body.totp_code = totpCode;
        const data = await apiFetch("/auth/login/user", { method: "POST", body: JSON.stringify(body) }) as { access_token?: string; totp_required?: boolean };
        if (data.totp_required) { setTotpRequired(true); return; }
        setToken(data.access_token!);
      } else {
        const data = await apiFetch("/auth/login", { method: "POST", body: JSON.stringify({ password }) }) as { access_token: string };
        setToken(data.access_token);
      }
      router.replace("/home");
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "Invalid credentials");
    } finally {
      setLoading(false);
    }
  }

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setSuccess(null);
    if (regPassword !== regPassword2) { setErr("Passwords do not match"); return; }
    setLoading(true);
    try {
      const data = await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify({ username: username.trim(), password: regPassword, email: email.trim() }),
      }) as { access_token: string; username: string };
      setToken(data.access_token);
      setSuccess(`Welcome, ${data.username}! Redirecting…`);
      setTimeout(() => router.replace("/home"), 900);
    } catch (ex: unknown) {
      setErr(ex instanceof Error ? ex.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  const inputBase = "w-full rounded-xl bg-[var(--app-input-bg)] border border-[var(--app-input-border)] text-app-text text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition-all placeholder:text-app-subtle/60";

  return (
    <div className="h-screen overflow-y-auto flex flex-col items-center px-4 py-12"
      style={{
        background:
          "radial-gradient(ellipse 900px 600px at 20% 0%, rgba(0,217,165,0.09), transparent 55%)," +
          "radial-gradient(ellipse 700px 500px at 85% 100%, rgba(0,184,255,0.07), transparent 50%)," +
          "radial-gradient(ellipse 600px 400px at 60% 50%, rgba(99,102,241,0.04), transparent 60%)," +
          "linear-gradient(160deg, var(--app-bg) 0%, var(--app-bg2) 100%)",
      }}>

      {/* Background orbs */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden>
        <div className="absolute top-0 left-1/4 w-[500px] h-[500px] rounded-full bg-accent/4 blur-[120px]" />
        <div className="absolute bottom-0 right-1/4 w-[400px] h-[400px] rounded-full bg-accent2/4 blur-[100px]" />
      </div>

      <div className="w-full max-w-[400px] relative z-10 my-auto">

        {/* Brand mark */}
        <div className="text-center mb-10">
          <Logo size={56} standalone={true} className="mx-auto mb-5" />
          <h1 className="text-2xl font-bold tracking-tight text-app-text">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="text-sm text-app-muted mt-1.5">
            {mode === "login"
              ? "Sign in to AutoClean AI"
              : "Start cleaning data in minutes"}
          </p>
        </div>

        {/* Card */}
        <div className="rounded-2xl shadow-2xl overflow-hidden"
          style={{ background: "var(--app-panel)", border: "1px solid color-mix(in srgb, var(--app-edge) 70%, transparent)", backdropFilter: "blur(32px)" }}>

          <div className="p-8 space-y-5">

            {/* ── LOGIN FORM ─────────────────────────────── */}
            {mode === "login" && !totpRequired && (
              <form onSubmit={onLogin} className="space-y-4">

                {/* Owner mode toggle */}
                <div className="flex items-center justify-between">
                  <p className="text-xs text-app-muted">
                    {ownerMode ? "Signing in as" : "Sign in as"}
                    {" "}
                    <span className={ownerMode ? "font-semibold text-accent" : "text-app-text font-medium"}>
                      {ownerMode ? "owner" : "user"}
                    </span>
                  </p>
                  <button type="button" onClick={() => { setOwnerMode(o => !o); setUsername(""); setErr(null); }}
                    className="text-[11px] font-medium px-2.5 py-1 rounded-lg transition-all"
                    style={{ background: "var(--app-hover-bg)", color: "var(--app-subtle)", border: "1px solid var(--app-edge)" }}>
                    {ownerMode ? "Switch to user" : "Admin / Owner"}
                  </button>
                </div>

                {!ownerMode && (
                  <div className="relative">
                    <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-app-subtle pointer-events-none" />
                    <input type="text" autoComplete="username" autoFocus
                      className={`${inputBase} pl-10 pr-4 py-3`}
                      value={username} onChange={(e) => setUsername(e.target.value)}
                      placeholder="Username" required={!ownerMode} />
                  </div>
                )}

                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-app-subtle pointer-events-none" />
                  <input type={showPw ? "text" : "password"} autoComplete="current-password"
                    className={`${inputBase} pl-10 pr-11 py-3`}
                    value={password} onChange={(e) => setPassword(e.target.value)}
                    placeholder="Password" required />
                  <button type="button" onClick={() => setShowPw(v => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-app-subtle hover:text-app-text transition-colors">
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {err && (
                  <div className="flex items-center gap-2.5 p-3 rounded-xl bg-danger/8 border border-danger/20 text-danger text-xs">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />{err}
                  </div>
                )}

                <button type="submit" disabled={loading}
                  className="w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-60"
                  style={{ background: "linear-gradient(135deg, var(--accent), var(--accent2, #00b8ff))", boxShadow: "0 4px 20px rgba(0,217,165,0.25)" }}>
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Signing in…</> : <>Continue <ArrowRight className="w-4 h-4" /></>}
                </button>

                <p className="text-center text-[11px] text-app-subtle">
                  Forgot your password?{" "}
                  <button type="button" onClick={() => setOwnerMode(true)} className="text-accent/80 hover:text-accent transition-colors">
                    Sign in as owner to reset it
                  </button>
                </p>
              </form>
            )}

            {/* ── 2FA STEP ───────────────────────────────── */}
            {mode === "login" && totpRequired && (
              <form onSubmit={onLogin} className="space-y-5">
                <div className="text-center space-y-3 py-2">
                  <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-accent/10 border border-accent/25 mx-auto">
                    <ShieldCheck className="w-7 h-7 text-accent" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-app-text">Two-factor authentication</p>
                    <p className="text-xs text-app-muted mt-1">Enter the 6-digit code from your authenticator app</p>
                  </div>
                </div>

                <input type="text" inputMode="numeric" maxLength={6} autoFocus autoComplete="one-time-code"
                  className={`${inputBase} py-4 text-center tracking-[0.5em] text-xl font-mono`}
                  value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ""))}
                  placeholder="000 000" required />

                {err && (
                  <div className="flex items-center gap-2.5 p-3 rounded-xl bg-danger/8 border border-danger/20 text-danger text-xs">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />{err}
                  </div>
                )}

                <button type="submit" disabled={loading || totpCode.length !== 6}
                  className="w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-50"
                  style={{ background: "linear-gradient(135deg, var(--accent), var(--accent2, #00b8ff))", boxShadow: "0 4px 20px rgba(0,217,165,0.25)" }}>
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Verifying…</> : <><ShieldCheck className="w-4 h-4" />Verify code</>}
                </button>

                <button type="button" onClick={() => { setTotpRequired(false); setTotpCode(""); setErr(null); }}
                  className="w-full text-center text-[11px] text-app-subtle hover:text-app-muted transition-colors py-1">
                  ← Back to sign in
                </button>
              </form>
            )}

            {/* ── REGISTER FORM ──────────────────────────── */}
            {mode === "register" && (
              <form onSubmit={onRegister} className="space-y-4">

                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-app-subtle pointer-events-none" />
                  <input type="text" autoComplete="username" autoFocus
                    className={`${inputBase} pl-10 pr-4 py-3`}
                    value={username} onChange={(e) => setUsername(e.target.value)}
                    placeholder="Username (a-z, 0-9, _ - .)" required />
                </div>

                <div className="relative">
                  <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-app-subtle pointer-events-none" />
                  <input type="email" autoComplete="email"
                    className={`${inputBase} pl-10 pr-4 py-3`}
                    value={email} onChange={(e) => setEmail(e.target.value)}
                    placeholder="Email address" required />
                </div>

                <div>
                  <div className="relative">
                    <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-app-subtle pointer-events-none" />
                    <input type={showRegPw ? "text" : "password"} autoComplete="new-password"
                      className={`${inputBase} pl-10 pr-11 py-3`}
                      value={regPassword} onChange={(e) => setRegPassword(e.target.value)}
                      placeholder="Password" required />
                    <button type="button" onClick={() => setShowRegPw(v => !v)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2 text-app-subtle hover:text-app-text transition-colors">
                      {showRegPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {regPassword && (() => {
                    const { score, label, color } = pwStrength(regPassword);
                    return (
                      <div className="mt-2 space-y-1">
                        <div className="flex gap-1">
                          {[0,1,2,3,4].map((i) => (
                            <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i < score ? color : "bg-edge/30"}`} />
                          ))}
                        </div>
                        <p className="text-[10px] text-app-subtle">{label}</p>
                      </div>
                    );
                  })()}
                </div>

                <div className="relative">
                  <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-app-subtle pointer-events-none" />
                  <input type={showRegPw2 ? "text" : "password"} autoComplete="new-password"
                    className={`${inputBase} pl-10 pr-11 py-3`}
                    value={regPassword2} onChange={(e) => setRegPassword2(e.target.value)}
                    placeholder="Confirm password" required />
                  <button type="button" onClick={() => setShowRegPw2(v => !v)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-app-subtle hover:text-app-text transition-colors">
                    {showRegPw2 ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>

                {err && (
                  <div className="flex items-center gap-2.5 p-3 rounded-xl bg-danger/8 border border-danger/20 text-danger text-xs">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />{err}
                  </div>
                )}
                {success && (
                  <div className="flex items-center gap-2.5 p-3 rounded-xl bg-accent/8 border border-accent/20 text-accent text-xs">
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />{success}
                  </div>
                )}

                <button type="submit" disabled={loading || !!success}
                  className="w-full py-3 rounded-xl text-sm font-semibold text-white flex items-center justify-center gap-2 transition-all disabled:opacity-60"
                  style={{ background: "linear-gradient(135deg, var(--accent), var(--accent2, #00b8ff))", boxShadow: "0 4px 20px rgba(0,217,165,0.25)" }}>
                  {loading ? <><Loader2 className="w-4 h-4 animate-spin" />Creating account…</> : <>Create account <ArrowRight className="w-4 h-4" /></>}
                </button>
              </form>
            )}

          </div>

          {/* Mode switcher footer */}
          <div className="px-8 py-4 text-center text-[12px]"
            style={{ borderTop: "1px solid color-mix(in srgb, var(--app-edge) 50%, transparent)", background: "color-mix(in srgb, var(--app-bg) 40%, transparent)" }}>
            {mode === "login" ? (
              <span className="text-app-muted">
                Don't have an account?{" "}
                <button onClick={() => switchMode("register")} className="font-semibold text-accent hover:text-accent/80 transition-colors">
                  Create one
                </button>
              </span>
            ) : (
              <span className="text-app-muted">
                Already have an account?{" "}
                <button onClick={() => switchMode("login")} className="font-semibold text-accent hover:text-accent/80 transition-colors">
                  Sign in
                </button>
              </span>
            )}
          </div>
        </div>

        {/* Footer note */}
        <p className="text-center text-[11px] text-app-subtle/60 mt-6">
          AutoClean AI · Data Intelligence Platform
        </p>
      </div>
    </div>
  );
}
