import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { TenantEmpresa } from "@/lib/tenant"
import type { TenantHomeTestimoniosSection as TenantHomeTestimoniosSectionData } from "@/lib/tenant-home-sections"
import TenantProvider from "./tenant-provider"
import { TenantHomeTestimoniosSection } from "./tenant-home-testimonios-section"

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

function renderSection(section: TenantHomeTestimoniosSectionData) {
  return renderToStaticMarkup(
    <TenantProvider empresa={tenantBase}>
      <TenantHomeTestimoniosSection section={section} />
    </TenantProvider>
  )
}

function renderSectionWithTenant(section: TenantHomeTestimoniosSectionData, empresa: TenantEmpresa) {
  return renderToStaticMarkup(
    <TenantProvider empresa={empresa}>
      <TenantHomeTestimoniosSection section={section} />
    </TenantProvider>
  )
}

test("testimonios section renders nothing when there are no testimonios at all", () => {
  const markup = renderSection({ id: "testi-1", type: "testimonios", titulo: "Lo que dicen", testimonios: [], visible: true })

  assert.doesNotMatch(markup, /px-4 py-12/)
  assert.doesNotMatch(markup, /Lo que dicen/)
})

test("testimonios section renders nothing when every testimonio is missing nombre or texto", () => {
  const markup = renderSection({
    id: "testi-1",
    type: "testimonios",
    titulo: "Lo que dicen",
    testimonios: [
      { id: "t-1", nombre: "", texto: "Sin nombre", rol: "", url_foto: "" },
      { id: "t-2", nombre: "Sin texto", texto: "", rol: "", url_foto: "" },
    ],
    visible: true,
  })

  assert.doesNotMatch(markup, /px-4 py-12/)
})

test("testimonios section renders only the complete testimonios, in original order, skipping incomplete ones", () => {
  const markup = renderSection({
    id: "testi-1",
    type: "testimonios",
    titulo: "Lo que dicen",
    testimonios: [
      { id: "t-1", nombre: "Ana", texto: "Excelente lugar", rol: "Clienta habitué", url_foto: "" },
      { id: "t-2", nombre: "", texto: "Sin nombre no cuenta", rol: "", url_foto: "" },
      { id: "t-3", nombre: "Beto", texto: "Volvería mil veces", rol: "", url_foto: "" },
    ],
    visible: true,
  })

  assert.match(markup, /Lo que dicen/)
  assert.match(markup, /Excelente lugar/)
  assert.match(markup, /Volvería mil veces/)
  assert.doesNotMatch(markup, /Sin nombre no cuenta/)

  // Order preserved: Ana's testimonio must appear before Beto's.
  const anaIndex = markup.indexOf("Excelente lugar")
  const betoIndex = markup.indexOf("Volvería mil veces")
  assert.ok(anaIndex > -1 && betoIndex > -1 && anaIndex < betoIndex)

  // rol is shown only when present.
  assert.match(markup, /Clienta habitué/)
})

test("testimonios section shows an initial-letter fallback avatar when there is no url_foto", () => {
  const markup = renderSection({
    id: "testi-1",
    type: "testimonios",
    titulo: "",
    testimonios: [{ id: "t-1", nombre: "zoe", texto: "Buenísimo", rol: "", url_foto: "" }],
    visible: true,
  })

  assert.match(markup, />Z</) // uppercased first initial
  assert.doesNotMatch(markup, /<img/) // no <img> without a photo url
})

test("testimonios section anchors to a linked evento when evento_id resolves in tenant.testimonio_eventos", () => {
  const markup = renderSectionWithTenant(
    {
      id: "testi-1",
      type: "testimonios",
      titulo: "",
      testimonios: [{ id: "t-1", nombre: "Ana", texto: "Excelente lugar", rol: "", url_foto: "", evento_id: "evt-1" }],
      visible: true,
    },
    {
      ...tenantBase,
      testimonio_eventos: { "evt-1": { nombre: "Fiesta de verano", imagen_url: "https://example.com/cover.jpg" } },
    }
  )

  assert.match(markup, /Fiesta de verano/)
  assert.match(markup, /Ana/)
  assert.match(markup, /cover\.jpg/)
  // Event-anchored card renders the cover image header, not the generic circular avatar
  // (the loose-card avatar is always exactly 40x40 — h-10 w-10 — unlike the badge pill above).
  assert.doesNotMatch(markup, /h-10 w-10 shrink-0/)
})

test("testimonios section falls back to the loose card when evento_id doesn't resolve (deleted/missing event)", () => {
  const markup = renderSectionWithTenant(
    {
      id: "testi-1",
      type: "testimonios",
      titulo: "",
      testimonios: [{ id: "t-1", nombre: "Beto", texto: "Volvería mil veces", rol: "", url_foto: "", evento_id: "evt-deleted" }],
      visible: true,
    },
    { ...tenantBase, testimonio_eventos: {} }
  )

  assert.match(markup, /Volvería mil veces/)
  assert.match(markup, />B</) // initial-letter fallback avatar, same as an unlinked testimonio
})

test("testimonios section omits the title heading when titulo is empty", () => {
  const markup = renderSection({
    id: "testi-1",
    type: "testimonios",
    titulo: "",
    testimonios: [{ id: "t-1", nombre: "Ana", texto: "Excelente lugar", rol: "", url_foto: "" }],
    visible: true,
  })

  assert.match(markup, /Excelente lugar/)
  assert.doesNotMatch(markup, /<h2/)
})
