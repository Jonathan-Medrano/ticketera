import assert from "node:assert/strict"
import test from "node:test"

import { aplicarPreset, SITIO_VENTA_PRESETS, type PresetPatch } from "./presets"
import type { SitioVentaForm } from "./types"

// Espejo de los validadores de backend/src/routes/sitio-venta.ts. Si allá se
// agrega un valor, acá también — pero si un preset trae uno que el backend NO
// acepta, el guardado devuelve 400 y el cliente ve un error sin entender por qué.
const VALID = {
  eventos_layout: ["", "clasico", "cartelera", "agenda"],
  font: ["inter", "montserrat", "raleway", "bebas", "poppins", "space-grotesk", "dm-sans", "playfair"],
  heading_font: ["", "inter", "montserrat", "raleway", "bebas", "poppins", "space-grotesk", "dm-sans", "playfair"],
  border_radius: ["", "sharp", "soft", "rounded", "pill"],
  button_style: ["filled", "outline", "ghost"],
  card_columns: ["", "1", "2", "3"],
  section_spacing: ["", "compact", "normal", "spacious"],
  mobile_event_layout: ["", "lista", "cuadricula"],
  event_card_style: ["", "clasico", "editorial"],
  desktop_event_card_size: ["large", "medium", "small"],
  banner_variant: ["blurred", "full"],
  navbar_size: ["small", "medium", "large"],
  logo_size: ["", "small", "medium", "large", "xl"],
} as const

const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const COLOR_KEYS = ["color_primario", "color_fondo", "color_texto", "color_superficie"] as const

// Todo lo que un preset NO puede tocar: es contenido del cliente.
const CLAVES_DE_CONTENIDO = [
  "nombre", "descripcion", "whatsapp", "logo_url", "favicon_url",
  "banners", "galeria_fotos", "sections", "faqs", "info_pages",
  "social_links", "announcement_bar", "support_contact_email",
  "titulo_eventos_home", "subtitulo_eventos_home", "cta_eventos_home",
  "mostrar_descripcion_home", "mostrar_tanda_activa_home", "mostrar_badge_stock_home",
  "mostrar_fecha_home", "mostrar_lugar_home", "mostrar_precio_home",
]

test("los ids y nombres de los presets son unicos", () => {
  const ids = SITIO_VENTA_PRESETS.map((p) => p.id)
  const nombres = SITIO_VENTA_PRESETS.map((p) => p.nombre)
  assert.equal(new Set(ids).size, ids.length, "hay ids repetidos")
  assert.equal(new Set(nombres).size, nombres.length, "hay nombres repetidos")
})

test("cada preset usa solo valores que el backend acepta", () => {
  for (const preset of SITIO_VENTA_PRESETS) {
    for (const [clave, permitidos] of Object.entries(VALID)) {
      const valor = preset.patch[clave as keyof PresetPatch]
      assert.ok(
        (permitidos as readonly string[]).includes(valor as string),
        `preset "${preset.id}": ${clave}="${valor}" no esta en [${permitidos.join(", ")}]`,
      )
    }
  }
})

test("los colores de cada preset son hex validos", () => {
  for (const preset of SITIO_VENTA_PRESETS) {
    for (const clave of COLOR_KEYS) {
      assert.match(preset.patch[clave], HEX, `preset "${preset.id}": ${clave} no es hex`)
    }
    // navbar_color puede ir vacio (= usa el primario)
    if (preset.patch.navbar_color) {
      assert.match(preset.patch.navbar_color, HEX, `preset "${preset.id}": navbar_color no es hex`)
    }
    for (const s of preset.swatch) {
      assert.match(s, HEX, `preset "${preset.id}": swatch invalido`)
    }
  }
})

test("ningun preset toca contenido del cliente", () => {
  for (const preset of SITIO_VENTA_PRESETS) {
    for (const clave of CLAVES_DE_CONTENIDO) {
      assert.ok(
        !(clave in preset.patch),
        `preset "${preset.id}" toca "${clave}", que es contenido del cliente y no debe pisarse`,
      )
    }
  }
})

test("aplicarPreset preserva el contenido y solo cambia el estilo", () => {
  const form = {
    nombre: "Club Paraiso",
    logo_url: "https://cdn/logo.png",
    banners: ["a.jpg", "b.jpg"],
    faqs: [{ pregunta: "p", respuesta: "r" }],
    color_primario: "#111111",
    eventos_layout: "",
    font: "inter",
  } as unknown as SitioVentaForm

  const preset = SITIO_VENTA_PRESETS.find((p) => p.id === "cartelera-under")!
  const out = aplicarPreset(form, preset)

  // contenido intacto
  assert.equal(out.nombre, "Club Paraiso")
  assert.equal(out.logo_url, "https://cdn/logo.png")
  assert.deepEqual(out.banners, ["a.jpg", "b.jpg"])
  assert.equal(out.faqs.length, 1)
  // estilo aplicado
  assert.equal(out.color_primario, "#c6ff00")
  assert.equal(out.eventos_layout, "cartelera")
  // el original no se mutó
  assert.equal(form.color_primario, "#111111")
})

test("el preset Clasico vuelve al layout historico", () => {
  const clasico = SITIO_VENTA_PRESETS.find((p) => p.id === "clasico")
  assert.ok(clasico, "falta el preset de vuelta atras")
  // "" es el layout historico: un tenant que probo Cartelera puede volver.
  assert.equal(clasico!.patch.eventos_layout, "")
})

test("hay al menos un preset por layout nuevo", () => {
  const layouts = new Set(SITIO_VENTA_PRESETS.map((p) => p.patch.eventos_layout))
  assert.ok(layouts.has("cartelera"), "falta un preset de Cartelera")
  assert.ok(layouts.has("agenda"), "falta un preset de Agenda")
})
