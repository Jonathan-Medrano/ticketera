import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { TenantEmpresa } from "@/lib/tenant"
import type { TenantHomeVideoEmbedSection as TenantHomeVideoEmbedSectionData } from "@/lib/tenant-home-sections"
import TenantProvider from "./tenant-provider"
import { TenantHomeVideoEmbedSection } from "./tenant-home-video-embed-section"

const tenantBase: TenantEmpresa = {
  id: "tenant-1",
  nombre: "Club Demo",
  slug: "club-demo",
  logo_url: null,
  color_primario: "#7c3aed",
  color_fondo: "#111827",
  color_texto: "#ffffff",
  mostrar_descripcion_home: true,
  mostrar_tanda_activa_home: true,
  mostrar_badge_stock_home: true,
  mostrar_fecha_home: true,
  mostrar_lugar_home: true,
  mostrar_precio_home: true,
  titulo_eventos_home: "Eventos",
  subtitulo_eventos_home: "Lo mejor",
  cta_eventos_home: "Comprar",
  banner_variant: "full",
  descripcion: "Experiencias en vivo",
  whatsapp: "+54911",
  banners: [],
  home_sections: null,
  faqs: null,
}

function renderSection(section: TenantHomeVideoEmbedSectionData) {
  return renderToStaticMarkup(
    <TenantProvider empresa={tenantBase}>
      <TenantHomeVideoEmbedSection section={section} />
    </TenantProvider>
  )
}

test("video_embed section renders nothing when the URL does not parse to a known provider", () => {
  const emptyMarkup = renderSection({ id: "video-1", type: "video_embed", url: "", visible: true })
  const unknownDomainMarkup = renderSection({ id: "video-1", type: "video_embed", url: "https://vimeo.com/123456789", visible: true })
  const malformedMarkup = renderSection({ id: "video-1", type: "video_embed", url: "not a url", visible: true })

  // Only the TenantProvider's <style> tag should remain — the section itself bails out to null.
  assert.doesNotMatch(emptyMarkup, /px-4 py-12/)
  assert.doesNotMatch(unknownDomainMarkup, /px-4 py-12/)
  assert.doesNotMatch(malformedMarkup, /px-4 py-12/)
  assert.doesNotMatch(emptyMarkup, /<iframe/)
  assert.doesNotMatch(unknownDomainMarkup, /<iframe/)
  assert.doesNotMatch(malformedMarkup, /<iframe/)
})

test("video_embed section renders a YouTube iframe pointed at the validated /embed/{id} src, never the raw pasted URL", () => {
  const markup = renderSection({
    id: "video-1",
    type: "video_embed",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s",
    visible: true,
  })

  assert.match(markup, /<iframe[^>]*src="https:\/\/www\.youtube\.com\/embed\/dQw4w9WgXcQ"/)
  assert.match(markup, /title="Video de YouTube"/)
  assert.match(markup, /allowfullscreen/i)
  // The raw query string / extra params must never leak into the iframe src.
  assert.doesNotMatch(markup, /t=42s/)
})

test("video_embed section renders an Instagram iframe pointed at the /p/{shortcode}/embed src", () => {
  const markup = renderSection({
    id: "video-1",
    type: "video_embed",
    url: "https://www.instagram.com/reel/Cabc123XYZ/",
    visible: true,
  })

  assert.match(markup, /<iframe[^>]*src="https:\/\/www\.instagram\.com\/p\/Cabc123XYZ\/embed"/)
  assert.match(markup, /title="Publicación de Instagram"/)
})

test("video_embed section never leaks an injection payload from an invalid URL into rendered markup", () => {
  const markup = renderSection({
    id: "video-1",
    type: "video_embed",
    url: 'https://www.youtube.com/watch?v="><script>alert(1)</script>',
    visible: true,
  })

  assert.doesNotMatch(markup, /<script/i)
  assert.doesNotMatch(markup, /<iframe/)
})
