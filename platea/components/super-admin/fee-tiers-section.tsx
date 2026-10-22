"use client"

import { useCallback, useMemo, useState } from "react"
import { AlertTriangle, Check, Info, Loader2, Plus, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { formatDate, formatInt } from "@/lib/format"

export type FeeTier = {
  id: string
  nombre: string
  min_entradas_90d: number
  pct_entradas: number
  pct_consumibles: number
  activo: boolean
  orden: number
}

export type FeeTierPendiente = {
  empresa_id: string
  empresa_nombre: string
  entradas_ventana: number
  pending_desde: string | null
  evaluated_at: string | null
  tier_actual: string | null
  tier_propuesto: string | null
  pct_entradas_propuesto: string | null
  pct_consumibles_propuesto: string | null
}

type Props = {
  tiersIniciales: FeeTier[]
  pendientesIniciales: FeeTierPendiente[]
  canEditEscalera: boolean
  canEditEmpresa: boolean
}

function pctLabel(value: number | string | null): string {
  if (value === null) return "—"
  const n = typeof value === "number" ? value : Number(value)
  if (!Number.isFinite(n)) return "—"
  return `${n.toFixed(2).replace(".", ",")}%`
}

/** Validación espejo de la del servidor. La del servidor es la que manda. */
function validar(tiers: FeeTier[]): { errores: string[]; advertencias: string[] } {
  const errores: string[] = []
  const advertencias: string[] = []
  const activos = [...tiers].filter((t) => t.activo).sort((a, b) => a.min_entradas_90d - b.min_entradas_90d)

  for (const t of tiers) {
    if (!t.nombre.trim()) errores.push("Todos los tiers necesitan un nombre")
    for (const [label, pct] of [
      ["entradas", t.pct_entradas],
      ["consumibles", t.pct_consumibles],
    ] as const) {
      if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
        errores.push(`"${t.nombre || "sin nombre"}" tiene un porcentaje de ${label} inválido`)
      }
    }
    if (!Number.isInteger(t.min_entradas_90d) || t.min_entradas_90d < 0) {
      errores.push(`"${t.nombre || "sin nombre"}" tiene un umbral inválido`)
    }
  }

  const vistos = new Map<number, string>()
  for (const t of activos) {
    const previo = vistos.get(t.min_entradas_90d)
    if (previo) errores.push(`"${previo}" y "${t.nombre}" comparten el umbral ${t.min_entradas_90d}`)
    else vistos.set(t.min_entradas_90d, t.nombre)
  }

  if (activos.length > 0 && !activos.some((t) => t.min_entradas_90d === 0)) {
    errores.push("La escalera necesita un tier base activo con umbral 0")
  }

  for (let i = 1; i < activos.length; i += 1) {
    const ant = activos[i - 1]
    const act = activos[i]
    if (act.pct_entradas > ant.pct_entradas || act.pct_consumibles > ant.pct_consumibles) {
      advertencias.push(`"${act.nombre}" cobra más que "${ant.nombre}": vender más saldría más caro`)
    }
  }

  return { errores, advertencias }
}

export default function FeeTiersSection({
  tiersIniciales,
  pendientesIniciales,
  canEditEscalera,
  canEditEmpresa,
}: Props) {
  const [tiers, setTiers] = useState<FeeTier[]>(tiersIniciales)
  const [pendientes, setPendientes] = useState<FeeTierPendiente[]>(pendientesIniciales)
  const [guardando, setGuardando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmando, setConfirmando] = useState<FeeTierPendiente | null>(null)
  const [aplicando, setAplicando] = useState(false)

  const { errores, advertencias } = useMemo(() => validar(tiers), [tiers])
  const hayActivos = tiers.some((t) => t.activo)

  const actualizar = useCallback((id: string, patch: Partial<FeeTier>) => {
    setTiers((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  const agregar = useCallback(() => {
    setTiers((prev) => [
      ...prev,
      {
        id: `nuevo-${Date.now()}`,
        nombre: "",
        min_entradas_90d: 0,
        pct_entradas: 4,
        pct_consumibles: 3,
        activo: false,
        orden: prev.length,
      },
    ])
  }, [])

  const guardar = useCallback(async () => {
    setGuardando(true)
    setError(null)
    setMensaje(null)
    try {
      const res = await fetch("/api/platform/fee-tiers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiers }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? "No se pudo guardar la escalera")
      setTiers(json.data.tiers)
      setMensaje("Escalera guardada")
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la escalera")
    } finally {
      setGuardando(false)
    }
  }, [tiers])

  const aplicarDescenso = useCallback(async () => {
    if (!confirmando) return
    setAplicando(true)
    setError(null)
    try {
      const res = await fetch(`/api/platform/fee-tiers/pendientes/${confirmando.empresa_id}/aplicar`, {
        method: "POST",
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? "No se pudo aplicar el cambio")
      setPendientes((prev) => prev.filter((p) => p.empresa_id !== confirmando.empresa_id))
      setMensaje(`Comisión actualizada para ${confirmando.empresa_nombre}`)
      setConfirmando(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo aplicar el cambio")
    } finally {
      setAplicando(false)
    }
  }, [confirmando])

  const descartar = useCallback(async (empresaId: string) => {
    setError(null)
    try {
      const res = await fetch(`/api/platform/fee-tiers/pendientes/${empresaId}`, { method: "DELETE" })
      if (!res.ok) throw new Error("No se pudo descartar")
      setPendientes((prev) => prev.filter((p) => p.empresa_id !== empresaId))
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo descartar")
    }
  }, [])

  return (
    <div className="space-y-8">
      {/* Estado del motor */}
      <div className="rounded-card border border-border bg-card p-5">
        <div className="flex items-start gap-3">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="space-y-1 text-sm">
            <p className="font-semibold">
              {hayActivos ? "El motor está activo" : "El motor está apagado"}
            </p>
            <p className="text-muted-foreground">
              {hayActivos
                ? "La evaluación diaria baja la comisión sola cuando una empresa cruza un umbral. Las subas nunca se aplican solas: caen en la cola de abajo."
                : "No hay ningún tier activo, así que la evaluación diaria mide volumen pero no modifica ninguna comisión. Activá al menos el tier base para encender el motor."}
            </p>
          </div>
        </div>
      </div>

      {(mensaje || error) && (
        <div
          className={`rounded-card border p-4 text-sm ${
            error ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border bg-card"
          }`}
        >
          {error ?? mensaje}
        </div>
      )}

      {/* Escalera */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">Escalera de comisiones</h2>
            <p className="text-sm text-muted-foreground">
              El umbral se mide en <strong>cantidad de entradas online</strong> de los últimos 90 días, no en pesos:
              un umbral en pesos se desactualiza con la inflación.
            </p>
          </div>
          {canEditEscalera && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={agregar}>
                <Plus className="mr-1.5 h-4 w-4" />
                Agregar tier
              </Button>
              <Button size="sm" onClick={guardar} disabled={guardando || errores.length > 0}>
                {guardando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
                Guardar
              </Button>
            </div>
          )}
        </div>

        {errores.length > 0 && (
          <div className="rounded-card border border-destructive/40 bg-destructive/10 p-4">
            <ul className="space-y-1 text-sm text-destructive">
              {errores.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        {advertencias.length > 0 && (
          <div className="rounded-card border border-amber-500/40 bg-amber-500/10 p-4">
            <ul className="space-y-1 text-sm">
              {advertencias.map((a) => (
                <li key={a} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                  <span>{a}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-separate border-spacing-0">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="border-b border-border pb-2 pr-3 font-medium">Nombre</th>
                <th className="border-b border-border pb-2 pr-3 text-right font-medium">Entradas / 90d</th>
                <th className="border-b border-border pb-2 pr-3 text-right font-medium">% Entradas</th>
                <th className="border-b border-border pb-2 pr-3 text-right font-medium">% Consumibles</th>
                <th className="border-b border-border pb-2 pr-3 font-medium">Estado</th>
                {canEditEscalera && <th className="border-b border-border pb-2 font-medium" />}
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier) => (
                <tr key={tier.id}>
                  <td className="border-b border-border py-2 pr-3">
                    <Input
                      value={tier.nombre}
                      disabled={!canEditEscalera}
                      onChange={(e) => actualizar(tier.id, { nombre: e.target.value })}
                      className="h-9"
                    />
                  </td>
                  <td className="border-b border-border py-2 pr-3">
                    <Input
                      type="number"
                      min={0}
                      value={tier.min_entradas_90d}
                      disabled={!canEditEscalera}
                      onChange={(e) => actualizar(tier.id, { min_entradas_90d: Number(e.target.value) })}
                      className="h-9 text-right font-mono tabular-nums"
                    />
                  </td>
                  <td className="border-b border-border py-2 pr-3">
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      max={100}
                      value={tier.pct_entradas}
                      disabled={!canEditEscalera}
                      onChange={(e) => actualizar(tier.id, { pct_entradas: Number(e.target.value) })}
                      className="h-9 text-right font-mono tabular-nums"
                    />
                  </td>
                  <td className="border-b border-border py-2 pr-3">
                    <Input
                      type="number"
                      step="0.01"
                      min={0}
                      max={100}
                      value={tier.pct_consumibles}
                      disabled={!canEditEscalera}
                      onChange={(e) => actualizar(tier.id, { pct_consumibles: Number(e.target.value) })}
                      className="h-9 text-right font-mono tabular-nums"
                    />
                  </td>
                  <td className="border-b border-border py-2 pr-3">
                    <button
                      type="button"
                      disabled={!canEditEscalera}
                      onClick={() => actualizar(tier.id, { activo: !tier.activo })}
                      className="disabled:cursor-not-allowed"
                    >
                      <Badge variant={tier.activo ? "default" : "secondary"}>
                        {tier.activo ? "Activo" : "Inactivo"}
                      </Badge>
                    </button>
                  </td>
                  {canEditEscalera && (
                    <td className="border-b border-border py-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setTiers((prev) => prev.filter((t) => t.id !== tier.id))}
                        aria-label={`Eliminar ${tier.nombre}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Cola de descensos */}
      <section className="space-y-4">
        <div>
          <h2 className="text-lg font-semibold">Subas de comisión pendientes</h2>
          <p className="text-sm text-muted-foreground">
            Estas empresas bajaron su volumen y les correspondería una comisión más alta. Nunca se aplica sola:
            avisale al cliente antes de confirmar.
          </p>
        </div>

        {pendientes.length === 0 ? (
          <div className="rounded-card border border-border bg-card p-8 text-center text-sm text-muted-foreground">
            No hay subas pendientes.
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {pendientes.map((p) => (
              <div key={p.empresa_id} className="rounded-card border border-border bg-card p-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold">{p.empresa_nombre}</p>
                    <p className="text-sm text-muted-foreground">
                      <span className="font-mono tabular-nums">{formatInt(p.entradas_ventana)}</span> entradas en 90 días
                    </p>
                  </div>
                  <Badge variant="secondary">
                    {p.tier_actual ?? "—"} → {p.tier_propuesto ?? "—"}
                  </Badge>
                </div>

                <dl className="mt-4 space-y-1 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Entradas</dt>
                    <dd className="font-mono tabular-nums">{pctLabel(p.pct_entradas_propuesto)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Consumibles</dt>
                    <dd className="font-mono tabular-nums">{pctLabel(p.pct_consumibles_propuesto)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Pendiente desde</dt>
                    <dd className="font-mono tabular-nums">{p.pending_desde ? formatDate(p.pending_desde) : "—"}</dd>
                  </div>
                </dl>

                {canEditEmpresa && (
                  <div className="mt-4 flex gap-2">
                    <Button size="sm" onClick={() => setConfirmando(p)}>
                      Aplicar suba
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => descartar(p.empresa_id)}>
                      Descartar
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Confirmación por Dialog, nunca window.confirm */}
      <Dialog open={confirmando !== null} onOpenChange={(open) => !open && setConfirmando(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Subir la comisión de {confirmando?.empresa_nombre}?</DialogTitle>
            <DialogDescription>
              Pasaría al tier <strong>{confirmando?.tier_propuesto}</strong>:{" "}
              {pctLabel(confirmando?.pct_entradas_propuesto ?? null)} en entradas y{" "}
              {pctLabel(confirmando?.pct_consumibles_propuesto ?? null)} en consumibles. Aplica solo a ventas nuevas —
              las ya cobradas mantienen su comisión. Confirmá que le avisaste al cliente.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmando(null)} disabled={aplicando}>
              Cancelar
            </Button>
            <Button onClick={aplicarDescenso} disabled={aplicando}>
              {aplicando && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
              Confirmar suba
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
