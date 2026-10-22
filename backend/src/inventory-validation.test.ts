import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { prismaDirectUrl as prisma } from './lib/prisma'
import consumiblesRouter from './routes/consumibles'
import barrasRouter from './routes/barras'
import promocionesRouter from './routes/promociones'
import venderRouter from './routes/vender'

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

function buildEmpleadoUser(userId: string, empresaId: string, email: string, permisos: Record<string, boolean> = { ver_consumibles: true, gestionar_consumibles: true }) {
  return {
    id: userId,
    email,
    empresa_id: empresaId,
    userType: 'empleado' as const,
    permisos,
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

async function requestJson(method: 'POST' | 'PUT', url: string, user: Record<string, unknown>, body: unknown) {
  const response = await originalFetch(url, {
    method,
    headers: buildHeaders(user),
    body: JSON.stringify(body),
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

async function seedEmpleado(userId: string, empresaId: string, email: string, permisos: Record<string, boolean> = { ver_consumibles: true, gestionar_consumibles: true }) {
  await prisma.$executeRaw`
    INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, activo, permisos)
    VALUES (${userId}, ${empresaId}, 'Empleado', 'Inventario', ${email}, ${TEST_PASSWORD_HASH}, 'operador', true, ${JSON.stringify(permisos)})
    ON CONFLICT DO NOTHING`
}

async function seedEvento(empresaId: string, eventoId: string) {
  await prisma.$executeRaw`
    INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo)
    VALUES (${eventoId}, ${empresaId}, ${`Evento ${eventoId}`}, NULL, NULL, 'unica', NULL, true)
    ON CONFLICT DO NOTHING`
}

async function seedConsumible(empresaId: string, consumibleId: string, precio = 1000) {
  await prisma.$executeRaw`
    INSERT INTO consumibles (id, empresa_id, nombre, descripcion, precio, imagen_url, activo)
    VALUES (${consumibleId}, ${empresaId}, ${`Consumible ${consumibleId}`}, NULL, ${precio}, NULL, true)
    ON CONFLICT DO NOTHING`
}

async function seedBarra(empresaId: string, eventoId: string, barraId: string) {
  await prisma.$executeRaw`
    INSERT INTO barras (id, evento_id, empresa_id, nombre, activa)
    VALUES (${barraId}, ${eventoId}, ${empresaId}, ${`Barra ${barraId}`}, true)
    ON CONFLICT DO NOTHING`
}

async function seedBarraStock(stockId: string, barraId: string, consumibleId: string, stock: number, opts: { ilimitado?: boolean; agotado?: boolean } = {}) {
  await prisma.$executeRaw`
    INSERT INTO barra_stock (id, barra_id, consumible_id, stock_inicial, stock_actual, precio_override, activo, stock_ilimitado, agotado)
    VALUES (${stockId}, ${barraId}, ${consumibleId}, ${stock}, ${stock}, NULL, true, ${opts.ilimitado ?? false}, ${opts.agotado ?? false})
    ON CONFLICT DO NOTHING`
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM consumibles_venta_items WHERE venta_id IN (SELECT id FROM consumibles_ventas WHERE empresa_id ILIKE 'phase12-emp-%')`
  await prisma.$executeRaw`DELETE FROM consumibles_ventas WHERE empresa_id ILIKE 'phase12-emp-%'`
  await prisma.$executeRaw`DELETE FROM consumibles_promociones WHERE id ILIKE 'phase12-promo-%' OR empresa_id ILIKE 'phase12-emp-%'`
  await prisma.$executeRaw`DELETE FROM barra_stock WHERE id ILIKE 'phase12-stock-%' OR barra_id ILIKE 'phase12-bar-%' OR consumible_id ILIKE 'phase12-con-%'`
  await prisma.$executeRaw`DELETE FROM barras WHERE id ILIKE 'phase12-bar-%' OR empresa_id ILIKE 'phase12-emp-%'`
  await prisma.$executeRaw`DELETE FROM consumibles WHERE id ILIKE 'phase12-con-%' OR empresa_id ILIKE 'phase12-emp-%'`
  await prisma.$executeRaw`DELETE FROM evento_fechas WHERE evento_id ILIKE 'phase12-evt-%'`
  await prisma.$executeRaw`DELETE FROM evento_tandas WHERE evento_id ILIKE 'phase12-evt-%'`
  await prisma.$executeRaw`DELETE FROM eventos WHERE id ILIKE 'phase12-evt-%' OR empresa_id ILIKE 'phase12-emp-%'`
  await prisma.$executeRaw`DELETE FROM usuarios WHERE id ILIKE 'phase12-usr-%' OR empresa_id ILIKE 'phase12-emp-%'`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'phase12-emp-%' OR slug ILIKE 'phase12-%'`
}

beforeEach(async () => {
  await cleanup()
})

after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

test('consumibles rejects invalid prices and barra assignment invalid stock/override', async () => {
  const empresaId = 'phase12-emp-1'
  const eventoId = 'phase12-evt-1'
  const consumibleId = 'phase12-con-1'
  const barraId = 'phase12-bar-1'
  const empleadoId = 'phase12-usr-1'
  const email = 'phase12-usr-1@example.com'

  await seedEmpresa(empresaId, 'phase12-1')
  await seedEmpleado(empleadoId, empresaId, email)
  await seedEvento(empresaId, eventoId)
  await seedConsumible(empresaId, consumibleId)
  await seedBarra(empresaId, eventoId, barraId)

  const app = express()
  app.use(express.json())
  app.use('/api/consumibles', consumiblesRouter)
  const server = await createTestServer(app)

  try {
    const invalidPrice = await requestJson('PUT', `${server.baseUrl}/api/consumibles/${consumibleId}`, buildEmpleadoUser(empleadoId, empresaId, email), { precio: 0 })
    assert.equal(invalidPrice.status, 400)

    const invalidAssignment = await requestJson('POST', `${server.baseUrl}/api/consumibles/${consumibleId}/barras/asignaciones`, buildEmpleadoUser(empleadoId, empresaId, email), {
      evento_id: eventoId,
      barra_ids: [barraId],
      stock_inicial: -1,
      precio_override: -10,
    })
    assert.equal(invalidAssignment.status, 400)
  } finally {
    await server.close()
  }
})

test('barras rejects invalid stock and override mutations', async () => {
  const empresaId = 'phase12-emp-2'
  const eventoId = 'phase12-evt-2'
  const consumibleId = 'phase12-con-2'
  const barraId = 'phase12-bar-2'
  const empleadoId = 'phase12-usr-2'
  const email = 'phase12-usr-2@example.com'

  await seedEmpresa(empresaId, 'phase12-2')
  await seedEmpleado(empleadoId, empresaId, email)
  await seedEvento(empresaId, eventoId)
  await seedConsumible(empresaId, consumibleId)
  await seedBarra(empresaId, eventoId, barraId)

  const app = express()
  app.use(express.json())
  app.use('/api/consumibles/barras', barrasRouter)
  const server = await createTestServer(app)

  try {
    const invalidUpsert = await requestJson('POST', `${server.baseUrl}/api/consumibles/barras/${barraId}/stock`, buildEmpleadoUser(empleadoId, empresaId, email), {
      consumible_id: consumibleId,
      stock_inicial: -5,
      precio_override: -1,
    })
    assert.equal(invalidUpsert.status, 400)

    await seedBarraStock('phase12-stock-2', barraId, consumibleId, 10)

    const invalidBulk = await requestJson('PUT', `${server.baseUrl}/api/consumibles/barras/${barraId}/stock`, buildEmpleadoUser(empleadoId, empresaId, email), {
      items: [{ consumible_id: consumibleId, stock_inicial: 5, stock_actual: 7, precio_override: -10 }],
    })
    assert.equal(invalidBulk.status, 400)
  } finally {
    await server.close()
  }
})

test('promociones rejects invalid value and minimum quantity', async () => {
  const empresaId = 'phase12-emp-3'
  const eventoId = 'phase12-evt-3'
  const consumibleId = 'phase12-con-3'
  const empleadoId = 'phase12-usr-3'
  const email = 'phase12-usr-3@example.com'

  await seedEmpresa(empresaId, 'phase12-3')
  await seedEmpleado(empleadoId, empresaId, email)
  await seedEvento(empresaId, eventoId)
  await seedConsumible(empresaId, consumibleId)

  const app = express()
  app.use(express.json())
  app.use('/api/consumibles/promociones', promocionesRouter)
  const server = await createTestServer(app)

  try {
    const invalidCreate = await requestJson('POST', `${server.baseUrl}/api/consumibles/promociones`, buildEmpleadoUser(empleadoId, empresaId, email), {
      nombre: 'Promo',
      tipo: 'porcentaje',
      valor: 0,
      consumible_ids: [consumibleId],
      cantidad_minima: 0,
      evento_id: eventoId,
    })
    assert.equal(invalidCreate.status, 400)

    await prisma.$executeRaw`
      INSERT INTO consumibles_promociones (id, empresa_id, evento_id, nombre, descripcion, tipo, valor, consumible_ids, cantidad_minima, activa)
      VALUES ('phase12-promo-3', ${empresaId}, ${eventoId}, 'Promo Base', NULL, 'porcentaje', 10, ${JSON.stringify([consumibleId])}, 1, true)
      ON CONFLICT DO NOTHING`

    const invalidUpdate = await requestJson('PUT', `${server.baseUrl}/api/consumibles/promociones/phase12-promo-3`, buildEmpleadoUser(empleadoId, empresaId, email), {
      valor: 999999999,
      cantidad_minima: -1,
    })
    assert.equal(invalidUpdate.status, 400)
  } finally {
    await server.close()
  }
})

test('promotions reject foreign event scope and selling ignores promo from another event', async () => {
  const empresaId = 'phase12-emp-4'
  const eventoA = 'phase12-evt-4a'
  const eventoB = 'phase12-evt-4b'
  const consumibleId = 'phase12-con-4'
  const barraId = 'phase12-bar-4'
  const empleadoId = 'phase12-usr-4'
  const email = 'phase12-usr-4@example.com'

  await seedEmpresa(empresaId, 'phase12-4')
  await seedEmpleado(empleadoId, empresaId, email, { ver_consumibles: true, gestionar_consumibles: true, vender_consumibles: true })
  await seedEvento(empresaId, eventoA)
  await seedEvento(empresaId, eventoB)
  await seedConsumible(empresaId, consumibleId)
  await seedBarra(empresaId, eventoA, barraId)
  await seedBarraStock('phase12-stock-4', barraId, consumibleId, 20)

  const app = express()
  app.use(express.json())
  app.use('/api/consumibles/promociones', promocionesRouter)
  app.use('/api/consumibles/vender', venderRouter)
  const server = await createTestServer(app)

  try {
    const invalidCreate = await requestJson('POST', `${server.baseUrl}/api/consumibles/promociones`, buildEmpleadoUser(empleadoId, empresaId, email), {
      nombre: 'Promo cruzada',
      tipo: 'porcentaje',
      valor: 10,
      consumible_ids: [consumibleId],
      cantidad_minima: 1,
      evento_id: 'evento-ajeno',
    })
    assert.equal(invalidCreate.status, 400)

    await prisma.$executeRaw`
      INSERT INTO consumibles_promociones (id, empresa_id, evento_id, nombre, descripcion, tipo, valor, consumible_ids, cantidad_minima, activa)
      VALUES ('phase12-promo-4', ${empresaId}, ${eventoB}, 'Promo Evento B', NULL, 'porcentaje', 50, ${JSON.stringify([consumibleId])}, 1, true)
      ON CONFLICT DO NOTHING`

    const ventaRes = await requestJson('POST', `${server.baseUrl}/api/consumibles/vender`, buildEmpleadoUser(empleadoId, empresaId, email, { ver_consumibles: true, vender_consumibles: true }), {
      barra_id: barraId,
      evento_id: eventoA,
      promocion_id: 'phase12-promo-4',
      items: [{ consumible_id: consumibleId, cantidad: 1 }],
    })

    assert.equal(ventaRes.status, 200)
    assert.equal(ventaRes.data.descuento ?? 0, 0)
  } finally {
    await server.close()
  }
})

test('porcentaje promo only discounts the consumibles listed in consumible_ids, not the whole cart', async () => {
  const empresaId = 'phase12-emp-5'
  const eventoId = 'phase12-evt-5'
  const consumibleConPromo = 'phase12-con-5a'
  const consumibleSinPromo = 'phase12-con-5b'
  const barraId = 'phase12-bar-5'
  const empleadoId = 'phase12-usr-5'
  const email = 'phase12-usr-5@example.com'

  await seedEmpresa(empresaId, 'phase12-5')
  await seedEmpleado(empleadoId, empresaId, email, { ver_consumibles: true, vender_consumibles: true })
  await seedEvento(empresaId, eventoId)
  await seedConsumible(empresaId, consumibleConPromo, 1000) // elegible para la promo
  await seedConsumible(empresaId, consumibleSinPromo, 500) // NO elegible
  await seedBarra(empresaId, eventoId, barraId)
  await seedBarraStock('phase12-stock-5a', barraId, consumibleConPromo, 20)
  await seedBarraStock('phase12-stock-5b', barraId, consumibleSinPromo, 20)

  // Promo 50% que aplica SOLO al consumible elegible.
  await prisma.$executeRaw`
    INSERT INTO consumibles_promociones (id, empresa_id, evento_id, nombre, descripcion, tipo, valor, consumible_ids, cantidad_minima, activa)
    VALUES ('phase12-promo-5', ${empresaId}, ${eventoId}, 'Promo solo cerveza', NULL, 'porcentaje', 50, ${JSON.stringify([consumibleConPromo])}, 1, true)
    ON CONFLICT DO NOTHING`

  const app = express()
  app.use(express.json())
  app.use('/api/consumibles/vender', venderRouter)
  const server = await createTestServer(app)

  try {
    const ventaRes = await requestJson('POST', `${server.baseUrl}/api/consumibles/vender`, buildEmpleadoUser(empleadoId, empresaId, email, { ver_consumibles: true, vender_consumibles: true }), {
      barra_id: barraId,
      evento_id: eventoId,
      promocion_id: 'phase12-promo-5',
      items: [
        { consumible_id: consumibleConPromo, cantidad: 1 }, // 1000
        { consumible_id: consumibleSinPromo, cantidad: 1 }, // 500
      ],
    })

    assert.equal(ventaRes.status, 200)
    // subtotal bruto = 1500. El 50% aplica SOLO al ítem elegible (1000) → descuento 500.
    // total = 1500 - 500 = 1000. (El bug aplicaba 50% sobre 1500 → total 750.)
    assert.equal(ventaRes.data.total, 1000)
  } finally {
    await server.close()
  }
})

test('stock_ilimitado vende sin validar ni descontar stock', async () => {
  const empresaId = 'phase12-emp-6'
  const eventoId = 'phase12-evt-6'
  const consumibleId = 'phase12-con-6'
  const barraId = 'phase12-bar-6'
  const empleadoId = 'phase12-usr-6'
  const email = 'phase12-usr-6@example.com'

  await seedEmpresa(empresaId, 'phase12-6')
  await seedEmpleado(empleadoId, empresaId, email, { ver_consumibles: true, vender_consumibles: true })
  await seedEvento(empresaId, eventoId)
  await seedConsumible(empresaId, consumibleId, 1000)
  await seedBarra(empresaId, eventoId, barraId)
  // stock_actual=0 pero ilimitado → debe poder venderse igual, sin descontar.
  await seedBarraStock('phase12-stock-6', barraId, consumibleId, 0, { ilimitado: true })

  const app = express()
  app.use(express.json())
  app.use('/api/consumibles/vender', venderRouter)
  const server = await createTestServer(app)

  try {
    const ventaRes = await requestJson('POST', `${server.baseUrl}/api/consumibles/vender`, buildEmpleadoUser(empleadoId, empresaId, email, { ver_consumibles: true, vender_consumibles: true }), {
      barra_id: barraId,
      evento_id: eventoId,
      items: [{ consumible_id: consumibleId, cantidad: 5 }],
    })
    assert.equal(ventaRes.status, 200)
    assert.equal(ventaRes.data.total, 5000)

    // stock_actual NO se descontó (sigue en 0, no -5).
    const rows = await prisma.$queryRaw<{ stock_actual: number }[]>`SELECT stock_actual FROM barra_stock WHERE id = 'phase12-stock-6'`
    assert.equal(Number(rows[0].stock_actual), 0)
  } finally {
    await server.close()
  }
})

test('agotado bloquea la venta aunque haya stock', async () => {
  const empresaId = 'phase12-emp-7'
  const eventoId = 'phase12-evt-7'
  const consumibleId = 'phase12-con-7'
  const barraId = 'phase12-bar-7'
  const empleadoId = 'phase12-usr-7'
  const email = 'phase12-usr-7@example.com'

  await seedEmpresa(empresaId, 'phase12-7')
  await seedEmpleado(empleadoId, empresaId, email, { ver_consumibles: true, vender_consumibles: true })
  await seedEvento(empresaId, eventoId)
  await seedConsumible(empresaId, consumibleId, 1000)
  await seedBarra(empresaId, eventoId, barraId)
  // stock de sobra (50) pero marcado agotado → no se puede vender.
  await seedBarraStock('phase12-stock-7', barraId, consumibleId, 50, { agotado: true })

  const app = express()
  app.use(express.json())
  app.use('/api/consumibles/vender', venderRouter)
  const server = await createTestServer(app)

  try {
    const ventaRes = await requestJson('POST', `${server.baseUrl}/api/consumibles/vender`, buildEmpleadoUser(empleadoId, empresaId, email, { ver_consumibles: true, vender_consumibles: true }), {
      barra_id: barraId,
      evento_id: eventoId,
      items: [{ consumible_id: consumibleId, cantidad: 1 }],
    })
    assert.equal(ventaRes.status, 400)
    assert.match(String(ventaRes.data.error), /agotado/i)
  } finally {
    await server.close()
  }
})
