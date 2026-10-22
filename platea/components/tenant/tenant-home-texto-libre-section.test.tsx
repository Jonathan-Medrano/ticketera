import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { TenantEmpresa } from "@/lib/tenant"
import type { TenantHomeTextoLibreSection as TenantHomeTextoLibreSectionData } from "@/lib/tenant-home-sections"
import TenantProvider from "./tenant-provider"
import { TenantHomeTextoLibreSection } from "./tenant-home-texto-libre-section"

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

function renderSection(section: TenantHomeTextoLibreSectionData) {
  return renderToStaticMarkup(
    <TenantProvider empresa={tenantBase}>
      <TenantHomeTextoLibreSection section={section} />
    </TenantProvider>
  )
}

test("texto_libre section renders nothing when there is no title and no meaningful HTML", () => {
  const emptyMarkup = renderSection({ id: "texto-1", type: "texto_libre", titulo: "", contenido_html: "", visible: true })
  const whitespaceOnlyMarkup = renderSection({ id: "texto-1", type: "texto_libre", titulo: "", contenido_html: "<p>&nbsp;</p>", visible: true })

  // Only the TenantProvider's <style> tag should remain — the section itself bails out to null.
  assert.doesNotMatch(emptyMarkup, /px-4 py-12/)
  assert.doesNotMatch(whitespaceOnlyMarkup, /px-4 py-12/)
})

test("texto_libre section renders the title alone when there is no HTML content", () => {
  const markup = renderSection({ id: "texto-1", type: "texto_libre", titulo: "Sobre el club", contenido_html: "", visible: true })

  assert.match(markup, /Sobre el club/)
  assert.doesNotMatch(markup, /dangerouslySetInnerHTML/) // sanity: this is markup, not source
})

test("texto_libre section renders allowed rich-text HTML (paragraphs, lists, links, formatting)", () => {
  const markup = renderSection({
    id: "texto-1",
    type: "texto_libre",
    titulo: "Nuestra historia",
    contenido_html: '<p>Somos un <strong>club</strong> con <em>historia</em>.</p><ul><li>Uno</li><li>Dos</li></ul><a href="https://ticketera.com">Sitio</a>',
    visible: true,
  })

  assert.match(markup, /Nuestra historia/)
  assert.match(markup, /<strong>club<\/strong>/)
  assert.match(markup, /<em>historia<\/em>/)
  assert.match(markup, /<li>Uno<\/li>/)
  assert.match(markup, /<li>Dos<\/li>/)
  assert.match(markup, /href="https:\/\/ticketera\.com"/)
})

test("texto_libre section re-sanitizes at render time even if unsafe HTML slips past normalization (defense in depth)", () => {
  // Simulates a stored value that bypassed lib/tenant-home-sections.ts normalization
  // (e.g. legacy row written before sanitization existed, or a future bug upstream).
  // The component itself must not trust `section.contenido_html` blindly.
  const unsafeSection = {
    id: "texto-1",
    type: "texto_libre" as const,
    titulo: "",
    contenido_html: '<p onclick="alert(1)">Hola</p><script>alert(document.cookie)</script><img src=x onerror=alert(1)><iframe src="javascript:alert(1)"></iframe>',
    visible: true,
  }

  const markup = renderSection(unsafeSection)

  assert.doesNotMatch(markup, /<script/i)
  assert.doesNotMatch(markup, /onclick/i)
  assert.doesNotMatch(markup, /onerror/i)
  assert.doesNotMatch(markup, /<iframe/i)
  assert.doesNotMatch(markup, /javascript:/i)
  assert.match(markup, /<p>Hola<\/p>/)
})
