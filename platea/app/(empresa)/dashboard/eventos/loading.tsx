export default function EventosLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      {/* Header */}
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="h-8 w-36 rounded-lg bg-muted" />
        <div className="h-10 w-32 rounded-lg bg-muted" />
      </section>

      {/* Summary cards */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-panel border border-border bg-card p-4 shadow-sm space-y-3">
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="h-7 w-16 rounded bg-muted" />
            <div className="h-3 w-28 rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* Toolbar: 3 selects (ordenar / dirección / estado de publicación) + búsqueda,
          más pageSize + rango + paginación — refleja la toolbar real de eventos-content.tsx. */}
      <section className="rounded-panel border border-border bg-card p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-col gap-3 xl:flex-row xl:flex-1">
            <div className="h-11 w-full rounded-lg bg-muted xl:w-44" />
            <div className="h-11 w-full rounded-lg bg-muted xl:w-40" />
            <div className="h-11 w-full rounded-lg bg-muted xl:w-44" />
            <div className="h-11 flex-1 rounded-lg bg-muted" />
          </div>
          <div className="flex flex-col gap-3 sm:flex-row xl:items-center xl:justify-end">
            <div className="h-10 w-24 rounded-lg bg-muted" />
            <div className="h-6 w-32 rounded bg-muted" />
            <div className="flex gap-1">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-8 w-8 rounded-lg bg-muted" />
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Lista de eventos */}
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="rounded-panel border border-border bg-card p-4 shadow-sm md:p-5"
          >
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
              <div className="flex items-start gap-3 shrink-0">
                <div className="h-5 w-5 rounded-md bg-muted" />
                <div className="h-20 w-20 rounded-lg bg-muted shrink-0" />
              </div>
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div className="h-6 w-24 rounded-full bg-muted" />
                  <div className="h-6 w-20 rounded-full bg-muted" />
                  <div className="h-6 w-24 rounded-full bg-muted" />
                </div>
                <div className="h-5 w-64 max-w-full rounded bg-muted" />
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="h-9 rounded-xl bg-muted" />
                  <div className="h-9 rounded-xl bg-muted" />
                  <div className="h-9 rounded-xl bg-muted" />
                </div>
              </div>
              <div className="hidden lg:flex items-center gap-1 shrink-0">
                <div className="h-11 w-11 rounded-xl bg-muted" />
                <div className="h-11 w-11 rounded-xl bg-muted" />
                <div className="h-11 w-11 rounded-xl bg-muted" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
