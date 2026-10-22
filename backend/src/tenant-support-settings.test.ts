import './test-env'

import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import pool from './db'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || 're_test_key'
process.env.RESEND_FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'support@test.dev'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch
const sentEmails: Array<Record<string, unknown>> = []

let sitioVentaRouter: express.Router
let tenantRouter: express.Router

type EmpresaSupportRow = {
  support_contact_email: string | null
  faqs: string | null
}

globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
  if (url.startsWith('https://api.resend.com/')) {
    sentEmails.push(JSON.parse(String(init?.body ?? '{}')))
    return new Response(JSON.stringify({ id: 'email_test' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }

  return originalFetch(input, init)
}) as typeof fetch

function buildHeaders(user: Record<string, unknown> | null = null) {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
    ...(user ? { 'x-user': JSON.stringify(user) } : {}),
  }
}

function buildEmpresaUser(empresaId: string, email?: string) {
  return {
    id: empresaId,
    email: email ?? `${empresaId}@example.com`,
    userType: 'empresa' as const,
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

async function requestJson(method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown, user: Record<string, unknown> | null = null) {
  const response = await originalFetch(url, {
    method,
    headers: buildHeaders(user),
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function seedEmpresa({ empresaId, slug, email, supportEmail, faqs }: { empresaId: string; slug: string; email: string; supportEmail?: string | null; faqs?: unknown }) {
  await pool.query(
    `INSERT INTO empresas (id, nombre, slug, email, support_contact_email, password, admin_nombre, activa, faqs)
     VALUES (?, ?, ?, ?, ?, ?, ?, true, ?)`,
    [empresaId, `Empresa ${slug}`, slug, email, supportEmail ?? null, TEST_PASSWORD_HASH, `Admin ${slug}`, faqs ? JSON.stringify(faqs) : null]
  )
}

async function cleanup() {
  sentEmails.length = 0
  await pool.query(`DELETE FROM empresas WHERE id LIKE 'phase-support-%' OR slug LIKE 'phase-support-%' OR email LIKE 'phase-support-%' OR support_contact_email LIKE 'phase-support-%'`)
}

before(async () => {
  ;({ default: sitioVentaRouter } = await import('./routes/sitio-venta'))
  ;({ default: tenantRouter } = await import('./routes/tenant'))
})

beforeEach(async () => {
  await cleanup()
})

after(async () => {
  await cleanup()
  globalThis.fetch = originalFetch
  await pool.end()
})

test('site settings stores support contact email and canonical FAQs', async () => {
  const empresaId = 'phase-support-emp-1'
  await seedEmpresa({ empresaId, slug: 'phase-support-editor', email: 'phase-support-internal@example.com' })

  const app = express()
  app.use(express.json())
  app.use('/api/sitio-venta', sitioVentaRouter)
  const server = await createTestServer(app)

  try {
    const patchResponse = await requestJson(
      'PATCH',
      `${server.baseUrl}/api/sitio-venta`,
      {
        support_contact_email: 'support@club.test',
        faqs: [
          { pregunta: '¿Horario?', respuesta: 'Desde las 20 hs' },
          { question: '¿Hay reingreso?', answer: 'No', hidden: true },
          { id: 'faq-custom', question: 'Dress code', answer: 'Casual', hidden: false },
          { question: '', answer: 'No debería persistir' },
        ],
      },
      buildEmpresaUser(empresaId, 'phase-support-internal@example.com')
    )

    assert.equal(patchResponse.status, 200)

    const [rows] = await pool.query<EmpresaSupportRow[]>(
      'SELECT support_contact_email, faqs FROM empresas WHERE id = ?',
      [empresaId]
    )

    assert.equal(rows[0].support_contact_email, 'support@club.test')
    assert.deepEqual(JSON.parse(String(rows[0].faqs)), [
      { id: 'faq-1', question: '¿Horario?', answer: 'Desde las 20 hs', hidden: false },
      { id: 'faq-2', question: '¿Hay reingreso?', answer: 'No', hidden: true },
      { id: 'faq-custom', question: 'Dress code', answer: 'Casual', hidden: false },
    ])

    const getResponse = await requestJson('GET', `${server.baseUrl}/api/sitio-venta`, undefined, buildEmpresaUser(empresaId, 'phase-support-internal@example.com'))
    assert.equal(getResponse.status, 200)
    assert.equal(getResponse.data.data.support_contact_email, 'support@club.test')
  } finally {
    await server.close()
  }
})

test('site settings can clear support email and round-trip mixed FAQ edits', async () => {
  const empresaId = 'phase-support-emp-5'
  await seedEmpresa({
    empresaId,
    slug: 'phase-support-mixed',
    email: 'phase-support-mixed-internal@example.com',
    supportEmail: 'phase-support-initial@example.com',
    faqs: [
      { id: 'faq-delete', question: 'Eliminar', answer: 'Se va', hidden: false },
      { id: 'faq-keep', question: 'Visible original', answer: 'Se edita', hidden: false },
      { id: 'faq-hide', question: 'Oculta original', answer: 'También se edita', hidden: false },
    ],
  })

  const app = express()
  app.use(express.json())
  app.use('/api/sitio-venta', sitioVentaRouter)
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const patchResponse = await requestJson(
      'PATCH',
      `${server.baseUrl}/api/sitio-venta`,
      {
        support_contact_email: '   ',
        faqs: [
          { id: 'faq-keep', question: 'Visible editada', answer: 'Sigue pública', hidden: false },
          { id: 'faq-hide', question: 'Oculta editada', answer: 'Queda editable', hidden: true },
          { question: 'Nueva visible', answer: 'Se agrega en el mismo guardado', hidden: false },
        ],
      },
      buildEmpresaUser(empresaId, 'phase-support-mixed-internal@example.com')
    )

    assert.equal(patchResponse.status, 200)

    const [rows] = await pool.query<EmpresaSupportRow[]>(
      'SELECT support_contact_email, faqs FROM empresas WHERE id = ?',
      [empresaId]
    )

    assert.equal(rows[0].support_contact_email, null)
    assert.deepEqual(JSON.parse(String(rows[0].faqs)), [
      { id: 'faq-keep', question: 'Visible editada', answer: 'Sigue pública', hidden: false },
      { id: 'faq-hide', question: 'Oculta editada', answer: 'Queda editable', hidden: true },
      { id: 'faq-3', question: 'Nueva visible', answer: 'Se agrega en el mismo guardado', hidden: false },
    ])

    const settingsResponse = await requestJson('GET', `${server.baseUrl}/api/sitio-venta`, undefined, buildEmpresaUser(empresaId, 'phase-support-mixed-internal@example.com'))
    assert.equal(settingsResponse.status, 200)
    assert.equal(settingsResponse.data.data.support_contact_email, null)
    assert.deepEqual(JSON.parse(String(settingsResponse.data.data.faqs)), [
      { id: 'faq-keep', question: 'Visible editada', answer: 'Sigue pública', hidden: false },
      { id: 'faq-hide', question: 'Oculta editada', answer: 'Queda editable', hidden: true },
      { id: 'faq-3', question: 'Nueva visible', answer: 'Se agrega en el mismo guardado', hidden: false },
    ])

    const publicResponse = await requestJson('GET', `${server.baseUrl}/api/tenant/phase-support-mixed`)
    assert.equal(publicResponse.status, 200)
    assert.equal(publicResponse.data.data.empresa.support_contact_enabled, false)
    assert.deepEqual(publicResponse.data.data.empresa.faqs, [
      { id: 'faq-keep', question: 'Visible editada', answer: 'Sigue pública', hidden: false },
      { id: 'faq-3', question: 'Nueva visible', answer: 'Se agrega en el mismo guardado', hidden: false },
    ])

    const supportResponse = await requestJson('POST', `${server.baseUrl}/api/tenant/phase-support-mixed/soporte`, {
      nombre: 'Comprador',
      email: 'buyer@example.com',
      mensaje: '¿Hay ayuda?',
    })

    assert.equal(supportResponse.status, 409)
    assert.equal(supportResponse.data.error, 'Soporte no disponible')
    assert.equal(sentEmails.length, 0)
  } finally {
    await server.close()
  }
})

test('public tenant payload keeps visible FAQs and hides support destination email', async () => {
  await seedEmpresa({
    empresaId: 'phase-support-emp-2',
    slug: 'phase-support-public',
    email: 'phase-support-public-internal@example.com',
    supportEmail: 'phase-support-public@example.com',
    faqs: [
      { id: 'faq-1', question: 'Visible', answer: 'Sí', hidden: false },
      { id: 'faq-2', question: 'Oculta', answer: 'No sale', hidden: true },
      { pregunta: 'Legacy visible', respuesta: 'Compat ok' },
    ],
  })

  const app = express()
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson('GET', `${server.baseUrl}/api/tenant/phase-support-public`)
    assert.equal(response.status, 200)
    assert.equal(response.data.data.empresa.support_contact_enabled, true)
    assert.equal('support_contact_email' in response.data.data.empresa, false)
    assert.deepEqual(response.data.data.empresa.faqs, [
      { id: 'faq-1', question: 'Visible', answer: 'Sí', hidden: false },
      { id: 'faq-3', question: 'Legacy visible', answer: 'Compat ok', hidden: false },
    ])
  } finally {
    await server.close()
  }
})

test('support endpoint rejects requests when no public support email is configured', async () => {
  await seedEmpresa({
    empresaId: 'phase-support-emp-3',
    slug: 'phase-support-disabled',
    email: 'phase-support-disabled-internal@example.com',
  })

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson('POST', `${server.baseUrl}/api/tenant/phase-support-disabled/soporte`, {
      nombre: 'Comprador',
      email: 'buyer@example.com',
      mensaje: 'Necesito ayuda',
    })

    assert.equal(response.status, 409)
    assert.equal(response.data.error, 'Soporte no disponible')
    assert.equal(sentEmails.length, 0)
  } finally {
    await server.close()
  }
})

test('support endpoint sends messages to configured support email instead of internal company email', async () => {
  await seedEmpresa({
    empresaId: 'phase-support-emp-4',
    slug: 'phase-support-send',
    email: 'phase-support-internal-destination@example.com',
    supportEmail: 'phase-support-public-destination@example.com',
  })

  const app = express()
  app.use(express.json())
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson('POST', `${server.baseUrl}/api/tenant/phase-support-send/soporte`, {
      nombre: 'Comprador',
      email: 'buyer@example.com',
      mensaje: 'Necesito ayuda con mi compra',
    })

    assert.equal(response.status, 200)
    assert.equal(sentEmails.length, 1)
    assert.match(JSON.stringify(sentEmails[0].to), /phase-support-public-destination@example\.com/)
    assert.doesNotMatch(JSON.stringify(sentEmails[0].to), /phase-support-internal-destination@example\.com/)
  } finally {
    await server.close()
  }
})
