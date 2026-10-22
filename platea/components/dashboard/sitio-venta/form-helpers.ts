import { normalizeTenantInfoPages } from "@/lib/tenant"
import type { TenantInfoPage, TenantInfoPageKey } from "@/lib/tenant-info"
import { normalizeTenantHomeSections } from "@/lib/tenant-home-sections"
import type { TenantHomeSection } from "@/lib/tenant-home-sections"
import type { AnnouncementBar, GaleriaFotoItem, SitioVentaEmpresa, SitioVentaForm, SocialLinks, SupportFaqDraft } from "./types"

const SUPPORT_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function safeParseStringArray(value?: string | null, fallback: string[] = []) {
  if (!value) return fallback
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : fallback
  } catch {
    return fallback
  }
}

function normalizeFaqDraft(item: unknown, index: number): SupportFaqDraft | null {
  if (!item || typeof item !== "object") return null

  const candidate = item as Record<string, unknown>
  const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : `faq-${index + 1}`
  const question = typeof candidate.question === "string"
    ? candidate.question.trim()
    : typeof candidate.pregunta === "string"
      ? candidate.pregunta.trim()
      : ""
  const answer = typeof candidate.answer === "string"
    ? candidate.answer.trim()
    : typeof candidate.respuesta === "string"
      ? candidate.respuesta.trim()
      : ""

  if (!question || !answer) return null

  return {
    id,
    question,
    answer,
    hidden: Boolean(candidate.hidden),
  }
}

function normalizeFaqDrafts(value: unknown): SupportFaqDraft[] {
  if (!Array.isArray(value)) return []
  return value.map((item, index) => normalizeFaqDraft(item, index)).filter((item): item is SupportFaqDraft => item !== null)
}

function normalizeGaleriaFotoItem(item: unknown): GaleriaFotoItem | null {
  if (!item || typeof item !== "object") return null
  const candidate = item as Record<string, unknown>
  const id = typeof candidate.id === "string" && candidate.id.trim() ? candidate.id.trim() : null
  const url = typeof candidate.url === "string" ? candidate.url.trim() : ""
  if (!id || !url) return null
  return {
    id,
    url,
    titulo: typeof candidate.titulo === "string" ? candidate.titulo.trim() : "",
    visible: Boolean(candidate.visible),
  }
}

function parseGaleriaFotos(value: unknown): GaleriaFotoItem[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value
    if (!Array.isArray(parsed)) return []
    return parsed.map(normalizeGaleriaFotoItem).filter((item): item is GaleriaFotoItem => item !== null)
  } catch {
    return []
  }
}

function safeParseFaqArray(value?: SitioVentaEmpresa["faqs"]) {
  if (!value) return []
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value
    return normalizeFaqDrafts(parsed)
  } catch {
    return []
  }
}


const DEFAULT_ANNOUNCEMENT_BAR: AnnouncementBar = { text: "", link: "", link_label: "", style: "brand", enabled: false }
const DEFAULT_SOCIAL_LINKS: SocialLinks = { instagram: "", tiktok: "", facebook: "", x: "", youtube: "" }
const VALID_BORDER_RADII = new Set(["sharp", "soft", "rounded"])
const VALID_BUTTON_STYLES = new Set(["filled", "outline", "ghost"])
const VALID_FONTS_SET = new Set(["inter", "montserrat", "raleway", "bebas", "poppins", "space-grotesk", "dm-sans", "playfair"])
const VALID_CARD_COLUMNS = new Set(["1", "2", "3"])
const VALID_SECTION_SPACINGS = new Set(["compact", "normal", "spacious"])
const VALID_MOBILE_LAYOUTS = new Set(["lista", "cuadricula"])
const VALID_EVENT_CARD_STYLES = new Set(["clasico", "editorial"])
// Layout general del home. "" = clasico (default historico).
const VALID_EVENTOS_LAYOUTS = new Set(["clasico", "cartelera", "agenda"])

function normalizeAnnouncementBarDraft(value: unknown): AnnouncementBar {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_ANNOUNCEMENT_BAR }
  const v = value as Record<string, unknown>
  return {
    text: typeof v.text === "string" ? v.text : "",
    link: typeof v.link === "string" ? v.link : "",
    link_label: typeof v.link_label === "string" ? v.link_label : "",
    style: v.style === "warning" ? "warning" : "brand",
    enabled: Boolean(v.enabled),
  }
}

function normalizeSocialLinksDraft(value: unknown): SocialLinks {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { ...DEFAULT_SOCIAL_LINKS }
  const v = value as Record<string, unknown>
  return {
    instagram: typeof v.instagram === "string" ? v.instagram : "",
    tiktok: typeof v.tiktok === "string" ? v.tiktok : "",
    facebook: typeof v.facebook === "string" ? v.facebook : "",
    x: typeof v.x === "string" ? v.x : "",
    youtube: typeof v.youtube === "string" ? v.youtube : "",
  }
}

export function parseHomeSections(homeSections: unknown): TenantHomeSection[] {
  try {
    const parsed = typeof homeSections === "string" ? JSON.parse(homeSections) : homeSections
    if (!Array.isArray(parsed) || parsed.length === 0) return []
    return normalizeTenantHomeSections(parsed)
  } catch {
    return []
  }
}

export function sanitizeSitioVentaDraft(value: unknown): Partial<SitioVentaForm> {
  if (!value || typeof value !== "object") return {}

  const draft = value as Partial<SitioVentaForm>

  return {
    ...(typeof draft.nombre === "string" ? { nombre: draft.nombre } : {}),
    ...(typeof draft.descripcion === "string" ? { descripcion: draft.descripcion } : {}),
    ...(typeof draft.whatsapp === "string" ? { whatsapp: draft.whatsapp } : {}),
    ...(typeof draft.logo_url === "string" ? { logo_url: draft.logo_url } : {}),
    ...(typeof draft.favicon_url === "string" ? { favicon_url: draft.favicon_url } : {}),
    ...(draft.navbar_size === "small" || draft.navbar_size === "medium" || draft.navbar_size === "large" ? { navbar_size: draft.navbar_size } : {}),
    ...(typeof draft.logo_size === "string" ? { logo_size: draft.logo_size } : {}),
    ...(typeof draft.navbar_color === "string" ? { navbar_color: draft.navbar_color } : {}),
    ...(typeof draft.font === "string" ? { font: draft.font } : {}),
    ...(typeof draft.color_primario === "string" ? { color_primario: draft.color_primario } : {}),
    ...(typeof draft.color_fondo === "string" ? { color_fondo: draft.color_fondo } : {}),
    ...(typeof draft.color_texto === "string" ? { color_texto: draft.color_texto } : {}),
    ...(draft.desktop_event_card_size === "large" || draft.desktop_event_card_size === "medium" || draft.desktop_event_card_size === "small"
      ? { desktop_event_card_size: draft.desktop_event_card_size }
      : {}),
    ...(typeof draft.mostrar_descripcion_home === "boolean" ? { mostrar_descripcion_home: draft.mostrar_descripcion_home } : {}),
    ...(typeof draft.mostrar_tanda_activa_home === "boolean" ? { mostrar_tanda_activa_home: draft.mostrar_tanda_activa_home } : {}),
    ...(typeof draft.mostrar_badge_stock_home === "boolean" ? { mostrar_badge_stock_home: draft.mostrar_badge_stock_home } : {}),
    ...(typeof draft.mostrar_fecha_home === "boolean" ? { mostrar_fecha_home: draft.mostrar_fecha_home } : {}),
    ...(typeof draft.mostrar_lugar_home === "boolean" ? { mostrar_lugar_home: draft.mostrar_lugar_home } : {}),
    ...(typeof draft.mostrar_precio_home === "boolean" ? { mostrar_precio_home: draft.mostrar_precio_home } : {}),
    ...(typeof draft.titulo_eventos_home === "string" ? { titulo_eventos_home: draft.titulo_eventos_home } : {}),
    ...(typeof draft.subtitulo_eventos_home === "string" ? { subtitulo_eventos_home: draft.subtitulo_eventos_home } : {}),
    ...(typeof draft.cta_eventos_home === "string" ? { cta_eventos_home: draft.cta_eventos_home } : {}),
    ...(draft.banner_variant === "blurred" || draft.banner_variant === "full" ? { banner_variant: draft.banner_variant } : {}),
    ...(Array.isArray(draft.banners) ? { banners: draft.banners.filter((item): item is string => typeof item === "string") } : {}),
    ...(Array.isArray(draft.info_pages) ? { info_pages: normalizeTenantInfoPages(draft.info_pages) } : {}),
    ...(typeof draft.support_contact_email === "string" ? { support_contact_email: draft.support_contact_email } : {}),
    ...(Array.isArray(draft.faqs) ? { faqs: normalizeFaqDrafts(draft.faqs) } : {}),
    ...(Array.isArray(draft.galeria_fotos) ? { galeria_fotos: draft.galeria_fotos.map(normalizeGaleriaFotoItem).filter((item): item is GaleriaFotoItem => item !== null) } : {}),
    ...(Array.isArray(draft.sections) ? { sections: draft.sections } : {}),
    ...(draft.announcement_bar && typeof draft.announcement_bar === "object" && !Array.isArray(draft.announcement_bar)
      ? { announcement_bar: normalizeAnnouncementBarDraft(draft.announcement_bar) }
      : {}),
    ...(draft.social_links && typeof draft.social_links === "object" && !Array.isArray(draft.social_links)
      ? { social_links: normalizeSocialLinksDraft(draft.social_links) }
      : {}),
    ...(typeof draft.color_superficie === "string" ? { color_superficie: draft.color_superficie } : {}),
    ...(typeof draft.border_radius === "string" && (draft.border_radius === "" || VALID_BORDER_RADII.has(draft.border_radius)) ? { border_radius: draft.border_radius as SitioVentaForm["border_radius"] } : {}),
    ...(typeof draft.button_style === "string" && VALID_BUTTON_STYLES.has(draft.button_style) ? { button_style: draft.button_style as SitioVentaForm["button_style"] } : {}),
    ...(typeof draft.heading_font === "string" ? { heading_font: draft.heading_font } : {}),
    ...(typeof draft.navbar_blur === "boolean" ? { navbar_blur: draft.navbar_blur } : {}),
    ...(typeof draft.card_columns === "string" && (draft.card_columns === "" || VALID_CARD_COLUMNS.has(draft.card_columns)) ? { card_columns: draft.card_columns as SitioVentaForm["card_columns"] } : {}),
    ...(typeof draft.section_spacing === "string" && (draft.section_spacing === "" || VALID_SECTION_SPACINGS.has(draft.section_spacing)) ? { section_spacing: draft.section_spacing as SitioVentaForm["section_spacing"] } : {}),
    ...(typeof draft.mobile_event_layout === "string" && (draft.mobile_event_layout === "" || VALID_MOBILE_LAYOUTS.has(draft.mobile_event_layout)) ? { mobile_event_layout: draft.mobile_event_layout as SitioVentaForm["mobile_event_layout"] } : {}),
    ...(typeof draft.event_card_style === "string" && (draft.event_card_style === "" || VALID_EVENT_CARD_STYLES.has(draft.event_card_style)) ? { event_card_style: draft.event_card_style as SitioVentaForm["event_card_style"] } : {}),
    ...(typeof draft.eventos_layout === "string" && (draft.eventos_layout === "" || VALID_EVENTOS_LAYOUTS.has(draft.eventos_layout)) ? { eventos_layout: draft.eventos_layout as SitioVentaForm["eventos_layout"] } : {}),
  }
}

export function createSitioVentaInitialForm(empresa: SitioVentaEmpresa): SitioVentaForm {
  return {
    nombre: empresa.nombre ?? "",
    descripcion: empresa.descripcion ?? "",
    whatsapp: empresa.whatsapp ?? "",
    logo_url: empresa.logo_url ?? "",
    favicon_url: empresa.favicon_url ?? "",
    navbar_size: empresa.navbar_size === "small" ? "small" : empresa.navbar_size === "large" ? "large" : "medium",
    // "" = automatico (se deriva de navbar_size). Los tenants viejos vienen NULL.
    logo_size: empresa.logo_size ?? "",
    navbar_color: empresa.navbar_color ?? "",
    font: empresa.font ?? "",
    color_primario: empresa.color_primario ?? "#2563eb",
    color_fondo: empresa.color_fondo ?? "#000000",
    color_texto: empresa.color_texto ?? "#ffffff",
    desktop_event_card_size: empresa.desktop_event_card_size === "small" ? "small" : empresa.desktop_event_card_size === "medium" ? "medium" : "large",
    mostrar_descripcion_home: empresa.mostrar_descripcion_home !== false && Number(empresa.mostrar_descripcion_home ?? 1) === 1,
    mostrar_tanda_activa_home: empresa.mostrar_tanda_activa_home !== false && Number(empresa.mostrar_tanda_activa_home ?? 1) === 1,
    mostrar_badge_stock_home: empresa.mostrar_badge_stock_home !== false && Number(empresa.mostrar_badge_stock_home ?? 1) === 1,
    mostrar_fecha_home: empresa.mostrar_fecha_home !== false && Number(empresa.mostrar_fecha_home ?? 1) === 1,
    mostrar_lugar_home: empresa.mostrar_lugar_home !== false && Number(empresa.mostrar_lugar_home ?? 1) === 1,
    mostrar_precio_home: empresa.mostrar_precio_home !== false && Number(empresa.mostrar_precio_home ?? 1) === 1,
    titulo_eventos_home: empresa.titulo_eventos_home ?? "",
    subtitulo_eventos_home: empresa.subtitulo_eventos_home ?? "",
    cta_eventos_home: empresa.cta_eventos_home ?? "",
    banner_variant: empresa.banner_variant === "full" ? "full" : "blurred",
    banners: safeParseStringArray(empresa.banners),
    info_pages: normalizeTenantInfoPages(empresa.info_pages),
    support_contact_email: empresa.support_contact_email ?? "",
    faqs: safeParseFaqArray(empresa.faqs),
    galeria_fotos: parseGaleriaFotos(empresa.galeria_fotos),
    sections: parseHomeSections(empresa.home_sections),
    announcement_bar: normalizeAnnouncementBarDraft(empresa.announcement_bar),
    social_links: normalizeSocialLinksDraft(empresa.social_links),
    color_superficie: empresa.color_superficie ?? "",
    border_radius: (empresa.border_radius && VALID_BORDER_RADII.has(empresa.border_radius) ? empresa.border_radius : "") as SitioVentaForm["border_radius"],
    button_style: (empresa.button_style && VALID_BUTTON_STYLES.has(empresa.button_style) ? empresa.button_style : "filled") as SitioVentaForm["button_style"],
    heading_font: empresa.heading_font && VALID_FONTS_SET.has(empresa.heading_font) ? empresa.heading_font : "",
    navbar_blur: empresa.navbar_blur === true,
    card_columns: (empresa.card_columns && VALID_CARD_COLUMNS.has(empresa.card_columns) ? empresa.card_columns : "") as SitioVentaForm["card_columns"],
    section_spacing: (empresa.section_spacing && VALID_SECTION_SPACINGS.has(empresa.section_spacing) ? empresa.section_spacing : "") as SitioVentaForm["section_spacing"],
    mobile_event_layout: (empresa.mobile_event_layout && VALID_MOBILE_LAYOUTS.has(empresa.mobile_event_layout) ? empresa.mobile_event_layout : "") as SitioVentaForm["mobile_event_layout"],
    event_card_style: (empresa.event_card_style && VALID_EVENT_CARD_STYLES.has(empresa.event_card_style) ? empresa.event_card_style : "") as SitioVentaForm["event_card_style"],
    eventos_layout: (empresa.eventos_layout && VALID_EVENTOS_LAYOUTS.has(empresa.eventos_layout) ? empresa.eventos_layout : "") as SitioVentaForm["eventos_layout"],
  }
}

export function isValidSupportContactEmail(value: string) {
  return SUPPORT_EMAIL_REGEX.test(value.trim())
}

export function buildSitioVentaPayload(form: SitioVentaForm) {
  return {
    nombre: form.nombre.trim() || null,
    descripcion: form.descripcion.trim() || null,
    whatsapp: form.whatsapp.trim() || null,
    logo_url: form.logo_url.trim(),
    favicon_url: form.favicon_url.trim() || null,
    navbar_size: form.navbar_size,
    logo_size: form.logo_size,
    navbar_color: (() => {
      const trimmed = form.navbar_color.trim()
      if (!trimmed) return null
      return trimmed.toLowerCase() === form.color_primario.trim().toLowerCase() ? null : trimmed
    })(),
    font: form.font.trim() || null,
    color_primario: form.color_primario.trim(),
    color_fondo: form.color_fondo.trim(),
    color_texto: form.color_texto.trim(),
    desktop_event_card_size: form.desktop_event_card_size,
    mostrar_descripcion_home: form.mostrar_descripcion_home,
    mostrar_tanda_activa_home: form.mostrar_tanda_activa_home,
    mostrar_badge_stock_home: form.mostrar_badge_stock_home,
    mostrar_fecha_home: form.mostrar_fecha_home,
    mostrar_lugar_home: form.mostrar_lugar_home,
    mostrar_precio_home: form.mostrar_precio_home,
    titulo_eventos_home: form.titulo_eventos_home.trim(),
    subtitulo_eventos_home: form.subtitulo_eventos_home.trim(),
    cta_eventos_home: form.cta_eventos_home.trim(),
    banner_variant: form.banner_variant,
    banners: form.banners.map((banner) => banner.trim()).filter(Boolean),
    info_pages: form.info_pages.map((page) => ({
      key: page.key,
      title: page.title.trim(),
      content: page.content.trim(),
      enabled: page.enabled && page.content.trim().length > 0,
    })),
    support_contact_email: form.support_contact_email.trim() ? form.support_contact_email.trim() : null,
    faqs: form.faqs
      .map((faq) => ({
        id: faq.id.trim(),
        question: faq.question.trim(),
        answer: faq.answer.trim(),
        hidden: faq.hidden,
      }))
      .filter((faq) => faq.id && faq.question && faq.answer),
    galeria_fotos: form.galeria_fotos
      .filter((f) => f.url.trim())
      .map((f) => ({ id: f.id, url: f.url.trim(), titulo: f.titulo.trim(), visible: f.visible })),
    home_sections: form.sections,
    announcement_bar: {
      text: form.announcement_bar.text.trim(),
      link: form.announcement_bar.link?.trim() || undefined,
      link_label: form.announcement_bar.link_label?.trim() || undefined,
      style: form.announcement_bar.style,
      enabled: form.announcement_bar.enabled && !!form.announcement_bar.text.trim(),
    },
    social_links: {
      ...(form.social_links.instagram?.trim() ? { instagram: form.social_links.instagram.trim() } : {}),
      ...(form.social_links.tiktok?.trim() ? { tiktok: form.social_links.tiktok.trim() } : {}),
      ...(form.social_links.facebook?.trim() ? { facebook: form.social_links.facebook.trim() } : {}),
      ...(form.social_links.x?.trim() ? { x: form.social_links.x.trim() } : {}),
      ...(form.social_links.youtube?.trim() ? { youtube: form.social_links.youtube.trim() } : {}),
    },
    color_superficie: form.color_superficie.trim() || null,
    border_radius: form.border_radius || null,
    button_style: form.button_style,
    heading_font: form.heading_font.trim() || null,
    navbar_blur: form.navbar_blur,
    card_columns: form.card_columns || null,
    section_spacing: form.section_spacing || null,
    mobile_event_layout: form.mobile_event_layout || null,
    event_card_style: form.event_card_style || null,
    eventos_layout: form.eventos_layout || null,
  }
}

export function replaceInfoPage(pages: TenantInfoPage[], nextPage: TenantInfoPage) {
  return pages.map((page) => (page.key === nextPage.key ? nextPage : page))
}

export function getInfoPageByKey(pages: TenantInfoPage[], key: TenantInfoPageKey) {
  return pages.find((page) => page.key === key)
}
