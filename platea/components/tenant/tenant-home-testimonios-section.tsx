"use client"

import { CalendarDays, Quote } from "lucide-react"
import { useTenant } from "./tenant-provider"
import TenantImage from "./tenant-image"
import { tenantOverlayColor } from "@/lib/color-contrast"
import { getRenderableTestimonios, type TenantHomeTestimonioItem, type TenantHomeTestimoniosSection as TenantHomeTestimoniosSectionData } from "@/lib/tenant-home-sections"

export function TenantHomeTestimoniosSection({ section }: { section: TenantHomeTestimoniosSectionData }) {
  const tenant = useTenant()
  const testimonios = getRenderableTestimonios(section)

  if (!testimonios.length) return null

  const titulo = section.titulo.trim()
  const gridColsClassName = testimonios.length > 2 ? "sm:grid-cols-2 lg:grid-cols-3" : testimonios.length > 1 ? "sm:grid-cols-2" : ""

  return (
    <div className="w-full px-4 py-12 md:py-16">
      <div className="mx-auto max-w-5xl">
        {titulo && (
          <h2 className="mb-6 text-center text-xl font-bold md:mb-8 md:text-2xl" style={{ color: tenant.color_texto }}>
            {titulo}
          </h2>
        )}
        <div className={`grid items-stretch gap-4 ${gridColsClassName}`}>
          {testimonios.map((testimonio) => {
            // Testimonio anclado a un evento pasado del tenant: solo si evento_id resuelve
            // a un evento real (tenant.testimonio_eventos, poblado server-side scoped al
            // propio tenant). Si el evento fue borrado o no vino en el mapa, cae con gracia
            // al diseño de testimonio suelto (avatar genérico) — nunca rompe el render.
            const eventoVinculado = testimonio.evento_id ? tenant.testimonio_eventos?.[testimonio.evento_id] : null
            return eventoVinculado ? (
              <TestimonioEventoCard key={testimonio.id} testimonio={testimonio} eventoNombre={eventoVinculado.nombre} eventoImagenUrl={eventoVinculado.imagen_url} />
            ) : (
              <TestimonioSueltoCard key={testimonio.id} testimonio={testimonio} />
            )
          })}
        </div>
      </div>
    </div>
  )
}

function TestimonioSueltoCard({ testimonio }: { testimonio: TenantHomeTestimonioItem }) {
  const tenant = useTenant()
  const initial = testimonio.nombre.trim().charAt(0).toUpperCase() || "?"

  return (
    <div
      className="flex min-w-0 flex-col border p-5"
      style={{
        borderColor: `${tenant.color_texto}12`,
        background: `var(--tenant-superficie, ${tenant.color_texto}05)`,
        borderRadius: "var(--tenant-radius, 20px)",
      }}
    >
      <Quote className="mb-3 h-5 w-5 shrink-0" style={{ color: `${tenant.color_primario}80` }} />
      <p className="mb-4 flex-1 whitespace-pre-line break-words text-sm leading-relaxed" style={{ color: `${tenant.color_texto}cc` }}>
        {testimonio.texto}
      </p>
      <div className="flex items-center gap-3">
        <TenantImage
          src={testimonio.url_foto || undefined}
          alt={testimonio.nombre}
          width={40}
          height={40}
          className="h-10 w-10 shrink-0 rounded-full object-cover"
          fallback={
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-sm font-bold"
              style={{ background: `${tenant.color_primario}18`, color: tenant.color_primario }}
            >
              {initial}
            </div>
          }
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" style={{ color: tenant.color_texto }}>
            {testimonio.nombre}
          </p>
          {testimonio.rol && (
            <p className="truncate text-xs" style={{ color: `${tenant.color_texto}60` }}>
              {testimonio.rol}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

// Card anclada a un evento pasado real del tenant: la imagen de portada reemplaza al
// avatar genérico y el nombre del evento aparece como contexto ("esto pasó acá") —
// solo nombre + imagen, nunca precio/stock, no es un widget de venta.
function TestimonioEventoCard({
  testimonio,
  eventoNombre,
  eventoImagenUrl,
}: {
  testimonio: TenantHomeTestimonioItem
  eventoNombre: string
  eventoImagenUrl: string | null
}) {
  const tenant = useTenant()

  return (
    <div
      className="flex min-w-0 flex-col overflow-hidden border"
      style={{
        borderColor: `${tenant.color_texto}12`,
        background: `var(--tenant-superficie, ${tenant.color_texto}05)`,
        borderRadius: "var(--tenant-radius, 20px)",
      }}
    >
      {eventoImagenUrl ? (
        <div className="relative aspect-[16/9] w-full shrink-0 overflow-hidden">
          <TenantImage src={eventoImagenUrl} alt={eventoNombre} fill sizes="(max-width: 768px) 100vw, 33vw" className="object-cover" />
          {/* Overlay de legibilidad — mismo mecanismo que el hero de evento y las cards editoriales del home. */}
          <div
            className="absolute inset-0"
            style={{ background: `linear-gradient(to top, ${tenantOverlayColor(tenant.color_primario, 0.85)} 0%, transparent 60%)` }}
          />
          <span className="absolute inset-x-3 bottom-3 inline-flex max-w-[calc(100%-1.5rem)] items-center gap-1.5 truncate rounded-full bg-black/35 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
            <CalendarDays className="h-3 w-3 shrink-0" />
            <span className="truncate">{eventoNombre}</span>
          </span>
        </div>
      ) : (
        <div className="px-5 pt-5">
          <span
            className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full px-2.5 py-1 text-[11px] font-semibold"
            style={{ background: `${tenant.color_primario}18`, color: tenant.color_primario }}
          >
            <CalendarDays className="h-3 w-3 shrink-0" />
            <span className="truncate">{eventoNombre}</span>
          </span>
        </div>
      )}
      <div className="flex flex-1 flex-col p-5">
        <Quote className="mb-3 h-5 w-5 shrink-0" style={{ color: `${tenant.color_primario}80` }} />
        <p className="mb-4 flex-1 whitespace-pre-line break-words text-sm leading-relaxed" style={{ color: `${tenant.color_texto}cc` }}>
          {testimonio.texto}
        </p>
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold" style={{ color: tenant.color_texto }}>
            {testimonio.nombre}
          </p>
          {testimonio.rol && (
            <p className="truncate text-xs" style={{ color: `${tenant.color_texto}60` }}>
              {testimonio.rol}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
