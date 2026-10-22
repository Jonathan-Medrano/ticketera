import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { getPlatformMarketplaceFeeDefaultsByFlow, type PlatformFlow } from './marketplace-fee'
import type { PaymentAccountReason, PaymentAccountStatus } from './payment-accounts'
import { getPlatformOwnerPaymentAccountReadModel, type PlatformOwnerPaymentAccountReadModel } from './platform-owner-payment-account'
import { getPlatformPaymentAccountReadModel } from './platform-payment-accounts'
import { getPlatformAllocationMetricsByFlow, getPlatformAllocationSeries, getPlatformProfitSharingOverview } from './platform-profit-sharing'
import { resolvePlatformViewerPolicy, type PlatformRevenueVisibilityScope } from './platform-governance'
import type { SalesReadiness, SalesReadinessReason, SalesReadinessStatus } from './sales-readiness'
import type { SessionUser } from '../types'
import { roundMoney } from './money'

export type PlatformMetrics = {
  empresasActivas: number
  ventasTotales: number
  volumenBruto: number
  gananciasOwner: number
}

export type PlatformMetricScope = {
  historicoTotal: PlatformMetrics
  soloEmpresasActivas: PlatformMetrics
  marketplace: PlatformMetrics
}

export type PlatformFlowMetrics = {
  ventasTotales: number
  volumenBruto: number
  gananciasOwner: number
}

export type PlatformFlowMetricMap = {
  entradas: PlatformFlowMetrics
  consumibles: PlatformFlowMetrics
}

type PlatformSeriesPoint = {
  dia: string
  total: number
}

export type PlatformCompanyAggregate = {
  id: string
  nombre: string
  slug: string
  activa: boolean
  esPrueba: boolean
  tenantPublicDisabled: boolean
  suspendido: boolean
  aprobada: boolean
  revendedorHabilitado: boolean
  consumiblesHabilitado: boolean
  gananciasOwner: number
  volumenBruto: number
  ventas: number
  metricasPorFlow: PlatformFlowMetricMap
}

export type PlatformCompanyDetail = {
  empresaId: string
  empresaNombre: string
  volumenBruto: number
  gananciasOwner: number
  ventas: number
  serieTemporal: PlatformSeriesPoint[]
  metricasPorFlow: PlatformFlowMetricMap
}

export type PlatformHealthOwnerStatus = {
  status: SalesReadinessStatus
  reason: PaymentAccountReason | 'missing_provider' | null
  updatedAt: string | null
}

export type PlatformHealthBucketStatus = 'missing_collection_setup' | 'ready_to_sell' | 'deactivated'

export type PlatformHealthReadinessBuckets = Record<PlatformHealthBucketStatus, number>

export type PlatformHealthIssueCounters = {
  total: number
  missingCollectionSetup: number
  deactivated: number
  missingMarketplaceFee: number
  withOverrides: number
}

export type PlatformHealthIssueCompany = {
  id: string
  nombre: string
  slug: string
  activa: boolean
  tenantPublicDisabled: boolean
  withOverrides: boolean
  readiness: SalesReadiness
}

export type PlatformHealthIssueCompanies = {
  missingCollectionSetup: PlatformHealthIssueCompany[]
  deactivated: PlatformHealthIssueCompany[]
  missingMarketplaceFee: PlatformHealthIssueCompany[]
  withOverrides: PlatformHealthIssueCompany[]
}

export type PlatformHealthSnapshot = {
  ownerPaymentAccount: PlatformOwnerPaymentAccountReadModel | null
  currentUserPaymentAccount?: PlatformOwnerPaymentAccountReadModel | null
  ownerStatus: PlatformHealthOwnerStatus
  readinessBuckets: PlatformHealthReadinessBuckets
  issueCounters: PlatformHealthIssueCounters
  issueCompanies: PlatformHealthIssueCompanies
}

type PlatformHealthCompanyRow = {
  id: string
  nombre: string
  slug: string
  activa: number
  tenant_public_disabled: number
}

type PlatformHealthPaymentAccountRow = {
  empresa_id: string
  status: PaymentAccountStatus
  reason: PaymentAccountReason | null
  blocked_at: string | Date | null
}

type PlatformHealthLegacyFeeRow = {
  empresa_id: string
}

type PlatformHealthFeeOverrideRow = {
  empresa_id: string
  flow: PlatformFlow
}

export type PlatformRevenueTimelinePoint = {
  bucket: string
  total: number
}

export type PlatformRevenueTimeline = {
  period: {
    days: number
    from: string
    to: string
  }
  current: {
    series: PlatformRevenueTimelinePoint[]
    total: number
    average: number
    peak: PlatformRevenueTimelinePoint | null
  }
  previous: {
    total: number
    from: string
    to: string
  }
  growth: {
    absolute: number
    percent: number | null
  }
}

function fillSeriesGaps(series: PlatformRevenueTimelinePoint[], fromIso: string, toIso: string): PlatformRevenueTimelinePoint[] {
  const map = new Map(series.map((p) => [p.bucket, p.total]))
  const out: PlatformRevenueTimelinePoint[] = []
  const start = new Date(fromIso)
  const end = new Date(toIso)
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10)
    out.push({ bucket: key, total: roundMoney(Number(map.get(key) ?? 0)) })
  }
  return out
}


export async function getPlatformRevenueTimeline(periodDays: number): Promise<PlatformRevenueTimeline> {
  const days = Math.max(1, Math.min(Math.floor(periodDays), 365))
  const now = new Date()
  const currentTo = new Date(now)
  const currentFrom = new Date(now)
  currentFrom.setDate(currentFrom.getDate() - (days - 1))
  currentFrom.setHours(0, 0, 0, 0)
  const previousTo = new Date(currentFrom)
  previousTo.setDate(previousTo.getDate() - 1)
  previousTo.setHours(23, 59, 59, 999)
  const previousFrom = new Date(previousTo)
  previousFrom.setDate(previousFrom.getDate() - (days - 1))
  previousFrom.setHours(0, 0, 0, 0)

  const currentFromIso = currentFrom.toISOString()
  const currentToIso = currentTo.toISOString()
  const previousFromIso = previousFrom.toISOString()
  const previousToIso = previousTo.toISOString()

  type DayBucketRaw = { bucket: Date | string; total: unknown }[]
  type TotalRaw = { total: unknown }[]
  const currentFromDate = new Date(currentFromIso)
  const currentToDate = new Date(currentToIso)
  const previousFromDate = new Date(previousFromIso)
  const previousToDate = new Date(previousToIso)

  const [entradasCurrentRaw, entradasPrevRaw] = await Promise.all([
    prisma.$queryRaw<DayBucketRaw>`
      SELECT DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') AS bucket, COALESCE(SUM(en.comision), 0) AS total
      FROM entradas en
      WHERE en.estado != 'cancelada' AND en.created_at >= ${currentFromDate} AND en.created_at <= ${currentToDate}
      GROUP BY DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') ORDER BY bucket ASC`,
    prisma.$queryRaw<TotalRaw>`
      SELECT COALESCE(SUM(en.comision), 0) AS total
      FROM entradas en
      WHERE en.estado != 'cancelada' AND en.created_at >= ${previousFromDate} AND en.created_at <= ${previousToDate}`,
  ])
  const entradasCurrent = entradasCurrentRaw.map((row) => ({ bucket: String(row.bucket).slice(0, 10), total: Number(row.total ?? 0) }))

  let consumiblesCurrent: PlatformRevenueTimelinePoint[] = []
  let consumiblesPrevTotal = 0
  try {
    const [consCurrent, consPrevRaw] = await Promise.all([
      prisma.$queryRaw<DayBucketRaw>`
        SELECT DATE(cv.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') AS bucket, COALESCE(SUM(cv.owner_fee_amount), 0) AS total
        FROM consumibles_ventas cv
        WHERE cv.estado != 'cancelado' AND cv.created_at >= ${currentFromDate} AND cv.created_at <= ${currentToDate}
        GROUP BY DATE(cv.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') ORDER BY bucket ASC`,
      prisma.$queryRaw<TotalRaw>`
        SELECT COALESCE(SUM(cv.owner_fee_amount), 0) AS total
        FROM consumibles_ventas cv
        WHERE cv.estado != 'cancelado' AND cv.created_at >= ${previousFromDate} AND cv.created_at <= ${previousToDate}`,
    ])
    consumiblesCurrent = consCurrent.map((row) => ({ bucket: String(row.bucket).slice(0, 10), total: Number(row.total ?? 0) }))
    consumiblesPrevTotal = Number(consPrevRaw[0]?.total ?? 0)
  } catch (error) {
    if (!isMissingConsumiblesOwnerFeeSchema(error)) {
      throw error
    }
  }

  const mergedMap = new Map<string, number>()
  for (const p of entradasCurrent) {
    mergedMap.set(p.bucket, (mergedMap.get(p.bucket) ?? 0) + p.total)
  }
  for (const p of consumiblesCurrent) {
    mergedMap.set(p.bucket, (mergedMap.get(p.bucket) ?? 0) + p.total)
  }

  const mergedSparse: PlatformRevenueTimelinePoint[] = Array.from(mergedMap.entries())
    .map(([bucket, total]) => ({ bucket, total }))
    .sort((a, b) => a.bucket.localeCompare(b.bucket))

  const currentSeries = fillSeriesGaps(
    mergedSparse,
    currentFromIso.slice(0, 10),
    currentToIso.slice(0, 10),
  )

  const currentTotal = currentSeries.reduce((sum, p) => sum + p.total, 0)
  const previousTotal = Number(entradasPrevRaw[0]?.total ?? 0) + consumiblesPrevTotal

  const peak = currentSeries.reduce<PlatformRevenueTimelinePoint | null>((best, p) => {
    if (!best || p.total > best.total) return p
    return best
  }, null)

  const average = currentSeries.length > 0 ? roundMoney(currentTotal / currentSeries.length) : 0

  const absolute = roundMoney(currentTotal - previousTotal)
  const percent = previousTotal > 0
    ? roundMoney(((currentTotal - previousTotal) / previousTotal) * 100)
    : null

  return {
    period: {
      days,
      from: currentFromIso,
      to: currentToIso,
    },
    current: {
      series: currentSeries,
      total: roundMoney(currentTotal),
      average,
      peak: peak ? { bucket: peak.bucket, total: roundMoney(peak.total) } : null,
    },
    previous: {
      total: roundMoney(previousTotal),
      from: previousFromIso,
      to: previousToIso,
    },
    growth: {
      absolute,
      percent,
    },
  }
}

function isMissingConsumiblesOwnerFeeSchema(error: unknown) {
  const code = (error as any)?.code
  const causeCode = (error as any)?.cause?.code
  const isUndefinedTable = code === '42P01' || causeCode === '42P01'
  const isUndefinedColumn = code === '42703' || causeCode === '42703'
  return isUndefinedTable || isUndefinedColumn
}

async function getPlatformHealthCompanyRows(): Promise<PlatformHealthCompanyRow[]> {
  const rows = await prisma.empresa.findMany({
    select: { id: true, nombre: true, slug: true, activa: true, tenant_public_disabled: true },
    orderBy: { nombre: 'asc' },
  })
  return rows.map((row) => ({
    id: row.id,
    nombre: row.nombre,
    slug: row.slug,
    activa: row.activa ? 1 : 0,
    tenant_public_disabled: row.tenant_public_disabled ? 1 : 0,
  } as PlatformHealthCompanyRow))
}

async function getPlatformHealthPaymentAccountRows(): Promise<PlatformHealthPaymentAccountRow[]> {
  try {
    const rows = await prisma.empresaPaymentAccount.findMany({
      where: { provider: 'mercadopago' },
      select: { empresa_id: true, status: true, reason: true, blocked_at: true },
    })
    return rows.map((row) => ({
      empresa_id: row.empresa_id,
      status: row.status as PaymentAccountStatus,
      reason: (row.reason ?? null) as PaymentAccountReason | null,
      blocked_at: row.blocked_at ?? null,
    } as PlatformHealthPaymentAccountRow))
  } catch (error) {
    if (isMissingConsumiblesOwnerFeeSchema(error)) {
      return []
    }
    throw error
  }
}

async function getPlatformHealthLegacyFeeRows(): Promise<PlatformHealthLegacyFeeRow[]> {
  // empresa_marketplace_fees es una tabla LEGACY que no existe en el schema Postgres actual
  // (la tabla vigente es empresa_marketplace_fee_overrides). Chequeamos su existencia con
  // to_regclass (devuelve NULL sin error) ANTES de consultarla, para no emitir un prisma:error
  // 42P01 en cada lectura del dashboard. El try/catch queda como red de seguridad.
  try {
    const exists = await prisma.$queryRaw<{ table_name: string | null }[]>`
      SELECT to_regclass('public.empresa_marketplace_fees')::text AS table_name`
    if (!exists[0]?.table_name) return []

    const rows = await prisma.$queryRaw<{ empresa_id: string }[]>`
      SELECT DISTINCT empresa_id FROM empresa_marketplace_fees`
    return rows.map((row) => ({ empresa_id: row.empresa_id } as PlatformHealthLegacyFeeRow))
  } catch {
    return []
  }
}

async function getPlatformHealthFeeOverrideRows(): Promise<PlatformHealthFeeOverrideRow[]> {
  try {
    const rows = await prisma.empresaMarketplaceFeeOverride.findMany({
      select: { empresa_id: true, flow: true },
      distinct: ['empresa_id', 'flow'],
    })
    return rows.map((row) => ({
      empresa_id: row.empresa_id,
      flow: row.flow as PlatformFlow,
    } as PlatformHealthFeeOverrideRow))
  } catch (error) {
    if (isMissingConsumiblesOwnerFeeSchema(error)) {
      return []
    }
    throw error
  }
}

function buildSalesReadinessFromPlatformHealth(params: {
  paymentAccount: PlatformHealthPaymentAccountRow | undefined
  feeConfiguredByFlow: Record<PlatformFlow, boolean>
}): SalesReadiness {
  const paymentAccount = params.paymentAccount

  if (!paymentAccount) {
    return { status: 'missing_provider', reason: 'missing_provider', canSell: false }
  }

  if (paymentAccount.status === 'blocked' || paymentAccount.blocked_at) {
    return { status: 'blocked', reason: paymentAccount.reason ?? 'manual_block', canSell: false }
  }

  if (paymentAccount.status === 'ready_to_sell') {
    if (!params.feeConfiguredByFlow.entradas || !params.feeConfiguredByFlow.consumibles) {
      return { status: 'pending_validation', reason: 'missing_marketplace_fee', canSell: false }
    }

    return { status: 'ready_to_sell', reason: null, canSell: true }
  }

  return { status: 'pending_validation', reason: paymentAccount.reason ?? 'validation_pending', canSell: false }
}

function buildOwnerStatusSnapshot(status: PlatformOwnerPaymentAccountReadModel | null): PlatformHealthOwnerStatus {
  if (!status) {
    return {
      status: 'missing_provider',
      reason: 'missing_provider',
      updatedAt: null,
    }
  }

  return {
    status: status.blockedAt || status.status === 'blocked' ? 'blocked' : status.status,
    reason: status.blockedAt && !status.reason ? 'manual_block' : status.reason,
    updatedAt: status.blockedAt ?? status.validatedAt ?? status.oauthConnectedAt ?? status.updatedAt,
  }
}

function resolvePlatformHealthBucket(company: PlatformHealthCompanyRow, readiness: SalesReadiness): PlatformHealthBucketStatus {
  if (Number(company.activa) !== 1 || Number(company.tenant_public_disabled) === 1) {
    return 'deactivated'
  }

  return readiness.status === 'ready_to_sell' ? 'ready_to_sell' : 'missing_collection_setup'
}

function buildScopedStaffHealthSnapshot(params: {
  currentUserPaymentAccount: PlatformOwnerPaymentAccountReadModel | null
}): PlatformHealthSnapshot {
  return {
    ownerPaymentAccount: null,
    currentUserPaymentAccount: params.currentUserPaymentAccount,
    ownerStatus: buildOwnerStatusSnapshot(params.currentUserPaymentAccount),
    readinessBuckets: {
      missing_collection_setup: 0,
      ready_to_sell: 0,
      deactivated: 0,
    },
    issueCounters: {
      total: 0,
      missingCollectionSetup: 0,
      deactivated: 0,
      missingMarketplaceFee: 0,
      withOverrides: 0,
    },
    issueCompanies: {
      missingCollectionSetup: [],
      deactivated: [],
      missingMarketplaceFee: [],
      withOverrides: [],
    },
  }
}

function compareIssueCompanies(a: PlatformHealthIssueCompany, b: PlatformHealthIssueCompany) {
  const rank = (readiness: SalesReadiness) => {
    if (readiness.status === 'blocked') return 0
    if (readiness.status === 'missing_provider') return 1
    if (readiness.reason === 'missing_marketplace_fee') return 2
    if (readiness.status === 'pending_validation') return 3
    return 4
  }

  return rank(a.readiness) - rank(b.readiness) || a.nombre.localeCompare(b.nombre)
}

async function getPlatformHealthSnapshot(): Promise<PlatformHealthSnapshot> {
  const [ownerPaymentAccount, defaultFeesByFlow, companyRows, paymentAccountRows, legacyFeeRows, feeOverrideRows] = await Promise.all([
    getPlatformOwnerPaymentAccountReadModel(),
    getPlatformMarketplaceFeeDefaultsByFlow(),
    getPlatformHealthCompanyRows(),
    getPlatformHealthPaymentAccountRows(),
    getPlatformHealthLegacyFeeRows(),
    getPlatformHealthFeeOverrideRows(),
  ])

  const globalFeeConfiguredByFlow: Record<PlatformFlow, boolean> = {
    entradas: defaultFeesByFlow.entradas.configured,
    consumibles: defaultFeesByFlow.consumibles.configured,
  }
  const paymentAccountByEmpresaId = new Map(paymentAccountRows.map((row) => [String(row.empresa_id), row]))
  const legacyFeeEmpresaIds = new Set(legacyFeeRows.map((row) => String(row.empresa_id)))
  const overrideKeySet = new Set(feeOverrideRows.map((row) => `${String(row.empresa_id)}:${row.flow}`))

  const readinessBuckets: PlatformHealthReadinessBuckets = {
    missing_collection_setup: 0,
    ready_to_sell: 0,
    deactivated: 0,
  }
  const issueCounters: PlatformHealthIssueCounters = {
    total: 0,
    missingCollectionSetup: 0,
    deactivated: 0,
    missingMarketplaceFee: 0,
    withOverrides: 0,
  }
  const issueCompanies: PlatformHealthIssueCompanies = {
    missingCollectionSetup: [],
    deactivated: [],
    missingMarketplaceFee: [],
    withOverrides: [],
  }

  for (const company of companyRows) {
    const empresaId = String(company.id)
    const inheritsLegacyFee = legacyFeeEmpresaIds.has(empresaId)
    const hasOverrides = overrideKeySet.has(`${empresaId}:entradas`) || overrideKeySet.has(`${empresaId}:consumibles`)
    const feeConfiguredByFlow: Record<PlatformFlow, boolean> = {
      entradas: overrideKeySet.has(`${empresaId}:entradas`) || inheritsLegacyFee || globalFeeConfiguredByFlow.entradas,
      consumibles: overrideKeySet.has(`${empresaId}:consumibles`) || inheritsLegacyFee || globalFeeConfiguredByFlow.consumibles,
    }
    const readiness = buildSalesReadinessFromPlatformHealth({
      paymentAccount: paymentAccountByEmpresaId.get(empresaId),
      feeConfiguredByFlow,
    })
    const bucketStatus = resolvePlatformHealthBucket(company, readiness)

    readinessBuckets[bucketStatus] += 1

    const issueCompany: PlatformHealthIssueCompany = {
      id: empresaId,
      nombre: String(company.nombre),
      slug: String(company.slug),
      activa: Number(company.activa) === 1,
      tenantPublicDisabled: Number(company.tenant_public_disabled) === 1,
      withOverrides: hasOverrides,
      readiness,
    }

    if (hasOverrides) {
      issueCounters.withOverrides += 1
      issueCompanies.withOverrides.push(issueCompany)
    }

    if (bucketStatus === 'ready_to_sell') {
      continue
    }

    issueCounters.total += 1

    if (bucketStatus === 'deactivated') {
      issueCounters.deactivated += 1
      issueCompanies.deactivated.push(issueCompany)
      continue
    }

    issueCounters.missingCollectionSetup += 1
    issueCompanies.missingCollectionSetup.push(issueCompany)

    if (readiness.reason === 'missing_marketplace_fee') {
      issueCounters.missingMarketplaceFee += 1
      issueCompanies.missingMarketplaceFee.push(issueCompany)
    }
  }

  return {
    ownerPaymentAccount,
    ownerStatus: buildOwnerStatusSnapshot(ownerPaymentAccount),
    readinessBuckets,
    issueCounters,
    issueCompanies: {
      missingCollectionSetup: issueCompanies.missingCollectionSetup.sort(compareIssueCompanies),
      deactivated: issueCompanies.deactivated.sort(compareIssueCompanies),
      missingMarketplaceFee: issueCompanies.missingMarketplaceFee.sort(compareIssueCompanies),
      withOverrides: issueCompanies.withOverrides.sort(compareIssueCompanies),
    },
  }
}

async function getEntradasMetricsOnly(options: { onlyActive?: boolean } = {}) {
  type MetricRaw = { ventas_totales: unknown; volumen_bruto: unknown; ganancias_owner: unknown }[]
  type SeriesRaw = { dia: Date | string; total: unknown }[]
  // Test empresas (es_prueba = true) are always excluded from super-admin metrics
  const empresaClause = options.onlyActive
    ? Prisma.sql` AND e.activa = true AND e.es_prueba = false`
    : Prisma.sql` AND e.es_prueba = false`

  const [metricRaw, seriesRaw] = await Promise.all([
    prisma.$queryRaw<MetricRaw>`
      SELECT COUNT(en.id) as ventas_totales,
             COALESCE(SUM(en.precio_pagado), 0) as volumen_bruto,
             COALESCE(SUM(en.comision), 0) as ganancias_owner
      FROM entradas en
      JOIN eventos ev ON ev.id = en.evento_id
      JOIN empresas e ON e.id = ev.empresa_id
      WHERE en.estado != 'cancelada'${empresaClause}`,
    prisma.$queryRaw<SeriesRaw>`
      SELECT DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') as dia, COALESCE(SUM(en.comision), 0) as total
      FROM entradas en
      JOIN eventos ev ON ev.id = en.evento_id
      JOIN empresas e ON e.id = ev.empresa_id
      WHERE en.estado != 'cancelada'${empresaClause}
      GROUP BY DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') ORDER BY dia ASC`,
  ])

  return {
    metrics: {
      ventasTotales: Number(metricRaw[0]?.ventas_totales ?? 0),
      volumenBruto: Number(metricRaw[0]?.volumen_bruto ?? 0),
      gananciasOwner: Number(metricRaw[0]?.ganancias_owner ?? 0),
    },
    series: seriesRaw.map((row) => ({
      dia: (row.dia instanceof Date ? row.dia.toISOString() : String(row.dia)).slice(0, 10),
      total: Number(row.total ?? 0),
    })),
  }
}

async function getConsumiblesMetricsOnly(options: { onlyActive?: boolean; onlyMarketplace?: boolean } = {}) {
  type MetricRaw = { ventas_totales: unknown; volumen_bruto: unknown; ganancias_owner: unknown }[]
  type SeriesRaw = { dia: Date | string; total: unknown }[]
  // Test empresas (es_prueba = true) are always excluded from super-admin metrics; force the JOIN even if not onlyActive
  const activeJoin = Prisma.sql` JOIN empresas e ON e.id = cv.empresa_id`
  const activeClause = options.onlyActive
    ? Prisma.sql` AND e.activa = true AND e.es_prueba = false`
    : Prisma.sql` AND e.es_prueba = false`
  const marketplaceClause = options.onlyMarketplace ? Prisma.sql` AND cv.origen = 'tenant_publico'` : Prisma.empty
  try {
    const [metricRaw, seriesRaw] = await Promise.all([
      prisma.$queryRaw<MetricRaw>`
        SELECT COUNT(cv.id) as ventas_totales,
               COALESCE(SUM(cv.total), 0) as volumen_bruto,
               COALESCE(SUM(cv.owner_fee_amount), 0) as ganancias_owner
        FROM consumibles_ventas cv${activeJoin}
        WHERE cv.estado != 'cancelado'${activeClause}${marketplaceClause}`,
      prisma.$queryRaw<SeriesRaw>`
        SELECT DATE(cv.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') as dia, COALESCE(SUM(cv.owner_fee_amount), 0) as total
        FROM consumibles_ventas cv${activeJoin}
        WHERE cv.estado != 'cancelado'${activeClause}${marketplaceClause}
        GROUP BY DATE(cv.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') ORDER BY dia ASC`,
    ])

    return {
      metrics: {
        ventasTotales: Number(metricRaw[0]?.ventas_totales ?? 0),
        volumenBruto: Number(metricRaw[0]?.volumen_bruto ?? 0),
        gananciasOwner: Number(metricRaw[0]?.ganancias_owner ?? 0),
      },
      series: seriesRaw.map((row) => ({
        dia: (row.dia instanceof Date ? row.dia.toISOString() : String(row.dia)).slice(0, 10),
        total: Number(row.total ?? 0),
      })),
    }
  } catch (error) {
    if (isMissingConsumiblesOwnerFeeSchema(error)) {
      return {
        metrics: { ventasTotales: 0, volumenBruto: 0, gananciasOwner: 0 },
        series: [] as PlatformSeriesPoint[],
      }
    }

    throw error
  }
}

function mergeSeries(entries: PlatformSeriesPoint[], consumibles: PlatformSeriesPoint[]) {
  const totals = new Map<string, number>()

  for (const item of [...entries, ...consumibles]) {
    totals.set(item.dia, roundMoney((totals.get(item.dia) ?? 0) + item.total))
  }

  return [...totals.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([dia, total]) => ({ dia, total }))
}

export async function getPlatformDashboardReporting(viewer?: SessionUser): Promise<{
  metricas: PlatformMetrics
  metricasScope: PlatformMetricScope
  metricasPorFlow: PlatformFlowMetricMap
  gananciasPorDia: PlatformSeriesPoint[]
  empresasResumen: PlatformCompanyAggregate[]
  healthSnapshot: PlatformHealthSnapshot
  viewerScope?: PlatformRevenueVisibilityScope
  profitSharing?: Awaited<ReturnType<typeof getPlatformProfitSharingOverview>>
}> {
  const baseReporting = await (async () => {
    const [empresasActivasCount, entradasHistoricas, entradasActivas, consumiblesHistoricos, consumiblesActivos, consumiblesMarketplace, empresasResumen, healthSnapshot] = await Promise.all([
      prisma.empresa.count({ where: { activa: true, es_prueba: false } }),
      getEntradasMetricsOnly(),
      getEntradasMetricsOnly({ onlyActive: true }),
      getConsumiblesMetricsOnly(),
      getConsumiblesMetricsOnly({ onlyActive: true }),
      getConsumiblesMetricsOnly({ onlyMarketplace: true }),
      getPlatformCompanyAggregates({ onlyActive: true, excludeTest: true, limit: 10, sortByOwnerGainsDesc: true }),
      getPlatformHealthSnapshot(),
    ])

    return {
      metricas: {
        empresasActivas: empresasActivasCount,
        ventasTotales: entradasHistoricas.metrics.ventasTotales + consumiblesHistoricos.metrics.ventasTotales,
        volumenBruto: roundMoney(entradasHistoricas.metrics.volumenBruto + consumiblesHistoricos.metrics.volumenBruto),
        gananciasOwner: roundMoney(entradasHistoricas.metrics.gananciasOwner + consumiblesHistoricos.metrics.gananciasOwner),
      },
      metricasScope: {
        historicoTotal: {
          empresasActivas: empresasActivasCount,
          ventasTotales: entradasHistoricas.metrics.ventasTotales + consumiblesHistoricos.metrics.ventasTotales,
          volumenBruto: roundMoney(entradasHistoricas.metrics.volumenBruto + consumiblesHistoricos.metrics.volumenBruto),
          gananciasOwner: roundMoney(entradasHistoricas.metrics.gananciasOwner + consumiblesHistoricos.metrics.gananciasOwner),
        },
        soloEmpresasActivas: {
          empresasActivas: empresasActivasCount,
          ventasTotales: entradasActivas.metrics.ventasTotales + consumiblesActivos.metrics.ventasTotales,
          volumenBruto: roundMoney(entradasActivas.metrics.volumenBruto + consumiblesActivos.metrics.volumenBruto),
          gananciasOwner: roundMoney(entradasActivas.metrics.gananciasOwner + consumiblesActivos.metrics.gananciasOwner),
        },
        marketplace: {
          empresasActivas: empresasActivasCount,
          ventasTotales: entradasHistoricas.metrics.ventasTotales + consumiblesMarketplace.metrics.ventasTotales,
          volumenBruto: roundMoney(entradasHistoricas.metrics.volumenBruto + consumiblesMarketplace.metrics.volumenBruto),
          gananciasOwner: roundMoney(entradasHistoricas.metrics.gananciasOwner + consumiblesMarketplace.metrics.gananciasOwner),
        },
      },
      metricasPorFlow: {
        entradas: {
          ventasTotales: entradasHistoricas.metrics.ventasTotales,
          volumenBruto: roundMoney(entradasHistoricas.metrics.volumenBruto),
          gananciasOwner: roundMoney(entradasHistoricas.metrics.gananciasOwner),
        },
        consumibles: {
          ventasTotales: consumiblesHistoricos.metrics.ventasTotales,
          volumenBruto: roundMoney(consumiblesHistoricos.metrics.volumenBruto),
          gananciasOwner: roundMoney(consumiblesHistoricos.metrics.gananciasOwner),
        },
      },
      gananciasPorDia: mergeSeries(entradasHistoricas.series, consumiblesHistoricos.series),
      empresasResumen,
      healthSnapshot,
    }
  })()

  if (!viewer || viewer.userType === 'super_admin') {
    return {
      ...baseReporting,
      viewerScope: 'global',
      profitSharing: await getPlatformProfitSharingOverview(),
    }
  }

  const viewerPolicy = viewer.platformViewerPolicy ?? await resolvePlatformViewerPolicy(viewer.id)
  const configuredUserIds = viewerPolicy.revenueVisibilityScope === 'global'
    ? undefined
    : viewerPolicy.revenueVisibilityScope === 'branch'
      ? await (async () => {
        const rows = await prisma.platformAdminClosure.findMany({
          where: { ancestor_platform_admin_user_id: viewer.id },
          select: { descendant_platform_admin_user_id: true },
        })
        return rows.map((row) => String(row.descendant_platform_admin_user_id))
      })()
      : [viewer.id]

  if (viewerPolicy.revenueVisibilityScope === 'global') {
    return {
      ...baseReporting,
      viewerScope: 'global',
      profitSharing: await getPlatformProfitSharingOverview(),
    }
  }

  const [metricasPorFlow, gananciasPorDia, profitSharing, currentUserPaymentAccount] = await Promise.all([
    getPlatformAllocationMetricsByFlow(configuredUserIds),
    getPlatformAllocationSeries(configuredUserIds),
    getPlatformProfitSharingOverview(configuredUserIds),
    getPlatformPaymentAccountReadModel(viewer.id),
  ])

  const totalGanancias = roundMoney(metricasPorFlow.entradas.gananciasOwner + metricasPorFlow.consumibles.gananciasOwner)
  const totalVentas = metricasPorFlow.entradas.ventasTotales + metricasPorFlow.consumibles.ventasTotales

  return {
    metricas: {
      empresasActivas: 0,
      ventasTotales: totalVentas,
      volumenBruto: totalGanancias,
      gananciasOwner: totalGanancias,
    },
    metricasScope: {
      historicoTotal: { empresasActivas: 0, ventasTotales: totalVentas, volumenBruto: totalGanancias, gananciasOwner: totalGanancias },
      soloEmpresasActivas: { empresasActivas: 0, ventasTotales: totalVentas, volumenBruto: totalGanancias, gananciasOwner: totalGanancias },
      marketplace: { empresasActivas: 0, ventasTotales: totalVentas, volumenBruto: totalGanancias, gananciasOwner: totalGanancias },
    },
    metricasPorFlow,
    gananciasPorDia,
    empresasResumen: [],
    healthSnapshot: buildScopedStaffHealthSnapshot({ currentUserPaymentAccount }),
    viewerScope: viewerPolicy.revenueVisibilityScope,
    profitSharing,
  }
}

export async function getPlatformCompanyAggregates(options: {
  onlyActive?: boolean
  excludeTest?: boolean
  limit?: number
  sortByOwnerGainsDesc?: boolean
} = {}): Promise<PlatformCompanyAggregate[]> {
  type CompanyAggRow = {
    id: string; nombre: string; slug: string; activa: boolean; es_prueba: boolean
    tenant_public_disabled: boolean; suspendido: boolean; aprobada: boolean
    revendedor_habilitado: boolean; consumibles_habilitado: boolean
    entradas_ganancias_owner: unknown; entradas_volumen_bruto: unknown; entradas_ventas: unknown
    consumibles_ganancias_owner: unknown; consumibles_volumen_bruto: unknown; consumibles_ventas: unknown
  }[]
  // excludeTest defaults to false so callers that need the full empresa list (super-admin /empresas) still see test accounts.
  // Aggregation callers (rankings, dashboard totals) pass { excludeTest: true } explicitly.
  const conditions: string[] = []
  if (options.onlyActive) conditions.push('e.activa = true')
  if (options.excludeTest) conditions.push('e.es_prueba = false')
  const activeClause = conditions.length > 0
    ? Prisma.sql` WHERE ${Prisma.raw(conditions.join(' AND '))}`
    : Prisma.empty
  const orderClause = options.sortByOwnerGainsDesc
    ? Prisma.sql`(COALESCE(entradas_stats.ganancias_owner, 0) + COALESCE(consumibles_stats.ganancias_owner, 0)) DESC,`
    : Prisma.sql`e.activa DESC,`
  const limitClause = options.limit ? Prisma.sql` LIMIT ${options.limit}` : Prisma.empty

  let empresaRows: CompanyAggRow
  try {
    empresaRows = await prisma.$queryRaw<CompanyAggRow>`
      SELECT e.id, e.nombre, e.slug, e.activa, COALESCE(e.es_prueba, false) AS es_prueba, e.tenant_public_disabled,
             COALESCE(e.suspendido, false) AS suspendido,
             COALESCE(e.aprobada, true) AS aprobada,
             COALESCE(e.revendedor_habilitado, true) AS revendedor_habilitado,
             COALESCE(e.consumibles_habilitado, true) AS consumibles_habilitado,
             COALESCE(entradas_stats.ganancias_owner, 0) as entradas_ganancias_owner,
             COALESCE(entradas_stats.volumen_bruto, 0) as entradas_volumen_bruto,
             COALESCE(entradas_stats.ventas, 0) as entradas_ventas,
             COALESCE(consumibles_stats.ganancias_owner, 0) as consumibles_ganancias_owner,
             COALESCE(consumibles_stats.volumen_bruto, 0) as consumibles_volumen_bruto,
             COALESCE(consumibles_stats.ventas, 0) as consumibles_ventas
      FROM empresas e
      LEFT JOIN (
        SELECT ev.empresa_id,
               COUNT(en.id) as ventas,
               COALESCE(SUM(en.precio_pagado), 0) as volumen_bruto,
               COALESCE(SUM(en.comision), 0) as ganancias_owner
        FROM entradas en
        JOIN eventos ev ON ev.id = en.evento_id
        WHERE en.estado != 'cancelada'
        GROUP BY ev.empresa_id
      ) entradas_stats ON entradas_stats.empresa_id = e.id
      LEFT JOIN (
        SELECT cv.empresa_id,
               COUNT(cv.id) as ventas,
               COALESCE(SUM(cv.total), 0) as volumen_bruto,
               COALESCE(SUM(cv.owner_fee_amount), 0) as ganancias_owner
        FROM consumibles_ventas cv
        WHERE cv.estado != 'cancelado'
        GROUP BY cv.empresa_id
      ) consumibles_stats ON consumibles_stats.empresa_id = e.id
      ${activeClause}
      ORDER BY ${orderClause} e.nombre ASC${limitClause}`
  } catch (error) {
    if (!isMissingConsumiblesOwnerFeeSchema(error)) {
      throw error
    }
    // Fallback: consumibles_ventas table not available
    empresaRows = await prisma.$queryRaw<CompanyAggRow>`
      SELECT e.id, e.nombre, e.slug, e.activa, COALESCE(e.es_prueba, false) AS es_prueba, e.tenant_public_disabled,
             COALESCE(e.suspendido, false) AS suspendido,
             COALESCE(e.aprobada, true) AS aprobada,
             COALESCE(e.revendedor_habilitado, true) AS revendedor_habilitado,
             COALESCE(e.consumibles_habilitado, true) AS consumibles_habilitado,
             COALESCE(entradas_stats.ganancias_owner, 0) as entradas_ganancias_owner,
             COALESCE(entradas_stats.volumen_bruto, 0) as entradas_volumen_bruto,
             COALESCE(entradas_stats.ventas, 0) as entradas_ventas,
             0 as consumibles_ganancias_owner,
             0 as consumibles_volumen_bruto,
             0 as consumibles_ventas
      FROM empresas e
      LEFT JOIN (
        SELECT ev.empresa_id,
               COUNT(en.id) as ventas,
               COALESCE(SUM(en.precio_pagado), 0) as volumen_bruto,
               COALESCE(SUM(en.comision), 0) as ganancias_owner
        FROM entradas en
        JOIN eventos ev ON ev.id = en.evento_id
        WHERE en.estado != 'cancelada'
        GROUP BY ev.empresa_id
      ) entradas_stats ON entradas_stats.empresa_id = e.id
      ${activeClause}
      ORDER BY ${orderClause} e.nombre ASC${limitClause}`
  }

  return empresaRows.map((row) => ({
    id: String(row.id),
    nombre: String(row.nombre),
    slug: String(row.slug),
    activa: Boolean(row.activa),
    esPrueba: Boolean(row.es_prueba),
    tenantPublicDisabled: Boolean(row.tenant_public_disabled),
    suspendido: Boolean(row.suspendido),
    aprobada: row.aprobada !== false,
    revendedorHabilitado: row.revendedor_habilitado !== false,
    consumiblesHabilitado: row.consumibles_habilitado !== false,
    gananciasOwner: roundMoney(Number(row.entradas_ganancias_owner ?? 0) + Number(row.consumibles_ganancias_owner ?? 0)),
    volumenBruto: roundMoney(Number(row.entradas_volumen_bruto ?? 0) + Number(row.consumibles_volumen_bruto ?? 0)),
    ventas: Number(row.entradas_ventas ?? 0) + Number(row.consumibles_ventas ?? 0),
    metricasPorFlow: {
      entradas: {
        ventasTotales: Number(row.entradas_ventas ?? 0),
        volumenBruto: roundMoney(Number(row.entradas_volumen_bruto ?? 0)),
        gananciasOwner: roundMoney(Number(row.entradas_ganancias_owner ?? 0)),
      },
      consumibles: {
        ventasTotales: Number(row.consumibles_ventas ?? 0),
        volumenBruto: roundMoney(Number(row.consumibles_volumen_bruto ?? 0)),
        gananciasOwner: roundMoney(Number(row.consumibles_ganancias_owner ?? 0)),
      },
    },
  }))
}

export async function getPlatformCompanyReporting(empresaId: string): Promise<PlatformCompanyDetail | null> {
  const empresa = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { id: true, nombre: true },
  })

  if (!empresa) {
    return null
  }

  type StatsRaw = { volumen_bruto: unknown; ganancias_owner: unknown; ventas: unknown }[]
  type SeriesRaw = { dia: Date | string; total: unknown }[]

  const [entradasStatsRaw, entradasSeriesRaw] = await Promise.all([
    prisma.$queryRaw<StatsRaw>`
      SELECT COALESCE(SUM(en.precio_pagado), 0) as volumen_bruto,
             COALESCE(SUM(en.comision), 0) as ganancias_owner,
             COUNT(en.id) as ventas
      FROM eventos ev
      LEFT JOIN entradas en ON en.evento_id = ev.id AND en.estado != 'cancelada'
      WHERE ev.empresa_id = ${empresaId}`,
    prisma.$queryRaw<SeriesRaw>`
      SELECT DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') as dia, COALESCE(SUM(en.comision), 0) as total
      FROM entradas en
      JOIN eventos ev ON ev.id = en.evento_id
      WHERE ev.empresa_id = ${empresaId} AND en.estado != 'cancelada'
      GROUP BY DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') ORDER BY dia ASC`,
  ])

  let consumiblesStats = { volumenBruto: 0, gananciasOwner: 0, ventas: 0 }
  let consumiblesSeries: PlatformSeriesPoint[] = []

  try {
    const [consumiblesStatsRaw, consumiblesSeriesRaw] = await Promise.all([
      prisma.$queryRaw<StatsRaw>`
        SELECT COALESCE(SUM(total), 0) as volumen_bruto,
               COALESCE(SUM(owner_fee_amount), 0) as ganancias_owner,
               COUNT(id) as ventas
        FROM consumibles_ventas
        WHERE empresa_id = ${empresaId} AND estado != 'cancelado'`,
      prisma.$queryRaw<SeriesRaw>`
        SELECT DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') as dia, COALESCE(SUM(owner_fee_amount), 0) as total
        FROM consumibles_ventas
        WHERE empresa_id = ${empresaId} AND estado != 'cancelado'
        GROUP BY DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') ORDER BY dia ASC`,
    ])

    consumiblesStats = {
      volumenBruto: Number(consumiblesStatsRaw[0]?.volumen_bruto ?? 0),
      gananciasOwner: Number(consumiblesStatsRaw[0]?.ganancias_owner ?? 0),
      ventas: Number(consumiblesStatsRaw[0]?.ventas ?? 0),
    }
    consumiblesSeries = consumiblesSeriesRaw.map((row) => ({
      dia: (row.dia instanceof Date ? row.dia.toISOString() : String(row.dia)).slice(0, 10),
      total: Number(row.total ?? 0),
    }))
  } catch (error) {
    if (!isMissingConsumiblesOwnerFeeSchema(error)) {
      throw error
    }
  }

  return {
    empresaId,
    empresaNombre: empresa.nombre,
    volumenBruto: roundMoney(Number(entradasStatsRaw[0]?.volumen_bruto ?? 0) + consumiblesStats.volumenBruto),
    gananciasOwner: roundMoney(Number(entradasStatsRaw[0]?.ganancias_owner ?? 0) + consumiblesStats.gananciasOwner),
    ventas: Number(entradasStatsRaw[0]?.ventas ?? 0) + consumiblesStats.ventas,
    serieTemporal: mergeSeries(
      entradasSeriesRaw.map((row) => ({ dia: (row.dia instanceof Date ? row.dia.toISOString() : String(row.dia)).slice(0, 10), total: Number(row.total ?? 0) })),
      consumiblesSeries
    ),
    metricasPorFlow: {
      entradas: {
        ventasTotales: Number(entradasStatsRaw[0]?.ventas ?? 0),
        volumenBruto: roundMoney(Number(entradasStatsRaw[0]?.volumen_bruto ?? 0)),
        gananciasOwner: roundMoney(Number(entradasStatsRaw[0]?.ganancias_owner ?? 0)),
      },
      consumibles: {
        ventasTotales: consumiblesStats.ventas,
        volumenBruto: roundMoney(consumiblesStats.volumenBruto),
        gananciasOwner: roundMoney(consumiblesStats.gananciasOwner),
      },
    },
  }
}
