"use client"

import { useCallback, useEffect, useState } from "react"
import Link from "next/link"
import { ArrowLeft, CheckCircle2, Download, Loader2, Package, Plus, Send, Truck, X } from "lucide-react"
import { formatDateTime, formatMoney, formatInt } from "@/lib/format"
import { toast } from "sonner"

type Categoria = { id: string; nombre: string; precio: number }
type Fecha = { id: string; fecha: string }

type Lote = {
  id: string
  evento_id: string
  evento_nombre: string
  categoria_id: string
  categoria_nombre: string
  cantidad_total: number
  cantidad_disponible: number
  cantidad_vendido: number
  cantidad_usada: number
  cantidad_anulada: number
  precio_impreso: number | null
  formato: string
  estado: string
  notas: string | null
  fecha_envio_imprenta: string | null
  fecha_recepcion: string | null
  created_at: string
}

type Revendedor = { id: string; nombre: string }

type Props = {
  eventoId: string
  eventoNombre: string
  modoFecha: "unica" | "multiple" | "pase"
  categorias: Categoria[]
  fechas: Fecha[]
  revendedores?: Revendedor[]
}

const ESTADO_LABEL: Record<string, string> = {
  generado: "Generado",
  enviado_imprenta: "En imprenta",
  recibido: "Recibido",
  completado: "Completado",
  anulado: "Anulado",
}

const ESTADO_ORDER: Array<{ value: string; label: string; icon: typeof Send }> = [
  { value: "enviado_imprenta", label: "Marcar 'En imprenta'", icon: Send },
  { value: "recibido", label: "Marcar 'Recibido'", icon: Truck },
  { value: "completado", label: "Marcar 'Completado'", icon: CheckCircle2 },
]


export default function PreimpresosSection({ eventoId, eventoNombre, modoFecha, categorias, fechas, revendedores = [] }: Props) {
  const [lotes, setLotes] = useState<Lote[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [busy, setBusy] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)

  const loadLotes = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/preimpresos?evento_id=${eventoId}`, { cache: "no-store" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { data: { lotes: Lote[] } }
      setLotes(json.data.lotes)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando lotes")
    } finally {
      setLoading(false)
    }
  }, [eventoId])

  useEffect(() => {
    void loadLotes()
  }, [loadLotes])

  const changeEstado = useCallback(
    async (loteId: string, estado: string) => {
      setBusy((prev) => ({ ...prev, [loteId]: true }))
      try {
        const res = await fetch(`/api/preimpresos/${loteId}/estado`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ estado }),
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        await loadLotes()
      } catch (err) {
        setError(err instanceof Error ? err.message : "Error actualizando estado")
      } finally {
        setBusy((prev) => {
          const next = { ...prev }
          delete next[loteId]
          return next
        })
      }
    },
    [loadLotes],
  )

  return (
    <div className="space-y-6 p-4 md:p-6">
      <header className="space-y-1">
        <Link
          href={`/dashboard/eventos/${eventoId}`}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Volver al evento
        </Link>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Tickets físicos pre-impresos</h1>
        <p className="text-sm text-muted-foreground">
          <strong>{eventoNombre}</strong>: generá lotes de tickets físicos con QR único pre-bindeado. Cada ticket genera un PDF imposicionable
          listo para imprenta. Cuando se canjea en puerta, el sistema lo marca como usado (fotocopias rechazadas automáticamente).
        </p>
      </header>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-400">
          <span className="flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} className="p-0.5">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {lotes.length} {lotes.length === 1 ? "lote" : "lotes"} en este evento
        </p>
        <button
          type="button"
          onClick={() => setShowForm(true)}
          disabled={categorias.length === 0}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <Plus className="h-4 w-4" />
          Generar lote
        </button>
      </div>

      {showForm && (
        <CreateLoteForm
          eventoId={eventoId}
          modoFecha={modoFecha}
          categorias={categorias}
          fechas={fechas}
          onCreated={() => {
            setShowForm(false)
            void loadLotes()
          }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {loading && (
        <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Cargando lotes…
        </div>
      )}

      {!loading && lotes.length === 0 && (
        <div className="rounded-xl border border-dashed border-border/60 px-4 py-10 text-center">
          <Package className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">Todavía no generaste lotes de tickets físicos para este evento.</p>
        </div>
      )}

      {!loading && lotes.length > 0 && (
        <div className="grid gap-4">
          {lotes.map((lote) => (
            <LoteCard
              key={lote.id}
              lote={lote}
              busy={!!busy[lote.id]}
              onChangeEstado={(estado) => void changeEstado(lote.id, estado)}
              revendedores={revendedores}
              onAsignacionDone={() => void loadLotes()}
            />
          ))}
        </div>
      )}
    </div>
  )
}

const FORMATO_OPTIONS = [
  { value: "horizontal_4xa4", label: "Horizontal · 4 por A4", description: "Clásico boletería con stub, ~190×52mm. Recomendado para la mayoría de eventos." },
  { value: "vertical_4xa4", label: "Vertical · 4 por A4", description: "Tipo entrada de cine, ~100×145mm. Más espacio para diseño visual." },
  { value: "tarjeta_8xa4", label: "Tarjeta plástica · 8 por A4", description: "Formato tarjeta de crédito 85.6×54mm con bordes redondeados. 8 por hoja. Ideal para imprimir en placa plástica." },
  { value: "pulsera_12xa4", label: "Pulsera tyvek · 12 por A4", description: "Banda larga 190×16mm para imprimir en papel tyvek y cerrar en muñeca. Ideal para festivales/boliches." },
] as const

function CreateLoteForm({
  eventoId,
  modoFecha,
  categorias,
  fechas,
  onCreated,
  onCancel,
}: {
  eventoId: string
  modoFecha: "unica" | "multiple" | "pase"
  categorias: Categoria[]
  fechas: Fecha[]
  onCreated: () => void
  onCancel: () => void
}) {
  const [categoriaId, setCategoriaId] = useState<string>(categorias[0]?.id ?? "")
  const [fechaId, setFechaId] = useState<string>("")
  const [cantidad, setCantidad] = useState<number>(100)
  const [formato, setFormato] = useState<string>("horizontal_4xa4")
  const [overridePrecio, setOverridePrecio] = useState<boolean>(false)
  const [precioImpreso, setPrecioImpreso] = useState<number>(0)
  const [notas, setNotas] = useState<string>("")
  const [seguridadGuilloche, setSeguridadGuilloche] = useState<boolean>(false)
  const [seguridadMicrotexto, setSeguridadMicrotexto] = useState<boolean>(false)
  const [seguridadHologramaArea, setSeguridadHologramaArea] = useState<boolean>(false)
  const [saving, setSaving] = useState<boolean>(false)
  const [err, setErr] = useState<string | null>(null)

  const submit = useCallback(async () => {
    setErr(null)
    if (!categoriaId) {
      setErr("Elegí una categoría")
      return
    }
    if (!Number.isFinite(cantidad) || cantidad < 1 || cantidad > 10000) {
      setErr("La cantidad debe estar entre 1 y 10.000")
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        evento_id: eventoId,
        categoria_id: categoriaId,
        cantidad,
        formato,
        notas: notas.trim() || null,
        seguridad_guilloche: seguridadGuilloche,
        seguridad_microtexto: seguridadMicrotexto,
        seguridad_holograma_area: seguridadHologramaArea,
      }
      if (modoFecha === "multiple" && fechaId) body.fecha_id = fechaId
      if (overridePrecio) body.precio_impreso = precioImpreso

      const res = await fetch(`/api/preimpresos`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(errBody.error ?? `HTTP ${res.status}`)
      }
      onCreated()
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error creando lote")
    } finally {
      setSaving(false)
    }
  }, [cantidad, categoriaId, eventoId, fechaId, formato, modoFecha, notas, onCreated, overridePrecio, precioImpreso, seguridadGuilloche, seguridadMicrotexto, seguridadHologramaArea])

  const categoriaActual = categorias.find((c) => c.id === categoriaId)

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-foreground">Generar nuevo lote</h2>
        <button type="button" onClick={onCancel} className="rounded-md p-1 text-muted-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Categoría</span>
          <select
            value={categoriaId}
            onChange={(e) => setCategoriaId(e.target.value)}
            className="h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:border-primary"
          >
            {categorias.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre} — {formatMoney(c.precio)}
              </option>
            ))}
          </select>
        </label>

        {modoFecha === "multiple" && (
          <label className="space-y-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">Fecha (opcional)</span>
            <select
              value={fechaId}
              onChange={(e) => setFechaId(e.target.value)}
              className="h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:border-primary"
            >
              <option value="">Todas / no aplica</option>
              {fechas.map((f) => (
                <option key={f.id} value={f.id}>
                  {formatDateTime(f.fecha)}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="space-y-1">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Cantidad de tickets</span>
          <input
            type="number"
            min={1}
            max={10000}
            value={cantidad}
            onChange={(e) => setCantidad(Number(e.target.value))}
            className="h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:border-primary"
          />
        </label>

        <div className="space-y-1">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Precio en ticket</span>
          <div className="flex items-center gap-2">
            <label className="inline-flex items-center gap-1.5 text-sm">
              <input type="checkbox" checked={overridePrecio} onChange={(e) => setOverridePrecio(e.target.checked)} />
              <span>Usar precio distinto al de categoría</span>
            </label>
          </div>
          {overridePrecio ? (
            <input
              type="number"
              min={0}
              step={100}
              value={precioImpreso}
              onChange={(e) => setPrecioImpreso(Number(e.target.value))}
              className="h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:border-primary"
            />
          ) : (
            <p className="text-xs text-muted-foreground">
              Se imprimirá: <strong className="font-mono tabular-nums">{formatMoney(categoriaActual?.precio ?? null)}</strong>
            </p>
          )}
        </div>

        <label className="space-y-1 md:col-span-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Notas internas (opcional)</span>
          <input
            type="text"
            value={notas}
            onChange={(e) => setNotas(e.target.value)}
            placeholder="Ej: Lote para revendedor Juan / kioskos centro"
            className="h-10 w-full rounded-lg border border-border/60 bg-background px-3 text-sm outline-none focus:border-primary"
          />
        </label>

        {/* Formato del ticket */}
        <div className="space-y-2 md:col-span-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Formato del ticket</span>
          <div className="grid gap-2 sm:grid-cols-2">
            {FORMATO_OPTIONS.map((opt) => (
              <label
                key={opt.value}
                className={`flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors ${
                  formato === opt.value ? "border-primary bg-primary/5" : "border-border/60 bg-background hover:bg-muted/40"
                }`}
              >
                <input
                  type="radio"
                  name="formato"
                  value={opt.value}
                  checked={formato === opt.value}
                  onChange={(e) => setFormato(e.target.value)}
                  className="mt-1 shrink-0"
                />
                <div>
                  <div className="text-sm font-medium text-foreground">{opt.label}</div>
                  <div className="text-xs text-muted-foreground">{opt.description}</div>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Seguridad anti-falsificación */}
        <div className="space-y-2 md:col-span-2">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Elementos de seguridad (opcionales)</span>
          <div className="flex flex-col gap-2 rounded-lg border border-border/60 bg-muted/30 p-3">
            <label className="inline-flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={seguridadGuilloche}
                onChange={(e) => setSeguridadGuilloche(e.target.checked)}
                className="mt-1 shrink-0"
              />
              <div>
                <span className="font-medium">Guilloché</span>
                <span className="block text-xs text-muted-foreground">
                  Patrón de líneas finas en el fondo. Difícil de fotocopiar sin perder detalle.
                </span>
              </div>
            </label>
            <label className="inline-flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={seguridadMicrotexto}
                onChange={(e) => setSeguridadMicrotexto(e.target.checked)}
                className="mt-1 shrink-0"
              />
              <div>
                <span className="font-medium">Microtexto</span>
                <span className="block text-xs text-muted-foreground">
                  Texto de 3.5pt repetido al pie. Visible solo con lupa, se rompe al fotocopiarse.
                </span>
              </div>
            </label>
            <label className="inline-flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={seguridadHologramaArea}
                onChange={(e) => setSeguridadHologramaArea(e.target.checked)}
                className="mt-1 shrink-0"
              />
              <div>
                <span className="font-medium">Área para holograma</span>
                <span className="block text-xs text-muted-foreground">
                  Reserva un cuadro marcado en el ticket donde pegar adhesivos holográficos comprados aparte.
                </span>
              </div>
            </label>
          </div>
        </div>
      </div>

      {err && <p className="mt-3 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-400">{err}</p>}

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border/40 pt-4">
        <button type="button" onClick={onCancel} className="rounded-lg border border-border/60 px-3 py-2 text-sm hover:bg-muted">
          Cancelar
        </button>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Crear lote
        </button>
      </div>
    </div>
  )
}

function LoteCard({
  lote,
  busy,
  onChangeEstado,
  revendedores,
  onAsignacionDone,
}: {
  lote: Lote
  busy: boolean
  onChangeEstado: (estado: string) => void
  revendedores: Revendedor[]
  onAsignacionDone: () => void
}) {
  const total = lote.cantidad_total
  const used = lote.cantidad_usada
  const sold = lote.cantidad_vendido
  const avail = lote.cantidad_disponible
  const annul = lote.cantidad_anulada
  const pctUsed = total > 0 ? Math.round((used / total) * 100) : 0
  const [asignForm, setAsignForm] = useState<{ open: boolean; revendedorId: string; cantidad: string; saving: boolean; err: string | null }>(
    { open: false, revendedorId: revendedores[0]?.id ?? "", cantidad: "10", saving: false, err: null },
  )

  const submitAsignacion = useCallback(async () => {
    if (!asignForm.revendedorId) {
      setAsignForm((f) => ({ ...f, err: "Elegí un revendedor" }))
      return
    }
    const cantidad = Number(asignForm.cantidad)
    if (!Number.isFinite(cantidad) || cantidad < 1) {
      setAsignForm((f) => ({ ...f, err: "Cantidad inválida" }))
      return
    }
    setAsignForm((f) => ({ ...f, saving: true, err: null }))
    try {
      const res = await fetch(`/api/preimpresos/${lote.id}/asignar`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ revendedor_id: asignForm.revendedorId, cantidad }),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      const json = (await res.json()) as { data: { asignados: number; requested: number } }
      setAsignForm({ open: false, revendedorId: revendedores[0]?.id ?? "", cantidad: "10", saving: false, err: null })
      onAsignacionDone()
      if (json.data.asignados < json.data.requested) {
        toast.warning(`Asignados ${json.data.asignados} de ${json.data.requested} solicitados (no quedaban más disponibles).`)
      }
    } catch (e) {
      setAsignForm((f) => ({ ...f, saving: false, err: e instanceof Error ? e.message : "Error" }))
    }
  }, [asignForm.revendedorId, asignForm.cantidad, lote.id, onAsignacionDone, revendedores])

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-foreground">{lote.categoria_nombre}</h3>
            <span
              className={`rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${
                lote.estado === "completado"
                  ? "bg-success/15 text-success"
                  : lote.estado === "anulado"
                    ? "bg-rose-500/15 text-rose-700 dark:text-rose-400"
                    : lote.estado === "recibido"
                      ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400"
                      : lote.estado === "enviado_imprenta"
                        ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                        : "bg-slate-500/15 text-slate-700 dark:text-slate-400"
              }`}
            >
              {ESTADO_LABEL[lote.estado] ?? lote.estado}
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {total} tickets · <span className="font-mono tabular-nums">{formatMoney(lote.precio_impreso)}</span> · creado {formatDateTime(lote.created_at)}
          </p>
          {lote.notas && <p className="mt-1 text-xs italic text-muted-foreground">&quot;{lote.notas}&quot;</p>}
        </div>

        <div className="flex items-center gap-2">
          <a
            href={`/api/preimpresos/${lote.id}/pdf`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-medium hover:bg-muted"
          >
            <Download className="h-4 w-4" />
            Descargar PDF
          </a>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBox label="Disponibles" value={avail} accent="info" />
        <StatBox label="Vendidos" value={sold} accent="warn" />
        <StatBox label="Usados" value={used} accent="ok" />
        <StatBox label="Anulados" value={annul} accent="danger" />
      </div>

      <div className="mt-3">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Progreso de uso</span>
          <span>{pctUsed}%</span>
        </div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full rounded-full bg-success transition-all" style={{ width: `${pctUsed}%` }} />
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border/40 pt-3">
        {ESTADO_ORDER.filter((e) => e.value !== lote.estado).map((e) => {
          const Icon = e.icon
          return (
            <button
              key={e.value}
              type="button"
              onClick={() => onChangeEstado(e.value)}
              disabled={busy}
              className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border/60 bg-background px-3 text-xs hover:bg-muted disabled:opacity-50"
            >
              <Icon className="h-3.5 w-3.5" />
              {e.label}
            </button>
          )
        })}
        {revendedores.length > 0 && avail > 0 && (
          <button
            type="button"
            onClick={() => setAsignForm((f) => ({ ...f, open: !f.open }))}
            className="inline-flex h-10 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 text-xs text-primary hover:bg-primary/20"
          >
            <Plus className="h-3.5 w-3.5" />
            Asignar a revendedor
          </button>
        )}
        {busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      </div>

      {asignForm.open && (
        <div className="mt-3 rounded-lg border border-border/60 bg-muted/30 p-3">
          <div className="grid gap-2 sm:grid-cols-[1fr_120px_auto_auto]">
            <select
              value={asignForm.revendedorId}
              onChange={(e) => setAsignForm((f) => ({ ...f, revendedorId: e.target.value }))}
              className="h-9 rounded-md border border-border/60 bg-background px-2 text-sm"
            >
              {revendedores.map((r) => (
                <option key={r.id} value={r.id}>{r.nombre}</option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={avail}
              value={asignForm.cantidad}
              onChange={(e) => setAsignForm((f) => ({ ...f, cantidad: e.target.value }))}
              placeholder="cantidad"
              className="h-9 rounded-md border border-border/60 bg-background px-2 text-sm"
            />
            <button
              type="button"
              onClick={() => void submitAsignacion()}
              disabled={asignForm.saving}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground disabled:opacity-50"
            >
              {asignForm.saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Asignar
            </button>
            <button
              type="button"
              onClick={() => setAsignForm((f) => ({ ...f, open: false, err: null }))}
              className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Asigna los siguientes {asignForm.cantidad || "N"} tickets disponibles del lote (en orden) al revendedor seleccionado. Hay {avail} disponibles.
          </p>
          {asignForm.err && <p className="mt-1 text-xs text-rose-500">{asignForm.err}</p>}
        </div>
      )}
    </div>
  )
}

function StatBox({ label, value, accent }: { label: string; value: number; accent: "info" | "ok" | "warn" | "danger" }) {
  const accentClass: Record<typeof accent, string> = {
    info: "border-cyan-500/30 bg-cyan-500/5",
    ok: "border-success/30 bg-success/5",
    warn: "border-amber-500/30 bg-amber-500/5",
    danger: "border-rose-500/30 bg-rose-500/5",
  }
  return (
    <div className={`rounded-lg border ${accentClass[accent]} p-3`}>
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-xl font-bold tabular-nums">{formatInt(value)}</div>
    </div>
  )
}
