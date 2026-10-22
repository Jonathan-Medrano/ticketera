import { randomUUID as uuidv4 } from 'node:crypto'
import { prisma, prismaDirectUrl } from './prisma'
import { Prisma } from '@prisma/client'
import { roundMoney } from './money'

type QueryExecutor = {
  query: (sql: string, values?: unknown[]) => Promise<unknown>
}

// A Prisma interactive transaction client can be used instead of a legacy mysql2 PoolConnection
// for calls that originate inside a Prisma $transaction (e.g. confirmarPagoLogic).
type PrismaTxClient = Prisma.TransactionClient

// Legacy duck-type for connection-like executors that held transaction control methods.
// In practice, production callers cast a Prisma tx as unknown as ShareLockExecutor
// so the mysql2 PoolConnection type is no longer needed.
type LegacyConnectionMethods = {
  beginTransaction: () => Promise<void>
  commit: () => Promise<void>
  rollback: () => Promise<void>
  release: () => void
}
type ShareLockExecutor = QueryExecutor & LegacyConnectionMethods

export type PlatformRevenueFlow = 'entradas' | 'consumibles'
export type PlatformAllocationEntryKind = 'allocation' | 'reversal'
export const PLATFORM_REVENUE_FLOWS: PlatformRevenueFlow[] = ['entradas', 'consumibles']
export type PlatformPermissionKey = 'platform_dashboard' | 'platform_empresas' | 'platform_configuracion' | 'platform_usuarios'

type PlatformAdminRow = {
  id: string
  nombre: string
  role_slug: string | null
  singleton_key: string | null
  activo: number
  permisos: string | null
}

type ShareRow = {
  platform_admin_user_id: string
  flow: PlatformRevenueFlow
  percentage: number | string | Prisma.Decimal
}

type PlatformRevenueGrantRow = {
  parent_platform_admin_user_id: string
  child_platform_admin_user_id: string
  flow: PlatformRevenueFlow
  percentage: number | string
}

type PlatformRelationshipRow = {
  platform_admin_user_id: string
  parent_platform_admin_user_id: string | null
}

type AllocationAggregateRow = {
  effective_platform_admin_user_id: string
  configured_platform_admin_user_id: string
  flow: PlatformRevenueFlow
  total: number | string
  owner_fee_total: number | string
  sales_count: number | string
  fallback_total: number | string
  dia?: string
  empresa_id?: string
  starts_at?: string | Date | null
}

type PlatformAllocationLedgerRow = {
  id: string
  source_type: 'entrada' | 'consumible_venta' | 'addon_venta'
  source_id: string
  checkout_session_id: string | null
  empresa_id: string
  flow: PlatformRevenueFlow
  currency: string
  owner_fee_amount: number | string
  allocated_amount: number | string
  allocation_percentage: number | string
  entry_kind: PlatformAllocationEntryKind
  reversal_for_allocation_id: string | null
  reversal_reason: string | null
  reversal_reference_type: string | null
  reversal_reference_id: string | null
  configured_platform_admin_user_id: string
  effective_platform_admin_user_id: string
  fallback_reason: string
}

export type PlatformDirectPermissions = Record<PlatformPermissionKey, boolean>

export type PlatformUserShareByFlow = Record<PlatformRevenueFlow, number>

export type PlatformAllocationInsert = {
  sourceType: 'entrada' | 'consumible_venta' | 'addon_venta'
  sourceId: string
  checkoutSessionId: string | null
  empresaId: string
  flow: PlatformRevenueFlow
  currency: string
  ownerFeeAmount: number
  allocatedAmount: number
  allocationPercentage: number
  configuredPlatformAdminUserId: string
  effectivePlatformAdminUserId: string
  fallbackReason: string
  entryKind?: PlatformAllocationEntryKind
  reversalForAllocationId?: string | null
  reversalReason?: string | null
  reversalReferenceType?: string | null
  reversalReferenceId?: string | null
}

export type PlatformAllocationResolution = PlatformAllocationInsert & {
  configuredUserName: string
  effectiveUserName: string
}

export type PlatformAllocationUserSummary = {
  userId: string
  nombre: string
  roleSlug: string
  isSingletonSuperadmin: boolean
  permissions: PlatformDirectPermissions
  configuredShareByFlow: PlatformUserShareByFlow
  effectiveRevenueByFlow: Record<PlatformRevenueFlow, number>
  fallbackRevenueByFlow: Record<PlatformRevenueFlow, number>
}

export type PlatformProfitSharingCutoff = {
  startsAt: string | null
  source: 'first_allocation'
}

export type PlatformProfitSharingOverview = {
  cutoff: PlatformProfitSharingCutoff
  totalsByFlow: Record<PlatformRevenueFlow, {
    ownerFeeTotal: number
    assignedPercentage: number
    remainderPercentage: number
    overflowPercentage: number
    isOverallocated: boolean
  }>
  integrity: {
    hasInvalidShareTotals: boolean
    issues: Array<{
      flow: PlatformRevenueFlow
      assignedPercentage: number
      overflowPercentage: number
      affectedUserIds: string[]
      message: string
    }>
  }
  users: PlatformAllocationUserSummary[]
}

export function getDefaultPlatformPermissions(): PlatformDirectPermissions {
  return {
    platform_dashboard: false,
    platform_empresas: false,
    platform_configuracion: false,
    platform_usuarios: false,
  }
}

export function normalizePlatformPermissions(input: unknown): PlatformDirectPermissions {
  const normalized = getDefaultPlatformPermissions()
  if (!input || typeof input !== 'object') return normalized

  for (const key of Object.keys(normalized) as PlatformPermissionKey[]) {
    normalized[key] = (input as Record<string, unknown>)[key] === true
  }

  return normalized
}

export function parsePlatformPermissions(raw: string | null | undefined) {
  if (!raw) return getDefaultPlatformPermissions()
  try {
    return normalizePlatformPermissions(JSON.parse(raw))
  } catch {
    return getDefaultPlatformPermissions()
  }
}

export function serializePlatformPermissions(permisos: unknown) {
  return JSON.stringify(normalizePlatformPermissions(permisos))
}

export async function getSingletonSuperadmin(): Promise<PlatformAdminRow | null> {
  const row = await prisma.platformAdminUser.findFirst({
    where: { singleton_key: 'superadmin' },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    select: { id: true, nombre: true, role_slug: true, singleton_key: true, activo: true, permisos: true },
  })
  if (!row) return null
  return {
    id: row.id,
    nombre: row.nombre,
    role_slug: row.role_slug ?? null,
    singleton_key: row.singleton_key ?? null,
    activo: row.activo ? 1 : 0,
    permisos: row.permisos ?? null,
  } as PlatformAdminRow
}

async function getShareRows(): Promise<ShareRow[]> {
  const rows = await prisma.platformAdminUserFlowShare.findMany({
    select: { platform_admin_user_id: true, flow: true, percentage: true },
  })
  return rows.map((row) => ({
    platform_admin_user_id: row.platform_admin_user_id,
    flow: row.flow as PlatformRevenueFlow,
    percentage: row.percentage,
  })) as ShareRow[]
}

async function getRevenueGrantRows(flow?: PlatformRevenueFlow): Promise<PlatformRevenueGrantRow[]> {
  try {
    const rows = flow
      ? await prisma.platformAdminRevenueGrant.findMany({
          where: { flow },
          select: { parent_platform_admin_user_id: true, child_platform_admin_user_id: true, flow: true, percentage: true },
        })
      : await prisma.platformAdminRevenueGrant.findMany({
          select: { parent_platform_admin_user_id: true, child_platform_admin_user_id: true, flow: true, percentage: true },
        })
    return rows.map((row) => ({
      parent_platform_admin_user_id: row.parent_platform_admin_user_id,
      child_platform_admin_user_id: row.child_platform_admin_user_id,
      flow: row.flow as PlatformRevenueFlow,
      percentage: Number(row.percentage),
    })) as PlatformRevenueGrantRow[]
  } catch {
    return []
  }
}

async function getRelationshipRows(): Promise<PlatformRelationshipRow[]> {
  try {
    const rows = await prisma.platformAdminRelationship.findMany({
      select: { platform_admin_user_id: true, parent_platform_admin_user_id: true },
    })
    return rows.map((row) => ({
      platform_admin_user_id: row.platform_admin_user_id,
      parent_platform_admin_user_id: row.parent_platform_admin_user_id ?? null,
    })) as PlatformRelationshipRow[]
  } catch {
    return []
  }
}

function normalizeSharePercentage(value: number, flow: PlatformRevenueFlow) {
  if (!Number.isFinite(value)) {
    throw new Error(`El porcentaje configurado para ${flow} debe ser un número válido`)
  }

  const normalized = roundMoney(value)
  if (normalized < 0 || normalized > 100) {
    throw new Error(`El porcentaje configurado para ${flow} debe estar entre 0 y 100`)
  }

  return normalized
}

function summarizeShareRows(
  shareRows: ShareRow[],
  superadminId?: string | null,
  candidateUserId?: string,
  candidateShares?: Partial<Record<PlatformRevenueFlow, number>>,
) {
  const totals: PlatformUserShareByFlow = { entradas: 0, consumibles: 0 }
  const affectedUserIdsByFlow: Record<PlatformRevenueFlow, string[]> = { entradas: [], consumibles: [] }

  for (const row of shareRows) {
    const platformAdminUserId = String(row.platform_admin_user_id)
    if (candidateUserId && platformAdminUserId === candidateUserId) continue
    if (superadminId && platformAdminUserId === superadminId) continue

    totals[row.flow] = roundMoney(totals[row.flow] + Number(row.percentage ?? 0))
    affectedUserIdsByFlow[row.flow].push(platformAdminUserId)
  }

  for (const flow of PLATFORM_REVENUE_FLOWS) {
    const candidateShare = candidateShares?.[flow]
    if (candidateShare === undefined) continue
    if (Number(candidateShare) > 0 && candidateUserId && !affectedUserIdsByFlow[flow].includes(candidateUserId)) {
      affectedUserIdsByFlow[flow].push(candidateUserId)
    }

    totals[flow] = roundMoney(totals[flow] + Number(candidateShare ?? 0))
  }

  const issues = PLATFORM_REVENUE_FLOWS.flatMap((flow) => {
    const overflowPercentage = roundMoney(Math.max(0, totals[flow] - 100))
    if (overflowPercentage <= 0) return []

    return [{
      flow,
      assignedPercentage: totals[flow],
      overflowPercentage,
      affectedUserIds: affectedUserIdsByFlow[flow],
      message: `La suma configurada para ${flow} no puede superar 100% (excede por ${overflowPercentage}%)`,
    }]
  })

  return { totals, issues }
}

function buildShareLockName(flow: PlatformRevenueFlow) {
  return `platform_profit_sharing:${flow}`
}

// Legacy `acquirePlatformShareLocks` / `releasePlatformShareLocks` (MySQL `GET_LOCK`/`RELEASE_LOCK`)
// removed Phase 4 — `runLockedShareMutation` uses `pg_advisory_xact_lock(9002)` instead.
// `buildShareLockName(flow)` retained in case future callers want it for naming.

// Advisory lock key for platform profit-sharing write operations (pg_advisory_xact_lock).
// Key registry: 4242=delivery-retry, 7701=marketing-carrito, 8823=checkoutCleanup,
//               9001=platform-governance, 9002=platform-profit-sharing (THIS FILE)
// Lock is transactional: auto-released on commit or rollback — no explicit RELEASE needed.
const PLATFORM_PROFIT_SHARING_LOCK_KEY = 9002n

async function runLockedShareMutation<T>(
  _flows: PlatformRevenueFlow[],
  work: (executor: ShareLockExecutor) => Promise<T>,
) {
  // Postgres advisory lock — transactional, auto-released on commit/rollback.
  // MUST use prismaDirectUrl (direct port 5432) — PgBouncer transaction mode
  // is incompatible with transaction-level advisory locks.
  let capturedResult: T | undefined
  await prismaDirectUrl.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PLATFORM_PROFIT_SHARING_LOCK_KEY})`
    // Cast is safe: production callers (upsertPlatformUserShares, deletePlatformUserShares)
    // use the Prisma-native path and never read work()'s argument as PoolConnection.
    capturedResult = await work(tx as unknown as ShareLockExecutor)
  }, { timeout: 30000 })
  return capturedResult as T
}

function normalizeConfiguredUserIds(configuredUserIds?: string | string[] | null) {
  if (!configuredUserIds) return [] as string[]
  return Array.from(new Set((Array.isArray(configuredUserIds) ? configuredUserIds : [configuredUserIds]).map((userId) => userId.trim()).filter(Boolean)))
}

async function computeRevenueDistribution(flow: PlatformRevenueFlow, empresaId?: string | null) {
  const [superadmin, prismaAdminRows, prismaPaymentRows, revenueGrantRows, relationshipRows, empresaOverrideRows] = await Promise.all([
    getSingletonSuperadmin(),
    prisma.platformAdminUser.findMany({
      select: { id: true, nombre: true, role_slug: true, singleton_key: true, activo: true, permisos: true },
    }),
    prisma.platformPaymentAccount.findMany({
      where: { provider: 'mercadopago' },
      select: { platform_admin_user_id: true, status: true },
    }),
    getRevenueGrantRows(flow),
    getRelationshipRows(),
    empresaId
      ? prisma.platformAdminUserEmpresaOverride.findMany({
          where: { empresa_id: empresaId, flow },
          select: { platform_admin_user_id: true, percentage: true },
        })
      : Promise.resolve([] as { platform_admin_user_id: string; percentage: Prisma.Decimal | number }[]),
  ])

  if (!superadmin) throw new Error('No existe superadmin singleton para resolver allocations')

  const admins: PlatformAdminRow[] = prismaAdminRows.map((row) => ({
    id: row.id,
    nombre: row.nombre,
    role_slug: row.role_slug ?? null,
    singleton_key: row.singleton_key ?? null,
    activo: row.activo ? 1 : 0,
    permisos: row.permisos ?? null,
  } as PlatformAdminRow))
  const byId = new Map(admins.map((row) => [String(row.id), row]))
  const paymentStatusByUserId = new Map(prismaPaymentRows.map((row) => [String(row.platform_admin_user_id), String(row.status)]))
  const parentByChild = new Map(relationshipRows.map((row) => [String(row.platform_admin_user_id), row.parent_platform_admin_user_id ? String(row.parent_platform_admin_user_id) : null]))
  const childrenByParent = new Map<string, Array<{ userId: string; grant: number }>>()

  for (const row of revenueGrantRows) {
    const parentUserId = String(row.parent_platform_admin_user_id)
    const childUserId = String(row.child_platform_admin_user_id)
    const list = childrenByParent.get(parentUserId) ?? []
    list.push({ userId: childUserId, grant: roundMoney(Number(row.percentage ?? 0)) })
    childrenByParent.set(parentUserId, list)
  }

  const retainedShareByUserId = new Map<string, number>()
  const effectiveGrantByUserId = new Map<string, number>()
  const issues: Array<{ flow: PlatformRevenueFlow; assignedPercentage: number; overflowPercentage: number; affectedUserIds: string[]; message: string }> = []
  const rootUserId = String(superadmin.id)

  const walk = (userId: string, effectiveGrant: number) => {
    effectiveGrantByUserId.set(userId, effectiveGrant)
    const childRows = childrenByParent.get(userId) ?? []
    const delegatedTotal = roundMoney(childRows.reduce((acc, child) => acc + child.grant, 0))
    if (delegatedTotal > roundMoney(effectiveGrant)) {
      issues.push({
        flow,
        assignedPercentage: delegatedTotal,
        overflowPercentage: roundMoney(delegatedTotal - effectiveGrant),
        affectedUserIds: [userId, ...childRows.map((child) => child.userId)],
        message: `La rama de ${flow} excede el bag de su padre por ${roundMoney(delegatedTotal - effectiveGrant)}%`,
      })
    }

    retainedShareByUserId.set(userId, roundMoney(Math.max(0, effectiveGrant - delegatedTotal)))
    for (const child of childRows) {
      walk(child.userId, child.grant)
    }
  }

  walk(rootUserId, 100)

  // ---- Empresa-level overrides (Phase: platform_admin_user_empresa_overrides) ----
  // When an empresaId is provided, override the retained share of any non-root user
  // who has an override row for (empresa_id, flow). The superadmin/root is never
  // overrideable directly: its retained share is the REMAINDER of the bag once
  // overrides + non-overridden global retained shares are subtracted from 100.
  //
  // Semantics: override REPLACES the global retained share for this empresa+flow
  // (not additive — see decision in engram: architecture/platform-empresa-overrides).
  if (empresaOverrideRows.length > 0) {
    const overrideByUser = new Map<string, number>()
    for (const row of empresaOverrideRows) {
      const userId = String(row.platform_admin_user_id)
      if (userId === rootUserId) continue
      overrideByUser.set(userId, normalizeSharePercentage(Number(row.percentage ?? 0), flow))
    }

    for (const [userId, overridePct] of overrideByUser) {
      retainedShareByUserId.set(userId, overridePct)
    }

    let nonRootTotal = 0
    for (const [userId, share] of retainedShareByUserId) {
      if (userId === rootUserId) continue
      nonRootTotal = roundMoney(nonRootTotal + share)
    }

    if (nonRootTotal > 100) {
      issues.push({
        flow,
        assignedPercentage: nonRootTotal,
        overflowPercentage: roundMoney(nonRootTotal - 100),
        affectedUserIds: Array.from(overrideByUser.keys()),
        message: `Los overrides por empresa para ${flow} suman ${nonRootTotal}% (excede 100% por ${roundMoney(nonRootTotal - 100)}%)`,
      })
    }

    retainedShareByUserId.set(rootUserId, roundMoney(Math.max(0, 100 - nonRootTotal)))
  }

  const resolveEffectivePayoutUserId = (configuredUserId: string) => {
    let cursor: string | null = configuredUserId
    while (cursor) {
      const user = byId.get(cursor)
      const status = paymentStatusByUserId.get(cursor)
      if (cursor === rootUserId) return rootUserId
      if (user && Number(user.activo) === 1 && status === 'ready_to_sell') {
        return cursor
      }
      cursor = parentByChild.get(cursor) ?? rootUserId
      if (cursor === rootUserId) return rootUserId
    }
    return rootUserId
  }

  const configs = admins
    .map((admin) => {
      const configuredPlatformAdminUserId = String(admin.id)
      const retainedPercentage = roundMoney(retainedShareByUserId.get(configuredPlatformAdminUserId) ?? 0)
      if (retainedPercentage <= 0) return null
      const effectivePlatformAdminUserId = resolveEffectivePayoutUserId(configuredPlatformAdminUserId)
      const effectiveUser = byId.get(effectivePlatformAdminUserId) ?? superadmin
      const fallbackReason = effectivePlatformAdminUserId === configuredPlatformAdminUserId
        ? 'none'
        : Number(admin.activo) !== 1
          ? 'inactive_platform_user'
          : paymentStatusByUserId.get(configuredPlatformAdminUserId)
            ? 'payment_account_not_ready'
            : 'missing_payment_account'

      return {
        configuredPlatformAdminUserId,
        effectivePlatformAdminUserId,
        allocationPercentage: retainedPercentage,
        configuredUserName: String(admin.nombre),
        effectiveUserName: String(effectiveUser.nombre),
        fallbackReason,
      }
    })
    .filter((config): config is NonNullable<typeof config> => !!config)

  return {
    rootUserId,
    configs,
    issues,
    retainedShareByUserId,
    effectiveGrantByUserId,
  }
}

export async function getPlatformUserShareMap() {
  const rows = await getShareRows()
  const map = new Map<string, PlatformUserShareByFlow>()
  for (const row of rows) {
    const current = map.get(String(row.platform_admin_user_id)) ?? { entradas: 0, consumibles: 0 }
    current[row.flow] = Number(row.percentage ?? 0)
    map.set(String(row.platform_admin_user_id), current)
  }
  return map
}

export async function validatePlatformShareTotals(candidateUserId?: string, candidateShares?: Partial<Record<PlatformRevenueFlow, number>>) {
  const shareRows = await getShareRows()
  const { totals } = summarizeShareRows(shareRows, null, candidateUserId, candidateShares)
  return totals
}

export async function upsertPlatformUserShares(params: {
  platformAdminUserId: string
  configuredByPlatformAdminId?: string | null
  sharesByFlow?: Partial<Record<PlatformRevenueFlow, number>>
  executor?: ShareLockExecutor
  skipLocking?: boolean
}) {
  const normalizedShares: PlatformUserShareByFlow = {
    entradas: normalizeSharePercentage(Number(params.sharesByFlow?.entradas ?? 0), 'entradas'),
    consumibles: normalizeSharePercentage(Number(params.sharesByFlow?.consumibles ?? 0), 'consumibles'),
  }

  // Prisma-native path when no legacy executor provided
  if (!params.executor) {
    for (const flow of PLATFORM_REVENUE_FLOWS) {
      await prisma.platformAdminUserFlowShare.upsert({
        where: { platform_admin_user_id_flow: { platform_admin_user_id: params.platformAdminUserId, flow } },
        create: {
          id: uuidv4(),
          platform_admin_user_id: params.platformAdminUserId,
          flow,
          percentage: normalizedShares[flow],
          configured_by_platform_admin_id: params.configuredByPlatformAdminId ?? null,
        },
        update: {
          percentage: normalizedShares[flow],
          configured_by_platform_admin_id: params.configuredByPlatformAdminId ?? null,
        },
      })
    }
    return normalizedShares
  }

  // Legacy mysql2 path (executor provided by platform-governance.ts)
  const persistShares = async (executor: ShareLockExecutor) => {
    for (const flow of PLATFORM_REVENUE_FLOWS) {
      await executor.query(
        `INSERT INTO platform_admin_user_flow_shares (
          id, platform_admin_user_id, flow, percentage, configured_by_platform_admin_id
        ) VALUES (?, ?, ?::"PlatformFlowEnum", ?, ?)
        ON CONFLICT (platform_admin_user_id, flow) DO UPDATE SET
          percentage = EXCLUDED.percentage,
          configured_by_platform_admin_id = EXCLUDED.configured_by_platform_admin_id,
          updated_at = CURRENT_TIMESTAMP`,
        [uuidv4(), params.platformAdminUserId, flow, normalizedShares[flow], params.configuredByPlatformAdminId ?? null]
      )
    }

    return normalizedShares
  }

  if (params.skipLocking) {
    return persistShares(params.executor)
  }

  return runLockedShareMutation(PLATFORM_REVENUE_FLOWS, persistShares)
}

export async function deletePlatformUserShares(platformAdminUserId: string, executor?: ShareLockExecutor, skipLocking = false) {
  if (!executor) {
    // Prisma-native path
    await prisma.platformAdminUserFlowShare.deleteMany({
      where: { platform_admin_user_id: platformAdminUserId },
    })
    return
  }

  // Legacy mysql2 path
  if (skipLocking) {
    await executor.query(`DELETE FROM platform_admin_user_flow_shares WHERE platform_admin_user_id = ?`, [platformAdminUserId])
    return
  }

  await runLockedShareMutation(PLATFORM_REVENUE_FLOWS, async (lockedExecutor) => {
    await lockedExecutor.query(`DELETE FROM platform_admin_user_flow_shares WHERE platform_admin_user_id = ?`, [platformAdminUserId])
  })
}

function distributeByWeight(weightCents: number[], totalAmount: number) {
  const totalCents = Math.round(roundMoney(totalAmount) * 100)
  if (totalCents <= 0 || weightCents.length === 0) return weightCents.map(() => 0)
  const denominator = weightCents.reduce((acc, value) => acc + value, 0)
  if (denominator <= 0) return weightCents.map(() => 0)

  const base = weightCents.map((value, index) => {
    const exact = (totalCents * value) / denominator
    return { index, cents: Math.floor(exact), remainder: exact - Math.floor(exact) }
  })
  let remaining = totalCents - base.reduce((acc, item) => acc + item.cents, 0)
  for (const item of [...base].sort((a, b) => b.remainder - a.remainder || a.index - b.index)) {
    if (remaining <= 0) break
    item.cents += 1
    remaining -= 1
  }

  return base.sort((a, b) => a.index - b.index).map((item) => roundMoney(item.cents / 100))
}

export async function resolvePlatformAllocations(params: {
  flow: PlatformRevenueFlow
  totalOwnerFeeAmount: number
  currency?: string
  sales: Array<{ sourceType: 'entrada' | 'consumible_venta' | 'addon_venta'; sourceId: string; amountWeight: number; checkoutSessionId: string | null; empresaId: string }>
}) {
  // All sales in a single resolvePlatformAllocations call come from the same checkout,
  // which belongs to exactly one empresa. Derive empresaId from the sales so we can
  // apply empresa-level commission overrides (platform_admin_user_empresa_overrides).
  const distinctEmpresaIds = Array.from(new Set(params.sales.map((sale) => sale.empresaId).filter(Boolean)))
  if (distinctEmpresaIds.length > 1) {
    throw new Error(`resolvePlatformAllocations: sales mezclan ${distinctEmpresaIds.length} empresas, no soportado`)
  }
  const empresaId = distinctEmpresaIds[0] ?? null

  const distribution = await computeRevenueDistribution(params.flow, empresaId)
  if (distribution.issues.length > 0) {
    throw new Error(distribution.issues[0].message)
  }

  const weightCents = params.sales.map((sale) => Math.max(0, Math.round(Number(sale.amountWeight) * 100)))
  const currency = params.currency ?? 'ARS'
  const totalOwnerFeeAmount = roundMoney(params.totalOwnerFeeAmount)
  const configs = distribution.configs

  const configTotals = distributeByWeight(
    configs.map((config) => Math.round(totalOwnerFeeAmount * config.allocationPercentage)),
    totalOwnerFeeAmount
  )

  const resolved: PlatformAllocationResolution[] = []
  configs.forEach((config, configIndex) => {
    const perSaleAmounts = distributeByWeight(weightCents, configTotals[configIndex] ?? 0)
    perSaleAmounts.forEach((allocatedAmount, saleIndex) => {
      if (allocatedAmount <= 0) return
      const sale = params.sales[saleIndex]
      resolved.push({
        sourceType: sale.sourceType,
        sourceId: sale.sourceId,
        checkoutSessionId: sale.checkoutSessionId,
        empresaId: sale.empresaId,
        flow: params.flow,
        currency,
        ownerFeeAmount: totalOwnerFeeAmount,
        allocatedAmount,
        allocationPercentage: config.allocationPercentage,
        configuredPlatformAdminUserId: config.configuredPlatformAdminUserId,
        effectivePlatformAdminUserId: config.effectivePlatformAdminUserId,
        fallbackReason: config.fallbackReason,
        configuredUserName: config.configuredUserName,
        effectiveUserName: config.effectiveUserName,
      })
    })
  })

  return resolved
}

export async function persistPlatformAllocations(
  allocations: PlatformAllocationInsert[],
  executor?: QueryExecutor | PrismaTxClient,
) {
  for (const allocation of allocations) {
    // Prisma-native path: no executor provided, or executor is a PrismaTxClient.
    // Detect PrismaTxClient by presence of $executeRaw (Prisma) vs .query (mysql2).
    if (!executor || '$executeRaw' in executor) {
      const tx = (executor as PrismaTxClient | undefined) ?? prisma
      await tx.platformSaleAllocation.create({
        data: {
          id: uuidv4(),
          source_type: allocation.sourceType,
          source_id: allocation.sourceId,
          checkout_session_id: allocation.checkoutSessionId ?? null,
          empresa_id: allocation.empresaId,
          flow: allocation.flow,
          currency: allocation.currency,
          owner_fee_amount: allocation.ownerFeeAmount,
          allocated_amount: allocation.allocatedAmount,
          allocation_percentage: allocation.allocationPercentage,
          entry_kind: (allocation.entryKind ?? 'allocation') as 'allocation' | 'reversal',
          reversal_for_allocation_id: allocation.reversalForAllocationId ?? null,
          reversal_reason: allocation.reversalReason ?? null,
          reversal_reference_type: allocation.reversalReferenceType ?? null,
          reversal_reference_id: allocation.reversalReferenceId ?? null,
          configured_platform_admin_user_id: allocation.configuredPlatformAdminUserId,
          effective_platform_admin_user_id: allocation.effectivePlatformAdminUserId,
          fallback_reason: allocation.fallbackReason,
        },
      })
    } else {
      // Legacy mysql2 path (executor provided by legacy callers / tests)
      await (executor as QueryExecutor).query(
        `INSERT INTO platform_sale_allocations (
          id, source_type, source_id, checkout_session_id, empresa_id, flow, currency,
          owner_fee_amount, allocated_amount, allocation_percentage,
          entry_kind, reversal_for_allocation_id, reversal_reason, reversal_reference_type, reversal_reference_id,
          configured_platform_admin_user_id, effective_platform_admin_user_id, fallback_reason
        ) VALUES (?, ?::"PlatformSaleAllocSourceTypeEnum", ?, ?, ?, ?::"PlatformFlowEnum", ?, ?, ?, ?, ?::"PlatformSaleAllocEntryKindEnum", ?, ?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          allocation.sourceType,
          allocation.sourceId,
          allocation.checkoutSessionId,
          allocation.empresaId,
          allocation.flow,
          allocation.currency,
          allocation.ownerFeeAmount,
          allocation.allocatedAmount,
          allocation.allocationPercentage,
          allocation.entryKind ?? 'allocation',
          allocation.reversalForAllocationId ?? null,
          allocation.reversalReason ?? null,
          allocation.reversalReferenceType ?? null,
          allocation.reversalReferenceId ?? null,
          allocation.configuredPlatformAdminUserId,
          allocation.effectivePlatformAdminUserId,
          allocation.fallbackReason,
        ]
      )
    }
  }
}

export async function reversePlatformAllocationsForSources(
  params: {
    sourceType: 'entrada' | 'consumible_venta' | 'addon_venta'
    sourceIds: string[]
    reason: string
    referenceType: string
    referenceId: string
    empresaId?: string
  },
  executor?: QueryExecutor
) {
  const normalizedSourceIds = Array.from(new Set((params.sourceIds ?? []).map((sourceId) => sourceId.trim()).filter(Boolean)))
  if (normalizedSourceIds.length === 0) {
    return { created: 0, skipped: 0 }
  }

  // Prisma-native path (no legacy executor provided)
  if (!executor) {
    type LedgerRaw = PlatformAllocationLedgerRow[]
    const empresaClause = params.empresaId
      ? Prisma.sql` AND alloc.empresa_id = ${params.empresaId}`
      : Prisma.empty
    const rows = await prisma.$queryRaw<LedgerRaw>`
      SELECT alloc.id, alloc.source_type, alloc.source_id, alloc.checkout_session_id, alloc.empresa_id, alloc.flow,
             alloc.currency, alloc.owner_fee_amount, alloc.allocated_amount, alloc.allocation_percentage,
             alloc.entry_kind, alloc.reversal_for_allocation_id, alloc.reversal_reason,
             alloc.reversal_reference_type, alloc.reversal_reference_id,
             alloc.configured_platform_admin_user_id, alloc.effective_platform_admin_user_id, alloc.fallback_reason
      FROM platform_sale_allocations alloc
      LEFT JOIN platform_sale_allocations reversal ON reversal.reversal_for_allocation_id = alloc.id
      WHERE alloc.source_type = ${params.sourceType}::"PlatformSaleAllocSourceTypeEnum"
        AND alloc.source_id = ANY(${normalizedSourceIds})
        AND alloc.entry_kind = 'allocation'
        ${empresaClause}
        AND reversal.id IS NULL`

    for (const allocation of rows) {
      await prisma.platformSaleAllocation.create({
        data: {
          id: uuidv4(),
          source_type: allocation.source_type,
          source_id: allocation.source_id,
          checkout_session_id: allocation.checkout_session_id ?? null,
          empresa_id: allocation.empresa_id,
          flow: allocation.flow as 'entradas' | 'consumibles',
          currency: allocation.currency,
          owner_fee_amount: roundMoney(-Number(allocation.owner_fee_amount ?? 0)),
          allocated_amount: roundMoney(-Number(allocation.allocated_amount ?? 0)),
          allocation_percentage: Number(allocation.allocation_percentage ?? 0),
          entry_kind: 'reversal',
          reversal_for_allocation_id: allocation.id,
          reversal_reason: params.reason,
          reversal_reference_type: params.referenceType,
          reversal_reference_id: params.referenceId,
          configured_platform_admin_user_id: allocation.configured_platform_admin_user_id,
          effective_platform_admin_user_id: allocation.effective_platform_admin_user_id,
          fallback_reason: allocation.fallback_reason,
        },
      }).catch(() => {
        // Idempotent: reversal_for_allocation_id is unique — ignore conflict
      })
    }

    const reversedSourceIds = new Set(rows.map((row) => row.source_id))
    return {
      created: rows.length,
      skipped: normalizedSourceIds.filter((sourceId) => !reversedSourceIds.has(sourceId)).length,
    }
  }

  // Legacy mysql2 path (executor provided by legacy callers)
  const placeholders = normalizedSourceIds.map(() => '?').join(', ')
  const queryValues: unknown[] = [params.sourceType, ...normalizedSourceIds]
  const empresaFilter = params.empresaId ? ' AND alloc.empresa_id = ?' : ''
  if (params.empresaId) queryValues.push(params.empresaId)

  const [rows] = await executor.query(
    `SELECT alloc.id, alloc.source_type, alloc.source_id, alloc.checkout_session_id, alloc.empresa_id, alloc.flow,
            alloc.currency, alloc.owner_fee_amount, alloc.allocated_amount, alloc.allocation_percentage,
            alloc.entry_kind, alloc.reversal_for_allocation_id, alloc.reversal_reason,
            alloc.reversal_reference_type, alloc.reversal_reference_id,
            alloc.configured_platform_admin_user_id, alloc.effective_platform_admin_user_id, alloc.fallback_reason
     FROM platform_sale_allocations alloc
     LEFT JOIN platform_sale_allocations reversal ON reversal.reversal_for_allocation_id = alloc.id
     WHERE alloc.source_type = ?::"PlatformSaleAllocSourceTypeEnum"
       AND alloc.source_id IN (${placeholders})
       AND alloc.entry_kind = 'allocation'
       ${empresaFilter}
       AND reversal.id IS NULL`,
    queryValues
  ) as [PlatformAllocationLedgerRow[], unknown]

  for (const allocation of rows) {
    await executor.query(
      `INSERT INTO platform_sale_allocations (
        id, source_type, source_id, checkout_session_id, empresa_id, flow, currency,
        owner_fee_amount, allocated_amount, allocation_percentage,
        entry_kind, reversal_for_allocation_id, reversal_reason, reversal_reference_type, reversal_reference_id,
        configured_platform_admin_user_id, effective_platform_admin_user_id, fallback_reason
      ) VALUES (?, ?::"PlatformSaleAllocSourceTypeEnum", ?, ?, ?, ?::"PlatformFlowEnum", ?, ?, ?, ?, ?::"PlatformSaleAllocEntryKindEnum", ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT DO NOTHING`,
      [
        uuidv4(),
        allocation.source_type,
        allocation.source_id,
        allocation.checkout_session_id,
        allocation.empresa_id,
        allocation.flow,
        allocation.currency,
        roundMoney(-Number(allocation.owner_fee_amount ?? 0)),
        roundMoney(-Number(allocation.allocated_amount ?? 0)),
        Number(allocation.allocation_percentage ?? 0),
        'reversal',
        allocation.id,
        params.reason,
        params.referenceType,
        params.referenceId,
        allocation.configured_platform_admin_user_id,
        allocation.effective_platform_admin_user_id,
        allocation.fallback_reason,
      ]
    )
  }

  const reversedSourceIds = new Set(rows.map((row) => row.source_id))
  return {
    created: rows.length,
    skipped: normalizedSourceIds.filter((sourceId) => !reversedSourceIds.has(sourceId)).length,
  }
}

export async function reversePlatformAllocationsProportionally(
  params: {
    sourceType: 'entrada' | 'consumible_venta'
    sourceId: string
    refundAmount: number
    sourceAmount: number
    reason: string
    referenceType: string
    referenceId: string
    empresaId?: string
  },
  executor?: QueryExecutor
) {
  const normalizedSourceId = params.sourceId.trim()
  if (!normalizedSourceId) return { created: 0, skipped: 1 }

  const normalizedSourceAmount = roundMoney(Number(params.sourceAmount ?? 0))
  const normalizedRefundAmount = roundMoney(Number(params.refundAmount ?? 0))
  if (normalizedSourceAmount <= 0 || normalizedRefundAmount <= 0) {
    return { created: 0, skipped: 1 }
  }

  const ratio = Math.min(1, normalizedRefundAmount / normalizedSourceAmount)

  // Prisma-native path
  if (!executor) {
    const empresaClause = params.empresaId
      ? Prisma.sql` AND alloc.empresa_id = ${params.empresaId}`
      : Prisma.empty
    type LedgerRaw = PlatformAllocationLedgerRow[]
    const rows = await prisma.$queryRaw<LedgerRaw>`
      SELECT alloc.id, alloc.source_type, alloc.source_id, alloc.checkout_session_id, alloc.empresa_id, alloc.flow,
             alloc.currency, alloc.owner_fee_amount, alloc.allocated_amount, alloc.allocation_percentage,
             alloc.entry_kind, alloc.reversal_for_allocation_id, alloc.reversal_reason,
             alloc.reversal_reference_type, alloc.reversal_reference_id,
             alloc.configured_platform_admin_user_id, alloc.effective_platform_admin_user_id, alloc.fallback_reason
      FROM platform_sale_allocations alloc
      LEFT JOIN platform_sale_allocations reversal
        ON reversal.reversal_for_allocation_id = alloc.id
       AND reversal.reversal_reference_type = ${params.referenceType}
       AND reversal.reversal_reference_id = ${params.referenceId}
      WHERE alloc.source_type = ${params.sourceType}::"PlatformSaleAllocSourceTypeEnum"
        AND alloc.source_id = ${normalizedSourceId}
        AND alloc.entry_kind = 'allocation'
        ${empresaClause}
        AND reversal.id IS NULL`

    for (const allocation of rows) {
      await prisma.platformSaleAllocation.create({
        data: {
          id: uuidv4(),
          source_type: allocation.source_type,
          source_id: allocation.source_id,
          checkout_session_id: allocation.checkout_session_id ?? null,
          empresa_id: allocation.empresa_id,
          flow: allocation.flow as 'entradas' | 'consumibles',
          currency: allocation.currency,
          owner_fee_amount: roundMoney(-Number(allocation.owner_fee_amount ?? 0) * ratio),
          allocated_amount: roundMoney(-Number(allocation.allocated_amount ?? 0) * ratio),
          allocation_percentage: Number(allocation.allocation_percentage ?? 0),
          entry_kind: 'reversal',
          reversal_for_allocation_id: allocation.id,
          reversal_reason: params.reason,
          reversal_reference_type: params.referenceType,
          reversal_reference_id: params.referenceId,
          configured_platform_admin_user_id: allocation.configured_platform_admin_user_id,
          effective_platform_admin_user_id: allocation.effective_platform_admin_user_id,
          fallback_reason: allocation.fallback_reason,
        },
      })
    }

    return {
      created: rows.length,
      skipped: rows.length === 0 ? 1 : 0,
    }
  }

  // Legacy mysql2 path (executor provided)
  const queryValues: unknown[] = [params.sourceType, normalizedSourceId]
  const empresaFilter = params.empresaId ? ' AND alloc.empresa_id = ?' : ''
  if (params.empresaId) queryValues.push(params.empresaId)
  queryValues.push(params.referenceType, params.referenceId)

  const [rows] = await executor.query(
    `SELECT alloc.id, alloc.source_type, alloc.source_id, alloc.checkout_session_id, alloc.empresa_id, alloc.flow,
            alloc.currency, alloc.owner_fee_amount, alloc.allocated_amount, alloc.allocation_percentage,
            alloc.entry_kind, alloc.reversal_for_allocation_id, alloc.reversal_reason,
            alloc.reversal_reference_type, alloc.reversal_reference_id,
            alloc.configured_platform_admin_user_id, alloc.effective_platform_admin_user_id, alloc.fallback_reason
     FROM platform_sale_allocations alloc
     LEFT JOIN platform_sale_allocations reversal
       ON reversal.reversal_for_allocation_id = alloc.id
      AND reversal.reversal_reference_type = ?
      AND reversal.reversal_reference_id = ?
     WHERE alloc.source_type = ?::"PlatformSaleAllocSourceTypeEnum"
       AND alloc.source_id = ?
       AND alloc.entry_kind = 'allocation'
       ${empresaFilter}
       AND reversal.id IS NULL`,
    [params.referenceType, params.referenceId, ...queryValues]
  ) as [PlatformAllocationLedgerRow[], unknown]

  for (const allocation of rows) {
    await executor.query(
      `INSERT INTO platform_sale_allocations (
        id, source_type, source_id, checkout_session_id, empresa_id, flow, currency,
        owner_fee_amount, allocated_amount, allocation_percentage,
        entry_kind, reversal_for_allocation_id, reversal_reason, reversal_reference_type, reversal_reference_id,
        configured_platform_admin_user_id, effective_platform_admin_user_id, fallback_reason
      ) VALUES (?, ?::"PlatformSaleAllocSourceTypeEnum", ?, ?, ?, ?::"PlatformFlowEnum", ?, ?, ?, ?, ?::"PlatformSaleAllocEntryKindEnum", ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuidv4(),
        allocation.source_type,
        allocation.source_id,
        allocation.checkout_session_id,
        allocation.empresa_id,
        allocation.flow,
        allocation.currency,
        roundMoney(-Number(allocation.owner_fee_amount ?? 0) * ratio),
        roundMoney(-Number(allocation.allocated_amount ?? 0) * ratio),
        Number(allocation.allocation_percentage ?? 0),
        'reversal',
        allocation.id,
        params.reason,
        params.referenceType,
        params.referenceId,
        allocation.configured_platform_admin_user_id,
        allocation.effective_platform_admin_user_id,
        allocation.fallback_reason,
      ]
    )
  }

  return {
    created: rows.length,
    skipped: rows.length === 0 ? 1 : 0,
  }
}

export async function getPlatformProfitSharingOverview(viewerUserIds?: string | string[] | null) {
  const configuredUserIds = normalizeConfiguredUserIds(viewerUserIds)

  // Build raw admin rows via Prisma (active only, superadmin first)
  const adminPrismaRows = await prisma.platformAdminUser.findMany({
    where: { activo: true },
    select: { id: true, nombre: true, role_slug: true, singleton_key: true, activo: true, permisos: true },
    orderBy: [{ singleton_key: 'asc' }, { nombre: 'asc' }],
  })
  // Sort: superadmin first
  adminPrismaRows.sort((a, b) => {
    const aIsSuper = a.singleton_key === 'superadmin' ? 0 : 1
    const bIsSuper = b.singleton_key === 'superadmin' ? 0 : 1
    return aIsSuper - bIsSuper || a.nombre.localeCompare(b.nombre)
  })
  const adminRowsData: PlatformAdminRow[] = adminPrismaRows.map((row) => ({
    id: row.id,
    nombre: row.nombre,
    role_slug: row.role_slug ?? null,
    singleton_key: row.singleton_key ?? null,
    activo: row.activo ? 1 : 0,
    permisos: row.permisos ?? null,
  } as PlatformAdminRow))

  // Cutoff: MIN(created_at) of allocations
  type CutoffRaw = { starts_at: Date | null }[]
  const cutoffRaw = await prisma.$queryRaw<CutoffRaw>`
    SELECT MIN(created_at) as starts_at FROM platform_sale_allocations WHERE entry_kind = 'allocation'`

  // Aggregate by user + flow
  type AggRaw = { configured_platform_admin_user_id: string; flow: string; total: unknown; fallback_total: unknown }[]
  const aggregateRaw = configuredUserIds.length > 0
    ? await prisma.$queryRaw<AggRaw>`
        SELECT configured_platform_admin_user_id, flow,
               COALESCE(SUM(allocated_amount), 0) as total,
               COALESCE(SUM(CASE WHEN fallback_reason != 'none' THEN allocated_amount ELSE 0 END), 0) as fallback_total
        FROM platform_sale_allocations
        WHERE configured_platform_admin_user_id = ANY(${configuredUserIds})
        GROUP BY configured_platform_admin_user_id, flow`
    : await prisma.$queryRaw<AggRaw>`
        SELECT configured_platform_admin_user_id, flow,
               COALESCE(SUM(allocated_amount), 0) as total,
               COALESCE(SUM(CASE WHEN fallback_reason != 'none' THEN allocated_amount ELSE 0 END), 0) as fallback_total
        FROM platform_sale_allocations
        GROUP BY configured_platform_admin_user_id, flow`

  // Flow totals
  type FlowTotalRaw = { flow: string; total: unknown }[]
  const flowTotalsRaw = configuredUserIds.length > 0
    ? await prisma.$queryRaw<FlowTotalRaw>`
        SELECT flow, COALESCE(SUM(allocated_amount), 0) as total
        FROM platform_sale_allocations
        WHERE configured_platform_admin_user_id = ANY(${configuredUserIds})
        GROUP BY flow`
    : await prisma.$queryRaw<FlowTotalRaw>`
        SELECT flow, COALESCE(SUM(allocated_amount), 0) as total
        FROM platform_sale_allocations
        GROUP BY flow`

  const distributionByFlow = await Promise.all(PLATFORM_REVENUE_FLOWS.map((flow) => computeRevenueDistribution(flow)))

  const retainedByFlow = new Map<PlatformRevenueFlow, Map<string, number>>()
  const issues = distributionByFlow.flatMap((distribution) => distribution.issues)
  const users = adminRowsData.map<PlatformAllocationUserSummary>((row) => {
    const userId = String(row.id)
    return {
      userId,
      nombre: String(row.nombre),
      roleSlug: String(row.role_slug === 'superadmin' ? 'superadmin' : 'staff'),
      isSingletonSuperadmin: String(row.singleton_key ?? '') === 'superadmin',
      permissions: parsePlatformPermissions(row.permisos),
      configuredShareByFlow: { entradas: 0, consumibles: 0 },
      effectiveRevenueByFlow: { entradas: 0, consumibles: 0 },
      fallbackRevenueByFlow: { entradas: 0, consumibles: 0 },
    }
  })
  const userMap = new Map(users.map((user) => [user.userId, user]))

  distributionByFlow.forEach((distribution, index) => {
    const flow = PLATFORM_REVENUE_FLOWS[index]
    retainedByFlow.set(flow, distribution.retainedShareByUserId)
    for (const [userId, retained] of distribution.retainedShareByUserId.entries()) {
      const user = userMap.get(userId)
      if (!user) continue
      user.configuredShareByFlow[flow] = roundMoney(retained)
    }
  })

  for (const row of aggregateRaw) {
    const user = userMap.get(String(row.configured_platform_admin_user_id))
    if (!user) continue
    user.effectiveRevenueByFlow[row.flow as PlatformRevenueFlow] = roundMoney(user.effectiveRevenueByFlow[row.flow as PlatformRevenueFlow] + Number(row.total ?? 0))
    user.fallbackRevenueByFlow[row.flow as PlatformRevenueFlow] = roundMoney(user.fallbackRevenueByFlow[row.flow as PlatformRevenueFlow] + Number(row.fallback_total ?? 0))
  }

  const totalsByFlow = PLATFORM_REVENUE_FLOWS.reduce<Record<PlatformRevenueFlow, {
    ownerFeeTotal: number
    assignedPercentage: number
    remainderPercentage: number
    overflowPercentage: number
    isOverallocated: boolean
  }>>((acc, flow) => {
    acc[flow] = { ownerFeeTotal: 0, assignedPercentage: 0, remainderPercentage: 0, overflowPercentage: 0, isOverallocated: false }
    return acc
  }, {} as Record<PlatformRevenueFlow, {
    ownerFeeTotal: number
    assignedPercentage: number
    remainderPercentage: number
    overflowPercentage: number
    isOverallocated: boolean
  }>)

  distributionByFlow.forEach((distribution, index) => {
    const flow = PLATFORM_REVENUE_FLOWS[index]
    const rootRetained = distribution.retainedShareByUserId.get(distribution.rootUserId) ?? 0
    const delegated = roundMoney(100 - rootRetained)
    const issue = distribution.issues[0]
    totalsByFlow[flow].assignedPercentage = delegated
    totalsByFlow[flow].remainderPercentage = rootRetained
    totalsByFlow[flow].overflowPercentage = issue?.overflowPercentage ?? 0
    totalsByFlow[flow].isOverallocated = Boolean(issue)
  })

  for (const row of flowTotalsRaw) {
    if (row.flow in totalsByFlow) {
      totalsByFlow[row.flow as PlatformRevenueFlow].ownerFeeTotal = roundMoney(Number(row.total ?? 0))
    }
  }

  return {
    cutoff: {
      startsAt: cutoffRaw[0]?.starts_at ? new Date(cutoffRaw[0].starts_at).toISOString() : null,
      source: 'first_allocation',
    },
    integrity: {
      hasInvalidShareTotals: issues.length > 0,
      issues,
    },
    totalsByFlow,
    users: configuredUserIds.length > 0 ? users.filter((user) => configuredUserIds.includes(user.userId)) : users,
  } satisfies PlatformProfitSharingOverview
}

export async function getPlatformAllocationSeries(viewerUserIds?: string | string[] | null) {
  const configuredUserIds = normalizeConfiguredUserIds(viewerUserIds)
  type SeriesRaw = { dia: Date | string; total: unknown }[]
  const rows = configuredUserIds.length > 0
    ? await prisma.$queryRaw<SeriesRaw>`
        SELECT DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') as dia, COALESCE(SUM(allocated_amount), 0) as total
        FROM platform_sale_allocations
        WHERE configured_platform_admin_user_id = ANY(${configuredUserIds})
        GROUP BY DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')
        ORDER BY dia ASC`
    : await prisma.$queryRaw<SeriesRaw>`
        SELECT DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') as dia, COALESCE(SUM(allocated_amount), 0) as total
        FROM platform_sale_allocations
        GROUP BY DATE(created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')
        ORDER BY dia ASC`

  return rows.map((row) => ({ dia: (row.dia instanceof Date ? row.dia.toISOString() : String(row.dia)).slice(0, 10), total: roundMoney(Number(row.total ?? 0)) }))
}

export async function getPlatformAllocationMetricsByFlow(viewerUserIds?: string | string[] | null) {
  const configuredUserIds = normalizeConfiguredUserIds(viewerUserIds)
  type MetricsRaw = { flow: string; total: unknown; sales_count: unknown }[]
  const rows = configuredUserIds.length > 0
    ? await prisma.$queryRaw<MetricsRaw>`
        SELECT flow,
               COALESCE(SUM(source_total), 0) as total,
               COALESCE(SUM(CASE WHEN source_total > 0 THEN 1 ELSE 0 END), 0) as sales_count
        FROM (
           SELECT flow, source_type, source_id, COALESCE(SUM(allocated_amount), 0) as source_total
           FROM platform_sale_allocations
           WHERE configured_platform_admin_user_id = ANY(${configuredUserIds})
           GROUP BY flow, source_type, source_id
        ) grouped
        GROUP BY flow`
    : await prisma.$queryRaw<MetricsRaw>`
        SELECT flow,
               COALESCE(SUM(source_total), 0) as total,
               COALESCE(SUM(CASE WHEN source_total > 0 THEN 1 ELSE 0 END), 0) as sales_count
        FROM (
           SELECT flow, source_type, source_id, COALESCE(SUM(allocated_amount), 0) as source_total
           FROM platform_sale_allocations
           GROUP BY flow, source_type, source_id
        ) grouped
        GROUP BY flow`

  const base = {
    entradas: { ventasTotales: 0, volumenBruto: 0, gananciasOwner: 0 },
    consumibles: { ventasTotales: 0, volumenBruto: 0, gananciasOwner: 0 },
  }

  for (const row of rows) {
    const flow = row.flow as PlatformRevenueFlow
    if (flow in base) {
      base[flow] = {
        ventasTotales: Number(row.sales_count ?? 0),
        volumenBruto: roundMoney(Number(row.total ?? 0)),
        gananciasOwner: roundMoney(Number(row.total ?? 0)),
      }
    }
  }

  return base
}

// ============================================================
// Empresa-level commission overrides
// ============================================================
//
// Lets each platform_admin_user have a per-empresa percentage that REPLACES
// their global retained share for that empresa+flow. Used to model:
//   * Team member with 10% on all empresas (no override needed)
//   * Team member with X% only on the empresas they brought in (global=0 + overrides)
//   * Customer with 6% global and 12% on specific empresas (override REPLACES, not adds)
//
// Writes are gated by the same advisory lock as platform_admin_user_flow_shares
// (key 9002) — a single empresa override edit must not race against a global share
// edit, since both feed into the same allocation math.

export type PlatformEmpresaOverrideRow = {
  id: string
  platformAdminUserId: string
  empresaId: string
  flow: PlatformRevenueFlow
  percentage: number
  configuredByPlatformAdminId: string | null
  createdAt: string
  updatedAt: string
}

function mapEmpresaOverrideRow(row: {
  id: string
  platform_admin_user_id: string
  empresa_id: string
  flow: PlatformRevenueFlow | string
  percentage: Prisma.Decimal | number | string
  configured_by_platform_admin_id: string | null
  created_at: Date
  updated_at: Date
}): PlatformEmpresaOverrideRow {
  return {
    id: row.id,
    platformAdminUserId: row.platform_admin_user_id,
    empresaId: row.empresa_id,
    flow: row.flow as PlatformRevenueFlow,
    percentage: roundMoney(Number(row.percentage ?? 0)),
    configuredByPlatformAdminId: row.configured_by_platform_admin_id ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  }
}

export async function listEmpresaOverridesByEmpresa(empresaId: string) {
  const rows = await prisma.platformAdminUserEmpresaOverride.findMany({
    where: { empresa_id: empresaId },
    orderBy: [{ platform_admin_user_id: 'asc' }, { flow: 'asc' }],
  })
  return rows.map(mapEmpresaOverrideRow)
}

export async function listEmpresaOverridesByUser(platformAdminUserId: string) {
  const rows = await prisma.platformAdminUserEmpresaOverride.findMany({
    where: { platform_admin_user_id: platformAdminUserId },
    orderBy: [{ empresa_id: 'asc' }, { flow: 'asc' }],
  })
  return rows.map(mapEmpresaOverrideRow)
}

export async function upsertEmpresaOverride(params: {
  platformAdminUserId: string
  empresaId: string
  flow: PlatformRevenueFlow
  percentage: number
  configuredByPlatformAdminId?: string | null
}) {
  const normalizedPercentage = normalizeSharePercentage(Number(params.percentage), params.flow)

  return runLockedShareMutation([params.flow], async () => {
    const row = await prisma.platformAdminUserEmpresaOverride.upsert({
      where: {
        platform_admin_user_id_empresa_id_flow: {
          platform_admin_user_id: params.platformAdminUserId,
          empresa_id: params.empresaId,
          flow: params.flow,
        },
      },
      create: {
        id: uuidv4(),
        platform_admin_user_id: params.platformAdminUserId,
        empresa_id: params.empresaId,
        flow: params.flow,
        percentage: normalizedPercentage,
        configured_by_platform_admin_id: params.configuredByPlatformAdminId ?? null,
      },
      update: {
        percentage: normalizedPercentage,
        configured_by_platform_admin_id: params.configuredByPlatformAdminId ?? null,
      },
    })
    return mapEmpresaOverrideRow(row)
  })
}

export async function deleteEmpresaOverride(params: {
  platformAdminUserId: string
  empresaId: string
  flow: PlatformRevenueFlow
}) {
  return runLockedShareMutation([params.flow], async () => {
    await prisma.platformAdminUserEmpresaOverride.deleteMany({
      where: {
        platform_admin_user_id: params.platformAdminUserId,
        empresa_id: params.empresaId,
        flow: params.flow,
      },
    })
  })
}

export async function deleteAllEmpresaOverridesForEmpresa(empresaId: string) {
  return runLockedShareMutation(PLATFORM_REVENUE_FLOWS, async () => {
    await prisma.platformAdminUserEmpresaOverride.deleteMany({
      where: { empresa_id: empresaId },
    })
  })
}

export async function deleteAllEmpresaOverridesForUser(platformAdminUserId: string) {
  return runLockedShareMutation(PLATFORM_REVENUE_FLOWS, async () => {
    await prisma.platformAdminUserEmpresaOverride.deleteMany({
      where: { platform_admin_user_id: platformAdminUserId },
    })
  })
}
