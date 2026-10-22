"use client"

import Link from "next/link"
import { useTenantBuyerSession } from "./tenant-buyer-session-provider"
import { ArrowRight, Beer, CalendarDays, MapPin } from "lucide-react"
import { useTenant } from "./tenant-provider"
import { useConsumiblesCart } from "./consumibles-cart-provider"
import TenantImage from "./tenant-image"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"
import type { TenantConsumiblesEventoResumen } from "@/lib/tenant"

import { TENANT_NAVBAR_CLEARANCE } from "@/lib/tenant-navbar-clearance"
import { formatDateShort } from "@/lib/format"
export default function TenantConsumiblesHub({ eventos }: { eventos: TenantConsumiblesEventoResumen[] }) {
  const tenant = useTenant()
  const { buyerSession } = useTenantBuyerSession()
  const { totalItems } = useConsumiblesCart()
  const checkoutHref = buyerSession?.userType === "comprador"
    ? buildTenantPath(tenant.slug, tenantRoutes.consumiblesCheckout())
    : buildTenantPath(tenant.slug, tenantRoutes.auth("consumibles/checkout"))

  return (
    <div className="min-h-screen pb-32" style={{ background: tenant.color_fondo, color: tenant.color_texto }}>
      <div className="max-w-5xl mx-auto px-4 space-y-6" style={{ paddingTop: TENANT_NAVBAR_CLEARANCE }}>
        <section className="rounded-[2rem] border p-5 md:p-7" style={{ borderColor: `${tenant.color_texto}14`, background: `linear-gradient(135deg, ${tenant.color_texto}08, ${tenant.color_primario}10)` }}>
          <div className="flex flex-col gap-4 md:flex-row md:items-start">
            <div className="h-10 w-10 md:h-14 md:w-14 rounded-2xl flex items-center justify-center shrink-0" style={{ background: `${tenant.color_primario}20`, color: tenant.color_primario }}>
              <Beer className="h-5 w-5 md:h-7 md:w-7" />
            </div>
            <div className="space-y-2">
              <p className="text-[11px] md:text-xs font-semibold uppercase tracking-[0.18em] md:tracking-[0.25em]" style={{ color: `${tenant.color_texto}55` }}>Consumibles del evento</p>
              <h1 className="text-2xl md:text-4xl font-black leading-tight">Comprá antes de llegar y retirás en la barra</h1>
              <p className="text-sm md:text-base max-w-2xl" style={{ color: `${tenant.color_texto}72` }}>
                Elegí un evento activo, revisá qué barras tienen consumibles disponibles y generá tu QR. La compra de consumibles es independiente de la entrada.
              </p>
            </div>
          </div>
        </section>

        {totalItems > 0 ? (
          <section className="rounded-[2rem] border p-4 md:p-5" style={{ borderColor: `${tenant.color_primario}35`, background: `${tenant.color_primario}10` }}>
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.22em]" style={{ color: `${tenant.color_texto}55` }}>Tu carrito de consumibles</p>
                <h2 className="text-xl font-black mt-1">Tenés {totalItems} consumo{totalItems === 1 ? "" : "s"} pendiente{totalItems === 1 ? "" : "s"}</h2>
                <p className="text-sm mt-1" style={{ color: `${tenant.color_texto}68` }}>Podés retomar el checkout cuando quieras sin volver a buscar el evento.</p>
              </div>

              <Link href={checkoutHref} className="min-h-11 rounded-2xl px-5 py-3 font-bold text-white inline-flex items-center justify-center" style={{ background: tenant.color_primario }}>
                Ir al carrito de consumibles
              </Link>
            </div>
          </section>
        ) : null}

        {eventos.length === 0 ? (
          <section className="rounded-[2rem] border p-8 text-center" style={{ borderColor: `${tenant.color_texto}14`, background: `${tenant.color_texto}05` }}>
            <Beer className="h-14 w-14 mx-auto mb-4" style={{ color: `${tenant.color_texto}35` }} />
            <h2 className="text-xl font-black mb-2">Todavía no hay consumibles publicados</h2>
            <p className="text-sm" style={{ color: `${tenant.color_texto}68` }}>
              Cuando el organizador habilite un evento activo con consumibles, te va a aparecer acá.
            </p>
          </section>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {eventos.map((evento) => (
              <Link
                key={evento.id}
                href={`/t/${tenant.slug}${tenantRoutes.consumiblesEvento(evento.id)}`}
                className="block rounded-[2rem] overflow-hidden border transition-transform duration-200 active:scale-[0.99]"
                style={{ borderColor: `${tenant.color_texto}14`, background: `${tenant.color_texto}05` }}
              >
                <article>
                  <div className="relative h-44" style={{ background: `linear-gradient(135deg, ${tenant.color_primario}40, ${tenant.color_fondo})` }}>
                    {evento.imagen_url ? <TenantImage src={evento.imagen_url} alt={evento.nombre} className="h-full w-full object-cover" fill sizes="(max-width: 768px) 100vw, 50vw" /> : null}
                    <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,.55), transparent)" }} />
                    <div className="absolute left-4 right-4 bottom-4 flex items-end justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="text-xl font-black text-white leading-tight line-clamp-2">{evento.nombre}</h2>
                      </div>
                      <div className="shrink-0 rounded-full px-3 py-1 text-xs font-bold" style={{ background: evento.consumibles_disponibles ? "rgba(34,197,94,.18)" : "rgba(245,158,11,.18)", color: evento.consumibles_disponibles ? "#bbf7d0" : "#fde68a" }}>
                        {evento.consumibles_disponibles ? "Disponible" : "Sin stock por ahora"}
                      </div>
                    </div>
                  </div>

                  <div className="p-5 space-y-4">
                    {evento.descripcion ? <p className="text-sm leading-relaxed" style={{ color: `${tenant.color_texto}74` }}>{evento.descripcion}</p> : null}

                    <div className="flex flex-wrap gap-3 text-xs" style={{ color: `${tenant.color_texto}60` }}>
                      {evento.proxima_fecha ? (
                        <div className="inline-flex items-center gap-1.5"><CalendarDays className="h-3.5 w-3.5" /> {formatDateShort(evento.proxima_fecha)}</div>
                      ) : null}
                      {evento.lugar ? (
                        <div className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" /> {evento.lugar}</div>
                      ) : null}
                    </div>

                    <div className="grid grid-cols-1 gap-3 text-center sm:grid-cols-3">
                      <div className="rounded-2xl border p-3" style={{ borderColor: `${tenant.color_texto}12`, background: `${tenant.color_texto}04` }}>
                        <p className="text-[11px] uppercase tracking-wide" style={{ color: `${tenant.color_texto}55` }}>Barras</p>
                        <p className="font-black">{evento.barras_activas}</p>
                      </div>
                      <div className="rounded-2xl border p-3" style={{ borderColor: `${tenant.color_texto}12`, background: `${tenant.color_texto}04` }}>
                        <p className="text-[11px] uppercase tracking-wide" style={{ color: `${tenant.color_texto}55` }}>Items</p>
                        <p className="font-black">{evento.items_disponibles}</p>
                      </div>
                      <div className="rounded-2xl border p-3" style={{ borderColor: `${tenant.color_texto}12`, background: `${tenant.color_texto}04` }}>
                        <p className="text-[11px] uppercase tracking-wide" style={{ color: `${tenant.color_texto}55` }}>Stock</p>
                        <p className="font-black">{evento.stock_total_consumibles}</p>
                      </div>
                    </div>

                    <div className="w-full rounded-2xl px-4 py-3 font-bold text-white inline-flex items-center justify-between" style={{ background: tenant.color_primario, opacity: evento.consumibles_disponibles ? 1 : 0.75 }}>
                      <span>{evento.consumibles_disponibles ? "Ver barras y comprar" : "Ver evento"}</span>
                      <ArrowRight className="h-4 w-4" />
                    </div>
                  </div>
                </article>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
