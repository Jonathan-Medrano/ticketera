import type { Request } from 'express'
import { createPersistentRateLimit } from './persistent-rate-limit'
import { getActorEmpresaId } from './authz'

function normalizeValue(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

// Extrae el empresaId del actor YA AUTENTICADO (`req.user`, poblado por `verifyInternal`
// tras validar `x-internal-secret` con timingSafeEqual y rehidratar el usuario contra la
// DB). Estos limiters se montan como middleware de RUTA, después de `verifyInternal` +
// `requireAuth` + `requirePermissionMiddleware` en la propia definición de la ruta — NUNCA
// como middleware global antes de `app.use('/api', routes)`. Si se montan antes de
// `verifyInternal`, `req.user` todavía no existe y la única fuente sería el header `x-user`
// crudo (no validado): cualquiera puede spoofearlo con el `empresaId` de otra empresa
// (no es secreto, lo devuelve `GET /api/tenant/:slug`) y agotar su bucket de rate limit,
// o mandar un id distinto en cada request para nunca caer en el mismo bucket — bypass total
// del propio rate limit. Por eso acá solo leemos `req.user`, nunca el header.
function getAuthenticatedActorEmpresaId(req: Request): string | null {
  if (!req.user) return null
  return getActorEmpresaId(req.user)
}

type SensitiveRateLimitOptions = {
  prefix: string
  windowMs: number
  max: number
  message: { error: string }
  getIdentifier?: (req: Request) => string | null | undefined
}

export function createSensitiveRateLimit(options: SensitiveRateLimitOptions) {
  const { prefix, windowMs, max, message, getIdentifier } = options

  return createPersistentRateLimit({
    prefix,
    windowMs,
    max,
    message,
    getIdentifier,
  })
}

export const AUTH_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000

export const createCompanyRegisterRateLimit = () => createSensitiveRateLimit({
  prefix: 'auth-register-company',
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: 5,
  message: { error: 'Demasiados intentos de registro, intentá nuevamente en 15 minutos' },
  getIdentifier: (req) => normalizeValue(req.body?.email) || normalizeValue(req.body?.slug),
})

export const createTenantRegisterRateLimit = () => createSensitiveRateLimit({
  prefix: 'auth-register-tenant',
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: 5,
  message: { error: 'Demasiados intentos de registro, intentá nuevamente en 15 minutos' },
  getIdentifier: (req) => normalizeValue(req.body?.email) || normalizeValue(req.params.slug),
})

export const createPasswordResetForgotRateLimit = (prefix: string) => createSensitiveRateLimit({
  prefix,
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: 5,
  message: { error: 'Demasiados intentos de recuperación, intentá nuevamente en 15 minutos' },
  getIdentifier: (req) => normalizeValue(req.body?.email) || normalizeValue(req.params.slug),
})

export const createPasswordResetConsumeRateLimit = (prefix: string) => createSensitiveRateLimit({
  prefix,
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: 10,
  message: { error: 'Demasiados intentos de restablecimiento, intentá nuevamente en 15 minutos' },
  getIdentifier: (req) => normalizeValue(req.body?.token) || normalizeValue(req.params.slug),
})

export const createEmailVerifyRateLimit = () => createSensitiveRateLimit({
  prefix: 'auth-verify-email',
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: 10,
  message: { error: 'Demasiados intentos de verificación, intentá nuevamente en 15 minutos' },
  getIdentifier: (req) => normalizeValue(req.body?.email),
})

export const createEmailVerifyResendRateLimit = () => createSensitiveRateLimit({
  prefix: 'auth-verify-email-resend',
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: 5,
  message: { error: 'Demasiados reenvíos de código, intentá nuevamente en 15 minutos' },
  getIdentifier: (req) => normalizeValue(req.body?.email),
})

export const createTenantTokenConsumeRateLimit = () => createSensitiveRateLimit({
  prefix: 'tenant-auth-token',
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: 10,
  message: { error: 'Demasiados intentos con token, esperá unos minutos antes de reintentar' },
  getIdentifier: (req) => normalizeValue(req.query.token) || normalizeValue(req.params.slug),
})

export const createSupportRateLimit = () => createSensitiveRateLimit({
  prefix: 'tenant-support',
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: 8,
  message: { error: 'Demasiados mensajes de soporte, intentá nuevamente en unos minutos' },
  getIdentifier: (req) => normalizeValue(req.body?.email) || normalizeValue(req.params.slug),
})

export const createValidarCodigoDescuentoRateLimit = () => createSensitiveRateLimit({
  prefix: 'tenant-validar-codigo-descuento',
  windowMs: 5 * 60 * 1000,
  max: 20,
  message: { error: 'Demasiados intentos de validación de código, esperá unos minutos' },
  getIdentifier: (req) => normalizeValue(req.ip) || normalizeValue(req.params.slug),
})

// Slug availability check: keyed by IP to prevent enumeration of registered companies.
export const createCheckSlugRateLimit = () => createSensitiveRateLimit({
  prefix: 'auth-check-slug',
  windowMs: AUTH_RATE_LIMIT_WINDOW_MS,
  max: 60,
  message: { error: 'Demasiadas verificaciones de subdominio, intentá nuevamente en 15 minutos' },
  getIdentifier: (req) => normalizeValue(req.ip ?? ''),
})

// Envío de campañas y test-send de marketing: todo el tráfico llega server-to-server
// desde el BFF (el actor SIEMPRE está autenticado en este punto), así que un rate
// limit por IP comparte el bucket entre TODAS las empresas si el BFF no reenvía el IP
// real del browser (DoS cruzado: una empresa abusiva agota la cuota de las demás), y
// se diluye si el backend escala a más de una instancia (cada una con su propio
// MemoryStore de express-rate-limit). `createPersistentRateLimit` resuelve la
// dilución (bucket en Postgres, compartido entre instancias) y `getAuthenticatedActorEmpresaId`
// resuelve el bucket compartido (aísla por empresa en vez de por IP) usando el actor
// YA VALIDADO — se montan como middleware de ruta en `routes/marketing.ts`, DESPUÉS de
// `verifyInternal`/`requireAuth`/`requirePermissionMiddleware`.
export const createMarketingCampanaEnviarRateLimit = () => createSensitiveRateLimit({
  prefix: 'marketing-campana-enviar',
  windowMs: 60 * 1000,
  max: 30,
  message: { error: 'Demasiados envíos de campaña, aguardá un momento' },
  getIdentifier: getAuthenticatedActorEmpresaId,
})

export const createMarketingCampanaTestSendRateLimit = () => createSensitiveRateLimit({
  prefix: 'marketing-campana-test-send',
  windowMs: 60 * 1000,
  max: 15,
  message: { error: 'Demasiados envíos de prueba, aguardá un momento' },
  getIdentifier: getAuthenticatedActorEmpresaId,
})
