import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import { Prisma } from '@prisma/client'
import { prismaDirectUrl } from './lib/prisma'
import {
  getPlatformCompanyAggregates,
  getPlatformCompanyReporting,
  getPlatformDashboardReporting,
} from './lib/platform-reporting'
import { createPlatformUser } from './lib/platform-governance'
import { getSingletonSuperadmin } from './lib/platform-profit-sharing'
import { upsertMarketplaceFeeConfigByEmpresaId } from './lib/marketplace-fee'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'

async function seedEmpresa({ empresaId, slug }: { empresaId: string; slug: string }) {
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES (${empresaId}, 'Empresa Reporting', ${slug}, ${`${slug}@example.com`}, ${TEST_PASSWORD_HASH}, 'Admin Reporting', true)
  `)
}

async function seedEmpresaPaymentAccount(params: {
  empresaId: string
  status: 'pending_validation' | 'ready_to_sell' | 'blocked'
  reason?: 'credentials_invalid' | 'provider_unreachable' | 'provider_blocked' | 'manual_block' | 'validation_pending' | null
  blockedAt?: string | null
}) {
  const validatedAt = params.status === 'ready_to_sell' ? new Date() : null
  const blockedAt = params.blockedAt ? new Date(params.blockedAt) : null

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO empresa_payment_accounts (
      id, empresa_id, provider, status, reason,
      credential_ciphertext, credential_iv, credential_tag, credential_last4,
      provider_account_label, validated_at, blocked_at
    ) VALUES (
      ${`${params.empresaId}-account`}, ${params.empresaId}, 'mercadopago', ${params.status}, ${params.reason ?? null},
      'cipher', 'iv', 'tag', '1234', 'Cuenta test', ${validatedAt}, ${blockedAt}
    )
  `)
}

async function seedPlatformOwnerPaymentAccount(params: {
  status: 'pending_validation' | 'ready_to_sell' | 'blocked'
  credentialLast4?: string
  oauthConnectedAt?: Date | null
  validatedAt?: Date | null
  blockedAt?: Date | null
  providerAccountLabel?: string | null
}) {
  const singleton = await getSingletonSuperadmin()
  if (!singleton?.id) throw new Error('Missing singleton superadmin for reporting test seed')

  const providerAccountLabel = Object.prototype.hasOwnProperty.call(params, 'providerAccountLabel')
    ? params.providerAccountLabel ?? null
    : 'Owner test'

  const reason = params.status === 'pending_validation' ? 'validation_pending' : params.status === 'blocked' ? 'manual_block' : null
  const validatedAt = params.validatedAt ?? (params.status === 'ready_to_sell' ? new Date() : null)
  const blockedAt = params.blockedAt ?? (params.status === 'blocked' ? new Date() : null)
  const oauthConnectedAt = params.oauthConnectedAt ?? null

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO platform_payment_accounts (
      id, platform_admin_user_id, provider, status, reason,
      credential_ciphertext, credential_iv, credential_tag, credential_last4,
      oauth_connected_at, provider_account_label, validated_at, blocked_at
    ) VALUES (
      'phase5-reporting-owner-account', ${String(singleton.id)}, 'mercadopago', ${params.status}, ${reason},
      'cipher', 'iv', 'tag', ${params.credentialLast4 ?? '5678'},
      ${oauthConnectedAt}, ${providerAccountLabel}, ${validatedAt}, ${blockedAt}
    )
  `)
}

async function seedPlatformStaffPaymentAccount(params: {
  platformAdminUserId: string
  status: 'pending_validation' | 'ready_to_sell' | 'blocked'
  credentialLast4?: string
  providerAccountLabel?: string | null
}) {
  const reason = params.status === 'pending_validation' ? 'validation_pending' : params.status === 'blocked' ? 'manual_block' : null
  const validatedAt = params.status === 'ready_to_sell' ? new Date() : null
  const blockedAt = params.status === 'blocked' ? new Date() : null

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO platform_payment_accounts (
      id, platform_admin_user_id, provider, status, reason,
      credential_ciphertext, credential_iv, credential_tag, credential_last4,
      provider_account_label, validated_at, blocked_at
    ) VALUES (
      ${`${params.platformAdminUserId}-account`}, ${params.platformAdminUserId}, 'mercadopago', ${params.status}, ${reason},
      'cipher', 'iv', 'tag', ${params.credentialLast4 ?? '9999'},
      ${params.providerAccountLabel ?? 'Staff propia'}, ${validatedAt}, ${blockedAt}
    )
  `)
}

async function seedComprador(compradorId: string, empresaId: string) {
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO compradores (id, empresa_id, nombre, email, dni, password)
    VALUES (${compradorId}, ${empresaId}, 'Comprador Reporting', ${`${compradorId}@example.com`}, ${`${compradorId.slice(-16)}-dni`}, ${TEST_PASSWORD_HASH})
  `)
}

async function seedEventoConCategoria({ eventoId, empresaId, categoriaId }: { eventoId: string; empresaId: string; categoriaId: string }) {
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo)
    VALUES (${eventoId}, ${empresaId}, ${`Evento ${eventoId}`}, NULL, NULL, 'unica', NULL, true)
  `)

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO entrada_categorias (id, evento_id, tanda_id, nombre, descripcion, precio, stock, stock_disponible, activa)
    VALUES (${categoriaId}, ${eventoId}, NULL, ${`Categoría ${categoriaId}`}, NULL, 150, 10, 10, true)
  `)
}

async function cleanupTestData() {
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM entradas WHERE id LIKE 'phase5-reporting-%' OR evento_id LIKE 'phase5-reporting-%' OR categoria_id LIKE 'phase5-reporting-%' OR comprador_id LIKE 'phase5-reporting-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM consumibles_ventas WHERE id LIKE 'phase5-reporting-%' OR empresa_id LIKE 'phase5-reporting-%' OR comprador_id LIKE 'phase5-reporting-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresa_payment_accounts WHERE empresa_id LIKE 'phase5-reporting-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_payment_accounts WHERE id = 'phase5-reporting-owner-account'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_payment_accounts WHERE platform_admin_user_id LIKE 'phase5-reporting-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresa_marketplace_fee_overrides WHERE empresa_id LIKE 'phase5-reporting-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresa_marketplace_fees WHERE empresa_id LIKE 'phase5-reporting-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_admin_user_flow_shares WHERE platform_admin_user_id LIKE 'phase5-reporting-%' OR configured_by_platform_admin_id LIKE 'phase5-reporting-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_sale_allocations WHERE effective_platform_admin_user_id LIKE 'phase5-reporting-%' OR configured_platform_admin_user_id LIKE 'phase5-reporting-%' OR checkout_session_id LIKE 'phase5-reporting-%' OR empresa_id LIKE 'phase5-reporting-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_admin_users WHERE id LIKE 'phase5-reporting-%' OR email LIKE 'phase5-reporting-%' OR login_alias LIKE 'phase5-reporting-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM entrada_categorias WHERE id LIKE 'phase5-reporting-%' OR evento_id LIKE 'phase5-reporting-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_marketplace_fee_defaults WHERE updated_by_platform_admin_id = 'phase5-reporting-admin' OR id LIKE 'phase5-reporting-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM eventos WHERE id LIKE 'phase5-reporting-%' OR empresa_id LIKE 'phase5-reporting-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM compradores WHERE id LIKE 'phase5-reporting-%' OR empresa_id LIKE 'phase5-reporting-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresas WHERE id LIKE 'phase5-reporting-%' OR slug LIKE 'phase5-reporting-%'`)
}

beforeEach(async () => {
  await cleanupTestData()
})

after(async () => {
  await cleanupTestData()
  await prismaDirectUrl.$disconnect()
})

test('platform reporting aggregates entradas and consumibles without drift', async () => {
  const empresaId = 'phase5-reporting-emp-1'
  const slug = 'phase5-reporting-empresa-1'
  const eventoId = 'phase5-reporting-evt-1'
  const categoriaId = 'phase5-reporting-cat-1'
  const compradorId = 'phase5-reporting-cmp-1'

  await seedEmpresa({ empresaId, slug })
  await seedComprador(compradorId, empresaId)
  await seedEventoConCategoria({ eventoId, empresaId, categoriaId })

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO entradas (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado, precio_pagado, comision, created_at)
    VALUES ('phase5-reporting-ent-1', ${eventoId}, ${categoriaId}, ${compradorId}, 'phase5-reporting-qr-1', 'RPT1111', 'valida', 150, 21, NOW())
  `)

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO consumibles_ventas (id, barra_id, evento_id, empresa_id, comprador_id, checkout_session_id, origen, qr_code, clave_corta, total, estado, owner_fee_amount, owner_fee_currency, owner_fee_mode, owner_fee_percentage, owner_fee_fixed_amount, created_at)
    VALUES ('phase5-reporting-sale-1', 'phase5-reporting-bar-1', ${eventoId}, ${empresaId}, ${compradorId}, 'phase5-reporting-checkout-1', 'tenant_publico', 'phase5-reporting-qr-2', 'RPT2222', 90, 'confirmado', 9, 'ARS', 'percentage', 10, NULL, NOW())
  `)

  const dashboard = await getPlatformDashboardReporting()
  assert.equal(dashboard.metricas.gananciasOwner >= 30, true)
  assert.equal(dashboard.metricasPorFlow.entradas.gananciasOwner >= 21, true)
  assert.equal(dashboard.metricasPorFlow.consumibles.gananciasOwner >= 9, true)
  assert.ok(dashboard.profitSharing)
  assert.equal(dashboard.profitSharing?.cutoff.source, 'first_allocation')
  assert.equal(
    dashboard.profitSharing?.cutoff.startsAt === null || typeof dashboard.profitSharing?.cutoff.startsAt === 'string',
    true
  )

  const aggregate = (await getPlatformCompanyAggregates()).find((company) => company.id === empresaId)
  assert.ok(aggregate)
  assert.equal(aggregate?.gananciasOwner, 30)
  assert.equal(aggregate?.metricasPorFlow.entradas.gananciasOwner, 21)
  assert.equal(aggregate?.metricasPorFlow.consumibles.gananciasOwner, 9)

  const companyReporting = await getPlatformCompanyReporting(empresaId)
  assert.ok(companyReporting)
  assert.equal(companyReporting?.gananciasOwner, 30)
  assert.equal(companyReporting?.metricasPorFlow.entradas.gananciasOwner, 21)
  assert.equal(companyReporting?.metricasPorFlow.consumibles.gananciasOwner, 9)
  assert.equal(companyReporting?.serieTemporal.some((point) => point.total === 30), true)
})

test('platform dashboard health snapshot aggregates owner status and readiness issues without N+1 helpers', async () => {
  const readyEmpresaId = 'phase5-reporting-health-ready'
  const missingProviderEmpresaId = 'phase5-reporting-health-missing-prov'
  const pendingEmpresaId = 'phase5-reporting-health-pending'
  const missingFeeEmpresaId = 'phase5-reporting-health-missing-fee'
  const blockedEmpresaId = 'phase5-reporting-health-blocked'
  const inactiveEmpresaId = 'phase5-reporting-health-inactive'
  const baseline = await getPlatformDashboardReporting()

  await seedEmpresa({ empresaId: readyEmpresaId, slug: 'phase5-reporting-health-ready' })
  await seedEmpresa({ empresaId: missingProviderEmpresaId, slug: 'phase5-reporting-health-missing-provider' })
  await seedEmpresa({ empresaId: pendingEmpresaId, slug: 'phase5-reporting-health-pending' })
  await seedEmpresa({ empresaId: missingFeeEmpresaId, slug: 'phase5-reporting-health-missing-fee' })
  await seedEmpresa({ empresaId: blockedEmpresaId, slug: 'phase5-reporting-health-blocked' })
  await seedEmpresa({ empresaId: inactiveEmpresaId, slug: 'phase5-reporting-health-inactive' })
  await prismaDirectUrl.$executeRaw(Prisma.sql`UPDATE empresas SET activa = false WHERE id = ${inactiveEmpresaId}`)

  await seedPlatformOwnerPaymentAccount({ status: 'ready_to_sell' })
  await seedEmpresaPaymentAccount({ empresaId: readyEmpresaId, status: 'ready_to_sell' })
  await seedEmpresaPaymentAccount({ empresaId: pendingEmpresaId, status: 'pending_validation', reason: 'validation_pending' })
  await seedEmpresaPaymentAccount({ empresaId: missingFeeEmpresaId, status: 'ready_to_sell' })
  await seedEmpresaPaymentAccount({ empresaId: blockedEmpresaId, status: 'blocked', reason: 'manual_block', blockedAt: new Date().toISOString().slice(0, 19).replace('T', ' ') })

  await upsertMarketplaceFeeConfigByEmpresaId({
    empresaId: readyEmpresaId,
    flow: 'entradas',
    marketplaceFeeMode: 'percentage',
    marketplaceFeePercentage: 12,
    marketplaceFeeFixedAmount: null,
    updatedByPlatformAdminId: 'phase5-reporting-admin',
  })
  await upsertMarketplaceFeeConfigByEmpresaId({
    empresaId: readyEmpresaId,
    flow: 'consumibles',
    marketplaceFeeMode: 'fixed',
    marketplaceFeePercentage: null,
    marketplaceFeeFixedAmount: 10,
    updatedByPlatformAdminId: 'phase5-reporting-admin',
  })
  await upsertMarketplaceFeeConfigByEmpresaId({
    empresaId: missingFeeEmpresaId,
    flow: 'entradas',
    marketplaceFeeMode: 'percentage',
    marketplaceFeePercentage: 8,
    marketplaceFeeFixedAmount: null,
    updatedByPlatformAdminId: 'phase5-reporting-admin',
  })

  const dashboard = await getPlatformDashboardReporting()

  assert.equal(dashboard.healthSnapshot.ownerPaymentAccount?.status, 'ready_to_sell')
  assert.equal(dashboard.healthSnapshot.ownerPaymentAccount?.reason, null)
  assert.deepEqual(dashboard.healthSnapshot.ownerStatus.status, 'ready_to_sell')
  assert.deepEqual(dashboard.healthSnapshot.ownerStatus.reason, null)
  assert.deepEqual(Object.keys(dashboard.healthSnapshot.issueCompanies).sort(), ['deactivated', 'missingCollectionSetup', 'missingMarketplaceFee', 'withOverrides'])
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(dashboard.healthSnapshot.readinessBuckets).map(([key, value]) => [key, value - baseline.healthSnapshot.readinessBuckets[key as keyof typeof baseline.healthSnapshot.readinessBuckets]])
    ),
    {
      missing_collection_setup: 4,
      ready_to_sell: 1,
      deactivated: 1,
    }
  )
  assert.deepEqual(
    {
      total: dashboard.healthSnapshot.issueCounters.total - baseline.healthSnapshot.issueCounters.total,
      missingCollectionSetup: dashboard.healthSnapshot.issueCounters.missingCollectionSetup - baseline.healthSnapshot.issueCounters.missingCollectionSetup,
      deactivated: dashboard.healthSnapshot.issueCounters.deactivated - baseline.healthSnapshot.issueCounters.deactivated,
      missingMarketplaceFee: dashboard.healthSnapshot.issueCounters.missingMarketplaceFee - baseline.healthSnapshot.issueCounters.missingMarketplaceFee,
      withOverrides: dashboard.healthSnapshot.issueCounters.withOverrides - baseline.healthSnapshot.issueCounters.withOverrides,
    },
    {
      total: 5,
      missingCollectionSetup: 4,
      deactivated: 1,
      missingMarketplaceFee: 1,
      withOverrides: 2,
    }
  )
  const missingCollectionSetupIssues = dashboard.healthSnapshot.issueCompanies.missingCollectionSetup
    .filter((company) => [blockedEmpresaId, missingProviderEmpresaId, missingFeeEmpresaId, pendingEmpresaId].includes(company.id))
    .map((company) => ({ id: company.id, status: company.readiness.status, reason: company.readiness.reason, withOverrides: company.withOverrides }))
  assert.deepEqual(missingCollectionSetupIssues, [
    { id: blockedEmpresaId, status: 'blocked', reason: 'manual_block' },
    { id: missingProviderEmpresaId, status: 'missing_provider', reason: 'missing_provider' },
    { id: missingFeeEmpresaId, status: 'pending_validation', reason: 'missing_marketplace_fee' },
    { id: pendingEmpresaId, status: 'pending_validation', reason: 'validation_pending' },
  ].map((company) => ({ ...company, withOverrides: company.id === missingFeeEmpresaId })))
  const deactivatedIssues = dashboard.healthSnapshot.issueCompanies.deactivated
    .filter((company) => company.id === inactiveEmpresaId)
    .map((company) => ({ id: company.id, status: company.readiness.status, reason: company.readiness.reason, withOverrides: company.withOverrides, activa: company.activa }))
  assert.deepEqual(deactivatedIssues, [
    { id: inactiveEmpresaId, status: 'missing_provider', reason: 'missing_provider', withOverrides: false, activa: false },
  ])
  const missingMarketplaceFeeIssues = dashboard.healthSnapshot.issueCompanies.missingMarketplaceFee
    .filter((company) => company.id === missingFeeEmpresaId)
    .map((company) => ({ id: company.id, status: company.readiness.status, reason: company.readiness.reason, withOverrides: company.withOverrides }))
  assert.deepEqual(missingMarketplaceFeeIssues, [
    { id: missingFeeEmpresaId, status: 'pending_validation', reason: 'missing_marketplace_fee', withOverrides: true },
  ])
  const withOverridesIssues = dashboard.healthSnapshot.issueCompanies.withOverrides
    .filter((company) => [readyEmpresaId, missingFeeEmpresaId].includes(company.id))
    .map((company) => ({ id: company.id, status: company.readiness.status, reason: company.readiness.reason, withOverrides: company.withOverrides }))
  assert.deepEqual(withOverridesIssues, [
    { id: missingFeeEmpresaId, status: 'pending_validation', reason: 'missing_marketplace_fee', withOverrides: true },
    { id: readyEmpresaId, status: 'ready_to_sell', reason: null, withOverrides: true },
  ])
  assert.equal(
    Object.values(dashboard.healthSnapshot.issueCompanies)
      .flat()
      .some((company) => company.id === inactiveEmpresaId),
    true
  )
})

test('platform dashboard health snapshot keeps owner oauth read model compatible', async () => {
  const ownerOauthConnectedAt = new Date('2026-05-10T12:00:00.000Z')

  await seedPlatformOwnerPaymentAccount({
    status: 'ready_to_sell',
    credentialLast4: '4321',
    oauthConnectedAt: ownerOauthConnectedAt,
    providerAccountLabel: null,
    validatedAt: new Date('2026-05-10T12:05:00.000Z'),
  })

  const dashboard = await getPlatformDashboardReporting()

  assert.equal(dashboard.healthSnapshot.ownerPaymentAccount?.status, 'ready_to_sell')
  assert.equal(dashboard.healthSnapshot.ownerPaymentAccount?.reason, null)
  assert.equal(dashboard.healthSnapshot.ownerPaymentAccount?.credentialLast4, '••••4321')
  assert.equal(dashboard.healthSnapshot.ownerPaymentAccount?.connectionMode, 'oauth')
  assert.equal(dashboard.healthSnapshot.ownerPaymentAccount?.providerAccountLabel, 'Mercado Pago owner')
  assert.equal(dashboard.healthSnapshot.ownerPaymentAccount?.oauthConnectedAt, ownerOauthConnectedAt.toISOString())
  assert.equal(dashboard.healthSnapshot.ownerStatus.status, 'ready_to_sell')
  assert.equal(dashboard.healthSnapshot.ownerStatus.reason, null)
  assert.equal(dashboard.healthSnapshot.ownerStatus.updatedAt, dashboard.healthSnapshot.ownerPaymentAccount?.validatedAt)
})

test('platform dashboard reporting strips owner health data for staff viewers', async () => {
  const staff = await createPlatformUser({
    nombre: 'Phase5 Reporting Staff',
    email: 'phase5-reporting-staff@example.com',
    loginAlias: 'phase5-reporting-staff',
    password: 'ValidPass123!',
    roleSlug: 'staff',
    permisos: { platform_dashboard: true },
    shareByFlow: { entradas: 15, consumibles: 5 },
    activo: true,
  })

  await seedPlatformOwnerPaymentAccount({
    status: 'ready_to_sell',
    credentialLast4: '1234',
    providerAccountLabel: 'Mercado Pago owner real',
  })
  await seedPlatformStaffPaymentAccount({
    platformAdminUserId: staff.id,
    status: 'ready_to_sell',
    credentialLast4: '6789',
    providerAccountLabel: 'Mercado Pago staff real',
  })

  const dashboard = await getPlatformDashboardReporting({
    id: staff.id,
    email: staff.email,
    name: staff.nombre,
    userType: 'platform_staff',
    roleSlug: staff.roleSlug,
    slug: '',
    permisos: staff.permisos,
  })

  assert.equal(dashboard.viewerScope, 'own')
  assert.equal(dashboard.healthSnapshot.ownerPaymentAccount, null)
  assert.equal(dashboard.healthSnapshot.currentUserPaymentAccount?.credentialLast4, '••••6789')
  assert.equal(dashboard.healthSnapshot.currentUserPaymentAccount?.providerAccountLabel, 'Mercado Pago staff real')
  assert.equal(dashboard.healthSnapshot.ownerStatus.status, 'ready_to_sell')
  assert.equal(dashboard.healthSnapshot.issueCounters.total, 0)
  assert.equal(dashboard.healthSnapshot.issueCompanies.missingCollectionSetup.length, 0)
  assert.deepEqual(dashboard.profitSharing?.users.map((user) => user.userId), [staff.id])
  assert.equal(JSON.stringify(dashboard).includes('Mercado Pago owner real'), false)
  assert.equal(JSON.stringify(dashboard).includes('••••1234'), false)
})
