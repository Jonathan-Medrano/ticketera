import { Router } from 'express'
import { getMarketplaceFeeSummariesByFlowBulk } from '../../lib/marketplace-fee'
import { getPaymentAccountReadModelByEmpresaIdsBulk } from '../../lib/payment-accounts'
import { getPlatformDashboardReporting } from '../../lib/platform-reporting'
import { computeSalesReadiness } from '../../lib/sales-readiness'
import { requireAuth } from '../../middleware/auth'
import { requirePlatformCapabilityMiddleware } from '../../lib/authz'
import { buildCompanyContract, createPlatformHandler } from './shared'

const router = Router()

router.get(
  '/',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.revenue.view.own'),
  createPlatformHandler('platform dashboard', async (req, res) => {
    const reporting = await getPlatformDashboardReporting(req.user!)

    const empresaIds = reporting.empresasResumen.map((row) => row.id)
    const [feesMap, accountsMap] = await Promise.all([
      getMarketplaceFeeSummariesByFlowBulk(empresaIds),
      getPaymentAccountReadModelByEmpresaIdsBulk(empresaIds),
    ])

    const empresasResumen = reporting.empresasResumen.map((row) => {
      const marketplaceFeeByFlow = feesMap.get(row.id)!
      const paymentAccount = accountsMap.get(row.id) ?? null
      const salesReadiness = computeSalesReadiness(paymentAccount, marketplaceFeeByFlow)

      return {
        ganancias_owner: row.gananciasOwner,
        ...buildCompanyContract({
          company: row,
          salesReadiness,
          marketplaceFeeByFlow,
        }),
      }
    })

    return res.json({
      data: {
        metricas: reporting.metricas,
        metricas_scope: reporting.metricasScope,
        metricasScope: reporting.metricasScope,
        metricas_por_flow: reporting.metricasPorFlow,
        metricasPorFlow: reporting.metricasPorFlow,
        ganancias_por_dia: reporting.gananciasPorDia,
        empresas_resumen: empresasResumen,
        healthSnapshot: reporting.healthSnapshot,
        health_snapshot: reporting.healthSnapshot,
        viewerScope: reporting.viewerScope,
        viewer_scope: reporting.viewerScope,
        profitSharing: reporting.profitSharing,
        profit_sharing: reporting.profitSharing,
      },
    })
  })
)

export default router
