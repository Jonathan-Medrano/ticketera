export default function RevendedoresLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-8 w-40 rounded-lg bg-muted" />
          <div className="h-4 w-24 rounded bg-muted" />
        </div>
        <div className="h-10 w-36 rounded-lg bg-muted" />
      </div>

      {/* Stats strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-panel border border-border bg-card p-4 shadow-sm space-y-2">
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="h-7 w-14 rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* Filter toolbar */}
      <div className="rounded-panel border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap gap-3">
          <div className="h-10 w-56 rounded-lg bg-muted" />
          <div className="h-10 w-36 rounded-lg bg-muted" />
          <div className="h-10 w-32 rounded-lg bg-muted" />
        </div>
      </div>

      {/* Table */}
      <div className="rounded-panel border border-border bg-card shadow-sm overflow-hidden">
        <div className="border-b border-border px-5 py-3.5 flex gap-6">
          <div className="h-3 w-32 rounded bg-muted" />
          <div className="h-3 w-20 rounded bg-muted" />
          <div className="h-3 w-20 rounded bg-muted" />
        </div>
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="border-b border-border last:border-0 px-5 py-4 flex items-center gap-4">
            <div className="h-9 w-9 rounded-full bg-muted shrink-0" />
            <div className="flex-1 space-y-1.5">
              <div className="h-3.5 w-40 rounded bg-muted" />
              <div className="h-3 w-28 rounded bg-muted" />
            </div>
            <div className="h-4 w-16 rounded bg-muted hidden sm:block" />
            <div className="h-4 w-20 rounded bg-muted hidden md:block" />
          </div>
        ))}
      </div>
    </div>
  )
}
