export default function ConsumiblesVenderLoading() {
  return (
    <div className="space-y-4 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-32 rounded-lg bg-muted" />
          <div className="h-4 w-48 rounded bg-muted" />
        </div>
        <div className="h-10 w-32 rounded-lg bg-muted" />
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* Product grid */}
        <div className="flex-1 space-y-4">
          {/* Category tabs */}
          <div className="flex gap-2 flex-wrap">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-9 w-28 rounded-lg bg-muted" />
            ))}
          </div>

          {/* Product cards */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="rounded-card border border-border bg-card shadow-sm overflow-hidden">
                <div className="h-28 w-full bg-muted" />
                <div className="p-3 space-y-2">
                  <div className="h-4 w-28 rounded bg-muted" />
                  <div className="flex items-center justify-between">
                    <div className="h-5 w-16 rounded bg-muted" />
                    <div className="h-7 w-20 rounded-full bg-muted" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Order panel */}
        <div className="lg:w-72 rounded-panel border border-border bg-card p-4 shadow-sm space-y-4">
          <div className="h-5 w-20 rounded bg-muted" />
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
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
