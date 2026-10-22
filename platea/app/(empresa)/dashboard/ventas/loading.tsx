export default function VentasLoading() {
  return (
    <div className="space-y-5 animate-pulse">
      {/* Tabs + header action */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1 rounded-full bg-muted p-1">
          <div className="h-8 w-24 rounded-full bg-muted-foreground/20" />
          <div className="h-8 w-28 rounded-full bg-muted-foreground/10" />
        </div>
        <div className="h-9 w-28 rounded-lg bg-muted" />
      </div>

      {/* Stats de período */}
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-panel border border-border bg-card p-4 shadow-sm space-y-2">
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="h-7 w-24 rounded bg-muted" />
            <div className="h-3 w-32 rounded bg-muted" />
          </div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3">
        <div className="h-10 w-48 rounded-lg bg-muted" />
        <div className="h-10 w-36 rounded-lg bg-muted" />
        <div className="h-10 w-36 rounded-lg bg-muted" />
        <div className="h-10 w-24 rounded-lg bg-muted" />
      </div>

      {/* Tabla */}
      <div className="rounded-panel border border-border bg-card shadow-sm overflow-hidden">
        {/* Cabecera tabla */}
        <div className="border-b border-border bg-muted/40 px-4 py-3 grid grid-cols-5 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-3 w-full max-w-[80px] rounded bg-muted" />
          ))}
        </div>
        {/* Filas */}
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="border-b border-border/50 px-4 py-3 grid grid-cols-5 gap-4 items-center">
            <div className="h-3 w-20 rounded bg-muted" />
            <div className="h-3 w-28 rounded bg-muted" />
            <div className="h-3 w-16 rounded bg-muted" />
            <div className="h-5 w-14 rounded-full bg-muted" />
            <div className="h-3 w-12 rounded bg-muted justify-self-end" />
          </div>
        ))}
      </div>

      {/* Paginación */}
      <div className="flex items-center justify-between">
        <div className="h-3 w-32 rounded bg-muted" />
        <div className="flex gap-2">
          <div className="h-8 w-8 rounded bg-muted" />
          <div className="h-8 w-8 rounded bg-muted" />
          <div className="h-8 w-8 rounded bg-muted" />
        </div>
      </div>
    </div>
  )
}
