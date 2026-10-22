import { performance } from 'perf_hooks'
import { SUPABASE_STORAGE_BUCKET, getSupabaseServerClient } from '../lib/supabase-storage'
import { prisma } from '../lib/prisma'

export type PerfTestStatus = 'ok' | 'slow' | 'failed'
export type PerfTestCategory = 'database' | 'storage' | 'connectivity'

export type PerfTestResult = {
  name: string
  category: PerfTestCategory
  durationMs: number
  status: PerfTestStatus
  detail?: string
  threshold: { warning: number; critical: number }
}

export type PerfTestSuiteResult = {
  startedAt: string
  finishedAt: string
  totalDurationMs: number
  results: PerfTestResult[]
}

type TestDefinition = {
  name: string
  category: PerfTestCategory
  threshold: { warning: number; critical: number }
  fn: () => Promise<void>
}

const TESTS: TestDefinition[] = [
  {
    name: 'db.connection_acquire',
    category: 'database',
    threshold: { warning: 50, critical: 200 },
    fn: async () => {
      await prisma.$queryRaw`SELECT 1`
    },
  },
  {
    name: 'db.simple_select',
    category: 'database',
    threshold: { warning: 20, critical: 100 },
    fn: async () => {
      await prisma.$queryRaw`SELECT 1`
    },
  },
  {
    name: 'db.eventos_count_active',
    category: 'database',
    threshold: { warning: 50, critical: 250 },
    fn: async () => {
      await prisma.$queryRaw`SELECT COUNT(*) FROM eventos WHERE activo = true`
    },
  },
  {
    name: 'db.entradas_30d_aggregate',
    category: 'database',
    threshold: { warning: 200, critical: 1000 },
    fn: async () => {
      await prisma.$queryRaw`
        SELECT COUNT(*) AS cnt, COALESCE(SUM(precio_pagado), 0) AS total
        FROM entradas
        WHERE estado <> 'cancelada' AND created_at >= NOW() - INTERVAL '30 days'
      `
    },
  },
  {
    name: 'db.empresas_aggregate_top50',
    category: 'database',
    threshold: { warning: 500, critical: 2000 },
    fn: async () => {
      await prisma.$queryRaw`
        SELECT e.id, COUNT(en.id) AS ventas
        FROM empresas e
        LEFT JOIN eventos ev ON ev.empresa_id = e.id
        LEFT JOIN entradas en ON en.evento_id = ev.id AND en.estado <> 'cancelada'
        GROUP BY e.id
        LIMIT 50
      `
    },
  },
  {
    name: 'db.info_schema_tables',
    category: 'database',
    threshold: { warning: 100, critical: 500 },
    fn: async () => {
      await prisma.$queryRaw`
        SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = current_schema()
      `
    },
  },
  {
    name: 'storage.list_root',
    category: 'storage',
    threshold: { warning: 500, critical: 2000 },
    fn: async () => {
      const client = getSupabaseServerClient()
      if (!client) throw new Error('Supabase no configurado')
      const { error } = await client.storage
        .from(SUPABASE_STORAGE_BUCKET)
        .list('', { limit: 100 })
      if (error) throw new Error(error.message ?? 'Error listando bucket')
    },
  },
]

function classifyStatus(durationMs: number, threshold: TestDefinition['threshold']): PerfTestStatus {
  if (durationMs >= threshold.critical) return 'slow'
  return 'ok'
}

export async function runPerfTests(): Promise<PerfTestSuiteResult> {
  const startedAt = new Date()
  const suiteStart = performance.now()
  const results: PerfTestResult[] = []

  for (const test of TESTS) {
    const t0 = performance.now()
    try {
      await test.fn()
      const durationMs = Math.round(performance.now() - t0)
      results.push({
        name: test.name,
        category: test.category,
        durationMs,
        status: classifyStatus(durationMs, test.threshold),
        threshold: test.threshold,
      })
    } catch (err) {
      const durationMs = Math.round(performance.now() - t0)
      results.push({
        name: test.name,
        category: test.category,
        durationMs,
        status: 'failed',
        detail: err instanceof Error ? err.message : 'error desconocido',
        threshold: test.threshold,
      })
    }
  }

  const finishedAt = new Date()
  const totalDurationMs = Math.round(performance.now() - suiteStart)

  return {
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    totalDurationMs,
    results,
  }
}
