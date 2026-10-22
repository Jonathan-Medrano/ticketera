export default function MarketingLoading() {
  return (
    <div className="flex flex-col gap-6 pb-6 animate-pulse">
      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-card border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-2 flex-1">
                <div className="h-3 w-24 rounded bg-muted" />
                <div className="h-7 w-12 rounded bg-muted" />
              </div>
              <div className="h-9 w-9 rounded-xl bg-muted shrink-0" />
            </div>
          </div>
        ))}
      </div>

      {/* Nav cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-5 space-y-3">
            <div className="h-9 w-9 rounded-lg bg-muted" />
            <div className="space-y-1.5">
              <div className="h-4 w-28 rounded bg-muted" />
              <div className="h-3 w-full rounded bg-muted" />
              <div className="h-3 w-3/4 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
