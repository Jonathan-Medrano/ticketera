export default function SuperAdminComisionesLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header */}
      <div className="h-7 w-56 rounded-lg bg-muted/40" />

      {/* Search + filters */}
      <div className="flex gap-3">
        <div className="h-10 w-64 rounded-lg bg-muted/30" />
        <div className="h-10 w-36 rounded-lg bg-muted/30" />
      </div>

      {/* Table */}
      <div className="rounded-[28px] bg-muted/20">
        <div className="p-5 space-y-3">
          <div className="h-9 w-full rounded-xl bg-muted/30" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 rounded-2xl bg-muted/25" />
          ))}
        </div>
      </div>
    </div>
  )
}
