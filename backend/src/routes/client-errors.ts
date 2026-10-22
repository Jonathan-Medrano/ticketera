import { Router, type Request } from 'express'
import { createPersistentRateLimit } from '../lib/persistent-rate-limit'
import { captureError, type ErrorLogSeverity } from '../lib/error-logger'

const router = Router()

// Rate limit por IP — cualquier visitor del tenant puede reportar errores del browser.
// Sin auth (los compradores/empleados sin sesión también van a tener bugs). Capacidad
// holgada porque una sola pestaña puede disparar muchos errores en cascada.
const clientErrorRateLimit = createPersistentRateLimit({
  prefix: 'client-errors-report',
  windowMs: 60 * 1000,
  max: 60,
  message: { error: 'Demasiados reportes de error en poco tiempo' },
  getIdentifier: (req) => {
    const forwarded = req.headers['x-forwarded-for']
    const fwd = Array.isArray(forwarded) ? forwarded[0] : forwarded
    return (fwd ?? req.ip ?? 'unknown').split(',')[0].trim()
  },
})

function pickString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed
}

function pickSeverity(value: unknown): ErrorLogSeverity {
  if (value === 'fatal' || value === 'warn') return value
  return 'error'
}

function pickContext(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  // Allow only string/number/boolean leaves, drop nested objects beyond 1 level.
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (val === null || val === undefined) continue
    if (typeof val === 'string') out[key] = val.length > 1000 ? val.slice(0, 1000) : val
    else if (typeof val === 'number' || typeof val === 'boolean') out[key] = val
    // else: silently drop (no nested objects, no arrays)
  }
  return Object.keys(out).length > 0 ? out : null
}

router.post('/', clientErrorRateLimit, async (req: Request, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>

  const message = pickString(body.message, 2000)
  if (!message) {
    return res.status(400).json({ error: 'message es obligatorio (string no vacío)' })
  }

  const forwarded = req.headers['x-forwarded-for']
  const fwd = Array.isArray(forwarded) ? forwarded[0] : forwarded
  const ip = (fwd ?? req.ip ?? '').split(',')[0].trim() || null

  void captureError({
    source: 'frontend',
    severity: pickSeverity(body.severity),
    message,
    stack: pickString(body.stack, 10000),
    context: pickContext(body.context),
    userAgent: pickString(req.headers['user-agent'], 500),
    ipAddress: ip,
  })

  // Respond fast — capture is fire-and-forget
  return res.status(204).send()
})

export default router
