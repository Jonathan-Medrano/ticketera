// Usage: npm run backfill:velocity -- --from=YYYY-MM-DD --to=YYYY-MM-DD [--evento-id=UUID] [--dry-run]
//
// Backfills evento_ventas_snapshot table with historical daily cumulative snapshots.
//
// Known limitation: capacidad_total_snapshot uses CURRENT entrada_categorias.stock
// values for all historical days (historical capacity is not tracked). Re-run this
// script after capacity changes to refresh historical rows.
//
// Performance: requires idx_entradas_evento_estado_created (Phase 1 composite index)
// for sub-minute execution on large datasets.
//
// Timezone: created_at is timestamptz (UTC instants). Days are bucketed in
// America/Argentina/Buenos_Aires (AR-only app) so a snapshot for a given calendar
// day matches how dates are displayed in the dashboard.

import { Prisma } from '@prisma/client'
import { prisma } from '../src/lib/prisma'

const AR_TZ = 'America/Argentina/Buenos_Aires'

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

type DeltaRow = {
  dia: string // 'YYYY-MM-DD' (bucketed in AR tz)
  vendidas_dia: number | bigint | null
  neto_dia: Prisma.Decimal | number | string | null
}

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2)
  const get = (flag: string) => {
    const entry = args.find((a) => a.startsWith(`--${flag}=`))
    return entry ? entry.split('=').slice(1).join('=') : null
  }
  return {
    from: get('from'),
    to: get('to'),
    eventoId: get('evento-id'),
    dryRun: args.includes('--dry-run'),
  }
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function isValidDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false
  const d = new Date(s + 'T00:00:00Z')
  return !isNaN(d.getTime())
}

function enumerateDays(from: string, to: string): string[] {
  const days: string[] = []
  const current = new Date(from + 'T00:00:00Z')
  const end = new Date(to + 'T00:00:00Z')
  while (current <= end) {
    days.push(current.toISOString().slice(0, 10))
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return days
}

// ---------------------------------------------------------------------------
// Chunk helper
// ---------------------------------------------------------------------------

function chunks<T>(arr: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < arr.length; i += size) result.push(arr.slice(i, i + size))
  return result
}

// ---------------------------------------------------------------------------
// Per-event backfill
// ---------------------------------------------------------------------------

async function backfillEvento(
  eventoId: string,
  fromDate: string,
  toDate: string,
  dryRun: boolean
): Promise<{ rows: number }> {
  // 1. Current capacity — documented limitation: uses current value for all historical days
  const capRows = await prisma.$queryRaw<Array<{ cap: number | bigint | null }>>`
    SELECT COALESCE(SUM(stock), 0) AS cap
    FROM entrada_categorias
    WHERE evento_id = ${eventoId}
  `
  const capacidadActual = Number(capRows[0]?.cap ?? 0)

  // 2. Per-day deltas — uses Phase 1 composite index idx_entradas_evento_estado_created.
  //    created_at (timestamptz) is bucketed into AR-local calendar days.
  const deltas = await prisma.$queryRaw<DeltaRow[]>`
    SELECT
      to_char((created_at AT TIME ZONE ${AR_TZ})::date, 'YYYY-MM-DD') AS dia,
      SUM(CASE WHEN estado IN ('valida','usada') THEN 1 ELSE 0 END) AS vendidas_dia,
      SUM(CASE WHEN estado != 'cancelada'
               THEN COALESCE(neto_empresa_amount, precio_pagado - COALESCE(comision,0) - COALESCE(mp_fee_amount,0))
               ELSE 0 END) AS neto_dia
    FROM entradas
    WHERE evento_id = ${eventoId}
      AND (created_at AT TIME ZONE ${AR_TZ})::date BETWEEN ${fromDate}::date AND ${toDate}::date
    GROUP BY (created_at AT TIME ZONE ${AR_TZ})::date
    ORDER BY (created_at AT TIME ZONE ${AR_TZ})::date ASC
  `

  // 3. Roll up cumulatives in JS — fill ALL days, even zero-sale days (REQ-35: completeness)
  let vendAcum = 0
  let netoAcum = 0
  const deltaByDay = new Map<string, DeltaRow>()
  for (const d of deltas) {
    const dia = String(d.dia).slice(0, 10)
    deltaByDay.set(dia, d)
  }

  const allDays = enumerateDays(fromDate, toDate)
  const rows: Array<[string, string, number, number, number]> = []

  for (const day of allDays) {
    const d = deltaByDay.get(day)
    if (d) {
      vendAcum += Number(d.vendidas_dia ?? 0)
      netoAcum += Number(d.neto_dia ?? 0)
    }
    rows.push([eventoId, day, vendAcum, capacidadActual, netoAcum])
  }

  if (dryRun) {
    console.log(`[backfill:dry-run] evento_id=${eventoId} would upsert ${rows.length} rows`)
    return { rows: rows.length }
  }

  // 4. Bulk UPSERT in chunks of 500 rows — parameterized via $N placeholders.
  //    Postgres equivalent of MySQL's INSERT ... ON DUPLICATE KEY UPDATE:
  //    ON CONFLICT (evento_id, fecha_snapshot) DO UPDATE — matches the unique
  //    constraint @@unique([evento_id, fecha_snapshot]) in the Prisma schema.
  for (const chunk of chunks(rows, 500)) {
    const valuesSql: string[] = []
    const params: unknown[] = []
    chunk.forEach((row, i) => {
      const base = i * 5
      // (evento_id, fecha_snapshot::date, vendidas, capacidad, ingresos)
      valuesSql.push(`($${base + 1}, $${base + 2}::date, $${base + 3}, $${base + 4}, $${base + 5})`)
      params.push(row[0], row[1], row[2], row[3], row[4])
    })

    const sql = `
      INSERT INTO evento_ventas_snapshot
        (evento_id, fecha_snapshot, vendidas_acumuladas, capacidad_total_snapshot, ingresos_neto_acumulado)
      VALUES ${valuesSql.join(', ')}
      ON CONFLICT (evento_id, fecha_snapshot) DO UPDATE
        SET vendidas_acumuladas      = EXCLUDED.vendidas_acumuladas,
            capacidad_total_snapshot = EXCLUDED.capacidad_total_snapshot,
            ingresos_neto_acumulado  = EXCLUDED.ingresos_neto_acumulado,
            updated_at               = NOW()
    `

    await prisma.$executeRawUnsafe(sql, ...params)
  }

  return { rows: rows.length }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const { from, to, eventoId, dryRun } = parseArgs()

  if (!from || !to) {
    console.error(
      'Error: --from y --to son requeridos.\n' +
        'Uso: npm run backfill:velocity -- --from=YYYY-MM-DD --to=YYYY-MM-DD [--evento-id=UUID] [--dry-run]'
    )
    process.exit(1)
  }

  if (!isValidDate(from)) {
    console.error(`Error: --from="${from}" no es una fecha válida (esperado YYYY-MM-DD)`)
    process.exit(1)
  }

  if (!isValidDate(to)) {
    console.error(`Error: --to="${to}" no es una fecha válida (esperado YYYY-MM-DD)`)
    process.exit(1)
  }

  if (new Date(from + 'T00:00:00Z') > new Date(to + 'T00:00:00Z')) {
    console.error(`Error: --from (${from}) no puede ser posterior a --to (${to})`)
    process.exit(1)
  }

  if (dryRun) {
    console.log('[backfill] DRY RUN mode — no se escribirá en la base de datos')
  }

  // Load eligible events
  const eventos = eventoId
    ? await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM eventos WHERE id = ${eventoId} AND modo_fecha IN ('unica','multiple')
      `
    : await prisma.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM eventos WHERE modo_fecha IN ('unica','multiple')
      `

  const total = eventos.length

  if (total === 0) {
    console.log(
      eventoId
        ? `[backfill] No se encontró evento con id=${eventoId} y modo_fecha unica/multiple. Saliendo.`
        : '[backfill] No hay eventos elegibles (modo_fecha unica/multiple). Saliendo.'
    )
    process.exit(0)
  }

  console.log(
    `[backfill] Iniciando: ${total} evento(s) | from=${from} | to=${to}` +
      (dryRun ? ' | DRY RUN' : '')
  )

  const startedAt = Date.now()
  let totalRows = 0

  for (let i = 0; i < total; i++) {
    const ev = eventos[i]
    try {
      const result = await backfillEvento(String(ev.id), from, to, dryRun)
      totalRows += result.rows
    } catch (err) {
      console.error(`[backfill] ERROR evento_id=${ev.id}:`, err)
      // Per-event error isolation: log and continue with remaining events
    }

    // Progress every 10 events
    if ((i + 1) % 10 === 0 || i + 1 === total) {
      const elapsedMs = Date.now() - startedAt
      const elapsedSec = elapsedMs / 1000
      const rate = (i + 1) / elapsedSec
      const etaSec = Math.round((total - i - 1) / Math.max(rate, 0.001))
      const etaMin = (etaSec / 60).toFixed(1)
      console.log(
        `[backfill] ${i + 1}/${total} eventos procesados | rows=${totalRows} | ` +
          `rate=${rate.toFixed(1)}/s | eta=${etaMin}min`
      )
    }
  }

  const totalSec = ((Date.now() - startedAt) / 1000).toFixed(1)
  console.log(
    `[backfill] Listo. ${total} evento(s), ${totalRows} filas upserted en ${totalSec}s` +
      (dryRun ? ' (DRY RUN — nada fue escrito)' : '')
  )

  await prisma.$disconnect()
  process.exit(0)
}

void main().catch(async (err) => {
  console.error('[backfill] Fatal:', err)
  await prisma.$disconnect().catch(() => {})
  process.exit(1)
})
