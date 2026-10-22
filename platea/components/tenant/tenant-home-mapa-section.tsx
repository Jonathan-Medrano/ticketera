"use client"

import { MapPin } from "lucide-react"
import { useTenant } from "./tenant-provider"
import { getContrastTextColor } from "@/lib/color-contrast"
import {
  buildGoogleMapsDirectionsUrl,
  buildOsmEmbedSrc,
  hasRenderableMapaContent,
  parseTenantHomeMapaCoords,
  type TenantHomeMapaSection as TenantHomeMapaSectionData,
} from "@/lib/tenant-home-sections"

export function TenantHomeMapaSection({ section }: { section: TenantHomeMapaSectionData }) {
  const tenant = useTenant()

  if (!hasRenderableMapaContent(section)) return null

  const direccion = section.direccion.trim()
  const coords = parseTenantHomeMapaCoords(section.lat, section.lng)
  const hasCta = Boolean(direccion || coords)

  return (
    <div className="w-full px-4 py-12 md:py-16">
      <div
        className="mx-auto max-w-3xl border p-6 md:p-10"
        style={{
          borderColor: `${tenant.color_texto}12`,
          background: `var(--tenant-superficie, ${tenant.color_texto}05)`,
          borderRadius: "var(--tenant-radius, 24px)",
        }}
      >
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-widest" style={{ color: `${tenant.color_texto}50` }}>
          Ubicación
        </p>

        {direccion && (
          <div className="mb-4 flex items-start gap-2">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" style={{ color: tenant.color_primario }} />
            <h2 className="text-base font-bold md:text-lg" style={{ color: tenant.color_texto }}>
              {direccion}
            </h2>
          </div>
        )}

        {coords && (
          <div className="overflow-hidden" style={{ borderRadius: "var(--tenant-radius, 16px)" }}>
            <iframe
              src={buildOsmEmbedSrc(coords.lat, coords.lng)}
              title="Mapa de ubicación"
              className="h-[280px] w-full border-0 md:h-[360px]"
              loading="lazy"
            />
          </div>
        )}

        {hasCta && (
          <a
            href={buildGoogleMapsDirectionsUrl(direccion, coords)}
            target="_blank"
            rel="noopener noreferrer"
            className={`inline-flex h-11 items-center justify-center gap-2 px-4 text-sm font-semibold ${coords ? "mt-4" : ""}`}
            style={{
              borderRadius: "var(--tenant-radius, 12px)",
              background: tenant.color_primario,
              color: getContrastTextColor(tenant.color_primario),
            }}
          >
            <MapPin className="h-4 w-4" />
            Cómo llegar
          </a>
        )}
      </div>
    </div>
  )
}
