"use client"

import { useCallback, useMemo, useState } from "react"
import Image from "next/image"
import { AlertCircle, ArrowLeft, Banknote, Check, CheckCircle2, ChevronDown, Copy, CreditCard, Loader2, Minus, Plus, Receipt, Send, ShoppingBag, Ticket, Wallet } from "lucide-react"
import { formatMoney, formatDateTime } from "@/lib/format"

type Categoria = { id: string; nombre: string; precio: number; stock_disponible: number; imagen_url: string | null }
type Fecha = { id: string; fecha: string }
type Evento = {
  id: string
  nombre: string
  modo_fecha: string
  imagen_url: string | null
  categorias: Categoria[]
  fechas: Fecha[]
}

type EntradaCreada = {
  id: string
  qr_code: string
  clave_corta: string
  precio_pagado: number
}

type EmailEnvioEstado = "enviado" | "fallido" | "omitido" | "no_solicitado"

type VentaResult = {
  cantidad: number
  precio_unitario: number
  precio_total: number
  medio_pago: string
  entradas: EntradaCreada[]
  email_envio?: { estado: EmailEnvioEstado; email: string | null }
}

// Mismo criterio de validez de email que el backend (routes/pos.ts).
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

const MEDIOS_PAGO = [
  { value: "efectivo", label: "Efectivo", icon: Banknote },
  { value: "tarjeta_manual", label: "Tarjeta", hint: "datáfono manual", icon: CreditCard },
  { value: "transferencia", label: "Transferencia", hint: "CBU / alias", icon: Wallet },
] as const

export default function PosSection({ eventos }: { eventos: Evento[] }) {
  const [eventoId, setEventoId] = useState<string>(eventos[0]?.id ?? "")
  const [categoriaId, setCategoriaId] = useState<string>(eventos[0]?.categorias[0]?.id ?? "")
  const [fechaId, setFechaId] = useState<string>("")
  const [cantidad, setCantidad] = useState<number>(1)
  const [medioPago, setMedioPago] = useState<string>("efectivo")
  const [montoRecibido, setMontoRecibido] = useState<string>("")
  const [overridePrecio, setOverridePrecio] = useState<boolean>(false)
  const [precioOverride, setPrecioOverride] = useState<number>(0)
  const [compradorNombre, setCompradorNombre] = useState<string>("")
  const [compradorDni, setCompradorDni] = useState<string>("")
  const [compradorEmail, setCompradorEmail] = useState<string>("")
  const [enviarEmail, setEnviarEmail] = useState<boolean>(false)
  const [saving, setSaving] = useState<boolean>(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<VentaResult | null>(null)
  const [copiado, setCopiado] = useState<string | null>(null)

  const evento = useMemo(() => eventos.find((e) => e.id === eventoId) ?? null, [eventoId, eventos])
  const categoria = useMemo(() => evento?.categorias.find((c) => c.id === categoriaId) ?? null, [categoriaId, evento])

  const precioFinal = overridePrecio ? precioOverride : (categoria?.precio ?? 0)
  const totalACobrar = precioFinal * cantidad
  const stockDisponible = categoria?.stock_disponible ?? 0
  const stockSuficiente = stockDisponible >= cantidad
  const puedeRegistrar = !saving && stockSuficiente && !!categoria && cantidad >= 1

  // Vuelto: ayuda visual SOLO para efectivo. NO se persiste (el modelo Entrada no
  // tiene columnas monto_recibido/vuelto) y NO bloquea la venta — igual que en barra.
  const emailValido = EMAIL_REGEX.test(compradorEmail.trim())
  const esEfectivo = medioPago === "efectivo"
  const montoRecibidoNum = Number(montoRecibido)
  const montoRecibidoValido =
    montoRecibido.trim() !== "" && Number.isFinite(montoRecibidoNum) && montoRecibidoNum >= 0
  const vuelto = esEfectivo && montoRecibidoValido ? Math.max(0, montoRecibidoNum - totalACobrar) : null
  const faltante = esEfectivo && montoRecibidoValido ? Math.max(0, totalACobrar - montoRecibidoNum) : 0

  const reset = useCallback(() => {
    setResult(null)
    setErr(null)
    setCantidad(1)
    setCompradorNombre("")
    setCompradorDni("")
    setCompradorEmail("")
    setEnviarEmail(false)
    setOverridePrecio(false)
    setPrecioOverride(0)
    setMontoRecibido("")
  }, [])

  const copiar = useCallback((texto: string) => {
    void navigator.clipboard.writeText(texto)
    setCopiado(texto)
    window.setTimeout(() => setCopiado((c) => (c === texto ? null : c)), 1800)
  }, [])

  const submit = useCallback(async () => {
    setErr(null)
    if (!eventoId || !categoriaId) {
      setErr("Elegí evento y categoría")
      return
    }
    if (!Number.isFinite(cantidad) || cantidad < 1) {
      setErr("Cantidad inválida")
      return
    }
    if (!stockSuficiente) {
      setErr(`Stock insuficiente. Disponible: ${categoria?.stock_disponible ?? 0}`)
      return
    }
    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        evento_id: eventoId,
        categoria_id: categoriaId,
        cantidad,
        medio_pago: medioPago,
        comprador_nombre: compradorNombre.trim() || null,
        comprador_dni: compradorDni.trim() || null,
        comprador_email: compradorEmail.trim() || null,
        enviar_email: enviarEmail && emailValido,
      }
      if (fechaId) body.fecha_id = fechaId
      if (overridePrecio) body.precio_cobrado = precioOverride

      const res = await fetch(`/api/dashboard/pos/venta`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string }
        throw new Error(j.error ?? `HTTP ${res.status}`)
      }
      const json = (await res.json()) as { data: VentaResult }
      setResult(json.data)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error registrando venta")
    } finally {
      setSaving(false)
    }
  }, [cantidad, categoria, categoriaId, compradorDni, compradorEmail, compradorNombre, emailValido, enviarEmail, eventoId, fechaId, medioPago, overridePrecio, precioOverride, stockSuficiente])

  // ──────────────────────── Pantalla de resultado (post-venta) ────────────────────────
  if (result) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="rounded-2xl border border-primary/40 bg-primary/5 p-6 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-primary/15">
            <CheckCircle2 className="h-8 w-8 text-primary" aria-hidden />
          </div>
          <h2 className="mt-3 text-2xl font-bold text-foreground">Venta registrada</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {result.cantidad} {result.cantidad === 1 ? "entrada" : "entradas"} · {formatMoney(result.precio_total)} · {result.medio_pago.replace(/_/g, " ")}
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-card p-5">
          <div className="mb-4 flex items-center gap-3 border-b border-border pb-4">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
              <Ticket className="h-4 w-4 text-primary" aria-hidden />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-foreground">Entradas emitidas</h3>
              <p className="text-xs text-muted-foreground">Mostrale el QR al comprador o pasale el código corto.</p>
            </div>
          </div>
          <ul className="space-y-2">
            {result.entradas.map((e, idx) => (
              <li key={e.id} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Entrada {idx + 1}</div>
                  <div className="mt-0.5 font-mono text-base font-semibold tracking-wide text-foreground">{e.clave_corta}</div>
                </div>
                <button
                  type="button"
                  onClick={() => copiar(e.clave_corta)}
                  className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Copiar código ${e.clave_corta}`}
                >
                  {copiado === e.clave_corta ? <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
                  {copiado === e.clave_corta ? "Copiado" : "Copiar"}
                </button>
              </li>
            ))}
          </ul>
          {result.email_envio && result.email_envio.estado !== "no_solicitado" ? (
            result.email_envio.estado === "enviado" ? (
              <p className="mt-4 flex gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 text-xs text-foreground">
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                <span>Entrada enviada por email{result.email_envio.email ? <> a <strong>{result.email_envio.email}</strong></> : null}.</span>
              </p>
            ) : (
              <p className="mt-4 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-300">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>No se pudo enviar el email. La entrada quedó emitida igual — mostrale el QR o pasale el código corto.</span>
              </p>
            )
          ) : null}
          <p className="mt-4 flex gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-xs text-amber-900 dark:text-amber-300">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span><strong>Importante:</strong> el comprador entra escaneando el QR. Si no lo tiene a mano, imprimí esta pantalla o pasale el código corto.</span>
          </p>
        </div>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
          <button
            type="button"
            onClick={() => window.location.assign("/dashboard")}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Ir al dashboard
          </button>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity duration-150 hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Plus className="h-4 w-4" aria-hidden />
            Nueva venta
          </button>
        </div>
      </div>
    )
  }

  // Detalle del resumen (desktop rail + mobile inline). El TOTAL vive aparte,
  // en su propio bloque prominente — coherente con el POS de barra.
  const resumenLineas = (
    <dl className="space-y-2 text-sm">
      <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Evento</dt><dd className="truncate text-right font-medium">{evento?.nombre ?? "—"}</dd></div>
      <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Categoría</dt><dd className="text-right font-medium">{categoria?.nombre ?? "—"}</dd></div>
      <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Precio unitario</dt><dd className="text-right font-mono tabular-nums">{formatMoney(precioFinal)}</dd></div>
      <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Cantidad</dt><dd className="text-right font-mono tabular-nums">×{cantidad}</dd></div>
      <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Medio</dt><dd className="text-right font-medium">{MEDIOS_PAGO.find((m) => m.value === medioPago)?.label}</dd></div>
    </dl>
  )

  // TOTAL — el elemento más prominente de la pantalla (mismo patrón que barra).
  const totalBlock = (
    <div className="rounded-2xl border border-border bg-muted/30 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Total</span>
        <span className="text-3xl sm:text-4xl font-black text-foreground font-mono tabular-nums leading-none">{formatMoney(totalACobrar)}</span>
      </div>
      <p className="mt-1.5 text-right text-[11px] text-muted-foreground font-mono tabular-nums">
        {cantidad} {cantidad === 1 ? "entrada" : "entradas"} × {formatMoney(precioFinal)}
      </p>
    </div>
  )

  // ──────────────────────── Pantalla principal de venta ────────────────────────
  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Punto de venta</h1>
        <p className="text-sm text-muted-foreground">
          Cobrá entradas en mano y emití el QR al instante. Pensado para boletería, kiosko o vendedor en sala.
        </p>
      </header>

      {eventos.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border px-4 py-12 text-center">
          <ShoppingBag className="mx-auto mb-3 h-10 w-10 text-muted-foreground/50" aria-hidden />
          <p className="text-sm text-muted-foreground">No hay eventos activos para vender. Creá uno desde la sección Eventos primero.</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[1fr_380px] lg:gap-5">
          {/* ── Columna formulario ── */}
          <div className="space-y-4 pb-28 lg:pb-0">
            {/* 1. Entrada a vender */}
            <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
              <div className="mb-5 space-y-0.5">
                <h2 className="text-sm font-semibold text-foreground">1 · Entrada a vender</h2>
                <p className="text-xs text-muted-foreground">Elegí evento, fecha (si hay varias) y categoría. El stock se valida al confirmar.</p>
              </div>

              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label htmlFor="pos-evento" className="text-xs font-medium text-muted-foreground">Evento</label>
                    <div className="relative">
                      <select
                        id="pos-evento"
                        value={eventoId}
                        onChange={(e) => {
                          const ev = eventos.find((x) => x.id === e.target.value)
                          setEventoId(e.target.value)
                          setCategoriaId(ev?.categorias[0]?.id ?? "")
                          setFechaId("")
                        }}
                        className="h-11 w-full appearance-none rounded-lg border border-border bg-background pl-3 pr-9 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {eventos.map((e) => (
                          <option key={e.id} value={e.id}>{e.nombre}</option>
                        ))}
                      </select>
                      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                    </div>
                  </div>

                  {evento && evento.modo_fecha === "multiple" && evento.fechas.length > 0 && (
                    <div className="space-y-1.5">
                      <label htmlFor="pos-fecha" className="text-xs font-medium text-muted-foreground">Fecha</label>
                      <div className="relative">
                        <select
                          id="pos-fecha"
                          value={fechaId}
                          onChange={(e) => setFechaId(e.target.value)}
                          className="h-11 w-full appearance-none rounded-lg border border-border bg-background pl-3 pr-9 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <option value="">Todas / no especifica</option>
                          {evento.fechas.map((f) => (
                            <option key={f.id} value={f.id}>{formatDateTime(f.fecha)}</option>
                          ))}
                        </select>
                        <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-2">
                  <span className="text-xs font-medium text-muted-foreground">Categoría</span>
                  {/* Cards compactas — selección única (no carrito). Densas para que entren varias sin scroll. */}
                  <div role="radiogroup" aria-label="Categoría de entrada" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {evento?.categorias.map((c) => {
                      const agotada = c.stock_disponible <= 0
                      const selected = categoriaId === c.id
                      const stockBajo = c.stock_disponible > 0 && c.stock_disponible <= 10
                      return (
                        <button
                          key={c.id}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          onClick={() => setCategoriaId(c.id)}
                          disabled={agotada}
                          className={`flex items-center gap-3 rounded-xl border bg-card p-2.5 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            agotada
                              ? "cursor-not-allowed border-border opacity-50"
                              : selected
                                ? "border-primary ring-2 ring-primary/30"
                                : "border-border hover:border-primary/60 active:scale-[0.99]"
                          }`}
                        >
                          {/* Thumbnail compacto — fallback a ícono sobre muted */}
                          <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                            {c.imagen_url ? (
                              <Image
                                src={c.imagen_url}
                                alt=""
                                fill
                                loading="lazy"
                                sizes="56px"
                                className="object-cover"
                                unoptimized
                                aria-hidden
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <Ticket className="h-5 w-5 text-muted-foreground/40" aria-hidden />
                              </div>
                            )}
                          </div>
                          {/* Nombre + precio + stock */}
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-1 text-sm font-semibold leading-tight text-foreground">{c.nombre}</p>
                            <p className="mt-0.5 font-mono text-lg font-bold leading-none tabular-nums text-primary">{formatMoney(c.precio)}</p>
                            {agotada ? (
                              <span className="mt-1 inline-block text-[11px] font-semibold text-rose-600">Agotado</span>
                            ) : (
                              <div className="mt-1 inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <span className={`h-1.5 w-1.5 rounded-full ${stockBajo ? "bg-amber-500" : "bg-muted-foreground/40"}`} aria-hidden />
                                <span className="font-mono tabular-nums">{c.stock_disponible}</span> disp.
                              </div>
                            )}
                          </div>
                          {/* Check de seleccionada */}
                          {selected && (
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
                              <Check className="h-4 w-4" aria-hidden />
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {/* Cantidad */}
                  <div className="space-y-1.5">
                    <span className="text-xs font-medium text-muted-foreground">Cantidad</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCantidad((c) => Math.max(1, c - 1))}
                        disabled={cantidad <= 1}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-foreground transition-colors hover:bg-muted disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Restar uno"
                      >
                        <Minus className="h-4 w-4" aria-hidden />
                      </button>
                      <input
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={stockDisponible || 100}
                        value={cantidad}
                        onChange={(e) => setCantidad(Math.max(1, Number(e.target.value) || 1))}
                        aria-label="Cantidad de entradas"
                        className="h-11 w-full rounded-lg border border-border bg-background px-3 text-center text-base font-semibold tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                      <button
                        type="button"
                        onClick={() => setCantidad((c) => c + 1)}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-border text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        aria-label="Sumar uno"
                      >
                        <Plus className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                  </div>

                  {/* Precio */}
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-muted-foreground">Precio unitario</span>
                      <button
                        type="button"
                        onClick={() => setOverridePrecio((v) => !v)}
                        className="relative py-2 text-xs font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded after:absolute after:-inset-x-2 after:-inset-y-1 after:content-['']"
                      >
                        {overridePrecio ? "Usar precio de lista" : "Modificar"}
                      </button>
                    </div>
                    {overridePrecio ? (
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        step={100}
                        value={precioOverride}
                        onChange={(e) => setPrecioOverride(Number(e.target.value))}
                        aria-label="Precio personalizado"
                        className="h-11 w-full rounded-lg border border-primary/40 bg-background px-3 text-base font-semibold tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    ) : (
                      <div className="flex h-11 items-center rounded-lg border border-transparent bg-muted/40 px-3 text-base font-semibold tabular-nums text-foreground">
                        {formatMoney(categoria?.precio ?? 0)}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* 2. Cómo cobraste */}
            <section className="rounded-2xl border border-border bg-card p-5 sm:p-6">
              <div className="mb-5 space-y-0.5">
                <h2 className="text-sm font-semibold text-foreground">2 · Cómo cobraste</h2>
                <p className="text-xs text-muted-foreground">Marcá el medio que usaste. El cobro físico lo hacés vos antes de confirmar.</p>
              </div>
              <div role="radiogroup" aria-label="Medio de pago" className="grid gap-2 sm:grid-cols-3">
                {MEDIOS_PAGO.map((m) => {
                  const Icon = m.icon
                  const selected = medioPago === m.value
                  return (
                    <button
                      key={m.value}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setMedioPago(m.value)}
                      className={`flex items-center gap-3 rounded-xl border p-3.5 text-left transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 sm:flex-col sm:items-start sm:gap-2 ${
                        selected ? "border-primary bg-primary/5 ring-1 ring-primary/20" : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <Icon className={`h-5 w-5 shrink-0 ${selected ? "text-primary" : "text-muted-foreground"}`} aria-hidden />
                      <div>
                        <div className="text-sm font-medium text-foreground">{m.label}</div>
                        {"hint" in m && m.hint ? <div className="text-[11px] text-muted-foreground">{m.hint}</div> : null}
                      </div>
                    </button>
                  )
                })}
              </div>

              {/* Efectivo: monto recibido + vuelto — solo ayuda visual del cajero, no se persiste ni bloquea */}
              {esEfectivo && (
                <div className="mt-4 space-y-2">
                  <div className="space-y-1.5">
                    <label htmlFor="pos-monto-recibido" className="text-xs font-medium text-muted-foreground">
                      Monto recibido <span className="font-normal">— opcional</span>
                    </label>
                    <input
                      id="pos-monto-recibido"
                      type="number"
                      inputMode="decimal"
                      min={0}
                      step="any"
                      placeholder="¿Con cuánto paga?"
                      value={montoRecibido}
                      onChange={(e) => setMontoRecibido(e.target.value)}
                      className="h-12 w-full rounded-lg border border-border bg-background px-3 text-lg font-semibold tabular-nums text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>

                  {vuelto !== null && (
                    <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 text-center">
                      <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vuelto</div>
                      <div className="mt-1 font-mono text-5xl font-black leading-none tabular-nums text-primary">{formatMoney(vuelto)}</div>
                      {faltante > 0 && (
                        <p className="mt-2 text-xs text-amber-600">
                          Faltan {formatMoney(faltante)} para cubrir el total
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
                El sistema registra la venta y emite el QR. El dinero lo recibís vos en mano.
              </p>
            </section>

            {/* 3. Datos del comprador — opcional, colapsado para no robar el fold del cobro */}
            <details className="group rounded-2xl border border-border bg-card">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-5 sm:p-6 [&::-webkit-details-marker]:hidden">
                <div className="space-y-0.5">
                  <h2 className="text-sm font-semibold text-foreground">3 · Datos del comprador <span className="font-normal text-muted-foreground">— opcional</span></h2>
                  <p className="text-xs text-muted-foreground">Sin completar se vende como &quot;Cliente presencial&quot;. Con email podés reenviarle el QR.</p>
                </div>
                <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              <div className="grid gap-3 px-5 pb-5 sm:grid-cols-2 sm:px-6 sm:pb-6">
                <div className="space-y-1.5">
                  <label htmlFor="pos-nombre" className="text-xs font-medium text-muted-foreground">Nombre</label>
                  <input id="pos-nombre" type="text" placeholder="Nombre y apellido" value={compradorNombre} onChange={(e) => setCompradorNombre(e.target.value)} className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="pos-dni" className="text-xs font-medium text-muted-foreground">DNI</label>
                  <input id="pos-dni" type="text" inputMode="numeric" placeholder="Sin puntos" value={compradorDni} onChange={(e) => setCompradorDni(e.target.value)} className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <label htmlFor="pos-email" className="text-xs font-medium text-muted-foreground">Email</label>
                  <input id="pos-email" type="email" autoComplete="off" placeholder="comprador@email.com" value={compradorEmail} onChange={(e) => setCompradorEmail(e.target.value)} className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
                  {/* Envío por email — opt-in explícito, default off, habilitado solo con email válido */}
                  <label
                    htmlFor="pos-enviar-email"
                    className={`mt-1 flex items-center gap-2.5 rounded-lg border border-border bg-background/60 px-3 py-2.5 text-sm ${emailValido ? "cursor-pointer text-foreground" : "cursor-not-allowed text-muted-foreground opacity-60"}`}
                  >
                    <input
                      id="pos-enviar-email"
                      type="checkbox"
                      checked={enviarEmail && emailValido}
                      disabled={!emailValido}
                      onChange={(e) => setEnviarEmail(e.target.checked)}
                      className="h-4 w-4 shrink-0 rounded border-border accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed"
                    />
                    <span>
                      Enviar entrada por email
                      {!emailValido ? <span className="text-muted-foreground"> — cargá un email válido</span> : null}
                    </span>
                  </label>
                </div>
              </div>
            </details>

            {/* Resumen inline (solo mobile/tablet, el rail lo reemplaza en desktop) */}
            <section className="space-y-4 rounded-2xl border border-border bg-card p-5 lg:hidden">
              <h2 className="text-sm font-semibold text-foreground">Resumen</h2>
              {resumenLineas}
              {totalBlock}
            </section>
          </div>

          {/* ── Resumen lateral sticky (desktop) ── */}
          <aside className="hidden self-start lg:sticky lg:top-2 lg:block">
            <div className="space-y-4 rounded-2xl border border-border bg-card p-5">
              <div className="space-y-0.5">
                <h2 className="text-sm font-semibold text-foreground">Resumen</h2>
                <p className="text-xs text-muted-foreground">Revisá antes de confirmar.</p>
              </div>

              {resumenLineas}

              {totalBlock}

              {!stockSuficiente && categoria && (
                <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-400" role="alert">
                  Stock insuficiente · disponible {stockDisponible}
                </div>
              )}
              {err && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-400" role="alert" aria-live="assertive">{err}</div>}

              <button
                type="button"
                onClick={() => void submit()}
                disabled={!puedeRegistrar}
                className="inline-flex h-14 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-base font-semibold text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              >
                {saving ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Receipt className="h-5 w-5" aria-hidden />}
                Registrar venta · {formatMoney(totalACobrar)}
              </button>
              <p className="text-center text-[11px] text-muted-foreground">
                Si dos cajeros venden al mismo tiempo, solo uno se lleva el último cupo. Sin sobreventas.
              </p>
            </div>
          </aside>

          {/* ── Barra de acción sticky (mobile/tablet) ── */}
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] lg:hidden">
            <div className="pointer-events-auto mx-auto max-w-2xl rounded-2xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur-sm">
              {(err || (!stockSuficiente && categoria)) && (
                <div className="mb-2 rounded-lg border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-400" role="alert" aria-live="assertive">
                  {err ?? `Stock insuficiente · disponible ${stockDisponible}`}
                </div>
              )}
              <div className="flex items-center gap-3">
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Total {cantidad > 0 && <span className="font-mono tabular-nums">· {cantidad} u.</span>}
                  </div>
                  <div className="text-2xl font-black leading-none text-foreground font-mono tabular-nums">{formatMoney(totalACobrar)}</div>
                </div>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={!puedeRegistrar}
                  className="ml-auto inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-base font-semibold text-primary-foreground transition-opacity duration-150 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {saving ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Receipt className="h-5 w-5" aria-hidden />}
                  Registrar venta
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <p className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Send className="h-3 w-3" aria-hidden />
        Próxima versión: cobro automático con MP Point + envío de QR por WhatsApp.
      </p>
    </div>
  )
}
