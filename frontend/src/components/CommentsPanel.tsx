"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { showToast } from "@/components/Toast";
import { MessageSquare, Send, Trash2, Loader2 } from "lucide-react";

interface Comment {
  id: number;
  dataset_id: string;
  author: string;
  content: string;
  created_at: string;
}

function relativeTime(ts: string): string {
  const diff = Date.now() - new Date(ts).getTime();
  if (diff < 60_000) return "just now";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  return new Date(ts).toLocaleDateString();
}

export function CommentsPanel({
  datasetId,
  currentUser,
}: {
  datasetId: string;
  currentUser?: string;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const hasLoaded = useRef(false);

  function scrollToBottom() {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }

  function loadComments() {
    apiFetch(`/datasets/${datasetId}/comments`)
      .then((d) => setComments(d.comments || []))
      .catch(() => {})
      .finally(() => {
        setLoading(false);
        hasLoaded.current = true;
        requestAnimationFrame(scrollToBottom);
      });
  }

  useEffect(() => {
    loadComments();
  }, [datasetId]);

  useEffect(() => {
    if (!hasLoaded.current) return;
    scrollToBottom();
  }, [comments.length]);

  async function submitComment(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      const created = await apiFetch(`/datasets/${datasetId}/comments`, {
        method: "POST",
        body: JSON.stringify({ content: text.trim() }),
      });
      setComments((prev) => [
        ...prev,
        { ...created, created_at: new Date().toISOString() },
      ]);
      setText("");
    } catch (err) {
      showToast(String(err), "error");
    } finally {
      setSubmitting(false);
    }
  }

  async function deleteComment(id: number) {
    try {
      await apiFetch(`/datasets/${datasetId}/comments/${id}`, {
        method: "DELETE",
      });
      setComments((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      showToast(String(err), "error");
    }
  }

  return (
    <section className="glass-card rounded-2xl overflow-hidden animate-fade-in-up">
      <div className="flex items-center gap-2 px-5 py-4 border-b border-edge/20">
        <MessageSquare className="w-4 h-4 text-accent" />
        <h2 className="text-sm font-semibold text-app-text">Comments</h2>
        {!loading && (
          <span className="ml-1 text-[11px] text-app-subtle px-1.5 py-0.5 rounded-full bg-edge/20">
            {comments.length}
          </span>
        )}
      </div>

      <div ref={listRef} className="max-h-72 overflow-y-auto px-5 py-3 space-y-0 divide-y divide-edge/10">
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="w-4 h-4 animate-spin text-accent" />
          </div>
        ) : comments.length === 0 ? (
          <div className="py-8 text-center">
            <MessageSquare className="w-8 h-8 text-app-subtle/40 mx-auto mb-2" />
            <p className="text-xs text-app-subtle">No comments yet — be the first</p>
          </div>
        ) : (
          comments.map((c) => (
            <div key={c.id} className="flex gap-3 py-3 group">
              <div className="w-6 h-6 rounded-full bg-accent/10 border border-accent/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-[9px] font-bold text-accent">
                  {c.author.slice(0, 2).toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-[11px] font-semibold text-app-text font-mono">
                    {c.author}
                  </span>
                  <span className="text-[10px] text-app-subtle">
                    {relativeTime(c.created_at)}
                  </span>
                </div>
                <p className="text-xs text-app-muted leading-relaxed whitespace-pre-wrap break-words">
                  {c.content}
                </p>
              </div>
              {(currentUser === c.author ||
                currentUser === "owner") && (
                <button
                  type="button"
                  onClick={() => void deleteComment(c.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-app-subtle hover:text-danger transition-all flex-shrink-0"
                  title="Delete comment"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))
        )}
      </div>

      <form
        onSubmit={submitComment}
        className="flex items-center gap-2 px-5 py-3 border-t border-edge/20 bg-panel/30"
      >
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Add a comment…"
          className="flex-1 bg-[var(--app-input-bg)] border border-edge/60 rounded-xl px-3 py-2 text-xs text-app-text placeholder:text-app-subtle focus:outline-none focus:ring-1 focus:ring-accent/40 focus:border-accent/40 transition-all"
          disabled={submitting}
        />
        <button
          type="submit"
          disabled={submitting || !text.trim()}
          className="p-2 rounded-xl bg-accent/10 border border-accent/20 text-accent hover:bg-accent/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
        >
          {submitting ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Send className="w-3.5 h-3.5" />
          )}
        </button>
      </form>
    </section>
  );
}
