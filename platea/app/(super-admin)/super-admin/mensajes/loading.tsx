import { SuperAdminPanel } from "@/components/super-admin/section-shell"

export default function Loading() {
  return (
    <div className="space-y-6">
      <SuperAdminPanel>
        {/* Header skeleton */}
        <div className="mb-6 flex items-start justify-between gap-3">
          <div className="space-y-2">
            <div className="h-5 w-48 animate-pulse rounded-lg bg-muted/40" />
            <div className="h-3 w-72 animate-pulse rounded-lg bg-muted/30" />
          </div>
          <div className="flex gap-2">
            <div className="h-9 w-32 animate-pulse rounded-lg bg-muted/40" />
            <div className="h-9 w-24 animate-pulse rounded-lg bg-muted/30" />
          </div>
        </div>

        {/* KPI strip skeleton */}
        <div className="mb-6 flex flex-wrap gap-4">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="flex min-w-[140px] flex-1 items-center gap-3 rounded-[28px] border border-border/70 bg-card p-4 shadow-[var(--superadmin-soft-shadow)]"
            >
              <div className="h-5 w-5 shrink-0 animate-pulse rounded-md bg-muted/40" />
              <div className="space-y-1.5">
                <div className="h-6 w-10 animate-pulse rounded-md bg-muted/40" />
                <div className="h-3 w-20 animate-pulse rounded-md bg-muted/30" />
              </div>
            </div>
          ))}
        </div>

        {/* Table skeleton */}
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-center gap-3 rounded-2xl bg-muted/20 px-3 py-4">
              <div className="flex-[2] space-y-1.5">
                <div className="h-4 w-3/4 animate-pulse rounded-md bg-muted/40" />
                <div className="h-3 w-full animate-pulse rounded-md bg-muted/30" />
              </div>
              <div className="h-5 w-16 animate-pulse rounded-full bg-muted/40" />
              <div className="h-4 w-24 animate-pulse rounded-md bg-muted/40" />
              <div className="h-4 w-20 animate-pulse rounded-md bg-muted/40" />
              <div className="h-5 w-14 animate-pulse rounded-full bg-muted/40" />
              <div className="flex gap-2">
                <div className="h-8 w-8 animate-pulse rounded-lg bg-muted/40" />
                <div className="h-8 w-16 animate-pulse rounded-lg bg-muted/40" />
                <div className="h-8 w-8 animate-pulse rounded-lg bg-muted/40" />
              </div>
            </div>
          ))}
        </div>
      </SuperAdminPanel>
    </div>
  )
}
