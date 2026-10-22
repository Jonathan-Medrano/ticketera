/**
 * consumibles-summary.test.ts
 *
 * Integration tests for GET /api/consumibles/ventas/summary (Ventas Fase C1).
 * Validates:
 *   T1: Empty empresa returns zeros/nulls
 *   T2: pendiente + canjeado counted as vendidos, cancelado excluded
 *   T3: Empleado without ver_recaudacion → 403
 *   T4: Tenant scoping — ventas from another empresa NOT counted
 *
 * Run: cd backend && node --import tsx --import ./src/test-env.ts --test
 *        --test-concurrency=1 src/consumibles-summary.test.ts
 */

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import pool from './db'
import indexRouter from './routes/index'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

// ─── Constants ─────────────────────────────────────────────────────────────
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET!

const EMP = 'cvsum-emp'  // 9 chars
const USR = 'cvsum-usr'  // 9 chars
const EVT = 'cvsum-evt'  // 9 chars
const BAR = 'cvsum-bar'  // 9 chars

// ─── Helpers ───────────────────────────────────────────────────────────────

function buildHeaders(user: Record<string, unknown> | null = null) {
  return {
    'content-type': 'application/json',
    'x-internal-secret': INTERNAL_SECRET,
    'x-user': JSON.stringify(user),
  }
}

function buildEmpresaUser(empresaId: string) {
  return {
    id: empresaId,
    email: `${empresaId}@test.com`,
    userType: 'empresa' as const,
  }
}

function buildEmpleadoUser(
  userId: string,
  empresaId: string,
  permisos: Record<string, boolean> = {}
) {
  return {
    id: userId,
    email: `${userId}@test.com`,
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
        server.close((err) => (err ? reject(err) : resolve()))
      })
    },
  }
}

async function requestJson(url: string, user: Record<string, unknown>) {
  const response = await fetch(url, {
    method: 'GET',
    headers: buildHeaders(user) as Record<string, string>,
  })
  const data = await response.json().catch(() => null)
  return { status: response.status, data }
}

// ─── DB helpers ────────────────────────────────────────────────────────────

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS empresas (
      id varchar(36) NOT NULL,
      nombre varchar(100) NOT NULL DEFAULT '',
      slug varchar(100) NOT NULL DEFAULT '',
      email varchar(191) NOT NULL DEFAULT '',
      password varchar(255) NOT NULL DEFAULT '',
      admin_nombre varchar(100) NOT NULL DEFAULT '',
      activa boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id)
    )
  `)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id varchar(36) NOT NULL,
      empresa_id varchar(36) NOT NULL,
      nombre varchar(100) NOT NULL DEFAULT '',
      apellido varchar(100) NOT NULL DEFAULT '',
      email varchar(191) NOT NULL DEFAULT '',
      password varchar(255) NOT NULL DEFAULT '',
      rol varchar(50) NOT NULL DEFAULT 'vendedor',
      permisos text DEFAULT NULL,
      activo boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id)
    )
  `)
}

async function cleanup() {
  await pool.query(`DELETE FROM consumibles_ventas WHERE empresa_id LIKE '${EMP}%'`)
  await pool.query(`DELETE FROM barras WHERE empresa_id LIKE '${EMP}%'`)
  await pool.query(`DELETE FROM eventos WHERE empresa_id LIKE '${EMP}%'`)
  await pool.query(`DELETE FROM usuarios WHERE empresa_id LIKE '${EMP}%'`)
  await pool.query(`DELETE FROM empresas WHERE id LIKE '${EMP}%'`)
}

async function seedEmpresa(id: string) {
  await pool.query(
    `INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
     VALUES (?, ?, ?, ?, 'hash', 'Admin', true)
     ON CONFLICT (id) DO NOTHING`,
    [id, `Empresa ${id}`, `slug-${id}`, `${id}@test.com`]
  )
}

async function seedEmpleado(
  id: string,
  empresaId: string,
  permisos: Record<string, boolean>
) {
  await pool.query(
    `INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, permisos, activo)
     VALUES (?, ?, 'Empleado', 'Test', ?, 'hash', 'vendedor', ?, true)
     ON CONFLICT (id) DO NOTHING`,
    [id, empresaId, `${id}@test.com`, JSON.stringify(permisos)]
  )
}

async function seedEvento(params: { id: string; empresaId: string }) {
  await pool.query(
    `INSERT INTO eventos (id, empresa_id, nombre, activo, publication_mode, modo_fecha)
     VALUES (?, ?, ?, true, 'immediate', 'unica')
     ON CONFLICT (id) DO NOTHING`,
    [params.id, params.empresaId, `Evento ${params.id}`]
  )
}

async function seedBarra(params: { id: string; eventoId: string; empresaId: string }) {
  await pool.query(
    `INSERT INTO barras (id, evento_id, empresa_id, nombre, activa)
     VALUES (?, ?, ?, 'Barra Test', true)
     ON CONFLICT (id) DO NOTHING`,
    [params.id, params.eventoId, params.empresaId]
  )
}

let ventaCounter = 0

async function seedVenta(params: {
  empresaId: string
  barraId: string
  eventoId: string
  estado?: string
  total?: number
  ownerFeeAmount?: number
  mpFeeAmount?: number
  netoEmpresaAmount?: number | null
  deliveredAmount?: number | null
  createdAt?: string
}) {
  ventaCounter++
  const id = `cvsum-vta-${ventaCounter}`
  const suffix = String(ventaCounter).padStart(5, '0')
  const qrCode = `qr-cvsum-${suffix}`.slice(0, 100)
  const claveCorta = `CVSUM${suffix}`.slice(0, 20)

  const {
    empresaId,
    barraId,
    eventoId,
    estado = 'pendiente',
    total = 600,
    ownerFeeAmount = 60,
    mpFeeAmount = 30,
    netoEmpresaAmount = null,
    deliveredAmount = null,
    createdAt,
  } = params

  if (createdAt) {
    await pool.query(
      `INSERT INTO consumibles_ventas
        (id, barra_id, evento_id, empresa_id, qr_code, clave_corta, total, estado, owner_fee_amount, mp_fee_amount, neto_empresa_amount, delivered_amount, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      [id, barraId, eventoId, empresaId, qrCode, claveCorta, total, estado, ownerFeeAmount, mpFeeAmount, netoEmpresaAmount, deliveredAmount, createdAt]
    )
  } else {
    await pool.query(
      `INSERT INTO consumibles_ventas
        (id, barra_id, evento_id, empresa_id, qr_code, clave_corta, total, estado, owner_fee_amount, mp_fee_amount, neto_empresa_amount, delivered_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO NOTHING`,
      [id, barraId, eventoId, empresaId, qrCode, claveCorta, total, estado, ownerFeeAmount, mpFeeAmount, netoEmpresaAmount, deliveredAmount]
    )
  }
}

// ─── Test app ──────────────────────────────────────────────────────────────

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api', indexRouter)
  return app
}

// ─── Setup / Teardown ──────────────────────────────────────────────────────

before(async () => {
  await ensureSchema()
  await cleanup()
})

after(async () => {
  await cleanup()
  await pool.end()
})

// ─── Tests ─────────────────────────────────────────────────────────────────

// T1: Empty empresa returns zeros/nulls
test('cvsum-t1: empty empresa returns zeros and null ticket_promedio', async () => {
  const empresaId = `${EMP}-t1`
  await seedEmpresa(empresaId)

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/consumibles/ventas/summary`, user)

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const { periodo, ventas_por_dia } = (data as any).data

    assert.equal(periodo.hoy.vendidos, 0)
    assert.equal(periodo.hoy.brutos, 0)
    assert.equal(periodo.hoy.neto, 0)
    assert.equal(periodo.hoy.cancelados, 0)
    assert.equal(periodo.hoy.ticket_promedio_neto, null, 'ticket_promedio_neto must be null when no sales')
    assert.equal(periodo.ultimos_30d.tasa_cancelacion_pct, null, 'tasa_cancelacion_pct must be null when no entries')

    assert.equal(ventas_por_dia.length, 30, 'ventas_por_dia must have 30 entries')
    for (const dia of ventas_por_dia) {
      assert.equal(dia.vendidos, 0)
      assert.equal(dia.neto, 0)
    }
  } finally {
    await server.close()
  }
})

// T2: pendiente + canjeado counted in vendidos, cancelado excluded
test('cvsum-t2: pendiente and canjeado counted, cancelado excluded from vendidos', async () => {
  const empresaId = `${EMP}-t2`
  const eventoId = `${EVT}-t2-ev`
  const barraId = `${BAR}-t2-bar`

  await seedEmpresa(empresaId)
  await seedEvento({ id: eventoId, empresaId })
  await seedBarra({ id: barraId, eventoId, empresaId })

  // 1 pendiente + 1 canjeado + 1 cancelado
  // total=600, owner_fee=60, mp_fee=30 → neto = 600-60-30 = 510
  await seedVenta({ empresaId, barraId, eventoId, estado: 'pendiente', total: 600, ownerFeeAmount: 60, mpFeeAmount: 30 })
  await seedVenta({ empresaId, barraId, eventoId, estado: 'canjeado', total: 600, ownerFeeAmount: 60, mpFeeAmount: 30 })
  await seedVenta({ empresaId, barraId, eventoId, estado: 'cancelado', total: 600, ownerFeeAmount: 60, mpFeeAmount: 30 })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/consumibles/ventas/summary`, user)

    assert.equal(status, 200)
    const { periodo } = (data as any).data

    assert.equal(periodo.hoy.vendidos, 2, `Expected vendidos=2 (pendiente+canjeado), got ${periodo.hoy.vendidos}`)
    assert.equal(periodo.hoy.cancelados, 1, `Expected cancelados=1, got ${periodo.hoy.cancelados}`)
    // brutos: 2 * 600 = 1200
    assert.equal(periodo.hoy.brutos, 1200, `Expected brutos=1200, got ${periodo.hoy.brutos}`)
    // neto: 2 * (600-60-30) = 2 * 510 = 1020
    assert.equal(periodo.hoy.neto, 1020, `Expected neto=1020, got ${periodo.hoy.neto}`)
    // ticket_promedio_neto = 1020/2 = 510
    assert.equal(periodo.hoy.ticket_promedio_neto, 510, `Expected ticket_promedio_neto=510, got ${periodo.hoy.ticket_promedio_neto}`)
    // tasa_cancelacion_pct = 1/(2+1)*100 ≈ 33.33...
    const tasa = periodo.ultimos_30d.tasa_cancelacion_pct
    assert.ok(tasa !== null && Math.abs(tasa - 33.333333333333336) < 0.001, `Expected tasa≈33.33, got ${tasa}`)
  } finally {
    await server.close()
  }
})

// T3: Empleado without ver_recaudacion → 403
test('cvsum-t3: empleado without ver_recaudacion gets 403', async () => {
  const empresaId = `${EMP}-t3`
  const userId = `${USR}-t3`

  await seedEmpresa(empresaId)
  await seedEmpleado(userId, empresaId, { ver_consumibles: true }) // NOT ver_recaudacion

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpleadoUser(userId, empresaId, { ver_consumibles: true })
    const { status } = await requestJson(`${server.baseUrl}/api/consumibles/ventas/summary`, user)

    assert.equal(status, 403, `Expected 403 for empleado without ver_recaudacion, got ${status}`)
  } finally {
    await server.close()
  }
})

// T4: Tenant scoping enforced — ventas from another empresa NOT counted
test('cvsum-t4: ventas from another empresa are not counted', async () => {
  const empresaId = `${EMP}-t4a`
  const otraEmpresaId = `${EMP}-t4b`
  const eventoIdA = `${EVT}-t4a-ev`
  const eventoIdB = `${EVT}-t4b-ev`
  const barraIdA = `${BAR}-t4a-bar`
  const barraIdB = `${BAR}-t4b-bar`

  await seedEmpresa(empresaId)
  await seedEmpresa(otraEmpresaId)
  await seedEvento({ id: eventoIdA, empresaId })
  await seedEvento({ id: eventoIdB, empresaId: otraEmpresaId })
  await seedBarra({ id: barraIdA, eventoId: eventoIdA, empresaId })
  await seedBarra({ id: barraIdB, eventoId: eventoIdB, empresaId: otraEmpresaId })

  // 1 venta for empresaId, 3 for otraEmpresaId
  await seedVenta({ empresaId, barraId: barraIdA, eventoId: eventoIdA, estado: 'canjeado' })
  for (let i = 0; i < 3; i++) {
    await seedVenta({ empresaId: otraEmpresaId, barraId: barraIdB, eventoId: eventoIdB, estado: 'canjeado' })
  }

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/consumibles/ventas/summary`, user)

    assert.equal(status, 200)
    const { periodo } = (data as any).data

    assert.equal(periodo.hoy.vendidos, 1, `Expected vendidos=1 (only own empresa), got ${periodo.hoy.vendidos}`)
  } finally {
    await server.close()
  }
})
