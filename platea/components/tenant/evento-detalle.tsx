"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import dynamic from "next/dynamic"
import { ShoppingCart } from "lucide-react"
import { useTenant, useTenantSalesReadiness } from "./tenant-provider"
import { useCart } from "./cart-provider"
import { formatDate, formatDateShortTime, formatMoney } from "@/lib/format"
import { toast } from "sonner"
import {
  EventoDetalleAddonsSection,
  EventoDetalleConsumiblesSection,
  EventoDetalleDateSelector,
  EventoDetalleHero,
  EventoDetalleStats,
  EventoDetalleTicketsSection,
  type TenantConsumibleBar,
  type TenantEventoAddon,
  type TenantEventoCategoria,
  type TenantEventoDetalle,
  type TenantEventoFecha,
} from "./evento-detalle-sections"
import type { SelectedAsiento } from "./seat-picker"

const SeatPicker = dynamic(() => import("./seat-picker"), { ssr: false })

export default function EventoDetalle({
  evento,
  categorias,
  fechas,
  consumiblesBarras,
  addons = [],
  tenantSlug,
}: {
  evento: TenantEventoDetalle
  categorias: TenantEventoCategoria[]
  fechas: TenantEventoFecha[]
  consumiblesBarras: TenantConsumibleBar[]
  addons?: TenantEventoAddon[]
  tenantSlug: string
}) {
  const tenant = useTenant()
  const salesReadiness = useTenantSalesReadiness()
  const { agregar } = useCart()
  // is_checkout_open en false = evento listado/con detalle visible pero todavía no
  // llegó su publish_at_utc (ver event-publication.ts) -- antes esta página ignoraba
  // por completo ese estado y dejaba agregar al carrito igual.
  const checkoutOpen = evento.is_checkout_open ?? true
  const canSell = (salesReadiness?.can_sell ?? true) && checkoutOpen
  const publicationCopy =
    !checkoutOpen && evento.publication?.publish_at_utc
      ? `Las entradas se ponen a la venta el ${formatDateShortTime(evento.publication.publish_at_utc)}.`
      : !checkoutOpen
        ? "Las entradas todavía no están a la venta."
        : null
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [seleccion, setSeleccion] = useState<Record<string, number>>({})
  const [seleccionAddons, setSeleccionAddons] = useState<Record<string, number>>({})
  const [fechaId, setFechaId] = useState(fechas[0]?.id ?? "")
  const [agregado, setAgregado] = useState<string | null>(null)
  const [addonAgregado, setAddonAgregado] = useState<string | null>(null)
  const [selectedAsientos, setSelectedAsientos] = useState<SelectedAsiento[]>([])
  const [asientosAgregadosOk, setAsientosAgregadosOk] = useState(false)
  // Seat picker disabled system-wide — always fall back to the "libre" (category) flow
  const isNumerado = false
  const heroImagen = evento.tanda_activa?.imagen_url || evento.imagen_url
  const ventaConsumiblesActiva = Number(evento.venta_consumibles_habilitada) === 1
  const precioMinimo = useMemo(() => {
    // El backend ahora devuelve también categorías agotadas (para poder mostrarlas
    // tachadas en vez de ocultarlas) — el "Desde $X" solo debe reflejar precios
    // realmente comprables, nunca el de una categoría sin stock.
    return categorias.reduce((acc, cat) => {
      if (cat.stock_disponible <= 0) return acc
      const precio = Number(cat.precio)
      if (!precio) return acc
      return acc === 0 ? precio : Math.min(acc, precio)
    }, 0)
  }, [categorias])
  const totalSeleccionado = useMemo(() => Object.values(seleccion).reduce((acc, val) => acc + val, 0), [seleccion])
  const totalEstimadoPrecio = useMemo(() =>
    Object.entries(seleccion).reduce((acc, [catId, cantidad]) => {
      const cat = categorias.find((c) => c.id === catId)
      if (!cat) return acc
      return acc + cantidad * Number(cat.precio_buyer ?? cat.precio)
    }, 0),
    [seleccion, categorias]
  )
  const fechaSeleccionada = useMemo(() => fechas.find((fecha) => fecha.id === fechaId), [fechaId, fechas])
  const fechaSeleccionadaLabel = useMemo(
    () =>
      fechaSeleccionada ? formatDate(fechaSeleccionada.fecha) : undefined,
    [fechaSeleccionada]
  )
  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    }
  }, [])

  const cambiarCantidad = useCallback((catId: string, delta: number, max: number) => {
    setSeleccion((prev) => {
      const actual = prev[catId] ?? 0
      if (delta > 0 && actual >= max) {
        toast.error(`Solo quedan ${max} disponible${max === 1 ? "" : "s"}`)
        return prev
      }
      const nueva = Math.max(0, Math.min(max, actual + delta))
      if (nueva === 0) {
        const next = { ...prev }
        delete next[catId]
        return next
      }
      return { ...prev, [catId]: nueva }
    })
  }, [])

  const cambiarCantidadAddon = useCallback((addonId: string, delta: number, max: number) => {
    setSeleccionAddons((prev) => {
      const actual = prev[addonId] ?? 0
      if (delta > 0 && actual >= max) {
        toast.error(`No podés sumar más de ${max} de este adicional`)
        return prev
      }
      const nueva = Math.max(0, Math.min(max, actual + delta))
      if (nueva === 0) {
        const next = { ...prev }
        delete next[addonId]
        return next
      }
      return { ...prev, [addonId]: nueva }
    })
  }, [])

  const handleAgregarAddon = useCallback((addon: TenantEventoAddon) => {
    if (!canSell) return
    const cantidad = seleccionAddons[addon.id] ?? 1
    const maxPorCompra = Math.min(addon.max_por_compra ?? 4, addon.stock_disponible)
    if (cantidad > maxPorCompra) {
      toast.error(`Máximo ${maxPorCompra} por compra para ${addon.nombre}`)
      return
    }
    agregar({
      categoriaId: `addon:${addon.id}`,
      addonId: addon.id,
      kind: "addon",
      eventoId: evento.id,
      eventoNombre: evento.nombre,
      categoriaNombre: addon.nombre,
      precio: Number(addon.precio),
      cantidad,
      stockDisponible: maxPorCompra,
      precioBuyer: addon.precio_buyer !== undefined ? Number(addon.precio_buyer) : undefined,
      feeBuyer: addon.fee_buyer_amount !== undefined ? Number(addon.fee_buyer_amount) : undefined,
    })
    setAddonAgregado(addon.id)
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = setTimeout(() => setAddonAgregado(null), 2000)
  }, [agregar, canSell, evento.id, evento.nombre, seleccionAddons])

  const handleAgregar = useCallback((cat: TenantEventoCategoria) => {
    if (!canSell) return
    const cantidad = seleccion[cat.id] ?? 1
    if (cantidad > Number(cat.stock_disponible)) {
      toast.error(`Solo quedan ${cat.stock_disponible} disponible${Number(cat.stock_disponible) === 1 ? "" : "s"} de ${cat.nombre}`)
      return
    }
    agregar({
      categoriaId: cat.id,
      eventoId: evento.id,
      eventoNombre: evento.nombre,
      categoriaNombre: cat.nombre,
      precio: Number(cat.precio),
      cantidad,
      fechaId: fechaId || undefined,
      fechaNombre: fechaSeleccionadaLabel,
      stockDisponible: Number(cat.stock_disponible),
      precioBuyer: cat.precio_buyer !== undefined ? Number(cat.precio_buyer) : undefined,
      feeBuyer: cat.fee_buyer_amount !== undefined ? Number(cat.fee_buyer_amount) : undefined,
    })
    setAgregado(cat.id)
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = setTimeout(() => setAgregado(null), 2000)
  }, [agregar, canSell, evento.id, evento.nombre, fechaId, fechaSeleccionadaLabel, seleccion])

  const handleAgregarTodo = useCallback(() => {
    if (!canSell) return
    Object.entries(seleccion).forEach(([catId, cantidad]) => {
      if (cantidad <= 0) return
      const cat = categorias.find((c) => c.id === catId)
      if (!cat) return
      agregar({
        categoriaId: cat.id,
        eventoId: evento.id,
        eventoNombre: evento.nombre,
        categoriaNombre: cat.nombre,
        precio: Number(cat.precio),
        cantidad,
        fechaId: fechaId || undefined,
        fechaNombre: fechaSeleccionadaLabel,
        stockDisponible: Number(cat.stock_disponible),
        precioBuyer: cat.precio_buyer !== undefined ? Number(cat.precio_buyer) : undefined,
        feeBuyer: cat.fee_buyer_amount !== undefined ? Number(cat.fee_buyer_amount) : undefined,
      })
    })
    setSeleccion({})
  }, [agregar, canSell, categorias, evento.id, evento.nombre, fechaId, fechaSeleccionadaLabel, seleccion])

  const handleAgregarAsientos = useCallback(() => {
    if (!canSell || selectedAsientos.length === 0) return
    selectedAsientos.forEach((asiento) => {
      agregar({
        categoriaId: asiento.categoria_id ?? asiento.seccion_id,
        eventoId: evento.id,
        eventoNombre: evento.nombre,
        categoriaNombre: `Fila ${asiento.fila} — Asiento ${asiento.numero}`,
        precio: asiento.precio,
        cantidad: 1,
        stockDisponible: 1,
        asiento_id: asiento.asiento_id,
        asiento_fila: asiento.fila,
        asiento_numero: asiento.numero,
        asiento_seccion: asiento.seccion_nombre,
        precioBuyer: asiento.precioBuyer,
        feeBuyer: asiento.feeBuyer,
      })
    })
    setAsientosAgregadosOk(true)
    setSelectedAsientos([])
    if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current)
    feedbackTimerRef.current = setTimeout(() => setAsientosAgregadosOk(false), 2000)
  }, [agregar, canSell, evento.id, evento.nombre, selectedAsientos])

  return (
    <div className="min-h-screen pb-40 md:pb-32" style={{ background: tenant.color_fondo, color: tenant.color_texto }}>
      <EventoDetalleHero tenant={tenant} evento={evento} heroImagen={heroImagen} canSell={canSell} primeraFecha={fechas[0]} />

      <div className="max-w-4xl mx-auto px-4 mt-6 md:mt-8 relative z-10">
        {publicationCopy ? (
          <div
            className="mb-4 rounded-2xl border px-4 py-3 text-sm font-medium"
            style={{ borderColor: `${tenant.color_primario}40`, background: `${tenant.color_primario}14`, color: tenant.color_texto }}
          >
            {publicationCopy}
          </div>
        ) : null}
        <EventoDetalleStats tenant={tenant} precioMinimo={precioMinimo} primeraFecha={fechas[0]} lugar={evento.lugar} />

        {evento.modo_fecha === "multiple" ? <EventoDetalleDateSelector tenant={tenant} fechas={fechas} fechaId={fechaId} onSelectFecha={setFechaId} /> : null}

        {isNumerado ? (
          <div className="mt-6 space-y-4">
            <SeatPicker
              eventoId={evento.id}
              categorias={categorias.map((c) => ({
                id: c.id,
                nombre: c.nombre,
                precio: Number(c.precio),
                precio_buyer: c.precio_buyer !== undefined ? Number(c.precio_buyer) : undefined,
                fee_buyer_amount: c.fee_buyer_amount !== undefined ? Number(c.fee_buyer_amount) : undefined,
              }))}
              selectedAsientos={selectedAsientos}
              onSelectionChange={setSelectedAsientos}
              colorPrimario={tenant.color_primario}
              colorTexto={tenant.color_texto}
            />
            {canSell && (
              <button
                type="button"
                onClick={handleAgregarAsientos}
                disabled={selectedAsientos.length === 0}
                className="w-full h-12 rounded-2xl font-bold text-white text-sm disabled:opacity-40 transition-all flex items-center justify-between px-5 cursor-pointer"
                style={{
                  background: asientosAgregadosOk
                    ? `${tenant.color_primario}99`
                    : tenant.color_primario,
                }}
              >
                <span>
                  {asientosAgregadosOk
                    ? "Asientos agregados ✓"
                    : selectedAsientos.length > 0
                    ? `${selectedAsientos.length} asiento${selectedAsientos.length !== 1 ? "s" : ""} seleccionado${selectedAsientos.length !== 1 ? "s" : ""}`
                    : "Elegí tus asientos"}
                </span>
                {!asientosAgregadosOk && selectedAsientos.length > 0 && (
                  <span className="font-mono tabular-nums text-xs opacity-80">
                    Agregar al carrito →
                  </span>
                )}
              </button>
            )}
          </div>
        ) : (
          <EventoDetalleTicketsSection
            tenant={tenant}
            evento={evento}
            fechaId={fechaId}
            categorias={categorias}
            seleccion={seleccion}
            agregado={agregado}
            canSell={canSell}
            salesReadiness={salesReadiness}
            onChangeCantidad={cambiarCantidad}
            onAgregar={handleAgregar}
          />
        )}

        <EventoDetalleAddonsSection
          tenant={tenant}
          addons={addons}
          seleccion={seleccionAddons}
          agregado={addonAgregado}
          canSell={canSell}
          onChangeCantidad={cambiarCantidadAddon}
          onAgregar={handleAgregarAddon}
        />

        {ventaConsumiblesActiva ? (
          <EventoDetalleConsumiblesSection
            tenant={tenant}
            eventoId={evento.id}
            eventoNombre={evento.nombre}
            canSell={canSell}
            consumiblesBarras={consumiblesBarras}
          />
        ) : null}
      </div>

      {totalSeleccionado > 0 && canSell && !isNumerado && (
        <div className="fixed inset-x-0 z-40 px-4 pb-2 md:hidden" style={{ bottom: "calc(80px + env(safe-area-inset-bottom))" }}>
          <button
            type="button"
            onClick={handleAgregarTodo}
            className="w-full h-14 rounded-2xl flex items-center justify-between px-5 font-bold text-white shadow-xl cursor-pointer"
            style={{ background: tenant.color_primario }}
          >
            <div className="text-left">
              <p className="text-sm font-bold">Agregar al carrito</p>
              <p className="text-xs font-mono tabular-nums" style={{ opacity: 0.8 }}>
                {totalSeleccionado} entrada{totalSeleccionado !== 1 ? "s" : ""} · {formatMoney(totalEstimadoPrecio)}
              </p>
            </div>
            <ShoppingCart className="h-5 w-5 shrink-0" />
          </button>
        </div>
      )}
    </div>
  )
}
