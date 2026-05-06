import { useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: () => void;
  description: string;
}

export function useKeyboardShortcuts(shortcuts: ShortcutConfig[]) {
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Do not fire navigation shortcuts while the user is typing in a form field.
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      for (const shortcut of shortcuts) {
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();
        const ctrlMatch = shortcut.ctrl === undefined || (e.ctrlKey || e.metaKey) === shortcut.ctrl;
        const shiftMatch = shortcut.shift === undefined || e.shiftKey === shortcut.shift;
        const altMatch = shortcut.alt === undefined || e.altKey === shortcut.alt;

        if (keyMatch && ctrlMatch && shiftMatch && altMatch) {
          e.preventDefault();
          shortcut.handler();
          return;
        }
      }
    },
    [shortcuts],
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);
}

// Navigation shortcuts handled here (page-level nav).
// Ctrl+K (search), Ctrl+B (sidebar), Ctrl+/ (shortcuts modal) are wired
// directly in Shell.tsx since they depend on Shell state.
export function useNavigationShortcuts() {
  const router = useRouter();

  const shortcuts: ShortcutConfig[] = [
    {
      key: "h",
      ctrl: true,
      handler: () => router.push("/home"),
      description: "Go to Home",
    },
    {
      key: "u",
      ctrl: true,
      handler: () => router.push("/upload"),
      description: "Upload Dataset",
    },
    {
      key: "i",
      ctrl: true,
      handler: () => router.push("/history"),
      description: "Go to Datasets",
    },
  ];

  useKeyboardShortcuts(shortcuts);
  return shortcuts;
}
