export default function ReconciliacionLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 w-44 rounded-lg bg-muted" />
          <div className="h-4 w-56 rounded bg-muted" />
        </div>
        <div className="h-10 w-36 rounded-lg bg-muted" />
      </div>

      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-panel border border-border bg-card p-4 shadow-sm space-y-2">
            <div className="h-3 w-24 rounded bg-muted" />
            <div className="h-7 w-20 rounded bg-muted" />
            <div className="h-3 w-16 rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="rounded-panel border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap gap-3">
          <div className="h-10 w-44 rounded-lg bg-muted" />
          <div className="h-10 w-36 rounded-lg bg-muted" />
          <div className="h-10 w-32 rounded-lg bg-muted" />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-panel border border-border bg-card shadow-sm overflow-hidden">
        <div className="border-b border-border px-5 py-3.5 flex gap-6">
          <div className="h-3 w-32 rounded bg-muted" />
          <div className="h-3 w-20 rounded bg-muted" />
          <div className="h-3 w-24 rounded bg-muted" />
          <div className="h-3 w-16 rounded bg-muted" />
        </div>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="border-b border-border last:border-0 px-5 py-4 flex items-center gap-4">
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-44 rounded bg-muted" />
              <div className="h-3 w-28 rounded bg-muted" />
            </div>
            <div className="h-4 w-20 rounded bg-muted hidden sm:block" />
            <div className="h-4 w-24 rounded bg-muted hidden md:block" />
            <div className="h-5 w-20 rounded-full bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}
