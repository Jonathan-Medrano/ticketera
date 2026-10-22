#!/usr/bin/env node
// Sincroniza prisma/schema.prisma + prisma/migrations/ desde backend/ hacia root/ y platea/.
//
// Backend es el canónico porque:
//   - Su Dockerfile corre `prisma migrate deploy` en runtime (línea 35 backend/Dockerfile)
//   - Sus migrations son las que se aplican a Supabase prod cuando Fly arranca
//
// Uso:
//   node scripts/sync-prisma-schemas.mjs           → muestra qué cambiaría (dry-run)
//   node scripts/sync-prisma-schemas.mjs --write   → aplica cambios
//
// Salida con código != 0 si encuentra diffs sin --write — útil para CI / pre-commit hook.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync, mkdirSync, copyFileSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const WRITE = process.argv.includes('--write')

const CANONICAL_SCHEMA = join(ROOT, 'backend', 'prisma', 'schema.prisma')
const CANONICAL_MIGRATIONS = join(ROOT, 'backend', 'prisma', 'migrations')

const TARGETS = [
  {
    label: 'platea',
    schema: join(ROOT, 'platea', 'prisma', 'schema.prisma'),
    migrations: null,
  },
  {
    label: 'root (workspace)',
    schema: join(ROOT, 'prisma', 'schema.prisma'),
    migrations: join(ROOT, 'prisma', 'migrations'),
  },
]

let driftDetected = false

function syncSchema(target) {
  if (!existsSync(CANONICAL_SCHEMA)) {
    console.error(`✗ No existe el schema canónico: ${CANONICAL_SCHEMA}`)
    process.exit(2)
  }
  const canonical = readFileSync(CANONICAL_SCHEMA, 'utf8')
  const targetExists = existsSync(target.schema)
  const current = targetExists ? readFileSync(target.schema, 'utf8') : null

  if (current === canonical) {
    console.log(`  ✓ schema ${target.label} ya está en sync`)
    return
  }

  driftDetected = true
  if (!targetExists) {
    console.log(`  ! schema ${target.label}: NO EXISTE → ${WRITE ? 'creando' : 'crearía'}`)
  } else {
    console.log(`  ! schema ${target.label}: DIFIERE del canónico → ${WRITE ? 'sobrescribiendo' : 'sobrescribiría'}`)
  }

  if (WRITE) {
    mkdirSync(dirname(target.schema), { recursive: true })
    writeFileSync(target.schema, canonical, 'utf8')
    console.log(`    ✓ escrito ${target.schema}`)
  }
}

function listMigrationDirs(folder) {
  if (!existsSync(folder)) return []
  return readdirSync(folder)
    .filter((entry) => statSync(join(folder, entry)).isDirectory())
    .sort()
}

function syncMigrations(target) {
  if (!target.migrations) return
  if (!existsSync(CANONICAL_MIGRATIONS)) {
    console.error(`✗ No existe el migrations folder canónico: ${CANONICAL_MIGRATIONS}`)
    process.exit(2)
  }

  const canonicalDirs = listMigrationDirs(CANONICAL_MIGRATIONS)
  const targetDirs = listMigrationDirs(target.migrations)

  const canonicalSet = new Set(canonicalDirs)
  const targetSet = new Set(targetDirs)

  const missing = canonicalDirs.filter((d) => !targetSet.has(d))
  const extra = targetDirs.filter((d) => !canonicalSet.has(d))

  // Compare migration.sql contents for directories present in both
  const drift = []
  for (const dir of canonicalDirs) {
    if (!targetSet.has(dir)) continue
    const a = join(CANONICAL_MIGRATIONS, dir, 'migration.sql')
    const b = join(target.migrations, dir, 'migration.sql')
    if (existsSync(a) && existsSync(b) && readFileSync(a, 'utf8') !== readFileSync(b, 'utf8')) {
      drift.push(dir)
    }
  }

  // Compare migration_lock.toml
  const lockA = join(CANONICAL_MIGRATIONS, 'migration_lock.toml')
  const lockB = join(target.migrations, 'migration_lock.toml')
  const lockDrift = existsSync(lockA) && existsSync(lockB) && readFileSync(lockA, 'utf8') !== readFileSync(lockB, 'utf8')

  if (missing.length === 0 && extra.length === 0 && drift.length === 0 && !lockDrift) {
    console.log(`  ✓ migrations ${target.label} ya están en sync`)
    return
  }

  driftDetected = true
  if (missing.length) console.log(`  ! migrations ${target.label}: FALTAN ${missing.length} (${missing.join(', ')})`)
  if (extra.length) console.log(`  ! migrations ${target.label}: SOBRAN ${extra.length} (${extra.join(', ')})`)
  if (drift.length) console.log(`  ! migrations ${target.label}: CONTENIDO DIFIERE en ${drift.length} (${drift.join(', ')})`)
  if (lockDrift) console.log(`  ! migrations ${target.label}: migration_lock.toml DIFIERE`)

  if (!WRITE) return

  mkdirSync(target.migrations, { recursive: true })

  // Copy missing migrations
  for (const dir of missing) {
    const srcDir = join(CANONICAL_MIGRATIONS, dir)
    const dstDir = join(target.migrations, dir)
    mkdirSync(dstDir, { recursive: true })
    for (const f of readdirSync(srcDir)) {
      copyFileSync(join(srcDir, f), join(dstDir, f))
    }
    console.log(`    ✓ creado ${dir}`)
  }

  // Overwrite drifted migrations
  for (const dir of drift) {
    const src = join(CANONICAL_MIGRATIONS, dir, 'migration.sql')
    const dst = join(target.migrations, dir, 'migration.sql')
    copyFileSync(src, dst)
    console.log(`    ✓ sobrescrito ${dir}/migration.sql`)
  }

  // Remove extra migrations (NOT auto — too dangerous)
  if (extra.length) {
    console.log(`    ⚠ NO eliminé ${extra.length} migration(s) sobrantes en ${target.label} — revisalas a mano y borralas si corresponde:`)
    for (const dir of extra) console.log(`      - ${join(target.migrations, dir)}`)
  }

  // Sync migration_lock.toml
  if (lockDrift) {
    copyFileSync(lockA, lockB)
    console.log(`    ✓ sobrescrito migration_lock.toml`)
  }
}

console.log(`Schema canónico: backend/prisma/schema.prisma\n`)
console.log(WRITE ? '=== MODO ESCRITURA ===\n' : '=== MODO DRY-RUN (use --write para aplicar) ===\n')

for (const target of TARGETS) {
  console.log(`→ ${target.label}`)
  syncSchema(target)
  syncMigrations(target)
  console.log('')
}

if (driftDetected && !WRITE) {
  console.error('Hay drift entre el schema/migrations canónicos y las copias. Corré con --write para sincronizar.')
  process.exit(1)
}

console.log(driftDetected ? '✓ Sincronización aplicada.' : '✓ Todo en sync — nada que hacer.')
