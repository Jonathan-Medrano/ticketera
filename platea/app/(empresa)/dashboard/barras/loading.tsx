export default function BarrasLoading() {
  return (
    <div className="animate-pulse space-y-5 pb-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1.5">
          <div className="h-8 w-48 rounded-lg bg-muted" />
          <div className="h-4 w-64 rounded bg-muted/70" />
        </div>
        <div className="h-9 w-36 rounded-lg bg-muted" />
      </div>

      {/* Event + search toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="h-9 w-52 rounded-lg bg-muted" />
        <div className="h-9 w-64 rounded-lg bg-muted" />
        <div className="ml-auto h-9 w-28 rounded-lg bg-muted" />
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/60 p-4 space-y-2">
            <div className="h-3.5 w-20 rounded bg-muted" />
            <div className="h-6 w-14 rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-border/60">
        <div className="border-b border-border/60 bg-muted/30 px-4 py-3 flex gap-4">
          {[120, 80, 60, 70, 50].map((w, i) => (
            <div key={i} className="h-3.5 rounded bg-muted" style={{ width: w }} />
          ))}
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border/40 px-4 py-4 last:border-b-0">
            <div className="h-8 w-8 rounded-lg bg-muted shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-40 rounded bg-muted" />
              <div className="h-3 w-24 rounded bg-muted/70" />
            </div>
            <div className="h-4 w-20 rounded bg-muted" />
            <div className="h-4 w-16 rounded bg-muted" />
            <div className="h-4 w-16 rounded bg-muted" />
            <div className="ml-auto h-7 w-7 rounded-lg bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}
