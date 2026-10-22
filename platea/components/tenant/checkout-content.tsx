"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { getSalesReadinessMessage, type SalesReadinessReason, type SalesReadinessStatus } from "@/lib/tenant"
import { useTenant, useTenantSalesReadiness } from "./tenant-provider"
import { useCart } from "./cart-provider"
import { useTenantBuyerSession } from "./tenant-buyer-session-provider"
import { Trash2, Minus, Plus, ArrowLeft, Ticket, User, CreditCard, ChevronDown, ChevronUp, X, CheckCircle } from "lucide-react"
import { toast } from "sonner"
import { formatMoney } from "@/lib/format"
import Link from "next/link"
import { buildTenantApiPath } from "@/lib/tenant"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import TenantSalesReadinessBanner from "./sales-readiness-banner"
import { TenantCard, TenantPanel, TenantSurface } from "./tenant-surface"
import { TenantInput } from "./tenant-field"
import {
  createEmptyDatosEntrada,
  expandCartItems,
  isValidDni,
  removeExpandedEntryState,
  sanitizeDniInput,
  syncCheckoutEntryState,
  type CheckoutEntryData as DatosEntrada,
  type ExpandedEntry,
} from "./checkout-entry-state"

import { TENANT_NAVBAR_CLEARANCE } from "@/lib/tenant-navbar-clearance"
export default function CheckoutContent() {
  const tenant = useTenant()
  const salesReadiness = useTenantSalesReadiness()
  const { items, agregar, quitar, quitarUno, limpiar, total, totalBuyer, totalFeeBuyer } = useCart()
  const { buyerSession } = useTenantBuyerSession()
  const searchParams = useSearchParams()
  const refParam =
    searchParams.get("ref") ??
    (typeof window !== "undefined" ? sessionStorage.getItem("ticketera_ref") : null)
  const canSell = salesReadiness?.can_sell ?? true

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  // true cuando el 409 del checkout es por un asiento que otro comprador tomó
  // primero — habilita el CTA "Volver a elegir asientos" en vez de solo texto.
  const [seatConflict, setSeatConflict] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  const [codigoInput, setCodigoInput] = useState("")
  const [codigoLoading, setCodigoLoading] = useState(false)
  const [codigoError, setCodigoError] = useState("")
  const [descuentoAplicado, setDescuentoAplicado] = useState<{
    codigo: string
    codigo_id: number
    descuento_monto: number
    tipo: string
    valor: number
  } | null>(null)

  const entradasExpandidas = useMemo(() => expandCartItems(items), [items])
  const eventosCount = useMemo(() => new Set(items.map((item) => item.eventoId)).size, [items])
  // Evento al que volver cuando el 409 de asientos pega — tomamos el primer ítem
  // con asiento_id en el carrito (si hay varios eventos con asientos, priorizamos
  // el primero; caso poco común y el link igual navega sin recargar).
  const seatConflictEventoId = useMemo(
    () => items.find((item) => item.asiento_id)?.eventoId,
    [items]
  )

  // El footer sticky tiene altura variable (código de descuento aplicado, error,
  // fee, precio tachado, etc.) — medimos su alto real en vez de adivinar un
  // padding fijo, para que nunca tape contenido del carrito en mobile.
  const footerRef = useRef<HTMLDivElement>(null)
  const [footerHeight, setFooterHeight] = useState(0)

  useEffect(() => {
    const el = footerRef.current
    if (!el || typeof ResizeObserver === "undefined") return
    const update = () => setFooterHeight(el.getBoundingClientRect().height)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const [datos, setDatos] = useState<Record<string, DatosEntrada>>(
    Object.fromEntries(
      entradasExpandidas.map((entry) => [entry.key, createEmptyDatosEntrada()])
    )
  )

  useEffect(() => {
    setDatos((prev) => syncCheckoutEntryState(prev, entradasExpandidas, createEmptyDatosEntrada))
    setExpanded((prev) => {
      const next: Record<string, boolean> = {}
      entradasExpandidas.forEach((entry, idx) => {
        next[entry.key] = prev[entry.key] ?? idx === 0
      })
      return next
    })
  }, [entradasExpandidas])

  // Reserva server-side de asientos solo se dispara en el submit final ("Ir a
  // pagar") — mientras el comprador completa nombre/DNI acá (puede demorar
  // varios minutos), un asiento puede ser tomado por otro comprador sin que
  // haya ningún aviso. Reusamos el mismo mecanismo de polling que SeatPicker
  // (disponibilidad cada 30s) mientras haya ítems con asiento_id en el carrito,
  // y sacamos del carrito los que ya no estén disponibles.
  const itemsRef = useRef(items)
  itemsRef.current = items
  const hasSeatItemsInCart = useMemo(() => items.some((item) => item.asiento_id), [items])

  useEffect(() => {
    if (!hasSeatItemsInCart) return

    let cancelled = false

    async function checkSeatAvailability() {
      const eventoIds = Array.from(
        new Set(itemsRef.current.filter((item) => item.asiento_id).map((item) => item.eventoId))
      )
      for (const eventoId of eventoIds) {
        try {
          const res = await fetch(`/api/asientos/${eventoId}/disponibilidad`)
          if (!res.ok || cancelled) continue
          const data = await res.json()
          const secciones = Array.isArray(data?.secciones) ? data.secciones : []
          const takenIds = new Set<string>()
          for (const sec of secciones) {
            for (const a of sec.asientos ?? []) {
              if (a.estado !== "disponible") takenIds.add(a.id)
            }
          }
          const staleItems = itemsRef.current.filter(
            (item) => item.eventoId === eventoId && item.asiento_id && takenIds.has(item.asiento_id)
          )
          if (staleItems.length > 0 && !cancelled) {
            staleItems.forEach((item) => quitar(item.categoriaId, item.fechaId, item.asiento_id))
            toast.error(
              staleItems.length === 1
                ? "Uno de tus asientos ya no está disponible — lo quitamos del carrito."
                : `${staleItems.length} asientos ya no están disponibles — los quitamos del carrito.`
            )
          }
        } catch {
          // best-effort: si falla el chequeo, el submit final igual revalida server-side
        }
      }
    }

    const interval = setInterval(checkSeatAvailability, 30_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [hasSeatItemsInCart, quitar])

  function actualizarDato(key: string, campo: keyof DatosEntrada, valor: string) {
    setDatos((prev) => ({ ...prev, [key]: { ...prev[key], [campo]: valor } }))
  }

  function toggleExpanded(key: string) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  function handleRemoveExpandedEntry(entrada: ExpandedEntry) {
    setDatos((prev) => removeExpandedEntryState(prev, entrada, entrada.index))
    setExpanded((prev) => removeExpandedEntryState(prev, entrada, entrada.index))
    // Seated items carry asiento_id — pass it so the cart key resolves correctly
    quitarUno(entrada.categoriaId, entrada.fechaId, entrada.asiento_id)
  }

  async function aplicarCodigo() {
    if (!codigoInput.trim()) return
    setCodigoError("")
    setCodigoLoading(true)
    try {
      const res = await fetch(buildTenantApiPath(tenant.slug, "/validar-codigo"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codigo: codigoInput.trim().toUpperCase(),
          subtotal: total,
          tipo_compra: "entradas",
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setCodigoError(data.error ?? "Código no válido")
        return
      }
      setDescuentoAplicado({
        codigo: codigoInput.trim().toUpperCase(),
        codigo_id: data.codigo_id,
        descuento_monto: data.descuento_monto,
        tipo: data.tipo,
        valor: data.valor,
      })
      setCodigoInput("")
    } catch {
      setCodigoError("No se pudo validar el código")
    } finally {
      setCodigoLoading(false)
    }
  }

  function quitarDescuento() {
    setDescuentoAplicado(null)
    setCodigoError("")
  }

  function resolveCheckoutErrorMessage(payload: {
    code?: string
    status?: SalesReadinessStatus
    reason?: SalesReadinessReason | null
    error?: string
  }) {
    if (payload.code === "sales_not_ready" && payload.status) {
      return getSalesReadinessMessage(
        {
          status: payload.status,
          reason: payload.reason ?? null,
        },
        "public"
      )
    }

    return payload.error ?? "No se pudo iniciar el checkout"
  }

  async function handleComprar(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setSeatConflict(false)

    if (codigoLoading) {
      setError("Esperá que se valide el código de descuento")
      return
    }

    if (!buyerSession) {
      window.location.assign(buildTenantPath(tenant.slug, tenantRoutes.auth("checkout")))
      return
    }

    if (!canSell) {
      setError(getSalesReadinessMessage(salesReadiness, "public"))
      return
    }

    for (const entrada of entradasExpandidas) {
      const d = datos[entrada.key]
      if (!d.nombre || !d.apellido || !d.dni) {
        setError(`Completá todos los datos del Ticket #${entrada.index + 1}`)
        setExpanded((prev) => ({ ...prev, [entrada.key]: true }))
        return
      }

      if (!isValidDni(d.dni)) {
        setError(`El DNI del Ticket #${entrada.index + 1} debe tener entre 6 y 8 dígitos`)
        setExpanded((prev) => ({ ...prev, [entrada.key]: true }))
        return
      }
    }

    setLoading(true)

    const itemsConDatos = entradasExpandidas.map((e) => ({
      categoriaId: e.categoriaId,
      eventoId: e.eventoId,
      eventoNombre: e.eventoNombre,
      categoriaNombre: e.categoriaNombre,
      fechaId: e.fechaId ?? null,
      precio: e.precio,
      cantidad: 1,
      datos: datos[e.key],
    }))

    const addonsBody = items
      .filter((item) => item.kind === "addon" && item.addonId)
      .map((item) => ({
        id: item.addonId,
        nombre: item.categoriaNombre,
        precio: item.precio,
        cantidad: item.cantidad,
      }))

    try {
      const asientoIds = items
        .filter((item) => item.asiento_id)
        .map((item) => item.asiento_id as string)

      const checkoutBody: Record<string, unknown> = { items: itemsConDatos }
      if (addonsBody.length > 0) {
        checkoutBody.addons = addonsBody
      }
      if (descuentoAplicado) {
        checkoutBody.codigo_descuento = descuentoAplicado.codigo
      }
      if (asientoIds.length > 0) {
        checkoutBody.asiento_ids = asientoIds
      }

      const checkoutPath = refParam
        ? `${buildTenantApiPath(tenant.slug, "/checkout")}?ref=${encodeURIComponent(refParam)}`
        : buildTenantApiPath(tenant.slug, "/checkout")

      const res = await fetch(checkoutPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(checkoutBody),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(resolveCheckoutErrorMessage(data))
        setSeatConflict(data.code === "seats_unavailable")
        return
      }

      limpiar()
      window.location.assign(data.init_point)
    } catch {
      setError("No se pudo iniciar el checkout. Reintentá en unos segundos.")
    } finally {
      setLoading(false)
    }
  }

  if (items.length === 0) {
    const fromPayment = searchParams.get("fromPayment") === "1"
    return (
      <div
        className="min-h-screen flex items-center justify-center px-4"
        style={{ background: tenant.color_fondo }}
      >
        <div className="text-center">
          <Ticket className="h-16 w-16 mx-auto mb-4" style={{ color: `${tenant.color_texto}30` }} />
          {fromPayment ? (
            <>
              <h2 className="text-xl font-bold mb-2" style={{ color: tenant.color_texto }}>
                Tu compra está siendo procesada
              </h2>
              <p className="text-sm mb-6" style={{ color: `${tenant.color_texto}60` }}>
                Revisá tus tickets en unos minutos.
              </p>
              <Link
                href={buildTenantPath(tenant.slug, tenantRoutes.misTickets())}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white text-sm"
                style={{ background: tenant.color_primario }}
              >
                Ver mis tickets
              </Link>
            </>
          ) : (
            <>
              <h2 className="text-xl font-bold mb-2" style={{ color: tenant.color_texto }}>
                Tu carrito está vacío
              </h2>
              <p className="text-sm mb-6" style={{ color: `${tenant.color_texto}60` }}>
                Agregá entradas para continuar
              </p>
              <Link
                href={buildTenantPath(tenant.slug, tenantRoutes.home())}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-white text-sm"
                style={{ background: tenant.color_primario }}
              >
                <ArrowLeft className="h-4 w-4" /> Ver eventos
              </Link>
            </>
          )}
        </div>
      </div>
    )
  }

  // Contenido del resumen de pedido — se renderiza dos veces (sidebar sticky en
  // desktop, barra fija en mobile) sobre el mismo estado; extraído para no
  // duplicar la lógica de descuento/precio/submit entre ambos layouts.
  const orderSummaryContent = (
    <>
      {/* Código de descuento compact */}
      {descuentoAplicado ? (
        <div className="flex items-center justify-between gap-3 rounded-xl px-3 py-2" style={{ background: `${tenant.color_primario}20`, border: `1px solid ${tenant.color_primario}40` }}>
          <div className="flex items-center gap-2 min-w-0">
            <CheckCircle className="h-3.5 w-3.5 shrink-0" style={{ color: tenant.color_primario }} />
            <p className="text-xs font-semibold font-mono truncate" style={{ color: tenant.color_texto }}>{descuentoAplicado.codigo}</p>
            <p className="text-xs font-mono tabular-nums shrink-0" style={{ color: `${tenant.color_texto}70` }}>
              −{formatMoney(descuentoAplicado.descuento_monto)}
            </p>
          </div>
          <button type="button" onClick={quitarDescuento} className="opacity-60 hover:opacity-100 shrink-0 transition-opacity" style={{ color: tenant.color_texto }} aria-label="Quitar código">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex gap-2">
          <TenantInput
            tenant={tenant}
            className="h-11 px-3 flex-1 text-xs font-mono uppercase"
            placeholder="Código de descuento"
            value={codigoInput}
            onChange={(e) => { setCodigoInput(e.target.value.toUpperCase()); setCodigoError("") }}
            style={{
              background: `${tenant.color_texto}10`,
              borderColor: codigoError ? "hsl(var(--destructive))" : `${tenant.color_texto}20`,
              color: tenant.color_texto,
            }}
          />
          <button
            type="button"
            onClick={aplicarCodigo}
            disabled={codigoLoading || !codigoInput.trim()}
            className="h-11 px-4 rounded-xl text-xs font-semibold transition-opacity disabled:opacity-40 hover:opacity-90 shrink-0"
            style={{ background: `${tenant.color_texto}15`, color: tenant.color_texto }}
          >
            {codigoLoading ? "..." : "Aplicar"}
          </button>
        </div>
      )}
      {codigoError && <p className="text-xs text-destructive">{codigoError}</p>}

      {/* Resumen precio */}
      <TenantCard tenant={tenant} className="flex items-center justify-between text-sm rounded-2xl border px-4 py-3">
        <div style={{ color: `${tenant.color_texto}60` }}>
          <p>
            {entradasExpandidas.length} entrada{entradasExpandidas.length !== 1 ? "s" : ""}
            {eventosCount > 1 ? ` · ${eventosCount} eventos` : ""}
          </p>
          {totalFeeBuyer > 0 && (
            <p className="text-[11px] font-mono tabular-nums" style={{ color: `${tenant.color_texto}55` }}>
              Incluye {formatMoney(totalFeeBuyer)} cargo por serv.
            </p>
          )}
          {descuentoAplicado && (
            <p className="text-xs font-mono tabular-nums" style={{ color: tenant.color_primario }}>
              -{formatMoney(descuentoAplicado.descuento_monto)} descuento
            </p>
          )}
        </div>
        <div className="text-right">
          {descuentoAplicado && (
            <p className="text-sm line-through font-mono tabular-nums" style={{ color: `${tenant.color_texto}40` }}>
              {formatMoney(totalBuyer)}
            </p>
          )}
          <span className="text-xl font-black font-mono tabular-nums" style={{ color: tenant.color_texto }}>
            {formatMoney(descuentoAplicado ? Math.max(0, totalBuyer - descuentoAplicado.descuento_monto) : totalBuyer)}
          </span>
        </div>
      </TenantCard>

      <button
        type="submit"
        disabled={loading || !canSell}
        className="w-full h-14 rounded-2xl font-bold text-white text-base flex items-center justify-center gap-2 disabled:opacity-50 transition-opacity hover:opacity-90"
        style={{ background: tenant.color_primario }}
      >
        <CreditCard className="h-5 w-5" />
        {loading ? "Procesando..." : !canSell ? "Checkout pausado" : "Ir a pagar"}
      </button>
      {!canSell && (
        <p className="text-center text-xs" style={{ color: `${tenant.color_texto}60` }}>
          {getSalesReadinessMessage(salesReadiness, "public")}
        </p>
      )}
    </>
  )

  return (
    <TooltipProvider>
    <div
      className="min-h-screen pb-64 md:pb-48 lg:pb-12"
      style={{
        background: tenant.color_fondo,
        // Una vez medido el footer real, el padding exacto pisa el fallback fijo de arriba.
        // A lg+ el footer mobile pasa a display:none (lg:hidden), su alto medida cae a 0,
        // y esta condición deja de aplicar — el layout desktop no reserva espacio de más.
        ...(footerHeight > 0 ? { paddingBottom: footerHeight + 24 } : {}),
      }}
    >
      <div className="max-w-2xl lg:max-w-5xl mx-auto px-4" style={{ paddingTop: TENANT_NAVBAR_CLEARANCE }}>
        {/* Header */}
        <TenantPanel tenant={tenant} className="mb-6 rounded-3xl border p-4 md:p-5">
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <Tooltip>
              <TooltipTrigger asChild>
                <Link
                  href={buildTenantPath(tenant.slug, tenantRoutes.home())}
                  className="h-11 w-11 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: `${tenant.color_texto}15` }}
                  aria-label="Volver a eventos"
                >
                  <ArrowLeft className="h-4 w-4" style={{ color: tenant.color_texto }} />
                </Link>
              </TooltipTrigger>
              <TooltipContent>Volver a eventos</TooltipContent>
            </Tooltip>
            <div>
              <h1 className="text-2xl font-black" style={{ color: tenant.color_texto }}>
                Checkout
              </h1>
              <p className="text-sm" style={{ color: `${tenant.color_texto}55` }}>
                Completá tus datos para terminar la compra
              </p>
            </div>
          </div>
        </TenantPanel>

        <form onSubmit={handleComprar}>
        <div className="lg:grid lg:grid-cols-[1fr_360px] lg:items-start lg:gap-6">
        <div className="space-y-4 min-w-0">
          {!canSell ? <TenantSalesReadinessBanner /> : null}

          {/* Resumen carrito */}
          <TenantPanel tenant={tenant} className="rounded-3xl p-4 md:p-5 space-y-3 border shadow-sm" style={{ background: `${tenant.color_texto}08`, borderColor: `${tenant.color_texto}15` }}>
            <p
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: `${tenant.color_texto}50` }}
            >
              Tu carrito
            </p>
            {items.map((item) => {
              const isSeated = !!item.asiento_id
              const itemKey = isSeated
                ? `${item.categoriaId}-${item.asiento_id}`
                : `${item.categoriaId}-${item.fechaId ?? "sin-fecha"}`

              return (
                <TenantCard
                  tenant={tenant}
                  key={itemKey}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border px-3 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium" style={{ color: tenant.color_texto }}>
                      {isSeated
                        ? item.categoriaNombre
                        : `${item.cantidad}x ${item.categoriaNombre}`}
                    </p>
                    <p className="text-xs" style={{ color: `${tenant.color_texto}50` }}>
                      {item.eventoNombre}
                      {item.fechaNombre ? ` · ${item.fechaNombre}` : ""}
                    </p>
                    {isSeated && item.asiento_seccion && (
                      <p className="text-xs font-mono font-semibold mt-0.5" style={{ color: `${tenant.color_texto}60` }}>
                        {item.asiento_seccion} — Fila {item.asiento_fila} · N° {item.asiento_numero}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center justify-between sm:justify-end gap-3 w-full sm:w-auto">
                    <p className="text-sm font-bold font-mono tabular-nums" style={{ color: tenant.color_primario }}>
                      {formatMoney(item.precio * item.cantidad)}
                    </p>
                    <div className="flex items-center gap-2 shrink-0">
                      {/* Seated items: fixed quantity 1, no stepper */}
                      {!isSeated && (
                        <div
                          className="flex items-center rounded-xl overflow-hidden"
                          style={{ border: `1px solid ${tenant.color_texto}20` }}
                        >
                          <button
                            type="button"
                            onClick={() => quitarUno(item.categoriaId, item.fechaId)}
                            disabled={item.cantidad <= 1}
                            className="flex items-center justify-center w-11 h-11 transition-opacity disabled:opacity-30"
                            style={{ color: tenant.color_texto, background: `${tenant.color_texto}08` }}
                            aria-label="Quitar uno"
                          >
                            <Minus className="h-4 w-4" />
                          </button>
                          <span
                            className="w-8 text-center text-sm font-bold tabular-nums"
                            style={{ color: tenant.color_texto }}
                          >
                            {item.cantidad}
                          </span>
                          <button
                            type="button"
                            onClick={() => agregar({ ...item, cantidad: 1 })}
                            disabled={
                              item.stockDisponible !== undefined &&
                              item.cantidad >= item.stockDisponible
                            }
                            className="flex items-center justify-center w-11 h-11 transition-opacity disabled:opacity-30"
                            style={{ color: tenant.color_texto, background: `${tenant.color_texto}08` }}
                            aria-label="Agregar uno"
                          >
                            <Plus className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (isSeated) {
                            quitar(item.categoriaId, item.fechaId, item.asiento_id)
                          } else {
                            quitar(item.categoriaId, item.fechaId)
                          }
                        }}
                        className="p-2 -m-2 opacity-40 hover:opacity-100 transition-opacity"
                        style={{ color: tenant.color_texto }}
                        aria-label={`Eliminar ${item.categoriaNombre} del carrito`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </TenantCard>
              )
            })}
          </TenantPanel>

          {/* Datos comprador */}
          <TenantPanel tenant={tenant} className="rounded-3xl p-4 md:p-5 border shadow-sm" style={{ background: `${tenant.color_texto}08`, borderColor: `${tenant.color_texto}15` }}>
            <div className="flex items-center gap-2 mb-1">
              <User className="h-4 w-4" style={{ color: `${tenant.color_texto}50` }} />
              <p
                className="text-xs font-semibold uppercase tracking-widest"
                style={{ color: `${tenant.color_texto}50` }}
              >
                Comprando como
              </p>
            </div>
            <p className="text-sm font-medium" style={{ color: tenant.color_texto }}>
              {buyerSession?.name}
            </p>
            <p className="text-xs" style={{ color: `${tenant.color_texto}50` }}>
              {buyerSession?.email}
            </p>
          </TenantPanel>

          {/* Datos por ticket — acordeón */}
          <div className="space-y-3">
            <p
              className="text-xs font-semibold uppercase tracking-widest"
              style={{ color: `${tenant.color_texto}50` }}
            >
              Datos de cada entrada
            </p>

            {entradasExpandidas.map((entrada, idx) => {
              const isOpen = expanded[entrada.key] !== false // default abierto
              const d = datos[entrada.key]
              const completo = d.nombre && d.apellido && d.dni

              return (
                <TenantSurface
                  tenant={tenant}
                  key={entrada.key}
                  className="rounded-3xl border overflow-hidden shadow-sm"
                  style={{
                    borderColor: completo
                      ? tenant.color_primario + "60"
                      : `${tenant.color_texto}15`,
                    background: `${tenant.color_texto}05`,
                  }}
                >
                  {/* Header acordeón */}
                  <div className="flex items-center justify-between gap-3 px-4 py-3">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(entrada.key)}
                      className="flex min-w-0 flex-1 items-center justify-between gap-3 text-left"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div
                          className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                          style={{ background: completo ? `${tenant.color_primario}99` : tenant.color_primario }}
                      >
                        {completo ? "✓" : idx + 1}
                      </div>
                        <div className="text-left min-w-0">
                          <p className="text-sm font-bold" style={{ color: tenant.color_texto }}>
                            Ticket #{idx + 1}
                          </p>
                          <p className="text-xs" style={{ color: `${tenant.color_texto}50` }}>
                            {entrada.categoriaNombre} · {formatMoney(entrada.precio)}
                          </p>
                          {entrada.asiento_fila && (
                            <p className="text-xs font-mono font-semibold" style={{ color: `${tenant.color_texto}55` }}>
                              {entrada.asiento_seccion} — Fila {entrada.asiento_fila} · N° {entrada.asiento_numero}
                            </p>
                          )}
                        </div>
                      </div>
                      {isOpen ? (
                        <ChevronUp
                          className="h-4 w-4 shrink-0"
                          style={{ color: `${tenant.color_texto}50` }}
                        />
                      ) : (
                        <ChevronDown
                          className="h-4 w-4 shrink-0"
                          style={{ color: `${tenant.color_texto}50` }}
                        />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveExpandedEntry(entrada)}
                      className="rounded-full p-2 opacity-55 transition-opacity hover:opacity-100"
                      style={{ color: tenant.color_texto, background: `${tenant.color_texto}08` }}
                      aria-label={`Quitar Ticket #${idx + 1}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>

                  {/* Formulario */}
                  {isOpen && (
                    <div className="px-4 pb-4 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <TenantInput
                          tenant={tenant}
                          id={`checkout-nombre-${entrada.key}`}
                          name={`nombre-${entrada.key}`}
                          autoComplete="given-name"
                          className="h-11 px-3 !py-2.5 focus:ring-2"
                          placeholder="Nombre"
                          value={d.nombre}
                          onChange={(e) => actualizarDato(entrada.key, "nombre", e.target.value)}
                          style={{
                            background: `${tenant.color_texto}10`,
                            borderColor: `${tenant.color_texto}20`,
                            color: tenant.color_texto,
                          }}
                          required
                        />
                        <TenantInput
                          tenant={tenant}
                          id={`checkout-apellido-${entrada.key}`}
                          name={`apellido-${entrada.key}`}
                          autoComplete="family-name"
                          className="h-11 px-3 !py-2.5 focus:ring-2"
                          placeholder="Apellido"
                          value={d.apellido}
                          onChange={(e) => actualizarDato(entrada.key, "apellido", e.target.value)}
                          style={{
                            background: `${tenant.color_texto}10`,
                            borderColor: `${tenant.color_texto}20`,
                            color: tenant.color_texto,
                          }}
                          required
                        />
                      </div>
                      <TenantInput
                        tenant={tenant}
                        id={`checkout-dni-${entrada.key}`}
                        name={`dni-${entrada.key}`}
                        autoComplete="off"
                        className="h-11 px-3 !py-2.5 focus:ring-2"
                        placeholder="DNI"
                        value={d.dni}
                        onChange={(e) => actualizarDato(entrada.key, "dni", sanitizeDniInput(e.target.value))}
                        style={{
                          background: `${tenant.color_texto}10`,
                          borderColor: `${tenant.color_texto}20`,
                          color: tenant.color_texto,
                        }}
                        inputMode="numeric"
                        maxLength={8}
                        required
                      />
                    </div>
                  )}
                </TenantSurface>
              )
            })}
          </div>

          {error && (
            <div className="space-y-2 bg-destructive/10 px-4 py-3 rounded-xl">
              <p className="text-sm text-destructive">{error}</p>
              {seatConflict && (
                <Link
                  href={buildTenantPath(
                    tenant.slug,
                    seatConflictEventoId ? tenantRoutes.evento(seatConflictEventoId) : tenantRoutes.home()
                  )}
                  className="inline-flex items-center gap-1.5 text-xs font-semibold underline underline-offset-2"
                  style={{ color: tenant.color_primario }}
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Volver a elegir asientos
                </Link>
              )}
            </div>
          )}
        </div>

        {/* Sidebar de resumen — sticky en desktop, reemplaza a la barra fija de mobile */}
        <div className="hidden lg:block lg:sticky lg:top-24 space-y-3 rounded-3xl border p-4" style={{ background: `${tenant.color_texto}08`, borderColor: `${tenant.color_texto}15` }}>
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: `${tenant.color_texto}50` }}>
            Resumen del pedido
          </p>
          {orderSummaryContent}
        </div>
        </div>

        {/* Barra fija — solo mobile/tablet; en desktop el sidebar de arriba la reemplaza */}
        <div
          ref={footerRef}
          className="lg:hidden fixed bottom-0 left-0 right-0 px-4 pt-4"
          style={{
            background: `linear-gradient(to top, ${tenant.color_fondo} 70%, transparent)`,
            paddingBottom: `calc(1rem + env(safe-area-inset-bottom))`,
          }}
        >
          <div className="max-w-2xl mx-auto space-y-2">
            {orderSummaryContent}
          </div>
        </div>
        </form>
      </div>
    </div>
    </TooltipProvider>
  )
}
