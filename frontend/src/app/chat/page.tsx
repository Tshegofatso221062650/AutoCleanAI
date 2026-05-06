"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { AuthGate } from "@/components/AuthGate";
import { Shell } from "@/components/Shell";
import { apiFetch, getCached } from "@/lib/api";
import { showToast } from "@/components/Toast";
import { Button } from "@/components/ui/Button";
import { MessageSquare, Send, Loader2, Bot, User, Sparkles, Database, AlertTriangle, Settings } from "lucide-react";
import NextLink from "next/link";

interface Dataset {
  id: string;
  original_filename: string;
  row_count: number;
  col_count: number;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  provider?: string;
}

export default function ChatPage() {
  const [datasets, setDatasets]           = useState<Dataset[]>(
    () => getCached<{ items: Dataset[] }>("/history")?.items ?? []
  );
  const [selectedId, setSelectedId]       = useState<string | null>(
    () => {
      if (typeof window === "undefined") return null;
      return sessionStorage.getItem("chat_selected_dataset") || null;
    }
  );
  const [messages, setMessages]           = useState<Message[]>(
    () => {
      if (typeof window === "undefined") return [];
      const sid = sessionStorage.getItem("chat_selected_dataset");
      if (!sid) return [];
      try { return JSON.parse(sessionStorage.getItem(`chat_msgs_${sid}`) || "[]"); } catch { return []; }
    }
  );
  const [input, setInput]                 = useState("");
  const [loading, setLoading]             = useState(false);
  const [datasetsLoading, setDatasetsLoading] = useState(
    () => getCached("/history") === null
  );
  const [aiProvider, setAiProvider] = useState<string>("ollama");
  const inputRef  = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (getCached("/history") === null) {
      apiFetch("/history")
        .then((d) => setDatasets(d.items || []))
        .catch(() => {})
        .finally(() => setDatasetsLoading(false));
    } else {
      apiFetch("/history").then((d) => setDatasets(d.items || [])).catch(() => {});
    }
    apiFetch("/settings").then((d) => setAiProvider(d.ai_provider || "ollama")).catch(() => {});
  }, []);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, loading]);

  const selected = datasets.find((d) => d.id === selectedId);

  const selectDataset = (id: string) => {
    setSelectedId(id);
    sessionStorage.setItem("chat_selected_dataset", id);
    // Restore previous messages for this dataset if any
    try {
      const prev = JSON.parse(sessionStorage.getItem(`chat_msgs_${id}`) || "[]");
      setMessages(prev);
    } catch { setMessages([]); }
  };

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || !selectedId || loading) return;

    const userMsg: Message = { role: "user", content: text };
    setMessages((m) => {
      const updated = [...m, userMsg];
      try { sessionStorage.setItem(`chat_msgs_${selectedId}`, JSON.stringify(updated)); } catch {}
      return updated;
    });
    setInput("");
    setLoading(true);

    try {
      const data = await apiFetch("/chat", {
        method: "POST",
        body: JSON.stringify({ dataset_id: selectedId, message: text }),
      });
      const assistantMsg: Message = {
        role: "assistant",
        content: data.reply,
        provider: data.provider,
      };
      setMessages((m) => {
        const updated = [...m, assistantMsg];
        try { sessionStorage.setItem(`chat_msgs_${selectedId}`, JSON.stringify(updated)); } catch {}
        return updated;
      });
    } catch {
      showToast("Failed to get response", "error");
      setMessages((m) => m.slice(0, -1));
      setInput(text);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  }, [input, selectedId, loading]);

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const SUGGESTIONS = [
    "Summarise this dataset",
    "Which columns have the most missing values?",
    "Are there any obvious data quality issues?",
    "What are the numeric column ranges?",
    "How many duplicate rows are there?",
  ];

  return (
    <AuthGate>
      <Shell>
        <div className="max-w-5xl mx-auto h-[calc(100vh-8rem)] flex gap-4">

          {/* Dataset panel */}
          <aside className="w-64 flex-none flex flex-col gap-3">
            <div>
              <h2 className="text-sm font-semibold text-app-muted uppercase tracking-wide mb-2">Dataset</h2>
              {datasetsLoading ? (
                <div className="space-y-1.5">
                  {[...Array(3)].map((_, i) => <div key={i} className="h-14 skeleton rounded-xl" />)}
                </div>
              ) : datasets.length === 0 ? (
                <p className="text-sm text-app-muted">
                  No datasets yet.{" "}
                  <a href="/upload" className="text-accent hover:underline">Upload one first.</a>
                </p>
              ) : (
                <div className="space-y-1.5 max-h-[70vh] overflow-y-auto pr-1 custom-scrollbar">
                  {datasets.map((ds) => (
                    <button
                      key={ds.id}
                      type="button"
                      onClick={() => selectDataset(ds.id)}
                      className={`w-full text-left p-3 rounded-xl border transition-all text-sm ${
                        selectedId === ds.id
                          ? "border-accent bg-accent/10 ring-1 ring-accent/20"
                          : "border-edge/30 bg-panel/20 hover:border-accent/40 hover:bg-panel/40"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <Database className="w-3.5 h-3.5 text-accent flex-shrink-0" />
                        <span className="font-medium text-app-text truncate">{ds.original_filename}</span>
                      </div>
                      <span className="text-xs text-app-subtle pl-5">
                        {ds.row_count?.toLocaleString()} rows · {ds.col_count} cols
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Quick suggestions */}
            {selectedId && messages.length === 0 && (
              <div>
                <h2 className="text-sm font-semibold text-app-muted uppercase tracking-wide mb-2">Suggestions</h2>
                <div className="space-y-1.5">
                  {SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { setInput(s); inputRef.current?.focus(); }}
                      className="w-full text-left px-3 py-2 rounded-lg border border-edge/30 bg-panel/20 hover:bg-accent/10 hover:border-accent/40 text-xs text-app-muted hover:text-app-text transition-all"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </aside>

          {/* Chat panel */}
          <div className="flex-1 flex flex-col glass-card rounded-2xl overflow-hidden">

            {/* Header */}
            <div className="flex items-center gap-3 px-5 py-3 border-b border-edge/20">
              <div className="p-1.5 rounded-lg bg-accent/15">
                <Sparkles className="w-4 h-4 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-app-text">AutoClean AI</p>
                {selected
                  ? <p className="text-xs text-app-subtle">Analysing <span className="text-accent">{selected.original_filename}</span></p>
                  : <p className="text-xs text-app-subtle">Select a dataset to start</p>
                }
              </div>
              <NextLink href="/settings" className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-panel/60 border border-edge/40 text-[11px] text-app-subtle hover:text-app-muted hover:border-edge transition-all">
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  aiProvider === "openai" ? "bg-accent" :
                  aiProvider === "ollama" ? "bg-accent" : "bg-app-subtle"
                }`} />
                {aiProvider === "none" ? "No AI" : aiProvider}
                <Settings className="w-3 h-3" />
              </NextLink>
            </div>

            {/* Messages */}
            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4 custom-scrollbar">
              {!selectedId && (
                <div className="flex flex-col items-center justify-center h-full gap-3 text-center">
                  <MessageSquare className="w-12 h-12 text-app-subtle" />
                  <p className="text-app-muted text-sm max-w-xs">
                    Pick a dataset on the left, then ask anything about its structure, quality, or content.
                  </p>
                </div>
              )}

              {selectedId && messages.length === 0 && !loading && (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
                  <Bot className="w-10 h-10 text-app-subtle" />
                  <p className="text-sm text-app-muted">Ask me anything about <span className="text-accent">{selected?.original_filename}</span></p>
                </div>
              )}

              {messages.map((m, i) => (
                <div key={i} className={`flex gap-3 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  {m.role === "assistant" && (
                    <div className="flex-none w-7 h-7 rounded-full bg-accent/15 flex items-center justify-center mt-0.5">
                      <Bot className="w-4 h-4 text-accent" />
                    </div>
                  )}
                  <div
                    className={`max-w-[75%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                      m.role === "user"
                        ? "bg-accent/15 text-app-text rounded-br-sm"
                        : m.provider === "ollama_error"
                        ? "bg-danger/8 border border-danger/25 text-app-text rounded-bl-sm"
                        : "bg-panel/60 border border-edge/30 text-app-text rounded-bl-sm"
                    }`}
                  >
                    {m.provider === "ollama_error" && (
                      <div className="flex items-center gap-1.5 text-danger text-xs font-semibold mb-2">
                        <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
                        Ollama unreachable
                      </div>
                    )}
                    {m.content}
                    {m.provider === "ollama_error" && (
                      <div className="mt-2 pt-2 border-t border-danger/20 flex items-center justify-between gap-2">
                        <span className="text-[11px] text-danger/70">Is Ollama running on port 11434?</span>
                        <NextLink href="/settings" className="text-[11px] text-accent hover:underline flex items-center gap-1">
                          <Settings className="w-3 h-3" />Fix in Settings
                        </NextLink>
                      </div>
                    )}
                    {m.provider && m.provider !== "none" && m.provider !== "ollama_error" && (
                      <span className="block text-[10px] text-app-subtle mt-1">via {m.provider}</span>
                    )}
                  </div>
                  {m.role === "user" && (
                    <div className="flex-none w-7 h-7 rounded-full bg-edge/60 flex items-center justify-center mt-0.5">
                      <User className="w-3.5 h-3.5 text-app-muted" />
                    </div>
                  )}
                </div>
              ))}

              {loading && (
                <div className="flex gap-3 justify-start">
                  <div className="flex-none w-7 h-7 rounded-full bg-accent/15 flex items-center justify-center">
                    <Bot className="w-4 h-4 text-accent" />
                  </div>
                  <div className="px-4 py-2.5 rounded-2xl rounded-bl-sm bg-panel border border-edge/30">
                    <Loader2 className="w-4 h-4 text-accent animate-spin" />
                  </div>
                </div>
              )}
              <div />
            </div>

            {/* Input */}
            <div className="flex-none px-4 py-3 border-t border-edge/20">
              <div className="flex items-end gap-2">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKey}
                  disabled={!selectedId || loading}
                  placeholder={selectedId ? "Ask about your data… (Enter to send)" : "Select a dataset first"}
                  className="flex-1 resize-none bg-[var(--app-input-bg)] border border-edge/50 rounded-xl px-4 py-2.5 text-sm text-app-text placeholder:text-app-subtle focus:outline-none focus:border-accent/50 focus:ring-1 focus:ring-accent/30 disabled:opacity-40 disabled:cursor-not-allowed transition-colors leading-relaxed"
                  style={{ minHeight: "42px", maxHeight: "120px" }}
                  onInput={(e) => {
                    const el = e.currentTarget;
                    el.style.height = "auto";
                    el.style.height = Math.min(el.scrollHeight, 120) + "px";
                  }}
                />
                <Button
                  onClick={send}
                  disabled={!input.trim() || !selectedId || loading}
                  variant="primary"
                  className="flex-none p-2.5 rounded-xl"
                >
                  {loading
                    ? <Loader2 className="w-4 h-4 animate-spin" />
                    : <Send className="w-4 h-4" />
                  }
                </Button>
              </div>
              <p className="text-[10px] text-app-subtle mt-1.5 px-1">
                Shift+Enter for new line · AI responses depend on the provider set in Settings
              </p>
            </div>
          </div>
        </div>
      </Shell>
    </AuthGate>
  );
}
