import type { TenantEmpresa } from "@/lib/tenant"
import type { EventoPasadoOption, SitioVentaForm } from "@/components/dashboard/sitio-venta/types"

// postMessage contract between the "sitio de venta" editor (parent tab) and the
// tenant storefront rendered inside its live-preview iframe (child). Both sides
// import these constants so the string literals never drift out of sync.
export const TENANT_PREVIEW_MESSAGE_TYPE = "ticketera:sitio-venta-preview"
export const TENANT_PREVIEW_READY_TYPE = "ticketera:sitio-venta-preview:ready"
export const TENANT_PREVIEW_NAVIGATION_TYPE = "ticketera:sitio-venta-preview:navigate"
export const TENANT_PREVIEW_QUERY_FLAG = "ticketera_editor_preview"
// iframe -> parent: emitted when the visitor edits an inline-editable field directly
// on top of the live preview (spike: only `titulo_eventos_home` today — see
// components/tenant/editable-text.tsx and sitio-venta-editor-preview.tsx). Deliberately
// a closed, single-field payload rather than a generic union: this is the inline-edit
// spike from `sitio-venta-editor-inline.md` phase 3, not the generalized allowlist yet.
export const TENANT_PREVIEW_FIELD_EDIT_TYPE = "ticketera:sitio-venta-preview:field-edit"

/** Payload for {@link TENANT_PREVIEW_FIELD_EDIT_TYPE}. Only `titulo_eventos_home` is
 * wired for now (single-field spike) — extend this union when more fields are added. */
export type TenantPreviewFieldEditPayload = {
  field: "titulo_eventos_home"
  value: string
}

/**
 * Maps the editor's in-memory SitioVentaForm to the Partial<TenantEmpresa> shape
 * the tenant storefront (TenantProvider) expects. Sent over postMessage on every
 * form change so the iframe reflects the draft instantly, without saving.
 *
 * Field naming diverges from SitioVentaForm in a few places:
 *   - `sections` -> `home_sections` (renamed to match the DB/API column)
 *   - `support_contact_email` -> derived into `support_contact_enabled` (TenantEmpresa
 *     never carries the raw email to the client — see backend/src/routes/tenant.ts,
 *     which derives the same boolean from `support_contact_email.trim().length > 0`)
 *   - `testimonio_eventos` is fully derived (no matching SitioVentaForm field): built
 *     from `form.sections`' testimonios `evento_id`s resolved against `eventosPasados`
 *     (the same in-memory list the editor's "Vincular a un evento" selector uses).
 *     In real (non-preview) traffic this map instead comes from the backend — see
 *     `extractTestimonioEventoIds` in backend/src/routes/tenant.ts — because the
 *     public page has no reason to fetch every past event just to resolve a few IDs.
 *
 * Every other field matches 1:1 by name and type, including `nombre`/`descripcion`/
 * `whatsapp` — those ARE edited inside the included sections (BrandingVisualSection,
 * FaqSection) so they must preview live too, even though they're mostly identity/
 * contact fields rather than "branding".
 */
export function buildTenantPreviewOverride(form: SitioVentaForm, eventosPasados: EventoPasadoOption[] = []): Partial<TenantEmpresa> {
  // testimonio_eventos normalmente lo resuelve el backend (GET /tenant/:slug) a partir
  // de los evento_id guardados. En vivo previo a guardar no hay ida y vuelta al server,
  // así que lo armamos acá con el mismo dataset (eventos pasados) que ya tiene el
  // selector del editor en memoria — misma forma que la respuesta real del backend.
  const eventosPorId = new Map(eventosPasados.map((e) => [e.id, e]))
  const testimonioEventos: Record<string, { nombre: string; imagen_url: string | null }> = {}
  for (const section of form.sections) {
    if (section.type !== "testimonios") continue
    for (const testimonio of section.testimonios) {
      const eventoId = testimonio.evento_id?.trim()
      if (!eventoId) continue
      const evento = eventosPorId.get(eventoId)
      if (evento) testimonioEventos[eventoId] = { nombre: evento.nombre, imagen_url: evento.imagen_url }
    }
  }

  return {
    nombre: form.nombre,
    descripcion: form.descripcion,
    whatsapp: form.whatsapp,
    logo_url: form.logo_url,
    favicon_url: form.favicon_url,
    navbar_size: form.navbar_size,
    logo_size: form.logo_size || null,
    navbar_color: form.navbar_color,
    font: form.font,
    color_primario: form.color_primario,
    color_fondo: form.color_fondo,
    color_texto: form.color_texto,
    desktop_event_card_size: form.desktop_event_card_size,
    mostrar_descripcion_home: form.mostrar_descripcion_home,
    mostrar_tanda_activa_home: form.mostrar_tanda_activa_home,
    mostrar_badge_stock_home: form.mostrar_badge_stock_home,
    mostrar_fecha_home: form.mostrar_fecha_home,
    mostrar_lugar_home: form.mostrar_lugar_home,
    mostrar_precio_home: form.mostrar_precio_home,
    titulo_eventos_home: form.titulo_eventos_home,
    subtitulo_eventos_home: form.subtitulo_eventos_home,
    cta_eventos_home: form.cta_eventos_home,
    banner_variant: form.banner_variant,
    banners: form.banners,
    info_pages: form.info_pages,
    support_contact_enabled: !!form.support_contact_email.trim(),
    faqs: form.faqs,
    galeria_fotos: form.galeria_fotos,
    home_sections: form.sections,
    announcement_bar: form.announcement_bar,
    social_links: form.social_links,
    color_superficie: form.color_superficie,
    border_radius: form.border_radius,
    button_style: form.button_style,
    heading_font: form.heading_font,
    navbar_blur: form.navbar_blur,
    card_columns: form.card_columns,
    section_spacing: form.section_spacing,
    mobile_event_layout: form.mobile_event_layout,
    event_card_style: form.event_card_style,
    eventos_layout: form.eventos_layout,
    testimonio_eventos: testimonioEventos,
  }
}
