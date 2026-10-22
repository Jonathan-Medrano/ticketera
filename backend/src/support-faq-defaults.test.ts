import './test-env'

import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import { prisma } from './lib/prisma'
import { backfillEmptyEmpresaSupportFaqs, getDefaultSupportFaqs } from './lib/support-faqs'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

interface EmpresaFaqRow {
  id: string
  faqs: string | null
}

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch

function buildHeaders() {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
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

async function requestJson(url: string, body: unknown) {
  const response = await originalFetch(url, {
    method: 'POST',
    headers: buildHeaders(),
    body: JSON.stringify(body),
  })

  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function seedEmpresa({ empresaId, slug, email, faqs }: { empresaId: string; slug: string; email: string; faqs?: string | null }) {
  await prisma.$executeRaw`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa, faqs)
    VALUES (${empresaId}, ${`Empresa ${slug}`}, ${slug}, ${email}, ${TEST_PASSWORD_HASH}, ${`Admin ${slug}`}, true, ${faqs ?? null})
  `
}

async function readFaqs(empresaId: string) {
  const rows = await prisma.$queryRaw<EmpresaFaqRow[]>`SELECT id, faqs::text as faqs FROM empresas WHERE id = ${empresaId}`
  return rows[0]?.faqs ? JSON.parse(String(rows[0].faqs)) : null
}

async function cleanup() {
  await prisma.$executeRaw`DELETE FROM empresas WHERE id ILIKE 'phase-faq-defaults-%' OR slug ILIKE 'phase-faq-defaults-%' OR email ILIKE 'phase-faq-defaults-%'`
}

let authRouter: express.Router

before(async () => {
  ;({ default: authRouter } = await import('./routes/auth'))
})

beforeEach(async () => {
  await cleanup()
})

after(async () => {
  await cleanup()
  await prisma.$disconnect()
})

test('new company registration stores default support FAQs', async () => {
  const app = express()
  app.use(express.json())
  app.use('/auth', authRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(`${server.baseUrl}/auth/registro`, {
      nombre: 'Empresa FAQ Defaults',
      slug: 'phase-faq-defaults-new',
      email: 'phase-faq-defaults-new@example.com',
      password: 'ValidPass123!',
      admin_nombre: 'Admin FAQ',
    })

    assert.equal(response.status, 201)

    const rows = await prisma.$queryRaw<EmpresaFaqRow[]>`SELECT id, faqs::text as faqs FROM empresas WHERE slug = 'phase-faq-defaults-new'`
    assert.equal(rows.length, 1)
    assert.deepEqual(JSON.parse(String(rows[0].faqs)), getDefaultSupportFaqs())
  } finally {
    await server.close()
  }
})

test('support FAQ backfill only updates empty values and keeps existing FAQs intact', async () => {
  await seedEmpresa({
    empresaId: 'phase-faq-defaults-null',
    slug: 'phase-faq-defaults-null',
    email: 'phase-faq-defaults-null@example.com',
    faqs: null,
  })
  await seedEmpresa({
    empresaId: 'phase-faq-defaults-empty',
    slug: 'phase-faq-defaults-empty',
    email: 'phase-faq-defaults-empty@example.com',
    faqs: '[]',
  })
  await seedEmpresa({
    empresaId: 'phase-faq-defaults-custom',
    slug: 'phase-faq-defaults-custom',
    email: 'phase-faq-defaults-custom@example.com',
    faqs: JSON.stringify([{ id: 'faq-custom', question: 'Custom', answer: 'No tocar', hidden: false }]),
  })

  const firstRun = await backfillEmptyEmpresaSupportFaqs()
  const secondRun = await backfillEmptyEmpresaSupportFaqs()

  assert.equal(firstRun.updated, 2)
  assert.equal(secondRun.updated, 0)
  assert.deepEqual(await readFaqs('phase-faq-defaults-null'), getDefaultSupportFaqs())
  assert.deepEqual(await readFaqs('phase-faq-defaults-empty'), getDefaultSupportFaqs())
  assert.deepEqual(await readFaqs('phase-faq-defaults-custom'), [
    { id: 'faq-custom', question: 'Custom', answer: 'No tocar', hidden: false },
  ])
})
