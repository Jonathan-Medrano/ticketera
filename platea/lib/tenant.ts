import { normalizeTenantHomeSections, type TenantHomeSection } from "./tenant-home-sections"
import { normalizeTenantInfoPages, type TenantInfoPage } from "./tenant-info"
import { resolveTenantSupportFaqCollection, type TenantSupportFaqItem } from "./tenant-support"

export type TenantFaqItem = TenantSupportFaqItem

export type GaleriaFotoItem = {
  id: string
  url: string
  titulo: string
  visible: boolean
}

export type AnnouncementBar = {
  text: string
  link?: string
  link_label?: string
  style: "brand" | "warning"
  enabled: boolean
}

export type SocialLinks = {
  instagram?: string
  tiktok?: string
  facebook?: string
  x?: string
  youtube?: string
}

export type SalesReadinessStatus = "missing_provider" | "pending_validation" | "ready_to_sell" | "blocked"

export type SalesReadinessReason =
  | "missing_provider"
  | "missing_marketplace_fee"
  | "credentials_invalid"
  | "provider_unreachable"
  | "provider_blocked"
  | "manual_block"
  | "validation_pending"

export type SalesReadinessSnapshot = {
  status: SalesReadinessStatus
  reason: SalesReadinessReason | null
}

export type TenantSalesReadiness = SalesReadinessSnapshot & {
  can_sell: boolean
}

export type MarketplaceFeeSummary = {
  configured: boolean
  mode: "percentage" | "fixed" | "hybrid" | null
  percentage: number | null
  fixedAmount: number | null
}

export type TenantEventPublicationStatus = "hidden" | "listed" | "live"

export type TenantEventPublicationReason =
  | "manual_inactive"
  | "scheduled_hidden"
  | "scheduled_listed"
  | "scheduled_detail_visible"
  | "live"

export type TenantEventPublication = {
  mode: "immediate" | "scheduled"
  pre_publish_visibility: "hidden" | "listado_solo" | "detail_visible"
  publish_at_utc: string | null
  publish_timezone: string | null
  published_live_at: string | null
  publish_date_local?: string
  publish_time_local?: string
}

export type TenantEventPublicationSnapshot = {
  publication_status: TenantEventPublicationStatus
  publication_reason: TenantEventPublicationReason
  is_listed: boolean
  is_detail_visible: boolean
  is_checkout_open: boolean
  publication: TenantEventPublication
}

export type TenantEmpresa = {
  id: string
  nombre: string
  slug: string
  logo_url: string | null
  // Favicon de la pestaña del navegador. Cuadrado chico (PNG/JPG/WEBP).
  // Si es null, el tenant cae al logo_url como fallback.
  favicon_url?: string | null
  navbar_size?: "small" | "medium" | "large" | null
  // null = derivar de navbar_size (ver lib/tenant-logo.ts)
  logo_size?: "small" | "medium" | "large" | "xl" | null
  navbar_color?: string | null
  font?: string | null
  color_primario: string
  color_fondo: string
  color_texto: string
  desktop_event_card_size?: "large" | "medium" | "small"
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
  descripcion: string | null
  whatsapp: string | null
  banners?: string | string[] | null
  home_sections?: string | TenantHomeSection[] | null
  info_pages?: string | TenantInfoPage[] | null
  faqs?: string | TenantFaqItem[] | null
  support_contact_enabled?: boolean
  suspendido?: boolean
  sales_readiness?: TenantSalesReadiness | null
  ga4_measurement_id?: string | null
  meta_pixel_id?: string | null
  gtm_container_id?: string | null
  galeria_fotos?: string | GaleriaFotoItem[] | null
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
  /** Layout general del home: "clasico" (default historico) | "cartelera" | "agenda". */
  eventos_layout?: string | null
  /**
   * Resuelto server-side (GET /tenant/:slug) a partir de los `evento_id` opcionales
   * dentro de `home_sections.testimonios` — nombre + imagen de portada del evento
   * vinculado, nunca precio/stock. Scoped al propio tenant, nunca cross-tenant.
   * Ausente en el override de live-preview del editor (ver `tenant-preview-override.ts`),
   * que construye su propio mapa a partir de la lista de eventos pasados en memoria.
   */
  testimonio_eventos?: Record<string, { nombre: string; imagen_url: string | null }> | null
}

export { normalizeTenantInfoPages }
export type { TenantInfoPage }

export type TenantEventoResumen = TenantEventPublicationSnapshot & {
  id: string
  nombre: string
  descripcion?: string | null
  lugar?: string | null
  imagen_url?: string | null
  modo_fecha: "unica" | "multiple" | "pase"
  /** "libre" (default) | "numerado" — numbered seat map */
  tipo_mapa?: string | null
  proxima_fecha?: string | null
  precio_desde?: number | null
  stock_total?: number | null
  venta_consumibles_habilitada?: number
  buyer_event_refunds_enabled?: number
  company_buyer_event_refunds_enabled?: number
  tanda_activa?: {
    id: string
    nombre: string
    descripcion?: string | null
    imagen_url?: string | null
  } | null
}

export type TenantConsumiblesEventoResumen = TenantEventPublicationSnapshot & {
  id: string
  nombre: string
  descripcion?: string | null
  lugar?: string | null
  imagen_url?: string | null
  modo_fecha: "unica" | "multiple" | "pase"
  proxima_fecha?: string | null
  venta_consumibles_habilitada: number
  barras_activas: number
  items_disponibles: number
  stock_total_consumibles: number
  consumibles_disponibles: boolean
}

export function parseTenantBanners(banners: TenantEmpresa["banners"]): string[] {
  try {
    const parsed = typeof banners === "string" ? JSON.parse(banners) : banners
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && !!item.trim()) : []
  } catch {
    return []
  }
}

export function parseTenantFaqs(faqs: TenantEmpresa["faqs"]): TenantFaqItem[] {
  try {
    const parsed = typeof faqs === "string" ? JSON.parse(faqs) : faqs
    return resolveTenantSupportFaqCollection(parsed)
  } catch {
    return resolveTenantSupportFaqCollection(faqs ?? null)
  }
}

export function parseTenantHomeSections(homeSections: TenantEmpresa["home_sections"]): TenantHomeSection[] {
  return normalizeTenantHomeSections(homeSections)
}

export function parseTenantGaleria(galeria: TenantEmpresa["galeria_fotos"]): GaleriaFotoItem[] {
  try {
    const parsed = typeof galeria === "string" ? JSON.parse(galeria) : galeria
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (item): item is GaleriaFotoItem =>
        !!item &&
        typeof item === "object" &&
        typeof item.id === "string" &&
        typeof item.url === "string" &&
        !!item.url.trim() &&
        item.visible === true
    )
  } catch {
    return []
  }
}

export function buildTenantApiPath(slug: string, path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  return `/api/tenant/${slug}${normalizedPath}`
}

export function getSalesReadinessStatusLabel(status: SalesReadinessStatus) {
  switch (status) {
    case "missing_provider":
      return "Sin cobros configurados"
    case "pending_validation":
      return "Validando cobros"
    case "ready_to_sell":
      return "Listo para vender"
    case "blocked":
      return "Cobros bloqueados"
  }
}

export function getSalesReadinessMessage(
  readiness: SalesReadinessSnapshot | null | undefined,
  audience: "public" | "dashboard" = "public"
) {
  if (!readiness) {
    return audience === "dashboard"
      ? "Configurá Mercado Pago para habilitar el checkout cuanto antes."
      : "Las compras están pausadas porque la empresa todavía no configuró su cuenta de cobro."
  }

  if (readiness.status === "ready_to_sell") {
    return audience === "dashboard"
      ? "El checkout ya puede cobrar con la cuenta Mercado Pago configurada."
      : "La tienda está lista para vender."
  }

  const reason = readiness.reason ?? "validation_pending"

  if (audience === "dashboard") {
    switch (reason) {
      case "missing_provider":
        return "Configurá Mercado Pago para habilitar el checkout de la tienda pública."
      case "missing_marketplace_fee":
        return "La cuenta está conectada, pero la comisión de plataforma todavía no quedó lista para vender."
      case "credentials_invalid":
        return "La autorización de Mercado Pago fue rechazada. Reconectá la cuenta para volver a habilitar ventas."
      case "provider_unreachable":
        return "No pudimos validar Mercado Pago. Reintentá cuando el proveedor vuelva a responder bien."
      case "provider_blocked":
      case "manual_block":
        return "La cuenta de cobro está bloqueada y no puede recibir pagos."
      case "validation_pending":
        return "La cuenta quedó pendiente de validación. Esperá la confirmación antes de vender."
      default:
        return "Revisá la configuración de cobros antes de habilitar ventas."
    }
  }

  switch (reason) {
    case "missing_provider":
      return "Las compras están pausadas porque la empresa todavía no configuró su cuenta de cobro."
    case "missing_marketplace_fee":
      return "Las compras están pausadas porque la configuración comercial de la plataforma todavía no quedó lista."
    case "credentials_invalid":
      return "Las compras están pausadas porque la cuenta de cobro necesita una revisión."
    case "provider_unreachable":
      return "Las compras están pausadas porque no pudimos validar la cuenta de cobro en este momento."
    case "provider_blocked":
    case "manual_block":
      return "Las compras están pausadas porque la cuenta de cobro está bloqueada."
    case "validation_pending":
      return "Las compras están pausadas mientras se valida la cuenta de cobro."
    default:
      return "Las compras están temporalmente pausadas."
  }
}

export function getSalesReadinessActionLabel(readiness: SalesReadinessSnapshot | null | undefined) {
  switch (readiness?.status) {
    case "ready_to_sell":
      return "Administrar cobros"
    case "pending_validation":
      return "Revisar validación"
    case "blocked":
      return "Resolver bloqueo"
    case "missing_provider":
    default:
      return "Configurar cobro"
  }
}

export function formatMarketplaceFeeSummary(summary: MarketplaceFeeSummary | null | undefined) {
  if (!summary?.configured || !summary.mode) {
    return "Sin comisión configurada"
  }

  const formatter = new Intl.NumberFormat("es-AR", { maximumFractionDigits: 2 })

  if (summary.mode === "percentage") {
    return `${formatter.format(summary.percentage ?? 0)}% por venta`
  }

  if (summary.mode === "fixed") {
    return `$${formatter.format(summary.fixedAmount ?? 0)} fijo por checkout`
  }

  const percentage = summary.percentage !== null ? `${formatter.format(summary.percentage)}%` : null
  const fixed = summary.fixedAmount !== null ? `$${formatter.format(summary.fixedAmount)}` : null

  return [percentage, fixed].filter(Boolean).join(" + ") || "Comisión híbrida"
}
