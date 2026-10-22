import { Router } from 'express'
import { requireAuth, verifyInternal } from '../middleware/auth'
import authRouter from './auth'
import dashboardRouter from './dashboard'
import cobrosRouter from './cobros'
import configuracionRouter from './configuracion'
import sitioVentaRouter from './sitio-venta'
import sitioVentaTemplatesRouter from './sitio-venta-templates'
import eventosRouter from './eventos'
import equipoRouter from './equipo'
import rolesRouter from './roles'
import entradasRouter from './entradas'
import escanearRouter from './escanear'
import compradoresRouter from './compradores'
import revendedoresRouter from './revendedores'
import consumiblesRouter from './consumibles'
import barrasRouter from './barras'
import venderRouter from './vender'
import canjearRouter from './canjear'
import ventasRouter from './ventas'
import promocionesRouter from './promociones'
import preimpresosRouter from './preimpresos'
import addonsRouter from './addons'
import asientosRouter from './asientos'
import posRouter from './pos'
import demoDataRouter from './demo-data'
import { waitlistAdminRouter, waitlistPublicRouter } from './waitlist'
import platformRouter from './platform'
import tenantRouter from './tenant'
import vidrieraRouter from './vidriera'
import reembolsosRouter from './reembolsos'
import marketingRouter from './marketing'
import reconciliacionRouter from './reconciliacion'
import comisionesRouter from './comisiones'
import webhooksRouter from './webhooks'
import clientErrorsRouter from './client-errors'
import victoriaRouter from './victoria'
import dashboardMensajesRouter from './dashboard/mensajes'
import dashboardFeaturesRouter from './dashboard/features'
import { publicLandingAnnouncementRouter } from './landing-announcement'
import { requireInternalDashboardActorMiddleware } from '../lib/authz'

const router = Router()
const internalDashboardGuards = [verifyInternal, requireAuth, requireInternalDashboardActorMiddleware] as const

// Auth pública
router.use('/auth', authRouter)

// Landing announcement — público (sin auth), pegado a la landing pública
router.use('/landing-announcement', publicLandingAnnouncementRouter)

// Dashboard — empresa
router.use('/dashboard', ...internalDashboardGuards, dashboardRouter)
router.use('/reembolsos', ...internalDashboardGuards, reembolsosRouter)
router.use('/marketing', ...internalDashboardGuards, marketingRouter)
router.use('/cobros', ...internalDashboardGuards, cobrosRouter)
router.use('/configuracion', ...internalDashboardGuards, configuracionRouter)
router.use('/sitio-venta', ...internalDashboardGuards, sitioVentaRouter)
router.use('/sitio-venta/templates', ...internalDashboardGuards, sitioVentaTemplatesRouter)
router.use('/eventos', ...internalDashboardGuards, eventosRouter)
router.use('/equipo', ...internalDashboardGuards, equipoRouter)
router.use('/roles', ...internalDashboardGuards, rolesRouter)
router.use('/entradas', ...internalDashboardGuards, entradasRouter)
router.use('/escanear', ...internalDashboardGuards, escanearRouter)
router.use('/compradores', ...internalDashboardGuards, compradoresRouter)
router.use('/revendedores', ...internalDashboardGuards, revendedoresRouter)
router.use('/reconciliacion', ...internalDashboardGuards, reconciliacionRouter)
router.use('/comisiones', ...internalDashboardGuards, comisionesRouter)
router.use('/platform', platformRouter)
router.use('/dashboard/mensajes', ...internalDashboardGuards, dashboardMensajesRouter)
router.use('/dashboard/features', ...internalDashboardGuards, dashboardFeaturesRouter)

// Consumibles — orden importa: rutas con nombres antes que /:id
router.use('/consumibles/barras', ...internalDashboardGuards, barrasRouter)
router.use('/consumibles/ventas', ...internalDashboardGuards, ventasRouter)
router.use('/consumibles/vender', ...internalDashboardGuards, venderRouter)
router.use('/consumibles/canjear', ...internalDashboardGuards, canjearRouter)
router.use('/consumibles/promociones', ...internalDashboardGuards, promocionesRouter)
router.use('/consumibles', ...internalDashboardGuards, consumiblesRouter)

// Tickets físicos pre-impresos — generación de lotes, PDF, anulación
router.use('/preimpresos', ...internalDashboardGuards, preimpresosRouter)

// Add-ons del evento (parking, meet&greet, merch) — CRUD admin
router.use('/dashboard/addons', ...internalDashboardGuards, addonsRouter)

// Seated events — secciones + asientos (dashboard CRUD + public availability + checkout reserve)
// Note: /asientos/reservar is verifyInternal-only (no requireAuth — called from the checkout BFF)
// Note: /:eventoId/disponibilidad is fully public (active evento check inside)
// Note: seat release on checkout expiry runs inline in services/checkoutCleanup.ts, and seat
// confirm on payment success runs inline in routes/tenant.ts — NOT via HTTP routes on this router
router.use('/asientos', asientosRouter)

// POS móvil — venta presencial desde dashboard (boletería en puerta, festival, kiosko)
router.use('/dashboard/pos', ...internalDashboardGuards, posRouter)

// Demo data generators — botones de "crear caso random" para empresas es_prueba=true
router.use('/dashboard/demo-data', ...internalDashboardGuards, demoDataRouter)

// Waitlist público (comprador anota cuando agotado) — verifyInternal + comprador auth inline
router.use('/tenant/:slug/waitlist', verifyInternal, waitlistPublicRouter)

// Waitlist admin (empresa ve la lista por evento)
router.use('/dashboard/waitlist', ...internalDashboardGuards, waitlistAdminRouter)

// Webhooks — accesibles sin requireAuth, solo con verifyInternal (llegan del BFF)
router.use('/webhooks', verifyInternal, webhooksRouter)

// Client error reports — público vía BFF (verifyInternal), sin requireAuth porque
// hasta los compradores anónimos pueden generar errores de browser que queremos capturar.
router.use('/client-errors', verifyInternal, clientErrorsRouter)

// Telemetría del asistente Victoria — feedback del browser vía BFF. Requiere sesión
// interna (empresa/empleado): el empresa_id sale SIEMPRE del contexto autenticado,
// nunca del body. El rate limit (empresa+IP) vive dentro del router, tras la auth.
router.use('/victoria', ...internalDashboardGuards, victoriaRouter)

// Tenant — rutas B2C públicas
router.use('/tenant', tenantRouter)

// Vidriera — descubrimiento público CROSS-TENANT (home marketing + página /eventos).
// No confundir con "marketplace" (PlatformMarketplaceFeeDefault / EmpresaMarketplaceFeeOverride),
// que es el modelo de fee de Mercado Pago — concepto no relacionado.
router.use('/vidriera', vidrieraRouter)

export default router
