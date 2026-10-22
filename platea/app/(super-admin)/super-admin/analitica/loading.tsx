export default function Loading() {
  return (
    <div className="space-y-6">
      {/* Section header row */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-2">
          <div className="h-7 w-28 animate-pulse rounded-md bg-muted" />
          <div className="h-4 w-72 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <div className="h-8 w-14 animate-pulse rounded-md bg-muted" />
            <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
            <div className="h-8 w-16 animate-pulse rounded-md bg-muted" />
            <div className="h-8 w-14 animate-pulse rounded-md bg-muted" />
          </div>
          <div className="h-8 w-8 animate-pulse rounded-md bg-muted" />
        </div>
      </div>

      {/* KPI strip */}
      <div className="rounded-[28px] border border-border/30 bg-card p-6 shadow-[var(--superadmin-soft-shadow)]">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-card-sm border border-border/50 bg-card px-4 py-4">
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            <div className="mt-3 h-8 w-32 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-20 animate-pulse rounded bg-muted" />
          </div>
          <div className="rounded-card-sm border border-border/50 bg-card px-4 py-4">
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            <div className="mt-3 h-8 w-20 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-32 animate-pulse rounded bg-muted" />
          </div>
          <div className="rounded-card-sm border border-border/50 bg-card px-4 py-4">
            <div className="h-3 w-24 animate-pulse rounded bg-muted" />
            <div className="mt-3 h-8 w-28 animate-pulse rounded bg-muted" />
          </div>
          <div className="rounded-card-sm border border-border/50 bg-card px-4 py-4">
            <div className="h-3 w-16 animate-pulse rounded bg-muted" />
            <div className="mt-3 h-8 w-28 animate-pulse rounded bg-muted" />
            <div className="mt-2 h-3 w-24 animate-pulse rounded bg-muted" />
          </div>
        </div>
      </div>

      {/* Chart panel */}
      <div className="rounded-[28px] border border-border/30 bg-card p-6 shadow-[var(--superadmin-soft-shadow)]">
        <div className="mb-4 flex items-center justify-between">
          <div className="space-y-1.5">
            <div className="h-5 w-36 animate-pulse rounded bg-muted" />
            <div className="h-3 w-56 animate-pulse rounded bg-muted" />
          </div>
          <div className="h-8 w-28 animate-pulse rounded-md bg-muted" />
        </div>
        <div className="h-[320px] w-full animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  )
}
