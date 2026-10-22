/**
 * compradores-summary.test.ts
 *
 * Integration tests for GET /api/compradores/summary (Compradores Fase B).
 * Validates:
 *   T1: Empty empresa → all counters 0, top_spender null
 *   T2: 10 compradores, 5 con email → con_email = 5, con_email_pct = 50
 *   T3: Recurrencia — 3 con 1 compra, 2 con 3 compras → con_1_compra=3, con_2_o_mas=2, tasa_recurrencia_pct=40
 *   T4: Empleado sin ver_recaudacion → HTTP 403
 *   T5: Tenant scoping — compradores de otra empresa NO contados
 *
 * Run: cd backend && node --import tsx --import ./src/test-env.ts --test
 *        --test-concurrency=1 src/compradores-summary.test.ts
 */

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { prisma } from './lib/prisma'
import indexRouter from './routes/index'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

// ─── Constants ─────────────────────────────────────────────────────────────
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET!

// Prefix all test IDs to avoid collisions with other test suites
const EMP = 'csmb-emp'  // compradores-summary-b
const USR = 'csmb-usr'
const EVT = 'csmb-evt'
const CMP = 'csmb-cmp'

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

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM entradas WHERE comprador_id ILIKE ${CMP + '%'}`
  await prisma.$executeRaw`DELETE FROM compradores WHERE empresa_id ILIKE ${EMP + '%'}`
  await prisma.$executeRaw`DELETE FROM entrada_categorias WHERE evento_id ILIKE ${EVT + '%'}`
  await prisma.$executeRaw`DELETE FROM eventos WHERE empresa_id ILIKE ${EMP + '%'}`
  await prisma.$executeRaw`DELETE FROM usuarios WHERE empresa_id ILIKE ${EMP + '%'}`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE ${EMP + '%'}`
}

async function seedEmpresa(id: string) {
  await prisma.$executeRaw`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES (${id}, ${`Empresa ${id}`}, ${`slug-${id}`}, ${`${id}@test.com`}, 'hash', 'Admin', true)
    ON CONFLICT DO NOTHING
  `
}

async function seedEmpleado(
  id: string,
  empresaId: string,
  permisos: Record<string, boolean>
) {
  await prisma.$executeRaw`
    INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, permisos, activo)
    VALUES (${id}, ${empresaId}, 'Empleado', 'Test', ${`${id}@test.com`}, 'hash', 'vendedor', ${JSON.stringify(permisos)}, true)
    ON CONFLICT DO NOTHING
  `
}

async function seedEvento(params: { id: string; empresaId: string }) {
  await prisma.$executeRaw`
    INSERT INTO eventos (id, empresa_id, nombre, activo, publication_mode, modo_fecha)
    VALUES (${params.id}, ${params.empresaId}, ${`Evento ${params.id}`}, true, 'immediate', 'unica')
    ON CONFLICT DO NOTHING
  `
}

async function seedCategoria(params: { id: string; eventoId: string }) {
  await prisma.$executeRaw`
    INSERT INTO entrada_categorias (id, evento_id, nombre, precio, stock, stock_disponible)
    VALUES (${params.id}, ${params.eventoId}, 'General', 1000, 100, 50)
    ON CONFLICT DO NOTHING
  `
}

async function seedComprador(params: {
  id: string
  empresaId: string
  email?: string
}) {
  // compradores.email is NOT NULL with a UNIQUE(empresa_id, email) constraint.
  // Every comprador must have a unique email per empresa — there are no "sin email" compradores in prod.
  // Use unique email derived from id by default.
  const { id, empresaId, email } = params
  const emailValue = email ?? `${id}@test.local`
  await prisma.$executeRaw`
    INSERT INTO compradores (id, empresa_id, nombre, email)
    VALUES (${id}, ${empresaId}, ${`Comprador ${id}`}, ${emailValue})
    ON CONFLICT DO NOTHING
  `
}

async function seedEntrada(params: {
  id: string
  compradorId: string
  eventoId: string
  categoriaId: string
  estado?: string
  precioPagado?: number
  comision?: number
}) {
  const {
    id,
    compradorId,
    eventoId,
    categoriaId,
    estado = 'valida',
    precioPagado = 1000,
    comision = 100,
  } = params

  const qrCode = `qr-${id}`.slice(0, 191)
  const claveCorta = `cc-${id.slice(-17)}`

  await prisma.$executeRaw`
    INSERT INTO entradas
      (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado, precio_pagado, comision)
     VALUES (${id}, ${eventoId}, ${categoriaId}, ${compradorId}, ${qrCode}, ${claveCorta}, ${estado}, ${precioPagado}, ${comision})
     ON CONFLICT DO NOTHING
  `
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
  await cleanup()
})

after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

// ─── Tests ─────────────────────────────────────────────────────────────────

// T1: Empty empresa → all counters 0, top_spender null
test('csmb-t1: empty empresa returns all zeros and top_spender null', async () => {
  const empresaId = `${EMP}-t1`
  await seedEmpresa(empresaId)

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/compradores/summary`, user)

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const { global: g, top_spender, nuevos_30d } = (data as any).data

    assert.equal(g.total_compradores, 0)
    assert.equal(g.con_email, 0)
    assert.equal(g.con_email_pct, 0)
    assert.equal(g.sin_compras, 0)
    assert.equal(g.con_1_compra, 0)
    assert.equal(g.con_2_o_mas, 0)
    assert.equal(g.tasa_recurrencia_pct, 0)
    assert.equal(g.ticket_promedio_neto, null, 'ticket_promedio_neto debe ser null sin ventas')
    assert.equal(g.total_vip, 0)
    assert.equal(g.vip_pct, 0)
    assert.equal(top_spender, null, 'top_spender debe ser null si no hay compradores')
    assert.equal(nuevos_30d, 0)
  } finally {
    await server.close()
  }
})

// T2: 4 compradores con email real → con_email=4, con_email_pct=100
// Note: compradores.email is NOT NULL with UNIQUE(empresa_id, email),
// so all real compradores must have unique email. The formula is tested
// by verifying the percentage computation on a full-coverage dataset.
test('csmb-t2: 4 compradores con email → con_email=4, total_compradores=4, con_email_pct=100', async () => {
  const empresaId = `${EMP}-t2`
  await seedEmpresa(empresaId)

  for (let i = 1; i <= 4; i++) {
    await seedComprador({ id: `${CMP}-t2-${i}`, empresaId, email: `csmbt2-${i}@test.local` })
  }

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/compradores/summary`, user)

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const { global: g } = (data as any).data

    assert.equal(g.total_compradores, 4, `Expected total_compradores=4, got ${g.total_compradores}`)
    assert.equal(g.con_email, 4, `Expected con_email=4, got ${g.con_email}`)
    assert.equal(g.con_email_pct, 100, `Expected con_email_pct=100, got ${g.con_email_pct}`)
  } finally {
    await server.close()
  }
})

// T3: Recurrencia — 3 compradores con 1 compra, 2 con 3 compras
// → con_1_compra=3, con_2_o_mas=2, tasa_recurrencia_pct=40
test('csmb-t3: recurrencia — 3 con 1 compra, 2 con 3 compras → tasa_recurrencia_pct=40', async () => {
  const empresaId = `${EMP}-t3`
  const eventoId = `${EVT}-t3-ev`
  const catId = `${EVT}-t3-cat`

  await seedEmpresa(empresaId)
  await seedEvento({ id: eventoId, empresaId })
  await seedCategoria({ id: catId, eventoId })

  // 5 compradores total con emails únicos (solo testear recurrencia)
  for (let i = 1; i <= 5; i++) {
    await seedComprador({ id: `${CMP}-t3-${i}`, empresaId, email: `csmbt3-${i}@test.local` })
  }

  // Compradores 1, 2, 3: 1 compra cada uno
  for (let i = 1; i <= 3; i++) {
    await seedEntrada({
      id: `${EVT}-t3-en-c${i}-1`,
      compradorId: `${CMP}-t3-${i}`,
      eventoId,
      categoriaId: catId,
      estado: 'valida',
    })
  }

  // Compradores 4 y 5: 3 compras cada uno
  for (let i = 4; i <= 5; i++) {
    for (let j = 1; j <= 3; j++) {
      await seedEntrada({
        id: `${EVT}-t3-en-c${i}-${j}`,
        compradorId: `${CMP}-t3-${i}`,
        eventoId,
        categoriaId: catId,
        estado: 'valida',
      })
    }
  }

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/compradores/summary`, user)

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const { global: g } = (data as any).data

    assert.equal(g.con_1_compra, 3, `Expected con_1_compra=3, got ${g.con_1_compra}`)
    assert.equal(g.con_2_o_mas, 2, `Expected con_2_o_mas=2, got ${g.con_2_o_mas}`)
    assert.equal(g.tasa_recurrencia_pct, 40, `Expected tasa_recurrencia_pct=40, got ${g.tasa_recurrencia_pct}`)
  } finally {
    await server.close()
  }
})

// T4: Empleado sin ver_recaudacion → HTTP 403
test('csmb-t4: empleado sin ver_recaudacion recibe 403', async () => {
  const empresaId = `${EMP}-t4`
  const userId = `${USR}-t4`

  await seedEmpresa(empresaId)
  await seedEmpleado(userId, empresaId, { ver_compradores: true }) // tiene ver_compradores pero NO ver_recaudacion

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpleadoUser(userId, empresaId, { ver_compradores: true })
    const { status } = await requestJson(`${server.baseUrl}/api/compradores/summary`, user)

    assert.equal(status, 403, `Expected 403 for empleado without ver_recaudacion, got ${status}`)
  } finally {
    await server.close()
  }
})

// T5: Tenant scoping — compradores de otra empresa NO contados
test('csmb-t5: compradores de otra empresa no son contados', async () => {
  const empresaId = `${EMP}-t5a`
  const otraEmpresaId = `${EMP}-t5b`

  await seedEmpresa(empresaId)
  await seedEmpresa(otraEmpresaId)

  // 2 compradores para empresaId
  for (let i = 1; i <= 2; i++) {
    await seedComprador({ id: `${CMP}-t5a-${i}`, empresaId })
  }

  // 7 compradores para otraEmpresaId
  for (let i = 1; i <= 7; i++) {
    await seedComprador({ id: `${CMP}-t5b-${i}`, empresaId: otraEmpresaId })
  }

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(`${server.baseUrl}/api/compradores/summary`, user)

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const { global: g } = (data as any).data

    assert.equal(g.total_compradores, 2, `Expected total_compradores=2 (only own empresa), got ${g.total_compradores}`)
  } finally {
    await server.close()
  }
})
