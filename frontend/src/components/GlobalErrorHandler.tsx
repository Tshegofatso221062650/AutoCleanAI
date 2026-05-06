"use client";

import { useEffect } from "react";
import { showToast } from "@/components/Toast";
import { ApiError } from "@/lib/api";

export function GlobalErrorHandler() {
  useEffect(() => {
    function handleUnhandledRejection(event: PromiseRejectionEvent) {
      const err = event.reason;

      if (err instanceof DOMException && err.name === "AbortError") {
        event.preventDefault();
        return;
      }

      event.preventDefault();

      if (err instanceof ApiError) {
        showToast(err.message, "error");
      } else if (err instanceof Error) {
        showToast(err.message || "An unexpected error occurred.", "error");
      } else {
        showToast("An unexpected error occurred.", "error");
      }
    }

    // Capture phase (true) ensures this runs BEFORE Next.js's own listener,
    // so event.preventDefault() successfully suppresses the dev overlay.
    window.addEventListener("unhandledrejection", handleUnhandledRejection, true);
    return () => window.removeEventListener("unhandledrejection", handleUnhandledRejection, true);
  }, []);

  return null;
}
