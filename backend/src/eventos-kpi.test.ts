/**
 * eventos-kpi.test.ts
 *
 * Integration tests for Section 3 — Backend list endpoint extension (eventos-kpi-summary change).
 * Validates:
 *   - GET /api/eventos returns ingresos_neto, ticket_promedio, ventas_7d for admin users
 *   - GET /api/eventos strips financial fields (null) for empleado without ver_kpis_eventos
 *   - ventas_7d counts only estado IN ('valida', 'usada') within last 7 days
 *   - Sort by gated keys returns 400 when user lacks ver_kpis_eventos
 *   - Sort by ocupacion works for users WITHOUT ver_kpis_eventos (NOT gated)
 *   - Sort by ingresos orders correctly
 *   - Sort by ocupacion handles NULLS LAST (capacidad=0 events)
 *   - publication_status filter works for all valid values
 *   - publication_status=manual_inactive filters activo=0 events
 *
 * Run: cd backend && node --import tsx --import ./src/test-env.ts --test
 *        --test-concurrency=1 src/eventos-kpi.test.ts
 *
 * NOTE: Tests run against XAMPP MariaDB 10.4 (port 3306), NOT Docker (port 3307).
 *       MariaDB JSON_EXTRACT returns booleans as string 'true'/'false'.
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

// All test IDs <= 20 chars (varchar(36) with safe margin)
const EMP = 'kpi-l-emp'   // empresa_id prefix — 9 chars
const USR = 'kpi-l-usr'   // user_id prefix
const EVT = 'kpi-l-evt'   // evento_id prefix

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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id varchar(36) NOT NULL,
      empresa_id varchar(36) NOT NULL,
      nombre varchar(100) NOT NULL,
      slug varchar(50) NOT NULL,
      permisos text DEFAULT NULL,
      es_predefinido boolean DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id),
      UNIQUE (empresa_id, slug)
    )
  `)
}

async function cleanup() {
  await pool.query(`DELETE FROM entradas WHERE evento_id LIKE '${EVT}%'`)
  await pool.query(`DELETE FROM entrada_categorias WHERE evento_id LIKE '${EVT}%'`)
  await pool.query(`DELETE FROM eventos WHERE id LIKE '${EVT}%' OR empresa_id LIKE '${EMP}%'`)
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
  publicationMode?: string
  publishAtUtc?: string | null
  prePublishVisibility?: string
}) {
  const {
    id,
    empresaId,
    nombre = `Evento ${id}`,
    activo = true,
    publicationMode = 'immediate',
    publishAtUtc = null,
    prePublishVisibility = 'hidden',
  } = params

  await pool.query(
    `INSERT INTO eventos
      (id, empresa_id, nombre, activo, publication_mode, publish_at_utc, pre_publish_visibility, modo_fecha)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'unica') ON CONFLICT DO NOTHING`,
    [id, empresaId, nombre, activo, publicationMode, publishAtUtc, prePublishVisibility]
  )
}

async function seedCategoria(params: {
  id: string
  eventoId: string
  stock?: number
  stockDisponible?: number
  precio?: number
}) {
  const { id, eventoId, stock = 100, stockDisponible = 50, precio = 1000 } = params
  await pool.query(
    `INSERT INTO entrada_categorias
      (id, evento_id, nombre, precio, stock, stock_disponible)
     VALUES (?, ?, 'General', ?, ?, ?) ON CONFLICT DO NOTHING`,
    [id, eventoId, precio, stock, stockDisponible]
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
  createdAt?: string
}) {
  const {
    id,
    eventoId,
    categoriaId,
    // Default compradorId derived from id to avoid UNIQUE KEY uq_comprador_evento (comprador_id, evento_id) conflicts
    compradorId = `cmp-${id}`.slice(0, 36),
    estado = 'valida',
    precioPagado = 1000,
    comision = 100,
    mpFeeAmount = 50,
    netoEmpresaAmount = null,
    createdAt,
  } = params

  // qr_code and clave_corta have UNIQUE constraints — use id-derived values to ensure uniqueness
  // Production DB has clave_corta varchar(20) — truncate to 20 chars.
  // Use last 17 chars of id for uniqueness (cc- prefix = 3 chars, total = 20)
  const qrCode = `qr-${id}`.slice(0, 191)
  const claveCorta = `cc-${id.slice(-17)}`

  if (createdAt) {
    await pool.query(
      `INSERT INTO entradas
        (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado, precio_pagado, comision, mp_fee_amount, neto_empresa_amount, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      [id, eventoId, categoriaId, compradorId, qrCode, claveCorta, estado, precioPagado, comision, mpFeeAmount, netoEmpresaAmount, createdAt]
    )
  } else {
    await pool.query(
      `INSERT INTO entradas
        (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado, precio_pagado, comision, mp_fee_amount, neto_empresa_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      [id, eventoId, categoriaId, compradorId, qrCode, claveCorta, estado, precioPagado, comision, mpFeeAmount, netoEmpresaAmount]
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

// T1: empresa user gets ingresos_neto, ticket_promedio, ventas_7d in response
test('kpi-list: empresa user gets financial KPI fields in event list', async () => {
  const empresaId = `${EMP}-t1`
  const eventoId = `${EVT}-t1-ev1`
  const catId = `${EVT}-t1-cat1`

  await seedEmpresa(empresaId)
  await seedEvento({ id: eventoId, empresaId })
  await seedCategoria({ id: catId, eventoId, stock: 100, stockDisponible: 97 })
  // 3 valid entradas at 1000 each, comision=100, mp_fee=50 → neto = 850 each → total_neto = 2550
  for (let i = 1; i <= 3; i++) {
    await seedEntrada({
      id: `${EVT}-t1-en${i}`,
      eventoId,
      categoriaId: catId,
      estado: 'valida',
      precioPagado: 1000,
      comision: 100,
      mpFeeAmount: 50,
      netoEmpresaAmount: null,
    })
  }

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/eventos`, user)

    assert.equal(status, 200, `Expected 200, got ${status}`)
    const eventos = (data as any).data as any[]
    assert.ok(eventos.length >= 1, 'Should have at least 1 event')

    const ev = eventos.find((e: any) => e.id === eventoId)
    assert.ok(ev, 'Seeded event should appear in list')

    // Fields must exist and be numbers (not undefined, not null for empresa user)
    assert.ok(typeof ev.ingresos_neto === 'number', `ingresos_neto should be number, got ${typeof ev.ingresos_neto}`)
    assert.ok(typeof ev.ingresos_bruto === 'number', `ingresos_bruto should be number, got ${typeof ev.ingresos_bruto}`)
    assert.ok(typeof ev.ventas_7d === 'number', `ventas_7d should be number, got ${typeof ev.ventas_7d}`)
    assert.ok(typeof ev.ticket_promedio_bruto === 'number', `ticket_promedio_bruto should be number, got ${typeof ev.ticket_promedio_bruto}`)
    assert.ok(typeof ev.ticket_promedio_neto === 'number', `ticket_promedio_neto should be number, got ${typeof ev.ticket_promedio_neto}`)

    // Verify correct calculation: neto = precio - comision - mp_fee = 1000 - 100 - 50 = 850
    assert.equal(ev.ingresos_neto, 2550, `ingresos_neto should be 2550 (3 * 850), got ${ev.ingresos_neto}`)
    assert.equal(ev.ingresos_bruto, 3000, `ingresos_bruto should be 3000 (3 * 1000), got ${ev.ingresos_bruto}`)
    // ticket_promedio_bruto = 3000/3 = 1000; ticket_promedio_neto = 2550/3 = 850
    assert.equal(ev.ticket_promedio_bruto, 1000, `ticket_promedio_bruto should be 1000, got ${ev.ticket_promedio_bruto}`)
    assert.equal(ev.ticket_promedio_neto, 850, `ticket_promedio_neto should be 850, got ${ev.ticket_promedio_neto}`)
  } finally {
    await server.close()
  }
})

// T2: empleado WITHOUT ver_kpis_eventos gets null for financial fields
test('kpi-list: empleado without ver_kpis_eventos gets null for financial fields', async () => {
  const empresaId = `${EMP}-t2`
  const userId = `${USR}-t2`
  const eventoId = `${EVT}-t2-ev1`
  const catId = `${EVT}-t2-cat1`

  await seedEmpresa(empresaId)
  await seedEmpleado(userId, empresaId, { ver_eventos: true, ver_kpis_eventos: false })
  await seedEvento({ id: eventoId, empresaId })
  await seedCategoria({ id: catId, eventoId })
  await seedEntrada({
    id: `${EVT}-t2-en1`,
    eventoId,
    categoriaId: catId,
    estado: 'valida',
    precioPagado: 1000,
    comision: 100,
    mpFeeAmount: 50,
  })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpleadoUser(userId, empresaId, { ver_eventos: true, ver_kpis_eventos: false })
    const { status, data } = await requestJson(`${server.baseUrl}/api/eventos`, user)

    assert.equal(status, 200)
    const eventos = (data as any).data as any[]
    const ev = eventos.find((e: any) => e.id === eventoId)
    assert.ok(ev, 'Seeded event should appear in list')

    // Financial fields must be null (stripped server-side)
    assert.equal(ev.ingresos_neto, null, `ingresos_neto should be null, got ${ev.ingresos_neto}`)
    assert.equal(ev.ingresos_bruto, null, `ingresos_bruto should be null, got ${ev.ingresos_bruto}`)
    assert.equal(ev.ticket_promedio_bruto, null, `ticket_promedio_bruto should be null, got ${ev.ticket_promedio_bruto}`)
    assert.equal(ev.ticket_promedio_neto, null, `ticket_promedio_neto should be null, got ${ev.ticket_promedio_neto}`)
    assert.equal(ev.ventas_7d, null, `ventas_7d should be null, got ${ev.ventas_7d}`)
  } finally {
    await server.close()
  }
})

// T3: ventas_7d counts only valida + usada within last 7 days
test('kpi-list: ventas_7d counts only valida + usada within last 7 days', async () => {
  const empresaId = `${EMP}-t3`
  const eventoId = `${EVT}-t3-ev1`
  const catId = `${EVT}-t3-cat1`
  const now = new Date()
  const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000)
    .toISOString()
    .replace('T', ' ')
    .slice(0, 19)

  await seedEmpresa(empresaId)
  await seedEvento({ id: eventoId, empresaId })
  await seedCategoria({ id: catId, eventoId, stock: 100, stockDisponible: 90 })

  // 2 valida recent → count
  await seedEntrada({ id: `${EVT}-t3-en1`, eventoId, categoriaId: catId, estado: 'valida', createdAt: threeDaysAgo })
  await seedEntrada({ id: `${EVT}-t3-en2`, eventoId, categoriaId: catId, estado: 'valida', createdAt: threeDaysAgo })
  // 2 usada recent → count
  await seedEntrada({ id: `${EVT}-t3-en3`, eventoId, categoriaId: catId, estado: 'usada', createdAt: threeDaysAgo })
  await seedEntrada({ id: `${EVT}-t3-en4`, eventoId, categoriaId: catId, estado: 'usada', createdAt: threeDaysAgo })
  // 1 cancelada recent → should NOT count
  await seedEntrada({ id: `${EVT}-t3-en5`, eventoId, categoriaId: catId, estado: 'cancelada', createdAt: threeDaysAgo })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/eventos`, user)

    assert.equal(status, 200)
    const ev = (data as any).data.find((e: any) => e.id === eventoId)
    assert.ok(ev, 'Event should be in list')
    assert.equal(ev.ventas_7d, 4, `ventas_7d should be 4 (2 valida + 2 usada), got ${ev.ventas_7d}`)
  } finally {
    await server.close()
  }
})

// T4: ventas_7d excludes cancelada entries
test('kpi-list: ventas_7d excludes cancelada entries', async () => {
  const empresaId = `${EMP}-t4`
  const eventoId = `${EVT}-t4-ev1`
  const catId = `${EVT}-t4-cat1`

  await seedEmpresa(empresaId)
  await seedEvento({ id: eventoId, empresaId })
  await seedCategoria({ id: catId, eventoId })
  // All cancelada
  for (let i = 1; i <= 3; i++) {
    await seedEntrada({ id: `${EVT}-t4-en${i}`, eventoId, categoriaId: catId, estado: 'cancelada' })
  }

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/eventos`, user)

    assert.equal(status, 200)
    const ev = (data as any).data.find((e: any) => e.id === eventoId)
    assert.ok(ev)
    assert.equal(ev.ventas_7d, 0, `ventas_7d should be 0 when all are cancelada, got ${ev.ventas_7d}`)
  } finally {
    await server.close()
  }
})

// T5: sort by ingresos returns 400 when empleado lacks ver_kpis_eventos
test('kpi-list: sortBy=ingresos returns 400 for empleado without ver_kpis_eventos', async () => {
  const empresaId = `${EMP}-t5`
  const userId = `${USR}-t5`

  await seedEmpresa(empresaId)
  await seedEmpleado(userId, empresaId, { ver_eventos: true, ver_kpis_eventos: false })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpleadoUser(userId, empresaId, { ver_eventos: true, ver_kpis_eventos: false })
    const { status, data } = await requestJson(`${server.baseUrl}/api/eventos?sortBy=ingresos`, user)

    assert.equal(status, 400, `Expected 400, got ${status}`)
    assert.ok((data as any).error, 'Should have error message')
  } finally {
    await server.close()
  }
})

// T6: sort by ticket_promedio returns 400 when empleado lacks ver_kpis_eventos
test('kpi-list: sortBy=ticket_promedio returns 400 for empleado without ver_kpis_eventos', async () => {
  const empresaId = `${EMP}-t6`
  const userId = `${USR}-t6`

  await seedEmpresa(empresaId)
  await seedEmpleado(userId, empresaId, { ver_eventos: true, ver_kpis_eventos: false })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpleadoUser(userId, empresaId, { ver_eventos: true, ver_kpis_eventos: false })
    const { status } = await requestJson(`${server.baseUrl}/api/eventos?sortBy=ticket_promedio`, user)

    assert.equal(status, 400)
  } finally {
    await server.close()
  }
})

// T7: sort by ventas_7d returns 400 when empleado lacks ver_kpis_eventos
test('kpi-list: sortBy=ventas_7d returns 400 for empleado without ver_kpis_eventos', async () => {
  const empresaId = `${EMP}-t7`
  const userId = `${USR}-t7`

  await seedEmpresa(empresaId)
  await seedEmpleado(userId, empresaId, { ver_eventos: true, ver_kpis_eventos: false })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpleadoUser(userId, empresaId, { ver_eventos: true, ver_kpis_eventos: false })
    const { status } = await requestJson(`${server.baseUrl}/api/eventos?sortBy=ventas_7d`, user)

    assert.equal(status, 400)
  } finally {
    await server.close()
  }
})

// T8: sort by ingresos orders events correctly (DESC)
test('kpi-list: sortBy=ingresos orders events DESC correctly', async () => {
  const empresaId = `${EMP}-t8`
  const evA = `${EVT}-t8-evA`
  const evB = `${EVT}-t8-evB`
  const catA = `${EVT}-t8-cA`
  const catB = `${EVT}-t8-cB`

  await seedEmpresa(empresaId)
  // Event A → 3000 neto, Event B → 500 neto
  await seedEvento({ id: evA, empresaId, nombre: 'Event A High Income' })
  await seedEvento({ id: evB, empresaId, nombre: 'Event B Low Income' })
  await seedCategoria({ id: catA, eventoId: evA, stock: 10, stockDisponible: 7 })
  await seedCategoria({ id: catB, eventoId: evB, stock: 10, stockDisponible: 9 })
  // 3 entradas on A at neto=1000 each
  for (let i = 1; i <= 3; i++) {
    await seedEntrada({
      id: `${EVT}-t8-enA${i}`,
      eventoId: evA,
      categoriaId: catA,
      estado: 'valida',
      precioPagado: 1000,
      comision: 0,
      mpFeeAmount: 0,
      netoEmpresaAmount: 1000,
    })
  }
  // 1 entrada on B at neto=500
  await seedEntrada({
    id: `${EVT}-t8-enB1`,
    eventoId: evB,
    categoriaId: catB,
    estado: 'valida',
    precioPagado: 500,
    comision: 0,
    mpFeeAmount: 0,
    netoEmpresaAmount: 500,
  })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos?sortBy=ingresos&sortDir=desc`,
      user
    )

    assert.equal(status, 200)
    const eventos = (data as any).data as any[]
    assert.ok(eventos.length >= 2)

    const indexA = eventos.findIndex((e: any) => e.id === evA)
    const indexB = eventos.findIndex((e: any) => e.id === evB)
    assert.ok(indexA !== -1, 'Event A should be in list')
    assert.ok(indexB !== -1, 'Event B should be in list')
    assert.ok(indexA < indexB, `Event A (higher income) should come before Event B in DESC order. indexA=${indexA}, indexB=${indexB}`)
  } finally {
    await server.close()
  }
})

// T9: sort by ocupacion works for empleado WITHOUT ver_kpis_eventos (NOT gated)
test('kpi-list: sortBy=ocupacion works for empleado without ver_kpis_eventos', async () => {
  const empresaId = `${EMP}-t9`
  const userId = `${USR}-t9`

  await seedEmpresa(empresaId)
  await seedEmpleado(userId, empresaId, { ver_eventos: true, ver_kpis_eventos: false })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpleadoUser(userId, empresaId, { ver_eventos: true, ver_kpis_eventos: false })
    const { status } = await requestJson(`${server.baseUrl}/api/eventos?sortBy=ocupacion`, user)

    // Should return 200, NOT 400
    assert.equal(status, 200, `sortBy=ocupacion should work without ver_kpis_eventos, got ${status}`)
  } finally {
    await server.close()
  }
})

// T10: sort by ocupacion orders events correctly — events with capacidad=0 sort LAST on DESC
test('kpi-list: sortBy=ocupacion handles capacidad=0 events (NULLS LAST on DESC)', async () => {
  const empresaId = `${EMP}-t10`
  const evFull = `${EVT}-t10-full`
  const evEmpty = `${EVT}-t10-empty`
  const evNoStk = `${EVT}-t10-noStk`
  const catFull = `${EVT}-t10-cFull`
  const catEmpty = `${EVT}-t10-cEmp`
  const catNoStk = `${EVT}-t10-cNStk`

  await seedEmpresa(empresaId)
  await seedEvento({ id: evFull, empresaId, nombre: 'Full Event' })
  await seedEvento({ id: evEmpty, empresaId, nombre: 'Empty Event' })
  await seedEvento({ id: evNoStk, empresaId, nombre: 'No Stock Event' })

  // Full: 50 sold of 100 → 50% ocupacion
  await seedCategoria({ id: catFull, eventoId: evFull, stock: 100, stockDisponible: 50 })
  // Empty: 0 sold of 100 → 0% ocupacion
  await seedCategoria({ id: catEmpty, eventoId: evEmpty, stock: 100, stockDisponible: 100 })
  // No stock: stock=0 → capacidad_total=0 → should be NULL (sort last)
  await seedCategoria({ id: catNoStk, eventoId: evNoStk, stock: 0, stockDisponible: 0 })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos?sortBy=ocupacion&sortDir=desc`,
      user
    )

    assert.equal(status, 200)
    const eventos = (data as any).data as any[]
    const idxFull = eventos.findIndex((e: any) => e.id === evFull)
    const idxEmpty = eventos.findIndex((e: any) => e.id === evEmpty)
    const idxNoStk = eventos.findIndex((e: any) => e.id === evNoStk)

    assert.ok(idxFull !== -1 && idxEmpty !== -1 && idxNoStk !== -1, 'All 3 events should be in list')
    // Full (50%) should come before Empty (0%)
    assert.ok(idxFull < idxEmpty, `Full event should sort before empty event in DESC ocupacion. idxFull=${idxFull}, idxEmpty=${idxEmpty}`)
    // No-stock (NULL) should sort LAST
    assert.ok(idxNoStk > idxFull, `No-stock event should sort after full event. idxNoStk=${idxNoStk}, idxFull=${idxFull}`)
    assert.ok(idxNoStk > idxEmpty, `No-stock event should sort after empty event. idxNoStk=${idxNoStk}, idxEmpty=${idxEmpty}`)
  } finally {
    await server.close()
  }
})

// T11: publication_status=live returns only live events
test('kpi-list: publication_status=live filters to only live events', async () => {
  const empresaId = `${EMP}-t11`
  const evLive = `${EVT}-t11-live`
  const evHidden = `${EVT}-t11-hiddn`  // note: max 20 chars for EVT- prefix
  const evInactive = `${EVT}-t11-inact`

  await seedEmpresa(empresaId)
  // Live: activo=1, mode=immediate
  await seedEvento({ id: evLive, empresaId, nombre: 'Live Event', activo: true, publicationMode: 'immediate' })
  // Hidden: activo=1, mode=scheduled, publish_at_utc in future, pre_publish_visibility=hidden
  await seedEvento({
    id: evHidden,
    empresaId,
    nombre: 'Hidden Event',
    activo: true,
    publicationMode: 'scheduled',
    publishAtUtc: '2099-01-01 00:00:00',
    prePublishVisibility: 'hidden',
  })
  // Inactive: activo=0
  await seedEvento({ id: evInactive, empresaId, nombre: 'Inactive Event', activo: false })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos?publication_status=live`,
      user
    )

    assert.equal(status, 200)
    const eventos = (data as any).data as any[]
    const ids = eventos.map((e: any) => e.id)

    assert.ok(ids.includes(evLive), 'Live event should be in results')
    assert.ok(!ids.includes(evHidden), 'Hidden event should NOT be in results')
    assert.ok(!ids.includes(evInactive), 'Inactive event should NOT be in results')
  } finally {
    await server.close()
  }
})

// T12: publication_status=manual_inactive returns only activo=0 events
test('kpi-list: publication_status=manual_inactive returns only activo=0 events', async () => {
  const empresaId = `${EMP}-t12`
  const evLive = `${EVT}-t12-live`
  const evInact = `${EVT}-t12-inact`

  await seedEmpresa(empresaId)
  await seedEvento({ id: evLive, empresaId, nombre: 'Live Event', activo: true, publicationMode: 'immediate' })
  await seedEvento({ id: evInact, empresaId, nombre: 'Inactive Event', activo: false })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos?publication_status=manual_inactive`,
      user
    )

    assert.equal(status, 200)
    const eventos = (data as any).data as any[]
    const ids = eventos.map((e: any) => e.id)

    assert.ok(!ids.includes(evLive), 'Live event should NOT be in manual_inactive results')
    assert.ok(ids.includes(evInact), 'Inactive (activo=0) event should be in manual_inactive results')
  } finally {
    await server.close()
  }
})

// T13: publication_status=hidden returns scheduled hidden events (NOT manual_inactive)
test('kpi-list: publication_status=hidden returns scheduled hidden events but not manual_inactive', async () => {
  const empresaId = `${EMP}-t13`
  const evHidden = `${EVT}-t13-hiddn`
  const evLive = `${EVT}-t13-live`
  const evInact = `${EVT}-t13-inact`

  await seedEmpresa(empresaId)
  // Hidden scheduled: activo=1, mode=scheduled, publish_at_utc in future, pre_publish_visibility=hidden
  await seedEvento({
    id: evHidden,
    empresaId,
    nombre: 'Scheduled Hidden',
    activo: true,
    publicationMode: 'scheduled',
    publishAtUtc: '2099-01-01 00:00:00',
    prePublishVisibility: 'hidden',
  })
  await seedEvento({ id: evLive, empresaId, nombre: 'Live Event', activo: true, publicationMode: 'immediate' })
  await seedEvento({ id: evInact, empresaId, nombre: 'Inactive', activo: false })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos?publication_status=hidden`,
      user
    )

    assert.equal(status, 200)
    const eventos = (data as any).data as any[]
    const ids = eventos.map((e: any) => e.id)

    assert.ok(ids.includes(evHidden), 'Scheduled hidden event should be in hidden results')
    assert.ok(!ids.includes(evLive), 'Live event should NOT be in hidden results')
    assert.ok(!ids.includes(evInact), 'Inactive event (manual_inactive) should NOT be in hidden results')
  } finally {
    await server.close()
  }
})

// T14: empty result when no events match the filter
test('kpi-list: empty result when no events match publication_status filter', async () => {
  const empresaId = `${EMP}-t14`
  // Only live event, filter for manual_inactive → empty
  await seedEmpresa(empresaId)
  await seedEvento({
    id: `${EVT}-t14-live`,
    empresaId,
    nombre: 'Live Only',
    activo: true,
    publicationMode: 'immediate',
  })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos?publication_status=manual_inactive`,
      user
    )

    assert.equal(status, 200)
    const eventos = (data as any).data as any[]
    assert.equal(eventos.length, 0, `Expected 0 events, got ${eventos.length}`)
  } finally {
    await server.close()
  }
})

// T15: ticket_promedio is null when event has 0 non-cancelled entradas
test('kpi-list: ticket_promedio is null when event has 0 valid entradas', async () => {
  const empresaId = `${EMP}-t15`
  const eventoId = `${EVT}-t15-ev1`
  const catId = `${EVT}-t15-cat1`

  await seedEmpresa(empresaId)
  await seedEvento({ id: eventoId, empresaId })
  await seedCategoria({ id: catId, eventoId, stock: 100, stockDisponible: 100 })
  // No entradas seeded → ticket_promedio should be null

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/eventos`, user)

    assert.equal(status, 200)
    const ev = (data as any).data.find((e: any) => e.id === eventoId)
    assert.ok(ev, 'Event should be in list')
    assert.equal(ev.ticket_promedio_bruto, null, `ticket_promedio_bruto should be null for event with 0 entradas, got ${ev.ticket_promedio_bruto}`)
    assert.equal(ev.ticket_promedio_neto, null, `ticket_promedio_neto should be null for event with 0 entradas, got ${ev.ticket_promedio_neto}`)
  } finally {
    await server.close()
  }
})

// T16: ticket_promedio is correct when event has entradas
test('kpi-list: ticket_promedio = ingresos_bruto / total_vendidas when > 0', async () => {
  const empresaId = `${EMP}-t16`
  const eventoId = `${EVT}-t16-ev1`
  const catId = `${EVT}-t16-cat1`

  await seedEmpresa(empresaId)
  await seedEvento({ id: eventoId, empresaId })
  await seedCategoria({ id: catId, eventoId, stock: 100, stockDisponible: 96 })
  // 4 entradas at precioPagado=1000 each (non-cancelled) → bruto=4000, vendidas=4 → ticket=1000
  for (let i = 1; i <= 4; i++) {
    await seedEntrada({
      id: `${EVT}-t16-en${i}`,
      eventoId,
      categoriaId: catId,
      estado: 'valida',
      precioPagado: 1000,
      comision: 0,
      mpFeeAmount: 0,
    })
  }
  // 1 cancelada → should NOT affect ticket_promedio calculation
  await seedEntrada({
    id: `${EVT}-t16-en5`,
    eventoId,
    categoriaId: catId,
    estado: 'cancelada',
    precioPagado: 1000,
    comision: 0,
    mpFeeAmount: 0,
  })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/eventos`, user)

    assert.equal(status, 200)
    const ev = (data as any).data.find((e: any) => e.id === eventoId)
    assert.ok(ev)
    // bruto=4000, vendidas_financiero=4 → ticket_bruto=1000
    // neto=4000 (comision=0, mp_fee=0), vendidas_financiero=4 → ticket_neto=1000
    assert.equal(ev.ticket_promedio_bruto, 1000, `ticket_promedio_bruto should be 1000, got ${ev.ticket_promedio_bruto}`)
    assert.equal(ev.ticket_promedio_neto, 1000, `ticket_promedio_neto should be 1000, got ${ev.ticket_promedio_neto}`)
  } finally {
    await server.close()
  }
})

// T17: sort by ingresos works for empresa user (DESC)
test('kpi-list: sortBy=ingresos works for empresa user', async () => {
  const empresaId = `${EMP}-t17`
  const userId = `${USR}-t17`

  await seedEmpresa(empresaId)
  await seedEmpleado(userId, empresaId, { ver_eventos: true, ver_kpis_eventos: true })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    // empresa user → always has all permissions
    const user = buildEmpresaUser(empresaId)
    const { status } = await requestJson(`${server.baseUrl}/api/eventos?sortBy=ingresos&sortDir=desc`, user)
    assert.equal(status, 200)
  } finally {
    await server.close()
  }
})

// ─── Section 3 QUICKFIX — T18 ──────────────────────────────────────────────

// T18: regression — ticket_promedio_bruto != ticket_promedio_neto when fees are non-zero
test('kpi-list: ticket_promedio_bruto and ticket_promedio_neto differ when fees are non-zero', async () => {
  const empresaId = `${EMP}-t18`
  const eventoId = `${EVT}-t18-ev1`
  const catId = `${EVT}-t18-cat1`

  await seedEmpresa(empresaId)
  await seedEvento({ id: eventoId, empresaId })
  await seedCategoria({ id: catId, eventoId, stock: 10, stockDisponible: 8 })

  // 2 entradas at precio=2000, comision=200, mp_fee=100
  // bruto = 2 * 2000 = 4000; neto = 2 * (2000 - 200 - 100) = 2 * 1700 = 3400
  // ticket_bruto = 4000/2 = 2000; ticket_neto = 3400/2 = 1700 (MUST be different)
  for (let i = 1; i <= 2; i++) {
    await seedEntrada({
      id: `${EVT}-t18-en${i}`,
      eventoId,
      categoriaId: catId,
      estado: 'valida',
      precioPagado: 2000,
      comision: 200,
      mpFeeAmount: 100,
      netoEmpresaAmount: null, // computed from formula
    })
  }

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/eventos`, user)

    assert.equal(status, 200)
    const ev = (data as any).data.find((e: any) => e.id === eventoId)
    assert.ok(ev, 'Event should be in list')
    assert.equal(ev.ticket_promedio_bruto, 2000, `ticket_promedio_bruto should be 2000, got ${ev.ticket_promedio_bruto}`)
    assert.equal(ev.ticket_promedio_neto, 1700, `ticket_promedio_neto should be 1700, got ${ev.ticket_promedio_neto}`)
    // Prove they're different — the whole point of this regression
    assert.notEqual(ev.ticket_promedio_bruto, ev.ticket_promedio_neto, 'bruto and neto should differ when fees non-zero')
  } finally {
    await server.close()
  }
})

// ─── Section 4: Summary endpoint tests ─────────────────────────────────────

const SUMM = 'kpi-s'   // summary test prefix (keep short for varchar limits)

// T19: summary returns 0s and nulls for empresa with no events
test('kpi-summary: returns 0/nulls when empresa has no events', async () => {
  const empresaId = `${EMP}-s19`
  await seedEmpresa(empresaId)

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/eventos/summary`, user)

    assert.equal(status, 200, `Expected 200, got ${status}`)
    const d = (data as any).data
    assert.ok(d, 'Should have data property')

    const t = d.totales
    assert.equal(t.eventos_count, 0)
    assert.equal(t.eventos_activos, 0)
    assert.equal(t.total_bruto, 0)
    assert.equal(t.total_neto, 0)
    assert.equal(t.total_vendidas, 0)
    assert.equal(t.ocupacion_promedio, null, 'ocupacion_promedio should be null with no events')
    assert.equal(t.ticket_promedio_bruto, null, 'ticket_promedio_bruto should be null with no events')
    assert.equal(t.ticket_promedio_neto, null, 'ticket_promedio_neto should be null with no events')

    const p = d.performers
    assert.equal(p.top_por_ingresos, null)
    assert.equal(p.bottom_por_ingresos, null)
    assert.equal(p.top_por_ocupacion, null)
    assert.equal(p.bottom_por_ocupacion, null)
  } finally {
    await server.close()
  }
})

// T20: summary returns correct aggregates with N events
test('kpi-summary: returns correct aggregates with N events', async () => {
  const empresaId = `${EMP}-s20`
  const evA = `${EVT}-s20-evA`
  const evB = `${EVT}-s20-evB`
  const catA = `${EVT}-s20-cA`
  const catB = `${EVT}-s20-cB`

  await seedEmpresa(empresaId)
  // Event A: activo=1, cap=100, vendidas=2, bruto=2000, neto=1700
  await seedEvento({ id: evA, empresaId, activo: true })
  await seedCategoria({ id: catA, eventoId: evA, stock: 100, stockDisponible: 98 })
  for (let i = 1; i <= 2; i++) {
    await seedEntrada({
      id: `${EVT}-s20-enA${i}`, eventoId: evA, categoriaId: catA,
      estado: 'valida', precioPagado: 1000, comision: 100, mpFeeAmount: 50,
    })
  }
  // Event B: activo=0, cap=50, vendidas=1, bruto=500, neto=500
  await seedEvento({ id: evB, empresaId, activo: false })
  await seedCategoria({ id: catB, eventoId: evB, stock: 50, stockDisponible: 49 })
  await seedEntrada({
    id: `${EVT}-s20-enB1`, eventoId: evB, categoriaId: catB,
    estado: 'valida', precioPagado: 500, comision: 0, mpFeeAmount: 0,
  })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/eventos/summary`, user)

    assert.equal(status, 200)
    const t = (data as any).data.totales
    assert.equal(t.eventos_count, 2, `eventos_count should be 2, got ${t.eventos_count}`)
    assert.equal(t.eventos_activos, 1, `eventos_activos should be 1 (only evA is activo), got ${t.eventos_activos}`)
    assert.equal(t.total_bruto, 2500, `total_bruto should be 2500 (2000+500), got ${t.total_bruto}`)
    // neto A: 2 * (1000-100-50) = 1700; neto B: 500; total = 2200
    assert.equal(t.total_neto, 2200, `total_neto should be 2200, got ${t.total_neto}`)
    assert.equal(t.total_vendidas, 3, `total_vendidas should be 3, got ${t.total_vendidas}`)
  } finally {
    await server.close()
  }
})

// T21: ocupacion_promedio excludes events with capacidad_total=0
test('kpi-summary: ocupacion_promedio excludes events with capacidad_total=0', async () => {
  const empresaId = `${EMP}-s21`
  const evWith = `${EVT}-s21-evW`   // event WITH capacity
  const evZero = `${EVT}-s21-evZ`   // event with capacidad=0
  const catWith = `${EVT}-s21-cW`
  const catZero = `${EVT}-s21-cZ`

  await seedEmpresa(empresaId)
  await seedEvento({ id: evWith, empresaId })
  await seedCategoria({ id: catWith, eventoId: evWith, stock: 100, stockDisponible: 50 }) // 50% ocupacion
  await seedEvento({ id: evZero, empresaId })
  await seedCategoria({ id: catZero, eventoId: evZero, stock: 0, stockDisponible: 0 }) // capacidad=0

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/eventos/summary`, user)

    assert.equal(status, 200)
    const t = (data as any).data.totales
    // Only evWith contributes to AVG: 50/100*100 = 50%
    assert.ok(t.ocupacion_promedio !== null, 'ocupacion_promedio should not be null when some events have capacity')
    assert.ok(Math.abs(t.ocupacion_promedio - 50) < 0.01, `ocupacion_promedio should be ~50, got ${t.ocupacion_promedio}`)
  } finally {
    await server.close()
  }
})

// T22: ocupacion_promedio is null when ALL events have capacidad_total=0
test('kpi-summary: ocupacion_promedio is null when all events have capacidad_total=0', async () => {
  const empresaId = `${EMP}-s22`
  const ev1 = `${EVT}-s22-ev1`
  const cat1 = `${EVT}-s22-c1`

  await seedEmpresa(empresaId)
  await seedEvento({ id: ev1, empresaId })
  await seedCategoria({ id: cat1, eventoId: ev1, stock: 0, stockDisponible: 0 })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/eventos/summary`, user)

    assert.equal(status, 200)
    const t = (data as any).data.totales
    assert.equal(t.ocupacion_promedio, null, `ocupacion_promedio should be null when all events have capacidad=0, got ${t.ocupacion_promedio}`)
  } finally {
    await server.close()
  }
})

// T23: top_por_ingresos identifies the event with highest neto
test('kpi-summary: top_por_ingresos identifies event with highest neto', async () => {
  const empresaId = `${EMP}-s23`
  const evHigh = `${EVT}-s23-high`
  const evLow = `${EVT}-s23-low`
  const catH = `${EVT}-s23-cH`
  const catL = `${EVT}-s23-cL`

  await seedEmpresa(empresaId)
  await seedEvento({ id: evHigh, empresaId, nombre: 'High Income' })
  await seedCategoria({ id: catH, eventoId: evHigh, stock: 10, stockDisponible: 7 })
  for (let i = 1; i <= 3; i++) {
    await seedEntrada({
      id: `${EVT}-s23-enH${i}`, eventoId: evHigh, categoriaId: catH,
      estado: 'valida', precioPagado: 1000, comision: 0, mpFeeAmount: 0,
    })
  }
  await seedEvento({ id: evLow, empresaId, nombre: 'Low Income' })
  await seedCategoria({ id: catL, eventoId: evLow, stock: 10, stockDisponible: 9 })
  await seedEntrada({
    id: `${EVT}-s23-enL1`, eventoId: evLow, categoriaId: catL,
    estado: 'valida', precioPagado: 100, comision: 0, mpFeeAmount: 0,
  })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/eventos/summary`, user)

    assert.equal(status, 200)
    const p = (data as any).data.performers
    assert.ok(p.top_por_ingresos, 'top_por_ingresos should not be null')
    assert.equal(p.top_por_ingresos.id, evHigh, `top_por_ingresos should be evHigh, got ${p.top_por_ingresos.id}`)
    assert.equal(p.top_por_ingresos.ingresos_neto, 3000, `ingresos_neto should be 3000, got ${p.top_por_ingresos.ingresos_neto}`)
  } finally {
    await server.close()
  }
})

// T24: bottom_por_ingresos INCLUDES events with $0 ingresos (FLAG-A regression)
test('kpi-summary: bottom_por_ingresos includes events with $0 ingresos', async () => {
  const empresaId = `${EMP}-s24`
  const evRich = `${EVT}-s24-rich`
  const evZero = `${EVT}-s24-zero`
  const catR = `${EVT}-s24-cR`

  await seedEmpresa(empresaId)
  await seedEvento({ id: evRich, empresaId, nombre: 'Rich' })
  await seedCategoria({ id: catR, eventoId: evRich, stock: 10, stockDisponible: 9 })
  await seedEntrada({
    id: `${EVT}-s24-enR1`, eventoId: evRich, categoriaId: catR,
    estado: 'valida', precioPagado: 500, comision: 0, mpFeeAmount: 0,
  })
  // Zero-income event: no entradas
  await seedEvento({ id: evZero, empresaId, nombre: 'Zero Income' })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/eventos/summary`, user)

    assert.equal(status, 200)
    const p = (data as any).data.performers
    assert.ok(p.bottom_por_ingresos, 'bottom_por_ingresos should not be null')
    // The $0 event should be the bottom performer (COALESCE null → 0)
    assert.equal(p.bottom_por_ingresos.id, evZero, `bottom should be the zero-income event, got ${p.bottom_por_ingresos.id}`)
    assert.equal(p.bottom_por_ingresos.ingresos_neto, 0, `bottom ingresos_neto should be 0, got ${p.bottom_por_ingresos.ingresos_neto}`)
  } finally {
    await server.close()
  }
})

// T25: top/bottom por ocupacion excludes events with capacidad_total=0
test('kpi-summary: top/bottom por ocupacion excludes events with capacidad_total=0', async () => {
  const empresaId = `${EMP}-s25`
  const evOcup = `${EVT}-s25-ocup`   // event with capacity
  const evZero = `${EVT}-s25-zero`   // event with capacity=0
  const catO = `${EVT}-s25-cO`
  const catZ = `${EVT}-s25-cZ`

  await seedEmpresa(empresaId)
  await seedEvento({ id: evOcup, empresaId, nombre: 'Ocupado' })
  await seedCategoria({ id: catO, eventoId: evOcup, stock: 100, stockDisponible: 80 }) // 20% ocupacion
  await seedEvento({ id: evZero, empresaId, nombre: 'Sin Capacidad' })
  await seedCategoria({ id: catZ, eventoId: evZero, stock: 0, stockDisponible: 0 })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/eventos/summary`, user)

    assert.equal(status, 200)
    const p = (data as any).data.performers
    // Both top and bottom should reference evOcup (only valid event for ocupacion)
    assert.ok(p.top_por_ocupacion, 'top_por_ocupacion should not be null')
    assert.equal(p.top_por_ocupacion.id, evOcup, `top should be evOcup, got ${p.top_por_ocupacion?.id}`)
    assert.ok(p.bottom_por_ocupacion, 'bottom_por_ocupacion should not be null')
    assert.equal(p.bottom_por_ocupacion.id, evOcup, `bottom should be evOcup (only 1 valid), got ${p.bottom_por_ocupacion?.id}`)
    // evZero should NOT appear
    assert.notEqual(p.top_por_ocupacion.id, evZero, 'zero-capacity event should not be top')
    assert.notEqual(p.bottom_por_ocupacion.id, evZero, 'zero-capacity event should not be bottom')
  } finally {
    await server.close()
  }
})

// T26: busqueda filter scopes aggregates correctly
test('kpi-summary: busqueda filter scopes aggregates correctly', async () => {
  const empresaId = `${EMP}-s26`
  const evRock = `${EVT}-s26-rock`
  const evJazz = `${EVT}-s26-jazz`
  const catR = `${EVT}-s26-cR`
  const catJ = `${EVT}-s26-cJ`

  await seedEmpresa(empresaId)
  await seedEvento({ id: evRock, empresaId, nombre: 'Rock Festival 2026' })
  await seedCategoria({ id: catR, eventoId: evRock, stock: 10, stockDisponible: 8 })
  for (let i = 1; i <= 2; i++) {
    await seedEntrada({
      id: `${EVT}-s26-enR${i}`, eventoId: evRock, categoriaId: catR,
      estado: 'valida', precioPagado: 1000, comision: 0, mpFeeAmount: 0,
    })
  }
  await seedEvento({ id: evJazz, empresaId, nombre: 'Jazz Night' })
  await seedCategoria({ id: catJ, eventoId: evJazz, stock: 10, stockDisponible: 5 })
  for (let i = 1; i <= 5; i++) {
    await seedEntrada({
      id: `${EVT}-s26-enJ${i}`, eventoId: evJazz, categoriaId: catJ,
      estado: 'valida', precioPagado: 500, comision: 0, mpFeeAmount: 0,
    })
  }

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    // Filter to only Rock events
    const { status, data } = await requestJson(`${server.baseUrl}/api/eventos/summary?busqueda=Rock`, user)

    assert.equal(status, 200)
    const t = (data as any).data.totales
    assert.equal(t.eventos_count, 1, `busqueda=Rock should match only 1 event, got ${t.eventos_count}`)
    assert.equal(t.total_bruto, 2000, `total_bruto should be 2000 (2 Rock entradas), got ${t.total_bruto}`)
  } finally {
    await server.close()
  }
})

// T27: publication_status filter scopes aggregates correctly
test('kpi-summary: publication_status filter scopes aggregates correctly', async () => {
  const empresaId = `${EMP}-s27`
  const evLive = `${EVT}-s27-live`
  const evInact = `${EVT}-s27-inact`
  const catL = `${EVT}-s27-cL`
  const catI = `${EVT}-s27-cI`

  await seedEmpresa(empresaId)
  await seedEvento({ id: evLive, empresaId, activo: true, publicationMode: 'immediate' })
  await seedCategoria({ id: catL, eventoId: evLive, stock: 10, stockDisponible: 9 })
  await seedEntrada({
    id: `${EVT}-s27-enL1`, eventoId: evLive, categoriaId: catL,
    estado: 'valida', precioPagado: 1000, comision: 0, mpFeeAmount: 0,
  })
  await seedEvento({ id: evInact, empresaId, activo: false })
  await seedCategoria({ id: catI, eventoId: evInact, stock: 10, stockDisponible: 7 })
  for (let i = 1; i <= 3; i++) {
    await seedEntrada({
      id: `${EVT}-s27-enI${i}`, eventoId: evInact, categoriaId: catI,
      estado: 'valida', precioPagado: 200, comision: 0, mpFeeAmount: 0,
    })
  }

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    // Filter to only live events
    const { status, data } = await requestJson(`${server.baseUrl}/api/eventos/summary?publication_status=live`, user)

    assert.equal(status, 200)
    const t = (data as any).data.totales
    assert.equal(t.eventos_count, 1, `Should count 1 live event, got ${t.eventos_count}`)
    assert.equal(t.total_bruto, 1000, `total_bruto should be 1000 (live only), got ${t.total_bruto}`)
  } finally {
    await server.close()
  }
})

// T28: returns 200 with 0s/nulls when no events match filters
test('kpi-summary: returns 200 with 0s/nulls when no events match filters', async () => {
  const empresaId = `${EMP}-s28`
  // Only live event, filter by manual_inactive → no match
  await seedEmpresa(empresaId)
  await seedEvento({ id: `${EVT}-s28-live`, empresaId, activo: true, publicationMode: 'immediate' })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/summary?publication_status=manual_inactive`,
      user
    )

    assert.equal(status, 200)
    const t = (data as any).data.totales
    const p = (data as any).data.performers
    assert.equal(t.eventos_count, 0)
    assert.equal(t.total_bruto, 0)
    assert.equal(t.total_neto, 0)
    assert.equal(t.ocupacion_promedio, null)
    assert.equal(p.top_por_ingresos, null)
    assert.equal(p.bottom_por_ingresos, null)
    assert.equal(p.top_por_ocupacion, null)
    assert.equal(p.bottom_por_ocupacion, null)
  } finally {
    await server.close()
  }
})

// T29: returns 403 for empleado without ver_recaudacion
test('kpi-summary: returns 403 for empleado without ver_recaudacion', async () => {
  const empresaId = `${EMP}-s29`
  const userId = `${USR}-s29`

  await seedEmpresa(empresaId)
  await seedEmpleado(userId, empresaId, { ver_eventos: true, ver_recaudacion: false })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpleadoUser(userId, empresaId, { ver_eventos: true, ver_recaudacion: false })
    const { status } = await requestJson(`${server.baseUrl}/api/eventos/summary`, user)
    assert.equal(status, 403, `Expected 403, got ${status}`)
  } finally {
    await server.close()
  }
})

// T30: single-event empresa — top == bottom for both ingresos and ocupacion
test('kpi-summary: single-event empresa has top == bottom for ingresos and ocupacion', async () => {
  const empresaId = `${EMP}-s30`
  const ev1 = `${EVT}-s30-ev1`
  const cat1 = `${EVT}-s30-c1`

  await seedEmpresa(empresaId)
  await seedEvento({ id: ev1, empresaId })
  await seedCategoria({ id: cat1, eventoId: ev1, stock: 50, stockDisponible: 40 }) // 10 sold, 20% ocupacion
  for (let i = 1; i <= 10; i++) {
    await seedEntrada({
      id: `${EVT}-s30-en${i}`, eventoId: ev1, categoriaId: cat1,
      estado: 'valida', precioPagado: 300, comision: 0, mpFeeAmount: 0,
    })
  }

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/eventos/summary`, user)

    assert.equal(status, 200)
    const p = (data as any).data.performers
    assert.ok(p.top_por_ingresos, 'top_por_ingresos should not be null')
    assert.ok(p.bottom_por_ingresos, 'bottom_por_ingresos should not be null')
    assert.ok(p.top_por_ocupacion, 'top_por_ocupacion should not be null')
    assert.ok(p.bottom_por_ocupacion, 'bottom_por_ocupacion should not be null')
    // With only 1 event, top and bottom should reference the same event
    assert.equal(p.top_por_ingresos.id, ev1)
    assert.equal(p.bottom_por_ingresos.id, ev1, 'single event: top == bottom for ingresos')
    assert.equal(p.top_por_ocupacion.id, ev1)
    assert.equal(p.bottom_por_ocupacion.id, ev1, 'single event: top == bottom for ocupacion')
  } finally {
    await server.close()
  }
})

// T31: tenant scoping — events from other empresa NOT included in summary
test('kpi-summary: tenant scoping excludes events from other empresa', async () => {
  const empresaA = `${EMP}-s31A`
  const empresaB = `${EMP}-s31B`
  const evA = `${EVT}-s31-evA`
  const evB = `${EVT}-s31-evB`
  const catA = `${EVT}-s31-cA`
  const catB = `${EVT}-s31-cB`

  await seedEmpresa(empresaA)
  await seedEmpresa(empresaB)

  // empresa A has 1 event with sales
  await seedEvento({ id: evA, empresaId: empresaA })
  await seedCategoria({ id: catA, eventoId: evA, stock: 10, stockDisponible: 9 })
  await seedEntrada({
    id: `${EVT}-s31-enA1`, eventoId: evA, categoriaId: catA,
    estado: 'valida', precioPagado: 999, comision: 0, mpFeeAmount: 0,
  })

  // empresa B has 1 event with different sales
  await seedEvento({ id: evB, empresaId: empresaB })
  await seedCategoria({ id: catB, eventoId: evB, stock: 10, stockDisponible: 5 })
  for (let i = 1; i <= 5; i++) {
    await seedEntrada({
      id: `${EVT}-s31-enB${i}`, eventoId: evB, categoriaId: catB,
      estado: 'valida', precioPagado: 500, comision: 0, mpFeeAmount: 0,
    })
  }

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    // Request as empresa A
    const userA = buildEmpresaUser(empresaA)
    const { status, data } = await requestJson(`${server.baseUrl}/api/eventos/summary`, userA)

    assert.equal(status, 200)
    const t = (data as any).data.totales
    // Only empresa A's data: 1 event, 1 entrada at 999
    assert.equal(t.eventos_count, 1, `empresa A should only see 1 event, got ${t.eventos_count}`)
    assert.equal(t.total_bruto, 999, `total_bruto should be 999 (empresa A only), got ${t.total_bruto}`)

    const p = (data as any).data.performers
    // Performer must belong to empresa A
    assert.equal(p.top_por_ingresos?.id, evA, `top_por_ingresos should be empresa A event, got ${p.top_por_ingresos?.id}`)
  } finally {
    await server.close()
  }
})
