import { Router } from 'express'
import { requireAuth } from '../../middleware/auth'
import { requirePlatformCapabilityMiddleware } from '../../lib/authz'
import { listPlatformRoles } from '../../lib/platform-governance'
import { createPlatformHandler } from './shared'

const router = Router()

router.get(
  '/',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.users.read'),
  createPlatformHandler('platform roles list', async (_req, res) => {
    return res.json({
      data: {
        roles: listPlatformRoles(),
      },
    })
  })
)

export default router
