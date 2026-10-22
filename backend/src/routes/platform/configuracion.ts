import { Router } from 'express'
import { getPlatformMarketplaceFeeDefaultsByFlow, upsertPlatformMarketplaceFeeDefault } from '../../lib/marketplace-fee'
import { getPlatformOwnerPaymentAccountReadModel } from '../../lib/platform-owner-payment-account'
import { getPlatformPaymentAccountReadModel } from '../../lib/platform-payment-accounts'
import { getPlatformProfitSharingOverview } from '../../lib/platform-profit-sharing'
import { requireAuth } from '../../middleware/auth'
import { requirePlatformCapabilityMiddleware } from '../../lib/authz'
import { createPlatformHandler, parseMarketplaceFeeBody, parsePlatformFlow } from './shared'
import { getAutoAprobarEmpresas, setAutoAprobarEmpresas } from '../../lib/platform-settings'
import { sendEmpresaApprovedEmail } from '../../lib/empresa-approved-email'
import { actorFromRequest, logAuditEvent } from '../../lib/audit-log'
import { prisma } from '../../lib/prisma'
import { revalidateVidriera } from '../../lib/revalidate-vidriera'

const router = Router()

router.get(
  '/fees',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.settings.read'),
  createPlatformHandler('platform configuracion fees get', async (req, res) => {
    const viewerScope = req.user!.platformViewerPolicy?.revenueVisibilityScope ?? (req.user!.userType === 'super_admin' ? 'global' : 'own')
    const isSingletonSuperadmin = req.user!.userType === 'super_admin'
    const [defaultsByFlow, currentUserPaymentAccount] = await Promise.all([
      getPlatformMarketplaceFeeDefaultsByFlow(),
      getPlatformPaymentAccountReadModel(req.user!.id),
    ])
    const profitSharingCutoff = isSingletonSuperadmin
      ? (await getPlatformProfitSharingOverview()).cutoff
      : { startsAt: null, source: 'first_allocation' as const }
    const ownerPaymentAccount = isSingletonSuperadmin
      ? await getPlatformOwnerPaymentAccountReadModel()
      : null

    return res.json({
      data: {
        defaultsByFlow,
        defaults_by_flow: defaultsByFlow,
        currentUserPaymentAccount,
        current_user_payment_account: currentUserPaymentAccount,
        ownerPaymentAccount,
        owner_payment_account: ownerPaymentAccount,
        profitSharingCutoff: profitSharingCutoff,
        profit_sharing_cutoff: profitSharingCutoff,
        viewerScope,
        viewer_scope: viewerScope,
      },
    })
  })
)

router.patch(
  '/fees',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.fees.defaults.edit'),
  createPlatformHandler('platform configuracion fees patch', async (req, res) => {
    const body = req.body as Record<string, unknown>
    const flow = parsePlatformFlow(body.flow)
    const config = parseMarketplaceFeeBody(body)

    const feeSummary = await upsertPlatformMarketplaceFeeDefault({
      flow,
      ...config,
      updatedByPlatformAdminId: req.user!.id,
    })

    const defaultsByFlow = await getPlatformMarketplaceFeeDefaultsByFlow()

    return res.json({
      data: {
        flow,
        feeSummary,
        fee_summary: feeSummary,
        defaultsByFlow,
        defaults_by_flow: defaultsByFlow,
      },
    })
  }, { allowGenericBadRequest: true })
)

// GET /auto-aprobacion — estado del flag de auto-aprobación de empresas.
router.get(
  '/auto-aprobacion',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.settings.read'),
  createPlatformHandler('platform configuracion auto-aprobacion get', async (_req, res) => {
    const autoAprobarEmpresas = await getAutoAprobarEmpresas()
    return res.json({ data: { auto_aprobar_empresas: autoAprobarEmpresas } })
  })
)

// PATCH /auto-aprobacion — activa/desactiva la auto-aprobación de empresas.
// Reusa la capability de overrides de empresas (no existe platform.settings.edit).
router.patch(
  '/auto-aprobacion',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.companies.overrides.edit'),
  createPlatformHandler('platform configuracion auto-aprobacion patch', async (req, res) => {
    const value = (req.body as Record<string, unknown>)?.auto_aprobar_empresas
    if (typeof value !== 'boolean') {
      return res.status(400).json({ error: 'auto_aprobar_empresas debe ser boolean' })
    }

    await setAutoAprobarEmpresas(value, req.user!.id)

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.settings.auto_aprobacion.updated',
      entityType: 'platform_setting',
      entityId: 'singleton',
      entityLabel: 'auto_aprobar_empresas',
      payload: { auto_aprobar_empresas: value },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.json({ data: { auto_aprobar_empresas: value } })
  })
)

// POST /aprobar-pendientes — aprueba en bloque todas las empresas pendientes.
router.post(
  '/aprobar-pendientes',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.companies.overrides.edit'),
  createPlatformHandler('platform configuracion aprobar-pendientes post', async (req, res) => {
    const pendientes = await prisma.empresa.findMany({
      where: { aprobada: false },
      select: { id: true, nombre: true, email: true, admin_nombre: true },
    })

    if (pendientes.length === 0) {
      void logAuditEvent({
        actor: actorFromRequest(req),
        action: 'platform.empresa.bulk_approved',
        entityType: 'empresa',
        entityId: null,
        entityLabel: 'aprobar-pendientes',
        payload: { aprobadas: 0 },
        ipAddress: req.requestMeta?.ip ?? null,
      })
      return res.json({ data: { aprobadas: 0 } })
    }

    const ids = pendientes.map((e) => e.id)
    const now = new Date()
    await prisma.empresa.updateMany({
      where: { id: { in: ids } },
      data: { aprobada: true, aprobada_at: now },
    })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.empresa.bulk_approved',
      entityType: 'empresa',
      entityId: null,
      entityLabel: 'aprobar-pendientes',
      payload: { aprobadas: pendientes.length, ids },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    // aprobada es uno de los flags de elegibilidad de la vidriera (vidriera.ts)
    void revalidateVidriera()

    // Emails best-effort, en serie (sendEmpresaApprovedEmail ya es no-throw).
    for (const empresa of pendientes) {
      if (!empresa.email) continue
      await sendEmpresaApprovedEmail({
        email: empresa.email,
        nombre: empresa.nombre,
        adminNombre: empresa.admin_nombre,
      })
    }

    return res.json({ data: { aprobadas: pendientes.length } })
  })
)

export default router
