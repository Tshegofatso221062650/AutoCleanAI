export default function Loading() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-8 w-40 rounded-lg bg-panel/60" />
      <div className="h-10 rounded-xl bg-panel/60" />
      {[...Array(8)].map((_, i) => (
        <div key={i} className="h-16 rounded-xl bg-panel/60" />
      ))}
    </div>
  );
}
