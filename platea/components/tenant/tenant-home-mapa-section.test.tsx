import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { TenantEmpresa } from "@/lib/tenant"
import type { TenantHomeMapaSection as TenantHomeMapaSectionData } from "@/lib/tenant-home-sections"
import TenantProvider from "./tenant-provider"
import { TenantHomeMapaSection } from "./tenant-home-mapa-section"

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

function renderSection(section: TenantHomeMapaSectionData) {
  return renderToStaticMarkup(
    <TenantProvider empresa={tenantBase}>
      <TenantHomeMapaSection section={section} />
    </TenantProvider>
  )
}

test("mapa section renders nothing when there is no address and no valid coordinates", () => {
  const emptyMarkup = renderSection({ id: "mapa-1", type: "mapa", direccion: "", lat: "", lng: "", visible: true })
  const invalidCoordsMarkup = renderSection({ id: "mapa-1", type: "mapa", direccion: "", lat: "abc", lng: "def", visible: true })
  const outOfRangeMarkup = renderSection({ id: "mapa-1", type: "mapa", direccion: "", lat: "999", lng: "999", visible: true })

  assert.doesNotMatch(emptyMarkup, /px-4 py-12/)
  assert.doesNotMatch(invalidCoordsMarkup, /px-4 py-12/)
  assert.doesNotMatch(outOfRangeMarkup, /px-4 py-12/)
  assert.doesNotMatch(emptyMarkup, /Cómo llegar/)
})

test("mapa section with only an address shows the address and the CTA, but no map iframe", () => {
  const markup = renderSection({ id: "mapa-1", type: "mapa", direccion: "Av. Siempre Viva 742", lat: "", lng: "", visible: true })

  assert.match(markup, /Av\. Siempre Viva 742/)
  assert.match(markup, /Cómo llegar/)
  assert.doesNotMatch(markup, /openstreetmap\.org/)

  // CTA must point at the address (percent-encoded), since there are no coords to prioritize.
  const hrefMatch = markup.match(/href="([^"]*google\.com\/maps\/dir[^"]*)"/)
  assert.ok(hrefMatch, "expected a Google Maps directions link")
  const url = new URL(hrefMatch![1].replace(/&amp;/g, "&"))
  assert.equal(url.searchParams.get("destination"), "Av. Siempre Viva 742")
})

test("mapa section with only coordinates shows the OSM iframe and the CTA, but no address heading", () => {
  const markup = renderSection({ id: "mapa-1", type: "mapa", direccion: "", lat: "-34.6037", lng: "-58.3816", visible: true })

  assert.match(markup, /openstreetmap\.org\/export\/embed\.html/)
  assert.match(markup, /Cómo llegar/)
  // No <h2> address heading should be present since direccion is empty.
  assert.doesNotMatch(markup, /<h2/)

  const hrefMatch = markup.match(/href="([^"]*google\.com\/maps\/dir[^"]*)"/)
  assert.ok(hrefMatch, "expected a Google Maps directions link")
  const url = new URL(hrefMatch![1].replace(/&amp;/g, "&"))
  assert.equal(url.searchParams.get("destination"), "-34.6037,-58.3816")
})

test("mapa section prioritizes coordinates over the address in the 'Cómo llegar' CTA when both are present", () => {
  const markup = renderSection({
    id: "mapa-1",
    type: "mapa",
    direccion: "Av. Siempre Viva 742",
    lat: "-34.6037",
    lng: "-58.3816",
    visible: true,
  })

  assert.match(markup, /Av\. Siempre Viva 742/) // address heading still shown
  assert.match(markup, /openstreetmap\.org/) // map still shown

  const hrefMatch = markup.match(/href="([^"]*google\.com\/maps\/dir[^"]*)"/)
  assert.ok(hrefMatch, "expected a Google Maps directions link")
  const url = new URL(hrefMatch![1].replace(/&amp;/g, "&"))
  assert.equal(url.searchParams.get("destination"), "-34.6037,-58.3816")
})
