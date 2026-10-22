import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import ExcelJS from 'exceljs'
import express from 'express'
import type { CellValue, Row } from 'exceljs'
import { prismaDirectUrl as prisma } from './lib/prisma'
import entradasRouter from './routes/entradas'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch
const originalExportLimit = process.env.ENTRADAS_EXPORT_MAX_ROWS

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

async function requestExport(url: string, user: Record<string, unknown> | null) {
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

async function loadWorksheet(buffer: Buffer) {
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0])
  assert.equal(workbook.worksheets.length, 1)
  const worksheet = workbook.getWorksheet('Entradas')
  assert.ok(worksheet)
  return worksheet
}

function readRowValues(row: Row): CellValue[] {
  return Array.isArray(row.values) ? row.values.slice(1) : []
}

function readWorksheetRows(worksheet: ExcelJS.Worksheet) {
  const rows: string[][] = []

  worksheet.eachRow((row) => {
    rows.push(readRowValues(row).map((value) => String(value ?? '')))
  })

  return rows
}

function readWorksheetHeaderLabels(worksheet: ExcelJS.Worksheet) {
  return readRowValues(worksheet.getRow(1)).map((value) => String(value ?? ''))
}

function parseCsv(csv: string) {
  const lines = csv.trimEnd().split('\n')
  return lines.map((line) => line.split(',').map((cell) => cell.replace(/^"|"$/g, '').replace(/""/g, '"')))
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

async function seedComprador(compradorId: string, empresaId: string, nombre: string, email: string, dni: string) {
  await prisma.$executeRaw`
    INSERT INTO compradores (id, empresa_id, nombre, email, dni, password, created_at)
    VALUES (${compradorId}, ${empresaId}, ${nombre}, ${email}, ${dni}, ${TEST_PASSWORD_HASH}, NOW())
    ON CONFLICT DO NOTHING`
}

async function seedEvento(eventoId: string, empresaId: string, nombre: string) {
  await prisma.$executeRaw`
    INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo)
    VALUES (${eventoId}, ${empresaId}, ${nombre}, NULL, NULL, 'unica', NULL, true)
    ON CONFLICT DO NOTHING`
}

async function seedCategoria(categoriaId: string, eventoId: string, nombre: string) {
  await prisma.$executeRaw`
    INSERT INTO entrada_categorias (id, evento_id, tanda_id, nombre, descripcion, precio, stock, stock_disponible, activa)
    VALUES (${categoriaId}, ${eventoId}, NULL, ${nombre}, NULL, 1500, 50, 48, true)
    ON CONFLICT DO NOTHING`
}

async function seedEntrada(input: {
  entradaId: string
  eventoId: string
  categoriaId: string
  compradorId: string
  clave: string
  estado?: 'valida' | 'usada' | 'cancelada'
  createdAt: string
  checkoutSessionId: string
  precioPagado?: number
  comision?: number
  netoEmpresaAmount?: number
}) {
  const estado = input.estado ?? 'valida'
  const precioPagado = input.precioPagado ?? 1500
  const comision = input.comision ?? 225
  const netoEmpresaAmount = input.netoEmpresaAmount ?? 1275
  const qrCode = `qr-${input.entradaId}`
  const empresaId = input.eventoId.replace('evt', 'emp')
  const allocId = `alloc-${input.entradaId}`

  await prisma.$executeRaw`
    INSERT INTO entradas (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado, precio_pagado, comision, neto_empresa_amount, created_at)
    VALUES (${input.entradaId}, ${input.eventoId}, ${input.categoriaId}, ${input.compradorId}, ${qrCode}, ${input.clave}, ${estado}, ${precioPagado}, ${comision}, ${netoEmpresaAmount}, ${input.createdAt}::timestamp)
    ON CONFLICT DO NOTHING`

  await prisma.$executeRaw`
    INSERT INTO platform_sale_allocations
    (id, source_type, source_id, checkout_session_id, empresa_id, flow, currency, owner_fee_amount, allocated_amount, allocation_percentage, entry_kind, configured_platform_admin_user_id, effective_platform_admin_user_id, fallback_reason)
    VALUES (${allocId}, 'entrada', ${input.entradaId}, ${input.checkoutSessionId}, ${empresaId}, 'entradas', 'ARS', 0, 0, 0, 'allocation', 'sales-export-platform-config', 'sales-export-platform-effective', 'none')
    ON CONFLICT DO NOTHING`
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM platform_sale_allocations WHERE id ILIKE 'alloc-sales-export-%' OR source_id ILIKE 'sales-export-%' OR checkout_session_id ILIKE 'sales-export-%' OR empresa_id ILIKE 'sales-export-%'`
  await prisma.$executeRaw`DELETE FROM entradas WHERE id ILIKE 'sales-export-%' OR evento_id ILIKE 'sales-export-%' OR comprador_id ILIKE 'sales-export-%'`
  await prisma.$executeRaw`DELETE FROM entrada_categorias WHERE id ILIKE 'sales-export-%' OR evento_id ILIKE 'sales-export-%'`
  await prisma.$executeRaw`DELETE FROM evento_fechas WHERE evento_id ILIKE 'sales-export-%'`
  await prisma.$executeRaw`DELETE FROM evento_tandas WHERE evento_id ILIKE 'sales-export-%'`
  await prisma.$executeRaw`DELETE FROM eventos WHERE id ILIKE 'sales-export-%' OR empresa_id ILIKE 'sales-export-%'`
  await prisma.$executeRaw`DELETE FROM compradores WHERE id ILIKE 'sales-export-%' OR empresa_id ILIKE 'sales-export-%'`
  await prisma.$executeRaw`DELETE FROM usuarios WHERE id ILIKE 'sales-export-%' OR empresa_id ILIKE 'sales-export-%'`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'sales-export-%' OR slug ILIKE 'sales-export-%'`
}

beforeEach(async () => {
  process.env.ENTRADAS_EXPORT_MAX_ROWS = originalExportLimit
  await cleanup()
})

after(async () => {
  process.env.ENTRADAS_EXPORT_MAX_ROWS = originalExportLimit
  await cleanup()
  await prisma.$disconnect()
})

test('entradas export returns the full filtered dataset in active sort order even when pagination points elsewhere', async () => {
  const empresaId = 'sales-export-emp-1'
  const empleadoId = 'sales-export-usr-1'
  const empleadoEmail = 'sales-export-usr-1@example.com'
  await seedEmpresa(empresaId, 'sales-export-1')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_entradas: true, ver_recaudacion: true })

  await seedComprador('sales-export-cmp-1', empresaId, 'Target Uno', 'target-uno@example.com', '11111111')
  await seedComprador('sales-export-cmp-2', empresaId, 'Target Dos', 'target-dos@example.com', '22222222')
  await seedComprador('sales-export-cmp-3', empresaId, 'Otro Comprador', 'otro@example.com', '33333333')
  await seedEvento('sales-export-evt-1', empresaId, 'B Evento')
  await seedCategoria('sales-export-cat-1', 'sales-export-evt-1', 'Campo')

  await seedEntrada({
    entradaId: 'sales-export-ent-1',
    eventoId: 'sales-export-evt-1',
    categoriaId: 'sales-export-cat-1',
    compradorId: 'sales-export-cmp-1',
    clave: 'B-002',
    createdAt: '2026-05-18 10:00:00',
    checkoutSessionId: 'sales-export-checkout-1',
  })
  await seedEntrada({
    entradaId: 'sales-export-ent-2',
    eventoId: 'sales-export-evt-1',
    categoriaId: 'sales-export-cat-1',
    compradorId: 'sales-export-cmp-2',
    clave: 'A-001',
    createdAt: '2026-05-18 11:00:00',
    checkoutSessionId: 'sales-export-checkout-2',
  })
  await seedEntrada({
    entradaId: 'sales-export-ent-3',
    eventoId: 'sales-export-evt-1',
    categoriaId: 'sales-export-cat-1',
    compradorId: 'sales-export-cmp-3',
    clave: 'C-003',
    createdAt: '2026-05-18 12:00:00',
    checkoutSessionId: 'sales-export-checkout-3',
  })

  const app = express()
  app.use('/api/entradas', entradasRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestExport(
      `${server.baseUrl}/api/entradas/export?busqueda=Target&page=3&pageSize=1&sortBy=clave&sortDir=asc`,
      buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_entradas: true, ver_recaudacion: true })
    )

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    assert.match(
      response.headers.get('content-disposition') ?? '',
      /^attachment; filename="Entradas_Resumen_\d{4}-\d{2}-\d{2}\.xlsx"$/
    )
    const worksheet = await loadWorksheet(response.body)
    const rows = readWorksheetRows(worksheet)
    assert.deepEqual(readWorksheetHeaderLabels(worksheet), ['Fecha compra', 'Estado', 'Reembolsada', 'Evento', 'Email comprador', 'DNI comprador', 'Precio pagado', 'Comisión', 'Neto empresa', 'Total reembolsado', 'Total sin reembolso', 'Total final', 'Neto total'])
    assert.equal(worksheet.views[0]?.state, 'frozen')
    assert.equal(worksheet.views[0]?.ySplit, 1)
    assert.equal(worksheet.getColumn(7).numFmt, '#,##0.00')
    assert.equal(worksheet.getColumn(8).numFmt, '#,##0.00')
    assert.equal(worksheet.getColumn(9).numFmt, '#,##0.00')
    assert.equal(worksheet.getColumn(10).numFmt, '#,##0.00')
    assert.equal(worksheet.getColumn(11).numFmt, '#,##0.00')
    assert.equal(worksheet.getColumn(12).numFmt, '#,##0.00')
    assert.equal(worksheet.getColumn(13).numFmt, '#,##0.00')
    assert.equal(worksheet.getCell('G2').numFmt, '#,##0.00')
    assert.equal(worksheet.getCell('G2').value, 1500)
    assert.equal(worksheet.getCell('C2').value, 'No')
    assert.equal(rows.length, 3)
    assert.equal(rows[1]?.[3], 'B Evento')
    assert.equal(rows[2]?.[3], 'B Evento')
  } finally {
    await server.close()
  }
})

test('entradas export denies actors without ver_entradas and returns no workbook payload', async () => {
  const empresaId = 'sales-export-emp-4'
  const empleadoId = 'sales-export-usr-4'
  const empleadoEmail = 'sales-export-usr-4@example.com'
  await seedEmpresa(empresaId, 'sales-export-4')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_entradas: false })

  const app = express()
  app.use('/api/entradas', entradasRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestExport(
      `${server.baseUrl}/api/entradas/export`,
      buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_entradas: false })
    )

    assert.equal(response.status, 403)
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
    assert.equal(response.headers.get('content-disposition'), null)
    assert.doesNotMatch(response.body.toString('utf8'), /^PK/)
    assert.match(response.body.toString('utf8'), /Sin permiso/)
  } finally {
    await server.close()
  }
})

test('entradas export can return csv without removing the xlsx variant', async () => {
  const empresaId = 'sales-export-emp-csv'
  const empleadoId = 'sales-export-usr-csv'
  const empleadoEmail = 'sales-export-usr-csv@example.com'
  await seedEmpresa(empresaId, 'sales-export-csv')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_entradas: true, ver_recaudacion: true })
  await seedEvento('sales-export-csv-evt-1', empresaId, 'Festival CSV')
  await seedCategoria('sales-export-csv-cat-1', 'sales-export-csv-evt-1', 'Campo')
  await seedComprador('sales-export-csv-cmp-1', empresaId, 'Lara CSV', 'lara.csv@example.com', '30111222')
  await seedEntrada({
    entradaId: 'sales-export-csv-ent-1',
    eventoId: 'sales-export-csv-evt-1',
    categoriaId: 'sales-export-csv-cat-1',
    compradorId: 'sales-export-csv-cmp-1',
    clave: 'CSV-001',
    createdAt: '2026-05-18 12:00:00',
    checkoutSessionId: 'sales-export-csv-checkout-1',
  })

  const app = express()
  app.use('/api/entradas', entradasRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestExport(
      `${server.baseUrl}/api/entradas/export?format=csv`,
      buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_entradas: true, ver_recaudacion: true })
    )

    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8')
    assert.match(
      response.headers.get('content-disposition') ?? '',
      /^attachment; filename="Entradas_Resumen_\d{4}-\d{2}-\d{2}\.csv"$/
    )
    const rows = parseCsv(response.body.toString('utf8'))
    assert.deepEqual(rows[0], ['fecha_compra', 'estado', 'reembolsada', 'evento', 'comprador_email', 'comprador_dni', 'precio_pagado', 'comision', 'neto_empresa_amount', 'total_reembolsado', 'total_sin_reembolso', 'total_final', 'neto_total'])
    assert.equal(rows[1]?.[2], 'No')
    assert.equal(rows[1]?.[3], 'Festival CSV')
    assert.equal(rows[1]?.[4], 'lara.csv@example.com')
  } finally {
    await server.close()
  }
})

test('entradas export returns only the allowed header row when filters produce no matches', async () => {
  const empresaId = 'sales-export-emp-2'
  const empleadoId = 'sales-export-usr-2'
  const empleadoEmail = 'sales-export-usr-2@example.com'
  await seedEmpresa(empresaId, 'sales-export-2')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_entradas: true })

  const app = express()
  app.use('/api/entradas', entradasRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestExport(
      `${server.baseUrl}/api/entradas/export?busqueda=sin-coincidencias`,
      buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_entradas: true })
    )

    assert.equal(response.status, 200)
    const worksheet = await loadWorksheet(response.body)
    const rows = readWorksheetRows(worksheet)
    assert.deepEqual(rows, [[
      'Fecha compra',
      'Estado',
      'Reembolsada',
      'Evento',
    ]])
  } finally {
    await server.close()
  }
})

test('entradas export can exclude refunded rows while keeping refund accounting columns', async () => {
  const empresaId = 'sales-export-emp-filter'
  const empleadoId = 'sales-export-usr-filter'
  const empleadoEmail = 'sales-export-usr-filter@example.com'
  await seedEmpresa(empresaId, 'sales-export-filter')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_entradas: true, ver_recaudacion: true })
  await seedComprador('sales-export-cmp-filter-1', empresaId, 'Comprador Uno', 'filter-uno@example.com', '11111111')
  await seedComprador('sales-export-cmp-filter-2', empresaId, 'Comprador Dos', 'filter-dos@example.com', '22222222')
  await seedEvento('sales-export-evt-filter', empresaId, 'Evento Filtro')
  await seedCategoria('sales-export-cat-filter', 'sales-export-evt-filter', 'General')
  await seedEntrada({
    entradaId: 'sales-export-ent-filter-1',
    eventoId: 'sales-export-evt-filter',
    categoriaId: 'sales-export-cat-filter',
    compradorId: 'sales-export-cmp-filter-1',
    clave: 'KEEP-001',
    createdAt: '2026-05-18 10:00:00',
    checkoutSessionId: 'sales-export-checkout-filter-1',
  })
  await seedEntrada({
    entradaId: 'sales-export-ent-filter-2',
    eventoId: 'sales-export-evt-filter',
    categoriaId: 'sales-export-cat-filter',
    compradorId: 'sales-export-cmp-filter-2',
    clave: 'DROP-001',
    estado: 'cancelada',
    createdAt: '2026-05-18 11:00:00',
    checkoutSessionId: 'sales-export-checkout-filter-2',
  })

  const app = express()
  app.use('/api/entradas', entradasRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestExport(
      `${server.baseUrl}/api/entradas/export?includeRefunded=false`,
      buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_entradas: true, ver_recaudacion: true })
    )

    assert.equal(response.status, 200)
    const worksheet = await loadWorksheet(response.body)
    const rows = readWorksheetRows(worksheet)
    assert.equal(rows.length, 2)
    assert.equal(rows[1]?.[2], 'No')
    assert.equal(rows[1]?.[3], 'Evento Filtro')
    assert.equal(rows[1]?.includes('DROP-001'), false)
  } finally {
    await server.close()
  }
})

test('entradas export can filter by created_at date range', async () => {
  const empresaId = 'sales-export-emp-period'
  const empleadoId = 'sales-export-usr-period'
  const empleadoEmail = 'sales-export-usr-period@example.com'
  await seedEmpresa(empresaId, 'sales-export-period')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_entradas: true, ver_recaudacion: true })
  await seedComprador('sales-export-cmp-period-1', empresaId, 'Comprador Uno', 'period-uno@example.com', '11111111')
  await seedComprador('sales-export-cmp-period-2', empresaId, 'Comprador Dos', 'period-dos@example.com', '22222222')
  await seedEvento('sales-export-evt-period', empresaId, 'Evento Periodo')
  await seedCategoria('sales-export-cat-period', 'sales-export-evt-period', 'General')
  await seedEntrada({
    entradaId: 'sales-export-ent-period-1',
    eventoId: 'sales-export-evt-period',
    categoriaId: 'sales-export-cat-period',
    compradorId: 'sales-export-cmp-period-1',
    clave: 'DATE-001',
    createdAt: '2026-05-18 10:00:00',
    checkoutSessionId: 'sales-export-checkout-period-1',
  })
  await seedEntrada({
    entradaId: 'sales-export-ent-period-2',
    eventoId: 'sales-export-evt-period',
    categoriaId: 'sales-export-cat-period',
    compradorId: 'sales-export-cmp-period-2',
    clave: 'DATE-002',
    createdAt: '2026-05-20 10:00:00',
    checkoutSessionId: 'sales-export-checkout-period-2',
  })

  const app = express()
  app.use('/api/entradas', entradasRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestExport(
      `${server.baseUrl}/api/entradas/export?desde=2026-05-19&hasta=2026-05-21`,
      buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_entradas: true, ver_recaudacion: true })
    )

    assert.equal(response.status, 200)
    const worksheet = await loadWorksheet(response.body)
    const rows = readWorksheetRows(worksheet)
    assert.equal(rows.length, 2)
    assert.equal(rows[1]?.[5], '22222222')
    assert.equal(rows[1]?.includes('DATE-001'), false)
  } finally {
    await server.close()
  }
})

test('entradas export rejects oversized datasets instead of truncating the workbook', async () => {
  process.env.ENTRADAS_EXPORT_MAX_ROWS = '1'
  const empresaId = 'sales-export-emp-3'
  const empleadoId = 'sales-export-usr-3'
  const empleadoEmail = 'sales-export-usr-3@example.com'
  await seedEmpresa(empresaId, 'sales-export-3')
  await seedEmpleado(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_entradas: true, ver_recaudacion: true })
  await seedComprador('sales-export-cmp-31', empresaId, 'Comprador Uno', 'uno@example.com', '11111111')
  await seedComprador('sales-export-cmp-32', empresaId, 'Comprador Dos', 'dos@example.com', '22222222')
  await seedEvento('sales-export-evt-3', empresaId, 'Evento Grande')
  await seedCategoria('sales-export-cat-3', 'sales-export-evt-3', 'General')
  await seedEntrada({
    entradaId: 'sales-export-ent-31',
    eventoId: 'sales-export-evt-3',
    categoriaId: 'sales-export-cat-3',
    compradorId: 'sales-export-cmp-31',
    clave: 'OV-001',
    createdAt: '2026-05-18 10:00:00',
    checkoutSessionId: 'sales-export-checkout-31',
  })
  await seedEntrada({
    entradaId: 'sales-export-ent-32',
    eventoId: 'sales-export-evt-3',
    categoriaId: 'sales-export-cat-3',
    compradorId: 'sales-export-cmp-32',
    clave: 'OV-002',
    createdAt: '2026-05-18 11:00:00',
    checkoutSessionId: 'sales-export-checkout-32',
  })

  const app = express()
  app.use('/api/entradas', entradasRouter)
  const server = await createTestServer(app)

  try {
    const response = await originalFetch(
      `${server.baseUrl}/api/entradas/export`,
      {
        method: 'GET',
        headers: buildHeaders(buildEmpleadoUser(empleadoId, empresaId, empleadoEmail, { exportar: true, ver_entradas: true, ver_recaudacion: true })),
      }
    )

    assert.equal(response.status, 413)
    assert.match(await response.text(), /Refiná los filtros/)
  } finally {
    await server.close()
  }
})
