export default function EquipoMiembroLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Breadcrumb */}
      <div className="h-4 w-48 rounded bg-muted" />

      {/* Profile card */}
      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="h-16 w-16 rounded-2xl bg-muted shrink-0" />
          <div className="flex-1 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="h-7 w-48 rounded-lg bg-muted" />
              <div className="h-5 w-16 rounded-full bg-muted" />
            </div>
            <div className="h-4 w-36 rounded bg-muted" />
          </div>
          <div className="flex gap-2 shrink-0">
            <div className="h-9 w-28 rounded-lg bg-muted" />
            <div className="h-9 w-9 rounded-lg bg-muted" />
          </div>
        </div>
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-panel border border-border bg-card p-4 shadow-sm space-y-2">
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="h-7 w-16 rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* Activity log */}
      <div className="rounded-panel border border-border bg-card shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <div className="h-5 w-28 rounded bg-muted" />
        </div>
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="border-b border-border last:border-0 px-5 py-3.5 flex items-center gap-4">
            <div className="h-8 w-8 rounded-full bg-muted shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-36 rounded bg-muted" />
              <div className="h-3 w-24 rounded bg-muted" />
            </div>
            <div className="h-3 w-20 rounded bg-muted hidden sm:block" />
          </div>
        ))}
      </div>
    </div>
  )
}
