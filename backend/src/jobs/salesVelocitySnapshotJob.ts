import { prisma } from '../lib/prisma'
import { logServerError, logServerInfo } from '../lib/safe-log'

export const SALES_VELOCITY_SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000 // diario

const JOB_STATE_KEY = Symbol.for('platea.backend.salesVelocitySnapshotJob')

let salesVelocitySnapshotRunning = false

type JobTimer = ReturnType<typeof setInterval>
type JobState = { timer: JobTimer | null }

function getJobState(): JobState {
  const scope = globalThis as typeof globalThis & {
    [JOB_STATE_KEY]?: JobState
  }
  if (!scope[JOB_STATE_KEY]) {
    scope[JOB_STATE_KEY] = { timer: null }
  }
  return scope[JOB_STATE_KEY]
}

export function shouldStartSalesVelocitySnapshotJob(env: NodeJS.ProcessEnv = process.env) {
  // Opt-out explícito (default ON)
  if (env.SALES_VELOCITY_SNAPSHOT_ENABLED === '0') {
    return false
  }

  if (env.NODE_ENV === 'test' && env.SALES_VELOCITY_SNAPSHOT_ENABLE_IN_TESTS !== '1') {
    return false
  }

  if (env.BACKEND_MIGRATION_MODE === '1' || env.MIGRATION_RUNNING === '1') {
    return false
  }

  return true
}

type ProcessResult = {
  processed: number
  succeeded: number
  failed: number
  durationMs: number
}

async function processVelocitySnapshots(): Promise<ProcessResult> {
  const startedAt = Date.now()

  // Postgres equivalent of MySQL's INSERT ... ON DUPLICATE KEY UPDATE.
  // Uses ON CONFLICT (evento_id, fecha_snapshot) DO UPDATE — matches the unique
  // constraint @@unique([evento_id, fecha_snapshot]) in the Prisma schema.
  // fecha_snapshot is the AR-local calendar day (America/Argentina/Buenos_Aires),
  // NOT the UTC day — this keeps the live snapshot aligned with backfillVelocitySnapshots.ts,
  // which buckets created_at as (created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::date.
  // Using plain CURRENT_DATE (UTC) would write the wrong day during the AR evening (UTC-3),
  // producing duplicate/misaligned snapshot rows vs the backfill.
  // updated_at is managed by the set_updated_at() trigger, but we set it explicitly
  // here too for consistency with the original query (trigger will also fire).
  const result = await prisma.$executeRaw`
    INSERT INTO evento_ventas_snapshot
      (evento_id, fecha_snapshot, vendidas_acumuladas, capacidad_total_snapshot, ingresos_neto_acumulado)
    SELECT
      e.id,
      (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date,
      COALESCE(ent.vendidas, 0),
      COALESCE(ec.capacidad, 0),
      COALESCE(ent.ingresos, 0)
    FROM eventos e
    LEFT JOIN (
      SELECT
        evento_id,
        COUNT(CASE WHEN estado IN ('valida','usada') THEN 1 END)       AS vendidas,
        SUM(CASE WHEN estado != 'cancelada'
              THEN COALESCE(neto_empresa_amount,
                            precio_pagado - COALESCE(comision,0) - COALESCE(mp_fee_amount,0))
              ELSE 0 END)                                              AS ingresos
      FROM entradas
      GROUP BY evento_id
    ) ent ON ent.evento_id = e.id
    LEFT JOIN (
      SELECT evento_id, SUM(stock) AS capacidad
      FROM entrada_categorias
      GROUP BY evento_id
    ) ec ON ec.evento_id = e.id
    WHERE e.modo_fecha IN ('unica','multiple')
    ON CONFLICT (evento_id, fecha_snapshot) DO UPDATE
      SET vendidas_acumuladas      = EXCLUDED.vendidas_acumuladas,
          capacidad_total_snapshot = EXCLUDED.capacidad_total_snapshot,
          ingresos_neto_acumulado  = EXCLUDED.ingresos_neto_acumulado,
          updated_at               = NOW()
  `

  const durationMs = Date.now() - startedAt
  // Postgres $executeRaw returns the number of rows affected (inserts + updates combined)
  const processed = Number(result)
  logServerInfo(
    `[salesVelocitySnapshot] processed=${processed} duration_ms=${durationMs}`
  )
  return { processed, succeeded: processed, failed: 0, durationMs }
}

export async function runSalesVelocitySnapshotJob() {
  if (salesVelocitySnapshotRunning) {
    return null
  }

  salesVelocitySnapshotRunning = true
  try {
    return await processVelocitySnapshots()
  } catch {
    logServerError('sales velocity snapshot')
    return null
  } finally {
    salesVelocitySnapshotRunning = false
  }
}

export function startSalesVelocitySnapshotJob(intervalMs = SALES_VELOCITY_SNAPSHOT_INTERVAL_MS) {
  if (!shouldStartSalesVelocitySnapshotJob()) {
    return null
  }

  const state = getJobState()
  if (state.timer) {
    return state.timer
  }

  // NO immediate boot tick — first execution after intervalMs (matches storageOrphanCleanupJob pattern)
  state.timer = setInterval(() => {
    void runSalesVelocitySnapshotJob()
  }, intervalMs)

  state.timer.unref?.()

  return state.timer
}

export function stopSalesVelocitySnapshotJob() {
  const state = getJobState()
  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }
}
