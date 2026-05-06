"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[App Error]", error);
  }, [error]);

  return (
    <div className="h-screen flex items-center justify-center bg-[var(--app-bg)] px-4">
      <div className="flex flex-col items-center gap-4 max-w-sm text-center">
        <div className="p-3 rounded-2xl bg-danger/10 ring-1 ring-danger/20">
          <AlertTriangle className="w-8 h-8 text-danger" />
        </div>
        <div>
          <h2 className="text-lg font-semibold text-app-text mb-1">Something went wrong</h2>
          <p className="text-sm text-app-muted">
            {error?.message || "An unexpected error occurred."}
          </p>
        </div>
        <button
          onClick={reset}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-accent/10 text-accent text-sm font-medium ring-1 ring-accent/20 hover:bg-accent/20 transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Try again
        </button>
      </div>
    </div>
  );
}
