import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { prismaDirectUrl as prisma } from './lib/prisma'
import ventasRouter from './routes/ventas'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch
const originalExportLimit = process.env.CONSUMIBLES_EXPORT_MAX_ROWS

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
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

async function requestText(url: string, user: Record<string, unknown> | null) {
  const response = await originalFetch(url, {
    method: 'GET',
    headers: buildHeaders(user),
  })

  return {
    status: response.status,
    text: await response.text(),
    headers: response.headers,
  }
}

async function requestBinary(url: string, user: Record<string, unknown> | null) {
  const response = await originalFetch(url, {
    method: 'GET',
    headers: buildHeaders(user),
  })

  return {
    status: response.status,
    body: Buffer.from(await response.arrayBuffer()),
    headers: response.headers,
  }
}

async function requestJson<T>(url: string, user: Record<string, unknown> | null) {
  const response = await originalFetch(url, {
    method: 'GET',
    headers: buildHeaders(user),
  })

  return {
    status: response.status,
    data: await response.json() as T,
    headers: response.headers,
  }
}

async function seedEmpresa(empresaId: string, slug: string) {
  await prisma.$executeRaw`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES (${empresaId}, ${`Empresa ${slug}`}, ${slug}, ${`${slug}@example.com`}, ${TEST_PASSWORD_HASH}, ${`Admin ${slug}`}, true)
    ON CONFLICT DO NOTHING`
}

async function seedEmpleado(userId: string, empresaId: string, email: string, permisos: Record<string, boolean>) {
  await prisma.$executeRaw`
    INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, activo, permisos)
    VALUES (${userId}, ${empresaId}, 'Empleado', 'Export', ${email}, ${TEST_PASSWORD_HASH}, 'operador', true, ${JSON.stringify(permisos)})
    ON CONFLICT DO NOTHING`
}

async function seedComprador(compradorId: string, empresaId: string, nombre: string, email: string) {
  await prisma.$executeRaw`
    INSERT INTO compradores (id, empresa_id, nombre, email, dni, password, created_at)
    VALUES (${compradorId}, ${empresaId}, ${nombre}, ${email}, '12345678', ${TEST_PASSWORD_HASH}, NOW())
    ON CONFLICT DO NOTHING`
}

async function seedEvento(eventoId: string, empresaId: string, nombre: string) {
  await prisma.$executeRaw`
    INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo)
    VALUES (${eventoId}, ${empresaId}, ${nombre}, NULL, NULL, 'unica', NULL, true)
    ON CONFLICT DO NOTHING`
}

async function seedBarra(barraId: string, eventoId: string, empresaId: string, nombre: string) {
  await prisma.$executeRaw`
    INSERT INTO barras (id, evento_id, empresa_id, nombre, activa)
    VALUES (${barraId}, ${eventoId}, ${empresaId}, ${nombre}, true)
    ON CONFLICT DO NOTHING`
}

async function seedConsumible(consumibleId: string, empresaId: string, nombre: string, precio: number) {
  await prisma.$executeRaw`
    INSERT INTO consumibles (id, empresa_id, nombre, descripcion, precio, activo)
    VALUES (${consumibleId}, ${empresaId}, ${nombre}, NULL, ${precio}, true)
    ON CONFLICT DO NOTHING`
}

async function seedVenta(input: {
  ventaId: string
  empresaId: string
  eventoId: string
  barraId: string
  consumibleId: string
  compradorId?: string
  checkoutSessionId?: string | null
  origen: 'manual' | 'tenant_publico'
  clave: string
  estado: 'pendiente' | 'canjeado' | 'cancelado' | 'resuelto_parcial'
  total: number
  createdAt: string
  deliveredAmount?: number | null
  refundedAmount?: number | null
  netoEmpresaAmount?: number | null
  itemNombre: string
}) {
  const compradorId = input.compradorId ?? null
  const checkoutSessionId = input.checkoutSessionId ?? null
  const netoEmpresaAmount = input.netoEmpresaAmount ?? null
  const deliveredAmount = input.deliveredAmount ?? null
  const refundedAmount = input.refundedAmount ?? null
  const qrCode = `qr-${input.ventaId}`

  await prisma.$executeRaw`
    INSERT INTO consumibles_ventas
      (id, barra_id, evento_id, empresa_id, comprador_id, checkout_session_id, origen, qr_code, clave_corta, total, estado, neto_empresa_amount, delivered_amount, refunded_amount, created_at)
    VALUES (${input.ventaId}, ${input.barraId}, ${input.eventoId}, ${input.empresaId}, ${compradorId}, ${checkoutSessionId}, ${input.origen}, ${qrCode}, ${input.clave}, ${input.total}, ${input.estado}, ${netoEmpresaAmount}, ${deliveredAmount}, ${refundedAmount}, ${input.createdAt}::timestamp)
    ON CONFLICT DO NOTHING`

  const itemId = `item-${input.ventaId}`
  await prisma.$executeRaw`
    INSERT INTO consumibles_venta_items (id, venta_id, consumible_id, nombre_snapshot, precio_unitario, cantidad, subtotal)
    VALUES (${itemId}, ${input.ventaId}, ${input.consumibleId}, ${input.itemNombre}, ${input.total}, 1, ${input.total})
    ON CONFLICT DO NOTHING`
}

function parseCsv(text: string) {
  return text
    .trim()
    .split('\n')
    .map((line) => line.replace(/\r$/, '').split(','))
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM consumibles_venta_items WHERE id ILIKE 'cons-export-%' OR venta_id ILIKE 'cons-export-%'`
  await prisma.$executeRaw`DELETE FROM consumibles_ventas WHERE id ILIKE 'cons-export-%' OR empresa_id ILIKE 'cons-export-%' OR comprador_id ILIKE 'cons-export-%' OR checkout_session_id ILIKE 'cons-export-%'`
  await prisma.$executeRaw`DELETE FROM consumibles WHERE id ILIKE 'cons-export-%' OR empresa_id ILIKE 'cons-export-%'`
  await prisma.$executeRaw`DELETE FROM barras WHERE id ILIKE 'cons-export-%' OR empresa_id ILIKE 'cons-export-%'`
  await prisma.$executeRaw`DELETE FROM eventos WHERE id ILIKE 'cons-export-%' OR empresa_id ILIKE 'cons-export-%'`
  await prisma.$executeRaw`DELETE FROM compradores WHERE id ILIKE 'cons-export-%' OR empresa_id ILIKE 'cons-export-%'`
  await prisma.$executeRaw`DELETE FROM usuarios WHERE id ILIKE 'cons-export-%' OR empresa_id ILIKE 'cons-export-%'`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'cons-export-%' OR slug ILIKE 'cons-export-%'`
}

beforeEach(async () => {
  process.env.CONSUMIBLES_EXPORT_MAX_ROWS = originalExportLimit
  await cleanup()
})

after(async () => {
  process.env.CONSUMIBLES_EXPORT_MAX_ROWS = originalExportLimit
  await cleanup()
  await prisma.$disconnect()
})

test('consumibles export returns the full filtered dataset in active sort order even when pagination points elsewhere', async () => {
  const empresaId = 'cons-export-emp-1'
  const empleadoId = 'cons-export-usr-1'
  const empleadoEmail = 'cons-export-usr-1@example.com'
  await seedEmpresa(empresaId, 'cons-export-1')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_consumibles: true, ver_recaudacion: true })
  await seedEvento('cons-export-evt-1', empresaId, 'Festival Norte')
  await seedBarra('cons-export-bar-1', 'cons-export-evt-1', empresaId, 'Barra Norte')
  await seedConsumible('cons-export-con-1', empresaId, 'Gin tonic premium', 1500)
  await seedComprador('cons-export-cmp-1', empresaId, 'Target Uno', 'target-1@example.com')
  await seedComprador('cons-export-cmp-2', empresaId, 'Target Dos', 'target-2@example.com')

  await seedVenta({
    ventaId: 'cons-export-sale-1',
    empresaId,
    eventoId: 'cons-export-evt-1',
    barraId: 'cons-export-bar-1',
    consumibleId: 'cons-export-con-1',
    compradorId: 'cons-export-cmp-1',
    checkoutSessionId: 'cons-export-checkout-1',
    origen: 'tenant_publico',
    clave: 'B-002',
    estado: 'pendiente',
    total: 1500,
    createdAt: '2026-05-18 10:00:00',
    itemNombre: 'Target especial gin',
  })
  await seedVenta({
    ventaId: 'cons-export-sale-2',
    empresaId,
    eventoId: 'cons-export-evt-1',
    barraId: 'cons-export-bar-1',
    consumibleId: 'cons-export-con-1',
    compradorId: 'cons-export-cmp-2',
    checkoutSessionId: 'cons-export-checkout-2',
    origen: 'manual',
    clave: 'A-001',
    estado: 'canjeado',
    total: 1800,
    createdAt: '2026-05-18 11:00:00',
    itemNombre: 'Target tonic extra',
  })

  const app = express()
  app.use('/api/consumibles/ventas', ventasRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestText(
      `${server.baseUrl}/api/consumibles/ventas/export?busqueda=Target&page=3&pageSize=1&sortBy=clave&sortDir=asc`,
      buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_consumibles: true, ver_recaudacion: true })
    )

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8')
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="Consumibles_Resumen.csv"')
    const rows = parseCsv(response.text)
    assert.deepEqual(rows[0], ['fecha_compra', 'estado', 'reembolsada', 'origen', 'evento', 'barra', 'total', 'neto_empresa_amount', 'delivered_amount', 'reembolso_parcial', 'total_reembolsado', 'neto_total'])
    assert.equal(rows.length, 3)
    assert.equal(rows[1]?.[4], 'Festival Norte')
    assert.equal(rows[2]?.[4], 'Festival Norte')
  } finally {
    await server.close()
  }
})

test('consumibles export can return xlsx', async () => {
  const empresaId = 'cons-export-emp-xlsx'
  const empleadoId = 'cons-export-usr-xlsx'
  const empleadoEmail = 'cons-export-usr-xlsx@example.com'
  await seedEmpresa(empresaId, 'cons-export-xlsx')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_consumibles: true, ver_recaudacion: true })
  await seedEvento('cons-export-evt-xlsx', empresaId, 'Festival XLSX')
  await seedBarra('cons-export-bar-xlsx', 'cons-export-evt-xlsx', empresaId, 'Barra XLSX')
  await seedConsumible('cons-export-con-xlsx', empresaId, 'Agua', 500)
  await seedVenta({ ventaId: 'cons-export-sale-xlsx', empresaId, eventoId: 'cons-export-evt-xlsx', barraId: 'cons-export-bar-xlsx', consumibleId: 'cons-export-con-xlsx', origen: 'manual', clave: 'XLSX-001', estado: 'pendiente', total: 500, createdAt: '2026-05-18 09:00:00', itemNombre: 'Agua xlsx' })

  const app = express()
  app.use('/api/consumibles/ventas', ventasRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestBinary(`${server.baseUrl}/api/consumibles/ventas/export?format=xlsx`, buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_consumibles: true, ver_recaudacion: true }))
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    assert.match(response.headers.get('content-disposition') ?? '', /^attachment; filename="Consumibles_Resumen_\d{4}-\d{2}-\d{2}\.xlsx"$/)
    assert.equal(response.body.subarray(0, 2).toString('utf8'), 'PK')
  } finally {
    await server.close()
  }
})

test('consumibles export returns only the allowed header row when filters produce no matches', async () => {
  const empresaId = 'cons-export-emp-2'
  const empleadoId = 'cons-export-usr-2'
  const empleadoEmail = 'cons-export-usr-2@example.com'
  await seedEmpresa(empresaId, 'cons-export-2')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_consumibles: true })

  const app = express()
  app.use('/api/consumibles/ventas', ventasRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestText(
      `${server.baseUrl}/api/consumibles/ventas/export?busqueda=sin-coincidencias`,
      buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_consumibles: true })
    )

    assert.equal(response.status, 200)
    assert.deepEqual(parseCsv(response.text), [[
      'fecha_compra',
      'estado',
      'reembolsada',
      'origen',
      'evento',
      'barra',
    ]])
  } finally {
    await server.close()
  }
})

test('consumibles export denies users without ver_consumibles and returns no CSV', async () => {
  const empresaId = 'cons-export-emp-2b'
  const empleadoId = 'cons-export-usr-2b'
  const empleadoEmail = 'cons-export-usr-2b@example.com'
  await seedEmpresa(empresaId, 'cons-export-2b')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_recaudacion: true })

  const app = express()
  app.use('/api/consumibles/ventas', ventasRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson<{ error: string }>(
      `${server.baseUrl}/api/consumibles/ventas/export`,
      buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_recaudacion: true })
    )

    assert.equal(response.status, 403)
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
    assert.equal(response.data.error, 'Sin permiso')
  } finally {
    await server.close()
  }
})

test('consumibles export rejects oversized datasets instead of truncating the CSV', async () => {
  process.env.CONSUMIBLES_EXPORT_MAX_ROWS = '1'
  const empresaId = 'cons-export-emp-3'
  const empleadoId = 'cons-export-usr-3'
  const empleadoEmail = 'cons-export-usr-3@example.com'
  await seedEmpresa(empresaId, 'cons-export-3')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_consumibles: true, ver_recaudacion: true })
  await seedEvento('cons-export-evt-3', empresaId, 'Festival Límite')
  await seedBarra('cons-export-bar-3', 'cons-export-evt-3', empresaId, 'Barra Límite')
  await seedConsumible('cons-export-con-3', empresaId, 'Agua', 500)
  await seedVenta({ ventaId: 'cons-export-sale-3a', empresaId, eventoId: 'cons-export-evt-3', barraId: 'cons-export-bar-3', consumibleId: 'cons-export-con-3', origen: 'manual', clave: 'L-001', estado: 'pendiente', total: 500, createdAt: '2026-05-18 09:00:00', itemNombre: 'Agua uno' })
  await seedVenta({ ventaId: 'cons-export-sale-3b', empresaId, eventoId: 'cons-export-evt-3', barraId: 'cons-export-bar-3', consumibleId: 'cons-export-con-3', origen: 'manual', clave: 'L-002', estado: 'pendiente', total: 500, createdAt: '2026-05-18 09:05:00', itemNombre: 'Agua dos' })

  const app = express()
  app.use('/api/consumibles/ventas', ventasRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson<{ code: string; limit: number; total: number }>(
      `${server.baseUrl}/api/consumibles/ventas/export`,
      buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_consumibles: true, ver_recaudacion: true })
    )

    assert.equal(response.status, 413)
    assert.equal(response.data.code, 'export_limit_exceeded')
    assert.equal(response.data.limit, 1)
    assert.equal(response.data.total, 2)
  } finally {
    await server.close()
  }
})

test('consumibles export can filter by created_at date range', async () => {
  const empresaId = 'cons-export-emp-date'
  const empleadoId = 'cons-export-usr-date'
  const empleadoEmail = 'cons-export-usr-date@example.com'
  await seedEmpresa(empresaId, 'cons-export-date')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_consumibles: true, ver_recaudacion: true })
  await seedEvento('cons-export-evt-date', empresaId, 'Festival Fecha')
  await seedBarra('cons-export-bar-date', 'cons-export-evt-date', empresaId, 'Barra Fecha')
  await seedConsumible('cons-export-con-date', empresaId, 'Agua', 500)
  await seedComprador('cons-export-cmp-date-1', empresaId, 'Buyer Uno', 'buyer-uno@example.com')
  await seedComprador('cons-export-cmp-date-2', empresaId, 'Buyer Dos', 'buyer-dos@example.com')
  await seedVenta({ ventaId: 'cons-export-sale-date-1', empresaId, eventoId: 'cons-export-evt-date', barraId: 'cons-export-bar-date', consumibleId: 'cons-export-con-date', compradorId: 'cons-export-cmp-date-1', checkoutSessionId: 'cons-export-checkout-date-1', origen: 'tenant_publico', clave: 'DATE-001', estado: 'pendiente', total: 500, createdAt: '2026-05-18 10:00:00', itemNombre: 'Agua' })
  await seedVenta({ ventaId: 'cons-export-sale-date-2', empresaId, eventoId: 'cons-export-evt-date', barraId: 'cons-export-bar-date', consumibleId: 'cons-export-con-date', compradorId: 'cons-export-cmp-date-2', checkoutSessionId: 'cons-export-checkout-date-2', origen: 'tenant_publico', clave: 'DATE-002', estado: 'pendiente', total: 500, createdAt: '2026-05-20 10:00:00', itemNombre: 'Agua' })

  const app = express()
  app.use('/api/consumibles/ventas', ventasRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestText(`${server.baseUrl}/api/consumibles/ventas/export?desde=2026-05-19&hasta=2026-05-21`, buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_consumibles: true, ver_recaudacion: true }))
    assert.equal(response.status, 200)
    const rows = parseCsv(response.text)
    assert.equal(rows.length, 2)
    assert.equal(rows[1]?.[4], 'Festival Fecha')
    assert.equal(rows[1]?.includes('DATE-001'), false)
  } finally {
    await server.close()
  }
})

test('consumibles export keeps one row per venta with explicit origin and partial resolution amounts', async () => {
  const empresaId = 'cons-export-emp-4'
  const empleadoId = 'cons-export-usr-4'
  const empleadoEmail = 'cons-export-usr-4@example.com'
  await seedEmpresa(empresaId, 'cons-export-4')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_consumibles: true, ver_recaudacion: true })
  await seedComprador('cons-export-cmp-4', empresaId, 'Comprador Export', 'comprador@example.com')
  await seedEvento('cons-export-evt-4', empresaId, 'Festival Mixto')
  await seedBarra('cons-export-bar-4', 'cons-export-evt-4', empresaId, 'Barra Mixta')
  await seedConsumible('cons-export-con-4', empresaId, 'Combo mixto', 6000)
  await seedVenta({
    ventaId: 'cons-export-sale-4a',
    empresaId,
    eventoId: 'cons-export-evt-4',
    barraId: 'cons-export-bar-4',
    consumibleId: 'cons-export-con-4',
    compradorId: 'cons-export-cmp-4',
    checkoutSessionId: 'cons-export-checkout-4',
    origen: 'tenant_publico',
    clave: 'PX-001',
    estado: 'resuelto_parcial',
    total: 6000,
    netoEmpresaAmount: 3000,
    deliveredAmount: 3000,
    refundedAmount: 3000,
    createdAt: '2026-05-18 12:00:00',
    itemNombre: 'Combo parcial',
  })
  await seedVenta({
    ventaId: 'cons-export-sale-4b',
    empresaId,
    eventoId: 'cons-export-evt-4',
    barraId: 'cons-export-bar-4',
    consumibleId: 'cons-export-con-4',
    origen: 'manual',
    clave: 'PX-002',
    estado: 'cancelado',
    total: 2500,
    netoEmpresaAmount: 0,
    deliveredAmount: 0,
    refundedAmount: 2500,
    createdAt: '2026-05-18 13:00:00',
    itemNombre: 'Combo cancelado',
  })

  const app = express()
  app.use('/api/consumibles/ventas', ventasRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestText(
      `${server.baseUrl}/api/consumibles/ventas/export?sortBy=clave&sortDir=asc`,
      buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_consumibles: true, ver_recaudacion: true })
    )

    assert.equal(response.status, 200)
    const rows = parseCsv(response.text)
    assert.equal(rows.length, 3)
    assert.deepEqual(rows[1], ['2026-05-18 12:00', 'resuelto_parcial', 'Sí', 'tenant_publico', 'Festival Mixto', 'Barra Mixta', '6000', '3000', '3000', 'Sí', '3000', '3000'])
    assert.equal(rows[2]?.[3], 'manual')
  } finally {
    await server.close()
  }
})
