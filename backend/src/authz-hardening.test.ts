import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from './lib/prisma'
import indexRouter from './routes/index'
import rolesRouter from './routes/roles'
import configuracionRouter from './routes/configuracion'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch

function buildHeaders(user: Record<string, unknown> | null = null) {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
    'x-user': JSON.stringify(user),
  }
}

function buildEmpleadoUser(userId: string, empresaId: string, email: string, permisos: Record<string, boolean> = {}) {
  return {
    id: userId,
    email,
    empresa_id: empresaId,
    userType: 'empleado' as const,
    permisos,
  }
}

async function createTestServer(app: express.Express) {
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })

  const address = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`

  return {
    baseUrl,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

async function requestJson(url: string, user: Record<string, unknown> | null, method: 'GET' | 'PATCH' = 'GET', body?: unknown) {
  const response = await originalFetch(url, {
    method,
    headers: buildHeaders(user),
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const data = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function ensureRolesSchema() {
  // Schema provisioned by prisma migrate deploy in prepare-test-db.cjs — no-op
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM usuarios WHERE id ILIKE 'phase-authz-usr-%' OR empresa_id ILIKE 'phase-authz-emp-%'`
  await prisma.$executeRaw`DELETE FROM compradores WHERE id ILIKE 'phase-authz-cmp-%' OR empresa_id ILIKE 'phase-authz-emp-%'`
  await prisma.$executeRaw`DELETE FROM roles WHERE empresa_id ILIKE 'phase-authz-emp-%'`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'phase-authz-emp-%' OR slug ILIKE 'phase-authz-%'`
}

async function seedEmpresa(empresaId: string, slug: string) {
  await prisma.$executeRaw`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES (${empresaId}, ${`Empresa ${slug}`}, ${slug}, ${`${slug}@example.com`}, ${TEST_PASSWORD_HASH}, ${`Admin ${slug}`}, true)
  `
}

async function seedEmpresaInactiva(empresaId: string, slug: string) {
  await prisma.$executeRaw`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES (${empresaId}, ${`Empresa ${slug}`}, ${slug}, ${`${slug}@example.com`}, ${TEST_PASSWORD_HASH}, ${`Admin ${slug}`}, false)
  `
}

async function seedEmpleado({
  userId,
  empresaId,
  email,
  rol = 'admin',
  permisos = null,
}: {
  userId: string
  empresaId: string
  email: string
  rol?: string
  permisos?: Record<string, boolean> | null
}) {
  const permisosStr = permisos ? JSON.stringify(permisos) : null
  await prisma.$executeRaw`
    INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, activo, permisos)
    VALUES (${userId}, ${empresaId}, 'Empleado', 'Authz', ${email}, ${TEST_PASSWORD_HASH}, ${rol}, true, ${permisosStr})
  `
}

async function seedComprador({ compradorId, empresaId, email }: { compradorId: string; empresaId: string; email: string }) {
  await prisma.$executeRaw`
    INSERT INTO compradores (id, empresa_id, nombre, email, dni, password)
    VALUES (${compradorId}, ${empresaId}, ${`Comprador ${compradorId}`}, ${email}, ${`dni-${compradorId.slice(-16)}`}, ${TEST_PASSWORD_HASH})
  `
}

function buildCompradorUser(compradorId: string, empresaId: string, slug: string, email: string) {
  return {
    id: compradorId,
    email,
    empresa_id: empresaId,
    empresa_slug: slug,
    slug,
    userType: 'comprador' as const,
  }
}

beforeEach(async () => {
  await ensureRolesSchema()
  await cleanup()
})

after(async () => {
  await ensureRolesSchema()
  await cleanup()
  await prisma.$disconnect()
})

test('rehydration ignores forged employee permission grants from x-user', async () => {
  const empresaId = 'phase-authz-emp-1'
  const userId = 'phase-authz-usr-1'
  const email = 'phase-authz-usr-1@example.com'
  await seedEmpresa(empresaId, 'phase-authz-1')
  await seedEmpleado({ userId, empresaId, email, permisos: null })

  const app = express()
  app.use('/api/roles', rolesRouter)
  const server = await createTestServer(app)

  try {
    const forgedUser = buildEmpleadoUser(userId, empresaId, email, { ver_roles: true })
    const response = await requestJson(`${server.baseUrl}/api/roles`, forgedUser)

    assert.equal(response.status, 403)
    assert.equal((response.data as { error: string }).error, 'Sin permiso')
  } finally {
    await server.close()
  }
})

test('rehydration restores employee permissions from DB even if x-user omits them', async () => {
  const empresaId = 'phase-authz-emp-2'
  const userId = 'phase-authz-usr-2'
  const email = 'phase-authz-usr-2@example.com'
  await seedEmpresa(empresaId, 'phase-authz-2')
  await seedEmpleado({ userId, empresaId, email, permisos: { ver_roles: true } })

  const app = express()
  app.use('/api/roles', rolesRouter)
  const server = await createTestServer(app)

  try {
    const staleUser = buildEmpleadoUser(userId, empresaId, email, {})
    const response = await requestJson(`${server.baseUrl}/api/roles`, staleUser)

    assert.equal(response.status, 200)
    assert.ok(Array.isArray((response.data as { data: unknown[] }).data))
  } finally {
    await server.close()
  }
})

test('employee password endpoint rotates only employee credentials', async () => {
  const empresaId = 'phase-authz-emp-3'
  const userId = 'phase-authz-usr-3'
  const email = 'phase-authz-usr-3@example.com'
  await seedEmpresa(empresaId, 'phase-authz-3')
  await seedEmpleado({ userId, empresaId, email, permisos: { editar_configuracion: true, ver_configuracion: true } })

  const app = express()
  app.use(express.json())
  app.use('/api/configuracion', configuracionRouter)
  const server = await createTestServer(app)

  try {
    const employeeCurrentPassword = 'CurrentPass123!'
    const newHash = await bcrypt.hash(employeeCurrentPassword, 12)
    await prisma.$executeRaw`UPDATE usuarios SET password = ${newHash} WHERE id = ${userId}`
    const beforeEmpresaRows = await prisma.$queryRaw<{ password: string }[]>`SELECT password FROM empresas WHERE id = ${empresaId}`

    const response = await requestJson(
      `${server.baseUrl}/api/configuracion/password`,
      buildEmpleadoUser(userId, empresaId, email, {}),
      'PATCH',
      {
        passwordActual: employeeCurrentPassword,
        nuevaPassword: 'ValidPass123!',
        confirmarPassword: 'ValidPass123!',
      }
    )

    assert.equal(response.status, 200)

    const afterEmpresaRows = await prisma.$queryRaw<{ password: string }[]>`SELECT password FROM empresas WHERE id = ${empresaId}`
    const employeeRows = await prisma.$queryRaw<{ password: string }[]>`SELECT password FROM usuarios WHERE id = ${userId}`

    assert.equal(beforeEmpresaRows[0].password, afterEmpresaRows[0].password)
    assert.notEqual(employeeRows[0].password, beforeEmpresaRows[0].password)
  } finally {
    await server.close()
  }
})

test('buyers cannot access internal dashboard routes by direct backend call', async () => {
  const empresaId = 'phase-authz-emp-4'
  const slug = 'phase-authz-4'
  const compradorId = 'phase-authz-cmp-4'
  const email = 'phase-authz-cmp-4@example.com'
  await seedEmpresa(empresaId, slug)
  await seedComprador({ compradorId, empresaId, email })

  const app = express()
  app.use('/api', indexRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      `${server.baseUrl}/api/roles`,
      buildCompradorUser(compradorId, empresaId, slug, email)
    )

    assert.equal(response.status, 403)
    assert.equal((response.data as { error: string }).error, 'Sin permiso')
  } finally {
    await server.close()
  }
})

test('employees from inactive companies are rejected during backend rehydration', async () => {
  const empresaId = 'phase-authz-emp-5'
  const slug = 'phase-authz-5'
  const userId = 'phase-authz-usr-5'
  const email = 'phase-authz-usr-5@example.com'
  await seedEmpresaInactiva(empresaId, slug)
  await seedEmpleado({ userId, empresaId, email, permisos: { ver_roles: true } })

  const app = express()
  app.use('/api', indexRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(`${server.baseUrl}/api/roles`, buildEmpleadoUser(userId, empresaId, email, { ver_roles: true }))

    assert.equal(response.status, 401)
    assert.equal((response.data as { error: string }).error, 'No autorizado')
  } finally {
    await server.close()
  }
})

test('buyers from inactive companies are rejected during backend rehydration', async () => {
  const empresaId = 'phase-authz-emp-6'
  const slug = 'phase-authz-6'
  const compradorId = 'phase-authz-cmp-6'
  const email = 'phase-authz-cmp-6@example.com'
  await seedEmpresaInactiva(empresaId, slug)
  await seedComprador({ compradorId, empresaId, email })

  const app = express()
  app.use('/api', indexRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      `${server.baseUrl}/api/roles`,
      buildCompradorUser(compradorId, empresaId, slug, email)
    )

    assert.equal(response.status, 401)
    assert.equal((response.data as { error: string }).error, 'No autorizado')
  } finally {
    await server.close()
  }
})
