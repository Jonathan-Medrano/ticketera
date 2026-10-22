import { randomUUID as uuidv4 } from 'node:crypto'
import { prisma } from './prisma'
import { roundMoney } from './money'
import type { MarketplaceFeeConfig, MarketplaceFeeMode } from './payment-accounts'

export type PlatformFlow = 'entradas' | 'consumibles'
export const PLATFORM_FLOWS: PlatformFlow[] = ['entradas', 'consumibles']

type LegacyEmpresaMarketplaceFeeRow = {
  id: string
  empresa_id: string
  mode: MarketplaceFeeMode
  percentage: number | string | null
  fixed_amount: number | string | null
  updated_by_platform_admin_id: string | null
}

type PlatformMarketplaceFeeDefaultRow = {
  id: string
  flow: PlatformFlow
  mode: MarketplaceFeeMode | null
  percentage: number | string | null
  fixed_amount: number | string | null
  updated_by_platform_admin_id: string | null
}

type EmpresaMarketplaceFeeOverrideRow = {
  id: string
  empresa_id: string
  flow: PlatformFlow
  mode: MarketplaceFeeMode | null
  percentage: number | string | null
  fixed_amount: number | string | null
  updated_by_platform_admin_id: string | null
}

export type MarketplaceFeeSummarySource = 'global' | 'empresa' | null
export type MarketplaceFeeLegacyFallback = 'empresa_legacy' | 'env_legacy' | null

export type MarketplaceFeeSummary = {
  flow: PlatformFlow
  configured: boolean
  source: MarketplaceFeeSummarySource
  legacyFallback: MarketplaceFeeLegacyFallback
  mode: MarketplaceFeeMode | null
  percentage: number | null
  fixedAmount: number | null
}

export type MarketplaceFeeMetadata = {
  mode: MarketplaceFeeMode | null
  percentage: number | null
  fixedAmount: number | null
  subtotal: number
  percentageAmount: number
  fixedAmountApplied: number
  currency: string
}

export type MarketplaceFeeResolution = {
  amount: number
  currency: string
  summary: MarketplaceFeeSummary
  metadata: MarketplaceFeeMetadata
}

type UpsertEmpresaMarketplaceFeeInput = MarketplaceFeeConfig & {
  empresaId: string
  flow?: PlatformFlow
  updatedByPlatformAdminId?: string | null
}

const DEFAULT_CURRENCY = 'ARS'
const MARKETPLACE_FEE_MODE_ENV = 'MARKETPLACE_FEE_MODE'
const MARKETPLACE_FEE_PERCENTAGE_ENV = 'MARKETPLACE_FEE_PERCENTAGE'
const MARKETPLACE_FEE_FIXED_AMOUNT_ENV = 'MARKETPLACE_FEE_FIXED_AMOUNT'
type ResolvedMarketplaceFeeConfig = {
  config: MarketplaceFeeConfig | null
  source: MarketplaceFeeSummarySource
  legacyFallback: MarketplaceFeeLegacyFallback
}

function normalizeAmount(value: number) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('El subtotal para calcular marketplace fee es inválido')
  }

  return roundMoney(value)
}

function toNullableNumber(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : null
}

function validateMarketplaceFeeConfig(input: MarketplaceFeeConfig | null): MarketplaceFeeConfig | null {
  if (!input) return null

  const marketplaceFeeMode = input.marketplaceFeeMode
  const marketplaceFeePercentage = toNullableNumber(input.marketplaceFeePercentage)
  const marketplaceFeeFixedAmount = toNullableNumber(input.marketplaceFeeFixedAmount)

  if (!marketplaceFeeMode || !['percentage', 'fixed', 'hybrid'].includes(marketplaceFeeMode)) {
    throw new Error('El modo de comisión marketplace es inválido')
  }

  if (marketplaceFeePercentage !== null && (marketplaceFeePercentage < 0 || marketplaceFeePercentage > 100)) {
    throw new Error('El porcentaje de comisión marketplace debe estar entre 0 y 100')
  }

  if (marketplaceFeeFixedAmount !== null && marketplaceFeeFixedAmount < 0) {
    throw new Error('El monto fijo de comisión marketplace no puede ser negativo')
  }

  if (marketplaceFeeMode === 'percentage') {
    if (marketplaceFeePercentage === null) {
      throw new Error('La comisión percentage requiere marketplaceFeePercentage')
    }

    return {
      marketplaceFeeMode,
      marketplaceFeePercentage: roundMoney(marketplaceFeePercentage),
      marketplaceFeeFixedAmount: null,
    }
  }

  if (marketplaceFeeMode === 'fixed') {
    if (marketplaceFeeFixedAmount === null) {
      throw new Error('La comisión fixed requiere marketplaceFeeFixedAmount')
    }

    return {
      marketplaceFeeMode,
      marketplaceFeePercentage: null,
      marketplaceFeeFixedAmount: roundMoney(marketplaceFeeFixedAmount),
    }
  }

  if (marketplaceFeePercentage === null && marketplaceFeeFixedAmount === null) {
    throw new Error('La comisión hybrid requiere porcentaje, monto fijo o ambos')
  }

  return {
    marketplaceFeeMode,
    marketplaceFeePercentage: marketplaceFeePercentage === null ? null : roundMoney(marketplaceFeePercentage),
    marketplaceFeeFixedAmount: marketplaceFeeFixedAmount === null ? null : roundMoney(marketplaceFeeFixedAmount),
  }
}

function getFallbackMarketplaceFeeConfigFromEnv(): MarketplaceFeeConfig | null {
  const modeFromEnv = process.env[MARKETPLACE_FEE_MODE_ENV]?.trim() as MarketplaceFeeMode | undefined
  const percentage = toNullableNumber(process.env[MARKETPLACE_FEE_PERCENTAGE_ENV])
  const fixedAmount = toNullableNumber(process.env[MARKETPLACE_FEE_FIXED_AMOUNT_ENV])

  if (!modeFromEnv && percentage === null && fixedAmount === null) {
    return null
  }

  const inferredMode: MarketplaceFeeMode | null = modeFromEnv
    ?? (percentage !== null && fixedAmount !== null ? 'hybrid' : percentage !== null ? 'percentage' : fixedAmount !== null ? 'fixed' : null)

  return validateMarketplaceFeeConfig(inferredMode ? {
    marketplaceFeeMode: inferredMode,
    marketplaceFeePercentage: percentage,
    marketplaceFeeFixedAmount: fixedAmount,
  } : null)
}

function mapRowToConfig(row: Pick<LegacyEmpresaMarketplaceFeeRow | PlatformMarketplaceFeeDefaultRow | EmpresaMarketplaceFeeOverrideRow, 'mode' | 'percentage' | 'fixed_amount'>): MarketplaceFeeConfig {
  return validateMarketplaceFeeConfig({
    marketplaceFeeMode: row.mode as MarketplaceFeeMode,
    marketplaceFeePercentage: toNullableNumber(row.percentage),
    marketplaceFeeFixedAmount: toNullableNumber(row.fixed_amount),
  })!
}

// empresa_marketplace_fees (legacy table) no longer exists in Prisma schema;
// it was superseded by empresa_marketplace_fee_overrides. Return null always.
async function getLegacyEmpresaMarketplaceFeeRowByEmpresaId(_empresaId: string): Promise<LegacyEmpresaMarketplaceFeeRow | null> {
  return null
}

async function getPlatformMarketplaceFeeDefaultRowByFlow(flow: PlatformFlow): Promise<PlatformMarketplaceFeeDefaultRow | null> {
  const row = await prisma.platformMarketplaceFeeDefault.findUnique({
    where: { flow },
  })
  if (!row) return null
  return {
    id: row.id,
    flow: row.flow as PlatformFlow,
    mode: row.mode as MarketplaceFeeMode | null,
    percentage: row.percentage ? Number(row.percentage) : null,
    fixed_amount: row.fixed_amount ? Number(row.fixed_amount) : null,
    updated_by_platform_admin_id: row.updated_by_platform_admin_id ?? null,
  }
}

function mapResolvedSummary(flow: PlatformFlow, resolved: ResolvedMarketplaceFeeConfig) {
  return buildMarketplaceFeeSummary(resolved.config, {
    flow,
    source: resolved.source,
    legacyFallback: resolved.legacyFallback,
  })
}

function matchesEnvMarketplaceFeeConfig(config: MarketplaceFeeConfig | null, row: Pick<PlatformMarketplaceFeeDefaultRow, 'mode' | 'percentage' | 'fixed_amount'> | null) {
  if (!config || !row?.mode) return false

  const rowConfig = mapRowToConfig(row)
  return rowConfig.marketplaceFeeMode === config.marketplaceFeeMode
    && rowConfig.marketplaceFeePercentage === config.marketplaceFeePercentage
    && rowConfig.marketplaceFeeFixedAmount === config.marketplaceFeeFixedAmount
}

async function resolvePlatformMarketplaceFeeDefaultByFlow(flow: PlatformFlow): Promise<ResolvedMarketplaceFeeConfig> {
  const defaultRow = await getPlatformMarketplaceFeeDefaultRowByFlow(flow)
  const envFallback = getFallbackMarketplaceFeeConfigFromEnv()

  if (defaultRow?.mode) {
    return {
      config: mapRowToConfig(defaultRow),
      source: 'global',
      legacyFallback: matchesEnvMarketplaceFeeConfig(envFallback, defaultRow) ? 'env_legacy' : null,
    }
  }

  if (envFallback) {
    return {
      config: envFallback,
      source: 'global',
      legacyFallback: 'env_legacy',
    }
  }

  return {
    config: null,
    source: null,
    legacyFallback: null,
  }
}

async function getEmpresaMarketplaceFeeOverrideRowByEmpresaId(empresaId: string, flow: PlatformFlow): Promise<EmpresaMarketplaceFeeOverrideRow | null> {
  const row = await prisma.empresaMarketplaceFeeOverride.findUnique({
    where: { empresa_id_flow: { empresa_id: empresaId, flow } },
  })
  if (!row) return null
  return {
    id: row.id,
    empresa_id: row.empresa_id,
    flow: row.flow as PlatformFlow,
    mode: row.mode as MarketplaceFeeMode | null,
    percentage: row.percentage ? Number(row.percentage) : null,
    fixed_amount: row.fixed_amount ? Number(row.fixed_amount) : null,
    updated_by_platform_admin_id: row.updated_by_platform_admin_id ?? null,
  }
}

function resolveMarketplaceFeeFromInputs(
  overrideRow: EmpresaMarketplaceFeeOverrideRow | null | undefined,
  legacyEmpresaRow: LegacyEmpresaMarketplaceFeeRow | null | undefined,
  defaultRow: PlatformMarketplaceFeeDefaultRow | null | undefined,
  envFallback: MarketplaceFeeConfig | null,
): ResolvedMarketplaceFeeConfig {
  if (overrideRow) {
    return {
      config: mapRowToConfig(overrideRow),
      source: 'empresa',
      legacyFallback: null,
    }
  }
  if (legacyEmpresaRow) {
    return {
      config: mapRowToConfig(legacyEmpresaRow),
      source: 'empresa',
      legacyFallback: 'empresa_legacy',
    }
  }
  if (defaultRow?.mode) {
    return {
      config: mapRowToConfig(defaultRow),
      source: 'global',
      legacyFallback: matchesEnvMarketplaceFeeConfig(envFallback, defaultRow) ? 'env_legacy' : null,
    }
  }
  if (envFallback) {
    return {
      config: envFallback,
      source: 'global',
      legacyFallback: 'env_legacy',
    }
  }
  return {
    config: null,
    source: null,
    legacyFallback: null,
  }
}

async function resolveMarketplaceFeeConfigByEmpresaId(empresaId: string, flow: PlatformFlow): Promise<ResolvedMarketplaceFeeConfig> {
  const [overrideRow, legacyEmpresaRow, defaultRow] = await Promise.all([
    getEmpresaMarketplaceFeeOverrideRowByEmpresaId(empresaId, flow),
    getLegacyEmpresaMarketplaceFeeRowByEmpresaId(empresaId),
    getPlatformMarketplaceFeeDefaultRowByFlow(flow),
  ])
  const envFallback = getFallbackMarketplaceFeeConfigFromEnv()
  return resolveMarketplaceFeeFromInputs(overrideRow, legacyEmpresaRow, defaultRow, envFallback)
}

async function getEmpresaMarketplaceFeeOverrideRowsByEmpresaIdsBulk(empresaIds: string[]): Promise<EmpresaMarketplaceFeeOverrideRow[]> {
  if (empresaIds.length === 0) return []
  const rows = await prisma.empresaMarketplaceFeeOverride.findMany({
    where: { empresa_id: { in: empresaIds } },
  })
  return rows.map((row) => ({
    id: row.id,
    empresa_id: row.empresa_id,
    flow: row.flow as PlatformFlow,
    mode: row.mode as MarketplaceFeeMode | null,
    percentage: row.percentage ? Number(row.percentage) : null,
    fixed_amount: row.fixed_amount ? Number(row.fixed_amount) : null,
    updated_by_platform_admin_id: row.updated_by_platform_admin_id ?? null,
  }))
}

// Legacy empresa_marketplace_fees table no longer exists — return empty.
async function getLegacyEmpresaMarketplaceFeeRowsByEmpresaIdsBulk(_empresaIds: string[]): Promise<LegacyEmpresaMarketplaceFeeRow[]> {
  return []
}

export async function getMarketplaceFeeSummariesByFlowBulk(
  empresaIds: string[],
): Promise<Map<string, Record<PlatformFlow, MarketplaceFeeSummary>>> {
  if (empresaIds.length === 0) return new Map()

  const [defaultRows, overrideRows, legacyRows] = await Promise.all([
    Promise.all(PLATFORM_FLOWS.map((flow) => getPlatformMarketplaceFeeDefaultRowByFlow(flow))),
    getEmpresaMarketplaceFeeOverrideRowsByEmpresaIdsBulk(empresaIds),
    getLegacyEmpresaMarketplaceFeeRowsByEmpresaIdsBulk(empresaIds),
  ])

  const defaultsByFlow = new Map<PlatformFlow, PlatformMarketplaceFeeDefaultRow | null>()
  PLATFORM_FLOWS.forEach((flow, idx) => defaultsByFlow.set(flow, defaultRows[idx] ?? null))

  const overridesByKey = new Map<string, EmpresaMarketplaceFeeOverrideRow>()
  for (const row of overrideRows) {
    overridesByKey.set(`${row.empresa_id}:${row.flow}`, row)
  }

  const legacyByEmpresa = new Map<string, LegacyEmpresaMarketplaceFeeRow>()
  for (const row of legacyRows) {
    legacyByEmpresa.set(row.empresa_id, row)
  }

  const envFallback = getFallbackMarketplaceFeeConfigFromEnv()

  const result = new Map<string, Record<PlatformFlow, MarketplaceFeeSummary>>()
  for (const empresaId of empresaIds) {
    const flowMap: Partial<Record<PlatformFlow, MarketplaceFeeSummary>> = {}
    for (const flow of PLATFORM_FLOWS) {
      const resolved = resolveMarketplaceFeeFromInputs(
        overridesByKey.get(`${empresaId}:${flow}`),
        legacyByEmpresa.get(empresaId),
        defaultsByFlow.get(flow),
        envFallback,
      )
      flowMap[flow] = mapResolvedSummary(flow, resolved)
    }
    result.set(empresaId, flowMap as Record<PlatformFlow, MarketplaceFeeSummary>)
  }

  return result
}

export async function getMarketplaceFeeConfigByEmpresaId(empresaId: string, flow: PlatformFlow = 'entradas') {
  const resolved = await resolveMarketplaceFeeConfigByEmpresaId(empresaId, flow)
  return resolved.config
}

export async function getPlatformMarketplaceFeeDefaultsByFlow() {
  const entries = await Promise.all(
    PLATFORM_FLOWS.map(async (flow) => [flow, mapResolvedSummary(flow, await resolvePlatformMarketplaceFeeDefaultByFlow(flow))] as const)
  )

  return Object.fromEntries(entries) as Record<PlatformFlow, MarketplaceFeeSummary>
}

export async function getMarketplaceFeeSummariesByFlow(empresaId: string) {
  const entries = await Promise.all(
    PLATFORM_FLOWS.map(async (flow) => [flow, await getMarketplaceFeeSummary(empresaId, flow)] as const)
  )

  return Object.fromEntries(entries) as Record<PlatformFlow, MarketplaceFeeSummary>
}

export async function getMarketplaceFeeOverridesByFlow(empresaId: string) {
  const entries = await Promise.all(
    PLATFORM_FLOWS.map(async (flow) => {
      const row = await getEmpresaMarketplaceFeeOverrideRowByEmpresaId(empresaId, flow)
      const config = row ? mapRowToConfig(row) : null
      return [flow, buildMarketplaceFeeSummary(config, { flow, source: row ? 'empresa' : null })] as const
    })
  )

  return Object.fromEntries(entries) as Record<PlatformFlow, MarketplaceFeeSummary>
}

type UpsertPlatformMarketplaceFeeDefaultInput = MarketplaceFeeConfig & {
  flow: PlatformFlow
  updatedByPlatformAdminId?: string | null
}

export async function upsertPlatformMarketplaceFeeDefault(input: UpsertPlatformMarketplaceFeeDefaultInput) {
  const config = validateMarketplaceFeeConfig(input)
  if (!config) {
    throw new Error('La configuración global de comisión marketplace es obligatoria')
  }

  await prisma.platformMarketplaceFeeDefault.upsert({
    where: { flow: input.flow },
    create: {
      id: uuidv4(),
      flow: input.flow,
      mode: config.marketplaceFeeMode,
      percentage: config.marketplaceFeePercentage,
      fixed_amount: config.marketplaceFeeFixedAmount,
      updated_by_platform_admin_id: input.updatedByPlatformAdminId ?? null,
    },
    update: {
      mode: config.marketplaceFeeMode,
      percentage: config.marketplaceFeePercentage,
      fixed_amount: config.marketplaceFeeFixedAmount,
      updated_by_platform_admin_id: input.updatedByPlatformAdminId ?? null,
    },
  })

  return mapResolvedSummary(input.flow, await resolvePlatformMarketplaceFeeDefaultByFlow(input.flow))
}

export async function upsertMarketplaceFeeConfigByEmpresaId(input: UpsertEmpresaMarketplaceFeeInput) {
  const config = validateMarketplaceFeeConfig(input)
  if (!config) {
    throw new Error('La configuración de comisión marketplace es obligatoria')
  }

  const flows = input.flow ? [input.flow] : PLATFORM_FLOWS

  for (const flow of flows) {
    await prisma.empresaMarketplaceFeeOverride.upsert({
      where: { empresa_id_flow: { empresa_id: input.empresaId, flow } },
      create: {
        id: uuidv4(),
        empresa_id: input.empresaId,
        flow,
        mode: config.marketplaceFeeMode,
        percentage: config.marketplaceFeePercentage,
        fixed_amount: config.marketplaceFeeFixedAmount,
        updated_by_platform_admin_id: input.updatedByPlatformAdminId ?? null,
      },
      update: {
        mode: config.marketplaceFeeMode,
        percentage: config.marketplaceFeePercentage,
        fixed_amount: config.marketplaceFeeFixedAmount,
        updated_by_platform_admin_id: input.updatedByPlatformAdminId ?? null,
      },
    })
  }

  return getMarketplaceFeeConfigByEmpresaId(input.empresaId, input.flow ?? 'entradas')
}

export function buildMarketplaceFeeSummary(
  config: MarketplaceFeeConfig | null | undefined,
  options: { flow?: PlatformFlow; source?: MarketplaceFeeSummarySource; legacyFallback?: MarketplaceFeeLegacyFallback } = {}
): MarketplaceFeeSummary {
  if (!config) {
    return {
      flow: options.flow ?? 'entradas',
      configured: false,
      source: options.source ?? null,
      legacyFallback: options.legacyFallback ?? null,
      mode: null,
      percentage: null,
      fixedAmount: null,
    }
  }

  return {
    flow: options.flow ?? 'entradas',
    configured: true,
    source: options.source ?? null,
    legacyFallback: options.legacyFallback ?? null,
    mode: config.marketplaceFeeMode,
    percentage: config.marketplaceFeePercentage,
    fixedAmount: config.marketplaceFeeFixedAmount,
  }
}

export function calculateMarketplaceFee(
  subtotal: number,
  config: MarketplaceFeeConfig | null | undefined,
  currency: string = DEFAULT_CURRENCY,
  summaryOptions: { flow?: PlatformFlow; source?: MarketplaceFeeSummarySource; legacyFallback?: MarketplaceFeeLegacyFallback } = {}
): MarketplaceFeeResolution {
  const normalizedSubtotal = normalizeAmount(subtotal)
  const normalizedConfig = validateMarketplaceFeeConfig(config ?? null)
  const summary = buildMarketplaceFeeSummary(normalizedConfig, summaryOptions)

  if (!normalizedConfig) {
    return {
      amount: 0,
      currency,
      summary,
      metadata: {
        mode: null,
        percentage: null,
        fixedAmount: null,
        subtotal: normalizedSubtotal,
        percentageAmount: 0,
        fixedAmountApplied: 0,
        currency,
      },
    }
  }

  const percentageAmount = normalizedConfig.marketplaceFeePercentage === null
    ? 0
    : roundMoney(normalizedSubtotal * (normalizedConfig.marketplaceFeePercentage / 100))
  const fixedAmountApplied = normalizedConfig.marketplaceFeeFixedAmount === null
    ? 0
    : roundMoney(normalizedConfig.marketplaceFeeFixedAmount)
  const amount = roundMoney(percentageAmount + fixedAmountApplied)

  return {
    amount,
    currency,
    summary,
    metadata: {
      mode: normalizedConfig.marketplaceFeeMode,
      percentage: normalizedConfig.marketplaceFeePercentage,
      fixedAmount: normalizedConfig.marketplaceFeeFixedAmount,
      subtotal: normalizedSubtotal,
      percentageAmount,
      fixedAmountApplied,
      currency,
    },
  }
}

export async function getMarketplaceFeeSummary(empresaId: string, flow: PlatformFlow = 'entradas') {
  const resolved = await resolveMarketplaceFeeConfigByEmpresaId(empresaId, flow)
  return mapResolvedSummary(flow, resolved)
}

export async function resolveMarketplaceFee(
  empresaId: string,
  subtotal: number,
  flow: PlatformFlow = 'entradas',
  currency: string = DEFAULT_CURRENCY
) {
  const resolved = await resolveMarketplaceFeeConfigByEmpresaId(empresaId, flow)
  return calculateMarketplaceFee(subtotal, resolved.config, currency, {
    flow,
    source: resolved.source,
    legacyFallback: resolved.legacyFallback,
  })
}
