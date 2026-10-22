"use client"

import type { ElementType } from "react"
import Link from "next/link"
import { TrendingUp } from "lucide-react"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { formatMoney } from "@/lib/format"

export type TopCategoria = {
  categoria_id: string | null
  categoria: string
  evento_id: string | null
  evento_nombre: string | null
  ventas: number
  bruto: number | null
}

export type HeatmapPoint = {
  /** MySQL DAYOFWEEK: 1=Sun, 2=Mon, ..., 7=Sat */
  dia_semana: number
  /** 0-23 */
  hora: number
  ventas: number
}

// Renumberamos DAYOFWEEK al orden lunes→domingo
const DIA_LABELS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
// dayOfWeek (1-7 con 1=Sun) → índice en DIA_LABELS (0-6 con 0=Lun)
function dayOfWeekToIndex(dow: number): number {
  // Sun=1 → 6, Mon=2 → 0, Tue=3 → 1, ..., Sat=7 → 5
  return (dow + 5) % 7
}

const HOURS = Array.from({ length: 24 }, (_, h) => h)

export function DashboardInsightsSection({
  topCategorias,
  heatmapHorario,
  puedeVerMontos,
}: {
  topCategorias: TopCategoria[]
  heatmapHorario: HeatmapPoint[]
  puedeVerMontos: boolean
}) {
  const maxVentasCategoria = Math.max(...topCategorias.map((c) => c.ventas), 1)

  // Construir grid 7×24 desde heatmapHorario
  const heatmapGrid: number[][] = Array.from({ length: 7 }, () => Array(24).fill(0))
  let maxVentasHeatmap = 0
  for (const point of heatmapHorario) {
    const dayIndex = dayOfWeekToIndex(point.dia_semana)
    if (dayIndex < 0 || dayIndex > 6) continue
    if (point.hora < 0 || point.hora > 23) continue
    heatmapGrid[dayIndex][point.hora] = point.ventas
    if (point.ventas > maxVentasHeatmap) maxVentasHeatmap = point.ventas
  }

  function heatmapCellOpacity(value: number): number {
    if (value === 0) return 0
    if (maxVentasHeatmap === 0) return 0
    return Math.max(0.12, value / maxVentasHeatmap)
  }

  return (
    <div className="rounded-panel border border-border bg-card p-4 shadow-sm md:p-6">
      <div className="flex flex-col gap-2 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Insights</p>
          <h2 className="mt-2 text-lg font-semibold text-foreground">Patrones de venta</h2>
        </div>
        <p className="text-xs text-muted-foreground">Top categorías y horarios pico para tomar decisiones operativas.</p>
      </div>

      <Tabs defaultValue="categorias" className="mt-5">
        <TabsList className="mb-5 h-12! w-full max-w-md grid grid-cols-2 rounded-2xl border border-border bg-muted/60 p-1">
          <TabsTrigger value="categorias" className="flex-1 rounded-xl px-6 text-sm font-semibold text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-active:bg-card data-active:text-foreground data-active:shadow-[0_8px_24px_rgba(2,6,23,0.12)]">Top categorías</TabsTrigger>
          <TabsTrigger value="heatmap" className="flex-1 rounded-xl px-6 text-sm font-semibold text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-active:bg-card data-active:text-foreground data-active:shadow-[0_8px_24px_rgba(2,6,23,0.12)]">Horarios pico</TabsTrigger>
        </TabsList>

        {/* TOP CATEGORÍAS */}
        <TabsContent value="categorias" className="mt-0">
          {topCategorias.length === 0 ? (
            <div className="flex h-[200px] items-center justify-center rounded-card-sm border border-dashed border-border bg-background/55 px-6 text-center text-sm text-muted-foreground">
              Sin ventas todavía. Cuando haya ventas vas a ver las categorías más vendidas acá.
            </div>
          ) : (
            <div className="space-y-2">
              {topCategorias.map((cat, idx) => {
                const percentBar = (cat.ventas / maxVentasCategoria) * 100
                const Wrapper = (cat.evento_id ? Link : "div") as ElementType
                const wrapperProps = cat.evento_id ? { href: `/dashboard/eventos/${cat.evento_id}` } : {}
                return (
                  <Wrapper
                    key={`${cat.categoria_id}-${cat.evento_id}-${idx}`}
                    {...wrapperProps}
                    className={cn(
                      "block rounded-card-sm border border-border bg-background/70 p-3 transition-colors",
                      cat.evento_id && "hover:bg-background hover:border-primary/30 cursor-pointer",
                    )}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--marketing-accent-soft)] text-xs font-bold text-[color:var(--marketing-accent)]">
                        #{idx + 1}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{cat.categoria}</p>
                        <p className="truncate text-[11px] text-muted-foreground">{cat.evento_nombre ?? "Sin evento"}</p>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-foreground">{cat.ventas} ventas</p>
                        {puedeVerMontos && cat.bruto !== null ? (
                          <p className="text-[11px] text-muted-foreground">{formatMoney(cat.bruto)}</p>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-sky-500 transition-all"
                        style={{ width: `${percentBar.toFixed(1)}%` }}
                      />
                    </div>
                  </Wrapper>
                )
              })}
            </div>
          )}
        </TabsContent>

        {/* HEATMAP HORARIO */}
        <TabsContent value="heatmap" className="mt-0">
          {heatmapHorario.length === 0 ? (
            <div className="flex h-[200px] items-center justify-center rounded-card-sm border border-dashed border-border bg-background/55 px-6 text-center text-sm text-muted-foreground">
              Sin actividad reciente. El heatmap se llena con las ventas de los últimos 90 días (o el período filtrado).
            </div>
          ) : (
            <TooltipProvider delayDuration={120}>
              <div className="overflow-x-auto pb-2">
                <div className="inline-block min-w-full">
                  {/* Header de horas */}
                  <div className="flex items-center gap-px pl-[44px]">
                    {HOURS.map((h) => (
                      <div
                        key={h}
                        className={cn(
                          "h-5 w-5 shrink-0 text-center text-[9px] font-mono text-muted-foreground",
                          h % 3 !== 0 && "text-transparent",
                        )}
                      >
                        {h.toString().padStart(2, "0")}
                      </div>
                    ))}
                  </div>
                  {/* Filas por día */}
                  {DIA_LABELS.map((dia, dayIdx) => (
                    <div key={dia} className="flex items-center gap-px py-px">
                      <div className="w-[40px] shrink-0 pr-1 text-right text-[10px] font-medium text-muted-foreground">
                        {dia}
                      </div>
                      {HOURS.map((h) => {
                        const value = heatmapGrid[dayIdx][h]
                        const opacity = heatmapCellOpacity(value)
                        return (
                          <Tooltip key={h}>
                            <TooltipTrigger asChild>
                              <div
                                className={cn(
                                  "h-5 w-5 shrink-0 rounded-sm transition-transform hover:scale-110",
                                  value === 0 ? "bg-muted/40" : "bg-sky-500",
                                )}
                                style={value > 0 ? { opacity } : undefined}
                              />
                            </TooltipTrigger>
                            <TooltipContent side="top" className="text-xs">
                              <p className="font-medium">{dia} · {h.toString().padStart(2, "0")}:00</p>
                              <p className="text-muted-foreground">{value} venta{value !== 1 ? "s" : ""}</p>
                            </TooltipContent>
                          </Tooltip>
                        )
                      })}
                    </div>
                  ))}
                  {/* Leyenda */}
                  <div className="mt-3 flex items-center gap-2 pl-[44px] text-[10px] text-muted-foreground">
                    <span>Menos</span>
                    {[0.15, 0.35, 0.55, 0.75, 1].map((op, i) => (
                      <div key={i} className="h-3 w-3 rounded-sm bg-sky-500" style={{ opacity: op }} />
                    ))}
                    <span>Más</span>
                    <span className="ml-auto flex items-center gap-1">
                      <TrendingUp className="h-3 w-3" />
                      Pico: {maxVentasHeatmap} venta{maxVentasHeatmap !== 1 ? "s" : ""} / hora
                    </span>
                  </div>
                </div>
              </div>
            </TooltipProvider>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
