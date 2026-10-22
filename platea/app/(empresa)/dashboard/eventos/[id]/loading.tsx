export default function EventoDetalleLoading() {
  return (
    <div className="space-y-4 md:space-y-6 pb-8 animate-pulse">
      {/* Breadcrumb + header */}
      <div className="space-y-1.5">
        <div className="h-4 w-48 rounded bg-muted" />
        <div className="flex items-center gap-3">
          <div className="flex-1 space-y-1.5">
            <div className="h-7 w-64 rounded-lg bg-muted" />
            <div className="flex gap-3">
              <div className="h-4 w-24 rounded bg-muted" />
              <div className="h-4 w-28 rounded bg-muted" />
            </div>
          </div>
          <div className="h-8 w-20 rounded-lg bg-muted hidden sm:block" />
          <div className="h-8 w-24 rounded-lg bg-muted hidden sm:block" />
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-panel border border-border bg-card p-4 shadow-sm space-y-2">
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="h-7 w-16 rounded bg-muted" />
            <div className="h-3 w-24 rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* Tabs + content */}
      <div className="rounded-panel border border-border bg-card shadow-sm overflow-hidden">
        <div className="flex gap-1 border-b border-border p-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-8 w-24 rounded-lg bg-muted" />
          ))}
        </div>
        <div className="p-4 space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 py-2 border-b border-border last:border-0">
              <div className="flex-1 space-y-1.5">
                <div className="h-3.5 w-40 rounded bg-muted" />
                <div className="h-3 w-28 rounded bg-muted" />
              </div>
              <div className="h-4 w-16 rounded bg-muted hidden sm:block" />
              <div className="h-5 w-20 rounded-full bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
