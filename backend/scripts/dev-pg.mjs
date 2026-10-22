/**
 * dev-pg.mjs — Postgres local persistente para desarrollo, sin Docker.
 * Puerto 5434, user/pass postgres/postgres, base `ticketera_dev`.
 * Requiere: npm install --no-save embedded-postgres pg
 */
import EmbeddedPostgres from 'embedded-postgres'
import pg from 'pg'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.dev-pg-data')
const fresh = !fs.existsSync(path.join(dir, 'PG_VERSION'))

const server = new EmbeddedPostgres({
  databaseDir: dir,
  user: 'postgres',
  password: 'postgres',
  port: 5434,
  persistent: true,
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  postgresFlags: ['-c', 'log_min_messages=fatal'],
})

if (fresh) await server.initialise()
await server.start()

const admin = new pg.Client({ connectionString: 'postgresql://postgres:postgres@localhost:5434/postgres' })
await admin.connect()
const { rowCount } = await admin.query("SELECT 1 FROM pg_database WHERE datname = 'ticketera_dev'")
if (!rowCount) await admin.query('CREATE DATABASE ticketera_dev')
await admin.end()

console.log('[dev-pg] listo: postgresql://postgres:postgres@localhost:5434/ticketera_dev')
process.on('SIGINT', async () => { await server.stop(); process.exit(0) })
setInterval(() => {}, 1 << 30)
