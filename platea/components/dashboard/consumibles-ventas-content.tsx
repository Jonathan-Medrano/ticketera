"use client"

import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { IconAction } from "@/components/ui/icon-action"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ShoppingBag,
  Eye,
  EyeOff,
  X,
  TrendingUp,
  Receipt,
  CheckCircle2,
  XCircle,
  Columns3,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronDown,
  Search,
  FileSpreadsheet,
  FileText,
  Download,
  Loader2,
} from "lucide-react"
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { puedeHacer, type Permisos } from "@/lib/permisos"
import type { ConsumiblesVentasQueryScope } from "@/lib/dashboard-query-scope"
import { readConsumiblesVentasQuery, writeConsumiblesVentasQuery } from "@/lib/dashboard-query-scope"
import { useDashboardDebouncedSearch } from "@/lib/use-dashboard-debounced-search"
import { useLoading } from "@/components/loading-provider"
import { getConsumiblesTicketActions } from "@/components/dashboard/consumibles-ventas-helpers"
import { cn } from "@/lib/utils"
import { formatMoney, formatInt, formatDateTime } from "@/lib/format"
import type { ConsumiblesSummary } from "@/app/(empresa)/dashboard/ventas/page"

const CONSUMIBLES_EXPORT_GENERIC_ERROR = "No pudimos exportar las ventas de consumibles. Refiná los filtros e intentá de nuevo."
const CONSUMIBLES_STATE_OPTIONS = [
  { value: "pendiente", label: "Válidas" },
  { value: "canjeado", label: "Usadas" },
  { value: "cancelado", label: "Reembolsadas" },
  { value: "resuelto_parcial", label: "Parciales" },
] as const

export function resolveConsumiblesExportErrorMessage(payload: { error?: unknown } | null | undefined) {
  return typeof payload?.error === "string" && payload.error.trim()
    ? payload.error
    : CONSUMIBLES_EXPORT_GENERIC_ERROR
}

function parseConsumiblesStateSelection(raw: string | undefined) {
  const selected = new Set((raw ?? "").split(",").map((value) => value.trim()).filter(Boolean))
  const normalized = CONSUMIBLES_STATE_OPTIONS.filter((option) => selected.has(option.value)).map((option) => option.value)
  return normalized.length === 0 ? CONSUMIBLES_STATE_OPTIONS.map((option) => option.value) : normalized
}

function buildConsumiblesStateQuery(selected: string[]) {
  const normalized = CONSUMIBLES_STATE_OPTIONS.filter((option) => selected.includes(option.value)).map((option) => option.value)
  if (normalized.length === 0 || normalized.length === CONSUMIBLES_STATE_OPTIONS.length) return ""
  return normalized.join(",")
}

function summarizeConsumiblesStateSelection(selected: string[]) {
  const normalized = CONSUMIBLES_STATE_OPTIONS.filter((option) => selected.includes(option.value))
  if (normalized.length === 0 || normalized.length === CONSUMIBLES_STATE_OPTIONS.length) return "Todos los estados"
  return normalized.map((option) => option.label).join(", ")
}

function buildConsumiblesExportRequestUrl(
  exportPath: string,
  eventoId: string,
  estado: string,
  exportAllPeriod: boolean,
  desde: string,
  hasta: string,
) {
  const url = new URL(exportPath, "https://platea.local")
  if (eventoId && eventoId !== "todos") url.searchParams.set("evento_id", eventoId)
  else url.searchParams.delete("evento_id")
  if (estado && estado !== "todos") url.searchParams.set("estado", estado)
  else url.searchParams.delete("estado")
  if (exportAllPeriod) {
    url.searchParams.delete("desde")
    url.searchParams.delete("hasta")
  } else {
    if (desde) url.searchParams.set("desde", desde)
    else url.searchParams.delete("desde")
    if (hasta) url.searchParams.set("hasta", hasta)
    else url.searchParams.delete("hasta")
  }
  return `${url.pathname}${url.search}`
}

function resolveCsvFileName(disposition: string | null | undefined, fallback: string) {
  return disposition?.match(/filename="?([^";]+)"?/)?.[1] ?? fallback
}

type ConsumiblesExportFormat = "csv" | "xlsx"

export function ConsumiblesExportAction({ exportPath, eventos, defaultEventoId = "todos", defaultEstado = "todos" }: { exportPath?: string; eventos: { id: string; nombre: string }[]; defaultEventoId?: string; defaultEstado?: string }) {
  const [isExporting, setIsExporting] = useState(false)
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false)
  const [exportEventoId, setExportEventoId] = useState(defaultEventoId)
  const [exportEstado, setExportEstado] = useState(defaultEstado)
  const [exportAllPeriod, setExportAllPeriod] = useState(true)
  const [exportDesde, setExportDesde] = useState("")
  const [exportHasta, setExportHasta] = useState("")
  const [exportEstados, setExportEstados] = useState<string[]>(() => parseConsumiblesStateSelection(defaultEstado))
  const [exportFormat, setExportFormat] = useState<ConsumiblesExportFormat>("xlsx")

  async function handleExport(format: ConsumiblesExportFormat) {
    if (!exportPath || isExporting) return
    setIsExporting(true)

    try {
      const requestUrl = `${buildConsumiblesExportRequestUrl(exportPath, exportEventoId, buildConsumiblesStateQuery(exportEstados), exportAllPeriod, exportDesde, exportHasta)}${buildConsumiblesExportRequestUrl(exportPath, exportEventoId, buildConsumiblesStateQuery(exportEstados), exportAllPeriod, exportDesde, exportHasta).includes('?') ? '&' : '?'}format=${format}`
      const response = await fetch(requestUrl, { method: "GET" })
      if (!response.ok) { toast.error("No se pudo exportar"); return }
      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = downloadUrl
      link.download = resolveCsvFileName(response.headers.get("content-disposition"), format === "xlsx" ? "consumibles-ventas-export.xlsx" : "consumibles-ventas-export.csv")
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(downloadUrl)
      toast.success("Exportación lista")
    } finally {
      setIsExporting(false)
      setIsExportDialogOpen(false)
    }
  }

  if (!exportPath) return null

  return (
    <>
      <Button type="button" variant="default" disabled={isExporting} onClick={() => setIsExportDialogOpen(true)} data-export-path={exportPath} className="h-11 px-6 text-sm font-semibold shadow-sm">
        {isExporting ? "Procesando..." : "Exportar"}
      </Button>
      <Dialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Exportar consumibles</DialogTitle>
            <DialogDescription>Elegí el formato y los filtros del reporte.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">Evento</label>
                <Select value={exportEventoId} onValueChange={setExportEventoId}>
                  <SelectTrigger className="h-11 w-full bg-background"><SelectValue placeholder="Todos los eventos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos los eventos</SelectItem>
                    {eventos.map((evento) => <SelectItem key={evento.id} value={evento.id}>{evento.nombre}</SelectItem>)}
                  </SelectContent>
                </Select>
            </div>
            <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">Estado</label>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" variant="outline" className="h-11 w-full justify-between bg-background font-normal">
                      <span className="truncate">{summarizeConsumiblesStateSelection(exportEstados)}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-64">
                    <DropdownMenuLabel>Estados</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {CONSUMIBLES_STATE_OPTIONS.map((option) => (
                      <DropdownMenuCheckboxItem
                        key={option.value}
                        checked={exportEstados.includes(option.value)}
                        onCheckedChange={(checked) => {
                          const next = checked === true
                            ? [...exportEstados, option.value]
                            : exportEstados.filter((value) => value !== option.value)
                          setExportEstados(next.length === 0 ? CONSUMIBLES_STATE_OPTIONS.map((item) => item.value) : Array.from(new Set(next)))
                        }}
                      >
                        {option.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">Desde</label>
                <Input type="date" className="h-11 min-w-0 bg-background" value={exportDesde} max={exportHasta || undefined} disabled={exportAllPeriod || isExporting} onChange={(event) => setExportDesde(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">Hasta</label>
                <Input type="date" className="h-11 min-w-0 bg-background" value={exportHasta} min={exportDesde || undefined} disabled={exportAllPeriod || isExporting} onChange={(event) => setExportHasta(event.target.value)} />
              </div>
              <label className="flex h-11 items-center gap-3 px-3 cursor-pointer bg-transparent">
                <Checkbox
                  checked={exportAllPeriod}
                  onCheckedChange={(checked) => setExportAllPeriod(checked === true)}
                />
                <span className="text-sm font-medium text-foreground">Todo</span>
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
            <Button type="button" variant="outline" onClick={() => setIsExportDialogOpen(false)} disabled={isExporting}>Cancelar</Button>
            <Button type="button" onClick={() => void handleExport(exportFormat)} disabled={isExporting} className="gap-2">
              {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isExporting ? "Exportando..." : "Exportar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

const estadoConfig = {
  pendiente: {
    label: "Válida",
    class: "border-success/25 bg-success/12 text-success",
  },
  canjeado: {
    label: "Usada",
    class: "border-border bg-muted text-muted-foreground",
  },
  cancelado: {
    label: "Reembolsada",
    class: "border-red-500/25 bg-red-500/12 text-red-700 dark:text-red-400",
  },
  resuelto_parcial: {
    label: "Parcial",
    class: "border-amber-500/25 bg-amber-500/12 text-amber-700 dark:text-amber-400",
  },
}

interface Ticket {
  id: string
  clave_corta: string
  estado: "pendiente" | "canjeado" | "cancelado" | "resuelto_parcial"
  total: number | null
  neto_empresa_amount?: number | null
  delivered_amount?: number | null
  refunded_amount?: number | null
  barra_nombre?: string | null
  evento_nombre?: string | null
  created_at: string
  items?: TicketItem[]
}

interface TicketItem {
  id: string
  consumible_id?: string
  consumible_nombre: string
  cantidad: number
  precio_unitario: number
  subtotal: number
  cantidad_entregada?: number | null
  cantidad_reembolsada?: number | null
}

interface PaginationMeta {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

type VentasConsumiblesStats = {
  total_tickets: number
  total_neto_acreditado: number | null
  total_bruto: number | null
  total_pendientes: number
  total_canjeados: number
  total_cancelados: number
}

type IngresoConsumibleEvento = {
  evento_id: string
  evento_nombre: string
  total_tickets: number
  total_neto_acreditado: number | null
  total_bruto: number | null
  total_cancelados: number
}

export default function ConsumiblesVentasContent({
  ventas,
  eventos,
  stats,
  ingresosPorEvento,
  pagination,
  initialDetalleVentaId = null,
  mode = "page",
  queryScope = "",
  exportPath,
  recoverableError,
  permisos,
  esEmpleado,
  summary = null,
}: {
  ventas: Ticket[]
  eventos: { id: string; nombre: string }[]
  stats: VentasConsumiblesStats
  ingresosPorEvento: IngresoConsumibleEvento[]
  pagination: PaginationMeta
  initialDetalleVentaId?: string | null
  mode?: "page" | "embedded" | "tab"
  queryScope?: ConsumiblesVentasQueryScope
  exportPath?: string
  recoverableError?: string | null
  permisos?: Permisos
  esEmpleado?: boolean
  summary?: ConsumiblesSummary | null
}) {
  const puede = (permiso: keyof Permisos) => puedeHacer(permiso, esEmpleado ?? false, permisos)
  const puedeVerTotales = puede("ver_totales_consumibles") || puede("ver_recaudacion")
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { withLoading } = useLoading()
  const query = readConsumiblesVentasQuery(searchParams, queryScope)
  const busqueda = query.busqueda ?? ""
  const eventoId = query.evento_id ?? ""
  const barraId = query.barra_id ?? ""
  const estadoFiltro = query.estado ?? "todos"
  const desdeFiltro = query.desde ?? ""
  const hastaFiltro = query.hasta ?? ""
  const sortBy = query.sortBy ?? "alta"
  const sortDir = query.sortDir === "asc" ? "asc" : "desc"
  const [totalesOcultos, setTotalesOcultos] = useState(false)
  const [netoPorEventoCollapsed, setNetoPorEventoCollapsed] = useState(true)
  const [filtroEventoDraft, setFiltroEventoDraft] = useState(eventoId || "_todos")
  const [filtroBarraDraft, setFiltroBarraDraft] = useState(barraId || "_todas")
  const [barras, setBarras] = useState<{ id: string; nombre: string }[]>([])
  const [filtroEstadosDraft, setFiltroEstadosDraft] = useState<string[]>(() => parseConsumiblesStateSelection(estadoFiltro))
  const [filtroDesdeDraft, setFiltroDesdeDraft] = useState(desdeFiltro)
  const [filtroHastaDraft, setFiltroHastaDraft] = useState(hastaFiltro)
  const [filtroTodoDraft, setFiltroTodoDraft] = useState(!desdeFiltro && !hastaFiltro)
  const [columnasVisibles, setColumnasVisibles] = useState({
    estado: true,
    total: true,
    barra: true,
    evento: true,
    fecha: true,
  })
  const pageSize = pagination.pageSize
  const rangeStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1
  const rangeEnd = Math.min(pagination.total, pagination.page * pagination.pageSize)

  const [detalle, setDetalle] = useState<Ticket | null>(() => {
    if (!initialDetalleVentaId) return null
    return ventas.find((venta) => venta.id === initialDetalleVentaId) ?? null
  })
  const [cancelando, setCancelando] = useState<Ticket | null>(null)
  const { value: busquedaInput, setValue: setBusquedaInput } = useDashboardDebouncedSearch({
    urlValue: busqueda,
    emit: (next) => updateQuery({ busqueda: next, page: 1 }),
  })

  function getResolvedCounts(item: TicketItem) {
    const entregada = Number(item.cantidad_entregada ?? 0)
    const reembolsada = Number(item.cantidad_reembolsada ?? 0)
    const hasResolution = item.cantidad_entregada != null || item.cantidad_reembolsada != null

    return { entregada, reembolsada, hasResolution }
  }

  useEffect(() => {
    // Sincroniza los drafts de filtro con los params de URL cuando estos cambian.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs draft filter state from URL params
    setFiltroEventoDraft(eventoId || "_todos")
    setFiltroBarraDraft(barraId || "_todas")
    setFiltroEstadosDraft(parseConsumiblesStateSelection(estadoFiltro))
    setFiltroDesdeDraft(desdeFiltro)
    setFiltroHastaDraft(hastaFiltro)
    setFiltroTodoDraft(!desdeFiltro && !hastaFiltro)
  }, [eventoId, barraId, estadoFiltro, desdeFiltro, hastaFiltro])

  useEffect(() => {
    const eventoIdResolved = filtroEventoDraft !== "_todos" ? filtroEventoDraft : ""
    if (!eventoIdResolved) {
      // Sin evento seleccionado: limpiamos las barras (acompaña el fetch externo del efecto).
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets dependent fetch state when no event selected
      setBarras([])
      setFiltroBarraDraft("_todas")
      return
    }
    void fetch(`/api/consumibles/barras?evento_id=${encodeURIComponent(eventoIdResolved)}`)
      .then((r) => r.json())
      .then((data: { data?: { id: string; nombre: string }[] }) => {
        setBarras(data.data ?? [])
      })
      .catch(() => setBarras([]))
  }, [filtroEventoDraft])

  function updateQuery(next: { page?: number; pageSize?: string; busqueda?: string; evento_id?: string; barra_id?: string; estado?: string; desde?: string; hasta?: string; sortBy?: string; sortDir?: "asc" | "desc" }) {
    const params = writeConsumiblesVentasQuery(searchParams, next, queryScope)

    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }

  function toggleSort(column: string) {
    const nextDir: "asc" | "desc" = sortBy === column && sortDir === "asc" ? "desc" : "asc"
    updateQuery({ sortBy: column, sortDir: nextDir, page: 1 })
  }

  function getSortIcon(column: string) {
    if (sortBy !== column) return <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
    return sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
  }

  function applyGridFilters() {
    updateQuery({
      evento_id: filtroEventoDraft === "_todos" ? "" : filtroEventoDraft,
      barra_id: filtroBarraDraft === "_todas" ? "" : filtroBarraDraft,
      estado: buildConsumiblesStateQuery(filtroEstadosDraft),
      desde: filtroTodoDraft ? "" : filtroDesdeDraft,
      hasta: filtroTodoDraft ? "" : filtroHastaDraft,
      page: 1,
    })
  }

  async function verDetalle(ticket: Ticket) {
    if (ticket.items) { setDetalle(ticket); return }
    const res = await fetch(`/api/consumibles/ventas/${ticket.id}`)
    const data = await res.json()
    const completo = { ...ticket, items: data.venta?.items ?? [] }
    setDetalle(completo)
  }

  async function confirmarCancelar() {
    if (!cancelando) return
    await withLoading(async () => {
      const res = await fetch(`/api/consumibles/ventas/${cancelando.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accion: "cancelar" }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.error ?? "No se pudo cancelar el ticket")
        return
      }
      if (detalle?.id === cancelando.id) {
        setDetalle((d) => d ? { ...d, estado: "cancelado" } : d)
      }
      toast.success("Ticket cancelado y reembolsado")
      router.refresh()
      setCancelando(null)
    })
  }

  const headingTag = mode === "embedded" ? "h2" : "h1"
  const Heading = headingTag as "h1" | "h2"
  const title = mode === "tab" ? "Consumibles" : "Historial de ventas"
  const subtitle =
    mode === "embedded"
      ? "Sección embebida de consumibles del dashboard"
      : mode === "tab"
        ? `${pagination.total} ticket${pagination.total !== 1 ? "s" : ""} de consumibles`
        : `${pagination.total} ticket${pagination.total !== 1 ? "s" : ""} de consumibles`

  if (recoverableError) {
    return (
      <div className="space-y-6">
        <div>
          <Heading className="text-2xl font-bold text-foreground">{title}</Heading>
          <p className="text-muted-foreground text-sm mt-1">
            {mode === "embedded" ? "Sección embebida de consumibles del dashboard" : "Podés cambiar de tab sin perder los filtros propios de consumibles."}
          </p>
        </div>

        <div className="bg-card rounded-2xl border border-border p-8 text-center">
          <ShoppingBag className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold text-foreground mb-1">No pudimos cargar las ventas de consumibles</h3>
          <p className="text-muted-foreground text-sm">{recoverableError}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <div>
          <Heading className="text-2xl font-bold text-foreground">{title}</Heading>
          <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        {(
          [
            {
              label: "Tickets",
              value: formatInt(stats.total_tickets),
              icon: Receipt,
              iconClass: "h-4 w-4 text-primary",
              bgClass: "h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center",
              oculto: false,
              sub: null,
            },
            {
              label: "Neto acreditado",
              value: formatMoney(stats.total_neto_acreditado),
              icon: TrendingUp,
              iconClass: "h-4 w-4 text-success",
              bgClass: "h-8 w-8 rounded-lg bg-success/10 flex items-center justify-center",
              oculto: !puedeVerTotales,
              sub: `Bruto total: ${formatMoney(stats.total_bruto)}`,
            },
            {
              label: "Usadas",
              value: formatInt(stats.total_canjeados),
              icon: CheckCircle2,
              iconClass: "h-4 w-4 text-purple-600 dark:text-purple-400",
              bgClass: "h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center",
              oculto: false,
              sub: null,
            },
            {
              label: "Reembolsadas",
              value: formatInt(stats.total_cancelados),
              icon: XCircle,
              iconClass: "h-4 w-4 text-destructive",
              bgClass: "h-8 w-8 rounded-lg bg-destructive/10 flex items-center justify-center",
              oculto: false,
              sub: null,
            },
          ]
        )
          .filter((item) => !item.oculto)
          .map(({ label, value, icon: Icon, iconClass, bgClass, oculto, sub }) => (
            <div key={label} className="bg-card rounded-2xl border border-border p-4">
              <div className="flex items-center justify-between mb-3">
                <div className={bgClass}>
                  <Icon className={iconClass} />
                </div>
                {oculto && (
                  <IconAction
                    label={totalesOcultos ? "Mostrar totales" : "Ocultar totales"}
                    onClick={() => setTotalesOcultos((prev) => !prev)}
                    className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    variant="ghost"
                    size="icon-sm"
                  >
                    {totalesOcultos ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </IconAction>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{label}</p>
              <p className="text-lg md:text-xl font-bold text-foreground mt-0.5 font-mono tabular-nums">
                {oculto && totalesOcultos ? "••••••" : value}
              </p>
              {sub ? <p className="mt-1 text-xs text-muted-foreground">{totalesOcultos ? "Podés volver a mostrar este monto cuando quieras" : sub}</p> : null}
            </div>
          ))}
      </div>

      {summary !== null && <ConsumiblesHeroSummary summary={summary} />}

      <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
        <div className="border-b border-primary/15 bg-primary/8 px-5 py-4 flex items-start justify-between gap-3">
          <button
            type="button"
            className="flex flex-1 items-start justify-between gap-3 text-left"
            onClick={() => setNetoPorEventoCollapsed((current) => !current)}
          >
            <div>
              <h2 className="text-sm font-semibold text-foreground">Neto por evento</h2>
              <p className="text-xs text-muted-foreground mt-1">
                Resumen económico de consumibles según los filtros actuales
              </p>
            </div>
            <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${netoPorEventoCollapsed ? "-rotate-90" : "rotate-0"}`} />
          </button>
          {puedeVerTotales && !netoPorEventoCollapsed && (
            <IconAction
              label={totalesOcultos ? "Mostrar totales" : "Ocultar totales"}
              onClick={() => setTotalesOcultos((prev) => !prev)}
              className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer shrink-0"
              variant="ghost"
              size="icon-sm"
            >
              {totalesOcultos ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </IconAction>
          )}
        </div>
        <div className={`grid transition-all duration-300 ease-out ${netoPorEventoCollapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}>
          <div className="overflow-hidden">
            {ingresosPorEvento.length === 0 ? (
              <div className="px-4 py-8 text-sm text-muted-foreground text-center">
                {busqueda ? "No hay ingresos por evento para mostrar con esta búsqueda y filtros" : "No hay ingresos por evento para mostrar con estos filtros"}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="border-b border-primary/15 bg-primary/10">
                      <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Evento</th>
                      <th className="text-right px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Tickets</th>
                      {puedeVerTotales && (
                        <th className="text-right px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Neto acreditado</th>
                      )}
                      <th className="text-right px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Cancelados</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {ingresosPorEvento.map((item) => (
                      <tr key={item.evento_id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-5 py-4 font-medium text-foreground">{item.evento_nombre}</td>
                        <td className="px-4 py-4 text-right font-mono tabular-nums text-foreground">{formatInt(item.total_tickets)}</td>
                        {puedeVerTotales && (
                          <td className="px-4 py-4 text-right font-mono tabular-nums text-foreground font-semibold">
                            {totalesOcultos ? "••••••" : formatMoney(item.total_neto_acreditado)}
                          </td>
                        )}
                        <td className="px-4 py-4 text-right font-mono tabular-nums text-muted-foreground">{formatInt(item.total_cancelados)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Filtros</h2>
            <p className="text-sm text-muted-foreground">Refiná qué ventas querés ver en la grilla.</p>
          </div>
          <Button type="button" onClick={applyGridFilters} className="w-full sm:w-auto">Buscar</Button>
        </div>

        <div className="grid gap-4 xl:grid-cols-5 xl:items-end">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Evento</label>
            <Select value={filtroEventoDraft} onValueChange={setFiltroEventoDraft}>
              <SelectTrigger className="h-10 bg-background w-full">
                <SelectValue placeholder="Todos los eventos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem className="py-2.5 px-2.5" value="_todos">Todos los eventos</SelectItem>
                {eventos.map((ev) => (
                  <SelectItem className="py-2.5 px-2.5" key={ev.id} value={ev.id}>{ev.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Barra</label>
            <Select
              value={filtroBarraDraft}
              onValueChange={setFiltroBarraDraft}
              disabled={filtroEventoDraft === "_todos" || barras.length === 0}
            >
              <SelectTrigger className="h-10 bg-background w-full">
                <SelectValue placeholder={filtroEventoDraft === "_todos" ? "Seleccioná un evento" : "Todas las barras"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem className="py-2.5 px-2.5" value="_todas">Todas las barras</SelectItem>
                {barras.map((b) => (
                  <SelectItem className="py-2.5 px-2.5" key={b.id} value={b.id}>{b.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Estado</label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className="h-10 w-full justify-between bg-background font-normal">
                  <span className="truncate">{summarizeConsumiblesStateSelection(filtroEstadosDraft)}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>Estados</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {CONSUMIBLES_STATE_OPTIONS.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.value}
                    checked={filtroEstadosDraft.includes(option.value)}
                    onCheckedChange={(checked) => {
                      const next = checked === true
                        ? [...filtroEstadosDraft, option.value]
                        : filtroEstadosDraft.filter((value) => value !== option.value)
                      setFiltroEstadosDraft(next.length === 0 ? CONSUMIBLES_STATE_OPTIONS.map((item) => item.value) : Array.from(new Set(next)))
                    }}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end xl:col-span-2">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">Desde</label>
              <Input type="date" className="h-10 bg-background w-full" value={filtroDesdeDraft} max={filtroHastaDraft || undefined} disabled={filtroTodoDraft} onChange={(e) => setFiltroDesdeDraft(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">Hasta</label>
              <Input type="date" className="h-10 bg-background w-full" value={filtroHastaDraft} min={filtroDesdeDraft || undefined} disabled={filtroTodoDraft} onChange={(e) => setFiltroHastaDraft(e.target.value)} />
            </div>
            <label className="flex h-10 items-center gap-3 px-3 cursor-pointer bg-transparent">
              <Checkbox
                checked={filtroTodoDraft}
                onCheckedChange={(checked) => setFiltroTodoDraft(checked === true)}
              />
              <span className="text-sm font-medium text-foreground">Todo</span>
            </label>
          </div>
        </div>
      </div>

      <div className="space-y-0">
      {/* Filtros del listado */}
      <div className="bg-card rounded-t-xl rounded-b-none border border-border border-b-0 overflow-hidden shadow-sm">
        <div className="border-b border-primary/15 bg-primary/8 px-5 py-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col sm:flex-row gap-3 xl:flex-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className="h-10 gap-2 bg-background/90 border-primary/15 xl:w-auto">
                  <Columns3 className="h-4 w-4" />
                  <span>Columnas</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Columnas visibles</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={columnasVisibles.estado} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, estado: checked === true }))}>Estado</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={columnasVisibles.total} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, total: checked === true }))}>Total</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={columnasVisibles.barra} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, barra: checked === true }))}>Barra</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={columnasVisibles.evento} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, evento: checked === true }))}>Evento</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={columnasVisibles.fecha} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, fecha: checked === true }))}>Fecha</DropdownMenuCheckboxItem>
              </DropdownMenuContent>
              </DropdownMenu>

              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9 h-10 bg-background/90 border-primary/15"
                  placeholder="Buscar por clave, evento, barra o ítem..."
                  value={busquedaInput}
                  onChange={(e) => setBusquedaInput(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 xl:items-center xl:justify-end">
              <Select value={String(pageSize)} onValueChange={(value) => updateQuery({ pageSize: value, page: 1 })}>
                <SelectTrigger className="bg-background/90 border-primary/15 w-full sm:w-24">
                  <SelectValue placeholder="25" />
                </SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100].map((size) => (<SelectItem key={size} value={String(size)}>{size}</SelectItem>))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
                <span>{rangeStart}-{rangeEnd} de {pagination.total}</span>
                <Badge variant="outline">{pagination.page}/{pagination.totalPages}</Badge>
              </div>

              <div className="flex items-center gap-1">
                <IconAction label="Primera página" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: 1 })} disabled={pagination.page <= 1}><ChevronsLeft className="h-4 w-4" /></IconAction>
                <IconAction label="Página anterior" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: pagination.page - 1 })} disabled={pagination.page <= 1}><ChevronLeft className="h-4 w-4" /></IconAction>
                <IconAction label="Página siguiente" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: pagination.page + 1 })} disabled={pagination.page >= pagination.totalPages}><ChevronRight className="h-4 w-4" /></IconAction>
                <IconAction label="Última página" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: pagination.totalPages })} disabled={pagination.page >= pagination.totalPages}><ChevronsRight className="h-4 w-4" /></IconAction>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Resultados */}
      {ventas.length === 0 ? (
        <div className="bg-card rounded-b-xl rounded-t-none border border-border border-t-0 p-8 text-center shadow-sm">
          <ShoppingBag className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold text-foreground mb-1">Sin resultados</h3>
          <p className="text-muted-foreground text-sm">{busqueda || eventoId || barraId || estadoFiltro !== "todos" || desdeFiltro || hastaFiltro ? "No se encontraron ventas con esos filtros" : "Todavía no se registraron ventas de consumibles"}</p>
        </div>
      ) : (
        <div className="bg-card rounded-b-xl rounded-t-none border border-border border-t-0 overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="border-b border-primary/15 bg-primary/10">
                  <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("clave")}>Clave {getSortIcon("clave")}</button></th>
                  {columnasVisibles.estado && <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("estado")}>Estado {getSortIcon("estado")}</button></th>}
                  {columnasVisibles.total && <th className="text-right px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("total")}>Total cobrado {getSortIcon("total")}</button></th>}
                  {columnasVisibles.barra && <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("barra")}>Barra {getSortIcon("barra")}</button></th>}
                  {columnasVisibles.evento && <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("evento")}>Evento {getSortIcon("evento")}</button></th>}
                  {columnasVisibles.fecha && <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("alta")}>Fecha {getSortIcon("alta")}</button></th>}
                  <th className="text-right px-5 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {ventas.map((v) => {
                  const est = estadoConfig[v.estado] ?? estadoConfig.pendiente
                  const actions = getConsumiblesTicketActions(v.estado, permisos, esEmpleado)
                  return (
                    <tr key={v.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-4">
                        <code className="text-xs bg-muted px-2 py-1 rounded font-mono text-foreground">
                          {v.clave_corta}
                        </code>
                      </td>
                      {columnasVisibles.estado && <td className="px-4 py-4">
                        <span className={cn("inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full border", est.class)}>
                          {est.label}
                        </span>
                      </td>}
                      {columnasVisibles.total && <td className="px-4 py-4 text-right text-foreground">
                        <div className="font-mono tabular-nums font-semibold">{totalesOcultos ? "••••••" : formatMoney(v.total)}</div>
                        {v.delivered_amount != null || v.refunded_amount != null ? (
                          <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                            <p>Entregado: <span className="font-mono tabular-nums">{totalesOcultos ? "••••••" : formatMoney(v.delivered_amount)}</span></p>
                            <p>Reembolsado: <span className="font-mono tabular-nums">{totalesOcultos ? "••••••" : formatMoney(v.refunded_amount)}</span></p>
                          </div>
                        ) : null}
                      </td>}
                      {columnasVisibles.barra && <td className="px-4 py-4 text-muted-foreground">{v.barra_nombre ?? "—"}</td>}
                      {columnasVisibles.evento && <td className="px-4 py-4 text-muted-foreground">{v.evento_nombre ?? "—"}</td>}
                      {columnasVisibles.fecha && <td className="px-4 py-4 text-xs text-muted-foreground whitespace-nowrap font-mono tabular-nums">
                        {formatDateTime(v.created_at)}
                      </td>}
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0"
                            aria-label="Detalle del ticket"
                            title="Detalle del ticket"
                            onClick={() => verDetalle(v)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          {actions.canCancel && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                              aria-label="Cancelar ticket"
                              title="Cancelar ticket"
                              onClick={() => setCancelando(v)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
      </div>

      {/* Modal detalle */}
      <Dialog open={!!detalle} onOpenChange={(o) => !o && setDetalle(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Detalle del ticket</DialogTitle>
            {detalle && (
              <div className="flex items-center gap-2 mt-1">
                <code className="text-sm bg-muted px-2 py-0.5 rounded font-mono">{detalle.clave_corta}</code>
                <span className={cn("inline-flex items-center text-xs font-medium px-2.5 py-1 rounded-full border", estadoConfig[detalle.estado]?.class)}>
                  {estadoConfig[detalle.estado]?.label}
                </span>
              </div>
            )}
          </DialogHeader>

          {detalle && (
            <div className="space-y-4">
              {detalle.items && detalle.items.length > 0 ? (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Items</p>
                  <div className="space-y-1.5">
                    {detalle.items.map((item) => (
                      <div key={item.id} className="flex items-start justify-between gap-3 text-sm">
                        <div>
                          <span className="text-foreground">
                            {item.cantidad}x {item.consumible_nombre}
                          </span>
                          {getResolvedCounts(item).hasResolution ? (
                            <div className="mt-1 space-y-0.5 text-xs">
                              <p className="text-success">
                                Entregados: <span className="font-mono tabular-nums">{getResolvedCounts(item).entregada}</span>
                              </p>
                              <p className="text-red-600 dark:text-red-400">
                                Reembolsados: <span className="font-mono tabular-nums">{getResolvedCounts(item).reembolsada}</span>
                              </p>
                            </div>
                          ) : null}
                        </div>
                        <span className="text-muted-foreground font-medium font-mono tabular-nums">
                          {formatMoney(item.subtotal)}
                        </span>
                      </div>
                    ))}
                  </div>
                    <div className="border-t border-border pt-2 space-y-2">
                      {(detalle.delivered_amount != null || detalle.refunded_amount != null) ? (
                        <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-1">
                          <div className="flex items-center justify-between gap-3">
                            <span>Entregado</span>
                            <span className="font-semibold font-mono tabular-nums text-success">
                              {totalesOcultos ? "••••••" : formatMoney(detalle.delivered_amount)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between gap-3">
                            <span>Reembolsado</span>
                            <span className="font-semibold font-mono tabular-nums text-red-700 dark:text-red-400">
                              {totalesOcultos ? "••••••" : formatMoney(detalle.refunded_amount)}
                            </span>
                          </div>
                        </div>
                      ) : null}
                    <div className="flex justify-between font-semibold text-foreground">
                       <span>Total cobrado</span>
                       <span className="font-mono tabular-nums">{totalesOcultos ? "••••••" : formatMoney(detalle.total)}</span>
                    </div>
                    </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">Cargando items...</p>
              )}

              {detalle.estado === "pendiente" && puede("gestionar_consumibles") && (
                <Button
                  variant="destructive"
                  className="w-full"
                  onClick={() => { setCancelando(detalle); setDetalle(null) }}
                >
                  Cancelar ticket
                </Button>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Dialog confirmar cancelar */}
      <Dialog open={!!cancelando} onOpenChange={(o) => !o && setCancelando(null)}>
        <DialogContent>
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                <XCircle className="h-5 w-5" />
              </div>
              <DialogTitle>Cancelar ticket</DialogTitle>
            </div>
            <DialogDescription className="pt-1">
              Vas a cancelar el ticket{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">{cancelando?.clave_corta}</code>.
              Se reembolsará el monto cobrado y el ticket quedará marcado como{" "}
              <span className="font-medium text-foreground">Reembolsada</span>. Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          {cancelando ? (
            <div className="flex items-center justify-between rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm">
              <span className="text-muted-foreground">Monto a reembolsar</span>
              <span className="font-mono tabular-nums font-semibold text-destructive">
                {formatMoney(cancelando.total)}
              </span>
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelando(null)}>
              No, mantener
            </Button>
            <Button variant="destructive" onClick={confirmarCancelar}>
              Sí, cancelar y reembolsar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function formatFechaCortaConsumibles(fecha: string) {
  const [, month, day] = fecha.split("-")
  return `${day}/${month}`
}

function ConsumiblesHeroSummary({ summary }: { summary: ConsumiblesSummary }) {
  const { hoy, ultimos_7d, ultimos_30d } = summary.data.periodo
  const ventasPorDia = summary.data.ventas_por_dia
  const todosEnCero = ventasPorDia.every((d) => d.vendidos === 0)

  const tooltipStyle = {
    background: "var(--card)",
    color: "var(--foreground)",
    border: "1px solid var(--border)",
    borderRadius: "8px",
    fontSize: "12px",
  }

  const periodos = [
    { label: "Hoy", data: hoy, is30d: false },
    { label: "Últimos 7 días", data: ultimos_7d, is30d: false },
    { label: "Últimos 30 días", data: ultimos_30d, is30d: true },
  ] as const

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {periodos.map(({ label, data, is30d }) => {
          const data30d = is30d ? (data as typeof ultimos_30d) : null
          return (
            <div key={label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
              <p className="mt-2 text-2xl font-bold tracking-tight text-foreground">
                <span className="font-mono tabular-nums">{formatInt(data.vendidos)}</span>
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">tickets</span>
              </p>
              <p className="mt-1.5 text-sm text-foreground font-medium">
                <span className="font-mono tabular-nums">{formatMoney(data.neto)}</span>
                <span className="ml-1 text-xs font-normal text-muted-foreground">neto acreditado</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Ticket prom.: <span className="font-mono tabular-nums">{data.ticket_promedio_neto !== null ? formatMoney(data.ticket_promedio_neto) : "—"}</span>
              </p>
              {is30d && data30d?.tasa_cancelacion_pct !== null && data30d?.tasa_cancelacion_pct !== undefined && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Cancelacion: <span className="font-mono tabular-nums">{Number(data30d.tasa_cancelacion_pct).toFixed(1)}%</span>
                </p>
              )}
            </div>
          )
        })}
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <p className="mb-4 text-sm font-semibold text-foreground">Ventas últimos 30 días</p>
        {todosEnCero || ventasPorDia.length === 0 ? (
          <div className="flex h-[240px] items-center justify-center text-sm text-muted-foreground">
            Sin ventas en los últimos 30 días
          </div>
        ) : (
          <div className="h-[240px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={ventasPorDia}>
                <defs>
                  <linearGradient id="consumiblesGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--marketing-accent)" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="var(--marketing-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="fecha"
                  tickFormatter={formatFechaCortaConsumibles}
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                />
                <RechartsTooltip
                  contentStyle={tooltipStyle}
                  cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "4 4" }}
                  labelFormatter={(label) => typeof label === "string" ? formatFechaCortaConsumibles(label) : label}
                />
                <Area
                  type="monotone"
                  dataKey="vendidos"
                  stroke="var(--marketing-accent)"
                  strokeWidth={2.5}
                  fill="url(#consumiblesGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}
