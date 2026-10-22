import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import type { Express } from 'express'
import express from 'express'
process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

import pool from './db'
import {
  createPlatformUser,
  deletePlatformUser,
  updatePlatformUser,
} from './lib/platform-governance'
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
  const [rows] = await pool.query<any[]>(`SELECT id FROM platform_admin_users WHERE singleton_key = 'superadmin' LIMIT 1`)
  return String(rows[0].id)
}

async function seedEmpresa(empresaId: string) {
  await pool.query(
    `INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
     VALUES (?, ?, ?, ?, ?, ?, true)`,
    [empresaId, `Empresa ${empresaId}`, `${empresaId}-slug`, `${empresaId}@example.com`, TEST_PASSWORD_HASH, `Admin ${empresaId}`]
  )
}

async function cleanupTestData() {
  await pool.query(`DELETE FROM empresa_marketplace_fee_overrides WHERE empresa_id LIKE 'phase8-%'`)
  await pool.query(`DELETE FROM empresas WHERE id LIKE 'phase8-%' OR slug LIKE 'phase8-%'`)
  await pool.query(`DELETE FROM platform_admin_revenue_grants WHERE child_platform_admin_user_id != (SELECT id FROM (SELECT id FROM platform_admin_users WHERE singleton_key = 'superadmin' LIMIT 1) root)`)
  await pool.query(`DELETE FROM platform_admin_capability_grants WHERE platform_admin_user_id != (SELECT id FROM (SELECT id FROM platform_admin_users WHERE singleton_key = 'superadmin' LIMIT 1) root)`)
  await pool.query(`DELETE FROM platform_admin_closure WHERE descendant_platform_admin_user_id != ancestor_platform_admin_user_id OR ancestor_platform_admin_user_id != (SELECT id FROM (SELECT id FROM platform_admin_users WHERE singleton_key = 'superadmin' LIMIT 1) root)`)
  await pool.query(`DELETE FROM platform_admin_relationships WHERE platform_admin_user_id != (SELECT id FROM (SELECT id FROM platform_admin_users WHERE singleton_key = 'superadmin' LIMIT 1) root)`)
  await pool.query(`DELETE FROM platform_admin_user_flow_shares WHERE platform_admin_user_id != (SELECT id FROM (SELECT id FROM platform_admin_users WHERE singleton_key = 'superadmin' LIMIT 1) root)`)
  await pool.query(`DELETE FROM platform_payment_accounts WHERE platform_admin_user_id != (SELECT id FROM (SELECT id FROM platform_admin_users WHERE singleton_key = 'superadmin' LIMIT 1) root)`)
  await pool.query(`DELETE FROM platform_admin_users WHERE singleton_key IS NULL`)
  await pool.query(`DELETE FROM platform_sale_allocations WHERE empresa_id LIKE 'phase8-%' OR checkout_session_id LIKE 'phase8-%'`)
  await pool.query(`DELETE FROM platform_admin_revenue_grants WHERE child_platform_admin_user_id LIKE 'phase8-%' OR parent_platform_admin_user_id LIKE 'phase8-%'`)
  await pool.query(`DELETE FROM platform_admin_capability_grants WHERE platform_admin_user_id LIKE 'phase8-%' OR granted_by_platform_admin_user_id LIKE 'phase8-%'`)
  await pool.query(`DELETE FROM platform_admin_closure WHERE ancestor_platform_admin_user_id LIKE 'phase8-%' OR descendant_platform_admin_user_id LIKE 'phase8-%'`)
  await pool.query(`DELETE FROM platform_admin_relationships WHERE platform_admin_user_id LIKE 'phase8-%'`)
  await pool.query(`DELETE FROM platform_admin_user_flow_shares WHERE platform_admin_user_id LIKE 'phase8-%' OR configured_by_platform_admin_id LIKE 'phase8-%'`)
  await pool.query(`DELETE FROM platform_payment_accounts WHERE platform_admin_user_id LIKE 'phase8-%'`)
  await pool.query(`DELETE FROM platform_admin_users WHERE id LIKE 'phase8-%' OR email LIKE 'phase8-%' OR login_alias LIKE 'phase8-%'`)
}


beforeEach(async () => {
  await cleanupTestData()
})

after(async () => {
  await cleanupTestData()
  await pool.end()
})

test('governance CRUD enforces descendant-only management and blocks ancestor/cross-branch edits', async () => {
  const rootUserId = await getRootUserId()
  const branchManager = await createPlatformUser({
    nombre: 'Phase8 Branch Manager',
    email: 'phase8-branch-manager@example.com',
    loginAlias: 'phase8-branch-manager',
    password: 'ValidPass123!',
    roleSlug: 'staff',
    capabilities: ['platform.users.read', 'platform.users.write', 'platform.users.capabilities.grant', 'platform.revenue.view.own', 'platform.revenue.view.branch'],
    revenueGrants: { entradas: 30, consumibles: 0 },
    activo: true,
  }, { actorUserId: rootUserId })
  const siblingManager = await createPlatformUser({
    nombre: 'Phase8 Sibling Manager',
    email: 'phase8-sibling-manager@example.com',
    loginAlias: 'phase8-sibling-manager',
    password: 'ValidPass123!',
    roleSlug: 'staff',
    capabilities: ['platform.users.read', 'platform.users.write', 'platform.users.capabilities.grant', 'platform.revenue.view.own', 'platform.revenue.view.branch'],
    revenueGrants: { entradas: 20, consumibles: 0 },
    activo: true,
  }, { actorUserId: rootUserId })

  const child = await createPlatformUser({
    nombre: 'Phase8 Child User',
    email: 'phase8-child-user@example.com',
    loginAlias: 'phase8-child-user',
    password: 'ValidPass123!',
    roleSlug: 'staff',
    capabilities: ['platform.revenue.view.own'],
    revenueGrants: { entradas: 5, consumibles: 0 },
    activo: true,
  }, { actorUserId: branchManager.id })

  const updated = await updatePlatformUser(child.id, { nombre: 'Phase8 Child Updated' }, { actorUserId: branchManager.id })
  assert.equal(updated.nombre, 'Phase8 Child Updated')
  assert.equal(updated.parentUserId, branchManager.id)
  assert.equal(updated.branchRootUserId, branchManager.id)

  await assert.rejects(
    () => updatePlatformUser(branchManager.id, { nombre: 'Nope' }, { actorUserId: child.id }),
    /descendientes/
  )

  await assert.rejects(
    () => updatePlatformUser(siblingManager.id, { nombre: 'Cross branch nope' }, { actorUserId: branchManager.id }),
    /descendientes/
  )

  await assert.rejects(
    () => deletePlatformUser(branchManager.id, { actorUserId: rootUserId }),
    /descendientes activos/
  )
})

test('platform routes enforce capability guards and scoped dashboard visibility', async () => {
  const rootUserId = await getRootUserId()
  await seedEmpresa('phase8-empresa-1')

  const branchViewer = await createPlatformUser({
    nombre: 'Phase8 Branch Viewer',
    email: 'phase8-branch-viewer@example.com',
    loginAlias: 'phase8-branch-viewer',
    password: 'ValidPass123!',
    roleSlug: 'staff',
    capabilities: ['platform.users.read', 'platform.users.write', 'platform.users.capabilities.grant', 'platform.revenue.view.own', 'platform.revenue.view.branch'],
    revenueGrants: { entradas: 25, consumibles: 0 },
    activo: true,
  }, { actorUserId: rootUserId })
  const child = await createPlatformUser({
    nombre: 'Phase8 Branch Child',
    email: 'phase8-branch-child@example.com',
    loginAlias: 'phase8-branch-child',
    password: 'ValidPass123!',
    roleSlug: 'staff',
    capabilities: ['platform.revenue.view.own'],
    revenueGrants: { entradas: 5, consumibles: 0 },
    activo: true,
  }, { actorUserId: branchViewer.id })
  const overrideEditor = await createPlatformUser({
    nombre: 'Phase8 Override Editor',
    email: 'phase8-override-editor@example.com',
    loginAlias: 'phase8-override-editor',
    password: 'ValidPass123!',
    roleSlug: 'staff',
    capabilities: ['platform.companies.overrides.edit', 'platform.revenue.view.global'],
    revenueGrants: { entradas: 0, consumibles: 0 },
    activo: true,
  }, { actorUserId: rootUserId })

  await pool.query(
    `INSERT INTO platform_sale_allocations (
      id, source_type, source_id, checkout_session_id, empresa_id, flow, currency,
      owner_fee_amount, allocated_amount, allocation_percentage,
      entry_kind, reversal_for_allocation_id, reversal_reason, reversal_reference_type, reversal_reference_id,
      configured_platform_admin_user_id, effective_platform_admin_user_id, fallback_reason
    ) VALUES (?, 'entrada', ?, ?, ?, 'entradas', 'ARS', 100, 5, 5, 'allocation', NULL, NULL, NULL, NULL, ?, ?, 'none')`,
    ['phase8-allocation-1', 'phase8-source-1', 'phase8-checkout-1', 'phase8-empresa-1', child.id, child.id]
  )

  const app = express()
  app.use(express.json())
  app.use('/api/platform', platformRouter)
  const server = await createTestServer(app)

  try {
    const dashboard = await requestJson('GET', `${server.baseUrl}/api/platform/dashboard`, undefined, buildPlatformUser(branchViewer.id))
    assert.equal(dashboard.status, 200)
    assert.equal((dashboard.data as any).data.viewerScope, 'branch')
    assert.equal((dashboard.data as any).data.metricas.gananciasOwner, 5)

    const denyOverride = await requestJson('PATCH', `${server.baseUrl}/api/platform/empresas/phase8-empresa-1/fees`, {
      flow: 'entradas',
      marketplaceFeeMode: 'percentage',
      marketplaceFeePercentage: 12,
      marketplaceFeeFixedAmount: null,
    }, buildPlatformUser(branchViewer.id))
    assert.equal(denyOverride.status, 403)

    const allowOverride = await requestJson('PATCH', `${server.baseUrl}/api/platform/empresas/phase8-empresa-1/fees`, {
      flow: 'entradas',
      marketplaceFeeMode: 'percentage',
      marketplaceFeePercentage: 12,
      marketplaceFeeFixedAmount: null,
    }, buildPlatformUser(overrideEditor.id))
    assert.equal(allowOverride.status, 200)
  } finally {
    await server.close()
  }
})
