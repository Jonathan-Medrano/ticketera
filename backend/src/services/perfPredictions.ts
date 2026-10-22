import { logServerError } from '../lib/safe-log'
import { prisma } from '../lib/prisma'

export type PerfAlertSeverity = 'info' | 'warning' | 'critical'
export type PerfAlertCategory =
  | 'stock'
  | 'storage'
  | 'database'
  | 'webhooks'
  | 'memory'
  | 'sales'

export type PerfAlert = {
  severity: PerfAlertSeverity
  category: PerfAlertCategory
  title: string
  description: string
  recommendation: string
  metric?: string | number
}

/**
 * Computa alertas predictivas basadas en estado actual de la DB. No usa ML —
 * son heurísticas simples sobre datos indexados.
 *
 * Cada check falla silenciosamente: si una query rompe (tabla no existe, etc.)
 * el resto sigue corriendo. Mejor algunas alertas que ninguna.
 */
export async function getPerformancePredictions(): Promise<PerfAlert[]> {
  const alerts: PerfAlert[] = []

  // 1. Stock crítico cerca de fecha de evento
  try {
    const rows = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(DISTINCT ev.id) AS cnt
      FROM eventos ev
      JOIN entrada_categorias ec ON ec.evento_id = ev.id
      JOIN evento_fechas ef ON ef.evento_id = ev.id
      WHERE ev.activo = true
        AND ef.fecha BETWEEN NOW() AND NOW() + INTERVAL '7 days'
        AND ec.stock > 0
        AND (ec.stock_disponible::numeric / ec.stock::numeric) < 0.20
    `
    const cnt = Number(rows[0]?.cnt ?? 0)
    if (cnt > 0) {
      alerts.push({
        severity: cnt > 5 ? 'critical' : 'warning',
        category: 'stock',
        title: `${cnt} evento(s) con stock crítico próximo a su fecha`,
        description: 'Eventos en los próximos 7 días con menos del 20% de stock disponible en al menos una categoría.',
        recommendation: 'Aumentar stock o avisar al equipo comercial. Riesgo de sold-out + carrito abandonado en puerta.',
        metric: cnt,
      })
    }
  } catch {
    logServerError('perf prediction: stock check')
  }

  // 2. audit_logs creciendo sin archivado
  try {
    const rows = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*) AS cnt FROM audit_logs
    `
    const cnt = Number(rows[0]?.cnt ?? 0)
    if (cnt > 1_000_000) {
      alerts.push({
        severity: cnt > 5_000_000 ? 'critical' : 'warning',
        category: 'database',
        title: `audit_logs tiene ~${cnt.toLocaleString('es-AR')} filas`,
        description: 'Tabla creciente sin job de archivado. A futuro impacta latencia de queries y costos de backup.',
        recommendation: 'Implementar archivado mensual (move-to audit_logs_archive) o exportación a object storage.',
        metric: cnt,
      })
    }
  } catch {
    logServerError('perf prediction: audit_logs check')
  }

  // 3. Checkout sessions huérfanas
  try {
    const rows = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*) AS cnt
      FROM checkout_sessions
      WHERE estado = 'pendiente' AND expires_at < NOW() - INTERVAL '1 hour'
    `
    const cnt = Number(rows[0]?.cnt ?? 0)
    if (cnt > 50) {
      alerts.push({
        severity: cnt > 500 ? 'critical' : 'warning',
        category: 'sales',
        title: `${cnt} checkouts pendientes expirados sin limpiar`,
        description: 'El job expiredCheckoutCleanup puede estar caído o procesando más lento que la tasa de carrito abandonado.',
        recommendation: 'Verificar logs de expiredCheckoutCleanupJob. Si crece sostenidamente, escalar intervalo o investigar bloqueo.',
        metric: cnt,
      })
    }
  } catch {
    logServerError('perf prediction: checkout sessions check')
  }

  // 4. Webhooks procesados últimas 24hs (informativo — baseline)
  try {
    const rows = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*) AS cnt
      FROM processed_webhooks
      WHERE processed_at >= NOW() - INTERVAL '24 hours'
    `
    const cnt = Number(rows[0]?.cnt ?? 0)
    alerts.push({
      severity: 'info',
      category: 'webhooks',
      title: `${cnt} webhooks procesados en las últimas 24hs`,
      description: 'Baseline actual de webhooks MP idempotentes. Si baja a 0 cuando esperás ventas, MP no está enviando o la signature está fallando.',
      recommendation: 'Si la cifra no coincide con el volumen esperado de ventas, revisar config en panel MP.',
      metric: cnt,
    })
  } catch {
    logServerError('perf prediction: webhooks check')
  }

  // 5. Storage quota basado en último cleanup run
  try {
    const rows = await prisma.$queryRaw<Array<{ scanned: number }>>`
      SELECT scanned FROM storage_cleanup_runs
      WHERE status = 'ok'
      ORDER BY started_at DESC LIMIT 1
    `
    const lastScanned = Number(rows[0]?.scanned ?? 0)
    if (lastScanned > 3000) {
      alerts.push({
        severity: lastScanned > 5000 ? 'critical' : 'warning',
        category: 'storage',
        title: `Supabase Storage: ~${lastScanned.toLocaleString('es-AR')} archivos`,
        description: 'Free tier de Supabase = 1GB. A ~200KB promedio por imagen, este volumen está cerca del límite.',
        recommendation: 'Upgrade al plan Pro de Supabase, o reducir el cooldown del cleanup job a 12hs para liberar más rápido.',
        metric: lastScanned,
      })
    }
  } catch {
    // Tabla puede no existir todavía — skip
  }

  // 6. Eventos próximos sin ventas
  try {
    const rows = await prisma.$queryRaw<Array<{ cnt: bigint }>>`
      SELECT COUNT(*) AS cnt FROM (
        SELECT ev.id
        FROM eventos ev
        JOIN evento_fechas ef ON ef.evento_id = ev.id
        LEFT JOIN entradas en ON en.evento_id = ev.id AND en.estado <> 'cancelada'
        WHERE ev.activo = true
          AND ef.fecha BETWEEN NOW() AND NOW() + INTERVAL '14 days'
        GROUP BY ev.id
        HAVING COUNT(en.id) = 0
      ) sub
    `
    const cnt = Number(rows[0]?.cnt ?? 0)
    if (cnt > 0) {
      alerts.push({
        severity: 'info',
        category: 'sales',
        title: `${cnt} evento(s) en 2 semanas sin ventas confirmadas`,
        description: 'Eventos activos con fecha próxima y 0 entradas vendidas. Posible problema de descubrimiento o promoción.',
        recommendation: 'Verificar publicación en tenant + campañas de marketing activas.',
        metric: cnt,
      })
    }
  } catch {
    logServerError('perf prediction: eventos sin ventas check')
  }

  // 7. Top tabla excesivamente grande (data + index > 500MB)
  try {
    // Postgres: pg_total_relation_size per table
    const rows = await prisma.$queryRaw<Array<{ name: string; total_bytes: bigint }>>`
      SELECT relname AS name, pg_total_relation_size(relid) AS total_bytes
      FROM pg_stat_user_tables
      WHERE pg_total_relation_size(relid) > 500 * 1024 * 1024
      ORDER BY total_bytes DESC
      LIMIT 3
    `
    for (const row of rows) {
      const name = String(row.name)
      const sizeMb = Number(row.total_bytes ?? 0) / (1024 * 1024)
      alerts.push({
        severity: sizeMb > 2000 ? 'critical' : 'warning',
        category: 'database',
        title: `Tabla ${name} supera ${sizeMb.toFixed(0)} MB`,
        description: 'Tabla individualmente grande. A futuro afecta backup time, query plan y costos.',
        recommendation: 'Revisar si necesita particionado, archivado, o solo mejor indexación.',
        metric: `${sizeMb.toFixed(0)} MB`,
      })
    }
  } catch {
    logServerError('perf prediction: large tables check')
  }

  return alerts
}
