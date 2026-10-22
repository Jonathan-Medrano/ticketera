import { Router, Request, Response } from 'express'
import { requireAuth, verifyInternal } from '../middleware/auth'
import { prisma } from '../lib/prisma'
import type { Permisos } from '../lib/permisos'
import { getActorEmpresaId, requirePermissionMiddleware } from '../lib/authz'
import { assertTenantSlugAvailable } from '../lib/tenant-slug'
import { logServerError } from '../lib/safe-log'
import { actorFromRequest, logAuditEvent } from '../lib/audit-log'
import { normalizeSupportFaqCollection } from '../lib/support-faqs'
import { revalidateTenantPath } from '../lib/revalidate-tenant'
import { sanitizeTenantRichText } from '../lib/tenant-rich-text'

const router = Router()
const VALID_BANNER_VARIANTS = new Set(['blurred', 'full'])
const VALID_NAVBAR_SIZES = new Set(['small', 'medium', 'large'])
// El logo tiene su propia escala, con un paso mas arriba que la navbar.
// '' (string vacio) se acepta y se guarda como NULL = "derivar de navbar_size".
const VALID_LOGO_SIZES = new Set(['small', 'medium', 'large', 'xl'])
const VALID_DESKTOP_EVENT_CARD_SIZES = new Set(['large', 'medium', 'small'])
const VALID_FONTS = new Set(['inter', 'montserrat', 'raleway', 'bebas', 'poppins', 'space-grotesk', 'dm-sans', 'playfair'])
const VALID_ANNOUNCEMENT_STYLES = new Set(['brand', 'warning'])
const VALID_SOCIAL_PLATFORMS = ['instagram', 'tiktok', 'facebook', 'x', 'youtube'] as const
const VALID_BORDER_RADII = new Set(['sharp', 'soft', 'rounded', 'pill'])
const VALID_BUTTON_STYLES = new Set(['filled', 'outline', 'ghost'])
const VALID_CARD_COLUMNS = new Set(['1', '2', '3'])
const VALID_SECTION_SPACINGS = new Set(['compact', 'normal', 'spacious'])
const VALID_MOBILE_LAYOUTS = new Set(['lista', 'cuadricula'])
const VALID_EVENT_CARD_STYLES = new Set(['clasico', 'editorial'])
// Layout general del home publico. Vacio/null = "clasico", que es el layout historico:
// no cambiarlo por defecto, los tenants ya publicados no deben mutar solos.
const VALID_EVENTOS_LAYOUTS = new Set(['clasico', 'cartelera', 'agenda'])
const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const SAFE_URL_RE = /^https?:\/\//i
const MAX_BANNERS = 5
const MAX_GALERIA_FOTOS = 20
const VALID_HOME_SECTION_TYPES = new Set(['eventos', 'banner', 'galeria', 'banners_group', 'auspiciantes_carousel', 'texto_libre', 'countdown', 'video_embed', 'mapa', 'testimonios'])
const VALID_COUNTDOWN_MODES = new Set(['proximo_evento', 'fecha_manual'])
const MAX_TESTIMONIOS = 10
const VALID_INFO_PAGE_KEYS = new Set(['contacto', 'arrepentimiento', 'terminos', 'privacidad', 'defensa_consumidor', 'eliminar_cuenta'])
const SUPPORT_EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v)
}

function isValidBannerVariant(value: unknown): value is 'blurred' | 'full' {
  return typeof value === 'string' && VALID_BANNER_VARIANTS.has(value)
}

function isValidNavbarSize(value: unknown): value is 'small' | 'medium' | 'large' {
  return typeof value === 'string' && VALID_NAVBAR_SIZES.has(value)
}

function isValidLogoSize(value: unknown): value is 'small' | 'medium' | 'large' | 'xl' | '' {
  return typeof value === 'string' && (value === '' || VALID_LOGO_SIZES.has(value))
}

function isValidDesktopEventCardSize(value: unknown): value is 'large' | 'medium' | 'small' {
  return typeof value === 'string' && VALID_DESKTOP_EVENT_CARD_SIZES.has(value)
}

function normalizeBannersPayload(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null
  if (value.length > MAX_BANNERS) return null

  const normalized: string[] = []
  for (const item of value) {
    if (typeof item !== 'string') return null

    const trimmed = item.trim()
    if (!trimmed) return null
    normalized.push(trimmed)
  }

  return normalized
}

function normalizeHomeSectionsPayload(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) return null

  const normalized: Array<Record<string, unknown>> = []

  for (const item of value) {
    if (!isRecord(item)) return null

    const record = item as Record<string, unknown>
    const type = typeof record.type === 'string' ? record.type.trim() : ''
    const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : `${type || 'section'}-${normalized.length}`

    if (!VALID_HOME_SECTION_TYPES.has(type)) return null

    if (type === 'eventos') {
      normalized.push({ id, type, visible: record.visible !== false })
      continue
    }

    if (type === 'galeria') {
      normalized.push({ id, type, visible: record.visible !== false })
      continue
    }

    if (type === 'banners_group') {
      const banners = Array.isArray(record.banners) ? record.banners.slice(0, 10) : []
      const normalizedBanners = banners.map((b: unknown) => {
        if (!isRecord(b)) return null
        const br = b as Record<string, unknown>
        const bid = typeof br.id === 'string' && br.id.trim() ? br.id.trim() : null
        if (!bid) return null
        return {
          id: bid,
          title: typeof br.title === 'string' ? br.title.trim() : '',
          subtitle: typeof br.subtitle === 'string' ? br.subtitle.trim() : '',
          image_url: typeof br.image_url === 'string' ? br.image_url.trim() : '',
          cta_label: typeof br.cta_label === 'string' ? br.cta_label.trim() : '',
          cta_href: typeof br.cta_href === 'string' ? br.cta_href.trim() : '',
          visible: br.visible !== false,
        }
      }).filter(Boolean)
      normalized.push({ id, type, visible: record.visible !== false, banners: normalizedBanners })
      continue
    }

    if (type === 'banner') {
      normalized.push({
        id,
        type,
        title: typeof record.title === 'string' ? record.title.trim() : '',
        subtitle: typeof record.subtitle === 'string' ? record.subtitle.trim() : '',
        image_url: typeof record.image_url === 'string' ? record.image_url.trim() : '',
        cta_label: typeof record.cta_label === 'string' ? record.cta_label.trim() : '',
        cta_href: typeof record.cta_href === 'string' ? record.cta_href.trim() : '',
        visible: record.visible !== false,
      })
      continue
    }

    if (type === 'auspiciantes_carousel') {
      if (!Array.isArray(record.sponsors)) return null

      const sponsors = record.sponsors.slice(0, 12).map((sponsor, index) => {
        if (!isRecord(sponsor)) return null
        const sponsorRecord = sponsor as Record<string, unknown>
        return {
          id: typeof sponsorRecord.id === 'string' && sponsorRecord.id.trim() ? sponsorRecord.id.trim() : `sponsor-${index}`,
          name: typeof sponsorRecord.name === 'string' ? sponsorRecord.name.trim() : '',
          logo_url: typeof sponsorRecord.logo_url === 'string' ? sponsorRecord.logo_url.trim() : '',
          href: typeof sponsorRecord.href === 'string' ? sponsorRecord.href.trim() : '',
        }
      })

      if (sponsors.some((sponsor) => sponsor === null)) return null

      normalized.push({
        id,
        type,
        title: typeof record.title === 'string' ? record.title.trim() : '',
        subtitle: typeof record.subtitle === 'string' ? record.subtitle.trim() : '',
        sponsors,
        visible: record.visible !== false,
      })
      continue
    }

    if (type === 'texto_libre') {
      const rawHtml = typeof record.contenido_html === 'string' ? record.contenido_html : ''
      normalized.push({
        id,
        type,
        titulo: typeof record.titulo === 'string' ? record.titulo.trim() : '',
        // El cliente ya sanea (RichTextEditor + render), pero saneamos también acá
        // para que la DB nunca persista HTML no confiable si alguien pega directo
        // a esta API sin pasar por la UI.
        contenido_html: rawHtml ? sanitizeTenantRichText(rawHtml) : '',
        visible: record.visible !== false,
      })
      continue
    }

    if (type === 'countdown') {
      const modo = typeof record.modo === 'string' && VALID_COUNTDOWN_MODES.has(record.modo) ? record.modo : 'proximo_evento'
      normalized.push({
        id,
        type,
        titulo: typeof record.titulo === 'string' ? record.titulo.trim() : '',
        modo,
        fecha_manual: typeof record.fecha_manual === 'string' ? record.fecha_manual.trim() : '',
        texto_finalizado: typeof record.texto_finalizado === 'string' ? record.texto_finalizado.trim() : '',
        visible: record.visible !== false,
      })
      continue
    }

    if (type === 'video_embed') {
      // La URL se persiste como texto crudo; el parseo a embed ID (YouTube/Instagram,
      // sin API key) pasa por parseTenantHomeVideoEmbedUrl del lado del cliente en
      // cada render — si no matchea ningún formato conocido el bloque simplemente
      // no se muestra en público, nunca se guarda un embed roto acá.
      normalized.push({
        id,
        type,
        url: typeof record.url === 'string' ? record.url.trim() : '',
        visible: record.visible !== false,
      })
      continue
    }

    if (type === 'mapa') {
      // lat/lng se guardan como texto (mismo criterio que fecha_manual en countdown)
      // para no forzar NaN sobre un input a medio completar; se validan/parsean
      // recién en el render público.
      normalized.push({
        id,
        type,
        direccion: typeof record.direccion === 'string' ? record.direccion.trim() : '',
        lat: typeof record.lat === 'string' ? record.lat.trim() : '',
        lng: typeof record.lng === 'string' ? record.lng.trim() : '',
        visible: record.visible !== false,
      })
      continue
    }

    if (type === 'testimonios') {
      if (!Array.isArray(record.testimonios)) return null

      const testimonios = record.testimonios.slice(0, MAX_TESTIMONIOS).map((testimonio, index) => {
        if (!isRecord(testimonio)) return null
        const testimonioRecord = testimonio as Record<string, unknown>
        // evento_id es opcional y NO se valida contra la DB en esta capa —
        // el render público resuelve el evento y cae con gracia si no existe/borrado.
        const eventoId = typeof testimonioRecord.evento_id === 'string' ? testimonioRecord.evento_id.trim() : ''
        return {
          id: typeof testimonioRecord.id === 'string' && testimonioRecord.id.trim() ? testimonioRecord.id.trim() : `testimonio-${index}`,
          nombre: typeof testimonioRecord.nombre === 'string' ? testimonioRecord.nombre.trim() : '',
          texto: typeof testimonioRecord.texto === 'string' ? testimonioRecord.texto.trim() : '',
          rol: typeof testimonioRecord.rol === 'string' ? testimonioRecord.rol.trim() : '',
          url_foto: typeof testimonioRecord.url_foto === 'string' ? testimonioRecord.url_foto.trim() : '',
          ...(eventoId ? { evento_id: eventoId } : {}),
        }
      })

      if (testimonios.some((testimonio) => testimonio === null)) return null

      normalized.push({
        id,
        type,
        titulo: typeof record.titulo === 'string' ? record.titulo.trim() : '',
        testimonios,
        visible: record.visible !== false,
      })
      continue
    }
  }

  // Compat: el listado de eventos es la sección núcleo del storefront -- un tenant
  // nunca debería poder terminar sin ella (a proposito o por un payload armado a mano
  // que no la incluya). Si no vino ninguna sección 'eventos' en el array, la
  // agregamos al frente en vez de solo cubrir el caso de array vacío.
  if (!normalized.some((section) => section.type === 'eventos')) {
    normalized.unshift({ id: 'section-eventos', type: 'eventos', visible: true })
  }

  return normalized
}

function normalizeInfoPagesPayload(value: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(value)) return null

  const normalized: Array<Record<string, unknown>> = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null

    const record = item as Record<string, unknown>
    const key = typeof record.key === 'string' ? record.key.trim() : ''
    if (!VALID_INFO_PAGE_KEYS.has(key)) return null

    const rawContent = typeof record.content === 'string' ? record.content.trim() : ''
    normalized.push({
      key,
      title: typeof record.title === 'string' ? record.title.trim() : '',
      content: rawContent ? sanitizeTenantRichText(rawContent) : '',
      enabled: Boolean(record.enabled),
    })
  }

  return normalized
}

function normalizeSupportContactEmail(value: unknown): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return ''
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!trimmed) return ''

  return SUPPORT_EMAIL_REGEX.test(trimmed) ? trimmed : null
}

type GaleriaFotoNormalized = { id: string; url: string; titulo: string; visible: boolean }

function normalizeGaleriaFotosPayload(value: unknown): GaleriaFotoNormalized[] | null {
  if (!Array.isArray(value)) return null
  if (value.length > MAX_GALERIA_FOTOS) return null

  const normalized: GaleriaFotoNormalized[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null
    const record = item as Record<string, unknown>

    const id = typeof record.id === 'string' && record.id.trim() ? record.id.trim() : null
    const url = typeof record.url === 'string' ? record.url.trim() : ''
    if (!id || !url) return null

    normalized.push({
      id,
      url,
      titulo: typeof record.titulo === 'string' ? record.titulo.trim() : '',
      visible: Boolean(record.visible),
    })
  }
  return normalized
}

function normalizeFaqPayload(value: unknown) {
  if (!Array.isArray(value)) return null
  return normalizeSupportFaqCollection(value)
}

type AnnouncementBarNormalized = { text: string; link: string; link_label: string; style: string; enabled: boolean }

function normalizeAnnouncementBarPayload(value: unknown): AnnouncementBarNormalized | null | undefined {
  if (value === undefined) return undefined
  if (value === null || !isRecord(value)) return null
  const text = typeof value.text === 'string' ? value.text.trim().slice(0, 200) : ''
  const rawLink = typeof value.link === 'string' ? value.link.trim().slice(0, 500) : ''
  return {
    text,
    link: rawLink && SAFE_URL_RE.test(rawLink) ? rawLink : '',
    link_label: typeof value.link_label === 'string' ? value.link_label.trim().slice(0, 50) : '',
    style: typeof value.style === 'string' && VALID_ANNOUNCEMENT_STYLES.has(value.style as string) ? value.style : 'brand',
    enabled: value.enabled !== false && !!text,
  }
}

type SocialLinksNormalized = { [K in typeof VALID_SOCIAL_PLATFORMS[number]]?: string }

function normalizeSocialLinksPayload(value: unknown): SocialLinksNormalized | null | undefined {
  if (value === undefined) return undefined
  if (value === null || !isRecord(value)) return null
  const result: SocialLinksNormalized = {}
  for (const platform of VALID_SOCIAL_PLATFORMS) {
    const v = value[platform]
    const trimmed = typeof v === 'string' ? v.trim() : ''
    if (trimmed && SAFE_URL_RE.test(trimmed)) result[platform] = trimmed.slice(0, 500)
  }
  return result
}

function resolveEmpresaContext(req: Request) {
  const user = req.user!

  return {
    empresaId: getActorEmpresaId(user),
    esEmpleado: user.userType === 'empleado',
    permisos: user.permisos as Permisos | undefined,
  }
}

router.get('/', verifyInternal, requireAuth, requirePermissionMiddleware('ver_configuracion'), async (req: Request, res: Response) => {
  try {
    const resolved = resolveEmpresaContext(req)
    if (!resolved.empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const empresa = await prisma.empresa.findUnique({
      where: { id: resolved.empresaId },
      select: {
        id: true,
        nombre: true,
        slug: true,
        descripcion: true,
        whatsapp: true,
        logo_url: true,
        favicon_url: true,
        navbar_size: true,
        logo_size: true,
        navbar_color: true,
        font: true,
        color_primario: true,
        color_fondo: true,
        color_texto: true,
        desktop_event_card_size: true,
        mostrar_descripcion_home: true,
        mostrar_tanda_activa_home: true,
        mostrar_badge_stock_home: true,
        mostrar_fecha_home: true,
        mostrar_lugar_home: true,
        mostrar_precio_home: true,
        titulo_eventos_home: true,
        subtitulo_eventos_home: true,
        cta_eventos_home: true,
        banner_variant: true,
        banners: true,
        home_sections: true,
        info_pages: true,
        support_contact_email: true,
        faqs: true,
        galeria_fotos: true,
        announcement_bar: true,
        social_links: true,
        color_superficie: true,
        border_radius: true,
        button_style: true,
        heading_font: true,
        navbar_blur: true,
        card_columns: true,
        section_spacing: true,
        mobile_event_layout: true,
        event_card_style: true,
        eventos_layout: true,
      },
    })

    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    return res.json({ data: empresa })
  } catch {
    logServerError('sitio-venta get')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.patch('/', verifyInternal, requireAuth, requirePermissionMiddleware('editar_configuracion'), async (req: Request, res: Response) => {
  try {
    const resolved = resolveEmpresaContext(req)
    if (!resolved.empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const body = req.body as Record<string, unknown>
    const updates: string[] = []
    const values: unknown[] = []
    let changedSlug: string | null = null

    if (body.imagen_hero !== undefined || body.imagen_footer !== undefined || body.footer_texto !== undefined) {
      return res.status(400).json({ error: 'imagen_hero, imagen_footer y footer_texto ya no forman parte del contrato de sitio de venta' })
    }

    if (body.slug !== undefined) {
      if (!body.slug || typeof body.slug !== 'string' || !body.slug.trim()) {
        return res.status(400).json({ error: 'El subdominio es obligatorio' })
      }
      let slug: string
      try {
        slug = await assertTenantSlugAvailable(body.slug, String(resolved.empresaId))
      } catch (error) {
        if (error instanceof Error && (error.message === 'El subdominio ya está en uso' || error.message.startsWith('El subdominio') || error.message === 'Ese subdominio está reservado y no se puede usar')) {
          return res.status(error.message === 'El subdominio ya está en uso' ? 409 : 400).json({ error: error.message })
        }
        throw error
      }
      changedSlug = slug
      updates.push('slug = ?')
      values.push(slug)
    }

    const nullableTextFields = [
      'descripcion',
      'whatsapp',
      'logo_url',
      'favicon_url',
      'titulo_eventos_home',
      'subtitulo_eventos_home',
      'cta_eventos_home',
    ] as const

    for (const field of nullableTextFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = ?`)
        values.push(typeof body[field] === 'string' && body[field].trim() ? body[field].trim() : null)
      }
    }

    if (body.navbar_size !== undefined) {
      if (!isValidNavbarSize(body.navbar_size)) {
        return res.status(400).json({ error: 'navbar_size debe ser small, medium o large' })
      }
      updates.push('navbar_size = ?')
      values.push(body.navbar_size)
    }

    if (body.logo_size !== undefined) {
      if (!isValidLogoSize(body.logo_size)) {
        return res.status(400).json({ error: 'logo_size debe ser small, medium, large o xl' })
      }
      updates.push('logo_size = ?')
      // '' => NULL => "derivar de navbar_size" (comportamiento historico)
      values.push(body.logo_size === '' ? null : body.logo_size)
    }

    const colorFields = ['color_primario', 'color_fondo', 'color_texto'] as const
    for (const field of colorFields) {
      if (body[field] !== undefined) {
        const value = typeof body[field] === 'string' ? body[field].trim() : ''
        if (!value) {
          return res.status(400).json({ error: `${field} es obligatorio` })
        }
        if (!HEX_COLOR_RE.test(value)) {
          return res.status(400).json({ error: `${field} debe ser un color hexadecimal válido (ej: #FF5500)` })
        }
        updates.push(`${field} = ?`)
        values.push(value)
      }
    }

    if (body.navbar_color !== undefined) {
      const navbarColorValue = typeof body.navbar_color === 'string' ? body.navbar_color.trim() : ''
      if (navbarColorValue && !HEX_COLOR_RE.test(navbarColorValue)) {
        return res.status(400).json({ error: 'navbar_color debe ser un color hexadecimal válido (ej: #FF5500) o vacío' })
      }
      updates.push('navbar_color = ?')
      values.push(navbarColorValue || null)
    }

    if (body.font !== undefined) {
      const fontValue = typeof body.font === 'string' ? body.font.trim() : ''
      if (fontValue && !VALID_FONTS.has(fontValue)) {
        return res.status(400).json({ error: `font debe ser uno de: ${[...VALID_FONTS].join(', ')} — o vacío para la fuente predeterminada` })
      }
      updates.push('font = ?')
      values.push(fontValue || null)
    }

    if (body.desktop_event_card_size !== undefined) {
      if (!isValidDesktopEventCardSize(body.desktop_event_card_size)) {
        return res.status(400).json({ error: 'desktop_event_card_size debe ser large, medium o small' })
      }
      updates.push('desktop_event_card_size = ?')
      values.push(body.desktop_event_card_size)
    }

    const booleanFields = [
      'mostrar_descripcion_home',
      'mostrar_tanda_activa_home',
      'mostrar_badge_stock_home',
      'mostrar_fecha_home',
      'mostrar_lugar_home',
      'mostrar_precio_home',
    ] as const

    for (const field of booleanFields) {
      if (body[field] !== undefined) {
        updates.push(`${field} = ?`)
        values.push(Boolean(body[field]))
      }
    }

    if (body.banner_variant !== undefined) {
      if (!isValidBannerVariant(body.banner_variant)) {
        return res.status(400).json({ error: 'banner_variant debe ser blurred o full' })
      }
      updates.push('banner_variant = ?')
      values.push(body.banner_variant)
    }

    if (body.banners !== undefined) {
      const banners = normalizeBannersPayload(body.banners)
      if (!banners) {
        return res.status(400).json({ error: 'banners debe ser un array de strings no vacíos' })
      }
      updates.push('banners = ?')
      values.push(JSON.stringify(banners))
    }

    if (body.home_sections !== undefined) {
      const homeSections = normalizeHomeSectionsPayload(body.home_sections)
      if (!homeSections) {
        return res.status(400).json({ error: 'home_sections debe ser un array válido de secciones configurables' })
      }
      updates.push('home_sections = ?')
      values.push(JSON.stringify(homeSections))
    }

    if (body.info_pages !== undefined) {
      const infoPages = normalizeInfoPagesPayload(body.info_pages)
      if (!infoPages) {
        return res.status(400).json({ error: 'info_pages debe ser un array válido de páginas informativas' })
      }
      updates.push('info_pages = ?')
      values.push(JSON.stringify(infoPages))
    }

    if (body.support_contact_email !== undefined) {
      const supportContactEmail = normalizeSupportContactEmail(body.support_contact_email)
      if (supportContactEmail === null) {
        return res.status(400).json({ error: 'support_contact_email debe ser un email válido o vacío' })
      }
      updates.push('support_contact_email = ?')
      values.push(supportContactEmail || null)
    }

    if (body.faqs !== undefined) {
      const faqs = normalizeFaqPayload(body.faqs)
      if (!faqs) {
        return res.status(400).json({ error: 'faqs debe ser un array' })
      }
      updates.push('faqs = ?')
      values.push(JSON.stringify(faqs))
    }

    if (body.galeria_fotos !== undefined) {
      const galeriaFotos = normalizeGaleriaFotosPayload(body.galeria_fotos)
      if (!galeriaFotos) {
        return res.status(400).json({ error: 'galeria_fotos debe ser un array válido de fotos' })
      }
      updates.push('galeria_fotos = ?')
      values.push(JSON.stringify(galeriaFotos))
    }

    if (body.announcement_bar !== undefined) {
      const bar = normalizeAnnouncementBarPayload(body.announcement_bar)
      if (bar === null) {
        return res.status(400).json({ error: 'announcement_bar debe ser un objeto con campos text, style y enabled' })
      }
      updates.push('announcement_bar = ?')
      values.push(bar)
    }

    if (body.social_links !== undefined) {
      const links = normalizeSocialLinksPayload(body.social_links)
      if (links === null) {
        return res.status(400).json({ error: 'social_links debe ser un objeto con campos instagram, tiktok, facebook, x o youtube' })
      }
      updates.push('social_links = ?')
      values.push(links)
    }

    if (body.color_superficie !== undefined) {
      const v = typeof body.color_superficie === 'string' ? body.color_superficie.trim() : ''
      if (v && !HEX_COLOR_RE.test(v)) {
        return res.status(400).json({ error: 'color_superficie debe ser un color hexadecimal válido o vacío' })
      }
      updates.push('color_superficie = ?')
      values.push(v || null)
    }

    if (body.border_radius !== undefined) {
      const v = typeof body.border_radius === 'string' ? body.border_radius.trim() : ''
      if (v && !VALID_BORDER_RADII.has(v)) {
        return res.status(400).json({ error: `border_radius debe ser uno de: ${[...VALID_BORDER_RADII].join(', ')} — o vacío para el predeterminado` })
      }
      updates.push('border_radius = ?')
      values.push(v || null)
    }

    if (body.button_style !== undefined) {
      const v = typeof body.button_style === 'string' ? body.button_style.trim() : ''
      if (v && !VALID_BUTTON_STYLES.has(v)) {
        return res.status(400).json({ error: `button_style debe ser uno de: ${[...VALID_BUTTON_STYLES].join(', ')} — o vacío para el predeterminado` })
      }
      updates.push('button_style = ?')
      values.push(v || null)
    }

    if (body.heading_font !== undefined) {
      const v = typeof body.heading_font === 'string' ? body.heading_font.trim() : ''
      if (v && !VALID_FONTS.has(v)) {
        return res.status(400).json({ error: `heading_font debe ser uno de: ${[...VALID_FONTS].join(', ')} — o vacío para usar la misma fuente del cuerpo` })
      }
      updates.push('heading_font = ?')
      values.push(v || null)
    }

    if (body.navbar_blur !== undefined) {
      updates.push('navbar_blur = ?')
      values.push(body.navbar_blur === true)
    }

    if (body.card_columns !== undefined) {
      const v = typeof body.card_columns === 'string' ? body.card_columns.trim() : ''
      if (v && !VALID_CARD_COLUMNS.has(v)) {
        return res.status(400).json({ error: `card_columns debe ser uno de: ${[...VALID_CARD_COLUMNS].join(', ')} — o vacío para el predeterminado` })
      }
      updates.push('card_columns = ?')
      values.push(v || null)
    }

    if (body.section_spacing !== undefined) {
      const v = typeof body.section_spacing === 'string' ? body.section_spacing.trim() : ''
      if (v && !VALID_SECTION_SPACINGS.has(v)) {
        return res.status(400).json({ error: `section_spacing debe ser uno de: ${[...VALID_SECTION_SPACINGS].join(', ')} — o vacío para el predeterminado` })
      }
      updates.push('section_spacing = ?')
      values.push(v || null)
    }

    if (body.mobile_event_layout !== undefined) {
      const v = typeof body.mobile_event_layout === 'string' ? body.mobile_event_layout.trim() : ''
      if (v && !VALID_MOBILE_LAYOUTS.has(v)) {
        return res.status(400).json({ error: `mobile_event_layout debe ser uno de: ${[...VALID_MOBILE_LAYOUTS].join(', ')} — o vacío para el predeterminado` })
      }
      updates.push('mobile_event_layout = ?')
      values.push(v || null)
    }

    if (body.event_card_style !== undefined) {
      const v = typeof body.event_card_style === 'string' ? body.event_card_style.trim() : ''
      if (v && !VALID_EVENT_CARD_STYLES.has(v)) {
        return res.status(400).json({ error: `event_card_style debe ser uno de: ${[...VALID_EVENT_CARD_STYLES].join(', ')} — o vacío para el predeterminado` })
      }
      updates.push('event_card_style = ?')
      values.push(v || null)
    }

    if (body.eventos_layout !== undefined) {
      const v = typeof body.eventos_layout === 'string' ? body.eventos_layout.trim() : ''
      if (v && !VALID_EVENTOS_LAYOUTS.has(v)) {
        return res.status(400).json({ error: `eventos_layout debe ser uno de: ${[...VALID_EVENTOS_LAYOUTS].join(', ')} — o vacío para el predeterminado` })
      }
      updates.push('eventos_layout = ?')
      values.push(v || null)
    }

    if (!updates.length) {
      return res.status(400).json({ error: 'No se enviaron campos de sitio de venta para actualizar' })
    }

    // Build a Prisma update data object from accumulated updates/values pairs
    const updateData: Record<string, unknown> = {}
    for (let i = 0; i < updates.length; i++) {
      // updates[i] is like "slug = ?" — extract the field name before " = ?"
      const field = updates[i].replace(' = ?', '').trim()
      updateData[field] = values[i]
    }

    let updatedSlug: string
    try {
      const updated = await prisma.empresa.update({
        where: { id: resolved.empresaId },
        data: updateData,
        select: { slug: true },
      })
      updatedSlug = updated.slug
    } catch (err: unknown) {
      // P2025: record not found
      if (typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'P2025') {
        return res.status(404).json({ error: 'Empresa no encontrada' })
      }
      throw err
    }

    // Fire-and-forget: bust the Next.js tenant cache so branding changes
    // surface on the next visit without waiting for ISR revalidate.
    void revalidateTenantPath(updatedSlug)

    if (changedSlug) {
      void logAuditEvent({
        actor: actorFromRequest(req),
        action: 'empresa.slug_changed',
        entityType: 'empresa',
        entityId: String(resolved.empresaId),
        entityLabel: changedSlug,
        payload: { new_slug: changedSlug },
        ipAddress: req.requestMeta?.ip ?? null,
      })
    }

    return res.json({ ok: true })
  } catch {
    logServerError('sitio-venta patch')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

export default router
