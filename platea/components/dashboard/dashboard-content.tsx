"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import dynamic from "next/dynamic"
import { AlertTriangle, ArrowRight, CalendarDays, CupSoda, Download, ExternalLink, Eye, EyeOff, Plus, Receipt, RefreshCcw, Ticket, TrendingUp, Users, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import CierreCajaExportDialog from "@/components/dashboard/cierre-caja-export-dialog"
import { DashboardInsightsSection } from "@/components/dashboard/dashboard-insights-section"
import { cn } from "@/lib/utils"
import type { Permisos } from "@/lib/permisos"
import type { Session } from "next-auth"
import { formatMoney } from "@/lib/format"
import {
  DashboardEventDetailDialog,
  DashboardFeaturedEventCard,
  DashboardFiltersCard,
  DashboardMetricsGrid,
  DashboardRecentSalesSection,
  type DashboardCard,
} from "@/components/dashboard/dashboard-content-sections"
import { PrimerosPassosCard } from "@/components/dashboard/primeros-pasos-card"
import type { SalesReadinessReason, SalesReadinessStatus } from "@/lib/tenant"

function AnalyticsSkeleton() {
  return (
    <div className="rounded-panel border border-border bg-card p-4 shadow-sm md:p-6 animate-pulse">
      <div className="flex flex-col gap-2 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-2">
          <div className="h-3 w-16 rounded bg-muted" />
          <div className="h-5 w-56 rounded bg-muted" />
        </div>
        <div className="h-3 w-40 rounded bg-muted" />
      </div>
      <div className="mt-5 space-y-4">
        <div className="h-8 w-64 rounded-full bg-muted" />
        <div className="h-[280px] w-full rounded-card-sm bg-muted" />
      </div>
    </div>
  )
}

const DashboardAnalyticsSection = dynamic(
  () => import("@/components/dashboard/dashboard-analytics-section"),
  { ssr: false, loading: () => <AnalyticsSkeleton /> },
)

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

type ProximoEvento = EventoActivo

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

interface Props {
  session: Session
  metricas: {
    ventas: number
    ingresosNetos: number | null
    ingresosBrutosEmpresa: number | null
    ingresosBrutosTotales: number | null
    compradores: number
    eventosActivos: number
  }
  ventasPorDia: { dia: string; ventas: number }[]
  ventasPorEvento: { evento_id: string; evento: string; ventas: number }[]
  topCategorias?: Array<{
    categoria_id: string | null
    categoria: string
    evento_id: string | null
    evento_nombre: string | null
    ventas: number
    bruto: number | null
  }>
  heatmapHorario?: Array<{ dia_semana: number; hora: number; ventas: number }>
  comparacion?: {
    ventas: number
    ingresosNetos: number | null
    ingresosBrutosTotales: number | null
    compradores: number
    desde: string
    hasta: string
  } | null
  ultimasVentas: UltimaVenta[]
  proximoEvento: ProximoEvento | null
  eventosActivos: EventoActivo[]
  eventos: EventoOption[]
  filtroEvento: string | null
  periodo: {
    desde: string | null
    hasta: string | null
  }
  reconciliacionPendientes?: number
  permisos?: Permisos
  esEmpleado?: boolean
  featureFlags?: { consumiblesHabilitado?: boolean; posMovilHabilitado?: boolean }
  salesReadiness?: {
    status: SalesReadinessStatus
    reason: SalesReadinessReason | null
    canSell: boolean
  } | null
  /** Passed through to PrimerosPassosCard — server-authoritative sitio step flag */
  sitioConfigurado?: boolean
}

export default function DashboardContent({
  session,
  metricas,
  ventasPorDia,
  ventasPorEvento,
  ultimasVentas,
  proximoEvento,
  eventosActivos,
  eventos,
  filtroEvento,
  periodo,
  reconciliacionPendientes = 0,
  permisos,
  esEmpleado = false,
  topCategorias = [],
  heatmapHorario = [],
  comparacion = null,
  featureFlags,
  salesReadiness,
  sitioConfigurado,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [ingresosOcultos, setIngresosOcultos] = useState(false)
  const [cierreCajaDialogOpen, setCierreCajaDialogOpen] = useState(false)
  const [reconciliacionBannerDismissed, setReconciliacionBannerDismissed] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)

  // Helpers de permisos — empresa owner siempre tiene acceso, empleado depende del flag
  const puede = (flag: keyof Permisos): boolean => {
    if (!esEmpleado) return true
    if (!permisos) return false
    return permisos[flag] === true
  }
  const puedeCrearEventos = puede("crear_eventos")
  // Accesos rápidos de venta — el POS de barra es el caballito de batalla (se usa
  // toda la noche), así que va primero y con acento primary. El de entradas solo
  // si la empresa lo activó (posMovilHabilitado, off por default).
  const puedeVenderBarra = featureFlags?.consumiblesHabilitado !== false && puede("vender_consumibles")
  const puedeVenderEntradas = featureFlags?.posMovilHabilitado === true && puede("ver_eventos")
  const [eventoModalOpen, setEventoModalOpen] = useState(false)
  const [eventoCarruselIndex, setEventoCarruselIndex] = useState(0)
  const [eventoDetalle, setEventoDetalle] = useState<ProximoEventoDetalle | null>(null)
  const [eventoDetalleLoading, setEventoDetalleLoading] = useState(false)
  const [eventoDetalleError, setEventoDetalleError] = useState<string | null>(null)
  const eventoDetalleCache = useRef<Record<string, ProximoEventoDetalle>>({})
  const nombreCorto = session.user.name?.split(" ")[0] ?? "ahí"
  const empresaSlug =
    (session.user as { empresa_slug?: string | null; slug?: string | null }).empresa_slug ??
    (session.user as { slug?: string | null }).slug ??
    null
  const mostrarIngresos = metricas.ingresosNetos !== null
  const eventoFiltro = filtroEvento ?? searchParams.get("evento") ?? "todos"

  function updateFiltros(next: { desde?: string; hasta?: string; evento?: string }) {
    const params = new URLSearchParams(searchParams.toString())

    if (next.desde !== undefined) {
      if (next.desde) params.set("desde", next.desde)
      else params.delete("desde")
    }

    if (next.hasta !== undefined) {
      if (next.hasta) params.set("hasta", next.hasta)
      else params.delete("hasta")
    }

    if (next.evento !== undefined) {
      if (next.evento && next.evento !== "todos") params.set("evento", next.evento)
      else params.delete("evento")
    }

    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }

  // Banner reconciliación dismissible — persiste en localStorage con TTL de 6 horas
  // para que el banner reaparezca después de un rato (no perpetuamente oculto).
  useEffect(() => {
    if (reconciliacionPendientes === 0) return
    try {
      const raw = window.localStorage.getItem("dashboard-reconciliacion-banner-dismissed")
      if (!raw) return
      const dismissedAt = Number(raw)
      const HOURS_6 = 6 * 60 * 60 * 1000
      if (Number.isFinite(dismissedAt) && Date.now() - dismissedAt < HOURS_6) {
        setReconciliacionBannerDismissed(true)
      }
    } catch {
      // localStorage no disponible — banner siempre visible
    }
  }, [reconciliacionPendientes])

  async function handleRefresh() {
    if (isRefreshing) return
    setIsRefreshing(true)
    try {
      router.refresh()
      // router.refresh es síncrono en cuanto a la llamada pero la regeneración SSR
      // toma su tiempo. Le damos un mínimo visual de 600ms para que el feedback
      // no sea instantáneo (sino el usuario no sabe si pasó algo).
      await new Promise((resolve) => setTimeout(resolve, 600))
      toast.success("Datos actualizados")
    } finally {
      setIsRefreshing(false)
    }
  }

  function dismissReconciliacionBanner() {
    setReconciliacionBannerDismissed(true)
    try {
      window.localStorage.setItem("dashboard-reconciliacion-banner-dismissed", String(Date.now()))
    } catch {
      // ignorar
    }
  }

  // Helper para formatear delta % vs período anterior
  function formatDelta(current: number, previous: number): { text: string; tone: "up" | "down" | "neutral" } | null {
    if (!comparacion) return null
    if (previous === 0) {
      if (current === 0) return { text: "Sin cambios", tone: "neutral" }
      return { text: "Nuevo en este período", tone: "up" }
    }
    const delta = ((current - previous) / previous) * 100
    if (Math.abs(delta) < 0.5) return { text: "≈ vs anterior", tone: "neutral" }
    const sign = delta > 0 ? "+" : ""
    return {
      text: `${sign}${delta.toFixed(0)}% vs anterior`,
      tone: delta > 0 ? "up" : "down",
    }
  }

  function buildSub(base: string, current: number, previous: number | null): string {
    if (previous === null) return base
    const delta = formatDelta(current, previous)
    if (!delta) return base
    return `${base}  ·  ${delta.text}`
  }

  const cards: DashboardCard[] = [
    {
      label: "Ventas totales",
      value: metricas.ventas.toString(),
      icon: Ticket,
      tone: "text-[color:var(--marketing-accent)]",
      surface: "bg-sky-100/80",
      sub: buildSub(
        metricas.ventas === 1 ? "1 operación registrada" : `${metricas.ventas} operaciones registradas`,
        metricas.ventas,
        comparacion?.ventas ?? null,
      ),
      delta: comparacion ? formatDelta(metricas.ventas, comparacion.ventas) : null,
      href: puede("ver_entradas") ? "/dashboard/ventas" : undefined,
    },
    ...(mostrarIngresos
      ? [
            {
            label: "Neto acreditado",
            value: formatMoney(metricas.ingresosNetos ?? 0),
            icon: TrendingUp,
            tone: "text-success",
            surface: "bg-success/15",
            ocultar: true,
            isMoney: true,
            sub: `Total cobrado: ${formatMoney(metricas.ingresosBrutosTotales ?? 0)}`,
            infoTooltip: "Este es el total cobrado antes de descontar la comisión de Mercado Pago.",
            delta: comparacion ? formatDelta(metricas.ingresosNetos ?? 0, comparacion.ingresosNetos ?? 0) : null,
            href: puede("ver_entradas") ? "/dashboard/ventas" : undefined,
          },
        ]
      : []),
    {
      label: "Compradores",
      value: metricas.compradores.toString(),
      icon: Users,
      tone: "text-violet-700",
      surface: "bg-violet-100/80",
      sub: "Base activa del período seleccionado",
      delta: comparacion ? formatDelta(metricas.compradores, comparacion.compradores) : null,
      href: puede("ver_compradores") ? "/dashboard/compradores" : undefined,
    },
    {
      label: "Eventos activos",
      value: metricas.eventosActivos.toString(),
      icon: CalendarDays,
      tone: "text-amber-700",
      surface: "bg-amber-100/80",
      sub: proximoEvento ? `Próximo: ${proximoEvento.nombre}` : "Sin eventos próximos",
      href: puede("ver_eventos") ? "/dashboard/eventos" : undefined,
    },
  ]

  const tooltipStyle = {
    borderRadius: "16px",
    border: "1px solid var(--border)",
    background: "var(--card)",
    color: "var(--foreground)",
    fontSize: "13px",
    boxShadow: "0 12px 34px rgba(15, 23, 42, 0.08)",
  }

  const eventoSeleccionado = useMemo(
    () => eventos.find((evento) => evento.id === eventoFiltro) ?? null,
    [eventos, eventoFiltro]
  )

  const eventosDestacados = useMemo(() => {
    if (eventosActivos.length > 0) return eventosActivos
    return proximoEvento ? [proximoEvento] : []
  }, [eventosActivos, proximoEvento])

  const eventoDestacadoActual = eventosDestacados[eventoCarruselIndex] ?? null

  const etiquetaEventoDestacado = eventoDestacadoActual
    ? eventoDestacadoActual.kind === "actual"
      ? "Evento actual"
      : eventoDestacadoActual.kind === "proximo"
        ? "Próximo evento"
        : "Evento activo"
    : "Evento"

  const ocupacionEventoDestacado = eventoDestacadoActual?.capacidad
    ? Math.min(100, Math.round((eventoDestacadoActual.vendidas / eventoDestacadoActual.capacidad) * 100))
    : 0

  useEffect(() => {
    setEventoCarruselIndex((prev) => {
      if (eventosDestacados.length === 0) return 0
      return Math.min(prev, eventosDestacados.length - 1)
    })
  }, [eventosDestacados])

  useEffect(() => {
    if (!eventoModalOpen || !eventoDestacadoActual?.id) return

    let cancelled = false
    const cachedDetalle = eventoDetalleCache.current[eventoDestacadoActual.id]

    if (cachedDetalle) {
      setEventoDetalleError(null)
      setEventoDetalleLoading(false)
      setEventoDetalle(cachedDetalle)
      return
    }

    async function loadEventoDetalle() {
      try {
        setEventoDetalleLoading(true)
        setEventoDetalleError(null)
        setEventoDetalle(null)

        const res = await fetch(`/api/eventos/${eventoDestacadoActual.id}`)
        if (!res.ok) throw new Error("No se pudo cargar el detalle del evento")

        const data = (await res.json()) as ProximoEventoDetalle
        const cache = eventoDetalleCache.current
        const MAX_CACHE_SIZE = 10
        const keys = Object.keys(cache)
        if (keys.length >= MAX_CACHE_SIZE) {
          // FIFO: eliminar la entrada más antigua
          delete cache[keys[0]]
        }
        cache[eventoDestacadoActual.id] = data
        if (!cancelled) setEventoDetalle(data)
      } catch (error) {
        if (!cancelled) {
          setEventoDetalleError(error instanceof Error ? error.message : "No se pudo cargar el detalle del evento")
        }
      } finally {
        if (!cancelled) setEventoDetalleLoading(false)
      }
    }

    loadEventoDetalle()

    return () => {
      cancelled = true
    }
  }, [eventoModalOpen, eventoDestacadoActual?.id])

  return (
    <div className="space-y-5 md:space-y-6">
      <section className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.04em] text-foreground md:text-[2.2rem]">
            Hola, {nombreCorto}!
          </h1>
          {!esEmpleado && empresaSlug ? (
            <a
              href={`https://${empresaSlug}.ticketera.com`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-3 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden />
              {empresaSlug}.ticketera.com
            </a>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="gap-2 h-10 px-3"
            onClick={() => void handleRefresh()}
            disabled={isRefreshing}
            title="Refrescar datos del dashboard"
          >
            <RefreshCcw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            <span className="hidden md:inline">{isRefreshing ? "Actualizando..." : "Refrescar"}</span>
          </Button>
          {puedeCrearEventos ? (
            <Button asChild className="gap-2 h-10 px-4">
              <Link href="/dashboard/eventos/nuevo" aria-label="Crear evento">
                <Plus className="h-4 w-4" />
                <span className="hidden sm:inline">Crear evento</span>
              </Link>
            </Button>
          ) : null}
          {mostrarIngresos ? (
            <Button
              variant="outline"
              className="gap-2 h-10 px-4"
              onClick={() => setCierreCajaDialogOpen(true)}
              aria-label="Exportar resumen"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Exportar resumen</span>
            </Button>
          ) : null}
        </div>
      </section>

      {(puedeVenderBarra || puedeVenderEntradas) ? (
        <section aria-label="Acciones rápidas de venta" className="grid gap-3 sm:grid-cols-2">
          {puedeVenderBarra ? (
            <Link
              href="/dashboard/consumibles/vender"
              className="group flex items-center gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-4 transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <CupSoda className="h-6 w-6" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-foreground">Vender en barra</p>
                <p className="text-xs text-muted-foreground">Cobrá consumibles y emití el QR al instante</p>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          ) : null}
          {puedeVenderEntradas ? (
            <Link
              href="/dashboard/pos"
              className="group flex items-center gap-4 rounded-2xl border border-primary/30 bg-primary/5 p-4 transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <Receipt className="h-6 w-6" aria-hidden />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-base font-semibold text-foreground">Vender entradas</p>
                <p className="text-xs text-muted-foreground">Cobrá entradas en puerta y emití el QR</p>
              </div>
              <ArrowRight className="h-5 w-5 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" aria-hidden />
            </Link>
          ) : null}
        </section>
      ) : null}

      {reconciliacionPendientes > 0 && !reconciliacionBannerDismissed ? (
        <div className="relative rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 transition-colors hover:bg-destructive/15">
          <Link
            href="/dashboard/reconciliacion"
            className="block pr-8"
          >
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div className="flex-1">
                <p className="font-semibold text-destructive">
                  {reconciliacionPendientes} pago{reconciliacionPendientes !== 1 ? "s" : ""} sin entrada emitida
                </p>
                <p className="mt-0.5 text-xs text-destructive/90">
                  Mercado Pago cobró pero la entrada no se generó. Revisalo y resolvelo desde
                  <span className="font-semibold"> Reconciliación</span> →
                </p>
              </div>
            </div>
          </Link>
          <button
            type="button"
            onClick={dismissReconciliacionBanner}
            className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-destructive/70 transition-colors hover:bg-destructive/20 hover:text-destructive"
            aria-label="Ocultar aviso por 6 horas"
            title="Ocultar por 6 horas"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : null}

      {!esEmpleado && (
        <PrimerosPassosCard
          salesReadiness={salesReadiness}
          eventos={eventos}
          eventosActivos={eventosActivos}
          sitioConfigurado={sitioConfigurado}
        />
      )}

      <DashboardMetricsGrid
        cards={cards}
        ingresosOcultos={ingresosOcultos}
        onToggleIngresos={() => setIngresosOcultos(!ingresosOcultos)}
        hideIcon={<EyeOff className="h-4 w-4" />}
        showIcon={<Eye className="h-4 w-4" />}
      />

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)] lg:items-stretch">
        <DashboardFeaturedEventCard
          eventoDestacadoActual={eventoDestacadoActual}
          etiquetaEventoDestacado={etiquetaEventoDestacado}
          eventoSeleccionado={eventoSeleccionado}
          ocupacionEventoDestacado={ocupacionEventoDestacado}
          eventosDestacados={eventosDestacados}
          eventoCarruselIndex={eventoCarruselIndex}
          onPrev={() => setEventoCarruselIndex((prev) => Math.max(prev - 1, 0))}
          onNext={() => setEventoCarruselIndex((prev) => Math.min(prev + 1, eventosDestacados.length - 1))}
          onOpenDetails={() => setEventoModalOpen(true)}
        />

        <DashboardFiltersCard
          eventoFiltro={eventoFiltro}
          eventos={eventos}
          periodo={periodo}
          onEventoChange={(value) => updateFiltros({ evento: value })}
          onDesdeChange={(value) => updateFiltros({ desde: value })}
          onHastaChange={(value) => updateFiltros({ hasta: value })}
          onReset={() => updateFiltros({ evento: "todos", desde: "", hasta: "" })}
          onPresetApply={(desde, hasta) => updateFiltros({ desde, hasta })}
        />
      </section>

      <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,0.9fr)]">
        <DashboardAnalyticsSection
          ventasPorDia={ventasPorDia}
          ventasPorEvento={ventasPorEvento}
          tooltipStyle={tooltipStyle}
        />

        <DashboardRecentSalesSection ultimasVentas={ultimasVentas} />
      </section>

      <DashboardInsightsSection
        topCategorias={topCategorias}
        heatmapHorario={heatmapHorario}
        puedeVerMontos={mostrarIngresos}
      />

      <DashboardEventDetailDialog
        open={eventoModalOpen}
        onOpenChange={setEventoModalOpen}
        eventoDestacadoActual={eventoDestacadoActual}
        mostrarIngresos={mostrarIngresos}
        ocupacionEventoDestacado={ocupacionEventoDestacado}
        eventoDetalleLoading={eventoDetalleLoading}
        eventoDetalleError={eventoDetalleError}
        eventoDetalle={eventoDetalle}
        empresaSlug={
          (session.user as { empresa_slug?: string | null; slug?: string | null }).empresa_slug ??
          (session.user as { empresa_slug?: string | null; slug?: string | null }).slug ??
          null
        }
        puedeEditarEventos={puede("editar_eventos")}
        puedeEscanear={puede("escanear")}
        puedeVerVentas={puede("ver_entradas")}
        puedeVerCompradores={puede("ver_compradores")}
      />

      {mostrarIngresos ? (
        <CierreCajaExportDialog
          open={cierreCajaDialogOpen}
          onOpenChange={setCierreCajaDialogOpen}
          eventos={eventos}
          initialPeriodo={periodo}
          initialEventoId={eventoFiltro}
        />
      ) : null}
    </div>
  )
}
