import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { Express } from 'express'
import express from 'express'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

import { prisma } from './lib/prisma'
import tenantRouter from './routes/tenant'
import { ensureIdentityConstraints } from './lib/identity-constraints'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const VALID_PASSWORD = 'ValidPass123!'
const originalFetch = globalThis.fetch

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

async function requestJson(method: 'POST', url: string, body: unknown) {
  const response = await originalFetch(url, {
    method,
    headers: buildHeaders(),
    body: JSON.stringify(body),
  })

  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function seedEmpresa(empresaId: string, slug: string) {
  await prisma.$executeRaw`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES (${empresaId}, ${`Empresa ${slug}`}, ${slug}, ${`${slug}@example.com`}, ${TEST_PASSWORD_HASH}, ${`Admin ${slug}`}, true)
  `
}

async function seedComprador({ compradorId, empresaId, email }: { compradorId: string; empresaId: string; email: string }) {
  await prisma.$executeRaw`
    INSERT INTO compradores (id, empresa_id, nombre, email, dni, password)
    VALUES (${compradorId}, ${empresaId}, ${`Comprador ${compradorId}`}, ${email}, ${`dni-${compradorId.slice(-16)}`}, ${TEST_PASSWORD_HASH})
  `
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM compradores WHERE id ILIKE 'phase9-cmp-%' OR empresa_id ILIKE 'phase9-emp-%' OR email ILIKE 'phase9-%'`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'phase9-emp-%' OR slug ILIKE 'phase9-%' OR email ILIKE 'phase9-%'`
}

beforeEach(async () => {
  await cleanup()
  await ensureIdentityConstraints()
})

after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

test('tenant registration rejects duplicate buyer email within same company', async () => {
  const empresaId = 'phase9-emp-1'
  const slug = 'phase9-tenant-1'
  await seedEmpresa(empresaId, slug)
  await seedComprador({ compradorId: 'phase9-cmp-1', empresaId, email: 'phase9-buyer@example.com' })

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/registro`, {
      nombre: 'Comprador',
      apellido: 'Demo',
      email: ' PHASE9-BUYER@example.com ',
      dni: '12345678',
      password: VALID_PASSWORD,
    })

    assert.equal(response.status, 409)
    assert.equal(response.data.error, 'Ya existe una cuenta compradora con ese email en esta empresa')
  } finally {
    await server.close()
  }
})
