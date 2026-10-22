export default function ConsumiblesLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      {/* Header */}
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div className="h-8 w-40 rounded-lg bg-muted" />
        <div className="h-10 w-36 rounded-lg bg-muted" />
      </section>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="h-10 w-56 rounded-lg bg-muted" />
        <div className="h-10 w-32 rounded-lg bg-muted" />
      </div>

      {/* Grid de cards de consumibles */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="rounded-panel border border-border bg-card shadow-sm overflow-hidden"
          >
            {/* Imagen placeholder */}
            <div className="h-36 w-full bg-muted" />
            <div className="p-4 space-y-3">
              <div className="h-4 w-32 rounded bg-muted" />
              <div className="h-3 w-48 rounded bg-muted" />
              <div className="flex items-center justify-between">
                <div className="h-5 w-16 rounded bg-muted" />
                <div className="h-6 w-14 rounded-full bg-muted" />
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Paginación */}
      <div className="flex items-center justify-between">
        <div className="h-3 w-28 rounded bg-muted" />
        <div className="flex gap-2">
          <div className="h-8 w-8 rounded bg-muted" />
          <div className="h-8 w-8 rounded bg-muted" />
          <div className="h-8 w-8 rounded bg-muted" />
        </div>
      </div>
    </div>
  )
}
