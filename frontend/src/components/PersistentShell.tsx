"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Shell } from "@/components/Shell";

/**
 * Mounted once in the root layout so the sidebar never unmounts between
 * page navigations.  Pages that should NOT have a shell (login, root redirect)
 * are listed in NO_SHELL_PATHS.
 */
const NO_SHELL_PATHS = new Set(["/", "/login"]);

export function PersistentShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  if (NO_SHELL_PATHS.has(pathname)) return <>{children}</>;
  return <Shell>{children}</Shell>;
}
