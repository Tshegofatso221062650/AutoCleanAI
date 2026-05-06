"use client";

import { useEffect, useState } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch } from "@/lib/api";
import { showToast } from "@/components/Toast";
import { Zap, Plus, Trash2, Loader2, Copy, CheckCircle, XCircle, ToggleLeft, ToggleRight } from "lucide-react";

const ALL_EVENTS = [
  { id: "dataset.uploaded", label: "Dataset Uploaded", desc: "Fires when a new file is uploaded" },
  { id: "dataset.analyzed", label: "Dataset Analyzed", desc: "Fires after analysis completes" },
  { id: "dataset.cleaned",  label: "Dataset Cleaned",  desc: "Fires after a clean job finishes" },
  { id: "pipeline.run",     label: "Pipeline Run",     desc: "Fires when a pipeline is executed" },
  { id: "*",                label: "All Events",       desc: "Subscribe to every event type" },
];

interface Webhook {
  id: number;
  url: string;
  events: string[];
  enabled: boolean;
  created_at: string;
  last_fired_at: string | null;
  last_status: string | null;
  failure_count: number;
}

function relativeTime(ts: string | null): string {
  if (!ts) return "Never";
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export default function WebhooksPage() {
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);

  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [newSecret, setNewSecret] = useState<{ id: number; secret: string } | null>(null);

  function load() {
    setLoading(true);
    apiFetch("/webhooks/")
      .then((d) => setWebhooks(d.webhooks || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function createWebhook(e: React.FormEvent) {
    e.preventDefault();
    if (!url.trim() || selectedEvents.length === 0) return;
    setCreating(true);
    try {
      const res = await apiFetch("/webhooks/", {
        method: "POST",
        body: JSON.stringify({ url: url.trim(), events: selectedEvents }),
      });
      setNewSecret({ id: res.id, secret: res.secret });
      setUrl("");
      setSelectedEvents([]);
      load();
      showToast("Webhook created — save the secret!", "success");
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setCreating(false);
    }
  }

  async function toggleWebhook(hook: Webhook) {
    try {
      await apiFetch(`/webhooks/${hook.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !hook.enabled }),
      });
      setWebhooks((prev) => prev.map((h) => h.id === hook.id ? { ...h, enabled: !h.enabled } : h));
    } catch (err) {
      showToast(String(err), "error");
    }
  }

  async function deleteWebhook(id: number) {
    try {
      await apiFetch(`/webhooks/${id}`, { method: "DELETE" });
      setWebhooks((prev) => prev.filter((h) => h.id !== id));
      showToast("Webhook deleted", "success");
    } catch (err) {
      showToast(String(err), "error");
    }
  }

  function toggleEvent(ev: string) {
    setSelectedEvents((prev) =>
      prev.includes(ev) ? prev.filter((e) => e !== ev) : [...prev, ev]
    );
  }

  return (
    <AuthGate>
      <Shell>
        <div className="max-w-3xl mx-auto space-y-8">
          {/* Header */}
          <div className="animate-fade-in-down">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[11px] font-semibold tracking-wide mb-3">
              <Zap className="w-3 h-3" />
              <span>Integrations</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              <span className="gradient-text">Webhooks</span>
            </h1>
            <p className="text-sm text-app-muted mt-1.5">
              Get HTTP POST notifications when events happen in AutoClean AI. Payloads are signed with HMAC-SHA256.
            </p>
          </div>

          {/* New secret reveal */}
          {newSecret && (
            <div className="glass-card rounded-2xl p-5 border border-accent/30 space-y-3 animate-fade-in-up">
              <p className="text-xs font-semibold text-accent uppercase tracking-wider">
                ⚠ Save your webhook secret — it won&apos;t be shown again
              </p>
              <p className="text-[11px] text-app-muted">
                Verify incoming requests by computing <code className="font-mono">HMAC-SHA256(secret, body)</code> and comparing to the <code className="font-mono">X-AutoClean-Signature</code> header.
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono text-app-text bg-panel/80 border border-edge/40 rounded-lg px-3 py-2 break-all">
                  {newSecret.secret}
                </code>
                <button
                  type="button"
                  onClick={() => { void navigator.clipboard.writeText(newSecret.secret); showToast("Copied!", "success"); }}
                  className="p-2 rounded-lg border border-edge/40 text-app-muted hover:text-accent transition-colors"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => setNewSecret(null)}
                className="text-[11px] text-app-subtle hover:text-app-muted underline"
              >
                I&apos;ve saved it — dismiss
              </button>
            </div>
          )}

          {/* Existing webhooks */}
          <div className="glass-card rounded-2xl overflow-hidden animate-fade-in-up">
            <div className="px-6 py-4 border-b border-edge/20 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-app-text flex items-center gap-2">
                <Zap className="w-4 h-4 text-accent" /> Your Webhooks
                {!loading && (
                  <span className="text-[11px] text-app-subtle px-1.5 py-0.5 rounded-full bg-edge/20 ml-1">
                    {webhooks.length}
                  </span>
                )}
              </h2>
            </div>

            {loading ? (
              <div className="flex justify-center py-10">
                <Loader2 className="w-5 h-5 animate-spin text-accent" />
              </div>
            ) : webhooks.length === 0 ? (
              <div className="py-12 text-center">
                <Zap className="w-8 h-8 text-app-subtle/40 mx-auto mb-2" />
                <p className="text-sm text-app-muted">No webhooks yet</p>
                <p className="text-xs text-app-subtle mt-1">Create one below to start receiving event notifications</p>
              </div>
            ) : (
              <div className="divide-y divide-edge/10">
                {webhooks.map((hook) => (
                  <div key={hook.id} className="px-6 py-4 flex items-start gap-4">
                    <div className="flex-1 min-w-0 space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <code className="text-sm font-mono text-app-text truncate max-w-sm">{hook.url}</code>
                        {hook.enabled ? (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-accent/15 text-accent border border-accent/30">Active</span>
                        ) : (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-edge/30 text-app-subtle border border-edge/40">Paused</span>
                        )}
                        {hook.failure_count > 0 && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-danger/15 text-danger border border-danger/30">
                            {hook.failure_count} fail{hook.failure_count !== 1 ? "s" : ""}
                          </span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {hook.events.map((ev) => (
                          <span key={ev} className="text-[10px] px-2 py-0.5 rounded-full bg-panel/80 border border-edge/40 text-app-subtle font-mono">
                            {ev}
                          </span>
                        ))}
                      </div>
                      <div className="flex items-center gap-3 text-[10px] text-app-subtle">
                        <span>Last fired: {relativeTime(hook.last_fired_at)}</span>
                        {hook.last_status && (
                          <span className={hook.last_status.startsWith("2") ? "text-accent" : "text-danger"}>
                            {hook.last_status.startsWith("2")
                              ? <CheckCircle className="inline w-3 h-3 mr-0.5" />
                              : <XCircle className="inline w-3 h-3 mr-0.5" />}
                            {hook.last_status}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => void toggleWebhook(hook)}
                        title={hook.enabled ? "Pause webhook" : "Resume webhook"}
                        className="p-1.5 rounded-lg text-app-muted hover:text-accent hover:bg-accent/10 transition-colors"
                      >
                        {hook.enabled
                          ? <ToggleRight className="w-4 h-4 text-accent" />
                          : <ToggleLeft className="w-4 h-4" />}
                      </button>
                      <button
                        type="button"
                        onClick={() => void deleteWebhook(hook.id)}
                        title="Delete webhook"
                        className="p-1.5 rounded-lg text-app-muted hover:text-danger hover:bg-danger/10 transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Create webhook */}
          <form onSubmit={createWebhook} className="glass-card rounded-2xl p-6 space-y-6 animate-fade-in-up">
            <h2 className="text-sm font-semibold text-app-text flex items-center gap-2">
              <Plus className="w-4 h-4 text-accent" /> Add Webhook
            </h2>

            <div className="space-y-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle">
                Payload URL
              </label>
              <input
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                required
                placeholder="https://your-server.com/hooks/autoclean"
                className="w-full bg-[var(--app-input-bg)] border border-edge/60 rounded-xl px-4 py-3 text-app-text text-sm focus:outline-none focus:ring-2 focus:ring-accent/40 focus:border-accent/40 transition-all"
              />
            </div>

            <div className="space-y-2">
              <label className="block text-[11px] font-semibold uppercase tracking-wider text-app-subtle">
                Events to subscribe to
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {ALL_EVENTS.map((ev) => (
                  <label
                    key={ev.id}
                    className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-all ${
                      selectedEvents.includes(ev.id)
                        ? "border-accent/40 bg-accent/8"
                        : "border-edge/40 hover:border-edge/60"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedEvents.includes(ev.id)}
                      onChange={() => toggleEvent(ev.id)}
                      className="mt-0.5 accent-accent"
                    />
                    <div>
                      <p className="text-xs font-semibold text-app-text font-mono">{ev.id}</p>
                      <p className="text-[11px] text-app-subtle">{ev.desc}</p>
                    </div>
                  </label>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={creating || !url.trim() || selectedEvents.length === 0}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-accent/10 border border-accent/30 text-accent text-sm font-semibold hover:bg-accent/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Create Webhook
            </button>
          </form>

          {/* Docs */}
          <div className="glass-card rounded-2xl p-6 space-y-3 animate-fade-in-up">
            <h2 className="text-sm font-semibold text-app-text">Verifying signatures</h2>
            <p className="text-xs text-app-muted">
              Every delivery includes an <code className="font-mono text-accent/80">X-AutoClean-Signature</code> header.
              Verify it with your secret to ensure the payload came from AutoClean AI.
            </p>
            <pre className="text-[11px] font-mono bg-panel/80 border border-edge/40 rounded-xl p-4 overflow-x-auto text-app-muted leading-relaxed">{`# Python example
import hmac, hashlib

def verify(secret: str, body: bytes, signature: str) -> bool:
    expected = "sha256=" + hmac.new(
        key=secret.encode(),
        msg=body,
        digestmod=hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)`}</pre>
          </div>
        </div>
      </Shell>
    </AuthGate>
  );
}
