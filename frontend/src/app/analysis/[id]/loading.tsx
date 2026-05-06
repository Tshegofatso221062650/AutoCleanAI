export default function Loading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="h-8 w-56 rounded-lg bg-panel/60" />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="h-20 rounded-xl bg-panel/60" />
        ))}
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="h-56 rounded-xl bg-panel/60" />
        <div className="h-56 rounded-xl bg-panel/60" />
      </div>
      <div className="h-48 rounded-xl bg-panel/60" />
    </div>
  );
}
