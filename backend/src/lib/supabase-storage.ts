import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let cachedClient: SupabaseClient | null = null
let warnedMissingConfig = false

/**
 * Cliente Supabase server-side para el backend. Usa SERVICE_ROLE_KEY,
 * NUNCA exponer al cliente. Solo usado por jobs administrativos como
 * la limpieza de archivos huérfanos.
 *
 * Env vars requeridas en backend/.env:
 *   - SUPABASE_URL
 *   - SUPABASE_SERVICE_ROLE_KEY
 *
 * Si faltan, retorna null y loguea warning una sola vez. Los jobs deben
 * chequear el retorno antes de operar.
 */
export function getSupabaseServerClient(): SupabaseClient | null {
  if (cachedClient) return cachedClient

  const url = process.env.SUPABASE_URL?.trim()
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()

  if (!url || !serviceRoleKey) {
    if (!warnedMissingConfig) {
      warnedMissingConfig = true
      console.warn(
        '[supabase] SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY no configurados en backend. ' +
          'Jobs de storage van a quedar deshabilitados.',
      )
    }
    return null
  }

  cachedClient = createClient(url, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  })

  return cachedClient
}

export const SUPABASE_STORAGE_BUCKET =
  process.env.SUPABASE_STORAGE_BUCKET?.trim() || 'tenant-images'

/**
 * Extrae el path del bucket desde una URL pública de Supabase Storage.
 * Retorna null si la URL no parece de este bucket.
 */
export function extractPathFromPublicUrl(
  url: string,
  bucket: string = SUPABASE_STORAGE_BUCKET,
): string | null {
  const marker = `/storage/v1/object/public/${bucket}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  const rest = url.slice(idx + marker.length)
  const qIdx = rest.indexOf('?')
  return qIdx === -1 ? rest : rest.slice(0, qIdx)
}

/**
 * Regex global para encontrar TODAS las URLs de Supabase Storage en un string
 * (útil cuando viene embebido en JSON serializado o texto libre).
 *
 * El callsite debe escapear correctamente el nombre del bucket si contiene
 * caracteres especiales — para nuestro caso "tenant-images" es ASCII seguro.
 */
export function buildSupabaseUrlRegex(bucket: string = SUPABASE_STORAGE_BUCKET): RegExp {
  const escaped = bucket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `https?://[^\\s"'<>\\\\]+/storage/v1/object/public/${escaped}/[^\\s"'<>\\\\?]+`,
    'g',
  )
}
