"use client"

import { useTenant } from "./tenant-provider"
import { parseTenantHomeVideoEmbedUrl, type TenantHomeVideoEmbedSection as TenantHomeVideoEmbedSectionData } from "@/lib/tenant-home-sections"

export function TenantHomeVideoEmbedSection({ section }: { section: TenantHomeVideoEmbedSectionData }) {
  const tenant = useTenant()

  // Si la URL no parsea a un ID de YouTube/Instagram válido, no renderizamos nada
  // roto en el sitio público — el editor ya avisa del error en el momento de pegarla.
  const parsed = parseTenantHomeVideoEmbedUrl(section.url)
  if (!parsed) return null

  return (
    <div className="w-full px-4 py-12 md:py-16">
      <div
        className="mx-auto max-w-3xl overflow-hidden border"
        style={{
          borderColor: `${tenant.color_texto}12`,
          background: `var(--tenant-superficie, ${tenant.color_texto}05)`,
          borderRadius: "var(--tenant-radius, 24px)",
        }}
      >
        {parsed.provider === "instagram" ? (
          // El embed crudo de Instagram (sin su script oficial de auto-resize) no
          // reporta su alto real — usamos una altura fija generosa, igual criterio
          // que un oembed básico. scrolling permite ver el contenido si es más alto.
          <iframe
            src={parsed.embedSrc}
            title="Publicación de Instagram"
            className="block w-full border-0"
            style={{ height: 660 }}
            allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
            loading="lazy"
          />
        ) : (
          <div className="relative aspect-video w-full">
            <iframe
              src={parsed.embedSrc}
              title="Video de YouTube"
              className="absolute inset-0 h-full w-full border-0"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              loading="lazy"
            />
          </div>
        )}
      </div>
    </div>
  )
}
