import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { Express } from 'express'
import express from 'express'
import { Payment, Preference } from 'mercadopago'

process.env.INTERNAL_API_SECRET = 'test-internal-secret'
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
process.env.PAYMENT_ACCOUNTS_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
process.env.MARKETPLACE_FEE_MODE = 'percentage'
process.env.MARKETPLACE_FEE_PERCENTAGE = '12.5'
process.env.MERCADO_PAGO_OAUTH_CLIENT_ID = 'mp-client-id'
process.env.MERCADO_PAGO_OAUTH_CLIENT_SECRET = 'mp-client-secret'
process.env.MERCADO_PAGO_OAUTH_REDIRECT_URI = ''
process.env.MERCADO_PAGO_OAUTH_PLATFORM_REDIRECT_URI = ''

import pool from './db'
import {
  calculateMarketplaceFee,
  getMarketplaceFeeSummary,
  getMarketplaceFeeSummariesByFlow,
  resolveMarketplaceFee,
} from './lib/marketplace-fee'
import {
  getPaymentAccountByEmpresaId,
  getPaymentAccountReadModelByEmpresaId,
  upsertPaymentAccountByEmpresaId,
  validateMercadoPagoAccessToken,
} from './lib/payment-accounts'
import { getSalesReadiness } from './lib/sales-readiness'
import cobrosRouter from './routes/cobros'
import configuracionRouter from './routes/configuracion'
import platformRouter from './routes/platform'
import tenantRouter from './routes/tenant'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch

// Id del superadmin singleton que este archivo degrada para instalar el suyo.
// Se restaura en el after() — ver seedPlatformSuperadmin.
let demotedRootId: string | null = null
const originalPreferenceCreate = Preference.prototype.create

function buildEmpresaUser(empresaId: string) {
  return {
    id: empresaId,
    email: `${empresaId}@example.com`,
    userType: 'empresa' as const,
  }
}

function buildCompradorUser(compradorId: string, empresaId: string, slug: string, email: string) {
  return {
    id: compradorId,
    email,
    slug,
    empresa_id: empresaId,
    empresa_slug: slug,
    userType: 'comprador' as const,
  }
}

function buildSuperAdminUser(adminId: string, email: string) {
  return {
    id: adminId,
    email,
    userType: 'super_admin' as const,
  }
}

function buildPlatformStaffUser(adminId: string, email: string, permisos: Record<string, boolean> = {}) {
  return {
    id: adminId,
    email,
    userType: 'platform_staff' as const,
    roleSlug: 'staff' as const,
    permisos,
  }
}

function buildHeaders(user: Record<string, unknown> | null = null) {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
    'x-user': JSON.stringify(user),
  }
}

function mockFetch(implementation: typeof fetch) {
  globalThis.fetch = implementation
}

type JsonResponse<T = any> = {
  status: number
  data: T
}

async function createTestServer(app: Express) {
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

async function requestJson<T = any>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown, user: Record<string, unknown> | null = null): Promise<JsonResponse<T>> {
  const response = await originalFetch(url, {
    method,
    headers: buildHeaders(user),
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const data = await response.json().catch(() => null)
  return { status: response.status, data: data as T }
}

async function requestRaw(method: 'GET', url: string, user: Record<string, unknown> | null = null) {
  return originalFetch(url, {
    method,
    headers: buildHeaders(user),
    redirect: 'manual',
  })
}

function assertOwnerSecretsHidden(surface: unknown, secrets: string[] = []) {
  const serialized = JSON.stringify(surface)

  assert.equal(serialized.includes('credential_ciphertext'), false)
  assert.equal(serialized.includes('oauth_refresh_ciphertext'), false)
  assert.equal(serialized.includes('accessToken'), false)
  assert.equal(serialized.includes('refreshToken'), false)

  for (const secret of secrets) {
    assert.equal(serialized.includes(secret), false)
  }
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

async function seedPlatformAdmin({
  adminId,
  email,
  nombre = 'Owner Platea',
  roleSlug = 'superadmin',
  singletonKey = 'superadmin',
}: {
  adminId: string
  email: string
  nombre?: string
  roleSlug?: 'superadmin' | 'staff'
  singletonKey?: string | null
}) {
  // Este helper DEGRADA el superadmin singleton que sembro prepare-test-db para
  // poner el suyo. Antes no lo restauraba, asi que al terminar este archivo la
  // plataforma quedaba SIN root: todos los tests posteriores que hacen
  // getRootUserId() reventaban con "Cannot read properties of undefined".
  // Peor aun, platform-profit-sharing borra por `singleton_key IS NULL`, o sea
  // que el root degradado terminaba eliminado.
  // Guardamos cual era para devolverlo en el after().
  const [prevRoot] = await pool.query<any[]>(
    `SELECT id FROM platform_admin_users WHERE singleton_key = 'superadmin' LIMIT 1`
  )
  if (prevRoot?.[0]?.id && !demotedRootId) {
    demotedRootId = String(prevRoot[0].id)
  }

  await pool.query(
    `UPDATE platform_admin_users
     SET role_slug = CASE WHEN role_slug = 'superadmin' THEN 'empleado' ELSE role_slug END,
          singleton_key = NULL
     WHERE singleton_key = 'superadmin'`
  )

  await pool.query(
    `INSERT INTO platform_admin_users (id, nombre, email, login_alias, password, role_slug, singleton_key, activo)
     VALUES (?, ?, ?, ?, ?, ?, ?, true)`,
    [adminId, nombre, email, `alias-${adminId}`, TEST_PASSWORD_HASH, roleSlug, singletonKey]
  )
}

async function seedPlatformStaff(params: {
  adminId: string
  email: string
  nombre?: string
  permisos?: Record<string, boolean>
}) {
  await pool.query(
    `INSERT INTO platform_admin_users (id, nombre, email, login_alias, password, role_slug, permisos, activo)
     VALUES (?, ?, ?, ?, ?, 'empleado', ?, true)`,
    [
      params.adminId,
      params.nombre ?? 'Staff Platea',
      params.email,
      `alias-${params.adminId}`,
      TEST_PASSWORD_HASH,
      JSON.stringify(params.permisos ?? {}),
    ]
  )
}

async function seedEmpleado({ userId, empresaId, email, nombre = 'Empleado', apellido = 'Demo' }: { userId: string; empresaId: string; email: string; nombre?: string; apellido?: string }) {
  await pool.query(
    `INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, activo, permisos)
     VALUES (?, ?, ?, ?, ?, ?, 'admin', true, NULL)`,
    [userId, empresaId, nombre, apellido, email, TEST_PASSWORD_HASH]
  )
}

function buildEmpleadoUser(userId: string, empresaId: string, email: string) {
  return {
    id: userId,
    email,
    empresa_id: empresaId,
    userType: 'empleado' as const,
    permisos: {},
  }
}

async function seedEventoConCategoria({
  eventoId,
  empresaId,
  categoriaId,
  precio,
  stock,
}: {
  eventoId: string
  empresaId: string
  categoriaId: string
  precio: number
  stock: number
}) {
  await pool.query(
    `INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo)
     VALUES (?, ?, ?, NULL, NULL, 'unica', NULL, true)`,
    [eventoId, empresaId, `Evento ${eventoId}`]
  )

  await pool.query(
    `INSERT INTO entrada_categorias (id, evento_id, tanda_id, nombre, descripcion, precio, stock, stock_disponible, activa)
     VALUES (?, ?, NULL, ?, NULL, ?, ?, ?, true)`,
    [categoriaId, eventoId, `Categoría ${categoriaId}`, precio, stock, stock]
  )
}

async function seedEventoConConsumiblePublico({
  eventoId,
  empresaId,
  barraId,
  consumibleId,
  precio,
  stock,
}: {
  eventoId: string
  empresaId: string
  barraId: string
  consumibleId: string
  precio: number
  stock: number
}) {
  await pool.query(`ALTER TABLE eventos ADD COLUMN IF NOT EXISTS venta_consumibles_habilitada boolean NOT NULL DEFAULT false`)

  await pool.query(
    `INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo, venta_consumibles_habilitada)
     VALUES (?, ?, ?, NULL, NULL, 'unica', NULL, true, true)`,
    [eventoId, empresaId, `Evento ${eventoId}`]
  )

  await pool.query(
    `INSERT INTO barras (id, evento_id, empresa_id, nombre, activa)
     VALUES (?, ?, ?, ?, true)`,
    [barraId, eventoId, empresaId, `Barra ${barraId}`]
  )

  await pool.query(
    `INSERT INTO consumibles (id, empresa_id, nombre, descripcion, precio, imagen_url, activo)
     VALUES (?, ?, ?, NULL, ?, NULL, true)`,
    [consumibleId, empresaId, `Consumible ${consumibleId}`, precio]
  )

  await pool.query(
    `INSERT INTO barra_stock (id, barra_id, consumible_id, stock_inicial, stock_actual, precio_override, activo)
     VALUES (?, ?, ?, ?, ?, NULL, true)`,
    [`phase5-stock-${barraId}`, barraId, consumibleId, stock, stock]
  )
}

async function cleanupTestData() {
  await pool.query(`DELETE FROM entradas WHERE evento_id LIKE 'phase5-evt-%' OR categoria_id LIKE 'phase5-cat-%' OR comprador_id LIKE 'phase5-cmp-%'`)
  await pool.query(`DELETE FROM checkout_sessions WHERE empresa_id LIKE 'phase5-emp-%' OR comprador_id LIKE 'phase5-cmp-%'`)
  await pool.query(`DELETE FROM consumibles_venta_items WHERE venta_id LIKE 'phase5-sale-%' OR id LIKE 'phase5-item-%'`)
  await pool.query(`DELETE FROM consumibles_ventas WHERE id LIKE 'phase5-sale-%' OR empresa_id LIKE 'phase5-emp-%' OR comprador_id LIKE 'phase5-cmp-%' OR checkout_session_id LIKE 'phase5-checkout-%'`)
  await pool.query(`DELETE FROM barra_stock WHERE barra_id LIKE 'phase5-bar-%' OR consumible_id LIKE 'phase5-con-%'`)
  await pool.query(`DELETE FROM barras WHERE id LIKE 'phase5-bar-%' OR empresa_id LIKE 'phase5-emp-%'`)
  await pool.query(`DELETE FROM consumibles WHERE id LIKE 'phase5-con-%' OR empresa_id LIKE 'phase5-emp-%'`)
  await pool.query(`DELETE FROM entrada_categorias WHERE id LIKE 'phase5-cat-%' OR evento_id LIKE 'phase5-evt-%'`)
  await pool.query(`DELETE FROM evento_fechas WHERE evento_id LIKE 'phase5-evt-%'`)
  await pool.query(`DELETE FROM evento_tandas WHERE evento_id LIKE 'phase5-evt-%'`)
  await pool.query(`DELETE FROM eventos WHERE id LIKE 'phase5-evt-%' OR empresa_id LIKE 'phase5-emp-%'`)
  await pool.query(`DELETE FROM compradores WHERE id LIKE 'phase5-cmp-%' OR empresa_id LIKE 'phase5-emp-%'`)
  await pool.query(`DELETE FROM usuarios WHERE id LIKE 'phase5-usr-%' OR empresa_id LIKE 'phase5-emp-%'`)
  await pool.query(`DELETE FROM platform_payment_accounts`)
  await pool.query(`DELETE FROM empresa_marketplace_fees WHERE empresa_id LIKE 'phase5-emp-%'`)
  await pool.query(`DELETE FROM empresa_marketplace_fee_overrides WHERE empresa_id LIKE 'phase5-emp-%'`)
  await pool.query(`DELETE FROM platform_marketplace_fee_defaults WHERE flow IN ('entradas', 'consumibles')`)
  await pool.query(`DELETE FROM platform_admin_users WHERE id LIKE 'phase5-admin-%' OR email LIKE 'phase5-admin-%'`)
  await pool.query(`DELETE FROM empresa_payment_accounts WHERE empresa_id LIKE 'phase5-emp-%'`)
  await pool.query(`DELETE FROM empresas WHERE id LIKE 'phase5-emp-%' OR slug LIKE 'phase5-%'`)
}

async function ensureRequiredSchema() {
  await pool.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS tenant_public_disabled boolean NOT NULL DEFAULT false`)
  await pool.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS tenant_public_disabled_at timestamptz DEFAULT NULL`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS empresa_payment_accounts (
      id varchar(36) NOT NULL,
      empresa_id varchar(36) NOT NULL,
      provider varchar(40) NOT NULL DEFAULT 'mercadopago',
      status varchar(40) NOT NULL DEFAULT 'pending_validation',
      reason varchar(40) DEFAULT 'validation_pending',
      credential_ciphertext varchar(512) NOT NULL,
      credential_iv varchar(64) NOT NULL,
      credential_tag varchar(64) NOT NULL,
      credential_last4 varchar(4) DEFAULT NULL,
      oauth_refresh_ciphertext varchar(512) DEFAULT NULL,
      oauth_refresh_iv varchar(64) DEFAULT NULL,
      oauth_refresh_tag varchar(64) DEFAULT NULL,
      oauth_token_type varchar(40) DEFAULT NULL,
      oauth_scope varchar(120) DEFAULT NULL,
      oauth_expires_at timestamptz DEFAULT NULL,
      oauth_connected_at timestamptz DEFAULT NULL,
      marketplace_fee_mode varchar(20) NOT NULL DEFAULT 'percentage',
      marketplace_fee_percentage decimal(5,2) DEFAULT NULL,
      marketplace_fee_fixed_amount decimal(10,2) DEFAULT NULL,
      provider_account_label varchar(120) DEFAULT NULL,
      validated_at timestamptz DEFAULT NULL,
      last_validation_error varchar(80) DEFAULT NULL,
      blocked_at timestamptz DEFAULT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id),
      UNIQUE (empresa_id, provider)
    )
  `)

  await pool.query(`
    ALTER TABLE empresa_payment_accounts
      ADD COLUMN IF NOT EXISTS oauth_refresh_ciphertext varchar(512) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS oauth_refresh_iv varchar(64) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS oauth_refresh_tag varchar(64) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS oauth_token_type varchar(40) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS oauth_scope varchar(120) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS oauth_expires_at timestamptz DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS oauth_connected_at timestamptz DEFAULT NULL
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_admin_users (
      id varchar(36) NOT NULL,
      nombre varchar(120) NOT NULL,
      email varchar(191) NOT NULL,
      password varchar(255) NOT NULL,
      activo boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id),
      UNIQUE (email)
    )
  `)

  await pool.query(`
    ALTER TABLE platform_admin_users
      ADD COLUMN IF NOT EXISTS login_alias varchar(80) NOT NULL DEFAULT '',
      ADD COLUMN IF NOT EXISTS role_slug varchar(40) NOT NULL DEFAULT 'empleado',
      ADD COLUMN IF NOT EXISTS permisos text DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS singleton_key varchar(80) DEFAULT NULL
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS empresa_marketplace_fees (
      id varchar(36) NOT NULL,
      empresa_id varchar(36) NOT NULL,
      mode varchar(20) NOT NULL,
      percentage decimal(5,2) DEFAULT NULL,
      fixed_amount decimal(10,2) DEFAULT NULL,
      updated_by_platform_admin_id varchar(36) DEFAULT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id),
      UNIQUE (empresa_id)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_marketplace_fee_defaults (
      id varchar(36) NOT NULL,
      flow varchar(40) NOT NULL,
      mode varchar(20) DEFAULT NULL,
      percentage decimal(5,2) DEFAULT NULL,
      fixed_amount decimal(10,2) DEFAULT NULL,
      updated_by_platform_admin_id varchar(36) DEFAULT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id),
      UNIQUE (flow)
    )
  `)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS empresa_marketplace_fee_overrides (
      id varchar(36) NOT NULL,
      empresa_id varchar(36) NOT NULL,
      flow varchar(40) NOT NULL,
      mode varchar(20) DEFAULT NULL,
      percentage decimal(5,2) DEFAULT NULL,
      fixed_amount decimal(10,2) DEFAULT NULL,
      updated_by_platform_admin_id varchar(36) DEFAULT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id),
      UNIQUE (empresa_id, flow)
    )
  `)

  await pool.query(`ALTER TABLE consumibles_ventas ADD COLUMN IF NOT EXISTS comprador_id varchar(36) DEFAULT NULL`)
  await pool.query(`ALTER TABLE consumibles_ventas ADD COLUMN IF NOT EXISTS checkout_session_id varchar(80) DEFAULT NULL`)
  await pool.query(`ALTER TABLE consumibles_ventas ADD COLUMN IF NOT EXISTS origen varchar(40) NOT NULL DEFAULT 'manual'`)
  await pool.query(`ALTER TABLE consumibles_ventas ADD COLUMN IF NOT EXISTS owner_fee_amount decimal(10,2) DEFAULT NULL`)
  await pool.query(`ALTER TABLE consumibles_ventas ADD COLUMN IF NOT EXISTS owner_fee_currency varchar(12) DEFAULT NULL`)
  await pool.query(`ALTER TABLE consumibles_ventas ADD COLUMN IF NOT EXISTS owner_fee_mode varchar(20) DEFAULT NULL`)
  await pool.query(`ALTER TABLE consumibles_ventas ADD COLUMN IF NOT EXISTS owner_fee_percentage decimal(5,2) DEFAULT NULL`)
  await pool.query(`ALTER TABLE consumibles_ventas ADD COLUMN IF NOT EXISTS owner_fee_fixed_amount decimal(10,2) DEFAULT NULL`)

  await pool.query(`
    CREATE TABLE IF NOT EXISTS platform_payment_accounts (
      id varchar(36) NOT NULL,
      provider varchar(40) NOT NULL DEFAULT 'mercadopago',
      status varchar(40) NOT NULL DEFAULT 'pending_validation',
      reason varchar(40) DEFAULT 'validation_pending',
      credential_ciphertext varchar(512) NOT NULL,
      credential_iv varchar(64) NOT NULL,
      credential_tag varchar(64) NOT NULL,
      credential_last4 varchar(4) DEFAULT NULL,
      oauth_refresh_ciphertext varchar(512) DEFAULT NULL,
      oauth_refresh_iv varchar(64) DEFAULT NULL,
      oauth_refresh_tag varchar(64) DEFAULT NULL,
      oauth_token_type varchar(40) DEFAULT NULL,
      oauth_scope varchar(120) DEFAULT NULL,
      oauth_expires_at timestamptz DEFAULT NULL,
      oauth_connected_at timestamptz DEFAULT NULL,
      provider_account_label varchar(120) DEFAULT NULL,
      validated_at timestamptz DEFAULT NULL,
      last_validation_error varchar(80) DEFAULT NULL,
      blocked_at timestamptz DEFAULT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id),
      UNIQUE (provider)
    )
  `)

  await pool.query(`
    ALTER TABLE platform_payment_accounts
      ADD COLUMN IF NOT EXISTS oauth_refresh_ciphertext varchar(512) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS oauth_refresh_iv varchar(64) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS oauth_refresh_tag varchar(64) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS oauth_token_type varchar(40) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS oauth_scope varchar(120) DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS oauth_expires_at timestamptz DEFAULT NULL,
      ADD COLUMN IF NOT EXISTS oauth_connected_at timestamptz DEFAULT NULL
  `)
}

beforeEach(async () => {
  globalThis.fetch = originalFetch
  Preference.prototype.create = originalPreferenceCreate
  process.env.MARKETPLACE_FEE_MODE = 'percentage'
  process.env.MARKETPLACE_FEE_PERCENTAGE = '12.5'
  process.env.MARKETPLACE_FEE_FIXED_AMOUNT = ''
  await ensureRequiredSchema()
  await cleanupTestData()
})

after(async () => {
  globalThis.fetch = originalFetch
  Preference.prototype.create = originalPreferenceCreate
  await ensureRequiredSchema()
  await cleanupTestData()

  // Devolver el superadmin singleton que este archivo degrado. Sin esto la
  // plataforma queda sin root y se cae toda la familia platform-governance /
  // profit-sharing que corre despues. Un test que ensucia estado global tiene
  // que limpiarlo: los demas no deberian depender del orden de ejecucion.
  if (demotedRootId) {
    await pool.query(
      `UPDATE platform_admin_users
       SET role_slug = 'superadmin', singleton_key = 'superadmin', activo = true
       WHERE id = ?`,
      [demotedRootId]
    )
    demotedRootId = null
  }

  await pool.end()
})

test('payment accounts encrypt/decrypt credentials and redact read models', async () => {
  const empresaId = 'phase5-emp-unit-1'
  await seedEmpresa({ empresaId, slug: 'phase5-unit-1' })

  mockFetch(async () => ({ ok: true, status: 200 }) as Response)

  await upsertPaymentAccountByEmpresaId({
    empresaId,
    accessToken: '  APP_USR-1234567890  ',
  })

  const [rows] = await pool.query<any[]>(
    `SELECT credential_ciphertext, credential_iv, credential_tag, credential_last4
     FROM empresa_payment_accounts WHERE empresa_id = ?`,
    [empresaId]
  )

  assert.equal(rows.length, 1)
  assert.notEqual(rows[0].credential_ciphertext, 'APP_USR-1234567890')
  assert.ok(rows[0].credential_iv)
  assert.ok(rows[0].credential_tag)
  assert.equal(rows[0].credential_last4, '7890')

  const paymentAccount = await getPaymentAccountByEmpresaId(empresaId)
  const readModel = await getPaymentAccountReadModelByEmpresaId(empresaId)

  assert.equal(paymentAccount?.accessToken, 'APP_USR-1234567890')
  assert.equal(readModel?.credentialLast4, '••••7890')
  assert.equal('accessToken' in (readModel as object), false)
})

test('payment account validation maps credentials_invalid and provider_unreachable', async () => {
  mockFetch(async () => ({ ok: false, status: 401 }) as Response)
  const invalidCredentials = await validateMercadoPagoAccessToken('APP_USR-invalid')
  assert.equal(invalidCredentials.status, 'blocked')
  assert.equal(invalidCredentials.reason, 'credentials_invalid')

  mockFetch(async () => ({ ok: false, status: 500 }) as Response)
  const unreachableProvider = await validateMercadoPagoAccessToken('APP_USR-unreachable')
  assert.equal(unreachableProvider.status, 'pending_validation')
  assert.equal(unreachableProvider.reason, 'provider_unreachable')
})

test('sales readiness falls back to missing_provider and prioritizes blocked', async () => {
  const missingEmpresaId = 'phase5-emp-ready-0'
  await seedEmpresa({ empresaId: missingEmpresaId, slug: 'phase5-missing-provider' })

  const missingProvider = await getSalesReadiness(missingEmpresaId)
  assert.deepEqual(missingProvider, {
    status: 'missing_provider',
    reason: 'missing_provider',
    canSell: false,
  })

  const blockedEmpresaId = 'phase5-emp-ready-1'
  await seedEmpresa({ empresaId: blockedEmpresaId, slug: 'phase5-blocked-priority' })
  mockFetch(async () => ({ ok: true, status: 200 }) as Response)

  await upsertPaymentAccountByEmpresaId({
    empresaId: blockedEmpresaId,
    accessToken: 'APP_USR-blocked-priority',
  })

  await pool.query(
    `UPDATE empresa_payment_accounts
     SET status = 'ready_to_sell', reason = NULL, blocked_at = NOW()
     WHERE empresa_id = ?`,
    [blockedEmpresaId]
  )

  const blockedReadiness = await getSalesReadiness(blockedEmpresaId)
  assert.deepEqual(blockedReadiness, {
    status: 'blocked',
    reason: 'manual_block',
    canSell: false,
  })
})

test('marketplace fee resolves percentage, fixed, rounding, disabled fee and invalid subtotals', async () => {
  const percentage = calculateMarketplaceFee(100, {
    marketplaceFeeMode: 'percentage',
    marketplaceFeePercentage: 12.5,
    marketplaceFeeFixedAmount: null,
  })
  assert.equal(percentage.amount, 12.5)
  assert.equal(percentage.metadata.percentageAmount, 12.5)

  const fixed = calculateMarketplaceFee(100, {
    marketplaceFeeMode: 'fixed',
    marketplaceFeePercentage: null,
    marketplaceFeeFixedAmount: 15.75,
  })
  assert.equal(fixed.amount, 15.75)
  assert.equal(fixed.metadata.fixedAmountApplied, 15.75)

  const rounded = calculateMarketplaceFee(99.99, {
    marketplaceFeeMode: 'hybrid',
    marketplaceFeePercentage: 12.5,
    marketplaceFeeFixedAmount: 1.11,
  })
  assert.equal(rounded.metadata.percentageAmount, 12.5)
  assert.equal(rounded.amount, 13.61)

  const disabled = calculateMarketplaceFee(250, null)
  assert.equal(disabled.amount, 0)
  assert.equal(disabled.summary.configured, false)

  assert.throws(() => calculateMarketplaceFee(-1, null), /subtotal para calcular marketplace fee es inválido/)
  assert.throws(() => calculateMarketplaceFee(Number.NaN, null), /subtotal para calcular marketplace fee es inválido/)
  process.env.MARKETPLACE_FEE_MODE = ''
  process.env.MARKETPLACE_FEE_PERCENTAGE = ''
  const noOwnerFeeEmpresaId = 'phase5-emp-no-owner-fee'
  await seedEmpresa({ empresaId: noOwnerFeeEmpresaId, slug: 'phase5-no-owner-fee' })

  mockFetch(async () => ({ ok: true, status: 200 }) as Response)
  await upsertPaymentAccountByEmpresaId({
    empresaId: noOwnerFeeEmpresaId,
    accessToken: 'APP_USR-no-owner-fee',
  })

  const missingOwnerFeeReadiness = await getSalesReadiness(noOwnerFeeEmpresaId)
  assert.deepEqual(missingOwnerFeeReadiness, {
    status: 'pending_validation',
    reason: 'missing_marketplace_fee',
    canSell: false,
  })

})

test('marketplace fee resolves by flow with global defaults, company overrides and legacy fallbacks', async () => {
  const empresaId = 'phase5-emp-flow-1'
  await seedEmpresa({ empresaId, slug: 'phase5-flow-1' })

  await pool.query(
    `INSERT INTO platform_marketplace_fee_defaults (id, flow, mode, percentage, fixed_amount)
     VALUES
     ('phase5-default-ent', 'entradas', 'percentage', 10, NULL),
     ('phase5-default-con', 'consumibles', 'fixed', NULL, 20)`
  )

  const beforeOverride = await getMarketplaceFeeSummariesByFlow(empresaId)
  assert.deepEqual(beforeOverride.entradas, {
    flow: 'entradas',
    configured: true,
    source: 'global',
    legacyFallback: null,
    mode: 'percentage',
    percentage: 10,
    fixedAmount: null,
  })
  assert.deepEqual(beforeOverride.consumibles, {
    flow: 'consumibles',
    configured: true,
    source: 'global',
    legacyFallback: null,
    mode: 'fixed',
    percentage: null,
    fixedAmount: 20,
  })

  await pool.query(
    `INSERT INTO empresa_marketplace_fee_overrides (id, empresa_id, flow, mode, percentage, fixed_amount)
     VALUES ('phase5-override-ent', ?, 'entradas', 'hybrid', 5, 12)`,
    [empresaId]
  )

  const entradasFee = await resolveMarketplaceFee(empresaId, 100, 'entradas')
  const consumiblesFee = await resolveMarketplaceFee(empresaId, 100, 'consumibles')
  assert.equal(entradasFee.amount, 17)
  assert.equal(entradasFee.summary.source, 'empresa')
  assert.equal(consumiblesFee.amount, 20)
  assert.equal(consumiblesFee.summary.source, 'global')

  await pool.query(`DELETE FROM platform_marketplace_fee_defaults WHERE flow = 'consumibles'`)
  await pool.query(
    `INSERT INTO empresa_marketplace_fees (id, empresa_id, mode, percentage, fixed_amount)
     VALUES ('phase5-legacy-flow', ?, 'fixed', NULL, 33.33)`,
    [empresaId]
  )

  const legacyConsumibles = await getMarketplaceFeeSummary(empresaId, 'consumibles')
  assert.deepEqual(legacyConsumibles, {
    flow: 'consumibles',
    configured: true,
    source: 'empresa',
    legacyFallback: 'empresa_legacy',
    mode: 'fixed',
    percentage: null,
    fixedAmount: 33.33,
  })
})

test('cobros routes reject manual tenant configuration and configuracion exposes owner-controlled fee summary', async () => {
  const empresaId = 'phase5-emp-route-1'
  const slug = 'phase5-route-1'
  await seedEmpresa({ empresaId, slug })

  const app = express()
  app.use(express.json())
  app.use('/api/cobros', cobrosRouter)
  app.use('/api/configuracion', configuracionRouter)
  const server = await createTestServer(app)

  try {
    const created = await requestJson('POST', `${server.baseUrl}/api/cobros/mercadopago`, {
      accessToken: 'APP_USR-PENDING-1111',
    }, buildEmpresaUser(empresaId))

    assert.equal(created.status, 405)
    assert.equal(
      created.data.error,
      'La configuración manual de Mercado Pago ya no está disponible. Usá Conectar Mercado Pago vía OAuth.'
    )

    const replaced = await requestJson('PATCH', `${server.baseUrl}/api/cobros/mercadopago`, {
      accessToken: 'APP_USR-READY-2222',
      providerAccountLabel: 'Cuenta principal',
    }, buildEmpresaUser(empresaId))

    assert.equal(replaced.status, 405)

    mockFetch(async () => ({ ok: true, status: 200 }) as Response)
    await upsertPaymentAccountByEmpresaId({
      empresaId,
      accessToken: 'APP_USR-READY-2222',
      providerAccountLabel: 'Cuenta principal',
    })

    const [accountRows] = await pool.query<any[]>(
      `SELECT COUNT(*) as total FROM empresa_payment_accounts WHERE empresa_id = ?`,
      [empresaId]
    )
    assert.equal(accountRows[0].total, 1)

    const configuracion = await requestJson('GET', `${server.baseUrl}/api/configuracion`, undefined, buildEmpresaUser(empresaId))
    assert.equal(configuracion.status, 200)
    assert.equal(configuracion.data.data.sales_readiness.status, 'ready_to_sell')
    assert.deepEqual(configuracion.data.data.marketplace_fee, {
      flow: 'entradas',
      configured: true,
      source: 'global',
      legacyFallback: 'env_legacy',
      mode: 'percentage',
      percentage: 12.5,
      fixedAmount: null,
    })
  } finally {
    await server.close()
  }
})

test('cobros oauth start/callback/disconnect manage company connection without exposing secrets', async () => {
  const empresaId = 'phase5-emp-oauth-1'
  const slug = 'phase5-oauth-1'
  await seedEmpresa({ empresaId, slug })

  const app = express()
  app.use(express.json())
  app.use('/api/cobros', cobrosRouter)
  const server = await createTestServer(app)

  try {
    const start = await requestJson('POST', `${server.baseUrl}/api/cobros/mercadopago/oauth/start`, undefined, buildEmpresaUser(empresaId))

    assert.equal(start.status, 200)
    assert.ok(typeof start.data.authUrl === 'string')

    const authUrl = new URL(start.data.authUrl)
    assert.equal(authUrl.origin, 'https://auth.mercadopago.com')
    assert.equal(authUrl.searchParams.get('client_id'), 'mp-client-id')
    assert.equal(authUrl.searchParams.get('response_type'), 'code')
    assert.equal(authUrl.searchParams.get('redirect_uri'), 'http://localhost:3000/api/cobros/mercadopago/oauth/callback')

    const state = authUrl.searchParams.get('state')
    assert.ok(state)

    mockFetch(async (input: Parameters<typeof fetch>[0] | URL) => {
      const url = String(input)
      if (url.includes('/oauth/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'APP_USR-OAUTH-4444',
            refresh_token: 'APP_USR-REFRESH-5555',
            expires_in: 3600,
            scope: 'offline_access read write',
            token_type: 'bearer',
          }),
        } as Response
      }

      if (url.includes('/v1/payment_methods')) {
        return { ok: true, status: 200 } as Response
      }

      throw new Error(`unexpected fetch ${url}`)
    })

    const callbackResponse = await requestRaw(
      'GET',
      `${server.baseUrl}/api/cobros/mercadopago/oauth/callback?code=oauth-code-123&state=${encodeURIComponent(state!)}`,
      buildEmpresaUser(empresaId)
    )

    assert.equal(callbackResponse.status, 302)
    assert.equal(callbackResponse.headers.get('location'), 'http://localhost:3000/dashboard/cobros?mercadopago_oauth=connected')

    const resource = await requestJson('GET', `${server.baseUrl}/api/cobros/mercadopago`, undefined, buildEmpresaUser(empresaId))
    assert.equal(resource.status, 200)
    assert.equal(resource.data.data.payment_account.status, 'ready_to_sell')
    assert.equal(resource.data.data.payment_account.credentialLast4, '••••4444')
    assert.equal('refreshToken' in resource.data.data.payment_account, false)

    const paymentAccount = await getPaymentAccountByEmpresaId(empresaId)
    assert.equal(paymentAccount?.accessToken, 'APP_USR-OAUTH-4444')
    assert.equal(paymentAccount?.refreshToken, 'APP_USR-REFRESH-5555')
    assert.equal(paymentAccount?.oauthScope, 'offline_access read write')
    assert.equal(paymentAccount?.oauthTokenType, 'bearer')
    assert.ok(paymentAccount?.oauthExpiresAt)
    assert.ok(paymentAccount?.oauthConnectedAt)

    const disconnected = await requestJson('DELETE', `${server.baseUrl}/api/cobros/mercadopago`, undefined, buildEmpresaUser(empresaId))
    assert.equal(disconnected.status, 200)
    assert.equal(disconnected.data.data.payment_account, null)
    assert.equal(disconnected.data.data.sales_readiness.status, 'missing_provider')
  } finally {
    await server.close()
  }
})

test('oauth reconnect replaces previous authorization and keeps owner-controlled fee configuration', async () => {
  const empresaId = 'phase5-emp-oauth-reconnect'
  const slug = 'phase5-oauth-reconnect'
  await seedEmpresa({ empresaId, slug })

  const app = express()
  app.use(express.json())
  app.use('/api/cobros', cobrosRouter)
  app.use('/api/configuracion', configuracionRouter)
  const server = await createTestServer(app)

  try {
    const start = await requestJson('POST', `${server.baseUrl}/api/cobros/mercadopago/oauth/start`, undefined, buildEmpresaUser(empresaId))
    const firstState = new URL(start.data.authUrl).searchParams.get('state')
    assert.ok(firstState)

    let oauthExchangeCount = 0
    mockFetch(async (input: Parameters<typeof fetch>[0] | URL) => {
      const url = String(input)
      if (url.includes('/oauth/token')) {
        oauthExchangeCount += 1
        return {
          ok: true,
          status: 200,
          json: async () => oauthExchangeCount === 1
            ? {
              access_token: 'APP_USR-FIRST-1111',
              refresh_token: 'APP_USR-REFRESH-1111',
              expires_in: 3600,
              scope: 'read write',
              token_type: 'bearer',
            }
            : {
              access_token: 'APP_USR-SECOND-2222',
              refresh_token: 'APP_USR-REFRESH-2222',
              expires_in: 7200,
              scope: 'read write offline_access',
              token_type: 'bearer',
            },
        } as Response
      }

      if (url.includes('/v1/payment_methods')) {
        return { ok: true, status: 200 } as Response
      }

      throw new Error(`unexpected fetch ${url}`)
    })

    const firstCallback = await requestRaw(
      'GET',
      `${server.baseUrl}/api/cobros/mercadopago/oauth/callback?code=oauth-code-1&state=${encodeURIComponent(firstState!)}`,
      buildEmpresaUser(empresaId)
    )
    assert.equal(firstCallback.status, 302)

    const firstAccount = await getPaymentAccountByEmpresaId(empresaId)
    assert.equal(firstAccount?.accessToken, 'APP_USR-FIRST-1111')
    assert.equal(firstAccount?.refreshToken, 'APP_USR-REFRESH-1111')

    const reconnectStart = await requestJson('POST', `${server.baseUrl}/api/cobros/mercadopago/oauth/start`, undefined, buildEmpresaUser(empresaId))
    const secondState = new URL(reconnectStart.data.authUrl).searchParams.get('state')
    assert.ok(secondState)

    const secondCallback = await requestRaw(
      'GET',
      `${server.baseUrl}/api/cobros/mercadopago/oauth/callback?code=oauth-code-2&state=${encodeURIComponent(secondState!)}`,
      buildEmpresaUser(empresaId)
    )
    assert.equal(secondCallback.status, 302)

    const secondAccount = await getPaymentAccountByEmpresaId(empresaId)
    assert.equal(secondAccount?.accessToken, 'APP_USR-SECOND-2222')
    assert.equal(secondAccount?.refreshToken, 'APP_USR-REFRESH-2222')
    assert.equal(secondAccount?.oauthScope, 'read write offline_access')

    const configuracion = await requestJson('GET', `${server.baseUrl}/api/configuracion`, undefined, buildEmpresaUser(empresaId))
    assert.equal(configuracion.status, 200)
    assert.deepEqual(configuracion.data.data.marketplace_fee, {
      flow: 'entradas',
      configured: true,
      source: 'global',
      legacyFallback: 'env_legacy',
      mode: 'percentage',
      percentage: 12.5,
      fixedAmount: null,
    })

    const disconnected = await requestJson('DELETE', `${server.baseUrl}/api/cobros/mercadopago`, undefined, buildEmpresaUser(empresaId))
    assert.equal(disconnected.status, 200)
    assert.deepEqual(disconnected.data.data.marketplace_fee, {
      flow: 'entradas',
      configured: true,
      source: 'global',
      legacyFallback: 'env_legacy',
      mode: 'percentage',
      percentage: 12.5,
      fixedAmount: null,
    })
  } finally {
    await server.close()
  }
})

test('oauth callback failure and pending validation produce stable non-sellable outcomes', async () => {
  const empresaId = 'phase5-emp-oauth-fail'
  const slug = 'phase5-oauth-fail'
  await seedEmpresa({ empresaId, slug })

  const app = express()
  app.use(express.json())
  app.use('/api/cobros', cobrosRouter)
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const start = await requestJson('POST', `${server.baseUrl}/api/cobros/mercadopago/oauth/start`, undefined, buildEmpresaUser(empresaId))
    const state = new URL(start.data.authUrl).searchParams.get('state')
    assert.ok(state)

    const providerRejected = await requestRaw(
      'GET',
      `${server.baseUrl}/api/cobros/mercadopago/oauth/callback?error=access_denied&state=${encodeURIComponent(state!)}`,
      buildEmpresaUser(empresaId)
    )
    assert.equal(providerRejected.status, 302)
    assert.equal(providerRejected.headers.get('location'), 'http://localhost:3000/dashboard/cobros?mercadopago_oauth=error&reason=access_denied')

    const afterProviderRejected = await requestJson('GET', `${server.baseUrl}/api/cobros/mercadopago`, undefined, buildEmpresaUser(empresaId))
    assert.equal(afterProviderRejected.status, 200)
    assert.equal(afterProviderRejected.data.data.payment_account, null)
    assert.equal(afterProviderRejected.data.data.sales_readiness.status, 'missing_provider')
    assert.equal(afterProviderRejected.data.data.sales_readiness.reason, 'missing_provider')

    mockFetch(async (input: Parameters<typeof fetch>[0] | URL) => {
      const url = String(input)
      if (url.includes('/oauth/token')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'APP_USR-PENDING-3333',
            refresh_token: 'APP_USR-REFRESH-3333',
            expires_in: 3600,
            scope: 'read',
            token_type: 'bearer',
          }),
        } as Response
      }

      if (url.includes('/v1/payment_methods')) {
        return { ok: false, status: 500 } as Response
      }

      throw new Error(`unexpected fetch ${url}`)
    })

    const pendingCallback = await requestRaw(
      'GET',
      `${server.baseUrl}/api/cobros/mercadopago/oauth/callback?code=oauth-code-pending&state=${encodeURIComponent(state!)}`,
      buildEmpresaUser(empresaId)
    )
    assert.equal(pendingCallback.status, 302)
    assert.equal(pendingCallback.headers.get('location'), 'http://localhost:3000/dashboard/cobros?mercadopago_oauth=connected')

    const cobros = await requestJson('GET', `${server.baseUrl}/api/cobros/mercadopago`, undefined, buildEmpresaUser(empresaId))
    assert.equal(cobros.status, 200)
    assert.equal(cobros.data.data.sales_readiness.status, 'pending_validation')
    assert.equal(cobros.data.data.sales_readiness.reason, 'provider_unreachable')
  } finally {
    await server.close()
  }
})

test('dashboard cobros exposes actionable missing_provider readiness when company is not connected', async () => {
  const empresaId = 'phase5-emp-dashboard-missing'
  const slug = 'phase5-dashboard-missing'
  await seedEmpresa({ empresaId, slug })

  const app = express()
  app.use(express.json())
  app.use('/api/cobros', cobrosRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson('GET', `${server.baseUrl}/api/cobros/mercadopago`, undefined, buildEmpresaUser(empresaId))
    assert.equal(response.status, 200)
    assert.equal(response.data.data.payment_account, null)
    assert.deepEqual(response.data.data.marketplace_fee_by_flow, {
      entradas: {
        flow: 'entradas',
        configured: true,
        source: 'global',
        legacyFallback: 'env_legacy',
        mode: 'percentage',
        percentage: 12.5,
        fixedAmount: null,
      },
      consumibles: {
        flow: 'consumibles',
        configured: true,
        source: 'global',
        legacyFallback: 'env_legacy',
        mode: 'percentage',
        percentage: 12.5,
        fixedAmount: null,
      },
    })
    assert.deepEqual(response.data.data.marketplace_fee, response.data.data.marketplace_fee_by_flow.entradas)
    assert.equal(response.data.data.sales_readiness.status, 'missing_provider')
    assert.equal(response.data.data.sales_readiness.reason, 'missing_provider')
  } finally {
    await server.close()
  }
})

test('empresa read contracts expose plural fee maps while singular stays pinned to entradas', async () => {
  const adminId = 'phase5-admin-empresa-flow-1'
  const adminEmail = 'phase5-admin-empresa-flow-1@example.com'
  const empresaId = 'phase5-emp-empresa-flow-1'
  const slug = 'phase5-empresa-flow-1'

  await seedPlatformAdmin({ adminId, email: adminEmail })
  await seedEmpresa({ empresaId, slug })

  const app = express()
  app.use(express.json())
  app.use('/api/platform', platformRouter)
  app.use('/api/configuracion', configuracionRouter)
  app.use('/api/cobros', cobrosRouter)
  const server = await createTestServer(app)

  try {
    const beforeConfig = await requestJson('GET', `${server.baseUrl}/api/configuracion`, undefined, buildEmpresaUser(empresaId))
    assert.equal(beforeConfig.status, 200)
    assert.equal(beforeConfig.data.data.marketplace_fee_by_flow.entradas.legacyFallback, 'env_legacy')
    assert.equal(beforeConfig.data.data.marketplace_fee_by_flow.consumibles.legacyFallback, 'env_legacy')
    assert.deepEqual(beforeConfig.data.data.marketplace_fee, beforeConfig.data.data.marketplace_fee_by_flow.entradas)

    const update = await requestJson('PATCH', `${server.baseUrl}/api/platform/empresas/${empresaId}/fees`, {
      flow: 'entradas',
      mode: 'fixed',
      fixedAmount: 33.33,
      percentage: null,
    }, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(update.status, 200)

    const afterConfig = await requestJson('GET', `${server.baseUrl}/api/configuracion`, undefined, buildEmpresaUser(empresaId))
    assert.equal(afterConfig.status, 200)
    assert.deepEqual(afterConfig.data.data.marketplace_fee, {
      flow: 'entradas',
      configured: true,
      source: 'empresa',
      legacyFallback: null,
      mode: 'fixed',
      percentage: null,
      fixedAmount: 33.33,
    })
    assert.deepEqual(afterConfig.data.data.marketplace_fee_by_flow, {
      entradas: {
        flow: 'entradas',
        configured: true,
        source: 'empresa',
        legacyFallback: null,
        mode: 'fixed',
        percentage: null,
        fixedAmount: 33.33,
      },
      consumibles: {
        flow: 'consumibles',
        configured: true,
        source: 'global',
        legacyFallback: 'env_legacy',
        mode: 'percentage',
        percentage: 12.5,
        fixedAmount: null,
      },
    })

    const cobros = await requestJson('GET', `${server.baseUrl}/api/cobros/mercadopago`, undefined, buildEmpresaUser(empresaId))
    assert.equal(cobros.status, 200)
    assert.deepEqual(cobros.data.data.marketplace_fee, afterConfig.data.data.marketplace_fee)
    assert.deepEqual(cobros.data.data.marketplace_fee_by_flow, afterConfig.data.data.marketplace_fee_by_flow)
  } finally {
    await server.close()
  }
})

test('tenant public payload stays visible while readiness remains non-sellable', async () => {
  const empresaId = 'phase5-emp-tenant-public'
  const slug = 'phase5-tenant-public'
  await seedEmpresa({ empresaId, slug })

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const publicResponse = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}`)
    assert.equal(publicResponse.status, 200)
    assert.equal(publicResponse.data.data.empresa.slug, slug)
    assert.deepEqual(publicResponse.data.data.empresa.sales_readiness, {
      status: 'missing_provider',
      reason: 'missing_provider',
      can_sell: false,
    })
  } finally {
    await server.close()
  }
})

test('tenant public deactivation hides tenant access while keeping dashboard status editable', async () => {
  const empresaId = 'phase5-emp-tenant-hidden'
  const slug = 'phase5-tenant-hidden'
  const adminId = 'phase5-admin-tenant-hidden'
  const adminEmail = 'phase5-admin-tenant-hidden@example.com'

  await seedEmpresa({ empresaId, slug })
  await seedPlatformAdmin({ adminId, email: adminEmail, roleSlug: 'superadmin', singletonKey: 'superadmin' })

  const app = express()
  app.use(express.json())
  app.use('/api/configuracion', configuracionRouter)
  app.use('/api/platform', platformRouter)
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const deactivate = await requestJson('PATCH', `${server.baseUrl}/api/configuracion/public-status`, {
      publicDisabled: true,
    }, buildEmpresaUser(empresaId))

    assert.equal(deactivate.status, 200)
    assert.equal((deactivate.data as any).data.tenantPublicDisabled, true)

    const companyConfig = await requestJson('GET', `${server.baseUrl}/api/configuracion`, undefined, buildEmpresaUser(empresaId))
    assert.equal(companyConfig.status, 200)
    assert.equal((companyConfig.data as any).data.tenant_public_disabled, true)

    const publicTenant = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}`)
    assert.equal(publicTenant.status, 404)

    const companies = await requestJson('GET', `${server.baseUrl}/api/platform/empresas`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(companies.status, 200)
    const company = (companies.data as any).data.empresas.find((item: any) => item.id === empresaId)
    assert.equal(company.tenantPublicDisabled, true)

    const reactivate = await requestJson('PATCH', `${server.baseUrl}/api/platform/empresas/${empresaId}/public-status`, {
      publicDisabled: false,
    }, buildSuperAdminUser(adminId, adminEmail))

    assert.equal(reactivate.status, 200)
    assert.equal((reactivate.data as any).data.tenantPublicDisabled, false)

    const publicTenantAgain = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}`)
    assert.equal(publicTenantAgain.status, 200)
  } finally {
    await server.close()
  }
})

test('tenant checkout returns 409 sales_not_ready before creating side effects', async () => {
  const empresaId = 'phase5-emp-tenant-blocked'
  const slug = 'phase5-tenant-blocked'
  const compradorId = 'phase5-cmp-blocked'
  const categoriaId = 'phase5-cat-blocked'
  const eventoId = 'phase5-evt-blocked'
  const compradorEmail = 'phase5-blocked@example.com'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, email: compradorEmail })
  await seedEventoConCategoria({ eventoId, empresaId, categoriaId, precio: 100, stock: 5 })

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/checkout`, {
      items: [{ categoriaId, eventoId, cantidad: 1 }],
    }, buildCompradorUser(compradorId, empresaId, slug, compradorEmail))

    assert.equal(response.status, 409)
    assert.deepEqual(response.data, {
      code: 'sales_not_ready',
      status: 'missing_provider',
      reason: 'missing_provider',
      error: 'La empresa no está lista para vender',
    })

    const [rows] = await pool.query<any[]>(
      `SELECT COUNT(*) as total FROM checkout_sessions WHERE empresa_id = ?`,
      [empresaId]
    )
    assert.equal(rows[0].total, 0)
  } finally {
    await server.close()
  }
})

test('tenant checkout sends the configured marketplace_fee and stores the same snapshot', async () => {
  const empresaId = 'phase5-emp-tenant-ready'
  const slug = 'phase5-tenant-ready'
  const compradorId = 'phase5-cmp-ready'
  const categoriaId = 'phase5-cat-ready'
  const eventoId = 'phase5-evt-ready'
  const compradorEmail = 'phase5-ready@example.com'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, email: compradorEmail })
  await seedEventoConCategoria({ eventoId, empresaId, categoriaId, precio: 123.45, stock: 10 })

  mockFetch(async () => ({ ok: true, status: 200 }) as Response)
  await upsertPaymentAccountByEmpresaId({
    empresaId,
    accessToken: 'APP_USR-READY-CHECKOUT-3333',
  })

  let capturedPreferenceBody: any = null
  Preference.prototype.create = async function ({ body }: { body: unknown }) {
    capturedPreferenceBody = body
    return { init_point: 'https://mp.test/preference/123' } as any
  }

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/checkout`, {
      items: [{ categoriaId, eventoId, cantidad: 2 }],
    }, buildCompradorUser(compradorId, empresaId, slug, compradorEmail))

    assert.equal(response.status, 200)
    assert.equal(response.data.init_point, 'https://mp.test/preference/123')
    assert.ok(capturedPreferenceBody)
    assert.equal(capturedPreferenceBody.marketplace_fee, 30.86)
    assert.equal(capturedPreferenceBody.metadata.marketplace_fee.amount, 30.86)
    assert.equal(capturedPreferenceBody.metadata.marketplace_fee.percentage, 12.5)

    const [sessionRows] = await pool.query<any[]>(
      `SELECT datos FROM checkout_sessions WHERE empresa_id = ? ORDER BY created_at DESC LIMIT 1`,
      [empresaId]
    )

    assert.equal(sessionRows.length, 1)
    const sessionData = JSON.parse(sessionRows[0].datos)
    assert.equal(sessionData.marketplaceFee.amount, 30.86)
    assert.equal(sessionData.marketplaceFee.metadata.percentageAmount, 30.86)
  } finally {
    await server.close()
  }
})

test('tenant consumables payment confirmation persists owner fee snapshot fields from checkout session', async () => {
  const adminId = 'phase5-admin-consumibles-1'
  const adminEmail = 'phase5-admin-consumibles-1@example.com'
  const empresaId = 'phase5-emp-consumibles-1'
  const slug = 'phase5-consumibles-1'
  const eventoId = 'phase5-evt-consumibles-1'
  const barraId = 'phase5-bar-consumibles-1'
  const consumibleId = 'phase5-con-consumibles-1'
  const compradorId = 'phase5-cmp-consumibles-1'
  const compradorEmail = 'phase5-consumibles-buyer@example.com'
  const sessionId = 'phase5-checkout-consumibles-1'

  await seedPlatformAdmin({ adminId, email: adminEmail })
  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, email: compradorEmail })
  await seedEventoConConsumiblePublico({
    eventoId,
    empresaId,
    barraId,
    consumibleId,
    precio: 100,
    stock: 10,
  })

  mockFetch(async () => ({ ok: true, status: 200 }) as Response)
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-CONSUMIBLES-1111' })

  await pool.query(
    `INSERT INTO checkout_sessions (id, comprador_id, empresa_id, datos, estado, expires_at, created_at)
     VALUES (?, ?, ?, ?, 'reservada', NOW() + INTERVAL '10 minutes', NOW())`,
    [
      sessionId,
      compradorId,
      empresaId,
      JSON.stringify({
        flow: 'consumibles',
        items: [
          {
            barraId,
            barraNombre: `Barra ${barraId}`,
            consumibleId,
            nombre: `Consumible ${consumibleId}`,
            precio: 100,
            cantidad: 2,
            eventoId,
            eventoNombre: `Evento ${eventoId}`,
          },
        ],
        marketplaceFee: {
          amount: 18.33,
          currency: 'ARS',
          metadata: {
            mode: 'hybrid',
            percentage: 7.5,
            percentageAmount: 15,
            fixedAmount: 3.33,
            fixedAmountApplied: 3.33,
            source: 'global',
          },
        },
        confirmationToken: 'phase5-consumibles-confirmation-token',
      }),
    ]
  )

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const [sessionRows] = await pool.query<any[]>(
      `SELECT datos FROM checkout_sessions WHERE id = ?`,
      [sessionId]
    )

    assert.equal(sessionRows.length, 1)
    const sessionData = JSON.parse(String(sessionRows[0].datos))
    assert.equal(sessionData.flow, 'consumibles')
    assert.equal(sessionData.marketplaceFee.amount, 18.33)
    assert.equal(sessionData.marketplaceFee.metadata.mode, 'hybrid')
    assert.equal(sessionData.marketplaceFee.metadata.percentage, 7.5)
    assert.equal(sessionData.marketplaceFee.metadata.fixedAmount, 3.33)

    Payment.prototype.get = async function () {
      return {
        status: 'approved',
        external_reference: sessionId,
        transaction_amount: 200,
      } as any
    }

    const confirm = await requestJson<{ ok: boolean; ventas?: number; flow?: string }>('POST', `${server.baseUrl}/api/tenant/${slug}/pago/confirmar`, {
      sessionId,
      paymentId: 'phase5-payment-consumibles-1',
    }, buildCompradorUser(compradorId, empresaId, slug, compradorEmail))

    assert.equal(confirm.status, 200)
    assert.equal(confirm.data.ok, true)
    assert.equal(confirm.data.flow, 'consumibles')
    assert.equal(confirm.data.ventas, 1)

    const [saleRows] = await pool.query<any[]>(
      `SELECT checkout_session_id, total, owner_fee_amount, owner_fee_currency, owner_fee_mode, owner_fee_percentage, owner_fee_fixed_amount
       FROM consumibles_ventas WHERE checkout_session_id = ?`,
      [sessionId]
    )

    assert.equal(saleRows.length, 1)
    assert.equal(saleRows[0].checkout_session_id, sessionId)
    assert.equal(Number(saleRows[0].total), 200)
    assert.equal(Number(saleRows[0].owner_fee_amount), 18.33)
    assert.equal(saleRows[0].owner_fee_currency, 'ARS')
    assert.equal(saleRows[0].owner_fee_mode, 'hybrid')
    assert.equal(Number(saleRows[0].owner_fee_percentage), 7.5)
    assert.equal(Number(saleRows[0].owner_fee_fixed_amount), 3.33)
  } finally {
    await server.close()
  }
})

test('platform routes protect owner-only access and expose dashboard, companies, fee update and owner payment account via OAuth', async () => {
  const adminId = 'phase5-admin-1'
  const adminEmail = 'phase5-admin-1@example.com'
  const empresaId = 'phase5-emp-platform-1'
  const slug = 'phase5-platform-1'
  const eventoId = 'phase5-evt-platform-1'
  const categoriaId = 'phase5-cat-platform-1'
  const compradorId = 'phase5-cmp-platform-1'
  const empresaEmail = 'phase5-platform-buyer@example.com'

  await seedPlatformAdmin({ adminId, email: adminEmail })
  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, email: empresaEmail })
  await seedEventoConCategoria({ eventoId, empresaId, categoriaId, precio: 200, stock: 10 })

  mockFetch(async (url, init) => {
    if (typeof url === 'string' && url.includes('/oauth/token')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'APP_USR-OWNER-OAUTH-9999',
          refresh_token: 'REFRESH-OWNER-OAUTH',
          expires_in: 3600,
          scope: 'offline_access read write',
          token_type: 'bearer',
        }),
      } as Response
    }

    if (init?.headers && typeof init.headers === 'object' && 'Authorization' in init.headers) {
      return { ok: true, status: 200 } as Response
    }

    return { ok: false, status: 500 } as Response
  })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-PLATFORM-4444' })

   await pool.query(
     `INSERT INTO entradas (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado, precio_pagado, comision)
      VALUES (?, ?, ?, ?, ?, ?, 'valida', ?, ?)`,
     ['phase5-ent-platform-1', eventoId, categoriaId, compradorId, 'phase5-qr-platform-1', 'PLAT1111', 200, 25]
   )
    await pool.query(
      `INSERT INTO consumibles_ventas (id, barra_id, evento_id, empresa_id, comprador_id, checkout_session_id, origen, qr_code, clave_corta, total, estado, owner_fee_amount, owner_fee_currency, owner_fee_mode, owner_fee_percentage, owner_fee_fixed_amount)
       VALUES ('phase5-sale-platform-1', 'phase5-bar-platform-1', ?, ?, ?, 'phase5-checkout-platform-1', 'tenant_publico', 'phase5-qr-platform-2', 'PLAT2222', 80, 'pendiente', 8, 'ARS', 'percentage', 10, NULL)`,
      [eventoId, empresaId, compradorId]
    )

  const app = express()
  app.use(express.json())
  app.use('/api/platform', platformRouter)
  const server = await createTestServer(app)

  try {
    const forbidden = await requestJson('GET', `${server.baseUrl}/api/platform/dashboard`, undefined, buildEmpresaUser(empresaId))
    assert.equal(forbidden.status, 403)

    const forbiddenFeeUpdate = await requestJson('PATCH', `${server.baseUrl}/api/platform/empresas/${empresaId}/comision`, {
      marketplaceFeeMode: 'percentage',
      marketplaceFeePercentage: 8,
    }, buildEmpresaUser(empresaId))
    assert.equal(forbiddenFeeUpdate.status, 403)

    const dashboard = await requestJson('GET', `${server.baseUrl}/api/platform/dashboard`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(dashboard.status, 200)
    assert.equal(dashboard.data.data.metricas.empresasActivas >= 1, true)
    assert.equal(dashboard.data.data.metricas.gananciasOwner >= 33, true)
    assert.ok(Array.isArray(dashboard.data.data.ganancias_por_dia))
    assert.ok(Array.isArray(dashboard.data.data.empresas_resumen))
    assert.equal(dashboard.data.data.healthSnapshot.ownerPaymentAccount, null)
    assert.equal(dashboard.data.data.healthSnapshot.ownerStatus.status, 'missing_provider')
    assert.equal(dashboard.data.data.healthSnapshot.ownerStatus.reason, 'missing_provider')
    assert.deepEqual(Object.keys(dashboard.data.data.healthSnapshot.readinessBuckets).sort(), ['deactivated', 'missing_collection_setup', 'ready_to_sell'])
    assert.equal(typeof dashboard.data.data.healthSnapshot.issueCounters.total, 'number')
    assert.equal(typeof dashboard.data.data.healthSnapshot.issueCounters.missingCollectionSetup, 'number')
    assert.equal(typeof dashboard.data.data.healthSnapshot.issueCounters.deactivated, 'number')
    assert.equal(typeof dashboard.data.data.healthSnapshot.issueCounters.missingMarketplaceFee, 'number')
    assert.equal(typeof dashboard.data.data.healthSnapshot.issueCounters.withOverrides, 'number')
    assert.ok(Array.isArray(dashboard.data.data.healthSnapshot.issueCompanies.missingCollectionSetup))
    assert.ok(Array.isArray(dashboard.data.data.healthSnapshot.issueCompanies.deactivated))
    assert.ok(Array.isArray(dashboard.data.data.healthSnapshot.issueCompanies.missingMarketplaceFee))
    assert.ok(Array.isArray(dashboard.data.data.healthSnapshot.issueCompanies.withOverrides))
    assert.deepEqual(dashboard.data.data.health_snapshot, dashboard.data.data.healthSnapshot)

    const companies = await requestJson('GET', `${server.baseUrl}/api/platform/empresas`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(companies.status, 200)
    const companyRow = companies.data.data.empresas.find((empresa: any) => empresa.id === empresaId)
    assert.ok(companyRow)
    assert.equal(companyRow.gananciasOwner, 33)

    const gains = await requestJson('GET', `${server.baseUrl}/api/platform/empresas/${empresaId}/ganancias`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(gains.status, 200)
    assert.equal(gains.data.data.empresaId, empresaId)
    assert.equal(gains.data.data.gananciasOwner, 33)

    const feeUpdate = await requestJson('PATCH', `${server.baseUrl}/api/platform/empresas/${empresaId}/comision`, {
      marketplaceFeeMode: 'fixed',
      marketplaceFeeFixedAmount: 55.5,
      marketplaceFeePercentage: null,
    }, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(feeUpdate.status, 200)
    assert.deepEqual(feeUpdate.data.data.marketplace_fee, {
      flow: 'entradas',
      configured: true,
      source: 'empresa',
      legacyFallback: null,
      mode: 'fixed',
      percentage: null,
      fixedAmount: 55.5,
    })

    const ownerPaymentBefore = await requestJson('GET', `${server.baseUrl}/api/platform/cobros/mercadopago`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(ownerPaymentBefore.status, 200)
    assert.deepEqual(ownerPaymentBefore.data.data, {
      ownerPaymentAccount: null,
      owner_payment_account: null,
      currentUserPaymentAccount: null,
      current_user_payment_account: null,
      paymentAccounts: [],
      payment_accounts: [],
    })

    const ownerManualUpdate = await requestJson('PATCH', `${server.baseUrl}/api/platform/cobros/mercadopago`, {
      accessToken: 'APP_USR-OWNER-9999',
    }, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(ownerManualUpdate.status, 405)
    assert.equal(
      ownerManualUpdate.data.error,
      'La configuración manual de Mercado Pago owner ya no está disponible. Usá Conectar Mercado Pago vía OAuth.'
    )

    const oauthStart = await requestJson<{ authUrl: string }>('POST', `${server.baseUrl}/api/platform/cobros/mercadopago/oauth/start`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(oauthStart.status, 200)
    const authUrl = new URL(oauthStart.data.authUrl)
    assert.equal(authUrl.origin, 'https://auth.mercadopago.com')
    assert.equal(authUrl.searchParams.get('redirect_uri'), 'http://localhost:3000/api/platform/cobros/mercadopago/oauth/callback')

    const state = authUrl.searchParams.get('state')
    assert.ok(state)

    const ownerOauthCallback = await requestRaw(
      'GET',
      `${server.baseUrl}/api/platform/cobros/mercadopago/oauth/callback?code=oauth-owner-code-1&state=${encodeURIComponent(state!)}`,
      buildSuperAdminUser(adminId, adminEmail)
    )
    assert.equal(ownerOauthCallback.status, 302)
    assert.equal(ownerOauthCallback.headers.get('location'), 'http://localhost:3000/super-admin/configuracion?mercadopago_oauth=connected')

    const ownerPaymentAfter = await requestJson('GET', `${server.baseUrl}/api/platform/cobros/mercadopago`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(ownerPaymentAfter.status, 200)
    assert.equal(ownerPaymentAfter.data.data.ownerPaymentAccount?.credentialLast4, '••••9999')
    assert.equal(ownerPaymentAfter.data.data.ownerPaymentAccount?.providerAccountLabel, 'Mercado Pago owner')
    assert.equal(ownerPaymentAfter.data.data.ownerPaymentAccount?.connectionMode, 'oauth')
    assert.equal(ownerPaymentAfter.data.data.ownerPaymentAccount?.oauthConnectedAt !== null, true)
    assert.equal(ownerPaymentAfter.data.data.currentUserPaymentAccount?.credentialLast4, '••••9999')
    assert.equal(ownerPaymentAfter.data.data.currentUserPaymentAccount?.providerAccountLabel, 'Mercado Pago platform')

    const dashboardAfterOwnerPayment = await requestJson('GET', `${server.baseUrl}/api/platform/dashboard`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(dashboardAfterOwnerPayment.status, 200)
    assert.equal(dashboardAfterOwnerPayment.data.data.healthSnapshot.ownerPaymentAccount?.credentialLast4, '••••9999')
    assert.equal(dashboardAfterOwnerPayment.data.data.healthSnapshot.ownerPaymentAccount?.providerAccountLabel, 'Mercado Pago owner')
    assert.equal(dashboardAfterOwnerPayment.data.data.healthSnapshot.ownerStatus.status, ownerPaymentAfter.data.data.ownerPaymentAccount?.status)
    assert.equal(dashboardAfterOwnerPayment.data.data.healthSnapshot.ownerStatus.reason, ownerPaymentAfter.data.data.ownerPaymentAccount?.reason)
    assert.deepEqual(dashboardAfterOwnerPayment.data.data.health_snapshot, dashboardAfterOwnerPayment.data.data.healthSnapshot)

    const ownerOauthFailure = await requestRaw(
      'GET',
      `${server.baseUrl}/api/platform/cobros/mercadopago/oauth/callback?error=access_denied&state=${encodeURIComponent(state!)}`,
      buildSuperAdminUser(adminId, adminEmail)
    )
    assert.equal(ownerOauthFailure.status, 302)
    assert.equal(ownerOauthFailure.headers.get('location'), 'http://localhost:3000/super-admin/configuracion?mercadopago_oauth=error&reason=access_denied')

    const ownerPaymentDelete = await requestJson('DELETE', `${server.baseUrl}/api/platform/cobros/mercadopago`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(ownerPaymentDelete.status, 200)
    assert.equal(ownerPaymentDelete.data.data, null)

    const tenantAccount = await getPaymentAccountByEmpresaId(empresaId)
    assert.equal(tenantAccount?.accessToken, 'APP_USR-PLATFORM-4444')
  } finally {
    await server.close()
  }
})

test('platform owner oauth lifecycle is super_admin only across start callback reconnect and disconnect', async () => {
  const adminId = 'phase5-admin-platform-oauth-authz'
  const adminEmail = 'phase5-admin-platform-oauth-authz@example.com'
  const empresaId = 'phase5-emp-platform-oauth-authz'
  const slug = 'phase5-platform-oauth-authz'
  const empleadoId = 'phase5-usr-platform-oauth-authz'
  const empleadoEmail = 'phase5-usr-platform-oauth-authz@example.com'

  await seedPlatformAdmin({ adminId, email: adminEmail })
  await seedEmpresa({ empresaId, slug })
  await seedEmpleado({ userId: empleadoId, empresaId, email: empleadoEmail })

  mockFetch(async (_input: Parameters<typeof fetch>[0] | URL, init?: Parameters<typeof fetch>[1]) => {
    const url = String(_input)

    if (url.includes('/oauth/token')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { code?: string }
      const code = body.code ?? ''

      return {
        ok: true,
        status: 200,
        json: async () => code === 'owner-code-2'
          ? {
            access_token: 'APP_USR-OWNER-AUTHZ-8888',
            refresh_token: 'REFRESH-OWNER-AUTHZ-8888',
            expires_in: 7200,
            scope: 'offline_access read write',
            token_type: 'bearer',
          }
          : {
            access_token: 'APP_USR-OWNER-AUTHZ-9999',
            refresh_token: 'REFRESH-OWNER-AUTHZ-9999',
            expires_in: 3600,
            scope: 'offline_access read write',
            token_type: 'bearer',
          },
      } as Response
    }

    if (url.includes('/v1/payment_methods')) {
      return { ok: true, status: 200 } as Response
    }

    throw new Error(`unexpected fetch ${url}`)
  })

  const app = express()
  app.use(express.json())
  app.use('/api/platform', platformRouter)
  const server = await createTestServer(app)

  try {
    const unauthenticatedStart = await requestJson('POST', `${server.baseUrl}/api/platform/cobros/mercadopago/oauth/start`, undefined, null)
    assert.equal(unauthenticatedStart.status, 401)

    const empresaStart = await requestJson('POST', `${server.baseUrl}/api/platform/cobros/mercadopago/oauth/start`, undefined, buildEmpresaUser(empresaId))
    assert.equal(empresaStart.status, 403)

    const empleadoStart = await requestJson('POST', `${server.baseUrl}/api/platform/cobros/mercadopago/oauth/start`, undefined, buildEmpleadoUser(empleadoId, empresaId, empleadoEmail))
    assert.equal(empleadoStart.status, 403)

    const ownerStart = await requestJson<{ authUrl: string }>('POST', `${server.baseUrl}/api/platform/cobros/mercadopago/oauth/start`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(ownerStart.status, 200)
    const firstState = new URL(ownerStart.data.authUrl).searchParams.get('state')
    assert.ok(firstState)

    const empresaCallback = await requestRaw(
      'GET',
      `${server.baseUrl}/api/platform/cobros/mercadopago/oauth/callback?code=owner-code-1&state=${encodeURIComponent(firstState!)}`,
      buildEmpresaUser(empresaId)
    )
    assert.equal(empresaCallback.status, 403)

    const empleadoCallback = await requestRaw(
      'GET',
      `${server.baseUrl}/api/platform/cobros/mercadopago/oauth/callback?code=owner-code-1&state=${encodeURIComponent(firstState!)}`,
      buildEmpleadoUser(empleadoId, empresaId, empleadoEmail)
    )
    assert.equal(empleadoCallback.status, 403)

    const firstOwnerCallback = await requestRaw(
      'GET',
      `${server.baseUrl}/api/platform/cobros/mercadopago/oauth/callback?code=owner-code-1&state=${encodeURIComponent(firstState!)}`,
      buildSuperAdminUser(adminId, adminEmail)
    )
    assert.equal(firstOwnerCallback.status, 302)
    assert.equal(firstOwnerCallback.headers.get('location'), 'http://localhost:3000/super-admin/configuracion?mercadopago_oauth=connected')

    const firstOwnerAccount = await requestJson('GET', `${server.baseUrl}/api/platform/cobros/mercadopago`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(firstOwnerAccount.status, 200)
    assert.equal(firstOwnerAccount.data.data.ownerPaymentAccount?.credentialLast4, '••••9999')
    assert.equal(firstOwnerAccount.data.data.currentUserPaymentAccount?.credentialLast4, '••••9999')
    assert.equal(firstOwnerAccount.data.data.currentUserPaymentAccount?.providerAccountLabel, 'Mercado Pago platform')
    assertOwnerSecretsHidden(firstOwnerAccount.data, ['APP_USR-OWNER-AUTHZ-9999', 'REFRESH-OWNER-AUTHZ-9999'])

    const reconnectStart = await requestJson<{ authUrl: string }>('POST', `${server.baseUrl}/api/platform/cobros/mercadopago/oauth/start`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(reconnectStart.status, 200)
    const secondState = new URL(reconnectStart.data.authUrl).searchParams.get('state')
    assert.ok(secondState)

    const reconnectCallback = await requestRaw(
      'GET',
      `${server.baseUrl}/api/platform/cobros/mercadopago/oauth/callback?code=owner-code-2&state=${encodeURIComponent(secondState!)}`,
      buildSuperAdminUser(adminId, adminEmail)
    )
    assert.equal(reconnectCallback.status, 302)
    assert.equal(reconnectCallback.headers.get('location'), 'http://localhost:3000/super-admin/configuracion?mercadopago_oauth=connected')

    const ownerAfterReconnect = await requestJson('GET', `${server.baseUrl}/api/platform/cobros/mercadopago`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(ownerAfterReconnect.status, 200)
    assert.equal(ownerAfterReconnect.data.data.ownerPaymentAccount?.credentialLast4, '••••8888')
    assert.equal(ownerAfterReconnect.data.data.ownerPaymentAccount?.connectionMode, 'oauth')
    assert.equal(ownerAfterReconnect.data.data.currentUserPaymentAccount?.credentialLast4, '••••8888')
    assert.equal(ownerAfterReconnect.data.data.currentUserPaymentAccount?.providerAccountLabel, 'Mercado Pago platform')
    assertOwnerSecretsHidden(ownerAfterReconnect.data, ['APP_USR-OWNER-AUTHZ-8888', 'REFRESH-OWNER-AUTHZ-8888'])

    const empresaDisconnect = await requestJson('DELETE', `${server.baseUrl}/api/platform/cobros/mercadopago`, undefined, buildEmpresaUser(empresaId))
    assert.equal(empresaDisconnect.status, 403)

    const empleadoDisconnect = await requestJson('DELETE', `${server.baseUrl}/api/platform/cobros/mercadopago`, undefined, buildEmpleadoUser(empleadoId, empresaId, empleadoEmail))
    assert.equal(empleadoDisconnect.status, 403)

    const ownerDisconnect = await requestJson('DELETE', `${server.baseUrl}/api/platform/cobros/mercadopago`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(ownerDisconnect.status, 200)
    assert.equal(ownerDisconnect.data.data, null)
  } finally {
    await server.close()
  }
})

test('platform owner oauth stays isolated from seller oauth lifecycle and owner surfaces stay masked', async () => {
  const adminId = 'phase5-admin-plat-oauth-iso'
  const adminEmail = 'phase5-admin-plat-oauth-iso@example.com'
  const empresaId = 'phase5-emp-platform-oauth-isolation'
  const slug = 'phase5-platform-oauth-isolation'

  await seedPlatformAdmin({ adminId, email: adminEmail })
  await seedEmpresa({ empresaId, slug })

  mockFetch(async (input: Parameters<typeof fetch>[0] | URL, init?: Parameters<typeof fetch>[1]) => {
    const url = String(input)

    if (url.includes('/oauth/token')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { code?: string }

      if (body.code === 'seller-code-1') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'APP_USR-SELLER-1111',
            refresh_token: 'REFRESH-SELLER-1111',
            expires_in: 3600,
            scope: 'offline_access read write',
            token_type: 'bearer',
          }),
        } as Response
      }

      if (body.code === 'seller-code-2') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            access_token: 'APP_USR-SELLER-2222',
            refresh_token: 'REFRESH-SELLER-2222',
            expires_in: 7200,
            scope: 'offline_access read write',
            token_type: 'bearer',
          }),
        } as Response
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          access_token: 'APP_USR-OWNER-3333',
          refresh_token: 'REFRESH-OWNER-3333',
          expires_in: 5400,
          scope: 'offline_access read write',
          token_type: 'bearer',
        }),
      } as Response
    }

    if (url.includes('/v1/payment_methods')) {
      return { ok: true, status: 200 } as Response
    }

    throw new Error(`unexpected fetch ${url}`)
  })

  const app = express()
  app.use(express.json())
  app.use('/api/cobros', cobrosRouter)
  app.use('/api/platform', platformRouter)
  const server = await createTestServer(app)

  try {
    const sellerStart = await requestJson<{ authUrl: string }>('POST', `${server.baseUrl}/api/cobros/mercadopago/oauth/start`, undefined, buildEmpresaUser(empresaId))
    assert.equal(sellerStart.status, 200)
    const sellerFirstState = new URL(sellerStart.data.authUrl).searchParams.get('state')
    assert.ok(sellerFirstState)

    const sellerFirstCallback = await requestRaw(
      'GET',
      `${server.baseUrl}/api/cobros/mercadopago/oauth/callback?code=seller-code-1&state=${encodeURIComponent(sellerFirstState!)}`,
      buildEmpresaUser(empresaId)
    )
    assert.equal(sellerFirstCallback.status, 302)

    const sellerBeforeOwner = await requestJson('GET', `${server.baseUrl}/api/cobros/mercadopago`, undefined, buildEmpresaUser(empresaId))
    assert.equal(sellerBeforeOwner.status, 200)
    assert.equal(sellerBeforeOwner.data.data.payment_account.credentialLast4, '••••1111')

    const ownerStart = await requestJson<{ authUrl: string }>('POST', `${server.baseUrl}/api/platform/cobros/mercadopago/oauth/start`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(ownerStart.status, 200)
    const ownerState = new URL(ownerStart.data.authUrl).searchParams.get('state')
    assert.ok(ownerState)

    const ownerCallback = await requestRaw(
      'GET',
      `${server.baseUrl}/api/platform/cobros/mercadopago/oauth/callback?code=owner-code-1&state=${encodeURIComponent(ownerState!)}`,
      buildSuperAdminUser(adminId, adminEmail)
    )
    assert.equal(ownerCallback.status, 302)
    assert.equal(ownerCallback.headers.get('location'), 'http://localhost:3000/super-admin/configuracion?mercadopago_oauth=connected')

    const ownerPayment = await requestJson('GET', `${server.baseUrl}/api/platform/cobros/mercadopago`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(ownerPayment.status, 200)
    assert.equal(ownerPayment.data.data.ownerPaymentAccount?.credentialLast4, '••••3333')
    assert.equal(ownerPayment.data.data.ownerPaymentAccount?.providerAccountLabel, 'Mercado Pago owner')
    assert.equal(ownerPayment.data.data.ownerPaymentAccount?.connectionMode, 'oauth')
    assert.equal(ownerPayment.data.data.currentUserPaymentAccount?.credentialLast4, '••••3333')
    assert.equal(ownerPayment.data.data.currentUserPaymentAccount?.providerAccountLabel, 'Mercado Pago platform')
    assertOwnerSecretsHidden(ownerPayment.data, ['APP_USR-OWNER-3333', 'REFRESH-OWNER-3333'])

    const sellerAfterOwner = await requestJson('GET', `${server.baseUrl}/api/cobros/mercadopago`, undefined, buildEmpresaUser(empresaId))
    assert.equal(sellerAfterOwner.status, 200)
    assert.equal(sellerAfterOwner.data.data.payment_account.credentialLast4, '••••1111')

    const defaultsAfterOwner = await requestJson('GET', `${server.baseUrl}/api/platform/configuracion/fees`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(defaultsAfterOwner.status, 200)
    assert.equal(defaultsAfterOwner.data.data.ownerPaymentAccount?.credentialLast4, '••••3333')
    assert.equal(defaultsAfterOwner.data.data.ownerPaymentAccount?.connectionMode, 'oauth')
    assert.deepEqual(defaultsAfterOwner.data.data.owner_payment_account, defaultsAfterOwner.data.data.ownerPaymentAccount)
    assertOwnerSecretsHidden(defaultsAfterOwner.data, ['APP_USR-OWNER-3333', 'REFRESH-OWNER-3333'])

    const dashboardAfterOwner = await requestJson('GET', `${server.baseUrl}/api/platform/dashboard`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(dashboardAfterOwner.status, 200)
    assert.equal(dashboardAfterOwner.data.data.healthSnapshot.ownerPaymentAccount?.credentialLast4, '••••3333')
    assert.equal(dashboardAfterOwner.data.data.healthSnapshot.ownerPaymentAccount?.connectionMode, 'oauth')
    assertOwnerSecretsHidden(dashboardAfterOwner.data, ['APP_USR-OWNER-3333', 'REFRESH-OWNER-3333'])

    const sellerReconnectStart = await requestJson<{ authUrl: string }>('POST', `${server.baseUrl}/api/cobros/mercadopago/oauth/start`, undefined, buildEmpresaUser(empresaId))
    assert.equal(sellerReconnectStart.status, 200)
    const sellerSecondState = new URL(sellerReconnectStart.data.authUrl).searchParams.get('state')
    assert.ok(sellerSecondState)

    const sellerReconnectCallback = await requestRaw(
      'GET',
      `${server.baseUrl}/api/cobros/mercadopago/oauth/callback?code=seller-code-2&state=${encodeURIComponent(sellerSecondState!)}`,
      buildEmpresaUser(empresaId)
    )
    assert.equal(sellerReconnectCallback.status, 302)

    const sellerAfterReconnect = await requestJson('GET', `${server.baseUrl}/api/cobros/mercadopago`, undefined, buildEmpresaUser(empresaId))
    assert.equal(sellerAfterReconnect.status, 200)
    assert.equal(sellerAfterReconnect.data.data.payment_account.credentialLast4, '••••2222')

    const ownerAfterSellerReconnect = await requestJson('GET', `${server.baseUrl}/api/platform/cobros/mercadopago`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(ownerAfterSellerReconnect.status, 200)
    assert.equal(ownerAfterSellerReconnect.data.data.ownerPaymentAccount?.credentialLast4, '••••3333')
    assertOwnerSecretsHidden(ownerAfterSellerReconnect.data, ['APP_USR-OWNER-3333', 'REFRESH-OWNER-3333'])

    const ownerDisconnect = await requestJson('DELETE', `${server.baseUrl}/api/platform/cobros/mercadopago`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(ownerDisconnect.status, 200)
    assert.equal(ownerDisconnect.data.data, null)

    const sellerAfterOwnerDisconnect = await requestJson('GET', `${server.baseUrl}/api/cobros/mercadopago`, undefined, buildEmpresaUser(empresaId))
    assert.equal(sellerAfterOwnerDisconnect.status, 200)
    assert.equal(sellerAfterOwnerDisconnect.data.data.payment_account.credentialLast4, '••••2222')
  } finally {
    await server.close()
  }
})

test('employee users cannot access platform routes', async () => {
  const adminId = 'phase5-admin-3'
  const adminEmail = 'phase5-admin-3@example.com'
  const empresaId = 'phase5-emp-platform-3'
  const slug = 'phase5-platform-3'
  const empleadoId = 'phase5-usr-platform-3'
  const empleadoEmail = 'phase5-usr-platform-3@example.com'

  await seedPlatformAdmin({ adminId, email: adminEmail })
  await seedEmpresa({ empresaId, slug })
  await seedEmpleado({ userId: empleadoId, empresaId, email: empleadoEmail })

  const app = express()
  app.use(express.json())
  app.use('/api/platform', platformRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson('GET', `${server.baseUrl}/api/platform/dashboard`, undefined, buildEmpleadoUser(empleadoId, empresaId, empleadoEmail))
    assert.equal(response.status, 403)
    assert.equal(response.data.error, 'Sin permiso')
  } finally {
    await server.close()
  }
})

test('platform staff shared routes hide owner-global data and scope payloads to self only', async () => {
  const adminId = 'phase5-admin-staff-scope-owner'
  const adminEmail = 'phase5-admin-staff-scope-owner@example.com'
  const staffId = 'phase5-admin-staff-scope-secondary'
  const staffEmail = 'phase5-admin-staff-scope-secondary@example.com'
  const empresaId = 'phase5-emp-staff-scope-1'
  const slug = 'phase5-staff-scope-1'
  const eventoId = 'phase5-evt-staff-scope-1'
  const categoriaId = 'phase5-cat-staff-scope-1'
  const compradorId = 'phase5-cmp-staff-scope-1'

  await seedPlatformAdmin({ adminId, email: adminEmail })
  await seedPlatformStaff({
    adminId: staffId,
    email: staffEmail,
    permisos: {
      platform_dashboard: true,
      platform_empresas: true,
      platform_configuracion: true,
      platform_usuarios: true,
    },
  })
  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, email: 'phase5-staff-scope-buyer@example.com' })
  await seedEventoConCategoria({ eventoId, empresaId, categoriaId, precio: 200, stock: 10 })

  await pool.query(
    `INSERT INTO entradas (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado, precio_pagado, comision)
     VALUES (?, ?, ?, ?, ?, ?, 'valida', ?, ?)`,
    ['phase5-ent-staff-scope-1', eventoId, categoriaId, compradorId, 'phase5-qr-staff-scope-1', 'STAFF111', 200, 25]
  )
  await pool.query(
    `INSERT INTO consumibles_ventas (id, barra_id, evento_id, empresa_id, comprador_id, checkout_session_id, origen, qr_code, clave_corta, total, estado, owner_fee_amount, owner_fee_currency, owner_fee_mode, owner_fee_percentage, owner_fee_fixed_amount)
     VALUES ('phase5-sale-staff-scope-1', 'phase5-bar-staff-scope-1', ?, ?, ?, 'phase5-checkout-staff-scope-1', 'tenant_publico', 'phase5-qr-staff-scope-2', 'STAFF222', 80, 'pendiente', 8, 'ARS', 'percentage', 10, NULL)`,
    [eventoId, empresaId, compradorId]
  )

  mockFetch(async (input: Parameters<typeof fetch>[0] | URL, init?: Parameters<typeof fetch>[1]) => {
    const url = String(input)

    if (url.includes('/oauth/token')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as { code?: string }

      return {
        ok: true,
        status: 200,
        json: async () => body.code === 'staff-scope-owner-code'
          ? {
            access_token: 'APP_USR-OWNER-SCOPE-1111',
            refresh_token: 'REFRESH-OWNER-SCOPE-1111',
            expires_in: 3600,
            scope: 'offline_access read write',
            token_type: 'bearer',
          }
          : {
            access_token: 'APP_USR-STAFF-SCOPE-2222',
            refresh_token: 'REFRESH-STAFF-SCOPE-2222',
            expires_in: 3600,
            scope: 'offline_access read write',
            token_type: 'bearer',
          },
      } as Response
    }

    if (url.includes('/v1/payment_methods')) {
      return { ok: true, status: 200 } as Response
    }

    throw new Error(`unexpected fetch ${url}`)
  })

  const app = express()
  app.use(express.json())
  app.use('/api/platform', platformRouter)
  const server = await createTestServer(app)

  try {
    const ownerStart = await requestJson<{ authUrl: string }>('POST', `${server.baseUrl}/api/platform/cobros/mercadopago/oauth/start`, undefined, buildSuperAdminUser(adminId, adminEmail))
    const ownerState = new URL(ownerStart.data.authUrl).searchParams.get('state')
    assert.ok(ownerState)
    const ownerCallback = await requestRaw('GET', `${server.baseUrl}/api/platform/cobros/mercadopago/oauth/callback?code=staff-scope-owner-code&state=${encodeURIComponent(ownerState!)}`,
      buildSuperAdminUser(adminId, adminEmail))
    assert.equal(ownerCallback.status, 302)

    const staffStart = await requestJson<{ authUrl: string }>('POST', `${server.baseUrl}/api/platform/cobros/mercadopago/oauth/start`, undefined, buildPlatformStaffUser(staffId, staffEmail, {
      platform_dashboard: true,
      platform_configuracion: true,
      platform_usuarios: true,
    }))
    const staffState = new URL(staffStart.data.authUrl).searchParams.get('state')
    assert.ok(staffState)
    const staffCallback = await requestRaw('GET', `${server.baseUrl}/api/platform/cobros/mercadopago/oauth/callback?code=staff-scope-staff-code&state=${encodeURIComponent(staffState!)}`,
      buildPlatformStaffUser(staffId, staffEmail, {
        platform_dashboard: true,
        platform_configuracion: true,
        platform_usuarios: true,
      }))
    assert.equal(staffCallback.status, 302)

    const configuracion = await requestJson('GET', `${server.baseUrl}/api/platform/configuracion/fees`, undefined, buildPlatformStaffUser(staffId, staffEmail, { platform_configuracion: true }))
    assert.equal(configuracion.status, 200)
    assert.equal(configuracion.data.data.viewer_scope, 'own')
    assert.equal(configuracion.data.data.ownerPaymentAccount, null)
    assert.equal(configuracion.data.data.currentUserPaymentAccount?.credentialLast4, '••••2222')
    assertOwnerSecretsHidden(configuracion.data, ['APP_USR-OWNER-SCOPE-1111', 'REFRESH-OWNER-SCOPE-1111', 'APP_USR-STAFF-SCOPE-2222', 'REFRESH-STAFF-SCOPE-2222'])

    const cobros = await requestJson('GET', `${server.baseUrl}/api/platform/cobros/mercadopago`, undefined, buildPlatformStaffUser(staffId, staffEmail))
    assert.equal(cobros.status, 200)
    assert.equal(cobros.data.data.ownerPaymentAccount, null)
    assert.equal(cobros.data.data.currentUserPaymentAccount?.credentialLast4, '••••2222')
    assert.deepEqual(cobros.data.data.paymentAccounts, [])
    assertOwnerSecretsHidden(cobros.data, ['APP_USR-OWNER-SCOPE-1111', 'REFRESH-OWNER-SCOPE-1111', 'APP_USR-STAFF-SCOPE-2222', 'REFRESH-STAFF-SCOPE-2222'])

    const usuarios = await requestJson('GET', `${server.baseUrl}/api/platform/usuarios`, undefined, buildPlatformStaffUser(staffId, staffEmail, { platform_usuarios: true }))
    assert.equal(usuarios.status, 200)
    assert.deepEqual(usuarios.data.data.usuarios.map((usuario: any) => usuario.id), [staffId])

    const empresas = await requestJson('GET', `${server.baseUrl}/api/platform/empresas`, undefined, buildPlatformStaffUser(staffId, staffEmail, { platform_empresas: true }))
    assert.equal(empresas.status, 200)

    // This staff has platform.companies.read but not platform.revenue.view.global, so the
    // company-list financials (and the sales-count fields that proxy them) must be redacted
    // to 0 for every company — not just the money fields. Regression guard for the gap where
    // `ventas` / `metricasPorFlow.*.ventasTotales` leaked real sales counts unredacted.
    const staffCompanyRow = empresas.data.data.empresas.find((empresa: any) => empresa.id === empresaId)
    assert.ok(staffCompanyRow)
    assert.equal(staffCompanyRow.gananciasOwner, 0)
    assert.equal(staffCompanyRow.volumenBruto, 0)
    assert.equal(staffCompanyRow.ventas, 0)
    assert.equal(staffCompanyRow.metricasPorFlow.entradas.ventasTotales, 0)
    assert.equal(staffCompanyRow.metricasPorFlow.entradas.volumenBruto, 0)
    assert.equal(staffCompanyRow.metricasPorFlow.entradas.gananciasOwner, 0)
    assert.equal(staffCompanyRow.metricasPorFlow.consumibles.ventasTotales, 0)
    assert.equal(staffCompanyRow.metricasPorFlow.consumibles.volumenBruto, 0)
    assert.equal(staffCompanyRow.metricasPorFlow.consumibles.gananciasOwner, 0)

    // Sanity check that redaction is scope-dependent, not a blanket zeroing bug: the same
    // company must show real financials/ventas to a global-scope viewer (super_admin).
    const empresasAsOwner = await requestJson('GET', `${server.baseUrl}/api/platform/empresas`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(empresasAsOwner.status, 200)
    const ownerCompanyRow = empresasAsOwner.data.data.empresas.find((empresa: any) => empresa.id === empresaId)
    assert.ok(ownerCompanyRow)
    assert.equal(ownerCompanyRow.gananciasOwner, 33)
    assert.equal(ownerCompanyRow.ventas, 2)

    // This staff only has platform.companies.read (via platform_empresas) and
    // platform.revenue.view.own (via platform_dashboard) — not platform.revenue.view.global —
    // so the pure-money /ganancias endpoint must deny access outright rather than leak real
    // per-company earnings for companies outside this staff's revenue scope.
    const ganancias = await requestJson('GET', `${server.baseUrl}/api/platform/empresas/phase5-empresa-inexistente/ganancias`, undefined, buildPlatformStaffUser(staffId, staffEmail, { platform_empresas: true }))
    assert.equal(ganancias.status, 403)

    const fees = await requestJson('GET', `${server.baseUrl}/api/platform/empresas/phase5-empresa-inexistente/fees`, undefined, buildPlatformStaffUser(staffId, staffEmail, { platform_empresas: true }))
    assert.equal(fees.status, 404)
    assert.equal(fees.data.error, 'Empresa no encontrada')

    const roles = await requestJson('GET', `${server.baseUrl}/api/platform/roles`, undefined, buildPlatformStaffUser(staffId, staffEmail, { platform_usuarios: true }))
    assert.equal(roles.status, 200)
    assert.equal(roles.data.data.roles.length, 2)
    assert.equal(roles.data.data.roles.some((role: any) => role.slug === 'staff'), true)
  } finally {
    await server.close()
  }
})

test('platform backend APIs expose split governance contracts and owner metrics by flow', async () => {
  const adminId = 'phase5-admin-4'
  const adminEmail = 'phase5-admin-4@example.com'
  const empresaId = 'phase5-emp-platform-4'
  const slug = 'phase5-platform-4'
  const eventoId = 'phase5-evt-platform-4'
  const categoriaId = 'phase5-cat-platform-4'
  const compradorId = 'phase5-cmp-platform-4'

  await seedPlatformAdmin({ adminId, email: adminEmail })
  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, email: 'phase5-platform-4-buyer@example.com' })
  await seedEventoConCategoria({ eventoId, empresaId, categoriaId, precio: 150, stock: 10 })

  mockFetch(async () => ({ ok: true, status: 200 }) as Response)
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-PLATFORM-5555' })

  await pool.query(
    `INSERT INTO entradas (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado, precio_pagado, comision)
     VALUES (?, ?, ?, ?, ?, ?, 'valida', ?, ?)`,
    ['phase5-ent-platform-4', eventoId, categoriaId, compradorId, 'phase5-qr-platform-4', 'PLAT4444', 150, 21]
  )
  await pool.query(
    `INSERT INTO consumibles_ventas (id, barra_id, evento_id, empresa_id, comprador_id, checkout_session_id, origen, qr_code, clave_corta, total, estado, owner_fee_amount, owner_fee_currency, owner_fee_mode, owner_fee_percentage, owner_fee_fixed_amount)
     VALUES ('phase5-sale-platform-4', 'phase5-bar-platform-4', ?, ?, ?, 'phase5-checkout-platform-4', 'tenant_publico', 'phase5-qr-platform-4b', 'PLAT5555', 90, 'confirmado', 9, 'ARS', 'percentage', 10, NULL)`,
    [eventoId, empresaId, compradorId]
  )

  const app = express()
  app.use(express.json())
  app.use('/api/platform', platformRouter)
  const server = await createTestServer(app)

  try {
    const dashboard = await requestJson('GET', `${server.baseUrl}/api/platform/dashboard`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(dashboard.status, 200)
    assert.equal(dashboard.data.data.metricas_por_flow.entradas.gananciasOwner, 21)
    assert.equal(dashboard.data.data.metricas_por_flow.consumibles.gananciasOwner, 9)
    assert.equal(dashboard.data.data.profit_sharing.cutoff.source, 'first_allocation')
    assert.ok(typeof dashboard.data.data.profit_sharing.cutoff.startsAt === 'string')

    const companyRow = dashboard.data.data.empresas_resumen.find((empresa: any) => empresa.id === empresaId)
    assert.ok(companyRow)
    assert.equal(companyRow.marketplace_fee_by_flow.entradas.flow, 'entradas')
    assert.equal(companyRow.marketplace_fee_by_flow.consumibles.flow, 'consumibles')
    assert.equal(companyRow.sales_readiness.canSell, true)

    const defaultsBefore = await requestJson('GET', `${server.baseUrl}/api/platform/configuracion/fees`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(defaultsBefore.status, 200)
    assert.equal(defaultsBefore.data.data.defaults_by_flow.entradas.source, 'global')
    assert.equal(defaultsBefore.data.data.profit_sharing_cutoff.source, 'first_allocation')
    assert.equal(defaultsBefore.data.data.profit_sharing_cutoff.startsAt, dashboard.data.data.profit_sharing.cutoff.startsAt)

    const defaultsUpdate = await requestJson('PATCH', `${server.baseUrl}/api/platform/configuracion/fees`, {
      flow: 'consumibles',
      marketplaceFeeMode: 'fixed',
      marketplaceFeeFixedAmount: 14.5,
      marketplaceFeePercentage: null,
    }, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(defaultsUpdate.status, 200)
    assert.equal(defaultsUpdate.data.data.fee_summary.fixedAmount, 14.5)

    const companyFees = await requestJson('GET', `${server.baseUrl}/api/platform/empresas/${empresaId}/fees`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(companyFees.status, 200)
    assert.equal(companyFees.data.data.defaults_by_flow.consumibles.fixedAmount, 14.5)
    assert.equal(companyFees.data.data.overrides_by_flow.entradas.configured, false)

    const companyFeeUpdate = await requestJson('PATCH', `${server.baseUrl}/api/platform/empresas/${empresaId}/fees`, {
      flow: 'entradas',
      mode: 'fixed',
      fixedAmount: 45,
      percentage: null,
    }, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(companyFeeUpdate.status, 200)
    assert.equal(companyFeeUpdate.data.data.marketplace_fee.fixedAmount, 45)
    assert.equal(companyFeeUpdate.data.data.marketplace_fee_by_flow.entradas.fixedAmount, 45)

    const roles = await requestJson('GET', `${server.baseUrl}/api/platform/roles`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(roles.status, 200)
    assert.equal(roles.data.data.roles.some((role: any) => role.slug === 'superadmin'), true)

    const users = await requestJson('GET', `${server.baseUrl}/api/platform/usuarios`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(users.status, 200)
    assert.equal(users.data.data.usuarios.some((usuario: any) => usuario.email === adminEmail), true)
  } finally {
    await server.close()
  }
})

test('platform users CRUD rejects second or missing singleton superadmin', async () => {
  const adminId = 'phase5-admin-5'
  const adminEmail = 'phase5-admin-5@example.com'

  await seedPlatformAdmin({ adminId, email: adminEmail })

  const app = express()
  app.use(express.json())
  app.use('/api/platform', platformRouter)
  const server = await createTestServer(app)

  try {
    const created = await requestJson('POST', `${server.baseUrl}/api/platform/usuarios`, {
      nombre: 'Operador Platform',
      email: 'phase5-admin-5-operador@example.com',
      loginAlias: 'phase5-operador-5',
      password: 'ValidPass123!',
      roleSlug: 'staff',
      permisos: { ver_dashboard: true },
      activo: true,
    }, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(created.status, 201)

    const createdUserId = created.data.data.usuario.id

    const promoteToSecondSuperadmin = await requestJson('PATCH', `${server.baseUrl}/api/platform/usuarios/${createdUserId}`, {
      roleSlug: 'superadmin',
      activo: true,
    }, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(promoteToSecondSuperadmin.status, 409)
    assert.equal(promoteToSecondSuperadmin.data.code, 'singleton_superadmin_exists')

    const demoteSingleton = await requestJson('PATCH', `${server.baseUrl}/api/platform/usuarios/${adminId}`, {
      roleSlug: 'staff',
    }, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(demoteSingleton.status, 409)
    assert.equal(demoteSingleton.data.code, 'singleton_superadmin_required')

    const deleteSingleton = await requestJson('DELETE', `${server.baseUrl}/api/platform/usuarios/${adminId}`, undefined, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(deleteSingleton.status, 409)
    assert.equal(deleteSingleton.data.code, 'singleton_superadmin_required')
  } finally {
    await server.close()
  }
})

test('persisted company marketplace fee overrides env fallback in tenant-facing summaries and readiness flow', async () => {
  const adminId = 'phase5-admin-2'
  const adminEmail = 'phase5-admin-2@example.com'
  const empresaId = 'phase5-emp-platform-2'
  const slug = 'phase5-platform-2'

  await seedPlatformAdmin({ adminId, email: adminEmail })
  await seedEmpresa({ empresaId, slug })

  const app = express()
  app.use(express.json())
  app.use('/api/platform', platformRouter)
  app.use('/api/configuracion', configuracionRouter)
  const server = await createTestServer(app)

  try {
    const before = await requestJson('GET', `${server.baseUrl}/api/configuracion`, undefined, buildEmpresaUser(empresaId))
    assert.equal(before.status, 200)
    assert.deepEqual(before.data.data.marketplace_fee, {
      flow: 'entradas',
      configured: true,
      source: 'global',
      legacyFallback: 'env_legacy',
      mode: 'percentage',
      percentage: 12.5,
      fixedAmount: null,
    })

    const update = await requestJson('PATCH', `${server.baseUrl}/api/platform/empresas/${empresaId}/comision`, {
      marketplaceFeeMode: 'fixed',
      marketplaceFeeFixedAmount: 33.33,
      marketplaceFeePercentage: null,
    }, buildSuperAdminUser(adminId, adminEmail))
    assert.equal(update.status, 200)

    const after = await requestJson('GET', `${server.baseUrl}/api/configuracion`, undefined, buildEmpresaUser(empresaId))
    assert.equal(after.status, 200)
    assert.deepEqual(after.data.data.marketplace_fee, {
      flow: 'entradas',
      configured: true,
      source: 'empresa',
      legacyFallback: null,
      mode: 'fixed',
      percentage: null,
      fixedAmount: 33.33,
    })
    assert.equal(after.data.data.sales_readiness.status, 'missing_provider')
  } finally {
    await server.close()
  }
})
