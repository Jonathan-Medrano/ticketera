import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import bcrypt from 'bcryptjs'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

let pool: typeof import('./db').default
let authRouter: typeof import('./routes/auth').default
let equipoRouter: typeof import('./routes/equipo').default
let configuracionRouter: typeof import('./routes/configuracion').default
let compradoresRouter: typeof import('./routes/compradores').default
let tenantRouter: typeof import('./routes/tenant').default

async function createTestServer(app: express.Express) {
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })

  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    },
  }
}

function buildHeaders(user?: Record<string, unknown> | null) {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
    ...(user ? { 'x-user': JSON.stringify(user) } : {}),
  }
}

async function requestJson(method: string, url: string, body?: unknown, user?: Record<string, unknown> | null) {
  const response = await fetch(url, {
    method,
    headers: buildHeaders(user),
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  return { status: response.status, data: await response.json().catch(() => null) as any }
}

before(async () => {
  pool = (await import('./db')).default
  ;({ default: authRouter } = await import('./routes/auth'))
  ;({ default: equipoRouter } = await import('./routes/equipo'))
  ;({ default: configuracionRouter } = await import('./routes/configuracion'))
  ;({ default: compradoresRouter } = await import('./routes/compradores'))
  ;({ default: tenantRouter } = await import('./routes/tenant'))
})

beforeEach(async () => {
  await pool.query('DELETE FROM compradores')
  await pool.query('DELETE FROM usuarios')
  await pool.query('DELETE FROM empresas')

  await pool.query(
    `INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
     VALUES (?, ?, ?, ?, ?, ?, true)`,
    ['policy-emp-1', 'Empresa Policy', 'empresa-policy', 'owner@policy.test', await bcrypt.hash('OwnerSegura12!', 12), 'Owner']
  )

  await pool.query(
    `INSERT INTO compradores (id, empresa_id, nombre, email, dni, password)
     VALUES (?, ?, ?, ?, ?, ?)`,
    ['policy-cmp-1', 'policy-emp-1', 'Buyer Demo', 'buyer@policy.test', '30111222', await bcrypt.hash('BuyerSegura12!', 12)]
  )
})

after(async () => {
  await pool.end()
})

test('public empresa signup rejects weak passwords with canonical error shape', async () => {
  const app = express()
  app.use(express.json())
  app.use('/auth', authRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson('POST', `${server.baseUrl}/auth/registro`, {
      nombre: 'Nueva Empresa',
      slug: 'nueva-empresa-policy',
      email: 'new@policy.test',
      password: 'corta',
      admin_nombre: 'Nueva',
    })

    assert.equal(response.status, 400)
    assert.equal(response.data.error, 'La contraseña debe cumplir la política de seguridad')
    assert.equal(response.data.code, 'password_policy_failed')
  } finally {
    await server.close()
  }
})

test('buyer self-registration rejects weak passwords with canonical error shape', async () => {
  const app = express()
  app.use(express.json())
  app.use('/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson('POST', `${server.baseUrl}/tenant/empresa-policy/registro`, {
      nombre: 'Buyer',
      apellido: 'Weak',
      email: 'buyer-weak@policy.test',
      dni: '33888999',
      password: '12345678',
    })

    assert.equal(response.status, 400)
    assert.equal(response.data.error, 'La contraseña debe cumplir la política de seguridad')
    assert.equal(response.data.code, 'password_policy_failed')
  } finally {
    await server.close()
  }
})

test('admin buyer password reset now rejects weak passwords', async () => {
  const app = express()
  app.use(express.json())
  app.use('/compradores', compradoresRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      'PUT',
      `${server.baseUrl}/compradores/policy-cmp-1/password`,
      { nuevaPassword: '123456' },
      { id: 'policy-emp-1', userType: 'empresa', slug: 'empresa-policy' }
    )

    assert.equal(response.status, 400)
    assert.equal(response.data.code, 'password_policy_failed')
  } finally {
    await server.close()
  }
})

test('temporary employee passwords are flagged and forced change clears the flag', async () => {
  const app = express()
  app.use(express.json())
  app.use('/equipo', equipoRouter)
  app.use('/configuracion', configuracionRouter)
  const server = await createTestServer(app)

  try {
    const createResponse = await requestJson(
      'POST',
      `${server.baseUrl}/equipo`,
      {
        nombre: 'Empleado',
        apellido: 'Temporal',
        email: 'empleado-temp@policy.test',
        password: 'temp123',
        rol: 'puerta',
        temporaryPassword: true,
      },
      { id: 'policy-emp-1', userType: 'empresa', slug: 'empresa-policy' }
    )

    assert.equal(createResponse.status, 201)

    const [createdRows] = await pool.query<any[]>(
      'SELECT id, must_change_password, temporary_password_set_at FROM usuarios WHERE email = ?',
      ['empleado-temp@policy.test']
    )

    assert.equal(createdRows[0].must_change_password, true)
    assert.notEqual(createdRows[0].temporary_password_set_at, null)

    const rotateResponse = await requestJson(
      'PATCH',
      `${server.baseUrl}/configuracion/password`,
      {
        passwordActual: 'temp123',
        nuevaPassword: 'NuevaSegura12!',
        confirmarPassword: 'NuevaSegura12!',
      },
      { id: createdRows[0].id, userType: 'empleado', empresa_id: 'policy-emp-1', empresa_slug: 'empresa-policy' }
    )

    assert.equal(rotateResponse.status, 200)

    const [updatedRows] = await pool.query<any[]>(
      'SELECT password, must_change_password, temporary_password_set_at FROM usuarios WHERE id = ?',
      [createdRows[0].id]
    )

    assert.equal(await bcrypt.compare('NuevaSegura12!', updatedRows[0].password), true)
    assert.equal(updatedRows[0].must_change_password, false)
    assert.equal(updatedRows[0].temporary_password_set_at, null)
  } finally {
    await server.close()
  }
})
