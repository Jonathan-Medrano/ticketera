"use client"

import { useEffect, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { writeDashboardSearchParam } from "@/lib/dashboard-grid-search"
import { useDashboardDebouncedSearch } from "@/lib/use-dashboard-debounced-search"
import { formatMoney, formatInt, formatDate } from "@/lib/format"
import { toast } from "sonner"
import {
  Plus,
  Search,
  TrendingUp,
  ShoppingBag,
  Store,
  Eye,
  EyeOff,
  Power,
  Trash2,
  AlertTriangle,
  Columns3,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  HelpCircle,
  FileSpreadsheet,
  FileText,
  Download,
  Loader2,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { IconAction } from "@/components/ui/icon-action"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Badge } from "@/components/ui/badge"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import PasswordInput from "@/components/password-input"
import { useLoading } from "@/components/loading-provider"
import { puedeHacer, type Permisos } from "@/lib/permisos"

interface Props {
  revendedores: Array<{
    id: string
    nombre: string
    apellido?: string | null
    email: string
    activo: number
    porcentaje_comision?: number | null
    created_at: string
    total_ventas: number
    total_generado: number
    total_comision: number
  }>
  comisionDefault: number
  eventos: Array<{
    id: string
    nombre: string
    total_ventas: number
  }>
  stats: {
    totalRevendedores: number
    totalActivos: number
    totalInactivos: number
    totalGenerado: number
    totalComision: number
  }
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  exportPath?: string | null
  permisos?: Permisos
  esEmpleado?: boolean
}

function resolveExportFilename(disposition: string | null | undefined, fallback: string) {
  return disposition?.match(/filename="?([^";]+)"?/)?.[1] ?? fallback
}

function RevendedoresExportAction({ exportPath, eventos = [] }: { exportPath?: string | null; eventos?: Array<{ id: string; nombre: string; total_ventas: number }> }) {
  const [open, setOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [evento, setEvento] = useState("todos")
  const [estado, setEstado] = useState("todos")
  const [todoPeriodo, setTodoPeriodo] = useState(true)
  const [desde, setDesde] = useState("")
  const [hasta, setHasta] = useState("")
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx">("xlsx")

  async function handleExport(format: "csv" | "xlsx" | "payout") {
    if (!exportPath || isExporting) return
    setIsExporting(true)
    try {
      const targetPath = format === "payout"
        ? "/api/revendedores/payouts/export"
        : exportPath
      const url = new URL(targetPath, "https://platea.local")
      if (evento && evento !== "todos") url.searchParams.set("evento", evento)
      else url.searchParams.delete("evento")
      if (estado && estado !== "activos") url.searchParams.set("estado", estado)
      else url.searchParams.delete("estado")
      if (estado === "todos") url.searchParams.set("mostrarInactivos", "1")
      else url.searchParams.delete("mostrarInactivos")
      if (todoPeriodo) {
        url.searchParams.delete("desde")
        url.searchParams.delete("hasta")
      } else {
        if (desde) url.searchParams.set("desde", desde)
        else url.searchParams.delete("desde")
        if (hasta) url.searchParams.set("hasta", hasta)
        else url.searchParams.delete("hasta")
      }
      if (format !== "payout") {
        url.searchParams.set("format", format)
      }
      const response = await fetch(url, { method: "GET" })
      if (!response.ok) { toast.error("No se pudo exportar"); return }
      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = downloadUrl
      const fallbackFilename = format === "xlsx"
        ? "Revendedores_Resumen.xlsx"
        : format === "payout"
          ? "Liquidacion_Comisiones.csv"
          : "Revendedores_Resumen.csv"
      link.download = resolveExportFilename(response.headers.get("content-disposition"), fallbackFilename)
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
      <Button type="button" className="h-10 px-6" onClick={() => setOpen(true)} disabled={isExporting}>
        {isExporting ? "Procesando..." : "Exportar"}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Exportar revendedores</DialogTitle>
            <DialogDescription>Descargá el resumen de tus revendedores en el formato que prefieras.</DialogDescription>
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
                    <SelectItem key={ev.id} value={ev.id}>{ev.nombre} ({Number(ev.total_ventas ?? 0)})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-xs font-medium text-muted-foreground">Estado</label>
              <Select value={estado} onValueChange={setEstado}>
                <SelectTrigger className="h-11 w-full bg-background">
                  <SelectValue placeholder="Ambos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Ambos</SelectItem>
                  <SelectItem value="activos">Solo activos</SelectItem>
                  <SelectItem value="inactivos">Solo inactivos</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end">
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">Desde</label>
                <Input type="date" className="h-11 min-w-0 bg-background" value={desde} max={hasta || undefined} disabled={todoPeriodo || isExporting} onChange={(event) => setDesde(event.target.value)} />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-medium text-muted-foreground">Hasta</label>
                <Input type="date" className="h-11 min-w-0 bg-background" value={hasta} min={desde || undefined} disabled={todoPeriodo || isExporting} onChange={(event) => setHasta(event.target.value)} />
              </div>
              <div className="flex h-11 items-center gap-3 px-3">
                <Checkbox
                  id="export-todo-periodo"
                  checked={todoPeriodo}
                  onCheckedChange={(v) => setTodoPeriodo(v as boolean)}
                />
                <label htmlFor="export-todo-periodo" className="text-sm font-medium text-foreground cursor-pointer">Todo</label>
              </div>
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
            <div className="flex gap-2">
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => void handleExport("payout")}
                      disabled={isExporting}
                      className="gap-1 pl-3 pr-2.5"
                    >
                      Liquidación
                      <HelpCircle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs text-xs leading-relaxed">
                    Calcula la comisión a pagar a cada revendedor por las ventas del período. Excluye revendedores sin actividad.
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button type="button" onClick={() => void handleExport(exportFormat)} disabled={isExporting} className="gap-2">
                {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {isExporting ? "Exportando..." : "Exportar"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

export default function RevendedoresContent({
  revendedores,
  comisionDefault,
  eventos,
  stats,
  pagination,
  exportPath,
  permisos,
  esEmpleado,
}: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { withLoading } = useLoading()
  const [modalAgregar, setModalAgregar] = useState(false)
  const [modalEliminar, setModalEliminar] = useState<(typeof revendedores)[number] | null>(null)
  const [confirmToggle, setConfirmToggle] = useState<{ id: string; activo: boolean; nombre: string } | null>(null)
  const [comisionDefaultVal, setComisionDefaultVal] = useState(comisionDefault.toString())
  const busqueda = searchParams.get("busqueda") ?? ""
  const eventoFiltro = searchParams.get("evento") ?? "todos"
  const desdeFiltro = searchParams.get("desde") ?? ""
  const hastaFiltro = searchParams.get("hasta") ?? ""
  const mostrarInactivos = searchParams.get("mostrarInactivos") === "1"
  const estadoFiltro = searchParams.get("estado") === "inactivos" ? "inactivos" : mostrarInactivos ? "todos" : "activos"
  const sortBy = searchParams.get("sortBy") ?? "total_generado"
  const sortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc"
  const pageSize = pagination.pageSize
  const rangeStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1
  const rangeEnd = Math.min(pagination.total, pagination.page * pagination.pageSize)

  const puede = (permiso: keyof Permisos) => puedeHacer(permiso, esEmpleado ?? false, permisos)
  const hayRevendedores = pagination.total > 0

  const [form, setForm] = useState({
    nombre: "",
    apellido: "",
    email: "",
    password: "",
    porcentaje_comision: comisionDefault.toString(),
    ver_comision_propia: true,
    ver_ganancia_propia: true,
  })
  const [columnasVisibles, setColumnasVisibles] = useState({
    ventas: true,
    totalGenerado: true,
    comision: true,
    estado: true,
    alta: true,
  })
  const [filtroEventoDraft, setFiltroEventoDraft] = useState(eventoFiltro)
  const [filtroDesdeDraft, setFiltroDesdeDraft] = useState(desdeFiltro)
  const [filtroHastaDraft, setFiltroHastaDraft] = useState(hastaFiltro)
  const [filtroTodoDraft, setFiltroTodoDraft] = useState(!desdeFiltro && !hastaFiltro)
  const [filtroEstadoDraft, setFiltroEstadoDraft] = useState(estadoFiltro)
  const { value: busquedaInput, setValue: setBusquedaInput } = useDashboardDebouncedSearch({
    urlValue: busqueda,
    emit: (next) => updateQuery({ busqueda: next, page: 1 }),
  })

  function resetForm() {
    setForm({
      nombre: "",
      apellido: "",
      email: "",
      password: "",
      porcentaje_comision: comisionDefault.toString(),
      ver_comision_propia: true,
      ver_ganancia_propia: true,
    })
  }

  function cerrarAgregar() {
    setModalAgregar(false)
    resetForm()
  }

  function updateQuery(next: {
    page?: number
    pageSize?: string
    busqueda?: string
    evento?: string
    desde?: string
    hasta?: string
    estado?: string
    mostrarInactivos?: boolean
    sortBy?: string
    sortDir?: "asc" | "desc"
  }) {
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

    if (next.estado !== undefined) {
      if (next.estado && next.estado !== "activos") params.set("estado", next.estado)
      else params.delete("estado")
    }

    if (next.mostrarInactivos !== undefined) {
      if (next.mostrarInactivos) params.set("mostrarInactivos", "1")
      else params.delete("mostrarInactivos")
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

  function toggleSort(column: string) {
    const nextDir: "asc" | "desc" = sortBy === column && sortDir === "asc" ? "desc" : "asc"
    updateQuery({ sortBy: column, sortDir: nextDir, page: 1 })
  }

  function getSortIcon(column: string) {
    if (sortBy !== column) return <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
    return sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
  }

  useEffect(() => {
    // Sincroniza los drafts de filtro con los params de URL cuando estos cambian.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncs draft filter state from URL params
    setFiltroEventoDraft(eventoFiltro)
    setFiltroDesdeDraft(desdeFiltro)
    setFiltroHastaDraft(hastaFiltro)
    setFiltroTodoDraft(!desdeFiltro && !hastaFiltro)
    setFiltroEstadoDraft(estadoFiltro)
  }, [eventoFiltro, desdeFiltro, hastaFiltro, estadoFiltro])

  function applyGridFilters() {
    updateQuery({
      evento: filtroEventoDraft,
      desde: filtroTodoDraft ? "" : filtroDesdeDraft,
      hasta: filtroTodoDraft ? "" : filtroHastaDraft,
      estado: filtroEstadoDraft,
      mostrarInactivos: filtroEstadoDraft !== "activos",
      page: 1,
    })
  }

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault()

    // No validamos la policy de contraseña acá: la empresa puede setear cualquier
    // contraseña inicial. El revendedor la rota en su primer login (forzado por
    // must_change_password=true) con la policy enforced del lado del usuario.
    if (!form.password) {
      toast.error("La contraseña es obligatoria")
      return
    }
    const comVal = Number(form.porcentaje_comision)
    if (isNaN(comVal) || comVal < 0 || comVal > 100) {
      toast.error("La comisión debe ser un número entre 0 y 100")
      return
    }

    await withLoading(async () => {
      const res = await fetch("/api/equipo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: form.nombre,
          apellido: form.apellido,
          email: form.email,
          password: form.password,
          rol: "revendedor",
          porcentaje_comision: comVal,
          permisos: {
            ver_comision_propia: form.ver_comision_propia,
            ver_ganancia_propia: form.ver_ganancia_propia,
          },
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Error al crear revendedor")
        return
      }
      toast.success("Revendedor creado correctamente")
      setModalAgregar(false)
      resetForm()
      router.refresh()
    })
  }

  async function toggleActivo(id: string, activo: boolean) {
    await withLoading(async () => {
      const res = await fetch(`/api/equipo/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: activo ? 0 : 1 }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? "No se pudo actualizar el estado")
        return
      }
      toast.success(activo ? "Revendedor desactivado" : "Revendedor activado")
      router.refresh()
    })
  }

  async function confirmarEliminar() {
    if (!modalEliminar) return
    await withLoading(async () => {
      const res = await fetch(`/api/equipo/${modalEliminar.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? "No se pudo eliminar el revendedor")
        setModalEliminar(null)
        return
      }
      toast.success("Revendedor eliminado")
      setModalEliminar(null)
      router.refresh()
    })
  }

  async function guardarComisionDefault() {
    const val = Number(comisionDefaultVal)
    if (isNaN(val) || val < 0 || val > 100) {
      toast.error("La comisión debe ser un número entre 0 y 100")
      return
    }
    await withLoading(async () => {
      try {
        const res = await fetch("/api/equipo/comision-default", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ comision: val }),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          toast.error((data as { error?: string }).error ?? "No se pudo guardar la comisión")
          return
        }
        toast.success("Comisión default actualizada")
      } catch {
        toast.error("No se pudo guardar la comisión")
      }
    })
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Revendedores</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {stats.totalActivos} activo{stats.totalActivos !== 1 ? "s" : ""}
            {stats.totalInactivos > 0 &&
              ` · ${stats.totalInactivos} inactivo${stats.totalInactivos !== 1 ? "s" : ""}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <RevendedoresExportAction exportPath={exportPath} eventos={eventos} />
          {puede("gestionar_revendedores") && (
            <Button className="gap-2 h-10 px-6" onClick={() => setModalAgregar(true)}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Nuevo revendedor</span>
            </Button>
          )}
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Filtros</h2>
            <p className="text-sm text-muted-foreground">Refiná qué revendedores querés ver en la grilla.</p>
          </div>
          <Button type="button" onClick={applyGridFilters} className="w-full sm:w-auto">Buscar</Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 xl:items-end">
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

          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Estado</label>
              <Select value={filtroEstadoDraft} onValueChange={setFiltroEstadoDraft}>
                <SelectTrigger className="h-10 bg-background w-full">
                  <SelectValue placeholder="Ambos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Ambos</SelectItem>
                  <SelectItem value="activos">Solo activos</SelectItem>
                  <SelectItem value="inactivos">Solo inactivos</SelectItem>
                </SelectContent>
              </Select>
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
            <div className="flex h-10 items-center gap-3 px-3">
              <Checkbox
                id="filtro-todo-periodo"
                checked={filtroTodoDraft}
                onCheckedChange={(v) => setFiltroTodoDraft(v as boolean)}
              />
              <label htmlFor="filtro-todo-periodo" className="text-sm font-medium text-foreground cursor-pointer">Todo</label>
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      {hayRevendedores && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            {
              label: "Revendedores activos",
              value: stats.totalActivos,
              icon: Store,
              color: "text-primary",
              bg: "bg-primary/10",
            },
            {
              label: "Venta bruta generada",
              value: formatMoney(stats.totalGenerado),
              icon: TrendingUp,
              color: "text-success",
              bg: "bg-success/10",
            },
            {
              label: "Total en comisiones",
              value: formatMoney(stats.totalComision),
              icon: TrendingUp,
              color: "text-amber-600",
              bg: "bg-amber-500/10",
            },
          ].map(({ label, value, icon: Icon, color, bg }) => (
            <div key={label} className="bg-card rounded-2xl border border-border p-4 md:p-5">
              <div
                className={`h-8 w-8 md:h-9 md:w-9 rounded-xl ${bg} flex items-center justify-center mb-3`}
              >
                <Icon className={`h-4 w-4 ${color}`} />
              </div>
              <p className="text-xs text-muted-foreground mb-1">{label}</p>
              <p className="text-xl md:text-2xl font-bold text-foreground font-mono tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Comisión default */}
      {hayRevendedores && puede("gestionar_revendedores") && (
        <div className="bg-card rounded-2xl border border-border p-5 flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-foreground">
              Comisión default para nuevos revendedores
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Se asigna automáticamente al crear un revendedor
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="relative w-28">
              <Input
                type="number"
                min="0"
                max="100"
                className="h-9 pr-7"
                value={comisionDefaultVal}
                onChange={(e) => setComisionDefaultVal(e.target.value)}
              />
              <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                %
              </span>
            </div>
            <Button size="sm" className="h-9 px-6" onClick={guardarComisionDefault}>
              Guardar
            </Button>
          </div>
        </div>
      )}

      {/* Lista */}
      <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
        <div className="border-b border-border bg-muted/30 px-5 py-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
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
                <DropdownMenuCheckboxItem checked={columnasVisibles.ventas} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, ventas: checked === true }))}>Ventas</DropdownMenuCheckboxItem>
                 <DropdownMenuCheckboxItem checked={columnasVisibles.totalGenerado} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, totalGenerado: checked === true }))}>Venta bruta generada</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={columnasVisibles.comision} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, comision: checked === true }))}>Comisión</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={columnasVisibles.estado} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, estado: checked === true }))}>Estado</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={columnasVisibles.alta} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, alta: checked === true }))}>Alta</DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9 h-10 bg-background/90 border-primary/15"
                placeholder="Buscar revendedor..."
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
              <IconAction label="Primera página" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: 1 })} disabled={pagination.page <= 1}><ChevronsLeft className="h-4 w-4" /></IconAction>
              <IconAction label="Página anterior" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: pagination.page - 1 })} disabled={pagination.page <= 1}><ChevronLeft className="h-4 w-4" /></IconAction>
              <IconAction label="Página siguiente" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: pagination.page + 1 })} disabled={pagination.page >= pagination.totalPages}><ChevronRight className="h-4 w-4" /></IconAction>
              <IconAction label="Última página" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: pagination.totalPages })} disabled={pagination.page >= pagination.totalPages}><ChevronsRight className="h-4 w-4" /></IconAction>
            </div>
          </div>
        </div>
          {revendedores.length === 0 ? (
            <div className="px-6 py-16 text-center">
              <Store className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-semibold text-foreground mb-1">Sin revendedores</h3>
              <p className="text-muted-foreground text-sm mb-4">
                {busqueda
                  ? "No se encontraron revendedores con ese criterio de búsqueda"
                  : "Todavía no hay revendedores cargados para esta empresa"}
              </p>
              {puede("gestionar_revendedores") && !busqueda && (
                <Button className="gap-2" onClick={() => setModalAgregar(true)}>
                  <Plus className="h-4 w-4" /> Crear revendedor
                </Button>
              )}
            </div>
          ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px] text-sm">
              <thead>
                <tr className="border-b border-primary/15 bg-primary/10">
                  <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">
                    <button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("revendedor")}>
                      Revendedor {getSortIcon("revendedor")}
                    </button>
                  </th>
                  {columnasVisibles.ventas && <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("total_ventas")}>Ventas {getSortIcon("total_ventas")}</button></th>}
                  {columnasVisibles.totalGenerado && <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em] hidden md:table-cell"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("total_generado")}>Venta bruta {getSortIcon("total_generado")}</button></th>}
                  {columnasVisibles.comision && <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em] hidden md:table-cell"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("total_comision")}>Comisión {getSortIcon("total_comision")}</button></th>}
                  {columnasVisibles.estado && <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("estado")}>Estado {getSortIcon("estado")}</button></th>}
                  {columnasVisibles.alta && <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em] hidden lg:table-cell"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("alta")}>Alta {getSortIcon("alta")}</button></th>}
                  <th className="px-5 py-3.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {revendedores.map((r) => (
                  <tr
                    key={r.id}
                    className={`hover:bg-muted/30 transition-colors ${!r.activo ? "opacity-60" : ""}`}
                  >
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                          {r.nombre?.[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">
                            {r.nombre} {r.apellido ?? ""}
                          </p>
                          <p className="text-xs text-muted-foreground truncate max-w-[150px] md:max-w-xs">
                            {r.email}
                          </p>
                          <p className="text-xs text-muted-foreground md:hidden mt-0.5 font-mono tabular-nums">
                            {formatMoney(r.total_generado)} ·{" "}
                            {r.porcentaje_comision ?? 0}%
                          </p>
                        </div>
                      </div>
                    </td>
                    {columnasVisibles.ventas && <td className="px-4 py-4">
                      <div className="flex items-center gap-1.5 text-foreground">
                        <ShoppingBag className="h-3.5 w-3.5 text-muted-foreground" />
                        {r.total_ventas}
                      </div>
                    </td>}
                    {columnasVisibles.totalGenerado && <td className="px-4 py-4 font-medium text-foreground hidden md:table-cell font-mono tabular-nums">
                      {formatMoney(r.total_generado)}
                    </td>}
                    {columnasVisibles.comision && <td className="px-4 py-4 hidden md:table-cell">
                      <div>
                        <p className="font-medium text-foreground font-mono tabular-nums">{r.porcentaje_comision ?? 0}%</p>
                        <p className="text-xs text-muted-foreground font-mono tabular-nums">
                          {formatMoney(r.total_comision)}
                        </p>
                      </div>
                    </td>}
                    {columnasVisibles.estado && <td className="px-4 py-4">
                      <Badge
                        variant="outline"
                        className={`text-xs font-medium px-2.5 py-1 ${
                          r.activo
                            ? "bg-success/10 text-success border-success/20"
                            : "bg-muted text-muted-foreground border-border"
                        }`}
                      >
                        {r.activo ? "Activo" : "Inactivo"}
                      </Badge>
                    </td>}
                    {columnasVisibles.alta && <td className="px-4 py-4 text-muted-foreground text-xs hidden lg:table-cell font-mono tabular-nums">{formatDate(r.created_at)}</td>}
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1 justify-end">
                        <IconAction
                          href={`/dashboard/revendedores/${r.id}`}
                          label="Ver detalle del revendedor"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0"
                        >
                            <Eye className="h-4 w-4" />
                        </IconAction>
                        {puede("gestionar_revendedores") && (
                          <>
                            <IconAction
                              label={r.activo ? "Desactivar revendedor" : "Activar revendedor"}
                              variant="ghost"
                              size="sm"
                              className={`h-8 w-8 p-0 ${
                                r.activo
                                  ? "text-amber-600 hover:text-amber-700 hover:bg-amber-500/10"
                                  : "text-success hover:text-success hover:bg-success/10"
                              }`}
                              onClick={() =>
                                setConfirmToggle({
                                  id: r.id,
                                  activo: Boolean(r.activo),
                                  nombre: `${r.nombre} ${r.apellido ?? ""}`.trim(),
                                })
                              }
                            >
                              <Power className="h-4 w-4" />
                            </IconAction>
                            <IconAction
                              label="Eliminar revendedor"
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => setModalEliminar(r)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </IconAction>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}
        </div>

      {/* Modal agregar */}
      <Dialog
        open={modalAgregar}
        onOpenChange={(v) => {
          if (!v) {
            cerrarAgregar()
          } else {
            setModalAgregar(true)
          }
        }}
      >
        <DialogContent className="bg-card max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Nuevo revendedor</DialogTitle>
            <DialogDescription className="sr-only">
              Completá los datos del nuevo revendedor
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCrear} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="rev-nombre" className="text-xs text-muted-foreground">Nombre</Label>
                <Input
                  id="rev-nombre"
                  className="h-10"
                  placeholder="Juan"
                  maxLength={100}
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="rev-apellido" className="text-xs text-muted-foreground">
                  Apellido <span className="opacity-50">(opc.)</span>
                </Label>
                <Input
                  id="rev-apellido"
                  className="h-10"
                  placeholder="García"
                  maxLength={100}
                  value={form.apellido}
                  onChange={(e) => setForm({ ...form, apellido: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rev-email" className="text-xs text-muted-foreground">Email</Label>
              <Input
                id="rev-email"
                className="h-10"
                type="email"
                placeholder="juan@email.com"
                maxLength={254}
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Contraseña</Label>
              <PasswordInput
                placeholder="Contraseña inicial"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
              <p className="text-xs text-muted-foreground">
                Podés poner cualquier contraseña — el revendedor la rotará a una segura en su primer login.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="rev-comision" className="text-xs text-muted-foreground">Comisión %</Label>
              <div className="relative">
                <Input
                  id="rev-comision"
                  className="h-10 pr-8"
                  type="number"
                  min="0"
                  max="100"
                  value={form.porcentaje_comision}
                  onChange={(e) => setForm({ ...form, porcentaje_comision: e.target.value })}
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                  %
                </span>
              </div>
            </div>
            <div className="space-y-2">
              <Label className="text-xs text-muted-foreground">Permisos</Label>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="rev-ver-comision"
                  checked={form.ver_comision_propia}
                  onCheckedChange={(v) => setForm({ ...form, ver_comision_propia: v as boolean })}
                />
                <label htmlFor="rev-ver-comision" className="text-sm text-foreground cursor-pointer">Puede ver su comisión</label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="rev-ver-ganancia"
                  checked={form.ver_ganancia_propia}
                  onCheckedChange={(v) => setForm({ ...form, ver_ganancia_propia: v as boolean })}
                />
                <label htmlFor="rev-ver-ganancia" className="text-sm text-foreground cursor-pointer">Puede ver sus ingresos</label>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1 h-10"
                onClick={cerrarAgregar}
              >
                Cancelar
              </Button>
              <Button type="submit" className="flex-1 h-10">
                Crear revendedor
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal eliminar */}
      <Dialog open={!!modalEliminar} onOpenChange={() => setModalEliminar(null)}>
        <DialogContent className="bg-card sm:max-w-sm p-6">
          <DialogHeader>
            <DialogTitle className="text-foreground">¿Eliminar revendedor?</DialogTitle>
            <DialogDescription className="sr-only">Confirmar eliminación</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-destructive/10 border border-destructive/20 rounded-xl p-4">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">
                  {modalEliminar?.nombre} {modalEliminar?.apellido ?? ""}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Se eliminará permanentemente. Su historial de ventas quedará sin revendedor
                  asignado. Esta acción no se puede deshacer.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 h-10"
                onClick={() => setModalEliminar(null)}
              >
                Cancelar
              </Button>
              <Button variant="destructive" className="flex-1 h-10" onClick={confirmarEliminar}>
                Eliminar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmar activar/desactivar */}
      <Dialog open={confirmToggle !== null} onOpenChange={(v) => { if (!v) setConfirmToggle(null) }}>
        <DialogContent className="bg-card sm:max-w-sm p-6">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {confirmToggle?.activo ? "¿Desactivar revendedor?" : "¿Activar revendedor?"}
            </DialogTitle>
            <DialogDescription className="sr-only">Confirmar cambio de estado</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-muted/50 border border-border rounded-xl p-4">
              <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">
                  {confirmToggle?.nombre}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {confirmToggle?.activo
                    ? "Al desactivarlo, deja de vender y de generar comisiones. Podés reactivarlo cuando quieras."
                    : "Al activarlo, vuelve a operar: puede vender y generar comisiones nuevamente."}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 h-10"
                onClick={() => setConfirmToggle(null)}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 h-10"
                onClick={() => {
                  if (!confirmToggle) return
                  void toggleActivo(confirmToggle.id, confirmToggle.activo)
                  setConfirmToggle(null)
                }}
              >
                {confirmToggle?.activo ? "Desactivar" : "Activar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
