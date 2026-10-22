import { hasMeaningfulRichText, sanitizeTenantRichText } from "@/lib/tenant-rich-text"

export type TenantHomeSectionType = "eventos" | "banner" | "galeria" | "banners_group" | "auspiciantes_carousel" | "texto_libre" | "countdown" | "video_embed" | "mapa" | "testimonios"

export type TenantHomeEventosSection = {
  id: string
  type: "eventos"
  visible?: boolean
}

export type TenantHomeBannerSection = {
  id: string
  type: "banner"
  title: string
  subtitle: string
  image_url: string
  cta_label: string
  cta_href: string
  visible?: boolean
}

export type TenantHomeSponsorItem = {
  id: string
  name: string
  logo_url: string
  href: string
}

export type TenantHomeSponsorsCarouselSection = {
  id: string
  type: "auspiciantes_carousel"
  title: string
  subtitle: string
  sponsors: TenantHomeSponsorItem[]
  visible?: boolean
}

export type TenantHomeGaleriaSection = {
  id: string
  type: "galeria"
  visible: boolean
}

export type TenantHomeBannerItem = {
  id: string
  title: string
  subtitle: string
  image_url: string
  cta_label: string
  cta_href: string
  visible: boolean
}

export type TenantHomeBannersGroupSection = {
  id: string
  type: "banners_group"
  visible: boolean
  variant?: "normal" | "full"
  banners: TenantHomeBannerItem[]
}

export type TenantHomeTextoLibreSection = {
  id: string
  type: "texto_libre"
  titulo: string
  /** HTML saneado (mismo Tiptap/sanitize-html que las páginas de información). */
  contenido_html: string
  visible?: boolean
}

export type TenantHomeCountdownModo = "proximo_evento" | "fecha_manual"

export type TenantHomeCountdownSection = {
  id: string
  type: "countdown"
  titulo: string
  modo: TenantHomeCountdownModo
  /**
   * Valor crudo de un input `datetime-local` (hora Argentina, sin offset —
   * excepción de tz explícita en CLAUDE.md). Solo se usa cuando modo === "fecha_manual".
   */
  fecha_manual: string
  /** Mensaje a mostrar cuando la cuenta regresiva llega a cero. */
  texto_finalizado: string
  visible?: boolean
}

export type TenantHomeVideoEmbedSection = {
  id: string
  type: "video_embed"
  /** URL cruda pegada por el usuario (YouTube o Instagram). El parseo a embed ID pasa siempre por `parseTenantHomeVideoEmbedUrl`, nunca se persiste el ID resuelto. */
  url: string
  visible?: boolean
}

export type TenantHomeMapaSection = {
  id: string
  type: "mapa"
  direccion: string
  /**
   * Guardados como texto crudo (igual criterio que `fecha_manual` en countdown)
   * en vez de number para que un input vacío o a medio escribir no fuerce NaN
   * en el estado del formulario. Se parsean con `parseTenantHomeMapaCoords`.
   */
  lat: string
  lng: string
  visible?: boolean
}

export type TenantHomeTestimonioItem = {
  id: string
  nombre: string
  texto: string
  rol: string
  url_foto: string
  /**
   * Vínculo opcional a un evento PASADO/finalizado del propio tenant — ancla el
   * testimonio a "esto pasó en tu evento X". Se resuelve del lado del servidor
   * (nunca se valida acá): si el evento fue borrado o ya no existe, el render
   * público cae con gracia al diseño de testimonio suelto (avatar genérico).
   */
  evento_id?: string
}

export type TenantHomeTestimoniosSection = {
  id: string
  type: "testimonios"
  titulo: string
  testimonios: TenantHomeTestimonioItem[]
  visible?: boolean
}

export type TenantHomeSection =
  | TenantHomeEventosSection
  | TenantHomeBannerSection
  | TenantHomeGaleriaSection
  | TenantHomeBannersGroupSection
  | TenantHomeSponsorsCarouselSection
  | TenantHomeTextoLibreSection
  | TenantHomeCountdownSection
  | TenantHomeVideoEmbedSection
  | TenantHomeMapaSection
  | TenantHomeTestimoniosSection

function normalizeText(value: unknown) {
  return typeof value === "string" ? value.trim() : ""
}

function createId(prefix: string) {
  return `${prefix}:${Math.random().toString(36).slice(2, 10)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function createTenantHomeEventosSection(id = "section-eventos"): TenantHomeEventosSection {
  return { id, type: "eventos", visible: true }
}

export function createTenantHomeBannerSection(): TenantHomeBannerSection {
  return {
    id: createId("banner"),
    type: "banner",
    title: "",
    subtitle: "",
    image_url: "",
    cta_label: "",
    cta_href: "",
  }
}

export function createTenantHomeSponsorItem(): TenantHomeSponsorItem {
  return {
    id: createId("sponsor"),
    name: "",
    logo_url: "",
    href: "",
  }
}

export function createTenantHomeSponsorsCarouselSection(id?: string): TenantHomeSponsorsCarouselSection {
  return {
    id: id ?? createId("auspiciantes"),
    type: "auspiciantes_carousel",
    title: "",
    subtitle: "",
    sponsors: [createTenantHomeSponsorItem(), createTenantHomeSponsorItem(), createTenantHomeSponsorItem()],
    visible: true,
  }
}

export function createTenantHomeGaleriaSection(): TenantHomeGaleriaSection {
  return { id: "section-galeria", type: "galeria", visible: true }
}

export function createTenantHomeBannerItem(): TenantHomeBannerItem {
  return { id: createId("banner-item"), title: "", subtitle: "", image_url: "", cta_label: "", cta_href: "", visible: true }
}

export function createTenantHomeBannersGroupSection(): TenantHomeBannersGroupSection {
  return { id: createId("banners-group"), type: "banners_group", visible: true, banners: [] }
}

export function createTenantHomeTextoLibreSection(): TenantHomeTextoLibreSection {
  return { id: createId("texto-libre"), type: "texto_libre", titulo: "", contenido_html: "", visible: true }
}

export function createTenantHomeCountdownSection(): TenantHomeCountdownSection {
  return { id: createId("countdown"), type: "countdown", titulo: "", modo: "proximo_evento", fecha_manual: "", texto_finalizado: "", visible: true }
}

export function createTenantHomeVideoEmbedSection(): TenantHomeVideoEmbedSection {
  return { id: createId("video-embed"), type: "video_embed", url: "", visible: true }
}

export function createTenantHomeMapaSection(): TenantHomeMapaSection {
  return { id: createId("mapa"), type: "mapa", direccion: "", lat: "", lng: "", visible: true }
}

export const MAX_TESTIMONIOS = 10

export function createTenantHomeTestimonioItem(): TenantHomeTestimonioItem {
  return { id: createId("testimonio"), nombre: "", texto: "", rol: "", url_foto: "", evento_id: "" }
}

export function createTenantHomeTestimoniosSection(): TenantHomeTestimoniosSection {
  return { id: createId("testimonios"), type: "testimonios", titulo: "", testimonios: [createTenantHomeTestimonioItem()], visible: true }
}

export function createDefaultTenantHomeSections(): TenantHomeSection[] {
  return [
    createTenantHomeEventosSection(),
    createTenantHomeGaleriaSection(),
    createTenantHomeBannersGroupSection(),
    createTenantHomeSponsorsCarouselSection("section-sponsors"),
  ]
}

export function normalizeTenantHomeSponsors(value: unknown): TenantHomeSponsorItem[] {
  if (!Array.isArray(value)) return []

  return value
    .filter(isRecord)
    .slice(0, 12)
    .map((item, index) => ({
      id: normalizeText(item.id) || `sponsor:${index}`,
      name: normalizeText(item.name),
      logo_url: normalizeText(item.logo_url),
      href: normalizeText(item.href),
    }))
}

export function normalizeTenantHomeTestimonios(value: unknown): TenantHomeTestimonioItem[] {
  if (!Array.isArray(value)) return []

  return value
    .filter(isRecord)
    .slice(0, MAX_TESTIMONIOS)
    .map((item, index) => ({
      id: normalizeText(item.id) || `testimonio:${index}`,
      nombre: normalizeText(item.nombre),
      texto: normalizeText(item.texto),
      rol: normalizeText(item.rol),
      url_foto: normalizeText(item.url_foto),
      evento_id: normalizeText(item.evento_id),
    }))
}

export function normalizeTenantHomeSections(value: unknown): TenantHomeSection[] {
  const raw = typeof value === "string"
    ? (() => {
        try {
          return JSON.parse(value)
        } catch {
          return null
        }
      })()
    : value

  if (!Array.isArray(raw)) return createDefaultTenantHomeSections()

  const normalized: TenantHomeSection[] = []
  let hasEventos = false

  for (const item of raw) {
    if (!isRecord(item)) continue

    const type = normalizeText(item.type) as TenantHomeSectionType
    const id = normalizeText(item.id) || createId(type || "section")
    const visible = item.visible !== false

    if (type === "eventos") {
      if (hasEventos) continue
      normalized.push({ id, type: "eventos", visible })
      hasEventos = true
      continue
    }

    if (type === "galeria") {
      normalized.push({ id, type: "galeria", visible })
      continue
    }

    if (type === "banners_group") {
      const rawBanners = Array.isArray(item.banners) ? item.banners : []
      const banners: TenantHomeBannerItem[] = rawBanners
        .filter(isRecord)
        .slice(0, 10)
        .map((b) => {
          const bid = normalizeText(b.id)
          if (!bid) return null
          return {
            id: bid,
            title: normalizeText(b.title),
            subtitle: normalizeText(b.subtitle),
            image_url: normalizeText(b.image_url),
            cta_label: normalizeText(b.cta_label),
            cta_href: normalizeText(b.cta_href),
            visible: b.visible !== false,
          }
        })
        .filter((b): b is TenantHomeBannerItem => b !== null)
      const rawVariant = normalizeText(item.variant)
      const variant: "normal" | "full" = rawVariant === "full" ? "full" : "normal"
      normalized.push({ id, type: "banners_group", visible, variant, banners })
      continue
    }

    if (type === "banner") {
      normalized.push({
        id,
        type: "banner",
        title: normalizeText(item.title),
        subtitle: normalizeText(item.subtitle),
        image_url: normalizeText(item.image_url),
        cta_label: normalizeText(item.cta_label),
        cta_href: normalizeText(item.cta_href),
        visible,
      })
      continue
    }

    if (type === "auspiciantes_carousel") {
      normalized.push({
        id,
        type: "auspiciantes_carousel",
        title: normalizeText(item.title),
        subtitle: normalizeText(item.subtitle),
        sponsors: normalizeTenantHomeSponsors(item.sponsors),
        visible,
      })
      continue
    }

    if (type === "texto_libre") {
      normalized.push({
        id,
        type: "texto_libre",
        titulo: normalizeText(item.titulo),
        contenido_html: sanitizeTenantRichText(typeof item.contenido_html === "string" ? item.contenido_html : ""),
        visible,
      })
      continue
    }

    if (type === "countdown") {
      const rawModo = normalizeText(item.modo)
      const modo: TenantHomeCountdownModo = rawModo === "fecha_manual" ? "fecha_manual" : "proximo_evento"
      normalized.push({
        id,
        type: "countdown",
        titulo: normalizeText(item.titulo),
        modo,
        fecha_manual: normalizeText(item.fecha_manual),
        texto_finalizado: normalizeText(item.texto_finalizado),
        visible,
      })
      continue
    }

    if (type === "video_embed") {
      normalized.push({
        id,
        type: "video_embed",
        url: normalizeText(item.url),
        visible,
      })
      continue
    }

    if (type === "mapa") {
      normalized.push({
        id,
        type: "mapa",
        direccion: normalizeText(item.direccion),
        lat: normalizeText(item.lat),
        lng: normalizeText(item.lng),
        visible,
      })
      continue
    }

    if (type === "testimonios") {
      normalized.push({
        id,
        type: "testimonios",
        titulo: normalizeText(item.titulo),
        testimonios: normalizeTenantHomeTestimonios(item.testimonios),
        visible,
      })
      continue
    }
  }

  if (!normalized.length) {
    normalized.push(createTenantHomeEventosSection())
  }

  return normalized
}

export function moveTenantHomeSection(sections: TenantHomeSection[], id: string, direction: -1 | 1) {
  const currentIndex = sections.findIndex((section) => section.id === id)
  const targetIndex = currentIndex + direction

  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= sections.length) return sections

  const next = [...sections]
  const [moved] = next.splice(currentIndex, 1)
  next.splice(targetIndex, 0, moved)
  return next
}

export function reorderTenantHomeSections(sections: TenantHomeSection[], orderedIds: string[]) {
  if (sections.length <= 1) return sections

  const byId = new Map(sections.map((section) => [section.id, section]))
  const orderedSections = orderedIds.map((id) => byId.get(id)).filter((section): section is TenantHomeSection => Boolean(section))

  if (orderedSections.length !== sections.length) return sections

  return orderedSections
}

export function insertTenantHomeSection(sections: TenantHomeSection[], afterId: string, nextSection: TenantHomeSection) {
  const currentIndex = sections.findIndex((section) => section.id === afterId)

  if (currentIndex < 0) return [...sections, nextSection]

  const next = [...sections]
  next.splice(currentIndex + 1, 0, nextSection)
  return next
}

export function hasRenderableBannerContent(section: Pick<TenantHomeBannerSection, 'title' | 'subtitle' | 'image_url' | 'cta_label'>) {
  return Boolean(section.title || section.subtitle || section.image_url || section.cta_label)
}

export function getRenderableSponsors(section: TenantHomeSponsorsCarouselSection) {
  return section.sponsors.filter((sponsor) => sponsor.name || sponsor.logo_url)
}

export function chunkSponsors(sponsors: TenantHomeSponsorItem[], size = 3) {
  const pages: TenantHomeSponsorItem[][] = []
  for (let index = 0; index < sponsors.length; index += size) {
    pages.push(sponsors.slice(index, index + size))
  }
  return pages
}

/** True si el bloque de texto libre tiene título o contenido HTML no-vacío para mostrar. */
export function hasRenderableTextoLibreContent(section: Pick<TenantHomeTextoLibreSection, "titulo" | "contenido_html">) {
  return Boolean(section.titulo.trim() || hasMeaningfulRichText(section.contenido_html))
}

export type TenantHomeVideoEmbedProvider = "youtube" | "instagram"

export type TenantHomeVideoEmbedParsed = {
  provider: TenantHomeVideoEmbedProvider
  embedSrc: string
}

// IDs de YouTube son base64url de 11 chars en la práctica, pero aceptamos un
// rango un poco más laxo (6-20) para no romper con formatos legacy/cortos.
const YOUTUBE_ID_RE = /^[a-zA-Z0-9_-]{6,20}$/
const INSTAGRAM_SHORTCODE_RE = /^\/(p|reel)\/([a-zA-Z0-9_-]+)/

/**
 * Parsea una URL de YouTube o Instagram pegada por el usuario en el editor a un
 * embed sin necesitar API key (YouTube `/embed/{id}`, Instagram `/p/{id}/embed`).
 * Devuelve null si la URL no matchea ningún formato conocido — el llamador
 * (editor o render público) decide qué hacer con eso (mostrar error / no renderizar).
 */
export function parseTenantHomeVideoEmbedUrl(rawUrl: string): TenantHomeVideoEmbedParsed | null {
  const trimmed = rawUrl.trim()
  if (!trimmed) return null

  let parsed: URL
  try {
    // Sin protocolo explícito (ej: "youtu.be/xyz") `new URL` tira — probamos con https:// como fallback.
    parsed = new URL(trimmed)
  } catch {
    try {
      parsed = new URL(`https://${trimmed}`)
    } catch {
      return null
    }
  }

  const host = parsed.hostname.replace(/^www\./, "").toLowerCase()

  if (host === "youtube.com" || host === "m.youtube.com" || host === "youtube-nocookie.com") {
    let videoId: string | null = null
    if (parsed.pathname === "/watch") {
      videoId = parsed.searchParams.get("v")
    } else if (parsed.pathname.startsWith("/shorts/")) {
      videoId = parsed.pathname.split("/")[2] ?? null
    } else if (parsed.pathname.startsWith("/embed/")) {
      videoId = parsed.pathname.split("/")[2] ?? null
    }
    if (videoId && YOUTUBE_ID_RE.test(videoId)) {
      return { provider: "youtube", embedSrc: `https://www.youtube.com/embed/${videoId}` }
    }
    return null
  }

  if (host === "youtu.be") {
    const videoId = parsed.pathname.split("/")[1] ?? null
    if (videoId && YOUTUBE_ID_RE.test(videoId)) {
      return { provider: "youtube", embedSrc: `https://www.youtube.com/embed/${videoId}` }
    }
    return null
  }

  if (host === "instagram.com") {
    const match = INSTAGRAM_SHORTCODE_RE.exec(parsed.pathname)
    if (match) {
      return { provider: "instagram", embedSrc: `https://www.instagram.com/p/${match[2]}/embed` }
    }
    return null
  }

  return null
}

/** Rango válido de coordenadas geográficas. */
function isValidLat(value: number) {
  return Number.isFinite(value) && value >= -90 && value <= 90
}
function isValidLng(value: number) {
  return Number.isFinite(value) && value >= -180 && value <= 180
}

/** Parsea los campos crudos `lat`/`lng` (texto) del bloque mapa a números válidos, o null si faltan/son inválidos. */
export function parseTenantHomeMapaCoords(lat: string, lng: string): { lat: number; lng: number } | null {
  const rawLat = lat.trim()
  const rawLng = lng.trim()
  if (!rawLat || !rawLng) return null

  const latNum = Number(rawLat)
  const lngNum = Number(rawLng)
  if (!isValidLat(latNum) || !isValidLng(lngNum)) return null

  return { lat: latNum, lng: lngNum }
}

/** Deep link "Cómo llegar" — funciona sin API key, prioriza coordenadas (más preciso) sobre texto libre. */
export function buildGoogleMapsDirectionsUrl(direccion: string, coords?: { lat: number; lng: number } | null): string {
  const destination = coords ? `${coords.lat},${coords.lng}` : direccion.trim()
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`
}

/** iframe embed de OpenStreetMap (sin API key) centrado en el punto, con un margen fijo de bbox. */
export function buildOsmEmbedSrc(lat: number, lng: number, deltaDeg = 0.01): string {
  const bbox = [lng - deltaDeg, lat - deltaDeg, lng + deltaDeg, lat + deltaDeg].join(",")
  const marker = `${lat},${lng}`
  return `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(marker)}`
}

/** True si el bloque mapa tiene dirección de texto o coordenadas válidas para mostrar. */
export function hasRenderableMapaContent(section: Pick<TenantHomeMapaSection, "direccion" | "lat" | "lng">) {
  return Boolean(section.direccion.trim()) || parseTenantHomeMapaCoords(section.lat, section.lng) !== null
}

/** Testimonios con al menos nombre y texto — los incompletos no se muestran en público. */
export function getRenderableTestimonios(section: Pick<TenantHomeTestimoniosSection, "testimonios">) {
  return section.testimonios.filter((t) => t.nombre.trim() && t.texto.trim())
}
