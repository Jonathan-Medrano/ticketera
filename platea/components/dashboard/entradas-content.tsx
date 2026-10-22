"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { IconAction } from "@/components/ui/icon-action"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Search,
  Ticket,
  TrendingUp,
  CheckCircle2,
  XCircle,
  Clipboard,
  Eye,
  EyeOff,
  Columns3,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Loader2,
  FileSpreadsheet,
  FileText,
  Download,
  Mail,
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
import { cn } from "@/lib/utils"
import { formatMoney, formatInt, formatDateTime } from "@/lib/format"
import { toast } from "sonner"
import { puedeHacer, type Permisos } from "@/lib/permisos"
import { readEntradasQuery, writeEntradasQuery, type EntradasDashboardQueryScope } from "@/lib/dashboard-query-scope"
import { useDashboardDebouncedSearch } from "@/lib/use-dashboard-debounced-search"
import type { EntradasSummary } from "@/app/(empresa)/dashboard/ventas/page"

type EntradaListItem = {
  id: string
  checkout_session_id?: string | null
  qr_code?: string | null
  clave_corta?: string | null
  estado: "valida" | "usada" | "cancelada"
  precio_pagado: number | null
  comision?: number | null
  neto_empresa_amount?: number | null
  created_at: string
  evento_nombre: string
  categoria_nombre?: string | null
  comprador_nombre?: string | null
  comprador_email?: string | null
  comprador_dni?: string | null
  funcion_fecha?: string | null
}

type EventoFiltro = {
  id: string
  nombre: string
}

type PaginationMeta = {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

type EntradasStats = {
  total_entradas: number
  total_neto_acreditado: number | null
  total_bruto: number | null
  total_validas: number
  total_usadas: number
  total_canceladas: number
}

// Mismos tokens que ventaEstadoConfig en evento-detalle-content para que el badge
// de estado de entrada se vea idéntico en ventas y en el detalle del evento.
const estadoConfig = {
  valida: {
    label: "Válida",
    class: "border border-success/30 bg-success/10 text-success",
  },
  usada: {
    label: "Usada",
    class: "border border-border bg-muted text-muted-foreground",
  },
  cancelada: {
    label: "Reembolsada",
    class: "border border-destructive/30 bg-destructive/10 text-destructive",
  },
}

function buildEntradasExportFallbackDate(now: Date) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })

  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function resolveEntradasExportFilename(disposition: string | null | undefined, now = new Date()) {
  return disposition?.match(/filename="?([^";]+)"?/)?.[1] ?? `entradas-export-${buildEntradasExportFallbackDate(now)}.xlsx`
}

type EntradasExportFormat = "xlsx" | "csv"
const ENTRADAS_STATE_OPTIONS = [
  { value: "valida", label: "Válidas" },
  { value: "usada", label: "Usadas" },
  { value: "cancelada", label: "Reembolsadas" },
] as const

function parseEntradasStateSelection(raw: string | undefined) {
  const selected = new Set((raw ?? "").split(",").map((value) => value.trim()).filter(Boolean))
  const normalized = ENTRADAS_STATE_OPTIONS.filter((option) => selected.has(option.value)).map((option) => option.value)
  return normalized.length === 0 ? ENTRADAS_STATE_OPTIONS.map((option) => option.value) : normalized
}

function buildEntradasStateQuery(selected: string[]) {
  const normalized = ENTRADAS_STATE_OPTIONS.filter((option) => selected.includes(option.value)).map((option) => option.value)
  if (normalized.length === 0 || normalized.length === ENTRADAS_STATE_OPTIONS.length) return ""
  return normalized.join(",")
}

function summarizeEntradasStateSelection(selected: string[]) {
  const normalized = ENTRADAS_STATE_OPTIONS.filter((option) => selected.includes(option.value))
  if (normalized.length === 0 || normalized.length === ENTRADAS_STATE_OPTIONS.length) return "Todos los estados"
  return normalized.map((option) => option.label).join(", ")
}

function buildEntradasExportRequestUrlWithPeriod(
  exportPath: string,
  format: EntradasExportFormat,
  includeRefunded: boolean,
  exportAllPeriod: boolean,
  desde: string,
  hasta: string,
  evento: string,
  estado: string,
  busqueda: string,
) {
  const url = new URL(exportPath, "https://platea.local")
  url.searchParams.set("format", format)
  url.searchParams.set("includeRefunded", includeRefunded ? "true" : "false")
  if (evento && evento !== "todos") url.searchParams.set("evento", evento)
  else url.searchParams.delete("evento")
  if (estado && estado !== "todos") url.searchParams.set("estado", estado)
  else url.searchParams.delete("estado")
  if (busqueda.trim()) url.searchParams.set("busqueda", busqueda)
  else url.searchParams.delete("busqueda")
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

function resolveEntradasExportFallbackFilename(format: EntradasExportFormat, now = new Date()) {
  return `entradas-export-${buildEntradasExportFallbackDate(now)}.${format}`
}

export function EntradasExportAction({ exportPath, eventos, defaultEvento = "todos", defaultEstado = "todos" }: { exportPath?: string | null; eventos: EventoFiltro[]; defaultEvento?: string; defaultEstado?: string }) {
  const [isExporting, setIsExporting] = useState(false)
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false)
  const [includeRefunded, setIncludeRefunded] = useState(true)
  const [exportAllPeriod, setExportAllPeriod] = useState(true)
  const [exportDesde, setExportDesde] = useState("")
  const [exportHasta, setExportHasta] = useState("")
  const [exportEvento, setExportEvento] = useState(defaultEvento)
  const [exportEstados, setExportEstados] = useState<string[]>(() => parseEntradasStateSelection(defaultEstado))
  const [exportFormat, setExportFormat] = useState<EntradasExportFormat>("xlsx")

  async function handleExport(format: EntradasExportFormat) {
    if (!exportPath || isExporting) return

    setIsExporting(true)

    try {
      const response = await fetch(buildEntradasExportRequestUrlWithPeriod(exportPath, format, includeRefunded, exportAllPeriod, exportDesde, exportHasta, exportEvento, buildEntradasStateQuery(exportEstados), ""), { method: "GET" })
      if (!response.ok) {
        const body = await response.json().catch(() => null)
        toast.error(body?.error ?? "No se pudo exportar")
        return
      }

      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      const disposition = response.headers.get("content-disposition")
      const fileName = disposition ? resolveEntradasExportFilename(disposition) : resolveEntradasExportFallbackFilename(format)
      link.href = downloadUrl
      link.download = fileName
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(downloadUrl)
      toast.success("Exportación lista")
    } catch (err) {
      toast.error("Error al generar la exportación")
    } finally {
      setIsExporting(false)
      setIsExportDialogOpen(false)
    }
  }

  if (!exportPath) return null

  return (
    <>
      <Button type="button" variant="default" disabled={isExporting} onClick={() => setIsExportDialogOpen(true)} data-export-path={exportPath} data-export-formats="xlsx,csv" data-export-include-refunded={includeRefunded ? "true" : "false"} data-export-all-period={exportAllPeriod ? "true" : "false"} data-export-event={exportEvento} data-export-state={buildEntradasStateQuery(exportEstados) || "todos"} className="h-11 px-6 text-sm font-semibold shadow-sm">
        {isExporting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Procesando...</> : "Exportar"}
      </Button>
      <Dialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Exportar entradas</DialogTitle>
            <DialogDescription>Elegí el formato y los filtros del reporte.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">Evento</label>
                <Select value={exportEvento} onValueChange={setExportEvento}>
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
                      <span className="truncate">{summarizeEntradasStateSelection(exportEstados)}</span>
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-64">
                    <DropdownMenuLabel>Estados</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    {ENTRADAS_STATE_OPTIONS.map((option) => (
                      <DropdownMenuCheckboxItem
                        key={option.value}
                        checked={exportEstados.includes(option.value)}
                        onCheckedChange={(checked) => {
                          const next = checked === true
                            ? [...exportEstados, option.value]
                            : exportEstados.filter((value) => value !== option.value)
                          setExportEstados(next.length === 0 ? ENTRADAS_STATE_OPTIONS.map((item) => item.value) : Array.from(new Set(next)))
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
            <div className="flex justify-end">
              <label className="flex items-center gap-3 cursor-pointer">
                <Checkbox
                  checked={includeRefunded}
                  onCheckedChange={(checked) => setIncludeRefunded(checked === true)}
                />
                <span className="text-sm font-medium text-foreground">Incluir reembolsadas</span>
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

export default function EntradasContent({
  entradas,
  eventos,
  stats,
  pagination,
  mode = "page",
  queryScope = "",
  permisos,
  esEmpleado,
  summary = null,
}: {
  entradas: EntradaListItem[]
  eventos: EventoFiltro[]
  stats: EntradasStats
  pagination: PaginationMeta
  mode?: "page" | "tab"
  queryScope?: EntradasDashboardQueryScope
  permisos?: Permisos
  esEmpleado?: boolean
  summary?: EntradasSummary | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const puede = (permiso: keyof Permisos) => puedeHacer(permiso, esEmpleado ?? false, permisos)
  const puedeVerTotales = puede("ver_totales_entradas") || puede("ver_recaudacion")
  const query = readEntradasQuery(searchParams, queryScope)
  const busqueda = query.busqueda ?? ""
  const eventoFiltro = query.evento ?? "todos"
  const categoriaIdFiltro = query.categoria_id ?? ""
  const estadoFiltro = query.estado ?? "todos"
  const desdeFiltro = query.desde ?? ""
  const hastaFiltro = query.hasta ?? ""
  const sortBy = query.sortBy ?? "alta"
  const sortDir = query.sortDir === "asc" ? "asc" : "desc"
  const [totalesOcultos, setTotalesOcultos] = useState(false)
  const [filtroEventoDraft, setFiltroEventoDraft] = useState(eventoFiltro)
  const [filtroCategoriaDraft, setFiltroCategoriaDraft] = useState(categoriaIdFiltro || "todas")
  const [categorias, setCategorias] = useState<{ id: string; nombre: string }[]>([])
  const [filtroEstadosDraft, setFiltroEstadosDraft] = useState<string[]>(() => parseEntradasStateSelection(estadoFiltro))
  const [filtroDesdeDraft, setFiltroDesdeDraft] = useState(desdeFiltro)
  const [filtroHastaDraft, setFiltroHastaDraft] = useState(hastaFiltro)
  const [filtroTodoDraft, setFiltroTodoDraft] = useState(!desdeFiltro && !hastaFiltro)
  const [columnasVisibles, setColumnasVisibles] = useState({
    categoria: true,
    clave: true,
    checkout: true,
    precio: true,
    estado: true,
    fecha: true,
  })
  const [detalleAbierto, setDetalleAbierto] = useState<EntradaListItem | null>(null)
  const { value: busquedaInput, setValue: setBusquedaInput } = useDashboardDebouncedSearch({
    urlValue: busqueda,
    emit: (next) => updateQuery({ busqueda: next, page: 1 }),
  })

  useEffect(() => {
    // Sincroniza los drafts de filtro con los params de URL cuando estos cambian.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs draft filter state from URL params
    setFiltroEventoDraft(eventoFiltro)
    setFiltroCategoriaDraft(categoriaIdFiltro || "todas")
    setFiltroEstadosDraft(parseEntradasStateSelection(estadoFiltro))
    setFiltroDesdeDraft(desdeFiltro)
    setFiltroHastaDraft(hastaFiltro)
    setFiltroTodoDraft(!desdeFiltro && !hastaFiltro)
  }, [eventoFiltro, categoriaIdFiltro, estadoFiltro, desdeFiltro, hastaFiltro])

  useEffect(() => {
    const eventoId = filtroEventoDraft !== "todos" ? filtroEventoDraft : ""
    if (!eventoId) {
      // Sin evento seleccionado: limpiamos las categorías (acompaña el fetch externo del efecto).
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets dependent fetch state when no event selected
      setCategorias([])
      setFiltroCategoriaDraft("todas")
      return
    }
    void fetch(`/api/eventos/${eventoId}/categorias`)
      .then((r) => r.json())
      .then((data: { categorias?: { id: string; nombre: string }[] }) => {
        setCategorias(data.categorias ?? [])
      })
      .catch(() => setCategorias([]))
  }, [filtroEventoDraft])

  async function handleCopyCheckoutId(checkoutSessionId: string) {
    try {
      await navigator.clipboard.writeText(checkoutSessionId)
      toast.success("ID copiado")
    } catch {
      toast.error("No se pudo copiar el ID")
    }
  }
  const pageSize = pagination.pageSize
  const rangeStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1
  const rangeEnd = Math.min(pagination.total, pagination.page * pagination.pageSize)
  const showPageHeading = mode !== "tab"

  function updateQuery(next: { page?: number; pageSize?: string; busqueda?: string; evento?: string; categoria_id?: string; estado?: string; desde?: string; hasta?: string; sortBy?: string; sortDir?: "asc" | "desc" }) {
    const params = writeEntradasQuery(searchParams, next, queryScope)

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
      evento: filtroEventoDraft,
      categoria_id: filtroCategoriaDraft === "todas" ? "" : filtroCategoriaDraft,
      estado: buildEntradasStateQuery(filtroEstadosDraft),
      desde: filtroTodoDraft ? "" : filtroDesdeDraft,
      hasta: filtroTodoDraft ? "" : filtroHastaDraft,
      page: 1,
    })
  }

  return (
    <div className="space-y-6">
      <div>
        {showPageHeading ? <h1 className="text-2xl font-bold text-foreground">Entradas</h1> : null}
        <p className="text-muted-foreground text-sm mt-1">{pagination.total} entradas en total</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {(
          [
            {
              label: "Entradas",
              value: formatInt(stats.total_entradas),
              icon: Ticket,
              iconClass: "h-4 w-4 text-primary",
              bgClass: "h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center",
              oculto: false,
              sub: null,
            },
            {
              label: "Neto acreditado",
              value: formatMoney(stats.total_neto_acreditado ?? 0),
              icon: TrendingUp,
              iconClass: "h-4 w-4 text-success",
              bgClass: "h-8 w-8 rounded-lg bg-success/10 flex items-center justify-center",
              oculto: !puedeVerTotales,
              sub: `Total cobrado: ${formatMoney(stats.total_bruto ?? 0)}`,
            },
            {
              label: "Usadas",
              value: formatInt(stats.total_usadas),
              icon: CheckCircle2,
              iconClass: "h-4 w-4 text-purple-600",
              bgClass: "h-8 w-8 rounded-lg bg-purple-500/10 flex items-center justify-center",
              oculto: false,
              sub: null,
            },
            {
              label: "Reembolsadas",
              value: formatInt(stats.total_canceladas),
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

      {summary !== null && <EntradasHeroSummary summary={summary} />}

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Filtros</h2>
            <p className="text-sm text-muted-foreground">Refiná qué ventas querés ver en la grilla.</p>
          </div>
          <Button type="button" onClick={applyGridFilters} className="w-full sm:w-auto">
            Buscar
          </Button>
        </div>

        <div className="grid gap-4 lg:grid-cols-5 lg:items-end">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Evento</label>
            <Select value={filtroEventoDraft} onValueChange={setFiltroEventoDraft}>
              <SelectTrigger className="h-10 bg-background w-full">
                <SelectValue placeholder="Todos los eventos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem className="py-2.5 px-2.5" value="todos">Todos los eventos</SelectItem>
                {eventos.map((ev) => (
                  <SelectItem className="py-2.5 px-2.5" key={ev.id} value={ev.id}>
                    {ev.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Categoría</label>
            <Select
              value={filtroCategoriaDraft}
              onValueChange={setFiltroCategoriaDraft}
              disabled={filtroEventoDraft === "todos" || categorias.length === 0}
            >
              <SelectTrigger className="h-10 bg-background w-full">
                <SelectValue placeholder={filtroEventoDraft === "todos" ? "Seleccioná un evento" : "Todas las categorías"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem className="py-2.5 px-2.5" value="todas">Todas las categorías</SelectItem>
                {categorias.map((cat) => (
                  <SelectItem className="py-2.5 px-2.5" key={cat.id} value={cat.id}>
                    {cat.nombre}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Estado</label>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className="h-10 w-full justify-between bg-background font-normal">
                  <span className="truncate">{summarizeEntradasStateSelection(filtroEstadosDraft)}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>Estados</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {ENTRADAS_STATE_OPTIONS.map((option) => (
                  <DropdownMenuCheckboxItem
                    key={option.value}
                    checked={filtroEstadosDraft.includes(option.value)}
                    onCheckedChange={(checked) => {
                      const next = checked === true
                        ? [...filtroEstadosDraft, option.value]
                        : filtroEstadosDraft.filter((value) => value !== option.value)
                      setFiltroEstadosDraft(next.length === 0 ? ENTRADAS_STATE_OPTIONS.map((item) => item.value) : Array.from(new Set(next)))
                    }}
                  >
                    {option.label}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end lg:col-span-2">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">Desde</label>
              <Input
                type="date"
                className="h-10 bg-background w-full"
                value={filtroDesdeDraft}
                max={filtroHastaDraft || undefined}
                disabled={filtroTodoDraft}
                onChange={(e) => setFiltroDesdeDraft(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">Hasta</label>
              <Input
                type="date"
                className="h-10 bg-background w-full"
                value={filtroHastaDraft}
                min={filtroDesdeDraft || undefined}
                disabled={filtroTodoDraft}
                onChange={(e) => setFiltroHastaDraft(e.target.value)}
              />
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

      {/* Tabla */}
      <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
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
                  <DropdownMenuCheckboxItem checked={columnasVisibles.categoria} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, categoria: checked === true }))}>
                    Categoría
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={columnasVisibles.clave} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, clave: checked === true }))}>
                    Clave
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={columnasVisibles.checkout} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, checkout: checked === true }))}>
                    Checkout ID
                  </DropdownMenuCheckboxItem>
                  {puede("ver_precios_entradas") && (
                    <DropdownMenuCheckboxItem checked={columnasVisibles.precio} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, precio: checked === true }))}>
                      Precio
                    </DropdownMenuCheckboxItem>
                  )}
                  <DropdownMenuCheckboxItem checked={columnasVisibles.estado} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, estado: checked === true }))}>
                    Estado
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={columnasVisibles.fecha} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, fecha: checked === true }))}>
                    Fecha compra
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9 h-10 bg-background/90 border-primary/15"
                  placeholder="Buscar por nombre, email, DNI, clave o checkout..."
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
                  {[10, 25, 50, 100].map((size) => (
                    <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
                <span>{rangeStart}-{rangeEnd} de {pagination.total}</span>
                <Badge variant="outline">{pagination.page}/{pagination.totalPages}</Badge>
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
        </div>
        {entradas.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <Ticket className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-semibold text-foreground mb-1">No hay entradas</h3>
            <p className="text-muted-foreground text-sm">
              {busqueda || eventoFiltro !== "todos" || categoriaIdFiltro || estadoFiltro !== "todos" || desdeFiltro || hastaFiltro
                ? "No se encontraron entradas con esos filtros"
                : "Todavía no se vendieron entradas"}
            </p>
          </div>
        ) : (
          <div className="relative">
            <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 z-10 w-12 bg-gradient-to-l from-card to-transparent md:hidden" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-primary/15 bg-primary/10">
                  <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">
                    <button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("comprador")}>
                      Comprador {getSortIcon("comprador")}
                    </button>
                  </th>
                  <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">
                    <button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("evento")}>
                      Evento {getSortIcon("evento")}
                    </button>
                  </th>
                  {columnasVisibles.categoria && <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">
                    <button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("categoria")}>
                      Categoría {getSortIcon("categoria")}
                    </button>
                  </th>}
                  {columnasVisibles.clave && <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">
                    <button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("clave")}>
                      Clave {getSortIcon("clave")}
                    </button>
                  </th>}
                  {columnasVisibles.checkout && <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">
                    Checkout ID
                  </th>}
                  {puede("ver_precios_entradas") && columnasVisibles.precio && (
                    <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">
                      <button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("precio")}>
                        Neto {getSortIcon("precio")}
                      </button>
                    </th>
                  )}
                  {columnasVisibles.estado && <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">
                    <button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("estado")}>
                      Estado {getSortIcon("estado")}
                    </button>
                  </th>}
                  {columnasVisibles.fecha && <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">
                    <button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("alta")}>
                      Fecha compra {getSortIcon("alta")}
                    </button>
                  </th>}
                  <th className="text-right px-5 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {entradas.map((e) => {
                  const estado = estadoConfig[e.estado as keyof typeof estadoConfig]
                  return (
                    <tr key={e.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-4">
                        <p className="font-medium text-foreground">{e.comprador_nombre ?? "—"}</p>
                        <p className="text-xs text-muted-foreground">{e.comprador_email}</p>
                        <p className="text-xs text-muted-foreground">
                          DNI: {e.comprador_dni ?? "—"}
                        </p>
                      </td>
                      <td className="px-4 py-4 text-foreground">{e.evento_nombre}</td>
                      {columnasVisibles.categoria && <td className="px-4 py-4 text-foreground">{e.categoria_nombre ?? "—"}</td>}
                      {columnasVisibles.clave && <td className="px-4 py-4">
                        <code className="text-xs bg-muted px-2 py-1 rounded font-mono text-foreground">
                          {e.clave_corta ?? "—"}
                        </code>
                      </td>}
                      {columnasVisibles.checkout && <td className="px-4 py-4">
                        {e.checkout_session_id ? (
                          <div className="flex items-center gap-2">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <code className="max-w-[220px] truncate text-xs bg-muted px-2 py-1 rounded font-mono text-foreground">
                                    {e.checkout_session_id}
                                  </code>
                                </TooltipTrigger>
                                <TooltipContent>{e.checkout_session_id}</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <IconAction
                                    label="Copiar checkout ID"
                                    variant="ghost"
                                    size="icon-sm"
                                    onClick={() => void handleCopyCheckoutId(e.checkout_session_id!)}
                                  >
                                    <Clipboard className="h-4 w-4" />
                                  </IconAction>
                                </TooltipTrigger>
                                <TooltipContent>Copiar checkout ID</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </div>
                        ) : "—"}
                      </td>}
                      {puede("ver_precios_entradas") && columnasVisibles.precio && (
                        <td className="px-4 py-4 text-foreground font-semibold font-mono tabular-nums">
                          {e.neto_empresa_amount === null || e.neto_empresa_amount === undefined ? "Monto oculto" : totalesOcultos ? "••••••" : formatMoney(e.neto_empresa_amount)}
                        </td>
                      )}
                      {columnasVisibles.estado && <td className="px-4 py-4">
                        <span
                          className={`text-xs font-medium px-2.5 py-1 rounded-full ${estado.class}`}
                        >
                          {estado.label}
                        </span>
                      </td>}
                      {columnasVisibles.fecha && <td className="px-4 py-4 text-muted-foreground text-xs whitespace-nowrap">
                        {formatDateTime(e.created_at)}
                      </td>}
                      <td className="px-5 py-4">
                        <div className="flex items-center justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-10 w-10 p-0"
                            aria-label="Ver detalle"
                            title="Ver detalle"
                            onClick={() => setDetalleAbierto(e)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
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

      <EntradaDetalleModal
        entrada={detalleAbierto}
        onClose={() => setDetalleAbierto(null)}
        puedeVerRecaudacion={puedeVerTotales}
        onCopyCheckoutId={handleCopyCheckoutId}
      />
    </div>
  )
}

function EntradaDetalleModal({
  entrada,
  onClose,
  puedeVerRecaudacion,
  onCopyCheckoutId,
}: {
  entrada: EntradaListItem | null
  onClose: () => void
  puedeVerRecaudacion: boolean
  onCopyCheckoutId: (id: string) => Promise<void>
}) {
  const [email, setEmail] = useState("")
  const [enviando, setEnviando] = useState(false)

  // Pre-cargamos el email del comprador cada vez que se abre otra entrada; el cajero
  // puede corregirlo o completarlo (caso de ventas POS sin email).
  useEffect(() => {
    setEmail(entrada?.comprador_email ?? "")
  }, [entrada])

  const emailValido = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())
  const puedeReenviar = !!entrada && entrada.estado !== "cancelada"

  async function handleReenviar() {
    if (!entrada || !emailValido) return
    setEnviando(true)
    try {
      const res = await fetch(`/api/entradas/${entrada.id}/reenviar-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      })
      const body = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(body?.error ?? "No se pudo reenviar la entrada")
        return
      }
      toast.success(`Entrada enviada a ${email.trim()}`)
    } catch {
      toast.error("No se pudo reenviar la entrada")
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open={!!entrada} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Detalle de entrada</DialogTitle>
          {entrada && (
            <div className="flex items-center gap-2 mt-1">
              {entrada.clave_corta && (
                <code className="text-sm bg-muted px-2 py-0.5 rounded font-mono">{entrada.clave_corta}</code>
              )}
              <span className={cn("text-xs font-medium px-2.5 py-1 rounded-full", estadoConfig[entrada.estado]?.class)}>
                {estadoConfig[entrada.estado]?.label}
              </span>
            </div>
          )}
        </DialogHeader>

        {entrada && (
          <div className="space-y-4">
            {/* Comprador */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Comprador</p>
              <div className="space-y-1 text-sm">
                <p className="text-foreground font-medium">{entrada.comprador_nombre ?? "—"}</p>
                {entrada.comprador_email && (
                  <p className="text-muted-foreground">{entrada.comprador_email}</p>
                )}
                {entrada.comprador_dni && (
                  <p className="text-muted-foreground">DNI: {entrada.comprador_dni}</p>
                )}
              </div>
            </div>

            <hr className="border-border" />

            {/* Evento */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Evento</p>
              <div className="space-y-1 text-sm">
                <p className="text-foreground font-medium">{entrada.evento_nombre}</p>
                {entrada.categoria_nombre && (
                  <p className="text-muted-foreground">Categoría: {entrada.categoria_nombre}</p>
                )}
                {entrada.clave_corta && (
                  <p className="text-muted-foreground">
                    Clave:{" "}
                    <code className="text-xs bg-muted px-2 py-0.5 rounded font-mono text-foreground">
                      {entrada.clave_corta}
                    </code>
                  </p>
                )}
              </div>
            </div>

            <hr className="border-border" />

            {/* Fecha de compra */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Fecha de compra</p>
              <p className="text-sm text-foreground">{formatDateTime(entrada.created_at)}</p>
            </div>

            {/* Importes — solo si puede ver recaudación */}
            {puedeVerRecaudacion && (
              <>
                <hr className="border-border" />
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Importes</p>
                  <div className="rounded-lg bg-muted/50 px-3 py-2 text-xs text-muted-foreground space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span>Precio pagado</span>
                      <span className="font-semibold text-foreground font-mono tabular-nums">{formatMoney(entrada.precio_pagado)}</span>
                    </div>
                    {entrada.comision != null && (
                      <div className="flex items-center justify-between gap-3">
                        <span>Comisión plataforma</span>
                        <span className="font-semibold text-foreground font-mono tabular-nums">{formatMoney(entrada.comision)}</span>
                      </div>
                    )}
                    {entrada.neto_empresa_amount != null && (
                      <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
                        <span className="font-semibold text-foreground">Neto empresa</span>
                        <span className="font-semibold text-success font-mono tabular-nums">{formatMoney(entrada.neto_empresa_amount)}</span>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Checkout session ID */}
            {entrada.checkout_session_id && (
              <>
                <hr className="border-border" />
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Checkout session ID</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 truncate text-xs bg-muted px-2 py-1 rounded font-mono text-foreground">
                      {entrada.checkout_session_id}
                    </code>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 shrink-0"
                      aria-label="Copiar checkout ID"
                      title="Copiar checkout ID"
                      onClick={() => void onCopyCheckoutId(entrada.checkout_session_id!)}
                    >
                      <Clipboard className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </>
            )}

            {/* Reenviar por email — editable (cubre ventas POS sin email) */}
            {puedeReenviar && (
              <>
                <hr className="border-border" />
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Reenviar por email</p>
                  <p className="text-xs text-muted-foreground">Le mandamos el QR de esta entrada al email que indiques.</p>
                  <div className="flex items-center gap-2">
                    <Input
                      type="email"
                      inputMode="email"
                      placeholder="email@ejemplo.com"
                      value={email}
                      disabled={enviando}
                      onChange={(event) => setEmail(event.target.value)}
                      className="h-10 flex-1 bg-background"
                    />
                    <Button
                      type="button"
                      onClick={() => void handleReenviar()}
                      disabled={enviando || !emailValido}
                      className="h-10 shrink-0"
                    >
                      {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
                      <span className="ml-2">Enviar</span>
                    </Button>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cerrar</Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function formatFechaCorta(fecha: string) {
  const [, month, day] = fecha.split("-")
  return `${day}/${month}`
}

function EntradasHeroSummary({ summary }: { summary: EntradasSummary }) {
  const { hoy, ultimos_7d, ultimos_30d } = summary.data.periodo
  const ventasPorDia = summary.data.ventas_por_dia
  const todosEnCero = ventasPorDia.every((d) => d.vendidas === 0)

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
    { label: "Últimos 30 días", data: ultimos_30d as typeof ultimos_30d & { tasa_cancelacion_pct?: number | null }, is30d: true },
  ] as const

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {periodos.map(({ label, data, is30d }) => {
          const data30d = is30d ? (data as typeof ultimos_30d) : null
          return (
            <div key={label} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
              <p className="mt-2 text-2xl font-bold tracking-tight text-foreground tabular-nums">
                {formatInt(data.vendidas)}
                <span className="ml-1.5 text-sm font-normal text-muted-foreground">entradas</span>
              </p>
              <p className="mt-1.5 text-sm text-foreground font-medium font-mono tabular-nums">
                {formatMoney(data.neto)}
                <span className="ml-1 text-xs font-normal text-muted-foreground">neto acreditado</span>
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Ticket prom.: <span className="font-mono tabular-nums">{data.ticket_promedio_neto !== null ? formatMoney(data.ticket_promedio_neto) : "—"}</span>
              </p>
              {is30d && data30d?.tasa_cancelacion_pct !== null && data30d?.tasa_cancelacion_pct !== undefined && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Cancelacion: {Number(data30d.tasa_cancelacion_pct).toFixed(1)}%
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
                  <linearGradient id="entradasGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="var(--marketing-accent)" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="var(--marketing-accent)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis
                  dataKey="fecha"
                  tickFormatter={formatFechaCorta}
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
                  labelFormatter={(label) => typeof label === "string" ? formatFechaCorta(label) : label}
                />
                <Area
                  type="monotone"
                  dataKey="vendidas"
                  stroke="var(--marketing-accent)"
                  strokeWidth={2.5}
                  fill="url(#entradasGradient)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>
    </div>
  )
}
