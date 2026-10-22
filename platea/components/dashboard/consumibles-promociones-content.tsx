"use client"

import { useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { writeDashboardSearchParam } from "@/lib/dashboard-grid-search"
import { useDashboardDebouncedSearch } from "@/lib/use-dashboard-debounced-search"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { IconAction } from "@/components/ui/icon-action"
import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
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
import { Tag, Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Columns3, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react"
import { puedeHacer, type Permisos } from "@/lib/permisos"
import { useLoading } from "@/components/loading-provider"
import { formatMoney, formatDate } from "@/lib/format"

type PromocionItem = {
  id: string
  nombre: string
  descripcion?: string | null
  tipo: TipoPromocion
  valor: number
  consumible_ids: string[] | string
  cantidad_minima: number
  evento_id?: string | null
  activa: number | boolean
  fecha_inicio?: string | null
  fecha_fin?: string | null
}

type ConsumibleSimple = {
  id: string
  nombre: string
}

type EventoSimple = {
  id: string
  nombre: string
}

type TipoPromocion = "porcentaje" | "monto_fijo" | "precio_especial"

function utcToArDatetimeLocal(iso: string): string {
  const d = new Date(iso)
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(d)
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00"
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`
}

const tipoConfig: Record<TipoPromocion, { label: string; labelValor: string }> = {
  porcentaje: { label: "Porcentaje", labelValor: "Porcentaje (%)" },
  monto_fijo: { label: "Monto fijo", labelValor: "Monto fijo ($)" },
  precio_especial: { label: "Precio especial", labelValor: "Precio especial ($)" },
}

interface FormState {
  nombre: string
  descripcion: string
  tipo: TipoPromocion
  valor: string
  consumible_ids: string[]
  cantidad_minima: string
  evento_id: string
  fecha_inicio: string
  fecha_fin: string
}

const formVacio: FormState = {
  nombre: "",
  descripcion: "",
  tipo: "porcentaje",
  valor: "",
  consumible_ids: [],
  cantidad_minima: "1",
  evento_id: "",
  fecha_inicio: "",
  fecha_fin: "",
}

export default function ConsumiblesPromocionesContent({
  promociones,
  pagination,
  consumibles,
  eventos,
  permisos,
  esEmpleado,
}: {
  promociones: PromocionItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  consumibles: ConsumibleSimple[]
  eventos: EventoSimple[]
  permisos?: Permisos
  esEmpleado?: boolean
}) {
  const puede = (permiso: keyof Permisos) => puedeHacer(permiso, esEmpleado ?? false, permisos)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { withLoading } = useLoading()
  const busqueda = searchParams.get("busqueda") ?? ""
  const eventoFiltro = searchParams.get("evento_id") ?? ""
  const activaFiltro = searchParams.get("activa") ?? "todas"
  const sortBy = searchParams.get("sortBy") ?? "alta"
  const sortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc"
  const pageSize = pagination.pageSize
  const rangeStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1
  const rangeEnd = Math.min(pagination.total, pagination.page * pagination.pageSize)

  const [modalAbierto, setModalAbierto] = useState(false)
  const [editando, setEditando] = useState<PromocionItem | null>(null)
  const [form, setForm] = useState<FormState>(formVacio)
  const [eliminando, setEliminando] = useState<PromocionItem | null>(null)
  const [columnasVisibles, setColumnasVisibles] = useState({
    tipo: true,
    valor: true,
    estado: true,
    vigencia: true,
  })
  const { value: busquedaInput, setValue: setBusquedaInput } = useDashboardDebouncedSearch({
    urlValue: busqueda,
    emit: (next) => updateQuery({ busqueda: next, page: 1 }),
  })

  function updateQuery(next: {
    page?: number
    pageSize?: string
    busqueda?: string
    evento_id?: string
    activa?: string
    sortBy?: string
    sortDir?: "asc" | "desc"
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

    if (next.evento_id !== undefined) {
      if (next.evento_id) params.set("evento_id", next.evento_id)
      else params.delete("evento_id")
    }

    if (next.activa !== undefined) {
      if (next.activa && next.activa !== "todas") params.set("activa", next.activa)
      else params.delete("activa")
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

  function abrirNueva() {
    setEditando(null)
    setForm(formVacio)
    setModalAbierto(true)
  }

  function abrirEditar(p: PromocionItem) {
    setEditando(p)
    setForm({
      nombre: p.nombre ?? "",
      descripcion: p.descripcion ?? "",
      tipo: p.tipo ?? "porcentaje",
      valor: String(p.valor ?? ""),
      consumible_ids: (() => {
        try {
          const ids = p.consumible_ids
          if (Array.isArray(ids)) return ids.map(String)
          if (typeof ids === "string") return JSON.parse(ids).map(String)
          return []
        } catch {
          return []
        }
      })(),
      cantidad_minima: String(p.cantidad_minima ?? "1"),
      evento_id: p.evento_id ? String(p.evento_id) : "",
      fecha_inicio: p.fecha_inicio ? utcToArDatetimeLocal(p.fecha_inicio) : "",
      fecha_fin: p.fecha_fin ? utcToArDatetimeLocal(p.fecha_fin) : "",
    })
    setModalAbierto(true)
  }

  function toggleConsumible(id: string) {
    setForm((f) => ({
      ...f,
      consumible_ids: f.consumible_ids.includes(id)
        ? f.consumible_ids.filter((c) => c !== id)
        : [...f.consumible_ids, id],
    }))
  }

  async function guardar() {
    // Nombre requerido
    if (!form.nombre.trim()) { toast.error("El nombre es requerido"); return }

    // Valor numérico válido
    const valorNum = Number(form.valor)
    if (!form.valor || !Number.isFinite(valorNum)) {
      toast.error("El valor debe ser un número válido")
      return
    }

    // Validación del valor según el tipo de promoción
    if (form.tipo === "porcentaje") {
      if (valorNum < 0 || valorNum > 100) {
        toast.error("El porcentaje debe estar entre 0 y 100")
        return
      }
    } else {
      // monto_fijo / precio_especial
      if (valorNum <= 0) {
        toast.error(
          form.tipo === "monto_fijo"
            ? "El monto fijo debe ser mayor a 0"
            : "El precio especial debe ser mayor a 0",
        )
        return
      }
    }

    // Cantidad mínima: entero >= 1
    const cantidadNum = Number(form.cantidad_minima)
    if (!Number.isInteger(cantidadNum) || cantidadNum < 1) {
      toast.error("La cantidad mínima debe ser un entero mayor o igual a 1")
      return
    }

    // Al menos un consumible seleccionado
    if (form.consumible_ids.length === 0) {
      toast.error("Seleccioná al menos un consumible para la promoción")
      return
    }

    // Rango de fechas: fecha_fin debe ser posterior a fecha_inicio
    if (form.fecha_inicio && form.fecha_fin) {
      const inicio = new Date(form.fecha_inicio).getTime()
      const fin = new Date(form.fecha_fin).getTime()
      if (Number.isFinite(inicio) && Number.isFinite(fin) && fin <= inicio) {
        toast.error("La fecha de fin debe ser posterior a la fecha de inicio")
        return
      }
    }

    const body = {
      nombre: form.nombre.trim(),
      descripcion: form.descripcion.trim() || null,
      tipo: form.tipo,
      valor: valorNum,
      consumible_ids: form.consumible_ids,
      cantidad_minima: cantidadNum,
      evento_id: form.evento_id || null,
      fecha_inicio: form.fecha_inicio || null,
      fecha_fin: form.fecha_fin || null,
    }

    await withLoading(async () => {
      const res = editando
        ? await fetch(`/api/consumibles/promociones/${editando.id}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/consumibles/promociones", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })

      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? "Error al guardar")
        return
      }

      if (editando) {
        toast.success("Promoción actualizada")
      } else {
        toast.success("Promoción creada correctamente")
      }
      setModalAbierto(false)
      router.refresh()
    })
  }

  async function toggleActiva(p: PromocionItem) {
    await withLoading(async () => {
      const res = await fetch(`/api/consumibles/promociones/${p.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...p, activa: !p.activa }),
      })
      if (res.ok) {
        router.refresh()
      }
    })
  }

  async function confirmarEliminar() {
    if (!eliminando) return
    await withLoading(async () => {
      const res = await fetch(`/api/consumibles/promociones/${eliminando.id}`, { method: "DELETE" })
      if (res.ok) {
        router.refresh()
      }
      setEliminando(null)
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Promociones</h1>
          <p className="text-muted-foreground text-sm mt-1">{pagination.total} promociones configuradas</p>
        </div>
        {(puede("gestionar_consumibles") || puede("gestionar_promociones")) && (
          <Button onClick={abrirNueva} className="gap-2">
            <Plus className="h-4 w-4" /> Nueva promoción
          </Button>
        )}
      </div>

      <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
        <div className="border-b border-primary/15 bg-primary/8 px-5 py-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <p className="text-sm font-semibold text-foreground">Motor promocional</p>
            <p className="text-xs text-muted-foreground mt-1">Filtros, columnas y navegación del listado de promociones.</p>
          </div>

          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-end xl:min-w-[720px]">
            <Input className="h-10 bg-background/90 border-primary/15 xl:max-w-sm" placeholder="Buscar promoción..." value={busquedaInput} onChange={(e) => setBusquedaInput(e.target.value)} />
            <Select value={eventoFiltro || "_todos"} onValueChange={(v) => updateQuery({ evento_id: v === "_todos" ? "" : v, page: 1 })}>
              <SelectTrigger className="h-10 bg-background/90 border-primary/15 w-full xl:w-56">
                <SelectValue placeholder="Todos los eventos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem className="py-2.5 px-2.5" value="_todos">Todos los eventos</SelectItem>
                {eventos.map((ev) => (<SelectItem className="py-2.5 px-2.5" key={ev.id} value={String(ev.id)}>{ev.nombre}</SelectItem>))}
              </SelectContent>
            </Select>
            <Select value={activaFiltro} onValueChange={(value) => updateQuery({ activa: value, page: 1 })}>
              <SelectTrigger className="h-10 bg-background/90 border-primary/15 w-full xl:w-48">
                <SelectValue placeholder="Todas" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem className="py-2.5 px-2.5" value="todas">Todas</SelectItem>
                <SelectItem className="py-2.5 px-2.5" value="1">Activas</SelectItem>
                <SelectItem className="py-2.5 px-2.5" value="0">Inactivas</SelectItem>
              </SelectContent>
            </Select>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="outline" className="h-10 gap-2 bg-background/90 border-primary/15 xl:w-auto"><Columns3 className="h-4 w-4" /><span>Columnas</span></Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-56">
                <DropdownMenuLabel>Columnas visibles</DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuCheckboxItem checked={columnasVisibles.tipo} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, tipo: checked === true }))}>Tipo</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={columnasVisibles.valor} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, valor: checked === true }))}>Valor</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={columnasVisibles.estado} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, estado: checked === true }))}>Estado</DropdownMenuCheckboxItem>
                <DropdownMenuCheckboxItem checked={columnasVisibles.vigencia} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, vigencia: checked === true }))}>Vigencia</DropdownMenuCheckboxItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="px-5 py-3 border-b border-border/60 flex flex-col sm:flex-row gap-3 xl:items-center xl:justify-end">
          <Select value={String(pageSize)} onValueChange={(value) => updateQuery({ pageSize: value, page: 1 })}>
            <SelectTrigger className="bg-background/90 border-primary/15 w-full sm:w-24"><SelectValue placeholder="25" /></SelectTrigger>
            <SelectContent>{[10, 25, 50, 100].map((size) => (<SelectItem key={size} value={String(size)}>{size}</SelectItem>))}</SelectContent>
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

      {promociones.length === 0 ? (
        <div className="bg-card rounded-2xl border border-border p-8 md:p-16 text-center">
          <Tag className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <h3 className="font-semibold text-foreground mb-1">Sin promociones</h3>
          <p className="text-muted-foreground text-sm">
            {busqueda || eventoFiltro || activaFiltro !== "todas"
              ? "No se encontraron promociones con esos filtros"
              : "Todavía no hay promociones configuradas para este negocio"}
          </p>
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="border-b border-primary/15 bg-primary/10">
                  <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("nombre")}>Nombre {getSortIcon("nombre")}</button></th>
                  {columnasVisibles.tipo && <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("tipo")}>Tipo {getSortIcon("tipo")}</button></th>}
                  {columnasVisibles.valor && <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("valor")}>Valor {getSortIcon("valor")}</button></th>}
                  {columnasVisibles.estado && <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("estado")}>Estado {getSortIcon("estado")}</button></th>}
                  {columnasVisibles.vigencia && <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleSort("vigencia")}>Vigencia {getSortIcon("vigencia")}</button></th>}
                  {(puede("gestionar_consumibles") || puede("gestionar_promociones")) && (
                    <th className="text-right px-5 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Acciones</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {promociones.map((p) => {
                  const tipo = tipoConfig[p.tipo as TipoPromocion] ?? { label: p.tipo, labelValor: "" }
                  return (
                    <tr key={p.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-4">
                        <p className="font-medium text-foreground">{p.nombre}</p>
                        {p.descripcion && (
                          <p className="text-xs text-muted-foreground mt-0.5">{p.descripcion}</p>
                        )}
                      </td>
                      {columnasVisibles.tipo && <td className="px-4 py-4">
                        <span className="text-xs font-medium px-2.5 py-1 rounded-full bg-[color:var(--marketing-accent-soft)] text-[color:var(--marketing-accent)]">
                          {tipo.label}
                        </span>
                      </td>}
                      {columnasVisibles.valor && <td className="px-4 py-4 text-foreground font-semibold font-mono tabular-nums">
                        {p.tipo === "porcentaje" ? `${p.valor}%` : formatMoney(p.valor)}
                      </td>}
                      {columnasVisibles.estado && <td className="px-4 py-4">
                        <span
                          className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                            p.activa
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {p.activa ? "Activa" : "Inactiva"}
                        </span>
                      </td>}
                      {columnasVisibles.vigencia && <td className="px-4 py-4 text-xs text-muted-foreground">
                        {p.fecha_inicio || p.fecha_fin ? (
                          <>
                            {p.fecha_inicio && (
                              <span className="tabular-nums">Desde {formatDate(p.fecha_inicio)}</span>
                            )}
                            {p.fecha_fin && (
                              <span className="block tabular-nums">Hasta {formatDate(p.fecha_fin)}</span>
                            )}
                          </>
                        ) : (
                          <span>Sin límite</span>
                        )}
                      </td>}
                      {(puede("gestionar_consumibles") || puede("gestionar_promociones")) && (
                        <td className="px-5 py-4">
                          <div className="flex items-center justify-end gap-1">
                            <IconAction
                              label={p.activa ? "Desactivar" : "Activar"}
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => toggleActiva(p)}
                            >
                              {p.activa ? (
                                <ToggleRight className="h-4 w-4 text-primary" />
                              ) : (
                                <ToggleLeft className="h-4 w-4 text-muted-foreground" />
                              )}
                            </IconAction>
                            <IconAction
                              label="Editar"
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0"
                              onClick={() => abrirEditar(p)}
                            >
                              <Pencil className="h-4 w-4" />
                            </IconAction>
                            <IconAction
                              label="Eliminar"
                              variant="ghost"
                              size="sm"
                              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                              onClick={() => setEliminando(p)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </IconAction>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal crear/editar */}
      <Dialog open={modalAbierto} onOpenChange={setModalAbierto}>
        <DialogContent className="bg-card w-full max-w-sm sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editando ? "Editar promoción" : "Nueva promoción"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Nombre *</label>
              <Input
                value={form.nombre}
                onChange={(e) => setForm((f) => ({ ...f, nombre: e.target.value }))}
                placeholder="Ej: 2x1 en cervezas"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Descripción</label>
              <Textarea
                value={form.descripcion}
                onChange={(e) => setForm((f) => ({ ...f, descripcion: e.target.value }))}
                placeholder="Descripción opcional..."
                rows={2}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Tipo *</label>
                <Select
                  value={form.tipo}
                  onValueChange={(v) => setForm((f) => ({ ...f, tipo: v as TipoPromocion }))}
                >
                  <SelectTrigger className="h-10!">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="porcentaje">Porcentaje (%)</SelectItem>
                    <SelectItem value="monto_fijo">Monto fijo ($)</SelectItem>
                    <SelectItem value="precio_especial">Precio especial ($)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {tipoConfig[form.tipo].labelValor} *
                </label>
                <Input
                  type="number"
                  min={0}
                  max={form.tipo === "porcentaje" ? 100 : undefined}
                  step={form.tipo === "porcentaje" ? "1" : "0.01"}
                  value={form.valor}
                  onChange={(e) => setForm((f) => ({ ...f, valor: e.target.value }))}
                  placeholder="0"
                  className="font-mono tabular-nums"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Cantidad mínima</label>
              <Input
                type="number"
                min={1}
                step={1}
                value={form.cantidad_minima}
                onChange={(e) => setForm((f) => ({ ...f, cantidad_minima: e.target.value }))}
                className="font-mono tabular-nums"
              />
            </div>

            {consumibles.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  Consumibles incluidos <span className="text-muted-foreground font-normal">(ninguno = todos)</span>
                </label>
                <div className="border border-border rounded-xl p-3 space-y-2 max-h-40 overflow-y-auto">
                  {consumibles.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={form.consumible_ids.includes(String(c.id))}
                        onChange={() => toggleConsumible(String(c.id))}
                        className="rounded"
                      />
                      <span className="text-sm text-foreground">{c.nombre}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {eventos.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Evento (opcional)</label>
                <Select
                  value={form.evento_id || "_todos"}
                  onValueChange={(v) => setForm((f) => ({ ...f, evento_id: v === "_todos" ? "" : v }))}
                >
                  <SelectTrigger className="h-10!">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem className="py-2.5 px-2.5" value="_todos">Todos los eventos</SelectItem>
                    {eventos.map((ev) => (
                      <SelectItem className="py-2.5 px-2.5" key={ev.id} value={String(ev.id)}>
                        {ev.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Fecha inicio</label>
                <Input
                  type="datetime-local"
                  value={form.fecha_inicio}
                  onChange={(e) => setForm((f) => ({ ...f, fecha_inicio: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Fecha fin</label>
                <Input
                  type="datetime-local"
                  value={form.fecha_fin}
                  onChange={(e) => setForm((f) => ({ ...f, fecha_fin: e.target.value }))}
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalAbierto(false)}>
              Cancelar
            </Button>
            <Button onClick={guardar}>
              {editando ? "Guardar cambios" : "Crear promoción"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialog confirmar eliminar */}
      <Dialog open={!!eliminando} onOpenChange={(o) => !o && setEliminando(null)}>
        <DialogContent className="bg-card">
          <DialogHeader>
            <DialogTitle>Eliminar promoción</DialogTitle>
            <DialogDescription>
              ¿Estás seguro que querés eliminar{" "}
              <span className="font-semibold text-foreground">{eliminando?.nombre}</span>? Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          {eliminando && (
            <div className="rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-sm space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Tipo</span>
                <span className="font-medium text-foreground">
                  {tipoConfig[eliminando.tipo as TipoPromocion]?.label ?? eliminando.tipo}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Valor</span>
                <span className="font-mono tabular-nums font-medium text-foreground">
                  {eliminando.tipo === "porcentaje"
                    ? `${eliminando.valor}%`
                    : formatMoney(eliminando.valor)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Consumibles afectados</span>
                <span className="font-mono tabular-nums font-medium text-foreground">
                  {(() => {
                    const ids = eliminando.consumible_ids
                    if (Array.isArray(ids)) return ids.length
                    if (typeof ids === "string") {
                      try {
                        const parsed = JSON.parse(ids)
                        return Array.isArray(parsed) ? parsed.length : 0
                      } catch {
                        return 0
                      }
                    }
                    return 0
                  })()}
                </span>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEliminando(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmarEliminar}>
              Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
