"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Plus, Trash2, Pencil, Tag, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useLoading } from "../loading-provider"
import { puedeHacer, type Permisos } from "@/lib/permisos"
import { formatMoney, formatInt } from "@/lib/format"

export type EventoAddonRow = {
  id: string
  nombre: string
  descripcion: string | null
  precio: number
  stock: number
  stock_disponible: number
  max_por_compra: number
  // Backend (Prisma) devuelve boolean — el schema lo tiene como Boolean, no Int.
  activo: boolean
  orden_visual: number
}

type FormState = {
  nombre: string
  descripcion: string
  precio: string
  stock: string
  max_por_compra: string
  orden_visual: string
}

const EMPTY: FormState = {
  nombre: "",
  descripcion: "",
  precio: "",
  stock: "",
  max_por_compra: "4",
  orden_visual: "0",
}

export default function EventoAddonsSection({
  eventoId,
  initialAddons,
  permisos,
  esEmpleado,
}: {
  eventoId: string
  initialAddons: EventoAddonRow[]
  permisos?: Permisos
  esEmpleado?: boolean
}) {
  const router = useRouter()
  const { withLoading } = useLoading()
  const [list, setList] = useState<EventoAddonRow[]>(
    () => [...initialAddons].sort((a, b) => a.orden_visual - b.orden_visual)
  )
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<EventoAddonRow | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [errors, setErrors] = useState<Partial<Record<keyof FormState, string>>>({})
  const [toDelete, setToDelete] = useState<EventoAddonRow | null>(null)

  const puede = (p: keyof Permisos) => puedeHacer(p, esEmpleado ?? false, permisos)
  const canManage = puede("editar_eventos")

  function openCreate() {
    setEditing(null)
    setForm(EMPTY)
    setErrors({})
    setModalOpen(true)
  }

  function openEdit(addon: EventoAddonRow) {
    setEditing(addon)
    setForm({
      nombre: addon.nombre,
      descripcion: addon.descripcion ?? "",
      precio: String(addon.precio),
      stock: String(addon.stock),
      max_por_compra: String(addon.max_por_compra),
      orden_visual: String(addon.orden_visual),
    })
    setErrors({})
    setModalOpen(true)
  }

  /** Actualiza un campo del form y limpia su error inline al tipear. */
  function setField(key: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev))
  }

  async function submitForm() {
    const nombre = form.nombre.trim()
    const precio = Number(form.precio)
    const stock = Number(form.stock)
    const maxRaw = form.max_por_compra.trim()
    const max_por_compra = maxRaw === "" ? 1 : Number(maxRaw)
    const orden_visual = form.orden_visual.trim() === "" ? 0 : Number(form.orden_visual)

    const nextErrors: Partial<Record<keyof FormState, string>> = {}

    if (!nombre) nextErrors.nombre = "El nombre es obligatorio"
    if (!Number.isFinite(precio) || precio <= 0)
      nextErrors.precio = "El precio debe ser mayor a 0"
    if (!Number.isFinite(stock) || !Number.isInteger(stock) || stock < 0)
      nextErrors.stock = "El stock debe ser un entero igual o mayor a 0"
    if (
      maxRaw !== "" &&
      (!Number.isInteger(max_por_compra) || max_por_compra < 1 || max_por_compra > 100)
    )
      nextErrors.max_por_compra = "Debe ser un entero entre 1 y 100"
    if (!Number.isInteger(orden_visual))
      nextErrors.orden_visual = "El orden debe ser un número entero"

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors)
      toast.error("Revisá los campos marcados")
      return
    }
    setErrors({})

    const payload = {
      evento_id: eventoId,
      nombre,
      descripcion: form.descripcion.trim() || null,
      precio,
      stock,
      max_por_compra,
      orden_visual,
    }

    await withLoading(async () => {
      if (editing) {
        const res = await fetch(`/api/dashboard/addons/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => null)
          toast.error(data?.error ?? "No se pudo actualizar el adicional")
          return
        }
        const data = await res.json()
        const updated: EventoAddonRow = data?.data?.addon
        setList((prev) => prev.map((a) => (a.id === editing.id ? { ...a, ...updated } : a)))
        toast.success("Adicional actualizado")
      } else {
        const res = await fetch(`/api/dashboard/addons`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => null)
          toast.error(data?.error ?? "No se pudo crear el adicional")
          return
        }
        const data = await res.json()
        const created: EventoAddonRow = data?.data?.addon
        setList((prev) => [...prev, created].sort((a, b) => a.orden_visual - b.orden_visual))
        toast.success("Adicional creado")
      }
      setModalOpen(false)
      router.refresh()
    })
  }

  async function toggleActivo(addon: EventoAddonRow) {
    await withLoading(async () => {
      const res = await fetch(`/api/dashboard/addons/${addon.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: !addon.activo }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.error ?? "No se pudo actualizar el adicional")
        return
      }
      setList((prev) => prev.map((a) => (a.id === addon.id ? { ...a, activo: !a.activo } : a)))
    })
  }

  async function confirmEliminar() {
    const addon = toDelete
    if (!addon) return
    await withLoading(async () => {
      const res = await fetch(`/api/dashboard/addons/${addon.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.error ?? "No se pudo eliminar el adicional")
        return
      }
      setList((prev) => prev.filter((a) => a.id !== addon.id))
      toast.success("Adicional eliminado")
      setToDelete(null)
    })
  }

  return (
    <div className="bg-card rounded-2xl border border-border p-4 md:p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold text-foreground flex items-center gap-2">
            <Tag className="h-4 w-4 text-muted-foreground" />
            Adicionales del evento
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Parking, meet &amp; greet, merch o cualquier extra que el comprador pueda sumar al checkout.
          </p>
        </div>
        {canManage && (
          <Button size="sm" onClick={openCreate} className="h-8 px-3">
            <Plus className="h-3.5 w-3.5 mr-1" /> Crear
          </Button>
        )}
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no creaste adicionales para este evento. Sumá uno cuando quieras ofrecer extras opcionales en el checkout.
        </p>
      ) : (
        <div className="space-y-3">
          {list.map((addon) => {
            const comprometido = addon.stock - addon.stock_disponible
            return (
              <div key={addon.id} className="border border-border rounded-xl p-4 bg-muted/20">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">{addon.nombre}</p>
                    {addon.descripcion && (
                      <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{addon.descripcion}</p>
                    )}
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full shrink-0 ${
                      addon.activo
                        ? "bg-primary/10 text-primary"
                        : "bg-muted text-muted-foreground"
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        addon.activo ? "bg-primary" : "bg-muted-foreground/50"
                      }`}
                    />
                    {addon.activo ? "Activo" : "Pausado"}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 mb-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Precio</p>
                    <p className="font-semibold text-foreground font-mono tabular-nums">
                      {formatMoney(addon.precio)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Stock</p>
                    <p className="font-semibold text-foreground font-mono tabular-nums">
                      {formatInt(addon.stock_disponible)} / {formatInt(addon.stock)}
                    </p>
                    {comprometido > 0 && (
                      <p className="text-[10px] text-muted-foreground font-mono tabular-nums">
                        {formatInt(comprometido)} reservados
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Máx x compra</p>
                    <p className="font-semibold text-foreground font-mono tabular-nums">
                      {formatInt(addon.max_por_compra)}
                    </p>
                  </div>
                </div>

                {canManage && (
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={() => openEdit(addon)}
                      className="flex items-center gap-1 h-10 px-3 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors"
                    >
                      <Pencil className="h-3 w-3" /> Editar
                    </button>
                    <button
                      onClick={() => toggleActivo(addon)}
                      className="flex items-center gap-1 h-10 px-3 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors"
                    >
                      {addon.activo ? "Pausar" : "Activar"}
                    </button>
                    <button
                      onClick={() => setToDelete(addon)}
                      className="flex items-center gap-1 h-10 px-3 rounded-lg text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" /> Eliminar
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Editar adicional" : "Nuevo adicional"}</DialogTitle>
            <DialogDescription>
              Extras opcionales que el comprador puede sumar al checkout del evento.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Nombre</label>
              <Input
                value={form.nombre}
                onChange={(e) => setField("nombre", e.target.value)}
                placeholder="Estacionamiento, Meet &amp; Greet, Remera oficial..."
                aria-invalid={!!errors.nombre}
                className={errors.nombre ? "border-destructive focus-visible:ring-destructive" : undefined}
              />
              {errors.nombre && <p className="text-xs text-destructive">{errors.nombre}</p>}
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Descripción (opcional)</label>
              <textarea
                value={form.descripcion}
                onChange={(e) => setField("descripcion", e.target.value)}
                placeholder="Detalle visible para el comprador"
                rows={2}
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Precio (ARS)</label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={form.precio}
                  onChange={(e) => setField("precio", e.target.value)}
                  aria-invalid={!!errors.precio}
                  className={`font-mono tabular-nums ${errors.precio ? "border-destructive focus-visible:ring-destructive" : ""}`}
                />
                {errors.precio && <p className="text-xs text-destructive">{errors.precio}</p>}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Stock total</label>
                <Input
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={form.stock}
                  onChange={(e) => setField("stock", e.target.value)}
                  aria-invalid={!!errors.stock}
                  className={`font-mono tabular-nums ${errors.stock ? "border-destructive focus-visible:ring-destructive" : ""}`}
                />
                {errors.stock && <p className="text-xs text-destructive">{errors.stock}</p>}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Máx por compra</label>
                <Input
                  type="number"
                  min="1"
                  max="100"
                  step="1"
                  inputMode="numeric"
                  value={form.max_por_compra}
                  onChange={(e) => setField("max_por_compra", e.target.value)}
                  aria-invalid={!!errors.max_por_compra}
                  className={`font-mono tabular-nums ${errors.max_por_compra ? "border-destructive focus-visible:ring-destructive" : ""}`}
                />
                {errors.max_por_compra && <p className="text-xs text-destructive">{errors.max_por_compra}</p>}
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Orden visual</label>
                <Input
                  type="number"
                  step="1"
                  inputMode="numeric"
                  value={form.orden_visual}
                  onChange={(e) => setField("orden_visual", e.target.value)}
                  aria-invalid={!!errors.orden_visual}
                  className={`font-mono tabular-nums ${errors.orden_visual ? "border-destructive focus-visible:ring-destructive" : ""}`}
                />
                {errors.orden_visual && <p className="text-xs text-destructive">{errors.orden_visual}</p>}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setModalOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={submitForm}>{editing ? "Guardar cambios" : "Crear adicional"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-destructive/10 text-destructive shrink-0">
                <AlertTriangle className="h-4 w-4" />
              </span>
              Eliminar adicional
            </DialogTitle>
            <DialogDescription>
              Vas a eliminar{" "}
              <span className="font-medium text-foreground">
                {toDelete?.nombre ?? "este adicional"}
              </span>
              . Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>

          {toDelete && toDelete.stock - toDelete.stock_disponible > 0 && (
            <div className="rounded-card border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              Este adicional ya tiene{" "}
              <span className="font-mono tabular-nums font-semibold">
                {formatInt(toDelete.stock - toDelete.stock_disponible)}
              </span>{" "}
              unidades reservadas o vendidas. Si está en uso, conviene pausarlo en lugar de
              borrarlo.
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmEliminar}>
              <Trash2 className="h-4 w-4 mr-1" /> Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
