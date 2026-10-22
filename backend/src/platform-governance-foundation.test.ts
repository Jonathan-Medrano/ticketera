import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { Prisma } from '@prisma/client'
import { prismaDirectUrl } from './lib/prisma'
import { rehydrateSessionUser, requirePlatformConsoleUser } from './lib/authz'
import {
  PlatformGovernanceError,
  assertPlatformCapabilitiesWithinCeiling,
  createPlatformUser,
  listPlatformUsersForViewer,
  updatePlatformUser,
} from './lib/platform-governance'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'

type RootRelationshipRow = {
  platform_admin_user_id: string
  parent_platform_admin_user_id: string | null
  branch_root_platform_admin_user_id: string
  depth_from_root: number
}

function createResponseRecorder() {
  return {
    statusCode: 200,
    payload: null as unknown,
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(payload: unknown) {
      this.payload = payload
      return this
    },
  }
}

async function cleanupTestData() {
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_admin_revenue_grants WHERE child_platform_admin_user_id LIKE 'phase7-foundation-%' OR parent_platform_admin_user_id LIKE 'phase7-foundation-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_admin_capability_grants WHERE platform_admin_user_id LIKE 'phase7-foundation-%' OR granted_by_platform_admin_user_id LIKE 'phase7-foundation-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_admin_closure WHERE ancestor_platform_admin_user_id LIKE 'phase7-foundation-%' OR descendant_platform_admin_user_id LIKE 'phase7-foundation-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_admin_relationships WHERE platform_admin_user_id LIKE 'phase7-foundation-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_admin_user_flow_shares WHERE platform_admin_user_id LIKE 'phase7-foundation-%' OR configured_by_platform_admin_id LIKE 'phase7-foundation-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_payment_accounts WHERE platform_admin_user_id LIKE 'phase7-foundation-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_admin_users WHERE id LIKE 'phase7-foundation-%' OR email LIKE 'phase7-foundation-%' OR login_alias LIKE 'phase7-foundation-%'`)
}

beforeEach(async () => {
  await cleanupTestData()
})

after(async () => {
  await cleanupTestData()
  await prismaDirectUrl.$disconnect()
})

test('backend schema bootstraps singleton root into governance foundation tables', async () => {
  const rootRows = await prismaDirectUrl.$queryRaw<any[]>(Prisma.sql`
    SELECT id FROM platform_admin_users WHERE singleton_key = 'superadmin' LIMIT 1
  `)
  const rootUserId = String(rootRows[0]?.id ?? '')

  assert.ok(rootUserId)

  const relationshipRows = await prismaDirectUrl.$queryRaw<RootRelationshipRow[]>(Prisma.sql`
    SELECT platform_admin_user_id, parent_platform_admin_user_id, branch_root_platform_admin_user_id, depth_from_root
    FROM platform_admin_relationships
    WHERE platform_admin_user_id = ${rootUserId}
    LIMIT 1
  `)
  const closureRows = await prismaDirectUrl.$queryRaw<any[]>(Prisma.sql`
    SELECT depth
    FROM platform_admin_closure
    WHERE ancestor_platform_admin_user_id = ${rootUserId} AND descendant_platform_admin_user_id = ${rootUserId}
    LIMIT 1
  `)

  assert.equal(relationshipRows[0]?.parent_platform_admin_user_id ?? null, null)
  assert.equal(relationshipRows[0]?.branch_root_platform_admin_user_id, rootUserId)
  assert.equal(Number(relationshipRows[0]?.depth_from_root ?? -1), 0)
  assert.equal(Number(closureRows[0]?.depth ?? -1), 0)
})

test('label-only platform role does not bypass capability-based authorization', async () => {
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO platform_admin_users (id, nombre, email, login_alias, password, role_slug, permisos, singleton_key, activo)
    VALUES ('phase7-foundation-label-only', 'Label Only', 'phase7-foundation-label-only@example.com', 'phase7-foundation-label-only', ${TEST_PASSWORD_HASH}, 'superadmin', ${JSON.stringify({})}, NULL, true)
  `)

  const rehydrated = await rehydrateSessionUser({
    id: 'phase7-foundation-label-only',
    userType: 'platform_staff',
    email: 'phase7-foundation-label-only@example.com',
    name: 'Label Only',
    slug: '',
  })
  const res = createResponseRecorder()

  assert.equal(rehydrated?.userType, 'platform_staff')
  assert.deepEqual(rehydrated?.platformCapabilities ?? [], [])
  assert.equal(requirePlatformConsoleUser(rehydrated!, res as never, 'Sin permiso', 'platform_usuarios'), false)
  assert.equal(res.statusCode, 403)
})

test('capability ceiling blocks higher-than-self grants', () => {
  assert.throws(
    () => assertPlatformCapabilitiesWithinCeiling(
      ['platform.users.read'],
      ['platform.users.read', 'platform.revenue.view.global'],
    ),
    (error: unknown) => error instanceof PlatformGovernanceError && error.code === 'platform_capability_escalation'
  )
})

test('capability normalization auto-adds required parent capabilities', () => {
  assert.deepEqual(
    assertPlatformCapabilitiesWithinCeiling(
      ['platform.settings.read', 'platform.fees.defaults.edit'],
      ['platform.fees.defaults.edit'],
    ),
    ['platform.fees.defaults.edit', 'platform.settings.read'],
  )
})

test('viewer read model exposes policy, branch tree, and compatibility envelope', async () => {
  const staff = await createPlatformUser({
    nombre: 'Foundation Staff',
    email: 'phase7-foundation-staff@example.com',
    loginAlias: 'phase7-foundation-staff',
    password: 'ClaveSegura12!',
    roleSlug: 'staff',
    permisos: { platform_usuarios: true, platform_dashboard: true },
    shareByFlow: { entradas: 0, consumibles: 0 },
    activo: true,
  })

  const governance = await listPlatformUsersForViewer(staff.id)

  assert.equal(governance.viewerPolicy.actorUserId, staff.id)
  assert.equal(governance.viewerPolicy.branchRootUserId, staff.id)
  assert.equal(governance.viewerPolicy.revenueVisibilityScope, 'own')
  assert.equal(governance.viewerPolicy.capabilities.includes('platform.users.write'), true)
  assert.equal(governance.branchTree.length, 1)
  assert.equal(governance.branchTree[0]?.userId, staff.id)
  assert.deepEqual(governance.usuarios.map((usuario) => usuario.id), [staff.id])
  assert.equal(governance.capabilityCatalog.some((entry) => entry.key === 'platform.users.capabilities.grant'), true)
})

test('platform governance rejects weak passwords on create and update', async () => {
  await assert.rejects(
    () => createPlatformUser({
      nombre: 'Weak Staff',
      email: 'phase7-foundation-weak@example.com',
      loginAlias: 'phase7-foundation-weak',
      password: '12345678',
      roleSlug: 'staff',
      permisos: { platform_usuarios: true },
      activo: true,
    }),
    (error: unknown) => error instanceof PlatformGovernanceError && error.code === 'password_policy_failed'
  )

  const staff = await createPlatformUser({
    nombre: 'Update Staff',
    email: 'phase7-foundation-update@example.com',
    loginAlias: 'phase7-foundation-update',
    password: 'ClaveSegura12!',
    roleSlug: 'staff',
    permisos: { platform_usuarios: true },
    activo: true,
  })

  await assert.rejects(
    () => updatePlatformUser(staff.id, { password: '12345678' }),
    (error: unknown) => error instanceof PlatformGovernanceError && error.code === 'password_policy_failed'
  )
})
