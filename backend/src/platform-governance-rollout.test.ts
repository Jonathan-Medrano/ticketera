import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { Express } from 'express'
import express from 'express'
import { Prisma } from '@prisma/client'
import { prismaDirectUrl } from './lib/prisma'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

import { rehydrateSessionUser } from './lib/authz'
import { updatePlatformUser } from './lib/platform-governance'
import platformRouter from './routes/platform'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'

type JsonResponse<T = any> = { status: number; data: T }

function buildPlatformUser(userId: string, userType: 'super_admin' | 'platform_staff' = 'platform_staff') {
  return {
    id: userId,
    email: `${userId}@example.com`,
    userType,
    slug: '',
  }
}

function buildHeaders(user: Record<string, unknown> | null = null) {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
    'x-user': JSON.stringify(user),
  }
}

async function createTestServer(app: Express) {
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })
  const address = server.address() as AddressInfo
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

async function requestJson<T = any>(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', url: string, body?: unknown, user: Record<string, unknown> | null = null): Promise<JsonResponse<T>> {
  const response = await fetch(url, {
    method,
    headers: buildHeaders(user),
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const data = await response.json().catch(() => null)
  return { status: response.status, data: data as T }
}

async function getRootUserId() {
  const rows = await prismaDirectUrl.$queryRaw<any[]>(Prisma.sql`SELECT id FROM platform_admin_users WHERE singleton_key = 'superadmin' LIMIT 1`)
  return String(rows[0].id)
}

async function seedEmpresa({ empresaId, slug }: { empresaId: string; slug: string }) {
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES (${empresaId}, ${`Empresa ${slug}`}, ${slug}, ${`${slug}@example.com`}, ${TEST_PASSWORD_HASH}, ${`Admin ${slug}`}, true)
  `)
}

async function seedComprador(compradorId: string, empresaId: string) {
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO compradores (id, empresa_id, nombre, email, dni, password)
    VALUES (${compradorId}, ${empresaId}, 'Comprador Smoke', ${`${compradorId}@example.com`}, ${`${compradorId.slice(-16)}-dni`}, ${TEST_PASSWORD_HASH})
  `)
}

async function seedEventoConCategoria({ eventoId, empresaId, categoriaId }: { eventoId: string; empresaId: string; categoriaId: string }) {
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo)
    VALUES (${eventoId}, ${empresaId}, ${`Evento ${eventoId}`}, NULL, NULL, 'unica', NULL, true)
  `)

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO entrada_categorias (id, evento_id, tanda_id, nombre, descripcion, precio, stock, stock_disponible, activa)
    VALUES (${categoriaId}, ${eventoId}, NULL, ${`Categoría ${categoriaId}`}, NULL, 150, 10, 10, true)
  `)
}

async function cleanupTestData() {
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM entradas WHERE id LIKE 'phase9-%' OR evento_id LIKE 'phase9-%' OR categoria_id LIKE 'phase9-%' OR comprador_id LIKE 'phase9-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_sale_allocations WHERE empresa_id LIKE 'phase9-%' OR checkout_session_id LIKE 'phase9-%' OR source_id LIKE 'phase9-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresa_marketplace_fee_overrides WHERE empresa_id LIKE 'phase9-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresa_marketplace_fees WHERE empresa_id LIKE 'phase9-%'`)
  // plataforma_marketplace_fee_defaults may not exist — ignore errors
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_payment_accounts WHERE platform_admin_user_id LIKE 'phase9-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_admin_revenue_grants WHERE child_platform_admin_user_id LIKE 'phase9-%' OR parent_platform_admin_user_id LIKE 'phase9-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_admin_capability_grants WHERE platform_admin_user_id LIKE 'phase9-%' OR granted_by_platform_admin_user_id LIKE 'phase9-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_admin_closure WHERE ancestor_platform_admin_user_id LIKE 'phase9-%' OR descendant_platform_admin_user_id LIKE 'phase9-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_admin_relationships WHERE platform_admin_user_id LIKE 'phase9-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_admin_user_flow_shares WHERE platform_admin_user_id LIKE 'phase9-%' OR configured_by_platform_admin_id LIKE 'phase9-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_admin_users WHERE id LIKE 'phase9-%' OR email LIKE 'phase9-%' OR login_alias LIKE 'phase9-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM entrada_categorias WHERE id LIKE 'phase9-%' OR evento_id LIKE 'phase9-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM eventos WHERE id LIKE 'phase9-%' OR empresa_id LIKE 'phase9-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM compradores WHERE id LIKE 'phase9-%' OR empresa_id LIKE 'phase9-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresas WHERE id LIKE 'phase9-%' OR slug LIKE 'phase9-%'`)
}

beforeEach(async () => {
  await cleanupTestData()
})

after(async () => {
  await cleanupTestData()
  await prismaDirectUrl.$disconnect()
})

test('phase4 keeps legacy fallback compatibility and fails closed on rollback paths', async () => {
  const rootUserId = await getRootUserId()

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO platform_admin_users (id, nombre, email, login_alias, password, role_slug, permisos, activo)
    VALUES ('phase9-legacy-manager', 'Legacy Manager', 'phase9-legacy-manager@example.com', 'phase9-legacy-manager', ${TEST_PASSWORD_HASH}, 'empleado', ${JSON.stringify({ platform_usuarios: true, platform_dashboard: true })}, true)
  `)
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO platform_admin_relationships (platform_admin_user_id, parent_platform_admin_user_id, branch_root_platform_admin_user_id, depth_from_root, source)
    VALUES ('phase9-legacy-manager', ${rootUserId}, 'phase9-legacy-manager', 1, 'legacy_test')
  `)
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO platform_admin_closure (ancestor_platform_admin_user_id, descendant_platform_admin_user_id, depth)
    VALUES ('phase9-legacy-manager', 'phase9-legacy-manager', 0), (${rootUserId}, 'phase9-legacy-manager', 1)
  `)
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO platform_admin_revenue_grants (id, parent_platform_admin_user_id, child_platform_admin_user_id, flow, percentage, source)
    VALUES ('phase9-legacy-grant-ent', ${rootUserId}, 'phase9-legacy-manager', 'entradas', 20, 'legacy_test'),
           ('phase9-legacy-grant-con', ${rootUserId}, 'phase9-legacy-manager', 'consumibles', 0, 'legacy_test')
  `)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_admin_capability_grants WHERE platform_admin_user_id = 'phase9-legacy-manager'`)

  const rehydrated = await rehydrateSessionUser({
    id: 'phase9-legacy-manager',
    userType: 'platform_staff',
    email: 'phase9-legacy-manager@example.com',
    name: 'Legacy Manager',
    slug: '',
  })

  assert.equal(rehydrated?.platformViewerPolicy?.compatibilityMode, 'legacy_fallback')

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO platform_admin_users (id, nombre, email, login_alias, password, role_slug, permisos, activo)
    VALUES ('phase9-legacy-child', 'Legacy Child', 'phase9-legacy-child@example.com', 'phase9-legacy-child', ${TEST_PASSWORD_HASH}, 'empleado', ${JSON.stringify({ platform_dashboard: true })}, true)
  `)
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO platform_admin_relationships (platform_admin_user_id, parent_platform_admin_user_id, branch_root_platform_admin_user_id, depth_from_root, source)
    VALUES ('phase9-legacy-child', 'phase9-legacy-manager', 'phase9-legacy-manager', 2, 'legacy_test')
  `)
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO platform_admin_closure (ancestor_platform_admin_user_id, descendant_platform_admin_user_id, depth)
    VALUES ('phase9-legacy-child', 'phase9-legacy-child', 0),
           ('phase9-legacy-manager', 'phase9-legacy-child', 1),
           (${rootUserId}, 'phase9-legacy-child', 2)
  `)

  await assert.rejects(
    () => updatePlatformUser('phase9-legacy-manager', { parentUserId: 'phase9-legacy-child' }, { actorUserId: rootUserId }),
    /ciclos en la jerarquía/,
  )

  const relationshipRows = await prismaDirectUrl.$queryRaw<any[]>(Prisma.sql`
    SELECT parent_platform_admin_user_id, branch_root_platform_admin_user_id
    FROM platform_admin_relationships
    WHERE platform_admin_user_id = 'phase9-legacy-manager'
    LIMIT 1
  `)
  assert.equal(String(relationshipRows[0]?.parent_platform_admin_user_id ?? ''), rootUserId)
  assert.equal(String(relationshipRows[0]?.branch_root_platform_admin_user_id ?? ''), 'phase9-legacy-manager')

  await prismaDirectUrl.$executeRaw(Prisma.sql`UPDATE platform_admin_users SET activo = false WHERE id = 'phase9-legacy-manager'`)
  const staleRehydrated = await rehydrateSessionUser({
    id: 'phase9-legacy-manager',
    userType: 'platform_staff',
    email: 'phase9-legacy-manager@example.com',
    name: 'Legacy Manager',
    slug: '',
  })
  assert.equal(staleRehydrated, null)
})

test('phase4 smoke covers root create-child, upward denial, delegated global visibility, and override edit permission', async () => {
  const rootUserId = await getRootUserId()
  await seedEmpresa({ empresaId: 'phase9-empresa-1', slug: 'phase9-empresa-1' })
  await seedComprador('phase9-comprador-1', 'phase9-empresa-1')
  await seedEventoConCategoria({ eventoId: 'phase9-evento-1', empresaId: 'phase9-empresa-1', categoriaId: 'phase9-categoria-1' })
  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO entradas (id, evento_id, categoria_id, comprador_id, qr_code, clave_corta, estado, precio_pagado, comision, created_at)
    VALUES ('phase9-entrada-1', 'phase9-evento-1', 'phase9-categoria-1', 'phase9-comprador-1', 'phase9-qr-1', 'PH94001', 'valida', 150, 21, NOW())
  `)

  const app = express()
  app.use(express.json())
  app.use('/api/platform', platformRouter)
  const server = await createTestServer(app)

  try {
    const createChild = await requestJson('POST', `${server.baseUrl}/api/platform/usuarios`, {
      nombre: 'Phase9 Global Child',
      email: 'phase9-global-child@example.com',
      loginAlias: 'phase9-global-child',
      password: 'ValidPass123!',
      roleSlug: 'staff',
      parentUserId: rootUserId,
      capabilities: [
        'platform.users.read',
        'platform.revenue.view.own',
        'platform.revenue.view.global',
        'platform.companies.read',
        'platform.companies.overrides.edit',
      ],
      revenueGrants: { entradas: 0, consumibles: 0 },
      activo: true,
    }, buildPlatformUser(rootUserId, 'super_admin'))

    assert.equal(createChild.status, 201)
    const childUserId = (createChild.data as any).data.usuario.id as string

    const denyUpward = await requestJson('PATCH', `${server.baseUrl}/api/platform/usuarios/${rootUserId}`, {
      nombre: 'No debería poder',
    }, buildPlatformUser(childUserId))
    assert.equal(denyUpward.status, 403)

    const dashboard = await requestJson('GET', `${server.baseUrl}/api/platform/dashboard`, undefined, buildPlatformUser(childUserId))
    assert.equal(dashboard.status, 200)
    assert.equal((dashboard.data as any).data.viewerScope, 'global')
    assert.equal((dashboard.data as any).data.metricas.gananciasOwner >= 21, true)

    const overrideEdit = await requestJson('PATCH', `${server.baseUrl}/api/platform/empresas/phase9-empresa-1/fees`, {
      flow: 'entradas',
      marketplaceFeeMode: 'percentage',
      marketplaceFeePercentage: 12,
      marketplaceFeeFixedAmount: null,
    }, buildPlatformUser(childUserId))
    assert.equal(overrideEdit.status, 200)
  } finally {
    await server.close()
  }
})
