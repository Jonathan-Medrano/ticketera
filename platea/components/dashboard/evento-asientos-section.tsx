"use client"

import { useEffect, useState, type ElementType } from "react"
import { toast } from "sonner"
import {
  AlertTriangle,
  LayoutGrid,
  Lock,
  Map,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from "lucide-react"
import { Button } from "@/components/ui/button"
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useLoading } from "../loading-provider"
import { cn } from "@/lib/utils"
import { formatInt } from "@/lib/format"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SeccionConteos = {
  disponible: number
  reservado: number
  vendido: number
  bloqueado: number
  total: number
}

type FilaData = {
  fila: string
  disponible: number
  reservado: number
  vendido: number
  bloqueado: number
  total: number
}

export type AsientoSeccion = {
  id: string
  nombre: string
  filas: number
  asientos_por_fila: number
  color: string
  categoria_id: string | null
  categoria_nombre?: string | null
  total_asientos?: number
  conteos?: SeccionConteos
}

type SeccionesResponse = {
  tipo_mapa: "libre" | "numerado"
  secciones: AsientoSeccion[]
}

type FormState = {
  nombre: string
  categoria_id: string
  filas: string
  asientos_por_fila: string
  color: string
}

const FORM_EMPTY: FormState = {
  nombre: "",
  categoria_id: "",
  filas: "10",
  asientos_por_fila: "20",
  color: "#3b82f6",
}

type FormErrors = Partial<Record<keyof FormState, string>>

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function SectionHeader({
  icon: Icon,
  title,
  subtitle,
}: {
  icon: ElementType
  title: string
  subtitle?: string
}) {
  return (
    <div className="mb-5 flex items-start gap-3 border-b border-border pb-4">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
      </div>
    </div>
  )
}

function TipoMapaBadge({ tipo }: { tipo: "libre" | "numerado" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        tipo === "numerado"
          ? "border-primary/30 bg-primary/10 text-primary"
          : "border-border bg-muted text-muted-foreground"
      )}
    >
      {tipo === "numerado" ? (
        <Map className="h-3 w-3" />
      ) : (
        <LayoutGrid className="h-3 w-3" />
      )}
      {tipo === "numerado" ? "Numerado" : "Libre"}
    </span>
  )
}

// ---------------------------------------------------------------------------
// FilasDialog — bulk row block/unblock
// ---------------------------------------------------------------------------

function FilasDialog({
  seccion,
  eventoId,
  onClose,
  onRefresh,
}: {
  seccion: AsientoSeccion
  eventoId: string
  onClose: () => void
  onRefresh: () => void
}) {
  const [filas, setFilas] = useState<FilaData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  const [blockingFila, setBlockingFila] = useState<string | null>(null)
  const [blockingSeccion, setBlockingSeccion] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError(false)
      try {
        const res = await fetch(`/api/asientos/${eventoId}/secciones/${seccion.id}/filas`)
        if (!res.ok) throw new Error()
        const data = await res.json()
        if (!cancelled) setFilas(Array.isArray(data?.filas) ? data.filas : [])
      } catch {
        if (!cancelled) setError(true)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [eventoId, seccion.id])

  async function toggleSeccion(accion: "bloquear" | "desbloquear") {
    setBlockingSeccion(true)
    try {
      const res = await fetch(
        `/api/asientos/${eventoId}/secciones/${seccion.id}/bloquear`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accion }),
        }
      )
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.error ?? "No se pudo actualizar la sección")
        return
      }
      // Refresh filas state optimistically
      setFilas((prev) =>
        prev.map((f) => {
          if (accion === "bloquear") {
            const moved = f.disponible
            return { ...f, disponible: 0, bloqueado: f.bloqueado + moved }
          } else {
            const moved = f.bloqueado
            return { ...f, bloqueado: 0, disponible: f.disponible + moved }
          }
        })
      )
      toast.success(
        accion === "bloquear"
          ? `Sección "${seccion.nombre}" bloqueada (${data?.actualizados ?? 0} asientos)`
          : `Sección "${seccion.nombre}" desbloqueada (${data?.actualizados ?? 0} asientos)`
      )
      onRefresh()
    } finally {
      setBlockingSeccion(false)
    }
  }

  async function toggleFila(fila: FilaData, accion: "bloquear" | "desbloquear") {
    setBlockingFila(fila.fila)
    try {
      const res = await fetch(
        `/api/asientos/${eventoId}/secciones/${seccion.id}/filas/${encodeURIComponent(fila.fila)}/bloquear`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accion }),
        }
      )
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.error ?? "No se pudo actualizar la fila")
        return
      }
      // Refresh filas locally
      setFilas((prev) =>
        prev.map((f) => {
          if (f.fila !== fila.fila) return f
          if (accion === "bloquear") {
            const moved = f.disponible
            return { ...f, disponible: 0, bloqueado: f.bloqueado + moved }
          } else {
            const moved = f.bloqueado
            return { ...f, bloqueado: 0, disponible: f.disponible + moved }
          }
        })
      )
      toast.success(
        accion === "bloquear"
          ? `Fila ${fila.fila} bloqueada`
          : `Fila ${fila.fila} desbloqueada`
      )
      onRefresh()
    } finally {
      setBlockingFila(null)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-4 w-4 text-muted-foreground" />
            Gestión de filas — {seccion.nombre}
          </DialogTitle>
          <DialogDescription>
            Bloqueá o desbloqueá filas completas. Solo afecta asientos disponibles o bloqueados; los vendidos/reservados no cambian.
          </DialogDescription>
        </DialogHeader>

        {/* Section-level bulk actions */}
        {!loading && !error && filas.length > 0 && (() => {
          const totalDisponible = filas.reduce((sum, f) => sum + f.disponible, 0)
          const totalBloqueado = filas.reduce((sum, f) => sum + f.bloqueado, 0)
          if (totalDisponible === 0 && totalBloqueado === 0) return null
          return (
            <div className="flex items-center gap-2 pt-1 pb-2 border-b border-border">
              <span className="text-xs text-muted-foreground mr-1">Sección completa:</span>
              {totalDisponible > 0 && (
                <button
                  type="button"
                  disabled={blockingSeccion}
                  onClick={() => toggleSeccion("bloquear")}
                  className="h-7 px-3 rounded-lg text-xs font-medium bg-muted-foreground/10 text-foreground hover:bg-muted-foreground/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {blockingSeccion ? "…" : `Bloquear todas (${totalDisponible})`}
                </button>
              )}
              {totalBloqueado > 0 && (
                <button
                  type="button"
                  disabled={blockingSeccion}
                  onClick={() => toggleSeccion("desbloquear")}
                  className="h-7 px-3 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {blockingSeccion ? "…" : `Desbloquear todas (${totalBloqueado})`}
                </button>
              )}
            </div>
          )
        })()}

        {loading && (
          <div className="space-y-2 py-2">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded-lg bg-muted" />
            ))}
          </div>
        )}

        {!loading && error && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No se pudieron cargar las filas.
          </p>
        )}

        {!loading && !error && filas.length === 0 && (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Esta sección no tiene asientos generados todavía.
          </p>
        )}

        {!loading && !error && filas.length > 0 && (
          <div className="max-h-80 overflow-y-auto space-y-1.5 pr-1">
            {filas.map((f) => (
              <div
                key={f.fila}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/20 px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="text-sm font-mono font-semibold tabular-nums text-foreground">
                    Fila {f.fila}
                  </p>
                  <div className="flex flex-wrap gap-x-2.5 gap-y-0 text-[11px] font-mono tabular-nums text-muted-foreground mt-0.5">
                    {f.vendido > 0 && (
                      <span className="text-emerald-600 dark:text-emerald-400">{f.vendido} vend.</span>
                    )}
                    {f.reservado > 0 && (
                      <span className="text-amber-600 dark:text-amber-400">{f.reservado} res.</span>
                    )}
                    {f.disponible > 0 && <span>{f.disponible} disp.</span>}
                    {f.bloqueado > 0 && <span className="opacity-60">{f.bloqueado} bloq.</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {f.bloqueado > 0 && (
                    <button
                      type="button"
                      disabled={blockingFila === f.fila}
                      onClick={() => toggleFila(f, "desbloquear")}
                      className="h-10 px-2.5 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {blockingFila === f.fila ? "…" : "Desbloquear"}
                    </button>
                  )}
                  {f.disponible > 0 && (
                    <button
                      type="button"
                      disabled={blockingFila === f.fila}
                      onClick={() => toggleFila(f, "bloquear")}
                      className="h-10 px-2.5 rounded-lg text-xs font-medium bg-muted-foreground/10 text-foreground hover:bg-muted-foreground/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {blockingFila === f.fila ? "…" : "Bloquear"}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type Props = {
  eventoId: string
  categorias: Array<{ id: string; nombre: string }>
  canEdit: boolean
}

export default function EventoAsientosSection({ eventoId, categorias, canEdit }: Props) {
  const { withLoading } = useLoading()

  const [tipoMapa, setTipoMapa] = useState<"libre" | "numerado" | null>(null)
  const [secciones, setSecciones] = useState<AsientoSeccion[]>([])
  const [loadError, setLoadError] = useState(false)
  const [loadingData, setLoadingData] = useState(true)

  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<AsientoSeccion | null>(null)
  const [form, setForm] = useState<FormState>(FORM_EMPTY)
  const [formErrors, setFormErrors] = useState<FormErrors>({})
  const [submitting, setSubmitting] = useState(false)

  // Delete confirm dialog
  const [toDelete, setToDelete] = useState<AsientoSeccion | null>(null)

  // Generar asientos loading per-section
  const [generatingId, setGeneratingId] = useState<string | null>(null)

  // Gestión de filas dialog
  const [gestionandoFila, setGestionandoFila] = useState<AsientoSeccion | null>(null)

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  async function fetchSecciones() {
    setLoadingData(true)
    setLoadError(false)
    try {
      const res = await fetch(`/api/asientos/${eventoId}/secciones`)
      if (!res.ok) throw new Error("fetch error")
      const data: SeccionesResponse = await res.json()
      setTipoMapa(data.tipo_mapa)
      setSecciones(data.secciones ?? [])
    } catch {
      setLoadError(true)
    } finally {
      setLoadingData(false)
    }
  }

  useEffect(() => {
    fetchSecciones()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventoId])

  // ---------------------------------------------------------------------------
  // Form helpers
  // ---------------------------------------------------------------------------

  function openCreate() {
    setEditing(null)
    setForm(FORM_EMPTY)
    setFormErrors({})
    setShowForm(true)
  }

  function openEdit(s: AsientoSeccion) {
    setEditing(s)
    setForm({
      nombre: s.nombre,
      categoria_id: s.categoria_id ?? "",
      filas: String(s.filas),
      asientos_por_fila: String(s.asientos_por_fila),
      color: s.color ?? "#3b82f6",
    })
    setFormErrors({})
    setShowForm(true)
  }

  function cancelForm() {
    setShowForm(false)
    setEditing(null)
    setForm(FORM_EMPTY)
    setFormErrors({})
  }

  function setField(key: keyof FormState, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }))
    setFormErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev))
  }

  function validateForm(): FormErrors {
    const errors: FormErrors = {}
    if (!form.nombre.trim()) errors.nombre = "El nombre es obligatorio"
    const filas = Number(form.filas)
    if (!Number.isInteger(filas) || filas < 1 || filas > 100)
      errors.filas = "Entre 1 y 100"
    const apf = Number(form.asientos_por_fila)
    if (!Number.isInteger(apf) || apf < 1 || apf > 200)
      errors.asientos_por_fila = "Entre 1 y 200"
    if (!form.color.trim()) errors.color = "Elegí un color"
    return errors
  }

  async function submitForm() {
    const errors = validateForm()
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors)
      toast.error("Revisá los campos marcados")
      return
    }

    const payload = {
      nombre: form.nombre.trim(),
      categoria_id: form.categoria_id || null,
      filas: Number(form.filas),
      asientos_por_fila: Number(form.asientos_por_fila),
      color: form.color,
    }

    setSubmitting(true)
    try {
      if (editing) {
        const res = await fetch(`/api/asientos/${eventoId}/secciones/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => null)
          toast.error(data?.error ?? "No se pudo actualizar la sección")
          return
        }
        setSecciones((prev) =>
          prev.map((s) =>
            s.id === editing.id
              ? {
                  ...s,
                  ...payload,
                  categoria_nombre:
                    categorias.find((c) => c.id === payload.categoria_id)?.nombre ?? null,
                }
              : s
          )
        )
        toast.success("Sección actualizada")
      } else {
        const res = await fetch(`/api/asientos/${eventoId}/secciones`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        })
        if (!res.ok) {
          const data = await res.json().catch(() => null)
          toast.error(data?.error ?? "No se pudo crear la sección")
          return
        }
        const data = await res.json()
        const created: AsientoSeccion = data?.seccion ?? data
        setSecciones((prev) => [
          ...prev,
          {
            ...created,
            categoria_nombre:
              categorias.find((c) => c.id === created.categoria_id)?.nombre ?? null,
          },
        ])
        toast.success("Sección creada")
      }
      cancelForm()
    } finally {
      setSubmitting(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Delete
  // ---------------------------------------------------------------------------

  async function confirmEliminar() {
    const s = toDelete
    if (!s) return
    await withLoading(async () => {
      const res = await fetch(`/api/asientos/${eventoId}/secciones/${s.id}`, {
        method: "DELETE",
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        toast.error(data?.error ?? "No se pudo eliminar la sección")
        return
      }
      setSecciones((prev) => prev.filter((sec) => sec.id !== s.id))
      toast.success("Sección eliminada")
      setToDelete(null)
    })
  }

  // ---------------------------------------------------------------------------
  // Generar asientos
  // ---------------------------------------------------------------------------

  async function generarAsientos(s: AsientoSeccion) {
    setGeneratingId(s.id)
    try {
      const res = await fetch(`/api/asientos/${eventoId}/secciones/${s.id}/generar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        toast.error(data?.error ?? "Error al generar los asientos")
        return
      }
      const created = data?.created ?? 0
      const total = data?.total ?? 0
      toast.success(
        created > 0
          ? `${formatInt(created)} asientos creados (${formatInt(total)} en total)`
          : `Ya tenía ${formatInt(total)} asientos — sin cambios`
      )
    } finally {
      setGeneratingId(null)
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="bg-card rounded-2xl border border-border p-4 md:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-foreground">
            <Map className="h-4 w-4 text-muted-foreground" />
            Mapa de asientos
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Secciones del venue, filas y butacas asignadas por comprador.
          </p>
        </div>
        {tipoMapa !== null && <TipoMapaBadge tipo={tipoMapa} />}
      </div>

      {/* Loading skeleton */}
      {loadingData && (
        <div className="space-y-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      )}

      {/* Error state */}
      {!loadingData && loadError && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertTriangle className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No se pudieron cargar las secciones.</p>
          <Button variant="outline" size="sm" onClick={fetchSecciones}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Reintentar
          </Button>
        </div>
      )}

      {/* Libre — no map */}
      {!loadingData && !loadError && tipoMapa === "libre" && (
        <p className="text-sm text-muted-foreground">
          Evento con acceso libre — sin mapa de asientos. Podés cambiar esto editando el evento.
        </p>
      )}

      {/* Numerado */}
      {!loadingData && !loadError && tipoMapa === "numerado" && (
        <div className="space-y-4">
          {/* Section list */}
          {secciones.length === 0 && !showForm ? (
            <div className="flex flex-col items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="text-sm font-medium text-foreground">Elegiste mapa numerado pero todavía no hay secciones</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Sin secciones no hay butacas para vender. Si publicás el evento así, el comprador no va a poder elegir lugar. Agregá al menos una.
                  </p>
                </div>
              </div>
              {canEdit && (
                <Button type="button" size="sm" className="shrink-0 gap-1.5" onClick={openCreate}>
                  <Plus className="h-3.5 w-3.5" /> Agregar sección
                </Button>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              {secciones.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-col gap-3 rounded-xl border border-border bg-muted/20 p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Color swatch */}
                    <span
                      className="h-4 w-4 shrink-0 rounded-full border border-border"
                      style={{ background: s.color ?? "#3b82f6" }}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-foreground">{s.nombre}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground font-mono tabular-nums">
                        {formatInt(s.filas)} filas × {formatInt(s.asientos_por_fila)} asientos
                        {s.total_asientos !== undefined && s.total_asientos > 0
                          ? ` — ${formatInt(s.total_asientos)} generados`
                          : ""}
                      </p>
                      {s.categoria_nombre ? (
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Categoría: {s.categoria_nombre}
                        </p>
                      ) : (
                        <p className="mt-0.5 flex items-center gap-1 text-xs font-medium text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3 shrink-0" />
                          Sin categoría de precio — los asientos de esta sección se venderán gratis
                        </p>
                      )}
                      {s.conteos && s.total_asientos !== undefined && s.total_asientos > 0 && (
                        <div className="mt-2 space-y-1">
                          <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
                            {s.conteos.vendido > 0 && (
                              <div
                                className="bg-emerald-500 dark:bg-emerald-400 shrink-0"
                                style={{ width: `${(s.conteos.vendido / s.total_asientos) * 100}%` }}
                              />
                            )}
                            {s.conteos.reservado > 0 && (
                              <div
                                className="bg-amber-400 dark:bg-amber-500 shrink-0"
                                style={{ width: `${(s.conteos.reservado / s.total_asientos) * 100}%` }}
                              />
                            )}
                            {s.conteos.bloqueado > 0 && (
                              <div
                                className="bg-muted-foreground/30 shrink-0"
                                style={{ width: `${(s.conteos.bloqueado / s.total_asientos) * 100}%` }}
                              />
                            )}
                          </div>
                          <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] font-mono tabular-nums">
                            {s.conteos.vendido > 0 && (
                              <span className="text-emerald-600 dark:text-emerald-400">{formatInt(s.conteos.vendido)} vendidos</span>
                            )}
                            {s.conteos.reservado > 0 && (
                              <span className="text-amber-600 dark:text-amber-400">{formatInt(s.conteos.reservado)} reservados</span>
                            )}
                            {s.conteos.disponible > 0 && (
                              <span className="text-muted-foreground">{formatInt(s.conteos.disponible)} disponibles</span>
                            )}
                            {s.conteos.bloqueado > 0 && (
                              <span className="text-muted-foreground/60">{formatInt(s.conteos.bloqueado)} bloqueados</span>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {canEdit && (
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        onClick={() => generarAsientos(s)}
                        disabled={generatingId === s.id}
                        className="flex items-center gap-1 h-10 px-3 rounded-lg text-xs font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <RefreshCw
                          className={cn("h-3 w-3", generatingId === s.id && "animate-spin")}
                        />
                        {generatingId === s.id ? "Generando…" : "Generar asientos"}
                      </button>
                      {s.total_asientos !== undefined && s.total_asientos > 0 && (
                        <button
                          onClick={() => setGestionandoFila(s)}
                          className="flex items-center gap-1 h-10 px-3 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors"
                        >
                          <Lock className="h-3 w-3" /> Filas
                        </button>
                      )}
                      <button
                        onClick={() => openEdit(s)}
                        className="flex items-center gap-1 h-10 px-3 rounded-lg text-xs font-medium bg-muted hover:bg-muted/80 text-foreground transition-colors"
                      >
                        <Pencil className="h-3 w-3" /> Editar
                      </button>
                      <button
                        onClick={() => setToDelete(s)}
                        className="flex items-center gap-1 h-10 px-3 rounded-lg text-xs font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors"
                      >
                        <Trash2 className="h-3 w-3" /> Eliminar
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Inline add/edit form */}
          {canEdit && showForm && (
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-foreground">
                  {editing ? "Editar sección" : "Nueva sección"}
                </p>
                <button
                  type="button"
                  onClick={cancelForm}
                  aria-label="Cancelar"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {/* Nombre */}
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs text-muted-foreground">Nombre</Label>
                  <Input
                    value={form.nombre}
                    onChange={(e) => setField("nombre", e.target.value)}
                    placeholder="Platea baja, VIP, Palco..."
                    className={cn("h-9 bg-card", formErrors.nombre && "border-destructive")}
                  />
                  {formErrors.nombre && (
                    <p className="text-xs text-destructive">{formErrors.nombre}</p>
                  )}
                </div>

                {/* Categoria */}
                <div className="space-y-1 sm:col-span-2">
                  <Label className="text-xs text-muted-foreground">Categoría de entrada (opcional)</Label>
                  <Select
                    value={form.categoria_id || "__none__"}
                    onValueChange={(v) => setField("categoria_id", v === "__none__" ? "" : v)}
                  >
                    <SelectTrigger className="h-9 w-full bg-card">
                      <SelectValue placeholder="Sin categoría asignada" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sin categoría</SelectItem>
                      {categorias.map((c) => (
                        <SelectItem key={c.id} value={c.id}>
                          {c.nombre}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Filas */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Filas (1–100)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={100}
                    value={form.filas}
                    onChange={(e) => setField("filas", e.target.value)}
                    className={cn(
                      "h-9 bg-card font-mono tabular-nums",
                      formErrors.filas && "border-destructive"
                    )}
                  />
                  {formErrors.filas && (
                    <p className="text-xs text-destructive">{formErrors.filas}</p>
                  )}
                </div>

                {/* Asientos por fila */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Asientos por fila (1–200)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={200}
                    value={form.asientos_por_fila}
                    onChange={(e) => setField("asientos_por_fila", e.target.value)}
                    className={cn(
                      "h-9 bg-card font-mono tabular-nums",
                      formErrors.asientos_por_fila && "border-destructive"
                    )}
                  />
                  {formErrors.asientos_por_fila && (
                    <p className="text-xs text-destructive">{formErrors.asientos_por_fila}</p>
                  )}
                </div>

                {/* Color */}
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Color en el mapa</Label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={form.color}
                      onChange={(e) => setField("color", e.target.value)}
                      className="h-9 w-10 cursor-pointer rounded-lg border border-border bg-card p-1"
                    />
                    <Input
                      value={form.color}
                      onChange={(e) => setField("color", e.target.value)}
                      placeholder="#3b82f6"
                      className={cn(
                        "h-9 flex-1 bg-card font-mono tabular-nums",
                        formErrors.color && "border-destructive"
                      )}
                    />
                  </div>
                  {formErrors.color && (
                    <p className="text-xs text-destructive">{formErrors.color}</p>
                  )}
                </div>

                {/* Mini seat grid preview */}
                <div className="flex items-end">
                  {Number(form.filas) > 0 && Number(form.asientos_por_fila) > 0 ? (
                    <div className="space-y-0.5">
                      <p className="text-xs text-muted-foreground font-mono tabular-nums mb-1.5">
                        Total: {formatInt(Number(form.filas) * Number(form.asientos_por_fila))} asientos
                      </p>
                      {Array.from({ length: Math.min(Number(form.filas), 8) }, (_, ri) => (
                        <div key={ri} className="flex gap-0.5 items-center">
                          {Array.from({ length: Math.min(Number(form.asientos_por_fila), 20) }, (_, ci) => (
                            <span
                              key={ci}
                              className="h-1.5 w-1.5 rounded-[1px] shrink-0"
                              style={{ background: form.color ?? "#3b82f6" }}
                            />
                          ))}
                          {Number(form.asientos_por_fila) > 20 && (
                            <span className="text-[9px] text-muted-foreground ml-0.5">
                              +{Number(form.asientos_por_fila) - 20}
                            </span>
                          )}
                        </div>
                      ))}
                      {Number(form.filas) > 8 && (
                        <p className="text-[9px] text-muted-foreground mt-0.5">
                          +{Number(form.filas) - 8} filas más
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <Button
                  type="button"
                  size="sm"
                  className="h-8 px-4"
                  onClick={submitForm}
                  disabled={submitting}
                >
                  {submitting ? "Guardando…" : editing ? "Guardar cambios" : "Crear sección"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8"
                  onClick={cancelForm}
                >
                  Cancelar
                </Button>
              </div>
            </div>
          )}

          {/* Add button — el caso "sin secciones" ya tiene su propio CTA en el aviso de arriba */}
          {canEdit && !showForm && secciones.length > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-1 h-9 w-full gap-1.5"
              onClick={openCreate}
            >
              <Plus className="h-3.5 w-3.5" /> Agregar sección
            </Button>
          )}
        </div>
      )}

      {/* Gestión de filas dialog */}
      {gestionandoFila && (
        <FilasDialog
          seccion={gestionandoFila}
          eventoId={eventoId}
          onClose={() => setGestionandoFila(null)}
          onRefresh={fetchSecciones}
        />
      )}

      {/* Delete confirm dialog */}
      <Dialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-destructive/10 text-destructive shrink-0">
                <AlertTriangle className="h-4 w-4" />
              </span>
              Eliminar sección
            </DialogTitle>
            <DialogDescription>
              Vas a eliminar{" "}
              <span className="font-medium text-foreground">
                {toDelete?.nombre ?? "esta sección"}
              </span>{" "}
              y todos sus asientos generados. Esta acción no se puede deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setToDelete(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={confirmEliminar}>
              <Trash2 className="mr-1 h-4 w-4" /> Eliminar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
