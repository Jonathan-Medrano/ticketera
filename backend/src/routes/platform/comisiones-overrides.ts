import { Router } from 'express'
import { prisma } from '../../lib/prisma'
import { requireAuth } from '../../middleware/auth'
import { requirePlatformCapabilityMiddleware } from '../../lib/authz'
import { actorFromRequest, logAuditEvent } from '../../lib/audit-log'
import {
  deleteAllEmpresaOverridesForEmpresa,
  deleteAllEmpresaOverridesForUser,
  deleteEmpresaOverride,
  listEmpresaOverridesByEmpresa,
  listEmpresaOverridesByUser,
  upsertEmpresaOverride,
  type PlatformRevenueFlow,
} from '../../lib/platform-profit-sharing'
import { createPlatformHandler, parsePlatformFlow } from './shared'
import { PlatformGovernanceError } from '../../lib/platform-governance'

const router = Router()

async function assertEmpresaExists(empresaId: string) {
  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true, nombre: true } })
  if (!empresa) throw new PlatformGovernanceError('Empresa no encontrada', 'empresa_not_found', 404)
  return empresa
}

async function assertPlatformUserExists(userId: string) {
  const user = await prisma.platformAdminUser.findUnique({ where: { id: userId }, select: { id: true, nombre: true, singleton_key: true } })
  if (!user) throw new PlatformGovernanceError('Usuario de plataforma no encontrado', 'platform_user_not_found', 404)
  if (user.singleton_key === 'superadmin') {
    throw new PlatformGovernanceError('El superadmin no admite overrides por empresa (su share es el remainder del bag)', 'superadmin_override_forbidden', 400)
  }
  return user
}

router.get(
  '/empresa/:empresaId',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.companies.read'),
  createPlatformHandler('platform comisiones-overrides list by empresa', async (req, res) => {
    await assertEmpresaExists(req.params.empresaId)
    const overrides = await listEmpresaOverridesByEmpresa(req.params.empresaId)
    return res.json({ data: { overrides } })
  })
)

router.get(
  '/usuario/:userId',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.users.read'),
  createPlatformHandler('platform comisiones-overrides list by user', async (req, res) => {
    const overrides = await listEmpresaOverridesByUser(req.params.userId)
    return res.json({ data: { overrides } })
  })
)

router.put(
  '/empresa/:empresaId/usuario/:userId/flow/:flow',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.companies.overrides.edit'),
  createPlatformHandler('platform comisiones-overrides upsert', async (req, res) => {
    const empresa = await assertEmpresaExists(req.params.empresaId)
    const user = await assertPlatformUserExists(req.params.userId)
    const flow = parsePlatformFlow(req.params.flow) as PlatformRevenueFlow

    const rawBody = (req.body ?? {}) as Record<string, unknown>
    if (rawBody.percentage === undefined || rawBody.percentage === null) {
      throw new PlatformGovernanceError('percentage es obligatorio (número entre 0 y 100)', 'percentage_required', 400)
    }
    const percentage = Number(rawBody.percentage)
    if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
      throw new PlatformGovernanceError('percentage debe ser un número entre 0 y 100', 'percentage_invalid', 400)
    }

    const row = await upsertEmpresaOverride({
      platformAdminUserId: req.params.userId,
      empresaId: req.params.empresaId,
      flow,
      percentage,
      configuredByPlatformAdminId: req.user!.id,
    })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.empresa_override.upserted',
      entityType: 'platform_empresa_override',
      entityId: `${req.params.empresaId}:${req.params.userId}:${flow}`,
      entityLabel: `${empresa.nombre} ← ${user.nombre} (${flow})`,
      payload: { percentage, flow, empresaId: empresa.id, platformAdminUserId: user.id },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.json({ data: { override: row } })
  }, { allowGenericBadRequest: true })
)

router.delete(
  '/empresa/:empresaId/usuario/:userId/flow/:flow',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.companies.overrides.edit'),
  createPlatformHandler('platform comisiones-overrides delete', async (req, res) => {
    const empresa = await assertEmpresaExists(req.params.empresaId)
    const user = await assertPlatformUserExists(req.params.userId)
    const flow = parsePlatformFlow(req.params.flow) as PlatformRevenueFlow

    await deleteEmpresaOverride({
      platformAdminUserId: req.params.userId,
      empresaId: req.params.empresaId,
      flow,
    })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.empresa_override.deleted',
      entityType: 'platform_empresa_override',
      entityId: `${req.params.empresaId}:${req.params.userId}:${flow}`,
      entityLabel: `${empresa.nombre} ← ${user.nombre} (${flow})`,
      payload: { flow, empresaId: empresa.id, platformAdminUserId: user.id },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.status(204).send()
  })
)

router.delete(
  '/empresa/:empresaId',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.companies.overrides.edit'),
  createPlatformHandler('platform comisiones-overrides clear empresa', async (req, res) => {
    const empresa = await assertEmpresaExists(req.params.empresaId)
    await deleteAllEmpresaOverridesForEmpresa(req.params.empresaId)

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.empresa_override.cleared_empresa',
      entityType: 'platform_empresa_override',
      entityId: req.params.empresaId,
      entityLabel: empresa.nombre,
      payload: { empresaId: empresa.id },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.status(204).send()
  })
)

router.delete(
  '/usuario/:userId',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.users.write'),
  createPlatformHandler('platform comisiones-overrides clear user', async (req, res) => {
    const user = await assertPlatformUserExists(req.params.userId)
    await deleteAllEmpresaOverridesForUser(req.params.userId)

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.empresa_override.cleared_user',
      entityType: 'platform_empresa_override',
      entityId: req.params.userId,
      entityLabel: user.nombre,
      payload: { platformAdminUserId: user.id },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.status(204).send()
  })
)

export default router
