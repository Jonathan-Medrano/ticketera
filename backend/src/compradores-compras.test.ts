/**
 * compradores-compras.test.ts
 *
 * Integration tests for GET /api/compradores/:id/compras (Compradores Fase C).
 * Validates unified timeline of entradas + consumibles_ventas.
 *
 * Test cases:
 *   T1: Comprador vacío → compras: [], totales all zeros
 *   T2: 2 entradas + 1 consumible → compras.length=3, tipos mixtos, sorted DESC
 *   T3: Consumible resuelto_parcial → precio_pagado usa delivered_amount
 *   T4: Items cancelados → incluidos en compras pero NO en gastado_total sums
 *   T5: Tenant scoping → comprador de otra empresa → 404
 *
 * Run: cd backend && node --import tsx --import ./src/test-env.ts --test
 *        --test-concurrency=1 src/compradores-compras.test.ts
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
const EMP = 'ccmp-emp'  // compradores-compras
const USR = 'ccmp-usr'
const EVT = 'ccmp-evt'
const CMP = 'ccmp-cmp'
const CAT = 'ccmp-cat'
const BAR = 'ccmp-bar'
const ENT = 'ccmp-ent'
const VNT = 'ccmp-vnt'

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
  await prisma.$executeRaw`DELETE FROM consumibles_ventas WHERE empresa_id ILIKE ${EMP + '%'}`
  await prisma.$executeRaw`DELETE FROM entradas WHERE comprador_id ILIKE ${CMP + '%'}`
  await prisma.$executeRaw`DELETE FROM compradores WHERE empresa_id ILIKE ${EMP + '%'}`
  await prisma.$executeRaw`DELETE FROM entrada_categorias WHERE evento_id ILIKE ${EVT + '%'}`
  await prisma.$executeRaw`DELETE FROM barra_stock WHERE barra_id ILIKE ${BAR + '%'}`
  await prisma.$executeRaw`DELETE FROM barras WHERE empresa_id ILIKE ${EMP + '%'}`
  await prisma.$executeRaw`DELETE FROM eventos WHERE empresa_id ILIKE ${EMP + '%'}`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE ${EMP + '%'}`
}

async function seedEmpresa(id: string) {
  await prisma.$executeRaw`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES (${id}, ${`Empresa ${id}`}, ${`slug-${id}`}, ${`${id}@test.com`}, 'hash', 'Admin', true)
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

async function seedBarra(params: { id: string; eventoId: string; empresaId: string }) {
  await prisma.$executeRaw`
    INSERT INTO barras (id, evento_id, empresa_id, nombre, activa)
    VALUES (${params.id}, ${params.eventoId}, ${params.empresaId}, ${`Barra ${params.id}`}, true)
    ON CONFLICT DO NOTHING
  `
}

async function seedComprador(params: { id: string; empresaId: string; email?: string }) {
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
  createdAt?: string
}) {
  const {
    id,
    compradorId,
    eventoId,
    categoriaId,
    estado = 'valida',
    precioPagado = 1000,
    createdAt,
  } = params

  const qrCode = `qr-${id}`.slice(0, 191)
  const claveCorta = `cc-${id.slice(-17)}`

  if (createdAt) {
    await prisma.$executeRaw`
      INSERT INTO entradas
        (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado, precio_pagado, created_at)
       VALUES (${id}, ${eventoId}, ${categoriaId}, ${compradorId}, ${qrCode}, ${claveCorta}, ${estado}, ${precioPagado}, ${createdAt}::timestamptz)
       ON CONFLICT DO NOTHING
    `
  } else {
    await prisma.$executeRaw`
      INSERT INTO entradas
        (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado, precio_pagado)
       VALUES (${id}, ${eventoId}, ${categoriaId}, ${compradorId}, ${qrCode}, ${claveCorta}, ${estado}, ${precioPagado})
       ON CONFLICT DO NOTHING
    `
  }
}

async function seedConsumibleVenta(params: {
  id: string
  barraId: string
  eventoId: string
  empresaId: string
  compradorId: string
  total?: number
  deliveredAmount?: number | null
  estado?: string
  createdAt?: string
}) {
  const {
    id,
    barraId,
    eventoId,
    empresaId,
    compradorId,
    total = 500,
    deliveredAmount = null,
    estado = 'canjeado',
    createdAt,
  } = params

  const qrCode = `qr-cv-${id}`.slice(0, 191)
  const claveCorta = `cv-${id.slice(-17)}`

  if (createdAt) {
    await prisma.$executeRaw`
      INSERT INTO consumibles_ventas
        (id, barra_id, evento_id, empresa_id, comprador_id, origen, qr_code, clave_corta, total, delivered_amount, estado, created_at)
       VALUES (${id}, ${barraId}, ${eventoId}, ${empresaId}, ${compradorId}, 'tenant_publico', ${qrCode}, ${claveCorta}, ${total}, ${deliveredAmount}, ${estado}, ${createdAt}::timestamptz)
       ON CONFLICT DO NOTHING
    `
  } else {
    await prisma.$executeRaw`
      INSERT INTO consumibles_ventas
        (id, barra_id, evento_id, empresa_id, comprador_id, origen, qr_code, clave_corta, total, delivered_amount, estado)
       VALUES (${id}, ${barraId}, ${eventoId}, ${empresaId}, ${compradorId}, 'tenant_publico', ${qrCode}, ${claveCorta}, ${total}, ${deliveredAmount}, ${estado})
       ON CONFLICT DO NOTHING
    `
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
  await cleanup()
})

after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

// ─── Tests ─────────────────────────────────────────────────────────────────

// T1: Comprador vacío → compras: [], totales all zeros
test('ccmp-t1: comprador sin compras → compras vacías y totales en cero', async () => {
  const empresaId = `${EMP}-t1`
  const compradorId = `${CMP}-t1-c1`

  await seedEmpresa(empresaId)
  await seedComprador({ id: compradorId, empresaId })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/compradores/${compradorId}/compras`,
      user
    )

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const { compras, totales } = (data as any).data

    assert.deepEqual(compras, [], 'compras debe ser array vacío')
    assert.equal(totales.entradas, 0, 'totales.entradas debe ser 0')
    assert.equal(totales.consumibles, 0, 'totales.consumibles debe ser 0')
    assert.equal(totales.gastado_entradas, 0, 'totales.gastado_entradas debe ser 0')
    assert.equal(totales.gastado_consumibles, 0, 'totales.gastado_consumibles debe ser 0')
    assert.equal(totales.gastado_total, 0, 'totales.gastado_total debe ser 0')
  } finally {
    await server.close()
  }
})

// T2: 2 entradas + 1 consumible → length=3, tipo mixto, sorted by created_at DESC
test('ccmp-t2: 2 entradas + 1 consumible → compras unificadas y ordenadas DESC', async () => {
  const empresaId = `${EMP}-t2`
  const compradorId = `${CMP}-t2-c1`
  const eventoId = `${EVT}-t2-ev`
  const catId = `${CAT}-t2-cat`
  const barraId = `${BAR}-t2-bar`

  await seedEmpresa(empresaId)
  await seedEvento({ id: eventoId, empresaId })
  await seedCategoria({ id: catId, eventoId })
  await seedBarra({ id: barraId, eventoId, empresaId })
  await seedComprador({ id: compradorId, empresaId })

  // Entrada más antigua
  await seedEntrada({
    id: `${ENT}-t2-e1`,
    compradorId,
    eventoId,
    categoriaId: catId,
    precioPagado: 1000,
    createdAt: '2025-01-01 10:00:00',
  })
  // Consumible en el medio
  await seedConsumibleVenta({
    id: `${VNT}-t2-v1`,
    barraId,
    eventoId,
    empresaId,
    compradorId,
    total: 500,
    estado: 'canjeado',
    createdAt: '2025-01-02 10:00:00',
  })
  // Entrada más reciente
  await seedEntrada({
    id: `${ENT}-t2-e2`,
    compradorId,
    eventoId,
    categoriaId: catId,
    precioPagado: 2000,
    createdAt: '2025-01-03 10:00:00',
  })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/compradores/${compradorId}/compras`,
      user
    )

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const { compras, totales } = (data as any).data

    assert.equal(compras.length, 3, `Expected 3 compras, got ${compras.length}`)

    // Verificar tipos mixtos
    const tipos = compras.map((c: any) => c.tipo)
    assert.ok(tipos.includes('entrada'), 'Debe haber al menos una entrada')
    assert.ok(tipos.includes('consumible'), 'Debe haber al menos un consumible')

    // Verificar orden DESC por created_at (primera debe ser más reciente)
    const first = compras[0]
    assert.equal(first.tipo, 'entrada', 'El primero (más reciente) debe ser la entrada del 2025-01-03')
    assert.equal(Number(first.precio_pagado), 2000, 'precio_pagado de la entrada más reciente debe ser 2000')

    const second = compras[1]
    assert.equal(second.tipo, 'consumible', 'El segundo debe ser el consumible del 2025-01-02')
    assert.equal(Number(second.precio_pagado), 500, 'precio_pagado del consumible debe ser 500')

    // Verificar que el consumible tiene barra_nombre y sin categoria_nombre
    assert.ok(second.barra_nombre !== null && second.barra_nombre !== undefined, 'consumible debe tener barra_nombre')
    assert.equal(second.categoria_nombre, null, 'consumible debe tener categoria_nombre=null')

    // Verificar totales
    assert.equal(totales.entradas, 2, 'totales.entradas debe ser 2')
    assert.equal(totales.consumibles, 1, 'totales.consumibles debe ser 1')
    assert.equal(Number(totales.gastado_entradas), 3000, 'gastado_entradas debe ser 3000')
    assert.equal(Number(totales.gastado_consumibles), 500, 'gastado_consumibles debe ser 500')
    assert.equal(Number(totales.gastado_total), 3500, 'gastado_total debe ser 3500')
  } finally {
    await server.close()
  }
})

// T3: Consumible con estado='resuelto_parcial' → precio_pagado = delivered_amount, no total
test('ccmp-t3: consumible resuelto_parcial usa delivered_amount como precio_pagado', async () => {
  const empresaId = `${EMP}-t3`
  const compradorId = `${CMP}-t3-c1`
  const eventoId = `${EVT}-t3-ev`
  const barraId = `${BAR}-t3-bar`

  await seedEmpresa(empresaId)
  await seedEvento({ id: eventoId, empresaId })
  await seedBarra({ id: barraId, eventoId, empresaId })
  await seedComprador({ id: compradorId, empresaId })

  await seedConsumibleVenta({
    id: `${VNT}-t3-v1`,
    barraId,
    eventoId,
    empresaId,
    compradorId,
    total: 1000,
    deliveredAmount: 600,
    estado: 'resuelto_parcial',
  })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/compradores/${compradorId}/compras`,
      user
    )

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const { compras, totales } = (data as any).data

    assert.equal(compras.length, 1, `Expected 1 compra, got ${compras.length}`)
    const item = compras[0]
    assert.equal(item.tipo, 'consumible')
    assert.equal(item.estado, 'resuelto_parcial')
    // precio_pagado debe ser delivered_amount (600), no total (1000)
    assert.equal(Number(item.precio_pagado), 600, `precio_pagado debe ser 600 (delivered_amount), got ${item.precio_pagado}`)

    // resuelto_parcial no es 'cancelado' → cuenta en totales
    assert.equal(Number(totales.gastado_consumibles), 600, 'gastado_consumibles debe ser 600 (delivered_amount)')
    assert.equal(Number(totales.gastado_total), 600)
  } finally {
    await server.close()
  }
})

// T4: Items cancelados → presentes en compras pero NO en gastado sums
test('ccmp-t4: items cancelados aparecen en historial pero no suman en gastado_total', async () => {
  const empresaId = `${EMP}-t4`
  const compradorId = `${CMP}-t4-c1`
  const eventoId = `${EVT}-t4-ev`
  const catId = `${CAT}-t4-cat`
  const barraId = `${BAR}-t4-bar`

  await seedEmpresa(empresaId)
  await seedEvento({ id: eventoId, empresaId })
  await seedCategoria({ id: catId, eventoId })
  await seedBarra({ id: barraId, eventoId, empresaId })
  await seedComprador({ id: compradorId, empresaId })

  // Entrada válida
  await seedEntrada({
    id: `${ENT}-t4-e1`,
    compradorId,
    eventoId,
    categoriaId: catId,
    precioPagado: 1500,
    estado: 'valida',
  })
  // Entrada cancelada
  await seedEntrada({
    id: `${ENT}-t4-e2`,
    compradorId,
    eventoId,
    categoriaId: catId,
    precioPagado: 800,
    estado: 'cancelada',
  })
  // Consumible canjeado (cuenta)
  await seedConsumibleVenta({
    id: `${VNT}-t4-v1`,
    barraId,
    eventoId,
    empresaId,
    compradorId,
    total: 400,
    estado: 'canjeado',
  })
  // Consumible cancelado (no cuenta en totales)
  await seedConsumibleVenta({
    id: `${VNT}-t4-v2`,
    barraId,
    eventoId,
    empresaId,
    compradorId,
    total: 300,
    estado: 'cancelado',
  })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const user = buildEmpresaUser(empresaId)
    const { status, data } = await requestJson(
      `${server.baseUrl}/api/compradores/${compradorId}/compras`,
      user
    )

    assert.equal(status, 200, `Expected 200, got ${status}: ${JSON.stringify(data)}`)
    const { compras, totales } = (data as any).data

    // Todos los items aparecen en el historial (incluidos cancelados)
    assert.equal(compras.length, 4, `Expected 4 compras, got ${compras.length}`)

    // Pero los cancelados NO suman en gastado
    // gastado_entradas: solo 'valida' (1500), no 'cancelada' (800)
    assert.equal(Number(totales.gastado_entradas), 1500, 'gastado_entradas no debe incluir canceladas')
    // gastado_consumibles: solo 'canjeado' (400), no 'cancelado' (300)
    assert.equal(Number(totales.gastado_consumibles), 400, 'gastado_consumibles no debe incluir cancelados')
    assert.equal(Number(totales.gastado_total), 1900, 'gastado_total debe ser 1500+400=1900')

    // Contar totales de items (todos, incluidos cancelados)
    assert.equal(totales.entradas, 2, 'totales.entradas debe contar todas las entradas')
    assert.equal(totales.consumibles, 2, 'totales.consumibles debe contar todos los consumibles')
  } finally {
    await server.close()
  }
})

// T5: Tenant scoping → comprador de otra empresa → 404
test('ccmp-t5: comprador de otra empresa devuelve 404', async () => {
  const empresaA = `${EMP}-t5-a`
  const empresaB = `${EMP}-t5-b`
  const compradorBId = `${CMP}-t5-c-b`

  await seedEmpresa(empresaA)
  await seedEmpresa(empresaB)
  await seedComprador({ id: compradorBId, empresaId: empresaB })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    // Usuario autenticado como empresa A intenta acceder al comprador de empresa B
    const userA = buildEmpresaUser(empresaA)
    const { status } = await requestJson(
      `${server.baseUrl}/api/compradores/${compradorBId}/compras`,
      userA
    )

    assert.equal(status, 404, `Expected 404 for cross-tenant access, got ${status}`)
  } finally {
    await server.close()
  }
})
