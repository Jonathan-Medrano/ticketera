"use client"

import { useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { writeDashboardSearchParam } from "@/lib/dashboard-grid-search"
import { useDashboardDebouncedSearch } from "@/lib/use-dashboard-debounced-search"
import Link from "next/link"
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Download,
  Eye,
  FileSpreadsheet,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Power,
  Search,
  Ticket,
  Trash2,
  TrendingUp,
  Users,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { IconAction } from "@/components/ui/icon-action"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { useLoading } from "@/components/loading-provider"
import Image from "next/image"
import { puedeHacer, type Permisos } from "@/lib/permisos"
import { formatMoney, formatInt, formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { getPublicationStatusLabel } from "@/lib/publication-status"

type EventoListItem = {
  id: string
  nombre: string
  imagen_url: string | null
  modo_fecha: "unica" | "multiple" | "pase"
  activo: number
  cantidad_fechas: number
  cantidad_categorias: number
  entradas_vendidas: number
  capacidad_total: number
  ingresos_bruto: number | null
  ingresos_neto: number | null
  ticket_promedio_bruto: number | null
  ticket_promedio_neto: number | null
  ventas_7d: number | null
  proxima_fecha: string | null
  publication_status: "hidden" | "listed" | "live"
  publication_reason: "manual_inactive" | "scheduled_hidden" | "scheduled_listed" | "scheduled_detail_visible" | "live"
}

type PerformerIngresosCard = {
  id: string
  nombre: string
  imagen_url: string | null
  ingresos_neto: number
} | null

type PerformerOcupacionCard = {
  id: string
  nombre: string
  imagen_url: string | null
  ocupacion_pct: number
} | null

type EventosSummary = {
  totales: {
    eventos_count: number
    eventos_activos: number
    total_bruto: number
    total_neto: number
    total_vendidas: number
    total_capacidad: number
    ocupacion_promedio: number | null
    ticket_promedio_bruto: number | null
    ticket_promedio_neto: number | null
  }
  performers: {
    top_por_ingresos: PerformerIngresosCard
    bottom_por_ingresos: PerformerIngresosCard
    top_por_ocupacion: PerformerOcupacionCard
    bottom_por_ocupacion: PerformerOcupacionCard
  }
}

interface Props {
  eventos: EventoListItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  summary: EventosSummary | null
  permisos?: Permisos
  esEmpleado?: boolean
}

// Badge de modo de fecha tokenizado: usamos el accent primary/marketing como
// color informativo (no semántico de estado), consistente con roles/equipo.
const modoBadge = {
  unica: {
    label: "Fecha única",
    color: "border-[color:var(--marketing-accent)]/30 bg-[color:var(--marketing-accent-soft)] text-[color:var(--marketing-accent)]",
  },
  multiple: {
    label: "Múltiples fechas",
    color: "border-primary/30 bg-primary/10 text-primary",
  },
  pase: {
    label: "Pase general",
    color: "border-border bg-muted text-muted-foreground",
  },
} as const

export default function EventosContent({ eventos, pagination, summary, permisos, esEmpleado }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const busqueda = searchParams.get("busqueda") ?? ""
  const sortBy = searchParams.get("sortBy") ?? "alta"
  const sortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc"
  const publicationStatus = searchParams.get("publication_status") ?? ""
  const pageSize = pagination.pageSize
  const rangeStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1
  const rangeEnd = Math.min(pagination.total, pagination.page * pagination.pageSize)
  const [isExporting, setIsExporting] = useState(false)
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false)
  const [exportEvento, setExportEvento] = useState("todos")
  const [exportDesde, setExportDesde] = useState("")
  const [exportHasta, setExportHasta] = useState("")
  const [exportSoloActivos, setExportSoloActivos] = useState(false)
  const [exportFormat, setExportFormat] = useState<"xlsx" | "csv">("xlsx")
  const { withLoading } = useLoading()
  const { value: busquedaInput, setValue: setBusquedaInput } = useDashboardDebouncedSearch({
    urlValue: busqueda,
    emit: (next) => updateQuery({ busqueda: next, page: 1 }),
  })
  const [seleccionados, setSeleccionados] = useState<Set<string>>(new Set())
  const [toggleTarget, setToggleTarget] = useState<EventoListItem | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<EventoListItem | null>(null)
  const [deleting, setDeleting] = useState(false)

  function toggleSeleccion(id: string) {
    setSeleccionados((prev) => {
      if (prev.has(id)) {
        const next = new Set(prev)
        next.delete(id)
        return next
      }
      if (prev.size >= 4) {
        toast.info("Máximo 4 eventos para comparar", { description: "Deseleccioná uno para agregar otro." })
        return prev
      }
      const next = new Set(prev)
      next.add(id)
      return next
    })
  }

  const puede = (permiso: keyof Permisos) => puedeHacer(permiso, esEmpleado ?? false, permisos)

  function updateQuery(next: {
    page?: number
    pageSize?: string
    busqueda?: string
    sortBy?: string
    sortDir?: "asc" | "desc"
    publication_status?: string
  }) {
    const params = new URLSearchParams(searchParams.toString())

    if (next.page !== undefined) params.set("page", String(next.page))

    if (next.pageSize !== undefined) {
      if (next.pageSize) params.set("pageSize", next.pageSize)
      else params.delete("pageSize")
    }

    if (next.busqueda !== undefined) {
      writeDashboardSearchParam(params, "busqueda", next.busqueda)
    }

    if (next.sortBy !== undefined) {
      if (next.sortBy) params.set("sortBy", next.sortBy)
      else params.delete("sortBy")
    }

    if (next.sortDir !== undefined) params.set("sortDir", next.sortDir)

    if (next.publication_status !== undefined) {
      if (next.publication_status) params.set("publication_status", next.publication_status)
      else params.delete("publication_status")
    }

    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }

  async function handleExportLiquidacion(format: "csv" | "xlsx") {
    if (isExporting) return
    if (exportDesde && exportHasta && exportDesde > exportHasta) {
      toast.error("La fecha 'desde' no puede ser posterior a la fecha 'hasta'")
      return
    }
    setIsExporting(true)
    try {
      const params = new URLSearchParams()
      params.set("format", format)
      if (exportEvento !== "todos") params.set("evento_id", exportEvento)
      if (exportDesde) params.set("desde", exportDesde)
      if (exportHasta) params.set("hasta", exportHasta)
      if (exportSoloActivos) params.set("solo_activos", "true")
      if (busqueda) params.set("busqueda", busqueda)

      const res = await fetch(`/api/eventos/liquidacion/export?${params.toString()}`)
      if (!res.ok) {
        toast.error("No se pudo exportar la liquidación")
        return
      }
      const blob = await res.blob()
      const disposition = res.headers.get("content-disposition")
      const filenameMatch = disposition?.match(/filename="?([^";]+)"?/)
      const filename = filenameMatch?.[1] ?? `liquidacion-eventos-${new Date().toISOString().slice(0, 10)}.${format}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success("Exportación lista")
      setIsExportDialogOpen(false)
    } catch {
      toast.error("No se pudo descargar la liquidación")
    } finally {
      setIsExporting(false)
    }
  }

  async function toggleEvento(id: string) {
    if (!puede("activar_eventos")) return

    await withLoading(async () => {
      const res = await fetch(`/api/eventos/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "toggle_activo" }),
      })

      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error ?? "No se pudo actualizar el evento")
        return
      }

      router.refresh()
    })
  }

  async function confirmToggleEvento() {
    if (!toggleTarget) return
    const target = toggleTarget
    setToggleTarget(null)
    await toggleEvento(target.id)
  }

  async function confirmDeleteEvento() {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleting(true)
    try {
      const res = await fetch(`/api/eventos/${target.id}`, { method: "DELETE" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error ?? "No se pudo borrar el evento")
        return
      }
      setDeleteTarget(null)
      toast.success("Evento borrado")
      router.refresh()
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="space-y-5 md:space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Eventos</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {pagination.total} evento{pagination.total !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {puede("ver_recaudacion") ? (
            <Button
              variant="outline"
              className="gap-2 h-10 px-4"
              onClick={() => setIsExportDialogOpen(true)}
              disabled={pagination.total === 0}
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">Exportar liquidación</span>
            </Button>
          ) : null}
          {puede("ver_kpis_eventos") ? (
            <Button variant="outline" className="gap-2 h-10 px-4" asChild>
              <Link href="/dashboard/eventos/velocity">
                <TrendingUp className="h-4 w-4" />
                <span className="hidden sm:inline">Velocidad de ventas</span>
              </Link>
            </Button>
          ) : null}
          {puede("crear_eventos") ? (
            <Button className="gap-2 h-10 px-6" asChild>
              <Link href="/dashboard/eventos/nuevo">
                <Plus className="h-4 w-4" /> Nuevo evento
              </Link>
            </Button>
          ) : null}
        </div>
      </div>

      {summary !== null ? (
        <EventosHeroCard summary={summary} />
      ) : null}

      <section className="rounded-panel border border-border bg-card p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          {/* Row-switch alineado con el breakpoint xl: de los SelectTrigger (xl:w-44/xl:w-40)
              para evitar el rango 640-1279px donde quedaban 3 selects w-full amontonados
              en fila (ver roles-content.tsx: ahí ambos breakpoints coinciden en sm:). */}
          <div className="flex flex-col gap-3 xl:flex-row xl:flex-1">
            <Select value={sortBy} onValueChange={(value) => updateQuery({ sortBy: value, page: 1 })}>
              <SelectTrigger className="h-11 w-full bg-background xl:w-44">
                <SelectValue placeholder="Ordenar por" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="alta">Alta</SelectItem>
                <SelectItem value="proxima_fecha">Próxima fecha</SelectItem>
                <SelectItem value="nombre">Nombre</SelectItem>
                <SelectItem value="estado">Estado</SelectItem>
                <SelectItem value="fechas">Fechas</SelectItem>
                <SelectItem value="categorias">Categorías</SelectItem>
                <SelectItem value="vendidas">Vendidas</SelectItem>
                <SelectItem value="capacidad">Capacidad</SelectItem>
                <SelectItem value="ocupacion">Ocupación</SelectItem>
                {puede("ver_kpis_eventos") ? (
                  <SelectItem value="ingresos">Ingresos netos</SelectItem>
                ) : null}
                {puede("ver_kpis_eventos") ? (
                  <SelectItem value="ticket_promedio">Ticket promedio</SelectItem>
                ) : null}
                {puede("ver_kpis_eventos") ? (
                  <SelectItem value="ventas_7d">Ventas 7d</SelectItem>
                ) : null}
              </SelectContent>
            </Select>

            <Select value={sortDir} onValueChange={(value) => updateQuery({ sortDir: value as "asc" | "desc", page: 1 })}>
              <SelectTrigger className="h-11 w-full bg-background xl:w-40">
                <SelectValue placeholder="Dirección" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="desc">Descendente</SelectItem>
                <SelectItem value="asc">Ascendente</SelectItem>
              </SelectContent>
            </Select>

            <Select value={publicationStatus || "all"} onValueChange={(value) => updateQuery({ publication_status: value === "all" ? undefined : value, page: 1 })}>
              <SelectTrigger className="h-11 w-full bg-background xl:w-44">
                <SelectValue placeholder="Estado de publicación" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="live">Live</SelectItem>
                <SelectItem value="listed">Listado</SelectItem>
                <SelectItem value="hidden">Oculto (programado)</SelectItem>
                <SelectItem value="manual_inactive">Inactivo manual</SelectItem>
              </SelectContent>
            </Select>

            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className="h-11 border-border bg-background pl-9"
                placeholder="Buscar por evento o categoría..."
                value={busquedaInput}
                onChange={(e) => setBusquedaInput(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 xl:items-center xl:justify-end">
            <Select value={String(pageSize)} onValueChange={(value) => updateQuery({ pageSize: value, page: 1 })}>
              <SelectTrigger className="h-10 w-24 bg-background">
                <SelectValue placeholder="25" />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((size) => (
                  <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
              <span>{rangeStart}-{rangeEnd} de {pagination.total}</span>
              <Badge variant="outline" className="rounded-full px-3 py-1">{pagination.page}/{pagination.totalPages}</Badge>
            </div>

            <div className="flex items-center gap-1">
              <IconAction label="Primera página" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: 1 })} disabled={pagination.page <= 1}>
                <ChevronsLeft className="h-4 w-4" />
              </IconAction>
              <IconAction label="Página anterior" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: pagination.page - 1 })} disabled={pagination.page <= 1}>
                <ChevronLeft className="h-4 w-4" />
              </IconAction>
              <IconAction label="Página siguiente" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: pagination.page + 1 })} disabled={pagination.page >= pagination.totalPages}>
                <ChevronRight className="h-4 w-4" />
              </IconAction>
              <IconAction label="Última página" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: pagination.totalPages })} disabled={pagination.page >= pagination.totalPages}>
                <ChevronsRight className="h-4 w-4" />
              </IconAction>
            </div>
          </div>
        </div>
      </section>

      {eventos.length === 0 ? (
        <section className="rounded-panel border border-border bg-card px-6 py-14 text-center shadow-sm md:px-10 md:py-20">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <CalendarDays className="h-7 w-7" />
          </div>
          <h3 className="mt-5 text-xl font-semibold text-foreground">
            {busqueda ? "No se encontraron eventos" : "Todavía no tenés eventos"}
          </h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-7 text-muted-foreground">
            {busqueda ? "Probá con otro término de búsqueda para encontrar tu agenda." : "Creá tu primer evento y empezá a construir tu agenda comercial desde el dashboard."}
          </p>

          {!busqueda && puede("crear_eventos") ? (
            <Button className="mt-6 gap-2 rounded-full" asChild>
              <Link href="/dashboard/eventos/nuevo">
                <Plus className="h-4 w-4" />
                Crear primer evento
              </Link>
            </Button>
          ) : null}
        </section>
      ) : (
        <section className="space-y-4">
          {eventos.map((evento) => {
            const modo = modoBadge[evento.modo_fecha]
            const porcentaje = evento.capacidad_total > 0 ? Math.round((evento.entradas_vendidas / evento.capacidad_total) * 100) : 0

            return (
              <article
                key={evento.id}
                className="overflow-hidden rounded-panel border border-border bg-card p-4 shadow-sm transition-all hover:shadow-[0_18px_48px_rgba(15,23,42,0.08)] md:p-5"
              >
                <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
                  <div className="flex items-start gap-3 shrink-0">
                    <div className="flex h-20 items-center pl-1">
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Checkbox
                              checked={seleccionados.has(evento.id)}
                              onCheckedChange={() => toggleSeleccion(evento.id)}
                              disabled={!seleccionados.has(evento.id) && seleccionados.size >= 4}
                              aria-label={`Seleccionar evento ${evento.nombre} para comparar`}
                              className="relative after:absolute after:-inset-3 after:content-['']"
                            />
                          </TooltipTrigger>
                          <TooltipContent>Marcá para comparar (hasta 4 eventos)</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <div className="relative h-20 w-20 overflow-hidden rounded-card-sm bg-muted shrink-0">
                      {evento.imagen_url ? (
                        <Image src={evento.imagen_url} alt={evento.nombre} fill className="object-cover" unoptimized />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                          <CalendarDays className="h-7 w-7" />
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="min-w-0 flex-1">
                    {/* lg: (no xl:) para que Ver/Editar/Activar queden al lado del título
                        ya desde laptops de 1024px, no recién en 1280px. */}
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline" className={modo.color}>
                            {modo.label}
                          </Badge>
                          <Badge
                            variant="outline"
                            className={cn(
                              evento.activo
                                ? "border-primary/30 bg-primary/10 text-primary"
                                : "border-border bg-muted text-muted-foreground"
                            )}
                          >
                            {evento.activo ? "Activo" : "Inactivo"}
                          </Badge>
                          {/* Segundo badge, independiente de `activo`: refleja publication_status
                              real (si el evento está en vivo/listado/oculto para el público). */}
                          <Badge variant="outline" className="border-border bg-muted text-muted-foreground">
                            {getPublicationStatusLabel(evento.publication_status)}
                          </Badge>
                        </div>

                        <h3 className="mt-3 truncate text-lg font-semibold text-foreground md:text-xl">
                          {evento.nombre}
                        </h3>

                        <div className="mt-4 grid gap-2 sm:grid-cols-3">
                          <InfoPill
                            icon={CalendarDays}
                            text={
                              evento.cantidad_fechas > 0
                                ? `${evento.cantidad_fechas} fecha${evento.cantidad_fechas !== 1 ? "s" : ""} · ${evento.proxima_fecha ? formatDateTime(evento.proxima_fecha) : "Finalizado"}`
                                : "Sin fechas"
                            }
                          />
                          <InfoPill icon={Ticket} text={`${evento.cantidad_categorias} categoría${evento.cantidad_categorias !== 1 ? "s" : ""}`} />
                          <InfoPill icon={Users} text={`${formatInt(evento.entradas_vendidas)} / ${formatInt(evento.capacidad_total)} vendidas`} />
                        </div>

                        {puede("ver_kpis_eventos") ? (
                          <div className="mt-2 grid gap-2 sm:grid-cols-3">
                            <KpiPill
                              label="Ingresos netos"
                              value={evento.ingresos_neto != null ? formatMoney(evento.ingresos_neto) : "—"}
                              mono
                            />
                            <KpiPill
                              label="Ticket promedio"
                              value={
                                evento.ticket_promedio_bruto != null && evento.ticket_promedio_neto != null
                                  ? `${formatMoney(evento.ticket_promedio_bruto)} / ${formatMoney(evento.ticket_promedio_neto)}`
                                  : "—"
                              }
                              mono
                            />
                            <KpiPill
                              label="Ventas 7d"
                              value={evento.ventas_7d != null ? formatInt(evento.ventas_7d) : "—"}
                              mono
                            />
                          </div>
                        ) : null}
                      </div>

                      <div className="flex items-center gap-1 self-start lg:pl-4">
                        <IconAction href={`/dashboard/eventos/${evento.id}`} label="Ver detalle del evento" variant="ghost" size="sm" className="h-11 w-11 p-0 rounded-xl">
                          <Eye className="h-4 w-4" />
                        </IconAction>

                        {puede("editar_eventos") ? (
                          <IconAction href={`/dashboard/eventos/${evento.id}/editar`} label="Editar evento" variant="ghost" size="sm" className="h-11 w-11 p-0 rounded-xl">
                            <Pencil className="h-4 w-4" />
                          </IconAction>
                        ) : null}

                        {puede("activar_eventos") ? (
                          <IconAction
                            label={evento.activo ? "Desactivar evento" : "Activar evento"}
                            variant="ghost"
                            size="sm"
                            className={cn(
                              "h-11 w-11 rounded-xl p-0",
                              evento.activo
                                ? "text-amber-500 hover:bg-amber-500/10 hover:text-amber-600"
                                : "text-success hover:bg-success/5 hover:text-success"
                            )}
                            onClick={() => setToggleTarget(evento)}
                          >
                            <Power className="h-4 w-4" />
                          </IconAction>
                        ) : null}

                        {puede("eliminar_eventos") ? (
                          <IconAction
                            label="Borrar evento"
                            variant="ghost"
                            size="sm"
                            className="h-11 w-11 rounded-xl p-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={evento.entradas_vendidas > 0}
                            disabledReason='No se puede borrar: ya tiene entradas vendidas. Usá "Desactivar evento" en su lugar.'
                            onClick={() => setDeleteTarget(evento)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </IconAction>
                        ) : null}
                      </div>
                    </div>

                    {evento.capacidad_total > 0 ? (
                      <div className="mt-5 pt-2">
                        <div className="flex items-center justify-between gap-3 text-sm">
                          <span className="text-muted-foreground">Capacidad vendida</span>
                          <span className="font-semibold text-foreground tabular-nums">{porcentaje}%</span>
                        </div>
                        <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                          <div
                            className="h-full rounded-full bg-[linear-gradient(90deg,var(--primary)_0%,var(--marketing-accent)_100%)] transition-all"
                            style={{ width: `${Math.min(100, porcentaje)}%` }}
                          />
                        </div>
                        <p className="mt-2 text-xs text-muted-foreground tabular-nums">
                          {formatInt(evento.entradas_vendidas)} vendidas sobre {formatInt(evento.capacidad_total)} disponibles.
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </article>
            )
          })}
        </section>
      )}

      {seleccionados.size > 0 && (
        <div
          // right-[5.5rem] (88px) deja libre la esquina inferior derecha para el FAB de Victoria
          // (56px desde right-4), evitando que ambos botones flotantes se apilen.
          className="fixed bottom-6 right-[5.5rem] z-50"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <Button
            size="lg"
            className="gap-2 shadow-lg shadow-primary/30"
            disabled={seleccionados.size < 2}
            aria-label={`Comparar ${seleccionados.size} evento${seleccionados.size !== 1 ? "s" : ""} seleccionado${seleccionados.size !== 1 ? "s" : ""}`}
            onClick={() =>
              router.push(`/dashboard/eventos/comparar?ids=${[...seleccionados].join(",")}`)
            }
          >
            Comparar ({seleccionados.size})
          </Button>
        </div>
      )}

      <Dialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Exportar liquidación</DialogTitle>
            <DialogDescription>Elegí el formato y los filtros del reporte.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">Evento</label>
              <Select value={exportEvento} onValueChange={setExportEvento} disabled={isExporting}>
                <SelectTrigger className="h-11 w-full bg-background"><SelectValue placeholder="Todos los eventos" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos los eventos</SelectItem>
                  {eventos.map((evento) => (
                    <SelectItem key={evento.id} value={evento.id}>{evento.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">Fecha desde</label>
                <Input
                  type="date"
                  className="h-11 min-w-0 bg-background"
                  value={exportDesde}
                  max={exportHasta || undefined}
                  disabled={isExporting}
                  onChange={(event) => setExportDesde(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">Fecha hasta</label>
                <Input
                  type="date"
                  className="h-11 min-w-0 bg-background"
                  value={exportHasta}
                  min={exportDesde || undefined}
                  disabled={isExporting}
                  onChange={(event) => setExportHasta(event.target.value)}
                />
              </div>
            </div>
            <div className="flex justify-end">
              <label className="flex items-center gap-3 cursor-pointer">
                <Checkbox
                  checked={exportSoloActivos}
                  onCheckedChange={(checked) => setExportSoloActivos(checked === true)}
                  disabled={isExporting}
                />
                <span className="text-sm font-medium text-foreground">Solo eventos activos</span>
              </label>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">Formato</label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={exportFormat === "xlsx" ? "default" : "outline"}
                  className="h-9 gap-2"
                  onClick={() => setExportFormat("xlsx")}
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Excel
                </Button>
                <Button
                  type="button"
                  variant={exportFormat === "csv" ? "default" : "outline"}
                  className="h-9 gap-2"
                  onClick={() => setExportFormat("csv")}
                >
                  <FileText className="h-4 w-4" />
                  CSV
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={() => setIsExportDialogOpen(false)} disabled={isExporting}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleExportLiquidacion(exportFormat)} disabled={isExporting} className="gap-2">
              {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isExporting ? "Exportando..." : "Exportar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={toggleTarget !== null} onOpenChange={(open) => { if (!open) setToggleTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {toggleTarget?.activo ? "Desactivar evento" : "Activar evento"}
            </DialogTitle>
            <DialogDescription>
              {toggleTarget?.activo
                ? <>El evento <span className="font-semibold text-foreground">{toggleTarget?.nombre}</span> dejará de estar disponible para la venta y no será visible públicamente. Podés reactivarlo cuando quieras.</>
                : <>El evento <span className="font-semibold text-foreground">{toggleTarget?.nombre}</span> volverá a estar disponible para la venta según su configuración de publicación.</>}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={() => setToggleTarget(null)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant={toggleTarget?.activo ? "destructive" : "default"}
              className="gap-2"
              onClick={() => void confirmToggleEvento()}
            >
              <Power className="h-4 w-4" />
              {toggleTarget?.activo ? "Desactivar" : "Activar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Borrar evento</DialogTitle>
            <DialogDescription>
              El evento <span className="font-semibold text-foreground">{deleteTarget?.nombre}</span> se va a borrar
              definitivamente, junto con sus fechas, tandas y categorías. Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="gap-2"
              onClick={() => void confirmDeleteEvento()}
              disabled={deleting}
            >
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Borrar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function InfoPill({
  icon: Icon,
  text,
}: {
  icon: React.ComponentType<{ className?: string }>
  text: string
}) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-border bg-background/70 px-3 py-2 text-xs text-muted-foreground">
      <Icon className="h-3.5 w-3.5 text-[color:var(--marketing-accent)]" />
      <span className="truncate">{text}</span>
    </div>
  )
}

function KpiPill({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-border bg-background/70 px-3 py-2 text-xs">
      <span className="text-muted-foreground truncate">{label}</span>
      <span className={cn("ml-2 shrink-0 font-semibold text-foreground tabular-nums", mono && "font-mono")}>{value}</span>
    </div>
  )
}

function EventosHeroCard({ summary }: { summary: EventosSummary }) {
  if (summary.totales.eventos_count === 0) {
    return (
      <section className="rounded-panel border border-border bg-card p-6 shadow-sm">
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
            <CalendarDays className="h-6 w-6 text-muted-foreground" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">Sin datos para los filtros actuales</p>
            <p className="mt-1 text-xs text-muted-foreground">Cambiá los filtros o creá un evento para ver estadísticas.</p>
          </div>
        </div>
      </section>
    )
  }

  const formatPct = (n: number | null) => (n != null ? `${n.toFixed(1)}%` : "—")

  return (
    <section className="rounded-panel border border-border bg-card p-4 shadow-sm md:p-5 space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <HeroKpiTile label="Recaudación bruta" value={formatMoney(summary.totales.total_bruto)} mono />
        <HeroKpiTile label="Recaudación neta" value={formatMoney(summary.totales.total_neto)} mono />
        <HeroKpiTile label="Eventos activos" value={formatInt(summary.totales.eventos_activos)} mono />
        <HeroKpiTile label="Ocupación promedio" value={formatPct(summary.totales.ocupacion_promedio)} mono />
      </div>

    </section>
  )
}

function HeroKpiTile({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-background/70 p-4 space-y-2">
      <p className="text-xs font-medium text-muted-foreground truncate">{label}</p>
      <p
        className={cn(
          "truncate text-xl font-bold tracking-[-0.04em] text-foreground tabular-nums md:text-2xl",
          mono && "font-mono"
        )}
      >
        {value}
      </p>
    </div>
  )
}
