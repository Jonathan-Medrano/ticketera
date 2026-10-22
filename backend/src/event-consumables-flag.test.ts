import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { prismaDirectUrl as prisma } from './lib/prisma'
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

function buildEmpleadoUser(userId: string, empresaId: string, email: string) {
  return {
    id: userId,
    email,
    empresa_id: empresaId,
    userType: 'empleado' as const,
    permisos: { ver_eventos: true, editar_eventos: true },
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

async function requestJson(method: 'GET' | 'PATCH', url: string, user: Record<string, unknown>, body?: unknown) {
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
}

async function seedEmpleado(userId: string, empresaId: string, email: string) {
  await prisma.$executeRaw`
    INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, activo, permisos)
    VALUES (${userId}, ${empresaId}, 'Empleado', 'Eventos', ${email}, ${TEST_PASSWORD_HASH}, 'operador', true, ${JSON.stringify({ ver_eventos: true, editar_eventos: true })})
    ON CONFLICT DO NOTHING`
}

async function seedEvento(empresaId: string, eventoId: string) {
  await prisma.$executeRaw`
    INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo)
    VALUES (${eventoId}, ${empresaId}, ${`Evento ${eventoId}`}, NULL, NULL, 'unica', NULL, true)
    ON CONFLICT DO NOTHING`
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM entrada_categorias WHERE evento_id ILIKE 'phase14-evt-%'`
  await prisma.$executeRaw`DELETE FROM evento_fechas WHERE evento_id ILIKE 'phase14-evt-%'`
  await prisma.$executeRaw`DELETE FROM evento_tandas WHERE evento_id ILIKE 'phase14-evt-%'`
  await prisma.$executeRaw`DELETE FROM eventos WHERE id ILIKE 'phase14-evt-%' OR empresa_id ILIKE 'phase14-emp-%'`
  await prisma.$executeRaw`DELETE FROM usuarios WHERE id ILIKE 'phase14-usr-%' OR empresa_id ILIKE 'phase14-emp-%'`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'phase14-emp-%' OR slug ILIKE 'phase14-%'`
}

beforeEach(async () => {
  await cleanup()
})

after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

test('event detail exposes public consumables sale flag and toggle updates it', async () => {
  const empresaId = 'phase14-emp-1'
  const eventoId = 'phase14-evt-1'
  const empleadoId = 'phase14-usr-1'
  const email = 'phase14-usr-1@example.com'

  await seedEmpresa(empresaId, 'phase14-1')
  await seedEmpleado(empleadoId, empresaId, email)
  await seedEvento(empresaId, eventoId)

  const app = express()
  app.use(express.json())
  app.use('/api/eventos', eventosRouter)
  const server = await createTestServer(app)

  try {
    const before = await requestJson('GET', `${server.baseUrl}/api/eventos/${eventoId}`, buildEmpleadoUser(empleadoId, empresaId, email))
    assert.equal(before.status, 200)
    assert.equal(before.data.evento.venta_consumibles_habilitada, 0)

    const toggle = await requestJson('PATCH', `${server.baseUrl}/api/eventos/${eventoId}`, buildEmpleadoUser(empleadoId, empresaId, email), {
      accion: 'toggle_venta_consumibles_habilitada',
    })
    assert.equal(toggle.status, 200)

    const afterToggle = await requestJson('GET', `${server.baseUrl}/api/eventos/${eventoId}`, buildEmpleadoUser(empleadoId, empresaId, email))
    assert.equal(afterToggle.status, 200)
    assert.equal(afterToggle.data.evento.venta_consumibles_habilitada, 1)
  } finally {
    await server.close()
  }
})
