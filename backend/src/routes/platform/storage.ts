import { Router } from 'express'
import { requireAuth } from '../../middleware/auth'
import { requirePlatformCapabilityMiddleware } from '../../lib/authz'
import { getStorageCleanupHistory, runStorageOrphanCleanup } from '../../services/storageOrphanCleanup'
import { createPlatformHandler } from './shared'

const router = Router()

router.post(
  '/orphan-cleanup',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.companies.read'),
  createPlatformHandler('platform storage orphan-cleanup', async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const dryRun = body.dryRun === true
    const cooldownHours =
      typeof body.cooldownHours === 'number' && Number.isFinite(body.cooldownHours) && body.cooldownHours >= 0
        ? body.cooldownHours
        : undefined

    const user = req.user
    const triggeredByUserId = user ? String(user.id ?? '') || null : null
    const triggeredByUserName = user
      ? (user.name as string | undefined) ?? (user.email as string | undefined) ?? null
      : null

    const result = await runStorageOrphanCleanup({
      dryRun,
      cooldownHours,
      triggeredBy: 'manual',
      triggeredByUserId,
      triggeredByUserName,
    })
    return res.json({ data: result })
  }),
)

router.get(
  '/cleanup-history',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.companies.read'),
  createPlatformHandler('platform storage cleanup-history', async (req, res) => {
    const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : 50
    const runs = await getStorageCleanupHistory(limit)
    return res.json({ data: { runs } })
  }),
)

export default router
