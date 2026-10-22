export default function TenantHomeLoading() {
  return (
    <div className="min-h-screen animate-pulse" style={{ background: "var(--tenant-fondo)" }}>
      {/* Navbar skeleton */}
      <div className="h-16 border-b border-foreground/10 bg-foreground/5" />

      {/* Hero / banner area */}
      <div className="h-56 w-full bg-foreground/8 md:h-72" />

      {/* Event cards grid */}
      <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
        <div className="h-5 w-32 rounded bg-foreground/8" />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="overflow-hidden rounded-2xl border border-foreground/10 bg-foreground/5">
              <div className="h-40 bg-foreground/8" />
              <div className="space-y-2 p-4">
                <div className="h-4 w-3/4 rounded bg-foreground/8" />
                <div className="h-3 w-1/2 rounded bg-foreground/8" />
                <div className="h-8 w-full rounded-xl bg-foreground/8 mt-3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
