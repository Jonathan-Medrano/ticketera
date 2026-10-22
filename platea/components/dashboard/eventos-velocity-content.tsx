"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import Link from "next/link"
import {
  ArrowLeft,
  AlertTriangle,
  ChevronRight,
  TrendingUp,
  ChevronDown,
  Check,
  X,
} from "lucide-react"
import {
  LineChart,
  Line,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { formatMoney, formatInt } from "@/lib/format"
import type { Permisos } from "@/lib/permisos"

// ─── Types ───────────────────────────────────────────────────────────────────

type VelocitySeriesPoint = {
  days_before_event: number
  fecha_snapshot: string
  vendidas_acumuladas: number
  capacidad_total_snapshot: number
  ingresos_neto_acumulado: number
  ocupacion_pct: number
}

type VelocityEvent = {
  id: string
  nombre: string
  imagen_url: string | null
  modo_fecha: string
  anchor_date: string
  series: VelocitySeriesPoint[]
}

type VelocityData = {
  events: VelocityEvent[]
  excluded_ids: string[]
  no_anchor_ids: string[]
}

type EligibleEvent = {
  id: string
  nombre: string
  imagen_url: string | null
  modo_fecha: string
}

interface Props {
  eligibleEvents: EligibleEvent[]
  initialSelectedIds: string[]
  initialVelocityData: VelocityData | null
  permisos?: Permisos
  esEmpleado?: boolean
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EVENT_COLORS = [
  "#0052cc", // marketing-accent
  "#9333ea", // purple-600
  "#ea580c", // orange-600
  "#16a34a", // green-600
  "#dc2626", // red-600
  "#ca8a04", // yellow-600
  "#0d9488", // teal-600
  "#7c3aed", // violet-600
] as const

const MAX_SELECTED = 8

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmtPct = (n: number) => `${n.toFixed(1)}%`

/**
 * Pivot the events data into wide-format rows for recharts.
 * Each row: { days_before_event: N, [eventId]: ocupacion_pct, ... }
 * Sorted descending so the MOST-FUTURE days are first (recharts reads left→right,
 * but reversed XAxis ensures day 0 appears on the right).
 */
function pivotSeries(events: VelocityEvent[]): Record<string, number>[] {
  const allDays = new Set<number>()
  for (const ev of events) {
    for (const pt of ev.series) {
      allDays.add(pt.days_before_event)
    }
  }
  const sortedDays = [...allDays].sort((a, b) => b - a) // descending: 30 → 0

  return sortedDays.map((day) => {
    const row: Record<string, number> = { days_before_event: day }
    for (const ev of events) {
      const pt = ev.series.find((p) => p.days_before_event === day)
      if (pt !== undefined) {
        row[ev.id] = pt.ocupacion_pct
      }
    }
    return row
  })
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function VelocityTooltip({
  active,
  payload,
  label,
  events,
  coordinate,
  chartWidth,
}: {
  active?: boolean
  payload?: Array<{ dataKey: string; value: number; color: string; name: string }>
  label?: number
  events: VelocityEvent[]
  coordinate?: { x?: number; y?: number }
  chartWidth?: number
}) {
  if (!active || !payload || payload.length === 0) return null

  // Recharts clampea la posición contra su propio viewBox, pero en pantallas
  // angostas eso puede no alcanzar a evitar que el tooltip se corte contra el
  // borde derecho. Si el cursor está en el ~60% derecho del gráfico, lo
  // "flippeamos" para que se ancle a la izquierda del cursor en vez de la derecha.
  const overflowsRight = Boolean(
    coordinate?.x != null && chartWidth && chartWidth > 0 && coordinate.x > chartWidth * 0.6
  )

  return (
    <div
      className={cn(
        "min-w-[200px] space-y-2.5 rounded-2xl border border-border bg-popover/95 p-3.5 text-xs text-popover-foreground shadow-lg backdrop-blur-sm",
        overflowsRight && "-translate-x-full"
      )}
    >
      <p className="text-sm font-semibold text-foreground">
        {label === 0 ? "Día del evento" : `${label} días antes`}
      </p>
      {payload.map((entry) => {
        const ev = events.find((e) => e.id === entry.dataKey)
        if (!ev) return null
        const pt = ev.series.find((p) => p.days_before_event === label)
        return (
          <div key={entry.dataKey} className="space-y-1">
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 shrink-0 rounded-full"
                style={{ background: entry.color }}
              />
              <span className="max-w-[150px] truncate font-medium text-foreground">
                {ev.nombre}
              </span>
            </div>
            <div className="space-y-0.5 pl-3.5 text-muted-foreground">
              <p className="flex items-center justify-between gap-3">
                <span>Ocupación</span>
                <span className="font-mono font-medium tabular-nums text-foreground">
                  {fmtPct(entry.value)}
                </span>
              </p>
              {pt && (
                <>
                  <p className="flex items-center justify-between gap-3">
                    <span>Vendidas</span>
                    <span className="font-mono font-medium tabular-nums text-foreground">
                      {formatInt(pt.vendidas_acumuladas)} / {formatInt(pt.capacidad_total_snapshot)}
                    </span>
                  </p>
                  <p className="flex items-center justify-between gap-3">
                    <span>Ingresos</span>
                    <span className="font-mono font-medium tabular-nums text-foreground">
                      {formatMoney(pt.ingresos_neto_acumulado)}
                    </span>
                  </p>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Skeleton ────────────────────────────────────────────────────────────────

function ChartSkeleton() {
  return (
    <div className="h-[300px] w-full animate-pulse rounded-2xl bg-muted/40 md:h-[400px]" />
  )
}

// ─── Root export ──────────────────────────────────────────────────────────────

export default function EventosVelocityContent({
  eligibleEvents,
  initialSelectedIds,
  initialVelocityData,
  permisos,
  esEmpleado,
}: Props) {
  const [selectedIds, setSelectedIds] = useState<string[]>(initialSelectedIds)
  const [data, setData] = useState<VelocityData | null>(initialVelocityData)
  const [loading, setLoading] = useState(false)
  const [hiddenLines, setHiddenLines] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState("")
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [chartWidth, setChartWidth] = useState(0)
  const chartResizeObserverRef = useRef<ResizeObserver | null>(null)
  // El wrapper del gráfico solo se monta cuando hay datos (se alterna con
  // skeleton/estados vacíos), así que usamos un callback ref para
  // (re)conectar el ResizeObserver cada vez que el nodo aparece/desaparece.
  const chartWrapperRef = useCallback((el: HTMLDivElement | null) => {
    chartResizeObserverRef.current?.disconnect()
    chartResizeObserverRef.current = null
    if (!el || typeof ResizeObserver === "undefined") return
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width
      if (width) setChartWidth(width)
    })
    observer.observe(el)
    chartResizeObserverRef.current = observer
  }, [])

  // Track whether this is the first render to skip the initial fetch
  const isFirstRender = useRef(true)

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false
      return
    }
    if (selectedIds.length === 0) {
      // Limpia los datos cuando no hay selección, sincronizando con el fetch externo del efecto.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets fetched data to empty on selection change
      setData({ events: [], excluded_ids: [], no_anchor_ids: [] })
      return
    }
    setLoading(true)
    fetch(`/api/eventos/velocity?evento_ids=${selectedIds.join(",")}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((json: { data: VelocityData } | null) => {
        if (json) setData(json.data)
      })
      .finally(() => setLoading(false))
  }, [selectedIds])

  function toggleId(id: string) {
    setSelectedIds((prev) => {
      if (prev.includes(id)) {
        return prev.filter((x) => x !== id)
      }
      if (prev.length >= MAX_SELECTED) return prev
      return [...prev, id]
    })
  }

  function handleLegendClick(payload: { dataKey?: string | number | ((obj: unknown) => unknown) | undefined }) {
    const id = typeof payload.dataKey === "string" ? payload.dataKey : null
    if (!id) return
    setHiddenLines((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // Filtered eligible events for the selector search input
  const filteredEligible = eligibleEvents.filter((e) =>
    e.nombre.toLowerCase().includes(search.toLowerCase())
  )

  const chartData = data ? pivotSeries(data.events) : []
  const hasNoData =
    data !== null &&
    data.events.length > 0 &&
    data.events.every((e) => e.series.length === 0)

  // ── Edge states ──────────────────────────────────────────────────────────

  if (eligibleEvents.length === 0) {
    return (
      <div className="space-y-5 md:space-y-6">
        <Header />
        <div className="rounded-panel border border-border bg-card px-6 py-14 text-center shadow-sm">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <TrendingUp className="h-6 w-6" />
          </div>
          <h3 className="mt-4 text-lg font-semibold text-foreground">
            Sin eventos elegibles
          </h3>
          <p className="mt-2 text-sm text-muted-foreground max-w-md mx-auto">
            Necesitás al menos un evento con modo única o múltiple para ver la
            curva de velocidad de ventas.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-5 md:space-y-6">
      {/* Header */}
      <Header />

      {/* No-anchor warning banner */}
      {(data?.no_anchor_ids.length ?? 0) > 0 && (
        <div className="flex items-start gap-3 rounded-panel border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {data!.no_anchor_ids.length} evento
            {data!.no_anchor_ids.length !== 1 ? "s" : ""} sin fecha de
            referencia. Agregales una fecha para ver{" "}
            {data!.no_anchor_ids.length === 1 ? "su curva" : "sus curvas"}.
          </span>
        </div>
      )}

      {/* Excluded ids notice */}
      {(data?.excluded_ids.length ?? 0) > 0 && (
        <div className="flex items-start gap-3 rounded-panel border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            {data!.excluded_ids.length} evento
            {data!.excluded_ids.length !== 1 ? "s" : ""} no{" "}
            {data!.excluded_ids.length === 1 ? "está disponible" : "están disponibles"}{" "}
            para tu empresa y{" "}
            {data!.excluded_ids.length === 1 ? "fue omitido" : "fueron omitidos"}.
          </span>
        </div>
      )}

      {/* Selector */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
        <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              className="h-10 gap-2"
              aria-label="Seleccionar eventos"
            >
              <span>Eventos seleccionados</span>
              <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 font-mono text-xs font-medium tabular-nums text-primary">
                {selectedIds.length}/{MAX_SELECTED}
              </span>
              <ChevronDown className="h-4 w-4 opacity-60" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 rounded-2xl p-3 shadow-lg">
            <p className="mb-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Seleccioná hasta {MAX_SELECTED} eventos
            </p>
            {/* Search input */}
            <input
              type="text"
              placeholder="Buscar evento..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="mb-2.5 h-9 w-full rounded-card border border-input bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:ring-2 focus:ring-ring focus:ring-offset-1"
            />
            {/* Event list */}
            <div className="max-h-60 space-y-0.5 overflow-y-auto">
              {filteredEligible.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  Sin resultados.
                </p>
              ) : (
                filteredEligible.map((ev) => {
                  const checked = selectedIds.includes(ev.id)
                  const disabled = !checked && selectedIds.length >= MAX_SELECTED
                  return (
                    <label
                      key={ev.id}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-card px-2 py-2 text-sm transition-colors",
                        disabled
                          ? "cursor-not-allowed opacity-50"
                          : "hover:bg-muted/60",
                        checked && !disabled && "bg-primary/5"
                      )}
                    >
                      <Checkbox
                        checked={checked}
                        disabled={disabled}
                        onCheckedChange={() => toggleId(ev.id)}
                        aria-label={`Seleccionar ${ev.nombre}`}
                      />
                      <span className="truncate text-foreground">{ev.nombre}</span>
                      {checked && (
                        <Check className="ml-auto h-3.5 w-3.5 shrink-0 text-primary" />
                      )}
                    </label>
                  )
                })
              )}
            </div>
            {selectedIds.length > 0 && (
              <button
                onClick={() => {
                  setSelectedIds([])
                  setPopoverOpen(false)
                }}
                className="mt-2.5 flex w-full items-center justify-center gap-1.5 rounded-card border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground"
              >
                <X className="h-3 w-3" />
                Limpiar selección
              </button>
            )}
          </PopoverContent>
        </Popover>

        {/* Selected chips */}
        <div className="flex flex-wrap gap-1.5">
          {selectedIds.map((id) => {
            const ev = eligibleEvents.find((e) => e.id === id)
            const idx = data?.events.findIndex((e) => e.id === id) ?? -1
            const color = idx >= 0 ? EVENT_COLORS[idx % EVENT_COLORS.length] : "#94a3b8"
            if (!ev) return null
            return (
              <span
                key={id}
                className="inline-flex h-8 items-center gap-1 rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground"
                style={{ borderLeftColor: color, borderLeftWidth: 3 }}
              >
                <span className="max-w-[120px] truncate sm:max-w-[180px]">{ev.nombre}</span>
                <button
                  onClick={() => toggleId(id)}
                  aria-label={`Quitar ${ev.nombre}`}
                  className="relative rounded-full p-0.5 hover:bg-muted/60 transition-colors after:absolute after:-inset-2.5 after:content-['']"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            )
          })}
        </div>
      </div>

      {/* Chart */}
      <div className="rounded-panel border border-border bg-card p-4 shadow-sm md:p-5">
        <div className="mb-4 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-card bg-primary/10 text-primary">
            <TrendingUp className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-sm font-semibold leading-tight text-foreground">
              Curva de velocidad de ventas
            </h2>
            <p className="text-xs text-muted-foreground">Ocupación acumulada</p>
          </div>
        </div>

        {loading ? (
          <ChartSkeleton />
        ) : selectedIds.length === 0 ? (
          <div className="flex h-[300px] md:h-[400px] items-center justify-center text-sm text-muted-foreground">
            Seleccioná al menos un evento del selector.
          </div>
        ) : hasNoData ? (
          <div className="flex h-[300px] md:h-[400px] items-center justify-center">
            <div className="text-center space-y-2">
              <TrendingUp className="mx-auto h-8 w-8 text-muted-foreground/40" />
              <p className="text-sm text-muted-foreground">
                Sin datos de velocidad.
              </p>
              <p className="text-xs text-muted-foreground max-w-xs">
                Esperá a que el job procese los próximos snapshots.
              </p>
            </div>
          </div>
        ) : chartData.length === 0 ? (
          <div className="flex h-[300px] md:h-[400px] items-center justify-center text-sm text-muted-foreground">
            Sin datos para los eventos seleccionados.
          </div>
        ) : (
          /* CSS-container approach: outer div controls height, ResponsiveContainer fills it */
          <div ref={chartWrapperRef} className="h-[300px] md:h-[400px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                margin={{ top: 10, right: 10, left: 0, bottom: 16 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  stroke="var(--border)"
                  vertical={false}
                />
                <XAxis
                  dataKey="days_before_event"
                  type="number"
                  reversed
                  domain={["dataMax", 0]}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={40}
                  tickFormatter={(v: number) =>
                    v === 0 ? "Evento" : `-${v}d`
                  }
                />
                <YAxis
                  domain={[0, 100]}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v: number) => `${v}%`}
                  width={36}
                />
                <Tooltip
                  content={
                    <VelocityTooltip events={data?.events ?? []} chartWidth={chartWidth} />
                  }
                  cursor={{ stroke: "var(--muted-foreground)", strokeWidth: 1, strokeDasharray: "3 3" }}
                />
                <Legend
                  wrapperStyle={{ fontSize: 11, paddingTop: 24 }}
                  iconType="line"
                  onClick={handleLegendClick}
                />
                {data?.events.map((ev, i) => (
                  <Line
                    key={ev.id}
                    type="monotone"
                    dataKey={ev.id}
                    name={ev.nombre}
                    stroke={EVENT_COLORS[i % EVENT_COLORS.length]}
                    strokeWidth={2}
                    dot={false}
                    connectNulls
                    hide={hiddenLines.has(ev.id)}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      {/* Footnote */}
      <p className="text-xs text-muted-foreground">
        * La capacidad histórica usa el valor actual para días pasados. Los
        ingresos reflejan el acumulado hasta el momento del snapshot.
      </p>
    </div>
  )
}

// ─── Header sub-component ────────────────────────────────────────────────────

function Header() {
  return (
    <div className="space-y-1.5">
      <nav aria-label="Navegación" className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/dashboard/eventos" className="hover:text-foreground transition-colors">Eventos</Link>
        <ChevronRight className="h-3.5 w-3.5 opacity-50" />
        <span className="text-foreground font-medium">Velocidad de ventas</span>
      </nav>
      <h1 className="text-2xl font-bold text-foreground">
        Velocidad de ventas
      </h1>
    </div>
  )
}
