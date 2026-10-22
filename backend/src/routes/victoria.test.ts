import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { prisma } from '../lib/prisma'
import indexRouter from './index'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch

function buildHeaders(user: Record<string, unknown> | null) {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
    'x-user': JSON.stringify(user),
  }
}

function buildEmpresaUser(empresaId: string, email: string) {
  return { id: empresaId, email, userType: 'empresa' as const }
}

async function createTestServer(app: express.Express) {
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      }),
  }
}

async function postFeedback(url: string, user: Record<string, unknown> | null, body: unknown) {
  const response = await originalFetch(`${url}/api/victoria/feedback`, {
    method: 'POST',
    headers: buildHeaders(user),
    body: JSON.stringify(body),
  })
  const data = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function seedEmpresa(empresaId: string, slug: string) {
  await prisma.$executeRaw`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES (${empresaId}, ${`Empresa ${slug}`}, ${slug}, ${`${slug}@example.com`}, ${TEST_PASSWORD_HASH}, ${`Admin ${slug}`}, true)
  `
}

type TelRow = {
  empresa_id: string
  tipo: string
  query_text: string | null
  topic_id: string | null
  voto: string | null
  ruta: string | null
}

// El insert es fire-and-forget (la ruta responde 204 sin esperarlo). Poll corto
// hasta que la fila aparezca para mantener el test determinístico sin race.
async function waitForRows(empresaId: string, expected: number): Promise<TelRow[]> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const rows = await prisma.$queryRaw<TelRow[]>`
      SELECT empresa_id, tipo, query_text, topic_id, voto, ruta
      FROM victoria_telemetria WHERE empresa_id = ${empresaId}`
    if (rows.length >= expected) return rows
    await new Promise((r) => setTimeout(r, 20))
  }
  return prisma.$queryRaw<TelRow[]>`
    SELECT empresa_id, tipo, query_text, topic_id, voto, ruta
    FROM victoria_telemetria WHERE empresa_id = ${empresaId}`
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM victoria_telemetria WHERE empresa_id ILIKE 'vik-tel-emp-%'`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'vik-tel-emp-%' OR slug ILIKE 'vik-tel-%'`
}

beforeEach(cleanup)

after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

test('fallback inserta una fila tipo=fallback con texto truncado a 200 y empresa_id de la sesión', async () => {
  const empresaId = 'vik-tel-emp-1'
  await seedEmpresa(empresaId, 'vik-tel-1')

  const app = express()
  app.use(express.json())
  app.use('/api', indexRouter)
  const server = await createTestServer(app)

  try {
    const longQuery = 'a'.repeat(500)
    const res = await postFeedback(server.baseUrl, buildEmpresaUser(empresaId, 'vik-tel-1@example.com'), {
      tipo: 'fallback',
      query: longQuery,
      ruta: '/dashboard/eventos',
    })

    assert.equal(res.status, 204)

    const rows = await waitForRows(empresaId, 1)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].empresa_id, empresaId)
    assert.equal(rows[0].tipo, 'fallback')
    assert.equal(rows[0].query_text?.length, 200)
    assert.equal(rows[0].topic_id, null)
    assert.equal(rows[0].voto, null)
    assert.equal(rows[0].ruta, '/dashboard/eventos')
  } finally {
    await server.close()
  }
})

test('voto inserta una fila tipo=voto con topicId+voto y query_text null', async () => {
  const empresaId = 'vik-tel-emp-2'
  await seedEmpresa(empresaId, 'vik-tel-2')

  const app = express()
  app.use(express.json())
  app.use('/api', indexRouter)
  const server = await createTestServer(app)

  try {
    const res = await postFeedback(server.baseUrl, buildEmpresaUser(empresaId, 'vik-tel-2@example.com'), {
      tipo: 'voto',
      topicId: 'como-crear-evento',
      voto: 'up',
    })

    assert.equal(res.status, 204)

    const rows = await waitForRows(empresaId, 1)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].tipo, 'voto')
    assert.equal(rows[0].topic_id, 'como-crear-evento')
    assert.equal(rows[0].voto, 'up')
    assert.equal(rows[0].query_text, null)
  } finally {
    await server.close()
  }
})

test('payload inválido (tipo desconocido, voto fuera de enum) devuelve 400 sin escribir', async () => {
  const empresaId = 'vik-tel-emp-3'
  await seedEmpresa(empresaId, 'vik-tel-3')

  const app = express()
  app.use(express.json())
  app.use('/api', indexRouter)
  const server = await createTestServer(app)

  try {
    const user = buildEmpresaUser(empresaId, 'vik-tel-3@example.com')

    const unknownTipo = await postFeedback(server.baseUrl, user, { tipo: 'otra-cosa', query: 'hola' })
    assert.equal(unknownTipo.status, 400)

    const badVoto = await postFeedback(server.baseUrl, user, { tipo: 'voto', topicId: 'x', voto: 'maybe' })
    assert.equal(badVoto.status, 400)

    const emptyFallback = await postFeedback(server.baseUrl, user, { tipo: 'fallback', query: '   ' })
    assert.equal(emptyFallback.status, 400)

    // Pequeña espera para descartar inserts fire-and-forget tardíos antes de contar.
    await new Promise((r) => setTimeout(r, 100))
    const rows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM victoria_telemetria WHERE empresa_id = ${empresaId}`
    assert.equal(Number(rows[0].n), 0)
  } finally {
    await server.close()
  }
})

test('empresa_id se toma de la sesión, ignorando el del body (anti cross-tenant)', async () => {
  const empresaId = 'vik-tel-emp-4'
  const otraEmpresaId = 'vik-tel-emp-4-victima'
  await seedEmpresa(empresaId, 'vik-tel-4')
  await seedEmpresa(otraEmpresaId, 'vik-tel-4-victima')

  const app = express()
  app.use(express.json())
  app.use('/api', indexRouter)
  const server = await createTestServer(app)

  try {
    const res = await postFeedback(server.baseUrl, buildEmpresaUser(empresaId, 'vik-tel-4@example.com'), {
      tipo: 'fallback',
      query: 'vocabulario faltante',
      empresa_id: otraEmpresaId,
      empresaId: otraEmpresaId,
    })

    assert.equal(res.status, 204)

    const rows = await waitForRows(empresaId, 1)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].empresa_id, empresaId)

    const victima = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*)::bigint AS n FROM victoria_telemetria WHERE empresa_id = ${otraEmpresaId}`
    assert.equal(Number(victima[0].n), 0)
  } finally {
    await server.close()
  }
})
