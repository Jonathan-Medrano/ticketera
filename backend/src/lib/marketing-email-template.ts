// Marketing email content — structured ("plantilla estructurada") format.
//
// Migration-free design: the structured content is serialized to JSON and stored
// in the existing `marketing_campanas.contenido_html` (@db.Text) column. New/edited
// campaigns store JSON with the `_fmt` discriminator below; legacy campaigns store
// raw HTML. `renderMarketingEmailHtml` detects the format and renders accordingly,
// so old campaigns keep working and no DB migration is required.
//
// User text is ALWAYS HTML-escaped before rendering — the editor exposes plain
// fields, never raw HTML, which removes the XSS/content-injection surface the old
// raw-HTML textarea had. The only HTML is this trusted, on-brand template.

export const MARKETING_EMAIL_FMT = 'ticketera-email-v1'

export type MarketingEmailButton = { texto: string; url: string }

export type MarketingEmailContent = {
  _fmt: typeof MARKETING_EMAIL_FMT
  titulo: string | null
  parrafos: string[]
  imagen_url: string | null
  boton: MarketingEmailButton | null
}

const MAX_PARRAFOS = 30
const MAX_PARRAFO_LEN = 5000
const MAX_TITULO_LEN = 200
const MAX_BOTON_TEXTO_LEN = 60

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Only http(s) (for images/links) — blocks javascript:, data:, etc.
function isSafeUrl(url: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(url.trim())
}

// Images may come from our own uploads as a relative path ("/uploads/..") too.
function isSafeImageSrc(url: string): boolean {
  const u = url.trim()
  return isSafeUrl(u) || u.startsWith('/')
}

export function isStructuredContent(stored: string | null | undefined): boolean {
  if (!stored) return false
  const t = stored.trimStart()
  if (!t.startsWith('{')) return false
  try {
    return (JSON.parse(stored) as { _fmt?: unknown })?._fmt === MARKETING_EMAIL_FMT
  } catch {
    return false
  }
}

export function parseStructuredContent(stored: string | null | undefined): MarketingEmailContent | null {
  if (!stored) return null
  let raw: unknown
  try {
    raw = JSON.parse(stored)
  } catch {
    return null
  }
  const o = raw as Record<string, unknown>
  if (o?._fmt !== MARKETING_EMAIL_FMT) return null
  const boton =
    o.boton && typeof (o.boton as MarketingEmailButton).texto === 'string' && typeof (o.boton as MarketingEmailButton).url === 'string'
      ? { texto: String((o.boton as MarketingEmailButton).texto), url: String((o.boton as MarketingEmailButton).url) }
      : null
  return {
    _fmt: MARKETING_EMAIL_FMT,
    titulo: typeof o.titulo === 'string' && o.titulo.trim() ? o.titulo : null,
    parrafos: Array.isArray(o.parrafos) ? o.parrafos.filter((p): p is string => typeof p === 'string') : [],
    imagen_url: typeof o.imagen_url === 'string' && o.imagen_url.trim() ? o.imagen_url : null,
    boton,
  }
}

// Validate + normalize a structured payload coming from the editor.
// Throws Error(<user-facing message>) on invalid input.
export function buildStructuredContent(input: unknown): MarketingEmailContent {
  const o = (input ?? {}) as Record<string, unknown>

  const tituloRaw = typeof o.titulo === 'string' ? o.titulo.trim() : ''
  if (tituloRaw.length > MAX_TITULO_LEN) throw new Error('El título es demasiado largo')

  const parrafosRaw = Array.isArray(o.parrafos) ? o.parrafos : []
  const parrafos = parrafosRaw
    .map((p) => (typeof p === 'string' ? p.trim() : ''))
    .filter((p) => p.length > 0)
  if (parrafos.length > MAX_PARRAFOS) throw new Error('Demasiados párrafos')
  if (parrafos.some((p) => p.length > MAX_PARRAFO_LEN)) throw new Error('Un párrafo es demasiado largo')

  if (!tituloRaw && parrafos.length === 0) {
    throw new Error('El email necesita al menos un título o un párrafo')
  }

  let imagenUrl: string | null = null
  if (typeof o.imagen_url === 'string' && o.imagen_url.trim()) {
    const candidate = o.imagen_url.trim()
    if (!isSafeImageSrc(candidate)) throw new Error('La URL de la imagen no es válida')
    imagenUrl = candidate
  }

  let boton: MarketingEmailButton | null = null
  const botonRaw = o.boton as Record<string, unknown> | null | undefined
  const botonTexto = typeof botonRaw?.texto === 'string' ? botonRaw.texto.trim() : ''
  const botonUrl = typeof botonRaw?.url === 'string' ? botonRaw.url.trim() : ''
  if (botonTexto || botonUrl) {
    if (!botonTexto) throw new Error('El botón necesita un texto')
    if (botonTexto.length > MAX_BOTON_TEXTO_LEN) throw new Error('El texto del botón es demasiado largo')
    if (!isSafeUrl(botonUrl)) throw new Error('El link del botón debe empezar con http:// o https://')
    boton = { texto: botonTexto, url: botonUrl }
  }

  return {
    _fmt: MARKETING_EMAIL_FMT,
    titulo: tituloRaw || null,
    parrafos,
    imagen_url: imagenUrl,
    boton,
  }
}

export function serializeStructuredContent(content: MarketingEmailContent): string {
  return JSON.stringify(content)
}

// Replace the {{nombre}} personalization token. Text is already HTML-escaped, so the
// replacement value is escaped too. Empty/absent name → token removed cleanly.
function applyNombreToken(escapedText: string, nombre: string | null | undefined): string {
  const safeNombre = nombre ? escHtml(nombre.trim()) : ''
  return escapedText.replace(/\{\{nombre\}\}/g, safeNombre)
}

// Render the branded TICKETERA email body HTML. The unsubscribe footer is appended
// by the caller (send path), matching the previous behaviour.
// Legacy raw-HTML campaigns are passed through (only token replacement applied).
export function renderMarketingEmailHtml(stored: string, opts?: { nombre?: string | null }): string {
  const content = parseStructuredContent(stored)
  if (!content) {
    // Legacy raw HTML — keep prior behaviour (passthrough). No structured escaping.
    return stored
  }

  const nombre = opts?.nombre ?? null
  const parts: string[] = []

  if (content.titulo) {
    const titulo = applyNombreToken(escHtml(content.titulo), nombre)
    parts.push(`<h1 style="font-size:22px;line-height:1.3;margin:0 0 16px;color:#111827">${titulo}</h1>`)
  }

  if (content.imagen_url) {
    parts.push(
      `<img src="${escHtml(content.imagen_url)}" alt="" style="display:block;width:100%;max-width:480px;height:auto;border-radius:12px;margin:0 0 16px" />`,
    )
  }

  for (const parrafo of content.parrafos) {
    const escaped = applyNombreToken(escHtml(parrafo), nombre).replace(/\n/g, '<br />')
    parts.push(`<p style="font-size:15px;line-height:1.6;margin:0 0 14px;color:#333">${escaped}</p>`)
  }

  if (content.boton) {
    parts.push(
      `<div style="margin:24px 0 8px">` +
        `<a href="${escHtml(content.boton.url)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:999px;font-weight:600;font-size:15px">${escHtml(
          content.boton.texto,
        )}</a>` +
        `</div>`,
    )
  }

  return `<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:8px">${parts.join('')}</div>`
}
