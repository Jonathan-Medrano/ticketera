import type { MarketplaceFeeSummary, PlatformFlow } from '../../lib/marketplace-fee'

export type EmpresaMarketplaceFeeByFlow = Record<PlatformFlow, MarketplaceFeeSummary>

export function buildEmpresaMarketplaceFeeContract(marketplaceFeeByFlow: EmpresaMarketplaceFeeByFlow) {
  const legacyEntradasAlias = marketplaceFeeByFlow.entradas

  return {
    marketplaceFee: legacyEntradasAlias,
    marketplace_fee: legacyEntradasAlias,
    marketplaceFeeByFlow: marketplaceFeeByFlow,
    marketplace_fee_by_flow: marketplaceFeeByFlow,
    feeSummaryByFlow: marketplaceFeeByFlow,
    fee_summary_by_flow: marketplaceFeeByFlow,
  }
}
