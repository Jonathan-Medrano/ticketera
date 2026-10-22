/**
 * prepare-test-db.cjs — Postgres test database bootstrap (Phase 5 A)
 *
 * Drops and recreates the test database, then runs `prisma migrate deploy`
 * to provision the schema from the Prisma migration history.
 *
 * Env vars (with defaults):
 *   TEST_DB_HOST     localhost
 *   TEST_DB_PORT     5433
 *   TEST_DB_USER     postgres
 *   TEST_DB_PASSWORD postgres
 *   TEST_DB_NAME     ticketera_test
 */

require('dotenv').config()
const { execSync } = require('node:child_process')
const path = require('node:path')

// ── Connection config ──────────────────────────────────────────────────────
const host = process.env.TEST_DB_HOST || 'localhost'
const port = Number(process.env.TEST_DB_PORT) || 5433
const user = process.env.TEST_DB_USER || 'postgres'
const password = process.env.TEST_DB_PASSWORD || 'postgres'
const testDb = process.env.TEST_DB_NAME || 'ticketera_test'

// pg is a peer dep added in Phase 5 A; required only by this bootstrap script
const { Client } = require('pg')

async function main() {
  const adminConnString = `postgresql://${user}:${password}@${host}:${port}/postgres`
  const testConnString = `postgresql://${user}:${password}@${host}:${port}/${testDb}`

  // ── 1. Connect to the default "postgres" maintenance DB ──────────────────
  const admin = new Client({ connectionString: adminConnString })
  await admin.connect()

  try {
    // ── 2. Drop test DB (terminate open connections first) ─────────────────
    await admin.query(`
      SELECT pg_terminate_backend(pid)
      FROM pg_stat_activity
      WHERE datname = $1 AND pid <> pg_backend_pid()
    `, [testDb])

    await admin.query(`DROP DATABASE IF EXISTS "${testDb}"`)
    await admin.query(`CREATE DATABASE "${testDb}"`)
    console.log(`[prepare-test-db] Database "${testDb}" recreated.`)
  } finally {
    await admin.end()
  }

  // ── 3. Run Prisma migrations against the fresh test DB ───────────────────
  const schemaPath = path.resolve(__dirname, '../../prisma/schema.prisma')

  try {
    execSync(`npx prisma migrate deploy --schema="${schemaPath}"`, {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: testConnString,
        DIRECT_URL: testConnString,
      },
    })
    console.log('[prepare-test-db] Prisma migrations applied.')
  } catch (err) {
    console.error('[prepare-test-db] prisma migrate deploy failed:', err.message)
    process.exit(1)
  }

  // ── 4. Bootstrap del superadmin singleton ────────────────────────────────
  // Toda la familia platform-governance / profit-sharing asume que existe
  // exactamente un `platform_admin_users` con singleton_key='superadmin' (es la
  // raiz del arbol de permisos y el destinatario del profit sharing). La base
  // recien creada no lo tiene, asi que esos tests fallaban en el fixture, no en
  // la logica: `getRootUserId()` hacia rows[0].id sobre un resultado vacio.
  //
  // La password es solo para la DB de test local y descartable; el seed exige
  // 12+ caracteres.
  const seedPath = path.resolve(__dirname, '../prisma/seed.ts')

  try {
    execSync(`npx tsx "${seedPath}"`, {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: testConnString,
        DIRECT_URL: testConnString,
        SUPERADMIN_EMAIL: process.env.SUPERADMIN_EMAIL || 'superadmin@test.local',
        SUPERADMIN_LOGIN_ALIAS: process.env.SUPERADMIN_LOGIN_ALIAS || 'superadmin',
        SUPERADMIN_NAME: process.env.SUPERADMIN_NAME || 'Super Admin Test',
        SUPERADMIN_PASSWORD: process.env.SUPERADMIN_PASSWORD || 'test-superadmin-password',
      },
    })
    console.log('[prepare-test-db] Singleton superadmin bootstrapped.')
  } catch (err) {
    console.error('[prepare-test-db] superadmin seed failed:', err.message)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[prepare-test-db]', err)
  process.exit(1)
})
