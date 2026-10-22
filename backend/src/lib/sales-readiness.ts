import { prisma } from './prisma'
import { getPaymentAccountReadModelByEmpresaId, type PaymentAccountReadModel } from './payment-accounts'
import { getMarketplaceFeeSummariesByFlow, type MarketplaceFeeSummary, type PlatformFlow } from './marketplace-fee'

export type SalesReadinessStatus = 'missing_provider' | 'pending_validation' | 'ready_to_sell' | 'blocked'
export type SalesReadinessReason =
  | 'missing_provider'
  | 'missing_marketplace_fee'
  | 'credentials_invalid'
  | 'provider_unreachable'
  | 'provider_blocked'
  | 'manual_block'
  | 'validation_pending'

export type SalesReadiness = {
  status: SalesReadinessStatus
  reason: SalesReadinessReason | null
  canSell: boolean
}

export class SalesReadinessError extends Error {
  code = 'sales_not_ready' as const
  statusCode = 409
  readiness: SalesReadiness

  constructor(readiness: SalesReadiness) {
    super('La empresa no está lista para vender')
    this.name = 'SalesReadinessError'
    this.readiness = readiness
  }
}

function buildSalesReadiness(status: SalesReadinessStatus, reason: SalesReadinessReason | null): SalesReadiness {
  return {
    status,
    reason,
    canSell: status === 'ready_to_sell',
  }
}

export function computeSalesReadiness(
  paymentAccount: PaymentAccountReadModel | null | undefined,
  marketplaceFee: Record<PlatformFlow, MarketplaceFeeSummary> | null | undefined,
): SalesReadiness {
  if (!paymentAccount) {
    return buildSalesReadiness('missing_provider', 'missing_provider')
  }

  if (paymentAccount.status === 'blocked' || paymentAccount.blockedAt) {
    return buildSalesReadiness('blocked', paymentAccount.reason ?? 'manual_block')
  }

  if (paymentAccount.status === 'ready_to_sell') {
    if (!marketplaceFee?.entradas.configured || !marketplaceFee?.consumibles.configured) {
      return buildSalesReadiness('pending_validation', 'missing_marketplace_fee')
    }
    return buildSalesReadiness('ready_to_sell', null)
  }

  return buildSalesReadiness('pending_validation', paymentAccount.reason ?? 'validation_pending')
}

export async function getSalesReadiness(
  empresaId: string,
  options: { preloadedMarketplaceFee?: Record<PlatformFlow, MarketplaceFeeSummary> } = {},
): Promise<SalesReadiness> {
  const [paymentAccount, marketplaceFee] = await Promise.all([
    getPaymentAccountReadModelByEmpresaId(empresaId),
    options.preloadedMarketplaceFee
      ? Promise.resolve(options.preloadedMarketplaceFee)
      : getMarketplaceFeeSummariesByFlow(empresaId),
  ])

  return computeSalesReadiness(paymentAccount, marketplaceFee)
}

export async function assertCanSell(empresaId: string) {
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { suspendido: true },
  })
  if (empresa?.suspendido) {
    throw Object.assign(new Error('Esta empresa está suspendida'), { status: 403 })
  }

  const readiness = await getSalesReadiness(empresaId)

  if (!readiness.canSell) {
    throw new SalesReadinessError(readiness)
  }

  return readiness
}
