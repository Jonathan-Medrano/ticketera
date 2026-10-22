export default function MarketingEmailLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      <div className="flex items-center justify-between gap-3">
        <div className="h-8 w-48 rounded-lg bg-muted" />
        <div className="h-9 w-32 rounded-lg bg-muted" />
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 rounded-panel border border-border bg-card p-4 shadow-sm">
            <div className="h-10 w-10 shrink-0 rounded-xl bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-56 rounded bg-muted" />
              <div className="h-3 w-32 rounded bg-muted" />
            </div>
            <div className="hidden items-center gap-4 md:flex">
              <div className="h-5 w-20 rounded-full bg-muted" />
              <div className="h-3 w-24 rounded bg-muted" />
            </div>
            <div className="h-8 w-8 shrink-0 rounded-lg bg-muted" />
          </div>
        ))}
      </div>
    </div>
  )
}
