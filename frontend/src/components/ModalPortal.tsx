"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

interface ModalPortalProps {
  open: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * Renders modal content directly into document.body via a React Portal,
 * completely escaping any ancestor CSS transforms / stacking contexts
 * that would break position:fixed layout.
 */
export function ModalPortal({ open, onClose, children }: ModalPortalProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => { setMounted(true); }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 modal-overlay flex items-center justify-center z-[200] p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {children}
    </div>,
    document.body
  );
}
