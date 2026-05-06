"use client";

import { useEffect } from "react";
import { Keyboard, X } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface Shortcut {
  key: string;
  description: string;
}

interface ShortcutGroup {
  section: string;
  items: Shortcut[];
}

const shortcutGroups: ShortcutGroup[] = [
  {
    section: "Global",
    items: [
      { key: "Ctrl + K", description: "Quick dataset search" },
      { key: "Ctrl + B", description: "Toggle sidebar" },
      { key: "Ctrl + /", description: "Show this shortcuts panel" },
      { key: "Esc",      description: "Close any modal" },
    ],
  },
  {
    section: "Navigation",
    items: [
      { key: "Ctrl + H", description: "Go to Home" },
      { key: "Ctrl + U", description: "Upload dataset" },
      { key: "Ctrl + I", description: "Go to Datasets" },
    ],
  },
];

interface KeyboardShortcutsProps {
  isOpen: boolean;
  onClose: () => void;
}

export function KeyboardShortcuts({ isOpen, onClose }: KeyboardShortcutsProps) {
  useEffect(() => {
    if (isOpen) {
      const handleEscape = (e: KeyboardEvent) => {
        if (e.key === "Escape") onClose();
      };
      window.addEventListener("keydown", handleEscape);
      return () => window.removeEventListener("keydown", handleEscape);
    }
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 modal-overlay flex items-center justify-center z-50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="modal-card rounded-xl p-6 w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto custom-scrollbar">
        <div className="flex justify-between items-center mb-5">
          <div className="flex items-center gap-2">
            <Keyboard className="w-5 h-5 text-accent" />
            <h2 className="text-lg font-semibold text-app-text">Keyboard Shortcuts</h2>
          </div>
          <Button
            onClick={onClose}
            type="button"
            variant="ghost"
            size="sm"
            className="p-1 rounded hover:bg-edge/50 text-app-muted hover:text-app-text"
          >
            <X className="w-5 h-5" />
          </Button>
        </div>

        <div className="space-y-5">
          {shortcutGroups.map((group) => (
            <div key={group.section}>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-app-subtle mb-2">
                {group.section}
              </p>
              <div className="space-y-1.5">
                {group.items.map((shortcut) => (
                  <div
                    key={shortcut.key}
                    className="flex items-center justify-between p-2.5 rounded-lg bg-void border border-edge/60"
                  >
                    <span className="text-sm text-app-muted">{shortcut.description}</span>
                    <kbd className="px-2 py-1 rounded bg-accent/20 text-accent text-xs font-mono">
                      {shortcut.key}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
