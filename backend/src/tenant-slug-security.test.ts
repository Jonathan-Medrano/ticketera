import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { Express } from 'express'
import express from 'express'
process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

import pool from './db'
import authRouter from './routes/auth'
import sitioVentaRouter from './routes/sitio-venta'
import tenantRouter from './routes/tenant'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch

function buildHeaders(user: Record<string, unknown> | null = null) {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
    'x-user': JSON.stringify(user),
  }
}

function buildEmpresaUser(empresaId: string, email?: string) {
  return {
    id: empresaId,
    email: email ?? `${empresaId}@example.com`,
    userType: 'empresa' as const,
  }
}

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

async function requestJson(method: 'POST' | 'PATCH', url: string, body: unknown, user: Record<string, unknown> | null = null) {
  const response = await originalFetch(url, {
    method,
    headers: buildHeaders(user),
    body: JSON.stringify(body),
  })

  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function requestGetJson(url: string, user: Record<string, unknown> | null = null) {
  const response = await originalFetch(url, {
    method: 'GET',
    headers: buildHeaders(user),
  })

  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function seedEmpresa({ empresaId, slug, email }: { empresaId: string; slug: string; email: string }) {
  await pool.query(
    `INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
     VALUES (?, ?, ?, ?, ?, ?, true)`,
    [empresaId, `Empresa ${slug}`, slug, email, TEST_PASSWORD_HASH, `Admin ${slug}`]
  )
}

async function cleanup() {
  await pool.query(`DELETE FROM empresas WHERE id LIKE 'phase10-emp-%' OR slug LIKE 'phase10-%' OR email LIKE 'phase10-%'`)
}

beforeEach(async () => {
  await pool.query(`ALTER TABLE empresas ADD COLUMN IF NOT EXISTS home_sections text DEFAULT NULL`)
  await cleanup()
})

after(async () => {
  await cleanup()
  await pool.end()
})

test('company registration rejects reserved tenant slug', async () => {
  const app = express()
  app.use(express.json())
  app.use('/auth', authRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson('POST', `${server.baseUrl}/auth/registro`, {
      nombre: 'Nueva Empresa',
      slug: 'api',
      email: 'phase10-owner@example.com',
      password: '12345678',
      admin_nombre: 'Admin',
    })

    assert.equal(response.status, 400)
    assert.equal(response.data.error, 'Ese subdominio está reservado y no se puede usar')
  } finally {
    await server.close()
  }
})

test('company registration rejects malformed tenant slug', async () => {
  const app = express()
  app.use(express.json())
  app.use('/auth', authRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson('POST', `${server.baseUrl}/auth/registro`, {
      nombre: 'Nueva Empresa',
      slug: 'bad.slug',
      email: 'phase10-malformed@example.com',
      password: '12345678',
      admin_nombre: 'Admin',
    })

    assert.equal(response.status, 400)
    assert.equal(response.data.error, 'El subdominio solo puede tener letras minúsculas, números y guiones internos')
  } finally {
    await server.close()
  }
})

test('site settings rejects reserved tenant slug update', async () => {
  await seedEmpresa({ empresaId: 'phase10-emp-1', slug: 'phase10-ok', email: 'phase10-ok@example.com' })

  const app = express()
  app.use(express.json())
  app.use('/api/sitio-venta', sitioVentaRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      'PATCH',
      `${server.baseUrl}/api/sitio-venta`,
      { slug: 'support' },
      buildEmpresaUser('phase10-emp-1', 'phase10-ok@example.com')
    )

    assert.equal(response.status, 400)
    assert.equal(response.data.error, 'Ese subdominio está reservado y no se puede usar')
  } finally {
    await server.close()
  }
})

test('site settings rejects invalid banner variant update', async () => {
  await seedEmpresa({ empresaId: 'phase10-emp-2', slug: 'phase10-banner-variant', email: 'phase10-banner-variant@example.com' })

  const app = express()
  app.use(express.json())
  app.use('/api/sitio-venta', sitioVentaRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      'PATCH',
      `${server.baseUrl}/api/sitio-venta`,
      { banner_variant: 'cinematic' },
      buildEmpresaUser('phase10-emp-2', 'phase10-banner-variant@example.com')
    )

    assert.equal(response.status, 400)
    assert.equal(response.data.error, 'banner_variant debe ser blurred o full')
  } finally {
    await server.close()
  }
})

test('site settings rejects invalid banners payload update', async () => {
  await seedEmpresa({ empresaId: 'phase10-emp-3', slug: 'phase10-banners', email: 'phase10-banners@example.com' })

  const app = express()
  app.use(express.json())
  app.use('/api/sitio-venta', sitioVentaRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      'PATCH',
      `${server.baseUrl}/api/sitio-venta`,
      { banners: ['https://cdn.test/hero.jpg', '', 42] },
      buildEmpresaUser('phase10-emp-3', 'phase10-banners@example.com')
    )

    assert.equal(response.status, 400)
    assert.equal(response.data.error, 'banners debe ser un array de strings no vacíos')
  } finally {
    await server.close()
  }
})

test('site settings rejects banners payload longer than five items', async () => {
  await seedEmpresa({ empresaId: 'phase10-emp-4', slug: 'phase10-too-many-banners', email: 'phase10-too-many-banners@example.com' })

  const app = express()
  app.use(express.json())
  app.use('/api/sitio-venta', sitioVentaRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      'PATCH',
      `${server.baseUrl}/api/sitio-venta`,
      {
        banners: [
          'https://cdn.test/1.jpg',
          'https://cdn.test/2.jpg',
          'https://cdn.test/3.jpg',
          'https://cdn.test/4.jpg',
          'https://cdn.test/5.jpg',
          'https://cdn.test/6.jpg',
        ],
      },
      buildEmpresaUser('phase10-emp-4', 'phase10-too-many-banners@example.com')
    )

    assert.equal(response.status, 400)
    assert.equal(response.data.error, 'banners debe ser un array de strings no vacíos')
  } finally {
    await server.close()
  }
})

test('site settings rejects invalid home sections payload update', async () => {
  await seedEmpresa({ empresaId: 'phase10-emp-home-sections-1', slug: 'phase10-home-sections-1', email: 'phase10-home-sections-1@example.com' })

  const app = express()
  app.use(express.json())
  app.use('/api/sitio-venta', sitioVentaRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      'PATCH',
      `${server.baseUrl}/api/sitio-venta`,
      { home_sections: { type: 'eventos' } },
      buildEmpresaUser('phase10-emp-home-sections-1', 'phase10-home-sections-1@example.com')
    )

    assert.equal(response.status, 400)
    assert.equal(response.data.error, 'home_sections debe ser un array válido de secciones configurables')
  } finally {
    await server.close()
  }
})

test('site settings stores home sections payload and keeps eventos compatibility', async () => {
  const empresaId = 'phase10-emp-home-sections-2'
  await seedEmpresa({ empresaId, slug: 'phase10-home-sections-2', email: 'phase10-home-sections-2@example.com' })

  const app = express()
  app.use(express.json())
  app.use('/api/sitio-venta', sitioVentaRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      'PATCH',
      `${server.baseUrl}/api/sitio-venta`,
      {
        home_sections: [
          { id: 'banner-1', type: 'banner', title: 'Promo', subtitle: 'Sub', image_url: 'https://cdn.test/banner.jpg', cta_label: 'Ver', cta_href: '/promo' },
          { id: 'sponsors-1', type: 'auspiciantes_carousel', title: 'Acompañan', subtitle: 'Marcas', sponsors: [{ id: 'sp-1', name: 'Marca', logo_url: 'https://cdn.test/logo.svg', href: 'https://marca.test' }] },
        ],
      },
      buildEmpresaUser(empresaId, 'phase10-home-sections-2@example.com')
    )

    assert.equal(response.status, 200)

    const [rows] = await pool.query('SELECT home_sections FROM empresas WHERE id = ?', [empresaId])
    const stored = JSON.parse(String((rows as Array<{ home_sections: string | null }>)[0].home_sections ?? '[]'))

    assert.equal(stored[0].type, 'eventos')
    assert.equal(stored[1].type, 'banner')
    assert.equal(stored[2].type, 'auspiciantes_carousel')
  } finally {
    await server.close()
  }
})

test('site settings rejects legacy footer fields in patch contract', async () => {
  await seedEmpresa({ empresaId: 'phase10-emp-legacy-footer', slug: 'phase10-legacy-footer', email: 'phase10-legacy-footer@example.com' })

  const app = express()
  app.use(express.json())
  app.use('/api/sitio-venta', sitioVentaRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson(
      'PATCH',
      `${server.baseUrl}/api/sitio-venta`,
      { imagen_hero: 'https://cdn.test/hero.jpg', imagen_footer: 'https://cdn.test/footer.jpg', footer_texto: 'Legacy footer' },
      buildEmpresaUser('phase10-emp-legacy-footer', 'phase10-legacy-footer@example.com')
    )

    assert.equal(response.status, 400)
    assert.equal(response.data.error, 'imagen_hero, imagen_footer y footer_texto ya no forman parte del contrato de sitio de venta')
  } finally {
    await server.close()
  }
})

test('site settings response omits legacy footer and hero fields from dashboard contract', async () => {
  const empresaId = 'phase10-emp-5'
  const slug = 'phase10-dashboard-contract'
  await seedEmpresa({ empresaId, slug, email: 'phase10-dashboard-contract@example.com' })
  await pool.query(
    `UPDATE empresas SET banners = ? WHERE id = ?`,
    [JSON.stringify(['https://cdn.test/banner.jpg']), empresaId]
  )

  const app = express()
  app.use(express.json())
  app.use('/api/sitio-venta', sitioVentaRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestGetJson(
      `${server.baseUrl}/api/sitio-venta`,
      buildEmpresaUser(empresaId, 'phase10-dashboard-contract@example.com')
    )

    assert.equal(response.status, 200)
    assert.equal('imagen_hero' in response.data.data, false)
    assert.equal('imagen_footer' in response.data.data, false)
    assert.equal('footer_texto' in response.data.data, false)
  } finally {
    await server.close()
  }
})

test('public tenant response omits legacy footer and hero fields from public contract', async () => {
  const empresaId = 'phase10-emp-6'
  const slug = 'phase10-public-contract'
  await seedEmpresa({ empresaId, slug, email: 'phase10-public-contract@example.com' })
  await pool.query(
    `UPDATE empresas SET banners = ? WHERE id = ?`,
    [JSON.stringify(['https://cdn.test/banner-public.jpg']), empresaId]
  )

  const app = express()
  app.use('/api/tenant', tenantRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestGetJson(`${server.baseUrl}/api/tenant/${slug}`)

    assert.equal(response.status, 200)
    assert.equal('imagen_hero' in response.data.data.empresa, false)
    assert.equal('imagen_footer' in response.data.data.empresa, false)
    assert.equal('footer_texto' in response.data.data.empresa, false)
  } finally {
    await server.close()
  }
})

test('backend boot wires schema cleanup at startup', async () => {
  const source = await readFile(__dirname + '/index.ts', 'utf8')

  assert.match(source, /void startServer\(\)\.catch\(/)
})
