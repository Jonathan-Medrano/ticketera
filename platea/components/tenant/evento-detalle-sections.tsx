"use client"

import { useState } from "react"
import Link from "next/link"
import { Beer, CalendarDays, Check, MapPin, Minus, Plus, ShoppingCart, Sparkles, Ticket } from "lucide-react"
import { formatDateLong, formatDateShort, formatMoney } from "@/lib/format"
import { tenantOverlayColor } from "@/lib/color-contrast"
import { getSalesReadinessStatusLabel, type TenantEmpresa, type TenantSalesReadiness } from "@/lib/tenant"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { ConsumibleCard } from "./consumible-card"
import { useConsumiblesCart } from "./consumibles-cart-provider"
import TenantImage from "./tenant-image"
import TenantSalesReadinessBanner from "./sales-readiness-banner"

import { TenantCard, TenantPanel } from "./tenant-surface"
import WaitlistButton from "./waitlist-button"

/**
 * Cantidad editable a mano.
 *
 * Antes el número era un `<span>`: para comprar 10 entradas había que tocar "+"
 * diez veces. Ahora se puede tipear (`inputMode="numeric"` abre el teclado
 * numérico en mobile) y los botones quedan para ajustes de a uno.
 *
 * El valor se confirma al salir del campo o con Enter, no en cada tecla: si se
 * confirmara letra por letra, escribir "10" pasaría primero por 1 y el total
 * saltaría raro.
 *
 * Se comunica por DELTA porque es el contrato que ya tenían los handlers
 * (`cambiarCantidad` / `cambiarCantidadAddon`), que son los que aplican el
 * clamp real contra stock y avisan por toast.
 *
 * `normalizarCantidadTipeada` queda aparte y exportada para poder testearla:
 * es la parte que puede romper (basura, vacío, más que el stock).
 */
export function normalizarCantidadTipeada(raw: string, max: number): number {
  const digitos = String(raw ?? "").replace(/\D/g, "")
  if (!digitos) return 0
  return Math.min(Math.max(0, max), Number(digitos))
}

function CantidadInput({
  cantidad,
  max,
  disabled,
  textColor,
  onSet,
  label,
}: {
  cantidad: number
  max: number
  disabled?: boolean
  textColor: string
  onSet: (nueva: number) => void
  label: string
}) {
  const [draft, setDraft] = useState<string | null>(null)

  function confirmar(raw: string) {
    onSet(normalizarCantidadTipeada(raw, max))
    setDraft(null)
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      autoComplete="off"
      aria-label={label}
      disabled={disabled}
      value={draft ?? String(cantidad)}
      onChange={(e) => setDraft(e.target.value.replace(/\D/g, "").slice(0, 4))}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={(e) => confirmar(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          confirmar(e.currentTarget.value)
          e.currentTarget.blur()
        }
      }}
      className="h-11 w-12 rounded-lg border-0 bg-transparent text-center font-bold outline-none focus:ring-2 disabled:opacity-40"
      style={{ color: textColor, ["--tw-ring-color" as string]: `${textColor}40` }}
    />
  )
}

export type TenantEventoDetalle = {
  id: string
  nombre: string
  descripcion?: string | null
  lugar?: string | null
  imagen_url?: string | null
  modo_fecha: "unica" | "multiple" | "pase"
  venta_consumibles_habilitada: number
  tipo_mapa?: string | null
  // Estado de publicación programada (event-publication.ts) -- is_checkout_open en false
  // significa "listado, pero todavía no se puede comprar" (ej. pre_publish_visibility
  // detail_visible antes de publish_at_utc). Opcional para no romper callers viejos
  // que todavía no mandan estos campos.
  is_checkout_open?: boolean
  publication_status?: "hidden" | "listed" | "live"
  publication?: {
    publish_at_utc: string | null
    publish_timezone: string | null
  }
  tanda_activa?: {
    id: string
    nombre: string
    descripcion?: string | null
    imagen_url?: string | null
    activa_desde?: string | null
  } | null
}

export type TenantEventoCategoria = {
  id: string
  nombre: string
  descripcion?: string | null
  precio: number
  stock_disponible: number
  entradas_por_unidad?: number
  // Fee billing mode: si la empresa cobra el fee al comprador, precio_buyer = precio + fee_buyer_amount.
  // Si absorbed (default), precio_buyer === precio y fee_buyer_amount === 0.
  precio_buyer?: number
  fee_buyer_amount?: number
}

export type TenantEventoFecha = {
  id: string
  fecha: string
}

export type TenantEventoAddon = {
  id: string
  nombre: string
  descripcion?: string | null
  precio: number
  stock_disponible: number
  max_por_compra: number
  precio_buyer?: number
  fee_buyer_amount?: number
}

export type TenantConsumibleBar = {
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
    // El backend (getTenantConsumiblesCatalog) siempre los manda — quedaban afuera
    // del tipo aunque la API ya los devolvía (ver plan de rediseño de consumibles).
    stock_ilimitado: boolean
    agotado: boolean
  }>
}

// Delegan en lib/format.ts: los formateadores propios evitan el hydration
// mismatch que producia toLocaleDateString (ver cabecera de lib/format.ts).
const formatLongDate = (value: string) => formatDateLong(value)
const formatShortDate = (value: string) => formatDateShort(value)

export function EventoDetalleHero({
  tenant,
  evento,
  heroImagen,
  canSell,
  primeraFecha,
}: {
  tenant: TenantEmpresa
  evento: TenantEventoDetalle
  heroImagen?: string | null
  canSell: boolean
  primeraFecha?: TenantEventoFecha
}) {
  return (
    <>
      <div className="relative h-[400px] md:h-[500px] overflow-hidden">
        {heroImagen ? (
          <>
            {/* Los flyers de evento son casi siempre verticales (4:5, 3:4, 9:16). A todo el
                ancho, un object-cover los recorta a una banda del medio y se pierde lo que
                importa: el nombre del show, la fecha y los precios. Mostramos el flyer
                COMPLETO (object-contain) sobre una copia desenfocada de sí mismo, que es la
                que llena el ancho. */}
            <TenantImage
              src={heroImagen}
              alt=""
              className="w-full h-full object-cover scale-110 blur-2xl opacity-50"
              fill
              sizes="100vw"
            />
            <TenantImage src={heroImagen} alt={evento.nombre} className="w-full h-full object-contain" fill sizes="100vw" />
          </>
        ) : (
          <div className="w-full h-full" style={{ background: `linear-gradient(135deg, ${tenant.color_primario}55, ${tenant.color_fondo})` }} />
        )}
        {/* Overlay: fondo sube 28% para que el título sea legible sobre el color propio del sitio.
            El stop oscuro se tiñe con color_primario del tenant (mezclado mayormente con negro
            vía tenantOverlayColor para no sacrificar contraste) en vez de negro puro fijo. */}
        <div className="absolute inset-0" style={{ background: `linear-gradient(to top, ${tenant.color_fondo} 18%, ${tenantOverlayColor(tenant.color_primario, 0.62)} 45%, transparent)` }} />

        {/* Título superpuesto al hero — en la zona donde ya hay color_fondo */}
        <div className="absolute bottom-0 inset-x-0 px-4 pb-5">
          <div className="max-w-4xl mx-auto">
            {evento.tanda_activa && (
              <div className="inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold mb-2.5" style={{ background: `${tenant.color_primario}30`, color: tenant.color_primario }}>
                {evento.tanda_activa.nombre}
              </div>
            )}
            <h1 className="text-2xl md:text-4xl font-black leading-tight" style={{ color: tenant.color_texto }}>{evento.nombre}</h1>
          </div>
        </div>
      </div>

      <div className="mb-6 px-4 pt-4 md:mb-8 md:pt-5">
        <div className="max-w-4xl mx-auto">
          {evento.tanda_activa?.descripcion && <p className="text-sm leading-relaxed mb-3" style={{ color: tenant.color_primario }}>{evento.tanda_activa.descripcion}</p>}
          {!canSell ? <div className="mt-2"><TenantSalesReadinessBanner /></div> : null}
        </div>
      </div>
    </>
  )
}

/**
 * Franja de contexto del evento: cuándo, dónde y desde cuánto.
 *
 * Antes esto era un KPI-strip de tres números ("Desde / Opciones / Disponibles").
 * Los dos conteos se fueron por dos motivos:
 *
 * 1. DUPLICABAN lo que ya está a la vista. Cada card de categoría muestra su
 *    propio "N disponibles", "¡Últimos N!" y "Agotado" a un scroll de distancia.
 *    Contar las cards arriba no le agrega nada a quien va a comprar.
 * 2. "Disponibles" significaba DOS cosas distintas en la misma pantalla: acá
 *    eran TIPOS de entrada, en las cards son UNIDADES. Un número sin unidad al
 *    lado de otro número con unidad distinta confunde en vez de informar.
 *
 * Un dashboard cuenta; una página de venta ubica y convence. Queda "Desde $X"
 * porque es lo único de los tres que el comprador necesita ANTES de scrollear:
 * es el ancla de precio con la que decide si sigue leyendo.
 */
export function EventoDetalleStats({
  tenant,
  precioMinimo,
  primeraFecha,
  lugar,
}: {
  tenant: TenantEmpresa
  precioMinimo: number
  primeraFecha?: TenantEventoFecha
  lugar?: string | null
}) {
  const mostrarPrecio = precioMinimo > 0
  if (!primeraFecha && !lugar && !mostrarPrecio) return null

  return (
    // flex-wrap + basis en vez de grid-cols fijo: las cards se reparten el ancho
    // solas sean 1, 2 o 3. Con un grid de 3 columnas, un evento sin lugar dejaba
    // un hueco vacío al costado.
    <div className="mb-8 flex flex-wrap gap-3">
      {primeraFecha ? (
        <TenantCard tenant={tenant} className="min-w-0 flex-1 basis-[220px] rounded-2xl border px-4 py-3" tone="muted">
          <div className="flex items-center gap-2 text-sm" style={{ color: tenant.color_texto }}>
            <CalendarDays className="h-4 w-4 shrink-0" style={{ color: tenant.color_primario }} />
            <span className="truncate">{formatLongDate(primeraFecha.fecha)}</span>
          </div>
        </TenantCard>
      ) : null}
      {lugar ? (
        <TenantCard tenant={tenant} className="min-w-0 flex-1 basis-[220px] rounded-2xl border px-4 py-3" tone="muted">
          <div className="flex items-center gap-2 text-sm" style={{ color: tenant.color_texto }}>
            <MapPin className="h-4 w-4 shrink-0" style={{ color: tenant.color_primario }} />
            <span className="truncate flex-1 min-w-0">{lugar}</span>
            <a
              href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(lugar)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-xs font-semibold underline underline-offset-2"
              style={{ color: tenant.color_primario }}
            >
              Cómo llegar
            </a>
          </div>
        </TenantCard>
      ) : null}
      {mostrarPrecio ? (
        <TenantCard tenant={tenant} className="min-w-0 flex-1 basis-[220px] rounded-2xl border px-4 py-3" tone="muted">
          <div className="flex items-center gap-2 text-sm" style={{ color: tenant.color_texto }}>
            <Ticket className="h-4 w-4 shrink-0" style={{ color: tenant.color_primario }} />
            <span className="truncate">
              Entradas desde{" "}
              <span className="font-black font-mono tabular-nums" style={{ color: tenant.color_primario }}>
                {formatMoney(precioMinimo)}
              </span>
            </span>
          </div>
        </TenantCard>
      ) : null}
    </div>
  )
}

export function EventoDetalleDateSelector({
  tenant,
  fechas,
  fechaId,
  onSelectFecha,
}: {
  tenant: TenantEmpresa
  fechas: TenantEventoFecha[]
  fechaId: string
  onSelectFecha: (fechaId: string) => void
}) {
  if (fechas.length <= 1) return null

  return (
    <TenantPanel tenant={tenant} className="mb-8 rounded-3xl border p-4 md:p-5">
      <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: `${tenant.color_texto}55` }}>Elegí tu fecha</p>
      <div className="flex gap-2 flex-wrap">
        {fechas.map((fecha) => (
          <button
            key={fecha.id}
            onClick={() => onSelectFecha(fecha.id)}
            className="px-4 py-2 rounded-xl text-sm font-medium border transition-all cursor-pointer"
            style={{
              borderColor: fechaId === fecha.id ? tenant.color_primario : `${tenant.color_texto}20`,
              background: fechaId === fecha.id ? `${tenant.color_primario}33` : "transparent",
              color: fechaId === fecha.id ? tenant.color_primario : `${tenant.color_texto}75`,
            }}
          >
            {formatShortDate(fecha.fecha)}
          </button>
        ))}
      </div>
    </TenantPanel>
  )
}

export function EventoDetalleTicketsSection({
  tenant,
  evento,
  fechaId,
  categorias,
  seleccion,
  agregado,
  canSell,
  salesReadiness,
  onChangeCantidad,
  onAgregar,
}: {
  tenant: TenantEmpresa
  evento: { id: string }
  fechaId?: string | null
  categorias: TenantEventoCategoria[]
  seleccion: Record<string, number>
  agregado: string | null
  canSell: boolean
  salesReadiness: TenantSalesReadiness | null
  onChangeCantidad: (catId: string, delta: number, max: number) => void
  onAgregar: (cat: TenantEventoCategoria) => void
}) {
  // Competencia (Dice.fm, COMPETENCIA.md §7 patrón #2): lista escaneable de un vistazo
  // (nombre + precio bold por fila) en vez de un card grande por categoría siempre
  // expandido — solo la categoría con unidades elegidas (o tocada a mano) se expande
  // al stepper completo. Categorías agotadas quedan afuera de este manejo: ya se
  // muestran tachadas sin ocultarse (comportamiento previo, sin cambios acá).
  const [manuallyExpanded, setManuallyExpanded] = useState<Set<string>>(new Set())

  return (
    <TenantPanel tenant={tenant} className="rounded-3xl border p-4 md:p-5">
      <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: `${tenant.color_texto}55` }}>Entradas disponibles</p>
      <div className="space-y-3">
        {categorias.map((cat) => {
          const cantidad = seleccion[cat.id] ?? 0
          const isAgregado = agregado === cat.id
          // Competencia (Dice.fm): agotado se comunica tachado, no ocultando ni bajando
          // a un card aparte — la categoría sigue en el flujo normal, solo apagada.
          const isAgotado = cat.stock_disponible <= 0
          const isExpanded = isAgotado || cantidad > 0 || manuallyExpanded.has(cat.id)

          if (!isExpanded) {
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => setManuallyExpanded((prev) => new Set(prev).add(cat.id))}
                className="w-full flex items-center justify-between gap-3 rounded-2xl border p-4 text-left transition-colors cursor-pointer"
                style={{ borderColor: `${tenant.color_texto}1a` }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold line-clamp-1" style={{ color: tenant.color_texto }}>{cat.nombre}</p>
                    {Number(cat.entradas_por_unidad ?? 1) > 1 && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                        style={{ background: tenant.color_primario, color: "#fff" }}
                      >
                        🎟️ Pack ×{cat.entradas_por_unidad}
                      </span>
                    )}
                  </div>
                  {cat.stock_disponible <= 10 && <p className="text-xs text-amber-400 font-semibold mt-0.5">¡Últimos {cat.stock_disponible}!</p>}
                </div>
                <p className="font-black font-mono tabular-nums shrink-0" style={{ color: tenant.color_primario }}>
                  {formatMoney(cat.precio_buyer ?? cat.precio)}
                </p>
              </button>
            )
          }

          return (
            <TenantCard tenant={tenant} key={cat.id} className={`rounded-2xl p-4 border transition-opacity ${isAgotado ? "opacity-60" : ""}`}>
              <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className={`font-bold line-clamp-2 ${isAgotado ? "line-through" : ""}`} style={{ color: tenant.color_texto }}>{cat.nombre}</p>
                    {Number(cat.entradas_por_unidad ?? 1) > 1 && (
                      <span
                        className="inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                        style={{ background: tenant.color_primario, color: "#fff" }}
                      >
                        🎟️ Pack ×{cat.entradas_por_unidad}
                      </span>
                    )}
                  </div>
                  {cat.descripcion && <p className="text-xs mt-0.5" style={{ color: `${tenant.color_texto}7a` }}>{cat.descripcion}</p>}
                  {Number(cat.fee_buyer_amount ?? 0) > 0 ? (
                    <div className={`mt-1 ${isAgotado ? "line-through" : ""}`}>
                      <p className="text-lg font-black font-mono tabular-nums" style={{ color: tenant.color_primario }}>
                        {formatMoney(cat.precio_buyer ?? cat.precio)}
                      </p>
                      <p className="text-[11px] mt-0.5 font-mono tabular-nums" style={{ color: `${tenant.color_texto}80` }}>
                        {formatMoney(cat.precio)} + {formatMoney(cat.fee_buyer_amount)} cargo por servicio
                      </p>
                    </div>
                  ) : (
                    <p className={`text-lg font-black mt-1 font-mono tabular-nums ${isAgotado ? "line-through" : ""}`} style={{ color: tenant.color_primario }}>{formatMoney(cat.precio)}</p>
                  )}
                  {Number(cat.entradas_por_unidad ?? 1) > 1 && (
                    <p className="text-[11px] font-semibold mt-0.5" style={{ color: tenant.color_primario }}>
                      Te llevás {cat.entradas_por_unidad} entradas por este precio
                    </p>
                  )}
                  {!isAgotado && <p className="text-xs mt-0.5" style={{ color: `${tenant.color_texto}55` }}>{cat.stock_disponible} disponibles</p>}
                  {isAgotado ? <p className="text-xs text-red-400 font-semibold mt-1">Agotado</p> : cat.stock_disponible <= 10 ? <p className="text-xs text-amber-400 font-semibold mt-1">¡Últimos {cat.stock_disponible}!</p> : null}
                </div>

                <div className="flex flex-col gap-2 w-full sm:w-auto sm:items-end shrink-0 sm:min-w-[240px]">
                  {isAgotado ? (
                    <WaitlistButton
                      tenantSlug={tenant.slug}
                      eventoId={evento.id}
                      categoriaId={cat.id}
                      categoriaNombre={cat.nombre}
                      fechaId={fechaId ?? null}
                      textColor={tenant.color_texto}
                      primaryColor={tenant.color_primario}
                    />
                  ) : (
                    <>
                      <TooltipProvider>
                        <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button onClick={() => onChangeCantidad(cat.id, -1, cat.stock_disponible)} className="h-11 w-11 rounded-full flex items-center justify-center disabled:opacity-30 cursor-pointer" style={{ background: `${tenant.color_texto}12`, color: tenant.color_texto }} disabled={cantidad === 0 || !canSell} aria-label="Quitar unidad">
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Quitar unidad</TooltipContent>
                          </Tooltip>
                          <CantidadInput
                            cantidad={cantidad}
                            max={cat.stock_disponible}
                            disabled={!canSell}
                            textColor={tenant.color_texto}
                            label={`Cantidad de ${cat.nombre}`}
                            onSet={(nueva) => onChangeCantidad(cat.id, nueva - cantidad, cat.stock_disponible)}
                          />
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button onClick={() => onChangeCantidad(cat.id, 1, cat.stock_disponible)} className="h-11 w-11 rounded-full flex items-center justify-center cursor-pointer" style={{ background: tenant.color_primario }} disabled={cat.stock_disponible <= 0 || !canSell} aria-label="Agregar unidad">
                                <Plus className="h-3.5 w-3.5 text-white" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Agregar unidad</TooltipContent>
                          </Tooltip>
                        </div>
                      </TooltipProvider>

                      <button
                        onClick={() => onAgregar(cat)}
                        disabled={cantidad === 0 || !canSell}
                        title={!canSell ? getSalesReadinessStatusLabel(salesReadiness?.status ?? "missing_provider") : undefined}
                        className="h-11 w-full sm:w-auto px-4 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition-all disabled:opacity-30 cursor-pointer"
                        style={{ background: isAgregado ? `${tenant.color_primario}99` : tenant.color_primario, color: "white" }}
                      >
                        {isAgregado ? <><Check className="h-4 w-4" /> Agregado</> : <><ShoppingCart className="h-4 w-4" /> {canSell ? "Agregar" : "Ventas pausadas"}</>}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </TenantCard>
          )
        })}
      </div>
    </TenantPanel>
  )
}

export function EventoDetalleAddonsSection({
  tenant,
  addons,
  seleccion,
  agregado,
  canSell,
  onChangeCantidad,
  onAgregar,
}: {
  tenant: TenantEmpresa
  addons: TenantEventoAddon[]
  seleccion: Record<string, number>
  agregado: string | null
  canSell: boolean
  onChangeCantidad: (addonId: string, delta: number, max: number) => void
  onAgregar: (addon: TenantEventoAddon) => void
}) {
  if (addons.length === 0) return null

  return (
    <TenantPanel tenant={tenant} className="mt-6 rounded-3xl border p-4 md:p-5">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4" style={{ color: tenant.color_primario }} />
        <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: `${tenant.color_texto}55` }}>
          ¿Querés sumar algo?
        </p>
      </div>
      <p className="text-sm mb-4" style={{ color: `${tenant.color_texto}70` }}>
        Extras opcionales para tu noche: estacionamiento, meet &amp; greet, merch y más.
      </p>

      <div className="space-y-3">
        {addons.map((addon) => {
          const cantidad = seleccion[addon.id] ?? 0
          const isAgregado = agregado === addon.id
          const maxPorCompra = Math.min(addon.max_por_compra ?? 4, addon.stock_disponible)
          const disponible = addon.stock_disponible > 0

          return (
            <TenantCard tenant={tenant} key={addon.id} className="rounded-2xl p-4 border">
              <div className="flex flex-col sm:flex-row items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-bold" style={{ color: tenant.color_texto }}>{addon.nombre}</p>
                  {addon.descripcion && (
                    <p className="text-xs mt-0.5" style={{ color: `${tenant.color_texto}7a` }}>{addon.descripcion}</p>
                  )}
                  {Number(addon.fee_buyer_amount ?? 0) > 0 ? (
                    <div className="mt-1">
                      <p className="text-lg font-black font-mono tabular-nums" style={{ color: tenant.color_primario }}>
                        {formatMoney(Number(addon.precio_buyer ?? addon.precio))}
                      </p>
                      <p className="text-[11px] mt-0.5 font-mono tabular-nums" style={{ color: `${tenant.color_texto}80` }}>
                        {formatMoney(Number(addon.precio))} + {formatMoney(Number(addon.fee_buyer_amount))} cargo por servicio
                      </p>
                    </div>
                  ) : (
                    <p className="text-lg font-black mt-1 font-mono tabular-nums" style={{ color: tenant.color_primario }}>{formatMoney(Number(addon.precio))}</p>
                  )}
                  <p className="text-xs mt-0.5" style={{ color: `${tenant.color_texto}55` }}>
                    {disponible ? `${addon.stock_disponible} disponibles` : "Agotado"}
                  </p>
                </div>

                {disponible ? (
                  <div className="flex flex-col gap-2 w-full sm:w-auto sm:items-end shrink-0 sm:min-w-[240px]">
                    <TooltipProvider>
                      <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => onChangeCantidad(addon.id, -1, maxPorCompra)}
                              className="h-11 w-11 rounded-full flex items-center justify-center disabled:opacity-30 cursor-pointer"
                              style={{ background: `${tenant.color_texto}12`, color: tenant.color_texto }}
                              disabled={cantidad === 0 || !canSell}
                              aria-label="Quitar unidad"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Quitar unidad</TooltipContent>
                        </Tooltip>
                        <CantidadInput
                          cantidad={cantidad}
                          max={maxPorCompra}
                          disabled={!canSell}
                          textColor={tenant.color_texto}
                          label={`Cantidad de ${addon.nombre}`}
                          onSet={(nueva) => onChangeCantidad(addon.id, nueva - cantidad, maxPorCompra)}
                        />
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              onClick={() => onChangeCantidad(addon.id, 1, maxPorCompra)}
                              className="h-11 w-11 rounded-full flex items-center justify-center cursor-pointer disabled:opacity-30"
                              style={{ background: tenant.color_primario }}
                              disabled={!canSell || cantidad >= maxPorCompra}
                              aria-label="Agregar unidad"
                            >
                              <Plus className="h-3.5 w-3.5 text-white" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent>Agregar unidad</TooltipContent>
                        </Tooltip>
                      </div>
                    </TooltipProvider>

                    <button
                      onClick={() => onAgregar(addon)}
                      disabled={cantidad === 0 || !canSell}
                      className="h-11 w-full sm:w-auto px-4 rounded-xl text-sm font-bold flex items-center justify-center gap-1.5 transition-all disabled:opacity-30 cursor-pointer"
                      style={{ background: isAgregado ? `${tenant.color_primario}99` : tenant.color_primario, color: "white" }}
                    >
                      {isAgregado ? (
                        <><Check className="h-4 w-4" /> Sumado</>
                      ) : (
                        <><ShoppingCart className="h-4 w-4" /> Sumar al carrito</>
                      )}
                    </button>
                  </div>
                ) : null}
              </div>
            </TenantCard>
          )
        })}
      </div>
    </TenantPanel>
  )
}

export function EventoDetalleConsumiblesSection({
  tenant,
  eventoId,
  eventoNombre,
  canSell,
  consumiblesBarras,
}: {
  tenant: TenantEmpresa
  eventoId: string
  eventoNombre: string
  canSell: boolean
  consumiblesBarras: TenantConsumibleBar[]
}) {
  const { items, agregar, quitarUno } = useConsumiblesCart()

  if (consumiblesBarras.length === 0) return null

  function getCantidadEnCarrito(barraId: string, consumibleId: string) {
    return items.find((entry) => entry.barraId === barraId && entry.consumibleId === consumibleId)?.cantidad ?? 0
  }

  function handleIncrementar(barra: TenantConsumibleBar, item: TenantConsumibleBar["items"][number]) {
    agregar({
      barraId: barra.id,
      barraNombre: barra.nombre,
      buyerConsumibleRefundsEnabled: barra.buyer_consumible_refunds_enabled !== false,
      consumibleId: item.consumible_id,
      nombre: item.nombre,
      precio: Number(item.precio),
      cantidad: 1,
      eventoId,
      eventoNombre,
      stockDisponible: item.stock_actual,
    })
  }

  return (
    <TenantPanel tenant={tenant} className="mt-8 rounded-3xl border p-4 md:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest mb-1" style={{ color: `${tenant.color_texto}55` }}>Consumibles del evento</p>
          <h2 className="text-xl font-black" style={{ color: tenant.color_texto }}>Elegí barra y sumá tus consumos</h2>
          <p className="text-sm mt-1" style={{ color: `${tenant.color_texto}72` }}>Los consumibles se agrupan por barra. Cada barra genera su propio QR al momento del pago.</p>
        </div>
      </div>

      <div className="space-y-4">
        {consumiblesBarras.map((barra) => (
          <TenantCard tenant={tenant} key={barra.id} className="rounded-2xl border p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-9 w-9 rounded-xl flex items-center justify-center" style={{ background: `${tenant.color_primario}22`, color: tenant.color_primario }}>
                <Beer className="h-4 w-4" />
              </div>
              <div>
                <p className="font-bold" style={{ color: tenant.color_texto }}>{barra.nombre}</p>
                <p className="text-xs" style={{ color: `${tenant.color_texto}60` }}>{barra.items.length} consumible{barra.items.length === 1 ? "" : "s"} disponible{barra.items.length === 1 ? "" : "s"}</p>
              </div>
            </div>

            <div className="grid gap-3 md:grid-cols-2">
              {barra.items.map((item) => (
                <ConsumibleCard
                  key={item.consumible_id}
                  tenant={tenant}
                  size="compact"
                  nombre={item.nombre}
                  descripcion={item.descripcion}
                  imagenUrl={item.imagen_url}
                  precio={Number(item.precio)}
                  stockActual={item.stock_actual}
                  stockIlimitado={item.stock_ilimitado}
                  agotado={item.agotado}
                  cantidadEnCarrito={getCantidadEnCarrito(barra.id, item.consumible_id)}
                  canSell={canSell}
                  onIncrementar={() => handleIncrementar(barra, item)}
                  onDecrementar={() => quitarUno(barra.id, item.consumible_id)}
                />
              ))}
            </div>
          </TenantCard>
        ))}
      </div>

      <Link
        href={buildTenantPath(tenant.slug, tenantRoutes.consumiblesEvento(eventoId))}
        className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold"
        style={{ color: tenant.color_primario }}
      >
        Ver catálogo completo con filtros y búsqueda →
      </Link>
    </TenantPanel>
  )
}

export function EventoDetalleStickyCheckout({
  tenant,
  totalItems,
  totalEntradas,
  canSell,
  onComprar,
}: {
  tenant: TenantEmpresa
  totalItems: number
  totalEntradas: number
  canSell: boolean
  onComprar: () => void
}) {
  if (totalItems <= 0) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 px-4 pt-4" style={{ background: `linear-gradient(to top, ${tenant.color_fondo} 62%, transparent)`, paddingBottom: "calc(1rem + env(safe-area-inset-bottom))" }}>
      <div className="max-w-2xl mx-auto space-y-3">
        {totalItems > 0 ? (
          <button onClick={onComprar} disabled={!canSell} className="w-full flex items-center justify-between gap-3 min-h-14 px-4 sm:px-6 py-3 rounded-2xl font-bold text-white text-sm sm:text-base cursor-pointer" style={{ background: tenant.color_primario }}>
            <span className="font-black font-mono tabular-nums">{formatMoney(totalEntradas)}</span>
            <span>{canSell ? "Ir al checkout →" : "Checkout pausado"}</span>
            <span className="text-xs opacity-75">{totalItems} entrada{totalItems !== 1 ? "s" : ""}</span>
          </button>
        ) : null}
      </div>
    </div>
  )
}
