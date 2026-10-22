"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, AlertTriangle, CheckCircle2, ChevronDown, ChevronRight, Download, Loader2, RefreshCw, Search, Server, Trash2, X, Globe } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SuperAdminPanel } from "@/components/super-admin/section-shell"
import { SAKpiCard, saKpiLabelCn, saKpiValueCn } from "@/components/super-admin/kpi-card"
import { useAppTheme, useOptionalSuperAdminTheme } from "@/components/theme-provider"
import { formatDateTime, formatInt } from "@/lib/format"
import { cn } from "@/lib/utils"
import { toast } from "sonner"

type Source = "backend" | "frontend"
type Severity = "error" | "fatal" | "warn"

type ErrorRow = {
  id: number
  fingerprint: string
  source: Source
  severity: Severity
  message: string
  stack: string | null
  context: Record<string, unknown> | null
  userAgent: string | null
  ipAddress: string | null
  countTotal: number
  firstSeenAt: string
  lastSeenAt: string
  resolvedAt: string | null
  resolvedBy: string | null
}

type Metrics = {
  totalUnresolved: number
  totalLast24h: number
  totalPrev24h: number
  deltaPct: number | null
  totalBackend24h: number
  totalFrontend24h: number
  lastSeenAt: string | null
}

type ApiResponse = {
  data: {
    items: ErrorRow[]
    page: number
    pageSize: number
    total: number
    totalPages: number
    metrics: Metrics
  }
}

type Filters = {
  source: Source | "all"
  severity: Severity | "all"
  resolved: "unresolved" | "only" | "all"
  search: string
}

const DEFAULT_FILTERS: Filters = { source: "all", severity: "all", resolved: "unresolved", search: "" }
const POLL_INTERVAL_MS = 30_000

function relativeTime(iso: string) {
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diff = Math.max(0, now - then)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `hace ${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `hace ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours}h`
  const days = Math.floor(hours / 24)
  return `hace ${days}d`
}

export default function ErrorLogsSection() {
  const { resolvedTheme } = useAppTheme()
  const superAdminTheme = useOptionalSuperAdminTheme()
  const effectiveTheme = superAdminTheme?.theme ?? resolvedTheme
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS)
  const [debouncedSearch, setDebouncedSearch] = useState("")
  const [page, setPage] = useState(1)
  const [data, setData] = useState<ApiResponse["data"] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ErrorRow | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ErrorRow | null>(null)
  const [confirmBulkResolve, setConfirmBulkResolve] = useState(false)
  const [actionState, setActionState] = useState<Record<number, "resolving" | "deleting" | "error">>({})
  const lastFetchAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(filters.search.trim()), 350)
    return () => clearTimeout(t)
  }, [filters.search])

  const queryString = useMemo(() => {
    const params = new URLSearchParams()
    if (filters.source !== "all") params.set("source", filters.source)
    if (filters.severity !== "all") params.set("severity", filters.severity)
    params.set("resolved", filters.resolved)
    if (debouncedSearch) params.set("search", debouncedSearch)
    params.set("page", String(page))
    params.set("pageSize", "50")
    return params.toString()
  }, [filters.source, filters.severity, filters.resolved, debouncedSearch, page])

  const fetchData = useCallback(async () => {
    lastFetchAbortRef.current?.abort()
    const ac = new AbortController()
    lastFetchAbortRef.current = ac
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/platform/error-logs?${queryString}`, { cache: "no-store", signal: ac.signal })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as ApiResponse
      setData(json.data)
    } catch (err) {
      if ((err as { name?: string }).name === "AbortError") return
      setError(err instanceof Error ? err.message : "Error desconocido")
    } finally {
      setLoading(false)
    }
  }, [queryString])

  useEffect(() => {
    void fetchData()
  }, [fetchData])

  // Poll for new errors every 30s — only if user is not viewing a row's detail
  useEffect(() => {
    if (selected) return
    const interval = setInterval(() => void fetchData(), POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [fetchData, selected])

  const resolve = useCallback(async (row: ErrorRow) => {
    setActionState((prev) => ({ ...prev, [row.id]: "resolving" }))
    try {
      const res = await fetch(`/api/platform/error-logs/${row.id}/${row.resolvedAt ? "unresolve" : "resolve"}`, { method: "POST" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { data: { error: ErrorRow } }
      setData((prev) =>
        prev ? { ...prev, items: prev.items.map((r) => (r.id === row.id ? json.data.error : r)) } : prev,
      )
      if (selected?.id === row.id) setSelected(json.data.error)
      setActionState((prev) => {
        const next = { ...prev }
        delete next[row.id]
        return next
      })
      toast.success(row.resolvedAt ? "Error marcado como pendiente" : "Error resuelto")
    } catch {
      setActionState((prev) => ({ ...prev, [row.id]: "error" }))
      toast.error("No se pudo actualizar el estado")
    }
  }, [selected])

  const confirmRemove = useCallback(async () => {
    if (!deleteTarget) return
    const row = deleteTarget
    setDeleteTarget(null)
    setActionState((prev) => ({ ...prev, [row.id]: "deleting" }))
    try {
      const res = await fetch(`/api/platform/error-logs/${row.id}`, { method: "DELETE" })
      if (!res.ok && res.status !== 204) throw new Error(`HTTP ${res.status}`)
      setData((prev) => (prev ? { ...prev, items: prev.items.filter((r) => r.id !== row.id), total: prev.total - 1 } : prev))
      if (selected?.id === row.id) setSelected(null)
      toast.success("Log eliminado")
    } catch {
      setActionState((prev) => ({ ...prev, [row.id]: "error" }))
      toast.error("No se pudo eliminar el log")
    }
  }, [deleteTarget, selected])

  const exportCsv = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (filters.source !== "all") params.set("source", filters.source)
      if (filters.severity !== "all") params.set("severity", filters.severity)
      params.set("resolved", filters.resolved)
      if (debouncedSearch) params.set("search", debouncedSearch)
      const res = await fetch(`/api/platform/error-logs/export?${params.toString()}`)
      if (!res.ok) {
        toast.error("No se pudo exportar el CSV")
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `error-logs-${new Date().toISOString().slice(0, 10)}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error("No se pudo descargar el CSV")
    }
  }, [filters.source, filters.severity, filters.resolved, debouncedSearch])

  const bulkResolve = useCallback(async () => {
    if (!data?.items.length) return
    try {
      const ids = data.items.map((r) => r.id)
      const res = await fetch("/api/platform/error-logs/bulk-resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      void fetchData()
    } catch {
      toast.error("No se pudo resolver en lote")
    }
  }, [data?.items, fetchData])

  const metrics = data?.metrics
  const showBulkResolve = filters.resolved === "unresolved" && (data?.items.length ?? 0) > 1

  return (
    <div className="space-y-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Logs de errores</h1>
        <p className="text-sm text-muted-foreground">
          Errores capturados en backend (5xx, uncaught, unhandled rejection) y frontend (window.onerror, React Error Boundary,
          unhandled promise). Agrupados por fingerprint — la misma falla muchas veces es UNA fila con su contador.
        </p>
      </header>

      {/* KPI strip — skeletons while metrics is null */}
      {!metrics && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse rounded-2xl border border-border/60 p-4 shadow-[var(--superadmin-soft-shadow)]">
              <div className="h-3 w-24 rounded-md bg-muted/40" />
              <div className="mt-2 h-8 w-16 rounded-md bg-muted/40" />
            </div>
          ))}
        </div>
      )}

      {metrics && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <MetricCard label="Sin resolver" value={metrics.totalUnresolved} accent={metrics.totalUnresolved > 0 ? "warn" : "ok"} />
          <MetricCard
            label="Últimas 24h"
            value={metrics.totalLast24h}
            sub={metrics.deltaPct !== null ? `${metrics.deltaPct >= 0 ? "+" : ""}${metrics.deltaPct}% vs ayer` : "primer dia"}
            accent={metrics.deltaPct !== null && metrics.deltaPct > 30 ? "warn" : undefined}
          />
          <MetricCard label="Backend 24h" value={metrics.totalBackend24h} icon={<Server className="h-4 w-4" />} />
          <MetricCard label="Frontend 24h" value={metrics.totalFrontend24h} icon={<Globe className="h-4 w-4" />} />
        </div>
      )}

      {/* Filter bar */}
      <SuperAdminPanel className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[260px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              aria-label="Buscar en logs de error"
              placeholder="Buscar por mensaje o fingerprint…"
              value={filters.search}
              onChange={(e) => {
                setPage(1)
                setFilters((f) => ({ ...f, search: e.target.value }))
              }}
              className="h-10 w-full rounded-xl border border-border/60 bg-background pl-9 pr-3 text-sm outline-none focus:border-primary"
            />
          </div>

          <SelectFilter
            label="Source"
            value={filters.source}
            onChange={(v) => {
              setPage(1)
              setFilters((f) => ({ ...f, source: v as Filters["source"] }))
            }}
            options={[
              { value: "all", label: "Todos" },
              { value: "backend", label: "Backend" },
              { value: "frontend", label: "Frontend" },
            ]}
          />
          <SelectFilter
            label="Severity"
            value={filters.severity}
            onChange={(v) => {
              setPage(1)
              setFilters((f) => ({ ...f, severity: v as Filters["severity"] }))
            }}
            options={[
              { value: "all", label: "Todas" },
              { value: "fatal", label: "Fatal" },
              { value: "error", label: "Error" },
              { value: "warn", label: "Warn" },
            ]}
          />
          <SelectFilter
            label="Estado"
            value={filters.resolved}
            onChange={(v) => {
              setPage(1)
              setFilters((f) => ({ ...f, resolved: v as Filters["resolved"] }))
            }}
            options={[
              { value: "unresolved", label: "Sin resolver" },
              { value: "only", label: "Resueltos" },
              { value: "all", label: "Todos" },
            ]}
          />

          <div className="ml-auto flex items-center gap-2">
            {showBulkResolve && (
              <Button variant="outline" size="sm" onClick={() => setConfirmBulkResolve(true)} disabled={loading}>
                <CheckCircle2 className="h-4 w-4 mr-2" />
                Resolver visibles
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => void fetchData()} disabled={loading} title="Refrescar">
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
              Refrescar
            </Button>
            <Button variant="outline" size="sm" onClick={() => void exportCsv()} disabled={loading}>
              <Download className="h-4 w-4 mr-2" />
              Exportar CSV
            </Button>
          </div>
        </div>
      </SuperAdminPanel>

      {/* Table + detail panel */}
      <div className={`grid gap-6 ${selected ? "lg:grid-cols-[1fr_440px]" : ""}`}>
        <SuperAdminPanel className="space-y-3">
          {error && (
            <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2 text-sm border-destructive/30 bg-destructive/15 text-destructive">
              <span>{error}</span>
              <button
                type="button"
                onClick={() => void fetchData()}
                className="shrink-0 underline underline-offset-2 hover:no-underline"
              >
                Reintentar
              </button>
            </div>
          )}

          {/* Skeleton rows — initial load */}
          {loading && !data && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2.5 pr-3 font-medium">Source / Severity</th>
                    <th className="px-3 py-2.5 font-medium">Mensaje</th>
                    <th className="px-3 py-2.5 font-medium text-right"># veces</th>
                    <th className="hidden px-3 py-2.5 font-medium md:table-cell">Ultimo</th>
                    <th className="px-3 py-2.5 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <tr key={i} className="animate-pulse border-b border-border/40 last:border-b-0">
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-1.5">
                          <div className="h-4 w-10 rounded-md bg-muted/40" />
                          <div className="h-4 w-12 rounded-md bg-muted/40" />
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="h-3 w-64 rounded-md bg-muted/40" />
                        <div className="mt-1.5 h-2.5 w-32 rounded-md bg-muted/40" />
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="ml-auto h-3 w-8 rounded-md bg-muted/40" />
                      </td>
                      <td className="hidden px-3 py-3 md:table-cell">
                        <div className="h-3 w-16 rounded-md bg-muted/40" />
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex items-center justify-end gap-1">
                          <div className="h-7 w-7 rounded-md bg-muted/40" />
                          <div className="h-7 w-7 rounded-md bg-muted/40" />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Empty state */}
          {data && data.items.length === 0 && (
            <div className="rounded-xl border border-dashed border-border/50 py-14 flex flex-col items-center">
              {filters.resolved === "unresolved" ? (
                <>
                  <CheckCircle2 className="h-10 w-10 mb-3 text-success" />
                  <p className="text-sm font-medium text-foreground">Sin errores activos</p>
                  <p className="text-xs text-muted-foreground mt-1">Todo en orden por ahora.</p>
                </>
              ) : (
                <>
                  <Search className="h-10 w-10 mb-3 text-muted-foreground" />
                  <p className="text-sm font-medium text-foreground">Sin resultados</p>
                  <p className="text-xs text-muted-foreground mt-1">Ajustá los filtros para ver más registros.</p>
                </>
              )}
            </div>
          )}

          {data && data.items.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b border-border/60 text-left text-xs uppercase tracking-wider text-muted-foreground">
                    <th className="py-2.5 pr-3 font-medium">Source / Severity</th>
                    <th className="px-3 py-2.5 font-medium">Mensaje</th>
                    <th className="px-3 py-2.5 font-medium text-right"># veces</th>
                    <th className="hidden px-3 py-2.5 font-medium md:table-cell">Ultimo</th>
                    <th className="px-3 py-2.5 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((row) => {
                    const isOpen = selected?.id === row.id
                    const state = actionState[row.id]
                    return (
                      <tr
                        key={row.id}
                        className={`cursor-pointer border-b border-border/40 last:border-b-0 transition-colors hover:bg-accent/10 ${
                          isOpen ? "bg-primary/5" : ""
                        } ${row.resolvedAt ? "opacity-60" : ""}`}
                        onClick={() => setSelected(isOpen ? null : row)}
                      >
                        <td className="py-3 pr-3">
                          <div className="flex items-center gap-1.5">
                            {isOpen ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
                            <SourceBadge source={row.source} />
                            <SeverityBadge severity={row.severity} />
                          </div>
                        </td>
                        <td className="px-3 py-3 max-w-[420px]">
                          <div className="truncate font-mono text-xs text-foreground">{row.message}</div>
                          <div className="truncate text-[11px] text-muted-foreground">{row.fingerprint.slice(0, 16)}…</div>
                        </td>
                        <td className="px-3 py-3 text-right font-mono tabular-nums">{formatInt(row.countTotal)}</td>
                        <td className="hidden px-3 py-3 text-xs text-muted-foreground md:table-cell">
                          <span title={formatDateTime(row.lastSeenAt)}>{relativeTime(row.lastSeenAt)}</span>
                          <span className="block font-mono text-[10px] tabular-nums text-muted-foreground/70">{formatDateTime(row.lastSeenAt)}</span>
                        </td>
                        <td className="px-3 py-3">
                          <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                            <button
                              type="button"
                              title={row.resolvedAt ? "Reabrir" : "Marcar resuelto"}
                              aria-label={row.resolvedAt ? "Reabrir error" : "Marcar error como resuelto"}
                              onClick={() => void resolve(row)}
                              disabled={state === "resolving"}
                              className="rounded-md p-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                            >
                              {state === "resolving" ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <CheckCircle2 className={`h-4 w-4 ${row.resolvedAt ? "text-success" : ""}`} />
                              )}
                            </button>
                            <button
                              type="button"
                              title="Eliminar"
                              aria-label="Eliminar error log"
                              onClick={() => setDeleteTarget(row)}
                              disabled={state === "deleting"}
                              className="rounded-md p-2.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                            >
                              {state === "deleting" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {data && data.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border/40 pt-3 text-xs text-muted-foreground">
              <span>
                Página {data.page} de {data.totalPages} · {data.total} totales
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="rounded-md border border-border/60 px-3 py-1 hover:bg-muted disabled:opacity-50"
                >
                  ←
                </button>
                <button
                  type="button"
                  disabled={page >= data.totalPages}
                  onClick={() => setPage((p) => p + 1)}
                  className="rounded-md border border-border/60 px-3 py-1 hover:bg-muted disabled:opacity-50"
                >
                  →
                </button>
              </div>
            </div>
          )}
        </SuperAdminPanel>

        {selected && <DetailPanel error={selected} onClose={() => setSelected(null)} onResolve={() => void resolve(selected)} onDelete={() => setDeleteTarget(selected)} />}
      </div>

      <Dialog open={confirmBulkResolve} onOpenChange={(open) => { if (!open) setConfirmBulkResolve(false) }}>
        <DialogContent data-superadmin-theme={effectiveTheme} className="super-admin-theme-scope max-w-md">
          <DialogHeader>
            <DialogTitle>Resolver errores en lote</DialogTitle>
            <DialogDescription>
              Vas a marcar{" "}
              <strong>{data?.items.length ?? 0}</strong>{" "}
              {(data?.items.length ?? 0) === 1 ? "error" : "errores"} como resueltos. Esta acción es reversible.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setConfirmBulkResolve(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => {
                setConfirmBulkResolve(false)
                void bulkResolve()
              }}
            >
              Confirmar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent data-superadmin-theme={effectiveTheme} className="super-admin-theme-scope max-w-md">
          <DialogHeader>
            <DialogTitle>Eliminar error log</DialogTitle>
            <DialogDescription>
              Esta acción no se puede deshacer. El siguiente registro será eliminado permanentemente:
              <span className="mt-2 block truncate rounded-md bg-muted px-2 py-1 font-mono text-xs text-foreground">
                {deleteTarget?.message.slice(0, 80)}{(deleteTarget?.message.length ?? 0) > 80 ? "…" : ""}
              </span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => void confirmRemove()}>
              Eliminar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function MetricCard({ label, value, sub, accent, icon }: { label: string; value: number; sub?: string; accent?: "ok" | "warn"; icon?: React.ReactNode }) {
  const tone = accent === "warn" ? "warning" : accent === "ok" ? "success" : "neutral"
  return (
    <SAKpiCard tone={tone}>
      <div className={cn(saKpiLabelCn, "flex items-center gap-2")}>
        {icon}
        {label}
      </div>
      <div className={saKpiValueCn}>{formatInt(value)}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </SAKpiCard>
  )
}

function SelectFilter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }> }) {
  return (
    <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
      <span className="hidden sm:inline">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-10 rounded-xl border border-border/60 bg-background px-3 text-sm text-foreground outline-none focus:border-primary"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function SourceBadge({ source }: { source: Source }) {
  if (source === "backend") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
        <Server className="h-3 w-3" />
        Back
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-foreground">
      <Globe className="h-3 w-3" />
      Front
    </span>
  )
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const map: Record<Severity, string> = {
    fatal: "border border-destructive/30 bg-destructive/15 text-destructive",
    error: "border border-warning/30 bg-warning/15 text-warning",
    warn: "border border-border bg-secondary text-foreground",
  }
  const icon: Record<Severity, React.ReactNode> = {
    fatal: <AlertTriangle className="h-3 w-3" />,
    error: <AlertCircle className="h-3 w-3" />,
    warn: <AlertCircle className="h-3 w-3" />,
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-md ${map[severity]} px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider`}>
      {icon[severity]}
      {severity}
    </span>
  )
}

function DetailPanel({ error, onClose, onResolve, onDelete }: { error: ErrorRow; onClose: () => void; onResolve: () => void; onDelete: () => void }) {
  return (
    <SuperAdminPanel className="space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
            <SourceBadge source={error.source} />
            <SeverityBadge severity={error.severity} />
            {error.resolvedAt && (
              <span className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-success">
                Resuelto
              </span>
            )}
          </div>
          <h3 className="mt-2 break-words font-mono text-sm text-foreground">{error.message}</h3>
        </div>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border/60 bg-muted/30 p-3 text-xs">
        <DetailField label="Fingerprint" value={<code className="font-mono">{error.fingerprint.slice(0, 24)}…</code>} />
        <DetailField label="Ocurrencias" value={formatInt(error.countTotal)} />
        <DetailField
          label="Primer vista"
          value={
            <span>
              {relativeTime(error.firstSeenAt)}
              <span className="block font-mono text-[10px] tabular-nums text-muted-foreground/70">{formatDateTime(error.firstSeenAt)}</span>
            </span>
          }
        />
        <DetailField
          label="Ultima vista"
          value={
            <span>
              {relativeTime(error.lastSeenAt)}
              <span className="block font-mono text-[10px] tabular-nums text-muted-foreground/70">{formatDateTime(error.lastSeenAt)}</span>
            </span>
          }
        />
        <DetailField label="IP" value={error.ipAddress ?? "—"} />
        <DetailField label="User-Agent" value={<span className="truncate">{error.userAgent ?? "—"}</span>} className="col-span-2" />
      </dl>

      {error.context && Object.keys(error.context).length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground">Contexto</h4>
          <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-muted/40 p-3 text-[11px] leading-relaxed font-mono">
            {JSON.stringify(error.context, null, 2)}
          </pre>
        </div>
      )}

      {error.stack && (
        <div className="space-y-1.5">
          <h4 className="text-xs uppercase tracking-wider text-muted-foreground">Stack trace</h4>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/60 bg-muted/40 p-3 text-[11px] leading-relaxed font-mono">
            {error.stack}
          </pre>
        </div>
      )}

      <div className="flex items-center gap-2 border-t border-border/40 pt-3">
        <Button size="sm" onClick={onResolve}>
          <CheckCircle2 className="h-4 w-4 mr-2" />
          {error.resolvedAt ? "Reabrir" : "Marcar resuelto"}
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete}>
          <Trash2 className="h-4 w-4 mr-2" />
          Eliminar
        </Button>
      </div>
    </SuperAdminPanel>
  )
}

function DetailField({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <dt className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-xs text-foreground">{value}</dd>
    </div>
  )
}
