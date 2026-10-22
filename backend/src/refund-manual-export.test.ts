import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

import pool from './db'
import reembolsosRouter from './routes/reembolsos'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch

function buildHeaders(user: Record<string, unknown>) {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
    'x-user': JSON.stringify(user),
  }
}

function buildEmpresaUser(empresaId: string, slug: string) {
  return { id: empresaId, email: `${slug}@example.com`, userType: 'empresa' as const, slug }
}

function buildEmpleadoUser(empleadoId: string, empresaId: string, slug: string, permisos: Record<string, boolean>) {
  return { id: empleadoId, email: `${empleadoId}@example.com`, userType: 'empleado' as const, empresa_id: empresaId, empresa_slug: slug, slug, permisos }
}

function buildCompradorUser(compradorId: string, empresaId: string, slug: string) {
  return { id: compradorId, email: `${compradorId}@example.com`, userType: 'comprador' as const, empresa_id: empresaId, empresa_slug: slug, slug }
}

async function createTestServer() {
  const app = express()
  app.use(express.json())
  app.use('/api/reembolsos', reembolsosRouter)

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

async function requestJson(url: string, user: Record<string, unknown>) {
  const response = await originalFetch(url, { method: 'GET', headers: buildHeaders(user) })
  const data = await response.json().catch(() => null)
  return { status: response.status, data, headers: response.headers }
}

async function requestText(url: string, user: Record<string, unknown>) {
  const response = await originalFetch(url, { method: 'GET', headers: buildHeaders(user) })
  const text = await response.text()
  return { status: response.status, text, headers: response.headers }
}

async function seedEmpresa({ empresaId, slug }: { empresaId: string; slug: string }) {
  await pool.query(
    `INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
     VALUES (?, ?, ?, ?, ?, ?, true)`,
    [empresaId, `Empresa ${slug}`, slug, `${slug}@example.com`, TEST_PASSWORD_HASH, `Admin ${slug}`]
  )
}

async function seedEmpleado({ empleadoId, empresaId, permisos }: { empleadoId: string; empresaId: string; permisos: Record<string, boolean> }) {
  await pool.query(
    `INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, permisos, activo)
     VALUES (?, ?, 'Em', 'Pleado', ?, ?, 'owner', ?, true)`,
    [empleadoId, empresaId, `${empleadoId}@example.com`, TEST_PASSWORD_HASH, JSON.stringify(permisos)]
  )
}

async function seedComprador({ compradorId, empresaId, nombre, email }: { compradorId: string; empresaId: string; nombre: string; email: string }) {
  await pool.query(
    `INSERT INTO compradores (id, empresa_id, nombre, email, dni, password)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [compradorId, empresaId, nombre, email, `dni-${compradorId.slice(-16)}`, TEST_PASSWORD_HASH]
  )
}

async function seedCheckoutSession(input: {
  sessionId: string
  empresaId: string
  compradorId: string
  flow?: 'entradas' | 'consumibles'
  paymentId: string
}) {
  await pool.query(
    `INSERT INTO checkout_sessions
     (id, comprador_id, empresa_id, datos, estado, payment_id, payment_status, reconciliation_status, confirmed_at, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'confirmada', ?, 'approved', 'reconciled', NOW(), NOW() + INTERVAL '10 minutes', NOW())`,
    [
      input.sessionId,
      input.compradorId,
      input.empresaId,
      JSON.stringify({
        flow: input.flow === 'consumibles' ? 'consumibles' : undefined,
        items: [{ precio: 1200, cantidad: 1 }],
        marketplaceFee: { amount: 50, currency: 'ARS' },
      }),
      input.paymentId,
    ]
  )
}

async function seedEvento({ eventoId, empresaId, nombre }: { eventoId: string; empresaId: string; nombre: string }) {
  await pool.query(
    `INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo)
     VALUES (?, ?, ?, NULL, NULL, 'unica', NULL, true)`,
    [eventoId, empresaId, nombre]
  )
}

async function seedCategoria({ categoriaId, eventoId }: { categoriaId: string; eventoId: string }) {
  await pool.query(
    `INSERT INTO entrada_categorias (id, evento_id, tanda_id, nombre, descripcion, precio, stock, stock_disponible, activa)
     VALUES (?, ?, NULL, ?, NULL, 1200, 10, 10, true)`,
    [categoriaId, eventoId, `Categoria ${categoriaId}`]
  )
}

async function seedEntrada(input: { entradaId: string; eventoId: string; categoriaId: string; compradorId: string }) {
  await pool.query(
    `INSERT INTO entradas (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado, precio_pagado, comision, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'valida', 1200, 180, NOW())`,
    [input.entradaId, input.eventoId, input.categoriaId, input.compradorId, `qr-${input.entradaId}`, `KEY-${input.entradaId}`]
  )
}

async function seedConsumiblesContext(input: {
  empresaId: string
  eventoId: string
  barraId: string
  consumibleId: string
  ventaId: string
  checkoutSessionId: string
  compradorId: string
}) {
  await pool.query(`ALTER TABLE consumibles_ventas ADD COLUMN IF NOT EXISTS comprador_id varchar(36) DEFAULT NULL`)
  await pool.query(`ALTER TABLE consumibles_ventas ADD COLUMN IF NOT EXISTS checkout_session_id varchar(80) DEFAULT NULL`)
  await pool.query(`ALTER TABLE consumibles_ventas ADD COLUMN IF NOT EXISTS origen varchar(40) NOT NULL DEFAULT 'manual'`)

  await pool.query(
    `INSERT INTO barras (id, evento_id, empresa_id, nombre, activa)
     VALUES (?, ?, ?, ?, true)`,
    [input.barraId, input.eventoId, input.empresaId, `Barra ${input.barraId}`]
  )

  await pool.query(
    `INSERT INTO consumibles (id, empresa_id, nombre, descripcion, precio, activo)
     VALUES (?, ?, ?, NULL, 600, true)`,
    [input.consumibleId, input.empresaId, `Consumible ${input.consumibleId}`]
  )

  await pool.query(
    `INSERT INTO barra_stock (id, barra_id, consumible_id, stock_inicial, stock_actual, precio_override, activo)
     VALUES (?, ?, ?, 10, 10, NULL, true)`,
    [`stock-${input.ventaId}`, input.barraId, input.consumibleId]
  )

  await pool.query(
    `INSERT INTO consumibles_ventas
     (id, barra_id, evento_id, empresa_id, comprador_id, checkout_session_id, origen, qr_code, clave_corta, total, estado)
     VALUES (?, ?, ?, ?, ?, ?, 'tenant_publico', ?, ?, 600, 'pendiente')`,
    [
      input.ventaId,
      input.barraId,
      input.eventoId,
      input.empresaId,
      input.compradorId,
      input.checkoutSessionId,
      `qr-${input.ventaId}`,
      `CV${input.ventaId.slice(-6).replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`,
    ]
  )

  await pool.query(
    `INSERT INTO consumibles_venta_items (id, venta_id, consumible_id, nombre_snapshot, precio_unitario, cantidad, subtotal)
     VALUES (?, ?, ?, 'Agua', 300, 2, 600)`,
    [`item-${input.ventaId}`, input.ventaId, input.consumibleId]
  )
}

async function seedRefundCase(input: {
  caseId: string
  empresaId: string
  checkoutSessionId: string
  flow: 'entradas' | 'consumibles'
  status: string
  paymentId: string
  requestedAmount: number
  requestReason: string
  requestOrigin: string
  buyerActorId?: string | null
  requestedEventId?: string | null
  requestedEntryId?: string | null
  requestedSaleId?: string | null
  paymentStatus?: string | null
  reconciliationStatus?: string | null
  requestNote?: string | null
  evidenceNote?: string | null
  externalRefundReference?: string | null
  createdAt: string
  resolvedAt?: string | null
}) {
  await pool.query(
    `INSERT INTO refund_manual_cases
     (id, empresa_id, checkout_session_id, flow, status, payment_id, payment_status, reconciliation_status,
      requested_amount, currency, request_reason, request_note, request_origin, external_refund_reference, evidence_note,
      requester_actor_id, requester_actor_type, requester_buyer_id, requested_event_id, requested_entry_id, requested_sale_id,
      company_policy_snapshot, event_policy_snapshot, created_by, resolved_by, created_at, updated_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ARS', ?, ?, ?, ?, ?, ?, 'empresa', ?, ?, ?, ?, true, true, ?, ?, ?, ?, ?)`,
    [
      input.caseId,
      input.empresaId,
      input.checkoutSessionId,
      input.flow,
      input.status,
      input.paymentId,
      input.paymentStatus ?? 'approved',
      input.reconciliationStatus ?? 'reconciled',
      input.requestedAmount,
      input.requestReason,
      input.requestNote ?? null,
      input.requestOrigin,
      input.externalRefundReference ?? null,
      input.evidenceNote ?? null,
      `actor-${input.caseId}`,
      input.buyerActorId ?? null,
      input.requestedEventId ?? null,
      input.requestedEntryId ?? null,
      input.requestedSaleId ?? null,
      `actor-${input.caseId}`,
      input.resolvedAt ? `resolver-${input.caseId}` : null,
      input.createdAt,
      input.createdAt,
      input.resolvedAt ?? null,
    ]
  )
}

async function seedRefundArtifacts(caseId: string, targetId: string) {
  await pool.query(
    `INSERT INTO refund_manual_case_items
     (id, case_id, target_type, target_id, target_status_before, target_status_after, eligibility, block_reason, amount_snapshot, created_at)
     VALUES (?, ?, 'entrada', ?, 'valida', NULL, 'elegible', NULL, 1200, NOW()),
            (?, ?, 'entrada', ?, 'valida', NULL, 'elegible', NULL, 1200, NOW())`,
    [`item-a-${caseId}`, caseId, targetId, `item-b-${caseId}`, caseId, targetId]
  )

  await pool.query(
    `INSERT INTO refund_manual_case_events
     (id, case_id, event_type, actor_id, actor_type, payload_json)
     VALUES (?, ?, 'case_requested', 'actor', 'empresa', '{"reason":"seed"}'),
            (?, ?, 'case_under_review', 'actor', 'empresa', '{"note":"seed"}')`,
    [`evt-a-${caseId}`, caseId, `evt-b-${caseId}`, caseId]
  )
}

function parseCsv(csv: string) {
  const lines = csv.trimEnd().split('\n')
  const headers = lines[0]?.split(',') ?? []
  const rows = lines.slice(1).filter(Boolean).map((line) => {
    const values = line.split(',')
    return headers.reduce<Record<string, string>>((acc, header, index) => {
      acc[header] = values[index] ?? ''
      return acc
    }, {})
  })
  return { headers, rows }
}

async function cleanup() {
  await pool.query(`DELETE FROM refund_manual_case_events WHERE case_id LIKE 'refund-export-%'`)
  await pool.query(`DELETE FROM refund_manual_case_items WHERE case_id LIKE 'refund-export-%'`)
  await pool.query(`DELETE FROM refund_manual_cases WHERE id LIKE 'refund-export-%' OR empresa_id LIKE 'refund-export-%' OR checkout_session_id LIKE 'refund-export-%'`)
  await pool.query(`DELETE FROM consumibles_venta_items WHERE id LIKE 'item-refund-export-%' OR venta_id LIKE 'refund-export-%' OR consumible_id LIKE 'refund-export-%'`)
  await pool.query(`DELETE FROM consumibles_ventas WHERE id LIKE 'refund-export-%' OR empresa_id LIKE 'refund-export-%' OR comprador_id LIKE 'refund-export-%' OR checkout_session_id LIKE 'refund-export-%'`)
  await pool.query(`DELETE FROM barra_stock WHERE id LIKE 'stock-refund-export-%' OR barra_id LIKE 'refund-export-%' OR consumible_id LIKE 'refund-export-%'`)
  await pool.query(`DELETE FROM consumibles WHERE id LIKE 'refund-export-%' OR empresa_id LIKE 'refund-export-%'`)
  await pool.query(`DELETE FROM barras WHERE id LIKE 'refund-export-%' OR empresa_id LIKE 'refund-export-%'`)
  await pool.query(`DELETE FROM entradas WHERE id LIKE 'refund-export-%' OR evento_id LIKE 'refund-export-%' OR comprador_id LIKE 'refund-export-%'`)
  await pool.query(`DELETE FROM checkout_sessions WHERE id LIKE 'refund-export-%' OR empresa_id LIKE 'refund-export-%' OR comprador_id LIKE 'refund-export-%'`)
  await pool.query(`DELETE FROM entrada_categorias WHERE id LIKE 'refund-export-%' OR evento_id LIKE 'refund-export-%'`)
  await pool.query(`DELETE FROM evento_fechas WHERE evento_id LIKE 'refund-export-%'`)
  await pool.query(`DELETE FROM evento_tandas WHERE evento_id LIKE 'refund-export-%'`)
  await pool.query(`DELETE FROM eventos WHERE id LIKE 'refund-export-%' OR empresa_id LIKE 'refund-export-%'`)
  await pool.query(`DELETE FROM compradores WHERE id LIKE 'refund-export-%' OR empresa_id LIKE 'refund-export-%'`)
  await pool.query(`DELETE FROM usuarios WHERE id LIKE 'refund-export-%' OR empresa_id LIKE 'refund-export-%'`)
  await pool.query(`DELETE FROM empresas WHERE id LIKE 'refund-export-%' OR slug LIKE 'refund-export-%'`)
}

beforeEach(async () => {
  delete process.env.REFUND_MANUAL_EXPORT_MAX_ROWS
  await cleanup()
})

after(async () => {
  delete process.env.REFUND_MANUAL_EXPORT_MAX_ROWS
  await cleanup()
  await pool.end()
})

test('refund export shares server-side filters and sort with the dashboard list and ignores pagination params', async () => {
  const empresaId = 'refund-export-emp-1'
  const slug = 'refund-export-1'
  const compradorId = 'refund-export-cmp-1'
  const otherCompradorId = 'refund-export-cmp-2'
  const eventoId = 'refund-export-evt-1'
  const otherEventoId = 'refund-export-evt-2'
  const categoriaId = 'refund-export-cat-1'
  const sessionA = 'refund-export-session-1'
  const sessionB = 'refund-export-session-2'
  const sessionC = 'refund-export-session-3'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, nombre: 'Ana Target', email: 'ana.target@example.com' })
  await seedComprador({ compradorId: otherCompradorId, empresaId, nombre: 'Bruno Otro', email: 'bruno@example.com' })
  await seedEvento({ eventoId, empresaId, nombre: 'Festival Exportable' })
  await seedEvento({ eventoId: otherEventoId, empresaId, nombre: 'Festival Ajeno' })
  await seedCategoria({ categoriaId, eventoId })
  await seedCheckoutSession({ sessionId: sessionA, empresaId, compradorId, paymentId: 'pay-refund-export-1' })
  await seedCheckoutSession({ sessionId: sessionB, empresaId, compradorId, paymentId: 'pay-refund-export-2', flow: 'consumibles' })
  await seedCheckoutSession({ sessionId: sessionC, empresaId, compradorId: otherCompradorId, paymentId: 'pay-refund-export-3' })
  await seedEntrada({ entradaId: 'refund-export-entry-1', eventoId, categoriaId, compradorId })

  await seedRefundCase({
    caseId: 'refund-export-case-1',
    empresaId,
    checkoutSessionId: sessionA,
    flow: 'entradas',
    status: 'requested',
    paymentId: 'pay-refund-export-1',
    requestedAmount: 1200,
    requestReason: 'Target festival request',
    requestOrigin: 'buyer_event_request',
    buyerActorId: compradorId,
    requestedEventId: eventoId,
    requestedEntryId: 'refund-export-entry-1',
    createdAt: '2026-05-15 12:00:00',
  })
  await seedRefundCase({
    caseId: 'refund-export-case-2',
    empresaId,
    checkoutSessionId: sessionB,
    flow: 'consumibles',
    status: 'under_review',
    paymentId: 'pay-refund-export-2',
    requestedAmount: 600,
    requestReason: 'Target festival consumibles',
    requestOrigin: 'buyer_consumible_request',
    buyerActorId: compradorId,
    requestedEventId: eventoId,
    createdAt: '2026-05-16 12:00:00',
  })
  await seedRefundCase({
    caseId: 'refund-export-case-3',
    empresaId,
    checkoutSessionId: sessionC,
    flow: 'entradas',
    status: 'requested',
    paymentId: 'pay-refund-export-3',
    requestedAmount: 1200,
    requestReason: 'Other festival request',
    requestOrigin: 'company_manual',
    buyerActorId: otherCompradorId,
    requestedEventId: otherEventoId,
    createdAt: '2026-05-17 12:00:00',
  })

  const server = await createTestServer()

  try {
    const query = 'query=Target&buyer=ana&event=Festival+Exportable&sortOrder=date_asc&page=99&pageSize=1'
    const list = await requestJson(`${server.baseUrl}/api/reembolsos?${query}`, buildEmpresaUser(empresaId, slug))
    assert.equal(list.status, 200)
    assert.deepEqual((list.data as any).data.cases.map((refundCase: any) => refundCase.id), ['refund-export-case-1', 'refund-export-case-2'])

    const exported = await requestText(`${server.baseUrl}/api/reembolsos/export?${query}`, buildEmpresaUser(empresaId, slug))
    assert.equal(exported.status, 200)
    assert.match(exported.headers.get('content-type') ?? '', /text\/csv/i)

    const csv = parseCsv(exported.text)
    assert.deepEqual(csv.rows.map((row) => row.case_id), ['refund-export-case-1', 'refund-export-case-2'])
  } finally {
    await server.close()
  }
})

test('refund export returns only allowlisted columns, keeps one row per case, and excludes sensitive fields', async () => {
  const empresaId = 'refund-export-emp-2'
  const slug = 'refund-export-2'
  const compradorId = 'refund-export-cmp-21'
  const eventoId = 'refund-export-evt-21'
  const categoriaId = 'refund-export-cat-21'
  const sessionId = 'refund-export-session-21'
  const consumiblesSessionId = 'refund-export-session-22'
  const ventaId = 'refund-export-sale-22'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, nombre: 'Carla Export', email: 'carla.secret@example.com' })
  await seedEvento({ eventoId, empresaId, nombre: 'Festival Sensible' })
  await seedCategoria({ categoriaId, eventoId })
  await seedCheckoutSession({ sessionId, empresaId, compradorId, paymentId: 'pay-refund-export-21' })
  await seedCheckoutSession({ sessionId: consumiblesSessionId, empresaId, compradorId, flow: 'consumibles', paymentId: 'pay-refund-export-22' })
  await seedEntrada({ entradaId: 'refund-export-entry-21', eventoId, categoriaId, compradorId })
  await seedConsumiblesContext({
    empresaId,
    eventoId,
    barraId: 'refund-export-bar-22',
    consumibleId: 'refund-export-cons-22',
    ventaId,
    checkoutSessionId: consumiblesSessionId,
    compradorId,
  })

  await seedRefundCase({
    caseId: 'refund-export-case-21',
    empresaId,
    checkoutSessionId: sessionId,
    flow: 'entradas',
    status: 'executed',
    paymentId: 'pay-refund-export-21',
    requestedAmount: 1200,
    requestReason: 'Caso con datos sensibles',
    requestOrigin: 'buyer_event_request',
    buyerActorId: compradorId,
    requestedEventId: eventoId,
    requestedEntryId: 'refund-export-entry-21',
    requestNote: 'nota interna que no debe salir',
    evidenceNote: 'evidencia interna que no debe salir',
    externalRefundReference: 'MP-REF-21',
    createdAt: '2026-05-18 09:00:00',
    resolvedAt: '2026-05-18 10:00:00',
  })
  await seedRefundCase({
    caseId: 'refund-export-case-22',
    empresaId,
    checkoutSessionId: consumiblesSessionId,
    flow: 'consumibles',
    status: 'under_review',
    paymentId: 'pay-refund-export-22',
    requestedAmount: 600,
    requestReason: 'Caso consumibles fila única',
    requestOrigin: 'buyer_consumible_request',
    buyerActorId: compradorId,
    requestedEventId: eventoId,
    requestedSaleId: ventaId,
    createdAt: '2026-05-18 11:00:00',
  })
  await seedRefundArtifacts('refund-export-case-21', 'refund-export-entry-21')
  await seedRefundArtifacts('refund-export-case-22', ventaId)

  const server = await createTestServer()

  try {
    const exported = await requestText(`${server.baseUrl}/api/reembolsos/export`, buildEmpresaUser(empresaId, slug))
    assert.equal(exported.status, 200)

    const csv = parseCsv(exported.text)
    assert.deepEqual(csv.headers, [
      'case_id',
      'created_at',
      'resolved_at',
      'checkout_session_id',
      'flow',
      'status',
      'request_origin',
      'requested_event_name',
      'buyer_name',
      'requested_amount',
      'currency',
      'payment_status',
      'reconciliation_status',
      'request_reason',
      'external_refund_reference',
    ])
    assert.equal(csv.rows.length, 2)
    assert.equal(csv.rows[0]?.case_id, 'refund-export-case-22')
    assert.equal(csv.rows[1]?.case_id, 'refund-export-case-21')
    assert.equal(csv.rows[0]?.buyer_name, 'Carla Export')
    assert.equal(csv.rows[1]?.requested_event_name, 'Festival Sensible')
    assert.equal(csv.headers.includes('buyer_email'), false)
    assert.equal(csv.headers.includes('request_note'), false)
    assert.equal(csv.headers.includes('evidence_note'), false)
    assert.equal(csv.headers.includes('payment_id'), false)
    assert.equal(csv.headers.includes('requester_actor_id'), false)
    assert.equal(csv.headers.includes('company_policy_snapshot'), false)
    assert.equal(exported.text.includes('carla.secret@example.com'), false)
    assert.equal(exported.text.includes('nota interna que no debe salir'), false)
    assert.equal(exported.text.includes('evidencia interna que no debe salir'), false)
    assert.equal(exported.text.includes('pay-refund-export-21'), false)
  } finally {
    await server.close()
  }
})

test('refund export returns headers only for empty matches and rejects oversized exports without truncation', async () => {
  const empresaId = 'refund-export-emp-3'
  const slug = 'refund-export-3'
  const compradorId = 'refund-export-cmp-31'
  const eventoId = 'refund-export-evt-31'
  const categoriaId = 'refund-export-cat-31'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, nombre: 'Diego Empty', email: 'diego@example.com' })
  await seedEvento({ eventoId, empresaId, nombre: 'Festival Limitado' })
  await seedCategoria({ categoriaId, eventoId })

  for (const index of [1, 2]) {
    const sessionId = `refund-export-session-3${index}`
    await seedCheckoutSession({ sessionId, empresaId, compradorId, paymentId: `pay-refund-export-3${index}` })
    await seedRefundCase({
      caseId: `refund-export-case-3${index}`,
      empresaId,
      checkoutSessionId: sessionId,
      flow: 'entradas',
      status: 'requested',
      paymentId: `pay-refund-export-3${index}`,
      requestedAmount: 1200,
      requestReason: `Caso ${index}`,
      requestOrigin: 'company_manual',
      buyerActorId: compradorId,
      requestedEventId: eventoId,
      createdAt: `2026-05-18 0${index}:00:00`,
    })
  }

  const server = await createTestServer()

  try {
    const emptyExport = await requestText(`${server.baseUrl}/api/reembolsos/export?query=sin-coincidencias`, buildEmpresaUser(empresaId, slug))
    assert.equal(emptyExport.status, 200)
    assert.deepEqual(parseCsv(emptyExport.text).rows, [])

    process.env.REFUND_MANUAL_EXPORT_MAX_ROWS = '1'
    const oversized = await requestJson(`${server.baseUrl}/api/reembolsos/export`, buildEmpresaUser(empresaId, slug))
    assert.equal(oversized.status, 413)
    assert.equal((oversized.data as any).code, 'export_limit_exceeded')
    assert.equal((oversized.data as any).limit, 1)
    assert.equal((oversized.data as any).total, 2)
  } finally {
    await server.close()
  }
})

test('refund export denies actors without dashboard access and never returns csv to unauthorized callers', async () => {
  const empresaId = 'refund-export-emp-4'
  const slug = 'refund-export-4'
  const empleadoId = 'refund-export-emp-user-4'
  const compradorId = 'refund-export-cmp-41'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, nombre: 'Eva No Access', email: 'eva@example.com' })
  await seedEmpleado({ empleadoId, empresaId, permisos: { exportar: true, gestionar_consumibles: true } })

  const server = await createTestServer()

  try {
    const empleado = await requestText(`${server.baseUrl}/api/reembolsos/export`, buildEmpleadoUser(empleadoId, empresaId, slug, { exportar: true, gestionar_consumibles: true }))
    assert.equal(empleado.status, 403)
    assert.equal(empleado.headers.get('content-type')?.includes('text/csv'), false)

    const comprador = await requestText(`${server.baseUrl}/api/reembolsos/export`, buildCompradorUser(compradorId, empresaId, slug))
    assert.equal(comprador.status, 403)
    assert.equal(comprador.headers.get('content-type')?.includes('text/csv'), false)
  } finally {
    await server.close()
  }
})
