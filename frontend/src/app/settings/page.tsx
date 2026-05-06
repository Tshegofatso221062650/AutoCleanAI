"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch } from "@/lib/api";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import { Settings as SettingsIcon, Cpu, Key, CheckCircle, XCircle, Save, Info, RotateCcw, Clock, Link, Shield, Wifi, WifiOff, Loader2 } from "lucide-react";

export default function SettingsPage() {
  const [aiProvider, setAiProvider] = useState("ollama");
  const [ollamaModel, setOllamaModel] = useState("mistral");
  const [ollamaTimeout, setOllamaTimeout] = useState(300);
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("http://127.0.0.1:11434");
  const [openaiModel, setOpenaiModel] = useState("gpt-4o-mini");
  const [hasKey, setHasKey] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [testing, setTesting] = useState(false);
  const [ollamaStatus, setOllamaStatus] = useState<{ ok: boolean; models?: string[]; error?: string } | null>(null);

  useEffect(() => {
    void Promise.all([
      apiFetch("/settings"),
      apiFetch("/auth/me"),
    ]).then(([d, me]) => {
        setAiProvider(d.ai_provider || "ollama");
        setOllamaModel(d.ollama_model || "mistral");
        setOllamaTimeout(d.ollama_timeout ?? 300);
        setOllamaBaseUrl(d.ollama_base_url || "http://127.0.0.1:11434");
        setOpenaiModel(d.openai_model || "gpt-4o-mini");
        setHasKey(!!d.has_openai_key);
        setIsAdmin(me.role === "admin");
      })
      .catch(() => {});
  }, []);

  async function save() {
    setMsg(null);
    setSaving(true);
    try {
      await apiFetch("/settings", {
        method: "POST",
        body: JSON.stringify({
          ai_provider: aiProvider,
          ollama_model: ollamaModel,
          ollama_base_url: ollamaBaseUrl,
          ollama_timeout: ollamaTimeout,
          openai_model: openaiModel,
        }),
      });
      setMsg("Settings saved successfully.");
      setOllamaStatus(null);
    } catch (e) {
      setMsg(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function testOllama() {
    setTesting(true);
    setOllamaStatus(null);
    try {
      const res = await apiFetch("/settings/test-ollama");
      setOllamaStatus(res);
    } catch (e) {
      setOllamaStatus({ ok: false, error: String(e) });
    } finally {
      setTesting(false);
    }
  }

  return (
    <AuthGate>
      <Shell>
        <div className="max-w-2xl mx-auto space-y-8">
          <div className="animate-fade-in-down">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
              <SettingsIcon className="w-3 h-3" />
              <span>Configuration</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="gradient-text">Settings</span>
            </h1>
            <p className="text-sm text-app-muted mt-1.5">
              {isAdmin ? "Configure AI providers for intelligent data cleaning and analysis" : "Manage your personal preferences"}
            </p>
          </div>

          {isAdmin && <div className="glass-card rounded-2xl p-6 space-y-6 animate-fade-in-up">
            <div className="space-y-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle flex items-center gap-2">
                <Cpu className="w-3.5 h-3.5" />
                AI Provider
              </label>
              <select
                disabled={!isAdmin}
                className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-xl px-4 py-3 text-app-text text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value)}
              >
                <option value="ollama">Ollama (local, free)</option>
                <option value="openai">OpenAI (requires API key)</option>
                <option value="none">None (heuristics only)</option>
              </select>
            </div>

            <div className="space-y-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle">Ollama Model</label>
              <input
                disabled={!isAdmin}
                className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-xl px-4 py-3 text-app-text font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                value={ollamaModel}
                onChange={(e) => setOllamaModel(e.target.value)}
                placeholder="e.g., phi3:mini, mistral, llama3"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle flex items-center gap-2">
                <Clock className="w-3.5 h-3.5" />
                Ollama Timeout (seconds)
              </label>
              <input
                type="number"
                min={10}
                max={3600}
                disabled={!isAdmin}
                className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-xl px-4 py-3 text-app-text font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                value={ollamaTimeout}
                onChange={(e) => setOllamaTimeout(Number(e.target.value))}
              />
              <p className="text-[11px] text-app-subtle">Increase if your model cold-starts slowly (default 300 s = 5 min).</p>
            </div>

            <div className="space-y-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle flex items-center gap-2">
                <Link className="w-3.5 h-3.5" />
                Ollama Server URL
              </label>
              <div className="flex gap-2">
                <input
                  disabled={!isAdmin}
                  className="flex-1 bg-[var(--app-input-bg)] border border-edge/60 rounded-xl px-4 py-3 text-app-text font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                  value={ollamaBaseUrl}
                  onChange={(e) => { setOllamaBaseUrl(e.target.value); setOllamaStatus(null); }}
                  placeholder="http://127.0.0.1:11434"
                />
                <button
                  type="button"
                  onClick={() => void testOllama()}
                  disabled={testing}
                  className="px-4 py-2 rounded-xl text-sm font-medium border transition-all flex items-center gap-2 disabled:opacity-60"
                  style={{ background: "var(--app-hover-bg)", border: "1px solid var(--app-edge)", color: "var(--app-text)" }}
                >
                  {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wifi className="w-4 h-4" />}
                  {testing ? "Testing…" : "Test"}
                </button>
              </div>
              {ollamaStatus && (
                <div className={`flex items-start gap-2 p-3 rounded-xl text-xs ${
                  ollamaStatus.ok
                    ? "bg-accent/10 border border-accent/20 text-accent"
                    : "bg-danger/10 border border-danger/20 text-danger"
                }`}>
                  {ollamaStatus.ok
                    ? <CheckCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                    : <WifiOff className="w-4 h-4 flex-shrink-0 mt-0.5" />}
                  <div>
                    {ollamaStatus.ok
                      ? <><span className="font-semibold">Connected</span> — models: {ollamaStatus.models?.join(", ") || "none"}</>
                      : <><span className="font-semibold">Unreachable</span> — {ollamaStatus.error}</>}
                  </div>
                </div>
              )}
              <p className="text-[11px] text-app-subtle">Change port or hostname if Ollama is running elsewhere. Saved to database — no restart needed.</p>
            </div>

            <div className="space-y-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle">OpenAI Model</label>
              <input
                disabled={!isAdmin}
                className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-xl px-4 py-3 text-app-text font-mono text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition-all disabled:opacity-60 disabled:cursor-not-allowed"
                value={openaiModel}
                onChange={(e) => setOpenaiModel(e.target.value)}
                placeholder="e.g., gpt-4o-mini, gpt-4"
              />
            </div>

            <div className="flex items-center gap-2 p-4 rounded-xl bg-panel/60 border border-edge/40">
              <Key className="w-4 h-4 text-app-subtle" />
              <span className="text-sm text-app-muted">OpenAI API Key:</span>
              {hasKey ? (
                <span className="flex items-center gap-1 text-accent text-sm font-medium">
                  <CheckCircle className="w-4 h-4" />
                  Configured
                </span>
              ) : (
                <span className="flex items-center gap-1 text-warn text-sm font-medium">
                  <XCircle className="w-4 h-4" />
                  Not configured
                </span>
              )}
            </div>

            <div className="flex items-start gap-3 p-4 rounded-xl bg-accent/5 border border-accent/15">
              <Info className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
              <p className="text-xs text-app-muted leading-relaxed">
                Set <code className="text-accent font-mono">OPENAI_API_KEY</code> in the backend{" "}
                <code className="text-accent font-mono">.env</code> file to use OpenAI. Ollama runs locally 
                and requires no API key.
              </p>
            </div>

            <Button
              type="button"
              onClick={() => void save()}
              disabled={saving || !isAdmin}
              variant="primary"
              className="w-full rounded-xl px-6 py-3 font-medium"
              title={!isAdmin ? "Admin access required" : undefined}
            >
              {saving ? (
                <>
                  <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="w-4 h-4" />
                  Save Settings
                </>
              )}
            </Button>

            {msg && (
              <div className={`p-4 rounded-xl text-sm ${msg.includes("success") ? "bg-accent/10 text-accent border border-accent/20" : "bg-danger/10 text-danger border border-danger/20"}`}>
                {msg}
              </div>
            )}
          </div>}

          {/* App ── Onboarding */}
          <div className="glass-card rounded-2xl p-6 space-y-4 animate-fade-in-up stagger-2">
            <div className="flex items-center gap-2 mb-1">
              <RotateCcw className="w-3.5 h-3.5 text-accent" />
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-app-subtle">Onboarding</h2>
            </div>
            <p className="text-xs text-app-muted">
              Replay the guided tour that appears when you first open the Home page.
            </p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                localStorage.removeItem("hasSeenOnboardingTour");
                showToast("Tour reset — visit Home to restart it", "success");
              }}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm"
            >
              <RotateCcw className="w-4 h-4" />
              Restart Onboarding Tour
            </Button>
          </div>
        </div>
      </Shell>
    </AuthGate>
  );
}
