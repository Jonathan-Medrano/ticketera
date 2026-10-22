export default function MisTicketsLoading() {
  return (
    <div className="min-h-screen animate-pulse">
      {/* Navbar skeleton */}
      <div className="h-16 bg-foreground/5 border-b border-foreground/10" />

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Page title */}
        <div className="h-7 w-40 bg-foreground/8 rounded-lg" />

        {/* Tabs skeleton */}
        <div className="flex gap-2">
          <div className="h-9 w-28 bg-foreground/8 rounded-lg" />
          <div className="h-9 w-28 bg-foreground/8 rounded-lg" />
        </div>

        {/* Ticket cards */}
        {[1, 2, 3].map((i) => (
          <div key={i} className="rounded-2xl border border-foreground/10 bg-foreground/5 p-4 space-y-3">
            <div className="flex gap-3">
              {/* Thumbnail */}
              <div className="h-20 w-20 rounded-xl bg-foreground/8 shrink-0" />
              {/* Content */}
              <div className="flex-1 space-y-2">
                <div className="h-4 w-3/4 bg-foreground/8 rounded" />
                <div className="h-3 w-1/2 bg-foreground/8 rounded" />
                <div className="h-3 w-1/3 bg-foreground/8 rounded" />
              </div>
            </div>
            <div className="h-9 w-full bg-foreground/8 rounded-xl" />
          </div>
        ))}
      </div>
    </div>
  )
}
