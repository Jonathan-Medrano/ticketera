import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { Prisma } from '@prisma/client'
import { prismaDirectUrl } from './lib/prisma'
import {
  findInternalEmailConflict,
} from './lib/internal-email'
import {
  rehydrateSessionUser,
  requirePlatformConsoleUser,
  requireSingletonSuperAdmin,
} from './lib/authz'
import {
  PlatformGovernanceError,
  createPlatformUser,
  updatePlatformUser,
} from './lib/platform-governance'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'

type PlatformAdminRow = {
  id: string
  singleton_key: string | null
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

async function seedEmpresa(empresaId: string, email: string) {
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES (${empresaId}, 'Empresa Auth', ${`${empresaId}-slug`}, ${email}, ${TEST_PASSWORD_HASH}, 'Admin Auth', true)
  `)
}

async function seedEmpleado(userId: string, empresaId: string, email: string) {
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, activo, permisos)
    VALUES (${userId}, ${empresaId}, 'Empleado', 'Auth', ${email}, ${TEST_PASSWORD_HASH}, 'admin', true, NULL)
  `)
}

async function cleanupTestData() {
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM usuarios WHERE id LIKE 'phase5-auth-%' OR empresa_id LIKE 'phase5-auth-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_admin_users WHERE id LIKE 'phase5-auth-%' OR email LIKE 'phase5-auth-%' OR login_alias LIKE 'phase5-auth-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresas WHERE id LIKE 'phase5-auth-%' OR slug LIKE 'phase5-auth-%' OR email LIKE 'phase5-auth-%'`)
}

beforeEach(async () => {
  await cleanupTestData()
})

after(async () => {
  await cleanupTestData()
  await prismaDirectUrl.$disconnect()
})

test('rehydrateSessionUser keeps singleton superadmin and platform staff separated', async () => {
  const singletonRows = await prismaDirectUrl.$queryRaw<PlatformAdminRow[]>(Prisma.sql`
    SELECT id, singleton_key FROM platform_admin_users WHERE singleton_key = 'superadmin' LIMIT 1
  `)

  assert.equal(singletonRows.length, 1)
  const singleton = await rehydrateSessionUser({
    id: singletonRows[0].id,
    userType: 'super_admin',
    email: null,
    name: null,
    slug: '',
  })

  assert.equal(singleton?.userType, 'super_admin')
  assert.equal(singleton?.singletonKey, 'superadmin')

  const staff = await createPlatformUser({
    nombre: 'Staff Platform Auth',
    email: 'phase5-auth-staff@example.com',
    loginAlias: 'phase5-auth-staff',
    password: 'ClaveSegura12!',
    roleSlug: 'staff',
    permisos: { platform_dashboard: true },
    activo: true,
  })

  const rehydratedStaff = await rehydrateSessionUser({
    id: staff.id,
    userType: 'platform_staff',
    email: staff.email,
    name: staff.nombre,
    slug: '',
  })

  assert.equal(rehydratedStaff?.userType, 'platform_staff')
  assert.equal(rehydratedStaff?.roleSlug, 'staff')
  assert.equal(rehydratedStaff?.singletonKey ?? null, null)
})

test('platform guard matrix blocks tenant actors and singleton-only actions correctly', () => {
  const platformRes = createResponseRecorder()
  assert.equal(requirePlatformConsoleUser({ id: 'a', userType: 'super_admin', singletonKey: 'superadmin', email: null, name: null, slug: '' }, platformRes as never), true)
  assert.equal(requirePlatformConsoleUser({ id: 'b', userType: 'platform_staff', roleSlug: 'staff', email: null, name: null, slug: '' }, platformRes as never), true)

  const empresaRes = createResponseRecorder()
  assert.equal(requirePlatformConsoleUser({ id: 'c', userType: 'empresa', slug: 'demo', email: null, name: null }, empresaRes as never), false)
  assert.equal(empresaRes.statusCode, 403)
  assert.deepEqual(empresaRes.payload, { error: 'Sin permiso' })

  const singletonRes = createResponseRecorder()
  assert.equal(requireSingletonSuperAdmin({ id: 'a', userType: 'super_admin', singletonKey: 'superadmin', email: null, name: null, slug: '' }, singletonRes as never), true)

  const nonSingletonRes = createResponseRecorder()
  assert.equal(requireSingletonSuperAdmin({ id: 'b', userType: 'platform_staff', roleSlug: 'staff', email: null, name: null, slug: '' }, nonSingletonRes as never), false)
  assert.equal(nonSingletonRes.statusCode, 403)
  assert.deepEqual(nonSingletonRes.payload, { error: 'Sin permiso' })
})

test('internal email conflicts cover empresa, empleado, platform staff and singleton governance', async () => {
  await seedEmpresa('phase5-auth-emp-1', 'phase5-auth-empresa@example.com')
  await seedEmpleado('phase5-auth-user-1', 'phase5-auth-emp-1', 'phase5-auth-empleado@example.com')

  const platformUser = await createPlatformUser({
    nombre: 'Operador Auth',
    email: 'phase5-auth-platform@example.com',
    loginAlias: 'phase5-auth-platform',
    password: 'ClaveSegura12!',
    roleSlug: 'staff',
    permisos: { platform_usuarios: true },
    activo: true,
  })

  assert.deepEqual(await findInternalEmailConflict('phase5-auth-empresa@example.com'), {
    actorType: 'empresa',
    actorId: 'phase5-auth-emp-1',
    email: 'phase5-auth-empresa@example.com',
  })
  assert.deepEqual(await findInternalEmailConflict('phase5-auth-empleado@example.com'), {
    actorType: 'empleado',
    actorId: 'phase5-auth-user-1',
    email: 'phase5-auth-empleado@example.com',
  })
  assert.deepEqual(await findInternalEmailConflict('phase5-auth-platform@example.com'), {
    actorType: 'platform_staff',
    actorId: platformUser.id,
    email: 'phase5-auth-platform@example.com',
  })

  const updated = await updatePlatformUser(platformUser.id, {
    nombre: 'Operador Auth Updated',
    email: 'phase5-auth-platform@example.com',
  })
  assert.equal(updated.nombre, 'Operador Auth Updated')

  await assert.rejects(
    () => createPlatformUser({
      nombre: 'Otro Superadmin',
      email: 'phase5-auth-second-superadmin@example.com',
      loginAlias: 'phase5-auth-second-superadmin',
      password: 'ClaveSegura12!',
      roleSlug: 'superadmin',
      permisos: {},
      activo: true,
    }),
    (error: unknown) => error instanceof PlatformGovernanceError && error.code === 'singleton_superadmin_exists'
  )
})
