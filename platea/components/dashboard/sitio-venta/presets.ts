import type { SitioVentaForm } from "./types"

/**
 * Plantillas de fábrica del sitio de venta.
 *
 * Salen de las maquetas navegables de `marca/sitio-venta-v2/` (board de
 * escenarios, jul-2026): los dos layouts nuevos —Cartelera y Agenda— probados
 * contra casos reales (4 eventos, un solo evento, sin flyer, 6 fechas) y con
 * las paletas que se validaron ahí. Los colores son los de esas maquetas, no
 * inventados.
 *
 * ── Reglas de diseño de este módulo ──────────────────────────────────────────
 *
 * 1. UN PRESET SOLO TOCA ESTILO. Nunca contenido: ni nombre, ni logo, ni
 *    banners, ni FAQs, ni páginas de información, ni redes, ni secciones del
 *    home, ni los toggles de qué mostrar en la card. Aplicar una plantilla
 *    reestiliza el sitio; no borra lo que el cliente cargó.
 *
 * 2. NO SE APLICAN SOLOS. Se mergean sobre el form en memoria, igual que
 *    cualquier otro campo del editor: el cliente ve el preview y decide si
 *    guarda. Ninguna cuenta ya publicada cambia de aspecto por existir esto.
 */

/** Solo las claves de estilo. El resto del form queda intacto al aplicar. */
export type PresetPatch = Pick<
  SitioVentaForm,
  | "eventos_layout"
  | "color_primario"
  | "color_fondo"
  | "color_texto"
  | "color_superficie"
  | "navbar_color"
  | "navbar_blur"
  | "navbar_size"
  | "logo_size"
  | "font"
  | "heading_font"
  | "border_radius"
  | "button_style"
  | "desktop_event_card_size"
  | "card_columns"
  | "section_spacing"
  | "mobile_event_layout"
  | "event_card_style"
  | "banner_variant"
>

export type SitioVentaPreset = {
  id: string
  nombre: string
  /** Para qué tipo de cliente sirve. Es lo que el dueño lee para elegir. */
  descripcion: string
  /** Colores de la miniatura: [fondo, primario, superficie]. */
  swatch: [string, string, string]
  patch: PresetPatch
}

export const SITIO_VENTA_PRESETS: SitioVentaPreset[] = [
  {
    id: "cartelera-noche",
    nombre: "Cartelera · Noche",
    descripcion:
      "El próximo evento gigante arriba y el resto del finde abajo. Para boliches con flyer fuerte y varias fechas por semana.",
    swatch: ["#0b0b0b", "#ff4d6d", "#15181f"],
    patch: {
      eventos_layout: "cartelera",
      color_primario: "#ff4d6d",
      color_fondo: "#0b0b0b",
      color_texto: "#f7f7f5",
      color_superficie: "#15181f",
      navbar_color: "",
      navbar_blur: true,
      navbar_size: "medium",
      logo_size: "large",
      font: "inter",
      heading_font: "bebas",
      border_radius: "soft",
      button_style: "filled",
      desktop_event_card_size: "large",
      card_columns: "3",
      section_spacing: "normal",
      mobile_event_layout: "cuadricula",
      event_card_style: "editorial",
      banner_variant: "full",
    },
  },
  {
    id: "cartelera-under",
    nombre: "Cartelera · Under",
    descripcion:
      "Negro y lima, tipografía dura. Para fiestas de electrónica y techno donde el flyer manda y el line-up es el gancho.",
    swatch: ["#0b0b0b", "#c6ff00", "#1a2200"],
    patch: {
      eventos_layout: "cartelera",
      color_primario: "#c6ff00",
      color_fondo: "#0b0b0b",
      color_texto: "#eaeaea",
      color_superficie: "#1a2200",
      navbar_color: "#0b0b0b",
      navbar_blur: false,
      navbar_size: "small",
      logo_size: "large",
      font: "space-grotesk",
      heading_font: "bebas",
      border_radius: "sharp",
      button_style: "filled",
      desktop_event_card_size: "large",
      card_columns: "2",
      section_spacing: "spacious",
      mobile_event_layout: "cuadricula",
      event_card_style: "editorial",
      banner_variant: "full",
    },
  },
  {
    id: "agenda-noche",
    nombre: "Agenda · Noche",
    descripcion:
      "Lista compacta con fecha, precio y botón por fila. Para quien tiene muchas fechas y necesita que se comparen de un vistazo.",
    swatch: ["#0e1117", "#3ddc97", "#12151b"],
    patch: {
      eventos_layout: "agenda",
      color_primario: "#3ddc97",
      color_fondo: "#0e1117",
      color_texto: "#f2f4f8",
      color_superficie: "#12151b",
      navbar_color: "",
      navbar_blur: true,
      navbar_size: "small",
      logo_size: "medium",
      font: "inter",
      heading_font: "inter",
      border_radius: "soft",
      button_style: "filled",
      desktop_event_card_size: "small",
      card_columns: "1",
      section_spacing: "compact",
      mobile_event_layout: "lista",
      event_card_style: "clasico",
      banner_variant: "blurred",
    },
  },
  {
    id: "agenda-claro",
    nombre: "Agenda · Claro",
    descripcion:
      "Fondo claro y verde profundo, aire editorial. Para teatros, ciclos culturales y productoras que no son nightlife.",
    swatch: ["#f7f7f5", "#0f766e", "#ffffff"],
    patch: {
      eventos_layout: "agenda",
      color_primario: "#0f766e",
      color_fondo: "#f7f7f5",
      color_texto: "#15181f",
      color_superficie: "#ffffff",
      navbar_color: "#ffffff",
      navbar_blur: false,
      navbar_size: "medium",
      logo_size: "medium",
      font: "dm-sans",
      heading_font: "playfair",
      border_radius: "rounded",
      button_style: "filled",
      desktop_event_card_size: "medium",
      card_columns: "1",
      section_spacing: "normal",
      mobile_event_layout: "lista",
      event_card_style: "clasico",
      banner_variant: "blurred",
    },
  },
  {
    id: "clasico",
    nombre: "Clásico",
    descripcion:
      "La grilla de tarjetas de siempre, en azul sobre oscuro. Es el layout histórico: útil para volver atrás si probaste otro y no te convenció.",
    swatch: ["#0e1117", "#2563eb", "#12151b"],
    patch: {
      eventos_layout: "",
      color_primario: "#2563eb",
      color_fondo: "#0e1117",
      color_texto: "#f2f4f8",
      color_superficie: "#12151b",
      navbar_color: "",
      navbar_blur: true,
      navbar_size: "medium",
      logo_size: "",
      font: "inter",
      heading_font: "inter",
      border_radius: "soft",
      button_style: "filled",
      desktop_event_card_size: "medium",
      card_columns: "3",
      section_spacing: "normal",
      mobile_event_layout: "cuadricula",
      event_card_style: "clasico",
      banner_variant: "blurred",
    },
  },
]

/** Mergea el preset sobre el form actual sin tocar el contenido cargado. */
export function aplicarPreset(form: SitioVentaForm, preset: SitioVentaPreset): SitioVentaForm {
  return { ...form, ...preset.patch }
}
