import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import { FaqSection, type SitioVentaForm } from "@/components/dashboard/sitio-venta-sections"

function buildForm(overrides: Partial<SitioVentaForm> = {}): SitioVentaForm {
  return {
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
    support_contact_email: "",
    faqs: [],
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
    ...overrides,
  }
}

test("FaqSection preview explains when public contact is hidden but FAQs stay visible", () => {
  const markup = renderToStaticMarkup(
    <FaqSection
      form={buildForm({
        support_contact_email: "   ",
        faqs: [
          { id: "faq-visible", question: "¿Horario?", answer: "Desde las 20 hs", hidden: false },
          { id: "faq-hidden", question: "¿Hay reingreso?", answer: "No", hidden: true },
        ],
      })}
      setForm={() => {}}
    />
  )

  assert.match(markup, /El formulario público va a quedar oculto hasta configurar un email\./)
  assert.match(markup, /Hay 1 FAQ visible para compradores\./)
  assert.doesNotMatch(markup, /El formulario público va a estar visible\./)
})
