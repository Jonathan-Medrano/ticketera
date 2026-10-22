"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { writeDashboardSearchParam } from "@/lib/dashboard-grid-search"
import { useDashboardDebouncedSearch } from "@/lib/use-dashboard-debounced-search"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { IconAction } from "@/components/ui/icon-action"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
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
import { Search, Users, Eye, Columns3, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, ArrowUpDown, ArrowUp, ArrowDown, FileSpreadsheet, FileText, Download, Loader2, Check } from "lucide-react"
import { useLoading } from "@/components/loading-provider"
import { puedeHacer, type Permisos } from "@/lib/permisos"
import { formatMoney, formatInt, formatDate } from "@/lib/format"

type CompradorListItem = {
  id: string
  nombre: string
  apellido?: string | null
  email?: string | null
  dni?: string | null
  created_at: string
  total_entradas: number
  total_gastado: number
  ultima_compra?: string | null
  eventos_ids?: string | null
}

type EventoCompradorFiltro = {
  id: string
  nombre: string
}

type PaginationMeta = {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

type CompraDetalle = {
  id: string
  tipo: 'entrada' | 'consumible'
  estado: string
  precio_pagado: number
  created_at: string
  evento_nombre: string
  categoria_nombre?: string | null
  barra_nombre?: string | null
}

type ComprasTotales = {
  entradas: number
  consumibles: number
  gastado_entradas: number
  gastado_consumibles: number
  gastado_total: number
}

type CompradoresSummaryData = {
  global: {
    total_compradores: number
    con_email: number
    con_email_pct: number
    sin_compras: number
    con_1_compra: number
    con_2_o_mas: number
    tasa_recurrencia_pct: number
    ticket_promedio_neto: number | null
  }
  top_spender: {
    id: string
    nombre: string
    email: string | null
    total_gastado: number
    total_entradas: number
  } | null
  nuevos_30d: number
}

function CompradoresHeroSummary({ summary }: { summary: CompradoresSummaryData }) {
  const { global: g, top_spender, nuevos_30d } = summary
  const ticketDisplay = g.ticket_promedio_neto != null ? formatMoney(g.ticket_promedio_neto) : "—"
  const topSpenderDisplay = top_spender
    ? `${top_spender.nombre} (${formatMoney(top_spender.total_gastado)})`
    : "—"

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Total compradores</p>
        <p className="text-2xl font-black text-foreground font-mono tabular-nums">{formatInt(g.total_compradores)}</p>
        <p className="text-xs text-muted-foreground mt-1">{nuevos_30d} nuevos en 30 dias</p>
      </div>
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Cobertura email</p>
        <p className="text-2xl font-black text-foreground tabular-nums">{g.con_email_pct.toFixed(0)}%</p>
        <p className="text-xs text-muted-foreground mt-1">{g.con_email} / {g.total_compradores} compradores</p>
      </div>
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Tasa de recurrencia</p>
        <p className="text-2xl font-black text-foreground tabular-nums">{g.tasa_recurrencia_pct.toFixed(0)}%</p>
        <p className="text-xs text-muted-foreground mt-1">{g.con_2_o_mas} con 2+ compras</p>
      </div>
      <div className="rounded-2xl border border-border bg-card p-4">
        <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Ticket promedio</p>
        <p className="text-2xl font-black text-foreground font-mono tabular-nums">{ticketDisplay}</p>
        <p className="text-xs text-muted-foreground mt-1 truncate">Top: {topSpenderDisplay}</p>
      </div>
    </div>
  )
}

function resolveBuyerExportFilename(disposition: string | null | undefined, fallback: string) {
  return disposition?.match(/filename="?([^";]+)"?/)?.[1] ?? fallback
}

function buildCompradoresExportRequestUrl(exportPath: string, evento: string, todoPeriodo: boolean, desde: string, hasta: string, format: "csv" | "xlsx") {
  const url = new URL(exportPath, "https://platea.local")
  if (evento && evento !== "todos") url.searchParams.set("evento", evento)
  else url.searchParams.delete("evento")
  if (todoPeriodo) {
    url.searchParams.delete("desde")
    url.searchParams.delete("hasta")
  } else {
    if (desde) url.searchParams.set("desde", desde)
    else url.searchParams.delete("desde")
    if (hasta) url.searchParams.set("hasta", hasta)
    else url.searchParams.delete("hasta")
  }
  url.searchParams.set("format", format)
  return `${url.pathname}${url.search}`
}

function CompradoresExportAction({ eventos, exportPath }: { eventos: EventoCompradorFiltro[]; exportPath?: string | null }) {
  const [open, setOpen] = useState(false)
  const [evento, setEvento] = useState("todos")
  const [todoPeriodo, setTodoPeriodo] = useState(true)
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")
  const [isExporting, setIsExporting] = useState(false)
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx">("xlsx")

  async function handleExport(format: "csv" | "xlsx") {
    if (!exportPath || isExporting) return
    setIsExporting(true)
    try {
      const response = await fetch(buildCompradoresExportRequestUrl(exportPath, evento, todoPeriodo, desde, hasta, format), { method: "GET" })
      if (!response.ok) { toast.error("No se pudo exportar"); return }
      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = downloadUrl
      link.download = resolveBuyerExportFilename(response.headers.get("content-disposition"), format === "xlsx" ? "Compradores_Resumen.xlsx" : "Compradores_Resumen.csv")
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(downloadUrl)
      toast.success("Exportación lista")
      setOpen(false)
    } finally {
      setIsExporting(false)
    }
  }

  if (!exportPath) return null

  return (
    <>
      <Button type="button" className="h-11 px-6 text-sm font-semibold shadow-sm" onClick={() => setOpen(true)} disabled={isExporting}>
        {isExporting ? "Procesando..." : "Exportar"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Exportar compradores</DialogTitle>
            <DialogDescription>Elegí los filtros del reporte.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">Evento</label>
              <Select value={evento} onValueChange={setEvento}>
                <SelectTrigger className="h-11 w-full bg-background">
                  <SelectValue placeholder="Todos los eventos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos los eventos</SelectItem>
                  {eventos.map((ev) => (
                    <SelectItem key={ev.id} value={ev.id}>{ev.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">Desde</label>
                <Input type="date" className="h-11 min-w-0 bg-background" value={desde} max={hasta || undefined} disabled={todoPeriodo} onChange={(event) => setDesde(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">Hasta</label>
                <Input type="date" className="h-11 min-w-0 bg-background" value={hasta} min={desde || undefined} disabled={todoPeriodo} onChange={(event) => setHasta(event.target.value)} />
              </div>
              <label className="flex h-11 items-center gap-3 px-3 cursor-pointer bg-transparent">
                <input type="checkbox" checked={todoPeriodo} onChange={(event) => setTodoPeriodo(event.target.checked)} className="h-4 w-4 rounded border-border" />
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
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isExporting}>Cancelar</Button>
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

export default function CompradoresContent({
  compradores,
  eventos,
  totals,
  pagination,
  exportPath,
  permisos,
  esEmpleado,
  summary,
}: {
  compradores: CompradorListItem[]
  eventos: EventoCompradorFiltro[]
  totals: {
    total_compradores: number
    total_entradas: number
    total_gastado: number
    total_con_email: number
  }
  pagination: PaginationMeta
  exportPath?: string | null
  permisos?: Permisos
  esEmpleado?: boolean
  summary?: CompradoresSummaryData | null
}) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const puede = (permiso: keyof Permisos) => puedeHacer(permiso, esEmpleado ?? false, permisos)
  const busqueda = searchParams.get("busqueda") ?? ""
  const eventoFiltro = searchParams.get("evento") ?? "todos"
  const desdeFiltro = searchParams.get("desde") ?? ""
  const hastaFiltro = searchParams.get("hasta") ?? ""
  const sortBy = searchParams.get("sortBy") ?? "alta"
  const sortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc"
  const [seleccionado, setSeleccionado] = useState<CompradorListItem | null>(null)
  const [compras, setCompras] = useState<CompraDetalle[]>([])
  const [comprasTotales, setComprasTotales] = useState<ComprasTotales | null>(null)
  const [copiadoTabla, setCopiadoTabla] = useState<string | null>(null)
  const [copiadoModal, setCopiadoModal] = useState(false)
  const [cambiarPassword, setCambiarPassword] = useState(false)
  const [nuevaPassword, setNuevaPassword] = useState("")
  const [passwordOk, setPasswordOk] = useState(false)
  const [impersonando, setImpersonando] = useState(false)
  const [impersonarTarget, setImpersonarTarget] = useState<CompradorListItem | null>(null)
  const [columnasVisibles, setColumnasVisibles] = useState({
    dni: true,
    entradas: true,
    totalGastado: true,
    ultimaCompra: true,
    alta: true,
  })
  const { withLoading } = useLoading()
  const [filtroEventoDraft, setFiltroEventoDraft] = useState(eventoFiltro)
  const [filtroDesdeDraft, setFiltroDesdeDraft] = useState(desdeFiltro)
  const [filtroHastaDraft, setFiltroHastaDraft] = useState(hastaFiltro)
  const [filtroTodoDraft, setFiltroTodoDraft] = useState(!desdeFiltro && !hastaFiltro)
  const pageSize = pagination.pageSize
  const rangeStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1
  const rangeEnd = Math.min(pagination.total, pagination.page * pagination.pageSize)
  const { value: busquedaInput, setValue: setBusquedaInput } = useDashboardDebouncedSearch({
    urlValue: busqueda,
    emit: (next) => updateQuery({ busqueda: next, page: 1 }),
  })

  function updateQuery(next: { page?: number; pageSize?: string; busqueda?: string; evento?: string; desde?: string; hasta?: string; sortBy?: string; sortDir?: "asc" | "desc" }) {
    const params = new URLSearchParams(searchParams.toString())

    if (next.page !== undefined) {
      params.set("page", String(next.page))
    }

    if (next.busqueda !== undefined) {
      writeDashboardSearchParam(params, "busqueda", next.busqueda)
    }

    if (next.evento !== undefined) {
      if (next.evento && next.evento !== "todos") params.set("evento", next.evento)
      else params.delete("evento")
    }

    if (next.desde !== undefined) {
      if (next.desde) params.set("desde", next.desde)
      else params.delete("desde")
    }

    if (next.hasta !== undefined) {
      if (next.hasta) params.set("hasta", next.hasta)
      else params.delete("hasta")
    }

    if (next.pageSize !== undefined) {
      if (next.pageSize) params.set("pageSize", next.pageSize)
      else params.delete("pageSize")
    }

    if (next.sortBy !== undefined) {
      if (next.sortBy) params.set("sortBy", next.sortBy)
      else params.delete("sortBy")
    }

    if (next.sortDir !== undefined) {
      params.set("sortDir", next.sortDir)
    }

    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }

  useEffect(() => {
    setFiltroEventoDraft(eventoFiltro)
    setFiltroDesdeDraft(desdeFiltro)
    setFiltroHastaDraft(hastaFiltro)
    setFiltroTodoDraft(!desdeFiltro && !hastaFiltro)
  }, [eventoFiltro, desdeFiltro, hastaFiltro])

  function applyGridFilters() {
    const params = new URLSearchParams(searchParams.toString())
    if (filtroEventoDraft && filtroEventoDraft !== "todos") params.set("evento", filtroEventoDraft)
    else params.delete("evento")
    if (!filtroTodoDraft && filtroDesdeDraft) params.set("desde", filtroDesdeDraft)
    else params.delete("desde")
    if (!filtroTodoDraft && filtroHastaDraft) params.set("hasta", filtroHastaDraft)
    else params.delete("hasta")
    params.set("page", "1")
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }

  async function verDetalle(comprador: CompradorListItem) {
    setSeleccionado(comprador)
    setCopiadoModal(false)
    setCambiarPassword(false)
    setNuevaPassword("")
    setPasswordOk(false)
    setCompras([])
    setComprasTotales(null)
    await withLoading(async () => {
      try {
        const res = await fetch(`/api/compradores/${comprador.id}/compras`)
        const json = await res.json().catch(() => null)
        if (!res.ok || !json) {
          toast.error("No se pudieron cargar las compras")
          return
        }
        // New shape: { data: { compras, totales } }
        if (json?.data?.compras) {
          setCompras(Array.isArray(json.data.compras) ? json.data.compras : [])
          setComprasTotales(json.data.totales ?? null)
        } else {
          // Fallback: legacy flat array (backwards compat during transition)
          setCompras(Array.isArray(json) ? json : [])
        }
      } catch {
        toast.error("No se pudieron cargar las compras")
      }
    })
  }

  function copiarEmailTabla(email: string, e: React.MouseEvent) {
    e.stopPropagation()
    navigator.clipboard.writeText(email)
    setCopiadoTabla(email)
    setTimeout(() => setCopiadoTabla(null), 2000)
  }

  async function handleCambiarPassword() {
    if (!seleccionado) return
    setPasswordOk(false)
    // No validamos la policy acá: la empresa puede setear cualquier contraseña.
    // El comprador la rota en su próximo login con la policy enforced (forzado
    // por must_change_password=true del lado del backend).
    if (!nuevaPassword) {
      toast.error("La contraseña es obligatoria")
      return
    }
    await withLoading(async () => {
      const res = await fetch(`/api/compradores/${seleccionado.id}/password`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nuevaPassword }),
      })
      if (res.ok) {
        toast.success("Contraseña actualizada")
        setPasswordOk(true)
        setNuevaPassword("")
        setTimeout(() => {
          setCambiarPassword(false)
          setPasswordOk(false)
        }, 2000)
      } else {
        const data = await res.json()
        toast.error(data.error ?? "Error al cambiar contraseña")
      }
    })
  }

  async function handleImpersonar() {
    if (!impersonarTarget) return
    setImpersonando(true)
    try {
      const res = await fetch(`/api/compradores/${impersonarTarget.id}/login-token`, { method: "POST" })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.token) {
        toast.error(data?.error ?? "No se pudo generar el acceso")
        return
      }
      const isDev = window.location.hostname.includes("local")
      const base = isDev
        ? `http://${data.slug}.Ticketera.local:3000`
        : `https://${data.slug}.ticketera.com`
      window.open(`${base}/auth/token?token=${data.token}`, "_blank")
    } finally {
      setImpersonando(false)
      setImpersonarTarget(null)
    }
  }

  function copiarEmailModal(email: string) {
    navigator.clipboard.writeText(email)
    setCopiadoModal(true)
    setTimeout(() => setCopiadoModal(false), 2000)
  }

  function toggleSort(column: string) {
    const nextDir: "asc" | "desc" = sortBy === column && sortDir === "asc" ? "desc" : "asc"
    updateQuery({ sortBy: column, sortDir: nextDir, page: 1 })
  }

  function getSortIcon(column: string) {
    if (sortBy !== column) return <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
    return sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
  }

  return (
    <TooltipProvider>
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Compradores</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {pagination.total} comprador{pagination.total !== 1 ? "es" : ""} registrado
            {pagination.total !== 1 ? "s" : ""}
          </p>
        </div>
        <CompradoresExportAction eventos={eventos} exportPath={exportPath} />
      </div>

      {summary != null && puede("ver_recaudacion") && (
        <CompradoresHeroSummary summary={summary} />
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Compradores filtrados</p>
          <p className="text-2xl font-black text-foreground">{totals.total_compradores}</p>
          <p className="text-xs text-muted-foreground mt-1">con los filtros actuales aplicados</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Entradas acumuladas</p>
          <p className="text-2xl font-black text-foreground">{totals.total_entradas}</p>
          <p className="text-xs text-muted-foreground mt-1">de todos los compradores filtrados</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Total gastado bruto</p>
          <p className="text-2xl font-black text-foreground font-mono tabular-nums">{formatMoney(totals.total_gastado)}</p>
          <p className="text-xs text-muted-foreground mt-1">por compradores filtrados</p>
        </div>
        <div className="rounded-2xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">Compradores con email</p>
          <p className="text-2xl font-black text-foreground">{totals.total_con_email}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {totals.total_compradores > 0
              ? `${Math.round((totals.total_con_email / totals.total_compradores) * 100)}% de cobertura`
              : "0% de cobertura"}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Filtros</h2>
            <p className="text-sm text-muted-foreground">Refiná qué compradores querés ver en la grilla.</p>
          </div>
          <Button type="button" onClick={applyGridFilters} className="w-full sm:w-auto">Buscar</Button>
        </div>

        <div className="grid gap-4 xl:grid-cols-4 xl:items-end">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Evento</label>
            <Select value={filtroEventoDraft} onValueChange={setFiltroEventoDraft}>
              <SelectTrigger className="h-10 bg-background w-full">
                <SelectValue placeholder="Todos los eventos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos los eventos</SelectItem>
                {eventos.map((ev) => (
                  <SelectItem key={ev.id} value={ev.id}>{ev.nombre}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end xl:col-span-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">Desde</label>
              <Input type="date" className="h-10 bg-background w-full" value={filtroDesdeDraft} max={filtroHastaDraft || undefined} disabled={filtroTodoDraft} onChange={(e) => setFiltroDesdeDraft(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">Hasta</label>
              <Input type="date" className="h-10 bg-background w-full" value={filtroHastaDraft} min={filtroDesdeDraft || undefined} disabled={filtroTodoDraft} onChange={(e) => setFiltroHastaDraft(e.target.value)} />
            </div>
            <label className="flex h-10 items-center gap-3 px-3 cursor-pointer bg-transparent">
              <input type="checkbox" checked={filtroTodoDraft} onChange={(e) => setFiltroTodoDraft(e.target.checked)} className="h-4 w-4 rounded border-border" />
              <span className="text-sm font-medium text-foreground">Todo</span>
            </label>
          </div>

        </div>
      </div>

      {/* Tabla */}
      <div className="space-y-3">
        <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
          <div className="border-b border-primary/15 bg-primary/8 px-5 py-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col sm:flex-row gap-3 xl:flex-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" className="gap-2 h-10 justify-between sm:w-40 bg-background/90 border-primary/15">
                    <span className="inline-flex items-center gap-2">
                      <Columns3 className="h-4 w-4" /> Columnas
                    </span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuLabel>Columnas visibles</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem checked={columnasVisibles.dni} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, dni: checked === true }))}>
                    DNI
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={columnasVisibles.entradas} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, entradas: checked === true }))}>
                    Entradas
                  </DropdownMenuCheckboxItem>
                  {puede("ver_montos_compradores") && (
                      <DropdownMenuCheckboxItem checked={columnasVisibles.totalGastado} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, totalGastado: checked === true }))}>
                        Total gastado bruto
                    </DropdownMenuCheckboxItem>
                  )}
                  <DropdownMenuCheckboxItem checked={columnasVisibles.ultimaCompra} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, ultimaCompra: checked === true }))}>
                    Última compra
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={columnasVisibles.alta} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, alta: checked === true }))}>
                    Alta
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9 h-10 bg-background/90 border-primary/15"
                  placeholder="Buscar por nombre, email o DNI..."
                  value={busquedaInput}
                  onChange={(e) => {
                    setBusquedaInput(e.target.value)
                  }}
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 xl:items-center xl:justify-end">
              <Select
                value={String(pageSize)}
                onValueChange={(value) => updateQuery({ pageSize: value, page: 1 })}
              >
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
                <IconAction label="Primera página" variant="ghost" size="icon-sm" className="size-10" onClick={() => updateQuery({ page: 1 })} disabled={pagination.page <= 1}>
                  <ChevronsLeft className="h-4 w-4" />
                </IconAction>
                <IconAction label="Página anterior" variant="ghost" size="icon-sm" className="size-10" onClick={() => updateQuery({ page: pagination.page - 1 })} disabled={pagination.page <= 1}>
                  <ChevronLeft className="h-4 w-4" />
                </IconAction>
                <IconAction label="Página siguiente" variant="ghost" size="icon-sm" className="size-10" onClick={() => updateQuery({ page: pagination.page + 1 })} disabled={pagination.page >= pagination.totalPages}>
                  <ChevronRight className="h-4 w-4" />
                </IconAction>
                <IconAction label="Última página" variant="ghost" size="icon-sm" className="size-10" onClick={() => updateQuery({ page: pagination.totalPages })} disabled={pagination.page >= pagination.totalPages}>
                  <ChevronsRight className="h-4 w-4" />
                </IconAction>
              </div>
            </div>
          </div>

          {compradores.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <Users className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-semibold text-foreground mb-1">No hay compradores</h3>
              <p className="text-muted-foreground text-sm">
                {busqueda || eventoFiltro !== "todos"
                  ? "No se encontraron compradores con ese filtro"
                  : "Todavía no hay compradores registrados"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-sm">
                <thead>
                  <tr className="border-b border-primary/15 bg-primary/10">
                    <th className="px-5 py-3.5 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
                      <button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("comprador")}>
                        Comprador {getSortIcon("comprador")}
                      </button>
                    </th>
                    {columnasVisibles.dni && <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-primary"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("dni")}>DNI {getSortIcon("dni")}</button></th>}
                    {columnasVisibles.entradas && <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-primary"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("total_entradas")}>Entradas {getSortIcon("total_entradas")}</button></th>}
                    {puede("ver_montos_compradores") && columnasVisibles.totalGastado && (
                      <th className="px-4 py-3.5 text-right text-[11px] font-semibold uppercase tracking-[0.16em] text-primary"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("total_gastado")}>Gasto bruto {getSortIcon("total_gastado")}</button></th>
                    )}
                    {columnasVisibles.ultimaCompra && <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-primary"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("ultima_compra")}>Última compra {getSortIcon("ultima_compra")}</button></th>}
                    {columnasVisibles.alta && <th className="px-4 py-3.5 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-primary"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("alta")}>Alta {getSortIcon("alta")}</button></th>}
                    <th className="px-5 py-3.5 text-right text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">Acción</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {compradores.map((c) => (
                    <tr
                      key={c.id}
                      className="group hover:bg-muted/20 transition-colors"
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                            {c.nombre?.[0]?.toUpperCase() ?? "?"}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <p className="font-medium text-foreground truncate">{c.nombre}{c.apellido ? ` ${c.apellido}` : ""}</p>
                            </div>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  type="button"
                                  className="text-xs text-muted-foreground truncate max-w-[260px] hover:text-primary transition-colors text-left"
                                  onClick={(e) => copiarEmailTabla(c.email ?? "", e)}
                                  aria-label={c.email ? `Copiar email ${c.email}` : "Sin email"}
                                >
                                  {copiadoTabla === c.email ? <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" />Copiado</span> : c.email ?? "Sin email"}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent>
                                {c.email ? (copiadoTabla === c.email ? "Email copiado" : `Copiar ${c.email}`) : "Sin email"}
                              </TooltipContent>
                            </Tooltip>
                          </div>
                        </div>
                      </td>
                      {columnasVisibles.dni && (
                        <td className="px-4 py-4">
                          {c.dni ? <Badge variant="secondary" className="font-mono tabular-nums">{c.dni}</Badge> : <span className="text-muted-foreground">—</span>}
                        </td>
                      )}
                      {columnasVisibles.entradas && <td className="px-4 py-4 font-semibold text-foreground">{c.total_entradas}</td>}
                      {puede("ver_montos_compradores") && columnasVisibles.totalGastado && (
                        <td className="px-4 py-4 text-right font-semibold text-foreground font-mono tabular-nums">{formatMoney(c.total_gastado)}</td>
                      )}
                      {columnasVisibles.ultimaCompra && (
                        <td className="px-4 py-4 text-muted-foreground text-xs whitespace-nowrap">
                          {formatDate(c.ultima_compra)}
                        </td>
                      )}
                      {columnasVisibles.alta && (
                        <td className="px-4 py-4 text-muted-foreground text-xs whitespace-nowrap">
                          {formatDate(c.created_at)}
                        </td>
                      )}
                      <td className="px-5 py-4 text-right">
                        <Button variant="ghost" size="sm" className="gap-2 opacity-90 group-hover:opacity-100" onClick={() => void verDetalle(c)}>
                          <Eye className="h-4 w-4" /> Ver detalle
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Badge variant="outline">Página {pagination.page} de {pagination.totalPages}</Badge>
              <span>{pagination.total} registros</span>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => updateQuery({ page: pagination.page - 1 })} disabled={pagination.page <= 1}>
                Anterior
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => updateQuery({ page: pagination.page + 1 })} disabled={pagination.page >= pagination.totalPages}>
                Siguiente
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Modal detalle */}
      <Dialog open={!!seleccionado} onOpenChange={() => setSeleccionado(null)}>
        <DialogContent className="sm:max-w-4xl w-full bg-card p-4 sm:p-6 overflow-x-hidden max-h-[90vh] overflow-y-auto">
          <DialogHeader className="pb-2">
            <DialogTitle className="text-foreground">Detalle del comprador</DialogTitle>
            <DialogDescription className="sr-only">
              Información detallada del comprador y su historial de compras
            </DialogDescription>
          </DialogHeader>

          {seleccionado && (
            <div className="space-y-4">
              {/* Identity */}
              <div className="flex items-center gap-3 pb-4 border-b border-border">
                <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-base shrink-0">
                  {seleccionado.nombre?.[0]?.toUpperCase() ?? "?"}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground truncate">
                    {seleccionado.nombre}{seleccionado.apellido ? ` ${seleccionado.apellido}` : ""}
                  </p>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="text-sm text-muted-foreground hover:text-primary transition-colors text-left max-w-full truncate block"
                        onClick={() => copiarEmailModal(seleccionado.email ?? "")}
                        aria-label={seleccionado.email ? `Copiar email ${seleccionado.email}` : "Sin email"}
                      >
                        {copiadoModal ? <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" />Copiado</span> : seleccionado.email ?? "Sin email"}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent>
                      {seleccionado.email ? (copiadoModal ? "Email copiado" : `Copiar ${seleccionado.email}`) : "Sin email"}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>

              {/* Two-column on md+ */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                {/* Left: stats + actions */}
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-muted/40 rounded-xl p-3">
                      <p className="text-[11px] text-muted-foreground mb-0.5">DNI</p>
                      <p className="text-sm font-medium text-foreground">{seleccionado.dni ?? "—"}</p>
                    </div>
                    <div className="bg-muted/40 rounded-xl p-3">
                      <p className="text-[11px] text-muted-foreground mb-0.5">Entradas</p>
                      <p className="text-sm font-medium text-foreground">{seleccionado.total_entradas}</p>
                    </div>
                    {puede("ver_montos_compradores") && (
                      <div className="bg-muted/40 rounded-xl p-3">
                        <p className="text-[11px] text-muted-foreground mb-0.5">Total gastado</p>
                        <p className="text-sm font-medium text-foreground font-mono tabular-nums">{formatMoney(seleccionado.total_gastado)}</p>
                      </div>
                    )}
                    <div className="bg-muted/40 rounded-xl p-3">
                      <p className="text-[11px] text-muted-foreground mb-0.5">Registrado</p>
                      <p className="text-sm font-medium text-foreground">
                        {formatDate(seleccionado.created_at)}
                      </p>
                    </div>
                    <div className="bg-muted/40 rounded-xl p-3">
                      <p className="text-[11px] text-muted-foreground mb-0.5">Última compra</p>
                      <p className="text-sm font-medium text-foreground">
                        {formatDate(seleccionado.ultima_compra)}
                      </p>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col gap-2 pt-3 border-t border-border">
                    {(!esEmpleado || puede("cambiar_password_compradores")) && (
                      <div>
                        {!cambiarPassword ? (
                          <button
                            className="text-xs text-muted-foreground hover:text-destructive transition-colors underline underline-offset-2"
                            onClick={() => setCambiarPassword(true)}
                          >
                            Cambiar contraseña
                          </button>
                        ) : (
                          <div className="bg-muted/40 rounded-xl p-3 space-y-2">
                            <p className="text-xs font-semibold text-foreground">Nueva contraseña</p>
                            <Input
                              type="password"
                              placeholder="Contraseña inicial"
                              value={nuevaPassword}
                              onChange={(e) => setNuevaPassword(e.target.value)}
                              className="h-8 text-sm bg-background"
                            />
                            <p className="text-[11px] text-muted-foreground">
                              Cualquier contraseña sirve — el comprador la rotará a una segura en su próximo login.
                            </p>
                            <div className="flex gap-2">
                              <button
                                className="text-xs px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-medium hover:bg-primary/90 transition-colors"
                                onClick={handleCambiarPassword}
                              >
                                {passwordOk ? <span className="inline-flex items-center gap-1"><Check className="h-3 w-3" />Guardado</span> : "Guardar"}
                              </button>
                              <button
                                className="text-xs px-2 py-1.5 rounded-lg bg-muted text-muted-foreground hover:bg-muted/70 transition-colors"
                                onClick={() => { setCambiarPassword(false); setNuevaPassword("") }}
                              >
                                Cancelar
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {(!esEmpleado || puede("ingresar_como_comprador")) && (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-primary transition-colors underline underline-offset-2 text-left disabled:opacity-50 disabled:pointer-events-none"
                        onClick={() => setImpersonarTarget(seleccionado)}
                        disabled={impersonando}
                      >
                        Ingresar como este comprador
                      </button>
                    )}
                  </div>
                </div>

                {/* Right: history */}
                <div>
                  <p className="text-sm font-semibold text-foreground mb-2">
                    Historial de compras
                    {compras.length > 0 && (
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        ({compras.length}{compras.length === 100 ? " — últimas 100" : ""})
                      </span>
                    )}
                  </p>
                  {comprasTotales && compras.length > 0 && (
                    <p className="text-xs text-muted-foreground mb-2">
                      {comprasTotales.entradas} {comprasTotales.entradas === 1 ? "entrada" : "entradas"}
                      {comprasTotales.consumibles > 0 && (
                        <> · {comprasTotales.consumibles} {comprasTotales.consumibles === 1 ? "consumible" : "consumibles"}</>
                      )}
                      {puede("ver_montos_compradores") && (
                        <> · Total {formatMoney(comprasTotales.gastado_total)}</>
                      )}
                    </p>
                  )}
                  {compras.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Sin compras registradas</p>
                  ) : (
                    <div className="space-y-2 max-h-[320px] overflow-y-auto pr-1">
                      {compras.map((c) => (
                        <div key={c.id} className="bg-muted/40 rounded-xl px-3 py-2.5">
                          <div className="flex items-center gap-1.5 mb-1 flex-wrap">
                            <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${
                              c.tipo === "entrada"
                                ? "bg-primary/10 text-primary"
                                : "bg-[color:var(--marketing-accent-soft)] text-[color:var(--marketing-accent)]"
                            }`}>
                              {c.tipo === "entrada" ? "Entrada" : "Consumible"}
                            </span>
                            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                              c.estado === "valida"
                                ? "bg-success/10 text-success"
                                : c.estado === "usada"
                                  ? "bg-muted text-muted-foreground"
                                  : c.estado === "canjeado"
                                    ? "bg-success/10 text-success"
                                    : c.estado === "pendiente"
                                      ? "bg-[color:var(--marketing-accent-soft)] text-[color:var(--marketing-accent)]"
                                      : c.estado === "resuelto_parcial"
                                        ? "bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                        : "bg-muted text-muted-foreground"
                            }`}>
                              {c.estado}
                            </span>
                          </div>
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-foreground">{c.evento_nombre}</p>
                              <p className="text-xs text-muted-foreground">
                                {c.tipo === "entrada"
                                  ? c.categoria_nombre ?? ""
                                  : c.barra_nombre ? `Barra: ${c.barra_nombre}` : ""}
                                {" · "}
                                {formatDate(c.created_at)}
                              </p>
                            </div>
                            {puede("ver_montos_compradores") && (
                              <p className="text-sm font-bold text-foreground shrink-0 ml-2 font-mono tabular-nums">
                                {formatMoney(c.precio_pagado)}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Confirmación impersonación */}
      <Dialog open={impersonarTarget !== null} onOpenChange={(open) => { if (!open && !impersonando) setImpersonarTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Ingresar como comprador?</DialogTitle>
            <DialogDescription>
              Vas a abrir la sesión de {impersonarTarget?.nombre}{impersonarTarget?.apellido ? ` ${impersonarTarget.apellido}` : ""} en una pestaña nueva. Vas a poder operar como si fueras este comprador.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={() => setImpersonarTarget(null)} disabled={impersonando}>Cancelar</Button>
            <Button type="button" onClick={() => void handleImpersonar()} disabled={impersonando} className="gap-2">
              {impersonando && <Loader2 className="h-4 w-4 animate-spin" />}
              {impersonando ? "Abriendo..." : "Ingresar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
    </TooltipProvider>
  )
}
