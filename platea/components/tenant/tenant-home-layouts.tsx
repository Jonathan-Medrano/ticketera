"use client"

import Link from "next/link"
import { CalendarDays, MapPin } from "lucide-react"
import type { TenantEmpresa, TenantEventoResumen } from "@/lib/tenant"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"
import { formatDate, formatDiaAR, formatMesAbr, formatMoney, formatTime } from "@/lib/format"
import { getContrastTextColor, tenantOverlayColor, withOpacity } from "@/lib/color-contrast"
import TenantImage from "./tenant-image"

/**
 * Layouts alternativos del home del tenant (ver openspec/changes/sitio-venta-v2/design.md).
 *
 * Viven fuera de tenant-home.tsx a propósito: ese archivo ya pasa las 1.400 líneas y
 * mete un tercer árbol de render adentro lo vuelve inmantenible.
 *
 * Reglas que estos layouts NO pueden romper:
 *  - Ningún blanco hardcodeado: todo sale de color_texto/color_primario con alpha,
 *    si no se rompe el contraste en tenants de fondo claro.
 *  - Nunca un hueco gris: los eventos sin imagen usan póster de fallback.
 *  - El radio sale de --tenant-radius, que ya setea el provider desde border_radius.
 */

type Evento = TenantEventoResumen

export type TenantHomeLayoutProps = {
  tenant: TenantEmpresa
  eventos: Evento[]
  /** Texto del CTA configurado por el tenant (cta_eventos_home). */
  ctaLabel: string
  /** Título de la sección, ya resuelto por el caller. */
  titulo: string
  subtitulo?: string
}

// ---------------------------------------------------------------- helpers

function imagenDe(evento: Evento) {
  return evento.tanda_activa?.imagen_url || evento.imagen_url || undefined
}

function ctaDe(evento: Evento, ctaLabel: string) {
  const stock = Number(evento.stock_total ?? 0)
  if (stock <= 0) return "Agotado"
  if (!evento.is_checkout_open) return "Disponible pronto"
  return ctaLabel
}

function comprable(evento: Evento) {
  return Number(evento.stock_total ?? 0) > 0 && !!evento.is_checkout_open
}

/**
 * Póster de reemplazo para eventos sin imagen. Muchos tenants cargan el evento sin
 * flyer; dejar el hueco vacío es la diferencia entre "esto está a medio hacer" y una
 * página que se sostiene sola.
 */
function PosterFallback({ tenant, nombre, compact = false }: { tenant: TenantEmpresa; nombre: string; compact?: boolean }) {
  const acento = tenant.color_primario || "#2563eb"
  return (
    <div
      className="h-full w-full flex items-center justify-center text-center"
      style={{
        padding: compact ? "8px" : "18px",
        background: `linear-gradient(150deg, ${acento}, ${tenantOverlayColor(acento, 1, 0.72)})`,
        color: getContrastTextColor(acento),
      }}
    >
      <span
        className="font-black uppercase leading-[1.05] line-clamp-4"
        style={{ fontSize: compact ? "0.7rem" : "1.35rem", letterSpacing: "-0.01em" }}
      >
        {nombre}
      </span>
    </div>
  )
}

function PosterOrFallback({ tenant, evento, compact = false }: { tenant: TenantEmpresa; evento: Evento; compact?: boolean }) {
  const src = imagenDe(evento)
  if (!src) return <PosterFallback tenant={tenant} nombre={evento.nombre} compact={compact} />
  return <TenantImage src={src} alt={evento.nombre} className="w-full h-full object-cover" fill sizes="(max-width: 1024px) 50vw, 33vw" />
}

// ---------------------------------------------------------------- A · CARTELERA

/**
 * El próximo evento ocupa la portada; el resto baja a una grilla secundaria.
 * Con UN solo evento la grilla no se renderiza: la portada es la página. Ese es el
 * caso que en el layout clásico dejaba media pantalla vacía.
 */
export function CarteleraLayout({ tenant, eventos, ctaLabel, titulo, subtitulo }: TenantHomeLayoutProps) {
  const [destacado, ...resto] = eventos
  if (!destacado) return null

  const texto = tenant.color_texto || "#ffffff"
  const acento = tenant.color_primario || "#2563eb"
  const heroImg = imagenDe(destacado)
  const detalleHref = buildTenantPath(tenant.slug, tenantRoutes.evento(destacado.id))

  return (
    <div className="w-full">
      <section className="relative overflow-hidden">
        {heroImg && (
          <TenantImage
            src={heroImg}
            alt=""
            className="w-full h-full object-cover scale-110 blur-2xl opacity-40"
            fill
            sizes="100vw"
          />
        )}
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(to top, ${tenant.color_fondo} 6%, ${tenantOverlayColor(acento, 0.55)} 58%, ${withOpacity(acento, 0.18)})`,
          }}
        />

        {/* El clearance del navbar va ACA adentro, no en un wrapper de afuera:
            asi el fondo difuminado llega hasta arriba de todo y no queda una
            franja del color de fondo entre el navbar y el hero. */}
        <div className="relative mx-auto max-w-[1200px] px-4 pb-8 pt-[calc(var(--tenant-navbar-h,80px)+1.5rem)] md:pb-12 md:pt-[calc(var(--tenant-navbar-h,80px)+2.5rem)]">
          {/* En mobile el poster va AL LADO del texto, no arriba. Apilado se
              comia 293 de los 581px del hero (medido a 390px); al costado, el
              alto pasa a mandarlo el bloque de texto. */}
          <div className="grid grid-cols-[minmax(0,124px)_minmax(0,1fr)] items-start gap-4 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)] md:gap-9 md:items-center">
            {/* El ancho lo fija la columna de la grilla (124px en mobile, 260 en
                desktop): sin eso el poster tomaba el ancho completo y daba
                ~477px de alto solo el flyer. */}
            <div
              className="relative w-full aspect-[3/4] overflow-hidden shadow-2xl"
              style={{ borderRadius: "var(--tenant-radius, 16px)" }}
            >
              <PosterOrFallback tenant={tenant} evento={destacado} />
            </div>

            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] mb-2" style={{ color: acento }}>
                {resto.length > 0 ? "Próximo" : "Única fecha"}
                {destacado.proxima_fecha ? ` · ${formatDate(destacado.proxima_fecha)}` : ""}
              </p>
              <h2
                className="text-3xl md:text-5xl font-black uppercase leading-[0.95] tracking-tight mb-3"
                style={{ color: texto }}
              >
                {destacado.nombre}
              </h2>

              <div className="flex flex-wrap gap-2 mb-4">
                {destacado.proxima_fecha && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs"
                    style={{ borderColor: withOpacity(texto, 0.2), color: withOpacity(texto, 0.9) }}
                  >
                    <CalendarDays className="h-3.5 w-3.5" aria-hidden />
                    {formatTime(destacado.proxima_fecha)}
                  </span>
                )}
                {destacado.lugar && (
                  <span
                    className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs min-w-0"
                    style={{ borderColor: withOpacity(texto, 0.2), color: withOpacity(texto, 0.9) }}
                  >
                    <MapPin className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate">{destacado.lugar}</span>
                  </span>
                )}
              </div>

              {destacado.descripcion && (
                <p className="text-sm leading-relaxed mb-5 max-w-[56ch]" style={{ color: withOpacity(texto, 0.72) }}>
                  {destacado.descripcion}
                </p>
              )}

              {/* En mobile la columna de texto es angosta (~218px): con el
                  padding de desktop los dos botones no entraban en una linea y
                  se apilaban, inflando el bloque de texto de 200 a 284px.
                  Padding mas chico y ancho compartido para que entren juntos. */}
              <div className="flex flex-wrap items-center gap-2 md:gap-3">
                <Link
                  href={detalleHref}
                  className="inline-flex flex-1 items-center justify-center px-4 py-2.5 text-sm font-extrabold transition-opacity hover:opacity-90 md:flex-none md:px-6 md:py-3"
                  style={{
                    borderRadius: "var(--tenant-radius, 12px)",
                    background: acento,
                    color: getContrastTextColor(acento),
                    pointerEvents: comprable(destacado) ? undefined : "none",
                    opacity: comprable(destacado) ? 1 : 0.55,
                  }}
                >
                  {ctaDe(destacado, ctaLabel)}
                </Link>
                <Link
                  href={detalleHref}
                  className="inline-flex flex-1 items-center justify-center border px-4 py-2.5 text-sm font-semibold transition-opacity hover:opacity-90 md:flex-none md:px-6 md:py-3"
                  style={{ borderRadius: "var(--tenant-radius, 12px)", borderColor: withOpacity(texto, 0.28), color: texto }}
                >
                  Ver detalle
                </Link>
                {destacado.precio_desde != null && (
                  <span className="text-xs" style={{ color: withOpacity(texto, 0.62) }}>
                    desde <b className="text-lg" style={{ color: texto }}>{formatMoney(destacado.precio_desde)}</b>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Con un solo evento no hay grilla: la portada ya es la pagina completa. */}
      {resto.length > 0 && (
        <section className="mx-auto max-w-[1200px] px-4 pb-16 pt-8">
          <div className="flex items-baseline justify-between gap-4 mb-4">
            <div>
              <h3 className="text-lg font-bold" style={{ color: texto }}>{titulo}</h3>
              {subtitulo && <p className="text-sm mt-1" style={{ color: withOpacity(texto, 0.6) }}>{subtitulo}</p>}
            </div>
            <span className="text-xs" style={{ color: withOpacity(texto, 0.45) }}>
              {resto.length} evento{resto.length !== 1 ? "s" : ""}
            </span>
          </div>

          {/* 2 columnas ya en mobile: con una sola, cada poster 4:5 ocupaba el
              ancho completo (~447px de alto a 390px) y cuatro eventos eran casi
              1800px de scroll solo en flyers. */}
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            {resto.map((evento) => (
              <Link
                key={evento.id}
                href={buildTenantPath(tenant.slug, tenantRoutes.evento(evento.id))}
                className="group overflow-hidden border transition-transform duration-300 hover:-translate-y-1"
                style={{
                  borderRadius: "var(--tenant-radius, 16px)",
                  borderColor: withOpacity(texto, 0.14),
                  background: withOpacity(texto, 0.04),
                }}
              >
                <div className="relative aspect-[4/5] overflow-hidden">
                  <PosterOrFallback tenant={tenant} evento={evento} />
                </div>
                <div className="p-3">
                  {evento.proxima_fecha && (
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em]" style={{ color: acento }}>
                      {formatDate(evento.proxima_fecha)}
                    </p>
                  )}
                  <p className="mt-1.5 text-sm font-bold leading-snug line-clamp-2" style={{ color: texto }}>
                    {evento.nombre}
                  </p>
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    {evento.precio_desde != null && (
                      <span className="text-sm font-extrabold" style={{ color: texto }}>{formatMoney(evento.precio_desde)}</span>
                    )}
                    <span
                      className="px-3 py-1.5 text-[11px] font-extrabold"
                      style={{
                        borderRadius: "calc(var(--tenant-radius, 12px) - 4px)",
                        background: comprable(evento) ? acento : withOpacity(texto, 0.12),
                        color: comprable(evento) ? getContrastTextColor(acento) : withOpacity(texto, 0.65),
                      }}
                    >
                      {ctaDe(evento, ctaLabel)}
                    </span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- C · AGENDA

/**
 * Filas densas por fecha. Es el unico de los tres layouts que no se rompe ni con 1
 * evento ni con 40, y el que deja comparar fechas y precios de un vistazo.
 */
export function AgendaLayout({ tenant, eventos, ctaLabel, titulo, subtitulo }: TenantHomeLayoutProps) {
  const texto = tenant.color_texto || "#ffffff"
  const acento = tenant.color_primario || "#2563eb"

  return (
    <section className="mx-auto max-w-[1100px] px-4 pb-16 pt-6">
      <div className="mb-4">
        <h2 className="text-2xl md:text-4xl font-black uppercase leading-none tracking-tight" style={{ color: texto }}>
          {titulo}
        </h2>
        {subtitulo && <p className="mt-2 text-sm" style={{ color: withOpacity(texto, 0.55) }}>{subtitulo}</p>}
      </div>

      <div>
        {eventos.map((evento) => {
          const disponible = comprable(evento)
          return (
            <Link
              key={evento.id}
              href={buildTenantPath(tenant.slug, tenantRoutes.evento(evento.id))}
              className="grid items-center gap-3 border-t py-3 transition-colors sm:gap-4"
              style={{
                borderColor: withOpacity(texto, 0.12),
                gridTemplateColumns: "auto minmax(0,1fr) auto",
                opacity: disponible ? 1 : 0.55,
              }}
            >
              <div className="flex items-center gap-3">
                {evento.proxima_fecha && (
                  <div
                    className="shrink-0 border px-2.5 py-1.5 text-center"
                    style={{ borderRadius: "calc(var(--tenant-radius, 12px) - 4px)", borderColor: withOpacity(texto, 0.18) }}
                  >
                    <div className="text-xl font-black leading-none" style={{ color: texto }}>
                      {formatDiaAR(evento.proxima_fecha)}
                    </div>
                    <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.12em]" style={{ color: acento }}>
                      {formatMesAbr(evento.proxima_fecha)}
                    </div>
                  </div>
                )}
                <div
                  className="relative hidden aspect-[3/4] w-14 shrink-0 overflow-hidden sm:block"
                  style={{ borderRadius: "calc(var(--tenant-radius, 12px) - 6px)" }}
                >
                  <PosterOrFallback tenant={tenant} evento={evento} compact />
                </div>
              </div>

              <div className="min-w-0">
                <p className="truncate text-sm font-extrabold sm:text-base" style={{ color: texto }}>{evento.nombre}</p>
                <p className="mt-0.5 truncate text-xs" style={{ color: withOpacity(texto, 0.5) }}>
                  {[evento.proxima_fecha ? formatTime(evento.proxima_fecha) : null, evento.lugar]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>

              <div className="flex items-center gap-3">
                {evento.precio_desde != null && (
                  <div className="text-right">
                    <div className="text-[10px]" style={{ color: withOpacity(texto, 0.45) }}>desde</div>
                    <div className="text-sm font-extrabold" style={{ color: texto }}>{formatMoney(evento.precio_desde)}</div>
                  </div>
                )}
                <span
                  className="hidden px-3 py-1.5 text-[11px] font-extrabold sm:inline-block"
                  style={{
                    borderRadius: "calc(var(--tenant-radius, 12px) - 4px)",
                    background: disponible ? acento : withOpacity(texto, 0.12),
                    color: disponible ? getContrastTextColor(acento) : withOpacity(texto, 0.65),
                  }}
                >
                  {ctaDe(evento, ctaLabel)}
                </span>
              </div>
            </Link>
          )
        })}
      </div>
    </section>
  )
}
