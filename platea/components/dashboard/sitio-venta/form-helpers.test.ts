import assert from "node:assert/strict"
import test from "node:test"
import {
  buildSitioVentaPayload,
  createSitioVentaInitialForm,
  sanitizeSitioVentaDraft,
} from "@/components/dashboard/sitio-venta/form-helpers"

test("createSitioVentaInitialForm produces empty banners array when empresa has no banners (regresión C1)", () => {
  const form = createSitioVentaInitialForm({ id: "emp-1", slug: "club-demo" })
  assert.deepEqual(form.banners, [])
})

test("createSitioVentaInitialForm produces empty banners array when banners is null", () => {
  const form = createSitioVentaInitialForm({ id: "emp-1", slug: "club-demo", banners: null })
  assert.deepEqual(form.banners, [])
})

test("createSitioVentaInitialForm normalizes legacy and canonical FAQs", () => {
  const form = createSitioVentaInitialForm({
    id: "emp-1",
    slug: "club-demo",
    support_contact_email: "soporte@club.test",
    faqs: JSON.stringify([
      { pregunta: "¿Horario?", respuesta: "Desde las 20 hs" },
      { question: "¿Dónde veo mis tickets?", answer: "En Mis tickets" },
      { id: "faq-3", question: "Dress code", answer: "Casual", hidden: true },
    ]),
  })

  assert.equal(form.support_contact_email, "soporte@club.test")
  assert.deepEqual(form.faqs, [
    { id: "faq-1", question: "¿Horario?", answer: "Desde las 20 hs", hidden: false },
    { id: "faq-2", question: "¿Dónde veo mis tickets?", answer: "En Mis tickets", hidden: false },
    { id: "faq-3", question: "Dress code", answer: "Casual", hidden: true },
  ])
})

test("sanitizeSitioVentaDraft preserves canonical support draft data only", () => {
  const draft = sanitizeSitioVentaDraft({
    support_contact_email: "ayuda@club.test",
    faqs: [
      { id: "faq-1", question: "Visible", answer: "Sí", hidden: false },
      { id: "faq-2", question: "Oculta", answer: "Todavía editable", hidden: true },
      { id: "faq-bad", question: "", answer: "Sin pregunta", hidden: false },
      { pregunta: "legacy", respuesta: "legacy" },
    ],
  })

  assert.equal(draft.support_contact_email, "ayuda@club.test")
  assert.deepEqual(draft.faqs, [
    { id: "faq-1", question: "Visible", answer: "Sí", hidden: false },
    { id: "faq-2", question: "Oculta", answer: "Todavía editable", hidden: true },
    { id: "faq-4", question: "legacy", answer: "legacy", hidden: false },
  ])
})

test("buildSitioVentaPayload emits canonical FAQ payload and nullable support email", () => {
  const payload = buildSitioVentaPayload({
    nombre: "",
    descripcion: "",
    whatsapp: "",
    logo_url: "",
    favicon_url: "",
    navbar_size: "medium",
    logo_size: "" as const,
    navbar_color: "",
    font: "",
    color_primario: "#2563eb",
    color_fondo: "#000000",
    color_texto: "#ffffff",
    desktop_event_card_size: "large",
    mostrar_descripcion_home: true,
    mostrar_tanda_activa_home: true,
    mostrar_badge_stock_home: true,
    mostrar_fecha_home: true,
    mostrar_lugar_home: true,
    mostrar_precio_home: true,
    titulo_eventos_home: "",
    subtitulo_eventos_home: "",
    cta_eventos_home: "",
    banner_variant: "blurred",
    banners: [],
    info_pages: [],
    support_contact_email: "   ",
    galeria_fotos: [],
    sections: [],
    announcement_bar: { text: "", link: "", link_label: "", style: "brand" as const, enabled: false },
    social_links: { instagram: "", tiktok: "", facebook: "", x: "", youtube: "" },
    color_superficie: "",
    border_radius: "",
    button_style: "filled" as const,
    heading_font: "",
    navbar_blur: false,
    card_columns: "" as const,
    section_spacing: "" as const,
    mobile_event_layout: "" as const,
    event_card_style: "" as const,
    eventos_layout: "" as const,
    faqs: [
      { id: "faq-1", question: "  Visible ", answer: "  Respuesta ", hidden: false },
      { id: "faq-2", question: "  Oculta ", answer: "  Sigue viva ", hidden: true },
      { id: "faq-empty", question: "", answer: "No va", hidden: false },
    ],
  })

  assert.equal(payload.support_contact_email, null)
  assert.deepEqual(payload.faqs, [
    { id: "faq-1", question: "Visible", answer: "Respuesta", hidden: false },
    { id: "faq-2", question: "Oculta", answer: "Sigue viva", hidden: true },
  ])
})
