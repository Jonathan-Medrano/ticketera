export default function ConsumiblesCanjearLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <div className="h-7 w-40 rounded-lg bg-muted" />
          <div className="h-4 w-56 rounded bg-muted" />
        </div>
      </div>

      {/* Search / QR input */}
      <div className="rounded-panel border border-border bg-card p-5 shadow-sm space-y-4">
        <div className="h-5 w-32 rounded bg-muted" />
        <div className="flex gap-3">
          <div className="h-11 flex-1 rounded-lg bg-muted" />
          <div className="h-11 w-28 rounded-lg bg-muted" />
        </div>
      </div>

      {/* Result placeholder */}
      <div className="rounded-panel border border-border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-2xl bg-muted shrink-0" />
          <div className="space-y-2 flex-1">
            <div className="h-5 w-40 rounded bg-muted" />
            <div className="h-4 w-28 rounded bg-muted" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-3 w-20 rounded bg-muted" />
              <div className="h-4 w-28 rounded bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
