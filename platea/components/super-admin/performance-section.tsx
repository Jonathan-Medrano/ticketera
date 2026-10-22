"use client"

import { Fragment, useCallback, useEffect, useState } from "react"
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Database,
  Gauge,
  HardDrive,
  Info,
  Loader2,
  Play,
  RefreshCcw,
  Server,
  XCircle,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { SuperAdminPanel } from "@/components/super-admin/section-shell"
import { SAKpiCard, saKpiLabelCn, saKpiValueCn, type SAKpiTone } from "@/components/super-admin/kpi-card"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { formatInt, formatDateTime } from "@/lib/format"

type SnapshotData = {
  generatedAt: string
  system: {
    uptimeSeconds: number
    nodeVersion: string
    platform: string
    memory: {
      rssBytes: number
      heapUsedBytes: number
      heapTotalBytes: number
      externalBytes: number
    }
    cpu: { loadAvg1m: number; loadAvg5m: number; loadAvg15m: number; cores: number }
    eventLoop: { meanLagMs: number | null; maxLagMs: number | null; p99LagMs: number | null }
  }
  database: {
    poolStats: { active: number; idle: number; queued: number; limit: number } | null
    totalSizeBytes: number
    tables: Array<{
      name: string
      rowCount: number
      dataSizeBytes: number
      indexSizeBytes: number
      totalSizeBytes: number
    }>
    hotTableCounts: Record<string, number>
  }
  predictions: Array<{
    severity: "info" | "warning" | "critical"
    category: string
    title: string
    description: string
    recommendation: string
    metric?: string | number
  }>
}

type TestSuiteData = {
  startedAt: string
  finishedAt: string
  totalDurationMs: number
  results: Array<{
    name: string
    category: "database" | "storage" | "connectivity"
    durationMs: number
    status: "ok" | "slow" | "failed"
    detail?: string
    threshold: { warning: number; critical: number }
  }>
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—"
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${Math.floor(seconds)}s`
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`
}

const SEVERITY_STYLES: Record<
  string,
  { icon: typeof AlertTriangle; bg: string; border: string; text: string; badge: string }
> = {
  critical: {
    icon: AlertCircle,
    bg: "bg-destructive/8",
    border: "border-destructive/30",
    text: "text-destructive",
    badge: "bg-destructive/15 text-destructive",
  },
  warning: {
    icon: AlertTriangle,
    bg: "bg-warning/8",
    border: "border-warning/30",
    text: "text-warning",
    badge: "bg-warning/15 text-warning",
  },
  info: {
    icon: Info,
    bg: "bg-primary/8",
    border: "border-primary/30",
    text: "text-primary",
    badge: "bg-primary/15 text-primary",
  },
}

const SEVERITY_ORDER: Record<string, number> = { critical: 0, warning: 1, info: 2 }

function perfValueClass(tone: SAKpiTone): string {
  switch (tone) {
    case "success": return "text-success"
    case "warning": return "text-warning"
    case "danger":  return "text-destructive"
    default:        return "text-foreground"
  }
}

const AUTO_REFRESH_OPTIONS = [
  { label: "Manual", value: "" },
  { label: "30s", value: "30" },
  { label: "1m", value: "60" },
  { label: "5m", value: "300" },
]

export default function PerformanceSection() {
  const [snapshot, setSnapshot] = useState<SnapshotData | null>(null)
  const [snapshotLoading, setSnapshotLoading] = useState(false)
  const [snapshotError, setSnapshotError] = useState<string | null>(null)
  const [tests, setTests] = useState<TestSuiteData | null>(null)
  const [testsRunning, setTestsRunning] = useState(false)
  const [autoRefreshSecs, setAutoRefreshSecs] = useState<number | null>(null)

  const loadSnapshot = useCallback(async () => {
    setSnapshotLoading(true)
    setSnapshotError(null)
    try {
      const res = await fetch("/api/platform/perf/snapshot")
      const data = (await res.json()) as { data?: SnapshotData; error?: string }
      if (!res.ok || !data.data) {
        setSnapshotError(data.error ?? "No se pudo cargar el snapshot")
        return
      }
      setSnapshot(data.data)
    } catch {
      setSnapshotError("Error de red — no se pudo contactar al backend")
    } finally {
      setSnapshotLoading(false)
    }
  }, [])

  async function runTests() {
    if (testsRunning) return
    setTestsRunning(true)
    setTests(null)
    try {
      const res = await fetch("/api/platform/perf/run-tests", { method: "POST" })
      const data = (await res.json()) as { data?: TestSuiteData; error?: string }
      if (!res.ok || !data.data) {
        const msg = data.error ?? "No se pudieron correr los tests"
        toast.error(msg, { action: { label: "Reintentar", onClick: () => void runTests() } })
        return
      }
      setTests(data.data)
      const failed = data.data.results.filter((r) => r.status === "failed").length
      const slow = data.data.results.filter((r) => r.status === "slow").length
      if (failed > 0) {
        toast.error(`${failed} test(s) fallaron`)
      } else if (slow > 0) {
        toast.warning(`${slow} test(s) por encima del threshold crítico`)
      } else {
        toast.success("Todos los tests pasaron")
      }
    } catch {
      toast.error("Error de red al correr tests", {
        action: { label: "Reintentar", onClick: () => void runTests() },
      })
    } finally {
      setTestsRunning(false)
    }
  }

  useEffect(() => {
    void loadSnapshot()
  }, [loadSnapshot])

  useEffect(() => {
    if (!autoRefreshSecs) return
    const id = setInterval(() => void loadSnapshot(), autoRefreshSecs * 1000)
    return () => clearInterval(id)
  }, [autoRefreshSecs, loadSnapshot])

  const heapUsagePercent = snapshot
    ? (snapshot.system.memory.heapUsedBytes / snapshot.system.memory.heapTotalBytes) * 100
    : 0

  const poolStats = snapshot?.database.poolStats ?? null
  const poolUsagePercent =
    poolStats && poolStats.limit > 0 ? (poolStats.active / poolStats.limit) * 100 : 0

  const p99LagMs = snapshot?.system.eventLoop.p99LagMs ?? null

  const heapTone: SAKpiTone =
    heapUsagePercent > 90 ? "danger" : heapUsagePercent > 70 ? "warning" : "success"
  const poolTone: SAKpiTone =
    !poolStats ? "neutral" : poolUsagePercent > 90 ? "danger" : poolUsagePercent > 70 ? "warning" : "success"
  const p99Tone: SAKpiTone =
    p99LagMs === null ? "neutral" : p99LagMs > 100 ? "danger" : p99LagMs > 30 ? "warning" : "success"

  const sortedPredictions = snapshot
    ? [...snapshot.predictions].sort(
        (a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99),
      )
    : []

  return (
    <div className="space-y-6">
      {/* 1. Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Rendimiento</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Snapshot del sistema + alertas predictivas + tests sintéticos.
            {snapshot ? (
              <span className="ml-2 inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground/70">
                <Clock className="h-3 w-3" />
                {formatDateTime(snapshot.generatedAt)}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Intervalo de refresco automático"
            value={autoRefreshSecs ?? ""}
            onChange={(e) => setAutoRefreshSecs(parseInt(e.target.value) || null)}
            className="rounded-lg border border-border/60 bg-card px-2 py-1.5 text-xs text-muted-foreground"
          >
            {AUTO_REFRESH_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => void loadSnapshot()}
            disabled={snapshotLoading}
          >
            <RefreshCcw className={cn("h-4 w-4", snapshotLoading && "animate-spin")} />
            {autoRefreshSecs !== null ? (
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                {snapshotLoading ? "Actualizando..." : "Refrescar"}
              </span>
            ) : snapshotLoading ? (
              "Actualizando..."
            ) : (
              "Refrescar"
            )}
          </Button>
        </div>
      </div>

      {/* 2. KPI strip */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SAKpiCard tone="neutral">
          <div className="flex items-center justify-between gap-2">
            <p className={saKpiLabelCn}>Uptime</p>
            <Server className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className={saKpiValueCn}>{snapshot ? formatUptime(snapshot.system.uptimeSeconds) : "—"}</p>
        </SAKpiCard>
        <SAKpiCard tone={snapshot ? heapTone : "neutral"}>
          <p className={saKpiLabelCn}>Heap usado</p>
          <p className={cn(saKpiValueCn, perfValueClass(snapshot ? heapTone : "neutral"))}>
            {snapshot ? `${Math.round(heapUsagePercent)}%` : "—"}
          </p>
          {snapshot ? (
            <p className="mt-1 text-xs text-muted-foreground">
              {formatBytes(snapshot.system.memory.heapUsedBytes)} / {formatBytes(snapshot.system.memory.heapTotalBytes)}
            </p>
          ) : null}
        </SAKpiCard>
        <SAKpiCard tone={snapshot ? poolTone : "neutral"}>
          <p className={saKpiLabelCn}>Pool activo</p>
          <p className={cn(saKpiValueCn, perfValueClass(snapshot ? poolTone : "neutral"))}>
            {poolStats ? `${poolStats.active} / ${poolStats.limit}` : "N/A"}
          </p>
          {poolStats ? (
            <p className="mt-1 text-xs text-muted-foreground">{Math.round(poolUsagePercent)}% en uso</p>
          ) : null}
        </SAKpiCard>
        <SAKpiCard tone={snapshot ? p99Tone : "neutral"}>
          <p className={saKpiLabelCn}>Event loop p99</p>
          <p className={cn(saKpiValueCn, perfValueClass(snapshot ? p99Tone : "neutral"))}>
            {p99LagMs !== null ? `${p99LagMs.toFixed(0)} ms` : "—"}
          </p>
        </SAKpiCard>
        <SAKpiCard tone="neutral">
          <div className="flex items-center justify-between gap-2">
            <p className={saKpiLabelCn}>DB total</p>
            <Database className="h-4 w-4 text-muted-foreground" />
          </div>
          <p className={saKpiValueCn}>{snapshot ? formatBytes(snapshot.database.totalSizeBytes) : "—"}</p>
        </SAKpiCard>
      </div>

      {/* 3. Error banner */}
      {snapshotError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive">
          {snapshotError}
        </div>
      ) : null}

      {/* 4. Panel B: Alertas predictivas (promoted) */}
      <SuperAdminPanel>
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-2xl bg-muted/50 p-2.5">
            <Gauge className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Alertas predictivas</p>
            <p className="text-xs text-muted-foreground">
              Heurísticas sobre datos actuales — flags accionables antes de que rompa
            </p>
          </div>
        </div>

        {!snapshot ? (
          <div className="rounded-2xl border border-dashed border-border/60 bg-muted/20 px-4 py-8 text-center text-xs text-muted-foreground">
            {snapshotLoading ? "Cargando alertas..." : "Refrescá para ver las alertas predictivas."}
          </div>
        ) : sortedPredictions.length === 0 ? (
          <div className="rounded-2xl border border-success/30 bg-success/8 px-4 py-6 text-center text-sm text-success">
            <CheckCircle2 className="mr-2 inline h-4 w-4" />
            Sin alertas. Todo en verde por ahora.
          </div>
        ) : (
          <div className="space-y-2">
            {sortedPredictions.map((alert, idx) => {
              const style = SEVERITY_STYLES[alert.severity] ?? SEVERITY_STYLES.info
              const Icon = style.icon
              return (
                <div
                  key={`${alert.category}-${idx}`}
                  className={cn("rounded-2xl border px-4 py-3", style.bg, style.border)}
                >
                  <div className="flex items-start gap-3">
                    <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", style.text)} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className={cn("text-sm font-semibold", style.text)}>{alert.title}</p>
                        <Badge className={cn("text-[10px] uppercase tracking-wider", style.badge)}>
                          {alert.severity}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {alert.category}
                        </Badge>
                      </div>
                      <p className={cn("mt-1 text-xs opacity-90", style.text)}>{alert.description}</p>
                      <p className={cn("mt-1.5 text-xs italic opacity-75", style.text)}>
                        → {alert.recommendation}
                      </p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </SuperAdminPanel>

      {/* 5. Panel A part 1: Sistema */}
      <SuperAdminPanel>
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-2xl bg-muted/50 p-2.5">
            <Activity className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Sistema</p>
            <p className="text-xs text-muted-foreground">Métricas live del proceso Node</p>
          </div>
        </div>

        {!snapshot ? (
          snapshotLoading ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted/40" />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/60 bg-muted/20 py-16 text-center">
              <Activity className="mb-2 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">Sin datos de rendimiento</p>
              <p className="text-xs text-muted-foreground">
                Hacé clic en Refrescar para cargar el snapshot del sistema.
              </p>
            </div>
          )
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <MetricCard label="Uptime" value={formatUptime(snapshot.system.uptimeSeconds)} />
            <MetricCard
              label="Memoria heap"
              value={`${formatBytes(snapshot.system.memory.heapUsedBytes)} / ${formatBytes(snapshot.system.memory.heapTotalBytes)}`}
              tone={heapUsagePercent > 90 ? "critical" : heapUsagePercent > 70 ? "warning" : "ok"}
            />
            <MetricCard label="RSS" value={formatBytes(snapshot.system.memory.rssBytes)} />
            <MetricCard
              label="CPU load 1m"
              value={snapshot.system.cpu.loadAvg1m.toFixed(2)}
              detail={`${snapshot.system.cpu.cores} cores`}
              tone={
                snapshot.system.cpu.loadAvg1m > snapshot.system.cpu.cores * 0.9
                  ? "critical"
                  : snapshot.system.cpu.loadAvg1m > snapshot.system.cpu.cores * 0.7
                    ? "warning"
                    : "ok"
              }
            />
            <MetricCard
              label="CPU load 5m"
              value={snapshot.system.cpu.loadAvg5m.toFixed(2)}
              detail={`${snapshot.system.cpu.cores} cores`}
            />
            <MetricCard
              label="CPU load 15m"
              value={snapshot.system.cpu.loadAvg15m.toFixed(2)}
              detail={`${snapshot.system.cpu.cores} cores`}
            />
            <MetricCard
              label="Event loop (mean)"
              value={
                snapshot.system.eventLoop.meanLagMs !== null
                  ? `${snapshot.system.eventLoop.meanLagMs.toFixed(1)} ms`
                  : "—"
              }
              tone={
                snapshot.system.eventLoop.meanLagMs !== null &&
                snapshot.system.eventLoop.meanLagMs > 100
                  ? "critical"
                  : snapshot.system.eventLoop.meanLagMs !== null &&
                      snapshot.system.eventLoop.meanLagMs > 30
                    ? "warning"
                    : "ok"
              }
            />
            <MetricCard
              label="Event loop p99"
              value={p99LagMs !== null ? `${p99LagMs.toFixed(0)} ms` : "—"}
              tone={p99LagMs !== null && p99LagMs > 100 ? "critical" : p99LagMs !== null && p99LagMs > 30 ? "warning" : "ok"}
            />
            <MetricCard label="Node" value={snapshot.system.nodeVersion} />
            <MetricCard label="Platform" value={snapshot.system.platform} />
          </div>
        )}
      </SuperAdminPanel>

      {/* 6. Panel A part 2: Base de datos */}
      <SuperAdminPanel>
        <div className="mb-4 flex items-center gap-3">
          <div className="rounded-2xl bg-muted/50 p-2.5">
            <Database className="h-5 w-5 text-muted-foreground" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Base de datos</p>
            <p className="text-xs text-muted-foreground">Pool de conexiones, tablas y hot rows</p>
          </div>
        </div>

        {!snapshot ? (
          snapshotLoading ? (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-2xl bg-muted/40" />
              ))}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/60 bg-muted/20 py-16 text-center">
              <Database className="mb-2 h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm font-medium text-muted-foreground">Sin datos de base de datos</p>
              <p className="text-xs text-muted-foreground">
                Hacé clic en Refrescar para cargar el snapshot.
              </p>
            </div>
          )
        ) : (
          <div className="space-y-5">
            {/* Pool mini-grid */}
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                <Server className="h-3.5 w-3.5" /> Pool de conexiones
              </h3>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {snapshot.database.poolStats ? (
                  <>
                    <MetricCard
                      label="En uso"
                      value={`${snapshot.database.poolStats.active} / ${snapshot.database.poolStats.limit}`}
                      tone={poolUsagePercent > 90 ? "critical" : poolUsagePercent > 70 ? "warning" : "ok"}
                    />
                    <MetricCard
                      label="Idle"
                      value={String(snapshot.database.poolStats.idle)}
                    />
                    <MetricCard
                      label="Queued"
                      value={String(snapshot.database.poolStats.queued)}
                      tone={snapshot.database.poolStats.queued > 5 ? "critical" : "ok"}
                    />
                  </>
                ) : (
                  <MetricCard
                    label="Pool"
                    value="No accesible"
                    detail="Pool stats no disponibles (Prisma/PgBouncer)"
                  />
                )}
                <MetricCard label="DB total" value={formatBytes(snapshot.database.totalSizeBytes)} />
              </div>
            </div>

            {/* Tables table */}
            <div>
              <h3 className="mb-2 flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                <Database className="h-3.5 w-3.5" /> Tablas
              </h3>
              <div className="overflow-x-auto rounded-2xl border border-border/50">
                <table className="min-w-full divide-y divide-border/40 text-xs">
                  <thead className="bg-muted/40">
                    <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 font-medium">Tabla</th>
                      <th className="px-3 py-2 font-medium text-right">Filas est.</th>
                      <th className="px-3 py-2 font-medium text-right">Data</th>
                      <th className="px-3 py-2 font-medium text-right">Índices</th>
                      <th className="px-3 py-2 font-medium text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {snapshot.database.tables.map((t) => {
                      const hotCount = snapshot.database.hotTableCounts[t.name]
                      return (
                        <tr key={t.name} className="hover:bg-accent/10">
                          <td className="px-3 py-1.5 font-mono text-[11px] text-foreground/90">
                            <span className="inline-flex items-center gap-1.5">
                              {t.name}
                              {hotCount != null && hotCount > 0 ? (
                                <Badge variant="outline" className="text-[10px] font-normal">
                                  <span className="font-mono">{formatInt(hotCount)}</span>&nbsp;hot
                                </Badge>
                              ) : null}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                            {formatInt(t.rowCount)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                            {formatBytes(t.dataSizeBytes)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-muted-foreground">
                            {formatBytes(t.indexSizeBytes)}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums font-semibold text-foreground">
                            {formatBytes(t.totalSizeBytes)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </SuperAdminPanel>

      {/* 7. Panel C: Tests sintéticos */}
      <SuperAdminPanel>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-muted/50 p-2.5">
              <HardDrive className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-foreground">Tests sintéticos</p>
              <p className="max-w-xl text-xs text-muted-foreground">
                Suite sintética de queries críticas + ping a Supabase. Cada test tiene threshold de
                warning y critical.
              </p>
            </div>
          </div>
          <Button
            type="button"
            className="gap-2"
            onClick={() => void runTests()}
            disabled={testsRunning}
          >
            {testsRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            {testsRunning ? "Ejecutando..." : "Ejecutar tests"}
          </Button>
        </div>

        {!tests ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border/60 bg-muted/20 py-12 text-center">
            {testsRunning ? (
              <>
                <Loader2 className="mb-2 h-6 w-6 animate-spin text-muted-foreground/40" />
                <p className="text-sm font-medium text-muted-foreground">Corriendo la suite...</p>
              </>
            ) : (
              <>
                <HardDrive className="mb-2 h-6 w-6 text-muted-foreground/40" />
                <p className="text-sm font-medium text-muted-foreground">Suite no ejecutada</p>
                <p className="text-xs text-muted-foreground">
                  Ejecutá la suite para ver latencia de queries críticas y conectividad. Toma menos de 5
                  segundos.
                </p>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>
                Duración total:{" "}
                <span className="font-mono font-semibold text-foreground">{tests.totalDurationMs} ms</span>
              </span>
              <span>· {tests.results.length} tests</span>
              <span>· {tests.results.filter((r) => r.status === "ok").length} OK</span>
              {tests.results.filter((r) => r.status === "slow").length > 0 ? (
                <span className="text-warning">
                  · {tests.results.filter((r) => r.status === "slow").length} lentos
                </span>
              ) : null}
              {tests.results.filter((r) => r.status === "failed").length > 0 ? (
                <span className="text-destructive">
                  · {tests.results.filter((r) => r.status === "failed").length} fallaron
                </span>
              ) : null}
            </div>

            <div className="overflow-x-auto rounded-2xl border border-border/50">
              <table className="min-w-full divide-y divide-border/40 text-xs">
                <thead className="bg-muted/40">
                  <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Test</th>
                    <th className="px-3 py-2 font-medium">Categoría</th>
                    <th className="px-3 py-2 font-medium text-right">Duración</th>
                    <th className="px-3 py-2 font-medium text-right">Threshold W/C</th>
                    <th className="px-3 py-2 font-medium">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/30">
                  {tests.results.map((r) => (
                    <Fragment key={r.name}>
                      <tr className="hover:bg-accent/10">
                        <td className="px-3 py-1.5 font-mono text-[11px] text-foreground/90">{r.name}</td>
                        <td className="px-3 py-1.5">
                          <Badge variant="outline" className="text-[10px] font-normal">
                            {r.category}
                          </Badge>
                        </td>
                        <td
                          className={cn(
                            "px-3 py-1.5 text-right font-mono font-semibold tabular-nums",
                            r.durationMs >= r.threshold.critical
                              ? "text-destructive"
                              : r.durationMs >= r.threshold.warning
                                ? "text-warning"
                                : "text-success",
                          )}
                        >
                          {r.durationMs} ms
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-[11px] text-muted-foreground">
                          {r.threshold.warning}/{r.threshold.critical}
                        </td>
                        <td className="px-3 py-1.5">
                          {r.status === "ok" ? (
                            <span className="inline-flex items-center gap-1 text-success">
                              <CheckCircle2 className="h-3 w-3" /> OK
                            </span>
                          ) : r.status === "slow" ? (
                            <span className="inline-flex items-center gap-1 text-warning">
                              <AlertTriangle className="h-3 w-3" /> Lento
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-destructive">
                              <XCircle className="h-3 w-3" /> Falló
                            </span>
                          )}
                        </td>
                      </tr>
                      {r.status === "failed" && r.detail ? (
                        <tr className="bg-destructive/8">
                          <td
                            colSpan={5}
                            className="px-3 py-1.5 text-[11px] text-destructive"
                          >
                            <span className="font-semibold">Detalle:</span>{" "}
                            <span className="font-mono">{r.detail}</span>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </SuperAdminPanel>
    </div>
  )
}

// ----- Sub-components -----

function MetricCard({
  label,
  value,
  detail,
  tone,
}: {
  label: string
  value: string
  detail?: string
  tone?: "ok" | "warning" | "critical"
}) {
  const toneClass =
    tone === "critical"
      ? "border-destructive/30 bg-destructive/8"
      : tone === "warning"
        ? "border-warning/30 bg-warning/8"
        : "border-border/50 bg-muted/30"

  const valueColor =
    tone === "critical"
      ? "text-destructive"
      : tone === "warning"
        ? "text-warning"
        : "text-foreground"

  return (
    <div className={cn("rounded-2xl border px-3 py-2.5", toneClass)}>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 truncate font-mono text-sm font-semibold tabular-nums", valueColor)}>{value}</p>
      {detail ? <p className="text-[10px] text-muted-foreground">{detail}</p> : null}
    </div>
  )
}

