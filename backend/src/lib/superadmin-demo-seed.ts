import { randomUUID as uuidv4 } from 'node:crypto'
import { prisma } from './prisma'
import { getPlatformMarketplaceFeeDefaultsByFlow, getMarketplaceFeeSummariesByFlow, type PlatformFlow } from './marketplace-fee'
import { getPlatformOwnerPaymentAccountReadModel } from './platform-owner-payment-account'
import { getPlatformCompanyAggregates, getPlatformDashboardReporting } from './platform-reporting'
import { getSalesReadiness, type SalesReadinessStatus } from './sales-readiness'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'

export const SUPERADMIN_DEMO_PREFIX = 'demo-superadmin'
export const SUPERADMIN_DEMO_COMPANY_SLUG_PREFIX = `${SUPERADMIN_DEMO_PREFIX}-empresa-`

type PaymentAccountSeed = {
  label: string
  status: SalesReadinessStatus
  reason: 'credentials_invalid' | 'provider_unreachable' | 'provider_blocked' | 'manual_block' | 'validation_pending' | null
}

type FeeSeed = {
  mode: 'percentage' | 'fixed' | 'hybrid'
  percentage: number | null
  fixedAmount: number | null
}

type EntradaSeed = {
  id: string
  compradorId: string
  precioPagado: number
  comision: number
  createdAt: string
}

type ConsumibleVentaSeed = {
  id: string
  compradorId: string
  total: number
  ownerFeeAmount: number
  ownerFeeMode: 'percentage' | 'fixed' | 'hybrid'
  ownerFeePercentage: number | null
  ownerFeeFixedAmount: number | null
  createdAt: string
}

type DemoCompanySeed = {
  id: string
  slug: string
  nombre: string
  paymentAccount: PaymentAccountSeed
  feeOverrides: Partial<Record<PlatformFlow, FeeSeed>>
  entradas: EntradaSeed[]
  consumibles: ConsumibleVentaSeed[]
}

type DemoCompanyVerification = {
  id: string
  slug: string
  nombre: string
  ventas: number
  volumenBruto: number
  gananciasOwner: number
  readiness: SalesReadinessStatus
  feeSourceEntradas: string | null
  feeSourceConsumibles: string | null
}

type DemoCounts = {
  companies: number
  buyers: number
  events: number
  categories: number
  entradas: number
  consumiblesVentas: number
}

export type SuperadminDemoSeedSummary = {
  counts: DemoCounts
  dashboard: Awaited<ReturnType<typeof getPlatformDashboardReporting>>['metricas']
  dashboardSeriesDays: number
  bestCompany: { id: string; nombre: string; gananciasOwner: number } | null
  ownerPaymentAccountStatus: string | null
  platformFeeDefaults: Awaited<ReturnType<typeof getPlatformMarketplaceFeeDefaultsByFlow>>
  demoCompanies: DemoCompanyVerification[]
}

function toDate(mysqlDateStr: string): Date {
  return new Date(mysqlDateStr.replace(' ', 'T') + 'Z')
}

function buildRelativeDate(daysAgo: number, hourUtc: number) {
  const date = new Date()
  date.setUTCHours(hourUtc, 0, 0, 0)
  date.setUTCDate(date.getUTCDate() - daysAgo)
  // Return ISO string slice for backward compat with seed data definitions
  return date.toISOString().slice(0, 19).replace('T', ' ')
}

function getCredentialSeed(label: string) {
  const normalized = label.replace(/[^a-z0-9]/gi, '').toUpperCase().padEnd(4, '0').slice(-4)
  return {
    ciphertext: Buffer.from(`seed:${label}`, 'utf8').toString('base64'),
    iv: Buffer.from(`iv:${label}`, 'utf8').toString('base64').slice(0, 16),
    tag: Buffer.from(`tag:${label}`, 'utf8').toString('base64').slice(0, 16),
    last4: normalized,
  }
}

const PLATFORM_DEFAULT_FEES: Record<PlatformFlow, FeeSeed> = {
  entradas: { mode: 'percentage', percentage: 12, fixedAmount: null },
  consumibles: { mode: 'fixed', percentage: null, fixedAmount: 15 },
}

function getCompanyKey(company: DemoCompanySeed) {
  return company.id.replace(`${SUPERADMIN_DEMO_PREFIX}-emp-`, '')
}

const DEMO_COMPANIES: DemoCompanySeed[] = [
  {
    id: `${SUPERADMIN_DEMO_PREFIX}-emp-ready`,
    slug: `${SUPERADMIN_DEMO_COMPANY_SLUG_PREFIX}ready-top`,
    nombre: 'Demo Atlas Shows',
    paymentAccount: { label: 'Atlas Seller MP', status: 'ready_to_sell', reason: null },
    feeOverrides: {},
    entradas: [
      { id: `${SUPERADMIN_DEMO_PREFIX}-atlas-ent-1`, compradorId: `${SUPERADMIN_DEMO_PREFIX}-atlas-buyer-1`, precioPagado: 320, comision: 38.4, createdAt: buildRelativeDate(12, 18) },
      { id: `${SUPERADMIN_DEMO_PREFIX}-atlas-ent-2`, compradorId: `${SUPERADMIN_DEMO_PREFIX}-atlas-buyer-2`, precioPagado: 260, comision: 31.2, createdAt: buildRelativeDate(9, 19) },
      { id: `${SUPERADMIN_DEMO_PREFIX}-atlas-ent-3`, compradorId: `${SUPERADMIN_DEMO_PREFIX}-atlas-buyer-1`, precioPagado: 240, comision: 28.8, createdAt: buildRelativeDate(6, 20) },
      { id: `${SUPERADMIN_DEMO_PREFIX}-atlas-ent-4`, compradorId: `${SUPERADMIN_DEMO_PREFIX}-atlas-buyer-2`, precioPagado: 180, comision: 21.6, createdAt: buildRelativeDate(2, 21) },
    ],
    consumibles: [
      { id: `${SUPERADMIN_DEMO_PREFIX}-atlas-con-1`, compradorId: `${SUPERADMIN_DEMO_PREFIX}-atlas-buyer-1`, total: 120, ownerFeeAmount: 15, ownerFeeMode: 'fixed', ownerFeePercentage: null, ownerFeeFixedAmount: 15, createdAt: buildRelativeDate(11, 22) },
      { id: `${SUPERADMIN_DEMO_PREFIX}-atlas-con-2`, compradorId: `${SUPERADMIN_DEMO_PREFIX}-atlas-buyer-2`, total: 180, ownerFeeAmount: 15, ownerFeeMode: 'fixed', ownerFeePercentage: null, ownerFeeFixedAmount: 15, createdAt: buildRelativeDate(3, 23) },
    ],
  },
  {
    id: `${SUPERADMIN_DEMO_PREFIX}-emp-pending`,
    slug: `${SUPERADMIN_DEMO_COMPANY_SLUG_PREFIX}pending`,
    nombre: 'Demo Brava Tickets',
    paymentAccount: { label: 'Brava Seller MP', status: 'pending_validation', reason: 'validation_pending' },
    feeOverrides: {},
    entradas: [
      { id: `${SUPERADMIN_DEMO_PREFIX}-brava-ent-1`, compradorId: `${SUPERADMIN_DEMO_PREFIX}-brava-buyer-1`, precioPagado: 190, comision: 22.8, createdAt: buildRelativeDate(10, 18) },
      { id: `${SUPERADMIN_DEMO_PREFIX}-brava-ent-2`, compradorId: `${SUPERADMIN_DEMO_PREFIX}-brava-buyer-2`, precioPagado: 170, comision: 20.4, createdAt: buildRelativeDate(5, 20) },
    ],
    consumibles: [
      { id: `${SUPERADMIN_DEMO_PREFIX}-brava-con-1`, compradorId: `${SUPERADMIN_DEMO_PREFIX}-brava-buyer-1`, total: 90, ownerFeeAmount: 15, ownerFeeMode: 'fixed', ownerFeePercentage: null, ownerFeeFixedAmount: 15, createdAt: buildRelativeDate(4, 22) },
    ],
  },
  {
    id: `${SUPERADMIN_DEMO_PREFIX}-emp-blocked`,
    slug: `${SUPERADMIN_DEMO_COMPANY_SLUG_PREFIX}blocked`,
    nombre: 'Demo Cobalto Venue',
    paymentAccount: { label: 'Cobalto Seller MP', status: 'blocked', reason: 'manual_block' },
    feeOverrides: {},
    entradas: [
      { id: `${SUPERADMIN_DEMO_PREFIX}-cobalto-ent-1`, compradorId: `${SUPERADMIN_DEMO_PREFIX}-cobalto-buyer-1`, precioPagado: 160, comision: 19.2, createdAt: buildRelativeDate(8, 19) },
    ],
    consumibles: [
      { id: `${SUPERADMIN_DEMO_PREFIX}-cobalto-con-1`, compradorId: `${SUPERADMIN_DEMO_PREFIX}-cobalto-buyer-2`, total: 210, ownerFeeAmount: 15, ownerFeeMode: 'fixed', ownerFeePercentage: null, ownerFeeFixedAmount: 15, createdAt: buildRelativeDate(7, 21) },
      { id: `${SUPERADMIN_DEMO_PREFIX}-cobalto-con-2`, compradorId: `${SUPERADMIN_DEMO_PREFIX}-cobalto-buyer-1`, total: 75, ownerFeeAmount: 15, ownerFeeMode: 'fixed', ownerFeePercentage: null, ownerFeeFixedAmount: 15, createdAt: buildRelativeDate(1, 20) },
    ],
  },
  {
    id: `${SUPERADMIN_DEMO_PREFIX}-emp-nosales`,
    slug: `${SUPERADMIN_DEMO_COMPANY_SLUG_PREFIX}no-sales`,
    nombre: 'Demo Delta Zero',
    paymentAccount: { label: 'Delta Seller MP', status: 'ready_to_sell', reason: null },
    feeOverrides: {
      entradas: { mode: 'hybrid', percentage: 9, fixedAmount: 5 },
    },
    entradas: [],
    consumibles: [],
  },
  {
    id: `${SUPERADMIN_DEMO_PREFIX}-emp-consu`,
    slug: `${SUPERADMIN_DEMO_COMPANY_SLUG_PREFIX}consu-override`,
    nombre: 'Demo Épica Food & Live',
    paymentAccount: { label: 'Epica Seller MP', status: 'ready_to_sell', reason: null },
    feeOverrides: {
      consumibles: { mode: 'percentage', percentage: 18, fixedAmount: null },
    },
    entradas: [
      { id: `${SUPERADMIN_DEMO_PREFIX}-epica-ent-1`, compradorId: `${SUPERADMIN_DEMO_PREFIX}-epica-buyer-1`, precioPagado: 220, comision: 26.4, createdAt: buildRelativeDate(13, 17) },
      { id: `${SUPERADMIN_DEMO_PREFIX}-epica-ent-2`, compradorId: `${SUPERADMIN_DEMO_PREFIX}-epica-buyer-2`, precioPagado: 190, comision: 22.8, createdAt: buildRelativeDate(3, 18) },
    ],
    consumibles: [
      { id: `${SUPERADMIN_DEMO_PREFIX}-epica-con-1`, compradorId: `${SUPERADMIN_DEMO_PREFIX}-epica-buyer-1`, total: 200, ownerFeeAmount: 36, ownerFeeMode: 'percentage', ownerFeePercentage: 18, ownerFeeFixedAmount: null, createdAt: buildRelativeDate(12, 19) },
      { id: `${SUPERADMIN_DEMO_PREFIX}-epica-con-2`, compradorId: `${SUPERADMIN_DEMO_PREFIX}-epica-buyer-1`, total: 140, ownerFeeAmount: 25.2, ownerFeeMode: 'percentage', ownerFeePercentage: 18, ownerFeeFixedAmount: null, createdAt: buildRelativeDate(6, 22) },
      { id: `${SUPERADMIN_DEMO_PREFIX}-epica-con-3`, compradorId: `${SUPERADMIN_DEMO_PREFIX}-epica-buyer-2`, total: 80, ownerFeeAmount: 14.4, ownerFeeMode: 'percentage', ownerFeePercentage: 18, ownerFeeFixedAmount: null, createdAt: buildRelativeDate(2, 19) },
    ],
  },
]

async function upsertPlatformFeeDefault(flow: PlatformFlow, config: FeeSeed) {
  await prisma.platformMarketplaceFeeDefault.upsert({
    where: { flow },
    create: {
      id: uuidv4(),
      flow,
      mode: config.mode,
      percentage: config.percentage !== null ? config.percentage : null,
      fixed_amount: config.fixedAmount !== null ? config.fixedAmount : null,
      updated_by_platform_admin_id: null,
    },
    update: {
      mode: config.mode,
      percentage: config.percentage !== null ? config.percentage : null,
      fixed_amount: config.fixedAmount !== null ? config.fixedAmount : null,
      updated_by_platform_admin_id: null,
    },
  })
}

async function upsertEmpresaFeeOverride(empresaId: string, flow: PlatformFlow, config: FeeSeed) {
  await prisma.empresaMarketplaceFeeOverride.upsert({
    where: { empresa_id_flow: { empresa_id: empresaId, flow } },
    create: {
      id: uuidv4(),
      empresa_id: empresaId,
      flow,
      mode: config.mode,
      percentage: config.percentage !== null ? config.percentage : null,
      fixed_amount: config.fixedAmount !== null ? config.fixedAmount : null,
      updated_by_platform_admin_id: null,
    },
    update: {
      mode: config.mode,
      percentage: config.percentage !== null ? config.percentage : null,
      fixed_amount: config.fixedAmount !== null ? config.fixedAmount : null,
      updated_by_platform_admin_id: null,
    },
  })
}

async function upsertEmpresa(company: DemoCompanySeed) {
  await prisma.empresa.upsert({
    where: { id: company.id },
    create: {
      id: company.id,
      nombre: company.nombre,
      slug: company.slug,
      email: `${company.slug}@demo.local`,
      password: TEST_PASSWORD_HASH,
      admin_nombre: `Admin ${company.nombre}`,
      activa: true,
    },
    update: {
      nombre: company.nombre,
      slug: company.slug,
      email: `${company.slug}@demo.local`,
      password: TEST_PASSWORD_HASH,
      admin_nombre: `Admin ${company.nombre}`,
      activa: true,
    },
  })
}

async function upsertCompradores(company: DemoCompanySeed) {
  const buyerIds = [...new Set([
    ...company.entradas.map((entrada) => entrada.compradorId),
    ...company.consumibles.map((venta) => venta.compradorId),
  ])]

  for (const [index, buyerId] of buyerIds.entries()) {
    await prisma.comprador.upsert({
      where: { id: buyerId },
      create: {
        id: buyerId,
        empresa_id: company.id,
        nombre: `${company.nombre} Buyer ${index + 1}`,
        email: `${buyerId}@demo.local`,
        dni: buyerId.slice(-12),
        password: TEST_PASSWORD_HASH,
      },
      update: {
        nombre: `${company.nombre} Buyer ${index + 1}`,
        email: `${buyerId}@demo.local`,
        dni: buyerId.slice(-12),
        password: TEST_PASSWORD_HASH,
      },
    })
  }
}

async function upsertEventoYCategoria(company: DemoCompanySeed) {
  const companyKey = getCompanyKey(company)
  const eventoId = `${SUPERADMIN_DEMO_PREFIX}-evt-${companyKey}`
  const categoriaId = `${SUPERADMIN_DEMO_PREFIX}-cat-${companyKey}`

  await prisma.evento.upsert({
    where: { id: eventoId },
    create: {
      id: eventoId,
      empresa_id: company.id,
      nombre: `${company.nombre} Live Session`,
      descripcion: `Evento demo para ${company.nombre}`,
      lugar: 'Teatro Demo',
      modo_fecha: 'unica',
      imagen_url: null,
      activo: true,
    },
    update: {
      nombre: `${company.nombre} Live Session`,
      descripcion: `Evento demo para ${company.nombre}`,
      lugar: 'Teatro Demo',
      modo_fecha: 'unica',
      imagen_url: null,
      activo: true,
    },
  })

  await prisma.entradaCategoria.upsert({
    where: { id: categoriaId },
    create: {
      id: categoriaId,
      evento_id: eventoId,
      tanda_id: null,
      nombre: 'General',
      descripcion: 'Categoría demo',
      precio: 350,
      stock: 500,
      stock_disponible: 500,
      activa: true,
    },
    update: {
      nombre: 'General',
      descripcion: 'Categoría demo',
      precio: 350,
      stock: 500,
      stock_disponible: 500,
      activa: true,
    },
  })

  return { eventoId, categoriaId }
}

async function upsertEmpresaPaymentAccount(company: DemoCompanySeed) {
  const companyKey = getCompanyKey(company)
  const credential = getCredentialSeed(company.slug)
  const blockedAt = company.paymentAccount.status === 'blocked' ? toDate(buildRelativeDate(1, 10)) : null
  const validatedAt = company.paymentAccount.status === 'ready_to_sell' ? toDate(buildRelativeDate(0, 10)) : null

  await prisma.empresaPaymentAccount.upsert({
    where: { empresa_id_provider: { empresa_id: company.id, provider: 'mercadopago' } },
    create: {
      id: `${SUPERADMIN_DEMO_PREFIX}-pay-${companyKey}`,
      empresa_id: company.id,
      provider: 'mercadopago',
      status: company.paymentAccount.status as any,
      reason: company.paymentAccount.reason as any,
      credential_ciphertext: credential.ciphertext,
      credential_iv: credential.iv,
      credential_tag: credential.tag,
      credential_last4: credential.last4,
      oauth_refresh_ciphertext: null,
      oauth_refresh_iv: null,
      oauth_refresh_tag: null,
      oauth_token_type: null,
      oauth_scope: null,
      oauth_expires_at: null,
      oauth_connected_at: null,
      provider_account_label: company.paymentAccount.label,
      validated_at: validatedAt,
      last_validation_error: company.paymentAccount.status === 'pending_validation' ? 'seed_pending_validation' : null,
      blocked_at: blockedAt,
    },
    update: {
      status: company.paymentAccount.status as any,
      reason: company.paymentAccount.reason as any,
      credential_ciphertext: credential.ciphertext,
      credential_iv: credential.iv,
      credential_tag: credential.tag,
      credential_last4: credential.last4,
      oauth_refresh_ciphertext: null,
      oauth_refresh_iv: null,
      oauth_refresh_tag: null,
      oauth_token_type: null,
      oauth_scope: null,
      oauth_expires_at: null,
      oauth_connected_at: null,
      provider_account_label: company.paymentAccount.label,
      validated_at: validatedAt,
      last_validation_error: company.paymentAccount.status === 'pending_validation' ? 'seed_pending_validation' : null,
      blocked_at: blockedAt,
    },
  })
}

async function upsertPlatformOwnerPaymentAccount() {
  const credential = getCredentialSeed('platform-owner-demo')
  const ownerReadModel = await getPlatformOwnerPaymentAccountReadModel()
  const ownerPlatformAdminUserId = ownerReadModel?.platformAdminUserId
    ?? await prisma.platformAdminUser.findFirst({
      where: { singleton_key: 'superadmin' },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
      select: { id: true },
    }).then((row) => row?.id ?? null)

  if (!ownerPlatformAdminUserId) {
    throw new Error('Missing singleton superadmin for platform owner payment account seed')
  }

  await prisma.platformPaymentAccount.upsert({
    where: { platform_admin_user_id_provider: { platform_admin_user_id: ownerPlatformAdminUserId, provider: 'mercadopago' } },
    create: {
      id: `${SUPERADMIN_DEMO_PREFIX}-platform-pay`,
      platform_admin_user_id: ownerPlatformAdminUserId,
      provider: 'mercadopago',
      status: 'ready_to_sell',
      reason: null,
      credential_ciphertext: credential.ciphertext,
      credential_iv: credential.iv,
      credential_tag: credential.tag,
      credential_last4: credential.last4,
      provider_account_label: 'Owner Demo MP',
      validated_at: toDate(buildRelativeDate(0, 9)),
      last_validation_error: null,
      blocked_at: null,
    },
    update: {
      platform_admin_user_id: ownerPlatformAdminUserId,
      status: 'ready_to_sell',
      reason: null,
      credential_ciphertext: credential.ciphertext,
      credential_iv: credential.iv,
      credential_tag: credential.tag,
      credential_last4: credential.last4,
      provider_account_label: 'Owner Demo MP',
      validated_at: toDate(buildRelativeDate(0, 9)),
      last_validation_error: null,
      blocked_at: null,
    },
  })
}

async function insertEntradas(company: DemoCompanySeed, eventoId: string, categoriaId: string) {
  for (const entrada of company.entradas) {
    await prisma.entrada.upsert({
      where: { id: entrada.id },
      create: {
        id: entrada.id,
        evento_id: eventoId,
        categoria_id: categoriaId,
        comprador_id: entrada.compradorId,
        qr_code: `qr-${entrada.id}`,
        clave_corta: entrada.id.slice(-8).toUpperCase(),
        estado: 'valida',
        precio_pagado: entrada.precioPagado,
        comision: entrada.comision,
        created_at: toDate(entrada.createdAt),
      },
      update: {
        evento_id: eventoId,
        categoria_id: categoriaId,
        comprador_id: entrada.compradorId,
        qr_code: `qr-${entrada.id}`,
        clave_corta: entrada.id.slice(-8).toUpperCase(),
        estado: 'valida',
        precio_pagado: entrada.precioPagado,
        comision: entrada.comision,
      },
    })
  }
}

async function insertConsumibles(company: DemoCompanySeed, eventoId: string) {
  const companyKey = getCompanyKey(company)
  for (const venta of company.consumibles) {
    await prisma.consumiblesVenta.upsert({
      where: { id: venta.id },
      create: {
        id: venta.id,
        barra_id: `${SUPERADMIN_DEMO_PREFIX}-bar-${companyKey}`,
        evento_id: eventoId,
        empresa_id: company.id,
        comprador_id: venta.compradorId,
        checkout_session_id: `${venta.id}-checkout`,
        origen: 'tenant_publico',
        qr_code: `qr-${venta.id}`,
        clave_corta: venta.id.slice(-8).toUpperCase(),
        total: venta.total,
        estado: 'confirmado',
        owner_fee_amount: venta.ownerFeeAmount,
        owner_fee_currency: 'ARS',
        owner_fee_mode: venta.ownerFeeMode,
        owner_fee_percentage: venta.ownerFeePercentage !== null ? venta.ownerFeePercentage : null,
        owner_fee_fixed_amount: venta.ownerFeeFixedAmount !== null ? venta.ownerFeeFixedAmount : null,
        created_at: toDate(venta.createdAt),
      },
      update: {
        barra_id: `${SUPERADMIN_DEMO_PREFIX}-bar-${companyKey}`,
        evento_id: eventoId,
        empresa_id: company.id,
        comprador_id: venta.compradorId,
        checkout_session_id: `${venta.id}-checkout`,
        origen: 'tenant_publico',
        qr_code: `qr-${venta.id}`,
        clave_corta: venta.id.slice(-8).toUpperCase(),
        total: venta.total,
        estado: 'confirmado',
        owner_fee_amount: venta.ownerFeeAmount,
        owner_fee_currency: 'ARS',
        owner_fee_mode: venta.ownerFeeMode,
        owner_fee_percentage: venta.ownerFeePercentage !== null ? venta.ownerFeePercentage : null,
        owner_fee_fixed_amount: venta.ownerFeeFixedAmount !== null ? venta.ownerFeeFixedAmount : null,
      },
    })
  }
}

export async function cleanupSuperadminDemoData() {
  await prisma.$transaction(async (tx) => {
    await tx.consumiblesVenta.deleteMany({
      where: {
        OR: [
          { empresa_id: { startsWith: SUPERADMIN_DEMO_PREFIX } },
          { id: { startsWith: SUPERADMIN_DEMO_PREFIX } },
          { checkout_session_id: { startsWith: SUPERADMIN_DEMO_PREFIX } },
        ],
      },
    })
    await tx.entrada.deleteMany({
      where: {
        OR: [
          { id: { startsWith: SUPERADMIN_DEMO_PREFIX } },
          { comprador_id: { startsWith: SUPERADMIN_DEMO_PREFIX } },
          { evento_id: { startsWith: SUPERADMIN_DEMO_PREFIX } },
          { categoria_id: { startsWith: SUPERADMIN_DEMO_PREFIX } },
        ],
      },
    })
    await tx.entradaCategoria.deleteMany({
      where: {
        OR: [
          { id: { startsWith: SUPERADMIN_DEMO_PREFIX } },
          { evento_id: { startsWith: SUPERADMIN_DEMO_PREFIX } },
        ],
      },
    })
    await tx.evento.deleteMany({
      where: {
        OR: [
          { id: { startsWith: SUPERADMIN_DEMO_PREFIX } },
          { empresa_id: { startsWith: SUPERADMIN_DEMO_PREFIX } },
        ],
      },
    })
    await tx.comprador.deleteMany({
      where: {
        OR: [
          { id: { startsWith: SUPERADMIN_DEMO_PREFIX } },
          { empresa_id: { startsWith: SUPERADMIN_DEMO_PREFIX } },
          { email: { endsWith: '@demo.local', startsWith: SUPERADMIN_DEMO_PREFIX } },
        ],
      },
    })
    await tx.empresaMarketplaceFeeOverride.deleteMany({
      where: { empresa_id: { startsWith: SUPERADMIN_DEMO_PREFIX } },
    })
    await tx.empresaPaymentAccount.deleteMany({
      where: {
        OR: [
          { empresa_id: { startsWith: SUPERADMIN_DEMO_PREFIX } },
          { id: { startsWith: SUPERADMIN_DEMO_PREFIX } },
        ],
      },
    })
    await tx.empresa.deleteMany({
      where: {
        OR: [
          { id: { startsWith: SUPERADMIN_DEMO_PREFIX } },
          { slug: { startsWith: SUPERADMIN_DEMO_COMPANY_SLUG_PREFIX } },
          { email: { startsWith: SUPERADMIN_DEMO_COMPANY_SLUG_PREFIX } },
        ],
      },
    })
  })
}

async function getDemoCounts() {
  const [companies, buyers, events, categories, entradas, consumiblesVentas] = await Promise.all([
    prisma.empresa.count({ where: { slug: { startsWith: SUPERADMIN_DEMO_COMPANY_SLUG_PREFIX } } }),
    prisma.comprador.count({ where: { id: { startsWith: SUPERADMIN_DEMO_PREFIX } } }),
    prisma.evento.count({ where: { id: { startsWith: SUPERADMIN_DEMO_PREFIX } } }),
    prisma.entradaCategoria.count({ where: { id: { startsWith: SUPERADMIN_DEMO_PREFIX } } }),
    prisma.entrada.count({ where: { id: { startsWith: SUPERADMIN_DEMO_PREFIX } } }),
    prisma.consumiblesVenta.count({ where: { id: { startsWith: SUPERADMIN_DEMO_PREFIX } } }),
  ])

  return {
    companies: Number(companies),
    buyers: Number(buyers),
    events: Number(events),
    categories: Number(categories),
    entradas: Number(entradas),
    consumiblesVentas: Number(consumiblesVentas),
  }
}

export async function getSuperadminDemoSeedSummary(): Promise<SuperadminDemoSeedSummary> {
  const [dashboard, companyAggregates, ownerPaymentAccount, platformFeeDefaults] = await Promise.all([
    getPlatformDashboardReporting(),
    getPlatformCompanyAggregates({ sortByOwnerGainsDesc: true }),
    getPlatformOwnerPaymentAccountReadModel(),
    getPlatformMarketplaceFeeDefaultsByFlow(),
  ])

  const demoCompanies = companyAggregates.filter((company) => company.slug.startsWith(SUPERADMIN_DEMO_COMPANY_SLUG_PREFIX))
  const verificationCompanies = await Promise.all(
    demoCompanies.map(async (company) => {
      const [readiness, feeSummaryByFlow] = await Promise.all([
        getSalesReadiness(company.id),
        getMarketplaceFeeSummariesByFlow(company.id),
      ])

      return {
        id: company.id,
        slug: company.slug,
        nombre: company.nombre,
        ventas: company.ventas,
        volumenBruto: company.volumenBruto,
        gananciasOwner: company.gananciasOwner,
        readiness: readiness.status,
        feeSourceEntradas: feeSummaryByFlow.entradas.source,
        feeSourceConsumibles: feeSummaryByFlow.consumibles.source,
      }
    })
  )

  return {
    counts: await getDemoCounts(),
    dashboard: dashboard.metricas,
    dashboardSeriesDays: dashboard.gananciasPorDia.length,
    bestCompany: demoCompanies[0]
      ? { id: demoCompanies[0].id, nombre: demoCompanies[0].nombre, gananciasOwner: demoCompanies[0].gananciasOwner }
      : null,
    ownerPaymentAccountStatus: ownerPaymentAccount?.status ?? null,
    platformFeeDefaults,
    demoCompanies: verificationCompanies.sort((a, b) => b.gananciasOwner - a.gananciasOwner || a.nombre.localeCompare(b.nombre)),
  }
}

export async function seedSuperadminDemoData() {
  await cleanupSuperadminDemoData()

  await upsertPlatformOwnerPaymentAccount()
  await upsertPlatformFeeDefault('entradas', PLATFORM_DEFAULT_FEES.entradas)
  await upsertPlatformFeeDefault('consumibles', PLATFORM_DEFAULT_FEES.consumibles)

  for (const company of DEMO_COMPANIES) {
    await upsertEmpresa(company)
    await upsertCompradores(company)
    const { eventoId, categoriaId } = await upsertEventoYCategoria(company)
    await upsertEmpresaPaymentAccount(company)

    for (const [flow, config] of Object.entries(company.feeOverrides) as Array<[PlatformFlow, FeeSeed | undefined]>) {
      if (config) {
        await upsertEmpresaFeeOverride(company.id, flow, config)
      }
    }

    await insertEntradas(company, eventoId, categoriaId)
    await insertConsumibles(company, eventoId)
  }

  return getSuperadminDemoSeedSummary()
}
