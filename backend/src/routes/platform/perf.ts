import { Router } from 'express'
import { requireAuth } from '../../middleware/auth'
import { requirePlatformCapabilityMiddleware } from '../../lib/authz'
import { getDatabaseSnapshot, getSystemSnapshot } from '../../lib/perf-metrics'
import { getPerformancePredictions } from '../../services/perfPredictions'
import { runPerfTests } from '../../services/perfTests'
import { createPlatformHandler } from './shared'

const router = Router()

/**
 * GET /api/platform/perf/snapshot
 * Snapshot read-only del estado del servidor + DB + predicciones.
 * Diseñado para ser barato — apto para auto-refresh cada N segundos.
 */
router.get(
  '/snapshot',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.companies.read'),
  createPlatformHandler('platform perf snapshot', async (_req, res) => {
    const [database, predictions] = await Promise.all([
      getDatabaseSnapshot(),
      getPerformancePredictions(),
    ])
    return res.json({
      data: {
        generatedAt: new Date().toISOString(),
        system: getSystemSnapshot(),
        database,
        predictions,
      },
    })
  }),
)

/**
 * POST /api/platform/perf/run-tests
 * Corre suite sintética de queries críticas + ping a Supabase. On-demand.
 */
router.post(
  '/run-tests',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.companies.read'),
  createPlatformHandler('platform perf run-tests', async (_req, res) => {
    const result = await runPerfTests()
    return res.json({ data: result })
  }),
)

export default router
