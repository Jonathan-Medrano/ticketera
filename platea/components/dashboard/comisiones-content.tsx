"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  AlertTriangle,
  CreditCard,
  Loader2,
  Receipt,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  Ticket,
  Wallet,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatDate, formatInt, formatMoney } from "@/lib/format"

type FlujoTotales = {
  bruto: number
  comision_mp: number
  comision_ticketera: number
  neto: number
  cantidad: number
}

type Totales = {
  bruto: number
  comision_mp: number
  comision_ticketera: number
  neto: number
}

type EventoFila = {
  evento_id: string
  nombre: string
  bruto: number
  comision_mp: number
  comision_ticketera: number
  neto: number
  cantidad: number
}

type ComisionesData = {
  desde: string
  hasta: string
  totales: Totales
  por_flujo: {
    entradas: FlujoTotales
    consumibles: FlujoTotales
  }
  por_evento: EventoFila[]
  sin_datos: {
    cantidad: number
    monto_bruto: number
  }
}

type ApiResponse = {
  data?: ComisionesData
  error?: string
}

function toNum(value: number | string | null | undefined): number {
  const num = typeof value === "number" ? value : Number(value)
  return Number.isFinite(num) ? num : 0
}

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  highlight = false,
}: {
  label: string
  value: string
  sub?: string
  icon: typeof Wallet
  highlight?: boolean
}) {
  return (
    <article
      className={
        highlight
          ? "rounded-card border border-primary/30 bg-primary/5 p-4 shadow-sm md:p-5"
          : "rounded-card border border-border bg-card p-4 shadow-sm md:p-5"
      }
    >
      <div
        className={
          highlight
            ? "flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/15 text-primary"
            : "flex h-10 w-10 items-center justify-center rounded-2xl bg-muted text-muted-foreground"
        }
      >
        <Icon className="h-4 w-4" />
      </div>
      <p className="mt-4 text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={
          highlight
            ? "mt-2 font-mono text-xl font-bold tracking-[-0.04em] tabular-nums text-primary md:text-2xl lg:text-[1.9rem]"
            : "mt-2 font-mono text-xl font-bold tracking-[-0.04em] tabular-nums text-foreground md:text-2xl lg:text-[1.9rem]"
        }
      >
        {value}
      </p>
      {sub ? <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{sub}</p> : null}
    </article>
  )
}

function FlujoCard({
  label,
  icon: Icon,
  flujo,
}: {
  label: string
  icon: typeof Ticket
  flujo: FlujoTotales
}) {
  const cantidad = toNum(flujo.cantidad)
  return (
    <article className="rounded-card border border-border bg-card p-4 shadow-sm md:p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-muted text-muted-foreground">
            <Icon className="h-4 w-4" />
          </div>
          <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-0.5 text-[11px] font-semibold tabular-nums text-muted-foreground">
          {formatInt(cantidad)} {cantidad === 1 ? "venta" : "ventas"}
        </span>
      </div>

      <dl className="mt-4 space-y-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">Bruto</dt>
          <dd className="font-mono font-medium tabular-nums text-foreground">{formatMoney(toNum(flujo.bruto))}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">Comisión Mercado Pago</dt>
          <dd className="font-mono font-medium tabular-nums text-foreground">
            −{formatMoney(toNum(flujo.comision_mp))}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">Comisión TICKETERA</dt>
          <dd className="font-mono font-medium tabular-nums text-foreground">
            −{formatMoney(toNum(flujo.comision_ticketera))}
          </dd>
        </div>
        <div className="mt-1 flex items-center justify-between gap-3 border-t border-border pt-2.5">
          <dt className="font-semibold text-foreground">Neto</dt>
          <dd className="font-mono text-base font-bold tabular-nums text-primary">{formatMoney(toNum(flujo.neto))}</dd>
        </div>
      </dl>
    </article>
  )
}

// Default: últimos 30 días en hora AR. El backend usa el mismo default si no
// mandamos fechas, pero los precargamos en los inputs para que el usuario los vea.
function defaultRange(): { desde: string; hasta: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Argentina/Buenos_Aires",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  })
  const hoy = new Date()
  const hace30 = new Date(hoy.getTime() - 30 * 24 * 60 * 60 * 1000)
  return { desde: fmt.format(hace30), hasta: fmt.format(hoy) }
}

export default function ComisionesContent() {
  const initialRange = useMemo(() => defaultRange(), [])
  const [desdeDraft, setDesdeDraft] = useState(initialRange.desde)
  const [hastaDraft, setHastaDraft] = useState(initialRange.hasta)
  const [applied, setApplied] = useState(initialRange)

  const [data, setData] = useState<ComisionesData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async (desde: string, hasta: string) => {
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams()
      if (desde) qs.set("desde", desde)
      if (hasta) qs.set("hasta", hasta)
      const res = await fetch(`/api/comisiones${qs.toString() ? `?${qs.toString()}` : ""}`, {
        cache: "no-store",
      })
      const json = (await res.json()) as ApiResponse
      if (!res.ok || !json.data) {
        setError(json.error ?? "No se pudieron cargar las comisiones")
        setData(null)
        return
      }
      setData(json.data)
    } catch {
      setError("Error de red — no se pudo contactar al servidor")
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void fetchData(applied.desde, applied.hasta)
  }, [applied, fetchData])

  function applyFilters() {
    setApplied({ desde: desdeDraft, hasta: hastaDraft })
  }

  const totales = data?.totales
  const sinDatos = data?.sin_datos

  return (
    <div className="space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-foreground">Comisiones reales</h1>
          <p className="mt-1 max-w-2xl text-pretty text-sm text-muted-foreground">
            La plata de tus ventas va a tu propio Mercado Pago. Acá te mostramos exacto cuánto te cobra MP y cuánto
            TICKETERA — sin esconder nada.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void fetchData(applied.desde, applied.hasta)}
          disabled={loading}
          className="gap-2"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Actualizar
        </Button>
      </div>

      {/* Filtro de rango de fechas */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-foreground">Período</h2>
            <p className="text-sm text-muted-foreground">
              {data ? (
                <>
                  Mostrando del {formatDate(`${data.desde}T12:00:00`)} al {formatDate(`${data.hasta}T12:00:00`)}.
                </>
              ) : (
                "Elegí el rango de fechas a analizar."
              )}
            </p>
          </div>
          <Button type="button" onClick={applyFilters} disabled={loading} className="w-full sm:w-auto">
            Aplicar
          </Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-end">
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Desde</label>
            <Input
              type="date"
              className="h-10 w-full bg-background"
              value={desdeDraft}
              max={hastaDraft || undefined}
              onChange={(e) => setDesdeDraft(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <label className="block text-xs font-medium text-muted-foreground">Hasta</label>
            <Input
              type="date"
              className="h-10 w-full bg-background"
              value={hastaDraft}
              min={desdeDraft || undefined}
              onChange={(e) => setHastaDraft(e.target.value)}
            />
          </div>
        </div>
      </section>

      {error ? (
        <section className="rounded-panel border border-red-500/30 bg-red-500/10 p-6 text-center text-sm text-red-800 dark:text-red-200">
          <AlertTriangle className="mr-2 inline h-4 w-4" />
          {error}
        </section>
      ) : null}

      {loading && !data ? (
        <section className="rounded-2xl border border-border bg-card p-12 text-center shadow-sm">
          <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Calculando comisiones…</p>
        </section>
      ) : null}

      {data && totales ? (
        <>
          {/* KPI strip */}
          <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
            <KpiCard
              label="Bruto vendido"
              value={formatMoney(toNum(totales.bruto))}
              sub="Total cobrado a tus compradores"
              icon={Wallet}
            />
            <KpiCard
              label="Comisión Mercado Pago"
              value={formatMoney(toNum(totales.comision_mp))}
              sub="Lo que cobra MP por procesar"
              icon={CreditCard}
            />
            <KpiCard
              label="Comisión TICKETERA"
              value={formatMoney(toNum(totales.comision_ticketera))}
              sub="Nuestra parte por el servicio"
              icon={ShieldCheck}
            />
            <KpiCard
              label="Neto que te queda"
              value={formatMoney(toNum(totales.neto))}
              sub="Después de todas las comisiones"
              icon={Wallet}
              highlight
            />
          </section>

          {/* Desglose por flujo */}
          <section className="space-y-3">
            <h2 className="text-base font-semibold text-foreground">Desglose por tipo de venta</h2>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:gap-4">
              <FlujoCard label="Entradas" icon={Ticket} flujo={data.por_flujo.entradas} />
              <FlujoCard label="Consumibles" icon={ShoppingCart} flujo={data.por_flujo.consumibles} />
            </div>
          </section>

          {/* Tabla por evento */}
          <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
            <div className="border-b border-border bg-muted/30 px-4 py-4 md:px-5">
              <h2 className="text-base font-semibold text-foreground">Por evento</h2>
              <p className="text-sm text-muted-foreground">Ordenado por monto bruto, de mayor a menor.</p>
            </div>

            {data.por_evento.length === 0 ? (
              <div className="p-12 text-center">
                <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                  <Receipt className="h-6 w-6 text-muted-foreground/50" />
                </div>
                <p className="mt-4 text-sm font-medium text-foreground">Sin ventas en este período</p>
                <p className="mt-1 text-sm text-muted-foreground">Probá ampliar el rango de fechas.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[840px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3 text-left font-medium md:px-5">Evento</th>
                      <th className="px-4 py-3 text-right font-medium whitespace-nowrap">Bruto</th>
                      <th className="px-4 py-3 text-right font-medium whitespace-nowrap">Comisión MP</th>
                      <th className="px-4 py-3 text-right font-medium whitespace-nowrap">Comisión TICKETERA</th>
                      <th className="px-4 py-3 text-right font-medium whitespace-nowrap">Neto</th>
                      <th className="px-4 py-3 text-right font-medium md:px-5 whitespace-nowrap">Ventas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.por_evento.map((ev) => (
                      <tr
                        key={ev.evento_id}
                        className="border-b border-border/60 transition-colors last:border-0 hover:bg-muted/30"
                      >
                        <td className="px-4 py-3 md:px-5">
                          <span className="font-medium text-foreground">{ev.nombre}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-foreground">
                          {formatMoney(toNum(ev.bruto))}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                          {formatMoney(toNum(ev.comision_mp))}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground">
                          {formatMoney(toNum(ev.comision_ticketera))}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-semibold tabular-nums text-primary">
                          {formatMoney(toNum(ev.neto))}
                        </td>
                        <td className="px-4 py-3 text-right font-mono tabular-nums text-muted-foreground md:px-5">
                          {formatInt(toNum(ev.cantidad))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-border bg-muted/30 font-semibold">
                      <td className="px-4 py-3 text-foreground md:px-5">Total</td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-foreground">
                        {formatMoney(toNum(totales.bruto))}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-foreground">
                        {formatMoney(toNum(totales.comision_mp))}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-foreground">
                        {formatMoney(toNum(totales.comision_ticketera))}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-primary">
                        {formatMoney(toNum(totales.neto))}
                      </td>
                      <td className="px-4 py-3 text-right font-mono tabular-nums text-foreground md:px-5">
                        {formatInt(data.por_evento.reduce((acc, ev) => acc + toNum(ev.cantidad), 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </section>

          {/* Nota de ventas sin datos de comisión */}
          {sinDatos && toNum(sinDatos.cantidad) > 0 ? (
            <p className="text-xs text-muted-foreground">
              {formatInt(toNum(sinDatos.cantidad))} {toNum(sinDatos.cantidad) === 1 ? "venta" : "ventas"} sin datos de
              comisión ({formatMoney(toNum(sinDatos.monto_bruto))}) — no entran en el cálculo de comisiones de arriba.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
