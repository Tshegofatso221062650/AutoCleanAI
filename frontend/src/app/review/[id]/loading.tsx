export default function Loading() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="flex gap-3">
        <div className="h-9 w-64 rounded-xl bg-panel/60" />
        <div className="h-9 w-28 rounded-xl bg-panel/60 ml-auto" />
      </div>
      <div className="rounded-xl border border-edge/30 overflow-hidden">
        <div className="h-10 bg-panel/80" />
        {[...Array(10)].map((_, i) => (
          <div key={i} className="h-10 border-t border-edge/15 bg-panel/40" />
        ))}
      </div>
      <div className="flex justify-center gap-2">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-8 w-8 rounded-lg bg-panel/60" />
        ))}
      </div>
    </div>
  );
}
