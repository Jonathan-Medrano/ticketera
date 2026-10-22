export default function Loading() {
  const panel = "rounded-[28px] border border-border/70 bg-card shadow-[var(--superadmin-soft-shadow)]"
  return (
    <div className="animate-pulse space-y-6 motion-reduce:animate-none md:space-y-8" aria-hidden>
      {/* Header */}
      <div className="space-y-2">
        <div className="h-3 w-32 rounded bg-secondary" />
        <div className="h-7 w-56 max-w-full rounded bg-secondary" />
        <div className="h-4 w-80 max-w-full rounded bg-secondary/70" />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`${panel} p-5`}>
            <div className="h-3 w-24 rounded bg-secondary" />
            <div className="mt-4 h-8 w-28 rounded bg-secondary" />
            <div className="mt-3 h-3 w-32 rounded bg-secondary/70" />
          </div>
        ))}
      </div>

      {/* Chart + readiness */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(300px,0.95fr)]">
        <div className={`${panel} p-7`}>
          <div className="h-4 w-44 rounded bg-secondary" />
          <div className="mt-8 h-[380px] rounded-3xl bg-secondary/50" />
        </div>
        <div className={`${panel} space-y-3 p-6`}>
          <div className="h-4 w-40 rounded bg-secondary" />
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-3xl bg-secondary/50" />
          ))}
        </div>
      </div>

      {/* Issues + flow comparison */}
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.95fr)]">
        <div className={`${panel} p-6`}>
          <div className="h-4 w-40 rounded bg-secondary" />
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div className="h-32 rounded-[26px] bg-secondary/50" />
            <div className="h-32 rounded-[26px] bg-secondary/50" />
          </div>
        </div>
        <div className={`${panel} p-6`}>
          <div className="h-4 w-36 rounded bg-secondary" />
          <div className="mt-5 space-y-3">
            <div className="h-28 rounded-3xl bg-secondary/50" />
            <div className="h-28 rounded-3xl bg-secondary/50" />
          </div>
        </div>
      </div>

      {/* Profit sharing */}
      <div className={`${panel} p-6`}>
        <div className="h-4 w-48 rounded bg-secondary" />
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <div className="h-24 rounded-3xl bg-secondary/50" />
          <div className="h-24 rounded-3xl bg-secondary/50" />
        </div>
        <div className="mt-6 h-40 rounded-3xl bg-secondary/50" />
      </div>
    </div>
  )
}
