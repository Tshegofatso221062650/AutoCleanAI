export default function Loading() {
  return (
    <div className="max-w-4xl mx-auto space-y-4 animate-pulse">
      <div className="h-8 w-40 rounded-lg bg-panel/60" />
      <div className="h-10 rounded-xl bg-panel/60" />
      <div className="grid sm:grid-cols-2 gap-3">
        {[...Array(6)].map((_, i) => (
          <div key={i} className="h-20 rounded-2xl bg-panel/60" />
        ))}
      </div>
    </div>
  );
}
