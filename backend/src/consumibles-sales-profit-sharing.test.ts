import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import pool from './db'
import { cancelPendingConsumableSale } from './lib/consumibles-sales'
import { persistPlatformAllocations, resolvePlatformAllocations } from './lib/platform-profit-sharing'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'

async function cleanup() {
  await pool.query(`DELETE FROM platform_sale_allocations WHERE empresa_id LIKE 'phase10-%' OR checkout_session_id LIKE 'phase10-%' OR reversal_reference_id LIKE 'phase10-%'`)
  await pool.query(`DELETE FROM consumibles_venta_items WHERE id LIKE 'phase10-%' OR venta_id LIKE 'phase10-%' OR consumible_id LIKE 'phase10-%'`)
  await pool.query(`DELETE FROM consumibles_ventas WHERE id LIKE 'phase10-%' OR empresa_id LIKE 'phase10-%' OR comprador_id LIKE 'phase10-%' OR checkout_session_id LIKE 'phase10-%'`)
  await pool.query(`DELETE FROM barra_stock WHERE id LIKE 'phase10-%' OR barra_id LIKE 'phase10-%' OR consumible_id LIKE 'phase10-%'`)
  await pool.query(`DELETE FROM consumibles WHERE id LIKE 'phase10-%' OR empresa_id LIKE 'phase10-%'`)
  await pool.query(`DELETE FROM barras WHERE id LIKE 'phase10-%' OR empresa_id LIKE 'phase10-%'`)
  await pool.query(`DELETE FROM checkout_sessions WHERE id LIKE 'phase10-%' OR empresa_id LIKE 'phase10-%' OR comprador_id LIKE 'phase10-%'`)
  await pool.query(`DELETE FROM eventos WHERE id LIKE 'phase10-%' OR empresa_id LIKE 'phase10-%'`)
  await pool.query(`DELETE FROM compradores WHERE id LIKE 'phase10-%' OR empresa_id LIKE 'phase10-%'`)
  await pool.query(`DELETE FROM empresas WHERE id LIKE 'phase10-%' OR slug LIKE 'phase10-%'`)
}

async function seedConsumibleSaleContext() {
  await pool.query(
    `INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
     VALUES ('phase10-emp-1', 'Empresa phase10', 'phase10-1', 'phase10@example.com', ?, 'Admin phase10', true)`,
    [TEST_PASSWORD_HASH]
  )
  await pool.query(`INSERT INTO compradores (id, empresa_id, nombre, email, dni, password) VALUES ('phase10-cmp-1', 'phase10-emp-1', 'Comprador phase10', 'phase10-cmp@example.com', 'dni-phase10', ?)`, [TEST_PASSWORD_HASH])
  await pool.query(`INSERT INTO eventos (id, empresa_id, nombre, descripcion, lugar, modo_fecha, imagen_url, activo) VALUES ('phase10-evt-1', 'phase10-emp-1', 'Evento phase10', NULL, NULL, 'unica', NULL, true)`)
  await pool.query(`INSERT INTO barras (id, evento_id, empresa_id, nombre, activa) VALUES ('phase10-bar-1', 'phase10-evt-1', 'phase10-emp-1', 'Barra phase10', true)`)
  await pool.query(`INSERT INTO consumibles (id, empresa_id, nombre, descripcion, precio, activo) VALUES ('phase10-cons-1', 'phase10-emp-1', 'Agua', NULL, 300, true)`)
  await pool.query(`INSERT INTO barra_stock (id, barra_id, consumible_id, stock_inicial, stock_actual, precio_override, activo) VALUES ('phase10-stock-1', 'phase10-bar-1', 'phase10-cons-1', 10, 8, NULL, true)`)
  await pool.query(
    `INSERT INTO checkout_sessions
     (id, comprador_id, empresa_id, datos, estado, payment_id, payment_status, reconciliation_status, confirmed_at, expires_at, created_at)
     VALUES ('phase10-session-1', 'phase10-cmp-1', 'phase10-emp-1', ?, 'confirmada', 'mp-phase10-1', 'approved', 'reconciled', NOW(), NOW() + INTERVAL '10 minutes', NOW())`,
    [JSON.stringify({ flow: 'consumibles', items: [{ consumibleId: 'phase10-cons-1', nombre: 'Agua', precio: 300, cantidad: 2 }], marketplaceFee: { amount: 60, currency: 'ARS' } })]
  )
  await pool.query(
    `INSERT INTO consumibles_ventas
     (id, barra_id, evento_id, empresa_id, comprador_id, checkout_session_id, origen, qr_code, clave_corta, total, estado, owner_fee_amount)
     VALUES ('phase10-venta-1', 'phase10-bar-1', 'phase10-evt-1', 'phase10-emp-1', 'phase10-cmp-1', 'phase10-session-1', 'tenant_publico', 'qr-phase10', 'PH10CV', 600, 'pendiente', 60)`
  )
  await pool.query(`INSERT INTO consumibles_venta_items (id, venta_id, consumible_id, nombre_snapshot, precio_unitario, cantidad, subtotal) VALUES ('phase10-item-1', 'phase10-venta-1', 'phase10-cons-1', 'Agua', 300, 2, 600)`)

  await persistPlatformAllocations(await resolvePlatformAllocations({
    flow: 'consumibles',
    totalOwnerFeeAmount: 60,
    currency: 'ARS',
    sales: [{
      sourceType: 'consumible_venta',
      sourceId: 'phase10-venta-1',
      amountWeight: 600,
      checkoutSessionId: 'phase10-session-1',
      empresaId: 'phase10-emp-1',
    }],
  }))
}

beforeEach(async () => {
  await cleanup()
  await seedConsumibleSaleContext()
})

after(async () => {
  await cleanup()
  await pool.end()
})

test('cancel pending consumable sale creates a single reversal ledger and keeps metrics netted', async () => {
  // Migrated from legacy PoolConnection path (Phase 4 A2) — cancelPendingConsumableSale
  // now owns its own Prisma transaction and triggers platform allocation reversal post-commit.
  const result = await cancelPendingConsumableSale({
    ventaId: 'phase10-venta-1',
    empresaId: 'phase10-emp-1',
  })

  assert.equal(result.ok, true)

  const [rows] = await pool.query<any[]>(
    `SELECT id, entry_kind, allocated_amount, reversal_for_allocation_id, reversal_reason, reversal_reference_type, reversal_reference_id
     FROM platform_sale_allocations
     WHERE source_type = 'consumible_venta' AND source_id = 'phase10-venta-1'
     ORDER BY entry_kind ASC, created_at ASC, id ASC`
  )

  assert.equal(rows.length, 2)
  assert.equal(rows[0].entry_kind, 'allocation')
  assert.equal(rows[1].entry_kind, 'reversal')
  assert.equal(Number(rows[1].allocated_amount), -Number(rows[0].allocated_amount))
  assert.equal(rows[1].reversal_for_allocation_id, rows[0].id)
  assert.equal(rows[1].reversal_reason, 'consumible_sale_cancelled')
  assert.equal(rows[1].reversal_reference_type, 'consumible_sale_cancel')
  assert.equal(rows[1].reversal_reference_id, 'phase10-venta-1')

  const [saleRows] = await pool.query<any[]>(`SELECT estado FROM consumibles_ventas WHERE id = 'phase10-venta-1'`)
  const [stockRows] = await pool.query<any[]>(`SELECT stock_actual FROM barra_stock WHERE id = 'phase10-stock-1'`)

  assert.equal(saleRows[0].estado, 'cancelado')
  assert.equal(stockRows[0].stock_actual, 10)
})
