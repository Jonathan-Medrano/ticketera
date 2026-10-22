"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { BarChart2, ChevronDown, ChevronUp, Download, Loader2, RefreshCw, TrendingDown, TrendingUp } from "lucide-react"
import { Button } from "@/components/ui/button"
import { SuperAdminPanel } from "@/components/super-admin/section-shell"
import { SAKpiCard, saKpiLabelCn, saKpiValueCn } from "@/components/super-admin/kpi-card"
import { useLoading } from "@/components/loading-provider"
import { formatBucketShort, money } from "@/components/super-admin/utils"
import { formatDate } from "@/lib/format"
import { useAppTheme, useOptionalSuperAdminTheme } from "@/components/theme-provider"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

export type RevenueTimelinePoint = {
  bucket: string
  total: number
}

export type RevenueTimelineData = {
  period: { days: number; from: string; to: string }
  current: {
    series: RevenueTimelinePoint[]
    total: number
    average: number
    peak: RevenueTimelinePoint | null
  }
  previous: { total: number; from: string; to: string }
  growth: { absolute: number; percent: number | null }
}

const PERIODS = [
  { days: 7, label: "7 días" },
  { days: 30, label: "30 días" },
  { days: 90, label: "90 días" },
  { days: 365, label: "1 año" },
]

export default function RevenueAnalyticsSection({ initialData }: { initialData: RevenueTimelineData }) {
  const { withLoading } = useLoading()
  const { resolvedTheme } = useAppTheme()
  const superAdminTheme = useOptionalSuperAdminTheme()
  const [data, setData] = useState<RevenueTimelineData>(initialData)
  const [periodDays, setPeriodDays] = useState<number>(initialData.period.days)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [showBreakdown, setShowBreakdown] = useState(false)

  const fetchTimeline = useCallback(async (days: number) => {
    const res = await fetch(`/api/platform/analitica/revenue-timeline?days=${days}`)
    const body = await res.json()
    if (!res.ok) {
      toast.error(body?.error ?? "No se pudo cargar el análisis temporal")
      return
    }
    setData(body.data as RevenueTimelineData)
    setPeriodDays(days)
  }, [])

  useEffect(() => {
    setData(initialData)
    setPeriodDays(initialData.period.days)
  }, [initialData])

  const onChangePeriod = (days: number) => {
    if (days === periodDays) return
    void withLoading(() => fetchTimeline(days))
  }

  const onRefresh = async () => {
    setIsRefreshing(true)
    try {
      await fetchTimeline(periodDays)
    } finally {
      setIsRefreshing(false)
    }
  }

  const onExportCSV = () => {
    const rows = ["bucket,total", ...data.current.series.map((p) => `${p.bucket},${p.total}`)]
    const blob = new Blob([rows.join("\n")], { type: "text/csv" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `revenue-${data.period.from}-${data.period.to}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const chartData = useMemo(() => {
    return data.current.series.map((point) => ({
      bucket: point.bucket,
      bucketLabel: formatBucketShort(point.bucket, data.period.days),
      total: point.total,
    }))
  }, [data])

  const growthPercent = data.growth.percent
  const growthPositive = (growthPercent ?? 0) >= 0
  const hasGrowthData = growthPercent !== null
  const periodTotal = data.current.total
  const isEmpty = data.current.series.length === 0

  // isDark is used for recharts tooltip/grid — those attrs can't use CSS vars directly.
  // Uses the SA-specific theme when available so it tracks the sidebar toggle, not just the global theme.
  const isDark = (superAdminTheme?.theme ?? resolvedTheme) === "dark"
  const gridColor = isDark ? "rgba(148, 163, 184, 0.14)" : "rgba(148, 163, 184, 0.22)"
  const axisColor = isDark ? "#94a3b8" : "#64748b"

  return (
    <div className="space-y-6">
      {/* 1. Section header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <span className="inline-flex items-center rounded-md border border-primary/20 bg-primary/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">Platform Console</span>
          <h1 className="mt-3 text-[26px] font-semibold tracking-tight text-foreground">Analítica de ingresos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ganancia owner agregada por día. Comparativa con el período anterior del mismo largo.
          </p>
        </div>
        <div className="mt-1 flex items-center gap-2">
          <div className="flex gap-1 rounded-full border border-border/60 p-1">
            {PERIODS.map((p) => (
              <button
                key={p.days}
                onClick={() => onChangePeriod(p.days)}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  periodDays === p.days ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:text-foreground"
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => { void onRefresh() }}
            disabled={isRefreshing}
            className="h-8 w-8 shrink-0"
            aria-label="Refrescar datos"
          >
            {isRefreshing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>
      </header>

      {/* 2. KPI strip — standalone cards, no panel wrapper */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SAKpiCard tone="primary">
            <p className={saKpiLabelCn}>Total del período</p>
            <p className={cn(saKpiValueCn, "font-mono text-primary")}>{money(data.current.total)}</p>
          </SAKpiCard>
          <SAKpiCard tone={hasGrowthData ? (growthPositive ? "success" : "danger") : "neutral"}>
            <div className="flex items-center justify-between gap-2">
              <p className={saKpiLabelCn}>Vs período anterior</p>
              {hasGrowthData
                ? growthPositive
                  ? <TrendingUp className="h-4 w-4 text-success" />
                  : <TrendingDown className="h-4 w-4 text-destructive" />
                : undefined}
            </div>
            <p className={cn(saKpiValueCn, "font-mono", hasGrowthData ? (growthPositive ? "text-success" : "text-destructive") : "text-foreground")}>
              {hasGrowthData ? `${growthPositive ? "+" : ""}${growthPercent!.toFixed(1)}%` : "—"}
            </p>
            {hasGrowthData ? (
              <p className="mt-1 text-xs text-muted-foreground">{money(data.previous.total)} anterior</p>
            ) : (
              <p className="mt-1 text-xs text-warning/70">Sin período anterior para comparar</p>
            )}
          </SAKpiCard>
          <SAKpiCard tone="neutral">
            <p className={saKpiLabelCn}>Promedio diario</p>
            <p className={cn(saKpiValueCn, "font-mono")}>{money(data.current.average)}</p>
          </SAKpiCard>
          <SAKpiCard tone="neutral">
            <p className={saKpiLabelCn}>Día pico</p>
            <p className={cn(saKpiValueCn, "font-mono")}>{data.current.peak ? money(data.current.peak.total) : "—"}</p>
            {data.current.peak ? (
              <p className="mt-1 text-xs text-muted-foreground">{formatDate(data.current.peak.bucket)}</p>
            ) : null}
          </SAKpiCard>
        </div>

      {/* 3. Chart panel */}
      <SuperAdminPanel className="border-border/30">
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-foreground">Evolución diaria</p>
            <p className="text-xs text-muted-foreground">Ganancia owner por día — entradas + consumibles</p>
            <span className="mt-1.5 inline-flex items-center rounded-full border border-border/40 bg-muted/20 px-2 py-0.5 text-[10px] font-medium text-muted-foreground/70">
              Desglose entradas / consumibles: próximamente
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onExportCSV}
            disabled={isEmpty}
            className="shrink-0 gap-1.5 text-xs"
          >
            <Download className="h-3.5 w-3.5" />
            Exportar CSV
          </Button>
        </div>

        {isEmpty ? (
          /* Empty state: KPI cards still render above; chart area replaced with this block */
          <div className="flex h-[380px] flex-col items-center justify-center gap-3 text-center">
            <BarChart2 className="size-10 text-muted-foreground/40" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">Sin ingresos en este período</p>
              <p className="mt-1 text-xs text-muted-foreground/70">
                Probá seleccionar un período más amplio o esperá a que haya ventas registradas.
              </p>
            </div>
          </div>
        ) : (
          <div className="h-[380px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <defs>
                  {/*
                   * Chart fill uses var(--color-primary) — globals.css maps
                   * --color-primary: var(--primary) via @theme inline, so this
                   * resolves correctly in both light and dark themes.
                   */}
                  <linearGradient id="revenue-area" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--color-primary)" stopOpacity={0.45} />
                    <stop offset="100%" stopColor="var(--color-primary)" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 6" stroke={gridColor} />
                <XAxis
                  dataKey="bucketLabel"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: axisColor, fontSize: 11 }}
                  minTickGap={32}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: axisColor, fontSize: 11 }}
                  tickFormatter={(value: number) => money(value)}
                  width={80}
                />
                <Tooltip
                  contentStyle={{
                    background: isDark ? "rgba(15, 23, 42, 0.95)" : "rgba(255, 255, 255, 0.95)",
                    border: `1px solid ${gridColor}`,
                    borderRadius: 12,
                    fontSize: 12,
                    color: isDark ? "#f8fafc" : "#0f172a",
                  }}
                  labelFormatter={(label, payload) => {
                    const bucket = payload?.[0]?.payload?.bucket
                    return bucket ? formatDate(bucket) : String(label)
                  }}
                  formatter={(value) => [money(Number(value ?? 0)), "Ganancia"]}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="var(--color-primary)"
                  strokeWidth={2}
                  fill="url(#revenue-area)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Collapsible daily breakdown — hidden by default, for power users */}
        {!isEmpty && (
          <div className="mt-4 border-t border-border/30 pt-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowBreakdown((v) => !v)}
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              {showBreakdown ? (
                <ChevronUp className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
              {showBreakdown ? "Ocultar desglose diario" : "Ver desglose diario"}
            </Button>

            {showBreakdown && (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/30">
                      <th className="pb-2 text-left font-semibold text-muted-foreground">Fecha</th>
                      <th className="pb-2 text-right font-semibold text-muted-foreground">Ganancia del día</th>
                      <th className="pb-2 text-right font-semibold text-muted-foreground">% del período</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.current.series.map((point) => (
                      <tr key={point.bucket} className="border-b border-border/20 last:border-0">
                        <td className="py-2 text-left text-foreground">{formatDate(point.bucket)}</td>
                        <td className="py-2 text-right font-mono tabular-nums text-foreground">
                          {money(point.total)}
                        </td>
                        <td className="py-2 text-right font-mono tabular-nums text-muted-foreground">
                          {periodTotal > 0
                            ? `${((point.total / periodTotal) * 100).toFixed(1)}%`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </SuperAdminPanel>
    </div>
  )
}

