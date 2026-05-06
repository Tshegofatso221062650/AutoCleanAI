"use client";

import Link from "next/link";
import { BarChart3, Activity, Shield } from "lucide-react";

interface InsightNavProps {
  active: "analytics" | "profiling" | "quality";
}

const PAGES = [
  { key: "analytics" as const, href: "/analytics", label: "Analytics",   icon: BarChart3 },
  { key: "profiling" as const, href: "/profiling", label: "Profiling",    icon: Activity  },
  { key: "quality"   as const, href: "/quality",   label: "Quality",      icon: Shield    },
];

export function InsightNav({ active }: InsightNavProps) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-xl bg-panel/50 border border-edge/30 w-fit mb-6">
      {PAGES.map(({ key, href, label, icon: Icon }) => (
        <Link
          key={key}
          href={href}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            active === key
              ? "bg-accent/20 text-accent"
              : "text-app-muted hover:text-app-text hover:bg-edge/30"
          }`}
        >
          <Icon className="w-3.5 h-3.5" />
          {label}
        </Link>
      ))}
    </div>
  );
}
