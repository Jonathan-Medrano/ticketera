import crypto from 'crypto'
import { prisma } from './prisma'
import { fetchMercadoPagoCollectorId, validateMercadoPagoAccessToken, type PaymentAccountReason, type PaymentAccountStatus } from './payment-accounts'

const uuidv4 = () => crypto.randomUUID()
const PAYMENT_ACCOUNTS_KEY_ENV = 'PAYMENT_ACCOUNTS_ENCRYPTION_KEY'
const AES_ALGORITHM = 'aes-256-gcm'
const AES_IV_BYTES = 12

// Shape returned from Prisma queries (matches PlatformPaymentAccount model)
type PlatformPaymentAccountRow = {
  id: string
  platform_admin_user_id: string | null
  provider: string
  status: string
  reason: string | null
  credential_ciphertext: string
  credential_iv: string
  credential_tag: string
  credential_last4: string | null
  collector_id: string | null
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
  updated_at: Date
}

export type PlatformPaymentAccountReadModel = {
  id: string
  platformAdminUserId: string
  provider: 'mercadopago'
  status: PaymentAccountStatus
  reason: PaymentAccountReason | null
  credentialLast4: string | null
  collectorId: string | null
  providerAccountLabel: string | null
  connectionMode: 'manual' | 'oauth'
  oauthConnectedAt: string | null
  validatedAt: string | null
  blockedAt: string | null
  updatedAt: string
}

type UpsertPlatformPaymentAccountInput = {
  platformAdminUserId: string
  accessToken: string
  refreshToken?: string | null
  oauthTokenType?: string | null
  oauthScope?: string | null
  oauthExpiresAt?: Date | null
  oauthConnectedAt?: Date | null
  providerAccountLabel?: string | null
}

function toNullableDate(value: Date | null | undefined) {
  return value ?? null
}

function toNullableIso(value: Date | null | undefined) {
  const date = toNullableDate(value)
  return date ? date.toISOString() : null
}

function normalizeAccessToken(accessToken: string) {
  return accessToken.trim()
}

function parseEncryptionKey(): Buffer {
  const rawKey = process.env[PAYMENT_ACCOUNTS_KEY_ENV]?.trim()
  if (!rawKey) throw new Error(`${PAYMENT_ACCOUNTS_KEY_ENV} no está configurada`)
  if (/^[0-9a-fA-F]{64}$/.test(rawKey)) return Buffer.from(rawKey, 'hex')

  if (/^[A-Za-z0-9+/]+={0,2}$/.test(rawKey)) {
    const decoded = Buffer.from(rawKey, 'base64')
    if (decoded.length === 32) return decoded
  }

  throw new Error(`${PAYMENT_ACCOUNTS_KEY_ENV} debe ser una key AES-256 válida en hex (64 chars) o base64 (32 bytes)`)
}

function getCredentialLast4(accessToken: string) {
  const normalized = normalizeAccessToken(accessToken)
  return normalized ? normalized.slice(-4) : null
}

function maskCredentialLast4(last4: string | null) {
  return last4 ? `••••${last4}` : null
}

function normalizeProviderAccountLabel(label?: string | null) {
  const normalized = label?.trim() ?? ''
  return normalized || null
}

function encryptCredential(value: string, emptyValueError: string) {
  const normalizedValue = value.trim()
  if (!normalizedValue) throw new Error(emptyValueError)

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

function decryptCredential(row: { credential_ciphertext: string; credential_iv: string; credential_tag: string }) {
  const decipher = crypto.createDecipheriv(AES_ALGORITHM, parseEncryptionKey(), Buffer.from(row.credential_iv, 'base64'))
  decipher.setAuthTag(Buffer.from(row.credential_tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(row.credential_ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

function resolveConnectionMode(row: Pick<PlatformPaymentAccountRow, 'oauth_refresh_ciphertext' | 'oauth_token_type' | 'oauth_scope' | 'oauth_expires_at' | 'oauth_connected_at'>) {
  return row.oauth_refresh_ciphertext || row.oauth_token_type || row.oauth_scope || row.oauth_expires_at || row.oauth_connected_at
    ? 'oauth'
    : 'manual'
}

function mapRowToReadModel(row: PlatformPaymentAccountRow): PlatformPaymentAccountReadModel {
  return {
    id: row.id,
    platformAdminUserId: row.platform_admin_user_id ?? '',
    provider: row.provider as 'mercadopago',
    status: row.status as PaymentAccountStatus,
    reason: row.reason as PaymentAccountReason | null,
    credentialLast4: maskCredentialLast4(row.credential_last4),
    collectorId: row.collector_id ?? null,
    providerAccountLabel: row.provider_account_label || (resolveConnectionMode(row) === 'oauth' ? 'Mercado Pago platform' : null),
    connectionMode: resolveConnectionMode(row),
    oauthConnectedAt: toNullableIso(row.oauth_connected_at),
    validatedAt: toNullableIso(row.validated_at),
    blockedAt: toNullableIso(row.blocked_at),
    updatedAt: row.updated_at.toISOString(),
  }
}

async function getPlatformPaymentAccountRow(platformAdminUserId: string) {
  const row = await prisma.platformPaymentAccount.findFirst({
    where: { platform_admin_user_id: platformAdminUserId, provider: 'mercadopago' },
  })
  return row as PlatformPaymentAccountRow | null
}

async function persistValidationOutcome(platformAdminUserId: string, validation: Awaited<ReturnType<typeof validateMercadoPagoAccessToken>>) {
  await prisma.platformPaymentAccount.updateMany({
    where: { platform_admin_user_id: platformAdminUserId, provider: 'mercadopago' },
    data: {
      status: validation.status as never,
      reason: (validation.reason ?? null) as never,
      validated_at: validation.validatedAt ?? null,
      blocked_at: validation.blockedAt ?? null,
      last_validation_error: validation.lastValidationError ?? null,
    },
  })
}

export async function getPlatformPaymentAccountReadModel(platformAdminUserId: string) {
  const row = await getPlatformPaymentAccountRow(platformAdminUserId)
  return row ? mapRowToReadModel(row) : null
}

export async function upsertPlatformPaymentAccount(input: UpsertPlatformPaymentAccountInput) {
  const accessToken = normalizeAccessToken(input.accessToken)
  if (!accessToken) throw new Error('El access token de Mercado Pago es obligatorio')

  const encrypted = encryptCredential(accessToken, 'El access token de Mercado Pago es obligatorio')
  const encryptedRefreshToken = input.refreshToken?.trim()
    ? encryptCredential(input.refreshToken, 'El refresh token de Mercado Pago es inválido')
    : null

  const upsertData = {
    platform_admin_user_id: input.platformAdminUserId,
    provider: 'mercadopago' as const,
    status: 'pending_validation' as const,
    reason: 'validation_pending' as const,
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
    oauth_connected_at: input.oauthConnectedAt ?? (encryptedRefreshToken ? new Date() : null),
    provider_account_label: normalizeProviderAccountLabel(input.providerAccountLabel),
    validated_at: null,
    last_validation_error: null,
    blocked_at: null,
  }

  await prisma.platformPaymentAccount.upsert({
    where: {
      platform_admin_user_id_provider: {
        platform_admin_user_id: input.platformAdminUserId,
        provider: 'mercadopago',
      },
    },
    create: { id: uuidv4(), ...upsertData },
    update: upsertData,
  })

  const [validation, collectorId] = await Promise.all([
    validateMercadoPagoAccessToken(accessToken),
    fetchMercadoPagoCollectorId(accessToken),
  ])
  await persistValidationOutcome(input.platformAdminUserId, validation)

  if (collectorId) {
    await prisma.platformPaymentAccount.updateMany({
      where: { platform_admin_user_id: input.platformAdminUserId, provider: 'mercadopago' },
      data: { collector_id: collectorId },
    })
  }

  return getPlatformPaymentAccountReadModel(input.platformAdminUserId)
}

export async function disconnectPlatformPaymentAccount(platformAdminUserId: string) {
  await prisma.platformPaymentAccount.deleteMany({
    where: { platform_admin_user_id: platformAdminUserId, provider: 'mercadopago' },
  })
}

// NOTE: `executor` parameter is kept for API compatibility during migration (Phase 4 will remove it).
// The delete now uses the Prisma pooler client directly since this operation requires no locking.
export async function disconnectPlatformPaymentAccountWithExecutor(
  platformAdminUserId: string,
  _executor: { query: (sql: string, values?: unknown[]) => Promise<unknown> },
) {
  await prisma.platformPaymentAccount.deleteMany({
    where: { platform_admin_user_id: platformAdminUserId, provider: 'mercadopago' },
  })
}

export async function listPlatformPaymentAccounts() {
  const rows = await prisma.platformPaymentAccount.findMany({
    where: { provider: 'mercadopago' },
  })
  return rows.map((r) => mapRowToReadModel(r as unknown as PlatformPaymentAccountRow))
}

export async function getPlatformCollectorId(platformAdminUserId: string): Promise<string | null> {
  const row = await prisma.platformPaymentAccount.findFirst({
    where: { platform_admin_user_id: platformAdminUserId, provider: 'mercadopago' },
    select: { collector_id: true, status: true, blocked_at: true },
  })
  if (!row || row.status !== 'ready_to_sell' || row.blocked_at) return null
  return row.collector_id ?? null
}

export async function getPlatformPaymentAccountAccessStatus(platformAdminUserId: string) {
  const row = await getPlatformPaymentAccountRow(platformAdminUserId)
  if (!row) return { hasAccount: false, readyToReceive: false, status: null as PaymentAccountStatus | null }

  return {
    hasAccount: true,
    readyToReceive: row.status === 'ready_to_sell' && !row.blocked_at,
    status: row.status,
  }
}

export async function revalidatePlatformPaymentAccount(platformAdminUserId: string) {
  const row = await getPlatformPaymentAccountRow(platformAdminUserId)
  if (!row) return null

  await prisma.platformPaymentAccount.updateMany({
    where: { platform_admin_user_id: platformAdminUserId, provider: 'mercadopago' },
    data: {
      status: 'pending_validation',
      reason: 'validation_pending',
      validated_at: null,
      last_validation_error: null,
      blocked_at: null,
    },
  })

  const decrypted = decryptCredential(row)
  const [validation, collectorId] = await Promise.all([
    validateMercadoPagoAccessToken(decrypted),
    fetchMercadoPagoCollectorId(decrypted),
  ])
  await persistValidationOutcome(platformAdminUserId, validation)

  if (collectorId) {
    await prisma.platformPaymentAccount.updateMany({
      where: { platform_admin_user_id: platformAdminUserId, provider: 'mercadopago' },
      data: { collector_id: collectorId },
    })
  }

  return getPlatformPaymentAccountReadModel(platformAdminUserId)
}
