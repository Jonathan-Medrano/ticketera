export default function ConfiguracionLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div className="space-y-2">
        <div className="h-8 w-44 rounded-lg bg-muted" />
        <div className="h-4 w-64 rounded bg-muted" />
      </div>

      {/* Config sections */}
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-panel border border-border bg-card shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border">
            <div className="h-5 w-36 rounded bg-muted" />
          </div>
          <div className="p-5 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j} className="space-y-1.5">
                  <div className="h-3 w-24 rounded bg-muted" />
                  <div className="h-10 w-full rounded-lg bg-muted" />
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-2">
              <div className="h-10 w-28 rounded-lg bg-muted" />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
