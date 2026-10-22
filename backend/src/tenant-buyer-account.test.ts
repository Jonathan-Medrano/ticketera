import './test-env'

import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from './lib/prisma'
import type { MessagingProvider, MessagingSendResult, MessagingVerificationCodeRequest } from './lib/messaging-provider'
import { setBuyerMessagingProviderForTests } from './lib/buyer-settings-service'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const BUYER_CURRENT_PASSWORD = 'ClaveActual123'
const originalFetch = globalThis.fetch

let tenantRouter: express.Router
let latestCodeRequest: MessagingVerificationCodeRequest | null = null
let verificationSendResult: MessagingSendResult = { ok: true, provider: 'fake-whatsapp', externalId: 'otp-1' }

const fakeProvider: MessagingProvider = {
  name: 'fake-whatsapp',
  isEnabled: () => true,
  async sendVerificationCode(input) {
    latestCodeRequest = input
    return verificationSendResult
  },
  async sendDeliveryMessage() {
    return { ok: true, provider: 'fake-whatsapp', externalId: 'delivery-1' }
  },
}

function buildHeaders(user: Record<string, unknown> | null = null, slug = 'phase-buyer-account') {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
    'x-actor-kind': 'buyer',
    'x-tenant-slug': slug,
    'x-client-ip': '198.51.100.50',
    ...(user ? { 'x-user': JSON.stringify(user) } : {}),
  }
}

function buildBuyerUser(buyerId = 'phase-buyer-cmp-1') {
  return {
    id: buyerId,
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

async function requestJson(method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown, user: Record<string, unknown> | null = buildBuyerUser(), slug = 'phase-buyer-account') {
  const response = await originalFetch(url, {
    method,
    headers: buildHeaders(user, slug),
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function cleanup() {
  latestCodeRequest = null
  verificationSendResult = { ok: true, provider: 'fake-whatsapp', externalId: 'otp-1' }
  await prisma.$executeRaw`DELETE FROM buyer_phone_verification_challenges WHERE buyer_id ILIKE 'phase-buyer-cmp-%' OR empresa_id ILIKE 'phase-buyer-emp-%'`
  await prisma.$executeRaw`DELETE FROM rate_limit_buckets WHERE bucket_key ILIKE 'tenant-buyer-%'`
  await prisma.$executeRaw`DELETE FROM compradores WHERE id ILIKE 'phase-buyer-cmp-%' OR empresa_id ILIKE 'phase-buyer-emp-%'`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'phase-buyer-emp-%' OR slug ILIKE 'phase-buyer-%'`
}

async function seedBuyerAccount(options?: { phoneE164?: string | null; phoneVerifiedAt?: string | null; deliveryPreference?: 'email' | 'whatsapp' | 'both' }) {
  const buyerPasswordHash = await bcrypt.hash(BUYER_CURRENT_PASSWORD, 12)
  await prisma.$executeRaw`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES ('phase-buyer-emp-1', 'Empresa Buyer', 'phase-buyer-account', 'phase-buyer-owner@example.com', ${TEST_PASSWORD_HASH}, 'Admin Buyer', true)
  `

  const phoneE164 = options?.phoneE164 ?? null
  const phoneVerifiedAt = options?.phoneVerifiedAt ? new Date(options.phoneVerifiedAt) : null
  const phoneVerificationProvider = options?.phoneVerifiedAt ? 'seed-provider' : null
  const deliveryPreference = options?.deliveryPreference ?? 'email'

  await prisma.$executeRaw`
    INSERT INTO compradores (id, empresa_id, nombre, email, dni, password, phone_e164, phone_verified_at, phone_verification_provider, delivery_preference)
    VALUES (
      'phase-buyer-cmp-1',
      'phase-buyer-emp-1',
      'Comprador Demo',
      'phase-buyer-cmp-1@example.com',
      '30111222',
      ${buyerPasswordHash},
      ${phoneE164},
      ${phoneVerifiedAt},
      ${phoneVerificationProvider},
      ${deliveryPreference}
    )
  `
}

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  return app
}

before(async () => {
  ;({ default: tenantRouter } = await import('./routes/tenant'))
})

beforeEach(async () => {
  await cleanup()
  setBuyerMessagingProviderForTests(fakeProvider)
})

after(async () => {
  setBuyerMessagingProviderForTests(null)
  await cleanup()
  await prisma.$disconnect()
})

test('buyer account snapshot exposes current settings and provider availability', async () => {
  await seedBuyerAccount({ phoneE164: '+5491111111111', phoneVerifiedAt: '2026-01-01 00:00:00', deliveryPreference: 'both' })
  const server = await createTestServer(buildApp())

  try {
    const response = await requestJson('GET', `${server.baseUrl}/api/tenant/phase-buyer-account/account`)

    assert.equal(response.status, 200)
    assert.equal(response.data.data.buyer.email, 'phase-buyer-cmp-1@example.com')
    assert.equal(response.data.data.buyer.phoneE164, '+5491111111111')
    assert.equal(response.data.data.buyer.deliveryPreference, 'both')
    assert.equal(response.data.data.whatsappVerification.providerAvailable, true)
  } finally {
    await server.close()
  }
})

test('buyer password change rejects an invalid current password', async () => {
  await seedBuyerAccount()
  const server = await createTestServer(buildApp())

  try {
    const response = await requestJson('PATCH', `${server.baseUrl}/api/tenant/phase-buyer-account/account/password`, {
      currentPassword: 'incorrecta',
      newPassword: 'NuevaClave123!',
      confirmPassword: 'NuevaClave123!',
    })

    assert.equal(response.status, 400)
    assert.equal(response.data.error, 'La contraseña actual es incorrecta')
  } finally {
    await server.close()
  }
})

test('buyer password change rejects weak replacements with canonical policy error', async () => {
  await seedBuyerAccount()
  const server = await createTestServer(buildApp())

  try {
    const response = await requestJson('PATCH', `${server.baseUrl}/api/tenant/phase-buyer-account/account/password`, {
      currentPassword: BUYER_CURRENT_PASSWORD,
      newPassword: '12345678',
      confirmPassword: '12345678',
    })

    assert.equal(response.status, 400)
    assert.equal(response.data.error, 'La contraseña debe cumplir la política de seguridad')
    assert.equal(response.data.code, 'password_policy_failed')
  } finally {
    await server.close()
  }
})

test('buyer password change updates credentials and password version', async () => {
  await seedBuyerAccount()
  const beforeRows = await prisma.$queryRaw<Array<{ password_changed_at: Date | null }>>`SELECT password_changed_at FROM compradores WHERE id = 'phase-buyer-cmp-1'`
  const beforeVersion = String(beforeRows[0].password_changed_at)
  const server = await createTestServer(buildApp())

  try {
    await new Promise((resolve) => setTimeout(resolve, 1100))

    const response = await requestJson('PATCH', `${server.baseUrl}/api/tenant/phase-buyer-account/account/password`, {
      currentPassword: BUYER_CURRENT_PASSWORD,
      newPassword: 'NuevaClave123!',
      confirmPassword: 'NuevaClave123!',
    })

    assert.equal(response.status, 200)
    assert.equal(response.data.ok, true)

    const rows = await prisma.$queryRaw<Array<{ password: string; password_changed_at: Date | null }>>`SELECT password, password_changed_at FROM compradores WHERE id = 'phase-buyer-cmp-1'`
    assert.equal(await bcrypt.compare('NuevaClave123!', rows[0].password), true)
    assert.notEqual(String(rows[0].password_changed_at), beforeVersion)
  } finally {
    await server.close()
  }
})

test('buyer whatsapp request reports provider unavailable explicitly', async () => {
  await seedBuyerAccount()
  verificationSendResult = { ok: false, provider: 'fake-whatsapp', errorCode: 'provider_down', errorMessage: 'offline', retryable: true }
  const server = await createTestServer(buildApp())

  try {
    const response = await requestJson('POST', `${server.baseUrl}/api/tenant/phase-buyer-account/account/whatsapp/request-code`, {
      phone: '+54 9 11 5555-4444',
    })

    assert.equal(response.status, 503)
    assert.equal(response.data.error, 'WhatsApp no está disponible en este momento')

    const rows = await prisma.$queryRaw<Array<{ status: string; invalidation_reason: string | null }>>`
      SELECT status, invalidation_reason FROM buyer_phone_verification_challenges
      WHERE buyer_id = 'phase-buyer-cmp-1' ORDER BY created_at DESC LIMIT 1
    `
    assert.equal(rows[0].status, 'invalidated')
    assert.equal(rows[0].invalidation_reason, 'provider_unavailable')
  } finally {
    await server.close()
  }
})

test('buyer whatsapp verify rejects invalid and expired OTP codes', async () => {
  await seedBuyerAccount()
  const server = await createTestServer(buildApp())

  try {
    const requestResponse = await requestJson('POST', `${server.baseUrl}/api/tenant/phase-buyer-account/account/whatsapp/request-code`, {
      phone: '+54 9 11 5555-4444',
    })
    assert.equal(requestResponse.status, 200)
    assert.equal(latestCodeRequest?.code.length, 6)

    const invalidResponse = await requestJson('POST', `${server.baseUrl}/api/tenant/phase-buyer-account/account/whatsapp/verify-code`, {
      phone: '+5491155554444',
      code: '000000',
    })
    assert.equal(invalidResponse.status, 400)
    assert.equal(invalidResponse.data.error, 'El código es inválido')

    await prisma.$executeRaw`
      UPDATE buyer_phone_verification_challenges
      SET expires_at = NOW() - INTERVAL '1 minute'
      WHERE buyer_id = 'phase-buyer-cmp-1'
    `

    const expiredResponse = await requestJson('POST', `${server.baseUrl}/api/tenant/phase-buyer-account/account/whatsapp/verify-code`, {
      phone: '+5491155554444',
      code: latestCodeRequest!.code,
    })
    assert.equal(expiredResponse.status, 400)
    assert.equal(expiredResponse.data.error, 'El código expiró. Pedí uno nuevo')
  } finally {
    await server.close()
  }
})

test('buyer delivery preference requires a verified phone and succeeds after verification', async () => {
  await seedBuyerAccount({ phoneE164: '+5491100000000', phoneVerifiedAt: '2026-01-01 00:00:00', deliveryPreference: 'email' })
  const server = await createTestServer(buildApp())

  try {
    const requestCodeResponse = await requestJson('POST', `${server.baseUrl}/api/tenant/phase-buyer-account/account/whatsapp/request-code`, {
      phone: '+54 9 11 5555-4444',
    })
    assert.equal(requestCodeResponse.status, 200)

    const buyerAfterRequestRows = await prisma.$queryRaw<Array<{ phone_e164: string | null; phone_verified_at: Date | null }>>`
      SELECT phone_e164, phone_verified_at FROM compradores WHERE id = 'phase-buyer-cmp-1'
    `
    assert.equal(buyerAfterRequestRows[0].phone_e164, '+5491155554444')
    assert.equal(buyerAfterRequestRows[0].phone_verified_at, null)

    const rejectedPreference = await requestJson('PATCH', `${server.baseUrl}/api/tenant/phase-buyer-account/account/delivery-preference`, {
      deliveryPreference: 'both',
    })
    assert.equal(rejectedPreference.status, 400)
    assert.equal(rejectedPreference.data.error, 'Verificá tu WhatsApp antes de elegir ese canal de entrega')

    const verifyResponse = await requestJson('POST', `${server.baseUrl}/api/tenant/phase-buyer-account/account/whatsapp/verify-code`, {
      phone: '+5491155554444',
      code: latestCodeRequest!.code,
    })
    assert.equal(verifyResponse.status, 200)
    assert.equal(verifyResponse.data.data.buyer.phoneE164, '+5491155554444')

    const acceptedPreference = await requestJson('PATCH', `${server.baseUrl}/api/tenant/phase-buyer-account/account/delivery-preference`, {
      deliveryPreference: 'both',
    })
    assert.equal(acceptedPreference.status, 200)
    assert.equal(acceptedPreference.data.data.buyer.deliveryPreference, 'both')
  } finally {
    await server.close()
  }
})
