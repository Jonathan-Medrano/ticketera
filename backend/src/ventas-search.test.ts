import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import pool from './db'
import ventasRouter from './routes/ventas'

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
  await pool.query(`DELETE FROM consumibles_venta_items WHERE id LIKE 'phase18-%' OR venta_id LIKE 'phase18-%'`)
  await pool.query(`DELETE FROM consumibles_ventas WHERE id LIKE 'phase18-%' OR empresa_id LIKE 'phase18-%'`)
  await pool.query(`DELETE FROM barras WHERE id LIKE 'phase18-%' OR empresa_id LIKE 'phase18-%'`)
  await pool.query(`DELETE FROM consumibles WHERE id LIKE 'phase18-%' OR empresa_id LIKE 'phase18-%'`)
  await pool.query(`DELETE FROM eventos WHERE id LIKE 'phase18-%' OR empresa_id LIKE 'phase18-%'`)
  await pool.query(`DELETE FROM empresas WHERE id LIKE 'phase18-%' OR slug LIKE 'phase18-%'`)
}

beforeEach(async () => {
  await cleanup()
})

after(async () => {
  await cleanup()
  await pool.end()
})

test('consumibles ventas search filters list, stats, and event summary by item snapshot matches', async () => {
  const empresaId = 'phase18-emp-1'
  const eventoGinId = 'phase18-evt-1'
  const eventoAguaId = 'phase18-evt-2'
  const barraGinId = 'phase18-bar-1'
  const barraAguaId = 'phase18-bar-2'
  const ventaGinId = 'phase18-sale-1'
  const ventaAguaId = 'phase18-sale-2'
  const consumibleGinId = 'phase18-con-1'
  const consumibleAguaId = 'phase18-con-2'
  const slug = 'phase18'

  await pool.query(
    `INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
     VALUES (?, 'Empresa Phase18', ?, 'phase18@example.com', ?, 'Admin', true)`,
    [empresaId, slug, TEST_PASSWORD_HASH]
  )
  await pool.query(
    `INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, activo)
     VALUES (?, ?, 'Festival Norte', NULL, NULL, 'unica', true), (?, ?, 'Expo Agua', NULL, NULL, 'unica', true)`,
    [eventoGinId, empresaId, eventoAguaId, empresaId]
  )
  await pool.query(
    `INSERT INTO barras (id, evento_id, empresa_id, nombre, activa)
     VALUES (?, ?, ?, 'Barra Azul', true), (?, ?, ?, 'Barra Verde', true)`,
    [barraGinId, eventoGinId, empresaId, barraAguaId, eventoAguaId, empresaId]
  )
  await pool.query(
    `INSERT INTO consumibles (id, empresa_id, nombre, descripcion, precio, activo)
     VALUES (?, ?, 'Combo noche', NULL, 1500, true), (?, ?, 'Agua', NULL, 500, true)`,
    [consumibleGinId, empresaId, consumibleAguaId, empresaId]
  )
  await pool.query(
    `INSERT INTO consumibles_ventas (id, barra_id, evento_id, empresa_id, qr_code, clave_corta, total, estado)
     VALUES (?, ?, ?, ?, 'phase18-qr-1', 'VX001', 1500, 'pendiente'), (?, ?, ?, ?, 'phase18-qr-2', 'VX002', 500, 'pendiente')`,
    [ventaGinId, barraGinId, eventoGinId, empresaId, ventaAguaId, barraAguaId, eventoAguaId, empresaId]
  )
  await pool.query(
    `INSERT INTO consumibles_venta_items (id, venta_id, consumible_id, nombre_snapshot, precio_unitario, cantidad, subtotal)
     VALUES
     ('phase18-item-1', ?, ?, 'Gin tonic premium', 1500, 1, 1500),
     ('phase18-item-2', ?, ?, 'Agua sin gas', 500, 1, 500)`,
    [ventaGinId, consumibleGinId, ventaAguaId, consumibleAguaId]
  )

  const app = express()
  app.use('/api/consumibles/ventas', ventasRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      `${server.baseUrl}/api/consumibles/ventas?busqueda=tonic`,
      buildHeaders({ id: empresaId, userType: 'empresa' })
    )
    const payload = response.data as any

    assert.equal(response.status, 200)
    assert.equal(payload.pagination.total, 1)
    assert.equal(payload.data.ventas.length, 1)
    assert.equal(payload.data.ventas[0].id, ventaGinId)
    assert.equal(payload.data.stats.total_tickets, 1)
    assert.equal(payload.data.ingresos_por_evento.length, 1)
    assert.equal(payload.data.ingresos_por_evento[0].evento_id, eventoGinId)
  } finally {
    await server.close()
  }
})
