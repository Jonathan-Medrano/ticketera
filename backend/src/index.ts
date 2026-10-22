import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import compression from 'compression'
import rateLimit from 'express-rate-limit'
import dotenv from 'dotenv'
import { errorHandler } from './middleware/errorHandler'
import routes from './routes/index'
import { startExpiredCheckoutCleanupJob } from './jobs/expiredCheckoutCleanupJob'
import { startMarketingCarritoAbandonadoJob } from './jobs/marketingCarritoAbandonadoJob'
import { startStorageOrphanCleanupJob } from './jobs/storageOrphanCleanupJob'
import { startDeliveryRetryJob } from './jobs/deliveryRetryJob'
import { startSalesVelocitySnapshotJob } from './jobs/salesVelocitySnapshotJob'
import { startRefundSlaAutoApproveJob } from './jobs/refundSlaAutoApproveJob'
import { startFeeTierEvaluationJob } from './jobs/feeTierEvaluationJob'
import { initEventLoopMonitor } from './lib/perf-metrics'
import { logServerError, logServerInfo } from './lib/safe-log'
import { captureError } from './lib/error-logger'
import {
  createCheckSlugRateLimit,
  createCompanyRegisterRateLimit,
  createEmailVerifyRateLimit,
  createEmailVerifyResendRateLimit,
  createPasswordResetConsumeRateLimit,
  createPasswordResetForgotRateLimit,
  createSupportRateLimit,
  createTenantRegisterRateLimit,
  createTenantTokenConsumeRateLimit,
  createValidarCodigoDescuentoRateLimit,
} from './lib/auth-rate-limit'

dotenv.config()

// Global error hooks — capture uncaught exceptions and unhandled promise
// rejections so they surface in the super-admin error_logs dashboard.
// We do NOT kill the process: Fly's health-check + Sentry-style dedup
// will handle it. Killing on every uncaught means downtime on transient bugs.
process.on('uncaughtException', (err) => {
  logServerError('uncaughtException', err)
  void captureError({
    source: 'backend',
    severity: 'fatal',
    message: err?.message ?? String(err),
    stack: err?.stack ?? null,
    context: { kind: 'uncaughtException' },
  })
})

process.on('unhandledRejection', (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason))
  logServerError('unhandledRejection', err)
  void captureError({
    source: 'backend',
    severity: 'error',
    message: err.message,
    stack: err.stack ?? null,
    context: { kind: 'unhandledRejection' },
  })
})

// Serialización JSON de BigInt (COUNT/SUM de Postgres).
// Vive en lib/bigint-json.ts para que los tests carguen EXACTAMENTE el mismo
// polyfill vía test-env.ts — antes estaba inline acá y los tests, que montan
// los routers sin pasar por este archivo, corrían sin él.
import './lib/bigint-json'

initEventLoopMonitor()

const app = express()
// Trust the first proxy (BFF Next.js). Without this, all rate limiters
// see the BFF's IP instead of the real client IP, making them useless.
app.set('trust proxy', 1)
const PORT = process.env.PORT || 3001
function normalizeOrigin(origin: string) {
  return origin.trim().replace(/\/$/, '')
}

function resolveAllowedOrigins() {
  const configured = [
    process.env.FRONTEND_URL,
    process.env.NEXT_PUBLIC_APP_URL,
    ...(process.env.CORS_ALLOWED_ORIGINS?.split(',') ?? []),
  ]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(normalizeOrigin)

  if (configured.length > 0) {
    return Array.from(new Set(configured))
  }

  return ['http://localhost:3000']
}

const allowedOrigins = new Set(resolveAllowedOrigins())

// Security & perf middleware
app.use(helmet())
app.use(compression())
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true)
    }

    if (allowedOrigins.has(normalizeOrigin(origin))) {
      return callback(null, true)
    }

    // Origen no permitido -> NO tiramos un Error.
    //
    // Antes esto hacía `callback(new Error('CORS origin not allowed'))`, y ese
    // throw caía en `errorHandler`, que responde 500 y persiste el error. O sea:
    // cada bot que escanea la API generaba un "error de backend" y disparaba el
    // mail de alerta al founder. En producción los 5 casos registrados entre
    // jun y ago 2026 fueron todos el mismo escaneo automatizado de WordPress
    // (`POST /index.php?rest_route=/batch/v1`). Ninguno era un usuario real.
    //
    // `callback(null, false)` es la forma correcta: no se mandan las cabeceras
    // de CORS y el NAVEGADOR bloquea la respuesta, que es exactamente como CORS
    // está diseñado para funcionar. No es una capa de control de acceso del
    // servidor y nunca lo fue: un cliente que no sea browser (curl, un bot) la
    // ignora por completo, así que tirar un 500 no protegía nada.
    //
    // Tampoco cambia la postura de seguridad: acá arriba ya se acepta cualquier
    // request SIN header Origin (todo el tráfico server-to-server). El gate real
    // sigue siendo `x-internal-secret` + `middleware/auth.ts`.
    return callback(null, false)
  },
  credentials: true,
}))

// General rate limit: 200 req/min por IP
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes, intentá en un momento' },
}))

app.use('/api/auth/check-slug', createCheckSlugRateLimit())
app.use('/api/auth/registro', createCompanyRegisterRateLimit())
// El reenvío debe registrarse antes que verify-email para que su path más específico
// matchee primero (Express monta por prefijo). Como '/api/auth/verify-email' es prefijo
// de '/api/auth/verify-email/resend', salteamos el limiter de verify en el subpath de
// resend para no consumir ambos buckets en un mismo request.
app.use('/api/auth/verify-email/resend', createEmailVerifyResendRateLimit())
const verifyEmailRateLimit = createEmailVerifyRateLimit()
app.use('/api/auth/verify-email', (req, res, next) => {
  if (req.path === '/resend' || req.path.startsWith('/resend/')) return next()
  return verifyEmailRateLimit(req, res, next)
})
app.use('/api/tenant/:slug/registro', createTenantRegisterRateLimit())
app.use('/api/auth/password/forgot', createPasswordResetForgotRateLimit('auth-password-forgot'))
app.use('/api/auth/password/reset', createPasswordResetConsumeRateLimit('auth-password-reset'))
app.use('/api/tenant/:slug/password/forgot', createPasswordResetForgotRateLimit('tenant-password-forgot'))
app.use('/api/tenant/:slug/password/reset', createPasswordResetConsumeRateLimit('tenant-password-reset'))
app.use('/api/tenant/:slug/auth/token', createTenantTokenConsumeRateLimit())
app.use('/api/tenant/:slug/soporte', createSupportRateLimit())
app.use('/api/tenant/:slug/validar-codigo-descuento', createValidarCodigoDescuentoRateLimit())

app.use('/api/tenant/:slug/checkout', rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de checkout' },
}))

// Reserva de asientos numerados: sin límite dedicado, alguien podía spamear IDs de butacas
// ajenas (obtenidas de /disponibilidad, pública) para bloquearlas repetidamente sin poder
// completar la compra (griefing de stock) — mismo perfil que /checkout, que es el paso
// siguiente del mismo flujo.
app.use('/api/asientos/reservar', rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de reserva de asientos, intentá en un momento' },
}))

app.use('/api/tenant/:slug/consumibles/checkout', rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de checkout de consumibles' },
}))

// Fase 3 — checkout mixto (entradas+addons+consumibles combinados). Mismo perfil
// anti-abuso que los dos checkouts de arriba. Endpoint aditivo, sin wiring desde
// el frontend todavía.
app.use('/api/tenant/:slug/checkout-mixto', rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de checkout' },
}))

app.use('/api/tenant/:slug/refunds', rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de reembolso, reintentá en unos minutos' },
}))

app.use('/api/tenant/:slug/consumibles-refund-requests', rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas solicitudes de reembolso, reintentá en unos minutos' },
}))

// Rate limit para ventas de consumibles
app.use('/api/consumibles/vender', rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas ventas simultáneas, intentá en un momento' },
}))

// POS móvil: venta presencial (boletería). Mismo perfil anti-abuso que
// /consumibles/vender — escribe stock + entradas y puede gatillar envío de email.
app.use('/api/dashboard/pos/venta', rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas ventas simultáneas, intentá en un momento' },
}))

app.use('/api/consumibles/canjear', rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados canjes simultáneos, intentá en un momento' },
}))

app.use('/api/escanear', rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados escaneos, aguardá un momento' },
}))

// Envío de campañas y test-send de marketing: el rate limit vive como middleware de
// RUTA en `routes/marketing.ts` (después de `verifyInternal`/`requireAuth`/
// `requirePermissionMiddleware`), no acá. Montarlo acá, antes de `app.use('/api', routes)`,
// corre ANTES de `verifyInternal` — el backend es públicamente ruteable (no hace falta
// pasar por el BFF), así que un actor sin `x-internal-secret` válido podría gastar una
// transacción Postgres de rate limit (y, si el keying dependiera del header `x-user`
// crudo, hasta agotar el bucket real de otra empresa) antes de ser rechazado.

// Reenvío manual de entrada por email desde el historial: dispara Resend → anti-spam.
app.use('/api/entradas/:id/reenviar-email', rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados reenvíos, aguardá un momento' },
}))

// Crear/editar eventos y sus fechas/tandas/categorías: solo limita escritura
// (POST/PATCH), no GET, para no afectar la carga normal del dashboard.
const eventosWriteRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas operaciones de evento, aguardá un momento' },
})
app.use('/api/eventos', (req, res, next) => {
  if (req.method !== 'POST' && req.method !== 'PATCH') return next()
  return eventosWriteRateLimit(req, res, next)
})

app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))

// Health check (sin autenticación)
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: Date.now() }))

// All API routes
app.use('/api', routes)

// Error handler (siempre al final)
app.use(errorHandler)

async function startServer() {
  app.listen(Number(PORT), '0.0.0.0', () => {
    logServerInfo(`[Backend] Corriendo en puerto ${PORT}`)
  })

  startExpiredCheckoutCleanupJob()
  startMarketingCarritoAbandonadoJob()
  startStorageOrphanCleanupJob()
  startDeliveryRetryJob()
  startSalesVelocitySnapshotJob()
  startRefundSlaAutoApproveJob()
  startFeeTierEvaluationJob()
}

void startServer().catch((err: unknown) => {
  logServerError('backend bootstrap')
  console.error('[Bootstrap error]', err)
  process.exit(1)
})

export default app
