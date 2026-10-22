import { logServerError, logServerWarn } from './safe-log'

/**
 * Fire-and-forget invalidation of la vidriera pública (home + /eventos) en el
 * frontend Next.js.
 *
 * Llamar desde cualquier endpoint que pueda cambiar si un evento entra o sale
 * de la vidriera (activo, publication_mode, pre_publish_visibility, publish_at_utc)
 * para que el cambio se refleje ahí sin esperar la ventana normal de ISR (600s).
 *
 * Los fallos se loguean pero nunca se lanzan — nunca bloquea la respuesta de éxito
 * del caller. Peor caso: la vidriera tarda hasta 600s en reflejar el cambio, igual
 * que hoy sin este mecanismo.
 */
export async function revalidateVidriera(): Promise<void> {
  const frontendUrl = process.env.FRONTEND_URL?.trim()
  const secret = process.env.INTERNAL_API_SECRET?.trim()

  if (!frontendUrl || !secret) {
    logServerWarn('revalidateVidriera: FRONTEND_URL or INTERNAL_API_SECRET missing — skipping')
    return
  }

  const url = `${frontendUrl.replace(/\/$/, '')}/api/internal/revalidate-vidriera`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': secret,
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      logServerError(`revalidateVidriera: frontend returned ${response.status}`)
    }
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    logServerError(`revalidateVidriera: ${detail}`)
  } finally {
    clearTimeout(timeoutId)
  }
}
