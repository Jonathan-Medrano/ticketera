import bcrypt from 'bcryptjs'
import { randomUUID as uuidv4 } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma, prismaDirectUrl } from './prisma'
import { roundMoney } from './money'
import { assertInternalEmailAvailable } from './internal-email'
import { buildPasswordPolicyError, validatePasswordPolicy } from './password-policy'
import type { PlatformStaffRoleSlug } from '../types'
import {
  deletePlatformUserShares,
  getPlatformUserShareMap,
  normalizePlatformPermissions,
  parsePlatformPermissions,
  PLATFORM_REVENUE_FLOWS,
  serializePlatformPermissions,
  type PlatformDirectPermissions,
  type PlatformPermissionKey,
  type PlatformRevenueFlow,
  type PlatformUserShareByFlow,
  upsertPlatformUserShares,
} from './platform-profit-sharing'
import { disconnectPlatformPaymentAccountWithExecutor, getPlatformPaymentAccountReadModel } from './platform-payment-accounts'

/**
 * Advisory lock key for platform-governance write operations.
 * Prevents concurrent createPlatformUser / updatePlatformUser / deletePlatformUser.
 * Key registry:
 *   8823 → checkoutCleanup
 *   7701 → marketing carrito abandonado
 *   4242 → delivery retry
 *   9001 → platform-governance share mutations  ← this file
 */
const PLATFORM_GOVERNANCE_LOCK_KEY = 9001n



type PlatformAdminUserRow = {
  id: string
  nombre: string
  email: string
  login_alias: string
  password: string
  role_slug: string | null
  permisos: string | null
  singleton_key: string | null
  activo: number
  created_at: string | Date
  updated_at: string | Date
}

type PlatformRoleDefinition = {
  slug: PlatformStaffRoleSlug
  nombre: string
  descripcion: string
  singleton: boolean
  editable: boolean
}

type PlatformAdminRelationshipRow = {
  platform_admin_user_id: string
  parent_platform_admin_user_id: string | null
  branch_root_platform_admin_user_id: string
  depth_from_root: number
}

type PlatformAdminCapabilityGrantRow = {
  capability_key: string
}

type PlatformAdminRevenueGrantRow = {
  parent_platform_admin_user_id: string
  child_platform_admin_user_id: string
  flow: PlatformRevenueFlow
  percentage: number | string
}

type PlatformAdminClosureRow = {
  ancestor_platform_admin_user_id: string
  descendant_platform_admin_user_id: string
  depth: number
  nombre: string
  role_slug: string | null
  singleton_key: string | null
  activo: number
}

export type PlatformCapabilityKey =
  | 'platform.users.read'
  | 'platform.users.write'
  | 'platform.users.capabilities.grant'
  | 'platform.revenue.view.own'
  | 'platform.revenue.view.branch'
  | 'platform.revenue.view.global'
  | 'platform.companies.read'
  | 'platform.settings.read'
  | 'platform.companies.overrides.edit'
  | 'platform.fees.defaults.edit'
  | 'platform.alerts.receive'

export type PlatformCapabilityCatalogEntry = {
  key: PlatformCapabilityKey
  domain: 'users' | 'revenue' | 'companies' | 'fees' | 'notifications'
  label: string
}

export type PlatformRevenueVisibilityScope = 'own' | 'branch' | 'global'

export type PlatformViewerPolicy = {
  actorUserId: string
  parentUserId: string | null
  branchRootUserId: string
  rootUserId: string
  roleLabel: string
  isRoot: boolean
  compatibilityMode: 'grants' | 'legacy_fallback'
  capabilities: PlatformCapabilityKey[]
  capabilityCeiling: PlatformCapabilityKey[]
  revenueVisibilityScope: PlatformRevenueVisibilityScope
}

export type PlatformBranchTreeNode = {
  userId: string
  parentUserId: string | null
  branchRootUserId: string
  nombre: string
  roleLabel: string
  depth: number
  activo: boolean
  children: PlatformBranchTreeNode[]
}

export const PLATFORM_CAPABILITY_CATALOG: PlatformCapabilityCatalogEntry[] = [
  { key: 'platform.users.read', domain: 'users', label: 'Ver módulo Usuarios' },
  { key: 'platform.users.write', domain: 'users', label: 'Crear y editar usuarios' },
  { key: 'platform.users.capabilities.grant', domain: 'users', label: 'Delegar capabilities' },
  { key: 'platform.revenue.view.own', domain: 'revenue', label: 'Ver revenue propio' },
  { key: 'platform.revenue.view.branch', domain: 'revenue', label: 'Ver revenue de rama' },
  { key: 'platform.revenue.view.global', domain: 'revenue', label: 'Ver revenue global' },
  { key: 'platform.companies.read', domain: 'companies', label: 'Ver módulo Empresas' },
  { key: 'platform.settings.read', domain: 'fees', label: 'Ver módulo Configuración' },
  { key: 'platform.companies.overrides.edit', domain: 'companies', label: 'Editar empresas' },
  { key: 'platform.fees.defaults.edit', domain: 'fees', label: 'Editar configuración global' },
  { key: 'platform.alerts.receive', domain: 'notifications', label: 'Recibir alertas de errores por email' },
]

export const ALL_PLATFORM_CAPABILITY_KEYS = PLATFORM_CAPABILITY_CATALOG.map((entry) => entry.key)

const LEGACY_PLATFORM_PERMISSION_CAPABILITY_MAP: Record<PlatformPermissionKey, PlatformCapabilityKey[]> = {
  platform_dashboard: ['platform.revenue.view.own'],
  platform_empresas: ['platform.companies.read'],
  platform_configuracion: ['platform.settings.read', 'platform.fees.defaults.edit', 'platform.companies.overrides.edit'],
  platform_usuarios: ['platform.users.read', 'platform.users.write', 'platform.users.capabilities.grant'],
}

export type PlatformUserReadModel = {
  id: string
  nombre: string
  email: string
  loginAlias: string
  roleSlug: PlatformStaffRoleSlug
  roleLabel: string
  permisos: PlatformDirectPermissions
  capabilities: PlatformCapabilityKey[]
  activo: boolean
  isSingletonSuperadmin: boolean
  parentUserId: string | null
  branchRootUserId: string
  paymentAccount: Awaited<ReturnType<typeof getPlatformPaymentAccountReadModel>>
  shareByFlow: PlatformUserShareByFlow
  revenueGrants: PlatformUserShareByFlow
  createdAt: string
  updatedAt: string
}

export type PlatformUserUpsertInput = {
  nombre?: string
  email?: string
  loginAlias?: string
  password?: string
  temporaryPassword?: boolean
  roleSlug?: string
  roleLabel?: string
  parentUserId?: string | null
  branchRootUserId?: string
  capabilities?: unknown
  permisos?: unknown
  revenueGrants?: Partial<Record<'entradas' | 'consumibles', number>>
  shareByFlow?: Partial<Record<'entradas' | 'consumibles', number>>
  activo?: boolean
}

type PlatformGovernanceActorOptions = {
  actorUserId?: string | null
}

type PlatformGovernanceContext = {
  viewerPolicy: PlatformViewerPolicy
  manageableUserIds: Set<string>
  branchUserIds: Set<string>
}

type PlatformTargetAssignment = {
  parentUserId: string | null
  branchRootUserId: string
}

export class PlatformGovernanceError extends Error {
  code: string
  statusCode: number
  payload?: Record<string, unknown>

  constructor(message: string, code: string, statusCode: number, payload?: Record<string, unknown>) {
    super(message)
    this.name = 'PlatformGovernanceError'
    this.code = code
    this.statusCode = statusCode
    this.payload = payload
  }
}

function assertPlatformPasswordPolicy(password: string) {
  const validation = validatePasswordPolicy(password)
  if (validation.ok) return

  const payload = buildPasswordPolicyError(validation.reason)
  throw new PlatformGovernanceError(payload.error, payload.code, 400, payload)
}

const PLATFORM_SUPERADMIN_SINGLETON_KEY = 'superadmin'

const PLATFORM_ROLE_DEFINITIONS: PlatformRoleDefinition[] = [
  {
    slug: 'superadmin',
    nombre: 'Superadmin',
    descripcion: 'Cuenta singleton con control total de la plataforma.',
    singleton: true,
    editable: false,
  },
  {
    slug: 'staff',
    nombre: 'Staff platform',
    descripcion: 'Usuario platform gestionado por capabilities, jerarquía y revenue grants.',
    singleton: false,
    editable: true,
  },
]

function normalizeText(value: string | undefined, field: string) {
  const normalized = value?.trim() ?? ''
  if (!normalized) {
    throw new PlatformGovernanceError(`El campo ${field} es obligatorio`, `platform_${field}_required`, 400)
  }

  return normalized
}

function normalizeOptionalEmail(value: string | undefined) {
  return value?.trim().toLowerCase() ?? ''
}

function parseRoleSlug(raw: string | null | undefined): PlatformStaffRoleSlug {
  if (raw === 'superadmin') return 'superadmin'
  if (raw === 'empleado' || raw === 'socio' || raw === 'staff') return 'staff'
  return 'staff'
}

function toStorageRoleSlug(roleSlug: PlatformStaffRoleSlug) {
  return roleSlug === 'superadmin' ? 'superadmin' : 'empleado'
}

function formatPlatformRoleLabel(roleSlug: PlatformStaffRoleSlug) {
  return roleSlug === 'superadmin' ? 'Superadmin' : 'Staff platform'
}

function normalizeRoleSlug(raw: string | undefined): PlatformStaffRoleSlug {
  if (raw === 'superadmin') return 'superadmin'
  if (raw === 'staff' || raw === 'empleado' || raw === 'socio') return 'staff'

  throw new PlatformGovernanceError('El rol platform es inválido', 'platform_role_invalid', 400)
}

export const PLATFORM_PERMISSION_KEYS: PlatformPermissionKey[] = ['platform_dashboard', 'platform_empresas', 'platform_configuracion', 'platform_usuarios']

function dedupeCapabilities(capabilities: Iterable<PlatformCapabilityKey>) {
  return [...new Set(capabilities)].sort() as PlatformCapabilityKey[]
}

function isPlatformCapabilityKey(value: string): value is PlatformCapabilityKey {
  return ALL_PLATFORM_CAPABILITY_KEYS.includes(value as PlatformCapabilityKey)
}

export function getPlatformCapabilitiesFromLegacyPermissions(permisos: unknown, isRoot = false) {
  if (isRoot) return [...ALL_PLATFORM_CAPABILITY_KEYS]

  const normalizedPermisos = typeof permisos === 'string'
    ? parsePlatformPermissions(permisos)
    : normalizePlatformPermissions(permisos)
  const capabilities: PlatformCapabilityKey[] = []

  for (const permission of PLATFORM_PERMISSION_KEYS) {
    if (!normalizedPermisos[permission]) continue
    capabilities.push(...LEGACY_PLATFORM_PERMISSION_CAPABILITY_MAP[permission])
  }

  return dedupeCapabilities(capabilities)
}

export function mapCapabilitiesToLegacyPlatformPermissions(capabilities: PlatformCapabilityKey[]): PlatformDirectPermissions {
  const capabilitySet = new Set(capabilities)

  return {
    platform_dashboard: capabilitySet.has('platform.revenue.view.own') || capabilitySet.has('platform.revenue.view.branch') || capabilitySet.has('platform.revenue.view.global'),
    platform_empresas: capabilitySet.has('platform.companies.read'),
    platform_configuracion: capabilitySet.has('platform.settings.read') || capabilitySet.has('platform.fees.defaults.edit') || capabilitySet.has('platform.companies.overrides.edit'),
    platform_usuarios: capabilitySet.has('platform.users.read') || capabilitySet.has('platform.users.write') || capabilitySet.has('platform.users.capabilities.grant'),
  }
}

const PLATFORM_CAPABILITY_DEPENDENCIES: Partial<Record<PlatformCapabilityKey, PlatformCapabilityKey[]>> = {
  'platform.users.write': ['platform.users.read'],
  'platform.users.capabilities.grant': ['platform.users.read'],
  'platform.companies.overrides.edit': ['platform.companies.read'],
  'platform.fees.defaults.edit': ['platform.settings.read'],
  'platform.revenue.view.branch': ['platform.revenue.view.own'],
  'platform.revenue.view.global': ['platform.revenue.view.own'],
}

function normalizeCapabilityDependencies(requestedCapabilities: PlatformCapabilityKey[]) {
  const resolved = new Set(requestedCapabilities)
  const queue = [...requestedCapabilities]

  while (queue.length > 0) {
    const current = queue.shift()!
    for (const dependency of PLATFORM_CAPABILITY_DEPENDENCIES[current] ?? []) {
      if (resolved.has(dependency)) continue
      resolved.add(dependency)
      queue.push(dependency)
    }
  }

  return dedupeCapabilities(resolved)
}

export function getRequiredCapabilitiesForLegacyPermission(permission: PlatformPermissionKey): PlatformCapabilityKey[] {
  return [...LEGACY_PLATFORM_PERMISSION_CAPABILITY_MAP[permission]]
}

export function assertPlatformCapabilitiesWithinCeiling(actorCapabilities: PlatformCapabilityKey[], requestedCapabilities: unknown) {
  const requested = Array.isArray(requestedCapabilities)
    ? dedupeCapabilities(requestedCapabilities.filter((value): value is PlatformCapabilityKey => typeof value === 'string' && isPlatformCapabilityKey(value)))
    : []
  const normalizedRequested = normalizeCapabilityDependencies(requested)
  const actorCapabilitySet = new Set(actorCapabilities)
  const missing = normalizedRequested.filter((capability) => !actorCapabilitySet.has(capability))

  if (missing.length > 0) {
    throw new PlatformGovernanceError(
      `No podés delegar capacidades fuera de tu ceiling (${missing.join(', ')})`,
      'platform_capability_escalation',
      403,
    )
  }

  return normalizedRequested
}

function getRevenueVisibilityScope(capabilities: PlatformCapabilityKey[]) {
  if (capabilities.includes('platform.revenue.view.global')) return 'global'
  if (capabilities.includes('platform.revenue.view.branch')) return 'branch'
  return 'own'
}

function getDefaultBranchRootUserId(userId: string, isRoot: boolean) {
  return isRoot ? userId : userId
}

export function getPlatformCapabilityCatalog() {
  return [...PLATFORM_CAPABILITY_CATALOG]
}

function normalizeOptionalUserId(value: string | null | undefined) {
  const normalized = value?.trim() ?? ''
  return normalized ? normalized : null
}

function normalizePlatformRevenueGrants(input: Partial<Record<'entradas' | 'consumibles', number>> | undefined) {
  return {
    entradas: Number(input?.entradas ?? 0),
    consumibles: Number(input?.consumibles ?? 0),
  } satisfies PlatformUserShareByFlow
}

function getRequestedCapabilities(input: PlatformUserUpsertInput, fallbackPermisos: unknown, isRoot: boolean) {
  if (input.capabilities !== undefined) {
    return Array.isArray(input.capabilities)
      ? dedupeCapabilities(input.capabilities.filter((value): value is PlatformCapabilityKey => typeof value === 'string' && isPlatformCapabilityKey(value)))
      : []
  }

  return getPlatformCapabilitiesFromLegacyPermissions(fallbackPermisos, isRoot)
}

function toIso(value: string | Date) {
  return new Date(value).toISOString()
}

function isDuplicateKeyError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002'
}

async function mapRowToUser(row: PlatformAdminUserRow, shareMap?: Map<string, PlatformUserShareByFlow>): Promise<PlatformUserReadModel> {
  const roleSlug = parseRoleSlug(row.role_slug) ?? (row.singleton_key === PLATFORM_SUPERADMIN_SINGLETON_KEY ? 'superadmin' : 'staff')
  const isSingletonSuperadmin = roleSlug === 'superadmin' && row.singleton_key === PLATFORM_SUPERADMIN_SINGLETON_KEY
  const [paymentAccount, relationship, viewerPolicy, revenueGrantRows] = await Promise.all([
    getPlatformPaymentAccountReadModel(String(row.id)),
    getPlatformAdminRelationship(String(row.id)),
    resolvePlatformViewerPolicy(String(row.id)),
    getPlatformRevenueGrantRows(),
  ])
  const revenueGrants = normalizePlatformRevenueGrants(
    PLATFORM_REVENUE_FLOWS.reduce<Partial<Record<'entradas' | 'consumibles', number>>>((acc, flow) => {
      const grantRow = revenueGrantRows.find((rowGrant) => String(rowGrant.child_platform_admin_user_id) === String(row.id) && rowGrant.flow === flow)
      acc[flow] = Number(grantRow?.percentage ?? 0)
      return acc
    }, {})
  )

  return {
    id: String(row.id),
    nombre: String(row.nombre),
    email: String(row.email),
    loginAlias: String(row.login_alias),
    roleSlug,
    roleLabel: formatPlatformRoleLabel(roleSlug),
    permisos: parsePlatformPermissions(row.permisos),
    capabilities: viewerPolicy.capabilities,
    activo: Number(row.activo) === 1,
    isSingletonSuperadmin,
    parentUserId: relationship?.parent_platform_admin_user_id ? String(relationship.parent_platform_admin_user_id) : null,
    branchRootUserId: relationship?.branch_root_platform_admin_user_id ? String(relationship.branch_root_platform_admin_user_id) : String(row.id),
    paymentAccount,
    shareByFlow: isSingletonSuperadmin
      ? { entradas: 0, consumibles: 0 }
      : (shareMap?.get(String(row.id)) ?? { entradas: 0, consumibles: 0 }),
    revenueGrants,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }
}

async function getPlatformAdminUserRowById(userId: string) {
  const rows = await prisma.$queryRaw<PlatformAdminUserRow[]>`
    SELECT * FROM platform_admin_users WHERE id = ${userId} LIMIT 1
  `

  return rows[0] ?? null
}

async function assertPlatformUserExists(userId: string) {
  const row = await getPlatformAdminUserRowById(userId)
  if (!row) {
    throw new PlatformGovernanceError('Usuario platform no encontrado', 'platform_user_not_found', 404)
  }

  return row
}

async function ensureLoginAliasAvailable(loginAlias: string, excludeUserId?: string) {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM platform_admin_users WHERE LOWER(TRIM(login_alias)) = ${loginAlias.toLowerCase()} LIMIT 1
  `

  const existingId = rows[0] ? String(rows[0].id) : null
  if (existingId && existingId !== excludeUserId) {
    throw new PlatformGovernanceError('El alias de login ya está en uso', 'platform_login_alias_taken', 409)
  }
}

async function assertSingletonSuperadminAvailable(excludeUserId?: string) {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM platform_admin_users
    WHERE activo = true AND singleton_key = ${PLATFORM_SUPERADMIN_SINGLETON_KEY}
    ORDER BY created_at ASC, id ASC
  `

  const existingId = rows[0] ? String(rows[0].id) : null
  if (existingId && existingId !== excludeUserId) {
    throw new PlatformGovernanceError('Ya existe un superadmin activo', 'singleton_superadmin_exists', 409)
  }
}

async function assertSingletonSuperadminStillPresent(nextRoleSlug: PlatformStaffRoleSlug, nextActivo: boolean, currentRow: PlatformAdminUserRow) {
  const isCurrentSingleton = String(currentRow.singleton_key ?? '') === PLATFORM_SUPERADMIN_SINGLETON_KEY
  if (!isCurrentSingleton) return

  if (nextRoleSlug !== 'superadmin' || !nextActivo) {
    throw new PlatformGovernanceError('La plataforma debe conservar exactamente un superadmin activo', 'singleton_superadmin_required', 409)
  }
}

async function getRootPlatformAdminUserId(tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma
  const rows = await client.$queryRaw<{ id: string }[]>`
    SELECT id
    FROM platform_admin_users
    WHERE singleton_key = ${PLATFORM_SUPERADMIN_SINGLETON_KEY}
    ORDER BY created_at ASC, id ASC
    LIMIT 1
  `

  const rootUserId = rows[0]?.id ? String(rows[0].id) : null
  if (!rootUserId) {
    throw new PlatformGovernanceError('No existe root platform activo', 'platform_root_missing', 409)
  }

  return rootUserId
}

async function listCapabilityGrantRows(userId: string) {
  const rows = await prisma.$queryRaw<PlatformAdminCapabilityGrantRow[]>`
    SELECT capability_key
    FROM platform_admin_capability_grants
    WHERE platform_admin_user_id = ${userId}
    ORDER BY capability_key ASC
  `.catch(() => [] as PlatformAdminCapabilityGrantRow[])

  return rows.filter((row) => isPlatformCapabilityKey(String(row.capability_key ?? '')))
}

async function getPlatformAdminRelationship(userId: string) {
  const rows = await prisma.$queryRaw<PlatformAdminRelationshipRow[]>`
    SELECT platform_admin_user_id, parent_platform_admin_user_id, branch_root_platform_admin_user_id, depth_from_root
    FROM platform_admin_relationships
    WHERE platform_admin_user_id = ${userId}
    LIMIT 1
  `.catch(() => [] as PlatformAdminRelationshipRow[])

  return rows[0] ?? null
}

async function getPlatformClosureDepth(ancestorUserId: string, descendantUserId: string) {
  const rows = await prisma.$queryRaw<{ depth: number }[]>`
    SELECT depth
    FROM platform_admin_closure
    WHERE ancestor_platform_admin_user_id = ${ancestorUserId}
      AND descendant_platform_admin_user_id = ${descendantUserId}
    LIMIT 1
  `.catch(() => [] as { depth: number }[])

  return rows[0]?.depth === undefined ? null : Number(rows[0].depth)
}

async function getActiveDescendantCount(userId: string) {
  const rows = await prisma.$queryRaw<{ total: bigint | number }[]>`
    SELECT COUNT(*) AS total
    FROM platform_admin_closure c
    JOIN platform_admin_users u ON u.id = c.descendant_platform_admin_user_id
    WHERE c.ancestor_platform_admin_user_id = ${userId}
      AND c.depth > 0
      AND u.activo = true
  `

  return Number(rows[0]?.total ?? 0)
}

async function getPlatformRevenueGrantRows(flow?: PlatformRevenueFlow) {
  const rows = await (flow
    ? prisma.$queryRaw<PlatformAdminRevenueGrantRow[]>`
        SELECT parent_platform_admin_user_id, child_platform_admin_user_id, flow, percentage
        FROM platform_admin_revenue_grants
        WHERE flow = ${flow}
      `
    : prisma.$queryRaw<PlatformAdminRevenueGrantRow[]>`
        SELECT parent_platform_admin_user_id, child_platform_admin_user_id, flow, percentage
        FROM platform_admin_revenue_grants
      `
  ).catch(() => [] as PlatformAdminRevenueGrantRow[])

  return rows
}

async function assertRevenueGrantsWithinParentBag(params: {
  rootUserId: string
  parentUserId: string | null
  childUserId?: string
  revenueGrants: PlatformUserShareByFlow
}) {
  const parentUserId = params.parentUserId ?? params.rootUserId
  const revenueGrantRows = await getPlatformRevenueGrantRows()
  const childrenByParent = new Map<string, PlatformAdminRevenueGrantRow[]>()
  const grantByChildFlow = new Map<string, number>()

  for (const row of revenueGrantRows) {
    const parentId = String(row.parent_platform_admin_user_id)
    const childId = String(row.child_platform_admin_user_id)
    const key = `${childId}:${row.flow}`
    grantByChildFlow.set(key, Number(row.percentage ?? 0))
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), row])
  }

  const memo = new Map<string, number>()
  const computeEffectiveGrant = (userId: string, flow: PlatformRevenueFlow): number => {
    const key = `${userId}:${flow}`
    if (memo.has(key)) return memo.get(key)!
    if (userId === params.rootUserId) {
      memo.set(key, 100)
      return 100
    }

    const effective = Number(grantByChildFlow.get(key) ?? 0)
    memo.set(key, effective)
    return effective
  }

  for (const flow of PLATFORM_REVENUE_FLOWS) {
    const parentEffectiveGrant = computeEffectiveGrant(parentUserId, flow)
    const siblingGrants = (childrenByParent.get(parentUserId) ?? [])
      .filter((row) => row.flow === flow)
      .filter((row) => String(row.child_platform_admin_user_id) !== String(params.childUserId ?? ''))
      .reduce((acc, row) => acc + Number(row.percentage ?? 0), 0)
    const nextGrant = Number(params.revenueGrants[flow] ?? 0)

    if (roundMoney(siblingGrants + nextGrant) > roundMoney(parentEffectiveGrant)) {
      throw new PlatformGovernanceError(
        `No podés delegar más de ${parentEffectiveGrant}% en ${flow} desde ese padre`,
        'platform_revenue_grant_overflow',
        409,
      )
    }
  }
}

async function getGovernanceContextForActor(actorUserId: string): Promise<PlatformGovernanceContext> {
  const viewerPolicy = await resolvePlatformViewerPolicy(actorUserId)
  const branchTree = await getPlatformBranchTree(actorUserId)
  const branchUserIds = new Set(flattenBranchTree(branchTree))
  const manageableUserIds = new Set(
    viewerPolicy.isRoot
      ? Array.from(branchUserIds)
      : Array.from(branchUserIds).filter((userId) => userId !== actorUserId)
  )

  return {
    viewerPolicy,
    manageableUserIds,
    branchUserIds,
  }
}

async function assertActorCanReadUser(actorUserId: string, targetUserId: string) {
  const context = await getGovernanceContextForActor(actorUserId)
  if (context.viewerPolicy.isRoot || context.branchUserIds.has(targetUserId)) {
    return context
  }

  throw new PlatformGovernanceError('No podés leer usuarios fuera de tu rama', 'platform_branch_scope_denied', 403)
}

async function assertActorCanManageTarget(actorUserId: string, targetUserId: string) {
  const context = await getGovernanceContextForActor(actorUserId)
  if (context.viewerPolicy.isRoot) {
    return context
  }

  if (!context.manageableUserIds.has(targetUserId)) {
    throw new PlatformGovernanceError('No podés gestionar usuarios fuera de tus descendientes', 'platform_target_not_descendant', 403)
  }

  return context
}

async function resolveTargetAssignmentForCreate(params: {
  actorContext: PlatformGovernanceContext
  input: PlatformUserUpsertInput
  newUserId: string
}) {
  const actorContext = params.actorContext
  const requestedParentUserId = normalizeOptionalUserId(params.input.parentUserId)
  const parentUserId = actorContext.viewerPolicy.isRoot
    ? (requestedParentUserId ?? actorContext.viewerPolicy.actorUserId)
    : (requestedParentUserId ?? actorContext.viewerPolicy.actorUserId)

  if (!parentUserId) {
    return {
      parentUserId: null,
      branchRootUserId: params.newUserId,
    } satisfies PlatformTargetAssignment
  }

  if (!actorContext.viewerPolicy.isRoot && !actorContext.branchUserIds.has(parentUserId)) {
    throw new PlatformGovernanceError('No podés crear usuarios fuera de tu rama', 'platform_branch_scope_denied', 403)
  }

  const rootUserId = actorContext.viewerPolicy.rootUserId
  const parentRelationship = await getPlatformAdminRelationship(parentUserId)
  const branchRootUserId = parentUserId === rootUserId
    ? params.newUserId
    : String(parentRelationship?.branch_root_platform_admin_user_id ?? parentUserId)

  return {
    parentUserId,
    branchRootUserId,
  } satisfies PlatformTargetAssignment
}

async function resolveTargetAssignmentForUpdate(params: {
  actorContext: PlatformGovernanceContext
  targetUserId: string
  currentParentUserId: string | null
  input: PlatformUserUpsertInput
}) {
  const requestedParentUserId = params.input.parentUserId === undefined
    ? params.currentParentUserId
    : normalizeOptionalUserId(params.input.parentUserId)

  if (!requestedParentUserId) {
    return {
      parentUserId: null,
      branchRootUserId: params.targetUserId,
    } satisfies PlatformTargetAssignment
  }

  if (requestedParentUserId === params.targetUserId) {
    throw new PlatformGovernanceError('No podés hacer que un usuario sea padre de sí mismo', 'platform_parent_cycle', 409)
  }

  if (!params.actorContext.viewerPolicy.isRoot && !params.actorContext.branchUserIds.has(requestedParentUserId)) {
    throw new PlatformGovernanceError('No podés mover usuarios fuera de tu rama', 'platform_branch_scope_denied', 403)
  }

  const cycleDepth = await getPlatformClosureDepth(params.targetUserId, requestedParentUserId)
  if (cycleDepth !== null) {
    throw new PlatformGovernanceError('No podés crear ciclos en la jerarquía', 'platform_parent_cycle', 409)
  }

  const rootUserId = params.actorContext.viewerPolicy.rootUserId
  const parentRelationship = await getPlatformAdminRelationship(requestedParentUserId)

  return {
    parentUserId: requestedParentUserId,
    branchRootUserId: requestedParentUserId === rootUserId
      ? params.targetUserId
      : String(parentRelationship?.branch_root_platform_admin_user_id ?? requestedParentUserId),
  } satisfies PlatformTargetAssignment
}

function rebuildClosureRows(params: {
  userId: string
  parentUserId: string | null
  rootUserId: string
  ancestorChain: Array<{ ancestorUserId: string; depthToParent: number }>
}) {
  const rows: Array<{ ancestorUserId: string; descendantUserId: string; depth: number }> = [
    { ancestorUserId: params.userId, descendantUserId: params.userId, depth: 0 },
  ]

  for (const ancestor of params.ancestorChain) {
    rows.push({
      ancestorUserId: ancestor.ancestorUserId,
      descendantUserId: params.userId,
      depth: ancestor.depthToParent + 1,
    })
  }

  if (!params.parentUserId && params.userId !== params.rootUserId) {
    rows.push({ ancestorUserId: params.rootUserId, descendantUserId: params.userId, depth: 1 })
  }

  return rows
}

export async function resolvePlatformViewerPolicy(userId: string): Promise<PlatformViewerPolicy> {
  const row = await assertPlatformUserExists(userId)
  const isRoot = String(row.singleton_key ?? '') === PLATFORM_SUPERADMIN_SINGLETON_KEY
  const [relationship, grantRows, rootUserId] = await Promise.all([
    getPlatformAdminRelationship(userId),
    listCapabilityGrantRows(userId),
    getRootPlatformAdminUserId(),
  ])

  const grantedCapabilities = dedupeCapabilities(
    grantRows
      .map((grant) => String(grant.capability_key))
      .filter((capability): capability is PlatformCapabilityKey => isPlatformCapabilityKey(capability))
  )
  const fallbackCapabilities = getPlatformCapabilitiesFromLegacyPermissions(row.permisos, isRoot)
  const capabilities = grantedCapabilities.length > 0 ? grantedCapabilities : fallbackCapabilities

  return {
    actorUserId: String(row.id),
    parentUserId: relationship?.parent_platform_admin_user_id ? String(relationship.parent_platform_admin_user_id) : null,
    branchRootUserId: relationship?.branch_root_platform_admin_user_id
      ? String(relationship.branch_root_platform_admin_user_id)
      : getDefaultBranchRootUserId(String(row.id), isRoot),
    rootUserId,
    roleLabel: formatPlatformRoleLabel(parseRoleSlug(row.role_slug)),
    isRoot,
    compatibilityMode: grantedCapabilities.length > 0 ? 'grants' : 'legacy_fallback',
    capabilities,
    capabilityCeiling: capabilities,
    revenueVisibilityScope: getRevenueVisibilityScope(capabilities),
  }
}

export async function getPlatformBranchTree(viewerUserId: string) {
  const rows = await prisma.$queryRaw<PlatformAdminClosureRow[]>`
    SELECT c.ancestor_platform_admin_user_id,
           c.descendant_platform_admin_user_id,
           c.depth,
           u.nombre,
           u.role_slug,
           u.singleton_key,
           u.activo
    FROM platform_admin_closure c
    JOIN platform_admin_users u ON u.id = c.descendant_platform_admin_user_id
    WHERE c.ancestor_platform_admin_user_id = ${viewerUserId}
    ORDER BY c.depth ASC, u.nombre ASC, u.created_at ASC
  `.catch(() => [] as PlatformAdminClosureRow[])

  const relationships = await Promise.all(
    rows.map((row) => getPlatformAdminRelationship(String(row.descendant_platform_admin_user_id)))
  )
  const nodeMap = new Map<string, PlatformBranchTreeNode>()
  const rootNodes: PlatformBranchTreeNode[] = []

  rows.forEach((row, index) => {
    const userId = String(row.descendant_platform_admin_user_id)
    const relationship = relationships[index]
    const node: PlatformBranchTreeNode = {
      userId,
      parentUserId: relationship?.parent_platform_admin_user_id ? String(relationship.parent_platform_admin_user_id) : null,
      branchRootUserId: relationship?.branch_root_platform_admin_user_id ? String(relationship.branch_root_platform_admin_user_id) : userId,
      nombre: String(row.nombre),
      roleLabel: formatPlatformRoleLabel(parseRoleSlug(row.role_slug)),
      depth: Number(row.depth ?? 0),
      activo: Number(row.activo) === 1,
      children: [],
    }

    nodeMap.set(userId, node)
  })

  for (const node of nodeMap.values()) {
    if (node.parentUserId && node.parentUserId !== node.userId) {
      const parentNode = nodeMap.get(node.parentUserId)
      if (parentNode) {
        parentNode.children.push(node)
        continue
      }
    }

    rootNodes.push(node)
  }

  if (rootNodes.length > 0) return rootNodes

  const fallbackPolicy = await resolvePlatformViewerPolicy(viewerUserId)
  const fallbackRow = await assertPlatformUserExists(viewerUserId)

  return [{
    userId: viewerUserId,
    parentUserId: fallbackPolicy.parentUserId,
    branchRootUserId: fallbackPolicy.branchRootUserId,
    nombre: String(fallbackRow.nombre),
    roleLabel: formatPlatformRoleLabel(parseRoleSlug(fallbackRow.role_slug)),
    depth: 0,
    activo: Number(fallbackRow.activo) === 1,
    children: [],
  }]
}

function flattenBranchTree(nodes: PlatformBranchTreeNode[]): string[] {
  return nodes.flatMap((node) => [node.userId, ...flattenBranchTree(node.children)])
}

async function syncPlatformCapabilityGrants(params: {
  userId: string
  capabilities: PlatformCapabilityKey[]
  isRoot: boolean
  tx: Prisma.TransactionClient
}) {
  const capabilities = params.isRoot ? [...ALL_PLATFORM_CAPABILITY_KEYS] : dedupeCapabilities(params.capabilities)

  await params.tx.$executeRaw`
    DELETE FROM platform_admin_capability_grants WHERE platform_admin_user_id = ${params.userId}
  `

  for (const capability of capabilities) {
    const id = uuidv4()
    const grantedBy = params.isRoot ? params.userId : null
    const source = params.isRoot ? 'root_default' : 'legacy_permisos'
    await params.tx.$executeRaw`
      INSERT INTO platform_admin_capability_grants (
        id,
        platform_admin_user_id,
        capability_key,
        granted_by_platform_admin_user_id,
        source
      ) VALUES (${id}, ${params.userId}, ${capability}, ${grantedBy}, ${source})
    `
  }
}

async function syncPlatformRelationship(params: {
  userId: string
  parentUserId: string | null
  branchRootUserId: string
  roleSlug: PlatformStaffRoleSlug
  active: boolean
  tx: Prisma.TransactionClient
}) {
  const rootUserId = await getRootPlatformAdminUserId(params.tx)
  const isRoot = params.roleSlug === 'superadmin' && params.active
  const parentUserId = isRoot ? null : params.parentUserId
  const branchRootUserId = isRoot ? params.userId : params.branchRootUserId

  const ancestorRows = parentUserId
    ? await params.tx.$queryRaw<{ ancestor_platform_admin_user_id: string; depth: number }[]>`
        SELECT ancestor_platform_admin_user_id, depth
        FROM platform_admin_closure
        WHERE descendant_platform_admin_user_id = ${parentUserId}
        ORDER BY depth ASC
      `
    : [] as { ancestor_platform_admin_user_id: string; depth: number }[]
  const ancestorChain = parentUserId
    ? ancestorRows.map((row) => ({ ancestorUserId: String(row.ancestor_platform_admin_user_id), depthToParent: Number(row.depth ?? 0) }))
    : []
  const depthFromRoot = isRoot
    ? 0
    : (() => {
      const rootDepth = ancestorChain.find((row) => row.ancestorUserId === rootUserId)?.depthToParent
      return rootDepth === undefined ? 1 : rootDepth + 1
    })()

  if (isRoot) {
    await params.tx.$executeRaw`
      DELETE FROM platform_admin_closure
      WHERE descendant_platform_admin_user_id = ${params.userId}
    `
  } else {
    await params.tx.$executeRaw`
      DELETE FROM platform_admin_closure
      WHERE ancestor_platform_admin_user_id = ${params.userId}
        OR descendant_platform_admin_user_id = ${params.userId}
    `
  }
  await params.tx.$executeRaw`
    DELETE FROM platform_admin_relationships WHERE platform_admin_user_id = ${params.userId}
  `
  const source = isRoot ? 'singleton' : 'managed_hierarchy'
  await params.tx.$executeRaw`
    INSERT INTO platform_admin_relationships (
      platform_admin_user_id,
      parent_platform_admin_user_id,
      branch_root_platform_admin_user_id,
      depth_from_root,
      source
    ) VALUES (${params.userId}, ${parentUserId}, ${branchRootUserId}, ${depthFromRoot}, ${source})
  `
  const closureRows = rebuildClosureRows({
    userId: params.userId,
    parentUserId,
    rootUserId,
    ancestorChain,
  })
  for (const closureRow of closureRows) {
    await params.tx.$executeRaw`
      INSERT INTO platform_admin_closure (
        ancestor_platform_admin_user_id,
        descendant_platform_admin_user_id,
        depth
      ) VALUES (${closureRow.ancestorUserId}, ${closureRow.descendantUserId}, ${closureRow.depth})
    `
  }
}

async function syncPlatformRevenueGrant(params: {
  userId: string
  parentUserId: string | null
  roleSlug: PlatformStaffRoleSlug
  active: boolean
  revenueGrants?: Partial<Record<'entradas' | 'consumibles', number>>
  tx: Prisma.TransactionClient
}) {
  await params.tx.$executeRaw`
    DELETE FROM platform_admin_revenue_grants WHERE child_platform_admin_user_id = ${params.userId}
  `

  if (params.roleSlug === 'superadmin' && params.active) return

  const parentUserId = params.parentUserId ?? await getRootPlatformAdminUserId(params.tx)
  for (const flow of PLATFORM_REVENUE_FLOWS) {
    const id = uuidv4()
    const percentage = Number(params.revenueGrants?.[flow] ?? 0)
    await params.tx.$executeRaw`
      INSERT INTO platform_admin_revenue_grants (
        id,
        parent_platform_admin_user_id,
        child_platform_admin_user_id,
        flow,
        percentage,
        source
      -- La columna flow es de tipo PlatformFlowEnum: un parametro llega como
      -- text y Postgres NO castea implicitamente text -> enum en un INSERT
      -- (42804). Los literales como 'legacy_flat_share' si funcionan (son de
      -- tipo desconocido y se resuelven contra la columna); los parametros no.
      ) VALUES (${id}, ${parentUserId}, ${params.userId}, ${flow}::"PlatformFlowEnum", ${percentage}, 'legacy_flat_share')
    `
  }
}

export function listPlatformRoles() {
  return PLATFORM_ROLE_DEFINITIONS
}

export async function listPlatformUsers(options: { onlyUserId?: string; userIds?: string[] } = {}) {
  let rows: PlatformAdminUserRow[]

  if (options.onlyUserId) {
    rows = await prisma.$queryRaw<PlatformAdminUserRow[]>`
      SELECT *
      FROM platform_admin_users
      WHERE id = ${options.onlyUserId}
      ORDER BY (singleton_key = 'superadmin') DESC, activo DESC, nombre ASC, created_at ASC
    `
  } else if (options.userIds && options.userIds.length > 0) {
    rows = await prisma.$queryRaw<PlatformAdminUserRow[]>`
      SELECT *
      FROM platform_admin_users
      WHERE id = ANY(${options.userIds})
      ORDER BY (singleton_key = 'superadmin') DESC, activo DESC, nombre ASC, created_at ASC
    `
  } else {
    rows = await prisma.$queryRaw<PlatformAdminUserRow[]>`
      SELECT *
      FROM platform_admin_users
      ORDER BY (singleton_key = 'superadmin') DESC, activo DESC, nombre ASC, created_at ASC
    `
  }

  const shareMap = await getPlatformUserShareMap()
  return Promise.all(rows.map((row) => mapRowToUser(row, shareMap)))
}

export async function listPlatformUsersForViewer(viewerUserId: string) {
  const viewerPolicy = await resolvePlatformViewerPolicy(viewerUserId)
  const branchTree = await getPlatformBranchTree(viewerUserId)
  const allowedUserIds = viewerPolicy.isRoot ? undefined : flattenBranchTree(branchTree)
  const usuarios = await listPlatformUsers(
    viewerPolicy.isRoot ? {} : { userIds: allowedUserIds }
  )

  return {
    viewerPolicy,
    capabilityCatalog: getPlatformCapabilityCatalog(),
    branchTree,
    revenueVisibilityScope: viewerPolicy.revenueVisibilityScope,
    usuarios,
  }
}

export async function createPlatformUser(input: PlatformUserUpsertInput, options: PlatformGovernanceActorOptions = {}) {
  const nombre = normalizeText(input.nombre, 'nombre')
  const email = normalizeOptionalEmail(input.email)
  const loginAlias = normalizeText(input.loginAlias, 'loginAlias').toLowerCase()
  const password = normalizeText(input.password, 'password')
  const temporaryPassword = input.temporaryPassword === true
  const roleSlug = normalizeRoleSlug(input.roleSlug)
  const activo = input.activo ?? true
  const actorUserId = normalizeOptionalUserId(options.actorUserId) ?? await getRootPlatformAdminUserId()
  const actorContext = await getGovernanceContextForActor(actorUserId)
  const isRootCreation = roleSlug === 'superadmin' && activo
  const requestedCapabilities = getRequestedCapabilities(input, input.permisos, isRootCreation)
  const normalizedRevenueGrants = normalizePlatformRevenueGrants(input.revenueGrants ?? input.shareByFlow)

  if (temporaryPassword && roleSlug !== 'staff') {
    throw new PlatformGovernanceError('Solo el staff platform puede usar contraseña temporal', 'platform_temporary_password_forbidden', 400)
  }

  if (!temporaryPassword) {
    assertPlatformPasswordPolicy(password)
  }

  if (!email) {
    throw new PlatformGovernanceError('El campo email es obligatorio', 'platform_email_required', 400)
  }

  if (!actorContext.viewerPolicy.isRoot && isRootCreation) {
    throw new PlatformGovernanceError('No podés crear otro root platform', 'platform_root_creation_forbidden', 403)
  }

  if (!actorContext.viewerPolicy.capabilities.includes('platform.users.write') && !actorContext.viewerPolicy.isRoot) {
    throw new PlatformGovernanceError('No tenés capacidad para crear usuarios platform', 'platform_users_write_required', 403)
  }

  if ((input.capabilities !== undefined || input.permisos !== undefined) && !actorContext.viewerPolicy.isRoot) {
    if (!actorContext.viewerPolicy.capabilities.includes('platform.users.capabilities.grant')) {
      throw new PlatformGovernanceError('No tenés capacidad para delegar capacidades', 'platform_capabilities_grant_required', 403)
    }
    assertPlatformCapabilitiesWithinCeiling(actorContext.viewerPolicy.capabilities, requestedCapabilities)
  }

  await assertInternalEmailAvailable(email)
  await ensureLoginAliasAvailable(loginAlias)

  if (isRootCreation) {
    await assertSingletonSuperadminAvailable()
  }

  const passwordHash = await bcrypt.hash(password, 12)
  const singletonKey = roleSlug === 'superadmin' && activo ? PLATFORM_SUPERADMIN_SINGLETON_KEY : null
  const userId = uuidv4()
  const assignment = await resolveTargetAssignmentForCreate({
    actorContext,
    input,
    newUserId: userId,
  })
  await assertRevenueGrantsWithinParentBag({
    rootUserId: actorContext.viewerPolicy.rootUserId,
    parentUserId: assignment.parentUserId,
    childUserId: userId,
    revenueGrants: roleSlug === 'superadmin' ? { entradas: 0, consumibles: 0 } : normalizedRevenueGrants,
  })

  await prismaDirectUrl.$transaction(async (tx) => {
    // Advisory lock — released automatically on tx commit/rollback.
    // PLATFORM_GOVERNANCE_LOCK_KEY = 9001 (see top of file for full key registry)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PLATFORM_GOVERNANCE_LOCK_KEY})`

    const permisosJson = serializePlatformPermissions(mapCapabilitiesToLegacyPlatformPermissions(requestedCapabilities))
    const activoBool = Boolean(activo)
    const mustChangePassword = Boolean(temporaryPassword)
    const tempPasswordSetAt = temporaryPassword ? new Date() : null

    try {
      await tx.$executeRaw`
        INSERT INTO platform_admin_users (
          id,
          nombre,
          email,
          login_alias,
          password,
          role_slug,
          permisos,
          singleton_key,
          activo,
          must_change_password,
          temporary_password_set_at,
          -- platform_admin_users.updated_at es NOT NULL y NO tiene DEFAULT
          -- (a diferencia de created_at). Prisma lo completa solo en sus
          -- writes por el @updatedAt, pero este INSERT es SQL crudo: omitirlo
          -- hacia fallar la creacion de usuarios platform con 23502
          -- (violacion de NOT NULL) tanto en test como en PRODUCCION.
          updated_at
        ) VALUES (
          ${userId},
          ${nombre},
          ${email},
          ${loginAlias},
          ${passwordHash},
          ${toStorageRoleSlug(roleSlug)},
          ${permisosJson},
          ${singletonKey},
          ${activoBool},
          ${mustChangePassword},
          ${tempPasswordSetAt},
          NOW()
        )
      `
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new PlatformGovernanceError('No se pudo crear el usuario platform por conflicto de unicidad', 'platform_user_conflict', 409)
      }

      throw error
    }

    await syncPlatformRelationship({
      userId,
      parentUserId: assignment.parentUserId,
      branchRootUserId: assignment.branchRootUserId,
      roleSlug,
      active: activo,
      tx,
    })
    await syncPlatformCapabilityGrants({
      userId,
      capabilities: requestedCapabilities,
      isRoot: roleSlug === 'superadmin' && activo,
      tx,
    })
    await syncPlatformRevenueGrant({
      userId,
      parentUserId: assignment.parentUserId,
      roleSlug,
      active: activo,
      revenueGrants: roleSlug === 'superadmin' ? { entradas: 0, consumibles: 0 } : normalizedRevenueGrants,
      tx,
    })
  }, { timeout: 30000 })

  // Prisma-native share upsert — runs after the advisory-locked tx commits
  await upsertPlatformUserShares({
    platformAdminUserId: userId,
    configuredByPlatformAdminId: actorUserId,
    sharesByFlow: roleSlug === 'superadmin' ? { entradas: 0, consumibles: 0 } : normalizedRevenueGrants,
  })

  const createdRow = await assertPlatformUserExists(userId)
  return mapRowToUser(createdRow, await getPlatformUserShareMap())
}

export async function updatePlatformUser(userId: string, input: PlatformUserUpsertInput, options: PlatformGovernanceActorOptions = {}) {
  const currentRow = await assertPlatformUserExists(userId)
  const currentUser = await mapRowToUser(currentRow, await getPlatformUserShareMap())
  const actorUserId = normalizeOptionalUserId(options.actorUserId) ?? await getRootPlatformAdminUserId()
  const actorContext = await assertActorCanManageTarget(actorUserId, userId)

  const nextNombre = input.nombre === undefined ? currentUser.nombre : normalizeText(input.nombre, 'nombre')
  const nextEmail = input.email === undefined ? currentUser.email : normalizeOptionalEmail(input.email)
  const nextLoginAlias = input.loginAlias === undefined ? currentUser.loginAlias : normalizeText(input.loginAlias, 'loginAlias').toLowerCase()
  const nextRoleSlug = input.roleSlug === undefined ? currentUser.roleSlug : normalizeRoleSlug(input.roleSlug)
  const nextActivo = input.activo === undefined ? currentUser.activo : input.activo
  const temporaryPassword = input.temporaryPassword === true
  const nextCapabilities = input.capabilities === undefined && input.permisos === undefined
    ? currentUser.capabilities
    : getRequestedCapabilities(input, input.permisos, nextRoleSlug === 'superadmin' && nextActivo)
  const nextPermisos = mapCapabilitiesToLegacyPlatformPermissions(nextCapabilities)
  const nextRevenueGrants = input.revenueGrants === undefined && input.shareByFlow === undefined
    ? currentUser.revenueGrants
    : normalizePlatformRevenueGrants(input.revenueGrants ?? input.shareByFlow)

  if (temporaryPassword && nextRoleSlug !== 'staff') {
    throw new PlatformGovernanceError('Solo el staff platform puede usar contraseña temporal', 'platform_temporary_password_forbidden', 400)
  }

  if (!nextEmail) {
    throw new PlatformGovernanceError('El campo email es obligatorio', 'platform_email_required', 400)
  }

  if ((input.capabilities !== undefined || input.permisos !== undefined) && !actorContext.viewerPolicy.isRoot) {
    if (!actorContext.viewerPolicy.capabilities.includes('platform.users.capabilities.grant')) {
      throw new PlatformGovernanceError('No tenés capacidad para delegar capacidades', 'platform_capabilities_grant_required', 403)
    }
    assertPlatformCapabilitiesWithinCeiling(actorContext.viewerPolicy.capabilities, nextCapabilities)
  }

  if (!actorContext.viewerPolicy.isRoot && nextRoleSlug === 'superadmin' && nextActivo) {
    throw new PlatformGovernanceError('No podés promover usuarios a root platform', 'platform_root_creation_forbidden', 403)
  }

  await assertInternalEmailAvailable(nextEmail, {
    exclude: {
      actorType: currentUser.isSingletonSuperadmin ? 'super_admin' : 'platform_staff',
      actorId: userId,
    },
  })
  await ensureLoginAliasAvailable(nextLoginAlias, userId)
  await assertSingletonSuperadminStillPresent(nextRoleSlug, nextActivo, currentRow)

  if (nextRoleSlug === 'superadmin' && nextActivo) {
    await assertSingletonSuperadminAvailable(userId)
  }

  const nextSingletonKey = nextRoleSlug === 'superadmin' && nextActivo ? PLATFORM_SUPERADMIN_SINGLETON_KEY : null
  const assignment = await resolveTargetAssignmentForUpdate({
    actorContext,
    targetUserId: userId,
    currentParentUserId: currentUser.parentUserId,
    input,
  })
  await assertRevenueGrantsWithinParentBag({
    rootUserId: actorContext.viewerPolicy.rootUserId,
    parentUserId: assignment.parentUserId,
    childUserId: userId,
    revenueGrants: nextRoleSlug === 'superadmin' ? { entradas: 0, consumibles: 0 } : nextRevenueGrants,
  })

  if (!nextActivo) {
    const activeDescendants = await getActiveDescendantCount(userId)
    if (activeDescendants > 0) {
      throw new PlatformGovernanceError('No podés desactivar usuarios con descendientes activos', 'platform_user_has_active_descendants', 409)
    }
  }

  if (nextActivo && assignment.parentUserId) {
    const parentRow = await assertPlatformUserExists(assignment.parentUserId)
    if (Number(parentRow.activo) !== 1) {
      throw new PlatformGovernanceError('No podés reactivar un usuario bajo un padre inactivo', 'platform_inactive_parent', 409)
    }
  }

  const updates: string[] = ['nombre = ?', 'email = ?', 'login_alias = ?', 'role_slug = ?', 'permisos = ?', 'singleton_key = ?', 'activo = ?']
  const values: Array<string | number | boolean | Date | null> = [
    nextNombre,
    nextEmail,
    nextLoginAlias,
          toStorageRoleSlug(nextRoleSlug),
    serializePlatformPermissions(nextPermisos),
    nextSingletonKey,
    nextActivo,
  ]

  if (input.password !== undefined) {
    const password = normalizeText(input.password, 'password')
    if (!temporaryPassword) {
      assertPlatformPasswordPolicy(password)
    }
    const passwordHash = await bcrypt.hash(password, 12)
    updates.push('password = ?')
    values.push(passwordHash)
    updates.push('must_change_password = ?')
    values.push(Boolean(temporaryPassword && nextRoleSlug === 'staff'))
    updates.push('temporary_password_set_at = ?')
    values.push(temporaryPassword && nextRoleSlug === 'staff' ? new Date() : null)
  } else if (nextRoleSlug !== 'staff') {
    updates.push('must_change_password = false')
    updates.push('temporary_password_set_at = NULL')
  }

  // values = SET clause values only (without WHERE id).
  // userId is appended as the last positional parameter for WHERE id = $N.

  await prismaDirectUrl.$transaction(async (tx) => {
    // Advisory lock — released automatically on tx commit/rollback.
    // PLATFORM_GOVERNANCE_LOCK_KEY = 9001 (see top of file for full key registry)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PLATFORM_GOVERNANCE_LOCK_KEY})`

    // Build SET clause. updates[] uses '?' placeholders (original MySQL style);
    // convert to Postgres positional $N for $executeRawUnsafe.
    const setClauses = updates.join(', ')
    // Replace each '?' with $1, $2, ... in order; userId is the final parameter.
    let paramIndex = 0
    const pgSetClauses = setClauses.replace(/\?/g, () => `$${++paramIndex}`)
    const rawSql = `UPDATE platform_admin_users SET ${pgSetClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = $${paramIndex + 1}`
    const allValues = [...values, userId]

    try {
      await tx.$executeRawUnsafe(rawSql, ...allValues)
    } catch (error) {
      if (isDuplicateKeyError(error)) {
        throw new PlatformGovernanceError('No se pudo actualizar el usuario platform por conflicto de unicidad', 'platform_user_conflict', 409)
      }

      throw error
    }

    await syncPlatformRelationship({
      userId,
      parentUserId: assignment.parentUserId,
      branchRootUserId: assignment.branchRootUserId,
      roleSlug: nextRoleSlug,
      active: nextActivo,
      tx,
    })
    await syncPlatformCapabilityGrants({
      userId,
      capabilities: nextCapabilities,
      isRoot: nextRoleSlug === 'superadmin' && nextActivo,
      tx,
    })
    await syncPlatformRevenueGrant({
      userId,
      parentUserId: assignment.parentUserId,
      roleSlug: nextRoleSlug,
      active: nextActivo,
      revenueGrants: nextRoleSlug === 'superadmin' ? { entradas: 0, consumibles: 0 } : nextRevenueGrants,
      tx,
    })
  }, { timeout: 30000 })

  // Prisma-native share upsert — runs after the advisory-locked tx commits
  await upsertPlatformUserShares({
    platformAdminUserId: userId,
    configuredByPlatformAdminId: actorUserId,
    sharesByFlow: nextRoleSlug === 'superadmin' ? { entradas: 0, consumibles: 0 } : nextRevenueGrants,
  })

  const updatedRow = await assertPlatformUserExists(userId)
  return mapRowToUser(updatedRow, await getPlatformUserShareMap())
}

export async function deletePlatformUser(userId: string, options: PlatformGovernanceActorOptions = {}) {
  const actorUserId = normalizeOptionalUserId(options.actorUserId) ?? await getRootPlatformAdminUserId()
  await assertActorCanManageTarget(actorUserId, userId)
  const currentRow = await assertPlatformUserExists(userId)
  if (String(currentRow.singleton_key ?? '') === PLATFORM_SUPERADMIN_SINGLETON_KEY) {
    throw new PlatformGovernanceError('No podés eliminar al superadmin singleton', 'singleton_superadmin_required', 409)
  }

  const activeDescendants = await getActiveDescendantCount(userId)
  if (activeDescendants > 0) {
    throw new PlatformGovernanceError('No podés eliminar usuarios con descendientes activos', 'platform_user_has_active_descendants', 409)
  }

  await prismaDirectUrl.$transaction(async (tx) => {
    // Advisory lock — released automatically on tx commit/rollback.
    // PLATFORM_GOVERNANCE_LOCK_KEY = 9001 (see top of file for full key registry)
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PLATFORM_GOVERNANCE_LOCK_KEY})`

    await tx.$executeRaw`
      DELETE FROM platform_admin_user_flow_shares WHERE platform_admin_user_id = ${userId}
    `
    // disconnectPlatformPaymentAccountWithExecutor already uses Prisma internally (ignores executor)
    await disconnectPlatformPaymentAccountWithExecutor(userId, null as unknown as { query: (sql: string, values?: unknown[]) => Promise<unknown> })
    await tx.$executeRaw`
      DELETE FROM platform_admin_revenue_grants
      WHERE child_platform_admin_user_id = ${userId} OR parent_platform_admin_user_id = ${userId}
    `
    await tx.$executeRaw`
      DELETE FROM platform_admin_capability_grants
      WHERE platform_admin_user_id = ${userId} OR granted_by_platform_admin_user_id = ${userId}
    `
    await tx.$executeRaw`
      DELETE FROM platform_admin_closure
      WHERE ancestor_platform_admin_user_id = ${userId} OR descendant_platform_admin_user_id = ${userId}
    `
    await tx.$executeRaw`
      DELETE FROM platform_admin_relationships WHERE platform_admin_user_id = ${userId}
    `

    const affected = await tx.$executeRaw`
      DELETE FROM platform_admin_users WHERE id = ${userId}
    `

    if (affected === 0) {
      throw new PlatformGovernanceError('Usuario platform no encontrado', 'platform_user_not_found', 404)
    }
  }, { timeout: 30000 })
}
