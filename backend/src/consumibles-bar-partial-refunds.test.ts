import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { PaymentRefund } from 'mercadopago'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'
process.env.PAYMENT_ACCOUNTS_ENCRYPTION_KEY = process.env.PAYMENT_ACCOUNTS_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'

import pool from './db'
import { upsertPaymentAccountByEmpresaId } from './lib/payment-accounts'
import canjearRouter from './routes/canjear'
import reembolsosRouter from './routes/reembolsos'
import tenantRouter from './routes/tenant'
import ventasRouter from './routes/ventas'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch
const originalRefundCreate = (PaymentRefund as any).prototype.create

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

async function requestJson(method: 'GET' | 'POST', url: string, user: Record<string, unknown>, body?: unknown) {
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

async function seedComprador({ compradorId, empresaId }: { compradorId: string; empresaId: string }) {
  await pool.query(
    `INSERT INTO compradores (id, empresa_id, nombre, email, dni, password)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [compradorId, empresaId, `Comprador ${compradorId}`, `${compradorId}@example.com`, `dni-${compradorId.slice(-16)}`, TEST_PASSWORD_HASH]
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

async function seedConsumiblesVentaContext(input: {
  empresaId: string
  slug: string
  compradorId: string
  sessionId: string
  eventoId: string
  barraId: string
  ventaId: string
}) {
  await pool.query(`ALTER TABLE eventos ADD COLUMN IF NOT EXISTS venta_consumibles_habilitada boolean NOT NULL DEFAULT false`)
  await pool.query(
    `INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, activo, venta_consumibles_habilitada)
     VALUES (?, ?, 'Evento Consumibles', NULL, NULL, 'unica', true, true)`,
    [input.eventoId, input.empresaId]
  )
  await pool.query(
    `INSERT INTO barras (id, evento_id, empresa_id, nombre, activa)
     VALUES (?, ?, ?, 'Barra Norte', true)`,
    [input.barraId, input.eventoId, input.empresaId]
  )
  await pool.query(
    `INSERT INTO consumibles (id, empresa_id, nombre, descripcion, precio, activo)
     VALUES (?, ?, 'Cerveza', NULL, 300, true), (?, ?, 'Papas', NULL, 400, true)`,
    ['partial-cons-1', input.empresaId, 'partial-cons-2', input.empresaId]
  )
  await pool.query(
    `INSERT INTO barra_stock (id, barra_id, consumible_id, stock_inicial, stock_actual, precio_override, activo)
     VALUES
     ('partial-stock-1', ?, 'partial-cons-1', 10, 4, NULL, true),
     ('partial-stock-2', ?, 'partial-cons-2', 10, 7, NULL, true)`,
    [input.barraId, input.barraId]
  )
  await pool.query(
    `INSERT INTO checkout_sessions
     (id, comprador_id, empresa_id, datos, estado, payment_id, payment_status, reconciliation_status, confirmed_at, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'confirmada', 'mp-partial-pay-1', 'approved', 'reconciled', NOW(), NOW() + INTERVAL '10 minutes', NOW())`,
    [
      input.sessionId,
      input.compradorId,
      input.empresaId,
      JSON.stringify({
        flow: 'consumibles',
        items: [
          { consumibleId: 'partial-cons-1', nombre: 'Cerveza', precio: 300, cantidad: 2 },
          { consumibleId: 'partial-cons-2', nombre: 'Papas', precio: 400, cantidad: 1 },
        ],
        marketplaceFee: { amount: 50, currency: 'ARS' },
      }),
    ]
  )
  await pool.query(
    `INSERT INTO consumibles_ventas
     (id, barra_id, evento_id, empresa_id, comprador_id, checkout_session_id, origen, qr_code, clave_corta, total, estado, owner_fee_amount, mp_fee_amount, neto_empresa_amount)
     VALUES (?, ?, ?, ?, ?, ?, 'tenant_publico', 'partial-qr-1', 'PARTIAL1', 1000, 'pendiente', 100, 50, 850)`,
    [input.ventaId, input.barraId, input.eventoId, input.empresaId, input.compradorId, input.sessionId]
  )
  await pool.query(
    `INSERT INTO consumibles_venta_items (id, venta_id, consumible_id, nombre_snapshot, precio_unitario, cantidad, subtotal)
     VALUES
     ('partial-item-1', ?, 'partial-cons-1', 'Cerveza', 300, 2, 600),
     ('partial-item-2', ?, 'partial-cons-2', 'Papas', 400, 1, 400)`,
    [input.ventaId, input.ventaId]
  )
  await pool.query(
    `INSERT INTO platform_sale_allocations
     (id, source_type, source_id, checkout_session_id, empresa_id, flow, currency, owner_fee_amount, allocated_amount, allocation_percentage, configured_platform_admin_user_id, effective_platform_admin_user_id, fallback_reason)
     VALUES (?, 'consumible_venta', ?, ?, ?, 'consumibles', 'ARS', 100, 100, 100, 'partial-platform-config', 'partial-platform-effective', 'none')`,
    ['partial-allocation-1', input.ventaId, input.sessionId, input.empresaId]
  )
}

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/consumibles/canjear', canjearRouter)
  app.use('/api/reembolsos', reembolsosRouter)
  app.use('/api/tenant', tenantRouter)
  app.use('/api/consumibles/ventas', ventasRouter)
  return app
}

async function cleanup() {
  ;(PaymentRefund as any).prototype.create = originalRefundCreate
  await pool.query(`DELETE FROM refund_manual_case_consumible_item_events WHERE case_id LIKE 'partial-%' OR consumible_case_item_id LIKE 'partial-%'`).catch(() => {})
  await pool.query(`DELETE FROM refund_manual_case_consumible_items WHERE case_id LIKE 'partial-%' OR venta_id LIKE 'partial-%' OR venta_item_id LIKE 'partial-%'`).catch(() => {})
  await pool.query(`
    DELETE FROM refund_manual_case_events e
    USING refund_manual_cases c
    WHERE c.id = e.case_id AND c.empresa_id LIKE 'partial-%'
  `).catch(() => {})
  await pool.query(`
    DELETE FROM refund_manual_case_items i
    USING refund_manual_cases c
    WHERE c.id = i.case_id AND c.empresa_id LIKE 'partial-%'
  `).catch(() => {})
  await pool.query(`DELETE FROM refund_manual_cases WHERE id LIKE 'partial-%' OR empresa_id LIKE 'partial-%'`).catch(() => {})
  await pool.query(`DELETE FROM consumibles_venta_resolucion_items WHERE venta_id LIKE 'partial-%' OR venta_item_id LIKE 'partial-%'`).catch(() => {})
  await pool.query(`DELETE FROM platform_sale_allocations WHERE source_id LIKE 'partial-%' OR empresa_id LIKE 'partial-%'`).catch(() => {})
  await pool.query(`DELETE FROM consumibles_canje_auditoria WHERE empresa_id LIKE 'partial-%' OR venta_id LIKE 'partial-%'`).catch(() => {})
  await pool.query(`DELETE FROM consumibles_venta_items WHERE id LIKE 'partial-%' OR venta_id LIKE 'partial-%'`).catch(() => {})
  await pool.query(`DELETE FROM consumibles_ventas WHERE id LIKE 'partial-%' OR empresa_id LIKE 'partial-%'`).catch(() => {})
  await pool.query(`DELETE FROM barra_stock WHERE barra_id LIKE 'partial-%' OR consumible_id LIKE 'partial-%'`).catch(() => {})
  await pool.query(`DELETE FROM barras WHERE id LIKE 'partial-%' OR empresa_id LIKE 'partial-%'`).catch(() => {})
  await pool.query(`DELETE FROM consumibles WHERE id LIKE 'partial-%' OR empresa_id LIKE 'partial-%'`).catch(() => {})
  await pool.query(`DELETE FROM checkout_sessions WHERE id LIKE 'partial-%' OR empresa_id LIKE 'partial-%'`).catch(() => {})
  await pool.query(`DELETE FROM compradores WHERE id LIKE 'partial-%' OR empresa_id LIKE 'partial-%'`).catch(() => {})
  await pool.query(`DELETE FROM eventos WHERE id LIKE 'partial-%' OR empresa_id LIKE 'partial-%'`).catch(() => {})
  await pool.query(`DELETE FROM empresa_payment_accounts WHERE empresa_id LIKE 'partial-%'`).catch(() => {})
  await pool.query(`DELETE FROM empresas WHERE id LIKE 'partial-%' OR slug LIKE 'partial-%'`).catch(() => {})
}

beforeEach(async () => {
  await cleanup()
})

after(async () => {
  await cleanup()
  await pool.end()
})

test('barra resolves mixed consumibles lines, refunds only crossed quantities, and exposes stock-shortage trace', async () => {
  const empresaId = 'partial-emp-1'
  const slug = 'partial-company'
  const compradorId = 'partial-cmp-1'
  const sessionId = 'partial-session-1'
  const eventoId = 'partial-evt-1'
  const barraId = 'partial-bar-1'
  const ventaId = 'partial-sale-1'
  let refundCreatePayload: any = null

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-PARTIAL-1111' })
  await markPaymentAccountReady(empresaId)
  await seedConsumiblesVentaContext({ empresaId, slug, compradorId, sessionId, eventoId, barraId, ventaId })
  await pool.query(`UPDATE barras SET buyer_consumible_refunds_enabled = false WHERE id = ?`, [barraId])

  ;(PaymentRefund as any).prototype.create = async function (payload: any) {
    refundCreatePayload = payload
    return {
      id: 9003,
      payment_id: 'mp-partial-pay-1',
      amount: 300,
      status: 'approved',
    }
  }

  const server = await createTestServer(buildApp())

  try {
    const empresaUser = buildEmpresaUser(empresaId, slug)
    const compradorUser = buildCompradorUser(compradorId, empresaId, slug)

    const preview = await requestJson('POST', `${server.baseUrl}/api/consumibles/canjear`, empresaUser, {
      codigo: 'PARTIAL1',
      barra_id: barraId,
    })

    assert.equal(preview.status, 200)
    assert.equal((preview.data as any).ok, true)
    assert.equal((preview.data as any).items[0].venta_item_id, 'partial-item-1')
    assert.equal((preview.data as any).items[1].venta_item_id, 'partial-item-2')

    const resolved = await requestJson('POST', `${server.baseUrl}/api/consumibles/canjear`, empresaUser, {
      accion: 'resolver',
      venta_id: ventaId,
      barra_id: barraId,
      items: [
        {
          venta_item_id: 'partial-item-1',
          cantidad_entregada: 1,
          cantidad_reembolsada: 1,
          resolution_reason: 'stock_shortage',
        },
        {
          venta_item_id: 'partial-item-2',
          cantidad_entregada: 1,
          cantidad_reembolsada: 0,
        },
      ],
    })

    assert.equal(resolved.status, 200)
    assert.equal((resolved.data as any).ok, true)
    assert.equal((resolved.data as any).estado, 'resuelto_parcial')
    assert.equal((resolved.data as any).delivered_amount, 700)
    assert.equal((resolved.data as any).refunded_amount, 300)
    assert.ok(typeof (resolved.data as any).refund_case_id === 'string')
    assert.deepEqual(
      (resolved.data as any).items.map((item: any) => ({
        venta_item_id: item.venta_item_id,
        cantidad_entregada: item.cantidad_entregada,
        cantidad_reembolsada: item.cantidad_reembolsada,
      })),
      [
        { venta_item_id: 'partial-item-1', cantidad_entregada: 1, cantidad_reembolsada: 1 },
        { venta_item_id: 'partial-item-2', cantidad_entregada: 1, cantidad_reembolsada: 0 },
      ]
    )

    assert.equal(refundCreatePayload.payment_id, 'mp-partial-pay-1')
    assert.equal(refundCreatePayload.body.amount, 300)
    assert.match(String(refundCreatePayload.requestOptions?.idempotencyKey ?? ''), /partial-sale-1/i)

    const refunds = await requestJson('GET', `${server.baseUrl}/api/reembolsos`, empresaUser)
    assert.equal(refunds.status, 200)
    assert.equal((refunds.data as any).data.cases.length, 1)
    assert.equal((refunds.data as any).data.cases[0].request_origin, 'bar_stockout_auto')
    assert.match((refunds.data as any).data.cases[0].request_reason, /falta de stock/i)

    const detail = await requestJson('GET', `${server.baseUrl}/api/consumibles/ventas/${ventaId}`, empresaUser)
    assert.equal(detail.status, 200)
    assert.equal((detail.data as any).venta.estado, 'resuelto_parcial')
    assert.equal((detail.data as any).venta.delivered_amount, 700)
    assert.equal((detail.data as any).venta.refunded_amount, 300)
    assert.deepEqual(
      (detail.data as any).venta.items.map((item: any) => ({
        id: item.id,
        cantidad_entregada: item.cantidad_entregada,
        cantidad_reembolsada: item.cantidad_reembolsada,
      })),
      [
        { id: 'partial-item-1', cantidad_entregada: 1, cantidad_reembolsada: 1 },
        { id: 'partial-item-2', cantidad_entregada: 1, cantidad_reembolsada: 0 },
      ]
    )

    const buyerHistory = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}/mis-consumibles`, compradorUser)
    assert.equal(buyerHistory.status, 200)
    assert.equal((buyerHistory.data as any).data.ventas[0].estado, 'resuelto_parcial')
    assert.equal((buyerHistory.data as any).data.ventas[0].delivered_amount, 700)
    assert.equal((buyerHistory.data as any).data.ventas[0].refunded_amount, 300)
    assert.equal((buyerHistory.data as any).data.ventas[0].items[0].cantidad_reembolsada, 1)

    const [saleRows] = await pool.query<any[]>(
      `SELECT estado, canjeado_at, resuelto_at, delivered_amount, refunded_amount, refund_case_id, neto_empresa_amount
       FROM consumibles_ventas
       WHERE id = ?`,
      [ventaId]
    )
    assert.equal(saleRows[0].estado, 'resuelto_parcial')
    assert.equal(saleRows[0].canjeado_at, null)
    assert.ok(saleRows[0].resuelto_at)
    assert.equal(Number(saleRows[0].delivered_amount), 700)
    assert.equal(Number(saleRows[0].refunded_amount), 300)
    assert.equal(Number(saleRows[0].neto_empresa_amount), 595)
    assert.ok(typeof saleRows[0].refund_case_id === 'string' && saleRows[0].refund_case_id.length > 10)

    const [allocationRows] = await pool.query<any[]>(
      `SELECT entry_kind, allocated_amount, reversal_reason, reversal_reference_type
       FROM platform_sale_allocations
       WHERE source_type = 'consumible_venta' AND source_id = ?
       ORDER BY entry_kind ASC, created_at ASC, id ASC`,
      [ventaId]
    )
    assert.equal(allocationRows.length, 2)
    assert.equal(allocationRows[0].entry_kind, 'allocation')
    assert.equal(allocationRows[1].entry_kind, 'reversal')
    assert.equal(Number(allocationRows[1].allocated_amount), -30)
    assert.equal(allocationRows[1].reversal_reason, 'bar_stockout_auto_refund')
    assert.equal(allocationRows[1].reversal_reference_type, 'refund_manual_case')

    const [refundItemRows] = await pool.query<any[]>(
      `SELECT venta_item_id, quantity_requested, quantity_executed, status
       FROM refund_manual_case_consumible_items
       WHERE case_id = ?
       ORDER BY venta_item_id ASC`,
      [(resolved.data as any).refund_case_id]
    )
    assert.deepEqual(refundItemRows, [
      {
        venta_item_id: 'partial-item-1',
        quantity_requested: 1,
        quantity_executed: 1,
        status: 'executed',
      },
    ])

    // Regression coverage: an automatic bar-stockout refund (createAutomaticRefundCase in
    // consumibles-redeem.ts, ~line 519) must restore barra_stock.stock_actual by the refunded
    // quantity on the line that hit the shortage (partial-item-1 → partial-cons-1, seeded at
    // stock_actual = 4 in seedConsumiblesVentaContext), and must NOT touch a line that had zero
    // cantidad_reembolsada (partial-item-2 → partial-cons-2, seeded at stock_actual = 7).
    const [stockRows] = await pool.query<any[]>(
      `SELECT consumible_id, stock_actual FROM barra_stock WHERE barra_id = ? ORDER BY consumible_id ASC`,
      [barraId]
    )
    assert.deepEqual(
      stockRows.map((row) => ({ consumible_id: row.consumible_id, stock_actual: Number(row.stock_actual) })),
      [
        { consumible_id: 'partial-cons-1', stock_actual: 5 },
        { consumible_id: 'partial-cons-2', stock_actual: 7 },
      ]
    )
  } finally {
    await server.close()
  }
})

test('bar can refund a remaining consumible line after a buyer refund executed another line from the same sale', async () => {
  const empresaId = 'partial-emp-3'
  const slug = 'partial-company-3'
  const compradorId = 'partial-cmp-3'
  const sessionId = 'partial-session-3'
  const eventoId = 'partial-evt-3'
  const barraId = 'partial-bar-3'
  const ventaId = 'partial-sale-3'
  let refundCreatePayload: any = null

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-PARTIAL-3333' })
  await markPaymentAccountReady(empresaId)
  await seedConsumiblesVentaContext({ empresaId, slug, compradorId, sessionId, eventoId, barraId, ventaId })

  ;(PaymentRefund as any).prototype.create = async function (payload: any) {
    refundCreatePayload = payload
    return {
      id: 9013,
      payment_id: 'mp-partial-pay-1',
      amount: 600,
      status: 'approved',
    }
  }

  const server = await createTestServer(buildApp())

  try {
    const empresaUser = buildEmpresaUser(empresaId, slug)
    const compradorUser = buildCompradorUser(compradorId, empresaId, slug)

    const buyerCreated = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/consumibles-refund-requests`, compradorUser, {
      items: [{ venta_id: ventaId, venta_item_id: 'partial-item-2', quantity_requested: 1 }],
      reason: 'No retiro papas',
    })

    assert.equal(buyerCreated.status, 201, JSON.stringify(buyerCreated.data))

    const buyerExecuted = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${(buyerCreated.data as any).case.id}/execute`, empresaUser, {
      evidence_note: 'Refund manual validado para papas',
      external_refund_reference: 'MANUAL-PARTIAL-3-BUYER',
    })

    assert.equal(buyerExecuted.status, 200, JSON.stringify(buyerExecuted.data))
    assert.equal((buyerExecuted.data as any).case.status, 'executed')

    const preview = await requestJson('POST', `${server.baseUrl}/api/consumibles/canjear`, empresaUser, {
      codigo: 'PARTIAL1',
      barra_id: barraId,
    })

    assert.equal(preview.status, 200)
    assert.equal((preview.data as any).ok, true)
    assert.deepEqual(
      (preview.data as any).items.map((item: any) => ({ venta_item_id: item.venta_item_id, cantidad: item.cantidad })),
      [{ venta_item_id: 'partial-item-1', cantidad: 2 }]
    )

    const resolved = await requestJson('POST', `${server.baseUrl}/api/consumibles/canjear`, empresaUser, {
      accion: 'resolver',
      venta_id: ventaId,
      barra_id: barraId,
      items: [
        {
          venta_item_id: 'partial-item-1',
          cantidad_entregada: 0,
          cantidad_reembolsada: 2,
          resolution_reason: 'stock_shortage',
        },
      ],
    })

    assert.equal(resolved.status, 200, JSON.stringify(resolved.data))
    assert.equal((resolved.data as any).ok, true)
    assert.equal((resolved.data as any).estado, 'cancelado')
    assert.equal((resolved.data as any).refunded_amount, 600)
    assert.ok(typeof (resolved.data as any).refund_case_id === 'string')
    assert.equal(refundCreatePayload.body.amount, 600)

    const [refundItemRows] = await pool.query<any[]>(
      `SELECT venta_item_id, quantity_requested, quantity_executed, status
       FROM refund_manual_case_consumible_items
       WHERE case_id = ?
       ORDER BY venta_item_id ASC`,
      [(resolved.data as any).refund_case_id]
    )
    assert.deepEqual(refundItemRows, [
      {
        venta_item_id: 'partial-item-1',
        quantity_requested: 2,
        quantity_executed: 2,
        status: 'executed',
      },
    ])
  } finally {
    await server.close()
  }
})

test('confirmar remains shorthand for all delivered and skips automatic refund creation', async () => {
  const empresaId = 'partial-emp-2'
  const slug = 'partial-company-2'
  const compradorId = 'partial-cmp-2'
  const sessionId = 'partial-session-2'
  const eventoId = 'partial-evt-2'
  const barraId = 'partial-bar-2'
  const ventaId = 'partial-sale-2'
  let refundCalls = 0

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-PARTIAL-2222' })
  await markPaymentAccountReady(empresaId)
  await seedConsumiblesVentaContext({ empresaId, slug, compradorId, sessionId, eventoId, barraId, ventaId })

  ;(PaymentRefund as any).prototype.create = async function () {
    refundCalls += 1
    return { id: 9999, amount: 0, status: 'approved' }
  }

  const server = await createTestServer(buildApp())

  try {
    const empresaUser = buildEmpresaUser(empresaId, slug)

    const confirm = await requestJson('POST', `${server.baseUrl}/api/consumibles/canjear`, empresaUser, {
      accion: 'confirmar',
      venta_id: ventaId,
      barra_id: barraId,
    })

    assert.equal(confirm.status, 200)
    assert.equal((confirm.data as any).ok, true)
    assert.equal((confirm.data as any).estado, 'canjeado')
    assert.equal((confirm.data as any).refunded_amount, 0)
    assert.equal(refundCalls, 0)

    const refunds = await requestJson('GET', `${server.baseUrl}/api/reembolsos`, empresaUser)
    assert.equal((refunds.data as any).data.cases.length, 0)

    const [saleRows] = await pool.query<any[]>(
      `SELECT estado, canjeado_at, resuelto_at, delivered_amount, refunded_amount
       FROM consumibles_ventas
       WHERE id = ?`,
      [ventaId]
    )
    assert.equal(saleRows[0].estado, 'canjeado')
    assert.ok(saleRows[0].canjeado_at)
    assert.ok(saleRows[0].resuelto_at)
    assert.equal(Number(saleRows[0].delivered_amount), 1000)
    assert.equal(Number(saleRows[0].refunded_amount), 0)
  } finally {
    await server.close()
  }
})

test('resolver rolls back the closure when Mercado Pago partial refund fails', async () => {
  const empresaId = 'partial-emp-3'
  const slug = 'partial-company-3'
  const compradorId = 'partial-cmp-3'
  const sessionId = 'partial-session-3'
  const eventoId = 'partial-evt-3'
  const barraId = 'partial-bar-3'
  const ventaId = 'partial-sale-3'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-PARTIAL-3333' })
  await markPaymentAccountReady(empresaId)
  await seedConsumiblesVentaContext({ empresaId, slug, compradorId, sessionId, eventoId, barraId, ventaId })

  ;(PaymentRefund as any).prototype.create = async function () {
    throw new Error('mp partial refund failed')
  }

  const server = await createTestServer(buildApp())

  try {
    const empresaUser = buildEmpresaUser(empresaId, slug)

    const resolved = await requestJson('POST', `${server.baseUrl}/api/consumibles/canjear`, empresaUser, {
      accion: 'resolver',
      venta_id: ventaId,
      barra_id: barraId,
      items: [
        {
          venta_item_id: 'partial-item-1',
          cantidad_entregada: 0,
          cantidad_reembolsada: 2,
          resolution_reason: 'stock_shortage',
        },
        {
          venta_item_id: 'partial-item-2',
          cantidad_entregada: 1,
          cantidad_reembolsada: 0,
        },
      ],
    })

    assert.equal(resolved.status, 200)
    assert.equal((resolved.data as any).ok, false)
    assert.match(String((resolved.data as any).motivo ?? ''), /mp partial refund failed/i)

    const refunds = await requestJson('GET', `${server.baseUrl}/api/reembolsos`, empresaUser)
    assert.equal(refunds.status, 200)
    assert.equal((refunds.data as any).data.cases.length, 0)

    const [saleRows] = await pool.query<any[]>(
      `SELECT estado, canjeado_at, resuelto_at, delivered_amount, refunded_amount, refund_case_id
       FROM consumibles_ventas
       WHERE id = ?`,
      [ventaId]
    )
    assert.equal(saleRows[0].estado, 'pendiente')
    assert.equal(saleRows[0].canjeado_at, null)
    assert.equal(saleRows[0].resuelto_at, null)
    assert.equal(saleRows[0].delivered_amount, null)
    assert.equal(saleRows[0].refunded_amount, null)
    assert.equal(saleRows[0].refund_case_id, null)

    const [resolutionRows] = await pool.query<any[]>(
      `SELECT id FROM consumibles_venta_resolucion_items WHERE venta_id = ?`,
      [ventaId]
    )
    assert.equal(resolutionRows.length, 0)
  } finally {
    await server.close()
  }
})

// Regression coverage for the bar-stockout automatic refund not restoring stock — see
// createAutomaticRefundCase in consumibles-redeem.ts (~line 489-524). Covers a full-line
// shortage refund restoring stock_actual AND the stock_ilimitado guard: a line marked
// stock_ilimitado = true must NOT have stock_actual touched even though its refund executes.
test('barra automatic refund restores barra_stock.stock_actual for the refunded quantity and skips lines marked stock_ilimitado', async () => {
  const empresaId = 'partial-emp-4'
  const slug = 'partial-company-4'
  const compradorId = 'partial-cmp-4'
  const sessionId = 'partial-session-4'
  const eventoId = 'partial-evt-4'
  const barraId = 'partial-bar-4'
  const ventaId = 'partial-sale-4'
  let refundCreatePayload: any = null

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-PARTIAL-4444' })
  await markPaymentAccountReady(empresaId)
  await seedConsumiblesVentaContext({ empresaId, slug, compradorId, sessionId, eventoId, barraId, ventaId })

  // partial-cons-2 (Papas) is marked stock_ilimitado — it was never decremented at sale time,
  // so its automatic refund below must skip restoring stock_actual (guard `stock_ilimitado = false`).
  await pool.query(`UPDATE barra_stock SET stock_ilimitado = true WHERE barra_id = ? AND consumible_id = ?`, [barraId, 'partial-cons-2'])

  ;(PaymentRefund as any).prototype.create = async function (payload: any) {
    refundCreatePayload = payload
    return {
      id: 9014,
      payment_id: 'mp-partial-pay-1',
      amount: 700,
      status: 'approved',
    }
  }

  const server = await createTestServer(buildApp())

  try {
    const empresaUser = buildEmpresaUser(empresaId, slug)

    // Both lines hit a physical shortage at the bar: partial-item-1 (Cerveza, qty 2) is
    // partially refunded (1 delivered, 1 refunded); partial-item-2 (Papas, qty 1, stock_ilimitado)
    // is fully refunded.
    const resolved = await requestJson('POST', `${server.baseUrl}/api/consumibles/canjear`, empresaUser, {
      accion: 'resolver',
      venta_id: ventaId,
      barra_id: barraId,
      items: [
        {
          venta_item_id: 'partial-item-1',
          cantidad_entregada: 1,
          cantidad_reembolsada: 1,
          resolution_reason: 'stock_shortage',
        },
        {
          venta_item_id: 'partial-item-2',
          cantidad_entregada: 0,
          cantidad_reembolsada: 1,
          resolution_reason: 'stock_shortage',
        },
      ],
    })

    assert.equal(resolved.status, 200, JSON.stringify(resolved.data))
    assert.equal((resolved.data as any).ok, true)
    assert.equal((resolved.data as any).estado, 'resuelto_parcial')
    assert.equal((resolved.data as any).delivered_amount, 300)
    assert.equal((resolved.data as any).refunded_amount, 700)
    assert.ok(typeof (resolved.data as any).refund_case_id === 'string')
    assert.equal(refundCreatePayload.body.amount, 700)

    const [stockRows] = await pool.query<any[]>(
      `SELECT consumible_id, stock_actual, stock_ilimitado FROM barra_stock WHERE barra_id = ? ORDER BY consumible_id ASC`,
      [barraId]
    )

    const stockByConsumible = new Map(stockRows.map((row) => [row.consumible_id, row]))

    // partial-cons-1 (Cerveza) seeded at stock_actual = 4, refunded 1 unit → restored to 5.
    const cervezaStock = stockByConsumible.get('partial-cons-1')
    assert.equal(Number(cervezaStock.stock_actual), 5)
    assert.equal(cervezaStock.stock_ilimitado, false)

    // partial-cons-2 (Papas) seeded at stock_actual = 7, stock_ilimitado = true, refunded 1 unit
    // → stock_actual must stay untouched despite the refund executing successfully.
    const papasStock = stockByConsumible.get('partial-cons-2')
    assert.equal(Number(papasStock.stock_actual), 7)
    assert.equal(papasStock.stock_ilimitado, true)

    const [refundItemRows] = await pool.query<any[]>(
      `SELECT venta_item_id, quantity_requested, quantity_executed, status
       FROM refund_manual_case_consumible_items
       WHERE case_id = ?
       ORDER BY venta_item_id ASC`,
      [(resolved.data as any).refund_case_id]
    )
    assert.deepEqual(refundItemRows, [
      {
        venta_item_id: 'partial-item-1',
        quantity_requested: 1,
        quantity_executed: 1,
        status: 'executed',
      },
      {
        venta_item_id: 'partial-item-2',
        quantity_requested: 1,
        quantity_executed: 1,
        status: 'executed',
      },
    ])
  } finally {
    await server.close()
  }
})
