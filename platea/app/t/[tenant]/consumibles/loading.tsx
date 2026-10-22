export default function ConsumiblesLoading() {
  return (
    <div className="min-h-screen animate-pulse">
      <div className="h-16 bg-foreground/5 border-b border-foreground/10" />

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-6">
        <div className="h-7 w-48 bg-foreground/8 rounded-lg" />

        {/* Event cards */}
        {[1, 2].map((i) => (
          <div key={i} className="rounded-2xl border border-foreground/10 bg-foreground/5 p-4 space-y-4">
            <div className="flex gap-4">
              <div className="h-24 w-24 rounded-xl bg-foreground/8 shrink-0" />
              <div className="flex-1 space-y-2">
                <div className="h-5 w-2/3 bg-foreground/8 rounded" />
                <div className="h-3 w-1/3 bg-foreground/8 rounded" />
                <div className="h-3 w-1/2 bg-foreground/8 rounded" />
              </div>
            </div>
            {/* Item grid */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {[1, 2, 3].map((j) => (
                <div key={j} className="rounded-xl bg-foreground/8 h-20" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
