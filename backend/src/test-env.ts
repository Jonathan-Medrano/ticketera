/**
 * test-env.ts — Test environment bootstrap (Phase 5 A)
 *
 * Imported via --import flag before test files run.
 * Sets DATABASE_URL / DIRECT_URL to point at the local Postgres test container
 * (port 5433) and marks NODE_ENV=test.
 *
 * For the Postgres test container there is no PgBouncer, so both URLs are
 * identical (direct connection — safe for FOR UPDATE / transactions).
 */
import dotenv from 'dotenv'

// Mismo polyfill de BigInt que carga el servidor real (src/index.ts).
// Sin esto los tests corren con un runtime distinto al de produccion: los
// routers montados a mano devuelven 500 en cualquier endpoint con un COUNT.
import './lib/bigint-json'

process.env.NODE_ENV = 'test'
dotenv.config()

const host = process.env.TEST_DB_HOST || 'localhost'
const port = process.env.TEST_DB_PORT || '5433'
const user = process.env.TEST_DB_USER || 'postgres'
const password = process.env.TEST_DB_PASSWORD || 'postgres'
const db = process.env.TEST_DB_NAME || 'ticketera_test'

const testUrl = `postgresql://${user}:${password}@${host}:${port}/${db}`

process.env.DATABASE_URL = testUrl
// DIRECT_URL = same as DATABASE_URL in test: no pooler in the test container
process.env.DIRECT_URL = testUrl
