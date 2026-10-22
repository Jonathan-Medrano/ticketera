export default function CobrosLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="h-8 w-40 rounded-lg bg-muted" />
      {[0, 1].map((i) => (
        <div key={i} className="rounded-panel border border-border bg-card p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 shrink-0 rounded-xl bg-muted" />
            <div className="flex-1 space-y-1.5">
              <div className="h-4 w-32 rounded bg-muted" />
              <div className="h-3 w-48 rounded bg-muted" />
            </div>
            <div className="h-6 w-20 rounded-full bg-muted" />
          </div>
          <div className="h-px bg-border" />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="h-16 rounded-xl bg-muted/50" />
            <div className="h-16 rounded-xl bg-muted/50" />
          </div>
          <div className="h-10 w-48 rounded-lg bg-muted" />
        </div>
      ))}
    </div>
  )
}
