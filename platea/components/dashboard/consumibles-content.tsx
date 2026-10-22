"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { writeDashboardSearchParam } from "@/lib/dashboard-grid-search"
import { useDashboardDebouncedSearch } from "@/lib/use-dashboard-debounced-search"
import { toast } from "sonner"
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Button } from "@/components/ui/button"
import { IconAction } from "@/components/ui/icon-action"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { ImageUploadInput } from "@/components/dashboard/image-upload-input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Plus,
  ShoppingBag,
  Store,
  Pencil,
  Search,
  Trash2,
  AlertTriangle,
  ToggleLeft,
  ToggleRight,
  Columns3,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Download,
  Loader2,
} from "lucide-react"
import { useLoading } from "@/components/loading-provider"
import { puedeHacer, type Permisos } from "@/lib/permisos"
import { consumiblesApi } from "@/lib/api"
import { formatMoney, formatDate } from "@/lib/format"

type ConsumibleTipo = "bebida_alcoholica" | "bebida_sin_alcohol" | "comida" | "otro"

const CONSUMIBLE_TIPO_OPTIONS: Array<{ value: ConsumibleTipo; label: string }> = [
  { value: "bebida_alcoholica", label: "Bebida con alcohol" },
  { value: "bebida_sin_alcohol", label: "Bebida sin alcohol" },
  { value: "comida", label: "Comida" },
  { value: "otro", label: "Otro" },
]

type ConsumibleItem = {
  id: string
  nombre: string
  descripcion?: string | null
  categoria?: string | null
  tipo?: ConsumibleTipo | null
  precio: number
  imagen_url?: string | null
  activo: number
  archived_at?: string | null
}

interface Props {
  consumibles: ConsumibleItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  permisos?: Permisos
  esEmpleado?: boolean
}

interface FormData {
  nombre: string
  descripcion: string
  categoria: string
  tipo: ConsumibleTipo
  precio: string
  imagen_url: string
}

const FORM_VACIO: FormData = { nombre: "", descripcion: "", categoria: "", tipo: "otro", precio: "", imagen_url: "" }

// ─── Export catálogo ──────────────────────────────────────────────────────────

type CatalogoExportEstado = "activos" | "inactivos" | "todos"
type CatalogoExportFormato = "xlsx" | "csv"

function ConsumiblesCatalogoExportAction() {
  const [isOpen, setIsOpen] = useState(false)
  const [isExporting, setIsExporting] = useState(false)
  const [estado, setEstado] = useState<CatalogoExportEstado>("activos")
  const [formato, setFormato] = useState<CatalogoExportFormato>("xlsx")

  async function handleExport() {
    if (isExporting) return
    setIsExporting(true)

    try {
      const incluirInactivos = estado === "todos" ? "1" : "0"
      const url = `/api/consumibles/export?formato=${formato}&incluir_inactivos=${incluirInactivos}&estado=${estado}`
      const response = await fetch(url, { method: "GET" })

      if (!response.ok) return

      const blob = await response.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = downloadUrl
      link.download = `consumibles-catalogo.${formato}`
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.URL.revokeObjectURL(downloadUrl)
    } finally {
      setIsExporting(false)
      setIsOpen(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        className="gap-2 h-10"
        onClick={() => setIsOpen(true)}
        disabled={isExporting}
      >
        <Download className="h-4 w-4" />
        Exportar
      </Button>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Exportar catálogo</DialogTitle>
            <DialogDescription className="sr-only">Exportar listado de consumibles</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label>Estado</Label>
              <Select value={estado} onValueChange={(v) => setEstado(v as CatalogoExportEstado)}>
                <SelectTrigger className="h-10 w-full bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="activos">Activos</SelectItem>
                  <SelectItem value="inactivos">Inactivos</SelectItem>
                  <SelectItem value="todos">Todos</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Formato</Label>
              <Select value={formato} onValueChange={(v) => setFormato(v as CatalogoExportFormato)}>
                <SelectTrigger className="h-10 w-full bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="xlsx">Excel (.xlsx)</SelectItem>
                  <SelectItem value="csv">CSV (.csv)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex gap-2 pt-4">
            <Button variant="outline" className="flex-1 h-10" onClick={() => setIsOpen(false)} disabled={isExporting}>
              Cancelar
            </Button>
            <Button className="flex-1 h-10 gap-2" onClick={() => void handleExport()} disabled={isExporting}>
              {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isExporting ? "Exportando..." : "Exportar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

// ─────────────────────────────────────────────────────────────────────────────

export default function ConsumiblesContent({ consumibles: init, pagination, permisos, esEmpleado }: Props) {
  const puede = (permiso: keyof Permisos) => puedeHacer(permiso, esEmpleado ?? false, permisos)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { withLoading } = useLoading()
  const busqueda = searchParams.get("busqueda") ?? ""
  const estadoFiltro = searchParams.get("estado") ?? "todos"
  const sortBy = searchParams.get("sortBy") ?? "nombre"
  const sortDir = searchParams.get("sortDir") === "desc" ? "desc" : "asc"
  const pageSize = pagination.pageSize
  const rangeStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1
  const rangeEnd = Math.min(pagination.total, pagination.page * pagination.pageSize)

  const [consumibles, setConsumibles] = useState(init)
  const [modalForm, setModalForm] = useState<ConsumibleItem | "nuevo" | null>(null)
  const [modalEliminar, setModalEliminar] = useState<ConsumibleItem | null>(null)
  const [form, setForm] = useState<FormData>(FORM_VACIO)
  const [columnasVisibles, setColumnasVisibles] = useState({
    precio: true,
    estado: true,
  })
  const { value: busquedaInput, setValue: setBusquedaInput } = useDashboardDebouncedSearch({
    urlValue: busqueda,
    emit: (next) => updateQuery({ busqueda: next, page: 1 }),
  })

  useEffect(() => {
    setConsumibles(init)
  }, [init])

  function updateQuery(next: { page?: number; pageSize?: string; busqueda?: string; estado?: string; sortBy?: string; sortDir?: "asc" | "desc" }) {
    const params = new URLSearchParams(searchParams.toString())

    if (next.page !== undefined) params.set("page", String(next.page))

    if (next.pageSize !== undefined) {
      if (next.pageSize) params.set("pageSize", next.pageSize)
      else params.delete("pageSize")
    }

    if (next.busqueda !== undefined) {
      writeDashboardSearchParam(params, "busqueda", next.busqueda)
    }

    if (next.estado !== undefined) {
      if (next.estado && next.estado !== "todos") params.set("estado", next.estado)
      else params.delete("estado")
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

  function abrirNuevo() {
    setForm(FORM_VACIO)
    setModalForm("nuevo")
  }

  function abrirEditar(c: ConsumibleItem) {
    setForm({
      nombre: c.nombre ?? "",
      descripcion: c.descripcion ?? "",
      categoria: c.categoria ?? "",
      tipo: c.tipo ?? "otro",
      precio: String(c.precio ?? ""),
      imagen_url: c.imagen_url ?? "",
    })
    setModalForm(c)
  }

  async function guardar() {
    const nombre = form.nombre.trim()
    if (!nombre) {
      toast.error("El nombre es obligatorio")
      return
    }
    if (!form.precio || Number(form.precio) <= 0) {
      toast.error("El precio debe ser mayor a 0")
      return
    }

    const imagenUrl = form.imagen_url.trim()
    if (imagenUrl && !/^https:\/\/.+/i.test(imagenUrl)) {
      toast.error("La imagen debe ser una URL válida que empiece con https://")
      return
    }

    const esNuevo = modalForm === "nuevo"
    const body = {
      nombre,
      descripcion: form.descripcion.trim() || null,
      categoria: form.categoria.trim() || null,
      tipo: form.tipo,
      precio: Number(form.precio),
      imagen_url: imagenUrl || null,
    }

    await withLoading(async () => {
      try {
        const result = await consumiblesApi.saveConsumible({
          id: esNuevo ? undefined : String((modalForm as ConsumibleItem).id),
          ...body,
        })

        if (esNuevo) {
          const createdId = String(result.id)
          toast.success(`"${body.nombre}" creado correctamente`)
          setConsumibles((prev) => [
            ...prev,
            { id: createdId, ...body, activo: 1 },
          ])
        } else {
          toast.success(`"${body.nombre}" actualizado correctamente`)
          setConsumibles((prev) =>
            prev.map((c) =>
              c.id === (modalForm as ConsumibleItem).id ? { ...c, ...body } : c
            )
          )
        }

        setModalForm(null)
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo guardar")
        return
      }
    })
  }

  async function confirmarEliminar() {
    if (!modalEliminar) return
    await withLoading(async () => {
      try {
        await consumiblesApi.deleteConsumible(String(modalEliminar.id))
        setConsumibles((prev) => prev.filter((c) => c.id !== modalEliminar.id))
        setModalEliminar(null)
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo eliminar")
      }
    })
  }

  async function toggleActivo(c: ConsumibleItem) {
    const nuevoActivo = Number(c.activo) === 1 ? 0 : 1

    await withLoading(async () => {
      try {
        await consumiblesApi.toggleConsumible(String(c.id), nuevoActivo === 1)
        setConsumibles((prev) =>
          prev.map((item) => (item.id === c.id ? { ...item, activo: nuevoActivo } : item))
        )
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo actualizar")
      }
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Consumibles</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {pagination.total} producto{pagination.total !== 1 ? "s" : ""} visible{pagination.total !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {puede("vender_consumibles") && (
            <Button asChild variant="outline" className="gap-2 h-10 border-primary/40 text-primary hover:bg-primary/10 hover:text-primary">
              <Link href="/dashboard/consumibles/vender">
                <Store className="h-4 w-4" /> Punto de venta
              </Link>
            </Button>
          )}
          <ConsumiblesCatalogoExportAction />
          {puede("gestionar_consumibles") && (
            <Button className="gap-2 h-10 px-6" onClick={abrirNuevo}>
              <Plus className="h-4 w-4" /> Nuevo producto
            </Button>
          )}
        </div>
      </div>

      {/* Lista */}
      <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
        <div className="border-b border-primary/15 bg-primary/8 px-5 py-4">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col sm:flex-row gap-3 xl:flex-1">
              <Select value={estadoFiltro} onValueChange={(value) => updateQuery({ estado: value, page: 1 })}>
                <SelectTrigger className="h-10 bg-background/90 border-primary/15 w-full xl:w-40">
                  <SelectValue placeholder="Estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="activos">Activos</SelectItem>
                  <SelectItem value="inactivos">Inactivos</SelectItem>
                </SelectContent>
              </Select>

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
                  <DropdownMenuCheckboxItem checked={columnasVisibles.precio} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, precio: checked === true }))}>Precio</DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={columnasVisibles.estado} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, estado: checked === true }))}>Estado</DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9 h-10 bg-background/90 border-primary/15"
                  placeholder="Buscar producto..."
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
        </div>

        {consumibles.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <ShoppingBag className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-semibold text-foreground mb-1">Sin consumibles</h3>
            <p className="text-muted-foreground text-sm mb-4">
              Agregá los productos que se venden en tus barras
            </p>
            {puede("gestionar_consumibles") && (
              <Button className="gap-2" onClick={abrirNuevo}>
                <Plus className="h-4 w-4" /> Crear producto
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-primary/15 bg-primary/10">
                  <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">
                    <button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("nombre")}>
                      Producto {getSortIcon("nombre")}
                    </button>
                  </th>
                  {columnasVisibles.precio && <th className="text-right px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">
                    <button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("precio")}>
                      Precio {getSortIcon("precio")}
                    </button>
                  </th>}
                  {columnasVisibles.estado && <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">
                    <button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("estado")}>
                      Estado {getSortIcon("estado")}
                    </button>
                  </th>}
                  <th className="px-5 py-3.5 text-right text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">
                    Acción
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {consumibles.map((c) => {
                  const inactivo = Number(c.activo) !== 1
                  return (
                    <tr
                      key={c.id}
                      className={`transition-colors ${inactivo ? "opacity-50" : "hover:bg-muted/30"}`}
                    >
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                            <ShoppingBag className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-foreground">{c.nombre}</p>
                            {c.descripcion && (
                              <p className="text-xs text-muted-foreground truncate max-w-xs">{c.descripcion}</p>
                            )}
                          </div>
                        </div>
                      </td>
                      {columnasVisibles.precio && <td className="px-4 py-4 text-right text-foreground font-semibold font-mono tabular-nums">
                        {formatMoney(c.precio)}
                      </td>}
                      {columnasVisibles.estado && <td className="px-4 py-4">
                        <div className="flex flex-col gap-1">
                          <span
                            className={`text-xs font-medium px-2.5 py-1 rounded-full self-start ${
                              !inactivo
                                ? "bg-primary/10 text-primary"
                                : "bg-muted text-muted-foreground"
                            }`}
                          >
                            {!inactivo ? "Activo" : "Inactivo"}
                          </span>
                          {inactivo && c.archived_at && (
                            <span className="text-[11px] text-muted-foreground px-1">
                              Desactivado el {formatDate(c.archived_at)}
                            </span>
                          )}
                        </div>
                      </td>}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1 justify-end">
                          {puede("gestionar_consumibles") && (
                            <>
                              <IconAction
                                label="Editar"
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => abrirEditar(c)}
                              >
                                <Pencil className="h-4 w-4" />
                              </IconAction>
                              <IconAction
                                label={!inactivo ? "Desactivar" : "Activar"}
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => toggleActivo(c)}
                              >
                                {!inactivo ? (
                                  <ToggleRight className="h-4 w-4 text-primary" />
                                ) : (
                                  <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                                )}
                              </IconAction>
                              {!inactivo && (
                                <IconAction
                                  label="Eliminar"
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                  onClick={() => setModalEliminar(c)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </IconAction>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal Nuevo / Editar */}
      <Dialog
        open={!!modalForm}
        onOpenChange={(open) => {
          if (!open) setModalForm(null)
        }}
      >
        <DialogContent className="bg-card max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {modalForm === "nuevo" ? "Nuevo producto" : "Editar producto"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {modalForm === "nuevo" ? "Agregar nuevo consumible" : "Editar consumible existente"}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="nombre">Nombre *</Label>
              <Input
                id="nombre"
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej: Cerveza, Agua, Gaseosa..."
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="descripcion">Descripción</Label>
              <Textarea
                id="descripcion"
                value={form.descripcion}
                onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
                placeholder="Descripción opcional..."
                rows={2}
                maxLength={500}
              />
              <p className="text-xs text-muted-foreground text-right">{form.descripcion.length}/500</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="categoria">Categoría</Label>
              <Input
                id="categoria"
                list="cons-categorias"
                value={form.categoria}
                onChange={(e) => setForm((f) => ({ ...f, categoria: e.target.value }))}
                placeholder="Ej: Cervezas, Tragos, Sin alcohol..."
                maxLength={100}
              />
              <datalist id="cons-categorias">
                {Array.from(new Set(consumibles.map((c) => c.categoria?.trim()).filter((c): c is string => !!c)))
                  .sort((a, b) => a.localeCompare(b, "es"))
                  .map((cat) => (
                    <option key={cat} value={cat} />
                  ))}
              </datalist>
              <p className="text-xs text-muted-foreground">Agrupa los productos en el punto de venta. Opcional.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="tipo">Tipo</Label>
              <Select value={form.tipo} onValueChange={(value) => setForm((f) => ({ ...f, tipo: value as ConsumibleTipo }))}>
                <SelectTrigger id="tipo" className="h-10 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONSUMIBLE_TIPO_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Clasificación real (a diferencia de categoría, que es solo una etiqueta libre).</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="precio">Precio *</Label>
              <Input
                id="precio"
                type="number"
                min="0"
                step="0.01"
                value={form.precio}
                onChange={(e) => setForm((f) => ({ ...f, precio: e.target.value }))}
                placeholder="0.00"
              />
            </div>

            <ImageUploadInput
              label="Imagen"
              value={form.imagen_url}
              onChange={(url) => setForm((f) => ({ ...f, imagen_url: url }))}
              type="consumible"
              aspect="square"
              description="Recomendado: cuadrado, fondo neutro"
            />

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1 h-10" onClick={() => setModalForm(null)}>
                Cancelar
              </Button>
              <Button className="flex-1 h-10" onClick={guardar}>
                {modalForm === "nuevo" ? "Crear producto" : "Guardar cambios"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal confirmar eliminación */}
      <Dialog
        open={!!modalEliminar}
        onOpenChange={(open) => {
          if (!open) setModalEliminar(null)
        }}
      >
        <DialogContent className="bg-card sm:max-w-sm p-6">
          <DialogHeader>
            <DialogTitle className="text-foreground">¿Eliminar permanentemente?</DialogTitle>
            <DialogDescription className="sr-only">Confirmar eliminación de consumible</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-destructive/10 border border-destructive/20 rounded-xl p-4">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">
                  {modalEliminar?.nombre}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Se eliminará permanentemente. Si el producto tiene historial de ventas o stock asignado, la operación será rechazada — desactivalo en su lugar.
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
    </div>
  )
}
