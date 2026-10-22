import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import ExcelJS from 'exceljs'
import express from 'express'
import type { CellValue, Row } from 'exceljs'
import pool from './db'
import dashboardRouter from './routes/dashboard'
import entradasRouter from './routes/entradas'
import eventosRouter from './routes/eventos'
import ventasRouter from './routes/ventas'

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

async function requestJson(url: string, user: Record<string, unknown> | null) {
  const response = await originalFetch(url, {
    method: 'GET',
    headers: buildHeaders(user),
  })

  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function requestWorkbook(url: string, user: Record<string, unknown> | null) {
  const response = await originalFetch(url, {
    method: 'GET',
    headers: buildHeaders(user),
  })

  return {
    status: response.status,
    body: Buffer.from(await response.arrayBuffer()),
  }
}

function readRowValues(row: Row): CellValue[] {
  return Array.isArray(row.values) ? row.values.slice(1) : []
}

async function readWorkbookHeader(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
  const worksheet = workbook.getWorksheet('Entradas')
  assert.ok(worksheet)
  return readRowValues(worksheet.getRow(1))
}

async function readWorkbookFirstDataRow(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
  const worksheet = workbook.getWorksheet('Entradas')
  assert.ok(worksheet)
  return readRowValues(worksheet.getRow(2)).map((value) => String(value ?? ''))
}

async function seedEmpresa(empresaId: string, slug: string) {
  await pool.query(
    `INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
     VALUES (?, ?, ?, ?, ?, ?, true)`,
    [empresaId, `Empresa ${slug}`, slug, `${slug}@example.com`, TEST_PASSWORD_HASH, `Admin ${slug}`]
  )
}

async function seedEmpleado(userId: string, empresaId: string, email: string, permisos: Record<string, boolean>) {
  await pool.query(
    `INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, activo, permisos)
     VALUES (?, ?, ?, ?, ?, ?, 'operador', true, ?)`,
    [userId, empresaId, 'Empleado', 'Shape', email, TEST_PASSWORD_HASH, JSON.stringify(permisos)]
  )
}

async function seedComprador(compradorId: string, empresaId: string, email: string) {
  await pool.query(
    `INSERT INTO compradores (id, empresa_id, nombre, email, dni, password, created_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())`,
    [compradorId, empresaId, 'Comprador Shape', email, '12345678', TEST_PASSWORD_HASH]
  )
}

async function seedEventoConEntrada({ empresaId, eventoId, categoriaId, compradorId }: { empresaId: string; eventoId: string; categoriaId: string; compradorId: string }) {
  await pool.query(
    `INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo)
     VALUES (?, ?, ?, NULL, NULL, 'unica', NULL, true)`,
    [eventoId, empresaId, `Evento ${eventoId}`]
  )

  await pool.query(
    `INSERT INTO entrada_categorias (id, evento_id, tanda_id, nombre, descripcion, precio, stock, stock_disponible, activa)
     VALUES (?, ?, NULL, ?, NULL, 1500, 50, 48, true)`,
    [categoriaId, eventoId, `Categoria ${categoriaId}`]
  )

  await pool.query(
    `INSERT INTO entradas (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado, precio_pagado, comision, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'valida', 1500, 225, NOW())`,
    // precio_pagado (1500) y comision (225) van literales en el VALUES de arriba:
    // pasarlos tambien como parametros daba 8 binds para 6 placeholders.
    [`ent-${eventoId}`, eventoId, categoriaId, compradorId, `qr-${eventoId}`, `KEY-${eventoId}`]
  )
}

async function cleanup() {
  await pool.query(`DELETE FROM consumibles_venta_items WHERE id LIKE 'phase-shape-item-%' OR venta_id LIKE 'phase-shape-sale-%'`)
  await pool.query(`DELETE FROM consumibles_ventas WHERE id LIKE 'phase-shape-sale-%' OR empresa_id LIKE 'phase-shape-emp-%' OR comprador_id LIKE 'phase-shape-cmp-%' OR checkout_session_id LIKE 'phase-shape-checkout-%'`).catch(() => {})
  await pool.query(`DELETE FROM barras WHERE id LIKE 'phase-shape-bar-%' OR empresa_id LIKE 'phase-shape-emp-%'`)
  await pool.query(`DELETE FROM consumibles WHERE id LIKE 'phase-shape-con-%' OR empresa_id LIKE 'phase-shape-emp-%'`)
  await pool.query(`DELETE FROM entradas WHERE id LIKE 'ent-phase-shape-%' OR evento_id LIKE 'phase-shape-evt-%' OR comprador_id LIKE 'phase-shape-cmp-%'`)
  await pool.query(`DELETE FROM entrada_categorias WHERE id LIKE 'phase-shape-cat-%' OR evento_id LIKE 'phase-shape-evt-%'`)
  await pool.query(`DELETE FROM evento_fechas WHERE evento_id LIKE 'phase-shape-evt-%'`)
  await pool.query(`DELETE FROM evento_tandas WHERE evento_id LIKE 'phase-shape-evt-%'`)
  await pool.query(`DELETE FROM eventos WHERE id LIKE 'phase-shape-evt-%' OR empresa_id LIKE 'phase-shape-emp-%'`)
  await pool.query(`DELETE FROM compradores WHERE id LIKE 'phase-shape-cmp-%' OR empresa_id LIKE 'phase-shape-emp-%'`)
  await pool.query(`DELETE FROM usuarios WHERE id LIKE 'phase-shape-usr-%' OR empresa_id LIKE 'phase-shape-emp-%'`)
  await pool.query(`DELETE FROM empresas WHERE id LIKE 'phase-shape-emp-%' OR slug LIKE 'phase-shape-%'`)
}

async function seedConsumibleVenta({
  empresaId,
  eventoId,
  barraId,
  consumibleId,
  compradorId,
  ventaId,
  origen,
  total,
  checkoutSessionId,
}: {
  empresaId: string
  eventoId: string
  barraId: string
  consumibleId: string
  compradorId: string
  ventaId: string
  origen: 'manual' | 'tenant_publico'
  total: number
  checkoutSessionId: string
}) {
  await pool.query(`INSERT INTO barras (id, evento_id, empresa_id, nombre, activa) VALUES (?, ?, ?, ?, true)`, [barraId, eventoId, empresaId, `Barra ${barraId}`])
  await pool.query(`INSERT INTO consumibles (id, empresa_id, nombre, descripcion, precio, activo) VALUES (?, ?, ?, NULL, ?, true)`, [consumibleId, empresaId, `Consumible ${consumibleId}`, total])
  await pool.query(
    `INSERT INTO consumibles_ventas (id, barra_id, evento_id, empresa_id, comprador_id, checkout_session_id, origen, qr_code, clave_corta, total, estado, neto_empresa_amount, delivered_amount, refunded_amount, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'resuelto_parcial', ?, ?, ?, NOW())`,
    [ventaId, barraId, eventoId, empresaId, compradorId, checkoutSessionId, origen, `qr-${ventaId}`, `KEY-${ventaId}`, total, total / 2, total / 2, total / 2]
  )
  await pool.query(
    `INSERT INTO consumibles_venta_items (id, venta_id, consumible_id, nombre_snapshot, precio_unitario, cantidad, subtotal)
     VALUES (?, ?, ?, 'Consumible Shape', ?, 1, ?)`,
    [`phase-shape-item-${ventaId}`, ventaId, consumibleId, total, total]
  )
}

beforeEach(async () => {
  await cleanup()
})

after(async () => {
  await cleanup()
  await pool.end()
})

test('dashboard response hides buyer PII and money fields for basic dashboard role', async () => {
  const empresaId = 'phase-shape-emp-1'
  const eventoId = 'phase-shape-evt-1'
  const categoriaId = 'phase-shape-cat-1'
  const compradorId = 'phase-shape-cmp-1'
  const empleadoId = 'phase-shape-usr-1'
  const empleadoEmail = 'phase-shape-usr-1@example.com'
  await seedEmpresa(empresaId, 'phase-shape-1')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { ver_dashboard: true })
  await seedComprador(compradorId, empresaId, 'phase-shape-cmp-1@example.com')
  await seedEventoConEntrada({ empresaId, eventoId, categoriaId, compradorId })

  const app = express()
  app.use('/api/dashboard', dashboardRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      `${server.baseUrl}/api/dashboard/resumen`,
      buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { ver_dashboard: true })
    )

    assert.equal(response.status, 200)
    assert.equal(response.data.data.metricas.ingresos, null)
    assert.equal(response.data.data.ultimas_ventas[0].comprador_email, null)
    assert.equal(response.data.data.ultimas_ventas[0].comprador_dni, null)
    assert.equal(response.data.data.ultimas_ventas[0].precio_pagado, null)
  } finally {
    await server.close()
  }
})

test('entradas response hides prices and buyer PII for non-monetary role', async () => {
  const empresaId = 'phase-shape-emp-2'
  const eventoId = 'phase-shape-evt-2'
  const categoriaId = 'phase-shape-cat-2'
  const compradorId = 'phase-shape-cmp-2'
  const empleadoId = 'phase-shape-usr-2'
  const empleadoEmail = 'phase-shape-usr-2@example.com'
  await seedEmpresa(empresaId, 'phase-shape-2')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_entradas: true })
  await seedComprador(compradorId, empresaId, 'phase-shape-cmp-2@example.com')
  await seedEventoConEntrada({ empresaId, eventoId, categoriaId, compradorId })

  const app = express()
  app.use('/api/entradas', entradasRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      `${server.baseUrl}/api/entradas`,
      buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_entradas: true })
    )

    assert.equal(response.status, 200)
    assert.equal(response.data.data.entradas[0].precio_pagado, null)
    assert.equal(response.data.data.entradas[0].comision, null)
    assert.equal(response.data.data.entradas[0].comprador_email, null)
    assert.equal(response.data.data.entradas[0].comprador_dni, null)
    assert.equal(response.data.data.stats.total_recaudado, null)
  } finally {
    await server.close()
  }
})

test('event detail response hides prices, revenue and buyer email for event-only role', async () => {
  const empresaId = 'phase-shape-emp-3'
  const eventoId = 'phase-shape-evt-3'
  const categoriaId = 'phase-shape-cat-3'
  const compradorId = 'phase-shape-cmp-3'
  const empleadoId = 'phase-shape-usr-3'
  const empleadoEmail = 'phase-shape-usr-3@example.com'
  await seedEmpresa(empresaId, 'phase-shape-3')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { ver_eventos: true })
  await seedComprador(compradorId, empresaId, 'phase-shape-cmp-3@example.com')
  await seedEventoConEntrada({ empresaId, eventoId, categoriaId, compradorId })

  const app = express()
  app.use('/api/eventos', eventosRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      `${server.baseUrl}/api/eventos/${eventoId}`,
      buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { ver_eventos: true })
    )

    assert.equal(response.status, 200)
    assert.equal(response.data.categorias[0].precio, null)
    assert.equal(response.data.ventas[0].precio_pagado, null)
    assert.equal(response.data.ventas[0].comprador_email, null)
    assert.equal(response.data.metricas.total_recaudado, null)
  } finally {
    await server.close()
  }
})

test('entradas export omits buyer sensitive and money columns for non-monetary roles', async () => {
  const empresaId = 'phase-shape-emp-4'
  const eventoId = 'phase-shape-evt-4'
  const categoriaId = 'phase-shape-cat-4'
  const compradorId = 'phase-shape-cmp-4'
  const empleadoId = 'phase-shape-usr-4'
  const empleadoEmail = 'phase-shape-usr-4@example.com'
  await seedEmpresa(empresaId, 'phase-shape-4')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_entradas: true })
  await seedComprador(compradorId, empresaId, 'phase-shape-cmp-4@example.com')
  await seedEventoConEntrada({ empresaId, eventoId, categoriaId, compradorId })

  const app = express()
  app.use('/api/entradas', entradasRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestWorkbook(
      `${server.baseUrl}/api/entradas/export`,
      buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_entradas: true })
    )

    assert.equal(response.status, 200)
    assert.deepEqual(await readWorkbookHeader(response.body), ['Fecha compra', 'Estado', 'Reembolsada', 'Evento'])
  } finally {
    await server.close()
  }
})

test('entradas export grants the full allowed schema to ver_recaudacion roles', async () => {
  const empresaId = 'phase-shape-emp-5'
  const eventoId = 'phase-shape-evt-5'
  const categoriaId = 'phase-shape-cat-5'
  const compradorId = 'phase-shape-cmp-5'
  const empleadoId = 'phase-shape-usr-5'
  const empleadoEmail = 'phase-shape-usr-5@example.com'
  await seedEmpresa(empresaId, 'phase-shape-5')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_entradas: true, ver_recaudacion: true })
  await seedComprador(compradorId, empresaId, 'phase-shape-cmp-5@example.com')
  await seedEventoConEntrada({ empresaId, eventoId, categoriaId, compradorId })

  const app = express()
  app.use('/api/entradas', entradasRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestWorkbook(
      `${server.baseUrl}/api/entradas/export`,
      buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_entradas: true, ver_recaudacion: true })
    )

    assert.equal(response.status, 200)
    assert.deepEqual(await readWorkbookHeader(response.body), ['Fecha compra', 'Estado', 'Reembolsada', 'Evento', 'Email comprador', 'DNI comprador', 'Precio pagado', 'Comisión', 'Neto empresa', 'Total reembolsado', 'Total sin reembolso', 'Total final', 'Neto total'])
    const firstRow = await readWorkbookFirstDataRow(response.body)
    assert.match(firstRow.join(','), /phase-shape-cmp-5@example.com/)
  } finally {
    await server.close()
  }
})

test('consumibles response hides row-level money fields for non-monetary roles', async () => {
  const empresaId = 'phase-shape-emp-6'
  const eventoId = 'phase-shape-evt-6'
  const compradorId = 'phase-shape-cmp-6'
  const empleadoId = 'phase-shape-usr-6'
  const empleadoEmail = 'phase-shape-usr-6@example.com'
  await seedEmpresa(empresaId, 'phase-shape-6')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_consumibles: true })
  await seedComprador(compradorId, empresaId, 'phase-shape-cmp-6@example.com')
  await seedEventoConEntrada({ empresaId, eventoId, categoriaId: 'phase-shape-cat-6', compradorId })
  await seedConsumibleVenta({ empresaId, eventoId, barraId: 'phase-shape-bar-6', consumibleId: 'phase-shape-con-6', compradorId, ventaId: 'phase-shape-sale-6', origen: 'tenant_publico', total: 2400, checkoutSessionId: 'phase-shape-checkout-6' })

  const app = express()
  app.use('/api/consumibles/ventas', ventasRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      `${server.baseUrl}/api/consumibles/ventas`,
      buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_consumibles: true })
    )

    assert.equal(response.status, 200)
    assert.equal(response.data.data.ventas[0].total, null)
    assert.equal(response.data.data.ventas[0].neto_empresa_amount, null)
    assert.equal(response.data.data.ventas[0].delivered_amount, null)
    assert.equal(response.data.data.ventas[0].refunded_amount, null)
  } finally {
    await server.close()
  }
})

test('consumibles export omits money columns for non-monetary roles and grants full schema to ver_recaudacion', async () => {
  const empresaId = 'phase-shape-emp-7'
  const eventoId = 'phase-shape-evt-7'
  const compradorId = 'phase-shape-cmp-7'
  const empleadoId = 'phase-shape-usr-7'
  const empleadoEmail = 'phase-shape-usr-7@example.com'
  await seedEmpresa(empresaId, 'phase-shape-7')
  await seedComprador(compradorId, empresaId, 'phase-shape-cmp-7@example.com')
  await seedEventoConEntrada({ empresaId, eventoId, categoriaId: 'phase-shape-cat-7', compradorId })
  await seedConsumibleVenta({ empresaId, eventoId, barraId: 'phase-shape-bar-7', consumibleId: 'phase-shape-con-7', compradorId, ventaId: 'phase-shape-sale-7', origen: 'manual', total: 3600, checkoutSessionId: 'phase-shape-checkout-7' })

  const app = express()
  app.use('/api/consumibles/ventas', ventasRouter)
  const server = await createTestServer(app)

  try {
    await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_consumibles: true })
    const limitedResponse = await originalFetch(`${server.baseUrl}/api/consumibles/ventas/export`, {
      method: 'GET',
      headers: buildHeaders(buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_consumibles: true })),
    })
    const [limitedHeader] = (await limitedResponse.text()).trim().split('\n')
    assert.equal(limitedHeader?.replace(/\r$/, ''), 'fecha_compra,estado,reembolsada,origen,evento,barra')

    await pool.query(`DELETE FROM usuarios WHERE id = ?`, [empleadoId])
    await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_consumibles: true, ver_recaudacion: true })
    const fullResponse = await originalFetch(`${server.baseUrl}/api/consumibles/ventas/export`, {
      method: 'GET',
      headers: buildHeaders(buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_consumibles: true, ver_recaudacion: true })),
    })
    const [fullHeader, firstRow] = (await fullResponse.text()).trim().split('\n')
    assert.equal(fullHeader?.replace(/\r$/, ''), 'fecha_compra,estado,reembolsada,origen,evento,barra,total,neto_empresa_amount,delivered_amount,reembolso_parcial,total_reembolsado,neto_total')
    assert.match(firstRow ?? '', /manual/)
    assert.match(firstRow ?? '', /3600/)
  } finally {
    await server.close()
  }
})
