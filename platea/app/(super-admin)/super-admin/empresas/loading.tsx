export default function Loading() {
  return (
    <div className="space-y-6">
      {/* KPI strip skeleton */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-[28px] bg-muted/30" />
        ))}
      </div>
      {/* Main panel skeleton */}
      <div className="animate-pulse rounded-[28px] bg-muted/30">
        <div className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="h-5 w-40 rounded-lg bg-muted/50" />
            <div className="flex gap-2">
              <div className="h-9 w-32 rounded-lg bg-muted/50" />
              <div className="h-9 w-36 rounded-lg bg-muted/50" />
            </div>
          </div>
          <div className="h-14 rounded-2xl bg-muted/40" />
          <div className="h-9 rounded-xl bg-muted/40" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-2xl bg-muted/30" />
          ))}
        </div>
      </div>
    </div>
  )
}
