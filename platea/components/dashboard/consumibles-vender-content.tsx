"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import Image from "next/image"
import dynamic from "next/dynamic"
// Import estático (no lazy) de la misma lib usada en el modal en pantalla, solo para el
// ticket impreso: imprimirTicket() necesita el markup SVG ya resuelto de forma síncrona
// vía renderToStaticMarkup, algo que el wrapper dynamic() (abajo) no puede garantizar.
// Sigue siendo 100% local — nada de red.
import QRCodeStatic from "react-qr-code"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
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
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  ShoppingCart, Plus, Minus, Trash2, Store, CheckCircle2, Banknote,
  CreditCard, Wallet, Receipt, Search, X, Printer, History,
} from "lucide-react"
import type { Permisos } from "@/lib/permisos"
import { useLoading } from "@/components/loading-provider"
import { consumiblesApi, type BarraDto, type BarraStockDto } from "@/lib/api"
import { formatMoney } from "@/lib/format"

// QR escaneable real (SVG, sin servicio externo). Mismo lib que mis-consumibles.
const QRCode = dynamic(() => import("react-qr-code"), { ssr: false })

// Tope razonable de cantidad por ítem para un POS — evita cantidades absurdas.
const MAX_CANTIDAD_ITEM = 999

// localStorage: recordar evento/barra del último turno para no re-seleccionar cada vez.
const LS_EVENTO = "ticketera_pos_cons_evento"
const LS_BARRA = "ticketera_pos_cons_barra"

// Medios de pago — naming alineado con el POS de entradas (medio_pago_presencial)
// para que el historial de ambos POS sea consistente. La etiqueta "Tarjeta" mapea a
// "tarjeta_manual". El efectivo recibido + vuelto SOLO aplican a efectivo.
const MEDIOS_PAGO = [
  { value: "efectivo", label: "Efectivo", icon: Banknote },
  { value: "tarjeta_manual", label: "Tarjeta", icon: CreditCard },
  { value: "transferencia", label: "Transferencia", icon: Wallet },
] as const

// Denominaciones de billetes AR — el cajero "recibe" plata tocando chips, como en mano.
const DENOMINACIONES = [1000, 2000, 5000, 10000] as const

type EventoSimple = { id: string; nombre: string }
type PromocionSimple = { id: string; nombre: string }

type Barra = Pick<BarraDto, "id" | "nombre">
type Producto = {
  id: string
  nombre: string
  categoria: string | null
  precio_base: number
  precio_override?: number | null
  stock_actual: number
  stock_ilimitado: boolean
  agotado: boolean
  imagen_url: string | null
}

interface ItemCarrito {
  productoId: string
  nombre: string
  precio: number
  cantidad: number
}

type EmailEnvioEstado = "enviado" | "fallido" | "omitido" | "no_solicitado"

interface ResultadoVenta {
  id: string
  clave_corta: string
  qr_code: string
  total: number
  medio_pago?: string | null
  monto_recibido?: number | null
  vuelto?: number | null
  email_envio?: { estado: EmailEnvioEstado; email: string | null }
}

// Venta registrada en este turno/sesión (cliente) — tally rápido sin pegarle al server.
interface VentaSesion extends ResultadoVenta {
  ts: number
  unidades: number
}

export default function ConsumiblesVenderContent({
  eventos = [],
  promociones = [],
}: {
  eventos: EventoSimple[]
  promociones: PromocionSimple[]
  permisos?: Permisos
  esEmpleado?: boolean
}) {
  const { withLoading } = useLoading()

  const [eventoId, setEventoId] = useState("")
  const [barras, setBarras] = useState<Barra[]>([])
  const [barraId, setBarraId] = useState("")
  const [productos, setProductos] = useState<Producto[]>([])
  const [busqueda, setBusqueda] = useState("")
  const [carrito, setCarrito] = useState<ItemCarrito[]>([])
  const [promocionId, setPromocionId] = useState("")
  const [medioPago, setMedioPago] = useState<string>("efectivo")
  const [montoRecibido, setMontoRecibido] = useState<string>("")
  const [resultado, setResultado] = useState<ResultadoVenta | null>(null)
  const [cobroAbierto, setCobroAbierto] = useState(false)
  const [ventasSesion, setVentasSesion] = useState<VentaSesion[]>([])
  const [turnoAbierto, setTurnoAbierto] = useState(false)
  // Entrega del comprobante por email — opt-in, default OFF.
  const [enviarEmail, setEnviarEmail] = useState(false)
  const [compradorEmail, setCompradorEmail] = useState("")

  // Barra pendiente de restaurar desde localStorage (se aplica cuando cargan las barras).
  const barraPendiente = useRef<string | null>(null)

  // Restaurar evento/barra del último turno al montar.
  useEffect(() => {
    try {
      const ev = localStorage.getItem(LS_EVENTO)
      const ba = localStorage.getItem(LS_BARRA)
      if (ev && eventos.some((e) => String(e.id) === ev)) {
        setEventoId(ev)
        if (ba) barraPendiente.current = ba
      }
    } catch {
      // localStorage no disponible — sin restaurar.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Al cambiar evento, cargar barras
  useEffect(() => {
    if (!eventoId) return
    consumiblesApi
      .getBarras(eventoId, { soloActivas: true })
      .then((data) => {
        const lista = data.map((barra) => ({ id: barra.id, nombre: barra.nombre }))
        setBarras(lista)
        // Restaurar barra del turno anterior si sigue activa.
        const pend = barraPendiente.current
        if (pend && lista.some((b) => b.id === pend)) {
          setBarraId(pend)
        }
        barraPendiente.current = null
      })
      .catch(() => setBarras([]))
  }, [eventoId])

  // Al cambiar barra, cargar stock + persistir selección
  useEffect(() => {
    if (!barraId) return
    try {
      if (eventoId) localStorage.setItem(LS_EVENTO, eventoId)
      localStorage.setItem(LS_BARRA, barraId)
    } catch {
      // noop
    }
    consumiblesApi
      .getBarraStock(barraId, { soloActivos: true })
      .then((data) => {
        const items: Producto[] = data.map((item: BarraStockDto) => ({
          id: item.consumible_id,
          nombre: item.nombre,
          categoria: item.categoria ?? null,
          precio_base: item.precio_base,
          precio_override: item.precio_override,
          stock_actual: item.stock_actual,
          stock_ilimitado: item.stock_ilimitado,
          agotado: item.agotado,
          imagen_url: item.imagen_url ?? null,
        }))
        setProductos(items.filter((p) => !p.agotado && (p.stock_ilimitado || p.stock_actual > 0)))
      })
      .catch(() => setProductos([]))
  }, [barraId, eventoId])

  function precioProducto(p: Producto): number {
    return p.precio_override != null ? p.precio_override : p.precio_base
  }

  const productosFiltrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return productos
    return productos.filter((p) => p.nombre.toLowerCase().includes(q))
  }, [productos, busqueda])

  // Agrupación por categoría: solo agrupa si hay al menos una categoría asignada.
  // "Sin categoría" siempre va al final; el resto, alfabético.
  const grupos = useMemo(() => {
    const map = new Map<string, Producto[]>()
    for (const p of productosFiltrados) {
      const key = p.categoria?.trim() || ""
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(p)
    }
    const conNombre = [...map.keys()].filter((k) => k !== "").sort((a, b) => a.localeCompare(b, "es"))
    const orden = [...conNombre, ...(map.has("") ? [""] : [])]
    return {
      hayCategorias: conNombre.length > 0,
      lista: orden.map((k) => ({ categoria: k, items: map.get(k)! })),
    }
  }, [productosFiltrados])

  function agregarAlCarrito(producto: Producto) {
    const precio = precioProducto(producto)
    setCarrito((prev) => {
      const existe = prev.find((i) => i.productoId === producto.id)
      if (existe) {
        if (existe.cantidad >= MAX_CANTIDAD_ITEM) {
          toast.error(`Máximo ${MAX_CANTIDAD_ITEM} unidades por ítem`)
          return prev
        }
        return prev.map((i) =>
          i.productoId === producto.id ? { ...i, cantidad: i.cantidad + 1 } : i
        )
      }
      return [...prev, { productoId: producto.id, nombre: producto.nombre, precio, cantidad: 1 }]
    })
  }

  function cambiarCantidad(productoId: string, delta: number) {
    setCarrito((prev) =>
      prev
        .map((i) =>
          i.productoId === productoId
            ? { ...i, cantidad: Math.min(MAX_CANTIDAD_ITEM, Math.trunc(i.cantidad + delta)) }
            : i
        )
        .filter((i) => i.cantidad > 0)
    )
  }

  function quitarDelCarrito(productoId: string) {
    setCarrito((prev) => prev.filter((i) => i.productoId !== productoId))
  }

  const totalCarrito = carrito.reduce((acc, i) => acc + i.precio * i.cantidad, 0)
  const totalUnidades = carrito.reduce((a, i) => a + i.cantidad, 0)

  // Vuelto: ayuda visual SOLO para efectivo. No bloquea la venta. El total final
  // siempre lo recalcula el servidor; acá usamos el estimado solo para mostrar.
  const montoRecibidoNum = Number(montoRecibido)
  const montoRecibidoValido =
    montoRecibido.trim() !== "" && Number.isFinite(montoRecibidoNum) && montoRecibidoNum >= 0
  const esEfectivo = medioPago === "efectivo"
  const vuelto = esEfectivo && montoRecibidoValido ? Math.max(0, montoRecibidoNum - totalCarrito) : null
  const faltante = esEfectivo && montoRecibidoValido ? Math.max(0, totalCarrito - montoRecibidoNum) : 0

  // Chips de efectivo: acumulan como recibir billetes en mano.
  function sumarEfectivo(monto: number) {
    setMontoRecibido((prev) => {
      const base = Number(prev)
      const next = (Number.isFinite(base) && prev.trim() !== "" ? base : 0) + monto
      return String(next)
    })
  }

  const totalTurno = ventasSesion.reduce((a, v) => a + (v.total ?? 0), 0)

  async function vender() {
    if (carrito.length === 0) return
    const cantidadesValidas = carrito.every(
      (i) => Number.isInteger(i.cantidad) && i.cantidad > 0 && i.cantidad <= MAX_CANTIDAD_ITEM
    )
    if (!cantidadesValidas) {
      toast.error("Revisá las cantidades del carrito")
      return
    }
    const unidadesVenta = totalUnidades
    await withLoading(async () => {
      // Wifi de boliche = inestable: fetch puede rechazar (sin red) o el proxy puede
      // devolver HTML en vez de JSON (502/504). Sin este try/catch la excepción salía
      // sin capturar y el cajero se quedaba sin feedback, sin saber si la venta pegó.
      try {
        const res = await fetch("/api/consumibles/vender", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            barra_id: barraId,
            evento_id: eventoId || null,
            promocion_id: promocionId || null,
            medio_pago: medioPago,
            monto_recibido: esEfectivo && montoRecibidoValido ? montoRecibidoNum : null,
            enviar_email: enviarEmail,
            comprador_email: enviarEmail ? compradorEmail : null,
            items: carrito.map((i) => ({ consumible_id: i.productoId, cantidad: i.cantidad })),
          }),
        })
        const data = (await res.json()) as ResultadoVenta & { error?: string }
        if (!res.ok) {
          toast.error(data.error ?? "Error al procesar la venta")
          return
        }
        setResultado(data)
        setVentasSesion((prev) => [{ ...data, ts: Date.now(), unidades: unidadesVenta }, ...prev])
        setCarrito([])
        setMontoRecibido("")
        setEnviarEmail(false)
        setCompradorEmail("")
        setCobroAbierto(false)
      } catch {
        toast.error("Error de conexión al procesar la venta — revisá el turno antes de reintentar")
      }
    })
  }

  function nuevaVenta() {
    setResultado(null)
    setCarrito([])
    setPromocionId("")
    setMedioPago("efectivo")
    setMontoRecibido("")
    setEnviarEmail(false)
    setCompradorEmail("")
    setCobroAbierto(false)
  }

  function imprimirTicket(v: ResultadoVenta) {
    const barraNombre = barras.find((b) => b.id === barraId)?.nombre ?? "Barra"
    // QR generado 100% local (misma lib que el modal en pantalla) — antes esto pegaba a
    // api.qrserver.com, un servicio externo por internet. Con wifi caído o saturado (típico
    // en un boliche), esa llamada fallaba y el ticket salía con una imagen rota, sin QR
    // escaneable. renderToStaticMarkup resuelve el SVG en el momento, sin red.
    const qrSvg = renderToStaticMarkup(<QRCodeStatic value={v.qr_code} size={240} />)
    const win = window.open("", "_blank", "width=380,height=560")
    if (!win) {
      toast.error("Habilitá las ventanas emergentes para imprimir")
      return
    }
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Comanda</title>
      <style>
        *{font-family:ui-sans-serif,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
        body{margin:0;padding:24px;text-align:center;color:#111}
        .barra{font-size:13px;color:#666;text-transform:uppercase;letter-spacing:.08em}
        .clave{font-size:34px;font-weight:800;letter-spacing:.18em;margin:8px 0 16px;font-variant-numeric:tabular-nums}
        svg{width:240px;height:240px}
        .total{font-size:22px;font-weight:800;margin-top:16px;font-variant-numeric:tabular-nums}
        .hint{font-size:12px;color:#888;margin-top:8px}
      </style></head><body>
      <div class="barra">${barraNombre.replace(/</g, "&lt;")}</div>
      <div class="clave">${String(v.clave_corta).replace(/</g, "&lt;")}</div>
      ${qrSvg}
      <div class="total">${formatMoney(v.total)}</div>
      <div class="hint">Mostrá este QR o la clave en la barra para retirar.</div>
      <script>window.onload=function(){setTimeout(function(){window.print()},250)}</script>
      </body></html>`)
    win.document.close()
  }

  function renderCard(p: Producto) {
    const precio = precioProducto(p)
    const enCarrito = carrito.find((i) => i.productoId === p.id)
    return (
      <div
        key={p.id}
        className={`group relative bg-card rounded-2xl border-2 overflow-hidden transition-all hover:shadow-md ${
          enCarrito ? "border-primary ring-2 ring-primary/30 shadow-sm" : "border-border hover:border-primary/60"
        }`}
      >
        <button
          onClick={() => agregarAlCarrito(p)}
          className="block w-full text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.97] transition-transform"
          aria-label={`Agregar ${p.nombre}`}
        >
          <div className="relative aspect-square w-full bg-muted">
            {p.imagen_url ? (
              <Image
                src={p.imagen_url}
                alt={p.nombre}
                fill
                loading="lazy"
                sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 200px"
                className="object-cover"
                unoptimized
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center bg-primary/10">
                <span className="text-4xl font-bold text-primary/60 select-none">
                  {p.nombre.trim().charAt(0).toUpperCase() || "?"}
                </span>
              </div>
            )}
            {enCarrito && (
              <span className="absolute top-2 right-2 flex h-9 min-w-9 items-center justify-center rounded-full bg-primary px-2 text-base font-bold text-primary-foreground tabular-nums shadow-md ring-2 ring-card">
                {enCarrito.cantidad}
              </span>
            )}
          </div>
          <div className="p-3">
            <p className="font-semibold text-foreground text-sm leading-tight line-clamp-2 min-h-[2.5rem]">{p.nombre}</p>
            <p className="text-primary font-bold text-xl mt-1 font-mono tabular-nums leading-none">{formatMoney(precio)}</p>
            {p.stock_ilimitado ? (
              <span className="inline-block mt-1.5 text-[11px] bg-primary/10 text-primary px-2 py-0.5 rounded-full font-medium">Ilimitado</span>
            ) : (
              <p className="text-[11px] text-muted-foreground mt-1.5">Stock: {p.stock_actual}</p>
            )}
          </div>
        </button>

        {/* Stepper en la propia card — ajustar cantidad sin ir al carrito (feel de caja) */}
        {enCarrito && (
          <div className="flex items-center justify-between gap-1 border-t border-primary/20 bg-primary/5 px-2 py-1.5">
            <button
              onClick={() => cambiarCantidad(p.id, -1)}
              className="h-11 w-11 rounded-lg bg-card flex items-center justify-center text-foreground transition-transform hover:bg-muted active:scale-90"
              aria-label="Quitar una unidad"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="text-sm font-bold text-foreground font-mono tabular-nums">{enCarrito.cantidad}</span>
            <button
              onClick={() => agregarAlCarrito(p)}
              disabled={enCarrito.cantidad >= MAX_CANTIDAD_ITEM}
              className="h-11 w-11 rounded-lg bg-card flex items-center justify-center text-foreground transition-transform hover:bg-muted active:scale-90 disabled:opacity-40 disabled:pointer-events-none"
              aria-label="Agregar una unidad"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    )
  }

  // ── Panel de cobro (reutilizado en rail desktop + bottom-sheet mobile) ──
  const panelCobro = (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <ShoppingCart className="h-5 w-5 text-foreground" />
        <h2 className="text-base font-semibold text-foreground">Carrito</h2>
        {totalUnidades > 0 && (
          <span className="ml-auto text-sm bg-primary text-primary-foreground rounded-full px-2.5 py-0.5 font-semibold tabular-nums">
            {totalUnidades}
          </span>
        )}
      </div>

      {carrito.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">Tocá un producto para agregarlo</p>
      ) : (
        <div className="space-y-2">
          {carrito.map((item) => (
            <div key={item.productoId} className="flex items-center gap-2 rounded-xl border border-border bg-background/60 p-2">
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-foreground truncate">{item.nombre}</p>
                <p className="text-xs text-muted-foreground font-mono tabular-nums">
                  {formatMoney(item.precio)} c/u · <span className="text-foreground font-semibold">{formatMoney(item.precio * item.cantidad)}</span>
                </p>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => cambiarCantidad(item.productoId, -1)}
                  className="h-11 w-11 rounded-lg bg-muted flex items-center justify-center transition-transform hover:bg-muted/70 active:scale-90"
                  aria-label="Quitar una unidad"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="text-base font-bold w-8 text-center text-foreground font-mono tabular-nums">{item.cantidad}</span>
                <button
                  onClick={() => cambiarCantidad(item.productoId, 1)}
                  disabled={item.cantidad >= MAX_CANTIDAD_ITEM}
                  className="h-11 w-11 rounded-lg bg-muted flex items-center justify-center transition-transform hover:bg-muted/70 active:scale-90 disabled:opacity-40 disabled:pointer-events-none"
                  aria-label="Agregar una unidad"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  onClick={() => quitarDelCarrito(item.productoId)}
                  className="h-9 w-9 rounded-lg text-destructive/70 flex items-center justify-center ml-0.5 transition-colors hover:text-destructive hover:bg-destructive/10 active:scale-90"
                  aria-label="Quitar del carrito"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {promociones.length > 0 && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <label className="text-xs font-medium text-muted-foreground">Promoción (opcional)</label>
          <Select value={promocionId || "_ninguna"} onValueChange={(v) => setPromocionId(v === "_ninguna" ? "" : v)}>
            <SelectTrigger className="h-10! w-full">
              <SelectValue placeholder="Sin promoción" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem className="py-2.5 px-2.5" value="_ninguna">Sin promoción</SelectItem>
              {promociones.map((p) => (
                <SelectItem className="py-2.5 px-2.5" key={p.id} value={String(p.id)}>{p.nombre}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* TOTAL — el elemento más prominente de la pantalla */}
      <div className="rounded-2xl border border-border bg-muted/30 p-4">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Total</span>
          <span className="text-3xl sm:text-4xl font-black text-foreground font-mono tabular-nums leading-none">{formatMoney(totalCarrito)}</span>
        </div>
        <p className="mt-1.5 text-right text-[11px] text-muted-foreground">El total final lo calcula el servidor</p>
      </div>

      {/* Cobro: medio de pago + (solo efectivo) chips de billetes + monto + vuelto */}
      <div className="space-y-3">
        <div className="space-y-1.5">
          <span className="text-xs font-medium text-muted-foreground">Medio de pago</span>
          <div role="radiogroup" aria-label="Medio de pago" className="grid grid-cols-3 gap-2">
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
                  className={`flex flex-col items-center justify-center gap-1.5 rounded-xl border p-3 text-center transition-colors active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                    selected ? "border-primary bg-primary/5 ring-1 ring-primary/30" : "border-border hover:border-primary hover:bg-muted/40"
                  }`}
                >
                  <Icon className={`h-5 w-5 ${selected ? "text-primary" : "text-muted-foreground"}`} aria-hidden />
                  <span className={`text-xs font-medium ${selected ? "text-primary" : "text-foreground"}`}>{m.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {esEfectivo && (
          <div className="space-y-2">
            {/* Chips de billetes AR — sumar como recibir plata en mano */}
            <div className="grid grid-cols-3 gap-2">
              {DENOMINACIONES.map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => sumarEfectivo(d)}
                  className="h-10 rounded-lg border border-border bg-background text-sm font-semibold text-foreground font-mono tabular-nums transition-colors hover:border-primary hover:bg-primary/5 active:scale-95"
                >
                  +{formatMoney(d)}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setMontoRecibido(String(totalCarrito))}
                disabled={totalCarrito <= 0}
                className="h-10 rounded-lg border border-primary/40 bg-primary/5 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 active:scale-95 disabled:opacity-40"
              >
                Justo
              </button>
              <button
                type="button"
                onClick={() => setMontoRecibido("")}
                disabled={montoRecibido === ""}
                className="h-10 rounded-lg border border-border text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-muted/40 active:scale-95 disabled:opacity-40"
              >
                Borrar
              </button>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="cons-monto-recibido" className="text-xs font-medium text-muted-foreground">
                Monto recibido <span className="font-normal">— opcional</span>
              </label>
              <input
                id="cons-monto-recibido"
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
                <div className="mt-1 text-5xl font-black text-primary font-mono tabular-nums leading-none">{formatMoney(vuelto)}</div>
                {faltante > 0 && (
                  <p className="mt-2 text-xs text-amber-600">
                    Faltan {formatMoney(faltante)} para cubrir el total
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Entrega del comprobante por email — opt-in, default OFF */}
      <div className="space-y-2 border-t border-border pt-3">
        <label className="flex items-center gap-2.5 cursor-pointer select-none">
          <input
            type="checkbox"
            className="h-4 w-4 accent-primary"
            checked={enviarEmail}
            onChange={(e) => setEnviarEmail(e.target.checked)}
          />
          <span className="text-sm font-medium text-foreground">Enviar comprobante por email</span>
        </label>
        {enviarEmail && (
          <input
            type="email"
            inputMode="email"
            placeholder="email@cliente.com"
            value={compradorEmail}
            onChange={(e) => setCompradorEmail(e.target.value)}
            className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        )}
      </div>

      <Button className="w-full h-14 text-base font-semibold" disabled={carrito.length === 0} onClick={vender}>
        <Receipt className="h-5 w-5" aria-hidden />
        Cobrar {formatMoney(totalCarrito)}
      </Button>
    </div>
  )

  // ── Paso 1: seleccionar evento y barra ──
  if (!barraId) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Punto de venta</h1>
          <p className="text-muted-foreground text-sm mt-1">Seleccioná evento y barra para comenzar</p>
        </div>

        <div className="max-w-sm space-y-4">
          <div className="bg-card rounded-2xl border border-border p-6 space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Evento</label>
              <Select value={eventoId || "_ninguno"} onValueChange={(v) => {
                const nextEventoId = v === "_ninguno" ? "" : v
                setEventoId(nextEventoId)
                setBarras([])
                setBarraId("")
                setProductos([])
                setCarrito([])
                setPromocionId("")
              }}>
                <SelectTrigger className="h-11! w-full">
                  <SelectValue placeholder="Seleccionar evento..." />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem className="py-2.5 px-2.5" value="_ninguno">Sin evento</SelectItem>
                  {eventos.map((ev) => (
                    <SelectItem className="py-2.5 px-2.5" key={ev.id} value={String(ev.id)}>{ev.nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {barras.length > 0 && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">Barra</label>
                <Select value={barraId} onValueChange={(value) => {
                  setBarraId(value)
                  setProductos([])
                  setCarrito([])
                  setPromocionId("")
                }}>
                  <SelectTrigger className="h-11! w-full">
                    <SelectValue placeholder="Seleccionar barra..." />
                  </SelectTrigger>
                  <SelectContent>
                    {barras.map((b) => (
                      <SelectItem className="py-2.5 px-2.5" key={b.id} value={b.id}>{b.nombre}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {eventoId && barras.length === 0 && (
              <p className="text-sm text-muted-foreground">No hay barras activas para este evento</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── Paso 2: POS ──
  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-foreground">Punto de venta</h1>
          <p className="text-muted-foreground text-sm mt-1 truncate">
            {barras.find((b) => b.id === barraId)?.nombre ?? "Barra"}
            {eventoId && eventos.find((e) => String(e.id) === eventoId) && (
              <> · {eventos.find((e) => String(e.id) === eventoId)?.nombre}</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {ventasSesion.length > 0 && (
            <Button variant="outline" size="sm" onClick={() => setTurnoAbierto(true)} className="gap-1.5">
              <History className="h-4 w-4" aria-hidden />
              <span className="tabular-nums">{ventasSesion.length}</span>
              <span className="hidden sm:inline font-mono tabular-nums">· {formatMoney(totalTurno)}</span>
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={() => { setBarraId(""); setProductos([]); setCarrito([]); setBusqueda("") }}>
            Cambiar barra
          </Button>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        {/* Productos — grilla táctil estilo caja registradora */}
        <div className="pb-28 lg:pb-0 space-y-3">
          {/* Buscador — sticky para que el cajero no pierda el foco al scrollear */}
          {productos.length > 0 && (
            <div className="sticky top-0 z-10 -mx-1 px-1 py-1 bg-background/80 backdrop-blur-sm">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" aria-hidden />
                <input
                  type="text"
                  inputMode="search"
                  placeholder="Buscar producto..."
                  value={busqueda}
                  onChange={(e) => setBusqueda(e.target.value)}
                  className="h-11 w-full rounded-xl border border-border bg-card pl-9 pr-9 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {busqueda && (
                  <button
                    onClick={() => setBusqueda("")}
                    aria-label="Limpiar búsqueda"
                    className="absolute right-2 top-1/2 -translate-y-1/2 h-7 w-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted active:scale-90"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            </div>
          )}

          {productos.length === 0 ? (
            <div className="bg-card rounded-2xl border border-border p-8 text-center">
              <Store className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
              <h3 className="font-semibold text-foreground mb-1">Sin stock disponible</h3>
              <p className="text-muted-foreground text-sm">No hay productos con stock en esta barra</p>
            </div>
          ) : productosFiltrados.length === 0 ? (
            <div className="bg-card rounded-2xl border border-border p-8 text-center">
              <Search className="h-9 w-9 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">Nada coincide con <span className="font-semibold text-foreground">“{busqueda}”</span></p>
            </div>
          ) : grupos.hayCategorias ? (
            <div className="space-y-5">
              {grupos.lista.map((g) => (
                <section key={g.categoria || "__sin__"} className="space-y-2">
                  <h3 className="px-0.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {g.categoria || "Sin categoría"}
                    <span className="ml-1.5 text-muted-foreground/60 tabular-nums">· {g.items.length}</span>
                  </h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {g.items.map(renderCard)}
                  </div>
                </section>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {productosFiltrados.map(renderCard)}
            </div>
          )}
        </div>

        {/* Panel de cobro — rail lateral sticky en desktop */}
        <aside className="hidden self-start lg:sticky lg:top-2 lg:block">
          <div className="bg-card rounded-2xl border border-border p-4">{panelCobro}</div>
        </aside>
      </div>

      {/* Barra fija inferior (mobile/tablet) — TOTAL + abrir cobro */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 px-4 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] lg:hidden">
        <div className="pointer-events-auto mx-auto max-w-2xl rounded-2xl border border-border bg-card/95 p-3 shadow-lg backdrop-blur-sm">
          <div className="flex items-center gap-3">
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Total {totalUnidades > 0 && <span className="tabular-nums">· {totalUnidades} u.</span>}
              </div>
              <div className="text-2xl font-black text-foreground font-mono tabular-nums leading-none">{formatMoney(totalCarrito)}</div>
            </div>
            <Button className="ml-auto h-12 flex-1 text-base font-semibold" disabled={carrito.length === 0} onClick={() => setCobroAbierto(true)}>
              <Receipt className="h-5 w-5" aria-hidden />
              Cobrar
            </Button>
          </div>
        </div>
      </div>

      {/* Bottom-sheet de cobro (mobile/tablet) */}
      <Dialog open={cobroAbierto} onOpenChange={setCobroAbierto}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto lg:hidden">
          <DialogHeader>
            <DialogTitle>Cobrar</DialogTitle>
            <DialogDescription className="sr-only">Resumen del pedido y opciones de pago para cerrar la venta.</DialogDescription>
          </DialogHeader>
          {panelCobro}
        </DialogContent>
      </Dialog>

      {/* Sheet de ventas del turno (sesión) */}
      <Dialog open={turnoAbierto} onOpenChange={setTurnoAbierto}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Ventas del turno</DialogTitle>
            <DialogDescription className="sr-only">Listado de ventas registradas durante esta sesión de trabajo.</DialogDescription>
          </DialogHeader>
          <div className="rounded-2xl border border-border bg-muted/30 p-4 flex items-baseline justify-between">
            <span className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">{ventasSesion.length} venta{ventasSesion.length === 1 ? "" : "s"}</span>
            <span className="text-2xl font-black text-foreground font-mono tabular-nums">{formatMoney(totalTurno)}</span>
          </div>
          <div className="space-y-2">
            {ventasSesion.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
                <div className="min-w-0">
                  <p className="font-mono font-semibold text-foreground tracking-wider">{v.clave_corta}</p>
                  <p className="text-xs text-muted-foreground tabular-nums">{v.unidades} u.</p>
                </div>
                <span className="font-mono font-bold text-foreground tabular-nums">{formatMoney(v.total)}</span>
              </div>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground text-center">Conteo local de esta sesión. El historial completo está en Consumibles → Ventas.</p>
        </DialogContent>
      </Dialog>

      {/* Modal resultado — comanda con QR escaneable */}
      <Dialog open={!!resultado} onOpenChange={(o) => !o && setResultado(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              Venta realizada
            </DialogTitle>
            <DialogDescription className="sr-only">Comprobante de la venta realizada con el código QR de canje.</DialogDescription>
          </DialogHeader>

          {resultado && (
            <div className="min-w-0 space-y-4">
              <div className="rounded-2xl border border-border bg-card p-5 text-center space-y-3">
                <div className="mx-auto w-fit rounded-xl bg-white p-3">
                  <QRCode value={resultado.qr_code} size={168} />
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Clave de canje</p>
                  <p className="text-3xl font-black text-foreground tracking-[0.18em] font-mono">{resultado.clave_corta}</p>
                </div>
                <p className="text-xs text-muted-foreground">Mostrá el QR o la clave en la barra para retirar.</p>
              </div>

              <div className="space-y-2">
                <div className="flex items-baseline justify-between gap-2 text-foreground">
                  <span className="font-semibold">Total cobrado</span>
                  <span className="text-xl font-bold font-mono tabular-nums">{formatMoney(resultado.total)}</span>
                </div>
                {resultado.medio_pago && (
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">Medio de pago</span>
                    <span className="font-medium text-foreground">
                      {MEDIOS_PAGO.find((m) => m.value === resultado.medio_pago)?.label ?? resultado.medio_pago.replace(/_/g, " ")}
                    </span>
                  </div>
                )}
                {resultado.vuelto != null && (
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm text-muted-foreground">Vuelto</span>
                    <span className="text-lg font-bold text-primary font-mono tabular-nums">{formatMoney(resultado.vuelto)}</span>
                  </div>
                )}
              </div>

              {resultado.email_envio && resultado.email_envio.estado !== "no_solicitado" && (
                <div className="text-sm text-center">
                  {resultado.email_envio.estado === "enviado" ? (
                    <p className="text-primary">
                      Comprobante enviado{resultado.email_envio.email ? <> a <strong>{resultado.email_envio.email}</strong></> : null}.
                    </p>
                  ) : resultado.email_envio.estado === "omitido" ? (
                    <p className="text-amber-600">No se envió el email: revisá la dirección.</p>
                  ) : (
                    <p className="text-amber-600">La venta se registró, pero no se pudo enviar el email.</p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" className="h-11" onClick={() => imprimirTicket(resultado)}>
                  <Printer className="h-4 w-4" aria-hidden />
                  Imprimir
                </Button>
                <Button className="h-11" onClick={nuevaVenta}>Nueva venta</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
