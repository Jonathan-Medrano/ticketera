"use client"

import type { ComponentType, ElementType, ReactNode } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { DASHBOARD_DATE_PRESETS, matchActivePreset } from "@/lib/date-presets"
import { cn } from "@/lib/utils"
import { CalendarDays, ChevronLeft, ChevronRight, CircleAlert, Copy, ExternalLink, Pencil, Ticket } from "lucide-react"
import { formatMoney, formatDate, formatDateTime } from "@/lib/format"
import { toast } from "sonner"
import EscanearStatsCard from "@/components/dashboard/escanear-stats-card"

type IconType = ComponentType<{ className?: string }>

type EventoOption = {
  id: string
  nombre: string
}

type EventoActivo = {
  id: string
  nombre: string
  fecha: string
  vendidas: number
  compradores: number
  recaudado: number | null
  capacidad: number
  kind: "actual" | "proximo" | "activo"
}

type UltimaVenta = {
  id: string
  precio_pagado: number | null
  created_at: string
  estado: string
  comprador_nombre: string
  comprador_email: string | null
  evento_nombre: string
  categoria_nombre: string | null
}

type ProximoEventoDetalle = {
  evento: {
    id: string
    nombre: string
    descripcion?: string | null
    lugar?: string | null
    modo_fecha: "unica" | "multiple" | "pase"
  }
  tandas: Array<{
    id: string
    nombre: string
    estado: "activa" | "proxima" | "inactiva" | "agotada"
    activa_desde?: string | null
  }>
  categorias: Array<{
    id: string
    nombre: string
    precio: number
    stock: number
    stock_disponible: number
    tanda_id?: string | null
  }>
  fechas: Array<{
    id: string
    fecha: string
  }>
  ventas: Array<{
    id: string
    precio_pagado: number | null
    estado: "valida" | "usada" | "cancelada"
    created_at: string
    comprador_nombre: string
    comprador_email: string | null
    categoria_nombre: string | null
  }>
  metricas: {
    total_vendidas: number
    total_recaudado: number | null
    total_usadas: number
    total_canceladas: number
  }
}

export type DashboardCard = {
  label: string
  value: string
  icon: IconType
  tone: string
  surface: string
  ocultar?: boolean
  sub?: string
  infoTooltip?: string
  /** Si está presente, la card es un Link a esa ruta (con hover y cursor pointer). */
  href?: string
  /** Delta vs período anterior. Si presente, se renderiza badge debajo del valor. */
  delta?: { text: string; tone: "up" | "down" | "neutral" } | null
  /** El valor es un monto en ARS: se renderiza con font-mono tabular-nums (convención de plata del design system). */
  isMoney?: boolean
}

export function DashboardMetricsGrid({
  cards,
  ingresosOcultos,
  onToggleIngresos,
  hideIcon,
  showIcon,
}: {
  cards: DashboardCard[]
  ingresosOcultos: boolean
  onToggleIngresos: () => void
  hideIcon: ReactNode
  showIcon: ReactNode
}) {
  return (
    <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4">
      {cards.map(({ label, value, icon: Icon, tone, surface, ocultar, sub, infoTooltip, href, delta, isMoney }) => (
        <MetricCard
          key={label}
          label={label}
          value={ocultar && ingresosOcultos ? "••••••" : value}
          icon={Icon}
          tone={tone}
          surface={surface}
          sub={ocultar && ingresosOcultos ? "Podés volver a mostrar este monto cuando quieras" : sub}
          delta={ocultar && ingresosOcultos ? null : delta}
          isMoney={isMoney}
          href={href}
          action={
            ocultar ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={onToggleIngresos}
                  className="rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
                  aria-label={ingresosOcultos ? "Mostrar ingresos" : "Ocultar ingresos"}
                >
                  {ingresosOcultos ? hideIcon : showIcon}
                </button>
                {infoTooltip ? (
                  <TooltipProvider delayDuration={150}>
                    <UITooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          className="rounded-full p-1 text-muted-foreground transition-colors hover:text-foreground"
                          aria-label="Más información sobre este monto"
                        >
                          <CircleAlert className="h-4 w-4" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-64 text-xs leading-5">
                        {infoTooltip}
                      </TooltipContent>
                    </UITooltip>
                  </TooltipProvider>
                ) : null}
              </div>
            ) : null
          }
        />
      ))}
    </section>
  )
}

export function DashboardFeaturedEventCard({
  eventoDestacadoActual,
  etiquetaEventoDestacado,
  eventoSeleccionado,
  ocupacionEventoDestacado,
  eventosDestacados,
  eventoCarruselIndex,
  onPrev,
  onNext,
  onOpenDetails,
}: {
  eventoDestacadoActual: EventoActivo | null
  etiquetaEventoDestacado: string
  eventoSeleccionado: EventoOption | null
  ocupacionEventoDestacado: number
  eventosDestacados: EventoActivo[]
  eventoCarruselIndex: number
  onPrev: () => void
  onNext: () => void
  onOpenDetails: () => void
}) {
  return (
    <div className="flex h-full min-w-0 flex-col rounded-panel border border-border bg-card p-5 shadow-sm md:p-6">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
          {etiquetaEventoDestacado}
        </p>
        <h2 className="mt-2 text-lg font-semibold text-foreground">
          {eventoDestacadoActual ? eventoDestacadoActual.nombre : "Todavía no hay eventos programados"}
        </h2>
        <p className="mt-2 text-xs leading-6 text-muted-foreground">
          {eventoSeleccionado
            ? "El resto del home se recalcula con el evento seleccionado sin salir de esta vista."
            : "Usalo como referencia rápida mientras filtrás métricas, analítica y ventas recientes."}
        </p>
      </div>

      {eventoDestacadoActual ? (
        <div className="mt-5 space-y-4">
          <div className="rounded-card-sm border border-border bg-background/70 p-4">
            <p className="text-xs text-muted-foreground">Fecha</p>
            <p className="mt-1 text-sm font-medium text-foreground">{formatDateTime(eventoDestacadoActual.fecha)}</p>
          </div>

          <div className="rounded-card-sm border border-border bg-background/70 p-4">
            <div className="flex items-center justify-between gap-3 text-sm">
              <span className="text-muted-foreground">Ocupación estimada</span>
              <span className="font-semibold text-foreground">{ocupacionEventoDestacado}%</span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-[color:var(--marketing-accent-soft)] dark:bg-sky-950/40">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${ocupacionEventoDestacado}%` }}
              />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {eventoDestacadoActual.vendidas} vendidas de {eventoDestacadoActual.capacidad} disponibles.
            </p>
          </div>

          <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={onOpenDetails}
                className="inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
                aria-label="Ver detalle del evento"
              >
                <CircleAlert className="h-3.5 w-3.5" />
                Ver detalle
              </button>
              {eventosDestacados.length > 1 ? (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {eventoCarruselIndex + 1} / {eventosDestacados.length}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-xl border border-border bg-background/70 text-muted-foreground hover:bg-background"
                      aria-label="Ver evento anterior"
                      onClick={onPrev}
                      disabled={eventoCarruselIndex === 0}
                    >
                      <ChevronLeft className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 rounded-xl border border-border bg-background/70 text-muted-foreground hover:bg-background"
                      aria-label="Ver siguiente evento"
                      onClick={onNext}
                      disabled={eventoCarruselIndex >= eventosDestacados.length - 1}
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
        </div>
      ) : (
        <EmptyState icon={CalendarDays} message="Cuando exista un próximo evento, lo vas a ver destacado acá." />
      )}
    </div>
  )
}

export function DashboardFiltersCard({
  eventoFiltro,
  eventos,
  periodo,
  onEventoChange,
  onDesdeChange,
  onHastaChange,
  onReset,
  onPresetApply,
}: {
  eventoFiltro: string
  eventos: EventoOption[]
  periodo: { desde: string | null; hasta: string | null }
  onEventoChange: (value: string) => void
  onDesdeChange: (value: string) => void
  onHastaChange: (value: string) => void
  onReset: () => void
  onPresetApply?: (desde: string, hasta: string) => void
}) {
  const activePresetId = matchActivePreset(periodo.desde, periodo.hasta)

  function applyPreset(presetId: string) {
    const preset = DASHBOARD_DATE_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    const { desde, hasta } = preset.compute()
    if (onPresetApply) {
      onPresetApply(desde, hasta)
    } else {
      onDesdeChange(desde)
      onHastaChange(hasta)
    }
  }

  return (
    <div className="flex h-full min-w-0 rounded-panel border border-border bg-card p-4 shadow-sm md:p-5">
      <div className="flex w-full flex-col gap-4 xl:justify-between">
        <div className="min-w-0 xl:max-w-md">
          <p className="text-sm font-semibold text-foreground">Filtrar resumen</p>
          <p className="mt-1 text-xs leading-6 text-muted-foreground">
            Ajustá métricas, gráficos y actividad reciente por evento o por período sin salir del home.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2 xl:col-span-2">
            <label className="block text-xs font-medium text-muted-foreground">Evento</label>
            <Select value={eventoFiltro} onValueChange={onEventoChange}>
              <SelectTrigger className="h-11 min-w-0 bg-background w-full">
                <SelectValue placeholder="Todos los eventos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los eventos</SelectItem>
                {eventos.map((evento) => (
                  <SelectItem key={evento.id} value={evento.id}>
                    {evento.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5 sm:col-span-2 xl:col-span-2">
            <label className="block text-xs font-medium text-muted-foreground">Período rápido</label>
            <div className="flex flex-wrap gap-1.5">
              {DASHBOARD_DATE_PRESETS.map((preset) => {
                const isActive = activePresetId === preset.id
                return (
                  <Badge
                    key={preset.id}
                    variant={isActive ? "default" : "outline"}
                    className={cn(
                      "cursor-pointer select-none transition-all px-2.5 py-1 text-[11px]",
                      isActive
                        ? "font-semibold ring-2 ring-primary/30 hover:bg-primary/90"
                        : "font-normal text-muted-foreground hover:bg-accent hover:text-foreground",
                    )}
                    onClick={() => applyPreset(preset.id)}
                  >
                    {isActive ? "✓ " : ""}{preset.label}
                  </Badge>
                )
              })}
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Desde</label>
            <Input
              type="date"
              className="h-11 min-w-0 w-full bg-background"
              value={periodo.desde ?? ""}
              max={periodo.hasta ?? undefined}
              onChange={(e) => onDesdeChange(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Hasta</label>
            <Input
              type="date"
              className="h-11 min-w-0 w-full bg-background"
              value={periodo.hasta ?? ""}
              min={periodo.desde ?? undefined}
              onChange={(e) => onHastaChange(e.target.value)}
            />
          </div>
          <Button variant="outline" className="h-11 sm:col-span-2 xl:col-span-2" onClick={onReset}>
            Limpiar filtros
          </Button>
        </div>
      </div>
    </div>
  )
}

export function DashboardRecentSalesSection({ ultimasVentas }: { ultimasVentas: UltimaVenta[] }) {
  return (
    <div className="rounded-panel border border-border bg-card p-4 shadow-sm md:p-6 min-w-0">
      <div className="flex items-end justify-between gap-3 border-b border-border pb-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">
            Actividad reciente
          </p>
          <h2 className="mt-2 text-lg font-semibold text-foreground">Últimas ventas</h2>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">{ultimasVentas.length} recientes</span>
          <Link
            href="/dashboard/ventas"
            className="text-xs font-medium text-primary underline-offset-2 transition-colors hover:underline"
          >
            Ver todas →
          </Link>
        </div>
      </div>

      {ultimasVentas.length === 0 ? (
        <EmptyState icon={Ticket} message="Todavía no hay ventas registradas en este período." />
      ) : (
        <div className="mt-5 space-y-3">
          {ultimasVentas.map((venta) => (
            <article
              key={venta.id}
              className="rounded-card-sm border border-border bg-background/70 p-4 transition-colors hover:bg-background"
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[color:var(--marketing-accent-soft)] text-xs font-bold text-sky-900 dark:bg-sky-900/30 dark:text-sky-200">
                  {venta.comprador_nombre?.[0]?.toUpperCase() ?? "?"}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-foreground">{venta.comprador_nombre}</p>
                      <p className="truncate text-xs text-muted-foreground">{venta.comprador_email ?? "Email oculto"}</p>
                    </div>
                    <p className="shrink-0 text-right text-sm font-semibold text-foreground">
                      <span className="block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">Precio pagado</span>
                      {venta.precio_pagado !== null ? (
                        <span className="font-mono tabular-nums">{formatMoney(Number(venta.precio_pagado))}</span>
                      ) : "Monto oculto"}
                    </p>
                  </div>

                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span className="rounded-full bg-muted px-2.5 py-1 text-foreground/80">{venta.evento_nombre}</span>
                    <span>{venta.categoria_nombre ?? "General"}</span>
                    <span>•</span>
                    <span>{formatDate(venta.created_at)}</span>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}

export function DashboardEventDetailDialog({
  open,
  onOpenChange,
  eventoDestacadoActual,
  mostrarIngresos,
  ocupacionEventoDestacado,
  eventoDetalleLoading,
  eventoDetalleError,
  eventoDetalle,
  empresaSlug,
  puedeEditarEventos = false,
  puedeEscanear = false,
  puedeVerVentas = false,
  puedeVerCompradores = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  eventoDestacadoActual: EventoActivo | null
  mostrarIngresos: boolean
  ocupacionEventoDestacado: number
  eventoDetalleLoading: boolean
  eventoDetalleError: string | null
  eventoDetalle: ProximoEventoDetalle | null
  empresaSlug?: string | null
  puedeEditarEventos?: boolean
  puedeEscanear?: boolean
  puedeVerVentas?: boolean
  puedeVerCompradores?: boolean
}) {
  const router = useRouter()
  const estadoEvento = eventoDestacadoActual
    ? eventoDestacadoActual.kind === "actual"
      ? "En curso"
      : eventoDestacadoActual.kind === "proximo"
        ? "Próximo"
        : "Activo"
    : null

  const publicEventUrl = eventoDestacadoActual && empresaSlug
    ? `/t/${empresaSlug}/evento/${eventoDestacadoActual.id}`
    : null

  async function copyPublicUrl() {
    if (!publicEventUrl) return
    try {
      const fullUrl = `${window.location.origin}${publicEventUrl}`
      await navigator.clipboard.writeText(fullUrl)
      toast.success("Link público copiado")
    } catch {
      toast.error("No se pudo copiar el link")
    }
  }

  // El stats card en vivo solo tiene sentido para eventos "en curso" o "próximos"
  // (que es cuando habría escaneos pasando o por pasar).
  const showLiveStats =
    puedeEscanear &&
    eventoDestacadoActual &&
    (eventoDestacadoActual.kind === "actual" || eventoDestacadoActual.kind === "proximo")

  function goToVentas() {
    if (!eventoDestacadoActual) return
    onOpenChange(false)
    router.push(`/dashboard/ventas?evento=${eventoDestacadoActual.id}`)
  }
  function goToDetalle() {
    if (!eventoDestacadoActual) return
    onOpenChange(false)
    router.push(`/dashboard/eventos/${eventoDestacadoActual.id}`)
  }
  function goToEditar() {
    if (!eventoDestacadoActual) return
    onOpenChange(false)
    router.push(`/dashboard/eventos/${eventoDestacadoActual.id}/editar`)
  }

  function compradorHref(venta: { comprador_email?: string | null; comprador_nombre?: string }): string | null {
    if (!puedeVerCompradores) return null
    const search = venta.comprador_email || venta.comprador_nombre
    if (!search) return null
    return `/dashboard/compradores?busqueda=${encodeURIComponent(search)}`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="h-auto w-[96vw] max-w-5xl overflow-hidden rounded-panel border border-border/80 bg-card p-0 shadow-2xl lg:w-[92vw] lg:max-w-[1120px]">
        <DialogHeader className="border-b border-border/70 bg-card px-5 py-3 pr-12 md:px-6">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {estadoEvento ? (
                <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {estadoEvento}
                </span>
              ) : null}
              {eventoDestacadoActual ? (
                <span className="text-[11px] font-medium text-muted-foreground">
                  📅 {formatDateTime(eventoDestacadoActual.fecha)}
                </span>
              ) : null}
            </div>
            <DialogTitle className="mt-1 pr-2 text-lg font-semibold leading-tight text-foreground md:text-xl">
              {eventoDestacadoActual ? eventoDestacadoActual.nombre : "Detalle del evento"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Resumen ejecutivo del evento: performance, capacidad, tandas, categorías y compradores recientes.
            </DialogDescription>

            {/* Acciones rápidas — fila separada debajo del título para no competir con la X */}
            {publicEventUrl ? (
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs"
                  onClick={() => void copyPublicUrl()}
                >
                  <Copy className="h-3 w-3" />
                  Copiar link público
                </Button>
                <a
                  href={publicEventUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background h-7 px-2.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/50"
                >
                  <ExternalLink className="h-3 w-3" />
                  Ver como comprador
                </a>
              </div>
            ) : null}
          </div>
        </DialogHeader>

        {eventoDestacadoActual ? (
          <div className="max-h-[calc(85vh-160px)] overflow-y-auto px-5 py-4 md:px-6 md:py-4">
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <MetricHighlightCard label="Entradas vendidas" value={String(eventoDestacadoActual.vendidas)} />
              <MetricHighlightCard label="Compradores" value={String(eventoDestacadoActual.compradores)} />
              <MetricHighlightCard label="Capacidad" value={String(eventoDestacadoActual.capacidad)} />
              <MetricHighlightCard
                label="Total cobrado"
                value={mostrarIngresos && eventoDestacadoActual.recaudado !== null ? formatMoney(eventoDestacadoActual.recaudado) : "Sin permiso"}
                isMoney={mostrarIngresos && eventoDestacadoActual.recaudado !== null}
              />
            </div>

            {/* Barra de ocupación inline (compacto — reemplaza panel "Capacidad y movimiento") */}
            <div className="mt-3 rounded-card-sm border border-border/70 bg-background/70 px-4 py-2.5">
              <div className="flex items-center justify-between gap-3 text-xs">
                <span className="text-muted-foreground">
                  Ocupación · {eventoDestacadoActual.vendidas} de {eventoDestacadoActual.capacidad}
                </span>
                <span className="font-semibold text-foreground">{ocupacionEventoDestacado}%</span>
              </div>
              <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[color:var(--marketing-accent-soft)] dark:bg-sky-950/40">
                <div
                  className="h-full rounded-full bg-primary"
                  style={{ width: `${ocupacionEventoDestacado}%` }}
                />
              </div>
            </div>

            {/* Stats de check-in en vivo (solo si evento en curso/próximo y user puede escanear) */}
            {showLiveStats ? (
              <div className="mt-3">
                <EscanearStatsCard eventoId={eventoDestacadoActual.id} />
              </div>
            ) : null}

            <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
              <div className="space-y-4">

                {eventoDetalleLoading ? (
                  <SectionPanel title="Cargando detalle" subtitle="Estamos trayendo más contexto operativo del evento.">
                    <div className="rounded-card-sm border border-dashed border-border/70 bg-background/60 p-5 text-sm text-muted-foreground">
                      Cargando tandas, categorías y compradores recientes...
                    </div>
                  </SectionPanel>
                ) : eventoDetalleError ? (
                  <SectionPanel title="Detalle no disponible" subtitle="No pudimos completar la carga del panel ampliado.">
                    <div className="rounded-card-sm border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive">
                      {eventoDetalleError}
                    </div>
                  </SectionPanel>
                ) : eventoDetalle ? (
                  <>
                    <SectionPanel
                      title="Tandas activas"
                      subtitle="Estado comercial de las ventanas de venta principales."
                      headerAction={
                        eventoDetalle.tandas.length > 4 ? (
                          <Link
                            href={`/dashboard/eventos/${eventoDestacadoActual.id}`}
                            className="text-xs text-primary hover:underline"
                          >
                            Ver todas ({eventoDetalle.tandas.length}) →
                          </Link>
                        ) : null
                      }
                    >
                      {eventoDetalle.tandas.length > 0 ? (
                        <div className="grid gap-2 xl:grid-cols-2">
                          {eventoDetalle.tandas.slice(0, 4).map((tanda) => (
                            <div key={tanda.id} className="rounded-card-sm border border-border/70 bg-background/70 px-3 py-2">
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="text-xs font-semibold text-foreground truncate">{tanda.nombre}</p>
                                  <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                                    {tanda.activa_desde ? `Desde ${formatDate(tanda.activa_desde)}` : "Sin fecha"}
                                  </p>
                                </div>
                                <StatusPill label={tanda.estado} compact />
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <EmptyInlineState message="Este evento no tiene tandas configuradas." />
                      )}
                    </SectionPanel>

                    <SectionPanel
                      title="Categorías y stock"
                      subtitle="Oferta disponible y referencia rápida de pricing."
                      headerAction={
                        eventoDetalle.categorias.length > 4 ? (
                          <Link
                            href={`/dashboard/eventos/${eventoDestacadoActual.id}`}
                            className="text-xs text-primary hover:underline"
                          >
                            Ver todas ({eventoDetalle.categorias.length}) →
                          </Link>
                        ) : null
                      }
                    >
                      {eventoDetalle.categorias.length > 0 ? (
                        <div className="grid gap-2 xl:grid-cols-2">
                          {eventoDetalle.categorias.slice(0, 4).map((categoria) => {
                            const stockTotal = Number(categoria.stock) || 0
                            const stockDisponible = Number(categoria.stock_disponible) || 0
                            const vendidas = Math.max(0, stockTotal - stockDisponible)
                            const porcentajeVendido = stockTotal > 0 ? Math.min(100, Math.round((vendidas / stockTotal) * 100)) : 0
                            return (
                              <div key={categoria.id} className="rounded-card-sm border border-border/70 bg-background/70 px-3 py-2">
                                <div className="flex items-center justify-between gap-3">
                                  <p className="truncate text-xs font-semibold text-foreground">{categoria.nombre}</p>
                                  <span className="shrink-0 text-xs font-mono font-semibold tabular-nums text-foreground">{formatMoney(categoria.precio)}</span>
                                </div>
                                <div className="mt-1.5 flex items-center gap-2">
                                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                                    <div
                                      className={`h-full rounded-full transition-all ${porcentajeVendido >= 90 ? "bg-destructive" : porcentajeVendido >= 70 ? "bg-amber-500" : "bg-primary"}`}
                                      style={{ width: `${porcentajeVendido}%` }}
                                    />
                                  </div>
                                  <span className="text-[10px] font-mono text-muted-foreground whitespace-nowrap shrink-0">
                                    {vendidas}/{stockTotal} · {porcentajeVendido}%
                                  </span>
                                </div>
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <EmptyInlineState message="Este evento no tiene categorías cargadas." />
                      )}
                    </SectionPanel>
                  </>
                ) : null}
              </div>

              <div className="space-y-4">
                <SectionPanel title="Compradores recientes" subtitle="Último movimiento para soporte y operación en puerta.">
                  {eventoDetalle?.ventas.length ? (
                    <div className="space-y-1.5">
                      {eventoDetalle.ventas.slice(0, 5).map((venta) => {
                        const href = compradorHref(venta)
                        const CardWrapper = (href ? Link : "div") as ElementType
                        const wrapperProps = href ? { href, onClick: () => onOpenChange(false) } : {}
                        return (
                          <CardWrapper
                            key={venta.id}
                            {...wrapperProps}
                            className={`block rounded-card-sm border border-border/70 bg-background/75 px-3 py-2 transition-colors ${href ? "hover:bg-background hover:border-primary/40 cursor-pointer" : ""}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-xs font-semibold text-foreground min-w-0">{venta.comprador_nombre}</p>
                              <StatusPill label={venta.estado} compact />
                            </div>
                            <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                              <span className="truncate min-w-0">{venta.categoria_nombre ?? "Sin categoría"}</span>
                              <span className="shrink-0">{formatDate(venta.created_at)}</span>
                            </div>
                          </CardWrapper>
                        )
                      })}
                    </div>
                  ) : eventoDetalleLoading ? (
                    <EmptyInlineState message="Cargando compradores recientes..." />
                  ) : (
                    <EmptyInlineState message="Todavía no hay compradores registrados para este evento." />
                  )}
                </SectionPanel>
              </div>
            </div>
          </div>
        ) : (
          <div className="px-6 py-8 md:px-8">
            <p className="text-sm text-muted-foreground">Todavía no hay un próximo evento disponible para mostrar.</p>
          </div>
        )}

        {/* Footer con CTAs — compacto */}
        {eventoDestacadoActual ? (
          <div className="border-t border-border/70 bg-muted/30 px-5 py-2 md:px-6 flex flex-wrap items-center justify-end gap-1.5">
            {puedeVerVentas ? (
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={goToVentas}>
                <Ticket className="h-3 w-3" />
                Entradas
              </Button>
            ) : null}
            {puedeEditarEventos ? (
              <Button type="button" variant="outline" size="sm" className="h-8 gap-1.5 text-xs" onClick={goToEditar}>
                <Pencil className="h-3 w-3" />
                Editar
              </Button>
            ) : null}
            <Button type="button" size="sm" className="h-8 gap-1.5 text-xs" onClick={goToDetalle}>
              Ver detalle completo
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function SectionPanel({
  title,
  subtitle,
  children,
  headerAction,
}: {
  title: string
  subtitle?: string
  children: ReactNode
  headerAction?: ReactNode
}) {
  return (
    <section className="rounded-card-sm border border-border/70 bg-card/70 p-3 md:p-3.5">
      <div className="mb-2.5 flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-[11px] leading-5 text-muted-foreground">{subtitle}</p> : null}
        </div>
        {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
      </div>
      {children}
    </section>
  )
}

function MetricHighlightCard({ label, value, isMoney }: { label: string; value: string; isMoney?: boolean }) {
  return (
    <div className="rounded-card-sm border border-border/70 bg-background/75 px-3 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className={cn(
        "mt-1 text-lg font-bold tracking-[-0.03em] text-foreground md:text-xl",
        isMoney && "font-mono tabular-nums",
      )}>{value}</p>
    </div>
  )
}

function StatusPill({ label, compact = false }: { label: string; compact?: boolean }) {
  const normalized = label.toLowerCase()
  const tone = normalized.includes("agot") || normalized.includes("cancel")
    ? "border-red-500/25 bg-red-500/10 text-red-300"
    : normalized.includes("activ") || normalized.includes("valid") || normalized.includes("usad")
      ? "border-success/25 bg-success/10 text-success"
      : "border-amber-500/25 bg-amber-500/10 text-amber-300"

  return (
    <span className={`rounded-full border px-2.5 py-1 font-medium capitalize ${compact ? "text-[11px]" : "text-xs"} ${tone}`}>
      {label}
    </span>
  )
}

function EmptyInlineState({ message }: { message: string }) {
  return (
    <div className="rounded-card-sm border border-dashed border-border/70 bg-background/60 p-4 text-sm text-muted-foreground">
      {message}
    </div>
  )
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone,
  surface,
  sub,
  action,
  href,
  delta,
  isMoney,
}: {
  label: string
  value: string
  icon: IconType
  tone: string
  surface: string
  sub?: string
  action?: ReactNode
  href?: string
  delta?: { text: string; tone: "up" | "down" | "neutral" } | null
  isMoney?: boolean
}) {
  const cardBody = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${surface}`}>
          <Icon className={`h-4 w-4 ${tone}`} />
        </div>
        {action}
      </div>
      <p className="mt-4 text-xs font-medium text-muted-foreground">{label}</p>
      <div className="mt-2 flex items-baseline gap-2 flex-wrap">
        <p className={cn(
          "text-xl font-bold tracking-[-0.04em] text-foreground md:text-2xl lg:text-[2rem] min-w-0 overflow-hidden",
          isMoney && "font-mono tabular-nums",
        )}>{value}</p>
        {delta ? (
          <span
            className={cn(
              "inline-flex items-center text-[11px] font-semibold rounded-full px-2 py-0.5",
              delta.tone === "up" && "bg-success/15 text-success",
              delta.tone === "down" && "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300",
              delta.tone === "neutral" && "bg-muted text-muted-foreground",
            )}
          >
            {delta.text}
          </span>
        ) : null}
      </div>
      {sub ? <p className="mt-2 text-xs leading-6 text-muted-foreground">{sub}</p> : null}
    </>
  )

  const baseClasses = "block rounded-card border border-border bg-card p-4 shadow-sm md:p-5"

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          baseClasses,
          "group transition-all hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        )}
      >
        {cardBody}
      </Link>
    )
  }

  return <article className={baseClasses}>{cardBody}</article>
}

function EmptyState({ icon: Icon, message }: { icon: IconType; message: string }) {
  return (
    <div className="flex min-h-[220px] flex-col items-center justify-center px-6 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="h-5 w-5" />
      </div>
      <p className="mt-4 max-w-xs text-sm leading-7 text-muted-foreground">{message}</p>
    </div>
  )
}


