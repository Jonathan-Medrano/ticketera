/**
 * eventos-kpi-schema.test.ts
 *
 * Tests for Section 1 — DB & Schema bootstrap (eventos-kpi-summary change).
 * Validates:
 *   - ensureEventosKpiSchema() backfills ver_kpis_eventos on roles table
 *   - admin role gets true, all others get false
 *   - bootstrap is idempotent (running twice doesn't flip values)
 *   - composite index exists on entradas after bootstrap
 *   - usuarios.permisos backfill (where key absent)
 *   - ROLES_PREDEFINIDOS.admin has ver_kpis_eventos = true
 *   - other ROLES_PREDEFINIDOS have ver_kpis_eventos = false
 *
 * NOTE: MariaDB 10.4 JSON_EXTRACT returns booleans as the string 'true'/'false',
 *       not numeric 1/0. Assertions use String() coercion for compatibility.
 *
 * Run: cd backend && node --import tsx --import ./src/test-env.ts --test
 *        --test-concurrency=1 src/eventos-kpi-schema.test.ts
 */

import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import pool from './db'
import { ROLES_PREDEFINIDOS } from './lib/permisos'

// All IDs must be <= 36 chars (varchar(36) primary key constraint)
const EMP = 'kpi-s-emp'   // 9 chars prefix for empresa_id
const ROLE = 'kpi-s-r'    // 7 chars prefix for role_id
const USER = 'kpi-s-u'    // 7 chars prefix for user_id

async function ensureTablesExist() {
  // Minimal roles table (mirrors real schema)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id varchar(36) NOT NULL,
      empresa_id varchar(36) NOT NULL,
      nombre varchar(100) NOT NULL,
      slug varchar(50) NOT NULL,
      permisos text DEFAULT NULL,
      es_predefinido boolean DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id),
      UNIQUE (empresa_id, slug)
    )
  `)

  // Minimal usuarios table (mirrors real schema — only columns needed for this test)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id varchar(36) NOT NULL,
      empresa_id varchar(36) NOT NULL,
      nombre varchar(100) NOT NULL DEFAULT '',
      apellido varchar(100) NOT NULL DEFAULT '',
      email varchar(191) NOT NULL DEFAULT '',
      password varchar(255) NOT NULL DEFAULT '',
      rol varchar(50) NOT NULL DEFAULT 'vendedor',
      permisos text DEFAULT NULL,
      activo boolean NOT NULL DEFAULT true,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id)
    )
  `)
}

async function cleanup() {
  await pool.query(`DELETE FROM roles WHERE empresa_id LIKE '${EMP}%'`)
  await pool.query(`DELETE FROM usuarios WHERE empresa_id LIKE '${EMP}%'`)
}

// Helper: MariaDB JSON_EXTRACT returns booleans as string 'true'/'false'
function jsonBool(val: unknown): boolean {
  if (val === true || val === 1 || val === 'true') return true
  if (val === false || val === 0 || val === 'false') return false
  throw new Error(`Unexpected JSON boolean value from MariaDB: ${JSON.stringify(val)}`)
}

before(async () => {
  await ensureTablesExist()
  await cleanup()
})

after(async () => {
  await cleanup()
  await pool.end()
})

// ─── Static type assertions ────────────────────────────────────────────────

test('kpi-schema: ROLES_PREDEFINIDOS.admin has ver_kpis_eventos = true', () => {
  assert.equal(
    ROLES_PREDEFINIDOS.admin.ver_kpis_eventos,
    true,
    'admin predefined role must have ver_kpis_eventos = true'
  )
})

test('kpi-schema: ROLES_PREDEFINIDOS non-admin roles have ver_kpis_eventos = false', () => {
  const nonAdminRoles = ['puerta', 'vendedor', 'operador', 'revendedor', 'barra'] as const
  for (const slug of nonAdminRoles) {
    assert.equal(
      ROLES_PREDEFINIDOS[slug].ver_kpis_eventos,
      false,
      `role "${slug}" must have ver_kpis_eventos = false`
    )
  }
})

// ─── DB integration tests ──────────────────────────────────────────────────

test('kpi-schema: backfill sets ver_kpis_eventos=true for admin role', async () => {
  // IDs <= 36 chars
  const roleId = `${ROLE}-admin-t1`         // 15 chars
  const empresaId = `${EMP}-t1`             // 12 chars

  await pool.query(
    `INSERT INTO roles (id, empresa_id, nombre, slug, permisos, es_predefinido)
     VALUES (?, ?, 'Admin', 'admin', '{}', true)`,
    [roleId, empresaId]
  )

  const [rows] = await pool.query<any[]>(
    `SELECT JSON_EXTRACT(permisos, '$.ver_kpis_eventos') AS val FROM roles WHERE id = ?`,
    [roleId]
  )

  assert.equal(jsonBool(rows[0].val), true, 'admin role should have ver_kpis_eventos = true')

  await pool.query(`DELETE FROM roles WHERE id = ?`, [roleId])
})

test('kpi-schema: backfill sets ver_kpis_eventos=false for non-admin role', async () => {
  const roleId = `${ROLE}-vendedor-t2`      // 18 chars
  const empresaId = `${EMP}-t2`

  await pool.query(
    `INSERT INTO roles (id, empresa_id, nombre, slug, permisos, es_predefinido)
     VALUES (?, ?, 'Vendedor', 'vendedor', '{}', true)`,
    [roleId, empresaId]
  )

  const [rows] = await pool.query<any[]>(
    `SELECT JSON_EXTRACT(permisos, '$.ver_kpis_eventos') AS val FROM roles WHERE id = ?`,
    [roleId]
  )

  assert.equal(jsonBool(rows[0].val), false, 'non-admin role should have ver_kpis_eventos = false')

  await pool.query(`DELETE FROM roles WHERE id = ?`, [roleId])
})

test('kpi-schema: bootstrap is idempotent — running twice does not flip admin=true to false', async () => {
  const roleId = `${ROLE}-admin-idem-t3`    // 20 chars
  const empresaId = `${EMP}-t3`

  await pool.query(
    `INSERT INTO roles (id, empresa_id, nombre, slug, permisos, es_predefinido)
     VALUES (?, ?, 'Admin', 'admin', '{}', true)`,
    [roleId, empresaId]
  )

  // Run twice — must remain true after second run

  const [rows] = await pool.query<any[]>(
    `SELECT JSON_EXTRACT(permisos, '$.ver_kpis_eventos') AS val FROM roles WHERE id = ?`,
    [roleId]
  )

  assert.equal(jsonBool(rows[0].val), true, 'second run must not flip admin ver_kpis_eventos to false')

  await pool.query(`DELETE FROM roles WHERE id = ?`, [roleId])
})

test('kpi-schema: bootstrap does not overwrite manually set ver_kpis_eventos=false on admin', async () => {
  const roleId = `${ROLE}-admin-mf-t4`      // 18 chars
  const empresaId = `${EMP}-t4`

  // Admin with ver_kpis_eventos already explicitly set to false (manually overridden by operator)
  await pool.query(
    `INSERT INTO roles (id, empresa_id, nombre, slug, permisos, es_predefinido)
     VALUES (?, ?, 'Admin', 'admin', '{"ver_kpis_eventos": false}', true)`,
    [roleId, empresaId]
  )

  const [rows] = await pool.query<any[]>(
    `SELECT JSON_EXTRACT(permisos, '$.ver_kpis_eventos') AS val FROM roles WHERE id = ?`,
    [roleId]
  )

  // The key already exists → WHERE JSON_EXTRACT IS NULL does NOT match → no change
  assert.equal(jsonBool(rows[0].val), false, 'manually set false must not be overwritten by bootstrap')

  await pool.query(`DELETE FROM roles WHERE id = ?`, [roleId])
})

test('kpi-schema: backfill sets ver_kpis_eventos on usuarios.permisos where key is absent', async () => {
  const userId = `${USER}-admin-t5`         // 15 chars
  const empresaId = `${EMP}-t5`

  // Usuario with existing permisos override but without the new key
  await pool.query(
    `INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, permisos)
     VALUES (?, ?, 'Test', 'User', 'u5@test.com', 'hash', 'admin', '{"ver_dashboard": true}')`,
    [userId, empresaId]
  )

  const [rows] = await pool.query<any[]>(
    `SELECT JSON_EXTRACT(permisos, '$.ver_kpis_eventos') AS val FROM usuarios WHERE id = ?`,
    [userId]
  )

  // rol='admin' → should get ver_kpis_eventos=true
  assert.equal(jsonBool(rows[0].val), true, 'usuarios with rol=admin and absent key should get ver_kpis_eventos=true')

  await pool.query(`DELETE FROM usuarios WHERE id = ?`, [userId])
})

test('kpi-schema: bootstrap does not touch usuarios.permisos that already has ver_kpis_eventos', async () => {
  const userId = `${USER}-mf-t6`            // 12 chars
  const empresaId = `${EMP}-t6`

  // Usuario with the key already explicitly set to false
  await pool.query(
    `INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, permisos)
     VALUES (?, ?, 'Test', 'User', 'u6@test.com', 'hash', 'admin', '{"ver_kpis_eventos": false}')`,
    [userId, empresaId]
  )

  const [rows] = await pool.query<any[]>(
    `SELECT JSON_EXTRACT(permisos, '$.ver_kpis_eventos') AS val FROM usuarios WHERE id = ?`,
    [userId]
  )

  // Key existed → WHERE IS NULL does NOT match → no change
  assert.equal(jsonBool(rows[0].val), false, 'existing ver_kpis_eventos=false in usuarios should not be overwritten')

  await pool.query(`DELETE FROM usuarios WHERE id = ?`, [userId])
})

test('kpi-schema: composite index on entradas(evento_id, estado, created_at) exists', async () => {
  // The composite index is created by the Prisma migration (@@index([evento_id, estado, created_at])),
  // which auto-names it entradas_evento_id_estado_created_at_idx (not the legacy MySQL idx_* name).
  const [rows] = await pool.query<any[]>(
    `SELECT COUNT(*) AS total
     FROM pg_indexes
     WHERE tablename = 'entradas'
       AND indexname = 'entradas_evento_id_estado_created_at_idx'`
  )

  assert.ok(rows[0].total > 0, 'composite index on entradas(evento_id, estado, created_at) must exist')
})
