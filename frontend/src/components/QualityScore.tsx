import { TrendingUp, TrendingDown, Minus } from "lucide-react";

interface QualityScoreProps {
  score: number;
  previousScore?: number;
  size?: "sm" | "md" | "lg";
  showLabel?: boolean;
}

export function QualityScore({ score, previousScore, size = "md", showLabel = true }: QualityScoreProps) {
  const getScoreColor = (s: number) => {
    if (s >= 80) return "text-accent";
    if (s >= 60) return "text-accent2";
    if (s >= 40) return "text-warn";
    return "text-danger";
  };

  const getScoreTier = (s: number): { label: string; message: string } => {
    if (s >= 80) return { label: "Excellent", message: "Data is in great shape. Safe to use." };
    if (s >= 60) return { label: "Good", message: "Minor issues present. Consider cleaning." };
    if (s >= 40) return { label: "Fair", message: "Noticeable issues found. Cleaning recommended." };
    return { label: "Poor", message: "Significant issues detected. Clean before using." };
  };

  const getScoreBg = (s: number) => {
    if (s >= 80) return "bg-accent/20";
    if (s >= 60) return "bg-accent2/20";
    if (s >= 40) return "bg-warn/20";
    return "bg-danger/20";
  };

  const getScoreBorder = (s: number) => {
    if (s >= 80) return "border-accent/30";
    if (s >= 60) return "border-accent2/30";
    if (s >= 40) return "border-warn/30";
    return "border-danger/30";
  };

  const sizeClasses = {
    sm: "w-20 h-20 text-2xl",
    md: "w-32 h-32 text-4xl",
    lg: "w-48 h-48 text-5xl",
  };

  const labelSizeClasses = {
    sm: "text-xs",
    md: "text-sm",
    lg: "text-base",
  };

  const difference = previousScore !== undefined ? score - previousScore : null;
  const TrendIcon = difference === null ? Minus : difference > 0 ? TrendingUp : TrendingDown;
  const trendColor = difference === null ? "text-app-subtle" : difference > 0 ? "text-accent" : "text-danger";

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={`relative rounded-full ${sizeClasses[size]} ${getScoreBg(score)} border ${getScoreBorder(score)} flex items-center justify-center font-bold ${getScoreColor(score)} transition-all duration-300`}
      >
        <span>{Math.round(score)}%</span>
        {difference !== null && (
          <div className={`absolute -top-2 -right-2 p-1.5 rounded-full bg-panel border ${getScoreBorder(score)} ${trendColor}`}>
            <TrendIcon className="w-4 h-4" />
          </div>
        )}
      </div>
      {showLabel && (
        <div className="text-center">
          <p className={`font-semibold ${labelSizeClasses[size]} ${getScoreColor(score)}`}>
            {getScoreTier(score).label}
          </p>
          <p className="text-xs text-app-subtle mt-0.5 max-w-[160px]">{getScoreTier(score).message}</p>
          {difference !== null && (
            <p className={`text-xs mt-1 ${trendColor}`}>
              {difference > 0 ? "+" : ""}{difference.toFixed(1)}% {difference > 0 ? "improvement" : "decline"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

interface QualityBreakdownProps {
  completeness: number;
  accuracy: number;
  consistency: number;
  validity: number;
}

export function QualityBreakdown({ completeness, accuracy, consistency, validity }: QualityBreakdownProps) {
  const metrics = [
    { name: "Completeness", value: completeness, color: "#00d9a5" },
    { name: "Accuracy", value: accuracy, color: "#00b8ff" },
    { name: "Consistency", value: consistency, color: "#ffb020" },
    { name: "Validity", value: validity, color: "#ef4444" },
  ];

  return (
    <div className="space-y-4">
      {metrics.map((metric) => (
        <div key={metric.name} className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-app-muted">{metric.name}</span>
            <span className="font-medium" style={{ color: metric.color }}>{metric.value.toFixed(1)}%</span>
          </div>
          <div className="h-2 rounded-full bg-edge overflow-hidden">
            <div
              className="h-full transition-all duration-500"
              style={{ width: `${metric.value}%`, backgroundColor: metric.color }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}
