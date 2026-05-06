"use client";

import Link from "next/link";
import { Workflow, Code2, FileCode, Layers } from "lucide-react";

interface PipelineNavProps {
  active: "pipelines" | "rules" | "functions" | "bulk";
}

const TABS = [
  { key: "pipelines" as const, href: "/pipelines",            label: "Pipelines",  icon: Workflow  },
  { key: "rules"     as const, href: "/transformation-rules", label: "Rules",      icon: Code2     },
  { key: "functions" as const, href: "/custom-functions",     label: "Functions",  icon: FileCode  },
  { key: "bulk"      as const, href: "/batch",                label: "Bulk",       icon: Layers    },
];

export function PipelineNav({ active }: PipelineNavProps) {
  return (
    <div className="flex items-center gap-1 p-1 rounded-xl bg-panel/50 border border-edge/30 w-fit mb-6">
      {TABS.map(({ key, href, label, icon: Icon }) => (
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
