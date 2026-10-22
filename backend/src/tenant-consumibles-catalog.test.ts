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

function buildHeaders() {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
    'x-user': 'null',
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

async function requestJson(url: string) {
  const response = await originalFetch(url, { method: 'GET', headers: buildHeaders() })
  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function seedEmpresa(empresaId: string, slug: string) {
  await prisma.$executeRaw`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES (${empresaId}, ${`Empresa ${slug}`}, ${slug}, ${`${slug}@example.com`}, ${TEST_PASSWORD_HASH}, 'Admin', true)
  `
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM barra_stock WHERE id ILIKE 'phase15-stock-%' OR barra_id ILIKE 'phase15-bar-%' OR consumible_id ILIKE 'phase15-con-%'`
  await prisma.$executeRaw`DELETE FROM barras WHERE id ILIKE 'phase15-bar-%' OR empresa_id ILIKE 'phase15-emp-%'`
  await prisma.$executeRaw`DELETE FROM consumibles WHERE id ILIKE 'phase15-con-%' OR empresa_id ILIKE 'phase15-emp-%'`
  await prisma.$executeRaw`DELETE FROM evento_fechas WHERE evento_id ILIKE 'phase15-evt-%'`
  await prisma.$executeRaw`DELETE FROM evento_tandas WHERE evento_id ILIKE 'phase15-evt-%'`
  await prisma.$executeRaw`DELETE FROM eventos WHERE id ILIKE 'phase15-evt-%' OR empresa_id ILIKE 'phase15-emp-%'`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'phase15-emp-%' OR slug ILIKE 'phase15-%'`
}

beforeEach(async () => {
  await cleanup()
})

after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

test('tenant consumables catalog returns active bars/items only when event public sale is enabled', async () => {
  const empresaId = 'phase15-emp-1'
  const slug = 'phase15-1'
  const eventoId = 'phase15-evt-1'
  await seedEmpresa(empresaId, slug)
  await prisma.$executeRaw`
    INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo, venta_consumibles_habilitada)
    VALUES (${eventoId}, ${empresaId}, 'Evento Consumos', NULL, NULL, 'unica', NULL, true, true)
  `
  await prisma.$executeRaw`
    INSERT INTO barras (id, evento_id, empresa_id, nombre, activa)
    VALUES ('phase15-bar-1', ${eventoId}, ${empresaId}, 'Barra Norte', true),
           ('phase15-bar-2', ${eventoId}, ${empresaId}, 'Barra Sur', false)
  `
  await prisma.$executeRaw`
    INSERT INTO consumibles (id, empresa_id, nombre, descripcion, precio, imagen_url, activo)
    VALUES ('phase15-con-1', ${empresaId}, 'Cerveza', NULL, 500, NULL, true),
           ('phase15-con-2', ${empresaId}, 'Inactivo', NULL, 700, NULL, false)
  `
  await prisma.$executeRaw`
    INSERT INTO barra_stock (id, barra_id, consumible_id, stock_inicial, stock_actual, precio_override, activo)
    VALUES ('phase15-stock-1', 'phase15-bar-1', 'phase15-con-1', 10, 8, NULL, true),
           ('phase15-stock-2', 'phase15-bar-1', 'phase15-con-2', 10, 0, NULL, true),
           ('phase15-stock-3', 'phase15-bar-2', 'phase15-con-1', 10, 5, NULL, true)
  `

  const app = express()
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(`${server.baseUrl}/api/tenant/${slug}/evento/${eventoId}/consumibles`)
    assert.equal(response.status, 200)
    assert.equal(response.data.data.barras.length, 1)
    assert.equal(response.data.data.barras[0].nombre, 'Barra Norte')
    assert.equal(response.data.data.barras[0].items.length, 1)
    assert.equal(response.data.data.barras[0].items[0].nombre, 'Cerveza')
  } finally {
    await server.close()
  }
})
