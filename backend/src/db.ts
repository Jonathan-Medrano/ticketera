// Postgres-backed compatibility adapter for the migrated test suite.
//
// Production code talks to the DB exclusively through Prisma (`./lib/prisma`).
// This shim exists ONLY so the test fixtures inherited from the MySQL era —
// which use raw `pool.query(sql, params)` with mysql2's `?` placeholders and
// the `const [rows] = await pool.query(...)` destructuring shape — keep working
// against the Postgres test DB without a full rewrite to Prisma.
//
// It mimics the slice of the mysql2/promise `Pool` surface the tests rely on:
//   const [rows] = await pool.query<T>(sql, params)   // resolves [rows, fields]
//   await pool.end()
// and translates mysql2 `?` placeholders into Postgres `$1, $2, ...`.
//
// The connection points at process.env.DATABASE_URL — the SAME URL Prisma uses
// during tests (set by src/test-env.ts), so data written via this pool and via
// Prisma routes share one database.

import { Pool, types } from 'pg'

// Match mysql2's numeric behaviour: return JS numbers for int8 / numeric instead
// of pg's default strings, so existing `assert.equal(row.count, 2)` assertions hold.
types.setTypeParser(20, (v) => (v === null ? null : Number(v))) // int8 / bigint
types.setTypeParser(1700, (v) => (v === null ? null : Number(v))) // numeric / decimal

let pool: Pool | null = null

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL
    if (!connectionString) {
      throw new Error(
        'db.ts compat adapter: DATABASE_URL is not set — src/test-env.ts must run first (loaded via --import in `npm test`).',
      )
    }
    pool = new Pool({ connectionString })
  }
  return pool
}

// Quote-aware `?` → `$N` translation. Skips `?` inside single-quoted string
// literals (handling the `''` escape) so fixtures like `LIKE 'a?b'` are untouched.
function toPgPlaceholders(sql: string): string {
  let out = ''
  let placeholder = 0
  let inSingle = false
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i]
    if (ch === "'") {
      inSingle = !inSingle
      out += ch
      continue
    }
    if (ch === '?' && !inSingle) {
      out += '$' + ++placeholder
      continue
    }
    out += ch
  }
  return out
}

type Row = Record<string, unknown>

async function run<T = Row[]>(sql: string, params: unknown[] = []): Promise<[T, unknown[]]> {
  const result = await getPool().query(toPgPlaceholders(sql), params as never[])
  return [result.rows as unknown as T, result.fields as unknown[]]
}

const adapter = {
  query: run,
  // mysql2 alias — same behaviour as query for our purposes.
  execute: run,
  // Minimal mysql2 PoolConnection surface for the few call sites (seed scripts)
  // that open an explicit transaction. Backed by a checked-out pg client.
  async getConnection() {
    const client = await getPool().connect()
    const clientRun = async <T = Row[]>(sql: string, params: unknown[] = []): Promise<[T, unknown[]]> => {
      const result = await client.query(toPgPlaceholders(sql), params as never[])
      return [result.rows as unknown as T, result.fields as unknown[]]
    }
    return {
      query: clientRun,
      execute: clientRun,
      beginTransaction: () => client.query('BEGIN'),
      commit: () => client.query('COMMIT'),
      rollback: () => client.query('ROLLBACK'),
      release: () => client.release(),
      // mysql2 connections expose end(); map it to release for pooled clients.
      end: async () => client.release(),
    }
  },
  async end(): Promise<void> {
    if (pool) {
      await pool.end()
      pool = null
    }
  },
}

export default adapter
