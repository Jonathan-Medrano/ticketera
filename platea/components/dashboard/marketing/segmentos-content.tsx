"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  Crown,
  TrendingUp,
  Sparkles,
  AlertTriangle,
  Clock,
  ShoppingCart,
  Plus,
  Users,
  Pencil,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  X,
  Layers,
  Zap,
  BookMarked,
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { IconAction } from "@/components/ui/icon-action"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { useLoading } from "@/components/loading-provider"
import { formatMoney, formatDate, formatInt } from "@/lib/format"
import { puedeHacer, type Permisos } from "@/lib/permisos"

interface AutoSegmento {
  slug: string
  nombre: string
  descripcion: string
  count: number
}

interface ManualSegmento {
  id: number
  nombre: string
  descripcion: string | null
  count: number
  created_at: string
}

interface Comprador {
  id: number
  nombre: string
  apellido: string | null
  email: string | null
  created_at: string
  total_entradas?: number
  total_gastado?: number
  ultima_compra?: string | null
  carritos_abandonados?: number
}

interface Props {
  automaticos: AutoSegmento[]
  manuales: ManualSegmento[]
  permisos?: Permisos
  esEmpleado?: boolean
}

const ICONO_POR_SLUG: Record<string, React.ReactNode> = {
  vip: <Crown className="h-5 w-5" />,
  activos: <TrendingUp className="h-5 w-5" />,
  nuevos: <Sparkles className="h-5 w-5" />,
  en_riesgo: <AlertTriangle className="h-5 w-5" />,
  inactivos: <Clock className="h-5 w-5" />,
  carrito_abandonado: <ShoppingCart className="h-5 w-5" />,
}

const COLOR_POR_SLUG: Record<string, string> = {
  vip: "bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400",
  activos: "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400",
  nuevos: "bg-[color:var(--marketing-accent-soft)] text-[color:var(--marketing-accent)]",
  en_riesgo: "bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400",
  inactivos: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400",
  carrito_abandonado: "bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-400",
}

interface CompradoresModalState {
  open: boolean
  titulo: string
  slugOrId: string | number
  esManual: boolean
}

export default function SegmentosContent({ automaticos, manuales: manualesInit, permisos, esEmpleado }: Props) {
  const router = useRouter()
  const { withLoading } = useLoading()
  const puede = (permiso: keyof Permisos) => puedeHacer(permiso, esEmpleado ?? false, permisos)

  const [manuales, setManuales] = useState<ManualSegmento[]>(manualesInit)

  const [modalNuevo, setModalNuevo] = useState(false)
  const [formNombre, setFormNombre] = useState("")
  const [formDescripcion, setFormDescripcion] = useState("")

  const [modalEditar, setModalEditar] = useState<ManualSegmento | null>(null)
  const [editNombre, setEditNombre] = useState("")
  const [editDescripcion, setEditDescripcion] = useState("")

  const [modalEliminar, setModalEliminar] = useState<ManualSegmento | null>(null)

  const [compradoresModal, setCompradoresModal] = useState<CompradoresModalState>({
    open: false,
    titulo: "",
    slugOrId: "",
    esManual: false,
  })
  const [compradores, setCompradores] = useState<Comprador[]>([])
  const [compradoresPag, setCompradoresPag] = useState({ page: 1, pageSize: 20, total: 0, totalPages: 1 })
  const [compradoresLoading, setCompradoresLoading] = useState(false)

  // KPI values computed from props/state — no new fetches
  const totalCompradoresAutomaticos = automaticos.reduce((sum, s) => sum + s.count, 0)
  const totalSegmentosAutomaticos = automaticos.length
  const totalSegmentosManuales = manuales.length

  async function fetchCompradores(slugOrId: string | number, page: number) {
    setCompradoresLoading(true)
    try {
      const qs = new URLSearchParams({ page: String(page), pageSize: "20" })
      const res = await fetch(`/api/marketing/segmentos/${slugOrId}/compradores?${qs.toString()}`)
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Error al cargar compradores")
        // Revert page indicator to the last successfully loaded page
        setCompradoresPag((prev) => ({ ...prev, page: prev.page }))
        return
      }
      setCompradores(data.data.compradores)
      setCompradoresPag(data.pagination)
    } finally {
      setCompradoresLoading(false)
    }
  }

  function abrirCompradores(titulo: string, slugOrId: string | number, esManual: boolean) {
    setCompradoresModal({ open: true, titulo, slugOrId, esManual })
    setCompradores([])
    setCompradoresPag({ page: 1, pageSize: 20, total: 0, totalPages: 1 })
    fetchCompradores(slugOrId, 1)
  }

  function cerrarCompradores() {
    setCompradoresModal({ open: false, titulo: "", slugOrId: "", esManual: false })
    setCompradores([])
  }

  async function handleQuitarComprador(compradorId: number) {
    await withLoading(async () => {
      const res = await fetch(
        `/api/marketing/segmentos/${compradoresModal.slugOrId}/compradores/${compradorId}`,
        { method: "DELETE" }
      )
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo quitar el comprador")
        return
      }
      toast.success("Comprador quitado del segmento")
      await fetchCompradores(compradoresModal.slugOrId, compradoresPag.page)
      router.refresh()
    })
  }

  async function handleCrearSegmento(e: React.FormEvent) {
    e.preventDefault()
    if (!formNombre.trim()) {
      toast.error("El nombre es requerido")
      return
    }
    await withLoading(async () => {
      const res = await fetch("/api/marketing/segmentos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: formNombre.trim(), descripcion: formDescripcion.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Error al crear el segmento")
        return
      }
      toast.success("Segmento creado")
      setModalNuevo(false)
      setFormNombre("")
      setFormDescripcion("")
      router.refresh()
    })
  }

  function abrirEditar(seg: ManualSegmento) {
    setModalEditar(seg)
    setEditNombre(seg.nombre)
    setEditDescripcion(seg.descripcion ?? "")
  }

  async function handleEditarSegmento(e: React.FormEvent) {
    e.preventDefault()
    if (!modalEditar) return
    if (!editNombre.trim()) {
      toast.error("El nombre es requerido")
      return
    }
    await withLoading(async () => {
      const res = await fetch(`/api/marketing/segmentos/${modalEditar.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: editNombre.trim(), descripcion: editDescripcion.trim() || null }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Error al actualizar el segmento")
        return
      }
      toast.success("Segmento actualizado")
      setManuales((prev) =>
        prev.map((s) =>
          s.id === modalEditar.id
            ? { ...s, nombre: editNombre.trim(), descripcion: editDescripcion.trim() || null }
            : s
        )
      )
      setModalEditar(null)
      router.refresh()
    })
  }

  async function confirmarEliminarSegmento() {
    if (!modalEliminar) return
    await withLoading(async () => {
      const res = await fetch(`/api/marketing/segmentos/${modalEliminar.id}`, { method: "DELETE" })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo eliminar el segmento")
        return
      }
      toast.success("Segmento eliminado")
      setManuales((prev) => prev.filter((s) => s.id !== modalEliminar.id))
      setModalEliminar(null)
      router.refresh()
    })
  }

  return (
    <div className="space-y-6 pb-8">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-[-0.02em]">Segmentos</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Grupos de compradores para targeting de campañas
          </p>
        </div>
        {puede("gestionar_campanas") && (
          <Button className="gap-2 h-10 px-6" onClick={() => setModalNuevo(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Nuevo segmento</span>
          </Button>
        )}
      </div>

      {/* KPI strip */}
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-card border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Compradores en segmentos</p>
              <p className="mt-1 text-2xl font-bold text-foreground tabular-nums">{formatInt(totalCompradoresAutomaticos)}</p>
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Users className="h-4 w-4" />
            </div>
          </div>
        </div>
        <div className="rounded-card border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Segmentos automáticos</p>
              <p className="mt-1 text-2xl font-bold text-foreground tabular-nums">{totalSegmentosAutomaticos}</p>
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Zap className="h-4 w-4" />
            </div>
          </div>
        </div>
        <div className="rounded-card border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Segmentos manuales</p>
              <p className="mt-1 text-2xl font-bold text-foreground tabular-nums">{totalSegmentosManuales}</p>
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BookMarked className="h-4 w-4" />
            </div>
          </div>
        </div>
        <div className="rounded-card border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">Total segmentos</p>
              <p className="mt-1 text-2xl font-bold text-foreground tabular-nums">{totalSegmentosAutomaticos + totalSegmentosManuales}</p>
            </div>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Layers className="h-4 w-4" />
            </div>
          </div>
        </div>
      </div>

      {/* Segmentos automáticos */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">Automáticos</h2>
        {automaticos.length === 0 && (
          <p className="text-sm text-muted-foreground">No hay segmentos automáticos disponibles.</p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {automaticos.map((seg) => (
            <div
              key={seg.slug}
              className="rounded-card border border-border bg-card shadow-sm transition-colors hover:border-primary/30 flex flex-col gap-3 p-4"
            >
              <div className="flex items-start gap-3">
                <div className={`h-9 w-9 rounded-xl flex items-center justify-center shrink-0 ${COLOR_POR_SLUG[seg.slug] ?? "bg-primary/10 text-primary"}`}>
                  {ICONO_POR_SLUG[seg.slug] ?? <Users className="h-5 w-5" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-foreground text-sm leading-tight">{seg.nombre}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{seg.descripcion}</p>
                </div>
              </div>
              <div className="flex items-center justify-between">
                <Badge variant="secondary" className="text-xs tabular-nums">
                  {seg.count} comprador{seg.count !== 1 ? "es" : ""}
                </Badge>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => abrirCompradores(seg.nombre, seg.slug, false)}
                >
                  Ver compradores
                </Button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Segmentos manuales */}
      <div className="space-y-3">
        <h2 className="text-base font-semibold text-foreground">Manuales</h2>
        {manuales.length === 0 ? (
          <div className="rounded-card border border-border bg-card px-6 py-16 text-center shadow-sm">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Users className="h-6 w-6" />
            </div>
            <h3 className="font-semibold text-foreground mb-1">Sin segmentos manuales</h3>
            <p className="text-muted-foreground text-sm mb-4">
              Creá un segmento para agrupar compradores manualmente
            </p>
            {puede("gestionar_campanas") && (
              <Button className="gap-2" onClick={() => setModalNuevo(true)}>
                <Plus className="h-4 w-4" /> Crear segmento
              </Button>
            )}
          </div>
        ) : (
          <div className="bg-card rounded-card border border-border overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-primary/15 bg-primary/10">
                    <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Nombre</th>
                    <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em] hidden md:table-cell">Descripción</th>
                    <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Compradores</th>
                    <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em] hidden sm:table-cell">Creado</th>
                    <th className="px-5 py-3.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {manuales.map((seg) => (
                    <tr key={seg.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-3">
                          <div className="h-8 w-8 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
                            <Users className="h-3.5 w-3.5" />
                          </div>
                          <span className="font-medium text-foreground truncate">{seg.nombre}</span>
                        </div>
                      </td>
                      <td className="px-4 py-4 text-muted-foreground hidden md:table-cell text-xs">
                        {seg.descripcion ?? <span className="italic opacity-50">Sin descripción</span>}
                      </td>
                      <td className="px-4 py-4">
                        <Badge variant="secondary" className="text-xs tabular-nums">
                          {seg.count} comprador{seg.count !== 1 ? "es" : ""}
                        </Badge>
                      </td>
                      <td className="px-4 py-4 text-muted-foreground text-xs hidden sm:table-cell tabular-nums">
                        {formatDate(seg.created_at)}
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1 justify-end">
                          <IconAction
                            label="Ver compradores"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => abrirCompradores(seg.nombre, seg.id, true)}
                          >
                            <Users className="h-4 w-4" />
                          </IconAction>
                          {puede("gestionar_campanas") && (
                            <IconAction
                              label="Editar segmento"
                              variant="ghost"
                              size="icon-sm"
                              onClick={() => abrirEditar(seg)}
                            >
                              <Pencil className="h-4 w-4" />
                            </IconAction>
                          )}
                          {puede("gestionar_campanas") && (
                            <IconAction
                              label="Eliminar segmento"
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => setModalEliminar(seg)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </IconAction>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Modal: Nuevo segmento */}
      <Dialog open={modalNuevo} onOpenChange={(v) => { if (!v) { setModalNuevo(false); setFormNombre(""); setFormDescripcion("") } }}>
        <DialogContent className="bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Nuevo segmento</DialogTitle>
            <DialogDescription className="sr-only">Crear un nuevo segmento manual de compradores</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCrearSegmento} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="nuevo-nombre" className="text-xs text-muted-foreground">Nombre</Label>
              <Input
                id="nuevo-nombre"
                className="h-10"
                placeholder="Ej: Clientes frecuentes"
                value={formNombre}
                onChange={(e) => setFormNombre(e.target.value)}
                maxLength={100}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="nuevo-descripcion" className="text-xs text-muted-foreground">Descripción <span className="opacity-50">(opc.)</span></Label>
              <Input
                id="nuevo-descripcion"
                className="h-10"
                placeholder="Descripción del segmento"
                value={formDescripcion}
                onChange={(e) => setFormDescripcion(e.target.value)}
              />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" className="flex-1 h-10" onClick={() => setModalNuevo(false)}>
                Cancelar
              </Button>
              <Button type="submit" className="flex-1 h-10">Crear segmento</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Editar segmento */}
      <Dialog open={!!modalEditar} onOpenChange={(v) => { if (!v) setModalEditar(null) }}>
        <DialogContent className="bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Editar segmento</DialogTitle>
            <DialogDescription className="sr-only">Editar el segmento manual de compradores</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditarSegmento} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="editar-nombre" className="text-xs text-muted-foreground">Nombre</Label>
              <Input
                id="editar-nombre"
                className="h-10"
                value={editNombre}
                onChange={(e) => setEditNombre(e.target.value)}
                maxLength={100}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="editar-descripcion" className="text-xs text-muted-foreground">Descripción <span className="opacity-50">(opc.)</span></Label>
              <Input
                id="editar-descripcion"
                className="h-10"
                value={editDescripcion}
                onChange={(e) => setEditDescripcion(e.target.value)}
              />
            </div>
            <DialogFooter className="pt-2">
              <Button type="button" variant="outline" className="flex-1 h-10" onClick={() => setModalEditar(null)}>
                Cancelar
              </Button>
              <Button type="submit" className="flex-1 h-10">Guardar cambios</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal: Confirmar eliminación (reemplaza window.confirm) */}
      <Dialog open={!!modalEliminar} onOpenChange={(v) => { if (!v) setModalEliminar(null) }}>
        <DialogContent className="bg-card sm:max-w-sm p-6">
          <DialogHeader>
            <DialogTitle className="text-foreground">¿Eliminar &ldquo;{modalEliminar?.nombre}&rdquo;?</DialogTitle>
            <DialogDescription>Confirmar eliminación de segmento manual</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-destructive/10 border border-destructive/20 rounded-xl p-4">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">{modalEliminar?.nombre}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Se eliminará permanentemente. Esta acción no se puede deshacer.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 h-10" onClick={() => setModalEliminar(null)}>
                Cancelar
              </Button>
              <Button variant="destructive" className="flex-1 h-10" onClick={confirmarEliminarSegmento}>
                Eliminar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Ver compradores */}
      <Dialog open={compradoresModal.open} onOpenChange={(v) => { if (!v) cerrarCompradores() }}>
        <DialogContent className="bg-card sm:max-w-2xl max-h-[90vh] flex flex-col">
          <DialogHeader className="shrink-0">
            <div className="flex items-center justify-between">
              <DialogTitle className="text-foreground">
                {compradoresModal.titulo}
                <Badge variant="secondary" className="ml-2 text-xs font-normal tabular-nums">
                  {compradoresPag.total} comprador{compradoresPag.total !== 1 ? "es" : ""}
                </Badge>
              </DialogTitle>
            </div>
            <DialogDescription className="sr-only">Lista de compradores del segmento</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto min-h-0">
            {compradoresLoading ? (
              <div className="py-12 text-center text-muted-foreground text-sm">Cargando compradores...</div>
            ) : compradores.length === 0 ? (
              <div className="py-12 text-center">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                  <Users className="h-5 w-5" />
                </div>
                <p className="text-muted-foreground text-sm">Sin compradores en este segmento</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-primary/15 bg-primary/10 sticky top-0">
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Comprador</th>
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-primary uppercase tracking-[0.16em] hidden sm:table-cell">Email</th>
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Entradas</th>
                      <th className="text-left px-4 py-3 text-[11px] font-semibold text-primary uppercase tracking-[0.16em] hidden md:table-cell">Gastado</th>
                      {compradoresModal.esManual && puede("gestionar_campanas") && <th className="px-4 py-3" />}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {compradores.map((c) => (
                      <tr key={c.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-4 py-3 min-w-0 max-w-[180px]">
                          <p className="font-medium text-foreground truncate">
                            {c.nombre}{c.apellido ? ` ${c.apellido}` : ""}
                          </p>
                          <p className="text-xs text-muted-foreground sm:hidden truncate">{c.email ?? "—"}</p>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground text-xs hidden sm:table-cell">
                          {c.email ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-foreground font-medium tabular-nums">
                          {c.total_entradas ?? c.carritos_abandonados ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground hidden md:table-cell font-mono tabular-nums">
                          {c.total_gastado != null ? formatMoney(c.total_gastado) : "—"}
                        </td>
                        {compradoresModal.esManual && puede("gestionar_campanas") && (
                          <td className="px-4 py-3">
                            <IconAction
                              label="Quitar del segmento"
                              variant="ghost"
                              size="icon-sm"
                              className="text-muted-foreground hover:text-destructive"
                              onClick={() => handleQuitarComprador(c.id)}
                            >
                              <X className="h-3.5 w-3.5" />
                            </IconAction>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {compradoresPag.totalPages > 1 && (
            <div className="shrink-0 border-t border-border pt-3 flex items-center justify-between px-1">
              <div className="text-xs text-muted-foreground tabular-nums">
                Pág. {compradoresPag.page} de {compradoresPag.totalPages}
              </div>
              <div className="flex items-center gap-1">
                <IconAction label="Primera" variant="ghost" size="icon-sm" disabled={compradoresLoading || compradoresPag.page <= 1} onClick={() => fetchCompradores(compradoresModal.slugOrId, 1)}><ChevronsLeft className="h-4 w-4" /></IconAction>
                <IconAction label="Anterior" variant="ghost" size="icon-sm" disabled={compradoresLoading || compradoresPag.page <= 1} onClick={() => fetchCompradores(compradoresModal.slugOrId, compradoresPag.page - 1)}><ChevronLeft className="h-4 w-4" /></IconAction>
                <IconAction label="Siguiente" variant="ghost" size="icon-sm" disabled={compradoresLoading || compradoresPag.page >= compradoresPag.totalPages} onClick={() => fetchCompradores(compradoresModal.slugOrId, compradoresPag.page + 1)}><ChevronRight className="h-4 w-4" /></IconAction>
                <IconAction label="Última" variant="ghost" size="icon-sm" disabled={compradoresLoading || compradoresPag.page >= compradoresPag.totalPages} onClick={() => fetchCompradores(compradoresModal.slugOrId, compradoresPag.totalPages)}><ChevronsRight className="h-4 w-4" /></IconAction>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
