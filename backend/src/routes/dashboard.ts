import { Router, Request, Response } from 'express'
import { verifyInternal, requireAuth } from '../middleware/auth'
import { getActorEmpresaId, requirePermissionMiddleware } from '../lib/authz'
import type { Permisos } from '../lib/permisos'
import { logServerError } from '../lib/safe-log'
import { safeCsvCell } from '../lib/csv-escape'
import {
  buildCierreCajaExportFilename,
  buildCierreCajaWorkbookBuffer,
  CIERRE_CAJA_EXPORT_CONTENT_TYPE,
  type CierreCajaRow,
  type CierreCajaTotals,
} from '../lib/cierre-caja-export-workbook'
import { prisma } from '../lib/prisma'

const router = Router()

function isValidDateInput(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

router.get('/resumen', verifyInternal, requireAuth, requirePermissionMiddleware('ver_dashboard'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    const esEmpleado = user.userType === 'empleado'
    const permisos = user.permisos as Permisos | undefined
    const puedeVerIngresos = !esEmpleado || !permisos || permisos.ver_ingresos || permisos.ver_recaudacion
    const puedeVerCompradorSensitive = !esEmpleado || !permisos || permisos.ver_montos_compradores
    const fechaDesde = isValidDateInput(req.query.desde) ? req.query.desde : null
    const fechaHasta = isValidDateInput(req.query.hasta) ? req.query.hasta : null
    const eventoId = typeof req.query.evento === 'string' ? req.query.evento.trim() : ''

    // Computar período anterior comparable solo si tenemos rango definido (desde + hasta).
    // Si no hay filtros de fecha, no podemos comparar contra nada (es "all time").
    // Si el rango supera 365 días, omitir comparación: calcularla implicaría escanear
    // otros 365+ días de historial, lo que puede traer millones de filas innecesariamente.
    // Determine if we have a comparable previous period (requires desde + hasta, range ≤ 365 days)
    let hasComparacionPeriod = false
    let compDesde: string | null = null
    let compHasta: string | null = null
    if (fechaDesde && fechaHasta) {
      const from = new Date(fechaDesde + 'T00:00:00Z')
      const to = new Date(fechaHasta + 'T00:00:00Z')
      const daysDiff = !Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && to >= from
        ? Math.ceil((to.getTime() - from.getTime()) / (1000 * 60 * 60 * 24))
        : 0
      const rangoDemasiadoLargo = daysDiff > 365
      if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && to >= from && !rangoDemasiadoLargo) {
        // Length of period in days (inclusive)
        const days = Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)) + 1
        const prevToMs = from.getTime() - 24 * 60 * 60 * 1000 // día anterior al fechaDesde
        const prevFromMs = prevToMs - (days - 1) * 24 * 60 * 60 * 1000
        compDesde = new Date(prevFromMs).toISOString().slice(0, 10)
        compHasta = new Date(prevToMs).toISOString().slice(0, 10)
        hasComparacionPeriod = true
      }
    }

    // Build positional param arrays for Postgres ($1, $2, …)
    // We reuse the same filter values for multiple parallel queries.
    // pgVentas: empresa_id [, eventoId] [, fechaDesde] [, fechaHasta]
    const pgVentasParams: unknown[] = [empresaId]
    const pgVentasFilters: string[] = ['ev.empresa_id = $1', `en.estado != 'cancelada'`]
    let pgIdx = 2
    if (eventoId) { pgVentasFilters.push(`ev.id = $${pgIdx}`); pgVentasParams.push(eventoId); pgIdx++ }
    if (fechaDesde) { pgVentasFilters.push(`en.created_at >= $${pgIdx}`); pgVentasParams.push(fechaDesde); pgIdx++ }
    if (fechaHasta) { pgVentasFilters.push(`en.created_at < $${pgIdx}::date + INTERVAL '1 day'`); pgVentasParams.push(fechaHasta); pgIdx++ }
    const pgWhereVentas = pgVentasFilters.join(' AND ')

    const pgEventosParams: unknown[] = [empresaId]
    let pgEventosSql = `SELECT COUNT(*) as total FROM eventos WHERE empresa_id = $1 AND activo = true`
    if (eventoId) { pgEventosSql += ` AND id = $2`; pgEventosParams.push(eventoId) }

    const [ventas, ingresos, compradores, eventosActivos] = await Promise.all([
      prisma.$queryRawUnsafe<{ total: bigint }[]>(
        `SELECT COUNT(*) as total FROM entradas en
         JOIN eventos ev ON ev.id = en.evento_id
         WHERE ${pgWhereVentas}`,
        ...pgVentasParams
      ),
      prisma.$queryRawUnsafe<{ bruto_empresa: string; neto_empresa: string; total_bruto_comprador: string }[]>(
        `SELECT
           COALESCE(SUM(en.precio_pagado - COALESCE(en.comision, 0)), 0) as bruto_empresa,
           COALESCE(SUM(COALESCE(en.neto_empresa_amount, en.precio_pagado - COALESCE(en.comision, 0) - COALESCE(en.mp_fee_amount, 0))), 0) as neto_empresa,
           COALESCE(SUM(en.precio_pagado), 0) as total_bruto_comprador
         FROM entradas en
         JOIN eventos ev ON ev.id = en.evento_id
         WHERE ${pgWhereVentas}`,
        ...pgVentasParams
      ),
      prisma.$queryRawUnsafe<{ total: bigint }[]>(
        `SELECT COUNT(DISTINCT en.comprador_id) as total
         FROM entradas en
         JOIN eventos ev ON ev.id = en.evento_id
         WHERE ${pgWhereVentas}`,
        ...pgVentasParams
      ),
      prisma.$queryRawUnsafe<{ total: bigint }[]>(pgEventosSql, ...pgEventosParams),
    ])

    // --- BLOQUE PARALELO: ventasPorDia + topCategorias + heatmap + ventasPorEvento + ultimasVentasBase + eventosActivos + eventos ---
    // Todas tienen exactamente los mismos parámetros de entrada y no dependen entre sí.

    // Build ventasPorEvento params
    const pgVentasPorEventoParams: unknown[] = [empresaId]
    let pgVentasPorEventoSql = `SELECT ev.id as evento_id, ev.nombre as evento, COUNT(en.id) as ventas
         FROM eventos ev
          LEFT JOIN entradas en ON en.evento_id = ev.id AND en.estado != 'cancelada'
         WHERE ev.empresa_id = $1`
    let pgVpIdx = 2
    if (eventoId) { pgVentasPorEventoSql += ` AND ev.id = $${pgVpIdx}`; pgVentasPorEventoParams.push(eventoId); pgVpIdx++ }
    if (fechaDesde) { pgVentasPorEventoSql += ` AND en.created_at >= $${pgVpIdx}`; pgVentasPorEventoParams.push(fechaDesde); pgVpIdx++ }
    if (fechaHasta) { pgVentasPorEventoSql += ` AND en.created_at < $${pgVpIdx}::date + INTERVAL '1 day'`; pgVentasPorEventoParams.push(fechaHasta); pgVpIdx++ }
    pgVentasPorEventoSql += ` GROUP BY ev.id ORDER BY ventas DESC LIMIT 6`

    const pgEventosActivosParams: unknown[] = [empresaId]
    let pgEventosActivosSql = `SELECT ev.id,
          ev.nombre,
          COALESCE(fecha_actual.fecha_actual, fecha_proxima.fecha_proxima, fecha_ultima.fecha_ultima) as fecha,
          COALESCE(ventas_stats.vendidas, 0) as vendidas,
          COALESCE(ventas_stats.compradores, 0) as compradores,
          COALESCE(ventas_stats.recaudado, 0) as recaudado,
          COALESCE(categoria_stats.capacidad, 0) as capacidad,
          CASE
            WHEN fecha_actual.fecha_actual IS NOT NULL THEN 'actual'
            WHEN fecha_proxima.fecha_proxima IS NOT NULL THEN 'proximo'
            ELSE 'activo'
          END as kind,
          CASE
            WHEN fecha_actual.fecha_actual IS NOT NULL THEN 0
            WHEN fecha_proxima.fecha_proxima IS NOT NULL THEN 1
            ELSE 2
          END as prioridad
        FROM eventos ev
        LEFT JOIN (
          SELECT evento_id, MIN(fecha) as fecha_actual
          FROM evento_fechas
          WHERE DATE(fecha AT TIME ZONE 'America/Argentina/Buenos_Aires') = (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date
          GROUP BY evento_id
        ) fecha_actual ON fecha_actual.evento_id = ev.id
        LEFT JOIN (
          SELECT evento_id, MIN(fecha) as fecha_proxima
          FROM evento_fechas
          WHERE fecha > NOW()
          GROUP BY evento_id
        ) fecha_proxima ON fecha_proxima.evento_id = ev.id
        LEFT JOIN (
          SELECT evento_id, MAX(fecha) as fecha_ultima
          FROM evento_fechas
          GROUP BY evento_id
        ) fecha_ultima ON fecha_ultima.evento_id = ev.id
        LEFT JOIN (
          SELECT evento_id,
                 COUNT(*) as vendidas,
                 COUNT(DISTINCT comprador_id) as compradores,
                 COALESCE(SUM(precio_pagado), 0) as recaudado
          FROM entradas
          WHERE estado != 'cancelada'
          GROUP BY evento_id
        ) ventas_stats ON ventas_stats.evento_id = ev.id
        LEFT JOIN (
          SELECT evento_id, COALESCE(SUM(stock), 0) as capacidad
          FROM entrada_categorias
          GROUP BY evento_id
        ) categoria_stats ON categoria_stats.evento_id = ev.id
        WHERE ev.empresa_id = $1 AND ev.activo = true`
    if (eventoId) { pgEventosActivosSql += ` AND ev.id = $2`; pgEventosActivosParams.push(eventoId) }
    pgEventosActivosSql += ` ORDER BY prioridad ASC, fecha ASC, ev.nombre ASC`

    const [
      ventasPorDia,
      topCategorias,
      heatmapHorario,
      ventasPorEvento,
      ultimasVentasBase,
      eventosActivosDestacados,
      eventos,
    ] = await Promise.all([
      prisma.$queryRawUnsafe<{ dia: Date; ventas: bigint }[]>(
        `SELECT DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') as dia, COUNT(*) as ventas
         FROM entradas en
         JOIN eventos ev ON ev.id = en.evento_id
         WHERE ${pgWhereVentas}${fechaDesde || fechaHasta ? '' : ` AND en.created_at >= NOW() - INTERVAL '30 days'`}
         GROUP BY DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')
         ORDER BY dia ASC`,
        ...pgVentasParams
      ),
      // --- TOP 5 CATEGORÍAS más vendidas en el período ---
      prisma.$queryRawUnsafe<{ categoria_id: string; categoria: string; evento_id: string; evento_nombre: string; ventas: bigint; bruto: string }[]>(
        `SELECT ec.id as categoria_id, ec.nombre as categoria, ev.id as evento_id, ev.nombre as evento_nombre,
                COUNT(en.id) as ventas, COALESCE(SUM(en.precio_pagado), 0) as bruto
         FROM entradas en
         JOIN eventos ev ON ev.id = en.evento_id
         LEFT JOIN entrada_categorias ec ON ec.id = en.categoria_id
         WHERE ${pgWhereVentas}
         GROUP BY ec.id, ev.id
         ORDER BY ventas DESC
         LIMIT 5`,
        ...pgVentasParams
      ),
      // --- HEATMAP día de semana × hora ---
      // Postgres EXTRACT(DOW): 0=Sunday, 1=Monday, ..., 6=Saturday
      // We add 1 to match MySQL DAYOFWEEK convention (1=Sunday) so frontend keeps working
      prisma.$queryRawUnsafe<{ dia_semana: number; hora: number; ventas: bigint }[]>(
        `SELECT EXTRACT(DOW FROM en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::int + 1 as dia_semana, EXTRACT(HOUR FROM en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')::int as hora, COUNT(*) as ventas
         FROM entradas en
         JOIN eventos ev ON ev.id = en.evento_id
         WHERE ${pgWhereVentas}${fechaDesde || fechaHasta ? '' : ` AND en.created_at >= NOW() - INTERVAL '90 days'`}
         GROUP BY EXTRACT(DOW FROM en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires'), EXTRACT(HOUR FROM en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')`,
        ...pgVentasParams
      ),
      prisma.$queryRawUnsafe<{ evento_id: string; evento: string; ventas: bigint }[]>(pgVentasPorEventoSql, ...pgVentasPorEventoParams),
      // Query base para últimas ventas (sin subqueries correlacionadas — ver FIX 2)
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT
          en.id, en.precio_pagado, en.created_at, en.estado,
          c.id as comprador_id,
          c.nombre as comprador_nombre, c.email as comprador_email, c.dni as comprador_dni, c.created_at as comprador_created_at,
          ev.nombre as evento_nombre, ev.empresa_id as empresa_id,
          ec.nombre as categoria_nombre
         FROM entradas en
         JOIN compradores c ON c.id = en.comprador_id
         JOIN eventos ev ON ev.id = en.evento_id
         LEFT JOIN entrada_categorias ec ON ec.id = en.categoria_id
         WHERE ${pgWhereVentas}
         ORDER BY en.created_at DESC
         LIMIT 5`,
        ...pgVentasParams
      ),
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(pgEventosActivosSql, ...pgEventosActivosParams),
      prisma.$queryRawUnsafe<{ id: string; nombre: string }[]>(
        `SELECT id, nombre
         FROM eventos
         WHERE empresa_id = $1
         ORDER BY nombre ASC`,
        empresaId
      ),
    ])

    // --- BLOQUE PARALELO 2: comparación período anterior + stats compradores en batch ---
    // Ambos dependen solo del bloque anterior, no entre sí.
    // compradorStats depende de ultimasVentasBase (ya disponible), no de comparacion.
    const compradorIds = [...new Set((ultimasVentasBase as { comprador_id: string }[]).map((v) => v.comprador_id))]

    const [comparacionRaw, compradorStatsRaw] = await Promise.all([
      // --- COMPARACIÓN PERÍODO ANTERIOR (solo si hay rango definido) ---
      hasComparacionPeriod
        ? (async () => {
            // Build Postgres-style comparison filters
            const pgCompParams: unknown[] = [empresaId]
            const pgCompFilters: string[] = ['ev.empresa_id = $1', `en.estado != 'cancelada'`]
            let pgCompIdx = 2
            if (eventoId) { pgCompFilters.push(`ev.id = $${pgCompIdx}`); pgCompParams.push(eventoId); pgCompIdx++ }
            pgCompFilters.push(`en.created_at >= $${pgCompIdx}`); pgCompParams.push(compDesde!); pgCompIdx++
            pgCompFilters.push(`en.created_at < $${pgCompIdx}::date + INTERVAL '1 day'`); pgCompParams.push(compHasta!); pgCompIdx++
            const pgWhereComp = pgCompFilters.join(' AND ')
            const [compVentas, compIngresos, compCompradores] = await Promise.all([
              prisma.$queryRawUnsafe<{ total: bigint }[]>(
                `SELECT COUNT(*) as total FROM entradas en
                 JOIN eventos ev ON ev.id = en.evento_id
                 WHERE ${pgWhereComp}`,
                ...pgCompParams
              ),
              prisma.$queryRawUnsafe<{ neto_empresa: string; total_bruto_comprador: string }[]>(
                `SELECT
                   COALESCE(SUM(COALESCE(en.neto_empresa_amount, en.precio_pagado - COALESCE(en.comision, 0) - COALESCE(en.mp_fee_amount, 0))), 0) as neto_empresa,
                   COALESCE(SUM(en.precio_pagado), 0) as total_bruto_comprador
                 FROM entradas en
                 JOIN eventos ev ON ev.id = en.evento_id
                 WHERE ${pgWhereComp}`,
                ...pgCompParams
              ),
              prisma.$queryRawUnsafe<{ total: bigint }[]>(
                `SELECT COUNT(DISTINCT en.comprador_id) as total
                 FROM entradas en
                 JOIN eventos ev ON ev.id = en.evento_id
                 WHERE ${pgWhereComp}`,
                ...pgCompParams
              ),
            ])
            return {
              ventas: Number(compVentas[0]?.total ?? 0n),
              ingresos_netos: Number(compIngresos[0]?.neto_empresa ?? 0),
              ingresos_brutos_totales: Number(compIngresos[0]?.total_bruto_comprador ?? 0),
              compradores: Number(compCompradores[0]?.total ?? 0n),
              desde: compDesde!,
              hasta: compHasta!,
            }
          })()
        : Promise.resolve(null),
      // Stats de compradores en batch (un solo IN en lugar de N×3 subqueries correlacionadas)
      compradorIds.length > 0
        ? prisma.$queryRawUnsafe<{ comprador_id: string; comprador_total_entradas: bigint; comprador_total_gastado: string; comprador_ultima_compra: Date | null }[]>(
            `SELECT en_stats.comprador_id,
                    COUNT(*) as comprador_total_entradas,
                    COALESCE(SUM(en_stats.precio_pagado), 0) as comprador_total_gastado,
                    MAX(en_stats.created_at) as comprador_ultima_compra
             FROM entradas en_stats
             JOIN eventos ev_stats ON ev_stats.id = en_stats.evento_id
             WHERE en_stats.estado != 'cancelada'
               AND ev_stats.empresa_id = $1
               AND en_stats.comprador_id = ANY($2::text[])
             GROUP BY en_stats.comprador_id`,
            empresaId, compradorIds
          )
        : Promise.resolve([]),
    ])

    const comparacion = comparacionRaw

    // Merge en memoria
    const statsMap = new Map((compradorStatsRaw as { comprador_id: string; comprador_total_entradas: bigint; comprador_total_gastado: string; comprador_ultima_compra: Date | null }[]).map((s) => [s.comprador_id, s]))
    type UltimaVentaRow = Record<string, unknown> & {
      precio_pagado: unknown
      comprador_id: string
      comprador_email: unknown
      comprador_dni: unknown
      comprador_total_entradas: number
      comprador_total_gastado: number
      comprador_ultima_compra: Date | null
    }
    const ultimasVentas = (ultimasVentasBase as Record<string, unknown>[]).map((v) => {
      const stats = statsMap.get(v.comprador_id as string)
      return {
        ...v,
        comprador_total_entradas: Number(stats?.comprador_total_entradas ?? 0n),
        comprador_total_gastado: Number(stats?.comprador_total_gastado ?? 0),
        comprador_ultima_compra: stats?.comprador_ultima_compra ?? null,
      } as UltimaVentaRow
    })

    const eventoDestacado = (eventosActivosDestacados as Record<string, unknown>[])[0] ?? null
    const ultimasVentasSanitizadas = ultimasVentas.map((venta) => ({
      ...venta,
      precio_pagado: puedeVerIngresos ? Number(venta.precio_pagado ?? 0) : null,
      comprador_email: puedeVerCompradorSensitive ? venta.comprador_email : null,
      comprador_dni: puedeVerCompradorSensitive ? venta.comprador_dni : null,
      comprador_total_gastado: puedeVerCompradorSensitive ? Number(venta.comprador_total_gastado ?? 0) : null,
      comprador_ultima_compra: puedeVerCompradorSensitive ? venta.comprador_ultima_compra : null,
    }))

    return res.json({
      data: {
        metricas: {
          ventas: Number(ventas[0]?.total ?? 0n),
          ingresos: puedeVerIngresos ? Number(ingresos[0]?.neto_empresa ?? 0) : null,
          ingresos_netos: puedeVerIngresos ? Number(ingresos[0]?.neto_empresa ?? 0) : null,
          ingresos_brutos_empresa: puedeVerIngresos ? Number(ingresos[0]?.bruto_empresa ?? 0) : null,
          ingresos_brutos_totales: puedeVerIngresos ? Number(ingresos[0]?.total_bruto_comprador ?? 0) : null,
          compradores: Number(compradores[0]?.total ?? 0n),
          eventosActivos: Number(eventosActivos[0]?.total ?? 0n),
        },
        comparacion: comparacion
          ? {
              ventas: comparacion.ventas,
              ingresos_netos: puedeVerIngresos ? comparacion.ingresos_netos : null,
              ingresos_brutos_totales: puedeVerIngresos ? comparacion.ingresos_brutos_totales : null,
              compradores: comparacion.compradores,
              desde: comparacion.desde,
              hasta: comparacion.hasta,
            }
          : null,
        ventas_por_dia: (ventasPorDia as { dia: Date; ventas: bigint }[]).map((row) => ({
          dia: row.dia instanceof Date ? row.dia.toISOString().slice(0, 10) : String(row.dia).slice(0, 10),
          ventas: Number(row.ventas ?? 0n),
        })),
        ventas_por_evento: ventasPorEvento,
        top_categorias: (topCategorias as { categoria_id: string; categoria: string; evento_id: string; evento_nombre: string; ventas: bigint; bruto: string }[]).map((row) => ({
          categoria_id: row.categoria_id ? String(row.categoria_id) : null,
          categoria: row.categoria ? String(row.categoria) : 'Sin categoría',
          evento_id: row.evento_id ? String(row.evento_id) : null,
          evento_nombre: row.evento_nombre ? String(row.evento_nombre) : null,
          ventas: Number(row.ventas ?? 0n),
          bruto: puedeVerIngresos ? Number(row.bruto ?? 0) : null,
        })),
        heatmap_horario: (heatmapHorario as { dia_semana: number; hora: number; ventas: bigint }[]).map((row) => ({
          dia_semana: Number(row.dia_semana ?? 0),
          hora: Number(row.hora ?? 0),
          ventas: Number(row.ventas ?? 0n),
        })),
        eventos,
        eventos_activos: (eventosActivosDestacados as Record<string, unknown>[]).map(({ prioridad: _p, ...evento }) => ({
          ...evento,
          recaudado: puedeVerIngresos ? Number(evento.recaudado ?? 0) : null,
        })),
        ultimas_ventas: ultimasVentasSanitizadas,
        proximo_evento: eventoDestacado
          ? {
              ...eventoDestacado,
              recaudado: puedeVerIngresos ? Number(eventoDestacado.recaudado ?? 0) : null,
            }
          : null,
        periodo: {
          desde: fechaDesde,
          hasta: fechaHasta,
        },
        filtros: {
          evento: eventoId || null,
        },
      },
    })
  } catch (error) {
    // `catch {}` sin capturar el error descartaba la unica pista de por que
    // fallaba: el endpoint devolvia 500 y el log solo decia "dashboard resumen".
    logServerError('dashboard resumen', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

const csvEscape = safeCsvCell

function formatMoneyForCsv(value: unknown): string {
  const num = Number(value ?? 0)
  if (!Number.isFinite(num)) return '0.00'
  return num.toFixed(2)
}

// GET /dashboard/cierre-caja/export — cierre de caja diario consolidado
router.get('/cierre-caja/export', verifyInternal, requireAuth, requirePermissionMiddleware('exportar'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const permisos = user.permisos as Permisos | undefined

    if (esEmpleado && !permisos?.ver_recaudacion) {
      return res.status(403).json({ error: 'Sin permiso para ver recaudación' })
    }

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const desde = isValidDateInput(req.query.desde) ? req.query.desde : null
    const hasta = isValidDateInput(req.query.hasta) ? req.query.hasta : null
    const eventoId = typeof req.query.evento === 'string' ? req.query.evento.trim() : ''
    const format = req.query.format === 'xlsx' ? 'xlsx' : 'csv'

    // Default range: últimos 30 días si no se especifica nada
    const today = new Date()
    const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
    const effectiveDesde = desde ?? thirtyDaysAgo.toISOString().slice(0, 10)
    const effectiveHasta = hasta ?? today.toISOString().slice(0, 10)

    // Build cierre-caja query params (Postgres positional)
    const pgCcEntBaseParams: unknown[] = [empresaId, effectiveDesde, effectiveHasta]
    let pgCcEntSql = `SELECT DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') AS fecha,
              COUNT(CASE WHEN en.estado <> 'cancelada' THEN 1 END) AS entradas_count,
              COUNT(CASE WHEN en.estado = 'cancelada' THEN 1 END) AS entradas_refunds_count,
              COALESCE(SUM(en.precio_pagado), 0) AS entradas_bruto,
              COALESCE(SUM(CASE WHEN en.estado <> 'cancelada' THEN COALESCE(en.comision, 0) ELSE 0 END), 0) AS entradas_comision_platea,
              COALESCE(SUM(CASE WHEN en.estado <> 'cancelada' THEN COALESCE(en.mp_fee_amount, 0) ELSE 0 END), 0) AS entradas_mp_fee,
              COALESCE(SUM(CASE WHEN en.estado <> 'cancelada' THEN en.precio_pagado - COALESCE(en.comision, 0) ELSE 0 END), 0) AS entradas_neto,
              COALESCE(SUM(CASE WHEN en.estado = 'cancelada' THEN en.precio_pagado ELSE 0 END), 0) AS entradas_refunds_monto
       FROM entradas en
       JOIN eventos ev ON ev.id = en.evento_id
       WHERE ev.empresa_id = $1
         AND en.created_at >= $2
         AND en.created_at < $3::date + INTERVAL '1 day'`
    if (eventoId) { pgCcEntSql += ` AND ev.id = $4`; pgCcEntBaseParams.push(eventoId) }
    pgCcEntSql += ` GROUP BY DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')`

    const pgCcCvBaseParams: unknown[] = [empresaId, effectiveDesde, effectiveHasta]
    let pgCcCvSql = `SELECT DATE(cv.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') AS fecha,
              COUNT(CASE WHEN cv.estado <> 'cancelado' THEN 1 END) AS consumibles_count,
              COUNT(CASE WHEN cv.estado = 'cancelado' THEN 1 END) AS consumibles_refunds_count,
              COALESCE(SUM(cv.total), 0) AS consumibles_bruto,
              COALESCE(SUM(CASE WHEN cv.estado <> 'cancelado' THEN COALESCE(cv.owner_fee_amount, 0) ELSE 0 END), 0) AS consumibles_comision_platea,
              COALESCE(SUM(CASE WHEN cv.estado <> 'cancelado' THEN COALESCE(cv.mp_fee_amount, 0) ELSE 0 END), 0) AS consumibles_mp_fee,
              COALESCE(SUM(CASE WHEN cv.estado <> 'cancelado' THEN cv.total - COALESCE(cv.owner_fee_amount, 0) ELSE 0 END), 0) AS consumibles_neto,
              COALESCE(SUM(CASE WHEN cv.estado = 'cancelado' THEN COALESCE(cv.refunded_amount, cv.total) WHEN cv.estado = 'resuelto_parcial' THEN cv.total - COALESCE(cv.delivered_amount, 0) ELSE 0 END), 0) AS consumibles_refunds_monto
       FROM consumibles_ventas cv
       JOIN eventos ev ON ev.id = cv.evento_id
       WHERE ev.empresa_id = $1
         AND cv.created_at >= $2
         AND cv.created_at < $3::date + INTERVAL '1 day'`
    if (eventoId) { pgCcCvSql += ` AND ev.id = $4`; pgCcCvBaseParams.push(eventoId) }
    pgCcCvSql += ` GROUP BY DATE(cv.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')`

    // 1) + 2) + 3) en paralelo
    const [entradasPorDia, consumiblesPorDia, descuentosPorDia] = await Promise.all([
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(pgCcEntSql, ...pgCcEntBaseParams),
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(pgCcCvSql, ...pgCcCvBaseParams),
      // 3) Descuentos aplicados por día (no aplica filtro por evento — los descuentos suelen ser empresa-wide)
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT DATE(u.usado_at AT TIME ZONE 'America/Argentina/Buenos_Aires') AS fecha,
                COUNT(*) AS descuentos_count,
                COALESCE(SUM(u.descuento_aplicado), 0) AS descuentos_monto
         FROM marketing_codigos_descuento_usos u
         JOIN marketing_codigos_descuento c ON c.id = u.codigo_id
         WHERE c.empresa_id = $1
           AND u.usado_at >= $2
           AND u.usado_at < $3::date + INTERVAL '1 day'
         GROUP BY DATE(u.usado_at AT TIME ZONE 'America/Argentina/Buenos_Aires')`,
        empresaId, effectiveDesde, effectiveHasta
      ),
    ])

    type DayBucket = {
      fecha: string
      entradas_count: number
      entradas_bruto: number
      entradas_comision_platea: number
      entradas_mp_fee: number
      entradas_neto: number
      entradas_refunds_count: number
      entradas_refunds_monto: number
      consumibles_count: number
      consumibles_bruto: number
      consumibles_comision_platea: number
      consumibles_mp_fee: number
      consumibles_neto: number
      consumibles_refunds_count: number
      consumibles_refunds_monto: number
      descuentos_count: number
      descuentos_monto: number
    }

    function emptyBucket(fecha: string): DayBucket {
      return {
        fecha,
        entradas_count: 0,
        entradas_bruto: 0,
        entradas_comision_platea: 0,
        entradas_mp_fee: 0,
        entradas_neto: 0,
        entradas_refunds_count: 0,
        entradas_refunds_monto: 0,
        consumibles_count: 0,
        consumibles_bruto: 0,
        consumibles_comision_platea: 0,
        consumibles_mp_fee: 0,
        consumibles_neto: 0,
        consumibles_refunds_count: 0,
        consumibles_refunds_monto: 0,
        descuentos_count: 0,
        descuentos_monto: 0,
      }
    }

    function fechaKey(value: unknown): string {
      if (value instanceof Date) return value.toISOString().slice(0, 10)
      return String(value ?? '').slice(0, 10)
    }

    const buckets = new Map<string, DayBucket>()

    for (const row of entradasPorDia) {
      const fecha = fechaKey(row.fecha)
      if (!buckets.has(fecha)) buckets.set(fecha, emptyBucket(fecha))
      const b = buckets.get(fecha)!
      b.entradas_count = Number(row.entradas_count ?? 0)
      b.entradas_bruto = Number(row.entradas_bruto ?? 0)
      b.entradas_comision_platea = Number(row.entradas_comision_platea ?? 0)
      b.entradas_mp_fee = Number(row.entradas_mp_fee ?? 0)
      b.entradas_neto = Number(row.entradas_neto ?? 0)
      b.entradas_refunds_count = Number(row.entradas_refunds_count ?? 0)
      b.entradas_refunds_monto = Number(row.entradas_refunds_monto ?? 0)
    }

    for (const row of consumiblesPorDia) {
      const fecha = fechaKey(row.fecha)
      if (!buckets.has(fecha)) buckets.set(fecha, emptyBucket(fecha))
      const b = buckets.get(fecha)!
      b.consumibles_count = Number(row.consumibles_count ?? 0)
      b.consumibles_bruto = Number(row.consumibles_bruto ?? 0)
      b.consumibles_comision_platea = Number(row.consumibles_comision_platea ?? 0)
      b.consumibles_mp_fee = Number(row.consumibles_mp_fee ?? 0)
      b.consumibles_neto = Number(row.consumibles_neto ?? 0)
      b.consumibles_refunds_count = Number(row.consumibles_refunds_count ?? 0)
      b.consumibles_refunds_monto = Number(row.consumibles_refunds_monto ?? 0)
    }

    // Si hay filtro por evento, no incluyo descuentos (son empresa-wide y distorsionarían)
    if (!eventoId) {
      for (const row of descuentosPorDia) {
        const fecha = fechaKey(row.fecha)
        if (!buckets.has(fecha)) buckets.set(fecha, emptyBucket(fecha))
        const b = buckets.get(fecha)!
        b.descuentos_count = Number(row.descuentos_count ?? 0)
        b.descuentos_monto = Number(row.descuentos_monto ?? 0)
      }
    }

    // Ordenar por fecha DESC (más reciente primero)
    const sortedDays = Array.from(buckets.values()).sort((a, b) => (a.fecha < b.fecha ? 1 : -1))

    // Construir estructuras comunes (rows + totals) que sirven para CSV y XLSX
    const reportRows: CierreCajaRow[] = []
    let acumBruto = 0
    let acumComision = 0
    let acumNeto = 0
    let acumRefunds = 0
    let acumDescuentos = 0

    for (const day of sortedDays) {
      const totalBruto = (day.entradas_bruto - day.entradas_refunds_monto) + (day.consumibles_bruto - day.consumibles_refunds_monto)
      const totalComision = day.entradas_comision_platea + day.consumibles_comision_platea
      const totalNeto = day.entradas_neto + day.consumibles_neto
      const refundsCount = day.entradas_refunds_count + day.consumibles_refunds_count
      const refundsMonto = day.entradas_refunds_monto + day.consumibles_refunds_monto

      acumBruto += totalBruto
      acumComision += totalComision
      acumNeto += totalNeto
      acumRefunds += refundsMonto
      acumDescuentos += day.descuentos_monto

      reportRows.push({
        fecha: day.fecha,
        entradas_vendidas: day.entradas_count,
        entradas_bruto: day.entradas_bruto,
        consumibles_vendidos: day.consumibles_count,
        consumibles_bruto: day.consumibles_bruto,
        descuentos_count: day.descuentos_count,
        descuentos_monto: day.descuentos_monto,
        refunds_count: refundsCount,
        refunds_monto: refundsMonto,
        total_bruto: totalBruto,
        comision_platea: totalComision,
        neto_empresa: totalNeto,
      })
    }

    const totals: CierreCajaTotals | null = sortedDays.length > 0
      ? {
          total_bruto: acumBruto,
          comision_platea: acumComision,
          neto_empresa: acumNeto,
          refunds_monto: acumRefunds,
          descuentos_monto: acumDescuentos,
        }
      : null

    // Branch por formato — XLSX o CSV
    if (format === 'xlsx') {
      const buffer = await buildCierreCajaWorkbookBuffer(reportRows, totals)
      const filename = buildCierreCajaExportFilename({ desde: effectiveDesde, hasta: effectiveHasta })
      res.setHeader('Content-Type', CIERRE_CAJA_EXPORT_CONTENT_TYPE)
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      return res.send(buffer)
    }

    // Default: CSV
    const headers = [
      'fecha',
      'entradas_vendidas',
      'entradas_bruto',
      'consumibles_vendidos',
      'consumibles_bruto',
      'descuentos_count',
      'descuentos_monto',
      'refunds_count',
      'refunds_monto',
      'total_bruto',
      'comision_platea',
      'neto_empresa',
    ]
    const lines: string[] = [headers.join(',')]

    for (const row of reportRows) {
      lines.push([
        csvEscape(row.fecha),
        csvEscape(row.entradas_vendidas),
        csvEscape(formatMoneyForCsv(row.entradas_bruto)),
        csvEscape(row.consumibles_vendidos),
        csvEscape(formatMoneyForCsv(row.consumibles_bruto)),
        csvEscape(row.descuentos_count),
        csvEscape(formatMoneyForCsv(row.descuentos_monto)),
        csvEscape(row.refunds_count),
        csvEscape(formatMoneyForCsv(row.refunds_monto)),
        csvEscape(formatMoneyForCsv(row.total_bruto)),
        csvEscape(formatMoneyForCsv(row.comision_platea)),
        csvEscape(formatMoneyForCsv(row.neto_empresa)),
      ].join(','))
    }

    if (totals) {
      lines.push([
        csvEscape('TOTAL'),
        '',
        '',
        '',
        '',
        '',
        csvEscape(formatMoneyForCsv(totals.descuentos_monto)),
        '',
        csvEscape(formatMoneyForCsv(totals.refunds_monto)),
        csvEscape(formatMoneyForCsv(totals.total_bruto)),
        csvEscape(formatMoneyForCsv(totals.comision_platea)),
        csvEscape(formatMoneyForCsv(totals.neto_empresa)),
      ].join(','))
    }

    const csv = '﻿' + lines.join('\r\n')
    const filename = `cierre-caja-${effectiveDesde}_${effectiveHasta}.csv`

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.send(csv)
  } catch {
    logServerError('dashboard cierre-caja export')
    return res.status(500).json({ error: 'No se pudo exportar el cierre de caja' })
  }
})

export default router
