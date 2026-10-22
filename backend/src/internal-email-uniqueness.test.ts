import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { Express } from 'express'
import express from 'express'
process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

import pool from './db'
import { assertInternalEmailAvailable } from './lib/internal-email'
import authRouter from './routes/auth'
import equipoRouter from './routes/equipo'
import configuracionRouter from './routes/configuracion'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch

function buildEmpresaUser(empresaId: string, email?: string) {
  return {
    id: empresaId,
    email: email ?? `${empresaId}@example.com`,
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

async function createTestServer(app: Express) {
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

async function requestJson(method: 'POST' | 'PATCH', url: string, body: unknown, user: Record<string, unknown> | null = null) {
  const response = await originalFetch(url, {
    method,
    headers: buildHeaders(user),
    body: JSON.stringify(body),
  })

  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_admin_users (
      id varchar(36) NOT NULL,
      nombre varchar(120) NOT NULL,
      email varchar(191) NOT NULL,
      login_alias varchar(80) NOT NULL,
      password varchar(255) NOT NULL,
      role_slug varchar(40) NOT NULL DEFAULT 'empleado',
      permisos text DEFAULT NULL,
      singleton_key varchar(80) DEFAULT NULL,
      activo boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id),
      UNIQUE (email),
      UNIQUE (login_alias),
      UNIQUE (singleton_key)
    )
  `)

  await pool.query(`ALTER TABLE platform_admin_users ADD COLUMN IF NOT EXISTS login_alias varchar(80) NOT NULL DEFAULT ''`)
  await pool.query(`ALTER TABLE platform_admin_users ADD COLUMN IF NOT EXISTS role_slug varchar(40) NOT NULL DEFAULT 'empleado'`)
  await pool.query(`ALTER TABLE platform_admin_users ADD COLUMN IF NOT EXISTS permisos text DEFAULT NULL`)
  await pool.query(`ALTER TABLE platform_admin_users ADD COLUMN IF NOT EXISTS singleton_key varchar(80) DEFAULT NULL`)
}

async function cleanup() {
  await pool.query(`DELETE FROM roles WHERE empresa_id LIKE 'phase8-emp-%'`).catch(() => {})
  await pool.query(`DELETE FROM compradores WHERE id LIKE 'phase8-cmp-%' OR empresa_id LIKE 'phase8-emp-%' OR email LIKE 'phase8-%'`)
  await pool.query(`DELETE FROM usuarios WHERE id LIKE 'phase8-usr-%' OR empresa_id LIKE 'phase8-emp-%' OR email LIKE 'phase8-%'`)
  await pool.query(`DELETE FROM platform_admin_users WHERE id LIKE 'phase8-admin-%' OR email LIKE 'phase8-%'`)
  await pool.query(`DELETE FROM empresas WHERE id LIKE 'phase8-emp-%' OR slug LIKE 'phase8-%' OR email LIKE 'phase8-%'`)
}

async function seedEmpresa({ empresaId, slug, email }: { empresaId: string; slug: string; email: string }) {
  await pool.query(
    `INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
     VALUES (?, ?, ?, ?, ?, ?, true)`,
    [empresaId, `Empresa ${slug}`, slug, email, TEST_PASSWORD_HASH, `Admin ${slug}`]
  )
}

async function seedUsuario({ userId, empresaId, email }: { userId: string; empresaId: string; email: string }) {
  await pool.query(
    `INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, activo)
     VALUES (?, ?, ?, ?, ?, ?, 'admin', true)`,
    [userId, empresaId, 'Usuario', 'Demo', email, TEST_PASSWORD_HASH]
  )
}

async function seedPlatformAdmin({ adminId, email }: { adminId: string; email: string }) {
  await pool.query(
    `INSERT INTO platform_admin_users (id, nombre, email, login_alias, password, role_slug, activo)
     VALUES (?, ?, ?, ?, ?, 'superadmin', true)`,
    [adminId, 'Owner Demo', email, `alias-${adminId}`, TEST_PASSWORD_HASH]
  )
}

async function seedComprador({ compradorId, empresaId, email }: { compradorId: string; empresaId: string; email: string }) {
  await pool.query(
    `INSERT INTO compradores (id, empresa_id, nombre, email, dni, password)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [compradorId, empresaId, 'Comprador Demo', email, `dni-${compradorId.slice(-16)}`, TEST_PASSWORD_HASH]
  )
}

beforeEach(async () => {
  await ensureSchema()
  await cleanup()
})

after(async () => {
  await ensureSchema()
  await cleanup()
  await pool.end()
})

test('company registration rejects email already used by employee', async () => {
  await seedEmpresa({ empresaId: 'phase8-emp-base', slug: 'phase8-base', email: 'phase8-base@example.com' })
  await seedUsuario({ userId: 'phase8-usr-1', empresaId: 'phase8-emp-base', email: 'phase8-shared@example.com' })

  const app = express()
  app.use(express.json())
  app.use('/auth', authRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson('POST', `${server.baseUrl}/auth/registro`, {
      nombre: 'Nueva Empresa',
      slug: 'phase8-nueva',
      email: 'phase8-shared@example.com',
      password: 'ValidPass123!',
      admin_nombre: 'Admin Nueva',
    })

    assert.equal(response.status, 409)
    assert.equal(response.data.error, 'El email ya está en uso por otra cuenta interna')
  } finally {
    await server.close()
  }
})

test('employee creation rejects email already used by company or super admin', async () => {
  await seedEmpresa({ empresaId: 'phase8-emp-1', slug: 'phase8-uno', email: 'phase8-owner@example.com' })
  await seedEmpresa({ empresaId: 'phase8-emp-2', slug: 'phase8-dos', email: 'phase8-company@example.com' })
  await seedPlatformAdmin({ adminId: 'phase8-admin-1', email: 'phase8-admin@example.com' })

  const app = express()
  app.use(express.json())
  app.use('/api/equipo', equipoRouter)
  const server = await createTestServer(app)

  try {
    const companyConflict = await requestJson('POST', `${server.baseUrl}/api/equipo`, {
      nombre: 'Empleado',
      email: 'phase8-company@example.com',
      password: 'ValidPass123!',
      rol: 'admin',
    }, buildEmpresaUser('phase8-emp-1', 'phase8-owner@example.com'))

    assert.equal(companyConflict.status, 409)
    assert.equal(companyConflict.data.error, 'El email ya está en uso por otra cuenta interna')

    const adminConflict = await requestJson('POST', `${server.baseUrl}/api/equipo`, {
      nombre: 'Empleado',
      email: 'phase8-admin@example.com',
      password: '12345678',
      rol: 'admin',
    }, buildEmpresaUser('phase8-emp-1', 'phase8-owner@example.com'))

    assert.equal(adminConflict.status, 409)
    assert.equal(adminConflict.data.error, 'El email ya está en uso por otra cuenta interna')
  } finally {
    await server.close()
  }
})

test('employee update rejects email already used by another internal actor', async () => {
  await seedEmpresa({ empresaId: 'phase8-emp-3', slug: 'phase8-tres', email: 'phase8-main@example.com' })
  await seedEmpresa({ empresaId: 'phase8-emp-4', slug: 'phase8-cuatro', email: 'phase8-other@example.com' })
  await seedUsuario({ userId: 'phase8-usr-2', empresaId: 'phase8-emp-3', email: 'phase8-user@example.com' })

  const app = express()
  app.use(express.json())
  app.use('/api/configuracion', configuracionRouter)
  app.use('/api/equipo', equipoRouter)
  const server = await createTestServer(app)

  try {
    const companyEmailConflict = await requestJson('PATCH', `${server.baseUrl}/api/equipo/phase8-usr-2`, {
      email: 'phase8-other@example.com',
    }, buildEmpresaUser('phase8-emp-3', 'phase8-main@example.com'))

    assert.equal(companyEmailConflict.status, 409)
    assert.equal(companyEmailConflict.data.error, 'El email ya está en uso por otra cuenta interna')

    const configConflict = await requestJson('PATCH', `${server.baseUrl}/api/configuracion`, {
      email: 'phase8-user@example.com',
    }, buildEmpresaUser('phase8-emp-3', 'phase8-main@example.com'))

    assert.equal(configConflict.status, 409)
    assert.equal(configConflict.data.error, 'El email ya está en uso por otra cuenta interna')
  } finally {
    await server.close()
  }
})

test('buyer email does not block internal actor creation', async () => {
  await seedEmpresa({ empresaId: 'phase8-emp-5', slug: 'phase8-cinco', email: 'phase8-owner5@example.com' })
  await seedComprador({ compradorId: 'phase8-cmp-1', empresaId: 'phase8-emp-5', email: 'phase8-buyer@example.com' })

  const normalizedEmail = await assertInternalEmailAvailable('phase8-buyer@example.com')
  assert.equal(normalizedEmail, 'phase8-buyer@example.com')
})
