import './test-env'

import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { prisma } from './lib/prisma'
import rolesRouter from './routes/roles'
import { ROLES_PREDEFINIDOS } from './lib/permisos'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

function buildEmpresaUser(empresaId: string) {
  return {
    id: empresaId,
    email: `${empresaId}@example.com`,
    userType: 'empresa' as const,
  }
}

function buildHeaders(user: Record<string, unknown> | null = null) {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
    'x-user': JSON.stringify(user),
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

async function requestJson(url: string, user: Record<string, unknown> | null = null, method: 'GET' | 'DELETE' | 'POST' | 'PATCH' = 'GET', body?: unknown) {
  const response = await originalFetch(url, {
    method,
    headers: buildHeaders(user),
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

// Local DDL no-op: schema already provisioned by prisma migrate deploy
async function ensureSchema() {
  // no-op: roles table exists via Prisma migrations
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM roles WHERE empresa_id ILIKE 'phase7-emp-%'`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'phase7-emp-%' OR slug ILIKE 'phase7-%'`
}

async function seedEmpresa(empresaId: string, slug: string) {
  await prisma.$executeRaw`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES (${empresaId}, ${`Empresa ${slug}`}, ${slug}, ${`${slug}@example.com`}, ${TEST_PASSWORD_HASH}, ${`Admin ${slug}`}, true)
  `
}

beforeEach(async () => {
  await ensureSchema()
  await cleanup()
})

after(async () => {
  await ensureSchema()
  await cleanup()
  await prisma.$disconnect()
})

test('roles endpoint restores all predefined roles when company has partial or custom roles', async () => {
  const empresaId = 'phase7-emp-roles-1'
  const slug = 'phase7-roles-1'
  await seedEmpresa(empresaId, slug)

  await prisma.$executeRaw`
    INSERT INTO roles (id, empresa_id, nombre, slug, permisos, es_predefinido)
    VALUES ('phase7-role-custom-1', ${empresaId}, 'Custom ventas', 'custom-ventas', ${JSON.stringify({ ver_dashboard: true })}, false)
  `

  await prisma.$executeRaw`
    INSERT INTO roles (id, empresa_id, nombre, slug, permisos, es_predefinido)
    VALUES ('phase7-role-admin-1', ${empresaId}, 'Admin', 'admin', ${JSON.stringify(ROLES_PREDEFINIDOS.admin)}, true)
  `

  const app = express()
  app.use('/api/roles', rolesRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(`${server.baseUrl}/api/roles`, buildEmpresaUser(empresaId))
    assert.equal(response.status, 200)

    const returnedSlugs = new Set((response.data.data as Array<{ slug: string }>).map((role) => role.slug))
    for (const slugPredefinido of Object.keys(ROLES_PREDEFINIDOS)) {
      assert.equal(returnedSlugs.has(slugPredefinido), true, `faltó el rol predefinido ${slugPredefinido}`)
    }
    assert.equal(returnedSlugs.has('custom-ventas'), true)
  } finally {
    await server.close()
  }
})

test('predefined roles cannot be deleted', async () => {
  const empresaId = 'phase7-emp-roles-2'
  const slug = 'phase7-roles-2'
  await seedEmpresa(empresaId, slug)

  await prisma.$executeRaw`
    INSERT INTO roles (id, empresa_id, nombre, slug, permisos, es_predefinido)
    VALUES ('phase7-role-predef-1', ${empresaId}, 'Admin', 'admin', ${JSON.stringify(ROLES_PREDEFINIDOS.admin)}, true)
  `

  const app = express()
  app.use('/api/roles', rolesRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(`${server.baseUrl}/api/roles/phase7-role-predef-1`, buildEmpresaUser(empresaId), 'DELETE')
    assert.equal(response.status, 400)
    assert.equal(response.data.error, 'No se puede eliminar un rol predefinido')

    const rows = await prisma.$queryRaw<Array<{ total: bigint }>>`SELECT COUNT(*) as total FROM roles WHERE id = 'phase7-role-predef-1'`
    assert.equal(Number(rows[0].total), 1)
  } finally {
    await server.close()
  }
})

test('roles cannot be created without active permissions', async () => {
  const empresaId = 'phase7-emp-roles-3'
  const slug = 'phase7-roles-3'
  await seedEmpresa(empresaId, slug)

  const app = express()
  app.use(express.json())
  app.use('/api/roles', rolesRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      `${server.baseUrl}/api/roles`,
      buildEmpresaUser(empresaId),
      'POST',
      { nombre: 'Rol vacío', permisos: {} }
    )
    assert.equal(response.status, 400)
    assert.equal(response.data.error, 'Debés seleccionar al menos un permiso para crear o editar el rol')
  } finally {
    await server.close()
  }
})

test('roles cannot be created with dependent permissions but missing base permission', async () => {
  const empresaId = 'phase7-emp-roles-4'
  const slug = 'phase7-roles-4'
  await seedEmpresa(empresaId, slug)

  const app = express()
  app.use(express.json())
  app.use('/api/roles', rolesRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      `${server.baseUrl}/api/roles`,
      buildEmpresaUser(empresaId),
      'POST',
      { nombre: 'Rol inconsistente', permisos: { ver_ingresos: true, ver_dashboard: false } }
    )
    assert.equal(response.status, 400)
    assert.equal(response.data.error, 'El permiso ver_ingresos requiere ver_dashboard')
  } finally {
    await server.close()
  }
})
