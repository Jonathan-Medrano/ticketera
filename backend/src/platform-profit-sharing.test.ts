import assert from 'node:assert/strict'
import { after, before, beforeEach, test } from 'node:test'
import pool from './db'
import { createPlatformUser, updatePlatformUser } from './lib/platform-governance'
import {
  getPlatformAllocationMetricsByFlow,
  getPlatformProfitSharingOverview,
  persistPlatformAllocations,
  resolvePlatformAllocations,
  reversePlatformAllocationsForSources,
} from './lib/platform-profit-sharing'

async function cleanupTestData() {
  await pool.query(`DELETE FROM platform_admin_revenue_grants WHERE child_platform_admin_user_id != (SELECT id FROM (SELECT id FROM platform_admin_users WHERE singleton_key = 'superadmin' LIMIT 1) root)`)
  await pool.query(`DELETE FROM platform_admin_capability_grants WHERE platform_admin_user_id != (SELECT id FROM (SELECT id FROM platform_admin_users WHERE singleton_key = 'superadmin' LIMIT 1) root)`)
  await pool.query(`DELETE FROM platform_admin_closure WHERE descendant_platform_admin_user_id != ancestor_platform_admin_user_id OR ancestor_platform_admin_user_id != (SELECT id FROM (SELECT id FROM platform_admin_users WHERE singleton_key = 'superadmin' LIMIT 1) root)`)
  await pool.query(`DELETE FROM platform_admin_relationships WHERE platform_admin_user_id != (SELECT id FROM (SELECT id FROM platform_admin_users WHERE singleton_key = 'superadmin' LIMIT 1) root)`)
  await pool.query(`DELETE FROM platform_admin_user_flow_shares WHERE platform_admin_user_id != (SELECT id FROM (SELECT id FROM platform_admin_users WHERE singleton_key = 'superadmin' LIMIT 1) root)`)
  await pool.query(`DELETE FROM platform_payment_accounts WHERE platform_admin_user_id != (SELECT id FROM (SELECT id FROM platform_admin_users WHERE singleton_key = 'superadmin' LIMIT 1) root)`)
  await pool.query(`DELETE FROM platform_admin_users WHERE singleton_key IS NULL`)
  await pool.query(`DELETE FROM platform_admin_revenue_grants WHERE child_platform_admin_user_id LIKE 'phase6-%' OR parent_platform_admin_user_id LIKE 'phase6-%'`)
  await pool.query(`DELETE FROM platform_admin_capability_grants WHERE platform_admin_user_id LIKE 'phase6-%' OR granted_by_platform_admin_user_id LIKE 'phase6-%'`)
  await pool.query(`DELETE FROM platform_admin_closure WHERE ancestor_platform_admin_user_id LIKE 'phase6-%' OR descendant_platform_admin_user_id LIKE 'phase6-%'`)
  await pool.query(`DELETE FROM platform_admin_relationships WHERE platform_admin_user_id LIKE 'phase6-%'`)
  await pool.query(`DELETE FROM platform_sale_allocations WHERE empresa_id LIKE 'phase6-%' OR checkout_session_id LIKE 'phase6-%'`)
  await pool.query(`
    DELETE FROM platform_admin_user_flow_shares
    WHERE platform_admin_user_id IN (
      SELECT id FROM (
        SELECT id
        FROM platform_admin_users
        WHERE email LIKE 'phase6-%' OR login_alias LIKE 'phase6-%'
      ) phase6_users
    )
  `)
  await pool.query(`
    DELETE FROM platform_payment_accounts
    WHERE platform_admin_user_id IN (
      SELECT id FROM (
        SELECT id
        FROM platform_admin_users
        WHERE email LIKE 'phase6-%' OR login_alias LIKE 'phase6-%'
      ) phase6_users
    )
  `)
  await pool.query(`DELETE FROM platform_admin_users WHERE id LIKE 'phase6-%' OR email LIKE 'phase6-%' OR login_alias LIKE 'phase6-%'`)
}

async function getRootUserId() {
  const [rows] = await pool.query<any[]>(`SELECT id FROM platform_admin_users WHERE singleton_key = 'superadmin' LIMIT 1`)
  return String(rows[0].id)
}

beforeEach(async () => {
  await cleanupTestData()
})

after(async () => {
  await cleanupTestData()
  await pool.end()
})

test('profit sharing keeps configured percentage and falls back to singleton when staff has no MP account', async () => {
  const rootUserId = await getRootUserId()
  const staff = await createPlatformUser({
    nombre: 'Phase6 Staff',
    email: 'phase6-staff@example.com',
    loginAlias: 'phase6-staff',
    password: 'ValidPass123!',
    roleSlug: 'staff',
    permisos: { platform_dashboard: true },
    shareByFlow: { entradas: 30, consumibles: 0 },
    activo: true,
  })

  const allocations = await resolvePlatformAllocations({
    flow: 'entradas',
    totalOwnerFeeAmount: 100,
    sales: [{
      sourceType: 'entrada',
      sourceId: 'phase6-entry-1',
      amountWeight: 100,
      checkoutSessionId: 'phase6-checkout-1',
      empresaId: 'phase6-empresa-1',
    }],
  })

  const configuredStaffAllocation = allocations.find((allocation) => allocation.configuredPlatformAdminUserId === staff.id)
  const remainderAllocation = allocations.find((allocation) => allocation.configuredPlatformAdminUserId === rootUserId)

  assert.ok(configuredStaffAllocation)
  assert.equal(configuredStaffAllocation?.allocatedAmount, 30)
  assert.equal(configuredStaffAllocation?.effectivePlatformAdminUserId, remainderAllocation?.effectivePlatformAdminUserId)
  assert.equal(configuredStaffAllocation?.fallbackReason, 'missing_payment_account')
  assert.equal(remainderAllocation?.allocatedAmount, 70)
})

test('profit sharing lets a parent delegate within its own bag', async () => {
  const rootUserId = await getRootUserId()
  const manager = await createPlatformUser({
    nombre: 'Phase6 Manager',
    email: 'phase6-manager@example.com',
    loginAlias: 'phase6-manager',
    password: 'ValidPass123!',
    roleSlug: 'staff',
    capabilities: ['platform.users.read', 'platform.users.write', 'platform.users.capabilities.grant', 'platform.revenue.view.own', 'platform.revenue.view.branch'],
    revenueGrants: { entradas: 40, consumibles: 0 },
    activo: true,
  }, { actorUserId: rootUserId })

  const child = await createPlatformUser({
    nombre: 'Phase6 Child',
    email: 'phase6-child@example.com',
    loginAlias: 'phase6-child',
    password: 'ValidPass123!',
    roleSlug: 'staff',
    capabilities: ['platform.revenue.view.own'],
    revenueGrants: { entradas: 5, consumibles: 0 },
    activo: true,
  }, { actorUserId: manager.id })

  const overview = await getPlatformProfitSharingOverview()
  const managerSummary = overview.users.find((user) => user.userId === manager.id)
  const childSummary = overview.users.find((user) => user.userId === child.id)

  assert.equal(managerSummary?.configuredShareByFlow.entradas, 35)
  assert.equal(childSummary?.configuredShareByFlow.entradas, 5)
  assert.equal(overview.totalsByFlow.entradas.assignedPercentage, 40)
  assert.equal(overview.totalsByFlow.entradas.remainderPercentage, 60)
})

test('profit sharing blocks overdelegation beyond the parent bag', async () => {
  const rootUserId = await getRootUserId()
  const manager = await createPlatformUser({
    nombre: 'Phase6 Limited Manager',
    email: 'phase6-limited-manager@example.com',
    loginAlias: 'phase6-limited-manager',
    password: 'ValidPass123!',
    roleSlug: 'staff',
    capabilities: ['platform.users.read', 'platform.users.write', 'platform.users.capabilities.grant', 'platform.revenue.view.own'],
    revenueGrants: { entradas: 40, consumibles: 0 },
    activo: true,
  }, { actorUserId: rootUserId })

  await assert.rejects(
    () => createPlatformUser({
      nombre: 'Phase6 Too Much Child',
      email: 'phase6-too-much-child@example.com',
      loginAlias: 'phase6-too-much-child',
      password: 'ValidPass123!',
      roleSlug: 'staff',
      capabilities: ['platform.revenue.view.own'],
      revenueGrants: { entradas: 50, consumibles: 0 },
      activo: true,
    }, { actorUserId: manager.id }),
    (error: unknown) => error instanceof Error && String(error.message).includes('No podés delegar más de 40% en entradas')
  )
})

test('profit sharing keeps user updates transactional when a child overdelegates', async () => {
  const rootUserId = await getRootUserId()
  const manager = await createPlatformUser({
    nombre: 'Phase6 Guard Manager',
    email: 'phase6-guard-manager@example.com',
    loginAlias: 'phase6-guard-manager',
    password: 'ValidPass123!',
    roleSlug: 'staff',
    capabilities: ['platform.users.read', 'platform.users.write', 'platform.users.capabilities.grant', 'platform.revenue.view.own'],
    revenueGrants: { entradas: 40, consumibles: 0 },
    activo: true,
  }, { actorUserId: rootUserId })
  const child = await createPlatformUser({
    nombre: 'Phase6 Guard Child',
    email: 'phase6-guard-child@example.com',
    loginAlias: 'phase6-guard-child',
    password: 'ValidPass123!',
    roleSlug: 'staff',
    capabilities: ['platform.revenue.view.own'],
    revenueGrants: { entradas: 10, consumibles: 0 },
    activo: true,
  }, { actorUserId: manager.id })

  await assert.rejects(
    () => updatePlatformUser(child.id, {
      nombre: 'No debería persistir',
      revenueGrants: { entradas: 45, consumibles: 0 },
    }, { actorUserId: manager.id }),
    /No podés delegar más de 40%/
  )

  const [rows] = await pool.query<any[]>(`SELECT nombre FROM platform_admin_users WHERE id = ?`, [child.id])
  assert.equal(rows[0].nombre, 'Phase6 Guard Child')
})

test('profit sharing bubbles descendant fallback to the nearest ready ancestor', async () => {
  const rootUserId = await getRootUserId()
  const manager = await createPlatformUser({
    nombre: 'Phase6 Ready Manager',
    email: 'phase6-ready-manager@example.com',
    loginAlias: 'phase6-ready-manager',
    password: 'ValidPass123!',
    roleSlug: 'staff',
    capabilities: ['platform.users.read', 'platform.users.write', 'platform.users.capabilities.grant', 'platform.revenue.view.own', 'platform.revenue.view.branch'],
    revenueGrants: { entradas: 40, consumibles: 0 },
    activo: true,
  }, { actorUserId: rootUserId })
  const child = await createPlatformUser({
    nombre: 'Phase6 Ready Child',
    email: 'phase6-ready-child@example.com',
    loginAlias: 'phase6-ready-child',
    password: 'ValidPass123!',
    roleSlug: 'staff',
    capabilities: ['platform.revenue.view.own'],
    revenueGrants: { entradas: 5, consumibles: 0 },
    activo: true,
  }, { actorUserId: manager.id })

  await pool.query(
    `INSERT INTO platform_payment_accounts (
      id, platform_admin_user_id, provider, status, reason,
      credential_ciphertext, credential_iv, credential_tag, credential_last4,
      provider_account_label, validated_at, blocked_at
    ) VALUES (?, ?, 'mercadopago', 'ready_to_sell', NULL, 'cipher', 'iv', 'tag', '9999', 'Manager ready', NOW(), NULL)`,
    [`${manager.id}-account`, manager.id]
  )

  const allocations = await resolvePlatformAllocations({
    flow: 'entradas',
    totalOwnerFeeAmount: 100,
    sales: [{
      sourceType: 'entrada',
      sourceId: 'phase6-entry-hierarchy-1',
      amountWeight: 100,
      checkoutSessionId: 'phase6-checkout-hierarchy-1',
      empresaId: 'phase6-empresa-hierarchy-1',
    }],
  })

  const childAllocation = allocations.find((allocation) => allocation.configuredPlatformAdminUserId === child.id)
  const managerRetained = allocations.find((allocation) => allocation.configuredPlatformAdminUserId === manager.id)
  const rootRetained = allocations.find((allocation) => allocation.configuredPlatformAdminUserId === rootUserId)

  assert.equal(childAllocation?.allocatedAmount, 5)
  assert.equal(childAllocation?.effectivePlatformAdminUserId, manager.id)
  assert.equal(childAllocation?.fallbackReason, 'missing_payment_account')
  assert.equal(managerRetained?.allocatedAmount, 35)
  assert.equal(managerRetained?.effectivePlatformAdminUserId, manager.id)
  assert.equal(rootRetained?.allocatedAmount, 60)
})

test('profit sharing stores auditable reversals without duplicating them and reporting nets them out', async () => {
  await persistPlatformAllocations(await resolvePlatformAllocations({
    flow: 'entradas',
    totalOwnerFeeAmount: 100,
    sales: [{
      sourceType: 'entrada',
      sourceId: 'phase6-entry-reversal-1',
      amountWeight: 100,
      checkoutSessionId: 'phase6-checkout-reversal-1',
      empresaId: 'phase6-empresa-reversal-1',
    }],
  }))

  await reversePlatformAllocationsForSources({
    sourceType: 'entrada',
    sourceIds: ['phase6-entry-reversal-1'],
    empresaId: 'phase6-empresa-reversal-1',
    reason: 'manual_refund_executed',
    referenceType: 'refund_manual_case',
    referenceId: 'phase6-refund-case-1',
  })
  await reversePlatformAllocationsForSources({
    sourceType: 'entrada',
    sourceIds: ['phase6-entry-reversal-1'],
    empresaId: 'phase6-empresa-reversal-1',
    reason: 'manual_refund_executed',
    referenceType: 'refund_manual_case',
    referenceId: 'phase6-refund-case-1',
  })

  const [rows] = await pool.query<any[]>(
    `SELECT id, entry_kind, allocated_amount, reversal_for_allocation_id, reversal_reason, reversal_reference_type, reversal_reference_id,
            configured_platform_admin_user_id, effective_platform_admin_user_id, fallback_reason
     FROM platform_sale_allocations
     WHERE checkout_session_id = ?
     ORDER BY entry_kind ASC, created_at ASC, id ASC`,
    ['phase6-checkout-reversal-1']
  )

  assert.equal(rows.length, 2)
  assert.equal(rows[0].entry_kind, 'allocation')
  assert.equal(Number(rows[0].allocated_amount), 100)
  assert.equal(rows[1].entry_kind, 'reversal')
  assert.equal(Number(rows[1].allocated_amount), -100)
  assert.equal(rows[1].reversal_for_allocation_id, rows[0].id)
  assert.equal(rows[1].reversal_reason, 'manual_refund_executed')
  assert.equal(rows[1].reversal_reference_type, 'refund_manual_case')
  assert.equal(rows[1].reversal_reference_id, 'phase6-refund-case-1')
  assert.equal(rows[1].configured_platform_admin_user_id, rows[0].configured_platform_admin_user_id)
  assert.equal(rows[1].effective_platform_admin_user_id, rows[0].effective_platform_admin_user_id)
  assert.equal(rows[1].fallback_reason, rows[0].fallback_reason)

  const metrics = await getPlatformAllocationMetricsByFlow()
  assert.equal(metrics.entradas.gananciasOwner, 0)
  assert.equal(metrics.entradas.ventasTotales, 0)

  const overview = await getPlatformProfitSharingOverview()
  assert.equal(overview.totalsByFlow.entradas.ownerFeeTotal, 0)
  assert.ok(overview.cutoff.startsAt)
  assert.equal(overview.cutoff.source, 'first_allocation')
})

test('profit sharing derives a global cutoff from the first allocation and keeps it for staff views', async () => {
  const staff = await createPlatformUser({
    nombre: 'Phase6 Cutoff Staff',
    email: 'phase6-cutoff-staff@example.com',
    loginAlias: 'phase6-cutoff-staff',
    password: 'ValidPass123!',
    roleSlug: 'staff',
    permisos: { platform_dashboard: true },
    shareByFlow: { entradas: 0, consumibles: 0 },
    activo: true,
  })

  await persistPlatformAllocations([
    {
      sourceType: 'entrada',
      sourceId: 'phase6-cutoff-entry-1',
      checkoutSessionId: 'phase6-cutoff-checkout-1',
      empresaId: 'phase6-cutoff-empresa-1',
      flow: 'entradas',
      currency: 'ARS',
      ownerFeeAmount: 100,
      allocatedAmount: 25,
      allocationPercentage: 25,
      configuredPlatformAdminUserId: staff.id,
      effectivePlatformAdminUserId: staff.id,
      fallbackReason: 'none',
    },
  ])

  await pool.query(`UPDATE platform_sale_allocations SET created_at = '2026-05-10 09:15:00' WHERE checkout_session_id = ?`, ['phase6-cutoff-checkout-1'])

  const overview = await getPlatformProfitSharingOverview()
  const staffOverview = await getPlatformProfitSharingOverview(staff.id)

  assert.match(overview.cutoff.startsAt ?? '', /^2026-05-10T/)
  assert.deepEqual(staffOverview.cutoff, overview.cutoff)
})
