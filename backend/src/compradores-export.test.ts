import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { prisma } from './lib/prisma'
import compradoresRouter from './routes/compradores'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch

function buildHeaders(user: Record<string, unknown> | null = null) {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
    'x-user': JSON.stringify(user),
  }
}

function buildEmpleadoUser(userId: string, empresaId: string, email: string, permisos: Record<string, boolean>) {
  return {
    id: userId,
    email,
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
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    },
  }
}

async function requestText(url: string, user: Record<string, unknown> | null) {
  const response = await originalFetch(url, { method: 'GET', headers: buildHeaders(user) })
  return { status: response.status, text: await response.text(), headers: response.headers }
}

async function requestBinary(url: string, user: Record<string, unknown> | null) {
  const response = await originalFetch(url, { method: 'GET', headers: buildHeaders(user) })
  return { status: response.status, body: Buffer.from(await response.arrayBuffer()), headers: response.headers }
}

async function seedEmpresa(empresaId: string, slug: string) {
  await prisma.$executeRaw`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES (${empresaId}, ${`Empresa ${slug}`}, ${slug}, ${`${slug}@example.com`}, ${TEST_PASSWORD_HASH}, ${`Admin ${slug}`}, true)
  `
}

async function seedEmpleado(userId: string, empresaId: string, email: string, permisos: Record<string, boolean>) {
  await prisma.$executeRaw`
    INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, activo, permisos)
    VALUES (${userId}, ${empresaId}, 'Empleado', 'Export', ${email}, ${TEST_PASSWORD_HASH}, 'operador', true, ${JSON.stringify(permisos)})
  `
}

async function seedComprador(compradorId: string, empresaId: string, nombre: string, email: string, createdAt: string) {
  await prisma.$executeRaw`
    INSERT INTO compradores (id, empresa_id, nombre, email, dni, password, created_at)
    VALUES (${compradorId}, ${empresaId}, ${nombre}, ${email}, '12345678', ${TEST_PASSWORD_HASH}, ${createdAt}::timestamptz)
  `
}

async function seedEvento(eventoId: string, empresaId: string, nombre: string) {
  await prisma.$executeRaw`
    INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo)
    VALUES (${eventoId}, ${empresaId}, ${nombre}, NULL, NULL, 'unica', NULL, true)
  `
}

async function seedCategoria(categoriaId: string, eventoId: string, nombre: string) {
  await prisma.$executeRaw`
    INSERT INTO entrada_categorias (id, evento_id, tanda_id, nombre, descripcion, precio, stock, stock_disponible, activa)
    VALUES (${categoriaId}, ${eventoId}, NULL, ${nombre}, NULL, 1500, 50, 48, true)
  `
}

async function seedEntrada(input: { entradaId: string; eventoId: string; categoriaId: string; compradorId: string; clave: string; createdAt: string; precioPagado?: number }) {
  await prisma.$executeRaw`
    INSERT INTO entradas (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado, precio_pagado, comision, neto_empresa_amount, created_at)
    VALUES (${input.entradaId}, ${input.eventoId}, ${input.categoriaId}, ${input.compradorId}, ${`qr-${input.entradaId}`}, ${input.clave}, 'valida', ${input.precioPagado ?? 1500}, 225, 1275, ${input.createdAt}::timestamptz)
  `
}

function parseCsv(text: string) {
  return text.trim().split('\n').map((line) => line.replace(/\r$/, '').split(','))
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM entradas WHERE id ILIKE 'buyers-export-%' OR evento_id ILIKE 'buyers-export-%' OR comprador_id ILIKE 'buyers-export-%'`
  await prisma.$executeRaw`DELETE FROM entrada_categorias WHERE id ILIKE 'buyers-export-%' OR evento_id ILIKE 'buyers-export-%'`
  await prisma.$executeRaw`DELETE FROM eventos WHERE id ILIKE 'buyers-export-%' OR empresa_id ILIKE 'buyers-export-%'`
  await prisma.$executeRaw`DELETE FROM compradores WHERE id ILIKE 'buyers-export-%' OR empresa_id ILIKE 'buyers-export-%'`
  await prisma.$executeRaw`DELETE FROM usuarios WHERE id ILIKE 'buyers-export-%' OR empresa_id ILIKE 'buyers-export-%'`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'buyers-export-%' OR slug ILIKE 'buyers-export-%'`
}

beforeEach(async () => {
  await cleanup()
})

after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

test('compradores export returns csv with event and registration filters', async () => {
  const empresaId = 'buyers-export-emp-1'
  const empleadoId = 'buyers-export-usr-1'
  const empleadoEmail = 'buyers-export-usr-1@example.com'
  await seedEmpresa(empresaId, 'buyers-export-1')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_compradores: true, ver_montos_compradores: true })
  await seedComprador('buyers-export-cmp-1', empresaId, 'Buyer Uno', 'buyer1@example.com', '2026-05-18 10:00:00')
  await seedComprador('buyers-export-cmp-2', empresaId, 'Buyer Dos', 'buyer2@example.com', '2026-05-20 10:00:00')
  await seedEvento('buyers-export-evt-1', empresaId, 'Festival Buyer')
  await seedCategoria('buyers-export-cat-1', 'buyers-export-evt-1', 'General')
  await seedEntrada({ entradaId: 'buyers-export-ent-1', eventoId: 'buyers-export-evt-1', categoriaId: 'buyers-export-cat-1', compradorId: 'buyers-export-cmp-2', clave: 'BUY-001', createdAt: '2026-05-20 10:00:00' })

  const app = express()
  app.use('/api/compradores', compradoresRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestText(`${server.baseUrl}/api/compradores/export?evento=buyers-export-evt-1&desde=2026-05-19&hasta=2026-05-21`, buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_compradores: true, ver_montos_compradores: true }))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="Compradores_Resumen_2026-05-20.csv"')
    const rows = parseCsv(response.text)
    assert.deepEqual(rows[0], ['fecha_registro', 'comprador', 'email', 'dni', 'total_gastado_entradas', 'total_gastado_consumibles', 'neto_empresa_total'])
    assert.equal(rows.length, 2)
    assert.equal(rows[1]?.[1], 'Buyer Dos')
    assert.equal(rows[1]?.[4], '1500')
    assert.equal(rows[1]?.[5], '0')
    assert.equal(rows[1]?.[6], '1275')
  } finally {
    await server.close()
  }
})

test('compradores export returns xlsx', async () => {
  const empresaId = 'buyers-export-emp-2'
  const empleadoId = 'buyers-export-usr-2'
  const empleadoEmail = 'buyers-export-usr-2@example.com'
  await seedEmpresa(empresaId, 'buyers-export-2')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_compradores: true, ver_montos_compradores: true })
  await seedComprador('buyers-export-cmp-3', empresaId, 'Buyer XLSX', 'buyerxlsx@example.com', '2026-05-20 10:00:00')

  const app = express()
  app.use('/api/compradores', compradoresRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestBinary(`${server.baseUrl}/api/compradores/export?format=xlsx`, buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_compradores: true, ver_montos_compradores: true }))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    assert.match(response.headers.get('content-disposition') ?? '', /^attachment; filename="Compradores_Resumen_\d{4}-\d{2}-\d{2}\.xlsx"$/)
    assert.equal(response.body.subarray(0, 2).toString('utf8'), 'PK')
  } finally {
    await server.close()
  }
})
