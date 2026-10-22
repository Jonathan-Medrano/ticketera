import os from 'os'
import { monitorEventLoopDelay, type Histogram } from 'perf_hooks'
import { prisma } from './prisma'

let eventLoopHistogram: Histogram | null = null

/**
 * Habilita el monitoreo continuo del event loop lag. Debe llamarse una sola vez
 * al arranque del server. Resolution de 20ms = bins de 20ms para el histograma.
 */
export function initEventLoopMonitor() {
  if (eventLoopHistogram) return
  try {
    const h = monitorEventLoopDelay({ resolution: 20 })
    h.enable()
    eventLoopHistogram = h
  } catch {
    // perf_hooks no disponible — degradamos silenciosamente
  }
}

export type SystemSnapshot = {
  uptimeSeconds: number
  nodeVersion: string
  platform: string
  memory: {
    rssBytes: number
    heapUsedBytes: number
    heapTotalBytes: number
    externalBytes: number
  }
  cpu: {
    loadAvg1m: number
    loadAvg5m: number
    loadAvg15m: number
    cores: number
  }
  eventLoop: {
    meanLagMs: number | null
    maxLagMs: number | null
    p99LagMs: number | null
  }
}

export function getSystemSnapshot(): SystemSnapshot {
  const memory = process.memoryUsage()
  const loadavg = os.loadavg()

  let meanLagMs: number | null = null
  let maxLagMs: number | null = null
  let p99LagMs: number | null = null
  if (eventLoopHistogram) {
    meanLagMs = eventLoopHistogram.mean / 1e6
    maxLagMs = eventLoopHistogram.max / 1e6
    p99LagMs = eventLoopHistogram.percentile(99) / 1e6
  }

  return {
    uptimeSeconds: process.uptime(),
    nodeVersion: process.version,
    platform: process.platform,
    memory: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
    },
    cpu: {
      loadAvg1m: loadavg[0] ?? 0,
      loadAvg5m: loadavg[1] ?? 0,
      loadAvg15m: loadavg[2] ?? 0,
      cores: os.cpus().length,
    },
    eventLoop: {
      meanLagMs,
      maxLagMs,
      p99LagMs,
    },
  }
}

export type DatabaseSnapshot = {
  poolStats: { active: number; idle: number; queued: number; limit: number } | null
  totalSizeBytes: number
  tables: Array<{
    name: string
    rowCount: number
    dataSizeBytes: number
    indexSizeBytes: number
    totalSizeBytes: number
  }>
  hotTableCounts: Record<string, number>
}

const HOT_TABLES = [
  'entradas',
  'consumibles_ventas',
  'checkout_sessions',
  'audit_logs',
  'processed_webhooks',
  'storage_cleanup_runs',
  'eventos',
  'compradores',
] as const

export async function getDatabaseSnapshot(): Promise<DatabaseSnapshot> {
  // Prisma does not expose internal pool stats — report null
  const poolStats: DatabaseSnapshot['poolStats'] = null

  type TableStatRow = { name: string; row_count: bigint; data_size: bigint; index_size: bigint }
  type TotalRow = { total: bigint }
  type HotRow = { name: string; row_count: bigint }

  const [topTablesRaw, totalSizeRaw, hotRowsRaw] = await Promise.all([
    prisma.$queryRaw<TableStatRow[]>`
      SELECT
        s.relname AS name,
        COALESCE(s.n_live_tup, 0)::bigint AS row_count,
        COALESCE(pg_total_relation_size(c.oid) - pg_indexes_size(c.oid), 0)::bigint AS data_size,
        COALESCE(pg_indexes_size(c.oid), 0)::bigint AS index_size
      FROM pg_stat_user_tables s
      JOIN pg_class c ON c.oid = s.relid
      ORDER BY pg_total_relation_size(c.oid) DESC
      LIMIT 10
    `,
    prisma.$queryRaw<TotalRow[]>`
      SELECT COALESCE(SUM(pg_total_relation_size(c.oid)), 0)::bigint AS total
      FROM pg_stat_user_tables s
      JOIN pg_class c ON c.oid = s.relid
    `,
    prisma.$queryRaw<HotRow[]>`
      SELECT relname AS name, COALESCE(n_live_tup, 0)::bigint AS row_count
      FROM pg_stat_user_tables
      WHERE relname = ANY(${HOT_TABLES as unknown as string[]})
    `,
  ])

  const hotTableCounts: Record<string, number> = {}
  for (const t of HOT_TABLES) hotTableCounts[t] = 0
  for (const row of hotRowsRaw) {
    hotTableCounts[String(row.name)] = Number(row.row_count ?? 0n)
  }

  return {
    poolStats,
    totalSizeBytes: Number(totalSizeRaw[0]?.total ?? 0n),
    tables: topTablesRaw.map((row) => {
      const dataSizeBytes = Number(row.data_size ?? 0n)
      const indexSizeBytes = Number(row.index_size ?? 0n)
      return {
        name: String(row.name),
        rowCount: Number(row.row_count ?? 0n),
        dataSizeBytes,
        indexSizeBytes,
        totalSizeBytes: dataSizeBytes + indexSizeBytes,
      }
    }),
    hotTableCounts,
  }
}
