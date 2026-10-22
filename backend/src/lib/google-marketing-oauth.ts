/**
 * Google OAuth helper para conectar GA4 y GTM automáticamente.
 *
 * Variables de entorno requeridas:
 *   GOOGLE_MARKETING_CLIENT_ID       — Client ID de la app OAuth en Google Cloud
 *   GOOGLE_MARKETING_CLIENT_SECRET   — Client Secret
 *   GOOGLE_MARKETING_REDIRECT_URI    — Ej: http://localhost:3000/api/marketing/google/callback
 *   GOOGLE_OAUTH_STATE_SECRET        — String aleatorio de 32+ chars para firmar CSRF state
 *   GOOGLE_OAUTH_ENCRYPTION_KEY      — 32 bytes en hex (64 chars) para AES-256-GCM de tokens
 *   FRONTEND_URL                     — Ej: http://localhost:3000 (para redirect post-callback)
 */

import crypto from 'crypto'
import { randomUUID as uuidv4 } from 'node:crypto'
import { prisma } from './prisma'

// ─── Encriptación AES-256-GCM ────────────────────────────────────────────────

const ALGORITHM = 'aes-256-gcm'
const IV_BYTES = 12

function getEncryptionKey(): Buffer {
  const key = process.env.GOOGLE_OAUTH_ENCRYPTION_KEY
  if (!key) throw new Error('Falta configurar GOOGLE_OAUTH_ENCRYPTION_KEY')
  const buf = Buffer.from(key, 'hex')
  if (buf.length !== 32) throw new Error('GOOGLE_OAUTH_ENCRYPTION_KEY debe ser 32 bytes en hex (64 chars)')
  return buf
}

function encrypt(value: string): { ciphertext: string; iv: string; tag: string } {
  const iv = crypto.randomBytes(IV_BYTES)
  const cipher = crypto.createCipheriv(ALGORITHM, getEncryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()])
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: (cipher as crypto.CipherGCM).getAuthTag().toString('base64'),
  }
}

function decrypt(ciphertext: string, iv: string, tag: string): string {
  const decipher = crypto.createDecipheriv(ALGORITHM, getEncryptionKey(), Buffer.from(iv, 'base64'))
  ;(decipher as crypto.DecipherGCM).setAuthTag(Buffer.from(tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}

// ─── CSRF State (HMAC-SHA256) ─────────────────────────────────────────────────

const OAUTH_STATE_TTL_MS = 10 * 60 * 1000 // 10 minutos

function getStateSecret(): string {
  const s = process.env.GOOGLE_OAUTH_STATE_SECRET
  if (!s) throw new Error('Falta configurar GOOGLE_OAUTH_STATE_SECRET')
  return s
}

export function buildOAuthState(empresaId: string): string {
  const payload = Buffer.from(JSON.stringify({ empresaId, issuedAt: Date.now() })).toString('base64url')
  const sig = crypto.createHmac('sha256', getStateSecret()).update(payload).digest('base64url')
  return `${payload}.${sig}`
}

export function parseOAuthState(state: string): { empresaId: string } {
  const dotIdx = state.lastIndexOf('.')
  if (dotIdx === -1) throw new Error('State inválido')
  const payload = state.slice(0, dotIdx)
  const sig = state.slice(dotIdx + 1)
  if (!payload || !sig) throw new Error('State inválido')

  const expected = crypto.createHmac('sha256', getStateSecret()).update(payload).digest('base64url')
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
    throw new Error('State inválido')
  }

  const { empresaId, issuedAt } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  if (Date.now() - issuedAt > OAUTH_STATE_TTL_MS) throw new Error('State expirado')
  return { empresaId }
}

// ─── URL de autorización ──────────────────────────────────────────────────────

export function buildGoogleAuthUrl(empresaId: string): string {
  const clientId = process.env.GOOGLE_MARKETING_CLIENT_ID
  const redirectUri = process.env.GOOGLE_MARKETING_REDIRECT_URI
  if (!clientId || !redirectUri) throw new Error('Falta configurar credenciales de Google OAuth')

  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.searchParams.set('client_id', clientId)
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', [
    'openid',
    'email',
    'https://www.googleapis.com/auth/analytics.readonly',
    'https://www.googleapis.com/auth/tagmanager.readonly',
  ].join(' '))
  url.searchParams.set('access_type', 'offline')
  url.searchParams.set('prompt', 'consent')
  url.searchParams.set('state', buildOAuthState(empresaId))
  return url.toString()
}

// ─── Intercambio de code por tokens ──────────────────────────────────────────

export async function exchangeCode(code: string): Promise<{
  access_token: string
  refresh_token?: string
  expires_in?: number
  scope?: string
  email?: string
}> {
  const clientId = process.env.GOOGLE_MARKETING_CLIENT_ID
  const clientSecret = process.env.GOOGLE_MARKETING_CLIENT_SECRET
  const redirectUri = process.env.GOOGLE_MARKETING_REDIRECT_URI
  if (!clientId || !clientSecret || !redirectUri) throw new Error('Falta configurar credenciales de Google OAuth')

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
    }),
  })
  if (!res.ok) throw new Error(`Google rechazó el intercambio (${res.status})`)
  const data = await res.json() as Record<string, any>
  if (!data.access_token) throw new Error('Google no devolvió access_token')

  // Obtener email del userinfo
  let email: string | undefined
  try {
    const profile = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${data.access_token}` },
    })
    if (profile.ok) email = ((await profile.json()) as Record<string, any>).email
  } catch { /* no-op */ }

  return { access_token: data.access_token as string, refresh_token: data.refresh_token as string | undefined, expires_in: data.expires_in as number | undefined, scope: data.scope as string | undefined, email }
}

// ─── Refresh de access token ──────────────────────────────────────────────────

// Marca de grant revocado (Google `invalid_grant`) para que el caller pueda
// flaggear la conexión como `needs_reconnect` en vez de loopear 500s.
export class RevokedGrantError extends Error {
  constructor(message = 'El grant de Google fue revocado (invalid_grant)') {
    super(message)
    this.name = 'RevokedGrantError'
  }
}

export async function refreshAccessToken(encryptedRefresh: {
  ciphertext: string
  iv: string
  tag: string
}): Promise<{ accessToken: string; expiresIn?: number }> {
  const refreshToken = decrypt(encryptedRefresh.ciphertext, encryptedRefresh.iv, encryptedRefresh.tag)
  const clientId = process.env.GOOGLE_MARKETING_CLIENT_ID!
  const clientSecret = process.env.GOOGLE_MARKETING_CLIENT_SECRET!

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!res.ok) {
    // invalid_grant ⇒ el usuario revocó el acceso (o el refresh token expiró):
    // distinguirlo para que la conexión se pueda marcar para reconectar.
    let body: Record<string, any> = {}
    try { body = await res.json() as Record<string, any> } catch { /* no-op */ }
    if (body?.error === 'invalid_grant') throw new RevokedGrantError()
    throw new Error('No se pudo renovar el access token de Google')
  }
  const data = await res.json() as Record<string, any>
  if (!data.access_token) throw new Error('Google no devolvió access_token al renovar')
  // Preferir el expires_in real de Google; fallback a 3600 si no viene.
  return { accessToken: data.access_token as string, expiresIn: data.expires_in as number | undefined }
}

// ─── CRUD en DB ───────────────────────────────────────────────────────────────

export async function saveGoogleConnection(
  empresaId: string,
  tokens: {
    accessToken: string
    refreshToken?: string
    expiresIn?: number
    scope?: string
    email?: string
  }
): Promise<void> {
  const at = encrypt(tokens.accessToken)
  const rt = tokens.refreshToken ? encrypt(tokens.refreshToken) : null
  const expiresAt = tokens.expiresIn ? new Date(Date.now() + tokens.expiresIn * 1000) : null

  const commonData = {
    status: 'connected',
    access_token_ciphertext: at.ciphertext,
    access_token_iv: at.iv,
    access_token_tag: at.tag,
    account_email: tokens.email ?? null,
    scopes: tokens.scope ?? null,
    expires_at: expiresAt,
    connected_at: new Date(),
  }

  await prisma.marketingOAuthAccount.upsert({
    where: { empresa_id_provider: { empresa_id: empresaId, provider: 'google' } },
    create: {
      id: uuidv4(),
      empresa_id: empresaId,
      provider: 'google',
      ...commonData,
      refresh_token_ciphertext: rt?.ciphertext ?? null,
      refresh_token_iv: rt?.iv ?? null,
      refresh_token_tag: rt?.tag ?? null,
    },
    update: {
      ...commonData,
      // Only overwrite refresh token if a new one was returned (Google only returns it on first auth)
      ...(rt
        ? {
            refresh_token_ciphertext: rt.ciphertext,
            refresh_token_iv: rt.iv,
            refresh_token_tag: rt.tag,
          }
        : {}),
    },
  })
}

export async function getGoogleConnection(empresaId: string) {
  return prisma.marketingOAuthAccount.findFirst({
    where: { empresa_id: empresaId, provider: 'google' },
  })
}

export async function deleteGoogleConnection(empresaId: string): Promise<void> {
  await prisma.marketingOAuthAccount.deleteMany({
    where: { empresa_id: empresaId, provider: 'google' },
  })
}

export async function saveGa4Selection(
  empresaId: string,
  propertyId: string,
  measurementId: string
): Promise<void> {
  // SEGURIDAD: el ga4_measurement_id termina inyectado en el storefront PÚBLICO
  // del tenant. Validar que el propertyId pertenece a la cuenta conectada antes
  // de persistir, y nunca persistir un measurementId vacío/null (lookup fallido).
  const owned = await listGa4Properties(empresaId)
  if (!owned.some((p) => p.propertyId === propertyId)) {
    throw new Error('La propiedad GA4 no pertenece a la cuenta conectada')
  }
  if (!measurementId) {
    throw new Error('No se pudo resolver el measurement-id de GA4 para esa propiedad')
  }

  await Promise.all([
    prisma.marketingOAuthAccount.updateMany({
      where: { empresa_id: empresaId, provider: 'google' },
      data: { ga4_property_id: propertyId, ga4_measurement_id: measurementId },
    }),
    // Sincronizar con el campo que leen el tenant y el script de tracking
    prisma.empresa.update({
      where: { id: empresaId },
      data: { ga4_measurement_id: measurementId },
    }),
  ])
}

export async function saveGtmSelection(
  empresaId: string,
  accountId: string,
  containerId: string
): Promise<void> {
  // SEGURIDAD: el gtm_container_id se inyecta en el storefront PÚBLICO del tenant
  // y carga JS arbitrario de GTM. Validar que el par accountId/containerId está en
  // los contenedores de la cuenta conectada antes de persistir (anti-tag-injection).
  const owned = await listGtmContainers(empresaId)
  if (!owned.some((c) => c.accountId === accountId && c.containerId === containerId)) {
    throw new Error('Container no pertenece a la cuenta conectada')
  }

  await Promise.all([
    prisma.marketingOAuthAccount.updateMany({
      where: { empresa_id: empresaId, provider: 'google' },
      data: { gtm_account_id: accountId, gtm_container_id: containerId },
    }),
    // Sincronizar con el campo que lee el tenant
    prisma.empresa.update({
      where: { id: empresaId },
      data: { gtm_container_id: containerId },
    }),
  ])
}

// ─── Token válido con auto-refresh ───────────────────────────────────────────

async function getValidAccessToken(empresaId: string): Promise<string> {
  const conn = await getGoogleConnection(empresaId)
  if (!conn) throw new Error('No hay conexión con Google para esta empresa')

  const expiresAt = conn.expires_at ? new Date(conn.expires_at).getTime() : 0
  // Si aún no expiró (con 5 min de margen), usar el token guardado
  if (expiresAt > Date.now() + 5 * 60 * 1000) {
    try {
      return decrypt(conn.access_token_ciphertext, conn.access_token_iv, conn.access_token_tag)
    } catch {
      // decrypt falló (clave rotada / dato corrupto): flaggear para reconectar
      // en vez de devolver 500s indefinidamente sobre un token ilegible.
      await markNeedsReconnect(empresaId)
      throw new Error('No se pudo descifrar el token de Google. Reconectá la cuenta.')
    }
  }

  // Necesita refresh
  if (!conn.refresh_token_ciphertext) throw new Error('No hay refresh token disponible')
  let refreshed: { accessToken: string; expiresIn?: number }
  try {
    refreshed = await refreshAccessToken({
      ciphertext: conn.refresh_token_ciphertext,
      iv: conn.refresh_token_iv!,
      tag: conn.refresh_token_tag!,
    })
  } catch (err) {
    // invalid_grant (revocado) o refresh token indescifrable ⇒ marcar para reconectar.
    if (err instanceof RevokedGrantError) {
      await markNeedsReconnect(empresaId)
      throw new Error('La conexión con Google fue revocada. Reconectá la cuenta.')
    }
    // decrypt del refresh token también puede fallar (clave rotada / corrupto).
    if (err instanceof Error && err.message.includes('Unsupported state')) {
      await markNeedsReconnect(empresaId)
      throw new Error('No se pudo descifrar el refresh token de Google. Reconectá la cuenta.')
    }
    throw err
  }

  const at = encrypt(refreshed.accessToken)
  // Usar el expires_in real de Google; fallback a 3600s si no vino.
  const ttlSeconds = refreshed.expiresIn ?? 3600
  await prisma.marketingOAuthAccount.updateMany({
    where: { empresa_id: empresaId, provider: 'google' },
    data: {
      access_token_ciphertext: at.ciphertext,
      access_token_iv: at.iv,
      access_token_tag: at.tag,
      expires_at: new Date(Date.now() + ttlSeconds * 1000),
    },
  })
  return refreshed.accessToken
}

// Marca la conexión OAuth de la empresa como necesitada de reconexión.
// `status` es VarChar(30) sin enum/CHECK; default 'pending', happy-path 'connected'.
async function markNeedsReconnect(empresaId: string): Promise<void> {
  await prisma.marketingOAuthAccount.updateMany({
    where: { empresa_id: empresaId, provider: 'google' },
    data: { status: 'needs_reconnect' },
  })
}

// ─── Listado de propiedades GA4 y contenedores GTM ───────────────────────────

export async function listGa4Properties(
  empresaId: string
): Promise<{ propertyId: string; displayName: string }[]> {
  const token = await getValidAccessToken(empresaId)
  const res = await fetch(
    'https://analyticsadmin.googleapis.com/v1beta/properties?filter=parent:accounts/-&pageSize=50',
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) throw new Error(`Error al listar propiedades GA4 (${res.status})`)
  const data = await res.json() as Record<string, any>
  return (data.properties ?? []).map((p: { name: string; displayName: string }) => ({
    propertyId: p.name.replace('properties/', ''),
    displayName: p.displayName,
  }))
}

export async function getGa4MeasurementId(
  empresaId: string,
  propertyId: string
): Promise<string | null> {
  const token = await getValidAccessToken(empresaId)
  const res = await fetch(
    `https://analyticsadmin.googleapis.com/v1beta/properties/${propertyId}/dataStreams?pageSize=10`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!res.ok) return null
  const data = await res.json() as Record<string, any>
  const webStream = (data.dataStreams ?? []).find(
    (s: { type: string; webStreamData?: { measurementId?: string } }) => s.type === 'WEB_DATA_STREAM'
  )
  return webStream?.webStreamData?.measurementId ?? null
}

export async function listGtmContainers(
  empresaId: string
): Promise<{ accountId: string; containerId: string; publicId: string; name: string }[]> {
  const token = await getValidAccessToken(empresaId)

  const accountsRes = await fetch(
    'https://www.googleapis.com/tagmanager/v2/accounts?fields=account(accountId,name)',
    { headers: { Authorization: `Bearer ${token}` } }
  )
  if (!accountsRes.ok) throw new Error(`Error al listar cuentas GTM (${accountsRes.status})`)
  const accountsData = await accountsRes.json() as Record<string, any>
  const accounts: { accountId: string; name: string }[] = accountsData.account ?? []

  const containers: { accountId: string; containerId: string; publicId: string; name: string }[] = []
  for (const account of accounts.slice(0, 5)) {
    const cRes = await fetch(
      `https://www.googleapis.com/tagmanager/v2/accounts/${account.accountId}/containers`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (cRes.ok) {
      const cData = await cRes.json() as Record<string, any>
      for (const c of cData.container ?? []) {
        containers.push({
          accountId: account.accountId,
          containerId: c.containerId,
          publicId: c.publicId,
          name: c.name,
        })
      }
    }
  }
  return containers
}
