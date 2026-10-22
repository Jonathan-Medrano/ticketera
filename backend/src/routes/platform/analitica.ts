import { Router } from 'express'
import { requireAuth } from '../../middleware/auth'
import { requirePlatformCapabilityMiddleware } from '../../lib/authz'
import { getPlatformRevenueTimeline } from '../../lib/platform-reporting'
import { createPlatformHandler } from './shared'

const router = Router()

const ALLOWED_PERIODS = new Set([7, 30, 90, 365])

router.get(
  '/revenue-timeline',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.revenue.view.own'),
  createPlatformHandler('platform analitica revenue timeline', async (req, res) => {
    const requestedDays = Number(req.query.days ?? 30)
    const days = ALLOWED_PERIODS.has(requestedDays) ? requestedDays : 30

    const timeline = await getPlatformRevenueTimeline(days)

    return res.json({ data: timeline })
  }),
)

export default router
