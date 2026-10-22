import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { prisma } from './lib/prisma'
import {
  BUYER_PHONE_VERIFICATION_MAX_ATTEMPTS,
  BUYER_PHONE_VERIFICATION_TTL_MS,
  buildBuyerVerificationChallenge,
  hashBuyerVerificationCode,
  normalizeBuyerPhoneE164,
  resolveBuyerDeliveryChannels,
} from './lib/buyer-settings'
import { buildBuyerDeliveryDispatchPlan } from './lib/buyer-delivery-dispatcher'

test('buyer settings foundation normalizes phone, hashes OTP, and resolves channels', () => {
  assert.equal(normalizeBuyerPhoneE164('11 5555-4444'), '+1155554444')
  assert.equal(hashBuyerVerificationCode('challenge-1', '123456'), hashBuyerVerificationCode('challenge-1', '123456'))

  const challenge = buildBuyerVerificationChallenge({
    buyerId: 'cmp-1',
    empresaId: 'emp-1',
    phone: '+54 9 11 5555-4444',
    challengeId: 'challenge-1',
    code: '123456',
    now: new Date('2026-01-01T00:00:00.000Z'),
  })

  assert.equal(challenge.record.phoneE164, '+5491155554444')
  assert.equal(challenge.record.maxAttempts, BUYER_PHONE_VERIFICATION_MAX_ATTEMPTS)
  assert.equal(challenge.record.expiresAt.getTime(), new Date('2026-01-01T00:00:00.000Z').getTime() + BUYER_PHONE_VERIFICATION_TTL_MS)
  assert.deepEqual(resolveBuyerDeliveryChannels('email', null), { ok: true, channels: ['email'] })
  assert.deepEqual(resolveBuyerDeliveryChannels('both', null), { ok: false, reason: 'phone_not_verified', channels: [] })
  assert.deepEqual(resolveBuyerDeliveryChannels('both', '2026-01-01T00:00:00.000Z'), { ok: true, channels: ['email', 'whatsapp'] })
})

test('buyer delivery dispatcher builds explicit multi-channel plan without fallback', () => {
  assert.deepEqual(buildBuyerDeliveryDispatchPlan({
    checkoutSessionId: 'chk-1',
    empresaId: 'emp-1',
    buyerId: 'cmp-1',
    email: 'buyer@example.com',
    phoneE164: '+5491155554444',
    deliveryPreference: 'both',
    phoneVerifiedAt: '2026-01-01T00:00:00.000Z',
  }), {
    ok: true,
    channels: [
      { channel: 'email', recipient: 'buyer@example.com' },
      { channel: 'whatsapp', recipient: '+5491155554444' },
    ],
  })

  assert.deepEqual(buildBuyerDeliveryDispatchPlan({
    checkoutSessionId: 'chk-1',
    empresaId: 'emp-1',
    buyerId: 'cmp-1',
    email: 'buyer@example.com',
    phoneE164: null,
    deliveryPreference: 'whatsapp',
    phoneVerifiedAt: null,
  }), {
    ok: true,
    channels: [
      { channel: 'whatsapp', recipient: null, blockedReason: 'missing_recipient' },
    ],
  })

  assert.deepEqual(buildBuyerDeliveryDispatchPlan({
    checkoutSessionId: 'chk-1',
    empresaId: 'emp-1',
    buyerId: 'cmp-1',
    email: 'buyer@example.com',
    phoneE164: '+5491155554444',
    deliveryPreference: 'both',
    phoneVerifiedAt: null,
  }), {
    ok: true,
    channels: [
      { channel: 'email', recipient: 'buyer@example.com' },
      { channel: 'whatsapp', recipient: '+5491155554444', blockedReason: 'phone_not_verified' },
    ],
  })
})

test('ensureBackendSchema provisions buyer settings tables and columns', async () => {
  // Postgres equivalent of SHOW COLUMNS / SHOW TABLES — query information_schema
  const buyerColumns = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'compradores' AND column_name = 'delivery_preference'
  `
  const phoneColumns = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'compradores' AND column_name = 'phone_e164'
  `
  const challengeTables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_name = 'buyer_phone_verification_challenges'
  `
  const dispatchTables = await prisma.$queryRaw<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_name = 'delivery_dispatch_attempts'
  `

  assert.equal(buyerColumns.length, 1)
  assert.equal(phoneColumns.length, 1)
  assert.equal(challengeTables.length, 1)
  assert.equal(dispatchTables.length, 1)
})

after(async () => {
  await prisma.$disconnect()
})
