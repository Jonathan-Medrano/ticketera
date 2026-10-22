import type { GaleriaFotoItem, AnnouncementBar, SocialLinks } from "@/lib/tenant"
import type { TenantInfoPage } from "@/lib/tenant-info"
import type { TenantHomeSection } from "@/lib/tenant-home-sections"

export type { GaleriaFotoItem, AnnouncementBar, SocialLinks }

export type SupportFaqDraft = {
  id: string
  question: string
  answer: string
  hidden: boolean
}

/** Evento pasado/finalizado del tenant — opciones para el selector "Vincular a un evento" del bloque testimonios. */
export type EventoPasadoOption = {
  id: string
  nombre: string
  imagen_url: string | null
}

export type SitioVentaForm = {
  nombre: string
  descripcion: string
  whatsapp: string
  logo_url: string
  favicon_url: string
  navbar_size: "small" | "medium" | "large"
  // "" = automatico: se deriva de navbar_size (ver lib/tenant-logo.ts)
  logo_size: "" | "small" | "medium" | "large" | "xl"
  navbar_color: string
  font: string
  color_primario: string
  color_fondo: string
  color_texto: string
  desktop_event_card_size: "large" | "medium" | "small"
  mostrar_descripcion_home: boolean
  mostrar_tanda_activa_home: boolean
  mostrar_badge_stock_home: boolean
  mostrar_fecha_home: boolean
  mostrar_lugar_home: boolean
  mostrar_precio_home: boolean
  titulo_eventos_home: string
  subtitulo_eventos_home: string
  cta_eventos_home: string
  banner_variant: "blurred" | "full"
  banners: string[]
  info_pages: TenantInfoPage[]
  support_contact_email: string
  faqs: SupportFaqDraft[]
  galeria_fotos: GaleriaFotoItem[]
  sections: TenantHomeSection[]
  announcement_bar: AnnouncementBar
  social_links: SocialLinks
  color_superficie: string
  border_radius: "sharp" | "soft" | "rounded" | ""
  button_style: "filled" | "outline" | "ghost"
  heading_font: string
  navbar_blur: boolean
  card_columns: "1" | "2" | "3" | ""
  section_spacing: "compact" | "normal" | "spacious" | ""
  mobile_event_layout: "lista" | "cuadricula" | ""
  event_card_style: "clasico" | "editorial" | ""
  /** "" = clasico (default historico). No cambiar solo para tenants ya publicados. */
  eventos_layout: "clasico" | "cartelera" | "agenda" | ""
}

export type SitioVentaEmpresa = {
  id: string
  nombre?: string | null
  slug: string
  descripcion?: string | null
  whatsapp?: string | null
  logo_url?: string | null
  favicon_url?: string | null
  navbar_size?: "small" | "medium" | "large" | null
  logo_size?: "small" | "medium" | "large" | "xl" | null
  navbar_color?: string | null
  font?: string | null
  color_primario?: string | null
  color_fondo?: string | null
  color_texto?: string | null
  desktop_event_card_size?: "large" | "medium" | "small" | null
  // MariaDB TINYINT(1) retorna number o boolean según el driver — normalizar con Number()
  mostrar_descripcion_home?: number | boolean
  mostrar_tanda_activa_home?: number | boolean
  mostrar_badge_stock_home?: number | boolean
  mostrar_fecha_home?: number | boolean
  mostrar_lugar_home?: number | boolean
  mostrar_precio_home?: number | boolean
  titulo_eventos_home?: string | null
  subtitulo_eventos_home?: string | null
  cta_eventos_home?: string | null
  banner_variant?: "blurred" | "full" | null
  banners?: string | null
  info_pages?: string | TenantInfoPage[] | null
  support_contact_email?: string | null
  faqs?: string | SupportFaqDraft[] | Array<{ pregunta: string; respuesta: string }> | Array<{ question: string; answer: string; hidden?: boolean; id?: string }> | null
  galeria_fotos?: string | GaleriaFotoItem[] | null
  home_sections?: string | null
  announcement_bar?: AnnouncementBar | Record<string, unknown> | null
  social_links?: SocialLinks | Record<string, unknown> | null
  color_superficie?: string | null
  border_radius?: string | null
  button_style?: string | null
  heading_font?: string | null
  navbar_blur?: boolean | null
  card_columns?: string | null
  section_spacing?: string | null
  mobile_event_layout?: string | null
  event_card_style?: string | null
  eventos_layout?: string | null
}
