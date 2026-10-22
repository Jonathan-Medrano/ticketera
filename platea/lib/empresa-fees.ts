import type { MarketplaceFeeSummary } from "@/lib/tenant"

export type PlatformFlow = "entradas" | "consumibles"
export type EmpresaMarketplaceFeeSource = "global" | "empresa" | null
export type EmpresaMarketplaceFeeLegacyFallback = "empresa_legacy" | "env_legacy" | null

export type EmpresaMarketplaceFeeSummary = MarketplaceFeeSummary & {
  flow: PlatformFlow
  source: EmpresaMarketplaceFeeSource
  legacyFallback: EmpresaMarketplaceFeeLegacyFallback
}

export type MarketplaceFeeByFlow = Record<PlatformFlow, EmpresaMarketplaceFeeSummary>

type MaybeMarketplaceFeeByFlow = Partial<Record<PlatformFlow, EmpresaMarketplaceFeeSummary>> | null | undefined

export type EmpresaMarketplaceFeeContract = {
  marketplaceFee?: EmpresaMarketplaceFeeSummary
  marketplace_fee?: EmpresaMarketplaceFeeSummary
  marketplaceFeeByFlow?: MaybeMarketplaceFeeByFlow
  marketplace_fee_by_flow?: MaybeMarketplaceFeeByFlow
}

const EMPRESA_FLOWS: PlatformFlow[] = ["entradas", "consumibles"]

export function buildEmptyMarketplaceFeeSummary(flow: PlatformFlow): EmpresaMarketplaceFeeSummary {
  return {
    flow,
    configured: false,
    source: null,
    legacyFallback: null,
    mode: null,
    percentage: null,
    fixedAmount: null,
  }
}

export function buildEmptyMarketplaceFeeByFlow(): MarketplaceFeeByFlow {
  return {
    entradas: buildEmptyMarketplaceFeeSummary("entradas"),
    consumibles: buildEmptyMarketplaceFeeSummary("consumibles"),
  }
}

export function formatEmpresaFeeFlowLabel(flow: PlatformFlow) {
  return flow === "entradas" ? "Entradas" : "Consumibles"
}

function normalizeFlowSummary(flow: PlatformFlow, summary?: EmpresaMarketplaceFeeSummary | null) {
  return summary
    ? {
      ...summary,
      flow,
    }
    : buildEmptyMarketplaceFeeSummary(flow)
}

export function normalizeEmpresaMarketplaceFeeByFlow(contract: EmpresaMarketplaceFeeContract): MarketplaceFeeByFlow {
  const empty = buildEmptyMarketplaceFeeByFlow()
  const plural = contract.marketplaceFeeByFlow ?? contract.marketplace_fee_by_flow
  const singularEntradas = contract.marketplaceFee ?? contract.marketplace_fee ?? null

  return {
    entradas: normalizeFlowSummary("entradas", plural?.entradas ?? singularEntradas ?? empty.entradas),
    consumibles: normalizeFlowSummary("consumibles", plural?.consumibles ?? empty.consumibles),
  }
}

export { EMPRESA_FLOWS }
