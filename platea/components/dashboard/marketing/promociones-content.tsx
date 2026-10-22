"use client"

import { useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { writeDashboardSearchParam } from "@/lib/dashboard-grid-search"
import { useDashboardDebouncedSearch } from "@/lib/use-dashboard-debounced-search"
import { formatMoney, formatDate, formatInt } from "@/lib/format"
import { toast } from "sonner"
import {
  Plus,
  Search,
  Tag,
  Pencil,
  Power,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Download,
  TicketPercent,
  CheckCircle2,
  MousePointerClick,
  Infinity,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { IconAction } from "@/components/ui/icon-action"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { useLoading } from "@/components/loading-provider"
import { puedeHacer, type Permisos } from "@/lib/permisos"

interface CodigoDescuento {
  id: number
  codigo: string
  tipo: "porcentaje" | "monto_fijo"
  valor: number
  aplica_a: "todos" | "entradas" | "consumibles"
  usos_maximos: number | null
  usos_actuales: number
  monto_minimo: number | null
  valido_desde: string | null
  valido_hasta: string | null
  evento_id: number | null
  evento_nombre: string | null
  activo: number
  created_at: string
}

interface Evento {
  id: string
  nombre: string
}

interface Props {
  codigos: CodigoDescuento[]
  eventos: Evento[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  stats?: {
    total: number
    activos: number
    usos_totales: number
    con_limite: number
  }
  permisos?: Permisos
  esEmpleado?: boolean
}

const TIPO_LABELS: Record<string, string> = {
  porcentaje: "Porcentaje",
  monto_fijo: "Monto fijo",
}

const APLICA_LABELS: Record<string, string> = {
  todos: "Todos",
  entradas: "Entradas",
  consumibles: "Consumibles",
}

function formatValor(tipo: string, valor: number) {
  if (tipo === "porcentaje") return `${valor}%`
  return formatMoney(valor)
}

function formatVigencia(desde: string | null, hasta: string | null) {
  if (!desde && !hasta) return "Sin vencimiento"
  const d = desde ? formatDate(desde) : null
  const h = hasta ? formatDate(hasta) : null
  if (d && h) return `${d} — ${h}`
  if (d) return `Desde ${d}`
  return `Hasta ${h}`
}

type FormState = {
  codigo: string
  tipo: "porcentaje" | "monto_fijo"
  valor: string
  aplica_a: "todos" | "entradas" | "consumibles"
  usos_maximos: string
  monto_minimo: string
  valido_desde: string
  valido_hasta: string
  evento_id: string
  activo: boolean
}

function emptyForm(): FormState {
  return {
    codigo: "",
    tipo: "porcentaje",
    valor: "",
    aplica_a: "todos",
    usos_maximos: "",
    monto_minimo: "",
    valido_desde: "",
    valido_hasta: "",
    evento_id: "",
    activo: true,
  }
}

function codigoToForm(c: CodigoDescuento): FormState {
  return {
    codigo: c.codigo,
    tipo: c.tipo,
    valor: String(c.valor),
    aplica_a: c.aplica_a,
    usos_maximos: c.usos_maximos != null ? String(c.usos_maximos) : "",
    monto_minimo: c.monto_minimo != null ? String(c.monto_minimo) : "",
    valido_desde: c.valido_desde ? c.valido_desde.slice(0, 10) : "",
    valido_hasta: c.valido_hasta ? c.valido_hasta.slice(0, 10) : "",
    evento_id: c.evento_id != null ? String(c.evento_id) : "",
    activo: Boolean(c.activo),
  }
}

const STATS_DEFAULT = { total: 0, activos: 0, usos_totales: 0, con_limite: 0 }

export default function PromocionesContent({ codigos, eventos, pagination, stats = STATS_DEFAULT, permisos, esEmpleado }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { withLoading } = useLoading()
  const puede = (permiso: keyof Permisos) => puedeHacer(permiso, esEmpleado ?? false, permisos)

  const [modalOpen, setModalOpen] = useState(false)
  const [editando, setEditando] = useState<CodigoDescuento | null>(null)
  const [form, setForm] = useState<FormState>(emptyForm())

  const busqueda = searchParams.get("busqueda") ?? ""
  const estadoFiltro = searchParams.get("estado") ?? "todos"
  const pageSize = pagination.pageSize
  const rangeStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1
  const rangeEnd = Math.min(pagination.total, pagination.page * pagination.pageSize)

  const [filtroEstadoDraft, setFiltroEstadoDraft] = useState(estadoFiltro)
  const { value: busquedaInput, setValue: setBusquedaInput } = useDashboardDebouncedSearch({
    urlValue: busqueda,
    emit: (next) => updateQuery({ busqueda: next, page: 1 }),
  })

  function updateQuery(next: {
    page?: number
    pageSize?: string
    busqueda?: string
    estado?: string
  }) {
    const params = new URLSearchParams(searchParams.toString())

    if (next.page !== undefined) params.set("page", String(next.page))
    if (next.busqueda !== undefined) writeDashboardSearchParam(params, "busqueda", next.busqueda)
    if (next.estado !== undefined) {
      if (next.estado && next.estado !== "todos") params.set("estado", next.estado)
      else params.delete("estado")
    }
    if (next.pageSize !== undefined) {
      if (next.pageSize) params.set("pageSize", next.pageSize)
      else params.delete("pageSize")
    }

    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }

  function applyGridFilters() {
    updateQuery({ estado: filtroEstadoDraft, page: 1 })
  }

  const [isExporting, setIsExporting] = useState(false)

  async function handleExportCsv() {
    if (isExporting) return
    setIsExporting(true)
    try {
      const params = new URLSearchParams()
      if (busqueda) params.set("busqueda", busqueda)
      if (estadoFiltro && estadoFiltro !== "todos") params.set("estado", estadoFiltro)

      const res = await fetch(`/api/marketing/promociones/export?${params.toString()}`)
      if (!res.ok) {
        toast.error("No se pudo exportar el CSV")
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `promociones-${new Date().toLocaleDateString("en-CA", { timeZone: "America/Argentina/Buenos_Aires" })}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error("No se pudo descargar el CSV")
    } finally {
      setIsExporting(false)
    }
  }

  function abrirCrear() {
    setEditando(null)
    setForm(emptyForm())
    setModalOpen(true)
  }

  function abrirEditar(c: CodigoDescuento) {
    setEditando(c)
    setForm(codigoToForm(c))
    setModalOpen(true)
  }

  function cerrarModal() {
    setModalOpen(false)
    setEditando(null)
    setForm(emptyForm())
  }

  function setField<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  async function handleGuardar(e: React.FormEvent) {
    e.preventDefault()

    const valorNum = Number(form.valor)
    if (!form.codigo.trim()) {
      toast.error("El código es requerido")
      return
    }
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      toast.error("El valor debe ser mayor a 0")
      return
    }

    const body = {
      codigo: form.codigo.trim().toUpperCase(),
      tipo: form.tipo,
      valor: valorNum,
      aplica_a: form.aplica_a,
      usos_maximos: form.usos_maximos ? Number(form.usos_maximos) : null,
      monto_minimo: form.monto_minimo ? Number(form.monto_minimo) : null,
      valido_desde: form.valido_desde || null,
      valido_hasta: form.valido_hasta || null,
      evento_id: form.evento_id ? Number(form.evento_id) : null,
      activo: form.activo,
    }

    await withLoading(async () => {
      const url = editando ? `/api/marketing/promociones/${editando.id}` : "/api/marketing/promociones"
      const method = editando ? "PUT" : "POST"
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Error al guardar el código")
        return
      }
      toast.success(editando ? "Código actualizado" : "Código creado")
      cerrarModal()
      router.refresh()
    })
  }

  async function toggleActivo(c: CodigoDescuento) {
    await withLoading(async () => {
      const res = await fetch(`/api/marketing/promociones/${c.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...codigoToForm(c), activo: !c.activo }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? "No se pudo actualizar el estado")
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-[-0.02em]">Códigos de Descuento</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {pagination.total} código{pagination.total !== 1 ? "s" : ""} en total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            className="gap-2 h-10 px-4"
            onClick={() => void handleExportCsv()}
            disabled={isExporting || pagination.total === 0}
            aria-label={isExporting ? "Exportando CSV..." : "Exportar CSV"}
          >
            <Download className="h-4 w-4" />
            <span className="hidden sm:inline">{isExporting ? "Exportando..." : "Exportar CSV"}</span>
          </Button>
          {puede("gestionar_codigos") && (
            <Button className="gap-2 h-10 px-6" onClick={abrirCrear}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">Nuevo código</span>
            </Button>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-card border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Total códigos</p>
              <p className="mt-1 text-2xl font-bold text-foreground tabular-nums">{formatInt(stats.total)}</p>
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <TicketPercent className="h-4 w-4" />
            </div>
          </div>
        </div>

        <div className="rounded-card border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Activos</p>
              <p className="mt-1 text-2xl font-bold text-foreground tabular-nums">{formatInt(stats.activos)}</p>
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </div>
        </div>

        <div className="rounded-card border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Usos totales</p>
              <p className="mt-1 text-2xl font-bold text-foreground tabular-nums">{formatInt(stats.usos_totales)}</p>
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <MousePointerClick className="h-4 w-4" />
            </div>
          </div>
        </div>

        <div className="rounded-card border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Con límite de uso</p>
              <p className="mt-1 text-2xl font-bold text-foreground tabular-nums">{formatInt(stats.con_limite)}</p>
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Infinity className="h-4 w-4" />
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row xl:flex-1">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9 h-10 bg-background w-full"
                placeholder="Buscar por código..."
                value={busquedaInput}
                onChange={(e) => setBusquedaInput(e.target.value)}
              />
            </div>
            <Select value={filtroEstadoDraft} onValueChange={setFiltroEstadoDraft}>
              <SelectTrigger className="h-10 bg-background w-full sm:w-40">
                <SelectValue placeholder="Todos" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="activo">Activos</SelectItem>
                <SelectItem value="inactivo">Inactivos</SelectItem>
              </SelectContent>
            </Select>
            <Button type="button" onClick={applyGridFilters} className="h-10 px-6 shrink-0">
              Buscar
            </Button>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center xl:justify-end">
            <Select value={String(pageSize)} onValueChange={(value) => updateQuery({ pageSize: value, page: 1 })}>
              <SelectTrigger className="h-10 w-full sm:w-20">
                <SelectValue placeholder="25" />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((size) => (
                  <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
              <span className="tabular-nums">{rangeStart}–{rangeEnd}</span>
              <span>de</span>
              <span className="tabular-nums">{pagination.total}</span>
            </div>

            <div className="flex items-center gap-1">
              <IconAction label="Primera página" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: 1 })} disabled={pagination.page <= 1}><ChevronsLeft className="h-4 w-4" /></IconAction>
              <IconAction label="Página anterior" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: pagination.page - 1 })} disabled={pagination.page <= 1}><ChevronLeft className="h-4 w-4" /></IconAction>
              <IconAction label="Página siguiente" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: pagination.page + 1 })} disabled={pagination.page >= pagination.totalPages}><ChevronRight className="h-4 w-4" /></IconAction>
              <IconAction label="Última página" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: pagination.totalPages })} disabled={pagination.page >= pagination.totalPages}><ChevronsRight className="h-4 w-4" /></IconAction>
            </div>
          </div>
        </div>
      </section>

      {/* Table card */}
      <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
        {codigos.length === 0 ? (
          <div className="rounded-card border border-border bg-card px-6 py-16 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Tag className="h-6 w-6" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">Sin códigos de descuento</h3>
            <p className="text-muted-foreground text-sm mb-4">
              {busqueda
                ? "No se encontraron códigos con ese criterio de búsqueda"
                : "Todavía no hay códigos de descuento creados"}
            </p>
            {!busqueda && puede("gestionar_codigos") && (
              <Button className="gap-2" onClick={abrirCrear}>
                <Plus className="h-4 w-4" /> Crear código
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-primary/15 bg-primary/10">
                  <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Código</th>
                  <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em] hidden sm:table-cell">Tipo</th>
                  <th className="text-right px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Valor</th>
                  <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em] hidden md:table-cell">Aplica a</th>
                  <th className="text-right px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em] hidden md:table-cell">Usos</th>
                  <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em] hidden lg:table-cell">Vigencia</th>
                  <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Estado</th>
                  <th className="px-5 py-3.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {codigos.map((c) => (
                  <tr key={c.id} className={`hover:bg-muted/30 transition-colors ${!c.activo ? "opacity-60" : ""}`}>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                          <Tag className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0">
                          <p className="font-mono font-semibold text-foreground truncate tabular-nums">{c.codigo}</p>
                          {c.evento_nombre && (
                            <p className="text-xs text-muted-foreground truncate">{c.evento_nombre}</p>
                          )}
                          <p className="text-xs text-muted-foreground sm:hidden">{TIPO_LABELS[c.tipo] ?? c.tipo}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-muted-foreground hidden sm:table-cell">{TIPO_LABELS[c.tipo] ?? c.tipo}</td>
                    <td className="px-4 py-4 font-semibold text-foreground text-right font-mono tabular-nums">{formatValor(c.tipo, c.valor)}</td>
                    <td className="px-4 py-4 text-muted-foreground hidden md:table-cell">{APLICA_LABELS[c.aplica_a] ?? c.aplica_a}</td>
                    <td className="px-4 py-4 text-right tabular-nums hidden md:table-cell">
                      <span className="text-foreground font-medium">{c.usos_actuales}</span>
                      <span className="text-muted-foreground">/{c.usos_maximos != null ? c.usos_maximos : "∞"}</span>
                    </td>
                    <td className="px-4 py-4 text-muted-foreground text-xs hidden lg:table-cell">{formatVigencia(c.valido_desde, c.valido_hasta)}</td>
                    <td className="px-4 py-4">
                      <Badge
                        variant="outline"
                        className={
                          c.activo
                            ? "border-primary/30 bg-primary/10 text-primary"
                            : "border-border bg-muted/40 text-muted-foreground"
                        }
                      >
                        {c.activo ? "Activo" : "Inactivo"}
                      </Badge>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-1 justify-end">
                        {puede("gestionar_codigos") && (
                          <IconAction
                            label="Editar código"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => abrirEditar(c)}
                          >
                            <Pencil className="h-4 w-4" />
                          </IconAction>
                        )}
                        {puede("gestionar_codigos") && (
                          <IconAction
                            label={c.activo ? "Desactivar código" : "Activar código"}
                            variant="ghost"
                            size="icon-sm"
                            className={
                              c.activo
                                ? "text-primary hover:text-primary hover:bg-primary/10"
                                : "text-muted-foreground hover:text-foreground"
                            }
                            onClick={() => toggleActivo(c)}
                          >
                            <Power className="h-4 w-4" />
                          </IconAction>
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

      {/* Create / Edit modal */}
      <Dialog open={modalOpen} onOpenChange={(v) => { if (!v) cerrarModal() }}>
        <DialogContent className="bg-card sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-foreground">{editando ? "Editar código" : "Nuevo código de descuento"}</DialogTitle>
            <DialogDescription className="sr-only">
              {editando ? "Editá los datos del código de descuento" : "Completá los datos del nuevo código de descuento"}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleGuardar}>
            <div className="space-y-4 max-h-[60vh] overflow-y-auto px-1 pb-1">
            <div className="space-y-1.5">
              <Label htmlFor="promo-codigo" className="text-xs text-muted-foreground">Código</Label>
              <Input
                id="promo-codigo"
                className="h-10 w-full font-mono uppercase"
                placeholder="VERANO2024"
                value={form.codigo}
                onChange={(e) => setField("codigo", e.target.value.toUpperCase())}
                required
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="promo-tipo" className="text-xs text-muted-foreground">Tipo</Label>
                <Select value={form.tipo} onValueChange={(v) => setField("tipo", v as "porcentaje" | "monto_fijo")}>
                  <SelectTrigger id="promo-tipo" className="h-10 w-full bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="porcentaje">Porcentaje</SelectItem>
                    <SelectItem value="monto_fijo">Monto fijo</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo-valor" className="text-xs text-muted-foreground">
                  Valor {form.tipo === "porcentaje" ? "(%)" : "($)"}
                </Label>
                <Input
                  id="promo-valor"
                  className="h-10 w-full"
                  type="number"
                  min="0.01"
                  step="0.01"
                  placeholder={form.tipo === "porcentaje" ? "10" : "500"}
                  value={form.valor}
                  onChange={(e) => setField("valor", e.target.value)}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="promo-aplica-a" className="text-xs text-muted-foreground">Aplica a</Label>
              <Select value={form.aplica_a} onValueChange={(v) => setField("aplica_a", v as "todos" | "entradas" | "consumibles")}>
                <SelectTrigger id="promo-aplica-a" className="h-10 w-full bg-background">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="entradas">Solo entradas</SelectItem>
                  <SelectItem value="consumibles">Solo consumibles</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="promo-usos-maximos" className="text-xs text-muted-foreground">
                  Usos máximos <span className="opacity-50">(vacío = ∞)</span>
                </Label>
                <Input
                  id="promo-usos-maximos"
                  className="h-10 w-full"
                  type="number"
                  min="1"
                  step="1"
                  placeholder="100"
                  value={form.usos_maximos}
                  onChange={(e) => setField("usos_maximos", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo-monto-minimo" className="text-xs text-muted-foreground">
                  Monto mínimo <span className="opacity-50">(opc.)</span>
                </Label>
                <Input
                  id="promo-monto-minimo"
                  className="h-10 w-full"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="5000"
                  value={form.monto_minimo}
                  onChange={(e) => setField("monto_minimo", e.target.value)}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="promo-valido-desde" className="text-xs text-muted-foreground">Válido desde</Label>
                <Input
                  id="promo-valido-desde"
                  className="h-10 w-full"
                  type="date"
                  value={form.valido_desde}
                  onChange={(e) => setField("valido_desde", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="promo-valido-hasta" className="text-xs text-muted-foreground">Válido hasta</Label>
                <Input
                  id="promo-valido-hasta"
                  className="h-10 w-full"
                  type="date"
                  value={form.valido_hasta}
                  onChange={(e) => setField("valido_hasta", e.target.value)}
                />
              </div>
            </div>

            {eventos.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="promo-evento" className="text-xs text-muted-foreground">
                  Evento específico <span className="opacity-50">(opc.)</span>
                </Label>
                <Select value={form.evento_id || "todos"} onValueChange={(v) => setField("evento_id", v === "todos" ? "" : v)}>
                  <SelectTrigger id="promo-evento" className="h-10 w-full bg-background">
                    <SelectValue placeholder="Todos los eventos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos los eventos</SelectItem>
                    {eventos.map((ev) => (
                      <SelectItem key={ev.id} value={String(ev.id)}>{ev.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                className="h-4 w-4 accent-primary"
                checked={form.activo}
                onChange={(e) => setField("activo", e.target.checked)}
              />
              <span className="text-sm text-foreground">Código activo</span>
            </label>
            </div>

            <DialogFooter className="pt-4">
              <Button type="button" variant="outline" className="flex-1 h-10" onClick={cerrarModal}>
                Cancelar
              </Button>
              <Button type="submit" className="flex-1 h-10">
                {editando ? "Guardar cambios" : "Crear código"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
