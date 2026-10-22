import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

import { prismaDirectUrl as prisma } from './lib/prisma'
import eventosRouter from './routes/eventos'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch

function buildHeaders(user: Record<string, unknown>) {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
    'x-user': JSON.stringify(user),
  }
}

function buildEmpleadoUser(userId: string, empresaId: string, email: string) {
  return {
    id: userId,
    email,
    empresa_id: empresaId,
    userType: 'empleado' as const,
    permisos: { ver_eventos: true, crear_eventos: true, editar_eventos: true, ver_precios_entradas: true },
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

async function requestJson(method: 'GET' | 'POST' | 'PATCH', url: string, user: Record<string, unknown>, body?: unknown) {
  const response = await originalFetch(url, {
    method,
    headers: buildHeaders(user),
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function seedEmpresa(empresaId: string, slug: string) {
  await prisma.$executeRaw`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES (${empresaId}, ${`Empresa ${slug}`}, ${slug}, ${`${slug}@example.com`}, ${TEST_PASSWORD_HASH}, ${`Admin ${slug}`}, true)
    ON CONFLICT DO NOTHING`

  await prisma.$executeRaw`UPDATE empresas SET buyer_event_refunds_enabled = true WHERE id = ${empresaId}`
}

async function seedEmpleado(userId: string, empresaId: string, email: string) {
  await prisma.$executeRaw`
    INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, activo, permisos)
    VALUES (${userId}, ${empresaId}, 'Empleado', 'Eventos', ${email}, ${TEST_PASSWORD_HASH}, 'operador', true, ${JSON.stringify({ ver_eventos: true, crear_eventos: true, editar_eventos: true, ver_precios_entradas: true })})
    ON CONFLICT DO NOTHING`
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM entrada_categorias WHERE evento_id ILIKE 'phase15-evt-%'`
  await prisma.$executeRaw`DELETE FROM evento_fechas WHERE evento_id ILIKE 'phase15-evt-%'`
  await prisma.$executeRaw`DELETE FROM evento_tandas WHERE evento_id ILIKE 'phase15-evt-%'`
  await prisma.$executeRaw`DELETE FROM eventos WHERE id ILIKE 'phase15-evt-%' OR empresa_id ILIKE 'phase15-emp-%'`
  await prisma.$executeRaw`DELETE FROM usuarios WHERE id ILIKE 'phase15-usr-%' OR empresa_id ILIKE 'phase15-emp-%'`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'phase15-emp-%' OR slug ILIKE 'phase15-%'`
}

beforeEach(async () => {
  await cleanup()
})

after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

test('event create and edit persist buyer refund flag when staff saves a refundable event', async () => {
  const empresaId = 'phase15-emp-1'
  const empleadoId = 'phase15-usr-1'
  const email = 'phase15-usr-1@example.com'
  const slug = 'phase15-1'

  await seedEmpresa(empresaId, slug)
  await seedEmpleado(empleadoId, empresaId, email)

  const app = express()
  app.use(express.json())
  app.use('/api/eventos', eventosRouter)
  const server = await createTestServer(app)

  try {
    const created = await requestJson('POST', `${server.baseUrl}/api/eventos`, buildEmpleadoUser(empleadoId, empresaId, email), {
      nombre: 'Evento Refundable',
      descripcion: 'QA refund flag',
      lugar: 'Teatro QA',
      modo_fecha: 'unica',
      buyer_event_refunds_enabled: true,
      fechas: [{ fecha: '2026-07-01T20:00' }],
      categorias: [{ id: 'phase15-cat-1', nombre: 'General', precio: 1500, stock: 50 }],
      tandas: [],
    })

    assert.equal(created.status, 201)
    assert.ok(created.data.id)

    const createdId = created.data.id as string
    const afterCreate = await requestJson('GET', `${server.baseUrl}/api/eventos/${createdId}`, buildEmpleadoUser(empleadoId, empresaId, email))
    assert.equal(afterCreate.status, 200)
    assert.equal(afterCreate.data.evento.buyer_event_refunds_enabled, 1)

    const edited = await requestJson('PATCH', `${server.baseUrl}/api/eventos/${createdId}`, buildEmpleadoUser(empleadoId, empresaId, email), {
      nombre: 'Evento Refundable Editado',
      descripcion: 'QA refund flag edit',
      lugar: 'Teatro QA 2',
      modo_fecha: 'unica',
      buyer_event_refunds_enabled: true,
      fechas: afterCreate.data.fechas.map((fecha: { id: string; fecha: string }) => ({ id: fecha.id, fecha: new Date(fecha.fecha).toISOString().slice(0, 16) })),
      categorias: afterCreate.data.categorias.map((categoria: { id: string; nombre: string; descripcion?: string | null; precio: number; stock: number; tanda_id?: string | null }) => ({
        id: categoria.id,
        nombre: categoria.nombre,
        descripcion: categoria.descripcion ?? '',
        precio: categoria.precio,
        stock: categoria.stock,
        tanda_id: categoria.tanda_id ?? '',
      })),
      tandas: [],
    })

    assert.equal(edited.status, 200, JSON.stringify(edited.data))

    const afterEdit = await requestJson('GET', `${server.baseUrl}/api/eventos/${createdId}`, buildEmpleadoUser(empleadoId, empresaId, email))
    assert.equal(afterEdit.status, 200)
    assert.equal(afterEdit.data.evento.nombre, 'Evento Refundable Editado')
    assert.equal(afterEdit.data.evento.buyer_event_refunds_enabled, 1)
  } finally {
    await server.close()
  }
})
