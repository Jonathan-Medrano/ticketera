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

async function requestJson(url: string, user: Record<string, unknown>, body: unknown) {
  const response = await originalFetch(url, {
    method: 'PATCH',
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
    ON CONFLICT DO NOTHING`
}

async function seedEmpleado(userId: string, empresaId: string, email: string) {
  await prisma.$executeRaw`
    INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, activo, permisos)
    VALUES (${userId}, ${empresaId}, 'Empleado', 'Eventos', ${email}, ${TEST_PASSWORD_HASH}, 'operador', true, ${JSON.stringify({ ver_eventos: true, editar_eventos: true })})
    ON CONFLICT DO NOTHING`
}

async function seedEventoYCategoria(empresaId: string, eventoId: string, categoriaId: string) {
  await prisma.$executeRaw`
    INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo)
    VALUES (${eventoId}, ${empresaId}, ${`Evento ${eventoId}`}, NULL, NULL, 'unica', NULL, true)
    ON CONFLICT DO NOTHING`

  await prisma.$executeRaw`
    INSERT INTO entrada_categorias (id, evento_id, tanda_id, nombre, descripcion, precio, stock, stock_disponible, activa)
    VALUES (${categoriaId}, ${eventoId}, NULL, ${`Categoria ${categoriaId}`}, NULL, 1000, 10, 10, true)
    ON CONFLICT DO NOTHING`
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM entrada_categorias WHERE id ILIKE 'phase11-cat-%' OR evento_id ILIKE 'phase11-evt-%'`
  await prisma.$executeRaw`DELETE FROM evento_fechas WHERE evento_id ILIKE 'phase11-evt-%'`
  await prisma.$executeRaw`DELETE FROM evento_tandas WHERE evento_id ILIKE 'phase11-evt-%'`
  await prisma.$executeRaw`DELETE FROM eventos WHERE id ILIKE 'phase11-evt-%' OR empresa_id ILIKE 'phase11-emp-%'`
  await prisma.$executeRaw`DELETE FROM usuarios WHERE id ILIKE 'phase11-usr-%' OR empresa_id ILIKE 'phase11-emp-%'`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'phase11-emp-%' OR slug ILIKE 'phase11-%'`
}

beforeEach(async () => {
  await cleanup()
})

after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

test('event category stock mutation rejects negative and fractional increments', async () => {
  const empresaId = 'phase11-emp-1'
  const eventoId = 'phase11-evt-1'
  const categoriaId = 'phase11-cat-1'
  const empleadoId = 'phase11-usr-1'
  const email = 'phase11-usr-1@example.com'

  await seedEmpresa(empresaId, 'phase11-1')
  await seedEmpleado(empleadoId, empresaId, email)
  await seedEventoYCategoria(empresaId, eventoId, categoriaId)

  const app = express()
  app.use(express.json())
  app.use('/api/eventos', eventosRouter)
  const server = await createTestServer(app)

  try {
    const negative = await requestJson(
      `${server.baseUrl}/api/eventos/${eventoId}/categorias/${categoriaId}`,
      buildEmpleadoUser(empleadoId, empresaId, email),
      { accion: 'agregar_stock', cantidad: -5 }
    )
    assert.equal(negative.status, 400)

    const fractional = await requestJson(
      `${server.baseUrl}/api/eventos/${eventoId}/categorias/${categoriaId}`,
      buildEmpleadoUser(empleadoId, empresaId, email),
      { accion: 'agregar_stock', cantidad: 1.5 }
    )
    assert.equal(fractional.status, 400)
  } finally {
    await server.close()
  }
})

test('event category price mutation rejects zero, negative and absurd values', async () => {
  const empresaId = 'phase11-emp-2'
  const eventoId = 'phase11-evt-2'
  const categoriaId = 'phase11-cat-2'
  const empleadoId = 'phase11-usr-2'
  const email = 'phase11-usr-2@example.com'

  await seedEmpresa(empresaId, 'phase11-2')
  await seedEmpleado(empleadoId, empresaId, email)
  await seedEventoYCategoria(empresaId, eventoId, categoriaId)

  const app = express()
  app.use(express.json())
  app.use('/api/eventos', eventosRouter)
  const server = await createTestServer(app)

  try {
    const zero = await requestJson(
      `${server.baseUrl}/api/eventos/${eventoId}/categorias/${categoriaId}`,
      buildEmpleadoUser(empleadoId, empresaId, email),
      { accion: 'cambiar_precio', precio: 0 }
    )
    assert.equal(zero.status, 400)

    const negative = await requestJson(
      `${server.baseUrl}/api/eventos/${eventoId}/categorias/${categoriaId}`,
      buildEmpleadoUser(empleadoId, empresaId, email),
      { accion: 'cambiar_precio', precio: -100 }
    )
    assert.equal(negative.status, 400)

    const huge = await requestJson(
      `${server.baseUrl}/api/eventos/${eventoId}/categorias/${categoriaId}`,
      buildEmpleadoUser(empleadoId, empresaId, email),
      { accion: 'cambiar_precio', precio: 999999999 }
    )
    assert.equal(huge.status, 400)
  } finally {
    await server.close()
  }
})
