/**
 * entradas-summary.test.ts
 *
 * Integration tests for GET /api/entradas/summary (Ventas Fase C1).
 * Validates:
 *   T1: Empty empresa returns zeros/nulls
 *   T2: 5 entradas today → periodo.hoy.vendidas = 5
 *   T3: Cancelled entradas excluded from vendidas but counted in canceladas
 *   T4: Empleado without ver_recaudacion → 403
 *   T5: Tenant scoping — entradas from another empresa NOT counted
 *   T6: ventas_por_dia includes exactly 30 entries (with 0s for empty days)
 *
 * Run: cd backend && node --import tsx --import ./src/test-env.ts --test
 *        --test-concurrency=1 src/entradas-summary.test.ts
 *
 * NOTE: Tests run against Postgres test container (port 5433).
 *       Schema is managed by Prisma migrations — no DDL in tests.
 */

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { prismaDirectUrl as prisma } from './lib/prisma'
import indexRouter from './routes/index'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

// ─── Constants ─────────────────────────────────────────────────────────────
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET!

// Prefix all test IDs to avoid collisions with other test suites
const EMP = 'esum-emp'  // 8 chars
const USR = 'esum-usr'  // 8 chars
const EVT = 'esum-evt'  // 8 chars

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

// ensureSchema is a no-op — schema managed by Prisma migrations
async function ensureSchema() {
  // no-op: Prisma migrate deploy has already run against the test container
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM entradas WHERE evento_id ILIKE ${`${EVT}%`}`
  await prisma.$executeRaw`DELETE FROM entrada_categorias WHERE evento_id ILIKE ${`${EVT}%`}`
  await prisma.$executeRaw`DELETE FROM eventos WHERE empresa_id ILIKE ${`${EMP}%`}`
  await prisma.$executeRaw`DELETE FROM usuarios WHERE empresa_id ILIKE ${`${EMP}%`}`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE ${`${EMP}%`}`
}

async function seedEmpresa(id: string) {
  await prisma.$executeRaw`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES (${id}, ${`Empresa ${id}`}, ${`slug-${id}`}, ${`${id}@test.com`}, 'hash', 'Admin', true)
    ON CONFLICT DO NOTHING`
}

async function seedEmpleado(
  id: string,
  empresaId: string,
  permisos: Record<string, boolean>
) {
  await prisma.$executeRaw`
    INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, permisos, activo)
    VALUES (${id}, ${empresaId}, 'Empleado', 'Test', ${`${id}@test.com`}, 'hash', 'vendedor', ${JSON.stringify(permisos)}, true)
    ON CONFLICT DO NOTHING`
}

async function seedEvento(params: { id: string; empresaId: string }) {
  await prisma.$executeRaw`
    INSERT INTO eventos (id, empresa_id, nombre, activo, publication_mode, modo_fecha)
    VALUES (${params.id}, ${params.empresaId}, ${`Evento ${params.id}`}, true, 'immediate', 'unica')
    ON CONFLICT DO NOTHING`
}

async function seedCategoria(params: { id: string; eventoId: string }) {
  await prisma.$executeRaw`
    INSERT INTO entrada_categorias (id, evento_id, nombre, precio, stock, stock_disponible)
    VALUES (${params.id}, ${params.eventoId}, 'General', 1000, 100, 50)
    ON CONFLICT DO NOTHING`
}

async function seedEntrada(params: {
  id: string
  eventoId: string
  categoriaId: string
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
    estado = 'valida',
    precioPagado = 1000,
    comision = 100,
    mpFeeAmount = 50,
    netoEmpresaAmount = null,
    createdAt,
  } = params

  const qrCode = `qr-${id}`.slice(0, 191)
  const claveCorta = `cc-${id.slice(-17)}`
  const compradorId = `cmp-${id}`.slice(0, 36)

  if (createdAt) {
    await prisma.$executeRaw`
      INSERT INTO entradas
        (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado, precio_pagado, comision, mp_fee_amount, neto_empresa_amount, created_at)
      VALUES (${id}, ${eventoId}, ${categoriaId}, ${compradorId}, ${qrCode}, ${claveCorta}, ${estado}, ${precioPagado}, ${comision}, ${mpFeeAmount}, ${netoEmpresaAmount}, ${createdAt}::timestamp)
      ON CONFLICT DO NOTHING`
  } else {
    await prisma.$executeRaw`
      INSERT INTO entradas
        (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado, precio_pagado, comision, mp_fee_amount, neto_empresa_amount)
      VALUES (${id}, ${eventoId}, ${categoriaId}, ${compradorId}, ${qrCode}, ${claveCorta}, ${estado}, ${precioPagado}, ${comision}, ${mpFeeAmount}, ${netoEmpresaAmount})
      ON CONFLICT DO NOTHING`
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
  await prisma.$disconnect()
})

// ─── Tests ─────────────────────────────────────────────────────────────────

// T1: Empty empresa returns zeros/nulls
test('esum-t1: empty empresa returns all zeros and null ticket_promedio', async () => {
  const empresaId = `${EMP}-t1`
  await seedEmpresa(empresaId)

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/entradas/summary`, user)

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const { periodo, ventas_por_dia } = (data as any).data

    assert.equal(periodo.hoy.vendidas, 0)
    assert.equal(periodo.hoy.brutos, 0)
    assert.equal(periodo.hoy.neto, 0)
    assert.equal(periodo.hoy.canceladas, 0)
    assert.equal(periodo.hoy.ticket_promedio_neto, null, 'ticket_promedio_neto should be null when no sales')

    assert.equal(periodo.ultimos_7d.vendidas, 0)
    assert.equal(periodo.ultimos_30d.vendidas, 0)
    assert.equal(periodo.ultimos_30d.tasa_cancelacion_pct, null, 'tasa_cancelacion_pct should be null when no entries')

    assert.equal(ventas_por_dia.length, 30, 'ventas_por_dia must always have 30 entries')
    for (const dia of ventas_por_dia) {
      assert.equal(dia.vendidas, 0)
      assert.equal(dia.neto, 0)
    }
  } finally {
    await server.close()
  }
})

// T2: 5 entradas today → periodo.hoy.vendidas = 5
test('esum-t2: 5 entradas today appear in periodo.hoy.vendidas', async () => {
  const empresaId = `${EMP}-t2`
  const eventoId = `${EVT}-t2-ev`
  const catId = `${EVT}-t2-cat`

  await seedEmpresa(empresaId)
  await seedEvento({ id: eventoId, empresaId })
  await seedCategoria({ id: catId, eventoId })

  for (let i = 1; i <= 5; i++) {
    await seedEntrada({
      id: `${EVT}-t2-en${i}`,
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
    const { status, data } = await requestJson(`${server.baseUrl}/api/entradas/summary`, user)

    assert.equal(status, 200)
    const { periodo } = (data as any).data

    assert.equal(periodo.hoy.vendidas, 5, `Expected 5 vendidas hoy, got ${periodo.hoy.vendidas}`)
    // brutos = 5 * 1000 = 5000
    assert.equal(periodo.hoy.brutos, 5000, `Expected brutos=5000, got ${periodo.hoy.brutos}`)
    // neto = 5 * (1000 - 100 - 50) = 5 * 850 = 4250
    assert.equal(periodo.hoy.neto, 4250, `Expected neto=4250, got ${periodo.hoy.neto}`)
    // ticket_promedio_neto = 4250 / 5 = 850
    assert.equal(periodo.hoy.ticket_promedio_neto, 850, `Expected ticket_promedio_neto=850, got ${periodo.hoy.ticket_promedio_neto}`)
  } finally {
    await server.close()
  }
})

// T3: Cancelled entradas excluded from vendidas but counted in canceladas
test('esum-t3: cancelled entradas excluded from vendidas, counted in canceladas', async () => {
  const empresaId = `${EMP}-t3`
  const eventoId = `${EVT}-t3-ev`
  const catId = `${EVT}-t3-cat`

  await seedEmpresa(empresaId)
  await seedEvento({ id: eventoId, empresaId })
  await seedCategoria({ id: catId, eventoId })

  // 3 valid + 2 cancelled today
  for (let i = 1; i <= 3; i++) {
    await seedEntrada({
      id: `${EVT}-t3-val${i}`,
      eventoId,
      categoriaId: catId,
      estado: 'valida',
      precioPagado: 1000,
      comision: 100,
      mpFeeAmount: 50,
    })
  }
  for (let i = 1; i <= 2; i++) {
    await seedEntrada({
      id: `${EVT}-t3-can${i}`,
      eventoId,
      categoriaId: catId,
      estado: 'cancelada',
      precioPagado: 1000,
      comision: 100,
      mpFeeAmount: 50,
    })
  }

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/entradas/summary`, user)

    assert.equal(status, 200)
    const { periodo } = (data as any).data

    assert.equal(periodo.hoy.vendidas, 3, `Expected vendidas=3, got ${periodo.hoy.vendidas}`)
    assert.equal(periodo.hoy.canceladas, 2, `Expected canceladas=2, got ${periodo.hoy.canceladas}`)
    // brutos only from non-cancelled: 3 * 1000 = 3000
    assert.equal(periodo.hoy.brutos, 3000, `Expected brutos=3000, got ${periodo.hoy.brutos}`)
    // tasa_cancelacion_pct = 2 / (3+2) * 100 = 40
    assert.equal(periodo.ultimos_30d.tasa_cancelacion_pct, 40, `Expected tasa=40, got ${periodo.ultimos_30d.tasa_cancelacion_pct}`)
  } finally {
    await server.close()
  }
})

// T4: Empleado without ver_recaudacion → 403
test('esum-t4: empleado without ver_recaudacion gets 403', async () => {
  const empresaId = `${EMP}-t4`
  const userId = `${USR}-t4`

  await seedEmpresa(empresaId)
  await seedEmpleado(userId, empresaId, { ver_entradas: true }) // has ver_entradas but NOT ver_recaudacion

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpleadoUser(userId, empresaId, { ver_entradas: true })
    const { status } = await requestJson(`${server.baseUrl}/api/entradas/summary`, user)

    assert.equal(status, 403, `Expected 403 for empleado without ver_recaudacion, got ${status}`)
  } finally {
    await server.close()
  }
})

// T5: Tenant scoping — entradas from another empresa NOT counted
test('esum-t5: entradas from another empresa are not counted', async () => {
  const empresaId = `${EMP}-t5a`
  const otraEmpresaId = `${EMP}-t5b`
  const eventoIdA = `${EVT}-t5a-ev`
  const eventoIdB = `${EVT}-t5b-ev`
  const catIdA = `${EVT}-t5a-cat`
  const catIdB = `${EVT}-t5b-cat`

  await seedEmpresa(empresaId)
  await seedEmpresa(otraEmpresaId)
  await seedEvento({ id: eventoIdA, empresaId })
  await seedEvento({ id: eventoIdB, empresaId: otraEmpresaId })
  await seedCategoria({ id: catIdA, eventoId: eventoIdA })
  await seedCategoria({ id: catIdB, eventoId: eventoIdB })

  // 2 entradas for empresaId, 5 for otraEmpresaId
  for (let i = 1; i <= 2; i++) {
    await seedEntrada({ id: `${EVT}-t5a-en${i}`, eventoId: eventoIdA, categoriaId: catIdA, estado: 'valida', precioPagado: 1000, comision: 100, mpFeeAmount: 50 })
  }
  for (let i = 1; i <= 5; i++) {
    await seedEntrada({ id: `${EVT}-t5b-en${i}`, eventoId: eventoIdB, categoriaId: catIdB, estado: 'valida', precioPagado: 1000, comision: 100, mpFeeAmount: 50 })
  }

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/entradas/summary`, user)

    assert.equal(status, 200)
    const { periodo } = (data as any).data

    assert.equal(periodo.hoy.vendidas, 2, `Expected vendidas=2 (only own empresa), got ${periodo.hoy.vendidas}`)
  } finally {
    await server.close()
  }
})

// T6: ventas_por_dia includes exactly 30 entries with 0s for empty days
test('esum-t6: ventas_por_dia has 30 entries including zero-fill for empty days', async () => {
  const empresaId = `${EMP}-t6`
  const eventoId = `${EVT}-t6-ev`
  const catId = `${EVT}-t6-cat`

  await seedEmpresa(empresaId)
  await seedEvento({ id: eventoId, empresaId })
  await seedCategoria({ id: catId, eventoId })

  // Insert 1 entrada today — only 1 day out of 30 has data
  await seedEntrada({ id: `${EVT}-t6-en1`, eventoId, categoriaId: catId, estado: 'valida', precioPagado: 1000, comision: 100, mpFeeAmount: 50 })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/entradas/summary`, user)

    assert.equal(status, 200)
    const { ventas_por_dia } = (data as any).data

    assert.equal(ventas_por_dia.length, 30, `Expected exactly 30 days, got ${ventas_por_dia.length}`)

    // All entries must have valid YYYY-MM-DD fecha
    for (const dia of ventas_por_dia) {
      assert.match(dia.fecha, /^\d{4}-\d{2}-\d{2}$/, `fecha must be YYYY-MM-DD, got ${dia.fecha}`)
    }

    // Dates must be in ascending order
    for (let i = 1; i < ventas_por_dia.length; i++) {
      assert.ok(ventas_por_dia[i].fecha >= ventas_por_dia[i - 1].fecha, `Dates must be in ascending order`)
    }

    // At least 29 days have 0 vendidas (only today has data)
    const zeroDays = ventas_por_dia.filter((d: any) => d.vendidas === 0)
    assert.ok(zeroDays.length >= 29, `Expected at least 29 zero days, got ${zeroDays.length}`)

    // Today must have 1 vendida
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const todayStr = today.toISOString().slice(0, 10)
    const todayEntry = ventas_por_dia.find((d: any) => d.fecha === todayStr)
    assert.ok(todayEntry, `Today (${todayStr}) must appear in ventas_por_dia`)
    assert.equal(todayEntry.vendidas, 1, `Expected vendidas=1 for today, got ${todayEntry.vendidas}`)
  } finally {
    await server.close()
  }
})
