import type { Request, Response } from 'express'
import type { PlatformFlow } from '../../lib/marketplace-fee'
import { PLATFORM_FLOWS } from '../../lib/marketplace-fee'
import type { MarketplaceFeeMode } from '../../lib/payment-accounts'
import { PlatformGovernanceError } from '../../lib/platform-governance'
import { logServerError } from '../../lib/safe-log'

export function parsePlatformFlow(raw: unknown): PlatformFlow {
  if (raw === 'entradas' || raw === 'consumibles') {
    return raw
  }

  throw new PlatformGovernanceError('El flow platform es obligatorio y debe ser entradas o consumibles', 'platform_flow_invalid', 400)
}

export function parseMarketplaceFeeBody(body: Record<string, unknown>) {
  const rawMarketplaceFeeMode = typeof body.marketplaceFeeMode === 'string'
    ? body.marketplaceFeeMode
    : typeof body.mode === 'string'
      ? body.mode
      : null

  if (!rawMarketplaceFeeMode) {
    throw new PlatformGovernanceError('El modo de comisión marketplace es obligatorio', 'marketplace_fee_mode_required', 400)
  }

  if (rawMarketplaceFeeMode !== 'percentage' && rawMarketplaceFeeMode !== 'fixed' && rawMarketplaceFeeMode !== 'hybrid') {
    throw new PlatformGovernanceError('El modo de comisión marketplace es inválido', 'marketplace_fee_mode_invalid', 400)
  }

  const marketplaceFeeMode: MarketplaceFeeMode = rawMarketplaceFeeMode

  return {
    marketplaceFeeMode,
    marketplaceFeePercentage: body.marketplaceFeePercentage === undefined
      ? body.percentage === undefined
        ? null
        : Number(body.percentage)
      : body.marketplaceFeePercentage === null
        ? null
        : Number(body.marketplaceFeePercentage),
    marketplaceFeeFixedAmount: body.marketplaceFeeFixedAmount === undefined
      ? body.fixedAmount === undefined
        ? null
        : Number(body.fixedAmount)
      : body.marketplaceFeeFixedAmount === null
        ? null
        : Number(body.marketplaceFeeFixedAmount),
  } as const
}

export function buildCompanyContract(params: {
  company: {
    id: string
    nombre: string
    slug: string
    activa: boolean
    esPrueba?: boolean
    tenantPublicDisabled: boolean
    suspendido: boolean
    aprobada?: boolean
    revendedorHabilitado?: boolean
    consumiblesHabilitado?: boolean
    gananciasOwner: number
    volumenBruto: number
    ventas: number
    metricasPorFlow: unknown
  }
  salesReadiness: unknown
  marketplaceFeeByFlow: Record<PlatformFlow, unknown>
}) {
  return {
    id: params.company.id,
    nombre: params.company.nombre,
    slug: params.company.slug,
    activa: params.company.activa,
    esPrueba: params.company.esPrueba ?? false,
    es_prueba: params.company.esPrueba ?? false,
    tenantPublicDisabled: params.company.tenantPublicDisabled,
    tenant_public_disabled: params.company.tenantPublicDisabled,
    suspendido: params.company.suspendido,
    aprobada: params.company.aprobada ?? true,
    revendedorHabilitado: params.company.revendedorHabilitado ?? true,
    consumiblesHabilitado: params.company.consumiblesHabilitado ?? true,
    gananciasOwner: params.company.gananciasOwner,
    volumenBruto: params.company.volumenBruto,
    ventas: params.company.ventas,
    metricasPorFlow: params.company.metricasPorFlow,
    metricas_por_flow: params.company.metricasPorFlow,
    salesReadiness: params.salesReadiness,
    sales_readiness: params.salesReadiness,
    marketplaceFee: params.marketplaceFeeByFlow.entradas,
    marketplace_fee: params.marketplaceFeeByFlow.entradas,
    marketplaceFeeByFlow: params.marketplaceFeeByFlow,
    marketplace_fee_by_flow: params.marketplaceFeeByFlow,
    feeSummaryByFlow: params.marketplaceFeeByFlow,
    fee_summary_by_flow: params.marketplaceFeeByFlow,
  }
}

export function createPlatformHandler(
  serverErrorContext: string,
  handler: (req: Request, res: Response) => Promise<Response | void>,
  options: { allowGenericBadRequest?: boolean } = {}
) {
  return async (req: Request, res: Response) => {
    try {
      return await handler(req, res)
    } catch (error) {
      if (error instanceof PlatformGovernanceError) {
        return res.status(error.statusCode).json(error.payload ?? { error: error.message, code: error.code })
      }

      if (options.allowGenericBadRequest && error instanceof Error) {
        return res.status(400).json({ error: error.message })
      }

      logServerError(serverErrorContext)
      return res.status(500).json({ error: 'Error interno del servidor' })
    }
  }
}

export function listPlatformFlows() {
  return [...PLATFORM_FLOWS]
}
