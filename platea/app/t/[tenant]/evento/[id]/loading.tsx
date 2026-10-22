export default function EventoLoading() {
  return (
    <div className="min-h-screen animate-pulse">
      {/* Navbar skeleton */}
      <div className="h-16 bg-foreground/5 border-b border-foreground/10" />

      {/* Hero image */}
      <div className="h-[320px] md:h-[380px] bg-foreground/8 w-full" />

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-6">
        {/* Event title */}
        <div className="space-y-3">
          <div className="h-8 w-3/4 bg-foreground/8 rounded-lg" />
          <div className="h-4 w-1/2 bg-foreground/8 rounded" />
        </div>

        {/* Stats: date, location, price cards */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="h-12 bg-foreground/8 rounded-2xl" />
          <div className="h-12 bg-foreground/8 rounded-2xl" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div className="h-16 bg-foreground/8 rounded-2xl" />
          <div className="h-16 bg-foreground/8 rounded-2xl" />
          <div className="h-16 bg-foreground/8 rounded-2xl" />
        </div>

        {/* Ticket categories section */}
        <div className="rounded-3xl border border-foreground/10 bg-foreground/5 p-4 md:p-5 space-y-3">
          <div className="h-3 w-40 bg-foreground/8 rounded" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl border border-foreground/10 bg-foreground/5 p-4 flex justify-between items-center gap-4">
              <div className="space-y-2 flex-1">
                <div className="h-4 w-1/2 bg-foreground/8 rounded" />
                <div className="h-5 w-24 bg-foreground/8 rounded" />
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <div className="h-8 w-8 rounded-full bg-foreground/8" />
                <div className="h-4 w-4 bg-foreground/8 rounded" />
                <div className="h-8 w-8 rounded-full bg-foreground/8" />
                <div className="h-9 w-24 rounded-xl bg-foreground/8" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
