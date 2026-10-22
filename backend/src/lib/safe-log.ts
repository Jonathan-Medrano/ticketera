export function logServerInfo(message: string) {
  console.info(message)
}

export function logServerWarn(message: string) {
  console.warn(message)
}

export function logServerError(context: string, error?: unknown) {
  if (error === undefined) {
    console.error(`[ServerError] ${context}`)
    return
  }
  const errPayload: Record<string, unknown> = { context }
  if (error instanceof Error) {
    errPayload.name = error.name
    errPayload.message = error.message
    errPayload.stack = error.stack
    const errObj = error as Error & { code?: unknown; meta?: unknown }
    if (errObj.code !== undefined) errPayload.code = errObj.code
    if (errObj.meta !== undefined) errPayload.meta = errObj.meta
  } else {
    errPayload.error = error
  }
  console.error(`[ServerError]`, JSON.stringify(errPayload))
}

// Lista de keys que NUNCA deben loguearse aunque vengan en el fields object.
// Defense in depth: si alguien por error pasa una credencial al logEvent,
// se filtra antes de llegar a stdout.
const FORBIDDEN_LOG_KEYS = new Set<string>([
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'password',
  'credential',
  'authorization',
  'apiKey',
  'api_key',
  'private_key',
  'card',
  'cvv',
  'signature',
])

function sanitizeFields(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(fields)) {
    const keyLower = key.toLowerCase()
    if (FORBIDDEN_LOG_KEYS.has(keyLower) || keyLower.includes('token') || keyLower.includes('secret') || keyLower.includes('password')) {
      out[key] = '[REDACTED]'
      continue
    }
    out[key] = value
  }
  return out
}

/**
 * Loguea un evento estructurado en formato JSON (parseable por Datadog/Sentry/CloudWatch).
 * Filtra automáticamente keys con nombres sospechosos (token/secret/password/...).
 *
 * Eventos del flow de pago/stock que deberían usarlo:
 *   - webhook_received, webhook_idempotent_hit, webhook_signature_failed
 *   - payment_confirmed, payment_reconciliation_pending
 *   - tickets_issued, stock_decremented, stock_restored
 *
 * Convención de fields:
 *   - IDs (empresa_id, session_id, payment_id, evento_id, categoria_id): safe
 *   - amounts: safe (sin tokens)
 *   - quantity, counts: safe
 *   - status, reason strings: safe
 *
 * NUNCA pasar: PII completa (email/teléfono), credenciales, payment tokens.
 */
export function logEvent(event: string, fields: Record<string, unknown> = {}) {
  const safe = sanitizeFields(fields)
  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...safe,
    }),
  )
}
