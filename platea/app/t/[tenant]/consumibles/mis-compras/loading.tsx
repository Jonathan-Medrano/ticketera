export default function MisConsumiblesLoading() {
  return (
    <div className="min-h-screen animate-pulse">
      <div className="h-16 bg-foreground/5 border-b border-foreground/10" />

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-5">
        <div className="h-7 w-40 bg-foreground/8 rounded-lg" />

        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-foreground/10 bg-foreground/5 p-4 space-y-3">
            <div className="flex justify-between gap-3">
              <div className="h-4 w-1/2 bg-foreground/8 rounded" />
              <div className="h-4 w-20 bg-foreground/8 rounded" />
            </div>
            <div className="h-3 w-1/3 bg-foreground/8 rounded" />
            <div className="space-y-2">
              {[1, 2].map((j) => (
                <div key={j} className="flex justify-between gap-3">
                  <div className="h-3 w-1/3 bg-foreground/8 rounded" />
                  <div className="h-3 w-16 bg-foreground/8 rounded" />
                </div>
              ))}
            </div>
            <div className="h-9 w-full bg-foreground/8 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  )
}
