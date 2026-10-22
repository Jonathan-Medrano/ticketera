/**
 * embedded-pg-runner.mjs — Corre la suite de tests SIN Docker.
 *
 * Levanta un Postgres REAL (binario nativo via `embedded-postgres`, sin virtualización
 * ni Docker/WSL2) en el puerto 5433 con user/pass `postgres/postgres` — exactamente lo
 * que esperan `scripts/prepare-test-db.cjs` y `src/test-env.ts` por defecto. Luego corre
 * el pipeline de test existente y apaga el Postgres al terminar.
 *
 * Uso:
 *   node scripts/embedded-pg-runner.mjs                      # corre TODA la suite
 *   node scripts/embedded-pg-runner.mjs src/foo.test.ts ...  # corre archivos puntuales
 *
 * Requiere: `npm install --no-save embedded-postgres` (no se commitea para no afectar Fly).
 */
import EmbeddedPostgres from 'embedded-postgres'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendDir = path.resolve(__dirname, '..')
// Carpeta de datos por-PID: en Windows, tras pg.stop() el proceso puede tardar en soltar
// el handle, y un rm inmediato tira EPERM. Una carpeta única por run evita colisiones con
// leftovers bloqueados de corridas previas.
const dataDir = path.join(backendDir, `.embedded-pg-data-${process.pid}`)

const args = process.argv.slice(2)
const testFiles = args.length ? args : ['src/**/*.test.ts']

const safeRm = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* best-effort */ } }
safeRm(dataDir)

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: 'postgres',
  password: 'postgres',
  port: 5433,
  persistent: false, // efímero: se limpia al apagar
  // El initdb de Windows defaultea a WIN1252 por el locale del SO, pero las migraciones
  // (y Supabase prod) son UTF8 — forzamos el cluster a UTF8 + locale C para que los
  // caracteres no-ASCII (→, acentos, etc.) apliquen sin "no equivalent in WIN1252".
  initdbFlags: ['--encoding=UTF8', '--locale=C'],
  // Silenciar los logs del server (LOG/ERROR de queries) para no tapar la salida de los
  // tests; los errores igual llegan al cliente y los reporta el test runner.
  postgresFlags: ['-c', 'log_min_messages=fatal', '-c', 'log_statement=none'],
})

let failed = false
try {
  console.log('[embedded-pg] initialise (initdb)…')
  await pg.initialise()
  console.log('[embedded-pg] start…')
  await pg.start()
  console.log('[embedded-pg] Postgres real escuchando en localhost:5433 (postgres/postgres)')

  console.log('\n[embedded-pg] === prepare-test-db (drop/create ticketera_test + migrate deploy) ===')
  execSync('node ./scripts/prepare-test-db.cjs', { cwd: backendDir, stdio: 'inherit' })

  console.log('\n[embedded-pg] === corriendo tests ===')
  const cmd = `node --import tsx --import ./src/test-env.ts --test --test-concurrency=1 ${testFiles.join(' ')}`
  execSync(cmd, { cwd: backendDir, stdio: 'inherit' })

  console.log('\n[embedded-pg] ✓ tests OK')
} catch (err) {
  failed = true
  console.error('\n[embedded-pg] ✗ falló:', err?.message ?? err)
} finally {
  try {
    console.log('[embedded-pg] stop…')
    await pg.stop()
  } catch { /* no-op */ }
  safeRm(dataDir)
}

process.exit(failed ? 1 : 0)
