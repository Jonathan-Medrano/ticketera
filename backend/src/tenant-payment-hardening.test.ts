import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { Payment } from 'mercadopago'

process.env.INTERNAL_API_SECRET = 'test-internal-secret'
process.env.PAYMENT_ACCOUNTS_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
process.env.MARKETPLACE_FEE_MODE = 'percentage'
process.env.MARKETPLACE_FEE_PERCENTAGE = '12.5'
process.env.MERCADOPAGO_SKIP_WEBHOOK_SIGNATURE = 'true'

import pool from './db'
import tenantRouter from './routes/tenant'
import { upsertPaymentAccountByEmpresaId } from './lib/payment-accounts'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalPaymentGet = Payment.prototype.get
const originalFetch = globalThis.fetch

function buildHeaders(user: Record<string, unknown> | null = null) {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
    'x-user': JSON.stringify(user),
  }
}

function buildCompradorSessionUser({ compradorId, empresaId, slug, email }: { compradorId: string; empresaId: string; slug: string; email: string }) {
  return {
    id: compradorId,
    email,
    empresa_id: empresaId,
    empresa_slug: slug,
    slug,
    userType: 'comprador' as const,
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

async function requestJson(method: 'POST', url: string, body: unknown, user: Record<string, unknown> | null) {
  const response = await originalFetch(url, {
    method,
    headers: buildHeaders(user),
    body: JSON.stringify(body),
  })

  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function requestWebhook(url: string, body: unknown) {
  const response = await originalFetch(url, {
    method: 'POST',
    headers: buildHeaders(null),
    body: JSON.stringify(body),
  })

  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function requestRaw(url: string) {
  return originalFetch(url, {
    method: 'GET',
    headers: buildHeaders(null),
    redirect: 'manual',
  })
}

async function requestGetJson(url: string) {
  const response = await originalFetch(url, {
    method: 'GET',
    headers: buildHeaders(null),
  })

  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function seedEmpresa({ empresaId, slug }: { empresaId: string; slug: string }) {
  await pool.query(
    `INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
     VALUES (?, ?, ?, ?, ?, ?, true)`,
    [empresaId, `Empresa ${slug}`, slug, `${slug}@example.com`, TEST_PASSWORD_HASH, `Admin ${slug}`]
  )
}

async function seedComprador({ compradorId, empresaId, email }: { compradorId: string; empresaId: string; email: string }) {
  await pool.query(
    `INSERT INTO compradores (id, empresa_id, nombre, email, dni, password)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [compradorId, empresaId, `Comprador ${compradorId}`, email, `dni-${compradorId.slice(-16)}`, TEST_PASSWORD_HASH]
  )
}

async function seedEventoConCategoria({ eventoId, empresaId, categoriaId, precio }: { eventoId: string; empresaId: string; categoriaId: string; precio: number }) {
  await pool.query(
    `INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo)
     VALUES (?, ?, ?, NULL, NULL, 'unica', NULL, true)`,
    [eventoId, empresaId, `Evento ${eventoId}`]
  )

  await pool.query(
    `INSERT INTO entrada_categorias (id, evento_id, tanda_id, nombre, descripcion, precio, stock, stock_disponible, activa)
     VALUES (?, ?, NULL, ?, NULL, ?, 10, 10, true)`,
    [categoriaId, eventoId, `Categoría ${categoriaId}`, precio]
  )
}

async function cleanup() {
  await pool.query(`DELETE FROM login_tokens WHERE id LIKE 'phase-payhard-token-%' OR comprador_id LIKE 'phase-payhard-cmp-%' OR empresa_slug LIKE 'phase-payhard-%'`)
  await pool.query(`DELETE FROM entradas WHERE evento_id LIKE 'phase-payhard-evt-%' OR comprador_id LIKE 'phase-payhard-cmp-%'`)
  await pool.query(`DELETE FROM checkout_sessions WHERE empresa_id LIKE 'phase-payhard-emp-%' OR comprador_id LIKE 'phase-payhard-cmp-%'`)
  await pool.query(`DELETE FROM entrada_categorias WHERE id LIKE 'phase-payhard-cat-%' OR evento_id LIKE 'phase-payhard-evt-%'`)
  await pool.query(`DELETE FROM evento_fechas WHERE evento_id LIKE 'phase-payhard-evt-%'`)
  await pool.query(`DELETE FROM evento_tandas WHERE evento_id LIKE 'phase-payhard-evt-%'`)
  await pool.query(`DELETE FROM eventos WHERE id LIKE 'phase-payhard-evt-%' OR empresa_id LIKE 'phase-payhard-emp-%'`)
  await pool.query(`DELETE FROM compradores WHERE id LIKE 'phase-payhard-cmp-%' OR empresa_id LIKE 'phase-payhard-emp-%'`)
  await pool.query(`DELETE FROM empresa_payment_accounts WHERE empresa_id LIKE 'phase-payhard-emp-%'`)
  await pool.query(`DELETE FROM empresas WHERE id LIKE 'phase-payhard-emp-%' OR slug LIKE 'phase-payhard-%'`)
}

beforeEach(async () => {
  Payment.prototype.get = originalPaymentGet
  globalThis.fetch = originalFetch
  await cleanup()
})

after(async () => {
  Payment.prototype.get = originalPaymentGet
  globalThis.fetch = originalFetch
  await cleanup()
  await pool.end()
})

test('tenant payment confirmation rejects authenticated buyer from another session owner', async () => {
  const empresaId = 'phase-payhard-emp-1'
  const slug = 'phase-payhard-1'
  const compradorId = 'phase-payhard-cmp-owner'
  const atacanteId = 'phase-payhard-cmp-attacker'
  const categoriaId = 'phase-payhard-cat-1'
  const eventoId = 'phase-payhard-evt-1'
  const ownerEmail = 'phase-payhard-owner@example.com'
  const attackerEmail = 'phase-payhard-attacker@example.com'
  const sessionId = 'phase-payhard-session-1'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, email: ownerEmail })
  await seedComprador({ compradorId: atacanteId, empresaId, email: attackerEmail })
  await seedEventoConCategoria({ eventoId, empresaId, categoriaId, precio: 100 })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-PAYHARD-1111' })

  await pool.query(
    `INSERT INTO checkout_sessions (id, comprador_id, empresa_id, datos, estado, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'reservada', NOW() + INTERVAL '10 minutes', NOW())`,
    [
      sessionId,
      compradorId,
      empresaId,
      JSON.stringify({
        items: [{ categoriaId, eventoId, categoriaNombre: 'General', eventoNombre: 'Evento Confirm', precio: 100, cantidad: 1 }],
        marketplaceFee: { amount: 12.5, currency: 'ARS', metadata: { mode: 'percentage', percentage: 12.5, percentageAmount: 12.5, fixedAmount: null, source: 'env' } },
        confirmationToken: 'ct-owner-1',
      }),
    ]
  )

  Payment.prototype.get = async function () {
    return {
      status: 'approved',
      external_reference: sessionId,
      transaction_amount: 100,
    } as any
  }

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      'POST',
      `${server.baseUrl}/api/tenant/${slug}/pago/confirmar`,
      { sessionId, paymentId: 'payment-123' },
      buildCompradorSessionUser({ compradorId: atacanteId, empresaId, slug, email: attackerEmail })
    )

    assert.equal(response.status, 403)
    assert.equal(response.data.error, 'La sesión no pertenece al usuario autenticado')
    assert.equal(response.data.reason, 'session_owner_mismatch')
  } finally {
    await server.close()
  }
})

test('tenant payment confirmation redirect rejects wrong confirmation token', async () => {
  const empresaId = 'phase-payhard-emp-2'
  const slug = 'phase-payhard-2'
  const compradorId = 'phase-payhard-cmp-2'
  const categoriaId = 'phase-payhard-cat-2'
  const eventoId = 'phase-payhard-evt-2'
  const buyerEmail = 'phase-payhard-buyer@example.com'
  const sessionId = 'phase-payhard-session-2'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, email: buyerEmail })
  await seedEventoConCategoria({ eventoId, empresaId, categoriaId, precio: 100 })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-PAYHARD-2222' })

  await pool.query(
    `INSERT INTO checkout_sessions (id, comprador_id, empresa_id, datos, estado, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'reservada', NOW() + INTERVAL '10 minutes', NOW())`,
    [
      sessionId,
      compradorId,
      empresaId,
      JSON.stringify({
        items: [{ categoriaId, eventoId, categoriaNombre: 'General', eventoNombre: 'Evento Confirm', precio: 100, cantidad: 1 }],
        marketplaceFee: { amount: 12.5, currency: 'ARS', metadata: { mode: 'percentage', percentage: 12.5, percentageAmount: 12.5, fixedAmount: null, source: 'env' } },
        confirmationToken: 'ct-valid-2',
      }),
    ]
  )

  Payment.prototype.get = async function () {
    return {
      status: 'approved',
      external_reference: sessionId,
      transaction_amount: 100,
    } as any
  }

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestRaw(
      `${server.baseUrl}/api/tenant/${slug}/pago/confirmar-redirect?session=${sessionId}&payment_id=payment-456&status=approved&ct=forged-token`
    )

    assert.equal(response.status, 302)
    assert.equal(response.headers.get('location'), `https://${slug}.Ticketera.com/pago/error?reason=confirmation_token_mismatch`)
  } finally {
    await server.close()
  }
})

test('tenant checkout rejects non-comprador sessions before reserving stock', async () => {
  const empresaId = 'phase-payhard-emp-3'
  const slug = 'phase-payhard-3'
  const compradorId = 'phase-payhard-cmp-3'
  const categoriaId = 'phase-payhard-cat-3'
  const eventoId = 'phase-payhard-evt-3'
  const buyerEmail = 'phase-payhard-buyer-3@example.com'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, email: buyerEmail })
  await seedEventoConCategoria({ eventoId, empresaId, categoriaId, precio: 120 })

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      'POST',
      `${server.baseUrl}/api/tenant/${slug}/checkout`,
      { items: [{ categoriaId, eventoId, cantidad: 1 }] },
      {
        id: 'phase-payhard-empactor-3',
        email: 'empresa@example.com',
        userType: 'empresa',
        slug,
      }
    )

    assert.equal(response.status, 401)
    assert.equal(response.data.error, 'No autorizado')

    const [rows] = await pool.query<any[]>(`SELECT COUNT(*) as total FROM checkout_sessions WHERE empresa_id = ?`, [empresaId])
    assert.equal(rows[0].total, 0)
  } finally {
    await server.close()
  }
})

test('late approved payment is marked for review instead of silently expiring and losing reconciliation', async () => {
  const empresaId = 'phase-payhard-emp-4'
  const slug = 'phase-payhard-4'
  const compradorId = 'phase-payhard-cmp-4'
  const categoriaId = 'phase-payhard-cat-4'
  const eventoId = 'phase-payhard-evt-4'
  const buyerEmail = 'phase-payhard-buyer-4@example.com'
  const sessionId = 'phase-payhard-session-4'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, email: buyerEmail })
  await seedEventoConCategoria({ eventoId, empresaId, categoriaId, precio: 100 })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-PAYHARD-4444' })

  await pool.query(
    `INSERT INTO checkout_sessions (id, comprador_id, empresa_id, datos, estado, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'reservada', NOW() - INTERVAL '1 minute', NOW())`,
    [
      sessionId,
      compradorId,
      empresaId,
      JSON.stringify({
        items: [{ categoriaId, eventoId, categoriaNombre: 'General', eventoNombre: 'Evento Confirm', precio: 100, cantidad: 1 }],
        marketplaceFee: { amount: 12.5, currency: 'ARS', metadata: { mode: 'percentage', percentage: 12.5, percentageAmount: 12.5, fixedAmount: null, source: 'env' } },
        confirmationToken: 'ct-late-4',
      }),
    ]
  )

  Payment.prototype.get = async function () {
    return {
      status: 'approved',
      external_reference: sessionId,
      transaction_amount: 100,
    } as any
  }

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      'POST',
      `${server.baseUrl}/api/tenant/${slug}/pago/confirmar`,
      { sessionId, paymentId: 'payment-late-4' },
      buildCompradorSessionUser({ compradorId, empresaId, slug, email: buyerEmail })
    )

    assert.equal(response.status, 409)
    assert.equal(response.data.reason, 'approved_after_expiry')

    const [rows] = await pool.query<any[]>(
      `SELECT estado, reconciliation_status, reconciliation_note, payment_id, payment_status
       FROM checkout_sessions WHERE id = ?`,
      [sessionId]
    )
    assert.equal(rows[0].estado, 'reservada')
    assert.equal(rows[0].reconciliation_status, 'needs_review')
    assert.equal(rows[0].reconciliation_note, 'approved_after_expiry')
    assert.equal(rows[0].payment_id, 'payment-late-4')
    assert.equal(rows[0].payment_status, 'approved')
  } finally {
    await server.close()
  }
})

test('payment webhook reconciles approved payment server-to-server', async () => {
  const empresaId = 'phase-payhard-emp-5'
  const slug = 'phase-payhard-5'
  const compradorId = 'phase-payhard-cmp-5'
  const categoriaId = 'phase-payhard-cat-5'
  const eventoId = 'phase-payhard-evt-5'
  const buyerEmail = 'phase-payhard-buyer-5@example.com'
  const sessionId = 'phase-payhard-session-5'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, email: buyerEmail })
  await seedEventoConCategoria({ eventoId, empresaId, categoriaId, precio: 100 })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-PAYHARD-5555' })

  await pool.query(
    `INSERT INTO checkout_sessions (id, comprador_id, empresa_id, datos, estado, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'reservada', NOW() + INTERVAL '10 minutes', NOW())`,
    [
      sessionId,
      compradorId,
      empresaId,
      JSON.stringify({
        items: [{ categoriaId, eventoId, categoriaNombre: 'General', eventoNombre: 'Evento Confirm', precio: 100, cantidad: 1 }],
        marketplaceFee: { amount: 12.5, currency: 'ARS', metadata: { mode: 'percentage', percentage: 12.5, percentageAmount: 12.5, fixedAmount: null, source: 'env' } },
        confirmationToken: 'ct-webhook-5',
      }),
    ]
  )

  Payment.prototype.get = async function () {
    return {
      status: 'approved',
      external_reference: sessionId,
      transaction_amount: 100,
    } as any
  }

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestWebhook(
      `${server.baseUrl}/api/tenant/${slug}/pago/webhook`,
      { type: 'payment', data: { id: 'payment-webhook-5' } }
    )

    assert.equal(response.status, 202)
    assert.equal(response.data.ok, true)
    assert.equal(response.data.reconciled, true)

    const [sessionRows] = await pool.query<any[]>(
      `SELECT estado, reconciliation_status, payment_id, payment_status, confirmed_at FROM checkout_sessions WHERE id = ?`,
      [sessionId]
    )
    assert.equal(sessionRows[0].estado, 'confirmada')
    assert.equal(sessionRows[0].reconciliation_status, 'reconciled')
    assert.equal(sessionRows[0].payment_id, 'payment-webhook-5')
    assert.equal(sessionRows[0].payment_status, 'approved')
    assert.ok(sessionRows[0].confirmed_at)

    const [entradas] = await pool.query<any[]>(`SELECT COUNT(*) as total FROM entradas WHERE evento_id = ?`, [eventoId])
    assert.equal(entradas[0].total, 1)
  } finally {
    await server.close()
  }
})

test('tenant checkout blocks hoarding by too many active reserved sessions', async () => {
  const empresaId = 'phase-payhard-emp-6'
  const slug = 'phase-payhard-6'
  const compradorId = 'phase-payhard-cmp-6'
  const categoriaId = 'phase-payhard-cat-6'
  const eventoId = 'phase-payhard-evt-6'
  const buyerEmail = 'phase-payhard-buyer-6@example.com'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, email: buyerEmail })
  await seedEventoConCategoria({ eventoId, empresaId, categoriaId, precio: 100 })
  globalThis.fetch = async () => ({ ok: true, status: 200 }) as Response
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-PAYHARD-6666' })

  await pool.query(
    `INSERT INTO checkout_sessions (id, comprador_id, empresa_id, datos, estado, expires_at, created_at)
     VALUES
     (?, ?, ?, ?, 'reservada', NOW() + INTERVAL '10 minutes', NOW()),
     (?, ?, ?, ?, 'reservada', NOW() + INTERVAL '10 minutes', NOW())`,
    [
      'phase-payhard-session-6a', compradorId, empresaId,
      JSON.stringify({ items: [{ categoriaId, eventoId, categoriaNombre: 'General', eventoNombre: 'Evento Confirm', precio: 100, cantidad: 1 }], marketplaceFee: { amount: 12.5, currency: 'ARS', metadata: { mode: 'percentage', percentage: 12.5, percentageAmount: 12.5, fixedAmount: null, source: 'env' } } }),
      'phase-payhard-session-6b', compradorId, empresaId,
      JSON.stringify({ items: [{ categoriaId, eventoId, categoriaNombre: 'General', eventoNombre: 'Evento Confirm', precio: 100, cantidad: 1 }], marketplaceFee: { amount: 12.5, currency: 'ARS', metadata: { mode: 'percentage', percentage: 12.5, percentageAmount: 12.5, fixedAmount: null, source: 'env' } } }),
    ]
  )

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      'POST',
      `${server.baseUrl}/api/tenant/${slug}/checkout`,
      { items: [{ categoriaId, eventoId, cantidad: 1 }] },
      buildCompradorSessionUser({ compradorId, empresaId, slug, email: buyerEmail })
    )

    assert.equal(response.status, 429)
    assert.equal(response.data.error, 'Ya tenés demasiadas reservas activas. Terminá o esperá que venza alguna antes de seguir.')
  } finally {
    await server.close()
  }
})

test('tenant checkout blocks hoarding by total reserved entries ceiling', async () => {
  const empresaId = 'phase-payhard-emp-7'
  const slug = 'phase-payhard-7'
  const compradorId = 'phase-payhard-cmp-7'
  const categoriaId = 'phase-payhard-cat-7'
  const eventoId = 'phase-payhard-evt-7'
  const buyerEmail = 'phase-payhard-buyer-7@example.com'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, email: buyerEmail })
  await seedEventoConCategoria({ eventoId, empresaId, categoriaId, precio: 100 })
  globalThis.fetch = async () => ({ ok: true, status: 200 }) as Response
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-PAYHARD-7777' })

  await pool.query(
    `INSERT INTO checkout_sessions (id, comprador_id, empresa_id, datos, estado, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'reservada', NOW() + INTERVAL '10 minutes', NOW())`,
    [
      'phase-payhard-session-7a', compradorId, empresaId,
      JSON.stringify({ items: [{ categoriaId, eventoId, categoriaNombre: 'General', eventoNombre: 'Evento Confirm', precio: 100, cantidad: 10 }], marketplaceFee: { amount: 12.5, currency: 'ARS', metadata: { mode: 'percentage', percentage: 12.5, percentageAmount: 12.5, fixedAmount: null, source: 'env' } } }),
    ]
  )

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      'POST',
      `${server.baseUrl}/api/tenant/${slug}/checkout`,
      { items: [{ categoriaId, eventoId, cantidad: 1 }] },
      buildCompradorSessionUser({ compradorId, empresaId, slug, email: buyerEmail })
    )

    assert.equal(response.status, 429)
    assert.equal(response.data.error, 'Superaste el máximo de entradas reservadas simultáneamente para este usuario.')
  } finally {
    await server.close()
  }
})

test('legacy buyer token GET endpoint is disabled and no longer leaks identity', async () => {
  const empresaId = 'phase-payhard-emp-8'
  const slug = 'phase-payhard-8'
  const compradorId = 'phase-payhard-cmp-8'
  const buyerEmail = 'phase-payhard-buyer-8@example.com'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, email: buyerEmail })

  await pool.query(
    `INSERT INTO login_tokens (id, comprador_id, empresa_slug, expires_at, usado)
     VALUES (?, ?, ?, NOW() + INTERVAL '10 minutes', false)`,
    ['phase-payhard-token-8', compradorId, slug]
  )

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestRaw(
      `${server.baseUrl}/api/tenant/${slug}/auth/token?token=phase-payhard-token-8`
    )

    assert.equal(response.status, 410)
    const body = await response.json() as any
    assert.equal(body.error, 'Este endpoint ya no está disponible. Usá el flujo de acceso actual.')

    const [rows] = await pool.query<any[]>(`SELECT usado FROM login_tokens WHERE id = ?`, ['phase-payhard-token-8'])
    assert.equal(rows[0].usado, false)
  } finally {
    await server.close()
  }
})

test('public event detail is not exposed for inactive company even with direct URL', async () => {
  const empresaId = 'phase-payhard-emp-9'
  const slug = 'phase-payhard-9'
  const eventoId = 'phase-payhard-evt-9'
  const categoriaId = 'phase-payhard-cat-9'

  await seedEmpresa({ empresaId, slug })
  await seedEventoConCategoria({ eventoId, empresaId, categoriaId, precio: 100 })
  await pool.query(`UPDATE empresas SET activa = false WHERE id = ?`, [empresaId])

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestGetJson(`${server.baseUrl}/api/tenant/${slug}/evento/${eventoId}`)
    assert.equal(response.status, 404)
  } finally {
    await server.close()
  }
})
