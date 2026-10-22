export default function PosLoading() {
  return (
    <div className="flex h-full flex-col gap-4 animate-pulse">
      {/* Event selector */}
      <div className="rounded-panel border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-wrap gap-3">
          <div className="h-10 w-52 rounded-lg bg-muted" />
          <div className="h-10 w-40 rounded-lg bg-muted" />
          <div className="h-10 w-36 rounded-lg bg-muted" />
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Category / product grid */}
        <div className="flex-1 space-y-4">
          {/* Category tabs */}
          <div className="flex gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-9 w-24 rounded-lg bg-muted" />
            ))}
          </div>

          {/* Ticket cards */}
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="rounded-card border border-border bg-card p-4 shadow-sm space-y-3">
                <div className="h-4 w-36 rounded bg-muted" />
                <div className="h-7 w-24 rounded bg-muted" />
                <div className="flex items-center justify-between">
                  <div className="h-3 w-20 rounded bg-muted" />
                  <div className="h-8 w-8 rounded-full bg-muted" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cart panel */}
        <div className="lg:w-72 rounded-panel border border-border bg-card p-4 shadow-sm space-y-4">
          <div className="h-5 w-16 rounded bg-muted" />
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <div className="flex-1 h-3 rounded bg-muted" />
                <div className="h-4 w-14 rounded bg-muted" />
              </div>
            ))}
          </div>
          <div className="border-t border-border pt-3 flex justify-between">
            <div className="h-5 w-12 rounded bg-muted" />
            <div className="h-5 w-20 rounded bg-muted" />
          </div>
          <div className="h-10 w-full rounded-lg bg-muted" />
        </div>
      </div>
    </div>
  )
}
