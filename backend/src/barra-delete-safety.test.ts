import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { prisma } from './lib/prisma'
import barrasRouter from './routes/barras'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch

function buildHeaders(user: Record<string, unknown>) {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
    'x-user': JSON.stringify(user),
  }
}

function buildEmpresaUser(empresaId: string) {
  return { id: empresaId, email: `${empresaId}@example.com`, userType: 'empresa' as const }
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

async function requestDelete(url: string, user: Record<string, unknown>) {
  const response = await originalFetch(url, { method: 'DELETE', headers: buildHeaders(user) })
  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function seedEmpresa(empresaId: string) {
  await prisma.$executeRaw`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES (${empresaId}, ${`Empresa ${empresaId}`}, ${empresaId}, ${`${empresaId}@example.com`}, ${TEST_PASSWORD_HASH}, 'Admin', true)
  `
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM consumibles_ventas WHERE id ILIKE 'phase13-%' OR empresa_id ILIKE 'phase13-%'`
  await prisma.$executeRaw`DELETE FROM barra_restock_alertas WHERE id ILIKE 'phase13-%' OR empresa_id ILIKE 'phase13-%' OR barra_id ILIKE 'phase13-%'`
  await prisma.$executeRaw`DELETE FROM barra_stock WHERE id ILIKE 'phase13-%' OR barra_id ILIKE 'phase13-%'`
  await prisma.$executeRaw`DELETE FROM barras WHERE id ILIKE 'phase13-%' OR empresa_id ILIKE 'phase13-%'`
  await prisma.$executeRaw`DELETE FROM eventos WHERE id ILIKE 'phase13-%' OR empresa_id ILIKE 'phase13-%'`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'phase13-%' OR slug ILIKE 'phase13-%'`
}

beforeEach(async () => {
  await cleanup()
})

after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

test('barra delete is blocked when historical consumable sales exist', async () => {
  const empresaId = 'phase13-emp-1'
  const eventoId = 'phase13-evt-1'
  const barraId = 'phase13-bar-1'
  await seedEmpresa(empresaId)
  await prisma.$executeRaw`INSERT INTO eventos (id, empresa_id, nombre, modo_fecha, activo) VALUES (${eventoId}, ${empresaId}, 'Evento', 'unica', true)`
  await prisma.$executeRaw`INSERT INTO barras (id, evento_id, empresa_id, nombre, activa) VALUES (${barraId}, ${eventoId}, ${empresaId}, 'Barra', true)`
  await prisma.$executeRaw`INSERT INTO consumibles_ventas (id, barra_id, evento_id, empresa_id, qr_code, clave_corta, total, estado) VALUES ('phase13-sale-1', ${barraId}, ${eventoId}, ${empresaId}, 'qr', 'CODE', 100, 'pendiente')`

  const app = express()
  app.use('/api/consumibles/barras', barrasRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestDelete(`${server.baseUrl}/api/consumibles/barras/${barraId}`, buildEmpresaUser(empresaId))
    assert.equal(response.status, 400)
    assert.equal(response.data.error, 'No se puede eliminar la barra porque tiene referencias activas o históricas. Desactivala en su lugar.')
  } finally {
    await server.close()
  }
})
