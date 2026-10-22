export default function EscanearLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header + stats */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-7 w-36 rounded-lg bg-muted" />
          <div className="h-4 w-48 rounded bg-muted" />
        </div>
        <div className="flex gap-3">
          <div className="h-10 w-28 rounded-lg bg-muted" />
          <div className="h-10 w-28 rounded-lg bg-muted" />
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-panel border border-border bg-card p-4 shadow-sm space-y-2">
            <div className="h-3 w-16 rounded bg-muted" />
            <div className="h-7 w-12 rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* Scanner / lookup */}
      <div className="rounded-panel border border-border bg-card p-5 shadow-sm space-y-4">
        <div className="h-5 w-40 rounded bg-muted" />
        <div className="flex gap-3">
          <div className="h-11 flex-1 rounded-lg bg-muted" />
          <div className="h-11 w-28 rounded-lg bg-muted" />
        </div>
      </div>

      {/* Recent scans */}
      <div className="rounded-panel border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-3.5 border-b border-border">
          <div className="h-4 w-32 rounded bg-muted" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="border-b border-border last:border-0 px-5 py-3 flex items-center gap-4">
            <div className="h-8 w-8 rounded-full bg-muted shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-36 rounded bg-muted" />
              <div className="h-3 w-24 rounded bg-muted" />
            </div>
            <div className="h-5 w-16 rounded-full bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}
