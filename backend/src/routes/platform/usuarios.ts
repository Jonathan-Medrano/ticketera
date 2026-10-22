import { Router } from 'express'
import { prisma } from '../../lib/prisma'
import { requireAuth } from '../../middleware/auth'
import { requirePlatformCapabilityMiddleware } from '../../lib/authz'
import { actorFromRequest, logAuditEvent } from '../../lib/audit-log'
import { createPlatformUser, deletePlatformUser, listPlatformUsersForViewer, updatePlatformUser } from '../../lib/platform-governance'
import { createPlatformHandler } from './shared'

const router = Router()

function parsePlatformUserBody(body: Record<string, unknown>) {
  const shareByFlowRaw = body.shareByFlow && typeof body.shareByFlow === 'object'
    ? body.shareByFlow as Record<string, unknown>
    : body.share_by_flow && typeof body.share_by_flow === 'object'
      ? body.share_by_flow as Record<string, unknown>
      : null

  return {
    nombre: typeof body.nombre === 'string' ? body.nombre : undefined,
    email: typeof body.email === 'string' ? body.email : undefined,
    loginAlias: typeof body.loginAlias === 'string'
      ? body.loginAlias
      : typeof body.login_alias === 'string'
        ? body.login_alias
        : undefined,
    password: typeof body.password === 'string' ? body.password : undefined,
    temporaryPassword: body.temporaryPassword === true,
    roleSlug: typeof body.roleSlug === 'string'
      ? body.roleSlug
      : typeof body.role_slug === 'string'
        ? body.role_slug
        : undefined,
    roleLabel: typeof body.roleLabel === 'string'
      ? body.roleLabel
      : typeof body.role_label === 'string'
        ? body.role_label
        : undefined,
    parentUserId: typeof body.parentUserId === 'string'
      ? body.parentUserId
      : typeof body.parent_user_id === 'string'
        ? body.parent_user_id
        : body.parentUserId === null || body.parent_user_id === null
          ? null
          : undefined,
    branchRootUserId: typeof body.branchRootUserId === 'string'
      ? body.branchRootUserId
      : typeof body.branch_root_user_id === 'string'
        ? body.branch_root_user_id
        : undefined,
    capabilities: Array.isArray(body.capabilities) ? body.capabilities : undefined,
    permisos: body.permisos,
    revenueGrants: shareByFlowRaw
      ? {
          entradas: shareByFlowRaw.entradas === undefined ? undefined : Number(shareByFlowRaw.entradas),
          consumibles: shareByFlowRaw.consumibles === undefined ? undefined : Number(shareByFlowRaw.consumibles),
        }
      : body.revenueGrants && typeof body.revenueGrants === 'object'
        ? {
            entradas: (body.revenueGrants as Record<string, unknown>).entradas === undefined ? undefined : Number((body.revenueGrants as Record<string, unknown>).entradas),
            consumibles: (body.revenueGrants as Record<string, unknown>).consumibles === undefined ? undefined : Number((body.revenueGrants as Record<string, unknown>).consumibles),
          }
        : undefined,
    shareByFlow: shareByFlowRaw
      ? {
          entradas: shareByFlowRaw.entradas === undefined ? undefined : Number(shareByFlowRaw.entradas),
          consumibles: shareByFlowRaw.consumibles === undefined ? undefined : Number(shareByFlowRaw.consumibles),
        }
      : undefined,
    activo: typeof body.activo === 'boolean' ? body.activo : undefined,
  }
}

router.get(
  '/',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.users.read'),
  createPlatformHandler('platform usuarios list', async (req, res) => {
    const governance = await listPlatformUsersForViewer(req.user!.id)

    return res.json({
      data: {
        usuarios: governance.usuarios,
        viewerPolicy: governance.viewerPolicy,
        viewer_policy: governance.viewerPolicy,
        capabilityCatalog: governance.capabilityCatalog,
        capability_catalog: governance.capabilityCatalog,
        branchTree: governance.branchTree,
        branch_tree: governance.branchTree,
        revenueVisibilityScope: governance.revenueVisibilityScope,
        revenue_visibility_scope: governance.revenueVisibilityScope,
      },
    })
  })
)

router.post(
  '/',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.users.write'),
  createPlatformHandler('platform usuarios create', async (req, res) => {
    const body = parsePlatformUserBody(req.body as Record<string, unknown>)
    const usuario = await createPlatformUser(body, { actorUserId: req.user!.id })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.user.created',
      entityType: 'platform_user',
      entityId: String((usuario as { id?: string }).id ?? ''),
      entityLabel: body.nombre ?? body.email ?? body.loginAlias ?? null,
      payload: {
        email: body.email ?? null,
        roleSlug: body.roleSlug ?? null,
        parentUserId: body.parentUserId ?? null,
        capabilitiesCount: Array.isArray(body.capabilities) ? body.capabilities.length : 0,
      },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.status(201).json({ data: { usuario } })
  }, { allowGenericBadRequest: true })
)

router.patch(
  '/:userId',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.users.write'),
  createPlatformHandler('platform usuarios update', async (req, res) => {
    const body = parsePlatformUserBody(req.body as Record<string, unknown>)
    const usuario = await updatePlatformUser(req.params.userId, body, { actorUserId: req.user!.id })

    const changedFields = Object.entries(body).filter(([, value]) => value !== undefined).map(([key]) => key)

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.user.updated',
      entityType: 'platform_user',
      entityId: req.params.userId,
      entityLabel: body.nombre ?? body.email ?? null,
      payload: {
        changedFields,
        roleSlug: body.roleSlug ?? null,
        capabilitiesCount: Array.isArray(body.capabilities) ? body.capabilities.length : null,
        activo: body.activo ?? null,
      },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.json({ data: { usuario } })
  }, { allowGenericBadRequest: true })
)

router.delete(
  '/:userId',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.users.write'),
  createPlatformHandler('platform usuarios delete', async (req, res) => {
    const snapshot = await prisma.usuario.findUnique({
      where: { id: req.params.userId },
      select: { id: true, nombre: true, email: true, rol: true },
    })

    await deletePlatformUser(req.params.userId, { actorUserId: req.user!.id })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.user.deleted',
      entityType: 'platform_user',
      entityId: req.params.userId,
      entityLabel: snapshot ? String(snapshot.nombre ?? snapshot.email ?? req.params.userId) : req.params.userId,
      payload: snapshot
        ? {
            email: snapshot.email ?? null,
            roleSlug: snapshot.rol ?? null,
          }
        : null,
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.status(204).send()
  })
)

export default router
