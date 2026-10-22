export default function SitioVentaLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex items-center justify-between gap-3">
        <div className="h-8 w-44 rounded-lg bg-muted" />
        <div className="flex gap-2">
          <div className="h-9 w-24 rounded-lg bg-muted" />
          <div className="h-9 w-28 rounded-lg bg-muted" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="overflow-hidden rounded-panel border border-border bg-card shadow-sm">
          <div className="flex h-12 items-center gap-3 border-b border-border bg-muted/30 px-4">
            <div className="h-4 w-16 rounded bg-muted" />
            <div className="h-4 w-16 rounded bg-muted" />
            <div className="h-4 w-20 rounded bg-muted" />
          </div>
          <div className="h-[480px] bg-muted/20" />
        </div>
        <div className="space-y-4">
          <div className="rounded-panel border border-border bg-card p-5 shadow-sm space-y-3">
            <div className="h-4 w-24 rounded bg-muted" />
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-3 w-20 rounded bg-muted" />
                <div className="h-9 w-full rounded-lg bg-muted/60" />
              </div>
            ))}
          </div>
          <div className="rounded-panel border border-border bg-card p-5 shadow-sm space-y-3">
            <div className="h-4 w-28 rounded bg-muted" />
            <div className="h-16 w-full rounded-xl bg-muted/50" />
          </div>
        </div>
      </div>
    </div>
  )
}
