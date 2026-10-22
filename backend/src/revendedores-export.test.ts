import './test-env'

import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { prisma } from './lib/prisma'
import revendedoresRouter from './routes/revendedores'

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

async function seedUsuario(userId: string, empresaId: string, email: string, nombre: string, _dni: string, porcentajeComision: number) {
  await prisma.$executeRaw`
    INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, activo, permisos, porcentaje_comision)
    VALUES (${userId}, ${empresaId}, ${nombre}, 'Export', ${email}, ${TEST_PASSWORD_HASH}, 'revendedor', true, ${JSON.stringify({ exportar: true, gestionar_revendedores: true })}, ${porcentajeComision})
  `
}

async function seedEvento(eventoId: string, empresaId: string) {
  await prisma.$executeRaw`
    INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo)
    VALUES (${eventoId}, ${empresaId}, 'Festival Revendedor', NULL, NULL, 'unica', NULL, true)
  `
}

async function seedCategoria(categoriaId: string, eventoId: string) {
  await prisma.$executeRaw`
    INSERT INTO entrada_categorias (id, evento_id, tanda_id, nombre, descripcion, precio, stock, stock_disponible, activa)
    VALUES (${categoriaId}, ${eventoId}, NULL, 'General', NULL, 1500, 50, 48, true)
  `
}

async function seedEntrada(input: { entradaId: string; eventoId: string; categoriaId: string; revendedorId: string; createdAt: string; precioPagado: number; comisionRevendedor?: number }) {
  // comision_revendedor se CONGELA por entrada al confirmar el pago (snapshot del % de la época).
  // El default 0 reproduce entradas legacy emitidas antes del congelamiento.
  const comisionRevendedor = input.comisionRevendedor ?? 0
  await prisma.$executeRaw`
    INSERT INTO entradas (id, evento_id, categoria_id, revendedor_id, qr_code, clave_corta, estado, precio_pagado, comision, comision_revendedor, neto_empresa_amount, created_at)
    VALUES (${input.entradaId}, ${input.eventoId}, ${input.categoriaId}, ${input.revendedorId}, ${`qr-${input.entradaId}`}, ${`key-${input.entradaId}`}, 'valida', ${input.precioPagado}, 225, ${comisionRevendedor}, 1275, ${input.createdAt}::timestamp)
  `
}

function parseCsv(text: string) {
  return text.trim().split('\n').map((line) => line.replace(/\r$/, '').split(','))
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM entradas WHERE id ILIKE 'resellers-export-%' OR evento_id ILIKE 'resellers-export-%' OR revendedor_id ILIKE 'resellers-export-%'`
  await prisma.$executeRaw`DELETE FROM entrada_categorias WHERE id ILIKE 'resellers-export-%' OR evento_id ILIKE 'resellers-export-%'`
  await prisma.$executeRaw`DELETE FROM eventos WHERE id ILIKE 'resellers-export-%' OR empresa_id ILIKE 'resellers-export-%'`
  await prisma.$executeRaw`DELETE FROM usuarios WHERE id ILIKE 'resellers-export-%' OR empresa_id ILIKE 'resellers-export-%'`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'resellers-export-%' OR slug ILIKE 'resellers-export-%'`
}

beforeEach(async () => {
  await cleanup()
})

after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

test('revendedores export returns csv', async () => {
  const empresaId = 'resellers-export-emp-1'
  const adminId = 'resellers-export-admin-1'
  const revendedorId = 'resellers-export-user-1'
  await seedEmpresa(empresaId, 'resellers-export-1')
  await seedUsuario(adminId, empresaId, 'admin@example.com', 'Admin', '12345678', 10)
  await seedUsuario(revendedorId, empresaId, 'revendedor@example.com', 'Revendedor Uno', '30111222', 10)
  await seedEvento('resellers-export-evt-1', empresaId)
  await seedCategoria('resellers-export-cat-1', 'resellers-export-evt-1')
  await seedEntrada({ entradaId: 'resellers-export-ent-1', eventoId: 'resellers-export-evt-1', categoriaId: 'resellers-export-cat-1', revendedorId, createdAt: '2026-05-18 10:00:00', precioPagado: 1500 })

  const app = express()
  app.use('/api/revendedores', revendedoresRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestText(`${server.baseUrl}/api/revendedores/export`, buildEmpleadoUser(adminId, empresaId, 'admin@example.com', { exportar: true, gestionar_revendedores: true }))
    assert.equal(response.status, 200)
    const rows = parseCsv(response.text)
    assert.deepEqual(rows[0], ['revendedor', 'fecha_alta', 'ventas_totales', 'ganancia_total', 'ganancia_neta'])
  } finally {
    await server.close()
  }
})

test('revendedores export returns xlsx', async () => {
  const empresaId = 'resellers-export-emp-2'
  const adminId = 'resellers-export-admin-2'
  await seedEmpresa(empresaId, 'resellers-export-2')
  await seedUsuario(adminId, empresaId, 'admin2@example.com', 'Admin', '12345678', 10)

  const app = express()
  app.use('/api/revendedores', revendedoresRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestBinary(`${server.baseUrl}/api/revendedores/export?format=xlsx`, buildEmpleadoUser(adminId, empresaId, 'admin2@example.com', { exportar: true, gestionar_revendedores: true }))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    assert.match(response.headers.get('content-disposition') ?? '', /^attachment; filename="Revendedores_Resumen_\d{4}-\d{2}-\d{2}\.xlsx"$/)
  } finally {
    await server.close()
  }
})

test('payouts export uses frozen comision_revendedor, not the current %', async () => {
  const empresaId = 'resellers-export-emp-3'
  const adminId = 'resellers-export-admin-3'
  const revendedorId = 'resellers-export-user-3'
  await seedEmpresa(empresaId, 'resellers-export-3')
  await seedUsuario(adminId, empresaId, 'admin3@example.com', 'Admin', '12345678', 10)
  await seedUsuario(revendedorId, empresaId, 'revendedor3@example.com', 'Revendedor Tres', '30333444', 10)
  await seedEvento('resellers-export-evt-3', empresaId)
  await seedCategoria('resellers-export-cat-3', 'resellers-export-evt-3')
  // Venta de 1500 con el 10% CONGELADO al momento de la venta = 150
  await seedEntrada({ entradaId: 'resellers-export-ent-3', eventoId: 'resellers-export-evt-3', categoriaId: 'resellers-export-cat-3', revendedorId, createdAt: '2026-05-18 10:00:00', precioPagado: 1500, comisionRevendedor: 150 })

  // La empresa sube el % del revendedor al 50% DESPUÉS de la venta.
  // El recálculo en vivo daría 750; el valor congelado debe seguir siendo 150.
  await prisma.$executeRaw`UPDATE usuarios SET porcentaje_comision = 50 WHERE id = ${revendedorId}`

  const app = express()
  app.use('/api/revendedores', revendedoresRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestText(
      `${server.baseUrl}/api/revendedores/payouts/export?desde=2026-05-01&hasta=2026-05-31`,
      buildEmpleadoUser(adminId, empresaId, 'admin3@example.com', { exportar: true, gestionar_revendedores: true }),
    )
    assert.equal(response.status, 200)
    const rows = parseCsv(response.text)
    const header = rows[0].map((cell) => cell.replace(/^﻿/, ''))
    const comisionIdx = header.indexOf('comision_a_pagar')
    assert.ok(comisionIdx >= 0, 'columna comision_a_pagar presente')
    const dataRow = rows.find((row) => row[0] === revendedorId)
    assert.ok(dataRow, 'fila del revendedor presente')
    // Congelado: 150.00 — NO 750.00 (lo que daría recalcular con el % nuevo)
    assert.equal(dataRow![comisionIdx], '150.00')
  } finally {
    await server.close()
  }
})
