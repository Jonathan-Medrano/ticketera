export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Header skeleton */}
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-8 w-64 animate-pulse rounded-md bg-muted/40" />
          <div className="h-4 w-[440px] animate-pulse rounded-md bg-muted/40" />
        </div>
        <div className="h-8 w-32 shrink-0 animate-pulse rounded-md bg-muted/40" />
      </div>

      {/* KPI strip skeleton */}
      <div className="grid grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-border/60 p-4">
            <div className="flex items-center gap-2">
              <div className="h-4 w-4 animate-pulse rounded-md bg-muted/40" />
              <div className="h-3 w-24 animate-pulse rounded-md bg-muted/40" />
            </div>
            <div className="mt-3 h-8 w-16 animate-pulse rounded-md bg-muted/40" />
          </div>
        ))}
      </div>

      {/* Filter panel skeleton */}
      <div className="rounded-[28px] border border-border/70 bg-card p-6 shadow-[var(--superadmin-soft-shadow)]">
        <div className="grid gap-3 grid-cols-[1fr_1fr_1fr_auto] items-end">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-1.5">
              <div className="h-3 w-16 animate-pulse rounded-md bg-muted/40" />
              <div className="h-10 w-full animate-pulse rounded-lg bg-muted/40" />
            </div>
          ))}
          <div className="flex gap-2">
            <div className="h-10 w-20 animate-pulse rounded-md bg-muted/40" />
            <div className="h-10 w-20 animate-pulse rounded-md bg-muted/40" />
          </div>
        </div>
      </div>

      {/* Table panel skeleton */}
      <div className="rounded-[28px] border border-border/70 bg-card p-6 shadow-[var(--superadmin-soft-shadow)]">
        {/* Toolbar row skeleton */}
        <div className="mb-4 flex items-center justify-between">
          <div className="h-3 w-52 animate-pulse rounded-md bg-muted/40" />
          <div className="flex items-center gap-2">
            <div className="h-8 w-24 animate-pulse rounded-md bg-muted/40" />
            <div className="h-3 w-14 animate-pulse rounded-md bg-muted/40" />
          </div>
        </div>

        {/* Table row skeletons */}
        <div className="space-y-2">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="flex items-center gap-4 rounded-xl bg-muted/20 px-3 py-3 animate-pulse"
            >
              <div className="h-3 w-32 shrink-0 rounded-md bg-muted/40" />
              <div className="h-3 w-28 rounded-md bg-muted/40" />
              <div className="h-5 w-36 rounded-md bg-muted/40" />
              <div className="h-3 w-28 rounded-md bg-muted/40" />
              <div className="hidden h-3 w-24 rounded-md bg-muted/40 md:block" />
              <div className="ml-auto h-7 w-10 rounded-md bg-muted/40" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
