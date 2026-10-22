import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { Express } from 'express'
import express from 'express'
import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { prismaDirectUrl } from './lib/prisma'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'
process.env.RESEND_API_KEY = ''
process.env.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'

type RequestPasswordReset = typeof import('./lib/password-reset').requestPasswordReset
type ConsumePasswordReset = typeof import('./lib/password-reset').consumePasswordReset
type CreatePasswordResetRateLimit = typeof import('./lib/password-reset-rate-limit').createPasswordResetRateLimit

let requestPasswordReset: RequestPasswordReset
let consumePasswordReset: ConsumePasswordReset
let authRouter: typeof import('./routes/auth').default
let createPasswordResetRateLimit: CreatePasswordResetRateLimit

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'

before(async () => {
  ;({ requestPasswordReset, consumePasswordReset } = await import('./lib/password-reset'))
  ;({ createPasswordResetRateLimit } = await import('./lib/password-reset-rate-limit'))
  authRouter = (await import('./routes/auth')).default
})

beforeEach(async () => {
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM password_reset_tokens`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM compradores`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM usuarios`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresas`)

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES ('emp-1', 'Empresa Demo', 'empresa-demo', 'empresa@example.com', ${TEST_PASSWORD_HASH}, 'Admin Demo', true)
  `)

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    -- La tabla usuarios ya no tiene columna empresa_slug: el slug vive en
    -- empresas y se resuelve por join. El fixture la seguia insertando y
    -- fallaba con 42703 (column does not exist).
    INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, activo, must_change_password)
    VALUES ('usr-1', 'emp-1', 'Usuario', 'Equipo', 'equipo@example.com', ${TEST_PASSWORD_HASH}, 'admin', true, true)
  `)

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO compradores (id, empresa_id, nombre, email, dni, password)
    VALUES ('cmp-1', 'emp-1', 'Comprador Demo', 'comprador@example.com', '12345678', ${TEST_PASSWORD_HASH})
  `)
})

after(async () => {
  await prismaDirectUrl.$disconnect()
})

async function createTestServer(app: Express) {
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

async function postJson(url: string, body: unknown, extraHeaders: Record<string, string> = {}) {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-internal-secret': process.env.INTERNAL_API_SECRET!,
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  })

  const data = await response.json().catch(() => null)
  return { status: response.status, data }
}

test('returns public success for unknown empresa email without creating tokens', async () => {
  const app = express()
  app.use(express.json())
  app.use('/auth', authRouter)
  const server = await createTestServer(app)

  try {
    const result = await postJson(
      `${server.baseUrl}/auth/password/forgot`,
      { email: 'noexiste@example.com', actor: 'empresa' },
      { 'x-forwarded-for': '10.10.0.1', 'user-agent': 'test/anti-enum' }
    )

    assert.equal(result.status, 200)
    assert.deepEqual(result.data, { ok: true })

    const rows = await prismaDirectUrl.$queryRaw<any[]>(Prisma.sql`SELECT COUNT(*) as total FROM password_reset_tokens`)
    assert.equal(Number(rows[0].total), 0)
  } finally {
    await server.close()
  }
})

test('invalidates previous empresa token when requesting forgot twice', async () => {
  const first = await requestPasswordReset({
    actorType: 'empresa',
    email: 'empresa@example.com',
    requestIp: '10.10.0.2',
    requestUserAgent: 'test/empresa-first',
  })

  const second = await requestPasswordReset({
    actorType: 'empresa',
    email: 'empresa@example.com',
    requestIp: '10.10.0.2',
    requestUserAgent: 'test/empresa-second',
  })

  assert.equal(first.status, 200)
  assert.equal(second.status, 200)

  const rows = await prismaDirectUrl.$queryRaw<any[]>(Prisma.sql`
    SELECT invalidated_at, requested_user_agent
    FROM password_reset_tokens
    WHERE actor_type = 'empresa'
    ORDER BY requested_user_agent ASC
  `)

  assert.equal(rows.length, 2)
  assert.equal(rows[0].requested_user_agent, 'test/empresa-first')
  assert.notEqual(rows[0].invalidated_at, null)
  assert.equal(rows[1].requested_user_agent, 'test/empresa-second')
  assert.equal(rows[1].invalidated_at, null)
})

test('creates reset tokens for empleado and comprador with the correct actor type', async () => {
  const empleado = await requestPasswordReset({
    actorType: 'empleado',
    email: 'equipo@example.com',
    requestIp: '10.10.0.3',
    requestUserAgent: 'test/empleado',
  })

  const comprador = await requestPasswordReset({
    actorType: 'comprador',
    email: 'comprador@example.com',
    tenantSlug: 'empresa-demo',
    resetBaseUrl: 'https://empresa-demo.Ticketera.com',
    requestIp: '10.10.0.4',
    requestUserAgent: 'test/comprador',
  })

  assert.equal(empleado.status, 200)
  assert.equal(comprador.status, 200)

  const rows = await prismaDirectUrl.$queryRaw<any[]>(Prisma.sql`
    SELECT actor_type, tenant_slug, requested_ip
    FROM password_reset_tokens
    ORDER BY actor_type ASC
  `)

  assert.deepEqual(rows, [
    { actor_type: 'empleado', tenant_slug: 'empresa-demo', requested_ip: '10.10.0.3' },
    { actor_type: 'comprador', tenant_slug: 'empresa-demo', requested_ip: '10.10.0.4' },
  ])
})

test('internal password reset remains unambiguous because duplicated internal emails are not allowed', async () => {
  const empleado = await requestPasswordReset({
    actorType: 'empleado',
    email: 'equipo@example.com',
    requestIp: '10.10.0.11',
    requestUserAgent: 'test/empleado-unico',
  })

  const empresa = await requestPasswordReset({
    actorType: 'empresa',
    email: 'empresa@example.com',
    requestIp: '10.10.0.12',
    requestUserAgent: 'test/empresa-unica',
  })

  assert.equal(empleado.status, 200)
  assert.equal(empresa.status, 200)

  const rows = await prismaDirectUrl.$queryRaw<any[]>(Prisma.sql`
    SELECT actor_type, email, requested_ip
    FROM password_reset_tokens
    WHERE requested_ip IN ('10.10.0.11', '10.10.0.12')
    ORDER BY requested_ip ASC
  `)

  assert.deepEqual(rows, [
    { actor_type: 'empleado', email: 'equipo@example.com', requested_ip: '10.10.0.11' },
    { actor_type: 'empresa', email: 'empresa@example.com', requested_ip: '10.10.0.12' },
  ])
})

test('consumes a valid empresa token, updates password and records consume metadata', async () => {
  const token = 'token-valido-empresa'
  const tokenHash = (await import('node:crypto')).createHash('sha256').update(token).digest('hex')

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO password_reset_tokens
      (id, actor_type, actor_id, empresa_id, tenant_slug, email, token_hash, expires_at, requested_ip, requested_user_agent)
    VALUES ('token-1', 'empresa', 'emp-1', 'emp-1', 'empresa-demo', 'empresa@example.com', ${tokenHash}, NOW() + INTERVAL '15 minutes', '10.10.0.5', 'test/seed-valid')
  `)

  const result = await consumePasswordReset({
    actorType: 'empresa',
    token,
    nuevaPassword: 'NuevaClave123!',
    confirmarPassword: 'NuevaClave123!',
    consumedIp: '10.10.0.5',
    consumedUserAgent: 'test/reset-valid',
  })

  assert.equal(result.status, 200)
  assert.deepEqual(result.data, { ok: true })

  const empresaRows = await prismaDirectUrl.$queryRaw<any[]>(Prisma.sql`SELECT password FROM empresas WHERE id = 'emp-1'`)
  const passwordUpdated = await bcrypt.compare('NuevaClave123!', empresaRows[0].password)
  assert.equal(passwordUpdated, true)

  const tokenRows = await prismaDirectUrl.$queryRaw<any[]>(Prisma.sql`
    SELECT used_at, consumed_ip, consumed_user_agent FROM password_reset_tokens WHERE id = 'token-1'
  `)

  assert.notEqual(tokenRows[0].used_at, null)
  assert.equal(tokenRows[0].consumed_ip, '10.10.0.5')
  assert.equal(tokenRows[0].consumed_user_agent, 'test/reset-valid')
})

test('consumes a valid empleado token and updates only employee credentials', async () => {
  const token = 'token-valido-empleado'
  const tokenHash = (await import('node:crypto')).createHash('sha256').update(token).digest('hex')

  const empresaBefore = await prismaDirectUrl.$queryRaw<any[]>(Prisma.sql`SELECT password FROM empresas WHERE id = 'emp-1'`)
  const compradorBefore = await prismaDirectUrl.$queryRaw<any[]>(Prisma.sql`SELECT password FROM compradores WHERE id = 'cmp-1'`)

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO password_reset_tokens
      (id, actor_type, actor_id, empresa_id, tenant_slug, email, token_hash, expires_at, requested_ip, requested_user_agent)
    VALUES ('token-emp-1', 'empleado', 'usr-1', 'emp-1', 'empresa-demo', 'equipo@example.com', ${tokenHash}, NOW() + INTERVAL '15 minutes', '10.10.0.7', 'test/seed-empleado')
  `)

  const result = await consumePasswordReset({
    actorType: 'empleado',
    token,
    nuevaPassword: 'ClaveEmpleadoNueva123!',
    confirmarPassword: 'ClaveEmpleadoNueva123!',
    consumedIp: '10.10.0.7',
    consumedUserAgent: 'test/reset-empleado',
  })

  assert.equal(result.status, 200)
  assert.deepEqual(result.data, { ok: true })

  const empleadoRows = await prismaDirectUrl.$queryRaw<any[]>(Prisma.sql`SELECT password, must_change_password, temporary_password_set_at FROM usuarios WHERE id = 'usr-1'`)
  const empleadoUpdated = await bcrypt.compare('ClaveEmpleadoNueva123!', empleadoRows[0].password)
  assert.equal(empleadoUpdated, true)
  assert.equal(empleadoRows[0].must_change_password, false)
  assert.equal(empleadoRows[0].temporary_password_set_at, null)

  const empresaAfter = await prismaDirectUrl.$queryRaw<any[]>(Prisma.sql`SELECT password FROM empresas WHERE id = 'emp-1'`)
  const compradorAfter = await prismaDirectUrl.$queryRaw<any[]>(Prisma.sql`SELECT password FROM compradores WHERE id = 'cmp-1'`)
  assert.equal(empresaAfter[0].password, empresaBefore[0].password)
  assert.equal(compradorAfter[0].password, compradorBefore[0].password)
})

test('rejects actor mismatch, reused token and expired token', async () => {
  const crypto = await import('node:crypto')
  const usedToken = 'token-usado'
  const expiredToken = 'token-expirado'
  const mismatchToken = 'token-mismatch'

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO password_reset_tokens
      (id, actor_type, actor_id, empresa_id, tenant_slug, email, token_hash, expires_at, used_at)
    VALUES ('token-used', 'empresa', 'emp-1', 'emp-1', 'empresa-demo', 'empresa@example.com', ${crypto.createHash('sha256').update(usedToken).digest('hex')}, NOW() + INTERVAL '15 minutes', NOW())
  `)

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO password_reset_tokens
      (id, actor_type, actor_id, empresa_id, tenant_slug, email, token_hash, expires_at)
    VALUES ('token-expired', 'empresa', 'emp-1', 'emp-1', 'empresa-demo', 'empresa@example.com', ${crypto.createHash('sha256').update(expiredToken).digest('hex')}, NOW() - INTERVAL '1 minute')
  `)

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO password_reset_tokens
      (id, actor_type, actor_id, empresa_id, tenant_slug, email, token_hash, expires_at)
    VALUES ('token-mismatch', 'empresa', 'emp-1', 'emp-1', 'empresa-demo', 'empresa@example.com', ${crypto.createHash('sha256').update(mismatchToken).digest('hex')}, NOW() + INTERVAL '15 minutes')
  `)

  const mismatch = await consumePasswordReset({
    actorType: 'empleado',
    token: mismatchToken,
    nuevaPassword: 'NuevaClave123!',
    confirmarPassword: 'NuevaClave123!',
  })
  const reused = await consumePasswordReset({
    actorType: 'empresa',
    token: usedToken,
    nuevaPassword: 'NuevaClave123!',
    confirmarPassword: 'NuevaClave123!',
  })
  const expired = await consumePasswordReset({
    actorType: 'empresa',
    token: expiredToken,
    nuevaPassword: 'NuevaClave123!',
    confirmarPassword: 'NuevaClave123!',
  })

  assert.equal(mismatch.status, 400)
  assert.deepEqual(mismatch.data, undefined)
  assert.equal(reused.status, 400)
  assert.equal(reused.error, 'Este enlace ya fue utilizado')
  assert.equal(expired.status, 400)
  assert.equal(expired.error, 'El enlace expiró')
})

test('rejects password reset when replacement password violates canonical policy', async () => {
  const token = 'token-password-debil'
  const tokenHash = (await import('node:crypto')).createHash('sha256').update(token).digest('hex')

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO password_reset_tokens
      (id, actor_type, actor_id, empresa_id, tenant_slug, email, token_hash, expires_at)
    VALUES ('token-weak-password', 'empresa', 'emp-1', 'emp-1', 'empresa-demo', 'empresa@example.com', ${tokenHash}, NOW() + INTERVAL '15 minutes')
  `)

  const result = await consumePasswordReset({
    actorType: 'empresa',
    token,
    nuevaPassword: '12345678',
    confirmarPassword: '12345678',
  })

  assert.equal(result.status, 400)
  assert.equal(result.error, 'La contraseña debe cumplir la política de seguridad')
})

test('password reset token is consumed atomically under concurrent attempts', async () => {
  const token = 'token-concurrente'
  const tokenHash = (await import('node:crypto')).createHash('sha256').update(token).digest('hex')

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO password_reset_tokens
      (id, actor_type, actor_id, empresa_id, tenant_slug, email, token_hash, expires_at, requested_ip, requested_user_agent)
    VALUES ('token-concurrent-1', 'empresa', 'emp-1', 'emp-1', 'empresa-demo', 'empresa@example.com', ${tokenHash}, NOW() + INTERVAL '15 minutes', '10.10.0.15', 'test/concurrent-seed')
  `)

  const [first, second] = await Promise.all([
    consumePasswordReset({
      actorType: 'empresa',
      token,
        nuevaPassword: 'ConcurrenteUno123!',
        confirmarPassword: 'ConcurrenteUno123!',
      consumedIp: '10.10.0.15',
      consumedUserAgent: 'test/concurrent-1',
    }),
    consumePasswordReset({
      actorType: 'empresa',
      token,
        nuevaPassword: 'ConcurrenteDos123!',
        confirmarPassword: 'ConcurrenteDos123!',
      consumedIp: '10.10.0.16',
      consumedUserAgent: 'test/concurrent-2',
    }),
  ])

  const statuses = [first.status, second.status].sort((a, b) => a - b)
  assert.deepEqual(statuses, [200, 400])

  const tokenRows = await prismaDirectUrl.$queryRaw<any[]>(Prisma.sql`
    SELECT used_at, consumed_ip, consumed_user_agent FROM password_reset_tokens WHERE id = 'token-concurrent-1'
  `)

  assert.notEqual(tokenRows[0].used_at, null)
  assert.ok(['10.10.0.15', '10.10.0.16'].includes(tokenRows[0].consumed_ip))
  assert.ok(['test/concurrent-1', 'test/concurrent-2'].includes(tokenRows[0].consumed_user_agent))

  const empresaRows = await prismaDirectUrl.$queryRaw<any[]>(Prisma.sql`SELECT password FROM empresas WHERE id = 'emp-1'`)
  const matchesFirst = await bcrypt.compare('ConcurrenteUno123!', empresaRows[0].password)
  const matchesSecond = await bcrypt.compare('ConcurrenteDos123!', empresaRows[0].password)
  assert.equal(matchesFirst || matchesSecond, true)
})

test('applies password reset rate limit per forwarded IP', async () => {
  const app = express()
  app.use(express.json())
  app.use('/auth/password/forgot', createPasswordResetRateLimit())
  app.use('/auth', authRouter)
  const server = await createTestServer(app)

  try {
    const attempts = []

    for (let index = 0; index < 6; index++) {
      attempts.push(await postJson(
        `${server.baseUrl}/auth/password/forgot`,
        { email: 'noexiste@example.com', actor: 'empresa' },
        { 'x-forwarded-for': '10.10.0.9', 'user-agent': `test/rate-limit-${index + 1}` }
      ))
    }

    assert.deepEqual(attempts.slice(0, 5).map((attempt) => attempt.status), [200, 200, 200, 200, 200])
    assert.equal(attempts[5].status, 429)
    assert.deepEqual(attempts[5].data, {
      error: 'Demasiados intentos de recuperación, intentá nuevamente en 15 minutos',
    })
  } finally {
    await server.close()
  }
})
