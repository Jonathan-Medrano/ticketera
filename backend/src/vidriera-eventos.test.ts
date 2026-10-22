import './test-env'

import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { prisma } from './lib/prisma'
import vidrieraRouter from './routes/vidriera'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

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

async function requestJson(method: 'GET', url: string, user: Record<string, unknown> | null = null) {
  const response = await originalFetch(url, { method, headers: buildHeaders(user) })
  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

type EmpresaFlags = {
  activa?: boolean
  aprobada?: boolean
  es_prueba?: boolean
  suspendido?: boolean
  tenant_public_disabled?: boolean
  email_verificado?: boolean
  vidriera_disabled?: boolean
}

async function seedEmpresa(empresaId: string, slug: string, flags: EmpresaFlags = {}) {
  const {
    activa = true,
    aprobada = true,
    es_prueba = false,
    suspendido = false,
    tenant_public_disabled = false,
    email_verificado = true,
    vidriera_disabled = false,
  } = flags

  await prisma.$executeRaw`
    INSERT INTO empresas (id, nombre, slug, email, admin_nombre, activa, aprobada, es_prueba, suspendido, tenant_public_disabled, email_verificado, vidriera_disabled)
    VALUES (${empresaId}, ${`Empresa ${slug}`}, ${slug}, ${`${slug}@example.com`}, 'Admin', ${activa}, ${aprobada}, ${es_prueba}, ${suspendido}, ${tenant_public_disabled}, ${email_verificado}, ${vidriera_disabled})
  `
}

async function seedEvento(
  eventoId: string,
  empresaId: string,
  fechaFutura: Date,
  overrides: Partial<{
    activo: boolean
    publication_mode: string
    pre_publish_visibility: string
    publish_at_utc: Date | null
    ciudad: string | null
  }> = {},
) {
  const {
    activo = true,
    publication_mode = 'immediate',
    pre_publish_visibility = 'hidden',
    publish_at_utc = null,
    ciudad = null,
  } = overrides

  await prisma.$executeRaw`
    INSERT INTO eventos (id, empresa_id, nombre, activo, publication_mode, pre_publish_visibility, publish_at_utc, ciudad)
    VALUES (${eventoId}, ${empresaId}, ${`Evento ${eventoId}`}, ${activo}, ${publication_mode}, ${pre_publish_visibility}, ${publish_at_utc}, ${ciudad})
  `
  await prisma.$executeRaw`
    INSERT INTO evento_fechas (id, evento_id, fecha)
    VALUES (${`${eventoId}-fecha`}, ${eventoId}, ${fechaFutura})
  `
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM evento_fechas WHERE evento_id ILIKE 'vidriera-test-evt-%'`
  await prisma.$executeRaw`DELETE FROM eventos WHERE id ILIKE 'vidriera-test-evt-%' OR empresa_id ILIKE 'vidriera-test-emp-%'`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'vidriera-test-emp-%' OR slug ILIKE 'vidriera-test-%'`
}

beforeEach(async () => {
  await cleanup()
})

after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/vidriera', vidrieraRouter)
  return app
}

const futureDate = () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
const pastDate = () => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

test('vidriera lists an eligible empresa event and includes its empresa_slug', async () => {
  const empresaId = 'vidriera-test-emp-1'
  const slug = 'vidriera-test-1'
  const eventoId = 'vidriera-test-evt-live'

  await seedEmpresa(empresaId, slug)
  await seedEvento(eventoId, empresaId, futureDate(), { activo: true, publication_mode: 'immediate' })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const res = await requestJson('GET', `${server.baseUrl}/api/vidriera/eventos`, null)
    assert.equal(res.status, 200)
    const ids = res.data.data.eventos.map((e: any) => e.id)
    assert.ok(ids.includes(eventoId))
    const evento = res.data.data.eventos.find((e: any) => e.id === eventoId)
    assert.equal(evento.empresa_slug, slug)
    assert.equal(evento.is_listed, true)
  } finally {
    await server.close()
  }
})

test('vidriera excludes empresas that are suspendida, es_prueba, tenant_public_disabled, no aprobada, email sin verificar o vidriera_disabled', async () => {
  // codigo corto porque empresas.id es VarChar(36) -- concatenar el slug entero lo pasaba de largo
  const cases: Array<[string, string, EmpresaFlags]> = [
    ['susp', 'vidriera-test-1-susp', { suspendido: true }],
    ['demo', 'vidriera-test-1-demo', { es_prueba: true }],
    ['off', 'vidriera-test-1-off', { tenant_public_disabled: true }],
    ['noap', 'vidriera-test-1-noap', { aprobada: false }],
    ['noverif', 'vidriera-test-1-noverif', { email_verificado: false }],
    ['vidoff', 'vidriera-test-1-vidoff', { vidriera_disabled: true }],
  ]

  for (const [code, slug, flags] of cases) {
    const empresaId = `vidriera-test-emp-${code}`
    const eventoId = `vidriera-test-evt-${code}`
    await seedEmpresa(empresaId, slug, flags)
    await seedEvento(eventoId, empresaId, futureDate())
  }

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const res = await requestJson('GET', `${server.baseUrl}/api/vidriera/eventos`, null)
    assert.equal(res.status, 200)
    const ids = res.data.data.eventos.map((e: any) => e.id)
    for (const [code] of cases) {
      assert.ok(!ids.includes(`vidriera-test-evt-${code}`), `empresa ${code} no debería listar eventos`)
    }
  } finally {
    await server.close()
  }
})

test('vidriera excludes hidden/scheduled events and events with a past date', async () => {
  const empresaId = 'vidriera-test-emp-2'
  const slug = 'vidriera-test-2'
  const hiddenEventId = 'vidriera-test-evt-hidden'
  const pastEventId = 'vidriera-test-evt-past'

  await seedEmpresa(empresaId, slug)
  await seedEvento(hiddenEventId, empresaId, futureDate(), {
    publication_mode: 'scheduled',
    pre_publish_visibility: 'hidden',
    publish_at_utc: futureDate(),
  })
  await seedEvento(pastEventId, empresaId, pastDate())

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const res = await requestJson('GET', `${server.baseUrl}/api/vidriera/eventos`, null)
    assert.equal(res.status, 200)
    const ids = res.data.data.eventos.map((e: any) => e.id)
    assert.ok(!ids.includes(hiddenEventId))
    assert.ok(!ids.includes(pastEventId))
  } finally {
    await server.close()
  }
})

test('vidriera does not let hidden events near the top of the date order crowd out a visible one under ?limit', async () => {
  const empresaId = 'vidriera-test-emp-3'
  const slug = 'vidriera-test-3'
  const hiddenNearEventId1 = 'vidriera-test-evt-hidnear1'
  const hiddenNearEventId2 = 'vidriera-test-evt-hidnear2'
  const visibleFarEventId = 'vidriera-test-evt-visfar'

  await seedEmpresa(empresaId, slug)
  // Dos eventos ocultos con fecha MÁS CERCANA que el visible: si el LIMIT del SQL
  // se aplicara antes del filtro is_listed, estos dos le comerían el lugar al visible.
  await seedEvento(hiddenNearEventId1, empresaId, new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), {
    publication_mode: 'scheduled',
    pre_publish_visibility: 'hidden',
    publish_at_utc: futureDate(),
  })
  await seedEvento(hiddenNearEventId2, empresaId, new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), {
    publication_mode: 'scheduled',
    pre_publish_visibility: 'hidden',
    publish_at_utc: futureDate(),
  })
  await seedEvento(visibleFarEventId, empresaId, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const res = await requestJson('GET', `${server.baseUrl}/api/vidriera/eventos?limit=2`, null)
    assert.equal(res.status, 200)
    const ids = res.data.data.eventos.map((e: any) => e.id)
    assert.ok(ids.includes(visibleFarEventId), 'el evento visible no debería desaparecer detrás de ocultos más próximos en fecha')
    assert.ok(!ids.includes(hiddenNearEventId1))
    assert.ok(!ids.includes(hiddenNearEventId2))
  } finally {
    await server.close()
  }
})

test('vidriera aggregates events across multiple empresas ordered by proxima_fecha ascending', async () => {
  const empresaAId = 'vidriera-test-emp-a'
  const empresaBId = 'vidriera-test-emp-b'
  const slugA = 'vidriera-test-a'
  const slugB = 'vidriera-test-b'
  const eventoLejosId = 'vidriera-test-evt-lejos'
  const eventoCercaId = 'vidriera-test-evt-cerca'

  await seedEmpresa(empresaAId, slugA)
  await seedEmpresa(empresaBId, slugB)
  await seedEvento(eventoLejosId, empresaAId, new Date(Date.now() + 20 * 24 * 60 * 60 * 1000))
  await seedEvento(eventoCercaId, empresaBId, new Date(Date.now() + 2 * 24 * 60 * 60 * 1000))

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const res = await requestJson('GET', `${server.baseUrl}/api/vidriera/eventos`, null)
    assert.equal(res.status, 200)
    const eventos = res.data.data.eventos.filter((e: any) => [eventoLejosId, eventoCercaId].includes(e.id))
    assert.equal(eventos.length, 2)
    assert.equal(eventos[0].id, eventoCercaId)
    assert.equal(eventos[1].id, eventoLejosId)
    assert.equal(eventos[0].empresa_slug, slugB)
    assert.equal(eventos[1].empresa_slug, slugA)
  } finally {
    await server.close()
  }
})

test('vidriera passes through ciudad for filtering client-side', async () => {
  const empresaId = 'vidriera-test-emp-4'
  const slug = 'vidriera-test-4'
  const eventoId = 'vidriera-test-evt-ciudad'

  await seedEmpresa(empresaId, slug)
  await seedEvento(eventoId, empresaId, futureDate(), { ciudad: 'Córdoba' })

  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const res = await requestJson('GET', `${server.baseUrl}/api/vidriera/eventos`, null)
    assert.equal(res.status, 200)
    const evento = res.data.data.eventos.find((e: any) => e.id === eventoId)
    assert.ok(evento, 'el evento con ciudad debería aparecer')
    assert.equal(evento.ciudad, 'Córdoba')
  } finally {
    await server.close()
  }
})

test('vidriera responds without a user session (fully public)', async () => {
  const app = buildApp()
  const server = await createTestServer(app)
  try {
    const res = await requestJson('GET', `${server.baseUrl}/api/vidriera/eventos`, null)
    assert.equal(res.status, 200)
    assert.ok(Array.isArray(res.data.data.eventos))
  } finally {
    await server.close()
  }
})
