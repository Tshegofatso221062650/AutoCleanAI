import { useState } from "react";
import { ArrowRight, Check, X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/Button";

interface ComparisonProps {
  before: Record<string, any>[];
  after: Record<string, any>[];
  columns: string[];
}

interface CellChange {
  row: number;
  column: string;
  before: any;
  after: any;
  type: "changed" | "added" | "removed";
}

export function DataComparison({ before, after, columns }: ComparisonProps) {
  const [selectedColumn, setSelectedColumn] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"changes" | "all">("changes");

  const getChanges = (): CellChange[] => {
    const changes: CellChange[] = [];
    const maxRows = Math.max(before.length, after.length);

    for (let i = 0; i < maxRows; i++) {
      const beforeRow = before[i];
      const afterRow = after[i];

      if (!beforeRow && afterRow) {
        // Added row
        for (const col of columns) {
          changes.push({
            row: i,
            column: col,
            before: null,
            after: afterRow[col],
            type: "added",
          });
        }
      } else if (beforeRow && !afterRow) {
        // Removed row
        for (const col of columns) {
          changes.push({
            row: i,
            column: col,
            before: beforeRow[col],
            after: null,
            type: "removed",
          });
        }
      } else if (beforeRow && afterRow) {
        // Compare columns
        for (const col of columns) {
          if (beforeRow[col] !== afterRow[col]) {
            changes.push({
              row: i,
              column: col,
              before: beforeRow[col],
              after: afterRow[col],
              type: "changed",
            });
          }
        }
      }
    }

    return changes;
  };

  const changes = getChanges();
  const filteredChanges = selectedColumn
    ? changes.filter((c) => c.column === selectedColumn)
    : changes;

  const displayData = viewMode === "changes" ? filteredChanges : changes;

  const getChangeIcon = (type: string) => {
    switch (type) {
      case "changed":
        return <Check className="w-4 h-4 text-accent" />;
      case "added":
        return <Check className="w-4 h-4 text-accent2" />;
      case "removed":
        return <X className="w-4 h-4 text-danger" />;
      default:
        return null;
    }
  };

  const getChangeColor = (type: string) => {
    switch (type) {
      case "changed":
        return "bg-accent/10 border-accent/30";
      case "added":
        return "bg-accent2/10 border-accent2/30";
      case "removed":
        return "bg-danger/10 border-danger/30";
      default:
        return "";
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Button
              onClick={() => setViewMode("changes")}
              variant="ghost"
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border ${
                viewMode === "changes"
                  ? "bg-accent/20 text-accent border-accent/30"
                  : "bg-panel/30 text-app-muted hover:text-app-text border-edge/50"
              }`}
            >
              Changes Only ({changes.length})
            </Button>
            <Button
              onClick={() => setViewMode("all")}
              variant="ghost"
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all border ${
                viewMode === "all"
                  ? "bg-accent/20 text-accent border-accent/30"
                  : "bg-panel/30 text-app-muted hover:text-app-text border-edge/50"
              }`}
            >
              All Data
            </Button>
          </div>
          {selectedColumn && (
            <Button
              onClick={() => setSelectedColumn(null)}
              variant="ghost"
              size="sm"
              className="px-3 py-1.5 rounded-lg bg-edge/30 text-app-muted hover:text-app-text text-sm"
            >
              Clear Filter
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-xl border border-edge/50 bg-panel/30 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-panel/50 border-b border-edge/50">
              <tr>
                <th className="p-3 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">
                  Row
                </th>
                <th className="p-3 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">
                  Column
                </th>
                <th className="p-3 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">
                  Before
                </th>
                <th className="p-3 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">
                  After
                </th>
                <th className="p-3 text-left text-[10px] font-semibold text-app-subtle uppercase tracking-wider">
                  Change Type
                </th>
              </tr>
            </thead>
            <tbody>
              {displayData.slice(0, 100).map((change, idx) => (
                <tr
                  key={`${change.row}-${change.column}-${idx}`}
                  className={`border-t border-edge/30 hover:bg-panel/60 transition-colors cursor-pointer ${getChangeColor(
                    change.type,
                  )}`}
                  onClick={() => setSelectedColumn(change.column)}
                >
                  <td className="p-3 text-app-muted font-mono text-xs">{change.row + 1}</td>
                  <td className="p-3 text-app-text font-medium">{change.column}</td>
                  <td className="p-3 text-app-muted font-mono text-xs">
                    {change.before !== null ? String(change.before) : "-"}
                  </td>
                  <td className="p-3 text-app-muted font-mono text-xs">
                    {change.after !== null ? String(change.after) : "-"}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {getChangeIcon(change.type)}
                      <span className="text-xs capitalize text-app-muted">{change.type}</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {displayData.length > 100 && (
          <div className="p-4 text-center text-xs text-app-subtle border-t border-edge/30">
            Showing first 100 of {displayData.length} changes
          </div>
        )}
      </div>

      <div className="flex items-center gap-6 text-xs text-app-subtle">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-accent/20 border border-accent/30" />
          <span>Changed</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-accent2/20 border border-accent2/30" />
          <span>Added</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded bg-danger/20 border border-danger/30" />
          <span>Removed</span>
        </div>
      </div>
    </div>
  );
}
