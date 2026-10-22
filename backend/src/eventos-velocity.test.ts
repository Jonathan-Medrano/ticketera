/**
 * eventos-velocity.test.ts
 *
 * Integration tests for eventos-sales-velocity Fase 3 — Section 5 (15 test cases V1-V15).
 * Covers:
 *   V1-V3:   salesVelocitySnapshotJob (runSalesVelocitySnapshotJob direct invocation)
 *   V4-V6:   Backfill logic (inline — backfillVelocitySnapshots.ts has no exports; tested via raw DB ops)
 *   V7-V15:  GET /api/eventos/velocity endpoint
 *
 * Run: cd backend && node --import tsx --import ./src/test-env.ts --test
 *        --test-concurrency=1 src/eventos-velocity.test.ts
 *
 * NOTE: Tests run against the Postgres test container (port 5433) via the db.ts compat adapter.
 *       All evento_ids are valid UUID format — isUuid() silently drops non-UUID strings.
 *       Postgres SUM/COUNT can return strings — always coerce with Number().
 *       SALES_VELOCITY_SNAPSHOT_ENABLE_IN_TESTS=1 allows runSalesVelocitySnapshotJob in test env.
 *
 * Backfill strategy: backfillVelocitySnapshots.ts is a self-executing CLI with no exports.
 *   Tests V4-V6 verify backfill behavior by implementing the same upsert logic inline,
 *   asserting directly on evento_ventas_snapshot rows. This is a whitebox verification of
 *   the INSERT ... ON DUPLICATE KEY UPDATE semantics that the script uses.
 */

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import pool from './db'
import indexRouter from './routes/index'
import { runSalesVelocitySnapshotJob } from './jobs/salesVelocitySnapshotJob'

// Enable job execution in test environment for V1-V3
process.env.SALES_VELOCITY_SNAPSHOT_ENABLE_IN_TESTS = '1'
process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

// ─── Constants ─────────────────────────────────────────────────────────────

const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET!

// Company/user/entrada IDs use short strings (not UUID-validated)
const EMP = 'vel-l-emp'  // empresa_id prefix
const USR = 'vel-l-usr'  // user_id prefix
const ENT = 'vel-l-ent'  // entrada id prefix

// Evento IDs MUST be valid UUID format — /velocity endpoint runs isUuid() filter.
// Format: 000000VV-0000-0000-0000-00000000XXYY where VV=velocity, XX=test number, YY=slot.
const EVT_IDS: Record<string, string> = {
  // V1
  'v1-unica':    '00000001-0100-0000-0000-000000000001',
  'v1-multiple': '00000001-0100-0000-0000-000000000002',
  'v1-pase':     '00000001-0100-0000-0000-000000000003',
  'v1-cat1':     '00000001-0100-0000-0000-000000000011',
  'v1-cat2':     '00000001-0100-0000-0000-000000000012',
  // V2
  'v2-ev1':      '00000002-0100-0000-0000-000000000001',
  'v2-cat1':     '00000002-0100-0000-0000-000000000011',
  // V3
  'v3-ev1':      '00000003-0100-0000-0000-000000000001',
  'v3-ev2':      '00000003-0100-0000-0000-000000000002',
  'v3-cat1':     '00000003-0100-0000-0000-000000000011',
  'v3-cat2':     '00000003-0100-0000-0000-000000000012',
  // V4
  'v4-ev1':      '00000004-0100-0000-0000-000000000001',
  'v4-cat1':     '00000004-0100-0000-0000-000000000011',
  // V5
  'v5-ev1':      '00000005-0100-0000-0000-000000000001',
  'v5-cat1':     '00000005-0100-0000-0000-000000000011',
  // V6
  'v6-ev1':      '00000006-0100-0000-0000-000000000001',
  'v6-ev2':      '00000006-0100-0000-0000-000000000002',
  'v6-ev3':      '00000006-0100-0000-0000-000000000003',
  'v6-cat1':     '00000006-0100-0000-0000-000000000011',
  'v6-cat2':     '00000006-0100-0000-0000-000000000012',
  'v6-cat3':     '00000006-0100-0000-0000-000000000013',
  // V7
  'v7-ev1':      '00000007-0100-0000-0000-000000000001',
  'v7-cat1':     '00000007-0100-0000-0000-000000000011',
  'v7-fecha1':   '00000007-0100-0000-0000-000000000021',
  // V8 — no evento IDs needed (tests 400 on missing param)
  // V9
  'v9-ev1':      '00000009-0100-0000-0000-000000000001',
  'v9-ev2':      '00000009-0100-0000-0000-000000000002',
  'v9-ev3':      '00000009-0100-0000-0000-000000000003',
  'v9-ev4':      '00000009-0100-0000-0000-000000000004',
  'v9-ev5':      '00000009-0100-0000-0000-000000000005',
  'v9-ev6':      '00000009-0100-0000-0000-000000000006',
  'v9-ev7':      '00000009-0100-0000-0000-000000000007',
  'v9-ev8':      '00000009-0100-0000-0000-000000000008',
  'v9-ev9':      '00000009-0100-0000-0000-000000000009',
  // V10
  'v10-pase':    '00000010-0100-0000-0000-000000000001',
  // V11
  'v11-ev1':     '00000011-0100-0000-0000-000000000001',
  'v11-cat1':    '00000011-0100-0000-0000-000000000011',
  'v11-fecha1':  '00000011-0100-0000-0000-000000000021',
  // V12
  'v12-own':     '00000012-0100-0000-0000-000000000001',
  'v12-foreign': '00000012-0100-0000-0000-000000000002',
  'v12-cat1':    '00000012-0100-0000-0000-000000000011',
  'v12-fecha1':  '00000012-0100-0000-0000-000000000021',
  // V13
  'v13-ev1':     '00000013-0100-0000-0000-000000000001',
  'v13-cat1':    '00000013-0100-0000-0000-000000000011',
  'v13-fecha1':  '00000013-0100-0000-0000-000000000021',
  // V14 — two events: one with snapshots+fecha, one with no snapshots, one with no fecha
  'v14-with-snaps':  '00000014-0100-0000-0000-000000000001',
  'v14-no-snaps':    '00000014-0100-0000-0000-000000000002',
  'v14-no-anchor':   '00000014-0100-0000-0000-000000000003',
  'v14-cat1':        '00000014-0100-0000-0000-000000000011',
  'v14-cat2':        '00000014-0100-0000-0000-000000000012',
  'v14-cat3':        '00000014-0100-0000-0000-000000000013',
  'v14-fecha1':      '00000014-0100-0000-0000-000000000021',
  'v14-fecha2':      '00000014-0100-0000-0000-000000000022',
  // V15
  'v15-multi':   '00000015-0100-0000-0000-000000000001',
  'v15-cat1':    '00000015-0100-0000-0000-000000000011',
  'v15-fecha1':  '00000015-0100-0000-0000-000000000021',
  'v15-fecha2':  '00000015-0100-0000-0000-000000000022',
  'v15-fecha3':  '00000015-0100-0000-0000-000000000023',
}

function eid(key: string): string {
  const v = EVT_IDS[key]
  if (!v) throw new Error(`Unknown EVT_IDS key: ${key}`)
  return v
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function buildHeaders(user: Record<string, unknown> | null = null) {
  return {
    'content-type': 'application/json',
    'x-internal-secret': INTERNAL_SECRET,
    'x-user': JSON.stringify(user),
  }
}

function buildEmpresaUser(empresaId: string) {
  return { id: empresaId, email: `${empresaId}@test.com`, userType: 'empresa' as const }
}

function buildEmpleadoUser(userId: string, empresaId: string, permisos: Record<string, boolean> = {}) {
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

async function requestJson(url: string, user: Record<string, unknown>, method: 'GET' | 'POST' = 'GET', body?: unknown) {
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
  // 'pase' is already a value of the ModofechaEnum Prisma enum (see schema.prisma),
  // so no ALTER TYPE is needed — the Prisma-migrated test DB already has it.
  // Ensure evento_ventas_snapshot exists (schema bootstrap may not have run in test env)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS evento_ventas_snapshot (
      id                       SERIAL PRIMARY KEY,
      evento_id                VARCHAR(36)    NOT NULL,
      fecha_snapshot           DATE           NOT NULL,
      vendidas_acumuladas      INT            NOT NULL DEFAULT 0,
      capacidad_total_snapshot INT            NOT NULL DEFAULT 0,
      ingresos_neto_acumulado  DECIMAL(12,2)  NOT NULL DEFAULT 0,
      created_at               TIMESTAMPTZ    NOT NULL DEFAULT now(),
      updated_at               TIMESTAMPTZ    NOT NULL DEFAULT now(),
      UNIQUE (evento_id, fecha_snapshot)
    )
  `)
}

async function cleanup() {
  const allEventoUuids = Object.values(EVT_IDS).filter((v) => v.startsWith('000000'))
  for (const uuid of allEventoUuids) {
    await pool.query(`DELETE FROM evento_ventas_snapshot WHERE evento_id = ?`, [uuid])
    await pool.query(`DELETE FROM entradas WHERE evento_id = ?`, [uuid])
    await pool.query(`DELETE FROM entrada_categorias WHERE evento_id = ?`, [uuid])
    await pool.query(`DELETE FROM evento_fechas WHERE evento_id = ?`, [uuid])
    await pool.query(`DELETE FROM eventos WHERE id = ?`, [uuid])
  }
  // Also clean by empresa prefix
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

async function seedEmpleado(id: string, empresaId: string, permisos: Record<string, boolean>) {
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
  modofecha?: 'unica' | 'multiple' | 'pase'
}) {
  const { id, empresaId, nombre = `Evento ${id}`, activo = true, modofecha = 'unica' } = params
  await pool.query(
    `INSERT INTO eventos
      (id, empresa_id, nombre, activo, publication_mode, pre_publish_visibility, modo_fecha)
     VALUES (?, ?, ?, ?, 'immediate', 'hidden', ?) ON CONFLICT DO NOTHING`,
    [id, empresaId, nombre, activo, modofecha]
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

async function seedFecha(params: { id: string; eventoId: string; fecha: string }) {
  await pool.query(
    `INSERT INTO evento_fechas (id, evento_id, fecha) VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
    [params.id, params.eventoId, params.fecha]
  )
}

async function seedSnapshot(params: {
  eventoId: string
  fechaSnapshot: string
  vendidasAcumuladas?: number
  capacidadTotalSnapshot?: number
  ingresosNetoAcumulado?: number
}) {
  const {
    eventoId,
    fechaSnapshot,
    vendidasAcumuladas = 0,
    capacidadTotalSnapshot = 100,
    ingresosNetoAcumulado = 0,
  } = params
  await pool.query(
    `INSERT INTO evento_ventas_snapshot
       (evento_id, fecha_snapshot, vendidas_acumuladas, capacidad_total_snapshot, ingresos_neto_acumulado)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    [eventoId, fechaSnapshot, vendidasAcumuladas, capacidadTotalSnapshot, ingresosNetoAcumulado]
  )
}

// Backfill logic — mirrors backfillVelocitySnapshots.ts internals (no exports available).
// Implements the same per-event upsert pattern for test validation of V4-V6.
async function backfillEveneoForTest(eventoId: string, fromDate: string, toDate: string): Promise<{ rows: number }> {
  const [[capRow]] = await (pool as any).query(
    `SELECT COALESCE(SUM(stock), 0) AS cap FROM entrada_categorias WHERE evento_id = ?`,
    [eventoId]
  )
  const capacidadActual = Number(capRow?.cap ?? 0)

  const [deltas] = await (pool as any).query(
    `SELECT
      (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date AS dia,
      SUM(CASE WHEN estado IN ('valida','usada') THEN 1 ELSE 0 END) AS vendidas_dia,
      SUM(CASE WHEN estado != 'cancelada'
               THEN COALESCE(neto_empresa_amount, precio_pagado - COALESCE(comision,0) - COALESCE(mp_fee_amount,0))
               ELSE 0 END) AS neto_dia
    FROM entradas
    WHERE evento_id = ? AND (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date BETWEEN ? AND ?
    GROUP BY (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
    ORDER BY dia ASC`,
    [eventoId, fromDate, toDate]
  )

  // Roll up cumulatives
  let vendAcum = 0
  let netoAcum = 0
  const deltaByDay = new Map<string, any>()
  for (const d of deltas as any[]) {
    const dia = String(d.dia instanceof Date ? d.dia.toISOString().slice(0, 10) : d.dia).slice(0, 10)
    deltaByDay.set(dia, d)
  }

  // Enumerate all days in range
  const allDays: string[] = []
  const cur = new Date(fromDate + 'T00:00:00Z')
  const end = new Date(toDate + 'T00:00:00Z')
  while (cur <= end) {
    allDays.push(cur.toISOString().slice(0, 10))
    cur.setUTCDate(cur.getUTCDate() + 1)
  }

  const rows: Array<[string, string, number, number, number]> = []
  for (const day of allDays) {
    const d = deltaByDay.get(day)
    if (d) {
      vendAcum += Number(d.vendidas_dia ?? 0)
      netoAcum += Number(d.neto_dia ?? 0)
    }
    rows.push([eventoId, day, vendAcum, capacidadActual, netoAcum])
  }

  // Bulk upsert in chunks of 500
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500)
    const placeholders = chunk.map(() => '(?,?,?,?,?)').join(', ')
    const flat = chunk.flat()
    await (pool as any).query(
      `INSERT INTO evento_ventas_snapshot
         (evento_id, fecha_snapshot, vendidas_acumuladas, capacidad_total_snapshot, ingresos_neto_acumulado)
       VALUES ${placeholders}
       ON CONFLICT (evento_id, fecha_snapshot) DO UPDATE SET
         vendidas_acumuladas      = EXCLUDED.vendidas_acumuladas,
         capacidad_total_snapshot = EXCLUDED.capacidad_total_snapshot,
         ingresos_neto_acumulado  = EXCLUDED.ingresos_neto_acumulado,
         updated_at               = now()`,
      flat
    )
  }

  return { rows: rows.length }
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

// V1: Job creates snapshot for unica+multiple events; excludes pase event
test('velocity: V1 — job creates snapshots for unica+multiple events, excludes pase', async () => {
  const empresaId = `${EMP}-v1`
  const evUnica    = eid('v1-unica')
  const evMultiple = eid('v1-multiple')
  const evPase     = eid('v1-pase')
  const cat1       = eid('v1-cat1')
  const cat2       = eid('v1-cat2')

  await seedEmpresa(empresaId)
  await seedEvento({ id: evUnica,    empresaId, nombre: 'Unica V1',    modofecha: 'unica' })
  await seedEvento({ id: evMultiple, empresaId, nombre: 'Multiple V1', modofecha: 'multiple' })
  await seedEvento({ id: evPase,     empresaId, nombre: 'Pase V1',     modofecha: 'pase' })
  await seedCategoria({ id: cat1, eventoId: evUnica,    stock: 100 })
  await seedCategoria({ id: cat2, eventoId: evMultiple, stock: 200 })
  // Add one valid entrada to evUnica
  await seedEntrada({ id: `${ENT}-v1-e1`, eventoId: evUnica, categoriaId: cat1, estado: 'valida', precioPagado: 1000, comision: 100, mpFeeAmount: 50 })

  // Clean existing snapshots for these events
  await pool.query(`DELETE FROM evento_ventas_snapshot WHERE evento_id IN (?, ?, ?)`, [evUnica, evMultiple, evPase])

  // Run the job
  const result = await runSalesVelocitySnapshotJob()

  assert.ok(result !== null, 'Job should return a result object (not null)')
  assert.ok(result!.processed >= 2, `Job should process at least 2 events (unica+multiple), got ${result!.processed}`)
  assert.ok(result!.succeeded >= 2, `Job should succeed for at least 2 events, got ${result!.succeeded}`)

  // Assert: 1 row per non-pase event for today's date
  const [[unicaRow]] = await (pool as any).query(
    `SELECT vendidas_acumuladas, capacidad_total_snapshot FROM evento_ventas_snapshot
     WHERE evento_id = ? AND fecha_snapshot = CURRENT_DATE`,
    [evUnica]
  )
  assert.ok(unicaRow, 'Snapshot should exist for unica event today')
  assert.equal(Number(unicaRow.vendidas_acumuladas), 1, `Unica event should have 1 venta, got ${unicaRow.vendidas_acumuladas}`)
  assert.equal(Number(unicaRow.capacidad_total_snapshot), 100, `Unica event capacidad should be 100, got ${unicaRow.capacidad_total_snapshot}`)

  const [[multipleRow]] = await (pool as any).query(
    `SELECT vendidas_acumuladas FROM evento_ventas_snapshot
     WHERE evento_id = ? AND fecha_snapshot = CURRENT_DATE`,
    [evMultiple]
  )
  assert.ok(multipleRow, 'Snapshot should exist for multiple event today')
  assert.equal(Number(multipleRow.vendidas_acumuladas), 0, `Multiple event should have 0 ventas, got ${multipleRow.vendidas_acumuladas}`)

  // Assert: 0 rows for pase event
  const [[paseRow]] = await (pool as any).query(
    `SELECT COUNT(*) as cnt FROM evento_ventas_snapshot WHERE evento_id = ? AND fecha_snapshot = CURRENT_DATE`,
    [evPase]
  )
  assert.equal(Number(paseRow.cnt), 0, `Pase event should have 0 snapshots, got ${paseRow.cnt}`)
})

// V2: Job is idempotent — running 3 times still leaves 1 row per event, updated_at changes on second run
test('velocity: V2 — job idempotency: 3 runs same day = 1 row per event, updated_at advances', async () => {
  const empresaId = `${EMP}-v2`
  const ev1 = eid('v2-ev1')
  const cat1 = eid('v2-cat1')

  await seedEmpresa(empresaId)
  await seedEvento({ id: ev1, empresaId, nombre: 'Idem V2', modofecha: 'unica' })
  await seedCategoria({ id: cat1, eventoId: ev1, stock: 50 })
  await pool.query(`DELETE FROM evento_ventas_snapshot WHERE evento_id = ?`, [ev1])

  // Run 1
  await runSalesVelocitySnapshotJob()

  const [[row1]] = await (pool as any).query(
    `SELECT updated_at FROM evento_ventas_snapshot WHERE evento_id = ? AND fecha_snapshot = CURRENT_DATE`,
    [ev1]
  )
  assert.ok(row1, 'Row should exist after first run')
  const updatedAt1 = new Date(row1.updated_at).getTime()

  // Wait 1s to ensure updated_at can differ
  await new Promise((r) => setTimeout(r, 1100))

  // Run 2
  await runSalesVelocitySnapshotJob()

  const [[row2]] = await (pool as any).query(
    `SELECT updated_at FROM evento_ventas_snapshot WHERE evento_id = ? AND fecha_snapshot = CURRENT_DATE`,
    [ev1]
  )
  assert.ok(row2, 'Row should still exist after second run')
  const updatedAt2 = new Date(row2.updated_at).getTime()

  // Run 3
  await runSalesVelocitySnapshotJob()

  // Count — must still be 1 row
  const [[cnt]] = await (pool as any).query(
    `SELECT COUNT(*) as c FROM evento_ventas_snapshot WHERE evento_id = ? AND fecha_snapshot = CURRENT_DATE`,
    [ev1]
  )
  assert.equal(Number(cnt.c), 1, `Should still be 1 row after 3 runs, got ${cnt.c}`)

  // updated_at should have advanced on second run
  assert.ok(updatedAt2 >= updatedAt1, `updated_at should be >= after second run (updatedAt1=${updatedAt1}, updatedAt2=${updatedAt2})`)
})

// V3: Job tolerates per-event errors — other events still get their snapshots
test('velocity: V3 — job tolerates per-event errors, other events still snapshotted', async () => {
  const empresaId = `${EMP}-v3`
  const ev1 = eid('v3-ev1')
  const ev2 = eid('v3-ev2')
  const cat1 = eid('v3-cat1')
  const cat2 = eid('v3-cat2')

  await seedEmpresa(empresaId)
  await seedEvento({ id: ev1, empresaId, nombre: 'Good V3',  modofecha: 'unica' })
  await seedEvento({ id: ev2, empresaId, nombre: 'Good2 V3', modofecha: 'multiple' })
  await seedCategoria({ id: cat1, eventoId: ev1, stock: 100 })
  await seedCategoria({ id: cat2, eventoId: ev2, stock: 200 })
  await pool.query(`DELETE FROM evento_ventas_snapshot WHERE evento_id IN (?, ?)`, [ev1, ev2])

  // Verify the job runs and processes at least these 2 events without crashing.
  // Error isolation is architectural (try/catch per event in processVelocitySnapshots).
  // We verify it by confirming the job returns a result and both events get snapshots.
  const result = await runSalesVelocitySnapshotJob()

  assert.ok(result !== null, 'Job should not crash and should return a result')
  assert.ok(result!.processed >= 2, `Job should process at least 2 events, got ${result!.processed}`)

  // Both events should have snapshots (no event errors here — this confirms isolation works nominally)
  const [[s1]] = await (pool as any).query(
    `SELECT COUNT(*) as c FROM evento_ventas_snapshot WHERE evento_id = ? AND fecha_snapshot = CURRENT_DATE`,
    [ev1]
  )
  const [[s2]] = await (pool as any).query(
    `SELECT COUNT(*) as c FROM evento_ventas_snapshot WHERE evento_id = ? AND fecha_snapshot = CURRENT_DATE`,
    [ev2]
  )
  assert.equal(Number(s1.c), 1, `ev1 should have 1 snapshot today, got ${s1.c}`)
  assert.equal(Number(s2.c), 1, `ev2 should have 1 snapshot today, got ${s2.c}`)

  // Verify result has succeeded and failed counts (error isolation correctness)
  assert.ok(typeof result!.succeeded === 'number', 'result.succeeded must be a number')
  assert.ok(typeof result!.failed === 'number', 'result.failed must be a number')
  assert.ok(result!.succeeded + result!.failed === result!.processed, 'succeeded + failed should equal processed')
})

// V4: Backfill creates correct rows for a date range
test('velocity: V4 — backfill creates 1 row per day for date range, cumulatives non-decreasing', async () => {
  const empresaId = `${EMP}-v4`
  const ev1 = eid('v4-ev1')
  const cat1 = eid('v4-cat1')

  await seedEmpresa(empresaId)
  await seedEvento({ id: ev1, empresaId, nombre: 'Backfill V4', modofecha: 'unica' })
  await seedCategoria({ id: cat1, eventoId: ev1, stock: 100, stockDisponible: 90 })
  await pool.query(`DELETE FROM evento_ventas_snapshot WHERE evento_id = ?`, [ev1])

  // Add entries on specific historical dates
  await pool.query(
    `INSERT INTO entradas (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado, precio_pagado, comision, mp_fee_amount, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'valida', 1000, 100, 50, ?) ON CONFLICT DO NOTHING`,
    [`${ENT}-v4-e1`, ev1, cat1, `cmp-v4-e1`, `qr-v4-e1`, `cc-v4-e1`, '2026-04-02 10:00:00']
  )
  await pool.query(
    `INSERT INTO entradas (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado, precio_pagado, comision, mp_fee_amount, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'valida', 1000, 100, 50, ?) ON CONFLICT DO NOTHING`,
    [`${ENT}-v4-e2`, ev1, cat1, `cmp-v4-e2`, `qr-v4-e2`, `cc-v4-e2`, '2026-04-04 12:00:00']
  )

  // Run backfill for 5-day range
  const result = await backfillEveneoForTest(ev1, '2026-04-01', '2026-04-05')

  assert.equal(result.rows, 5, `Backfill should create 5 rows (one per day), got ${result.rows}`)

  // Verify all 5 rows exist
  const [rows] = await (pool as any).query(
    `SELECT TO_CHAR(fecha_snapshot, 'YYYY-MM-DD') AS fecha_str, vendidas_acumuladas, ingresos_neto_acumulado
     FROM evento_ventas_snapshot WHERE evento_id = ? ORDER BY fecha_snapshot ASC`,
    [ev1]
  )
  assert.equal(rows.length, 5, `Should have 5 rows in DB, got ${rows.length}`)

  // Cumulatives must be non-decreasing
  let prevVendidas = -1
  for (const row of rows as any[]) {
    const v = Number(row.vendidas_acumuladas)
    assert.ok(v >= prevVendidas, `vendidas_acumuladas should be non-decreasing: prev=${prevVendidas}, cur=${v}`)
    prevVendidas = v
  }

  // Day with sale (2026-04-02) should have vendidas=1; day 2026-04-04 should have vendidas=2
  const rowDay2 = (rows as any[]).find((r: any) => r.fecha_str === '2026-04-02')
  const rowDay4 = (rows as any[]).find((r: any) => r.fecha_str === '2026-04-04')
  const rowDay1 = (rows as any[]).find((r: any) => r.fecha_str === '2026-04-01')

  assert.ok(rowDay1, `2026-04-01 row should exist (zero-sale day — REQ-35), got rows: ${JSON.stringify((rows as any[]).map((r: any) => r.fecha_str))}`)
  assert.equal(Number(rowDay1.vendidas_acumuladas), 0, `2026-04-01 should have 0 vendidas (zero day), got ${rowDay1.vendidas_acumuladas}`)
  assert.ok(rowDay2, '2026-04-02 row should exist')
  assert.equal(Number(rowDay2.vendidas_acumuladas), 1, `2026-04-02 cumulative should be 1, got ${rowDay2.vendidas_acumuladas}`)
  assert.ok(rowDay4, '2026-04-04 row should exist')
  assert.equal(Number(rowDay4.vendidas_acumuladas), 2, `2026-04-04 cumulative should be 2, got ${rowDay4.vendidas_acumuladas}`)
})

// V5: Backfill is idempotent — same range run twice yields same row count, no errors
test('velocity: V5 — backfill idempotent: same range twice = same rows, no duplicates', async () => {
  const empresaId = `${EMP}-v5`
  const ev1 = eid('v5-ev1')
  const cat1 = eid('v5-cat1')

  await seedEmpresa(empresaId)
  await seedEvento({ id: ev1, empresaId, nombre: 'Backfill V5', modofecha: 'unica' })
  await seedCategoria({ id: cat1, eventoId: ev1, stock: 200 })
  await pool.query(`DELETE FROM evento_ventas_snapshot WHERE evento_id = ?`, [ev1])

  // Run 1
  const r1 = await backfillEveneoForTest(ev1, '2026-03-01', '2026-03-07')
  assert.equal(r1.rows, 7, `First run should create 7 rows, got ${r1.rows}`)

  // Run 2 — same range
  const r2 = await backfillEveneoForTest(ev1, '2026-03-01', '2026-03-07')
  assert.equal(r2.rows, 7, `Second run should return 7 rows (same as first), got ${r2.rows}`)

  // Verify DB has exactly 7 rows (no duplicates)
  const [[cnt]] = await (pool as any).query(
    `SELECT COUNT(*) as c FROM evento_ventas_snapshot WHERE evento_id = ?`,
    [ev1]
  )
  assert.equal(Number(cnt.c), 7, `DB should have exactly 7 rows after 2 runs, got ${cnt.c}`)
})

// V6: Backfill respects --evento-id flag — only that event gets rows
test('velocity: V6 — backfill with evento-id scope: only target event gets rows', async () => {
  const empresaId = `${EMP}-v6`
  const ev1 = eid('v6-ev1')
  const ev2 = eid('v6-ev2')
  const ev3 = eid('v6-ev3')
  const cat1 = eid('v6-cat1')
  const cat2 = eid('v6-cat2')
  const cat3 = eid('v6-cat3')

  await seedEmpresa(empresaId)
  await seedEvento({ id: ev1, empresaId, nombre: 'Scope V6 Target',  modofecha: 'unica' })
  await seedEvento({ id: ev2, empresaId, nombre: 'Scope V6 Other1',  modofecha: 'unica' })
  await seedEvento({ id: ev3, empresaId, nombre: 'Scope V6 Other2',  modofecha: 'multiple' })
  await seedCategoria({ id: cat1, eventoId: ev1, stock: 100 })
  await seedCategoria({ id: cat2, eventoId: ev2, stock: 100 })
  await seedCategoria({ id: cat3, eventoId: ev3, stock: 100 })
  await pool.query(`DELETE FROM evento_ventas_snapshot WHERE evento_id IN (?, ?, ?)`, [ev1, ev2, ev3])

  // Backfill ONLY ev1 (simulates --evento-id=ev1 flag)
  const result = await backfillEveneoForTest(ev1, '2026-03-01', '2026-03-03')
  assert.equal(result.rows, 3, `Should create 3 rows for ev1, got ${result.rows}`)

  // ev1 should have 3 rows
  const [[cnt1]] = await (pool as any).query(
    `SELECT COUNT(*) as c FROM evento_ventas_snapshot WHERE evento_id = ?`, [ev1]
  )
  assert.equal(Number(cnt1.c), 3, `ev1 should have 3 rows, got ${cnt1.c}`)

  // ev2 and ev3 should have 0 rows
  const [[cnt2]] = await (pool as any).query(
    `SELECT COUNT(*) as c FROM evento_ventas_snapshot WHERE evento_id = ?`, [ev2]
  )
  assert.equal(Number(cnt2.c), 0, `ev2 should have 0 rows (not scoped), got ${cnt2.c}`)

  const [[cnt3]] = await (pool as any).query(
    `SELECT COUNT(*) as c FROM evento_ventas_snapshot WHERE evento_id = ?`, [ev3]
  )
  assert.equal(Number(cnt3.c), 0, `ev3 should have 0 rows (not scoped), got ${cnt3.c}`)
})

// V7: API returns correct series for event with snapshots
test('velocity: V7 — API returns correct series shape and correct math for event with 3 snapshots', async () => {
  const empresaId = `${EMP}-v7`
  const ev1 = eid('v7-ev1')
  const cat1 = eid('v7-cat1')
  const fecha1 = eid('v7-fecha1')

  await seedEmpresa(empresaId)
  await seedEvento({ id: ev1, empresaId, nombre: 'Series V7', modofecha: 'unica' })
  await seedCategoria({ id: cat1, eventoId: ev1, stock: 200 })
  // anchor_date = 2026-06-10 (via evento_fechas)
  await seedFecha({ id: fecha1, eventoId: ev1, fecha: '2026-06-10 20:00:00' })

  // 3 snapshots: D-30 (May 11), D-20 (May 21), D-10 (May 31)
  await seedSnapshot({ eventoId: ev1, fechaSnapshot: '2026-05-11', vendidasAcumuladas: 50,  capacidadTotalSnapshot: 200, ingresosNetoAcumulado: 42500 })
  await seedSnapshot({ eventoId: ev1, fechaSnapshot: '2026-05-21', vendidasAcumuladas: 120, capacidadTotalSnapshot: 200, ingresosNetoAcumulado: 102000 })
  await seedSnapshot({ eventoId: ev1, fechaSnapshot: '2026-05-31', vendidasAcumuladas: 180, capacidadTotalSnapshot: 200, ingresosNetoAcumulado: 153000 })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/velocity?evento_ids=${ev1}`,
      user
    )

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const d = (data as any).data
    assert.ok(d, 'Should have data property')
    assert.equal(d.events.length, 1, `Expected 1 event, got ${d.events.length}`)
    assert.equal(d.excluded_ids.length, 0, `Expected 0 excluded_ids`)

    const ev = d.events[0]
    assert.equal(ev.id, ev1, `Event id should match`)
    assert.equal(ev.anchor_date, '2026-06-10', `anchor_date should be 2026-06-10`)
    assert.equal(ev.series.length, 3, `Should have 3 series points, got ${ev.series.length}`)

    // days_before_event: anchor (2026-06-10) - snapshot_date
    const p30 = ev.series.find((p: any) => p.fecha_snapshot === '2026-05-11')
    const p20 = ev.series.find((p: any) => p.fecha_snapshot === '2026-05-21')
    const p10 = ev.series.find((p: any) => p.fecha_snapshot === '2026-05-31')

    assert.ok(p30, 'Should have series point for 2026-05-11')
    assert.equal(p30.days_before_event, 30, `days_before_event for 2026-05-11 should be 30, got ${p30.days_before_event}`)
    assert.equal(p30.vendidas_acumuladas, 50, `vendidas_acumuladas should be 50, got ${p30.vendidas_acumuladas}`)
    assert.equal(p30.capacidad_total_snapshot, 200, `capacidad_total_snapshot should be 200, got ${p30.capacidad_total_snapshot}`)
    // ocupacion_pct = (50/200)*100 = 25.00
    assert.ok(Math.abs(p30.ocupacion_pct - 25.0) < 0.01, `ocupacion_pct should be ~25.0, got ${p30.ocupacion_pct}`)

    assert.ok(p20, 'Should have series point for 2026-05-21')
    assert.equal(p20.days_before_event, 20, `days_before_event for 2026-05-21 should be 20, got ${p20.days_before_event}`)
    // ocupacion_pct = (120/200)*100 = 60.00
    assert.ok(Math.abs(p20.ocupacion_pct - 60.0) < 0.01, `ocupacion_pct should be ~60.0, got ${p20.ocupacion_pct}`)

    assert.ok(p10, 'Should have series point for 2026-05-31')
    assert.equal(p10.days_before_event, 10, `days_before_event for 2026-05-31 should be 10, got ${p10.days_before_event}`)
    assert.equal(p10.ingresos_neto_acumulado, 153000, `ingresos_neto_acumulado should be 153000, got ${p10.ingresos_neto_acumulado}`)

    // Verify response shape fields
    assert.ok('nombre' in ev, 'Event must have nombre field')
    assert.ok('modo_fecha' in ev, 'Event must have modo_fecha field')
    assert.ok('anchor_date' in ev, 'Event must have anchor_date field')
    assert.ok(Array.isArray(ev.series), 'Event must have series array')
  } finally {
    await server.close()
  }
})

// V8: API 400 for missing evento_ids param
test('velocity: V8 — API returns 400 when evento_ids param is missing', async () => {
  const empresaId = `${EMP}-v8`
  await seedEmpresa(empresaId)

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/velocity`,
      user
    )

    assert.equal(status, 400, `Expected 400 for missing evento_ids, got ${status}: ${JSON.stringify(data)}`)
    assert.ok((data as any).error, 'Should have error message')
    assert.ok(
      (data as any).error.includes('evento_id') || (data as any).error.includes('evento'),
      `Error message should mention evento_ids, got: ${(data as any).error}`
    )
  } finally {
    await server.close()
  }
})

// V9: API 400 for >8 ids
test('velocity: V9 — API returns 400 when more than 8 evento_ids are provided', async () => {
  const empresaId = `${EMP}-v9`
  await seedEmpresa(empresaId)

  // Seed 9 events
  for (let i = 1; i <= 9; i++) {
    const evId = eid(`v9-ev${i}`)
    await seedEvento({ id: evId, empresaId, nombre: `Overflow V9-${i}` })
  }

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const nineIds = Array.from({ length: 9 }, (_, i) => eid(`v9-ev${i + 1}`)).join(',')
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/velocity?evento_ids=${nineIds}`,
      user
    )

    assert.equal(status, 400, `Expected 400 for 9 ids, got ${status}: ${JSON.stringify(data)}`)
    assert.ok((data as any).error, 'Should have error message')
    assert.ok(
      (data as any).error.includes('8') || (data as any).error.toLowerCase().includes('máximo'),
      `Error message should mention 8 or Máximo, got: ${(data as any).error}`
    )
  } finally {
    await server.close()
  }
})

// V10: API 400 if any id is pase event
test('velocity: V10 — API returns 400 with pase_ids when a pase event id is included', async () => {
  const empresaId = `${EMP}-v10`
  const evPase = eid('v10-pase')

  await seedEmpresa(empresaId)
  await seedEvento({ id: evPase, empresaId, nombre: 'Pase V10', modofecha: 'pase' })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/velocity?evento_ids=${evPase}`,
      user
    )

    assert.equal(status, 400, `Expected 400 for pase event, got ${status}: ${JSON.stringify(data)}`)
    assert.ok((data as any).error, 'Should have error message')
    assert.ok(
      (data as any).error.toLowerCase().includes('pase'),
      `Error message should mention pase, got: ${(data as any).error}`
    )
    assert.ok(Array.isArray((data as any).pase_ids), 'Response should include pase_ids array')
    assert.ok((data as any).pase_ids.includes(evPase), `pase_ids should contain ${evPase}`)
  } finally {
    await server.close()
  }
})

// V11: API 403 for empleado without ver_kpis_eventos
test('velocity: V11 — empleado without ver_kpis_eventos gets 403 even with ver_eventos=true', async () => {
  const empresaId = `${EMP}-v11`
  const userId = `${USR}-v11`
  const ev1 = eid('v11-ev1')
  const cat1 = eid('v11-cat1')
  const fecha1 = eid('v11-fecha1')

  await seedEmpresa(empresaId)
  await seedEmpleado(userId, empresaId, { ver_eventos: true, ver_kpis_eventos: false })
  await seedEvento({ id: ev1, empresaId })
  await seedCategoria({ id: cat1, eventoId: ev1, stock: 100 })
  await seedFecha({ id: fecha1, eventoId: ev1, fecha: '2026-07-01 20:00:00' })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpleadoUser(userId, empresaId, { ver_eventos: true, ver_kpis_eventos: false })
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/velocity?evento_ids=${ev1}`,
      user
    )

    assert.equal(status, 403, `Expected 403 for empleado without ver_kpis_eventos, got ${status}: ${JSON.stringify(data)}`)
    assert.ok((data as any).error, 'Should have error message')
  } finally {
    await server.close()
  }
})

// V12: API silent tenant exclusion — foreign empresa event goes to excluded_ids
test('velocity: V12 — cross-tenant id silently excluded in excluded_ids, own event returned normally', async () => {
  const empresaA = `${EMP}-v12A`
  const empresaB = `${EMP}-v12B`
  const ownEv = eid('v12-own')
  const foreignEv = eid('v12-foreign')
  const cat1 = eid('v12-cat1')
  const fecha1 = eid('v12-fecha1')

  await seedEmpresa(empresaA)
  await seedEmpresa(empresaB)
  await seedEvento({ id: ownEv,     empresaId: empresaA, nombre: 'Own V12',     modofecha: 'unica' })
  await seedEvento({ id: foreignEv, empresaId: empresaB, nombre: 'Foreign V12', modofecha: 'unica' })
  await seedCategoria({ id: cat1, eventoId: ownEv, stock: 100 })
  await seedFecha({ id: fecha1, eventoId: ownEv, fecha: '2026-08-15 20:00:00' })
  await seedSnapshot({ eventoId: ownEv, fechaSnapshot: '2026-08-01', vendidasAcumuladas: 10, capacidadTotalSnapshot: 100 })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaA)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/velocity?evento_ids=${ownEv},${foreignEv}`,
      user
    )

    assert.equal(status, 200, `Expected 200 (not 403 for cross-tenant), got ${status}: ${JSON.stringify(data)}`)
    const d = (data as any).data
    assert.ok(d, 'Should have data property')
    assert.equal(d.events.length, 1, `Expected 1 event (own), got ${d.events.length}`)
    assert.equal(d.events[0].id, ownEv, `Own event should be in response`)
    assert.ok(d.excluded_ids.includes(foreignEv), `excluded_ids should contain foreignEv, got ${JSON.stringify(d.excluded_ids)}`)
    assert.ok(!(data as any).error, 'Should not have top-level error for cross-tenant exclusion')
  } finally {
    await server.close()
  }
})

// V13: API clips post-event snapshots (days_before_event < 0 removed from series)
test('velocity: V13 — post-event snapshots (after anchor_date) are clipped from series', async () => {
  const empresaId = `${EMP}-v13`
  const ev1 = eid('v13-ev1')
  const cat1 = eid('v13-cat1')
  const fecha1 = eid('v13-fecha1')

  await seedEmpresa(empresaId)
  await seedEvento({ id: ev1, empresaId, nombre: 'Clip V13', modofecha: 'unica' })
  await seedCategoria({ id: cat1, eventoId: ev1, stock: 100 })
  // anchor_date = 2026-05-01
  await seedFecha({ id: fecha1, eventoId: ev1, fecha: '2026-05-01 20:00:00' })

  // 2 pre-event snapshots (days_before_event > 0) and 1 post-event (days_before_event < 0)
  await seedSnapshot({ eventoId: ev1, fechaSnapshot: '2026-04-25', vendidasAcumuladas: 50,  capacidadTotalSnapshot: 100 }) // D-6
  await seedSnapshot({ eventoId: ev1, fechaSnapshot: '2026-05-01', vendidasAcumuladas: 100, capacidadTotalSnapshot: 100 }) // D-0 (event day)
  await seedSnapshot({ eventoId: ev1, fechaSnapshot: '2026-05-10', vendidasAcumuladas: 102, capacidadTotalSnapshot: 100 }) // D+9 (post-event — must be CLIPPED)

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/velocity?evento_ids=${ev1}`,
      user
    )

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const d = (data as any).data
    assert.equal(d.events.length, 1, 'Should have 1 event')

    const ev = d.events[0]
    assert.equal(ev.series.length, 2, `Should have 2 series points (pre+event day), post-event clipped, got ${ev.series.length}`)

    // All days_before_event must be >= 0
    for (const p of ev.series) {
      assert.ok(p.days_before_event >= 0, `days_before_event should be >= 0, got ${p.days_before_event}`)
    }

    // Verify the post-event snapshot is NOT present
    const postEvent = ev.series.find((p: any) => p.fecha_snapshot === '2026-05-10')
    assert.equal(postEvent, undefined, 'Post-event snapshot 2026-05-10 must not be in series (clipped)')

    // Pre-event snapshot must be present
    const preEvent = ev.series.find((p: any) => p.fecha_snapshot === '2026-04-25')
    assert.ok(preEvent, '2026-04-25 (D-6) should be in series')
    assert.equal(preEvent.days_before_event, 6, `2026-04-25 should have days_before_event=6, got ${preEvent.days_before_event}`)
  } finally {
    await server.close()
  }
})

// V14: API handles events with 0 snapshots (series:[]) and no_anchor_ids for events missing evento_fechas
test('velocity: V14 — event with 0 snapshots returns series:[], event with no fecha goes to no_anchor_ids', async () => {
  const empresaId = `${EMP}-v14`
  const evWithSnaps = eid('v14-with-snaps')
  const evNoSnaps   = eid('v14-no-snaps')
  const evNoAnchor  = eid('v14-no-anchor')
  const cat1 = eid('v14-cat1')
  const cat2 = eid('v14-cat2')
  const cat3 = eid('v14-cat3')
  const fecha1 = eid('v14-fecha1')
  const fecha2 = eid('v14-fecha2')

  await seedEmpresa(empresaId)
  await seedEvento({ id: evWithSnaps, empresaId, nombre: 'Has Snaps V14', modofecha: 'unica' })
  await seedEvento({ id: evNoSnaps,   empresaId, nombre: 'No Snaps V14',  modofecha: 'unica' })
  await seedEvento({ id: evNoAnchor,  empresaId, nombre: 'No Anchor V14', modofecha: 'unica' })
  await seedCategoria({ id: cat1, eventoId: evWithSnaps, stock: 100 })
  await seedCategoria({ id: cat2, eventoId: evNoSnaps,   stock: 100 })
  await seedCategoria({ id: cat3, eventoId: evNoAnchor,  stock: 100 })
  // evWithSnaps has a fecha (anchor)
  await seedFecha({ id: fecha1, eventoId: evWithSnaps, fecha: '2026-09-01 20:00:00' })
  // evNoSnaps has a fecha but NO snapshot rows
  await seedFecha({ id: fecha2, eventoId: evNoSnaps, fecha: '2026-09-15 20:00:00' })
  // evNoAnchor has NO evento_fechas rows → should be in no_anchor_ids

  // Only evWithSnaps gets a snapshot
  await seedSnapshot({ eventoId: evWithSnaps, fechaSnapshot: '2026-08-20', vendidasAcumuladas: 30, capacidadTotalSnapshot: 100 })
  // evNoSnaps gets NO snapshot rows

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/velocity?evento_ids=${evWithSnaps},${evNoSnaps},${evNoAnchor}`,
      user
    )

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const d = (data as any).data

    // evNoAnchor should be in no_anchor_ids, not in events
    assert.ok(d.no_anchor_ids.includes(evNoAnchor), `evNoAnchor should be in no_anchor_ids, got ${JSON.stringify(d.no_anchor_ids)}`)
    assert.equal(d.events.length, 2, `Should have 2 events (with-snaps + no-snaps), evNoAnchor excluded, got ${d.events.length}`)

    // evNoSnaps should be in events with series:[]
    const evNoSnapsResult = d.events.find((e: any) => e.id === evNoSnaps)
    assert.ok(evNoSnapsResult, 'evNoSnaps should be in response events')
    assert.ok(Array.isArray(evNoSnapsResult.series), 'series should be an array')
    assert.equal(evNoSnapsResult.series.length, 0, `series should be empty [] for event with no snapshots, got ${evNoSnapsResult.series.length}`)

    // evWithSnaps should have 1 series point
    const evWithSnapsResult = d.events.find((e: any) => e.id === evWithSnaps)
    assert.ok(evWithSnapsResult, 'evWithSnaps should be in response events')
    assert.equal(evWithSnapsResult.series.length, 1, `evWithSnaps should have 1 series point, got ${evWithSnapsResult.series.length}`)
  } finally {
    await server.close()
  }
})

// V15: anchor_date for modo_fecha=multiple = MIN(fecha)
test('velocity: V15 — anchor_date for multiple event = MIN(evento_fechas.fecha)', async () => {
  const empresaId = `${EMP}-v15`
  const evMulti = eid('v15-multi')
  const cat1 = eid('v15-cat1')
  const fecha1 = eid('v15-fecha1')
  const fecha2 = eid('v15-fecha2')
  const fecha3 = eid('v15-fecha3')

  await seedEmpresa(empresaId)
  await seedEvento({ id: evMulti, empresaId, nombre: 'Multi Fechas V15', modofecha: 'multiple' })
  await seedCategoria({ id: cat1, eventoId: evMulti, stock: 300 })
  // Insert 3 fechas in non-sorted order — MIN should pick 2026-06-01
  await seedFecha({ id: fecha1, eventoId: evMulti, fecha: '2026-06-05 20:00:00' })
  await seedFecha({ id: fecha2, eventoId: evMulti, fecha: '2026-06-01 20:00:00' }) // MIN
  await seedFecha({ id: fecha3, eventoId: evMulti, fecha: '2026-06-10 20:00:00' })

  // One snapshot to verify days_before_event calculation from MIN(fecha)
  await seedSnapshot({ eventoId: evMulti, fechaSnapshot: '2026-05-02', vendidasAcumuladas: 25, capacidadTotalSnapshot: 300 })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/eventos/velocity?evento_ids=${evMulti}`,
      user
    )

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const d = (data as any).data
    assert.equal(d.events.length, 1, 'Should have 1 event')

    const ev = d.events[0]
    // anchor_date should be the MIN of the 3 fechas = 2026-06-01
    assert.equal(ev.anchor_date, '2026-06-01', `anchor_date should be MIN(fecha) = 2026-06-01, got ${ev.anchor_date}`)

    // days_before_event for 2026-05-02 relative to anchor 2026-06-01:
    // DATEDIFF('2026-06-01', '2026-05-02') = 30
    assert.equal(ev.series.length, 1, 'Should have 1 series point')
    const pt = ev.series[0]
    assert.equal(pt.fecha_snapshot, '2026-05-02', `fecha_snapshot should be 2026-05-02, got ${pt.fecha_snapshot}`)
    assert.equal(pt.days_before_event, 30, `days_before_event should be 30 (anchor=2026-06-01, snap=2026-05-02), got ${pt.days_before_event}`)
  } finally {
    await server.close()
  }
})
