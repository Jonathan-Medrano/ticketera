import { createClient, type SupabaseClient } from "@supabase/supabase-js"

let cachedClient: SupabaseClient | null = null
let warnedMissingConfig = false

/**
 * Cliente Supabase server-side usando el SERVICE_ROLE_KEY.
 * NUNCA exponer este cliente al frontend — el service role bypassea RLS.
 *
 * Env vars requeridas en platea/.env.local:
 *   - SUPABASE_URL=https://xxxxx.supabase.co
 *   - SUPABASE_SERVICE_ROLE_KEY=<service_role key del dashboard>
 *
 * Si faltan, retorna null y loguea warning una vez. Endpoints deben chequear
 * y devolver error explícito.
 */
export function getSupabaseServerClient(): SupabaseClient | null {
  if (cachedClient) return cachedClient

  const url = process.env.SUPABASE_URL?.trim()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!url || !serviceRoleKey) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true
      console.warn(
        "[supabase] SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no configurados. " +
          "Endpoints de upload van a fallar con 503.",
      )
    }
    return null
  }

  // Proyectos migrados al nuevo sistema de keys (sb_secret_*) sirven Storage
  // desde <ref>.storage.supabase.co en lugar de <ref>.supabase.co. Sin esto,
  // sb_secret_* tira "Invalid Compact JWS" y las legacy JWT tiran "signature
  // verification failed" porque el endpoint legacy usa otro secret.
  // `useNewHostname` está implementado en supabase-js 2.107 pero todavía sin types.
  const clientOptions = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    storage: { useNewHostname: true },
  } as unknown as Parameters<typeof createClient>[2]

  cachedClient = createClient(url, serviceRoleKey, clientOptions)

  return cachedClient
}

export const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET?.trim() || "tenant-images"

export const ALLOWED_UPLOAD_TYPES = ["logo", "banner", "evento", "consumible", "galeria", "sponsor", "marketing"] as const

export type UploadType = (typeof ALLOWED_UPLOAD_TYPES)[number]

export function isAllowedUploadType(value: unknown): value is UploadType {
  return typeof value === "string" && (ALLOWED_UPLOAD_TYPES as readonly string[]).includes(value)
}

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024

export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
])

/**
 * Extrae el path interno del bucket desde una URL pública de Supabase Storage.
 * Retorna null si la URL no parece ser de Supabase (e.g. CDN externo, URL de imagen externa).
 *
 * Ejemplo:
 *   https://xxx.supabase.co/storage/v1/object/public/tenant-images/slug/logo/uuid.jpg
 *   → "slug/logo/uuid.jpg"
 */
export function extractPathFromPublicUrl(
  url: string,
  bucket: string = SUPABASE_STORAGE_BUCKET,
): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  const rest = url.slice(idx + marker.length)
  // Tirar cualquier query string que pueda venir
  const qIdx = rest.indexOf('?')
  return qIdx === -1 ? rest : rest.slice(0, qIdx)
}

/**
 * Validates file magic bytes against the declared MIME type.
 * Prevents MIME spoofing where an attacker sets Content-Type: image/jpeg
 * on an HTML/JS/SVG payload to bypass the MIME allowlist.
 */
export function hasValidImageMagicBytes(bytes: Uint8Array, mime: string): boolean {
  if (bytes.length < 4) return false
  switch (mime) {
    case "image/jpeg":
      return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    case "image/png":
      return (
        bytes[0] === 0x89 && bytes[1] === 0x50 &&
        bytes[2] === 0x4e && bytes[3] === 0x47
      )
    case "image/gif":
      return bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38
    case "image/webp":
      // RIFF....WEBP — bytes 0-3 = "RIFF", bytes 8-11 = "WEBP"
      return (
        bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
      )
    default:
      return false
  }
}

export function extensionFromMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg"
    case "image/png":
      return "png"
    case "image/webp":
      return "webp"
    case "image/gif":
      return "gif"
    default:
      return "bin"
  }
}
