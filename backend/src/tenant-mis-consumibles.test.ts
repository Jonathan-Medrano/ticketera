import './test-env'

import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { prisma } from './lib/prisma'
import tenantRouter from './routes/tenant'

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

async function createTestServer(app: express.Express) {
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })

  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    },
  }
}

async function requestJson(url: string, headers: Record<string, string>) {
  const response = await originalFetch(url, { method: 'GET', headers })
  const data = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function cleanup() {
  // DDL no-op: columns already exist via Prisma migrations (comprador_id, checkout_session_id, origen)
  await prisma.$executeRaw`DELETE FROM consumibles_venta_items WHERE id ILIKE 'phase17-%' OR venta_id ILIKE 'phase17-%'`
  await prisma.$executeRaw`DELETE FROM consumibles_ventas WHERE id ILIKE 'phase17-%' OR empresa_id ILIKE 'phase17-%' OR comprador_id ILIKE 'phase17-%'`
  await prisma.$executeRaw`DELETE FROM compradores WHERE id ILIKE 'phase17-%' OR empresa_id ILIKE 'phase17-%'`
  await prisma.$executeRaw`DELETE FROM barras WHERE id ILIKE 'phase17-%' OR empresa_id ILIKE 'phase17-%'`
  await prisma.$executeRaw`DELETE FROM consumibles WHERE id ILIKE 'phase17-%' OR empresa_id ILIKE 'phase17-%'`
  await prisma.$executeRaw`DELETE FROM eventos WHERE id ILIKE 'phase17-%' OR empresa_id ILIKE 'phase17-%'`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'phase17-%' OR slug ILIKE 'phase17-%'`
}

beforeEach(async () => {
  await cleanup()
})

after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

test('tenant mis-consumibles returns public consumable QR grouped by sale', async () => {
  const empresaId = 'phase17-emp-1'
  const eventoId = 'phase17-evt-1'
  const barraId = 'phase17-bar-1'
  const compraId = 'phase17-buy-1'
  const ventaId = 'phase17-sale-1'
  const consumibleId = 'phase17-con-1'
  const slug = 'phase17'

  // DDL no-op: venta_consumibles_habilitada already exists via Prisma migrations

  await prisma.$executeRaw`INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa) VALUES (${empresaId}, 'Empresa Phase17', ${slug}, 'phase17@example.com', ${TEST_PASSWORD_HASH}, 'Admin', true)`
  await prisma.$executeRaw`INSERT INTO compradores (id, empresa_id, nombre, email, password) VALUES (${compraId}, ${empresaId}, 'Comprador', 'comprador@phase17.com', ${TEST_PASSWORD_HASH})`
  await prisma.$executeRaw`INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, activo, venta_consumibles_habilitada) VALUES (${eventoId}, ${empresaId}, 'Evento Phase17', NULL, NULL, 'unica', true, true)`
  await prisma.$executeRaw`INSERT INTO barras (id, evento_id, empresa_id, nombre, activa) VALUES (${barraId}, ${eventoId}, ${empresaId}, 'Barra Norte', true)`
  await prisma.$executeRaw`INSERT INTO consumibles (id, empresa_id, nombre, descripcion, precio, activo) VALUES (${consumibleId}, ${empresaId}, 'Agua', NULL, 300, true)`

  // DDL no-op: comprador_id, checkout_session_id, origen already exist via Prisma migrations
  await prisma.$executeRaw`
    INSERT INTO consumibles_ventas (id, barra_id, evento_id, empresa_id, comprador_id, checkout_session_id, origen, qr_code, clave_corta, total, estado)
    VALUES (${ventaId}, ${barraId}, ${eventoId}, ${empresaId}, ${compraId}, 'phase17-checkout', 'tenant_publico', 'phase17-qr', 'PH17QR', 600, 'pendiente')
  `
  await prisma.$executeRaw`
    INSERT INTO consumibles_venta_items (id, venta_id, consumible_id, nombre_snapshot, precio_unitario, cantidad, subtotal)
    VALUES ('phase17-item-1', ${ventaId}, ${consumibleId}, 'Agua', 300, 2, 600)
  `

  const app = express()
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(`${server.baseUrl}/api/tenant/${slug}/mis-consumibles`, buildHeaders({ id: compraId, email: 'comprador@phase17.com', userType: 'comprador', empresa_id: empresaId, empresa_slug: slug, slug }))
    const payload = response.data as any
    assert.equal(response.status, 200)
    assert.equal(payload.data.ventas.length, 1)
    assert.equal(payload.data.ventas[0].barra_nombre, 'Barra Norte')
    assert.equal(payload.data.ventas[0].items[0].nombre, 'Agua')
  } finally {
    await server.close()
  }
})
