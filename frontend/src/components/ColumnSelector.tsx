import { useState } from "react";
import { Check, ChevronDown, ChevronRight, Database, Hash, Type, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface Column {
  name: string;
  dtype: string;
  selected: boolean;
  missing_count: number;
  unique_count: number;
}

interface ColumnSelectorProps {
  columns: Column[];
  onToggle: (columnName: string) => void;
  onToggleAll: (selected: boolean) => void;
  label?: string;
}

export function ColumnSelector({ columns, onToggle, onToggleAll, label = "Select Columns" }: ColumnSelectorProps) {
  const [expanded, setExpanded] = useState(true);
  const allSelected = columns.every((c) => c.selected);
  const someSelected = columns.some((c) => c.selected) && !allSelected;

  const getDtypeIcon = (dtype: string) => {
    const lower = dtype.toLowerCase();
    if (lower.includes("int") || lower.includes("float")) return <Hash className="w-4 h-4" />;
    if (lower.includes("str") || lower.includes("object")) return <Type className="w-4 h-4" />;
    return <Database className="w-4 h-4" />;
  };

  const getDtypeColor = (dtype: string) => {
    const lower = dtype.toLowerCase();
    if (lower.includes("int") || lower.includes("float")) return "text-accent";
    if (lower.includes("str") || lower.includes("object")) return "text-accent2";
    return "text-warn";
  };

  return (
    <div className="rounded-2xl border border-edge/50 bg-panel/30 overflow-hidden">
      <Button
        onClick={() => setExpanded(!expanded)}
        type="button"
        variant="ghost"
        className="w-full flex items-center justify-between p-4 hover:bg-panel/50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <Database className="w-5 h-5 text-app-muted" />
          <span className="font-medium text-app-text">{label}</span>
          <span className="text-xs text-app-subtle">({columns.filter((c) => c.selected).length} selected)</span>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-app-muted" /> : <ChevronRight className="w-4 h-4 text-app-muted" />}
      </Button>

      {expanded && (
        <div className="border-t border-edge/50 p-4 space-y-3">
          <div className="flex items-center justify-between pb-3 border-b border-edge/30">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={(e) => onToggleAll(e.target.checked)}
                className="w-4 h-4 rounded border-edge bg-void/50 text-accent focus:ring-accent/50"
              />
              <span className="text-sm text-app-muted">Select All</span>
            </label>
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {columns.map((column) => (
              <label
                key={column.name}
                className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                  column.selected ? "bg-accent/10 border border-accent/30" : "hover:bg-panel/60"
                }`}
              >
                <input
                  type="checkbox"
                  checked={column.selected}
                  onChange={() => onToggle(column.name)}
                  className="w-4 h-4 rounded border-edge bg-void/50 text-accent focus:ring-accent/50"
                />
                <div className={`p-1.5 rounded-lg ${getDtypeColor(column.dtype)}/10`}>
                  {getDtypeIcon(column.dtype)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-medium ${column.selected ? "text-app-text" : "text-app-muted"}`}>
                      {column.name}
                    </span>
                    {column.missing_count > 0 && (
                      <AlertTriangle className="w-3 h-3 text-warn flex-shrink-0" />
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-app-subtle">
                    <span className={getDtypeColor(column.dtype)}>{column.dtype}</span>
                    <span>•</span>
                    <span>{column.unique_count} unique</span>
                    {column.missing_count > 0 && (
                      <>
                        <span>•</span>
                        <span className="text-warn">{column.missing_count} missing</span>
                      </>
                    )}
                  </div>
                </div>
                {column.selected && <Check className="w-4 h-4 text-accent flex-shrink-0" />}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
