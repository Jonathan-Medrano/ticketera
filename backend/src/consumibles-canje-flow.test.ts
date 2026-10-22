import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import pool from './db'
import canjearRouter from './routes/canjear'

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

async function requestJson(url: string, body: unknown, headers: Record<string, string>) {
  const response = await originalFetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  const data = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function cleanup() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS consumibles_canje_auditoria (
      id varchar(36) NOT NULL,
      venta_id varchar(36) DEFAULT NULL,
      empresa_id varchar(36) NOT NULL,
      evento_id varchar(36) DEFAULT NULL,
      barra_id varchar(36) DEFAULT NULL,
      actor_id varchar(36) DEFAULT NULL,
      actor_type varchar(20) DEFAULT NULL,
      accion varchar(40) NOT NULL,
      codigo_ingresado varchar(255) DEFAULT NULL,
      motivo varchar(255) DEFAULT NULL,
      detalle_json text DEFAULT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id)
    )
  `)
  await pool.query(`DELETE FROM consumibles_canje_auditoria WHERE empresa_id LIKE 'phase16-%' OR venta_id LIKE 'phase16-%'`)
  await pool.query(`DELETE FROM consumibles_venta_items WHERE id LIKE 'phase16-%' OR venta_id LIKE 'phase16-%'`)
  await pool.query(`DELETE FROM consumibles_ventas WHERE id LIKE 'phase16-%' OR empresa_id LIKE 'phase16-%'`)
  await pool.query(`DELETE FROM barra_stock WHERE barra_id LIKE 'phase16-%' OR consumible_id LIKE 'phase16-%'`)
  await pool.query(`DELETE FROM barras WHERE id LIKE 'phase16-%' OR empresa_id LIKE 'phase16-%'`)
  await pool.query(`DELETE FROM consumibles WHERE id LIKE 'phase16-%' OR empresa_id LIKE 'phase16-%'`)
  await pool.query(`DELETE FROM eventos WHERE id LIKE 'phase16-%' OR empresa_id LIKE 'phase16-%'`)
  await pool.query(`DELETE FROM empresas WHERE id LIKE 'phase16-%' OR slug LIKE 'phase16-%'`)
}

beforeEach(async () => {
  await cleanup()
})

after(async () => {
  await cleanup()
  await pool.end()
})

test('consumibles redeem previews first and confirms only on explicit action', async () => {
  const empresaId = 'phase16-emp-1'
  const eventoId = 'phase16-evt-1'
  const barraId = 'phase16-bar-1'
  const ventaId = 'phase16-sale-1'
  const consumibleId = 'phase16-con-1'

  await pool.query(`ALTER TABLE eventos ADD COLUMN IF NOT EXISTS venta_consumibles_habilitada boolean NOT NULL DEFAULT false`)

  await pool.query(`INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa) VALUES (?, 'Empresa Phase16', 'phase16', 'phase16@example.com', ?, 'Admin', true)`, [empresaId, TEST_PASSWORD_HASH])
  await pool.query(`INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, activo, venta_consumibles_habilitada) VALUES (?, ?, 'Evento', NULL, NULL, 'unica', true, true)`, [eventoId, empresaId])
  await pool.query(`INSERT INTO barras (id, evento_id, empresa_id, nombre, activa) VALUES (?, ?, ?, 'Barra Norte', true)`, [barraId, eventoId, empresaId])
  await pool.query(`INSERT INTO consumibles (id, empresa_id, nombre, descripcion, precio, activo) VALUES (?, ?, 'Cerveza', NULL, 500, true)`, [consumibleId, empresaId])
  await pool.query(`INSERT INTO consumibles_ventas (id, barra_id, evento_id, empresa_id, qr_code, clave_corta, total, estado) VALUES (?, ?, ?, ?, 'phase16-qr', 'PHASE16', 1000, 'pendiente')`, [ventaId, barraId, eventoId, empresaId])
  await pool.query(`INSERT INTO consumibles_venta_items (id, venta_id, consumible_id, nombre_snapshot, precio_unitario, cantidad, subtotal) VALUES ('phase16-item-1', ?, ?, 'Cerveza', 500, 2, 1000)`, [ventaId, consumibleId])

  const app = express()
  app.use(express.json())
  app.use('/api/consumibles/canjear', canjearRouter)
  const server = await createTestServer(app)

  try {
    const headers = buildHeaders({ id: empresaId, email: 'phase16@example.com', userType: 'empresa', slug: 'phase16' })

    const preview = await requestJson(`${server.baseUrl}/api/consumibles/canjear`, { codigo: 'PHASE16', barra_id: barraId }, headers)
    const previewData = preview.data as any
    assert.equal(preview.status, 200)
    assert.equal(previewData.ok, true)
    assert.equal(previewData.items.length, 1)

    const [beforeRows] = await pool.query<any[]>(`SELECT estado FROM consumibles_ventas WHERE id = ?`, [ventaId])
    assert.equal(beforeRows[0].estado, 'pendiente')

    const confirm = await requestJson(`${server.baseUrl}/api/consumibles/canjear`, { accion: 'confirmar', venta_id: ventaId, barra_id: barraId }, headers)
    const confirmData = confirm.data as any
    assert.equal(confirm.status, 200)
    assert.equal(confirmData.ok, true)

    const [afterRows] = await pool.query<any[]>(`SELECT estado, canjeado_at FROM consumibles_ventas WHERE id = ?`, [ventaId])
    assert.equal(afterRows[0].estado, 'canjeado')
    assert.ok(afterRows[0].canjeado_at)
  } finally {
    await server.close()
  }
})
