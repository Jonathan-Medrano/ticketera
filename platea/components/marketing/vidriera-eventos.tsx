import { CalendarDays, MapPin, Ticket } from "lucide-react"

import TenantImage from "@/components/tenant/tenant-image"
import { buildTenantPublicUrl, tenantRoutes } from "@/lib/tenant-routes"
import { formatDate, formatMoney } from "@/lib/format"
import type { VidrieraEventoPublico } from "@/lib/vidriera"

export default function VidrieraEventos({ eventos }: { eventos: VidrieraEventoPublico[] }) {
  if (eventos.length === 0) return null

  return (
    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
      {eventos.map((evento) => {
        const href = `${buildTenantPublicUrl(evento.empresa_slug)}${tenantRoutes.evento(evento.id)}?utm_source=vidriera`

        return (
          <a
            key={evento.id}
            href={href}
            rel="noopener"
            className="group flex flex-col overflow-hidden rounded-2xl border border-[color:var(--marketing-border-strong)] bg-[color:var(--marketing-bg)]/70 backdrop-blur-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-[0_18px_44px_rgba(15,33,77,0.14)]"
          >
            <div className="relative aspect-[4/3] overflow-hidden bg-[color:var(--marketing-accent)]/10">
              <TenantImage
                src={evento.imagen_url}
                alt={evento.nombre}
                fill
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
                className="object-cover transition-transform duration-500 group-hover:scale-105"
                fallback={
                  <div className="absolute inset-0 flex items-center justify-center">
                    <Ticket className="h-10 w-10 text-[color:var(--marketing-accent)]/40" />
                  </div>
                }
              />
            </div>
            <div className="flex min-h-[9.5rem] flex-1 flex-col gap-1.5 p-4">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[color:var(--marketing-accent)]">
                {evento.empresa_nombre}
              </p>
              <h3 className="line-clamp-2 text-sm font-bold text-[color:var(--marketing-ink-strong)]">{evento.nombre}</h3>
              <div className="mt-1 flex flex-col gap-1 text-xs text-[color:var(--marketing-ink)]/70">
                {evento.proxima_fecha && (
                  <span className="flex items-center gap-1.5">
                    <CalendarDays className="h-3.5 w-3.5" />
                    {formatDate(evento.proxima_fecha)}
                  </span>
                )}
                {(evento.lugar || evento.ciudad) && (
                  <span className="flex items-center gap-1.5 truncate">
                    <MapPin className="h-3.5 w-3.5 shrink-0" />
                    {[evento.lugar, evento.ciudad].filter(Boolean).join(", ")}
                  </span>
                )}
              </div>
              {evento.precio_desde != null && (
                <p className="mt-auto pt-2 text-sm font-black font-mono tabular-nums text-[color:var(--marketing-accent)]">
                  Desde {formatMoney(evento.precio_desde)}
                </p>
              )}
            </div>
          </a>
        )
      })}
    </div>
  )
}
