/**
 * eventos-compare.test.ts
 *
 * Integration tests for GET /api/eventos/comparar — Section 3 of eventos-compare-mode Phase 2.
 * Validates:
 *   - Happy path: 2 and 4 events returned with full KPI fields
 *   - Deduplication: ids=a,a,b returns 2 events
 *   - HTTP 400 on fewer than 2 ids (after dedup + UUID filter)
 *   - HTTP 400 on more than 4 ids
 *   - Cross-tenant exclusion: ids from other empresa are silently excluded
 *   - All ids from another empresa → empty events array
 *   - Invalid UUID strings silently dropped before count check
 *   - Permission gating: empleado without ver_kpis_eventos → financial fields null
 *   - Permission OK: empleado with ver_kpis_eventos → financial fields present
 *   - Category mix correct: event with N categorias → category_mix with N entries
 *   - Category mix empty: event without categorias → category_mix: []
 *   - ocupacion_pct NOT returned by backend (frontend computes from entradas_vendidas/capacidad_total)
 *   - Order preservation: events returned in same order as ids param
 *
 * Run: cd backend && node --import tsx --import ./src/test-env.ts --test
 *        --test-concurrency=1 src/eventos-compare.test.ts
 *
 * NOTE: Tests run against XAMPP MariaDB 10.4 (port 3306), NOT Docker (port 3307).
 *       All test IDs kept <= 20 chars (varchar(36) with safe margin).
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

// Company/user IDs use short strings (not UUID-validated by the /comparar endpoint)
const EMP = 'cmp-l-emp'   // empresa_id prefix — 9 chars
const USR = 'cmp-l-usr'   // user_id prefix

// Evento IDs MUST be valid UUID format — /comparar endpoint runs isUuid() filter on the ids param.
// We use deterministic UUID-shaped IDs for each test slot (C1-C14).
// Format: 000000cc-0000-0000-0000-00000000XXYY where XX=test number, YY=event slot.
// These are valid UUID v4-like strings that pass the regex filter.
const EVT_IDS: Record<string, string> = {
  // C1
  'c1-ev1': '00000001-0000-0000-0000-000000000001',
  'c1-ev2': '00000001-0000-0000-0000-000000000002',
  'c1-cat1': '00000001-0000-0000-0000-000000000011',
  'c1-cat2': '00000001-0000-0000-0000-000000000012',
  // C2
  'c2-ev1': '00000002-0000-0000-0000-000000000001',
  'c2-ev2': '00000002-0000-0000-0000-000000000002',
  'c2-ev3': '00000002-0000-0000-0000-000000000003',
  'c2-ev4': '00000002-0000-0000-0000-000000000004',
  'c2-cat1': '00000002-0000-0000-0000-000000000011',
  'c2-cat2': '00000002-0000-0000-0000-000000000012',
  'c2-cat3': '00000002-0000-0000-0000-000000000013',
  'c2-cat4': '00000002-0000-0000-0000-000000000014',
  // C3
  'c3-evA': '00000003-0000-0000-0000-000000000001',
  'c3-evB': '00000003-0000-0000-0000-000000000002',
  'c3-catA': '00000003-0000-0000-0000-000000000011',
  'c3-catB': '00000003-0000-0000-0000-000000000012',
  // C4
  'c4-evA': '00000004-0000-0000-0000-000000000001',
  // C5
  'c5-ev1': '00000005-0000-0000-0000-000000000001',
  'c5-ev2': '00000005-0000-0000-0000-000000000002',
  'c5-ev3': '00000005-0000-0000-0000-000000000003',
  'c5-ev4': '00000005-0000-0000-0000-000000000004',
  'c5-ev5': '00000005-0000-0000-0000-000000000005',
  'c5-cat1': '00000005-0000-0000-0000-000000000011',
  'c5-cat2': '00000005-0000-0000-0000-000000000012',
  'c5-cat3': '00000005-0000-0000-0000-000000000013',
  'c5-cat4': '00000005-0000-0000-0000-000000000014',
  'c5-cat5': '00000005-0000-0000-0000-000000000015',
  // C6
  'c6-evA': '00000006-0000-0000-0000-000000000001',
  'c6-evB': '00000006-0000-0000-0000-000000000002',
  'c6-catA': '00000006-0000-0000-0000-000000000011',
  'c6-catB': '00000006-0000-0000-0000-000000000012',
  // C7
  'c7-evB1': '00000007-0000-0000-0000-000000000001',
  'c7-evB2': '00000007-0000-0000-0000-000000000002',
  'c7-catB1': '00000007-0000-0000-0000-000000000011',
  'c7-catB2': '00000007-0000-0000-0000-000000000012',
  // C8
  'c8-evA': '00000008-0000-0000-0000-000000000001',
  'c8-evB': '00000008-0000-0000-0000-000000000002',
  'c8-catA': '00000008-0000-0000-0000-000000000011',
  'c8-catB': '00000008-0000-0000-0000-000000000012',
  // C9
  'c9-ev1': '00000009-0000-0000-0000-000000000001',
  'c9-ev2': '00000009-0000-0000-0000-000000000002',
  'c9-cat1': '00000009-0000-0000-0000-000000000011',
  'c9-cat2': '00000009-0000-0000-0000-000000000012',
  // C10
  'c10-ev1': '00000010-0000-0000-0000-000000000001',
  'c10-ev2': '00000010-0000-0000-0000-000000000002',
  'c10-cat1': '00000010-0000-0000-0000-000000000011',
  'c10-cat2': '00000010-0000-0000-0000-000000000012',
  // C11
  'c11-ev1': '00000011-0000-0000-0000-000000000001',
  'c11-ev2': '00000011-0000-0000-0000-000000000002',
  'c11-vip': '00000011-0000-0000-0000-000000000011',
  'c11-gen': '00000011-0000-0000-0000-000000000012',
  'c11-other': '00000011-0000-0000-0000-000000000013',
  // C12
  'c12-nocat': '00000012-0000-0000-0000-000000000001',
  'c12-wcat': '00000012-0000-0000-0000-000000000002',
  'c12-cWith': '00000012-0000-0000-0000-000000000011',
  // C13
  'c13-ev1': '00000013-0000-0000-0000-000000000001',
  'c13-ev2': '00000013-0000-0000-0000-000000000002',
  'c13-cat1': '00000013-0000-0000-0000-000000000011',
  'c13-cat2': '00000013-0000-0000-0000-000000000012',
  // C14
  'c14-evC': '00000014-0000-0000-0000-000000000003',
  'c14-evA': '00000014-0000-0000-0000-000000000001',
  'c14-evB': '00000014-0000-0000-0000-000000000002',
  'c14-catC': '00000014-0000-0000-0000-000000000013',
  'c14-catA': '00000014-0000-0000-0000-000000000011',
  'c14-catB': '00000014-0000-0000-0000-000000000012',
}

// Helper to get a deterministic UUID for a given test slot key
function eid(key: string): string {
  const v = EVT_IDS[key]
  if (!v) throw new Error(`Unknown EVT_IDS key: ${key}`)
  return v
}

// EVT prefix for entradas and other non-UUID-validated IDs (can be short strings)
const EVT = 'cmp-l-evt'   // entrada/categoria id prefix for DB cleanup matching

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

async function requestJson(
  url: string,
  user: Record<string, unknown>,
  method: 'GET' | 'POST' = 'GET',
  body?: unknown
) {
  const response = await fetch(url, {
    method,
    headers: buildHeaders(user) as Record<string, string>,
    body: body !== undefined ? JSON.stringify(body) : undefined,
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
  // Clean up all seeded evento UUIDs
  const allEventoUuids = Object.values(EVT_IDS).filter((v) => v.startsWith('000000'))
  // Delete entradas and categorias referencing these eventos
  for (const uuid of allEventoUuids) {
    await pool.query(`DELETE FROM entradas WHERE evento_id = ?`, [uuid])
    await pool.query(`DELETE FROM entrada_categorias WHERE evento_id = ?`, [uuid])
  }
  // Delete all categorias seeded with UUID IDs (the categoria IDs are also in EVT_IDS)
  for (const uuid of allEventoUuids) {
    await pool.query(`DELETE FROM entrada_categorias WHERE id = ?`, [uuid])
    await pool.query(`DELETE FROM eventos WHERE id = ?`, [uuid])
  }
  // Also clean via empresa prefix (catches any stray rows)
  await pool.query(`DELETE FROM eventos WHERE empresa_id LIKE '${EMP}%'`)
  await pool.query(`DELETE FROM usuarios WHERE id LIKE '${USR}%' OR empresa_id LIKE '${EMP}%'`)
  await pool.query(`DELETE FROM empresas WHERE id LIKE '${EMP}%'`)
}

async function seedEmpresa(id: string) {
  await pool.query(
    `INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
     VALUES (?, ?, ?, ?, 'hash', 'Admin', true) ON CONFLICT DO NOTHING`,
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
     VALUES (?, ?, 'Empleado', 'Test', ?, 'hash', 'vendedor', ?, true) ON CONFLICT DO NOTHING`,
    [id, empresaId, `${id}@test.com`, JSON.stringify(permisos)]
  )
}

async function seedEvento(params: {
  id: string
  empresaId: string
  nombre?: string
  activo?: boolean
}) {
  const { id, empresaId, nombre = `Evento ${id}`, activo = true } = params
  await pool.query(
    `INSERT INTO eventos
      (id, empresa_id, nombre, activo, publication_mode, pre_publish_visibility, modo_fecha)
     VALUES (?, ?, ?, ?, 'immediate', 'hidden', 'unica') ON CONFLICT DO NOTHING`,
    [id, empresaId, nombre, activo]
  )
}

async function seedCategoria(params: {
  id: string
  eventoId: string
  nombre?: string
  stock?: number
  stockDisponible?: number
  precio?: number
}) {
  const { id, eventoId, nombre = 'General', stock = 100, stockDisponible = 50, precio = 1000 } = params
  await pool.query(
    `INSERT INTO entrada_categorias
      (id, evento_id, nombre, precio, stock, stock_disponible)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    [id, eventoId, nombre, precio, stock, stockDisponible]
  )
}

async function seedEntrada(params: {
  id: string
  eventoId: string
  categoriaId: string
  compradorId?: string
  estado?: string
  precioPagado?: number
  comision?: number
  mpFeeAmount?: number
  netoEmpresaAmount?: number | null
}) {
  const {
    id,
    eventoId,
    categoriaId,
    compradorId = `cmp-${id}`.slice(0, 36),
    estado = 'valida',
    precioPagado = 1000,
    comision = 100,
    mpFeeAmount = 50,
    netoEmpresaAmount = null,
  } = params

  const qrCode = `qr-${id}`.slice(0, 191)
  const claveCorta = `cc-${id.slice(-17)}`

  await pool.query(
    `INSERT INTO entradas
      (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado, precio_pagado, comision, mp_fee_amount, neto_empresa_amount)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    [id, eventoId, categoriaId, compradorId, qrCode, claveCorta, estado, precioPagado, comision, mpFeeAmount, netoEmpresaAmount]
  )
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

// C1: Happy path 2 events — admin user, returns 2 events with full KPI fields
test('comparar: C1 — empresa admin with 2 valid ids returns 2 events with full KPI fields', async () => {
  const empresaId = `${EMP}-c1`
  const ev1 = eid('c1-ev1')
  const ev2 = eid('c1-ev2')
  const cat1 = eid('c1-cat1')
  const cat2 = eid('c1-cat2')

  await seedEmpresa(empresaId)
  await seedEvento({ id: ev1, empresaId, nombre: 'Evento C1 Alpha' })
  await seedEvento({ id: ev2, empresaId, nombre: 'Evento C1 Beta' })
  await seedCategoria({ id: cat1, eventoId: ev1, stock: 100, stockDisponible: 97 })
  await seedCategoria({ id: cat2, eventoId: ev2, stock: 50, stockDisponible: 48 })

  // 3 entradas on ev1 → ingresos_bruto=3000, ingresos_neto=2550
  for (let i = 1; i <= 3; i++) {
    await seedEntrada({
      id: `${EVT}-c1-en1-${i}`,
      eventoId: ev1,
      categoriaId: cat1,
      estado: 'valida',
      precioPagado: 1000,
      comision: 100,
      mpFeeAmount: 50,
    })
  }
  // 2 entradas on ev2
  for (let i = 1; i <= 2; i++) {
    await seedEntrada({
      id: `${EVT}-c1-en2-${i}`,
      eventoId: ev2,
      categoriaId: cat2,
      estado: 'valida',
      precioPagado: 500,
      comision: 0,
      mpFeeAmount: 0,
    })
  }

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/comparar?ids=${ev1},${ev2}`,
      user
    )

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const d = (data as any).data
    assert.ok(d, 'Should have data property')
    assert.equal(d.events.length, 2, `Expected 2 events, got ${d.events.length}`)
    assert.equal(d.excluded_ids.length, 0, `Expected 0 excluded_ids, got ${d.excluded_ids.length}`)

    // Validate KPI fields on both events
    for (const ev of d.events) {
      assert.ok('ingresos_bruto' in ev, 'Event must have ingresos_bruto field')
      assert.ok('ingresos_neto' in ev, 'Event must have ingresos_neto field')
      assert.ok('ticket_promedio_bruto' in ev, 'Event must have ticket_promedio_bruto field')
      assert.ok('ticket_promedio_neto' in ev, 'Event must have ticket_promedio_neto field')
      assert.ok('ventas_7d' in ev, 'Event must have ventas_7d field')
      assert.ok(Array.isArray(ev.category_mix), 'Event must have category_mix array')
      // MariaDB returns SUM() aggregates as strings — check for presence and numeric coercibility
      assert.ok('capacidad_total' in ev, 'Event must have capacidad_total field')
      assert.ok('entradas_vendidas' in ev, 'Event must have entradas_vendidas field')
      assert.ok(!Number.isNaN(Number(ev.capacidad_total)), 'capacidad_total must be numeric-coercible')
      assert.ok(!Number.isNaN(Number(ev.entradas_vendidas)), 'entradas_vendidas must be numeric-coercible')
    }

    // Validate ev1 specific values
    const e1 = d.events.find((e: any) => e.id === ev1)
    assert.ok(e1, 'ev1 should be in response')
    assert.equal(e1.ingresos_bruto, 3000, `ingresos_bruto should be 3000, got ${e1.ingresos_bruto}`)
    assert.equal(e1.ingresos_neto, 2550, `ingresos_neto should be 2550, got ${e1.ingresos_neto}`)
    assert.ok(e1.ingresos_bruto > 0, 'ingresos_bruto should be > 0 for event with sales')
    assert.ok(e1.ingresos_neto > 0, 'ingresos_neto should be > 0 for event with sales')
    assert.ok(e1.ticket_promedio_bruto !== null, 'ticket_promedio_bruto should not be null when event has sales')
    assert.ok(e1.ticket_promedio_neto !== null, 'ticket_promedio_neto should not be null when event has sales')
    assert.ok(typeof e1.ventas_7d === 'number', 'ventas_7d should be a number')
  } finally {
    await server.close()
  }
})

// C2: Happy path 4 events — admin user, returns 4 events
test('comparar: C2 — empresa admin with 4 valid ids returns 4 events', async () => {
  const empresaId = `${EMP}-c2`

  await seedEmpresa(empresaId)
  const ids: string[] = []
  for (let i = 1; i <= 4; i++) {
    const evId = eid(`c2-ev${i}`)
    const catId = eid(`c2-cat${i}`)
    ids.push(evId)
    await seedEvento({ id: evId, empresaId, nombre: `Evento C2-${i}` })
    await seedCategoria({ id: catId, eventoId: evId, stock: 100, stockDisponible: 90 })
  }

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/comparar?ids=${ids.join(',')}`,
      user
    )

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const d = (data as any).data
    assert.equal(d.events.length, 4, `Expected 4 events, got ${d.events.length}`)
    assert.equal(d.excluded_ids.length, 0, `Expected 0 excluded_ids, got ${d.excluded_ids.length}`)
  } finally {
    await server.close()
  }
})

// C3: Deduplication — ids=a,a,b returns 2 events (not 3)
test('comparar: C3 — ids=a,a,b is deduplicated to 2 events', async () => {
  const empresaId = `${EMP}-c3`
  const evA = eid('c3-evA')
  const evB = eid('c3-evB')
  const catA = eid('c3-catA')
  const catB = eid('c3-catB')

  await seedEmpresa(empresaId)
  await seedEvento({ id: evA, empresaId })
  await seedEvento({ id: evB, empresaId })
  await seedCategoria({ id: catA, eventoId: evA })
  await seedCategoria({ id: catB, eventoId: evB })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    // Send evA twice + evB once
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/comparar?ids=${evA},${evA},${evB}`,
      user
    )

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const d = (data as any).data
    assert.equal(d.events.length, 2, `After dedup ids=a,a,b should return 2 events, got ${d.events.length}`)
  } finally {
    await server.close()
  }
})

// C4: HTTP 400 on 1 id (below minimum)
test('comparar: C4 — single id returns HTTP 400 with correct error message', async () => {
  const empresaId = `${EMP}-c4`
  const evA = eid('c4-evA')

  await seedEmpresa(empresaId)
  await seedEvento({ id: evA, empresaId })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/comparar?ids=${evA}`,
      user
    )

    assert.equal(status, 400, `Expected 400, got ${status}: ${JSON.stringify(data)}`)
    assert.equal(
      (data as any).error,
      'Se requieren al menos 2 eventos para comparar',
      `Expected min-count error message, got: ${(data as any).error}`
    )
  } finally {
    await server.close()
  }
})

// C5: HTTP 400 on 5 ids (above maximum)
test('comparar: C5 — 5 ids returns HTTP 400 with correct error message', async () => {
  const empresaId = `${EMP}-c5`
  const ids: string[] = []

  await seedEmpresa(empresaId)
  for (let i = 1; i <= 5; i++) {
    const evId = eid(`c5-ev${i}`)
    const catId = eid(`c5-cat${i}`)
    ids.push(evId)
    await seedEvento({ id: evId, empresaId })
    await seedCategoria({ id: catId, eventoId: evId })
  }

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/comparar?ids=${ids.join(',')}`,
      user
    )

    assert.equal(status, 400, `Expected 400, got ${status}: ${JSON.stringify(data)}`)
    assert.equal(
      (data as any).error,
      'Máximo 4 eventos comparables',
      `Expected max-count error message, got: ${(data as any).error}`
    )
  } finally {
    await server.close()
  }
})

// C6: Cross-tenant exclusion — 1 of 2 ids belongs to another empresa → excluded silently
test('comparar: C6 — cross-tenant id silently excluded, returns 1 event with excluded_ids', async () => {
  const empresaA = `${EMP}-c6A`
  const empresaB = `${EMP}-c6B`
  const evA = eid('c6-evA')
  const evB = eid('c6-evB')
  const catA = eid('c6-catA')
  const catB = eid('c6-catB')

  await seedEmpresa(empresaA)
  await seedEmpresa(empresaB)
  await seedEvento({ id: evA, empresaId: empresaA })
  await seedEvento({ id: evB, empresaId: empresaB })
  await seedCategoria({ id: catA, eventoId: evA })
  await seedCategoria({ id: catB, eventoId: evB })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    // Request as empresa A user — asks for own event + empresa B event
    const user = buildEmpresaUser(empresaA)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/comparar?ids=${evA},${evB}`,
      user
    )

    assert.equal(status, 200, `Expected 200 (not 403), got ${status}: ${JSON.stringify(data)}`)
    const d = (data as any).data
    assert.equal(d.events.length, 1, `Expected 1 event (own), got ${d.events.length}`)
    assert.equal(d.events[0].id, evA, `Expected own event evA, got ${d.events[0].id}`)
    assert.ok(d.excluded_ids.includes(evB), `excluded_ids should contain evB, got ${JSON.stringify(d.excluded_ids)}`)
    // No error message about the foreign id
    assert.ok(!(data as any).error, 'Should not have top-level error when cross-tenant id is silently excluded')
  } finally {
    await server.close()
  }
})

// C7: All ids from another empresa → empty events array
test('comparar: C7 — all ids from another empresa returns empty events array', async () => {
  const empresaA = `${EMP}-c7A`
  const empresaB = `${EMP}-c7B`
  const evB1 = eid('c7-evB1')
  const evB2 = eid('c7-evB2')
  const catB1 = eid('c7-catB1')
  const catB2 = eid('c7-catB2')

  await seedEmpresa(empresaA)
  await seedEmpresa(empresaB)
  await seedEvento({ id: evB1, empresaId: empresaB })
  await seedEvento({ id: evB2, empresaId: empresaB })
  await seedCategoria({ id: catB1, eventoId: evB1 })
  await seedCategoria({ id: catB2, eventoId: evB2 })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    // empresa A user asks for 2 empresa B events
    const user = buildEmpresaUser(empresaA)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/comparar?ids=${evB1},${evB2}`,
      user
    )

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const d = (data as any).data
    assert.equal(d.events.length, 0, `Expected 0 events (all cross-tenant), got ${d.events.length}`)
    assert.equal(d.excluded_ids.length, 2, `Expected 2 excluded_ids, got ${d.excluded_ids.length}`)
    assert.ok(d.excluded_ids.includes(evB1), 'evB1 should be in excluded_ids')
    assert.ok(d.excluded_ids.includes(evB2), 'evB2 should be in excluded_ids')
  } finally {
    await server.close()
  }
})

// C8: Invalid UUID format → silently dropped, valid ids still processed
test('comparar: C8 — invalid UUID strings silently dropped, valid ids still returned', async () => {
  const empresaId = `${EMP}-c8`
  const evA = eid('c8-evA')
  const evB = eid('c8-evB')
  const catA = eid('c8-catA')
  const catB = eid('c8-catB')

  await seedEmpresa(empresaId)
  await seedEvento({ id: evA, empresaId })
  await seedEvento({ id: evB, empresaId })
  await seedCategoria({ id: catA, eventoId: evA })
  await seedCategoria({ id: catB, eventoId: evB })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    // Mix: 2 invalid UUID strings + 2 valid ids
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/comparar?ids=not-a-uuid,also-invalid,${evA},${evB}`,
      user
    )

    assert.equal(status, 200, `Expected 200 (invalid UUIDs silently dropped), got ${status}: ${JSON.stringify(data)}`)
    const d = (data as any).data
    assert.equal(d.events.length, 2, `Expected 2 valid events returned, got ${d.events.length}`)
    const returnedIds = d.events.map((e: any) => e.id)
    assert.ok(returnedIds.includes(evA), 'evA should be in response')
    assert.ok(returnedIds.includes(evB), 'evB should be in response')
  } finally {
    await server.close()
  }
})

// C9: Permission gating — empleado without ver_kpis_eventos → financial fields null
test('comparar: C9 — empleado without ver_kpis_eventos gets null financial fields', async () => {
  const empresaId = `${EMP}-c9`
  const userId = `${USR}-c9`
  const ev1 = eid('c9-ev1')
  const ev2 = eid('c9-ev2')
  const cat1 = eid('c9-cat1')
  const cat2 = eid('c9-cat2')

  await seedEmpresa(empresaId)
  await seedEmpleado(userId, empresaId, { ver_eventos: true, ver_kpis_eventos: false })
  await seedEvento({ id: ev1, empresaId })
  await seedEvento({ id: ev2, empresaId })
  await seedCategoria({ id: cat1, eventoId: ev1, stock: 100, stockDisponible: 98 })
  await seedCategoria({ id: cat2, eventoId: ev2, stock: 50, stockDisponible: 49 })
  await seedEntrada({
    id: `${EVT}-c9-en1`,
    eventoId: ev1,
    categoriaId: cat1,
    estado: 'valida',
    precioPagado: 1000,
    comision: 100,
    mpFeeAmount: 50,
  })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpleadoUser(userId, empresaId, { ver_eventos: true, ver_kpis_eventos: false })
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/comparar?ids=${ev1},${ev2}`,
      user
    )

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const d = (data as any).data
    assert.equal(d.events.length, 2, `Expected 2 events, got ${d.events.length}`)

    for (const ev of d.events) {
      // Financial fields must be null (stripped server-side)
      assert.equal(ev.ingresos_bruto, null, `ingresos_bruto should be null for unpermissioned empleado, got ${ev.ingresos_bruto}`)
      assert.equal(ev.ingresos_neto, null, `ingresos_neto should be null, got ${ev.ingresos_neto}`)
      assert.equal(ev.ticket_promedio_bruto, null, `ticket_promedio_bruto should be null, got ${ev.ticket_promedio_bruto}`)
      assert.equal(ev.ticket_promedio_neto, null, `ticket_promedio_neto should be null, got ${ev.ticket_promedio_neto}`)
      assert.equal(ev.ventas_7d, null, `ventas_7d should be null, got ${ev.ventas_7d}`)
      // Operational fields must still be present (MariaDB SUM() returns strings — check presence + coercibility)
      assert.ok('capacidad_total' in ev, 'capacidad_total should still be present')
      assert.ok('entradas_vendidas' in ev, 'entradas_vendidas should still be present')
      assert.ok(!Number.isNaN(Number(ev.capacidad_total)), 'capacidad_total must be numeric-coercible')
      assert.ok(!Number.isNaN(Number(ev.entradas_vendidas)), 'entradas_vendidas must be numeric-coercible')
    }
  } finally {
    await server.close()
  }
})

// C10: Permission OK — empleado with ver_kpis_eventos → financial fields present
test('comparar: C10 — empleado with ver_kpis_eventos gets financial fields populated', async () => {
  const empresaId = `${EMP}-c10`
  const userId = `${USR}-c10`
  const ev1 = eid('c10-ev1')
  const ev2 = eid('c10-ev2')
  const cat1 = eid('c10-cat1')
  const cat2 = eid('c10-cat2')

  await seedEmpresa(empresaId)
  await seedEmpleado(userId, empresaId, { ver_eventos: true, ver_kpis_eventos: true })
  await seedEvento({ id: ev1, empresaId })
  await seedEvento({ id: ev2, empresaId })
  await seedCategoria({ id: cat1, eventoId: ev1, stock: 100, stockDisponible: 98 })
  await seedCategoria({ id: cat2, eventoId: ev2, stock: 50, stockDisponible: 48 })
  await seedEntrada({
    id: `${EVT}-c10-en1`,
    eventoId: ev1,
    categoriaId: cat1,
    estado: 'valida',
    precioPagado: 1500,
    comision: 150,
    mpFeeAmount: 75,
  })
  await seedEntrada({
    id: `${EVT}-c10-en2`,
    eventoId: ev2,
    categoriaId: cat2,
    estado: 'valida',
    precioPagado: 800,
    comision: 80,
    mpFeeAmount: 40,
  })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpleadoUser(userId, empresaId, { ver_eventos: true, ver_kpis_eventos: true })
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/comparar?ids=${ev1},${ev2}`,
      user
    )

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const d = (data as any).data
    assert.equal(d.events.length, 2, `Expected 2 events, got ${d.events.length}`)

    for (const ev of d.events) {
      assert.ok(ev.ingresos_bruto !== null, `ingresos_bruto should not be null for permissioned empleado`)
      assert.ok(ev.ingresos_neto !== null, `ingresos_neto should not be null`)
    }
    // ev1: bruto=1500, neto=1500-150-75=1275
    const e1 = d.events.find((e: any) => e.id === ev1)
    assert.ok(e1, 'ev1 should be in response')
    assert.equal(e1.ingresos_bruto, 1500, `ingresos_bruto should be 1500, got ${e1.ingresos_bruto}`)
    assert.equal(e1.ingresos_neto, 1275, `ingresos_neto should be 1275, got ${e1.ingresos_neto}`)
  } finally {
    await server.close()
  }
})

// C11: Category mix correct — event with 2 categorias → category_mix has 2 entries with correct values
test('comparar: C11 — category_mix has correct entries for events with categorias', async () => {
  const empresaId = `${EMP}-c11`
  const ev1 = eid('c11-ev1')
  const ev2 = eid('c11-ev2')
  const catVip = eid('c11-vip')
  const catGen = eid('c11-gen')
  const catOther = eid('c11-other')

  await seedEmpresa(empresaId)
  await seedEvento({ id: ev1, empresaId })
  await seedEvento({ id: ev2, empresaId })

  // ev1 has 2 categorias: VIP (stock=100, available=95 → vendidas=5) and General (stock=200, available=180 → vendidas=20)
  await seedCategoria({ id: catVip, eventoId: ev1, nombre: 'VIP', stock: 100, stockDisponible: 95, precio: 2000 })
  await seedCategoria({ id: catGen, eventoId: ev1, nombre: 'General', stock: 200, stockDisponible: 180, precio: 1000 })
  // ev2 has 1 categoria
  await seedCategoria({ id: catOther, eventoId: ev2, nombre: 'General', stock: 50, stockDisponible: 40, precio: 500 })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/comparar?ids=${ev1},${ev2}`,
      user
    )

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const d = (data as any).data

    const e1 = d.events.find((e: any) => e.id === ev1)
    assert.ok(e1, 'ev1 should be in response')
    assert.equal(e1.category_mix.length, 2, `ev1 should have 2 category_mix entries, got ${e1.category_mix.length}`)

    const vipMix = e1.category_mix.find((c: any) => c.nombre === 'VIP')
    assert.ok(vipMix, 'VIP category should be in category_mix')
    assert.equal(vipMix.vendidas, 5, `VIP vendidas should be 5, got ${vipMix.vendidas}`)
    assert.equal(vipMix.total, 100, `VIP total should be 100, got ${vipMix.total}`)
    assert.ok(vipMix.pct !== null, 'VIP pct should not be null')
    assert.ok(Math.abs(vipMix.pct - 5.0) < 0.1, `VIP pct should be ~5.0, got ${vipMix.pct}`)

    const genMix = e1.category_mix.find((c: any) => c.nombre === 'General')
    assert.ok(genMix, 'General category should be in category_mix')
    assert.equal(genMix.vendidas, 20, `General vendidas should be 20, got ${genMix.vendidas}`)
    assert.equal(genMix.total, 200, `General total should be 200, got ${genMix.total}`)
    assert.ok(Math.abs(genMix.pct - 10.0) < 0.1, `General pct should be ~10.0, got ${genMix.pct}`)
  } finally {
    await server.close()
  }
})

// C12: Category mix empty — event without categorias → category_mix: []
test('comparar: C12 — event without categorias has empty category_mix array (not null)', async () => {
  const empresaId = `${EMP}-c12`
  const evNoCat = eid('c12-nocat')
  const evWithCat = eid('c12-wcat')
  const catWith = eid('c12-cWith')

  await seedEmpresa(empresaId)
  // evNoCat: seeded with NO categoria rows
  await seedEvento({ id: evNoCat, empresaId, nombre: 'Event No Categories' })
  // evWithCat: has 1 categoria (needed as the 2nd event for valid compare call)
  await seedEvento({ id: evWithCat, empresaId, nombre: 'Event With Category' })
  await seedCategoria({ id: catWith, eventoId: evWithCat, stock: 50, stockDisponible: 45 })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/comparar?ids=${evNoCat},${evWithCat}`,
      user
    )

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const d = (data as any).data

    const evNoC = d.events.find((e: any) => e.id === evNoCat)
    assert.ok(evNoC, 'evNoCat should be in response')
    assert.ok(Array.isArray(evNoC.category_mix), 'category_mix should be an array, not null or undefined')
    assert.equal(evNoC.category_mix.length, 0, `category_mix should be empty [] for event without categorias, got length ${evNoC.category_mix.length}`)
  } finally {
    await server.close()
  }
})

// C13: ocupacion_pct NOT in backend response — frontend computes from entradas_vendidas/capacidad_total
test('comparar: C13 — backend does not return ocupacion_pct (frontend computes it)', async () => {
  const empresaId = `${EMP}-c13`
  const ev1 = eid('c13-ev1')
  const ev2 = eid('c13-ev2')
  const cat1 = eid('c13-cat1')
  const cat2 = eid('c13-cat2')

  await seedEmpresa(empresaId)
  // ev1: capacidad_total=200 (stock=200), entradas_vendidas=50 (stockDisponible=150 → 200-150=50)
  await seedEvento({ id: ev1, empresaId })
  await seedCategoria({ id: cat1, eventoId: ev1, stock: 200, stockDisponible: 150, precio: 1000 })
  // ev2: second event to make the call valid
  await seedEvento({ id: ev2, empresaId })
  await seedCategoria({ id: cat2, eventoId: ev2, stock: 100, stockDisponible: 90, precio: 500 })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/comparar?ids=${ev1},${ev2}`,
      user
    )

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const d = (data as any).data

    const e1 = d.events.find((e: any) => e.id === ev1)
    assert.ok(e1, 'ev1 should be in response')

    // CRITICAL: ocupacion_pct must NOT be present in the response
    assert.equal(e1.ocupacion_pct, undefined, `ocupacion_pct should be undefined (not sent by backend), got ${e1.ocupacion_pct}`)

    // BUT the source fields for frontend computation must be correct
    // MariaDB SUM() returns strings — use Number() for numeric comparison
    assert.equal(Number(e1.capacidad_total), 200, `capacidad_total should be 200, got ${e1.capacidad_total}`)
    assert.equal(Number(e1.entradas_vendidas), 50, `entradas_vendidas should be 50 (200-150), got ${e1.entradas_vendidas}`)
  } finally {
    await server.close()
  }
})

// C14: Order preservation — events returned in same order as ids param
test('comparar: C14 — events returned in same order as the ids query param', async () => {
  const empresaId = `${EMP}-c14`
  const evC = eid('c14-evC')
  const evA = eid('c14-evA')
  const evB = eid('c14-evB')
  const catC = eid('c14-catC')
  const catA = eid('c14-catA')
  const catB = eid('c14-catB')

  await seedEmpresa(empresaId)
  // Seed in A,B,C order — but request in C,A,B order to verify response preserves request order
  await seedEvento({ id: evA, empresaId, nombre: 'Alpha' })
  await seedEvento({ id: evB, empresaId, nombre: 'Beta' })
  await seedEvento({ id: evC, empresaId, nombre: 'Gamma' })
  await seedCategoria({ id: catA, eventoId: evA })
  await seedCategoria({ id: catB, eventoId: evB })
  await seedCategoria({ id: catC, eventoId: evC })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    // Request order: C, A, B
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/comparar?ids=${evC},${evA},${evB}`,
      user
    )

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const d = (data as any).data
    assert.equal(d.events.length, 3, `Expected 3 events, got ${d.events.length}`)

    // Response must mirror the request order: C, A, B
    assert.equal(d.events[0].id, evC, `First event should be evC, got ${d.events[0].id}`)
    assert.equal(d.events[1].id, evA, `Second event should be evA, got ${d.events[1].id}`)
    assert.equal(d.events[2].id, evB, `Third event should be evB, got ${d.events[2].id}`)
  } finally {
    await server.close()
  }
})
