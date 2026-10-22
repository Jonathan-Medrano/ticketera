export default function ConsumiblesEventoLoading() {
  return (
    <div className="min-h-screen animate-pulse">
      <div className="h-16 bg-foreground/5 border-b border-foreground/10" />

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Event header */}
        <div className="space-y-2">
          <div className="h-7 w-2/3 bg-foreground/8 rounded-lg" />
          <div className="h-4 w-1/3 bg-foreground/8 rounded" />
        </div>

        {/* Barra sections */}
        {[1, 2].map((i) => (
          <div key={i} className="space-y-3">
            <div className="h-5 w-32 bg-foreground/8 rounded" />
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[1, 2, 3, 4].map((j) => (
                <div key={j} className="rounded-2xl border border-foreground/10 bg-foreground/5 p-4 space-y-2">
                  <div className="h-16 w-full bg-foreground/8 rounded-xl" />
                  <div className="h-4 w-3/4 bg-foreground/8 rounded" />
                  <div className="h-5 w-20 bg-foreground/8 rounded" />
                  <div className="h-9 w-full bg-foreground/8 rounded-xl" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
