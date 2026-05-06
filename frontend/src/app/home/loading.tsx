export default function Loading() {
  return (
    <div className="max-w-4xl mx-auto space-y-6 animate-pulse">
      <div className="h-8 w-48 rounded-lg bg-panel/60" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-24 rounded-xl bg-panel/60" />
        ))}
      </div>
      <div className="h-40 rounded-xl bg-panel/60" />
      <div className="h-40 rounded-xl bg-panel/60" />
    </div>
  );
}
