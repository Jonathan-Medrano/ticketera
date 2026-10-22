"use client"

import { useTenant } from "./tenant-provider"
import { sanitizeTenantRichText } from "@/lib/tenant-rich-text"
import { hasRenderableTextoLibreContent, type TenantHomeTextoLibreSection as TenantHomeTextoLibreSectionData } from "@/lib/tenant-home-sections"

// Mismas utility classes que `tenant-info-page-view.tsx` para que el rich text
// (Tiptap) se vea consistente en toda la superficie del tenant — párrafos,
// listas, blockquote destacado y links con el color primario del theming.
const RICH_TEXT_CLASSNAME =
  "text-sm leading-relaxed break-words md:text-base " +
  "[&_p]:mb-4 [&_p]:leading-relaxed " +
  "[&_ul]:mb-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 " +
  "[&_ol]:mb-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 " +
  "[&_li]:leading-relaxed [&_strong]:font-semibold [&_em]:italic [&_u]:underline " +
  "[&_blockquote]:my-4 [&_blockquote]:rounded-2xl [&_blockquote]:border-l-4 [&_blockquote]:px-4 [&_blockquote]:py-3 " +
  "[&_blockquote]:border-l-[var(--tenant-text-quote-border)] [&_blockquote]:bg-[var(--tenant-text-quote-bg)] " +
  "[&_h2]:mb-4 [&_h2]:mt-1 [&_h2]:text-lg [&_h2]:font-semibold md:[&_h2]:text-xl " +
  "[&_h3]:mb-3 [&_h3]:mt-1 [&_h3]:text-base [&_h3]:font-semibold md:[&_h3]:text-lg " +
  "[&_a]:text-[var(--tenant-text-link)] [&_a]:underline [&_a]:underline-offset-4"

export function TenantHomeTextoLibreSection({ section }: { section: TenantHomeTextoLibreSectionData }) {
  const tenant = useTenant()

  if (!hasRenderableTextoLibreContent(section)) return null

  const titulo = section.titulo.trim()
  // Segunda pasada de saneamiento en el punto de render — defensa en profundidad,
  // mismo patrón que `tenant-info-page-view.tsx`/`support-view.tsx`. El contenido
  // ya sale saneado de `normalizeTenantHomeSections`, pero nunca confiamos en una
  // sola capa para HTML que se inyecta con dangerouslySetInnerHTML.
  const html = sanitizeTenantRichText(section.contenido_html)

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
        {titulo && (
          <h2 className="mb-4 text-xl font-bold md:text-2xl" style={{ color: tenant.color_texto }}>
            {titulo}
          </h2>
        )}
        {html && (
          <div
            className={RICH_TEXT_CLASSNAME}
            style={{
              color: `${tenant.color_texto}cc`,
              ["--tenant-text-link" as string]: tenant.color_primario,
              ["--tenant-text-quote-border" as string]: tenant.color_primario,
              ["--tenant-text-quote-bg" as string]: `${tenant.color_texto}08`,
            }}
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  )
}
