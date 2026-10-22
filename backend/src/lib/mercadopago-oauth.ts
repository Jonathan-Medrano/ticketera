import crypto from 'crypto'

const MERCADO_PAGO_OAUTH_AUTHORIZE_URL = 'https://auth.mercadopago.com/authorization'
const MERCADO_PAGO_OAUTH_TOKEN_URL = 'https://api.mercadopago.com/oauth/token'
const MERCADO_PAGO_OAUTH_CLIENT_ID_ENV = 'MERCADO_PAGO_OAUTH_CLIENT_ID'
const MERCADO_PAGO_OAUTH_CLIENT_SECRET_ENV = 'MERCADO_PAGO_OAUTH_CLIENT_SECRET'
const MERCADO_PAGO_OAUTH_REDIRECT_URI_ENV = 'MERCADO_PAGO_OAUTH_REDIRECT_URI'
const MERCADO_PAGO_OAUTH_PLATFORM_REDIRECT_URI_ENV = 'MERCADO_PAGO_OAUTH_PLATFORM_REDIRECT_URI'
const MERCADO_PAGO_OAUTH_STATE_SECRET_ENV = 'MERCADO_PAGO_OAUTH_STATE_SECRET'
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

export type MercadoPagoOAuthSubject = 'empresa' | 'platform_owner'

type MercadoPagoOAuthEmpresaStatePayload = {
  subject: 'empresa'
  empresaId: string
  actorUserId: string
  issuedAt: number
}

type MercadoPagoOAuthPlatformOwnerStatePayload = {
  subject: 'platform_owner'
  actorUserId: string
  issuedAt: number
}

export type MercadoPagoOAuthStatePayload =
  | MercadoPagoOAuthEmpresaStatePayload
  | (MercadoPagoOAuthPlatformOwnerStatePayload & { empresaId?: undefined })

export type MercadoPagoOAuthStateInput =
  | { subject?: 'empresa'; empresaId: string; actorUserId: string }
  | { subject: 'platform_owner'; actorUserId: string }

export type MercadoPagoOAuthTokenResponse = {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  token_type?: string
}

function requireEnv(name: string) {
  const value = process.env[name]?.trim()
  if (!value) {
    throw new Error(`Falta configurar ${name}`)
  }

  return value
}

function getOAuthClientId() {
  return requireEnv(MERCADO_PAGO_OAUTH_CLIENT_ID_ENV)
}

function getOAuthClientSecret() {
  return requireEnv(MERCADO_PAGO_OAUTH_CLIENT_SECRET_ENV)
}

export function getMercadoPagoOAuthRedirectUri(subject: MercadoPagoOAuthSubject = 'empresa') {
  if (subject === 'platform_owner') {
    return process.env[MERCADO_PAGO_OAUTH_PLATFORM_REDIRECT_URI_ENV]?.trim()
      || `${requireEnv('NEXT_PUBLIC_APP_URL')}/api/platform/cobros/mercadopago/oauth/callback`
  }

  return process.env[MERCADO_PAGO_OAUTH_REDIRECT_URI_ENV]?.trim()
    || `${requireEnv('NEXT_PUBLIC_APP_URL')}/api/cobros/mercadopago/oauth/callback`
}

function getOAuthStateSecret() {
  return requireEnv(MERCADO_PAGO_OAUTH_STATE_SECRET_ENV)
}

function toBase64Url(value: string) {
  return Buffer.from(value, 'utf8').toString('base64url')
}

function fromBase64Url(value: string) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function signStatePayload(encodedPayload: string) {
  return crypto.createHmac('sha256', getOAuthStateSecret()).update(encodedPayload).digest('base64url')
}

export function createMercadoPagoOAuthState(payload: MercadoPagoOAuthStateInput) {
  const normalizedPayload = payload.subject === 'platform_owner'
    ? payload
    : { ...payload, subject: 'empresa' as const }
  const encodedPayload = toBase64Url(JSON.stringify({ ...normalizedPayload, issuedAt: Date.now() }))
  const signature = signStatePayload(encodedPayload)
  return `${encodedPayload}.${signature}`
}

export function parseMercadoPagoOAuthState(state: string): MercadoPagoOAuthStatePayload {
  const [encodedPayload, providedSignature] = state.split('.')

  if (!encodedPayload || !providedSignature) {
    throw new Error('El state de OAuth es inválido')
  }

  const expectedSignature = signStatePayload(encodedPayload)
  const providedBuffer = Buffer.from(providedSignature)
  const expectedBuffer = Buffer.from(expectedSignature)

  if (providedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(providedBuffer, expectedBuffer)) {
    throw new Error('El state de OAuth es inválido')
  }

  const payload = JSON.parse(fromBase64Url(encodedPayload)) as MercadoPagoOAuthStatePayload

  if (!payload.actorUserId || !payload.issuedAt) {
    throw new Error('El state de OAuth es inválido')
  }

  if (payload.subject === 'empresa' && !payload.empresaId) {
    throw new Error('El state de OAuth es inválido')
  }

  if (payload.subject !== 'empresa' && payload.subject !== 'platform_owner') {
    throw new Error('El state de OAuth es inválido')
  }

  if (Date.now() - payload.issuedAt > OAUTH_STATE_TTL_MS) {
    throw new Error('El state de OAuth expiró')
  }

  return payload
}

export function buildMercadoPagoOAuthAuthorizationUrl(payload: MercadoPagoOAuthStateInput) {
  const url = new URL(MERCADO_PAGO_OAUTH_AUTHORIZE_URL)
  const subject = payload.subject === 'platform_owner' ? 'platform_owner' : 'empresa'
  url.searchParams.set('client_id', getOAuthClientId())
  url.searchParams.set('state', createMercadoPagoOAuthState(payload))
  url.searchParams.set('redirect_uri', getMercadoPagoOAuthRedirectUri(subject))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('platform_id', 'mp')
  return url.toString()
}

export async function exchangeMercadoPagoAuthorizationCode(code: string, subject: MercadoPagoOAuthSubject = 'empresa') {
  const normalizedCode = code.trim()
  if (!normalizedCode) {
    throw new Error('El code de OAuth es obligatorio')
  }

  const response = await fetch(MERCADO_PAGO_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: getOAuthClientId(),
      client_secret: getOAuthClientSecret(),
      code: normalizedCode,
      grant_type: 'authorization_code',
      redirect_uri: getMercadoPagoOAuthRedirectUri(subject),
    }),
  })

  if (!response.ok) {
    throw new Error(`Mercado Pago OAuth rechazó el intercambio (${response.status})`)
  }

  const data = await response.json() as MercadoPagoOAuthTokenResponse
  if (!data.access_token) {
    throw new Error('Mercado Pago OAuth no devolvió access_token')
  }

  return data
}

// Error tipado para distinguir un refresh_token revocado/inválido (irrecuperable, hay que
// reconectar la cuenta) de un fallo transitorio de red/proveedor (reintentar más tarde).
export class MercadoPagoRefreshRevokedError extends Error {
  constructor(message = 'El refresh token de Mercado Pago fue revocado o es inválido') {
    super(message)
    this.name = 'MercadoPagoRefreshRevokedError'
  }
}

// Renueva el access_token usando el refresh_token (grant_type=refresh_token).
// MP puede devolver un refresh_token nuevo (rotación) o no; el caller debe persistir el que venga.
export async function refreshMercadoPagoAccessToken(refreshToken: string): Promise<MercadoPagoOAuthTokenResponse> {
  const normalizedRefreshToken = refreshToken.trim()
  if (!normalizedRefreshToken) {
    throw new Error('El refresh token de Mercado Pago es obligatorio')
  }

  const response = await fetch(MERCADO_PAGO_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: getOAuthClientId(),
      client_secret: getOAuthClientSecret(),
      grant_type: 'refresh_token',
      refresh_token: normalizedRefreshToken,
    }),
  })

  if (!response.ok) {
    // 400/401 = refresh_token revocado o inválido → irrecuperable, hay que reconectar.
    // Otros (timeout, 5xx, 429) = transitorio → reintentar luego sin tocar la cuenta.
    if (response.status === 400 || response.status === 401) {
      throw new MercadoPagoRefreshRevokedError(`Mercado Pago OAuth rechazó el refresh (${response.status})`)
    }
    throw new Error(`Mercado Pago OAuth no pudo renovar el token (${response.status})`)
  }

  const data = await response.json() as MercadoPagoOAuthTokenResponse
  if (!data.access_token) {
    throw new Error('Mercado Pago OAuth no devolvió access_token en el refresh')
  }

  return data
}
