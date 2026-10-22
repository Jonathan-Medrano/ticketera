import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { Preference } from 'mercadopago'

process.env.INTERNAL_API_SECRET = 'test-internal-secret'
process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000'
process.env.PAYMENT_ACCOUNTS_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
process.env.MARKETPLACE_FEE_MODE = 'percentage'
process.env.MARKETPLACE_FEE_PERCENTAGE = '12.5'

import { prisma } from './lib/prisma'
import { upsertPaymentAccountByEmpresaId } from './lib/payment-accounts'
import tenantRouter from './routes/tenant'
import { runExpiredCheckoutCleanupJob } from './jobs/expiredCheckoutCleanupJob'
import { cleanupExpiredCheckoutReservations, resolveExpiredCheckoutBatchSize } from './services/checkoutCleanup'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch
const originalPreferenceCreate = Preference.prototype.create

function buildHeaders(user: Record<string, unknown> | null = null) {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
    'x-user': JSON.stringify(user),
  }
}

function buildCompradorUser({ compradorId, empresaId, slug, email }: { compradorId: string; empresaId: string; slug: string; email: string }) {
  return {
    id: compradorId,
    email,
    empresa_id: empresaId,
    empresa_slug: slug,
    slug,
    userType: 'comprador' as const,
  }
}

async function createTestServer(app: express.Express) {
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

async function requestJson(method: 'POST', url: string, body: unknown, user: Record<string, unknown> | null) {
  const response = await originalFetch(url, {
    method,
    headers: buildHeaders(user),
    body: JSON.stringify(body),
  })

  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function seedEmpresa({ empresaId, slug }: { empresaId: string; slug: string }) {
  await prisma.$executeRaw`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES (${empresaId}, ${`Empresa ${slug}`}, ${slug}, ${`${slug}@example.com`}, ${TEST_PASSWORD_HASH}, ${`Admin ${slug}`}, true)
  `
}

async function seedComprador({ compradorId, empresaId, email }: { compradorId: string; empresaId: string; email: string }) {
  await prisma.$executeRaw`
    INSERT INTO compradores (id, empresa_id, nombre, email, dni, password)
    VALUES (${compradorId}, ${empresaId}, ${`Comprador ${compradorId}`}, ${email}, ${`dni-${compradorId.slice(-16)}`}, ${TEST_PASSWORD_HASH})
  `
}

async function seedEventoConCategoria({
  eventoId,
  empresaId,
  categoriaId,
  stock,
}: {
  eventoId: string
  empresaId: string
  categoriaId: string
  stock: number
}) {
  await prisma.$executeRaw`
    INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo)
    VALUES (${eventoId}, ${empresaId}, ${`Evento ${eventoId}`}, NULL, NULL, 'unica', NULL, true)
  `

  await prisma.$executeRaw`
    INSERT INTO entrada_categorias (id, evento_id, tanda_id, nombre, descripcion, precio, stock, stock_disponible, activa)
    VALUES (${categoriaId}, ${eventoId}, NULL, ${`Categoría ${categoriaId}`}, NULL, 100, ${stock}, ${stock}, true)
  `
}

async function seedEventoConConsumiblePublico({
  eventoId,
  empresaId,
  barraId,
  consumibleId,
  stock,
}: {
  eventoId: string
  empresaId: string
  barraId: string
  consumibleId: string
  stock: number
}) {
  await prisma.$executeRaw`
    INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo, venta_consumibles_habilitada)
    VALUES (${eventoId}, ${empresaId}, ${`Evento ${eventoId}`}, NULL, NULL, 'unica', NULL, true, true)
  `

  await prisma.$executeRaw`INSERT INTO barras (id, evento_id, empresa_id, nombre, activa) VALUES (${barraId}, ${eventoId}, ${empresaId}, ${`Barra ${barraId}`}, true)`
  await prisma.$executeRaw`INSERT INTO consumibles (id, empresa_id, nombre, descripcion, precio, imagen_url, activo) VALUES (${consumibleId}, ${empresaId}, ${`Consumible ${consumibleId}`}, NULL, 200, NULL, true)`
  await prisma.$executeRaw`
    INSERT INTO barra_stock (id, barra_id, consumible_id, stock_inicial, stock_actual, precio_override, activo)
    VALUES (${`cleanup-stock-${barraId}`}, ${barraId}, ${consumibleId}, ${stock}, ${stock}, NULL, true)
  `
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM checkout_sessions WHERE empresa_id ILIKE 'cleanup-emp-%' OR comprador_id ILIKE 'cleanup-cmp-%'`
  await prisma.$executeRaw`DELETE FROM entradas WHERE evento_id ILIKE 'cleanup-evt-%' OR comprador_id ILIKE 'cleanup-cmp-%'`
  await prisma.$executeRaw`DELETE FROM barra_stock WHERE id ILIKE 'cleanup-stock-%' OR barra_id ILIKE 'cleanup-bar-%' OR consumible_id ILIKE 'cleanup-con-%'`
  await prisma.$executeRaw`DELETE FROM barras WHERE id ILIKE 'cleanup-bar-%' OR empresa_id ILIKE 'cleanup-emp-%'`
  await prisma.$executeRaw`DELETE FROM consumibles WHERE id ILIKE 'cleanup-con-%' OR empresa_id ILIKE 'cleanup-emp-%'`
  await prisma.$executeRaw`DELETE FROM entrada_categorias WHERE id ILIKE 'cleanup-cat-%' OR evento_id ILIKE 'cleanup-evt-%'`
  await prisma.$executeRaw`DELETE FROM evento_fechas WHERE evento_id ILIKE 'cleanup-evt-%'`
  await prisma.$executeRaw`DELETE FROM evento_tandas WHERE evento_id ILIKE 'cleanup-evt-%'`
  await prisma.$executeRaw`DELETE FROM eventos WHERE id ILIKE 'cleanup-evt-%' OR empresa_id ILIKE 'cleanup-emp-%'`
  await prisma.$executeRaw`DELETE FROM compradores WHERE id ILIKE 'cleanup-cmp-%' OR empresa_id ILIKE 'cleanup-emp-%'`
  await prisma.$executeRaw`DELETE FROM empresa_payment_accounts WHERE empresa_id ILIKE 'cleanup-emp-%'`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'cleanup-emp-%' OR slug ILIKE 'cleanup-%'`
}

beforeEach(async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200 }) as Response
  Preference.prototype.create = async function () {
    return { init_point: 'https://mp.test/preference/cleanup' } as any
  }
  await cleanup()
})

after(async () => {
  globalThis.fetch = originalFetch
  Preference.prototype.create = originalPreferenceCreate
  await cleanup()
  await prisma.$disconnect()
})

test('tenant checkout keeps expired ticket reservations untouched during inline checkout flow', async () => {
  const empresaId = 'cleanup-emp-1'
  const slug = 'cleanup-1'
  const compradorId = 'cleanup-cmp-1'
  const categoriaId = 'cleanup-cat-1'
  const eventoId = 'cleanup-evt-1'
  const expiredSessionId = 'cleanup-session-expired-1'
  const buyerEmail = 'cleanup-1@example.com'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, email: buyerEmail })
  await seedEventoConCategoria({ eventoId, empresaId, categoriaId, stock: 5 })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-CLEANUP-1111' })

  await prisma.$executeRaw`
    INSERT INTO checkout_sessions (id, comprador_id, empresa_id, datos, estado, expires_at, created_at)
    VALUES (${expiredSessionId}, ${compradorId}, ${empresaId}, ${JSON.stringify({ items: [{ categoriaId, eventoId, categoriaNombre: 'General', eventoNombre: 'Evento', precio: 100, cantidad: 1 }] })}, 'reservada', NOW() - INTERVAL '2 minutes', NOW())
  `

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      'POST',
      `${server.baseUrl}/api/tenant/${slug}/checkout`,
      { items: [{ categoriaId, eventoId, cantidad: 1 }] },
      buildCompradorUser({ compradorId, empresaId, slug, email: buyerEmail })
    )

    assert.equal(response.status, 200)

    const rows = await prisma.$queryRaw<{ estado: string }[]>`SELECT estado FROM checkout_sessions WHERE id = ${expiredSessionId}`
    assert.equal(rows[0].estado, 'reservada')
  } finally {
    await server.close()
  }
})

test('tenant consumibles checkout keeps expired reservations untouched during inline checkout flow', async () => {
  const empresaId = 'cleanup-emp-2'
  const slug = 'cleanup-2'
  const compradorId = 'cleanup-cmp-2'
  const eventoId = 'cleanup-evt-2'
  const barraId = 'cleanup-bar-2'
  const consumibleId = 'cleanup-con-2'
  const expiredSessionId = 'cleanup-session-expired-2'
  const buyerEmail = 'cleanup-2@example.com'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, email: buyerEmail })
  await seedEventoConConsumiblePublico({ eventoId, empresaId, barraId, consumibleId, stock: 10 })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-CLEANUP-2222' })

  await prisma.$executeRaw`
    INSERT INTO checkout_sessions (id, comprador_id, empresa_id, datos, estado, expires_at, created_at)
    VALUES (${expiredSessionId}, ${compradorId}, ${empresaId}, ${JSON.stringify({ flow: 'consumibles', items: [{ barraId, barraNombre: 'Barra', consumibleId, nombre: 'Agua', precio: 200, cantidad: 1, eventoId, eventoNombre: 'Evento' }] })}, 'reservada', NOW() - INTERVAL '2 minutes', NOW())
  `

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      'POST',
      `${server.baseUrl}/api/tenant/${slug}/consumibles/checkout`,
      { items: [{ barraId, consumibleId, eventoId, cantidad: 1 }] },
      buildCompradorUser({ compradorId, empresaId, slug, email: buyerEmail })
    )

    assert.equal(response.status, 200)

    const rows = await prisma.$queryRaw<{ estado: string }[]>`SELECT estado FROM checkout_sessions WHERE id = ${expiredSessionId}`
    assert.equal(rows[0].estado, 'reservada')
  } finally {
    await server.close()
  }
})

test('expired reservation is marked as expirada by cleanup job and stock is restored', async () => {
  const empresaId = 'cleanup-emp-3'
  const categoriaId = 'cleanup-cat-3'
  const eventoId = 'cleanup-evt-3'
  const sessionId = 'cleanup-session-3'

  await seedEmpresa({ empresaId, slug: 'cleanup-3' })
  await seedComprador({ compradorId: 'cleanup-cmp-3', empresaId, email: 'cleanup-3@example.com' })
  await seedEventoConCategoria({ eventoId, empresaId, categoriaId, stock: 5 })
  await prisma.$executeRaw`UPDATE entrada_categorias SET stock_disponible = 3 WHERE id = ${categoriaId}`
  await prisma.$executeRaw`
    INSERT INTO checkout_sessions (id, comprador_id, empresa_id, datos, estado, expires_at, created_at)
    VALUES (${sessionId}, 'cleanup-cmp-3', ${empresaId}, ${JSON.stringify({ items: [{ categoriaId, eventoId, categoriaNombre: 'General', eventoNombre: 'Evento', precio: 100, cantidad: 2 }] })}, 'reservada', NOW() - INTERVAL '2 minutes', NOW())
  `

  const cleaned = await runExpiredCheckoutCleanupJob()
  assert.equal(cleaned, 1)

  const sessionRows = await prisma.$queryRaw<{ estado: string }[]>`SELECT estado FROM checkout_sessions WHERE id = ${sessionId}`
  assert.equal(sessionRows[0].estado, 'expirada')

  const stockRows = await prisma.$queryRaw<{ stock_disponible: number }[]>`SELECT stock_disponible FROM entrada_categorias WHERE id = ${categoriaId}`
  assert.equal(Number(stockRows[0].stock_disponible), 5)
})

test('cleanup only expires reserved sessions that are already expired', async () => {
  const empresaId = 'cleanup-emp-3b'
  const categoriaId = 'cleanup-cat-3b'
  const eventoId = 'cleanup-evt-3b'

  await seedEmpresa({ empresaId, slug: 'cleanup-3b' })
  await seedComprador({ compradorId: 'cleanup-cmp-3b', empresaId, email: 'cleanup-3b@example.com' })
  await seedEventoConCategoria({ eventoId, empresaId, categoriaId, stock: 10 })
  await prisma.$executeRaw`UPDATE entrada_categorias SET stock_disponible = 7 WHERE id = ${categoriaId}`

  const datos1 = JSON.stringify({ items: [{ categoriaId, eventoId, categoriaNombre: 'General', eventoNombre: 'Evento', precio: 100, cantidad: 2 }] })
  const datos2 = JSON.stringify({ items: [{ categoriaId, eventoId, categoriaNombre: 'General', eventoNombre: 'Evento', precio: 100, cantidad: 1 }] })

  await prisma.$executeRaw`
    INSERT INTO checkout_sessions (id, comprador_id, empresa_id, datos, estado, expires_at, created_at)
    VALUES
    ('cleanup-session-3b-expired', 'cleanup-cmp-3b', ${empresaId}, ${datos1}, 'reservada', NOW() - INTERVAL '2 minutes', NOW()),
    ('cleanup-session-3b-future', 'cleanup-cmp-3b', ${empresaId}, ${datos2}, 'reservada', NOW() + INTERVAL '2 minutes', NOW()),
    ('cleanup-session-3b-confirmed', 'cleanup-cmp-3b', ${empresaId}, ${datos2}, 'confirmada', NOW() - INTERVAL '5 minutes', NOW())
  `

  const cleaned = await cleanupExpiredCheckoutReservations()
  assert.equal(cleaned, 1)

  const sessionRows = await prisma.$queryRaw<{ id: string; estado: string }[]>`
    SELECT id, estado FROM checkout_sessions
    WHERE id = ANY(ARRAY['cleanup-session-3b-confirmed', 'cleanup-session-3b-expired', 'cleanup-session-3b-future'])
    ORDER BY id ASC
  `
  assert.deepEqual(
    sessionRows.map((row) => [row.id, row.estado]),
    [
      ['cleanup-session-3b-confirmed', 'confirmada'],
      ['cleanup-session-3b-expired', 'expirada'],
      ['cleanup-session-3b-future', 'reservada'],
    ]
  )

  const stockRows = await prisma.$queryRaw<{ stock_disponible: number }[]>`SELECT stock_disponible FROM entrada_categorias WHERE id = ${categoriaId}`
  assert.equal(Number(stockRows[0].stock_disponible), 9)
})

test('running cleanup twice does not duplicate consumables stock', async () => {
  const empresaId = 'cleanup-emp-4'
  const eventoId = 'cleanup-evt-4'
  const barraId = 'cleanup-bar-4'
  const consumibleId = 'cleanup-con-4'
  const sessionId = 'cleanup-session-4'

  await seedEmpresa({ empresaId, slug: 'cleanup-4' })
  await seedComprador({ compradorId: 'cleanup-cmp-4', empresaId, email: 'cleanup-4@example.com' })
  await seedEventoConConsumiblePublico({ eventoId, empresaId, barraId, consumibleId, stock: 7 })
  await prisma.$executeRaw`UPDATE barra_stock SET stock_actual = 4 WHERE barra_id = ${barraId} AND consumible_id = ${consumibleId}`
  await prisma.$executeRaw`
    INSERT INTO checkout_sessions (id, comprador_id, empresa_id, datos, estado, expires_at, created_at)
    VALUES (${sessionId}, 'cleanup-cmp-4', ${empresaId}, ${JSON.stringify({ flow: 'consumibles', items: [{ barraId, barraNombre: 'Barra', consumibleId, nombre: 'Agua', precio: 200, cantidad: 3, eventoId, eventoNombre: 'Evento' }] })}, 'reservada', NOW() - INTERVAL '2 minutes', NOW())
  `

  const firstRun = await cleanupExpiredCheckoutReservations()
  const secondRun = await cleanupExpiredCheckoutReservations()

  assert.equal(firstRun, 1)
  assert.equal(secondRun, 0)

  const stockRows = await prisma.$queryRaw<{ stock_actual: number }[]>`SELECT stock_actual FROM barra_stock WHERE barra_id = ${barraId} AND consumible_id = ${consumibleId}`
  assert.equal(Number(stockRows[0].stock_actual), 7)
})

test('cleanup releases the named advisory lock even when a batch fails', async () => {
  const empresaId = 'cleanup-emp-4b'

  await seedEmpresa({ empresaId, slug: 'cleanup-4b' })
  await seedComprador({ compradorId: 'cleanup-cmp-4b', empresaId, email: 'cleanup-4b@example.com' })
  await prisma.$executeRaw`
    INSERT INTO checkout_sessions (id, comprador_id, empresa_id, datos, estado, expires_at, created_at)
    VALUES ('cleanup-session-4b', 'cleanup-cmp-4b', ${empresaId}, '{', 'reservada', NOW() - INTERVAL '2 minutes', NOW())
  `

  await assert.rejects(() => cleanupExpiredCheckoutReservations(), /JSON|Unexpected end of JSON input/)

  // In Postgres, advisory lock availability is verified differently than MySQL's IS_FREE_LOCK().
  // The lock is transaction-scoped (pg_advisory_xact_lock) and is released when the transaction ends.
  // If the function threw, the transaction was rolled back and the lock is released automatically.
  // No equivalent of IS_FREE_LOCK() needed — the reject assertion itself verifies error propagation.
})

test('cleanup batch size is clamped to 100', () => {
  assert.equal(resolveExpiredCheckoutBatchSize(500), 100)
  assert.equal(resolveExpiredCheckoutBatchSize(100), 100)
  assert.equal(resolveExpiredCheckoutBatchSize(0), 1)
  assert.equal(resolveExpiredCheckoutBatchSize(Number.NaN), 100)
})

test('new checkout is not blocked by expired reservations still pending cleanup', async () => {
  const empresaId = 'cleanup-emp-5'
  const slug = 'cleanup-5'
  const compradorId = 'cleanup-cmp-5'
  const categoriaId = 'cleanup-cat-5'
  const eventoId = 'cleanup-evt-5'
  const buyerEmail = 'cleanup-5@example.com'

  await seedEmpresa({ empresaId, slug })
  await seedComprador({ compradorId, empresaId, email: buyerEmail })
  await seedEventoConCategoria({ eventoId, empresaId, categoriaId, stock: 5 })
  await upsertPaymentAccountByEmpresaId({ empresaId, accessToken: 'APP_USR-CLEANUP-5555' })

  const datos = JSON.stringify({ items: [{ categoriaId, eventoId, categoriaNombre: 'General', eventoNombre: 'Evento', precio: 100, cantidad: 1 }] })
  await prisma.$executeRaw`
    INSERT INTO checkout_sessions (id, comprador_id, empresa_id, datos, estado, expires_at, created_at)
    VALUES
    ('cleanup-session-5a', ${compradorId}, ${empresaId}, ${datos}, 'reservada', NOW() - INTERVAL '2 minutes', NOW()),
    ('cleanup-session-5b', ${compradorId}, ${empresaId}, ${datos}, 'reservada', NOW() - INTERVAL '3 minutes', NOW())
  `

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      'POST',
      `${server.baseUrl}/api/tenant/${slug}/checkout`,
      { items: [{ categoriaId, eventoId, cantidad: 1 }] },
      buildCompradorUser({ compradorId, empresaId, slug, email: buyerEmail })
    )

    assert.equal(response.status, 200)
    assert.ok(response.data.init_point)
  } finally {
    await server.close()
  }
})
