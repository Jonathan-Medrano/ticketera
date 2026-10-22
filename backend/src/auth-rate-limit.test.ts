import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { prisma } from './lib/prisma'
import authRouter from './routes/auth'
import tenantRouter from './routes/tenant'
import {
  createCompanyRegisterRateLimit,
  createPasswordResetConsumeRateLimit,
  createPasswordResetForgotRateLimit,
  createSupportRateLimit,
  createTenantRegisterRateLimit,
  createTenantTokenConsumeRateLimit,
} from './lib/auth-rate-limit'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch

function buildHeaders(extra: Record<string, string> = {}) {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
    'x-forwarded-for': '203.0.113.10',
    ...extra,
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

async function requestJson(method: 'GET' | 'POST', url: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const response = await originalFetch(url, {
    method,
    headers: buildHeaders(extraHeaders),
    body: body === undefined ? undefined : JSON.stringify(body),
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

async function cleanup() {
  // Schema provisioned by prisma migrate deploy in prepare-test-db.cjs — no-op for DDL
  await prisma.$executeRaw`DELETE FROM login_tokens WHERE empresa_slug ILIKE 'phase-rate-%' OR comprador_id ILIKE 'phase-rate-cmp-%'`
  await prisma.$executeRaw`DELETE FROM compradores WHERE id ILIKE 'phase-rate-cmp-%' OR empresa_id ILIKE 'phase-rate-emp-%'`
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'phase-rate-emp-%' OR slug ILIKE 'phase-rate-%'`
  await prisma.$executeRaw`DELETE FROM rate_limit_buckets WHERE bucket_key ILIKE 'auth-%' OR bucket_key ILIKE 'tenant-%' OR bucket_key ILIKE 'nextauth-%'`
}

function buildApp() {
  const app = express()
  app.use(express.json())
  app.use('/api/auth/registro', createCompanyRegisterRateLimit())
  app.use('/api/auth/password/forgot', createPasswordResetForgotRateLimit('auth-password-forgot'))
  app.use('/api/auth/password/reset', createPasswordResetConsumeRateLimit('auth-password-reset'))
  app.use('/api/tenant/:slug/registro', createTenantRegisterRateLimit())
  app.use('/api/tenant/:slug/auth/token', createTenantTokenConsumeRateLimit())
  app.use('/api/tenant/:slug/password/forgot', createPasswordResetForgotRateLimit('tenant-password-forgot'))
  app.use('/api/tenant/:slug/password/reset', createPasswordResetConsumeRateLimit('tenant-password-reset'))
  app.use('/api/tenant/:slug/soporte', createSupportRateLimit())
  app.use('/api/auth', authRouter)
  app.use('/api/tenant', tenantRouter)
  return app
}

beforeEach(async () => {
  await cleanup()
})

after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

test('company register endpoint rate limits repeated attempts', async () => {
  const app = buildApp()
  const server = await createTestServer(app)

  try {
    let lastResponse = { status: 0, data: null as any }
    for (let i = 0; i < 6; i++) {
      lastResponse = await requestJson('POST', `${server.baseUrl}/api/auth/registro`, {
        nombre: 'Empresa',
        slug: 'phase-rate-company',
        email: 'phase-rate@example.com',
        password: 'super-secret-123',
        admin_nombre: 'Admin',
      })
    }

    assert.equal(lastResponse.status, 429)
    assert.equal(lastResponse.data.error, 'Demasiados intentos de registro, intentá nuevamente en 15 minutos')
  } finally {
    await server.close()
  }
})

test('password recovery endpoints rate limit by repeated identifier attempts', async () => {
  const app = buildApp()
  const server = await createTestServer(app)

  try {
    let forgotResponse = { status: 0, data: null as any }
    for (let i = 0; i < 6; i++) {
      forgotResponse = await requestJson('POST', `${server.baseUrl}/api/auth/password/forgot`, {
        actor: 'empresa',
        email: 'phase-rate-forgot@example.com',
      })
    }

    assert.equal(forgotResponse.status, 429)
    assert.equal(forgotResponse.data.error, 'Demasiados intentos de recuperación, intentá nuevamente en 15 minutos')

    let resetResponse = { status: 0, data: null as any }
    for (let i = 0; i < 11; i++) {
      resetResponse = await requestJson('POST', `${server.baseUrl}/api/auth/password/reset`, {
        actor: 'empresa',
        token: 'phase-rate-reset-token',
        nuevaPassword: 'super-secret-123',
        confirmarPassword: 'super-secret-123',
      })
    }

    assert.equal(resetResponse.status, 429)
    assert.equal(resetResponse.data.error, 'Demasiados intentos de restablecimiento, intentá nuevamente en 15 minutos')
  } finally {
    await server.close()
  }
})

test('tenant public token and support endpoints rate limit repeated abuse', async () => {
  const empresaId = 'phase-rate-emp-1'
  const slug = 'phase-rate-tenant-1'
  await seedEmpresa(empresaId, slug)

  const app = buildApp()
  const server = await createTestServer(app)

  try {
    let tokenResponse = { status: 0, data: null as any }
    for (let i = 0; i < 11; i++) {
      tokenResponse = await requestJson('GET', `${server.baseUrl}/api/tenant/${slug}/auth/token?token=phase-rate-token`)
    }

    assert.equal(tokenResponse.status, 429)
    assert.equal(tokenResponse.data.error, 'Demasiados intentos con token, esperá unos minutos antes de reintentar')

    let supportResponse = { status: 0, data: null as any }
    for (let i = 0; i < 9; i++) {
      supportResponse = await requestJson('POST', `${server.baseUrl}/api/tenant/${slug}/soporte`, {
        nombre: 'Spam Bot',
        email: 'spam@example.com',
        mensaje: 'Hola soporte',
      })
    }

    assert.equal(supportResponse.status, 429)
    assert.equal(supportResponse.data.error, 'Demasiados mensajes de soporte, intentá nuevamente en unos minutos')
  } finally {
    await server.close()
  }
})

test('spoofing x-forwarded-for does not bypass backend auth rate limit', async () => {
  const app = buildApp()
  const server = await createTestServer(app)

  try {
    let lastResponse = { status: 0, data: null as any }
    for (let i = 0; i < 6; i++) {
      lastResponse = await requestJson(
        'POST',
        `${server.baseUrl}/api/auth/registro`,
        {
          nombre: 'Empresa',
          slug: 'phase-rate-spoof',
          email: 'phase-rate-spoof@example.com',
          password: 'super-secret-123',
          admin_nombre: 'Admin',
        },
        { 'x-forwarded-for': `198.51.100.${i}` }
      )
    }

    assert.equal(lastResponse.status, 429)
    assert.equal(lastResponse.data.error, 'Demasiados intentos de registro, intentá nuevamente en 15 minutos')
  } finally {
    await server.close()
  }
})
