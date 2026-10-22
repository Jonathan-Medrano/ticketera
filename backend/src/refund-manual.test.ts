import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { PaymentRefund } from 'mercadopago'
process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'
process.env.PAYMENT_ACCOUNTS_ENCRYPTION_KEY = process.env.PAYMENT_ACCOUNTS_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

import pool from './db'
import { upsertPaymentAccountByEmpresaId } from './lib/payment-accounts'
import { persistPlatformAllocations, resolvePlatformAllocations } from './lib/platform-profit-sharing'
import compradoresRouter from './routes/compradores'
import reembolsosRouter from './routes/reembolsos'
import tenantRouter from './routes/tenant'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch
const originalPaymentRefundTotal = PaymentRefund.prototype.total
const originalPaymentRefundCreate = (PaymentRefund.prototype as any).create

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

function buildEmpleadoUser(empleadoId: string, empresaId: string, slug: string) {
  return { id: empleadoId, email: `${empleadoId}@example.com`, userType: 'empleado' as const, empresa_id: empresaId, empresa_slug: slug, slug }
}

function buildCompradorUser(compradorId: string, empresaId: string, slug: string) {
  return { id: compradorId, email: `${compradorId}@example.com`, userType: 'comprador' as const, empresa_id: empresaId, empresa_slug: slug, slug }
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

async function requestJson(method: 'GET' | 'POST' | 'PATCH', url: string, user: Record<string, unknown>, body?: unknown) {
  const response = await originalFetch(url, {
    method,
    headers: buildHeaders(user),
    body: body ? JSON.stringify(body) : undefined,
  })

  const data = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function seedEmpresa({ empresaId, slug }: { empresaId: string; slug: string }) {
  await pool.query(
    `INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
     VALUES (?, ?, ?, ?, ?, ?, true)`,
    [empresaId, `Empresa ${slug}`, slug, `${slug}@example.com`, TEST_PASSWORD_HASH, `Admin ${slug}`]
  )
}

async function seedEmpleado({ empleadoId, empresaId }: { empleadoId: string; empresaId: string }) {
  await pool.query(
    `INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, permisos, activo)
     VALUES (?, ?, 'Em', 'Pleado', ?, ?, 'owner', ?, true)`,
    [empleadoId, empresaId, `${empleadoId}@example.com`, TEST_PASSWORD_HASH, JSON.stringify({ ver_dashboard: true })]
  )
}

async function seedComprador({ compradorId, empresaId }: { compradorId: string; empresaId: string }) {
  await pool.query(
    `INSERT INTO compradores (id, empresa_id, nombre, email, dni, password)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [compradorId, empresaId, `Comprador ${compradorId}`, `${compradorId}@example.com`, `dni-${compradorId.slice(-16)}`, TEST_PASSWORD_HASH]
  )
}

async function seedConfirmedTicketSession(input: {
  sessionId: string
  empresaId: string
  compradorId: string
}) {
  await pool.query(
    `INSERT INTO checkout_sessions
     (id, comprador_id, empresa_id, datos, estado, payment_id, payment_status, reconciliation_status, confirmed_at, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'confirmada', 'mp-pay-1', 'approved', 'reconciled', NOW(), NOW() + INTERVAL '10 minutes', NOW())`,
    [
      input.sessionId,
      input.compradorId,
      input.empresaId,
      JSON.stringify({
        items: [{
          categoriaId: 'refund-phase1-cat-1',
          eventoId: 'refund-phase1-evt-1',
          eventoNombre: 'Evento Refund',
          categoriaNombre: 'General',
          precio: 1500,
          cantidad: 2,
        }],
        marketplaceFee: { amount: 100, currency: 'ARS' },
      }),
    ]
  )
}

async function seedConfirmedConsumablesSession(input: {
  sessionId: string
  empresaId: string
  compradorId: string
}) {
  await pool.query(
    `INSERT INTO checkout_sessions
     (id, comprador_id, empresa_id, datos, estado, payment_id, payment_status, reconciliation_status, confirmed_at, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'confirmada', 'mp-pay-cons-1', 'approved', 'reconciled', NOW(), NOW() + INTERVAL '10 minutes', NOW())`,
    [
      input.sessionId,
      input.compradorId,
      input.empresaId,
      JSON.stringify({
        flow: 'consumibles',
        items: [{ consumibleId: 'refund-phase2-cons-1', nombre: 'Agua', precio: 300, cantidad: 2 }],
        marketplaceFee: { amount: 50, currency: 'ARS' },
      }),
    ]
  )
}

async function seedEventoConCategoria(input: {
  eventoId: string
  empresaId: string
  categoriaId: string
  precio?: number
}) {
  await pool.query(
    `INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo)
     VALUES (?, ?, ?, NULL, NULL, 'unica', NULL, true)`,
    [input.eventoId, input.empresaId, `Evento ${input.eventoId}`]
  )

  await pool.query(
    `INSERT INTO entrada_categorias (id, evento_id, tanda_id, nombre, descripcion, precio, stock, stock_disponible, activa)
     VALUES (?, ?, NULL, ?, NULL, ?, 10, 10, true)`,
    [input.categoriaId, input.eventoId, `Categoria ${input.categoriaId}`, input.precio ?? 1500]
  )
}

async function seedEntrada(input: {
  entradaId: string
  eventoId: string
  categoriaId: string
  compradorId: string
  estado: 'valida' | 'usada' | 'cancelada'
  precio?: number
}) {
  await pool.query(
    `INSERT INTO entradas (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado, precio_pagado, comision, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      input.entradaId,
      input.eventoId,
      input.categoriaId,
      input.compradorId,
      `qr-${input.entradaId}`,
      `KEY-${input.entradaId}`,
      input.estado,
      input.precio ?? 1500,
      225,
    ]
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
  ventaEstado: 'pendiente' | 'canjeado' | 'cancelado'
  stockActual?: number
}) {
  await pool.query(`ALTER TABLE consumibles_ventas ADD COLUMN IF NOT EXISTS comprador_id varchar(36) DEFAULT NULL`)
  await pool.query(`ALTER TABLE consumibles_ventas ADD COLUMN IF NOT EXISTS checkout_session_id varchar(80) DEFAULT NULL`)
  await pool.query(`ALTER TABLE consumibles_ventas ADD COLUMN IF NOT EXISTS origen varchar(40) NOT NULL DEFAULT 'manual'`)

  await pool.query(
    `INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo)
     VALUES (?, ?, ?, NULL, NULL, 'unica', NULL, true)`,
    [input.eventoId, input.empresaId, `Evento ${input.eventoId}`]
  )

  await pool.query(
    `INSERT INTO barras (id, evento_id, empresa_id, nombre, activa)
     VALUES (?, ?, ?, ?, true)`,
    [input.barraId, input.eventoId, input.empresaId, `Barra ${input.barraId}`]
  )

  await pool.query(
    `INSERT INTO consumibles (id, empresa_id, nombre, descripcion, precio, activo)
     VALUES (?, ?, ?, NULL, 300, true)`,
    [input.consumibleId, input.empresaId, `Consumible ${input.consumibleId}`]
  )

  await pool.query(
    `INSERT INTO barra_stock (id, barra_id, consumible_id, stock_inicial, stock_actual, precio_override, activo)
     VALUES (?, ?, ?, 10, ?, NULL, true)`,
    [`stock-${input.ventaId}`, input.barraId, input.consumibleId, input.stockActual ?? 8]
  )

  await pool.query(
    `INSERT INTO consumibles_ventas
     (id, barra_id, evento_id, empresa_id, comprador_id, checkout_session_id, origen, qr_code, clave_corta, total, estado)
     VALUES (?, ?, ?, ?, ?, ?, 'tenant_publico', ?, ?, 600, ?)`,
    [
      input.ventaId,
      input.barraId,
      input.eventoId,
      input.empresaId,
      input.compradorId,
      input.checkoutSessionId,
      `qr-${input.ventaId}`,
      `CV${input.ventaId.slice(-6).replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`,
      input.ventaEstado,
    ]
  )

  await pool.query(
    `INSERT INTO consumibles_venta_items (id, venta_id, consumible_id, nombre_snapshot, precio_unitario, cantidad, subtotal)
     VALUES (?, ?, ?, 'Agua', 300, 2, 600)`,
    [`item-${input.ventaId}`, input.ventaId, input.consumibleId]
  )
}

function buildTestApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/reembolsos', reembolsosRouter)
  app.use('/api/compradores', compradoresRouter)
  return app
}

function buildTenantTestApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  app.use('/api/reembolsos', reembolsosRouter)
  return app
}

async function enableBuyerRefundsForEmpresa(empresaId: string) {
  await pool.query(`UPDATE empresas SET buyer_event_refunds_enabled = true WHERE id = ?`, [empresaId])
}

async function enableBuyerRefundsForEvento(eventoId: string) {
  await pool.query(`UPDATE eventos SET buyer_event_refunds_enabled = true WHERE id = ?`, [eventoId])
}

async function seedEntryCheckoutAllocation(input: { entradaId: string; empresaId: string; sessionId: string }) {
  await pool.query(
    `INSERT INTO platform_sale_allocations
     (id, source_type, source_id, checkout_session_id, empresa_id, flow, currency, owner_fee_amount, allocated_amount, allocation_percentage, configured_platform_admin_user_id, effective_platform_admin_user_id, fallback_reason)
     VALUES (?, 'entrada', ?, ?, ?, 'entradas', 'ARS', 0, 0, 0, 'refund-phase-platform-config', 'refund-phase-platform-effective', 'none')`,
    [`alloc-${input.entradaId}`, input.entradaId, input.sessionId, input.empresaId]
  )
}

async function markPaymentAccountReady(empresaId: string) {
  await pool.query(
    `UPDATE empresa_payment_accounts
     SET status = 'ready_to_sell', reason = NULL, validated_at = NOW(), last_validation_error = NULL, blocked_at = NULL
     WHERE empresa_id = ?`,
    [empresaId]
  )
}

async function cleanup() {
  await pool.query(`
    DELETE FROM refund_manual_case_events
    WHERE case_id IN (SELECT id FROM refund_manual_cases WHERE empresa_id LIKE 'refund-phase%')
   `)
  await pool.query(`
    DELETE FROM refund_manual_case_items
    WHERE case_id IN (SELECT id FROM refund_manual_cases WHERE empresa_id LIKE 'refund-phase%')
  `)
  await pool.query(`DELETE FROM refund_manual_cases WHERE id LIKE 'refund-phase%' OR empresa_id LIKE 'refund-phase%' OR checkout_session_id LIKE 'refund-phase%'`)
  await pool.query(`DELETE FROM platform_sale_allocations WHERE empresa_id LIKE 'refund-phase%' OR checkout_session_id LIKE 'refund-phase%' OR reversal_reference_id LIKE 'refund-phase%'`)
  await pool.query(`DELETE FROM consumibles_venta_items WHERE id LIKE 'item-refund-phase%' OR venta_id LIKE 'refund-phase%' OR consumible_id LIKE 'refund-phase%'`)
  await pool.query(`DELETE FROM consumibles_ventas WHERE id LIKE 'refund-phase%' OR empresa_id LIKE 'refund-phase%' OR comprador_id LIKE 'refund-phase%' OR checkout_session_id LIKE 'refund-phase%'`)
  await pool.query(`DELETE FROM barra_stock WHERE id LIKE 'stock-refund-phase%' OR barra_id LIKE 'refund-phase%' OR consumible_id LIKE 'refund-phase%'`)
  await pool.query(`DELETE FROM consumibles WHERE id LIKE 'refund-phase%' OR empresa_id LIKE 'refund-phase%'`)
  await pool.query(`DELETE FROM barras WHERE id LIKE 'refund-phase%' OR empresa_id LIKE 'refund-phase%'`)
  await pool.query(`DELETE FROM empresa_payment_accounts WHERE empresa_id LIKE 'refund-phase%'`)
  await pool.query(`DELETE FROM entradas WHERE id LIKE 'refund-phase%' OR evento_id LIKE 'refund-phase%' OR comprador_id LIKE 'refund-phase%'`)
  await pool.query(`DELETE FROM checkout_sessions WHERE id LIKE 'refund-phase%' OR empresa_id LIKE 'refund-phase%' OR comprador_id LIKE 'refund-phase%'`)
  await pool.query(`DELETE FROM entrada_categorias WHERE id LIKE 'refund-phase%' OR evento_id LIKE 'refund-phase%'`)
  await pool.query(`DELETE FROM evento_fechas WHERE evento_id LIKE 'refund-phase%'`)
  await pool.query(`DELETE FROM evento_tandas WHERE evento_id LIKE 'refund-phase%'`)
  await pool.query(`DELETE FROM eventos WHERE id LIKE 'refund-phase%' OR empresa_id LIKE 'refund-phase%'`)
  await pool.query(`DELETE FROM compradores WHERE id LIKE 'refund-phase%' OR empresa_id LIKE 'refund-phase%'`)
  await pool.query(`DELETE FROM usuarios WHERE id LIKE 'refund-phase%' OR empresa_id LIKE 'refund-phase%'`)
  await pool.query(`DELETE FROM empresas WHERE id LIKE 'refund-phase%' OR slug LIKE 'refund-phase%'`)
}

beforeEach(async () => {
  PaymentRefund.prototype.total = originalPaymentRefundTotal
  ;(PaymentRefund.prototype as any).create = originalPaymentRefundCreate
  await cleanup()
})

after(async () => {
  PaymentRefund.prototype.total = originalPaymentRefundTotal
  ;(PaymentRefund.prototype as any).create = originalPaymentRefundCreate
  await cleanup()
  await pool.end()
})

test('manual refund creates a requested case from a confirmed checkout session and records initial audit event', async () => {
  const empresaId = 'refund-phase1-emp-1'
  const compradorId = 'refund-phase1-cmp-1'
  const sessionId = 'refund-phase1-session-1'
  const slug = 'refund-phase1-1'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedTicketSession({ sessionId, empresaId, compradorId })

  const server = await createTestServer(buildTestApp())

  try {
    const created = await requestJson('POST', `${server.baseUrl}/api/reembolsos`, buildEmpresaUser(empresaId, slug), {
      checkout_session_id: sessionId,
      reason: 'Comprador pidió devolución manual',
      note: 'Caso QA PR1',
      external_refund_reference: 'ext-ref-1',
    })

    assert.equal(created.status, 201)
    assert.equal((created.data as any).case.status, 'requested')
    assert.equal((created.data as any).case.flow, 'entradas')
    assert.equal((created.data as any).purchase_context.checkout_session_id, sessionId)
    assert.equal((created.data as any).purchase_context.requested_amount, 3000)
    assert.equal((created.data as any).events.length, 1)
    assert.equal((created.data as any).events[0].event_type, 'case_requested')

    const list = await requestJson('GET', `${server.baseUrl}/api/reembolsos`, buildEmpresaUser(empresaId, slug))
    assert.equal(list.status, 200)
    assert.equal((list.data as any).data.cases.length, 1)
    assert.equal((list.data as any).data.cases[0].checkout_session_id, sessionId)

    const detail = await requestJson('GET', `${server.baseUrl}/api/reembolsos/${(created.data as any).case.id}`, buildEmpresaUser(empresaId, slug))
    assert.equal(detail.status, 200)
    assert.equal((detail.data as any).case.request_reason, 'Comprador pidió devolución manual')
    assert.equal((detail.data as any).purchase_context.payment_status, 'approved')
  } finally {
    await server.close()
  }
})

test('manual refund rejects orphan checkout sessions', async () => {
  const empresaId = 'refund-phase1-emp-2'
  const slug = 'refund-phase1-2'

  await seedEmpresa({ empresaId, slug })

  const server = await createTestServer(buildTestApp())

  try {
    const response = await requestJson('POST', `${server.baseUrl}/api/reembolsos`, buildEmpresaUser(empresaId, slug), {
      checkout_session_id: 'refund-phase1-missing-session',
      reason: 'No existe',
    })

    assert.equal(response.status, 404)
    assert.equal((response.data as any).error, 'La compra original no existe')
  } finally {
    await server.close()
  }
})

test('employees with dashboard access can list and inspect cases but cannot create them in phase 1', async () => {
  const empresaId = 'refund-phase1-emp-3'
  const empleadoId = 'refund-phase1-user-3'
  const compradorId = 'refund-phase1-cmp-3'
  const sessionId = 'refund-phase1-session-3'
  const slug = 'refund-phase1-3'

  await seedEmpresa({ empresaId, slug })
  await seedEmpleado({ empleadoId, empresaId })
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedTicketSession({ sessionId, empresaId, compradorId })

  const server = await createTestServer(buildTestApp())

  try {
    const created = await requestJson('POST', `${server.baseUrl}/api/reembolsos`, buildEmpresaUser(empresaId, slug), {
      checkout_session_id: sessionId,
      reason: 'Crear caso base',
    })

    const employeeCreate = await requestJson('POST', `${server.baseUrl}/api/reembolsos`, buildEmpleadoUser(empleadoId, empresaId, slug), {
      checkout_session_id: sessionId,
      reason: 'Empleado no puede crear en fase 1',
    })
    assert.equal(employeeCreate.status, 403)
    assert.equal((employeeCreate.data as any).error, 'Solo la empresa puede crear casos de reembolso por ahora')

    const list = await requestJson('GET', `${server.baseUrl}/api/reembolsos`, buildEmpleadoUser(empleadoId, empresaId, slug))
    assert.equal(list.status, 200)
    assert.equal((list.data as any).data.cases.length, 1)

    const detail = await requestJson('GET', `${server.baseUrl}/api/reembolsos/${(created.data as any).case.id}`, buildEmpleadoUser(empleadoId, empresaId, slug))
    assert.equal(detail.status, 200)
    assert.equal((detail.data as any).case.id, (created.data as any).case.id)
  } finally {
    await server.close()
  }
})

test('manual refund links ticket items, approves execution and cancels linked entradas safely', async () => {
  const empresaId = 'refund-phase2-emp-1'
  const compradorId = 'refund-phase2-cmp-1'
  const sessionId = 'refund-phase2-session-1'
  const eventoId = 'refund-phase2-evt-1'
  const categoriaId = 'refund-phase2-cat-1'
  const entradaId = 'refund-phase2-ent-1'
  const slug = 'refund-phase2-1'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedTicketSession({ sessionId, empresaId, compradorId })
  await seedEventoConCategoria({ empresaId, eventoId, categoriaId })
  await seedEntrada({ entradaId, eventoId, categoriaId, compradorId, estado: 'valida' })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-REFUND-PHASE2-1111' })
  await markPaymentAccountReady(empresaId)
  ;(PaymentRefund.prototype as any).create = async function () {
    return {
      id: 9001,
      payment_id: sessionId,
      amount: 1500,
      status: 'approved',
    } as any
  }

  const server = await createTestServer(buildTestApp())

  try {
    const created = await requestJson('POST', `${server.baseUrl}/api/reembolsos`, buildEmpresaUser(empresaId, slug), {
      checkout_session_id: sessionId,
      reason: 'Refund manual asistido tickets',
    })

    const caseId = (created.data as any).case.id
    const compras = await requestJson('GET', `${server.baseUrl}/api/compradores/${compradorId}/compras`, buildEmpresaUser(empresaId, slug))

    assert.equal(compras.status, 200)
    assert.equal((compras.data as any)[0].id, entradaId)
    assert.equal((compras.data as any)[0].categoria_id, categoriaId)
    assert.equal((compras.data as any)[0].evento_id, eventoId)
    assert.ok(String((compras.data as any)[0].clave_corta).startsWith('KEY-refund-phase2'))

    const linked = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${caseId}/items`, buildEmpresaUser(empresaId, slug), {
      items: [{ target_type: 'entrada', target_id: entradaId }],
    })

    assert.equal(linked.status, 200)
    assert.equal((linked.data as any).case.status, 'under_review')
    assert.equal((linked.data as any).items.length, 1)
    assert.equal((linked.data as any).items[0].eligibility, 'elegible')
    assert.equal((linked.data as any).items[0].target_status_before, 'valida')

    const executed = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${caseId}/execute`, buildEmpresaUser(empresaId, slug), {})

    assert.equal(executed.status, 200)
    assert.equal((executed.data as any).case.status, 'executed')
    assert.equal((executed.data as any).case.external_refund_reference, '9001')
    assert.equal((executed.data as any).items[0].target_status_after, 'cancelada')
    assert.ok((executed.data as any).events.some((event: any) => event.event_type === 'case_executed'))
    assert.match((executed.data as any).case.evidence_note, /reembolso automático en mercado pago/i)

    const [entryRows] = await pool.query<any[]>(`SELECT estado FROM entradas WHERE id = ?`, [entradaId])
    assert.equal(entryRows[0].estado, 'cancelada')
  } finally {
    await server.close()
  }
})

test('automatic Mercado Pago refund failure keeps the case approved and does not cancel entries', async () => {
  const empresaId = 'refund-phase2-emp-1b'
  const compradorId = 'refund-phase2-cmp-1b'
  const sessionId = 'refund-phase2-session-1b'
  const eventoId = 'refund-phase2-evt-1b'
  const categoriaId = 'refund-phase2-cat-1b'
  const entradaId = 'refund-phase2-ent-1b'
  const slug = 'refund-phase2-1b'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedTicketSession({ sessionId, empresaId, compradorId })
  await seedEventoConCategoria({ empresaId, eventoId, categoriaId })
  await seedEntrada({ entradaId, eventoId, categoriaId, compradorId, estado: 'valida' })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-REFUND-PHASE2-2222' })
  await markPaymentAccountReady(empresaId)
  ;(PaymentRefund.prototype as any).create = async function () {
    const error = new Error('payment already refunded') as Error & { status?: number }
    error.status = 400
    throw error
  }

  const server = await createTestServer(buildTestApp())

  try {
    const created = await requestJson('POST', `${server.baseUrl}/api/reembolsos`, buildEmpresaUser(empresaId, slug), {
      checkout_session_id: sessionId,
      reason: 'Refund automático fallido',
    })

    const caseId = (created.data as any).case.id
    await requestJson('POST', `${server.baseUrl}/api/reembolsos/${caseId}/items`, buildEmpresaUser(empresaId, slug), {
      items: [{ target_type: 'entrada', target_id: entradaId }],
    })
    const executed = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${caseId}/execute`, buildEmpresaUser(empresaId, slug), {})
    assert.equal(executed.status, 409)
    assert.equal((executed.data as any).error, 'payment already refunded')

    const detail = await requestJson('GET', `${server.baseUrl}/api/reembolsos/${caseId}`, buildEmpresaUser(empresaId, slug))
    assert.equal((detail.data as any).case.status, 'under_review')

    const [entryRows] = await pool.query<any[]>(`SELECT estado FROM entradas WHERE id = ?`, [entradaId])
    assert.equal(entryRows[0].estado, 'valida')
  } finally {
    await server.close()
  }
})

test('refund execution auto-rejects when the payment already has redeemed items before calling Mercado Pago', async () => {
  const empresaId = 'refund-phase2-emp-guard-1'
  const compradorId = 'refund-phase2-cmp-guard-1'
  const sessionId = 'refund-phase2-session-guard-1'
  const eventoId = 'refund-phase2-evt-guard-1'
  const categoriaId = 'refund-phase2-cat-guard-1'
  const entradaId = 'refund-phase2-ent-guard-1'
  const slug = 'refund-phase2-guard-1'
  let refundCalls = 0

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedTicketSession({ sessionId, empresaId, compradorId })
  await seedEventoConCategoria({ empresaId, eventoId, categoriaId })
  await seedEntrada({ entradaId, eventoId, categoriaId, compradorId, estado: 'valida' })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-REFUND-PHASE2-GUARD-1' })
  await markPaymentAccountReady(empresaId)
  ;(PaymentRefund.prototype as any).create = async function () {
    refundCalls += 1
    return { id: 9010, payment_id: sessionId, amount: 1500, status: 'approved' } as any
  }

  const server = await createTestServer(buildTestApp())

  try {
    const created = await requestJson('POST', `${server.baseUrl}/api/reembolsos`, buildEmpresaUser(empresaId, slug), {
      checkout_session_id: sessionId,
      reason: 'Refund con entrada canjeada después de aprobar',
    })

    const caseId = (created.data as any).case.id
    await requestJson('POST', `${server.baseUrl}/api/reembolsos/${caseId}/items`, buildEmpresaUser(empresaId, slug), {
      items: [{ target_type: 'entrada', target_id: entradaId }],
    })
    await requestJson('POST', `${server.baseUrl}/api/reembolsos/${caseId}/approve`, buildEmpresaUser(empresaId, slug), {
      reason: 'Aprobado antes de detectar el canje',
    })

    await pool.query(`UPDATE entradas SET estado = 'usada' WHERE id = ?`, [entradaId])

    const executed = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${caseId}/execute`, buildEmpresaUser(empresaId, slug), {})

    assert.equal(executed.status, 200)
    assert.equal((executed.data as any).case.status, 'rejected')
    assert.equal(refundCalls, 0)
    assert.match((executed.data as any).case.evidence_note, /entrada .* está en estado usada/i)

    const rejectionEvent = (executed.data as any).events.find((event: any) => event.event_type === 'case_rejected')
    assert.ok(rejectionEvent)
    assert.equal(rejectionEvent.payload.reason, 'Rechazo automático: entrada ya fue redimida')
    assert.match(rejectionEvent.payload.note, /estado usada/i)

    const [entryRows] = await pool.query<any[]>(`SELECT estado FROM entradas WHERE id = ?`, [entradaId])
    assert.equal(entryRows[0].estado, 'usada')
  } finally {
    await server.close()
  }
})

test('refund execution allows different entries from the same payment to be refunded independently', async () => {
  const empresaId = 'refund-phase2-emp-guard-2'
  const compradorId = 'refund-phase2-cmp-guard-2'
  const sessionId = 'refund-phase2-session-guard-2'
  const eventoId = 'refund-phase2-evt-guard-2'
  const categoriaId = 'refund-phase2-cat-guard-2'
  const entradaAId = 'refund-phase2-entry-guard-2a'
  const entradaBId = 'refund-phase2-entry-guard-2z'
  const slug = 'refund-phase2-guard-2'
  let refundCalls = 0

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedTicketSession({ sessionId, empresaId, compradorId })
  await seedEventoConCategoria({ empresaId, eventoId, categoriaId })
  await seedEntrada({ entradaId: entradaAId, eventoId, categoriaId, compradorId, estado: 'valida' })
  await pool.query(
    `INSERT INTO entradas (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado, precio_pagado, comision, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'valida', 1500, 225, NOW())`,
    [entradaBId, eventoId, categoriaId, compradorId, `qr-${entradaBId}`, 'KEY-GUARD-2B']
  )
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-REFUND-PHASE2-GUARD-2' })
  await markPaymentAccountReady(empresaId)
  const refundCreatePayloads: any[] = []
  ;(PaymentRefund.prototype as any).create = async function (payload: any) {
    refundCalls += 1
    refundCreatePayloads.push(payload)
    return { id: 9011, payment_id: sessionId, amount: 1500, status: 'approved' } as any
  }

  const server = await createTestServer(buildTestApp())

  try {
    const firstCreated = await requestJson('POST', `${server.baseUrl}/api/reembolsos`, buildEmpresaUser(empresaId, slug), {
      checkout_session_id: sessionId,
      reason: 'Primer refund del payment',
    })

    const firstCaseId = (firstCreated.data as any).case.id
    await requestJson('POST', `${server.baseUrl}/api/reembolsos/${firstCaseId}/items`, buildEmpresaUser(empresaId, slug), {
      items: [{ target_type: 'entrada', target_id: entradaAId }],
    })
    await requestJson('POST', `${server.baseUrl}/api/reembolsos/${firstCaseId}/approve`, buildEmpresaUser(empresaId, slug), {
      reason: 'Aprobado primer refund',
    })

    const firstExecuted = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${firstCaseId}/execute`, buildEmpresaUser(empresaId, slug), {})
    assert.equal(firstExecuted.status, 200)
    assert.equal((firstExecuted.data as any).case.status, 'executed')
    assert.equal(refundCalls, 1)
    assert.equal(refundCreatePayloads[0].payment_id, 'mp-pay-1')
    assert.equal(refundCreatePayloads[0].body.amount, 1500)

    const [firstEntryRows] = await pool.query<any[]>(`SELECT estado FROM entradas WHERE id = ?`, [entradaAId])
    const [otherEntryRows] = await pool.query<any[]>(`SELECT estado FROM entradas WHERE id = ?`, [entradaBId])
    assert.equal(firstEntryRows[0].estado, 'cancelada')
    assert.equal(otherEntryRows[0].estado, 'valida')

    const secondCreated = await requestJson('POST', `${server.baseUrl}/api/reembolsos`, buildEmpresaUser(empresaId, slug), {
      checkout_session_id: sessionId,
      reason: 'Segundo refund para otra entrada del mismo payment',
    })

    const secondCaseId = (secondCreated.data as any).case.id
    await requestJson('POST', `${server.baseUrl}/api/reembolsos/${secondCaseId}/items`, buildEmpresaUser(empresaId, slug), {
      items: [{ target_type: 'entrada', target_id: entradaBId }],
    })
    await requestJson('POST', `${server.baseUrl}/api/reembolsos/${secondCaseId}/approve`, buildEmpresaUser(empresaId, slug), {
      reason: 'Aprobado duplicado',
    })

    const secondExecuted = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${secondCaseId}/execute`, buildEmpresaUser(empresaId, slug), {})

    assert.equal(secondExecuted.status, 200)
    assert.equal((secondExecuted.data as any).case.status, 'executed')
    assert.equal(refundCalls, 2)
    assert.equal(refundCreatePayloads[1].payment_id, 'mp-pay-1')
    assert.equal(refundCreatePayloads[1].body.amount, 1500)

    const [secondEntryRows] = await pool.query<any[]>(`SELECT estado FROM entradas WHERE id = ?`, [entradaBId])
    assert.equal(secondEntryRows[0].estado, 'cancelada')
  } finally {
    await server.close()
  }
})

test('refund execution still protects the same exact entry from duplicate executed refunds', async () => {
  const empresaId = 'refund-phase2-emp-guard-3'
  const compradorId = 'refund-phase2-cmp-guard-3'
  const sessionId = 'refund-phase2-session-guard-3'
  const eventoId = 'refund-phase2-evt-guard-3'
  const categoriaId = 'refund-phase2-cat-guard-3'
  const entradaId = 'refund-phase2-entry-guard-3'
  const slug = 'refund-phase2-guard-3'
  let refundCalls = 0

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedTicketSession({ sessionId, empresaId, compradorId })
  await seedEventoConCategoria({ empresaId, eventoId, categoriaId })
  await seedEntrada({ entradaId, eventoId, categoriaId, compradorId, estado: 'valida' })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-REFUND-PHASE2-GUARD-3' })
  await markPaymentAccountReady(empresaId)
  ;(PaymentRefund.prototype as any).create = async function () {
    refundCalls += 1
    return { id: 9012, payment_id: sessionId, amount: 1500, status: 'approved' } as any
  }

  const server = await createTestServer(buildTestApp())

  try {
    const firstCreated = await requestJson('POST', `${server.baseUrl}/api/reembolsos`, buildEmpresaUser(empresaId, slug), {
      checkout_session_id: sessionId,
      reason: 'Primer refund de la entrada',
    })

    const firstCaseId = (firstCreated.data as any).case.id
    await requestJson('POST', `${server.baseUrl}/api/reembolsos/${firstCaseId}/items`, buildEmpresaUser(empresaId, slug), {
      items: [{ target_type: 'entrada', target_id: entradaId }],
    })
    await requestJson('POST', `${server.baseUrl}/api/reembolsos/${firstCaseId}/approve`, buildEmpresaUser(empresaId, slug), {
      reason: 'Aprobado primer refund',
    })

    const firstExecuted = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${firstCaseId}/execute`, buildEmpresaUser(empresaId, slug), {})
    assert.equal(firstExecuted.status, 200)
    assert.equal((firstExecuted.data as any).case.status, 'executed')
    assert.equal(refundCalls, 1)

    await pool.query(`UPDATE entradas SET estado = 'valida' WHERE id = ?`, [entradaId])

    const secondCreated = await requestJson('POST', `${server.baseUrl}/api/reembolsos`, buildEmpresaUser(empresaId, slug), {
      checkout_session_id: sessionId,
      reason: 'Segundo refund sobre la misma entrada',
    })

    const secondCaseId = (secondCreated.data as any).case.id
    await requestJson('POST', `${server.baseUrl}/api/reembolsos/${secondCaseId}/items`, buildEmpresaUser(empresaId, slug), {
      items: [{ target_type: 'entrada', target_id: entradaId }],
    })
    await requestJson('POST', `${server.baseUrl}/api/reembolsos/${secondCaseId}/approve`, buildEmpresaUser(empresaId, slug), {
      reason: 'Aprobado duplicado exacto',
    })

    const secondExecuted = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${secondCaseId}/execute`, buildEmpresaUser(empresaId, slug), {})

    assert.equal(secondExecuted.status, 200)
    assert.equal((secondExecuted.data as any).case.status, 'rejected')
    assert.equal(refundCalls, 1)
    assert.match((secondExecuted.data as any).case.evidence_note, /entrada .* ya tiene un reembolso ejecutado en el caso/i)

    const rejectionEvent = (secondExecuted.data as any).events.find((event: any) => event.event_type === 'case_rejected')
    assert.ok(rejectionEvent)
    assert.equal(rejectionEvent.payload.reason, 'Rechazo automático: entrada ya tiene un reembolso ejecutado')
    assert.match(rejectionEvent.payload.note, new RegExp(firstCaseId))
  } finally {
    await server.close()
  }
})

test('manual refund creates allocation reversals for refunded entradas without losing audit trail', async () => {
  const empresaId = 'refund-phase2-emp-rev-1'
  const compradorId = 'refund-phase2-cmp-rev-1'
  const sessionId = 'refund-phase2-session-rev-1'
  const eventoId = 'refund-phase2-evt-rev-1'
  const categoriaId = 'refund-phase2-cat-rev-1'
  const entradaId = 'refund-phase2-ent-rev-1'
  const slug = 'refund-phase2-rev-1'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedTicketSession({ sessionId, empresaId, compradorId })
  await seedEventoConCategoria({ empresaId, eventoId, categoriaId })
  await seedEntrada({ entradaId, eventoId, categoriaId, compradorId, estado: 'valida' })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-REFUND-PHASE2-3333' })
  await markPaymentAccountReady(empresaId)
  ;(PaymentRefund.prototype as any).create = async function () {
    return {
      id: 9002,
      payment_id: sessionId,
      amount: 1500,
      status: 'approved',
    } as any
  }

  await persistPlatformAllocations(await resolvePlatformAllocations({
    flow: 'entradas',
    totalOwnerFeeAmount: 100,
    currency: 'ARS',
    sales: [{
      sourceType: 'entrada',
      sourceId: entradaId,
      amountWeight: 1500,
      checkoutSessionId: sessionId,
      empresaId,
    }],
  }))

  const server = await createTestServer(buildTestApp())

  try {
    const created = await requestJson('POST', `${server.baseUrl}/api/reembolsos`, buildEmpresaUser(empresaId, slug), {
      checkout_session_id: sessionId,
      reason: 'Refund ticket con reverso profit sharing',
    })

    const caseId = (created.data as any).case.id

    await requestJson('POST', `${server.baseUrl}/api/reembolsos/${caseId}/items`, buildEmpresaUser(empresaId, slug), {
      items: [{ target_type: 'entrada', target_id: entradaId }],
    })
    await requestJson('POST', `${server.baseUrl}/api/reembolsos/${caseId}/approve`, buildEmpresaUser(empresaId, slug), {
      reason: 'Aprobado para reversar allocations',
    })

    const executed = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${caseId}/execute`, buildEmpresaUser(empresaId, slug), {
      external_refund_reference: 'refund-phase2-bank-rev-1',
    })

    assert.equal(executed.status, 200)

    const [allocationRows] = await pool.query<any[]>(
      `SELECT id, entry_kind, allocated_amount, reversal_for_allocation_id, reversal_reason, reversal_reference_type, reversal_reference_id
       FROM platform_sale_allocations
       WHERE source_type = 'entrada' AND source_id = ?
       ORDER BY entry_kind ASC, created_at ASC, id ASC`,
      [entradaId]
    )

    assert.equal(allocationRows.length, 2)
    assert.equal(allocationRows[0].entry_kind, 'allocation')
    assert.equal(allocationRows[1].entry_kind, 'reversal')
    assert.equal(Number(allocationRows[1].allocated_amount), -Number(allocationRows[0].allocated_amount))
    assert.equal(allocationRows[1].reversal_for_allocation_id, allocationRows[0].id)
    assert.equal(allocationRows[1].reversal_reason, 'manual_refund_executed')
    assert.equal(allocationRows[1].reversal_reference_type, 'refund_manual_case')
    assert.equal(allocationRows[1].reversal_reference_id, caseId)
  } finally {
    await server.close()
  }
})

test('manual refund blocks approval when a linked entrada is already used', async () => {
  const empresaId = 'refund-phase2-emp-2'
  const compradorId = 'refund-phase2-cmp-2'
  const sessionId = 'refund-phase2-session-2'
  const eventoId = 'refund-phase2-evt-2'
  const categoriaId = 'refund-phase2-cat-2'
  const entradaId = 'refund-phase2-ent-2'
  const slug = 'refund-phase2-2'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedTicketSession({ sessionId, empresaId, compradorId })
  await seedEventoConCategoria({ empresaId, eventoId, categoriaId })
  await seedEntrada({ entradaId, eventoId, categoriaId, compradorId, estado: 'usada' })

  const server = await createTestServer(buildTestApp())

  try {
    const created = await requestJson('POST', `${server.baseUrl}/api/reembolsos`, buildEmpresaUser(empresaId, slug), {
      checkout_session_id: sessionId,
      reason: 'Refund ticket usada',
    })

    const caseId = (created.data as any).case.id
    const linked = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${caseId}/items`, buildEmpresaUser(empresaId, slug), {
      items: [{ target_type: 'entrada', target_id: entradaId }],
    })

    assert.equal(linked.status, 200)
    assert.equal((linked.data as any).items[0].eligibility, 'bloqueado')
    assert.equal((linked.data as any).items[0].block_reason, 'entrada_usada')

    const approved = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${caseId}/approve`, buildEmpresaUser(empresaId, slug), {
      reason: 'No debería aprobar',
    })

    assert.equal(approved.status, 409)
    assert.equal((approved.data as any).error, `entrada ${entradaId} bloqueado: entrada_usada`)
  } finally {
    await server.close()
  }
})

test('manual refund rejects ticket cases only with evidence and preserves audit traceability', async () => {
  const empresaId = 'refund-phase2-emp-4'
  const compradorId = 'refund-phase2-cmp-4'
  const sessionId = 'refund-phase2-session-4'
  const eventoId = 'refund-phase2-evt-4'
  const categoriaId = 'refund-phase2-cat-4'
  const entradaId = 'refund-phase2-ent-4'
  const slug = 'refund-phase2-4'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedTicketSession({ sessionId, empresaId, compradorId })
  await seedEventoConCategoria({ empresaId, eventoId, categoriaId })
  await seedEntrada({ entradaId, eventoId, categoriaId, compradorId, estado: 'valida' })

  const server = await createTestServer(buildTestApp())

  try {
    const created = await requestJson('POST', `${server.baseUrl}/api/reembolsos`, buildEmpresaUser(empresaId, slug), {
      checkout_session_id: sessionId,
      reason: 'Refund ticket rechazable',
    })

    const caseId = (created.data as any).case.id

    const linked = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${caseId}/items`, buildEmpresaUser(empresaId, slug), {
      items: [{ target_type: 'entrada', target_id: entradaId }],
    })

    assert.equal(linked.status, 200)
    assert.equal((linked.data as any).case.status, 'under_review')

    const missingEvidence = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${caseId}/reject`, buildEmpresaUser(empresaId, slug), {
      reason: 'Se rechaza por revisión operativa',
    })

    assert.equal(missingEvidence.status, 400)
    assert.equal((missingEvidence.data as any).error, 'El rechazo manual requiere evidencia o referencia externa')

    const rejected = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${caseId}/reject`, buildEmpresaUser(empresaId, slug), {
      reason: 'Compra fuera de policy',
      note: 'Se revisó con soporte',
      evidence_note: 'Captura del intercambio con soporte',
      external_refund_reference: 'reject-audit-1',
    })

    assert.equal(rejected.status, 200)
    assert.equal((rejected.data as any).case.status, 'rejected')
    assert.equal((rejected.data as any).case.resolved_by, empresaId)
    assert.equal((rejected.data as any).case.evidence_note, 'Captura del intercambio con soporte')
    assert.equal((rejected.data as any).case.external_refund_reference, 'reject-audit-1')
    assert.ok((rejected.data as any).case.resolved_at)

    const rejectionEvent = (rejected.data as any).events.find((event: any) => event.event_type === 'case_rejected')
    assert.ok(rejectionEvent)
    assert.equal(rejectionEvent.payload.previous_status, 'under_review')
    assert.equal(rejectionEvent.payload.next_status, 'rejected')
    assert.equal(rejectionEvent.payload.reason, 'Compra fuera de policy')
    assert.equal(rejectionEvent.payload.note, 'Se revisó con soporte')
    assert.equal(rejectionEvent.payload.evidence_note, 'Captura del intercambio con soporte')
    assert.equal(rejectionEvent.payload.external_refund_reference, 'reject-audit-1')

    const [entryRows] = await pool.query<any[]>(`SELECT estado FROM entradas WHERE id = ?`, [entradaId])
    assert.equal(entryRows[0].estado, 'valida')
  } finally {
    await server.close()
  }
})

test('manual refund executes pending consumables cancellation with stock restitution and blocks redeemed sales', async () => {
  const empresaId = 'refund-phase2-emp-3'
  const compradorId = 'refund-phase2-cmp-3'
  const sessionId = 'refund-phase2-session-3'
  const eventoId = 'refund-phase2-evt-3'
  const barraId = 'refund-phase2-bar-3'
  const consumibleId = 'refund-phase2-cons-3'
  const ventaPendienteId = 'refund-phase2-sale-3'
  const ventaCanjeadaId = 'refund-phase2-sale-4'
  const slug = 'refund-phase2-3'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedConsumablesSession({ sessionId, empresaId, compradorId })
  await seedConsumiblesContext({
    empresaId,
    eventoId,
    barraId,
    consumibleId,
    ventaId: ventaPendienteId,
    checkoutSessionId: sessionId,
    compradorId,
    ventaEstado: 'pendiente',
    stockActual: 8,
  })
  await seedConsumiblesContext({
    empresaId,
    eventoId: 'refund-phase2-evt-4',
    barraId: 'refund-phase2-bar-4',
    consumibleId: 'refund-phase2-cons-4',
    ventaId: ventaCanjeadaId,
    checkoutSessionId: sessionId,
    compradorId,
    ventaEstado: 'canjeado',
    stockActual: 5,
  })

  const server = await createTestServer(buildTestApp())

  try {
    const created = await requestJson('POST', `${server.baseUrl}/api/reembolsos`, buildEmpresaUser(empresaId, slug), {
      checkout_session_id: sessionId,
      reason: 'Refund manual consumibles',
    })

    const caseId = (created.data as any).case.id
    const linked = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${caseId}/items`, buildEmpresaUser(empresaId, slug), {
      items: [{ target_type: 'consumible_venta', target_id: ventaPendienteId }],
    })

    assert.equal(linked.status, 200)
    assert.equal((linked.data as any).items[0].eligibility, 'elegible')

    const approved = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${caseId}/approve`, buildEmpresaUser(empresaId, slug), {
      reason: 'Consumibles aprobados para refund manual',
    })

    assert.equal(approved.status, 409)
    assert.equal((approved.data as any).error, 'Los consumibles deben resolverse como no reembolsables en este MVP')

    const executed = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${caseId}/execute`, buildEmpresaUser(empresaId, slug), {
      evidence_note: 'Acreditación externa confirmada',
    })

    assert.equal(executed.status, 409)
    assert.equal((executed.data as any).error, 'Los consumibles deben resolverse como no reembolsables en este MVP')

    const resolved = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${caseId}/resolve-non-refundable`, buildEmpresaUser(empresaId, slug), {
      reason: 'Consumibles no reembolsables en MVP',
      note: 'Se informa cierre operativo sin mover dinero',
    })

    assert.equal(resolved.status, 200)
    assert.equal((resolved.data as any).case.status, 'resolved_non_refundable')
    assert.equal((resolved.data as any).case.resolved_by, empresaId)
    assert.equal((resolved.data as any).case.evidence_note, 'Se informa cierre operativo sin mover dinero')
    assert.ok((resolved.data as any).events.some((event: any) => event.event_type === 'case_resolved_non_refundable'))

    const [saleRows] = await pool.query<any[]>(`SELECT estado FROM consumibles_ventas WHERE id = ?`, [ventaPendienteId])
    const [stockRows] = await pool.query<any[]>(`SELECT stock_actual FROM barra_stock WHERE barra_id = ? AND consumible_id = ?`, [barraId, consumibleId])
    assert.equal(saleRows[0].estado, 'pendiente')
    assert.equal(Number(stockRows[0].stock_actual), 8)

    const blockedCase = await requestJson('POST', `${server.baseUrl}/api/reembolsos`, buildEmpresaUser(empresaId, slug), {
      checkout_session_id: sessionId,
      reason: 'Refund consumible canjeado',
    })

    const blockedCaseId = (blockedCase.data as any).case.id
    const blockedLink = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${blockedCaseId}/items`, buildEmpresaUser(empresaId, slug), {
      items: [{ target_type: 'consumible_venta', target_id: ventaCanjeadaId }],
    })
    assert.equal(blockedLink.status, 200)
    assert.equal((blockedLink.data as any).items[0].block_reason, 'consumible_canjeado')

    const blockedResolved = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${blockedCaseId}/resolve-non-refundable`, buildEmpresaUser(empresaId, slug), {
      reason: 'Consumible canjeado y no reembolsable en MVP',
    })

    assert.equal(blockedResolved.status, 200)
    assert.equal((blockedResolved.data as any).case.status, 'resolved_non_refundable')
  } finally {
    await server.close()
  }
})

test('buyer can request refund for own eligible entry and duplicate requests reuse visible state', async () => {
  const empresaId = 'refund-phase3-emp-1'
  const compradorId = 'refund-phase3-cmp-1'
  const sessionId = 'refund-phase3-session-1'
  const eventoId = 'refund-phase3-evt-1'
  const categoriaId = 'refund-phase3-cat-1'
  const entradaId = 'refund-phase3-ent-1'
  const slug = 'refund-phase3-1'

  await seedEmpresa({ empresaId, slug })
  await enableBuyerRefundsForEmpresa(empresaId)
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedTicketSession({ sessionId, empresaId, compradorId })
  await seedEventoConCategoria({ empresaId, eventoId, categoriaId })
  await enableBuyerRefundsForEvento(eventoId)
  await seedEntrada({ entradaId, eventoId, categoriaId, compradorId, estado: 'valida' })
  await seedEntryCheckoutAllocation({ entradaId, empresaId, sessionId })

  const server = await createTestServer(buildTenantTestApp())

  try {
    const before = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}/mis-tickets`, buildCompradorUser(compradorId, empresaId, slug))
    assert.equal(before.status, 200)
    assert.equal((before.data as any).data.entradas[0].refund.eligible, true)

    const created = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/refunds`, buildCompradorUser(compradorId, empresaId, slug), {
      entrada_id: entradaId,
      reason: 'No voy a poder asistir',
      note: 'Viaje imprevisto',
    })

    assert.equal(created.status, 201)
    assert.equal((created.data as any).case.request_origin, 'buyer_event_request')
    assert.equal((created.data as any).case.requested_entry_id, entradaId)
    assert.equal((created.data as any).case.requester_buyer_id, compradorId)
    assert.equal((created.data as any).items.length, 1)
    assert.equal((created.data as any).items[0].target_id, entradaId)

    const duplicate = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/refunds`, buildCompradorUser(compradorId, empresaId, slug), {
      entrada_id: entradaId,
      reason: 'Intento duplicado',
    })

    assert.equal(duplicate.status, 409)
    assert.equal((duplicate.data as any).error, 'Ya existe una solicitud activa para esta entrada')
    assert.equal((duplicate.data as any).data.case.requested_entry_id, entradaId)

    const after = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}/mis-tickets`, buildCompradorUser(compradorId, empresaId, slug))
    assert.equal(after.status, 200)
    assert.equal((after.data as any).data.entradas[0].refund.eligible, false)
    assert.equal((after.data as any).data.entradas[0].refund.existing_request.status, 'requested')
  } finally {
    await server.close()
  }
})

test('mis-tickets does not duplicate entries when allocation ledger has duplicate allocation rows', async () => {
  const empresaId = 'refund-phase3-emp-dup-1'
  const compradorId = 'refund-phase3-cmp-dup-1'
  const sessionId = 'refund-phase3-session-dup-1'
  const eventoId = 'refund-phase3-evt-dup-1'
  const categoriaId = 'refund-phase3-cat-dup-1'
  const entradaId = 'refund-phase3-ent-dup-1'
  const slug = 'refund-phase3-dup-1'

  await seedEmpresa({ empresaId, slug })
  await enableBuyerRefundsForEmpresa(empresaId)
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedTicketSession({ sessionId, empresaId, compradorId })
  await seedEventoConCategoria({ empresaId, eventoId, categoriaId })
  await enableBuyerRefundsForEvento(eventoId)
  await seedEntrada({ entradaId, eventoId, categoriaId, compradorId, estado: 'valida' })

  await pool.query(
    `INSERT INTO platform_sale_allocations
     (id, source_type, source_id, checkout_session_id, empresa_id, flow, currency, owner_fee_amount, allocated_amount, allocation_percentage, configured_platform_admin_user_id, effective_platform_admin_user_id, fallback_reason, entry_kind)
     VALUES
     (?, 'entrada', ?, ?, ?, 'entradas', 'ARS', 0, 0, 0, 'dup-config-1', 'dup-effective-1', 'none', 'allocation'),
     (?, 'entrada', ?, ?, ?, 'entradas', 'ARS', 0, 0, 0, 'dup-config-1', 'dup-effective-1', 'none', 'allocation')`,
    ['dup-alloc-1', entradaId, sessionId, empresaId, 'dup-alloc-2', entradaId, sessionId, empresaId]
  )

  const server = await createTestServer(buildTenantTestApp())

  try {
    const tickets = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}/mis-tickets`, buildCompradorUser(compradorId, empresaId, slug))
    assert.equal(tickets.status, 200)
    assert.equal((tickets.data as any).data.entradas.length, 1)
    assert.equal((tickets.data as any).data.entradas[0].id, entradaId)
  } finally {
    await server.close()
  }
})

test('buyer refund request is blocked when company or event policy is disabled or entry is not refundable', async () => {
  const empresaId = 'refund-phase3-emp-2'
  const compradorId = 'refund-phase3-cmp-2'
  const sessionId = 'refund-phase3-session-2'
  const eventoId = 'refund-phase3-evt-2'
  const categoriaId = 'refund-phase3-cat-2'
  const entradaId = 'refund-phase3-ent-2'
  const slug = 'refund-phase3-2'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedTicketSession({ sessionId, empresaId, compradorId })
  await seedEventoConCategoria({ empresaId, eventoId, categoriaId })
  await seedEntrada({ entradaId, eventoId, categoriaId, compradorId, estado: 'valida' })
  await seedEntryCheckoutAllocation({ entradaId, empresaId, sessionId })

  const server = await createTestServer(buildTenantTestApp())

  try {
    const companyOff = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/refunds`, buildCompradorUser(compradorId, empresaId, slug), {
      entrada_id: entradaId,
      reason: 'Empresa apagada',
    })
    assert.equal(companyOff.status, 409)

    await enableBuyerRefundsForEmpresa(empresaId)

    const eventOff = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/refunds`, buildCompradorUser(compradorId, empresaId, slug), {
      entrada_id: entradaId,
      reason: 'Evento apagado',
    })
    assert.equal(eventOff.status, 409)

    await enableBuyerRefundsForEvento(eventoId)
    await pool.query(`UPDATE entradas SET estado = 'usada' WHERE id = ?`, [entradaId])

    const usedEntry = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/refunds`, buildCompradorUser(compradorId, empresaId, slug), {
      entrada_id: entradaId,
      reason: 'Entrada usada',
    })
    assert.equal(usedEntry.status, 409)
    assert.equal((usedEntry.data as any).error, 'La entrada ya fue utilizada y no puede pedir reembolso')
  } finally {
    await server.close()
  }
})

test('buyer refund request rejects ownership mismatch, cancelled entries, and missing confirmed purchase', async () => {
  const empresaId = 'refund-phase3-emp-4'
  const ownerBuyerId = 'refund-phase3-cmp-4-owner'
  const foreignBuyerId = 'refund-phase3-cmp-4-foreign'
  const sessionId = 'refund-phase3-session-4'
  const eventoId = 'refund-phase3-evt-4'
  const categoriaId = 'refund-phase3-cat-4'
  const validEntryId = 'refund-p3e4-valid'
  const cancelledEntryId = 'refund-p3e4-cancelled'
  const noCheckoutEntryId = 'refund-p3e4-no-checkout'
  const slug = 'refund-phase3-4'

  await seedEmpresa({ empresaId, slug })
  await enableBuyerRefundsForEmpresa(empresaId)
  await seedComprador({ compradorId: ownerBuyerId, empresaId })
  await seedComprador({ compradorId: foreignBuyerId, empresaId })
  await seedConfirmedTicketSession({ sessionId, empresaId, compradorId: ownerBuyerId })
  await seedEventoConCategoria({ empresaId, eventoId, categoriaId })
  await enableBuyerRefundsForEvento(eventoId)
  await seedEntrada({ entradaId: validEntryId, eventoId, categoriaId, compradorId: ownerBuyerId, estado: 'valida' })
  await seedEntrada({ entradaId: cancelledEntryId, eventoId, categoriaId, compradorId: ownerBuyerId, estado: 'cancelada' })
  await seedEntrada({ entradaId: noCheckoutEntryId, eventoId, categoriaId, compradorId: ownerBuyerId, estado: 'valida' })
  await seedEntryCheckoutAllocation({ entradaId: validEntryId, empresaId, sessionId })
  await seedEntryCheckoutAllocation({ entradaId: cancelledEntryId, empresaId, sessionId })

  const server = await createTestServer(buildTenantTestApp())

  try {
    const ownershipMismatch = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/refunds`, buildCompradorUser(foreignBuyerId, empresaId, slug), {
      entrada_id: validEntryId,
      reason: 'No me pertenece',
    })
    assert.equal(ownershipMismatch.status, 404)
    assert.equal((ownershipMismatch.data as any).error, 'La entrada no existe o no te pertenece')

    const cancelledEntry = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/refunds`, buildCompradorUser(ownerBuyerId, empresaId, slug), {
      entrada_id: cancelledEntryId,
      reason: 'Ya cancelada',
    })
    assert.equal(cancelledEntry.status, 409)
    assert.equal((cancelledEntry.data as any).error, 'La entrada ya fue reembolsada o cancelada')

    const missingCheckout = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/refunds`, buildCompradorUser(ownerBuyerId, empresaId, slug), {
      entrada_id: noCheckoutEntryId,
      reason: 'Sin checkout confirmado',
    })
    assert.equal(missingCheckout.status, 409)
    assert.equal((missingCheckout.data as any).error, 'La entrada no está ligada a una compra confirmada')
  } finally {
    await server.close()
  }
})

test('buyer sees reviewed outcome in mis-tickets after company rejects the request', async () => {
  const empresaId = 'refund-phase3-emp-3'
  const compradorId = 'refund-phase3-cmp-3'
  const sessionId = 'refund-phase3-session-3'
  const eventoId = 'refund-phase3-evt-3'
  const categoriaId = 'refund-phase3-cat-3'
  const entradaId = 'refund-phase3-ent-3'
  const slug = 'refund-phase3-3'

  await seedEmpresa({ empresaId, slug })
  await enableBuyerRefundsForEmpresa(empresaId)
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedTicketSession({ sessionId, empresaId, compradorId })
  await seedEventoConCategoria({ empresaId, eventoId, categoriaId })
  await enableBuyerRefundsForEvento(eventoId)
  await seedEntrada({ entradaId, eventoId, categoriaId, compradorId, estado: 'valida' })
  await seedEntryCheckoutAllocation({ entradaId, empresaId, sessionId })

  const server = await createTestServer(buildTenantTestApp())

  try {
    const created = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/refunds`, buildCompradorUser(compradorId, empresaId, slug), {
      entrada_id: entradaId,
      reason: 'Necesito devolverla',
    })

    const caseId = (created.data as any).case.id
    const rejected = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${caseId}/reject`, buildEmpresaUser(empresaId, slug), {
      reason: 'Fuera de policy',
      evidence_note: 'Se informó política vigente',
    })
    assert.equal(rejected.status, 200)

    const tickets = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}/mis-tickets`, buildCompradorUser(compradorId, empresaId, slug))
    assert.equal(tickets.status, 200)
    assert.equal((tickets.data as any).data.entradas[0].refund.existing_request.status, 'rejected')
    assert.equal((tickets.data as any).data.entradas[0].refund.eligible, false)
  } finally {
    await server.close()
  }
})

test('dashboard refund routes keep buyer-origin metadata and audit history visible to reviewers', async () => {
  const empresaId = 'refund-phase3-emp-5'
  const compradorId = 'refund-phase3-cmp-5'
  const sessionId = 'refund-phase3-session-5'
  const eventoId = 'refund-phase3-evt-5'
  const categoriaId = 'refund-phase3-cat-5'
  const entradaId = 'refund-phase3-ent-5'
  const slug = 'refund-phase3-5'

  await seedEmpresa({ empresaId, slug })
  await enableBuyerRefundsForEmpresa(empresaId)
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedTicketSession({ sessionId, empresaId, compradorId })
  await seedEventoConCategoria({ empresaId, eventoId, categoriaId })
  await enableBuyerRefundsForEvento(eventoId)
  await seedEntrada({ entradaId, eventoId, categoriaId, compradorId, estado: 'valida' })
  await seedEntryCheckoutAllocation({ entradaId, empresaId, sessionId })

  const server = await createTestServer(buildTenantTestApp())

  try {
    const created = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/refunds`, buildCompradorUser(compradorId, empresaId, slug), {
      entrada_id: entradaId,
      reason: 'Quiero devolverla',
      note: 'No voy a poder viajar',
    })
    assert.equal(created.status, 201)

    const caseId = (created.data as any).case.id

    const list = await requestJson('GET', `${server.baseUrl}/api/reembolsos`, buildEmpresaUser(empresaId, slug))
    assert.equal(list.status, 200)
    assert.equal((list.data as any).data.cases[0].request_origin, 'buyer_event_request')
    assert.equal((list.data as any).data.cases[0].requester_buyer_id, compradorId)
    assert.equal((list.data as any).data.cases[0].buyer_name, `Comprador ${compradorId}`)
    assert.equal((list.data as any).data.cases[0].requested_entry_id, entradaId)
    assert.equal((list.data as any).data.cases[0].requested_event_id, eventoId)
    assert.equal((list.data as any).data.cases[0].requested_event_name, `Evento ${eventoId}`)

    const detail = await requestJson('GET', `${server.baseUrl}/api/reembolsos/${caseId}`, buildEmpresaUser(empresaId, slug))
    assert.equal(detail.status, 200)
    assert.equal((detail.data as any).case.request_origin, 'buyer_event_request')
    assert.equal((detail.data as any).case.request_note, 'No voy a poder viajar')
    assert.equal((detail.data as any).purchase_context.buyer.id, compradorId)
    assert.equal((detail.data as any).events[0].event_type, 'case_requested')
    assert.equal((detail.data as any).events[0].actor_type, 'comprador')
    assert.equal((detail.data as any).events[0].payload.requested_entry_id, entradaId)
  } finally {
    await server.close()
  }
})

test('buyer event refund auto-executes when company policy enables automatic entry refunds', async () => {
  const empresaId = 'refund-phase3-auto-emp-1'
  const compradorId = 'refund-phase3-auto-cmp-1'
  const sessionId = 'refund-phase3-auto-session-1'
  const eventoId = 'refund-phase3-auto-evt-1'
  const categoriaId = 'refund-phase3-auto-cat-1'
  const entradaId = 'refund-phase3-auto-ent-1'
  const otherEntradaId = 'rf3-auto-ent-1b'
  const slug = 'refund-phase3-auto-1'
  const refundCreatePayloads: any[] = []

  await seedEmpresa({ empresaId, slug })
  await enableBuyerRefundsForEmpresa(empresaId)
  await pool.query(`UPDATE empresas SET buyer_auto_refunds_enabled = true, buyer_auto_refunds_scope = 'entradas' WHERE id = ?`, [empresaId])
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedTicketSession({ sessionId, empresaId, compradorId })
  await seedEventoConCategoria({ empresaId, eventoId, categoriaId })
  await enableBuyerRefundsForEvento(eventoId)
  await seedEntrada({ entradaId, eventoId, categoriaId, compradorId, estado: 'valida' })
  await seedEntrada({ entradaId: otherEntradaId, eventoId, categoriaId, compradorId, estado: 'valida' })
  await seedEntryCheckoutAllocation({ entradaId, empresaId, sessionId })
  await seedEntryCheckoutAllocation({ entradaId: otherEntradaId, empresaId, sessionId })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-REFUND-PHASE3-AUTO-1111' })
  await markPaymentAccountReady(empresaId)
  ;(PaymentRefund.prototype as any).create = async function (payload: any) {
    refundCreatePayloads.push(payload)
    return { id: 9901, payment_id: sessionId, amount: 1500, status: 'approved' } as any
  }

  const server = await createTestServer(buildTenantTestApp())

  try {
    const created = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/refunds`, buildCompradorUser(compradorId, empresaId, slug), {
      entrada_id: entradaId,
      reason: 'No voy a asistir',
    })

    assert.equal(created.status, 201)
    assert.equal((created.data as any).case.status, 'executed')
    assert.equal((created.data as any).case.external_refund_reference, '9901')
    assert.equal(refundCreatePayloads.length, 1)
    assert.equal(refundCreatePayloads[0].payment_id, 'mp-pay-1')
    assert.equal(refundCreatePayloads[0].body.amount, 1500)

    const [entryRows] = await pool.query<any[]>(`SELECT estado FROM entradas WHERE id = ?`, [entradaId])
    const [otherEntryRows] = await pool.query<any[]>(`SELECT estado FROM entradas WHERE id = ?`, [otherEntradaId])
    assert.equal(entryRows[0].estado, 'cancelada')
    assert.equal(otherEntryRows[0].estado, 'valida')

    const detail = await requestJson('GET', `${server.baseUrl}/api/reembolsos/${(created.data as any).case.id}`, buildEmpresaUser(empresaId, slug))
    assert.equal(detail.status, 200)
    assert.deepEqual(
      (detail.data as any).events.map((event: any) => event.event_type).sort(),
      ['case_executed', 'case_requested']
    )

    const tickets = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}/mis-tickets`, buildCompradorUser(compradorId, empresaId, slug))
    assert.equal(tickets.status, 200)
    const refundedEntry = (tickets.data as any).data.entradas.find((entrada: any) => entrada.id === entradaId)
    const untouchedEntry = (tickets.data as any).data.entradas.find((entrada: any) => entrada.id === otherEntradaId)
    assert.equal(refundedEntry.refund.existing_request.status, 'executed')
    assert.equal(untouchedEntry.refund.existing_request, null)
  } finally {
    await server.close()
  }
})

test('buyer consumible refund auto-executes when company policy enables automatic consumible refunds', async () => {
  const empresaId = 'refund-phase3-auto-emp-2'
  const compradorId = 'refund-phase3-auto-cmp-2'
  const sessionId = 'refund-phase3-auto-session-2'
  const eventoId = 'refund-phase3-auto-evt-2'
  const barraId = 'refund-phase3-auto-bar-2'
  const consumibleId = 'refund-phase3-auto-cons-2'
  const ventaId = 'refund-phase3-auto-sale-2'
  const slug = 'refund-phase3-auto-2'

  await seedEmpresa({ empresaId, slug })
  await pool.query(`UPDATE empresas SET buyer_auto_refunds_enabled = true, buyer_auto_refunds_scope = 'consumibles' WHERE id = ?`, [empresaId])
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedConsumablesSession({ sessionId, empresaId, compradorId })
  await seedConsumiblesContext({
    empresaId,
    eventoId,
    barraId,
    consumibleId,
    ventaId,
    checkoutSessionId: sessionId,
    compradorId,
    ventaEstado: 'pendiente',
    stockActual: 10,
  })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-REFUND-PHASE3-AUTO-2222' })
  await markPaymentAccountReady(empresaId)
  ;(PaymentRefund.prototype as any).create = async function () {
    return { id: 9902, payment_id: sessionId, amount: 600, status: 'approved' } as any
  }

  const server = await createTestServer(buildTenantTestApp())

  try {
    const before = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}/mis-consumibles`, buildCompradorUser(compradorId, empresaId, slug))
    assert.equal(before.status, 200)
    assert.equal((before.data as any).data.ventas[0].refund_policy.mode, 'consumibles')
    assert.equal((before.data as any).data.ventas[0].refund_policy.applies, true)

    const created = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/consumibles-refund-requests`, buildCompradorUser(compradorId, empresaId, slug), {
      items: [{ venta_id: ventaId, venta_item_id: `item-${ventaId}`, quantity_requested: 2 }],
      reason: 'No voy a retirar el pedido',
    })

    assert.equal(created.status, 201)
    assert.equal((created.data as any).case.status, 'executed')

    const [saleRows] = await pool.query<any[]>(`SELECT estado FROM consumibles_ventas WHERE id = ?`, [ventaId])
    assert.equal(saleRows[0].estado, 'cancelado')
  } finally {
    await server.close()
  }
})
