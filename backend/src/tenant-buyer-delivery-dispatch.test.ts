import './test-env'

import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { Payment } from 'mercadopago'
import type { MessagingDeliveryRequest, MessagingProvider, MessagingSendResult } from './lib/messaging-provider'
import { prisma } from './lib/prisma'
import { upsertPaymentAccountByEmpresaId } from './lib/payment-accounts'
import { setBuyerMessagingProviderForTests } from './lib/buyer-settings-service'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'
process.env.PAYMENT_ACCOUNTS_ENCRYPTION_KEY = process.env.PAYMENT_ACCOUNTS_ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
process.env.MARKETPLACE_FEE_MODE = process.env.MARKETPLACE_FEE_MODE || 'percentage'
process.env.MARKETPLACE_FEE_PERCENTAGE = process.env.MARKETPLACE_FEE_PERCENTAGE || '12.5'
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_dispatch'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalPaymentGet = Payment.prototype.get
const originalFetch = globalThis.fetch

let tenantRouter: express.Router
let latestDeliveryRequest: MessagingDeliveryRequest | null = null
let deliverySendResult: MessagingSendResult = { ok: true, provider: 'fake-whatsapp', externalId: 'delivery-1' }
let resendRequests: Array<{ url: string; body: string }> = []

const fakeProvider: MessagingProvider = {
  name: 'fake-whatsapp',
  isEnabled: () => true,
  async sendVerificationCode() {
    return { ok: true, provider: 'fake-whatsapp', externalId: 'otp-unused' }
  },
  async sendDeliveryMessage(input) {
    latestDeliveryRequest = input
    return deliverySendResult
  },
}

function buildHeaders(user: Record<string, unknown> | null) {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
    ...(user ? { 'x-user': JSON.stringify(user) } : {}),
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

function buildMarketplaceFeeSnapshot(amount: number) {
  return {
    amount,
    currency: 'ARS',
    metadata: {
      mode: 'percentage',
      percentage: 12.5,
      percentageAmount: amount,
      fixedAmount: null,
      source: 'env',
    },
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

async function requestJson(url: string, body: unknown, user: Record<string, unknown> | null) {
  const response = await originalFetch(url, {
    method: 'POST',
    headers: buildHeaders(user),
    body: JSON.stringify(body),
  })

  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function seedEmpresa({ empresaId, slug }: { empresaId: string; slug: string }) {
  await prisma.$executeRaw`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES (${empresaId}, ${`Empresa ${slug}`}, ${slug}, ${`${slug}@example.com`}, ${TEST_PASSWORD_HASH}, ${`Admin ${slug}`}, true)
  `
}

async function seedComprador(input: {
  compradorId: string
  empresaId: string
  email: string
  deliveryPreference: 'email' | 'whatsapp' | 'both'
  phoneE164?: string | null
  phoneVerifiedAt?: string | null
}) {
  const phoneE164 = input.phoneE164 ?? null
  const phoneVerifiedAt = input.phoneVerifiedAt ? new Date(input.phoneVerifiedAt) : null
  const phoneVerificationProvider = input.phoneVerifiedAt ? 'seed-provider' : null

  await prisma.$executeRaw`
    INSERT INTO compradores (id, empresa_id, nombre, email, dni, password, phone_e164, phone_verified_at, phone_verification_provider, delivery_preference)
    VALUES (
      ${input.compradorId},
      ${input.empresaId},
      ${`Comprador ${input.compradorId}`},
      ${input.email},
      ${`dni-${input.compradorId.slice(-16)}`},
      ${TEST_PASSWORD_HASH},
      ${phoneE164},
      ${phoneVerifiedAt},
      ${phoneVerificationProvider},
      ${input.deliveryPreference}
    )
  `
}

async function seedEventoConCategoria({ eventoId, empresaId, categoriaId, precio }: { eventoId: string; empresaId: string; categoriaId: string; precio: number }) {
  await prisma.$executeRaw`
    INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo)
    VALUES (${eventoId}, ${empresaId}, ${`Evento ${eventoId}`}, NULL, NULL, 'unica', NULL, true)
  `

  await prisma.$executeRaw`
    INSERT INTO entrada_categorias (id, evento_id, tanda_id, nombre, descripcion, precio, stock, stock_disponible, activa)
    VALUES (${categoriaId}, ${eventoId}, NULL, ${`Categoría ${categoriaId}`}, NULL, ${precio}, 10, 10, true)
  `
}

async function seedBarraConsumible({ barraId, consumibleId, eventoId, empresaId, precio }: { barraId: string; consumibleId: string; eventoId: string; empresaId: string; precio: number }) {
  await prisma.$executeRaw`INSERT INTO barras (id, evento_id, empresa_id, nombre, activa) VALUES (${barraId}, ${eventoId}, ${empresaId}, ${`Barra ${barraId}`}, true)`
  await prisma.$executeRaw`INSERT INTO consumibles (id, empresa_id, nombre, descripcion, precio, activo) VALUES (${consumibleId}, ${empresaId}, ${`Consumible ${consumibleId}`}, NULL, ${precio}, true)`
  await prisma.$executeRaw`INSERT INTO barra_stock (barra_id, consumible_id, stock_actual, stock_minimo) VALUES (${barraId}, ${consumibleId}, 20, 0)`.catch(() => {})
}

async function seedCheckoutSession(input: {
  sessionId: string
  compradorId: string
  empresaId: string
  data: unknown
}) {
  await prisma.$executeRaw`
    INSERT INTO checkout_sessions (id, comprador_id, empresa_id, datos, estado, expires_at, created_at)
    VALUES (${input.sessionId}, ${input.compradorId}, ${input.empresaId}, ${JSON.stringify(input.data)}, 'reservada', NOW() + INTERVAL '10 minutes', NOW())
  `
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM delivery_dispatch_attempts WHERE checkout_session_id ILIKE 'phase-delivery-%' OR buyer_id ILIKE 'phase-delivery-%' OR empresa_id ILIKE 'phase-delivery-%'`.catch(() => {})
  await prisma.$executeRaw`DELETE FROM platform_sale_allocations WHERE checkout_session_id ILIKE 'phase-delivery-%' OR empresa_id ILIKE 'phase-delivery-%'`.catch(() => {})
  await prisma.$executeRaw`DELETE FROM consumibles_venta_items WHERE venta_id ILIKE 'phase-delivery-%'`.catch(() => {})
  await prisma.$executeRaw`DELETE FROM consumibles_ventas WHERE id ILIKE 'phase-delivery-%' OR empresa_id ILIKE 'phase-delivery-%' OR comprador_id ILIKE 'phase-delivery-%' OR checkout_session_id ILIKE 'phase-delivery-%'`.catch(() => {})
  await prisma.$executeRaw`DELETE FROM entradas WHERE id ILIKE 'phase-delivery-%' OR evento_id ILIKE 'phase-delivery-%' OR comprador_id ILIKE 'phase-delivery-%'`.catch(() => {})
  await prisma.$executeRaw`DELETE FROM checkout_sessions WHERE id ILIKE 'phase-delivery-%' OR empresa_id ILIKE 'phase-delivery-%' OR comprador_id ILIKE 'phase-delivery-%'`.catch(() => {})
  await prisma.$executeRaw`DELETE FROM barra_stock WHERE barra_id ILIKE 'phase-delivery-%' OR consumible_id ILIKE 'phase-delivery-%'`.catch(() => {})
  await prisma.$executeRaw`DELETE FROM barras WHERE id ILIKE 'phase-delivery-%' OR empresa_id ILIKE 'phase-delivery-%' OR evento_id ILIKE 'phase-delivery-%'`.catch(() => {})
  await prisma.$executeRaw`DELETE FROM consumibles WHERE id ILIKE 'phase-delivery-%' OR empresa_id ILIKE 'phase-delivery-%'`.catch(() => {})
  await prisma.$executeRaw`DELETE FROM entrada_categorias WHERE id ILIKE 'phase-delivery-%' OR evento_id ILIKE 'phase-delivery-%'`.catch(() => {})
  await prisma.$executeRaw`DELETE FROM eventos WHERE id ILIKE 'phase-delivery-%' OR empresa_id ILIKE 'phase-delivery-%'`.catch(() => {})
  await prisma.$executeRaw`DELETE FROM compradores WHERE id ILIKE 'phase-delivery-%' OR empresa_id ILIKE 'phase-delivery-%'`.catch(() => {})
  await prisma.$executeRaw`DELETE FROM empresa_payment_accounts WHERE empresa_id ILIKE 'phase-delivery-%'`.catch(() => {})
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'phase-delivery-%' OR slug ILIKE 'phase-delivery-%'`.catch(() => {})
}

before(async () => {
  ;({ default: tenantRouter } = await import('./routes/tenant'))
})

beforeEach(async () => {
  Payment.prototype.get = originalPaymentGet
  latestDeliveryRequest = null
  deliverySendResult = { ok: true, provider: 'fake-whatsapp', externalId: 'delivery-1' }
  resendRequests = []
  setBuyerMessagingProviderForTests(fakeProvider)
  globalThis.fetch = async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    if (url.startsWith('https://api.resend.com/')) {
      resendRequests.push({ url, body: typeof init?.body === 'string' ? init.body : '' })
      return new Response(JSON.stringify({ id: `email-${resendRequests.length}` }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return originalFetch(input as any, init)
  }
  await cleanup()
})

after(async () => {
  Payment.prototype.get = originalPaymentGet
  globalThis.fetch = originalFetch
  setBuyerMessagingProviderForTests(null)
  await cleanup()
  await prisma.$disconnect()
})

test('post-confirmation email delivery records a sent email attempt for entradas', async () => {
  const empresaId = 'phase-delivery-emp-1'
  const slug = 'phase-delivery-1'
  const compradorId = 'phase-delivery-cmp-1'
  const email = 'phase-delivery-1@example.com'
  const sessionId = 'phase-delivery-session-1'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, email, deliveryPreference: 'email' })
  await seedEventoConCategoria({ eventoId: 'phase-delivery-evt-1', empresaId, categoriaId: 'phase-delivery-cat-1', precio: 100 })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-PHASE-DELIVERY-1' })
  await seedCheckoutSession({
    sessionId,
    compradorId,
    empresaId,
    data: {
      items: [{ categoriaId: 'phase-delivery-cat-1', eventoId: 'phase-delivery-evt-1', categoriaNombre: 'General', eventoNombre: 'Evento Delivery', precio: 100, cantidad: 1 }],
      marketplaceFee: buildMarketplaceFeeSnapshot(12.5),
      confirmationToken: 'ct-phase-delivery-1',
    },
  })

  Payment.prototype.get = async function () {
    return { status: 'approved', external_reference: sessionId, transaction_amount: 100 } as any
  }

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      `${server.baseUrl}/api/tenant/${slug}/pago/confirmar`,
      { sessionId, paymentId: 'payment-delivery-1' },
      buildCompradorSessionUser({ compradorId, empresaId, slug, email }),
    )

    assert.equal(response.status, 200)
    assert.equal(response.data.delivery.preference, 'email')
    assert.equal(resendRequests.length, 1)
    assert.equal(latestDeliveryRequest, null)

    const attemptRows = await prisma.$queryRaw<Array<{ channel: string; status: string; provider: string; recipient: string }>>`
      SELECT channel, status, provider, recipient FROM delivery_dispatch_attempts
      WHERE checkout_session_id = ${sessionId} ORDER BY channel ASC
    `
    assert.deepEqual(attemptRows, [{ channel: 'email', status: 'sent', provider: 'resend', recipient: email }])
  } finally {
    await server.close()
  }
})

test('post-confirmation both delivery sends email and whatsapp for consumibles', async () => {
  const empresaId = 'phase-delivery-emp-2'
  const slug = 'phase-delivery-2'
  const compradorId = 'phase-delivery-cmp-2'
  const email = 'phase-delivery-2@example.com'
  const sessionId = 'phase-delivery-session-2'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, email, deliveryPreference: 'both', phoneE164: '+5491155554444', phoneVerifiedAt: '2026-01-01 00:00:00' })
  await seedEventoConCategoria({ eventoId: 'phase-delivery-evt-2', empresaId, categoriaId: 'phase-delivery-cat-2', precio: 500 })
  await seedBarraConsumible({ barraId: 'phase-delivery-bar-2', consumibleId: 'phase-delivery-con-2', eventoId: 'phase-delivery-evt-2', empresaId, precio: 500 })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-PHASE-DELIVERY-2' })
  await seedCheckoutSession({
    sessionId,
    compradorId,
    empresaId,
    data: {
      flow: 'consumibles',
      items: [{ barraId: 'phase-delivery-bar-2', barraNombre: 'Barra Norte', consumibleId: 'phase-delivery-con-2', nombre: 'Cerveza', precio: 500, cantidad: 1, eventoId: 'phase-delivery-evt-2', eventoNombre: 'Evento Delivery' }],
      marketplaceFee: buildMarketplaceFeeSnapshot(62.5),
      confirmationToken: 'ct-phase-delivery-2',
    },
  })

  Payment.prototype.get = async function () {
    return { status: 'approved', external_reference: sessionId, transaction_amount: 500 } as any
  }

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      `${server.baseUrl}/api/tenant/${slug}/pago/confirmar`,
      { sessionId, paymentId: 'payment-delivery-2' },
      buildCompradorSessionUser({ compradorId, empresaId, slug, email }),
    )

    assert.equal(response.status, 200)
    assert.equal(response.data.delivery.preference, 'both')
    assert.equal(resendRequests.length, 1)
    assert.equal(latestDeliveryRequest?.template, 'buyer-consumables-delivery')
    assert.equal(latestDeliveryRequest?.recipient, '+5491155554444')

    const attemptRows = await prisma.$queryRaw<Array<{ channel: string; status: string; provider: string }>>`
      SELECT channel, status, provider FROM delivery_dispatch_attempts
      WHERE checkout_session_id = ${sessionId} ORDER BY channel ASC
    `
    assert.deepEqual(attemptRows, [
      { channel: 'email', status: 'sent', provider: 'resend' },
      { channel: 'whatsapp', status: 'sent', provider: 'fake-whatsapp' },
    ])
  } finally {
    await server.close()
  }
})

test('post-confirmation keeps both preference and records whatsapp failure when provider is unavailable', async () => {
  const empresaId = 'phase-delivery-emp-3'
  const slug = 'phase-delivery-3'
  const compradorId = 'phase-delivery-cmp-3'
  const email = 'phase-delivery-3@example.com'
  const sessionId = 'phase-delivery-session-3'

  deliverySendResult = { ok: false, provider: 'fake-whatsapp', errorCode: 'provider_down', errorMessage: 'offline', retryable: true }

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, email, deliveryPreference: 'both', phoneE164: '+5491155553333', phoneVerifiedAt: '2026-01-01 00:00:00' })
  await seedEventoConCategoria({ eventoId: 'phase-delivery-evt-3', empresaId, categoriaId: 'phase-delivery-cat-3', precio: 120 })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-PHASE-DELIVERY-3' })
  await seedCheckoutSession({
    sessionId,
    compradorId,
    empresaId,
    data: {
      items: [{ categoriaId: 'phase-delivery-cat-3', eventoId: 'phase-delivery-evt-3', categoriaNombre: 'General', eventoNombre: 'Evento Delivery', precio: 120, cantidad: 1 }],
      marketplaceFee: buildMarketplaceFeeSnapshot(15),
      confirmationToken: 'ct-phase-delivery-3',
    },
  })

  Payment.prototype.get = async function () {
    return { status: 'approved', external_reference: sessionId, transaction_amount: 120 } as any
  }

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      `${server.baseUrl}/api/tenant/${slug}/pago/confirmar`,
      { sessionId, paymentId: 'payment-delivery-3' },
      buildCompradorSessionUser({ compradorId, empresaId, slug, email }),
    )

    assert.equal(response.status, 200)
    assert.equal(response.data.delivery.preference, 'both')

    const buyerRows = await prisma.$queryRaw<Array<{ delivery_preference: string }>>`SELECT delivery_preference FROM compradores WHERE id = ${compradorId}`
    assert.equal(buyerRows[0].delivery_preference, 'both')

    const attemptRows = await prisma.$queryRaw<Array<{ channel: string; status: string; provider: string; error_code: string | null }>>`
      SELECT channel, status, provider, error_code FROM delivery_dispatch_attempts
      WHERE checkout_session_id = ${sessionId} ORDER BY channel ASC
    `
    assert.deepEqual(attemptRows, [
      { channel: 'email', status: 'sent', provider: 'resend', error_code: null },
      { channel: 'whatsapp', status: 'failed', provider: 'fake-whatsapp', error_code: 'provider_down' },
    ])
  } finally {
    await server.close()
  }
})

test('post-confirmation skips whatsapp when stored preference has no verified phone', async () => {
  const empresaId = 'phase-delivery-emp-4'
  const slug = 'phase-delivery-4'
  const compradorId = 'phase-delivery-cmp-4'
  const email = 'phase-delivery-4@example.com'
  const sessionId = 'phase-delivery-session-4'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, email, deliveryPreference: 'whatsapp', phoneE164: '+5491155552222', phoneVerifiedAt: null })
  await seedEventoConCategoria({ eventoId: 'phase-delivery-evt-4', empresaId, categoriaId: 'phase-delivery-cat-4', precio: 90 })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-PHASE-DELIVERY-4' })
  await seedCheckoutSession({
    sessionId,
    compradorId,
    empresaId,
    data: {
      items: [{ categoriaId: 'phase-delivery-cat-4', eventoId: 'phase-delivery-evt-4', categoriaNombre: 'General', eventoNombre: 'Evento Delivery', precio: 90, cantidad: 1 }],
      marketplaceFee: buildMarketplaceFeeSnapshot(11.25),
      confirmationToken: 'ct-phase-delivery-4',
    },
  })

  Payment.prototype.get = async function () {
    return { status: 'approved', external_reference: sessionId, transaction_amount: 90 } as any
  }

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      `${server.baseUrl}/api/tenant/${slug}/pago/confirmar`,
      { sessionId, paymentId: 'payment-delivery-4' },
      buildCompradorSessionUser({ compradorId, empresaId, slug, email }),
    )

    assert.equal(response.status, 200)
    assert.equal(response.data.delivery.preference, 'whatsapp')
    assert.equal(resendRequests.length, 0)
    assert.equal(latestDeliveryRequest, null)

    const attemptRows = await prisma.$queryRaw<Array<{ channel: string; status: string; error_code: string | null }>>`
      SELECT channel, status, error_code FROM delivery_dispatch_attempts WHERE checkout_session_id = ${sessionId}
    `
    assert.deepEqual(attemptRows, [{ channel: 'whatsapp', status: 'skipped', error_code: 'phone_not_verified' }])
  } finally {
    await server.close()
  }
})
