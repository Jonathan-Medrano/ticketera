import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { Prisma } from '@prisma/client'
import { prismaDirectUrl } from './lib/prisma'
import {
  getMarketplaceFeeOverridesByFlow,
  getMarketplaceFeeSummary,
  getMarketplaceFeeSummariesByFlow,
  getPlatformMarketplaceFeeDefaultsByFlow,
  upsertMarketplaceFeeConfigByEmpresaId,
  upsertPlatformMarketplaceFeeDefault,
} from './lib/marketplace-fee'
import { getSalesReadiness } from './lib/sales-readiness'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'

// ensurePaymentAccountSchema() is a no-op: schema managed by Prisma migrations
async function ensurePaymentAccountSchema() {
  // no-op: tables exist from prisma migrate deploy
}

async function seedEmpresa(empresaId: string) {
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES (${empresaId}, 'Empresa Fees', ${`${empresaId}-slug`}, ${`${empresaId}@example.com`}, ${TEST_PASSWORD_HASH}, 'Admin Fees', true)
  `)
}

async function seedReadyPaymentAccount(empresaId: string) {
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO empresa_payment_accounts (
      id, empresa_id, provider, status, reason,
      credential_ciphertext, credential_iv, credential_tag, credential_last4,
      provider_account_label, validated_at, blocked_at
    ) VALUES (${`${empresaId}-account`}, ${empresaId}, 'mercadopago', 'ready_to_sell', NULL, 'cipher', 'iv', 'tag', '1234', 'Cuenta test', NOW(), NULL)
  `)
}

async function cleanupTestData() {
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresa_payment_accounts WHERE empresa_id LIKE 'phase5-fees-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresa_marketplace_fees WHERE empresa_id LIKE 'phase5-fees-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresa_marketplace_fee_overrides WHERE empresa_id LIKE 'phase5-fees-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_marketplace_fee_defaults WHERE flow IN ('entradas', 'consumibles')`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresas WHERE id LIKE 'phase5-fees-%' OR slug LIKE 'phase5-fees-%'`)
}

before(async () => {
  await ensurePaymentAccountSchema()
})

beforeEach(async () => {
  await cleanupTestData()
})

after(async () => {
  await cleanupTestData()
  await prismaDirectUrl.$disconnect()
})

test('fee defaults and overrides stay per flow while readiness requires both flows configured', async () => {
  const empresaId = 'phase5-fees-empresa-1'
  await seedEmpresa(empresaId)
  await seedReadyPaymentAccount(empresaId)

  await upsertPlatformMarketplaceFeeDefault({
    flow: 'entradas',
    marketplaceFeeMode: 'percentage',
    marketplaceFeePercentage: 10,
    marketplaceFeeFixedAmount: null,
  })

  const readinessMissingFlow = await getSalesReadiness(empresaId)
  assert.deepEqual(readinessMissingFlow, {
    status: 'pending_validation',
    reason: 'missing_marketplace_fee',
    canSell: false,
  })

  await upsertPlatformMarketplaceFeeDefault({
    flow: 'consumibles',
    marketplaceFeeMode: 'fixed',
    marketplaceFeePercentage: null,
    marketplaceFeeFixedAmount: 12,
  })

  const readinessReady = await getSalesReadiness(empresaId)
  assert.deepEqual(readinessReady, {
    status: 'ready_to_sell',
    reason: null,
    canSell: true,
  })

  await upsertMarketplaceFeeConfigByEmpresaId({
    empresaId,
    flow: 'entradas',
    marketplaceFeeMode: 'hybrid',
    marketplaceFeePercentage: 5,
    marketplaceFeeFixedAmount: 3,
  })

  const defaultsByFlow = await getPlatformMarketplaceFeeDefaultsByFlow()
  const overridesByFlow = await getMarketplaceFeeOverridesByFlow(empresaId)
  const resolvedByFlow = await getMarketplaceFeeSummariesByFlow(empresaId)

  assert.equal(defaultsByFlow.entradas.percentage, 10)
  assert.equal(defaultsByFlow.consumibles.fixedAmount, 12)
  assert.equal(overridesByFlow.entradas.configured, true)
  assert.equal(overridesByFlow.consumibles.configured, false)
  assert.equal(resolvedByFlow.entradas.source, 'empresa')
  assert.equal(resolvedByFlow.consumibles.source, 'global')
})

test('legacy fallback remains scoped until an explicit flow override replaces it', async () => {
  const empresaId = 'phase5-fees-empresa-2'
  await seedEmpresa(empresaId)

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO empresa_marketplace_fees (id, empresa_id, mode, percentage, fixed_amount)
    VALUES ('phase5-fees-legacy-row', ${empresaId}, 'fixed', NULL, 33.33)
  `)

  const legacyEntradas = await getMarketplaceFeeSummary(empresaId, 'entradas')
  const legacyConsumibles = await getMarketplaceFeeSummary(empresaId, 'consumibles')

  assert.equal(legacyEntradas.legacyFallback, 'empresa_legacy')
  assert.equal(legacyConsumibles.legacyFallback, 'empresa_legacy')
  assert.equal(legacyConsumibles.fixedAmount, 33.33)

  await upsertMarketplaceFeeConfigByEmpresaId({
    empresaId,
    flow: 'consumibles',
    marketplaceFeeMode: 'fixed',
    marketplaceFeePercentage: null,
    marketplaceFeeFixedAmount: 18,
  })

  const resolvedConsumibles = await getMarketplaceFeeSummary(empresaId, 'consumibles')
  const resolvedEntradas = await getMarketplaceFeeSummary(empresaId, 'entradas')

  assert.equal(resolvedConsumibles.legacyFallback, null)
  assert.equal(resolvedConsumibles.fixedAmount, 18)
  assert.equal(resolvedEntradas.legacyFallback, 'empresa_legacy')
  assert.equal(resolvedEntradas.fixedAmount, 33.33)
})
