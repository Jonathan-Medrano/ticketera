import type { Resend } from 'resend'

/**
 * Sobre la forma del error de Resend:
 *
 * `resend.emails.send(payload)` NO lanza ante errores de la API — devuelve
 * `{ data, error }`. El error tiene la forma (ver `resend/dist/index.d.cts`):
 *
 *   type ErrorResponse = {
 *     message: string
 *     statusCode: number | null
 *     name: RESEND_ERROR_CODE_KEY  // incluye 'rate_limit_exceeded',
 *                                  // 'internal_server_error', 'application_error', ...
 *   }
 *
 * Tratamos como RETRYABLE: rate limit (`name === 'rate_limit_exceeded'`) o
 * cualquier `statusCode` de 429 / >= 500. Si `send` además lanza (error de red /
 * timeout), también reintentamos. El resto de errores (validación, api key
 * inválida, etc.) NO se reintentan: se devuelven tal cual al caller.
 */

// El payload es el mismo objeto que se pasa a `resend.emails.send(...)`.
type SendPayload = Parameters<Resend['emails']['send']>[0]
type SendOptions = Parameters<Resend['emails']['send']>[1]
type SendResult = Awaited<ReturnType<Resend['emails']['send']>>

export type SendEmailWithRetryOptions = {
  /** Cantidad máxima de reintentos tras el primer intento. Default: 3. */
  retries?: number
  /** Delay base en ms para el backoff exponencial. Default: 500. */
  baseDelayMs?: number
  /** Opciones nativas de `resend.emails.send` (p.ej. idempotencyKey). */
  sendOptions?: SendOptions
}

function isRetryableError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { name?: unknown; statusCode?: unknown; status?: unknown }

  if (e.name === 'rate_limit_exceeded') return true

  const code = typeof e.statusCode === 'number'
    ? e.statusCode
    : typeof e.status === 'number'
      ? e.status
      : null

  if (code === 429) return true
  if (code !== null && code >= 500) return true

  return false
}

function backoffDelayMs(attempt: number, baseDelayMs: number): number {
  // Backoff exponencial determinístico (base * 2^attempt) + jitter derivado del
  // número de intento — sin depender de Date.now/Math.random.
  const exponential = baseDelayMs * Math.pow(2, attempt)
  const jitter = (attempt + 1) * 50
  return exponential + jitter
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

/**
 * Envía un email vía Resend con reintentos ante condiciones transitorias
 * (rate limit 429 o errores de servidor 5xx, y errores de red al invocar `send`).
 *
 * Devuelve el `{ data, error }` final (éxito o el último error) para que el
 * caller conserve su manejo existente de `result.data.id` / `result.error`.
 */
export async function sendEmailWithRetry(
  resend: Resend,
  payload: SendPayload,
  opts: SendEmailWithRetryOptions = {}
): Promise<SendResult> {
  const retries = opts.retries ?? 3
  const baseDelayMs = opts.baseDelayMs ?? 500

  let lastResult: SendResult | undefined
  let lastThrown: unknown

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      await sleep(backoffDelayMs(attempt - 1, baseDelayMs))
    }

    try {
      const result = opts.sendOptions !== undefined
        ? await resend.emails.send(payload, opts.sendOptions)
        : await resend.emails.send(payload)
      lastResult = result

      if (!result.error) return result
      if (attempt < retries && isRetryableError(result.error)) continue

      return result
    } catch (err) {
      // `send` lanzó (error de red / timeout): reintentar si quedan intentos.
      lastThrown = err
      if (attempt < retries) continue
      // Sin más reintentos: si tuvimos un resultado previo, devolverlo;
      // si no, re-lanzar para preservar el comportamiento ante fallos duros.
      if (lastResult !== undefined) return lastResult
      throw err
    }
  }

  // Inalcanzable en la práctica, pero satisface el control de flujo.
  if (lastResult !== undefined) return lastResult
  throw lastThrown
}
