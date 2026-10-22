"use client"

import { useEffect, useRef, useState, type FormEvent } from "react"
import { ArrowLeft, Beer, ShoppingBasket, Trash2 } from "lucide-react"
import Link from "next/link"
import { formatMoney } from "@/lib/format"
import { useTenantBuyerSession } from "./tenant-buyer-session-provider"
import { useTenant, useTenantTheme } from "./tenant-provider"
import { useConsumiblesCart, type ConsumibleCartItem } from "./consumibles-cart-provider"
import { buildTenantApiPath } from "@/lib/tenant"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"
import { TenantCard, TenantPanel } from "./tenant-surface"

import { TENANT_NAVBAR_CLEARANCE } from "@/lib/tenant-navbar-clearance"
type CheckoutGroup = {
  barraNombre: string
  buyerConsumibleRefundsEnabled: boolean
  items: ConsumibleCartItem[]
  total: number
}

export default function ConsumiblesCheckoutContent() {
  const tenant = useTenant()
  const { mode } = useTenantTheme()
  const { buyerSession } = useTenantBuyerSession()
  const { items, quitar, limpiar, total, totalItems } = useConsumiblesCart()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")

  // El footer sticky tiene altura variable (breakdown por barra, error, etc.) —
  // medimos su alto real en vez de adivinar un padding fijo, para que nunca
  // tape el botón "Ir a pagar" en mobile (mismo patrón que checkout-content.tsx).
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

  const errorStyles = mode === "light"
    ? { borderColor: "rgba(239,68,68,.35)", background: "rgba(254,226,226,.98)", color: "#991b1b" }
    : { borderColor: "rgba(248,113,113,.35)", background: "rgba(127,29,29,.22)", color: "#fca5a5" }

  const grouped = items.reduce<Record<string, CheckoutGroup>>((acc, item) => {
    const current = acc[item.barraId] ?? {
      barraNombre: item.barraNombre,
      buyerConsumibleRefundsEnabled: item.buyerConsumibleRefundsEnabled !== false,
      items: [],
      total: 0,
    }
    current.items.push(item)
    current.total += item.precio * item.cantidad
    current.buyerConsumibleRefundsEnabled = current.buyerConsumibleRefundsEnabled && item.buyerConsumibleRefundsEnabled !== false
    acc[item.barraId] = current
    return acc
  }, {})

  async function handleComprar(e: FormEvent) {
    e.preventDefault()
    if (!buyerSession || buyerSession.userType !== "comprador") {
      window.location.assign(buildTenantPath(tenant.slug, tenantRoutes.auth("consumibles/checkout")))
      return
    }

    setLoading(true)
    setError("")

    try {
      const res = await fetch(buildTenantApiPath(tenant.slug, "/consumibles/checkout"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items }),
      })

      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ?? "No se pudo iniciar el checkout de consumibles")
        return
      }

      limpiar()
      window.location.assign(data.init_point)
    } catch {
      setError("No se pudo iniciar el checkout de consumibles. Reintentá en unos segundos.")
    } finally {
      setLoading(false)
    }
  }

  if (items.length === 0) {
    return (
      <div className="min-h-screen flex items-center justify-center px-4" style={{ background: tenant.color_fondo }}>
          <div className="text-center max-w-sm">
            <Beer className="h-16 w-16 mx-auto mb-4" style={{ color: `${tenant.color_texto}30` }} />
          <h1 className="text-2xl font-black mb-2" style={{ color: tenant.color_texto }}>Todavía no sumaste consumibles</h1>
          <p className="text-sm mb-6" style={{ color: `${tenant.color_texto}66` }}>
            Agregá consumos desde el evento para generar un QR por barra.
          </p>
          <Link href={buildTenantPath(tenant.slug, tenantRoutes.consumibles())} className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl font-bold text-white" style={{ background: tenant.color_primario }}>
            <ArrowLeft className="h-4 w-4" /> Explorar consumibles
          </Link>
        </div>
      </div>
    )
  }

  return (
    <form
      onSubmit={handleComprar}
      className="min-h-screen pb-32"
      style={{
        background: tenant.color_fondo,
        color: tenant.color_texto,
        // Una vez medido el footer real, el padding exacto pisa el fallback fijo de arriba.
        ...(footerHeight > 0 ? { paddingBottom: footerHeight + 24 } : {}),
      }}
    >
      <div className="max-w-3xl mx-auto px-4 space-y-5" style={{ paddingTop: TENANT_NAVBAR_CLEARANCE }}>
        <TenantPanel tenant={tenant} className="rounded-3xl border p-4 md:p-5">
          <div className="mb-3 flex flex-col gap-3 md:flex-row md:items-center">
            <Link href={buildTenantPath(tenant.slug, tenantRoutes.consumibles())} className="h-11 w-11 rounded-full flex items-center justify-center shrink-0" style={{ background: `${tenant.color_texto}15` }}>
              <ArrowLeft className="h-4 w-4" style={{ color: tenant.color_texto }} />
            </Link>
            <div>
              <h1 className="text-2xl font-black">Checkout de consumibles</h1>
              <p className="text-sm" style={{ color: `${tenant.color_texto}55` }}>Se genera un QR independiente por cada barra.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-center md:grid-cols-3">
            <TenantCard tenant={tenant} className="rounded-2xl border p-3 text-center">
              <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: `${tenant.color_texto}55` }}>Items</p>
              <p className="font-black text-sm" style={{ color: tenant.color_texto }}>{totalItems}</p>
            </TenantCard>
            <TenantCard tenant={tenant} className="rounded-2xl border p-3 text-center">
              <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: `${tenant.color_texto}55` }}>Barras</p>
              <p className="font-black text-sm" style={{ color: tenant.color_texto }}>{Object.keys(grouped).length}</p>
            </TenantCard>
            <TenantCard tenant={tenant} className="col-span-2 rounded-2xl border p-3 text-center md:col-span-1">
              <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: `${tenant.color_texto}55` }}>Total</p>
              <p className="font-black text-sm font-mono tabular-nums" style={{ color: tenant.color_primario }}>{formatMoney(total)}</p>
            </TenantCard>
          </div>
        </TenantPanel>

        <div className="space-y-4">
          {Object.entries(grouped).map(([barraId, group]) => (
            <TenantPanel tenant={tenant} key={barraId} className="rounded-3xl border p-5">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: `${tenant.color_texto}55` }}>Barra</p>
                  <h2 className="text-xl font-black">{group.barraNombre}</h2>
                </div>
                <TenantCard tenant={tenant} className="rounded-2xl px-4 py-3 border text-right">
                  <p className="text-[11px] uppercase tracking-widest" style={{ color: `${tenant.color_texto}55` }}>QR de esta barra</p>
                  <p className="font-black font-mono tabular-nums" style={{ color: tenant.color_primario }}>{formatMoney(group.total)}</p>
                </TenantCard>
              </div>

              <div className="space-y-3">
                {group.items.map((item) => (
                  <TenantCard tenant={tenant} key={`${item.barraId}-${item.consumibleId}`} className="flex items-center justify-between gap-3 rounded-2xl border px-4 py-3" tone="subtle">
                    <div>
                      <p className="font-semibold">{item.cantidad}x {item.nombre}</p>
                      <p className="text-xs font-mono tabular-nums" style={{ color: `${tenant.color_texto}60` }}>{formatMoney(item.precio)} por unidad</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="font-black font-mono tabular-nums" style={{ color: tenant.color_primario }}>{formatMoney(item.precio * item.cantidad)}</p>
                      <button type="button" onClick={() => quitar(item.barraId, item.consumibleId)} className="opacity-45 hover:opacity-100 transition-opacity">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </TenantCard>
                ))}
              </div>
            </TenantPanel>
          ))}
        </div>

        {error ? <div className="rounded-2xl border px-4 py-3 text-sm" style={{ borderColor: errorStyles.borderColor, background: errorStyles.background, color: errorStyles.color }}>{error}</div> : null}
      </div>

      <div ref={footerRef} className="fixed bottom-0 left-0 right-0 px-4 pt-4" style={{ background: `linear-gradient(to top, ${tenant.color_fondo} 62%, transparent)`, paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
        <button type="submit" disabled={loading} className="w-full max-w-3xl mx-auto min-h-14 rounded-2xl text-white font-bold flex items-center justify-center gap-2 px-5" style={{ background: tenant.color_primario, opacity: loading ? 0.7 : 1 }}>
          <ShoppingBasket className="h-4 w-4" />
          <span>{loading ? "Preparando pago..." : "Ir a pagar"}</span>
        </button>
      </div>
    </form>
  )
}
