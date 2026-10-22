import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { Express } from 'express'
import express from 'express'
import pool from './db'
import consumiblesRouter from './routes/consumibles'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch

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

async function requestDelete(url: string, user: Record<string, unknown> | null = null) {
  const response = await originalFetch(url, {
    method: 'DELETE',
    headers: buildHeaders(user),
  })

  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS consumibles (
      id varchar(36) NOT NULL,
      empresa_id varchar(36) NOT NULL,
      nombre varchar(120) NOT NULL,
      descripcion text DEFAULT NULL,
      precio decimal(10,2) NOT NULL,
      imagen_url varchar(255) DEFAULT NULL,
      activo boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS barras (
      id varchar(36) NOT NULL,
      evento_id varchar(36) NOT NULL,
      empresa_id varchar(36) NOT NULL,
      nombre varchar(120) NOT NULL,
      activa boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS barra_stock (
      id varchar(36) NOT NULL,
      barra_id varchar(36) NOT NULL,
      consumible_id varchar(36) NOT NULL,
      stock_inicial int NOT NULL,
      stock_actual int NOT NULL,
      precio_override decimal(10,2) DEFAULT NULL,
      activo boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS barra_restock_alertas (
      id varchar(36) NOT NULL,
      empresa_id varchar(36) NOT NULL,
      evento_id varchar(36) NOT NULL,
      barra_id varchar(36) NOT NULL,
      barra_stock_id varchar(36) NOT NULL,
      consumible_id varchar(36) NOT NULL,
      estado text NOT NULL DEFAULT 'pendiente',
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS consumibles_promociones (
      id varchar(36) NOT NULL,
      empresa_id varchar(36) NOT NULL,
      evento_id varchar(36) DEFAULT NULL,
      nombre varchar(120) NOT NULL,
      descripcion text DEFAULT NULL,
      tipo text NOT NULL,
      valor decimal(10,2) NOT NULL,
      consumible_ids text NOT NULL,
      cantidad_minima int NOT NULL DEFAULT 1,
      activa boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS consumibles_ventas (
      id varchar(36) NOT NULL,
      barra_id varchar(36) NOT NULL,
      evento_id varchar(36) NOT NULL,
      empresa_id varchar(36) NOT NULL,
      usuario_id varchar(36) DEFAULT NULL,
      qr_code varchar(255) NOT NULL,
      clave_corta varchar(20) NOT NULL,
      total decimal(10,2) NOT NULL,
      descuento decimal(10,2) NOT NULL DEFAULT 0.00,
      promocion_id varchar(36) DEFAULT NULL,
      estado text NOT NULL DEFAULT 'pendiente',
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS consumibles_venta_items (
      id varchar(36) NOT NULL,
      venta_id varchar(36) NOT NULL,
      consumible_id varchar(36) NOT NULL,
      nombre_snapshot varchar(120) NOT NULL,
      precio_unitario decimal(10,2) NOT NULL,
      cantidad int NOT NULL,
      subtotal decimal(10,2) NOT NULL,
      PRIMARY KEY (id)
    )
  `)
}

async function cleanup() {
  await pool.query(`DELETE FROM consumibles_venta_items WHERE id LIKE 'phase9-%' OR venta_id LIKE 'phase9-%' OR consumible_id LIKE 'phase9-%'`)
  await pool.query(`DELETE FROM consumibles_ventas WHERE id LIKE 'phase9-%' OR empresa_id LIKE 'phase9-%'`)
  await pool.query(`DELETE FROM consumibles_promociones WHERE id LIKE 'phase9-%' OR empresa_id LIKE 'phase9-%'`)
  await pool.query(`DELETE FROM barra_restock_alertas WHERE id LIKE 'phase9-%' OR empresa_id LIKE 'phase9-%' OR consumible_id LIKE 'phase9-%'`)
  await pool.query(`DELETE FROM barra_stock WHERE id LIKE 'phase9-%' OR consumible_id LIKE 'phase9-%' OR barra_id LIKE 'phase9-%'`)
  await pool.query(`DELETE FROM barras WHERE id LIKE 'phase9-%' OR empresa_id LIKE 'phase9-%'`)
  await pool.query(`DELETE FROM consumibles WHERE id LIKE 'phase9-%' OR empresa_id LIKE 'phase9-%'`)
  await pool.query(`DELETE FROM empresas WHERE id LIKE 'phase9-%' OR slug LIKE 'phase9-%'`)
}

async function seedEmpresa(empresaId: string, slug: string) {
  await pool.query(
    `INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
     VALUES (?, ?, ?, ?, ?, ?, true)`,
    [empresaId, `Empresa ${slug}`, slug, `${slug}@example.com`, TEST_PASSWORD_HASH, `Admin ${slug}`]
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

test('deletes consumable physically when there are no references', async () => {
  const empresaId = 'phase9-emp-1'
  await seedEmpresa(empresaId, 'phase9-1')
  await pool.query(
    `INSERT INTO consumibles (id, empresa_id, nombre, precio, activo) VALUES (?, ?, ?, ?, true)`,
    ['phase9-cons-1', empresaId, 'Agua', 100]
  )

  const app = express()
  app.use('/api/consumibles', consumiblesRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestDelete(`${server.baseUrl}/api/consumibles/phase9-cons-1`, buildEmpresaUser(empresaId))
    assert.equal(response.status, 200)
    assert.equal(response.data.ok, true)

    const [rows] = await pool.query<any[]>(`SELECT COUNT(*) as total FROM consumibles WHERE id = ?`, ['phase9-cons-1'])
    assert.equal(rows[0].total, 0)
  } finally {
    await server.close()
  }
})

test('blocks consumable delete when stock references exist', async () => {
  const empresaId = 'phase9-emp-2'
  await seedEmpresa(empresaId, 'phase9-2')
  await pool.query(`INSERT INTO consumibles (id, empresa_id, nombre, precio, activo) VALUES (?, ?, ?, ?, true)`, ['phase9-cons-2', empresaId, 'Fernet', 200])
  await pool.query(`INSERT INTO barras (id, evento_id, empresa_id, nombre, activa) VALUES (?, ?, ?, ?, true)`, ['phase9-bar-1', 'phase9-evt-1', empresaId, 'Barra 1'])
  await pool.query(`INSERT INTO barra_stock (id, barra_id, consumible_id, stock_inicial, stock_actual, activo) VALUES (?, ?, ?, 10, 10, true)`, ['phase9-stock-1', 'phase9-bar-1', 'phase9-cons-2'])

  const app = express()
  app.use('/api/consumibles', consumiblesRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestDelete(`${server.baseUrl}/api/consumibles/phase9-cons-2`, buildEmpresaUser(empresaId))
    assert.equal(response.status, 400)
    assert.equal(response.data.error, 'No se puede eliminar el consumible porque tiene referencias activas o históricas. Desactivalo en su lugar.')

    const [rows] = await pool.query<any[]>(`SELECT COUNT(*) as total FROM consumibles WHERE id = ?`, ['phase9-cons-2'])
    assert.equal(rows[0].total, 1)
  } finally {
    await server.close()
  }
})

test('blocks consumable delete when historical sales references exist', async () => {
  const empresaId = 'phase9-emp-3'
  await seedEmpresa(empresaId, 'phase9-3')
  await pool.query(`INSERT INTO consumibles (id, empresa_id, nombre, precio, activo) VALUES (?, ?, ?, ?, true)`, ['phase9-cons-3', empresaId, 'Gin', 300])
  await pool.query(`INSERT INTO consumibles_ventas (id, barra_id, evento_id, empresa_id, qr_code, clave_corta, total, estado) VALUES (?, ?, ?, ?, ?, ?, ?, 'canjeado')`, ['phase9-venta-1', 'phase9-bar-x', 'phase9-evt-x', empresaId, 'qr-phase9', 'CLAVE9', 300])
  await pool.query(`INSERT INTO consumibles_venta_items (id, venta_id, consumible_id, nombre_snapshot, precio_unitario, cantidad, subtotal) VALUES (?, ?, ?, ?, ?, ?, ?)`, ['phase9-item-1', 'phase9-venta-1', 'phase9-cons-3', 'Gin', 300, 1, 300])

  const app = express()
  app.use('/api/consumibles', consumiblesRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestDelete(`${server.baseUrl}/api/consumibles/phase9-cons-3`, buildEmpresaUser(empresaId))
    assert.equal(response.status, 400)
    assert.equal(response.data.error, 'No se puede eliminar el consumible porque tiene referencias activas o históricas. Desactivalo en su lugar.')
  } finally {
    await server.close()
  }
})
