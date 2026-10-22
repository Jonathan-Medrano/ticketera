import './test-env'

import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { prisma } from './lib/prisma'
import tenantRouter from './routes/tenant'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch

function buildHeaders(user: Record<string, unknown> | null = null) {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
    'x-user': JSON.stringify(user),
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

async function requestJson(method: 'GET' | 'POST', url: string, body?: unknown, user: Record<string, unknown> | null = null) {
  const response = await originalFetch(url, {
    method,
    headers: buildHeaders(user),
    body: body == null ? undefined : JSON.stringify(body),
  })

  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function seedEmpresa(empresaId: string, slug: string) {
  await prisma.$executeRaw`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES (${empresaId}, ${`Empresa ${slug}`}, ${slug}, ${`${slug}@example.com`}, ${TEST_PASSWORD_HASH}, 'Admin', true)
  `
}

async function seedComprador(compradorId: string, empresaId: string, email: string) {
  await prisma.$executeRaw`
    INSERT INTO compradores (id, empresa_id, nombre, email, dni, password)
    VALUES (${compradorId}, ${empresaId}, 'Comprador Test', ${email}, '12345678', ${TEST_PASSWORD_HASH})
  `
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM checkout_sessions WHERE id ILIKE 'phase-sched-checkout-%'`
  await prisma.$executeRaw`DELETE FROM barra_stock WHERE id ILIKE 'phase-sched-stock-%' OR barra_id ILIKE 'phase-sched-bar-%' OR consumible_id ILIKE 'phase-sched-con-%'`
  await prisma.$executeRaw`DELETE FROM barras WHERE id ILIKE 'phase-sched-bar-%' OR empresa_id ILIKE 'phase-sched-emp-%'`
  await prisma.$executeRaw`DELETE FROM consumibles WHERE id ILIKE 'phase-sched-con-%' OR empresa_id ILIKE 'phase-sched-emp-%'`
  await prisma.$executeRaw`DELETE FROM entrada_categorias WHERE id ILIKE 'phase-sched-cat-%' OR evento_id ILIKE 'phase-sched-evt-%'`
  await prisma.$executeRaw`DELETE FROM evento_fechas WHERE evento_id ILIKE 'phase-sched-evt-%'`
  await prisma.$executeRaw`DELETE FROM evento_tandas WHERE evento_id ILIKE 'phase-sched-evt-%'`
  await prisma.$executeRaw`DELETE FROM eventos WHERE id ILIKE 'phase-sched-evt-%' OR empresa_id ILIKE 'phase-sched-emp-%'`
  await prisma.$executeRaw`DELETE FROM compradores WHERE id ILIKE 'phase-sched-buyer-%' OR empresa_id ILIKE 'phase-sched-emp-%'`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'phase-sched-emp-%' OR slug ILIKE 'phase-sched-%'`
}

beforeEach(async () => {
  await cleanup()
})

after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

test('tenant routes enforce scheduled publication across list, detail and checkout', async () => {
  const empresaId = 'phase-sched-emp-1'
  const slug = 'phase-sched-1'
  const listedEventId = 'phase-sched-evt-listed'
  const detailVisibleEventId = 'phase-sched-evt-detail'
  const hiddenEventId = 'phase-sched-evt-hidden'
  const liveEventId = 'phase-sched-evt-live'
  const buyerId = 'phase-sched-buyer-1'
  const buyerEmail = 'phase-sched-buyer-1@example.com'

  await seedEmpresa(empresaId, slug)
  await seedComprador(buyerId, empresaId, buyerEmail)
  await prisma.$executeRaw`
    INSERT INTO eventos (
      id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo,
      publication_mode, pre_publish_visibility, publish_at_utc, publish_timezone,
      venta_consumibles_habilitada
    ) VALUES
      (${listedEventId}, ${empresaId}, 'Listado solo', NULL, NULL, 'unica', NULL, true, 'scheduled', 'listado_solo', '2099-05-20 23:00:00'::timestamp, 'America/Argentina/Buenos_Aires', true),
      (${detailVisibleEventId}, ${empresaId}, 'Detalle visible', NULL, NULL, 'unica', NULL, true, 'scheduled', 'detail_visible', '2099-05-20 23:00:00'::timestamp, 'America/Argentina/Buenos_Aires', true),
      (${hiddenEventId}, ${empresaId}, 'Oculto', NULL, NULL, 'unica', NULL, true, 'scheduled', 'hidden', '2099-05-20 23:00:00'::timestamp, 'America/Argentina/Buenos_Aires', true),
      (${liveEventId}, ${empresaId}, 'Ya publicado', NULL, NULL, 'unica', NULL, true, 'immediate', 'listado_solo', NULL, NULL, true)
  `

  await prisma.$executeRaw`
    INSERT INTO evento_fechas (id, evento_id, fecha) VALUES
      ('phase-sched-fecha-1', ${listedEventId}, '2099-05-21 03:00:00'::timestamp),
      ('phase-sched-fecha-2', ${detailVisibleEventId}, '2099-05-21 03:00:00'::timestamp),
      ('phase-sched-fecha-3', ${hiddenEventId}, '2099-05-21 03:00:00'::timestamp),
      ('phase-sched-fecha-4', ${liveEventId}, '2026-05-21 03:00:00'::timestamp)
  `

  await prisma.$executeRaw`
    INSERT INTO entrada_categorias (id, evento_id, tanda_id, nombre, descripcion, precio, stock, stock_disponible, activa) VALUES
      ('phase-sched-cat-1', ${listedEventId}, NULL, 'General', NULL, 1000, 10, 10, true),
      ('phase-sched-cat-2', ${detailVisibleEventId}, NULL, 'General', NULL, 1000, 10, 10, true),
      ('phase-sched-cat-3', ${liveEventId}, NULL, 'General', NULL, 1000, 10, 10, true)
  `

  await prisma.$executeRaw`INSERT INTO barras (id, evento_id, empresa_id, nombre, activa) VALUES ('phase-sched-bar-1', ${liveEventId}, ${empresaId}, 'Barra Norte', true)`
  await prisma.$executeRaw`INSERT INTO consumibles (id, empresa_id, nombre, descripcion, precio, imagen_url, activo) VALUES ('phase-sched-con-1', ${empresaId}, 'Cerveza', NULL, 500, NULL, true)`
  await prisma.$executeRaw`INSERT INTO barra_stock (id, barra_id, consumible_id, stock_inicial, stock_actual, precio_override, activo) VALUES ('phase-sched-stock-1', 'phase-sched-bar-1', 'phase-sched-con-1', 10, 8, NULL, true)`

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const listResponse = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}/eventos`)
    assert.equal(listResponse.status, 200)
    assert.deepEqual(listResponse.data.data.eventos.map((evento: any) => evento.id).sort(), [listedEventId, detailVisibleEventId, liveEventId].sort())

    const listedDetail = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}/evento/${listedEventId}`)
    assert.equal(listedDetail.status, 404)

    const detailVisibleDetail = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}/evento/${detailVisibleEventId}`)
    assert.equal(detailVisibleDetail.status, 200)
    assert.equal(detailVisibleDetail.data.data.evento.publication_reason, 'scheduled_detail_visible')

    const hiddenDetail = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}/evento/${hiddenEventId}`)
    assert.equal(hiddenDetail.status, 404)

    const liveDetail = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}/evento/${liveEventId}`)
    assert.equal(liveDetail.status, 200)
    assert.equal(liveDetail.data.data.evento.publication_status, 'live')

    const listedConsumibles = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}/evento/${listedEventId}/consumibles`)
    assert.equal(listedConsumibles.status, 404)

    const detailVisibleConsumibles = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}/evento/${detailVisibleEventId}/consumibles`)
    assert.equal(detailVisibleConsumibles.status, 200)

    const liveConsumibles = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}/evento/${liveEventId}/consumibles`)
    assert.equal(liveConsumibles.status, 200)
    assert.equal(liveConsumibles.data.data.barras.length, 1)

    const buyerUser = {
      id: buyerId,
      email: buyerEmail,
      empresa_slug: slug,
      userType: 'comprador',
    }

    const checkoutResponse = await requestJson(
      'POST',
      `${server.baseUrl}/api/tenant/${slug}/checkout`,
      {
        items: [{ categoriaId: 'phase-sched-cat-2', eventoId: detailVisibleEventId, cantidad: 1 }],
      },
      buyerUser
    )
    assert.equal(checkoutResponse.status, 409)

    const consumiblesCheckoutResponse = await requestJson(
      'POST',
      `${server.baseUrl}/api/tenant/${slug}/consumibles/checkout`,
      {
        items: [{ barraId: 'phase-sched-bar-1', barraNombre: 'Barra Norte', consumibleId: 'phase-sched-con-1', nombre: 'Cerveza', precio: 500, cantidad: 1, eventoId: listedEventId, eventoNombre: 'Listado solo' }],
      },
      buyerUser
    )
    assert.equal(consumiblesCheckoutResponse.status, 409)
  } finally {
    await server.close()
  }
})
