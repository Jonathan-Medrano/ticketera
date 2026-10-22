export default function Loading() {
  const panel = "rounded-[28px] border border-border/70 bg-card shadow-[var(--superadmin-soft-shadow)]"
  return (
    <div className="animate-pulse space-y-6 motion-reduce:animate-none md:space-y-8" aria-hidden>
      <div className="space-y-2">
        <div className="h-3 w-24 rounded bg-secondary" />
        <div className="h-7 w-48 max-w-full rounded bg-secondary" />
        <div className="h-4 w-72 max-w-full rounded bg-secondary/70" />
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`${panel} p-5`}>
            <div className="h-3 w-20 rounded bg-secondary" />
            <div className="mt-4 h-8 w-16 rounded bg-secondary" />
          </div>
        ))}
      </div>

      <div className={`${panel} overflow-hidden`}>
        <div className="border-b border-border/40 px-5 py-4">
          <div className="h-4 w-32 rounded bg-secondary" />
        </div>
        <div className="divide-y divide-border/30">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-4">
              <div className="h-3 w-3 rounded-full bg-secondary" />
              <div className="h-3 w-24 rounded bg-secondary" />
              <div className="h-3 flex-1 rounded bg-secondary/70" />
              <div className="h-3 w-12 rounded bg-secondary/50" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
