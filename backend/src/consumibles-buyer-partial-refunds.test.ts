import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

import pool from './db'
import canjearRouter from './routes/canjear'
import reembolsosRouter from './routes/reembolsos'
import tenantRouter from './routes/tenant'

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

function buildCompradorUser(compradorId: string, empresaId: string, slug: string) {
  return { id: compradorId, email: `${compradorId}@example.com`, userType: 'comprador' as const, empresa_id: empresaId, empresa_slug: slug, slug }
}

function buildEmpleadoUser(empleadoId: string, empresaId: string, slug: string, permisos: Record<string, boolean>) {
  return {
    id: empleadoId,
    email: `${empleadoId}@example.com`,
    userType: 'empleado' as const,
    empresa_id: empresaId,
    empresa_slug: slug,
    slug,
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

async function seedEmpleado({ empleadoId, empresaId, permisos }: { empleadoId: string; empresaId: string; permisos: Record<string, boolean> }) {
  await pool.query(
    `INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, activo, permisos)
     VALUES (?, ?, ?, ?, ?, ?, 'operador', true, ?)`,
    [empleadoId, empresaId, 'Empleado', 'Refunds', `${empleadoId}@example.com`, TEST_PASSWORD_HASH, JSON.stringify(permisos)]
  )
}

async function seedConfirmedConsumablesSession(input: {
  sessionId: string
  empresaId: string
  compradorId: string
  items: Array<{ consumibleId: string; consumibleName: string; quantity: number; price: number }>
}) {
  await pool.query(
    `INSERT INTO checkout_sessions
     (id, comprador_id, empresa_id, datos, estado, payment_id, payment_status, reconciliation_status, confirmed_at, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'confirmada', 'mp-pay-cons-buyer-1', 'approved', 'reconciled', NOW(), NOW() + INTERVAL '10 minutes', NOW())`,
    [
      input.sessionId,
      input.compradorId,
      input.empresaId,
      JSON.stringify({
        flow: 'consumibles',
        items: input.items.map((item) => ({ consumibleId: item.consumibleId, nombre: item.consumibleName, precio: item.price, cantidad: item.quantity })),
        marketplaceFee: { amount: 50, currency: 'ARS' },
      }),
    ]
  )
}

async function seedConsumiblesContext(input: {
  empresaId: string
  eventoId: string
  barraId: string
  checkoutSessionId: string
  compradorId: string
  ventaId: string
  items: Array<{ consumibleId: string; ventaItemId: string; nombre: string; quantity: number; price: number }>
}) {
  await pool.query(`ALTER TABLE eventos ADD COLUMN IF NOT EXISTS venta_consumibles_habilitada boolean NOT NULL DEFAULT false`)
  await pool.query(`ALTER TABLE consumibles_ventas ADD COLUMN IF NOT EXISTS comprador_id varchar(36) DEFAULT NULL`)
  await pool.query(`ALTER TABLE consumibles_ventas ADD COLUMN IF NOT EXISTS checkout_session_id varchar(80) DEFAULT NULL`)
  await pool.query(`ALTER TABLE consumibles_ventas ADD COLUMN IF NOT EXISTS origen varchar(40) NOT NULL DEFAULT 'manual'`)

  await pool.query(
    `INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo, venta_consumibles_habilitada)
     VALUES (?, ?, ?, NULL, NULL, 'unica', NULL, true, true)`,
    [input.eventoId, input.empresaId, `Evento ${input.eventoId}`]
  )

  await pool.query(
    `INSERT INTO barras (id, evento_id, empresa_id, nombre, activa)
     VALUES (?, ?, ?, ?, true)`,
    [input.barraId, input.eventoId, input.empresaId, 'Barra Norte']
  )

  await pool.query(
    `INSERT INTO consumibles (id, empresa_id, nombre, descripcion, precio, activo)
     VALUES ${input.items.map(() => '(?, ?, ?, NULL, ?, true)').join(', ')}`,
    input.items.flatMap((item) => [item.consumibleId, input.empresaId, item.nombre, item.price])
  )

  await pool.query(
    `INSERT INTO barra_stock (id, barra_id, consumible_id, stock_inicial, stock_actual, precio_override, activo)
     VALUES ${input.items.map(() => '(?, ?, ?, 50, 45, NULL, true)').join(', ')}`,
    input.items.flatMap((item, index) => [`stock-${input.ventaId}-${index + 1}`, input.barraId, item.consumibleId])
  )

  const total = input.items.reduce((sum, item) => sum + item.quantity * item.price, 0)

  await pool.query(
    `INSERT INTO consumibles_ventas
     (id, barra_id, evento_id, empresa_id, comprador_id, checkout_session_id, origen, qr_code, clave_corta, total, estado)
     VALUES (?, ?, ?, ?, ?, ?, 'tenant_publico', ?, ?, ?, 'pendiente')`,
    [
      input.ventaId,
      input.barraId,
      input.eventoId,
      input.empresaId,
      input.compradorId,
      input.checkoutSessionId,
      `qr-${input.ventaId}`,
      `CV${input.ventaId.slice(-6).replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`,
      total,
    ]
  )

  await pool.query(
    `INSERT INTO consumibles_venta_items (id, venta_id, consumible_id, nombre_snapshot, precio_unitario, cantidad, subtotal)
     VALUES ${input.items.map(() => '(?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
    input.items.flatMap((item) => [item.ventaItemId, input.ventaId, item.consumibleId, item.nombre, item.price, item.quantity, item.quantity * item.price])
  )
}

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  app.use('/api/reembolsos', reembolsosRouter)
  app.use('/api/consumibles/canjear', canjearRouter)
  return app
}

async function cleanup() {
  await pool.query(`DELETE FROM refund_manual_case_consumible_item_events WHERE case_id LIKE 'buyer-cons-%' OR consumible_case_item_id LIKE 'buyer-cons-%'`).catch(() => {})
  await pool.query(`DELETE FROM refund_manual_case_consumible_items WHERE case_id LIKE 'buyer-cons-%' OR venta_id LIKE 'buyer-cons-%' OR venta_item_id LIKE 'buyer-cons-%'`).catch(() => {})
  await pool.query(`DELETE FROM refund_manual_case_events e USING refund_manual_cases c WHERE c.id = e.case_id AND c.empresa_id LIKE 'buyer-cons-%'`).catch(() => {})
  await pool.query(`DELETE FROM refund_manual_case_items i USING refund_manual_cases c WHERE c.id = i.case_id AND c.empresa_id LIKE 'buyer-cons-%'`).catch(() => {})
  await pool.query(`DELETE FROM refund_manual_cases WHERE id LIKE 'buyer-cons-%' OR empresa_id LIKE 'buyer-cons-%' OR checkout_session_id LIKE 'buyer-cons-%'`).catch(() => {})
  await pool.query(`DELETE FROM consumibles_canje_auditoria WHERE empresa_id LIKE 'buyer-cons-%' OR venta_id LIKE 'buyer-cons-%'`).catch(() => {})
  await pool.query(`DELETE FROM consumibles_venta_resolucion_items WHERE venta_id LIKE 'buyer-cons-%' OR venta_item_id LIKE 'buyer-cons-%'`).catch(() => {})
  await pool.query(`DELETE FROM consumibles_venta_items WHERE id LIKE 'buyer-cons-%' OR venta_id LIKE 'buyer-cons-%' OR consumible_id LIKE 'buyer-cons-%'`).catch(() => {})
  await pool.query(`DELETE FROM consumibles_ventas WHERE id LIKE 'buyer-cons-%' OR empresa_id LIKE 'buyer-cons-%' OR comprador_id LIKE 'buyer-cons-%' OR checkout_session_id LIKE 'buyer-cons-%'`).catch(() => {})
  await pool.query(`DELETE FROM barra_stock WHERE id LIKE 'stock-buyer-cons-%' OR barra_id LIKE 'buyer-cons-%' OR consumible_id LIKE 'buyer-cons-%'`).catch(() => {})
  await pool.query(`DELETE FROM consumibles WHERE id LIKE 'buyer-cons-%' OR empresa_id LIKE 'buyer-cons-%'`).catch(() => {})
  await pool.query(`DELETE FROM barras WHERE id LIKE 'buyer-cons-%' OR empresa_id LIKE 'buyer-cons-%'`).catch(() => {})
  await pool.query(`DELETE FROM checkout_sessions WHERE id LIKE 'buyer-cons-%' OR empresa_id LIKE 'buyer-cons-%' OR comprador_id LIKE 'buyer-cons-%'`).catch(() => {})
  await pool.query(`DELETE FROM eventos WHERE id LIKE 'buyer-cons-%' OR empresa_id LIKE 'buyer-cons-%'`).catch(() => {})
  await pool.query(`DELETE FROM compradores WHERE id LIKE 'buyer-cons-%' OR empresa_id LIKE 'buyer-cons-%'`).catch(() => {})
  await pool.query(`DELETE FROM usuarios WHERE id LIKE 'buyer-cons-%' OR empresa_id LIKE 'buyer-cons-%'`).catch(() => {})
  await pool.query(`DELETE FROM empresas WHERE id LIKE 'buyer-cons-%' OR slug LIKE 'buyer-cons-%'`).catch(() => {})
}

beforeEach(async () => {
  await cleanup()
})

after(async () => {
  await cleanup()
  await pool.end()
})

test('buyer partial consumible refund requests stay manual-review and only executed quantities reduce redeemable amount', async () => {
  const empresaId = 'buyer-cons-emp-1'
  const compradorId = 'buyer-cons-cmp-1'
  const sessionId = 'buyer-cons-session-1'
  const eventoId = 'buyer-cons-evt-1'
  const barraId = 'buyer-cons-bar-1'
  const consumibleId = 'buyer-cons-product-1'
  const ventaId = 'buyer-cons-sale-1'
  const ventaItemId = 'buyer-cons-item-1'
  const slug = 'buyer-cons-1'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedConsumablesSession({
    sessionId,
    empresaId,
    compradorId,
    items: [{ consumibleId, consumibleName: 'Agua', quantity: 5, price: 300 }],
  })
  await seedConsumiblesContext({
    empresaId,
    eventoId,
    barraId,
    ventaId,
    checkoutSessionId: sessionId,
    compradorId,
    items: [{ consumibleId, ventaItemId, nombre: 'Agua', quantity: 5, price: 300 }],
  })

  const server = await createTestServer(buildApp())

  try {
    const created = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/consumibles-refund-requests`, buildCompradorUser(compradorId, empresaId, slug), {
      items: [{ venta_id: ventaId, venta_item_id: ventaItemId, quantity_requested: 2 }],
      reason: 'No voy a retirar todo',
      note: 'Solo necesito 3 unidades',
    })

    assert.equal(created.status, 201)
    assert.equal((created.data as any).case.request_origin, 'buyer_consumible_request')
    assert.equal((created.data as any).case.flow, 'consumibles')
    assert.equal((created.data as any).case.status, 'requested')
    assert.equal((created.data as any).consumible_items[0].venta_item_id, ventaItemId)
    assert.equal((created.data as any).consumible_items[0].quantity_requested, 2)
    assert.equal((created.data as any).consumible_items[0].status, 'requested')

    const beforeExecutionPreview = await requestJson('POST', `${server.baseUrl}/api/consumibles/canjear`, buildEmpresaUser(empresaId, slug), {
      codigo: `CV${ventaId.slice(-6).replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`,
      barra_id: barraId,
    })

    assert.equal(beforeExecutionPreview.status, 200)
    assert.equal((beforeExecutionPreview.data as any).ok, true)
    assert.equal((beforeExecutionPreview.data as any).items[0].cantidad, 5)

    const detail = await requestJson('GET', `${server.baseUrl}/api/reembolsos/${(created.data as any).case.id}`, buildEmpresaUser(empresaId, slug))
    assert.equal(detail.status, 200)
    assert.equal((detail.data as any).consumible_items[0].quantity_requested, 2)

    const buyerViewBeforeExecution = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}/mis-consumibles`, buildCompradorUser(compradorId, empresaId, slug))
    assert.equal(buyerViewBeforeExecution.status, 200)
    assert.equal((buyerViewBeforeExecution.data as any).data.ventas[0].items[0].refund.requested_quantity, 2)
    assert.equal((buyerViewBeforeExecution.data as any).data.ventas[0].items[0].refund.executed_quantity, 0)
    assert.equal((buyerViewBeforeExecution.data as any).data.ventas[0].items[0].refund.eligible_quantity, 3)
    assert.equal((buyerViewBeforeExecution.data as any).data.ventas[0].items[0].refund.existing_request.status, 'requested')

    const executed = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${(created.data as any).case.id}/execute`, buildEmpresaUser(empresaId, slug), {
      evidence_note: 'Acreditación manual validada por soporte',
      external_refund_reference: 'MANUAL-REF-1',
    })

    assert.equal(executed.status, 200, JSON.stringify(executed.data))
    assert.equal((executed.data as any).case.status, 'executed')
    assert.equal((executed.data as any).consumible_items[0].status, 'executed')
    assert.equal((executed.data as any).consumible_items[0].quantity_executed, 2)

    const afterExecutionPreview = await requestJson('POST', `${server.baseUrl}/api/consumibles/canjear`, buildEmpresaUser(empresaId, slug), {
      codigo: `CV${ventaId.slice(-6).replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`,
      barra_id: barraId,
    })

    assert.equal(afterExecutionPreview.status, 200)
    assert.equal((afterExecutionPreview.data as any).ok, true)
    assert.equal((afterExecutionPreview.data as any).items[0].cantidad, 3)

    const buyerView = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}/mis-consumibles`, buildCompradorUser(compradorId, empresaId, slug))
    assert.equal(buyerView.status, 200)
    assert.equal((buyerView.data as any).data.ventas[0].items[0].refund.executed_quantity, 2)
    assert.equal((buyerView.data as any).data.ventas[0].items[0].refund.eligible_quantity, 3)
    assert.equal((buyerView.data as any).data.ventas[0].items[0].refund.existing_request.status, 'executed')
  } finally {
    await server.close()
  }
})

test('buyer consumible refund rejects quantities above the remaining eligible amount', async () => {
  const empresaId = 'buyer-cons-emp-2'
  const compradorId = 'buyer-cons-cmp-2'
  const sessionId = 'buyer-cons-session-2'
  const eventoId = 'buyer-cons-evt-2'
  const barraId = 'buyer-cons-bar-2'
  const consumibleId = 'buyer-cons-product-2'
  const ventaId = 'buyer-cons-sale-2'
  const ventaItemId = 'buyer-cons-item-2'
  const slug = 'buyer-cons-2'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedConsumablesSession({
    sessionId,
    empresaId,
    compradorId,
    items: [{ consumibleId, consumibleName: 'Agua', quantity: 2, price: 300 }],
  })
  await seedConsumiblesContext({
    empresaId,
    eventoId,
    barraId,
    ventaId,
    checkoutSessionId: sessionId,
    compradorId,
    items: [{ consumibleId, ventaItemId, nombre: 'Agua', quantity: 2, price: 300 }],
  })

  const server = await createTestServer(buildApp())

  try {
    const response = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/consumibles-refund-requests`, buildCompradorUser(compradorId, empresaId, slug), {
      items: [{ venta_id: ventaId, venta_item_id: ventaItemId, quantity_requested: 3 }],
      reason: 'Pedí de más para probar validación',
    })

    assert.equal(response.status, 409)
    assert.equal((response.data as any).error, 'La cantidad solicitada supera el remanente elegible para reembolso')
  } finally {
    await server.close()
  }
})

test('buyer consumible refund is blocked when the bar disables final-buyer refund requests', async () => {
  const empresaId = 'buyer-cons-emp-bar-flag'
  const compradorId = 'buyer-cons-cmp-bar-flag'
  const sessionId = 'buyer-cons-session-bar-flag'
  const eventoId = 'buyer-cons-evt-bar-flag'
  const barraId = 'buyer-cons-bar-flag'
  const consumibleId = 'buyer-cons-product-bar-flag'
  const ventaId = 'buyer-cons-sale-bar-flag'
  const ventaItemId = 'buyer-cons-item-bar-flag'
  const slug = 'buyer-cons-bar-flag'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedConsumablesSession({
    sessionId,
    empresaId,
    compradorId,
    items: [{ consumibleId, consumibleName: 'Agua', quantity: 2, price: 300 }],
  })
  await seedConsumiblesContext({
    empresaId,
    eventoId,
    barraId,
    ventaId,
    checkoutSessionId: sessionId,
    compradorId,
    items: [{ consumibleId, ventaItemId, nombre: 'Agua', quantity: 2, price: 300 }],
  })
  await pool.query(`UPDATE barras SET buyer_consumible_refunds_enabled = false WHERE id = ?`, [barraId])

  const server = await createTestServer(buildApp())

  try {
    const response = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/consumibles-refund-requests`, buildCompradorUser(compradorId, empresaId, slug), {
      items: [{ venta_id: ventaId, venta_item_id: ventaItemId, quantity_requested: 1 }],
      reason: 'La barra no acepta reembolsos de comprador',
    })

    assert.equal(response.status, 409)
    assert.equal((response.data as any).error, 'Esta barra no acepta solicitudes de reembolso del comprador')

    const buyerView = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}/mis-consumibles`, buildCompradorUser(compradorId, empresaId, slug))
    assert.equal(buyerView.status, 200)
    assert.equal((buyerView.data as any).data.ventas[0].buyer_consumible_refunds_enabled, false)
  } finally {
    await server.close()
  }
})

test('rejected or non-refundable buyer consumible resolutions keep the requested quantity redeemable', async () => {
  const slug = 'buyer-cons-3'
  const empresaId = 'buyer-cons-emp-3'
  const compradorId = 'buyer-cons-cmp-3'
  const baseSessionId = 'buyer-cons-session-3'
  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })

  const scenarios = [
    {
      suffix: 'reject',
      resolutionPath: 'reject',
      resolutionBody: {
        reason: 'El comprador todavía puede retirar el pedido',
        note: 'Se rechazó el pedido de reembolso',
        evidence_note: 'Chat con soporte validado',
        external_refund_reference: 'MANUAL-REJECT-1',
      },
      expectedStatus: 'rejected',
    },
    {
      suffix: 'non-refundable',
      resolutionPath: 'resolve-non-refundable',
      resolutionBody: {
        reason: 'La política del evento no permite este reembolso',
        note: 'Se mantiene canjeable',
      },
      expectedStatus: 'resolved_non_refundable',
    },
  ] as const

  const server = await createTestServer(buildApp())

  try {
    for (const scenario of scenarios) {
      const sessionId = `${baseSessionId}-${scenario.suffix}`
      const eventoId = `buyer-cons-evt-3-${scenario.suffix}`
      const barraId = `buyer-cons-bar-3-${scenario.suffix}`
      const consumibleId = `buyer-cons-product-3-${scenario.suffix}`
      const ventaId = `buyer-cons-sale-3-${scenario.suffix}`
      const ventaItemId = `buyer-cons-item-3-${scenario.suffix}`

      await seedConfirmedConsumablesSession({
        sessionId,
        empresaId,
        compradorId,
        items: [{ consumibleId, consumibleName: `Agua ${scenario.suffix}`, quantity: 4, price: 250 }],
      })

      await seedConsumiblesContext({
        empresaId,
        eventoId,
        barraId,
        ventaId,
        checkoutSessionId: sessionId,
        compradorId,
        items: [{ consumibleId, ventaItemId, nombre: `Agua ${scenario.suffix}`, quantity: 4, price: 250 }],
      })

      const created = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/consumibles-refund-requests`, buildCompradorUser(compradorId, empresaId, slug), {
        items: [{ venta_id: ventaId, venta_item_id: ventaItemId, quantity_requested: 2 }],
        reason: `Refund ${scenario.suffix}`,
      })

      assert.equal(created.status, 201)

      const resolved = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${(created.data as any).case.id}/${scenario.resolutionPath}`, buildEmpresaUser(empresaId, slug), scenario.resolutionBody)

      assert.equal(resolved.status, 200, JSON.stringify(resolved.data))
      assert.equal((resolved.data as any).case.status, scenario.expectedStatus)
      assert.equal((resolved.data as any).consumible_items[0].status, scenario.expectedStatus)

      const preview = await requestJson('POST', `${server.baseUrl}/api/consumibles/canjear`, buildEmpresaUser(empresaId, slug), {
        codigo: `CV${ventaId.slice(-6).replace(/[^a-zA-Z0-9]/g, '').toUpperCase()}`,
        barra_id: barraId,
      })

      assert.equal(preview.status, 200)
      assert.equal((preview.data as any).ok, true)
      assert.equal((preview.data as any).items[0].cantidad, 4)

      const buyerView = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}/mis-consumibles`, buildCompradorUser(compradorId, empresaId, slug))
      const refund = (buyerView.data as any).data.ventas.find((venta: any) => venta.id === ventaId).items[0].refund

      assert.equal(buyerView.status, 200)
      assert.equal(refund.executed_quantity, 0)
      assert.equal(refund.eligible_quantity, 4)
      assert.equal(refund.existing_request.status, scenario.expectedStatus)
    }
  } finally {
    await server.close()
  }
})

test('employees with gestionar_consumibles can execute and reject buyer consumible refund cases only', async () => {
  const empresaId = 'buyer-cons-emp-4'
  const compradorId = 'buyer-cons-cmp-4'
  const empleadoId = 'buyer-cons-emp-user-4'
  const slug = 'buyer-cons-4'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await seedEmpleado({
    empleadoId,
    empresaId,
    permisos: { ver_dashboard: true, gestionar_consumibles: true },
  })

  const server = await createTestServer(buildApp())

  try {
    const saleA = {
      sessionId: 'buyer-cons-session-4-a',
      eventoId: 'buyer-cons-evt-4-a',
      barraId: 'buyer-cons-bar-4-a',
      consumibleId: 'buyer-cons-product-4-a',
      ventaId: 'buyer-cons-sale-4-a',
      ventaItemId: 'buyer-cons-item-4-a',
      quantity: 3,
      price: 500,
    }

    await seedConfirmedConsumablesSession({
      sessionId: saleA.sessionId,
      empresaId,
      compradorId,
      items: [{ consumibleId: saleA.consumibleId, consumibleName: 'Agua A', quantity: saleA.quantity, price: saleA.price }],
    })
    await seedConsumiblesContext({
      empresaId,
      eventoId: saleA.eventoId,
      barraId: saleA.barraId,
      ventaId: saleA.ventaId,
      checkoutSessionId: saleA.sessionId,
      compradorId,
      items: [{ consumibleId: saleA.consumibleId, ventaItemId: saleA.ventaItemId, nombre: 'Agua A', quantity: saleA.quantity, price: saleA.price }],
    })

    const createdForExecute = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/consumibles-refund-requests`, buildCompradorUser(compradorId, empresaId, slug), {
      items: [{ venta_id: saleA.ventaId, venta_item_id: saleA.ventaItemId, quantity_requested: 2 }],
      reason: 'No retiro todo A',
    })

    assert.equal(createdForExecute.status, 201)

    const executedByEmployee = await requestJson(
      'POST',
      `${server.baseUrl}/api/reembolsos/${(createdForExecute.data as any).case.id}/execute`,
      buildEmpleadoUser(empleadoId, empresaId, slug, { ver_dashboard: true, gestionar_consumibles: true }),
      {
        evidence_note: 'Validado por atención al cliente',
        external_refund_reference: 'MANUAL-EMP-EXEC-1',
      }
    )

    assert.equal(executedByEmployee.status, 200, JSON.stringify(executedByEmployee.data))
    assert.equal((executedByEmployee.data as any).case.status, 'executed')

    const saleB = {
      sessionId: 'buyer-cons-session-4-b',
      eventoId: 'buyer-cons-evt-4-b',
      barraId: 'buyer-cons-bar-4-b',
      consumibleId: 'buyer-cons-product-4-b',
      ventaId: 'buyer-cons-sale-4-b',
      ventaItemId: 'buyer-cons-item-4-b',
      quantity: 2,
      price: 750,
    }

    await seedConfirmedConsumablesSession({
      sessionId: saleB.sessionId,
      empresaId,
      compradorId,
      items: [{ consumibleId: saleB.consumibleId, consumibleName: 'Agua B', quantity: saleB.quantity, price: saleB.price }],
    })
    await seedConsumiblesContext({
      empresaId,
      eventoId: saleB.eventoId,
      barraId: saleB.barraId,
      ventaId: saleB.ventaId,
      checkoutSessionId: saleB.sessionId,
      compradorId,
      items: [{ consumibleId: saleB.consumibleId, ventaItemId: saleB.ventaItemId, nombre: 'Agua B', quantity: saleB.quantity, price: saleB.price }],
    })

    const createdForReject = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/consumibles-refund-requests`, buildCompradorUser(compradorId, empresaId, slug), {
      items: [{ venta_id: saleB.ventaId, venta_item_id: saleB.ventaItemId, quantity_requested: 1 }],
      reason: 'No retiro todo B',
    })

    assert.equal(createdForReject.status, 201)

    const rejectedByEmployee = await requestJson(
      'POST',
      `${server.baseUrl}/api/reembolsos/${(createdForReject.data as any).case.id}/reject`,
      buildEmpleadoUser(empleadoId, empresaId, slug, { ver_dashboard: true, gestionar_consumibles: true }),
      {
        reason: 'El comprador todavía puede retirar el pedido',
        evidence_note: 'Soporte confirmó disponibilidad',
      }
    )

    assert.equal(rejectedByEmployee.status, 200, JSON.stringify(rejectedByEmployee.data))
    assert.equal((rejectedByEmployee.data as any).case.status, 'rejected')

    const createManualCase = await requestJson(
      'POST',
      `${server.baseUrl}/api/reembolsos`,
      buildEmpleadoUser(empleadoId, empresaId, slug, { ver_dashboard: true, gestionar_consumibles: true }),
      {
        checkout_session_id: saleB.sessionId,
        reason: 'Intento manual sin permiso',
      }
    )

    assert.equal(createManualCase.status, 403)
  } finally {
    await server.close()
  }
})

test('buyer consumible refunds can execute distinct lines from the same sale while still blocking duplicate quantity on the same line', async () => {
  const empresaId = 'buyer-cons-emp-5'
  const compradorId = 'buyer-cons-cmp-5'
  const sessionId = 'buyer-cons-session-5'
  const eventoId = 'buyer-cons-evt-5'
  const barraId = 'buyer-cons-bar-5'
  const ventaId = 'buyer-cons-sale-5'
  const slug = 'buyer-cons-5'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedConsumablesSession({
    sessionId,
    empresaId,
    compradorId,
    items: [
      { consumibleId: 'buyer-cons-product-5-a', consumibleName: 'A', quantity: 1, price: 250 },
      { consumibleId: 'buyer-cons-product-5-b', consumibleName: 'B', quantity: 1, price: 400 },
      { consumibleId: 'buyer-cons-product-5-c', consumibleName: 'C', quantity: 1, price: 550 },
    ],
  })
  await seedConsumiblesContext({
    empresaId,
    eventoId,
    barraId,
    ventaId,
    checkoutSessionId: sessionId,
    compradorId,
    items: [
      { consumibleId: 'buyer-cons-product-5-a', ventaItemId: 'buyer-cons-item-5-a', nombre: 'A', quantity: 1, price: 250 },
      { consumibleId: 'buyer-cons-product-5-b', ventaItemId: 'buyer-cons-item-5-b', nombre: 'B', quantity: 1, price: 400 },
      { consumibleId: 'buyer-cons-product-5-c', ventaItemId: 'buyer-cons-item-5-c', nombre: 'C', quantity: 1, price: 550 },
    ],
  })

  const server = await createTestServer(buildApp())

  try {
    const firstCreated = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/consumibles-refund-requests`, buildCompradorUser(compradorId, empresaId, slug), {
      items: [{ venta_id: ventaId, venta_item_id: 'buyer-cons-item-5-c', quantity_requested: 1 }],
      reason: 'No retiro C',
    })

    assert.equal(firstCreated.status, 201)

    const firstExecuted = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${(firstCreated.data as any).case.id}/execute`, buildEmpresaUser(empresaId, slug), {
      evidence_note: 'Refund manual validado para C',
      external_refund_reference: 'MANUAL-REF-5-C',
    })

    assert.equal(firstExecuted.status, 200, JSON.stringify(firstExecuted.data))
    assert.equal((firstExecuted.data as any).case.status, 'executed')
    assert.equal((firstExecuted.data as any).consumible_items[0].venta_item_id, 'buyer-cons-item-5-c')

    const duplicateSameLine = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/consumibles-refund-requests`, buildCompradorUser(compradorId, empresaId, slug), {
      items: [{ venta_id: ventaId, venta_item_id: 'buyer-cons-item-5-c', quantity_requested: 1 }],
      reason: 'Intento duplicado sobre C',
    })

    assert.equal(duplicateSameLine.status, 409)
    assert.equal((duplicateSameLine.data as any).error, 'La cantidad solicitada supera el remanente elegible para reembolso')

    const secondCreated = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/consumibles-refund-requests`, buildCompradorUser(compradorId, empresaId, slug), {
      items: [{ venta_id: ventaId, venta_item_id: 'buyer-cons-item-5-b', quantity_requested: 1 }],
      reason: 'No retiro B',
    })

    assert.equal(secondCreated.status, 201, JSON.stringify(secondCreated.data))

    const secondExecuted = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${(secondCreated.data as any).case.id}/execute`, buildEmpresaUser(empresaId, slug), {
      evidence_note: 'Refund manual validado para B',
      external_refund_reference: 'MANUAL-REF-5-B',
    })

    assert.equal(secondExecuted.status, 200, JSON.stringify(secondExecuted.data))
    assert.equal((secondExecuted.data as any).case.status, 'executed')
    assert.equal((secondExecuted.data as any).consumible_items[0].venta_item_id, 'buyer-cons-item-5-b')

    const buyerView = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}/mis-consumibles`, buildCompradorUser(compradorId, empresaId, slug))
    assert.equal(buyerView.status, 200)

    const venta = (buyerView.data as any).data.ventas.find((item: any) => item.id === ventaId)
    assert.equal(venta.items.find((item: any) => item.venta_item_id === 'buyer-cons-item-5-a').refund.executed_quantity, 0)
    assert.equal(venta.items.find((item: any) => item.venta_item_id === 'buyer-cons-item-5-b').refund.executed_quantity, 1)
    assert.equal(venta.items.find((item: any) => item.venta_item_id === 'buyer-cons-item-5-c').refund.executed_quantity, 1)
  } finally {
    await server.close()
  }
})

// Regression coverage for audit finding A (stock never restored on buyer-consumible refunds) —
// see refund-manual.ts executeRefundManualCase, `flow === 'consumibles'` branch, ~line 2414-2452.
test('buyer consumible refund execution restores barra_stock by the refunded quantity (full and partial), respecting the stock_ilimitado guard', async () => {
  const empresaId = 'buyer-cons-emp-6'
  const compradorId = 'buyer-cons-cmp-6'
  const sessionId = 'buyer-cons-session-6'
  const eventoId = 'buyer-cons-evt-6'
  const barraId = 'buyer-cons-bar-6'
  const ventaId = 'buyer-cons-sale-6'
  const slug = 'buyer-cons-6'

  const fullProductId = 'buyer-cons-product-6-full'
  const partialProductId = 'buyer-cons-product-6-partial'
  const unlimitedProductId = 'buyer-cons-product-6-unlimited'
  const fullItemId = 'buyer-cons-item-6-full'
  const partialItemId = 'buyer-cons-item-6-partial'
  const unlimitedItemId = 'buyer-cons-item-6-unlimited'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedConsumablesSession({
    sessionId,
    empresaId,
    compradorId,
    items: [
      { consumibleId: fullProductId, consumibleName: 'Full', quantity: 5, price: 300 },
      { consumibleId: partialProductId, consumibleName: 'Partial', quantity: 5, price: 300 },
      { consumibleId: unlimitedProductId, consumibleName: 'Unlimited', quantity: 4, price: 200 },
    ],
  })
  await seedConsumiblesContext({
    empresaId,
    eventoId,
    barraId,
    ventaId,
    checkoutSessionId: sessionId,
    compradorId,
    items: [
      { consumibleId: fullProductId, ventaItemId: fullItemId, nombre: 'Full', quantity: 5, price: 300 },
      { consumibleId: partialProductId, ventaItemId: partialItemId, nombre: 'Partial', quantity: 5, price: 300 },
      { consumibleId: unlimitedProductId, ventaItemId: unlimitedItemId, nombre: 'Unlimited', quantity: 4, price: 200 },
    ],
  })

  // The "unlimited" line never decremented stock at sale time — mark it stock_ilimitado so the
  // refund path must skip restoring it too (the fix explicitly guards `stock_ilimitado = false`).
  await pool.query(`UPDATE barra_stock SET stock_ilimitado = true WHERE barra_id = ? AND consumible_id = ?`, [barraId, unlimitedProductId])

  const server = await createTestServer(buildApp())

  try {
    // `createBuyerConsumibleRefundRequest` allows only ONE open request per SALE at a time, so
    // each line below is requested and executed before the next line's request is created.
    const createdFull = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/consumibles-refund-requests`, buildCompradorUser(compradorId, empresaId, slug), {
      items: [{ venta_id: ventaId, venta_item_id: fullItemId, quantity_requested: 5 }],
      reason: 'Devuelvo todo el producto Full',
    })
    assert.equal(createdFull.status, 201)

    const executedFull = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${(createdFull.data as any).case.id}/execute`, buildEmpresaUser(empresaId, slug), {
      evidence_note: 'Refund manual validado (full)',
      external_refund_reference: 'MANUAL-REF-6-FULL',
    })
    assert.equal(executedFull.status, 200, JSON.stringify(executedFull.data))
    assert.equal((executedFull.data as any).case.status, 'executed')
    assert.equal((executedFull.data as any).consumible_items[0].quantity_executed, 5)

    const createdPartial = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/consumibles-refund-requests`, buildCompradorUser(compradorId, empresaId, slug), {
      items: [{ venta_id: ventaId, venta_item_id: partialItemId, quantity_requested: 2 }],
      reason: 'Devuelvo parte del producto Partial',
    })
    assert.equal(createdPartial.status, 201)

    const executedPartial = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${(createdPartial.data as any).case.id}/execute`, buildEmpresaUser(empresaId, slug), {
      evidence_note: 'Refund manual validado (partial)',
      external_refund_reference: 'MANUAL-REF-6-PARTIAL',
    })
    assert.equal(executedPartial.status, 200, JSON.stringify(executedPartial.data))
    assert.equal((executedPartial.data as any).case.status, 'executed')
    assert.equal((executedPartial.data as any).consumible_items[0].quantity_executed, 2)

    const createdUnlimited = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/consumibles-refund-requests`, buildCompradorUser(compradorId, empresaId, slug), {
      items: [{ venta_id: ventaId, venta_item_id: unlimitedItemId, quantity_requested: 4 }],
      reason: 'Devuelvo todo el producto Unlimited',
    })
    assert.equal(createdUnlimited.status, 201)

    const executedUnlimited = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${(createdUnlimited.data as any).case.id}/execute`, buildEmpresaUser(empresaId, slug), {
      evidence_note: 'Refund manual validado (unlimited)',
      external_refund_reference: 'MANUAL-REF-6-UNLIMITED',
    })
    assert.equal(executedUnlimited.status, 200, JSON.stringify(executedUnlimited.data))
    assert.equal((executedUnlimited.data as any).case.status, 'executed')
    assert.equal((executedUnlimited.data as any).consumible_items[0].quantity_executed, 4)

    const [fullStock] = await pool.query<any[]>(`SELECT stock_actual FROM barra_stock WHERE barra_id = ? AND consumible_id = ?`, [barraId, fullProductId])
    const [partialStock] = await pool.query<any[]>(`SELECT stock_actual FROM barra_stock WHERE barra_id = ? AND consumible_id = ?`, [barraId, partialProductId])
    const [unlimitedStock] = await pool.query<any[]>(`SELECT stock_actual FROM barra_stock WHERE barra_id = ? AND consumible_id = ?`, [barraId, unlimitedProductId])

    // Full refund of a 5-unit line: stock_actual goes back to its original value (45 + 5 = 50 = stock_inicial).
    assert.equal(Number(fullStock[0].stock_actual), 50)
    // Partial refund of 2 out of 5 units: only the EXECUTED quantity comes back, not the whole
    // order (45 + 2 = 47, NOT 45 + 5 = 50).
    assert.equal(Number(partialStock[0].stock_actual), 47)
    // stock_ilimitado = true: the line was never decremented at sale time, so the refund must NOT
    // touch stock_actual even though the case executes successfully.
    assert.equal(Number(unlimitedStock[0].stock_actual), 45)
  } finally {
    await server.close()
  }
})

// Regression coverage for audit finding B (a sale redeemed at the bar between refund-request and
// refund-execution could be refunded AND delivered — double benefit). See refund-manual.ts
// `guardRefundExecutionByPaymentState`, `redemptionCheckSaleIds` (~line 1329-1348) feeding
// `getRefundExecutionConsumibleConflict` (~line 1421-1424). Also guards against a regression of
// the "distinct lines from the same sale" coexistence covered by the test above (~line 627):
// an already-executed line on the sale must stay untouched when a LATER line gets blocked.
test('buyer consumible refund execution is auto-rejected once the sale is redeemed (canjeado) before execution, without disturbing an already-executed distinct line or double-restoring stock', async () => {
  const empresaId = 'buyer-cons-emp-7'
  const compradorId = 'buyer-cons-cmp-7'
  const sessionId = 'buyer-cons-session-7'
  const eventoId = 'buyer-cons-evt-7'
  const barraId = 'buyer-cons-bar-7'
  const ventaId = 'buyer-cons-sale-7'
  const slug = 'buyer-cons-7'

  const productXId = 'buyer-cons-product-7-x'
  const productYId = 'buyer-cons-product-7-y'
  const itemXId = 'buyer-cons-item-7-x'
  const itemYId = 'buyer-cons-item-7-y'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedConsumablesSession({
    sessionId,
    empresaId,
    compradorId,
    items: [
      { consumibleId: productXId, consumibleName: 'X', quantity: 1, price: 300 },
      { consumibleId: productYId, consumibleName: 'Y', quantity: 1, price: 400 },
    ],
  })
  await seedConsumiblesContext({
    empresaId,
    eventoId,
    barraId,
    ventaId,
    checkoutSessionId: sessionId,
    compradorId,
    items: [
      { consumibleId: productXId, ventaItemId: itemXId, nombre: 'X', quantity: 1, price: 300 },
      { consumibleId: productYId, ventaItemId: itemYId, nombre: 'Y', quantity: 1, price: 400 },
    ],
  })

  const server = await createTestServer(buildApp())

  try {
    // Line X is requested and executed while the sale is still 'pendiente' — this is the same
    // "distinct lines from the same sale" shape as the test at line ~627 and MUST keep working.
    const createdX = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/consumibles-refund-requests`, buildCompradorUser(compradorId, empresaId, slug), {
      items: [{ venta_id: ventaId, venta_item_id: itemXId, quantity_requested: 1 }],
      reason: 'No retiro X',
    })
    assert.equal(createdX.status, 201)

    const executedX = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${(createdX.data as any).case.id}/execute`, buildEmpresaUser(empresaId, slug), {
      evidence_note: 'Refund manual validado para X',
      external_refund_reference: 'MANUAL-REF-7-X',
    })
    assert.equal(executedX.status, 200, JSON.stringify(executedX.data))
    assert.equal((executedX.data as any).case.status, 'executed')
    assert.equal((executedX.data as any).consumible_items[0].quantity_executed, 1)

    const [afterXStock] = await pool.query<any[]>(`SELECT stock_actual FROM barra_stock WHERE barra_id = ? AND consumible_id = ?`, [barraId, productXId])
    assert.equal(Number(afterXStock[0].stock_actual), 46)

    // Line Y is requested but NOT executed yet.
    const createdY = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/consumibles-refund-requests`, buildCompradorUser(compradorId, empresaId, slug), {
      items: [{ venta_id: ventaId, venta_item_id: itemYId, quantity_requested: 1 }],
      reason: 'No retiro Y',
    })
    assert.equal(createdY.status, 201)

    // The buyer physically redeems the sale at the bar BETWEEN Y's refund request and its
    // execution. X's line is already refunded to 0 units, so only Y is still redeemable —
    // `confirmar` delivers Y and flips the whole sale to 'canjeado'.
    const redeemed = await requestJson('POST', `${server.baseUrl}/api/consumibles/canjear`, buildEmpresaUser(empresaId, slug), {
      barra_id: barraId,
      venta_id: ventaId,
      accion: 'confirmar',
    })
    assert.equal(redeemed.status, 200, JSON.stringify(redeemed.data))
    assert.equal((redeemed.data as any).estado, 'canjeado')

    // Executing Y's refund now MUST be auto-rejected — the comprador already got the product at
    // the bar; paying the refund too would be a double benefit (audit finding B).
    const executedY = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${(createdY.data as any).case.id}/execute`, buildEmpresaUser(empresaId, slug), {
      evidence_note: 'Intento de refund manual para Y',
      external_refund_reference: 'MANUAL-REF-7-Y',
    })

    assert.equal(executedY.status, 200, JSON.stringify(executedY.data))
    assert.equal((executedY.data as any).case.status, 'rejected')
    assert.equal((executedY.data as any).consumible_items[0].status, 'rejected')
    assert.equal((executedY.data as any).consumible_items[0].quantity_executed, 0)

    // Stock for Y must NOT have been restored (no double benefit), and X's earlier restore must
    // remain exactly as it was — the two cases must coexist without cross-contamination.
    const [finalXStock] = await pool.query<any[]>(`SELECT stock_actual FROM barra_stock WHERE barra_id = ? AND consumible_id = ?`, [barraId, productXId])
    const [finalYStock] = await pool.query<any[]>(`SELECT stock_actual FROM barra_stock WHERE barra_id = ? AND consumible_id = ?`, [barraId, productYId])
    assert.equal(Number(finalXStock[0].stock_actual), 46)
    assert.equal(Number(finalYStock[0].stock_actual), 45)

    // The sale stays 'canjeado' and X's already-executed case is untouched by Y's rejection.
    const [saleRows] = await pool.query<any[]>(`SELECT estado FROM consumibles_ventas WHERE id = ?`, [ventaId])
    assert.equal(saleRows[0].estado, 'canjeado')

    const executedXDetail = await requestJson('GET', `${server.baseUrl}/api/reembolsos/${(createdX.data as any).case.id}`, buildEmpresaUser(empresaId, slug))
    assert.equal(executedXDetail.status, 200)
    assert.equal((executedXDetail.data as any).case.status, 'executed')
  } finally {
    await server.close()
  }
})

// Same audit-finding-B guard, but for the OTHER blocked estado (`resuelto_parcial`) covered by
// getRefundExecutionConsumibleConflict's `estado IN ('canjeado', 'resuelto_parcial')`. Simulating
// an in-venue partial resolution end-to-end would require a live Mercado Pago account, so the
// intermediate 'resuelto_parcial' state is set directly on the fixture (documented deviation).
test('buyer consumible refund execution is auto-rejected when the sale is resuelto_parcial before execution', async () => {
  const empresaId = 'buyer-cons-emp-8'
  const compradorId = 'buyer-cons-cmp-8'
  const sessionId = 'buyer-cons-session-8'
  const eventoId = 'buyer-cons-evt-8'
  const barraId = 'buyer-cons-bar-8'
  const consumibleId = 'buyer-cons-product-8'
  const ventaId = 'buyer-cons-sale-8'
  const ventaItemId = 'buyer-cons-item-8'
  const slug = 'buyer-cons-8'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId })
  await seedConfirmedConsumablesSession({
    sessionId,
    empresaId,
    compradorId,
    items: [{ consumibleId, consumibleName: 'Agua', quantity: 4, price: 250 }],
  })
  await seedConsumiblesContext({
    empresaId,
    eventoId,
    barraId,
    ventaId,
    checkoutSessionId: sessionId,
    compradorId,
    items: [{ consumibleId, ventaItemId, nombre: 'Agua', quantity: 4, price: 250 }],
  })

  const server = await createTestServer(buildApp())

  try {
    const created = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/consumibles-refund-requests`, buildCompradorUser(compradorId, empresaId, slug), {
      items: [{ venta_id: ventaId, venta_item_id: ventaItemId, quantity_requested: 2 }],
      reason: 'No retiro todo',
    })
    assert.equal(created.status, 201)

    // Simulate an in-venue partial resolution (some units delivered, some marked stock-shortage)
    // landing the sale in 'resuelto_parcial' BETWEEN the buyer's refund request and its execution.
    await pool.query(`UPDATE consumibles_ventas SET estado = 'resuelto_parcial', resuelto_at = NOW() WHERE id = ?`, [ventaId])

    const [stockBeforeExecute] = await pool.query<any[]>(`SELECT stock_actual FROM barra_stock WHERE barra_id = ? AND consumible_id = ?`, [barraId, consumibleId])
    assert.equal(Number(stockBeforeExecute[0].stock_actual), 45)

    const executed = await requestJson('POST', `${server.baseUrl}/api/reembolsos/${(created.data as any).case.id}/execute`, buildEmpresaUser(empresaId, slug), {
      evidence_note: 'Intento de refund manual sobre venta resuelta parcialmente',
      external_refund_reference: 'MANUAL-REF-8',
    })

    assert.equal(executed.status, 200, JSON.stringify(executed.data))
    assert.equal((executed.data as any).case.status, 'rejected')
    assert.equal((executed.data as any).consumible_items[0].status, 'rejected')
    assert.equal((executed.data as any).consumible_items[0].quantity_executed, 0)

    const [stockAfterExecute] = await pool.query<any[]>(`SELECT stock_actual FROM barra_stock WHERE barra_id = ? AND consumible_id = ?`, [barraId, consumibleId])
    assert.equal(Number(stockAfterExecute[0].stock_actual), 45)

    const [saleRows] = await pool.query<any[]>(`SELECT estado FROM consumibles_ventas WHERE id = ?`, [ventaId])
    assert.equal(saleRows[0].estado, 'resuelto_parcial')
  } finally {
    await server.close()
  }
})
