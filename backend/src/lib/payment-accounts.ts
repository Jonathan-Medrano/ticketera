import crypto from 'crypto'
import MercadoPagoConfig from 'mercadopago'
import { prisma } from './prisma'
import { roundMoney } from './money'
import { refreshMercadoPagoAccessToken, MercadoPagoRefreshRevokedError } from './mercadopago-oauth'
import { logServerError } from './safe-log'

const uuidv4 = () => crypto.randomUUID()

export type PaymentProvider = 'mercadopago'
export type PaymentAccountStatus = 'pending_validation' | 'ready_to_sell' | 'blocked'
export type PaymentAccountReason =
  | 'credentials_invalid'
  | 'provider_unreachable'
  | 'provider_blocked'
  | 'manual_block'
  | 'validation_pending'

export type MarketplaceFeeMode = 'percentage' | 'fixed' | 'hybrid'

export type EmpresaPaymentAccountRow = {
  id: string
  empresa_id: string
  provider: PaymentProvider
  status: PaymentAccountStatus
  reason: PaymentAccountReason | null
  credential_ciphertext: string
  credential_iv: string
  credential_tag: string
  credential_last4: string | null
  oauth_refresh_ciphertext: string | null
  oauth_refresh_iv: string | null
  oauth_refresh_tag: string | null
  oauth_token_type: string | null
  oauth_scope: string | null
  oauth_expires_at: string | Date | null
  oauth_connected_at: string | Date | null
  provider_account_label: string | null
  validated_at: string | Date | null
  last_validation_error: string | null
  blocked_at: string | Date | null
  created_at: string | Date
  updated_at: string | Date
}

// Prisma returns properly-typed objects; we adapt them to the row shape used by decrypt helpers
type PrismaRowCompat = {
  id: string
  empresa_id: string
  provider: PaymentProvider
  status: PaymentAccountStatus
  reason: PaymentAccountReason | null
  credential_ciphertext: string
  credential_iv: string
  credential_tag: string
  credential_last4: string | null
  oauth_refresh_ciphertext: string | null
  oauth_refresh_iv: string | null
  oauth_refresh_tag: string | null
  oauth_token_type: string | null
  oauth_scope: string | null
  oauth_expires_at: Date | null
  oauth_connected_at: Date | null
  provider_account_label: string | null
  validated_at: Date | null
  last_validation_error: string | null
  blocked_at: Date | null
  created_at: Date
  updated_at: Date
}

export type MarketplaceFeeConfig = {
  marketplaceFeeMode: MarketplaceFeeMode
  marketplaceFeePercentage: number | null
  marketplaceFeeFixedAmount: number | null
}

export type PaymentAccount = {
  id: string
  empresaId: string
  provider: PaymentProvider
  status: PaymentAccountStatus
  reason: PaymentAccountReason | null
  accessToken: string
  refreshToken: string | null
  oauthTokenType: string | null
  oauthScope: string | null
  oauthExpiresAt: Date | null
  oauthConnectedAt: Date | null
  credentialLast4: string | null
  providerAccountLabel: string | null
  validatedAt: Date | null
  lastValidationError: string | null
  blockedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export type PaymentAccountReadModel = {
  id: string
  empresaId: string
  provider: PaymentProvider
  status: PaymentAccountStatus
  reason: PaymentAccountReason | null
  credentialLast4: string | null
  providerAccountLabel: string | null
  validatedAt: string | null
  blockedAt: string | null
  updatedAt: string
}

export type UpsertPaymentAccountInput = {
  empresaId: string
  accessToken: string
  refreshToken?: string | null
  oauthTokenType?: string | null
  oauthScope?: string | null
  oauthExpiresAt?: Date | null
  oauthConnectedAt?: Date | null
  provider?: PaymentProvider
  providerAccountLabel?: string | null
}

export type MercadoPagoValidationResult = {
  status: PaymentAccountStatus
  reason: PaymentAccountReason | null
  lastValidationError: string | null
  validatedAt: Date | null
  blockedAt: Date | null
}

const PAYMENT_PROVIDER: PaymentProvider = 'mercadopago'
const PAYMENT_ACCOUNTS_KEY_ENV = 'PAYMENT_ACCOUNTS_ENCRYPTION_KEY'
const AES_ALGORITHM = 'aes-256-gcm'
const AES_IV_BYTES = 12
const MERCADO_PAGO_VALIDATION_URL = 'https://api.mercadopago.com/v1/payment_methods'
const MERCADO_PAGO_TIMEOUT_MS = 10000
// Margen pre-emptive: refrescamos el access_token de MP cuando le quedan menos de 7 días.
// El token de OAuth de MP dura ~180 días, así que esta ventana da mucho aire y evita cortar
// cobros si una empresa no opera durante semanas.
const MP_OAUTH_REFRESH_MARGIN_MS = 7 * 24 * 60 * 60 * 1000

if (process.env.NODE_ENV === 'production') {
  const key = process.env[PAYMENT_ACCOUNTS_KEY_ENV]
  if (!key) throw new Error(`${PAYMENT_ACCOUNTS_KEY_ENV} is required in production`)
  if (Buffer.from(key, 'hex').length !== 32) throw new Error(`${PAYMENT_ACCOUNTS_KEY_ENV} must be 32 bytes (64 hex chars)`)
}

function toNullableDate(value: string | Date | null): Date | null {
  if (!value) return null
  return value instanceof Date ? value : new Date(value)
}

function toNullableIso(value: string | Date | null): string | null {
  const date = toNullableDate(value)
  return date ? date.toISOString() : null
}

function toNullableNumber(value: number | string | null): number | null {
  if (value === null || value === undefined) return null
  const normalized = Number(value)
  return Number.isFinite(normalized) ? normalized : null
}

function normalizeProviderAccountLabel(label?: string | null) {
  const normalized = label?.trim() ?? ''
  return normalized.length ? normalized : null
}

function normalizeAccessToken(accessToken: string) {
  return accessToken.trim()
}

function getCredentialLast4(accessToken: string) {
  const normalized = normalizeAccessToken(accessToken)
  if (!normalized) return null
  return normalized.slice(-4)
}

function maskCredentialLast4(last4: string | null) {
  if (!last4) return null
  return `••••${last4}`
}

function parseEncryptionKey(): Buffer {
  const rawKey = process.env[PAYMENT_ACCOUNTS_KEY_ENV]?.trim()
  if (!rawKey) {
    throw new Error(`${PAYMENT_ACCOUNTS_KEY_ENV} no está configurada`)
  }

  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) {
    return Buffer.from(rawKey, 'hex')
  }

  if (/^[A-Za-z0-9+/]+={0,2}$/.test(rawKey)) {
    const decoded = Buffer.from(rawKey, 'base64')
    if (decoded.length === 32) {
      return decoded
    }
  }

  throw new Error(`${PAYMENT_ACCOUNTS_KEY_ENV} debe ser una key AES-256 válida en hex (64 chars) o base64 (32 bytes)`)
}

function encryptCredential(value: string, emptyValueError: string) {
  const normalizedValue = value.trim()
  if (!normalizedValue) {
    throw new Error(emptyValueError)
  }

  const iv = crypto.randomBytes(AES_IV_BYTES)
  const cipher = crypto.createCipheriv(AES_ALGORITHM, parseEncryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(normalizedValue, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()

  return {
    credentialCiphertext: ciphertext.toString('base64'),
    credentialIv: iv.toString('base64'),
    credentialTag: tag.toString('base64'),
    credentialLast4: getCredentialLast4(normalizedValue),
  }
}

function encryptAccessToken(accessToken: string) {
  return encryptCredential(accessToken, 'El access token de Mercado Pago es obligatorio')
}

function decryptCredential(row: { credential_ciphertext: string; credential_iv: string; credential_tag: string }) {
  const decipher = crypto.createDecipheriv(
    AES_ALGORITHM,
    parseEncryptionKey(),
    Buffer.from(row.credential_iv, 'base64')
  )

  decipher.setAuthTag(Buffer.from(row.credential_tag, 'base64'))

  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(row.credential_ciphertext, 'base64')),
    decipher.final(),
  ])

  return plaintext.toString('utf8')
}

function decryptAccessToken(row: Pick<EmpresaPaymentAccountRow, 'credential_ciphertext' | 'credential_iv' | 'credential_tag'>) {
  return decryptCredential(row)
}

function decryptRefreshToken(row: Pick<EmpresaPaymentAccountRow, 'oauth_refresh_ciphertext' | 'oauth_refresh_iv' | 'oauth_refresh_tag'>) {
  if (!row.oauth_refresh_ciphertext || !row.oauth_refresh_iv || !row.oauth_refresh_tag) {
    return null
  }

  return decryptCredential({
    credential_ciphertext: row.oauth_refresh_ciphertext,
    credential_iv: row.oauth_refresh_iv,
    credential_tag: row.oauth_refresh_tag,
  })
}

function mapMercadoPagoValidationStatus(statusCode: number): MercadoPagoValidationResult {
  if (statusCode === 400 || statusCode === 401) {
    return {
      status: 'blocked',
      reason: 'credentials_invalid',
      lastValidationError: `http_${statusCode}`,
      validatedAt: null,
      blockedAt: new Date(),
    }
  }

  if (statusCode === 403) {
    return {
      status: 'blocked',
      reason: 'provider_blocked',
      lastValidationError: 'http_403',
      validatedAt: null,
      blockedAt: new Date(),
    }
  }

  if (statusCode === 408 || statusCode === 429 || statusCode >= 500) {
    return {
      status: 'pending_validation',
      reason: 'provider_unreachable',
      lastValidationError: `http_${statusCode}`,
      validatedAt: null,
      blockedAt: null,
    }
  }

  return {
    status: 'blocked',
    reason: 'provider_blocked',
    lastValidationError: `http_${statusCode}`,
    validatedAt: null,
    blockedAt: new Date(),
  }
}

export async function validateMercadoPagoAccessToken(accessToken: string): Promise<MercadoPagoValidationResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), MERCADO_PAGO_TIMEOUT_MS)

  try {
    const response = await fetch(MERCADO_PAGO_VALIDATION_URL, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${normalizeAccessToken(accessToken)}`,
        Accept: 'application/json',
      },
      signal: controller.signal,
    })

    if (!response.ok) {
      return mapMercadoPagoValidationStatus(response.status)
    }

    return {
      status: 'ready_to_sell',
      reason: null,
      lastValidationError: null,
      validatedAt: new Date(),
      blockedAt: null,
    }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return {
        status: 'pending_validation',
        reason: 'provider_unreachable',
        lastValidationError: 'timeout',
        validatedAt: null,
        blockedAt: null,
      }
    }

    return {
      status: 'pending_validation',
      reason: 'provider_unreachable',
      lastValidationError: 'network_error',
      validatedAt: null,
      blockedAt: null,
    }
  } finally {
    clearTimeout(timeout)
  }
}

export async function fetchMercadoPagoCollectorId(accessToken: string): Promise<string | null> {
  try {
    const response = await fetch('https://api.mercadopago.com/v1/users/me', {
      headers: { Authorization: `Bearer ${normalizeAccessToken(accessToken)}`, Accept: 'application/json' },
    })
    if (!response.ok) return null
    const data = await response.json() as Record<string, unknown>
    const id = data?.id
    return id != null ? String(id) : null
  } catch {
    return null
  }
}

function mapRowToPaymentAccount(row: EmpresaPaymentAccountRow | PrismaRowCompat): PaymentAccount {
  return {
    id: row.id,
    empresaId: row.empresa_id,
    provider: row.provider as PaymentProvider,
    status: row.status as PaymentAccountStatus,
    reason: row.reason as PaymentAccountReason | null,
    accessToken: decryptCredential(row),
    refreshToken: decryptRefreshToken(row),
    oauthTokenType: row.oauth_token_type,
    oauthScope: row.oauth_scope,
    oauthExpiresAt: toNullableDate(row.oauth_expires_at),
    oauthConnectedAt: toNullableDate(row.oauth_connected_at),
    credentialLast4: row.credential_last4,
    providerAccountLabel: row.provider_account_label,
    validatedAt: toNullableDate(row.validated_at),
    lastValidationError: row.last_validation_error,
    blockedAt: toNullableDate(row.blocked_at),
    createdAt: toNullableDate(row.created_at)!,
    updatedAt: toNullableDate(row.updated_at)!,
  }
}

function mapRowToReadModel(row: EmpresaPaymentAccountRow | PrismaRowCompat): PaymentAccountReadModel {
  return {
    id: row.id,
    empresaId: row.empresa_id,
    provider: row.provider as PaymentProvider,
    status: row.status as PaymentAccountStatus,
    reason: row.reason as PaymentAccountReason | null,
    credentialLast4: maskCredentialLast4(row.credential_last4),
    providerAccountLabel: row.provider_account_label,
    validatedAt: toNullableIso(row.validated_at),
    blockedAt: toNullableIso(row.blocked_at),
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

async function getPaymentAccountRowByEmpresaId(empresaId: string, provider: PaymentProvider = PAYMENT_PROVIDER): Promise<PrismaRowCompat | null> {
  const row = await prisma.empresaPaymentAccount.findFirst({
    where: { empresa_id: empresaId, provider: provider as never },
  })
  if (!row) return null
  return {
    id: row.id,
    empresa_id: row.empresa_id,
    provider: row.provider as PaymentProvider,
    status: row.status as PaymentAccountStatus,
    reason: (row.reason ?? null) as PaymentAccountReason | null,
    credential_ciphertext: row.credential_ciphertext,
    credential_iv: row.credential_iv,
    credential_tag: row.credential_tag,
    credential_last4: row.credential_last4,
    oauth_refresh_ciphertext: row.oauth_refresh_ciphertext,
    oauth_refresh_iv: row.oauth_refresh_iv,
    oauth_refresh_tag: row.oauth_refresh_tag,
    oauth_token_type: row.oauth_token_type,
    oauth_scope: row.oauth_scope,
    oauth_expires_at: row.oauth_expires_at,
    oauth_connected_at: row.oauth_connected_at,
    provider_account_label: row.provider_account_label,
    validated_at: row.validated_at,
    last_validation_error: row.last_validation_error,
    blocked_at: row.blocked_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

export async function getPaymentAccountByEmpresaId(empresaId: string, provider: PaymentProvider = PAYMENT_PROVIDER) {
  const row = await getPaymentAccountRowByEmpresaId(empresaId, provider)
  return row ? mapRowToPaymentAccount(row) : null
}

// Persiste un access_token renovado SIN re-disparar la validación contra MP ni resetear el
// status (a diferencia de upsertPaymentAccountByEmpresaId). El refresh es transparente: una
// cuenta ready_to_sell sigue ready_to_sell. Solo reescribe el refresh token si MP devolvió uno.
async function persistRefreshedMercadoPagoToken(
  empresaId: string,
  input: { accessToken: string; refreshToken: string | null; oauthTokenType: string | null; oauthScope: string | null; oauthExpiresAt: Date | null },
) {
  const encrypted = encryptAccessToken(input.accessToken)
  const encryptedRefresh = input.refreshToken?.trim()
    ? encryptCredential(input.refreshToken, 'El refresh token de Mercado Pago es inválido')
    : null

  await prisma.empresaPaymentAccount.updateMany({
    where: { empresa_id: empresaId, provider: PAYMENT_PROVIDER as never },
    data: {
      credential_ciphertext: encrypted.credentialCiphertext,
      credential_iv: encrypted.credentialIv,
      credential_tag: encrypted.credentialTag,
      credential_last4: encrypted.credentialLast4,
      ...(encryptedRefresh
        ? {
            oauth_refresh_ciphertext: encryptedRefresh.credentialCiphertext,
            oauth_refresh_iv: encryptedRefresh.credentialIv,
            oauth_refresh_tag: encryptedRefresh.credentialTag,
          }
        : {}),
      oauth_token_type: input.oauthTokenType,
      oauth_scope: input.oauthScope,
      oauth_expires_at: input.oauthExpiresAt,
    },
  })
}

// Marca la cuenta como bloqueada por OAuth (refresh_token revocado/inválido). Reusa el estado
// 'blocked' + 'credentials_invalid' que la UI de cobros ya sabe mostrar → la empresa reconecta.
async function markMercadoPagoNeedsReconnect(empresaId: string) {
  await prisma.empresaPaymentAccount.updateMany({
    where: { empresa_id: empresaId, provider: PAYMENT_PROVIDER as never },
    data: {
      status: 'blocked' as never,
      reason: 'credentials_invalid' as never,
      blocked_at: new Date(),
      last_validation_error: 'oauth_refresh_failed',
    },
  })
}

// Devuelve un access_token de MP válido, refrescándolo pre-emptivamente si está por expirar.
async function ensureFreshMercadoPagoAccessToken(empresaId: string, account: PaymentAccount): Promise<string | null> {
  const expiresAt = account.oauthExpiresAt ? account.oauthExpiresAt.getTime() : null

  // Cuentas sin info de expiración (credencial cargada a mano, sin flujo OAuth): no se pueden
  // refrescar; se usan tal cual.
  if (expiresAt === null) return account.accessToken

  // Todavía válido con margen → usar el actual.
  if (expiresAt > Date.now() + MP_OAUTH_REFRESH_MARGIN_MS) return account.accessToken

  // Está por expirar (o expiró) pero no hay refresh token → no hay forma de renovar.
  if (!account.refreshToken) return account.accessToken

  try {
    const refreshed = await refreshMercadoPagoAccessToken(account.refreshToken)
    const newExpiresAt = typeof refreshed.expires_in === 'number'
      ? new Date(Date.now() + refreshed.expires_in * 1000)
      : null
    await persistRefreshedMercadoPagoToken(empresaId, {
      accessToken: refreshed.access_token!,
      // MP puede rotar el refresh_token; si no vino uno nuevo, conservamos el actual.
      refreshToken: refreshed.refresh_token ?? account.refreshToken,
      oauthTokenType: refreshed.token_type ?? account.oauthTokenType,
      oauthScope: refreshed.scope ?? account.oauthScope,
      oauthExpiresAt: newExpiresAt,
    })
    return refreshed.access_token!
  } catch (error) {
    logServerError('mercadopago oauth refresh', error)

    // El refresh es preventivo: si el token actual TODAVÍA no expiró, seguimos usándolo y
    // reintentaremos el refresh en el próximo checkout. No cortamos el cobro por un fallo transitorio.
    if (expiresAt > Date.now()) return account.accessToken

    // Token ya expirado. Re-leer por si otro request concurrente ya lo refrescó (carrera en la
    // ventana de margen) antes de bloquear la cuenta.
    const fresh = await getPaymentAccountByEmpresaId(empresaId, PAYMENT_PROVIDER)
    if (fresh?.oauthExpiresAt && fresh.oauthExpiresAt.getTime() > Date.now()) {
      return fresh.accessToken
    }

    // Expirado y refresh fallido. Si fue revocación, marcamos para reconectar; si fue transitorio,
    // no tocamos la cuenta (puede recuperarse) pero no devolvemos cliente en este intento.
    if (error instanceof MercadoPagoRefreshRevokedError) {
      await markMercadoPagoNeedsReconnect(empresaId)
    }
    return null
  }
}

export async function getMercadoPagoClientByEmpresaId(empresaId: string) {
  const paymentAccount = await getPaymentAccountByEmpresaId(empresaId, PAYMENT_PROVIDER)
  if (!paymentAccount) return null

  const accessToken = await ensureFreshMercadoPagoAccessToken(empresaId, paymentAccount)
  if (!accessToken) return null

  return new MercadoPagoConfig({ accessToken })
}

export async function getPaymentAccountReadModelByEmpresaId(empresaId: string, provider: PaymentProvider = PAYMENT_PROVIDER) {
  const row = await getPaymentAccountRowByEmpresaId(empresaId, provider)
  return row ? mapRowToReadModel(row) : null
}

export async function getPaymentAccountReadModelByEmpresaIdsBulk(
  empresaIds: string[],
  provider: PaymentProvider = PAYMENT_PROVIDER,
): Promise<Map<string, PaymentAccountReadModel>> {
  if (empresaIds.length === 0) return new Map()
  const rows = await prisma.empresaPaymentAccount.findMany({
    where: { empresa_id: { in: empresaIds }, provider: provider as never },
  })
  const result = new Map<string, PaymentAccountReadModel>()
  for (const row of rows) {
    const compat: PrismaRowCompat = {
      id: row.id,
      empresa_id: row.empresa_id,
      provider: row.provider as PaymentProvider,
      status: row.status as PaymentAccountStatus,
      reason: (row.reason ?? null) as PaymentAccountReason | null,
      credential_ciphertext: row.credential_ciphertext,
      credential_iv: row.credential_iv,
      credential_tag: row.credential_tag,
      credential_last4: row.credential_last4,
      oauth_refresh_ciphertext: row.oauth_refresh_ciphertext,
      oauth_refresh_iv: row.oauth_refresh_iv,
      oauth_refresh_tag: row.oauth_refresh_tag,
      oauth_token_type: row.oauth_token_type,
      oauth_scope: row.oauth_scope,
      oauth_expires_at: row.oauth_expires_at,
      oauth_connected_at: row.oauth_connected_at,
      provider_account_label: row.provider_account_label,
      validated_at: row.validated_at,
      last_validation_error: row.last_validation_error,
      blocked_at: row.blocked_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }
    result.set(row.empresa_id, mapRowToReadModel(compat))
  }
  return result
}

async function persistValidationOutcome(empresaId: string, provider: PaymentProvider, validation: MercadoPagoValidationResult) {
  await prisma.empresaPaymentAccount.updateMany({
    where: { empresa_id: empresaId, provider: provider as never },
    data: {
      status: validation.status as never,
      reason: (validation.reason ?? null) as never,
      validated_at: validation.validatedAt,
      blocked_at: validation.blockedAt,
      last_validation_error: validation.lastValidationError,
    },
  })
}

export async function upsertPaymentAccountByEmpresaId(input: UpsertPaymentAccountInput) {
  const accessToken = normalizeAccessToken(input.accessToken)
  if (!accessToken) {
    throw new Error('El access token de Mercado Pago es obligatorio')
  }

  const encrypted = encryptAccessToken(accessToken)
  const encryptedRefreshToken = input.refreshToken?.trim()
    ? encryptCredential(input.refreshToken, 'El refresh token de Mercado Pago es inválido')
    : null
  const provider = input.provider ?? PAYMENT_PROVIDER
  const providerAccountLabel = normalizeProviderAccountLabel(input.providerAccountLabel)

  await prisma.empresaPaymentAccount.upsert({
    where: {
      empresa_id_provider: { empresa_id: input.empresaId, provider: provider as never },
    },
    create: {
      id: uuidv4(),
      empresa_id: input.empresaId,
      provider: provider as never,
      status: 'pending_validation' as never,
      reason: 'validation_pending' as never,
      credential_ciphertext: encrypted.credentialCiphertext,
      credential_iv: encrypted.credentialIv,
      credential_tag: encrypted.credentialTag,
      credential_last4: encrypted.credentialLast4,
      oauth_refresh_ciphertext: encryptedRefreshToken?.credentialCiphertext ?? null,
      oauth_refresh_iv: encryptedRefreshToken?.credentialIv ?? null,
      oauth_refresh_tag: encryptedRefreshToken?.credentialTag ?? null,
      oauth_token_type: input.oauthTokenType?.trim() ?? null,
      oauth_scope: input.oauthScope?.trim() ?? null,
      oauth_expires_at: input.oauthExpiresAt ?? null,
      oauth_connected_at: input.oauthConnectedAt ?? new Date(),
      provider_account_label: providerAccountLabel,
      validated_at: null,
      last_validation_error: null,
      blocked_at: null,
    },
    update: {
      status: 'pending_validation' as never,
      reason: 'validation_pending' as never,
      credential_ciphertext: encrypted.credentialCiphertext,
      credential_iv: encrypted.credentialIv,
      credential_tag: encrypted.credentialTag,
      credential_last4: encrypted.credentialLast4,
      oauth_refresh_ciphertext: encryptedRefreshToken?.credentialCiphertext ?? null,
      oauth_refresh_iv: encryptedRefreshToken?.credentialIv ?? null,
      oauth_refresh_tag: encryptedRefreshToken?.credentialTag ?? null,
      oauth_token_type: input.oauthTokenType?.trim() ?? null,
      oauth_scope: input.oauthScope?.trim() ?? null,
      oauth_expires_at: input.oauthExpiresAt ?? null,
      oauth_connected_at: input.oauthConnectedAt ?? new Date(),
      provider_account_label: providerAccountLabel,
      validated_at: null,
      last_validation_error: null,
      blocked_at: null,
    },
  })

  const mercadoPagoValidation = await validateMercadoPagoAccessToken(accessToken)
  await persistValidationOutcome(input.empresaId, provider, mercadoPagoValidation)

  return getPaymentAccountByEmpresaId(input.empresaId, provider)
}

export async function disconnectPaymentAccountByEmpresaId(empresaId: string, provider: PaymentProvider = PAYMENT_PROVIDER) {
  await prisma.empresaPaymentAccount.deleteMany({
    where: { empresa_id: empresaId, provider: provider as never },
  })
}

export async function revalidatePaymentAccountByEmpresaId(empresaId: string, provider: PaymentProvider = PAYMENT_PROVIDER) {
  const row = await getPaymentAccountRowByEmpresaId(empresaId, provider)
  if (!row) {
    return null
  }

  await prisma.empresaPaymentAccount.updateMany({
    where: { empresa_id: empresaId, provider: provider as never },
    data: {
      status: 'pending_validation' as never,
      reason: 'validation_pending' as never,
      validated_at: null,
      last_validation_error: null,
      blocked_at: null,
    },
  })

  const mercadoPagoValidation = await validateMercadoPagoAccessToken(decryptAccessToken(row))
  await persistValidationOutcome(empresaId, provider, mercadoPagoValidation)

  return getPaymentAccountByEmpresaId(empresaId, provider)
}
