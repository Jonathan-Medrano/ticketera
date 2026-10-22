export default function DashboardLoading() {
  return (
    <div className="space-y-5 md:space-y-6 animate-pulse">
      {/* Header */}
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="h-9 w-48 rounded-lg bg-muted" />
        <div className="flex gap-2">
          <div className="h-10 w-24 rounded-lg bg-muted" />
          <div className="h-10 w-32 rounded-lg bg-muted" />
        </div>
      </section>

      {/* Métricas grid */}
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4 xl:gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-panel border border-border bg-card p-5 shadow-sm space-y-3">
            <div className="flex items-center justify-between">
              <div className="h-3 w-24 rounded bg-muted" />
              <div className="h-9 w-9 rounded-full bg-muted" />
            </div>
            <div className="h-8 w-20 rounded bg-muted" />
            <div className="h-3 w-36 rounded bg-muted" />
          </div>
        ))}
      </section>

      {/* Evento destacado + filtros */}
      <section className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)]">
        <div className="rounded-panel border border-border bg-card p-5 shadow-sm space-y-4">
          <div className="h-3 w-20 rounded bg-muted" />
          <div className="h-6 w-64 rounded bg-muted" />
          <div className="h-24 w-full rounded-card-sm bg-muted" />
          <div className="h-16 w-full rounded-card-sm bg-muted" />
        </div>
        <div className="rounded-panel border border-border bg-card p-5 shadow-sm space-y-4">
          <div className="h-4 w-28 rounded bg-muted" />
          <div className="h-11 w-full rounded-lg bg-muted" />
          <div className="flex gap-2 flex-wrap">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-6 w-16 rounded-full bg-muted" />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="h-11 w-full rounded-lg bg-muted" />
            <div className="h-11 w-full rounded-lg bg-muted" />
          </div>
        </div>
      </section>

      {/* Analytics + ventas recientes */}
      <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-panel border border-border bg-card p-4 shadow-sm md:p-6 space-y-4">
          <div className="border-b border-border pb-4 space-y-2">
            <div className="h-3 w-16 rounded bg-muted" />
            <div className="h-5 w-56 rounded bg-muted" />
          </div>
          <div className="h-8 w-64 rounded-full bg-muted" />
          <div className="h-[280px] w-full rounded-card-sm bg-muted" />
        </div>
        <div className="rounded-panel border border-border bg-card p-4 shadow-sm md:p-6 space-y-4">
          <div className="border-b border-border pb-4 space-y-2">
            <div className="h-3 w-24 rounded bg-muted" />
            <div className="h-5 w-32 rounded bg-muted" />
          </div>
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-card-sm border border-border bg-background/70 p-4 flex gap-3">
              <div className="h-10 w-10 rounded-full bg-muted shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-3 w-32 rounded bg-muted" />
                <div className="h-3 w-48 rounded bg-muted" />
                <div className="h-3 w-24 rounded bg-muted" />
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
