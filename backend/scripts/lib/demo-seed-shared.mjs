/**
 * demo-seed-shared.mjs
 * =====================================================================
 * Utilidades compartidas por los scripts de CUENTAS DEMO:
 *   - seed-demo.mjs        (crea la empresa demo + datos navegables)
 *   - seed-demo-clean.mjs  (borra TODO lo marcado demo)
 *
 * Responsabilidades:
 *   1) Marcado canónico de lo demo (constantes: dominio de email, slug, etc).
 *   2) Resolución de la URL de conexión (env .env vs contenedor de test).
 *   3) Guardia anti-produccion (default-deny) — MISMO criterio que dev-up.ps1:
 *      el host de la DB tiene que ser local (localhost / 127.0.0.1 /
 *      host.docker.internal) o contener un segmento 'test'. Cualquier otra cosa
 *      aborta salvo override consciente TICKETERA_ALLOW_PROD=1.
 *
 * NUNCA crear ni borrar cuentas demo en prod por accidente: esto es no negociable.
 * =====================================================================
 */

import { PrismaClient } from '@prisma/client'

// ---------------------------------------------------------------------------
// 1) Marcado canónico de lo DEMO
// ---------------------------------------------------------------------------
//
// Estrategia de marcado (elegida deliberadamente, SIN migracion de schema):
//   - Flag REAL `empresas.es_prueba = true` (ya existe en el schema, ya indexado
//     con @@index([es_prueba])). Es la marca primaria.
//   - Dominio de email DEDICADO `@demo.ticketera.test`. Es la marca de cleanup:
//     un sufijo EXACTO, no un `LIKE '%demo%'` sobre el nombre. Asi una empresa
//     REAL llamada "Demo SA" NUNCA cae en el filtro, y la empresa de prueba
//     manual `empresaprueba@ticketera.test` (otro dominio) tampoco se toca.
//
// El cleanup filtra por: es_prueba = true AND email endsWith '@demo.ticketera.test'.
// Doble condicion -> imposible borrar datos reales.

export const DEMO_EMAIL_DOMAIN = 'demo.ticketera.test'
export const DEMO_EMPRESA_SLUG = 'demo-ticketera'
export const DEMO_EMPRESA_EMAIL = `demo@${DEMO_EMAIL_DOMAIN}`
// Credencial OBVIAMENTE de prueba. No es un secreto de prod. Documentada en DEV-LOCAL.md.
export const DEMO_EMPRESA_PASSWORD = 'Demo1234!'
export const DEMO_COMPRADOR_EMAIL = `comprador@${DEMO_EMAIL_DOMAIN}`

/** True si el email pertenece al dominio dedicado de cuentas demo (sufijo exacto). */
export function isDemoEmail(email) {
  if (!email) return false
  return String(email).toLowerCase().endsWith(`@${DEMO_EMAIL_DOMAIN}`)
}

// ---------------------------------------------------------------------------
// 2) Parsing / clasificacion de host (espejo de dev-up.ps1)
// ---------------------------------------------------------------------------

/** Aisla el host real de una connection string, descartando user:pass@ (incluso
 *  si el pass contiene '@', tomando lo que sigue al ULTIMO '@') y cortando en el
 *  primer ':' '/' o '?'. */
export function parseDbHost(rawUrl) {
  if (!rawUrl) return ''
  const val = String(rawUrl).trim().replace(/^["']|["']$/g, '')
  const afterAt = val.replace(/^.*@/, '')
  const m = afterAt.match(/^([^:/?]+)/)
  return m ? m[1] : ''
}

/** True si el host es local o de test. 'test' tiene que estar anclado a un segmento
 *  (test-db, db.test, test) — no substring suelto — para que un host de prod que
 *  casualmente contenga "test" (p. ej. un project-ref) NO pase. */
export function isLocalOrTestHost(h) {
  if (!h) return false
  return /^(localhost|127\.0\.0\.1|host\.docker\.internal)$/.test(h) ||
    /(^|[.\-])test([.\-]|$)/.test(h)
}

// ---------------------------------------------------------------------------
// 3) Resolucion de la URL de conexion
// ---------------------------------------------------------------------------

/** Construye la connection string del contenedor de test Postgres, usando los
 *  mismos defaults que scripts/prepare-test-db.cjs y src/test-env.ts. */
export function buildTestContainerUrl() {
  const host = process.env.TEST_DB_HOST || 'localhost'
  const port = process.env.TEST_DB_PORT || '5433'
  const user = process.env.TEST_DB_USER || 'postgres'
  const password = process.env.TEST_DB_PASSWORD || 'postgres'
  const db = process.env.TEST_DB_NAME || 'ticketera_test'
  return `postgresql://${user}:${password}@${host}:${port}/${db}`
}

/**
 * Resuelve a que DB se conecta el script.
 *   - Con `--test-db` (o TICKETERA_DEMO_TARGET=test-container): contenedor de test,
 *     ignorando lo que diga el .env. Es local por construccion.
 *   - Si no: DIRECT_URL ?? DATABASE_URL del entorno (.env). El seed escribe via
 *     conexion directa (no necesita FOR UPDATE; no usa el pooler).
 *
 * Devuelve { url, source, mode }.
 */
export function resolveDemoDbUrl(argv = process.argv.slice(2)) {
  const useTestDb = argv.includes('--test-db') ||
    process.env.TICKETERA_DEMO_TARGET === 'test-container'

  if (useTestDb) {
    return { url: buildTestContainerUrl(), source: 'test-container', mode: 'test-db' }
  }

  if (process.env.DIRECT_URL) {
    return { url: process.env.DIRECT_URL, source: 'DIRECT_URL', mode: 'env' }
  }
  if (process.env.DATABASE_URL) {
    return { url: process.env.DATABASE_URL, source: 'DATABASE_URL', mode: 'env' }
  }
  return { url: null, source: null, mode: 'env' }
}

// ---------------------------------------------------------------------------
// 4) Guardia anti-produccion (default-deny)
// ---------------------------------------------------------------------------

/**
 * Aborta el proceso si la DB destino no es local/test, salvo override consciente
 * TICKETERA_ALLOW_PROD=1. Valida:
 *   - el host de la URL RESUELTA (a donde realmente escribimos), y
 *   - en modo env, ADEMAS los hosts de DATABASE_URL y DIRECT_URL presentes en el
 *     entorno (defensa en profundidad: si CUALQUIERA apunta a prod, frenamos;
 *     mismo espiritu que dev-up.ps1, que chequea ambas).
 *
 * Llamar SIEMPRE antes de crear el PrismaClient.
 */
export function assertSafeDemoTarget({ url, source, mode }) {
  if (!url) {
    console.error('\n [STOP] No hay URL de conexion.')
    console.error('        Defini DIRECT_URL/DATABASE_URL en backend/.env, o corre con --test-db')
    console.error('        contra el contenedor de test (npm run test:postgres:up).\n')
    process.exit(1)
  }

  const override = process.env.TICKETERA_ALLOW_PROD === '1'

  // Hosts a auditar: el destino real + (en modo env) los que esten en el entorno.
  const targets = [[`destino (${source})`, parseDbHost(url)]]
  if (mode === 'env') {
    if (process.env.DATABASE_URL) targets.push(['DATABASE_URL', parseDbHost(process.env.DATABASE_URL)])
    if (process.env.DIRECT_URL) targets.push(['DIRECT_URL', parseDbHost(process.env.DIRECT_URL)])
  }

  const unsafe = targets.filter(([, h]) => !isLocalOrTestHost(h))

  if (unsafe.length === 0) {
    console.log(` [guard]   OK — destino local/test (${source}, host=${parseDbHost(url)})`)
    return
  }

  console.error('\n [STOP] Conexion(es) NO local/test detectada(s):')
  for (const [k, h] of unsafe) console.error(`          ${k} -> '${h || '(vacio)'}'`)
  console.error('        Crear/borrar cuentas demo aca tocaria datos REALES de clientes.')

  if (!override) {
    console.error('        Apunta a una DB de test/staging, o corre con --test-db contra el')
    console.error('        contenedor de test (npm run test:postgres:up).')
    console.error('        Si SABES lo que haces:  TICKETERA_ALLOW_PROD=1 <comando>\n')
    process.exit(1)
  }
  console.error('        TICKETERA_ALLOW_PROD=1 detectado -> continuo bajo tu responsabilidad.\n')
}

/** Crea el PrismaClient apuntado a la URL resuelta (datasource `db`). */
export function makeDemoPrisma(url) {
  return new PrismaClient({ datasources: { db: { url } } })
}

/** Boilerplate comun: resuelve URL, corre la guardia y devuelve { prisma, url, source }. */
export function bootstrapDemoPrisma() {
  const resolved = resolveDemoDbUrl()
  assertSafeDemoTarget(resolved)
  const prisma = makeDemoPrisma(resolved.url)
  return { prisma, url: resolved.url, source: resolved.source, mode: resolved.mode }
}
