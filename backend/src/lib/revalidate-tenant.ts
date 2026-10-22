import { logServerError, logServerWarn } from './safe-log'

/**
 * Fire-and-forget invalidation of a tenant's Next.js cache on the frontend.
 *
 * Call this from any endpoint that mutates a tenant-visible field (branding,
 * logo, suspension, public-status, etc.) so the user sees their changes
 * instantly instead of waiting for ISR to revalidate.
 *
 * Failures are logged but never thrown — the caller's success response is
 * never blocked by a revalidate hiccup. This is by design: the worst case
 * is the user has to wait for the normal revalidate window (currently 300s)
 * to elapse if the frontend is briefly unreachable.
 */
export async function revalidateTenantPath(slug: string): Promise<void> {
  const trimmedSlug = slug?.trim()
  if (!trimmedSlug) return

  const frontendUrl = process.env.FRONTEND_URL?.trim()
  const secret = process.env.INTERNAL_API_SECRET?.trim()

  if (!frontendUrl || !secret) {
    logServerWarn(`revalidateTenantPath: FRONTEND_URL or INTERNAL_API_SECRET missing — skipping (${trimmedSlug})`)
    return
  }

  const url = `${frontendUrl.replace(/\/$/, '')}/api/internal/revalidate-tenant`

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-secret': secret,
      },
      body: JSON.stringify({ slug: trimmedSlug }),
      signal: controller.signal,
    })

    if (!response.ok) {
      logServerError(`revalidateTenantPath: frontend returned ${response.status} for ${trimmedSlug}`)
    }
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    logServerError(`revalidateTenantPath: ${trimmedSlug} — ${detail}`)
  } finally {
    clearTimeout(timeoutId)
  }
}
