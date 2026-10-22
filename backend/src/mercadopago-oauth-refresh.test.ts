import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { refreshMercadoPagoAccessToken, MercadoPagoRefreshRevokedError } from './lib/mercadopago-oauth'

// Test unitario puro (sin DB): mockea fetch para verificar el contrato del refresh OAuth de MP.
const originalFetch = globalThis.fetch
process.env.MERCADO_PAGO_OAUTH_CLIENT_ID = process.env.MERCADO_PAGO_OAUTH_CLIENT_ID || 'test-client-id'
process.env.MERCADO_PAGO_OAUTH_CLIENT_SECRET = process.env.MERCADO_PAGO_OAUTH_CLIENT_SECRET || 'test-client-secret'

after(() => {
  globalThis.fetch = originalFetch
})

test('refresh envía grant_type=refresh_token con el refresh token y devuelve los tokens nuevos', async () => {
  let captured: { url: unknown; body: Record<string, unknown> } | null = null
  globalThis.fetch = (async (url: unknown, init: { body: string }) => {
    captured = { url, body: JSON.parse(init.body) }
    return new Response(
      JSON.stringify({ access_token: 'NEW_AT', refresh_token: 'NEW_RT', expires_in: 15552000, token_type: 'bearer', scope: 'read write' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }) as typeof fetch

  const data = await refreshMercadoPagoAccessToken('OLD_RT')

  assert.equal(captured!.url, 'https://api.mercadopago.com/oauth/token')
  assert.equal(captured!.body.grant_type, 'refresh_token')
  assert.equal(captured!.body.refresh_token, 'OLD_RT')
  assert.equal(captured!.body.client_id, 'test-client-id')
  assert.equal(data.access_token, 'NEW_AT')
  assert.equal(data.refresh_token, 'NEW_RT')
  assert.equal(data.expires_in, 15552000)
})

test('refresh tira MercadoPagoRefreshRevokedError ante 400 (token revocado/inválido)', async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })) as typeof fetch

  await assert.rejects(refreshMercadoPagoAccessToken('REVOKED'), MercadoPagoRefreshRevokedError)
})

test('refresh tira error genérico (NO revoked) ante 5xx transitorio', async () => {
  globalThis.fetch = (async () => new Response('upstream error', { status: 503 })) as typeof fetch

  await assert.rejects(
    refreshMercadoPagoAccessToken('X'),
    (err: unknown) => err instanceof Error && !(err instanceof MercadoPagoRefreshRevokedError),
  )
})

test('refresh rechaza un 200 sin access_token', async () => {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ refresh_token: 'only_rt' }), { status: 200 })) as typeof fetch

  await assert.rejects(refreshMercadoPagoAccessToken('X'), /no devolvió access_token/)
})
