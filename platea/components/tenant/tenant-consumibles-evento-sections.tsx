"use client"

import Link from "next/link"
import { ArrowLeft, Beer, MapPin, Search, X } from "lucide-react"
import type { TenantEmpresa } from "@/lib/tenant"
import { tenantRoutes } from "@/lib/tenant-routes"
import { ConsumibleCard } from "./consumible-card"
import TenantImage from "./tenant-image"
import { TenantCard, TenantSurface } from "./tenant-surface"

export type EventoData = {
  id: string
  nombre: string
  descripcion?: string | null
  lugar?: string | null
  imagen_url?: string | null
  venta_consumibles_habilitada: number
}

export type ConsumibleBar = {
  id: string
  nombre: string
  buyer_consumible_refunds_enabled?: boolean
  items: Array<{
    consumible_id: string
    nombre: string
    descripcion?: string | null
    imagen_url?: string | null
    precio: number
    stock_actual: number
    stock_ilimitado: boolean
    agotado: boolean
  }>
}

export function TenantConsumiblesEventoEmptyState({ tenant }: { tenant: TenantEmpresa }) {
  return (
    <TenantSurface tenant={tenant} className="rounded-[2rem] border p-8 text-center">
      <Beer className="h-14 w-14 mx-auto mb-4" style={{ color: `${tenant.color_texto}35` }} />
      <h1 className="text-2xl font-black mb-2">No hay consumibles disponibles ahora</h1>
      <p className="text-sm" style={{ color: `${tenant.color_texto}68` }}>Probá más tarde o revisá otro evento activo.</p>
    </TenantSurface>
  )
}

export function TenantConsumiblesEventoHero({
  tenant,
  evento,
}: {
  tenant: TenantEmpresa
  evento: EventoData
}) {
  return (
    <>
      <div className="px-1 pt-2 pb-2 md:pt-3 md:pb-3">
        <Link href={`/t/${tenant.slug}${tenantRoutes.consumibles()}`} className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: tenant.color_texto }}>
          <ArrowLeft className="h-4 w-4" /> Volver a consumibles
        </Link>
      </div>
      <TenantSurface tenant={tenant} className="rounded-[2rem] border overflow-hidden">
      <div className="relative h-56 md:h-72">
        {evento.imagen_url ? <TenantImage src={evento.imagen_url} alt={evento.nombre} className="h-full w-full object-cover" fill sizes="100vw" /> : <div className="h-full w-full" style={{ background: `linear-gradient(135deg, ${tenant.color_primario}55, ${tenant.color_fondo})` }} />}
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(0,0,0,.68), transparent)" }} />
        <div className="absolute left-5 right-5 bottom-5">
          <h1 className="text-3xl md:text-4xl font-black text-white leading-tight line-clamp-2">{evento.nombre}</h1>
          {evento.lugar ? <p className="text-sm mt-2 inline-flex items-center gap-2 text-white/80"><MapPin className="h-4 w-4" /> {evento.lugar}</p> : null}
        </div>
      </div>
      <div className="p-5 md:p-6 space-y-4">
        {evento.descripcion ? <p className="text-sm md:text-base leading-relaxed" style={{ color: `${tenant.color_texto}72` }}>{evento.descripcion}</p> : null}
      </div>
      </TenantSurface>
    </>
  )
}

export function TenantConsumiblesEventoFilters({
  tenant,
  busqueda,
  tipoFiltro,
  barraFiltro,
  barrasDisponibles,
  onBusquedaChange,
  onClearBusqueda,
  onTipoFiltroChange,
  onBarraFiltroChange,
}: {
  tenant: TenantEmpresa
  busqueda: string
  tipoFiltro: "todos" | "bebidas" | "comida"
  barraFiltro: string
  barrasDisponibles: Array<{ id: string; nombre: string }>
  onBusquedaChange: (value: string) => void
  onClearBusqueda: () => void
  onTipoFiltroChange: (value: "todos" | "bebidas" | "comida") => void
  onBarraFiltroChange: (value: string) => void
}) {
  return (
    <TenantSurface tenant={tenant} className="rounded-[2rem] border p-4 md:p-5">
      <div className="flex items-center gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: `${tenant.color_texto}12`, background: `${tenant.color_texto}04` }}>
        <Search className="h-4 w-4 shrink-0" style={{ color: `${tenant.color_texto}55` }} />
        <input value={busqueda} onChange={(event) => onBusquedaChange(event.target.value)} placeholder="Buscar por nombre del producto" className="w-full bg-transparent text-sm outline-none placeholder:opacity-60" style={{ color: tenant.color_texto }} />
        {busqueda ? (
          <button type="button" onClick={onClearBusqueda} className="h-7 w-7 rounded-full flex items-center justify-center shrink-0" style={{ background: `${tenant.color_texto}10`, color: tenant.color_texto }} aria-label="Limpiar búsqueda">
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>
      <p className="text-xs mt-3" style={{ color: `${tenant.color_texto}58` }}>Encontrá rápido cerveza, tragos, agua o comida por nombre o descripción.</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {[
          { key: "todos", label: "Todo" },
          { key: "bebidas", label: "Bebidas" },
          { key: "comida", label: "Comida" },
        ].map((chip) => {
          const active = tipoFiltro === chip.key
          return (
            <button key={chip.key} type="button" onClick={() => onTipoFiltroChange(chip.key as "todos" | "bebidas" | "comida")} className="px-3 py-2 rounded-full text-xs font-bold transition-all" style={{ background: active ? tenant.color_primario : `${tenant.color_texto}08`, color: active ? "#fff" : tenant.color_texto, border: `1px solid ${active ? tenant.color_primario : `${tenant.color_texto}12`}` }}>
              {chip.label}
            </button>
          )
        })}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => onBarraFiltroChange("todas")} className="px-3 py-2 rounded-full text-xs font-bold transition-all" style={{ background: barraFiltro === "todas" ? `${tenant.color_primario}18` : `${tenant.color_texto}06`, color: barraFiltro === "todas" ? tenant.color_primario : tenant.color_texto, border: `1px solid ${barraFiltro === "todas" ? `${tenant.color_primario}35` : `${tenant.color_texto}12`}` }}>
          Todas las barras
        </button>
        {barrasDisponibles.map((barra) => {
          const active = barraFiltro === barra.id
          return (
            <button key={barra.id} type="button" onClick={() => onBarraFiltroChange(barra.id)} className="px-3 py-2 rounded-full text-xs font-bold transition-all" style={{ background: active ? `${tenant.color_primario}18` : `${tenant.color_texto}06`, color: active ? tenant.color_primario : tenant.color_texto, border: `1px solid ${active ? `${tenant.color_primario}35` : `${tenant.color_texto}12`}` }}>
              {barra.nombre}
            </button>
          )
        })}
      </div>
    </TenantSurface>
  )
}

export function TenantConsumiblesEventoCartSummary({
  tenant,
  totalItems,
  onCheckout,
}: {
  tenant: TenantEmpresa
  totalItems: number
  onCheckout: () => void
}) {
  return (
    <TenantSurface tenant={tenant} className="rounded-[2rem] border p-4 md:p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.22em]" style={{ color: `${tenant.color_texto}55` }}>Carrito de consumibles</p>
          <h2 className="text-xl font-black">{totalItems > 0 ? `${totalItems} consumo${totalItems === 1 ? "" : "s"} listo${totalItems === 1 ? "" : "s"}` : "Todavía no sumaste productos"}</h2>
          <p className="text-sm" style={{ color: `${tenant.color_texto}68` }}>
            {totalItems > 0 ? "Revisá tu pedido y seguí al checkout exclusivo de consumibles." : "Cuando agregues productos, vas a poder revisar acá mismo tu pedido antes de pagar."}
          </p>
        </div>

        <button
          type="button"
          onClick={onCheckout}
          disabled={totalItems <= 0}
          className="min-h-11 rounded-2xl px-5 py-3 text-sm font-bold text-white transition-opacity disabled:cursor-not-allowed"
          style={{ background: tenant.color_primario, opacity: totalItems > 0 ? 1 : 0.45 }}
        >
          {totalItems > 0 ? "Ver carrito y checkout" : "Sumá productos para continuar"}
        </button>
      </div>
    </TenantSurface>
  )
}

export function TenantConsumiblesEventoCatalog({
  tenant,
  barrasFiltradas,
  totalItems,
  canSell,
  getCantidadEnCarrito,
  onAgregarConsumible,
  onQuitarConsumibleUno,
}: {
  tenant: TenantEmpresa
  barrasFiltradas: ConsumibleBar[]
  totalItems: number
  canSell: boolean
  getCantidadEnCarrito: (barraId: string, consumibleId: string) => number
  onAgregarConsumible: (barra: ConsumibleBar, item: ConsumibleBar["items"][number]) => void
  onQuitarConsumibleUno: (barraId: string, consumibleId: string) => void
}) {
  return (
    <div className="space-y-4">
      {barrasFiltradas.length === 0 ? (
        <TenantSurface tenant={tenant} className="rounded-[2rem] border p-8 text-center">
          <Search className="h-10 w-10 mx-auto mb-3" style={{ color: `${tenant.color_texto}35` }} />
          <h2 className="text-xl font-black mb-2">No encontramos productos con ese nombre</h2>
          <p className="text-sm" style={{ color: `${tenant.color_texto}68` }}>Probá con otro término o borrá la búsqueda para ver todo el catálogo.</p>
        </TenantSurface>
      ) : null}

      {barrasFiltradas.map((barra) => (
        <TenantSurface tenant={tenant} key={barra.id} className="rounded-[2rem] border p-5">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: `${tenant.color_texto}55` }}>Barra</p>
              <h2 className="text-2xl font-black">{barra.nombre}</h2>
              <p className="text-sm mt-1" style={{ color: `${tenant.color_texto}68` }}>{barra.items.length} producto{barra.items.length === 1 ? "" : "s"} disponible{barra.items.length === 1 ? "" : "s"}</p>
            </div>
            <TenantCard tenant={tenant} className="rounded-2xl border px-4 py-3 text-center" tone="subtle">
              <p className="text-[11px] uppercase tracking-wide" style={{ color: `${tenant.color_texto}55` }}>En carrito</p>
              <p className="text-xl font-black" style={{ color: tenant.color_primario }}>{totalItems}</p>
            </TenantCard>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {barra.items.map((item) => (
              <ConsumibleCard
                key={item.consumible_id}
                tenant={tenant}
                size="full"
                nombre={item.nombre}
                descripcion={item.descripcion}
                imagenUrl={item.imagen_url}
                precio={Number(item.precio)}
                stockActual={item.stock_actual}
                stockIlimitado={item.stock_ilimitado}
                agotado={item.agotado}
                cantidadEnCarrito={getCantidadEnCarrito(barra.id, item.consumible_id)}
                canSell={canSell}
                onIncrementar={() => onAgregarConsumible(barra, item)}
                onDecrementar={() => onQuitarConsumibleUno(barra.id, item.consumible_id)}
              />
            ))}
          </div>
        </TenantSurface>
      ))}
    </div>
  )
}

