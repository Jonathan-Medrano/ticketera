import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { prisma } from './lib/prisma'
import eventosRouter from './routes/eventos'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch

function buildHeaders(user: Record<string, unknown>) {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
    'x-user': JSON.stringify(user),
  }
}

function buildEmpresaUser(empresaId: string) {
  return { id: empresaId, email: `${empresaId}@example.com`, userType: 'empresa' as const }
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

async function requestDelete(url: string, user: Record<string, unknown>) {
  const response = await originalFetch(url, { method: 'DELETE', headers: buildHeaders(user) })
  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function seedEmpresa(empresaId: string) {
  await prisma.$executeRaw`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES (${empresaId}, ${`Empresa ${empresaId}`}, ${empresaId}, ${`${empresaId}@example.com`}, ${TEST_PASSWORD_HASH}, 'Admin', true)
  `
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM checkout_sessions WHERE id ILIKE 'evtdel-%' OR empresa_id ILIKE 'evtdel-%'`
  await prisma.$executeRaw`DELETE FROM entradas WHERE id ILIKE 'evtdel-%' OR evento_id ILIKE 'evtdel-%'`
  await prisma.$executeRaw`DELETE FROM compradores WHERE id ILIKE 'evtdel-%' OR empresa_id ILIKE 'evtdel-%'`
  await prisma.$executeRaw`DELETE FROM entrada_categorias WHERE id ILIKE 'evtdel-%' OR evento_id ILIKE 'evtdel-%'`
  await prisma.$executeRaw`DELETE FROM evento_tandas WHERE id ILIKE 'evtdel-%' OR evento_id ILIKE 'evtdel-%'`
  await prisma.$executeRaw`DELETE FROM evento_fechas WHERE id ILIKE 'evtdel-%' OR evento_id ILIKE 'evtdel-%'`
  await prisma.$executeRaw`DELETE FROM eventos WHERE id ILIKE 'evtdel-%' OR empresa_id ILIKE 'evtdel-%'`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'evtdel-%' OR slug ILIKE 'evtdel-%'`
}

beforeEach(async () => {
  await cleanup()
})

after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

test('DELETE /eventos/:id borra el evento y sus tablas de config cuando no tiene ventas', async () => {
  const empresaId = 'evtdel-emp-1'
  const eventoId = 'evtdel-evt-1'
  const categoriaId = 'evtdel-cat-1'
  await seedEmpresa(empresaId)
  await prisma.$executeRaw`INSERT INTO eventos (id, empresa_id, nombre, modo_fecha, activo) VALUES (${eventoId}, ${empresaId}, 'Evento sin ventas', 'unica', true)`
  await prisma.$executeRaw`INSERT INTO entrada_categorias (id, evento_id, nombre) VALUES (${categoriaId}, ${eventoId}, 'General')`

  const app = express()
  app.use('/api/eventos', eventosRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestDelete(`${server.baseUrl}/api/eventos/${eventoId}`, buildEmpresaUser(empresaId))
    assert.equal(response.status, 200)
    assert.equal(response.data.ok, true)

    const eventoRows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM eventos WHERE id = ${eventoId}`
    assert.equal(eventoRows.length, 0)

    const categoriaRows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM entrada_categorias WHERE id = ${categoriaId}`
    assert.equal(categoriaRows.length, 0)
  } finally {
    await server.close()
  }
})

test('DELETE /eventos/:id se bloquea (400) cuando el evento ya tiene entradas emitidas', async () => {
  const empresaId = 'evtdel-emp-2'
  const eventoId = 'evtdel-evt-2'
  const categoriaId = 'evtdel-cat-2'
  const compradorId = 'evtdel-comp-2'
  await seedEmpresa(empresaId)
  await prisma.$executeRaw`INSERT INTO eventos (id, empresa_id, nombre, modo_fecha, activo) VALUES (${eventoId}, ${empresaId}, 'Evento con ventas', 'unica', true)`
  await prisma.$executeRaw`INSERT INTO entrada_categorias (id, evento_id, nombre) VALUES (${categoriaId}, ${eventoId}, 'General')`
  await prisma.$executeRaw`INSERT INTO compradores (id, empresa_id, nombre, email) VALUES (${compradorId}, ${empresaId}, 'Comprador Test', 'comprador@example.com')`
  await prisma.$executeRaw`
    INSERT INTO entradas (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado)
    VALUES ('evtdel-ent-2', ${eventoId}, ${categoriaId}, ${compradorId}, 'evtdel-qr-2', 'EVTDEL2', 'valida')
  `

  const app = express()
  app.use('/api/eventos', eventosRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestDelete(`${server.baseUrl}/api/eventos/${eventoId}`, buildEmpresaUser(empresaId))
    assert.equal(response.status, 400)
    assert.match(response.data.error, /ventas asociadas/)

    const eventoRows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM eventos WHERE id = ${eventoId}`
    assert.equal(eventoRows.length, 1)
  } finally {
    await server.close()
  }
})

test('DELETE /eventos/:id devuelve 404 si el evento no existe o es de otra empresa', async () => {
  const empresaId = 'evtdel-emp-3'
  const otraEmpresaId = 'evtdel-emp-4'
  const eventoId = 'evtdel-evt-3'
  await seedEmpresa(empresaId)
  await seedEmpresa(otraEmpresaId)
  await prisma.$executeRaw`INSERT INTO eventos (id, empresa_id, nombre, modo_fecha, activo) VALUES (${eventoId}, ${empresaId}, 'Evento ajeno', 'unica', true)`

  const app = express()
  app.use('/api/eventos', eventosRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestDelete(`${server.baseUrl}/api/eventos/${eventoId}`, buildEmpresaUser(otraEmpresaId))
    assert.equal(response.status, 404)
  } finally {
    await server.close()
  }
})

test('DELETE /eventos/:id se bloquea (409) cuando hay un checkout_session activa (pago en curso) sin ventas confirmadas todavía', async () => {
  const empresaId = 'evtdel-emp-5'
  const eventoId = 'evtdel-evt-5'
  const categoriaId = 'evtdel-cat-5'
  const compradorId = 'evtdel-comp-5'
  await seedEmpresa(empresaId)
  await prisma.$executeRaw`INSERT INTO eventos (id, empresa_id, nombre, modo_fecha, activo) VALUES (${eventoId}, ${empresaId}, 'Evento con pago en curso', 'unica', true)`
  await prisma.$executeRaw`INSERT INTO entrada_categorias (id, evento_id, nombre) VALUES (${categoriaId}, ${eventoId}, 'General')`
  await prisma.$executeRaw`INSERT INTO compradores (id, empresa_id, nombre, email) VALUES (${compradorId}, ${empresaId}, 'Comprador Test', 'evtdel-comp-5@example.com')`

  // Checkout todavía no confirmado ni expirado — el comprador está en Mercado Pago
  // en este instante. No hay filas en `entradas` (ninguna venta confirmada), así que
  // el chequeo de "ventas asociadas" no lo detecta por sí solo.
  const datos = JSON.stringify({
    flow: 'entradas',
    items: [{ categoriaId, eventoId, eventoNombre: 'Evento con pago en curso', categoriaNombre: 'General', precio: 100, cantidad: 1 }],
    marketplaceFee: null,
  })
  await prisma.$executeRaw`
    INSERT INTO checkout_sessions (id, comprador_id, empresa_id, datos, estado, expires_at, created_at)
    VALUES ('evtdel-session-5', ${compradorId}, ${empresaId}, ${datos}, 'reservada', NOW() + INTERVAL '10 minutes', NOW())
  `

  const app = express()
  app.use('/api/eventos', eventosRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestDelete(`${server.baseUrl}/api/eventos/${eventoId}`, buildEmpresaUser(empresaId))
    assert.equal(response.status, 409)
    assert.match(response.data.error, /pagos en curso/)

    const eventoRows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM eventos WHERE id = ${eventoId}`
    assert.equal(eventoRows.length, 1)
  } finally {
    await server.close()
  }
})

test('DELETE /eventos/:id permite borrar cuando el checkout_session ya expiró (no cuenta como activa)', async () => {
  const empresaId = 'evtdel-emp-6'
  const eventoId = 'evtdel-evt-6'
  const categoriaId = 'evtdel-cat-6'
  const compradorId = 'evtdel-comp-6'
  await seedEmpresa(empresaId)
  await prisma.$executeRaw`INSERT INTO eventos (id, empresa_id, nombre, modo_fecha, activo) VALUES (${eventoId}, ${empresaId}, 'Evento con checkout expirado', 'unica', true)`
  await prisma.$executeRaw`INSERT INTO entrada_categorias (id, evento_id, nombre) VALUES (${categoriaId}, ${eventoId}, 'General')`
  await prisma.$executeRaw`INSERT INTO compradores (id, empresa_id, nombre, email) VALUES (${compradorId}, ${empresaId}, 'Comprador Test', 'evtdel-comp-6@example.com')`

  const datos = JSON.stringify({
    flow: 'entradas',
    items: [{ categoriaId, eventoId, eventoNombre: 'Evento con checkout expirado', categoriaNombre: 'General', precio: 100, cantidad: 1 }],
    marketplaceFee: null,
  })
  await prisma.$executeRaw`
    INSERT INTO checkout_sessions (id, comprador_id, empresa_id, datos, estado, expires_at, created_at)
    VALUES ('evtdel-session-6', ${compradorId}, ${empresaId}, ${datos}, 'reservada', NOW() - INTERVAL '10 minutes', NOW())
  `

  const app = express()
  app.use('/api/eventos', eventosRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestDelete(`${server.baseUrl}/api/eventos/${eventoId}`, buildEmpresaUser(empresaId))
    assert.equal(response.status, 200)
    assert.equal(response.data.ok, true)

    const eventoRows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM eventos WHERE id = ${eventoId}`
    assert.equal(eventoRows.length, 0)
  } finally {
    await server.close()
  }
})
