import { Router, Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import { verifyInternal, requireAuth } from '../middleware/auth'
import { getActorEmpresaId, requirePermissionMiddleware } from '../lib/authz'
import { logServerError } from '../lib/safe-log'
import { safeMsg } from '../lib/http-error'
import { buildRevendedoresCsvExportFilename, buildRevendedoresExportFilename, buildRevendedoresWorkbookBuffer, REVENDEDORES_EXPORT_CONTENT_TYPE } from '../lib/revendedores-export-workbook'
import { listTicketsAsignadosARevendedor, venderTicketFisico } from '../lib/preimpresos'
import { actorFromRequest, logAuditEvent } from '../lib/audit-log'

const router = Router()
const HARD_LIMIT = 500
const DEFAULT_PAGE_SIZE = 25
const DEFAULT_EXPORT_LIMIT = 2000

function formatCsvDateTime(value: string | null | undefined) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  return formatter.format(date)
}

import { safeCsvCell } from '../lib/csv-escape'

function toCsv(rows: Array<Record<string, unknown>>, columns: string[]) {
  const header = columns.map(safeCsvCell).join(',')
  const body = rows.map((row) => columns.map((column) => safeCsvCell(row[column])).join(',')).join('\n')
  return body ? `${header}\n${body}\n` : `${header}\n`
}

function resolveRevendedoresExportColumns() {
  return ['revendedor', 'fecha_alta', 'ventas_totales', 'ganancia_total', 'ganancia_neta']
}

function serializeRevendedoresExportRows(rows: Record<string, unknown>[]) {
  return rows.map((revendedor) => ({
    revendedor: `${String(revendedor.nombre ?? '')}${revendedor.apellido ? ` ${String(revendedor.apellido)}` : ''}`.trim(),
    fecha_alta: formatCsvDateTime(String(revendedor.created_at ?? '')),
    ventas_totales: Number(revendedor.total_ventas ?? 0),
    ganancia_total: Number(revendedor.total_generado ?? 0),
    ganancia_neta: Number(revendedor.total_comision ?? 0),
  }))
}

function resolveRevendedoresExportLimit() {
  const raw = Number(process.env.REVENDEDORES_EXPORT_MAX_ROWS)
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_EXPORT_LIMIT
  return Math.floor(raw)
}

function resolveRevendedoresExportFormat(req: Request) {
  return req.query.format === 'xlsx' ? 'xlsx' : 'csv'
}

router.get('/me', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!

    if (user.userType !== 'empleado') {
      return res.status(403).json({ error: 'Solo revendedores' })
    }

    if (!user.empresa_id) {
      return res.status(403).json({ error: 'Perfil sin empresa asociada' })
    }

    const revendedorId = user.id
    const empresaId = user.empresa_id

    // Site R1 — revendedor profile lookup
    type RevendedorMeRow = { id: string; nombre: string; apellido: string | null; email: string; porcentaje_comision: string | null }
    const revendedorRows = await prisma.$queryRawUnsafe<RevendedorMeRow[]>(
      `SELECT id, nombre, apellido, email, porcentaje_comision
       FROM usuarios WHERE id = $1 AND empresa_id = $2 AND rol = 'revendedor'`,
      revendedorId, empresaId,
    )

    if (!revendedorRows[0]) {
      return res.status(404).json({ error: 'Revendedor no encontrado' })
    }

    // Sites R2a-R2d — four parallel reads
    type VentasMeRow = { id: string; precio_pagado: string; comision_revendedor: string; created_at: Date; estado: string; evento_nombre: string; evento_id: string; imagen_url: string | null; categoria_nombre: string | null }
    type EventosMeRow = { id: string; nombre: string; imagen_url: string | null; stock_disponible: string; vendidas: string; stock_total: string }
    type EmpresaSlugRow = { slug: string }
    type VentasPorDiaRow = { dia: string; ventas: bigint }
    const [ventas, eventos, empresaRows, ventasPorDia] = await Promise.all([
      prisma.$queryRawUnsafe<VentasMeRow[]>(
        `SELECT
          en.id, en.precio_pagado, en.comision_revendedor, en.created_at, en.estado,
          ev.nombre as evento_nombre, ev.id as evento_id, ev.imagen_url,
          ec.nombre as categoria_nombre
         FROM entradas en
         JOIN eventos ev ON ev.id = en.evento_id AND ev.empresa_id = $1
         LEFT JOIN entrada_categorias ec ON ec.id = en.categoria_id
         WHERE en.revendedor_id = $2
         ORDER BY en.created_at DESC
         LIMIT $3`,
        empresaId, revendedorId, HARD_LIMIT,
      ),
      prisma.$queryRawUnsafe<EventosMeRow[]>(
        `SELECT e.id, e.nombre, e.imagen_url,
          COALESCE(SUM(ec.stock_disponible), 0) as stock_disponible,
          GREATEST(COALESCE(SUM(ec.stock - ec.stock_disponible), 0), 0) as vendidas,
          COALESCE(SUM(ec.stock), 0) as stock_total
         FROM eventos e
         LEFT JOIN entrada_categorias ec ON ec.evento_id = e.id AND ec.activa = true
         WHERE e.empresa_id = $1 AND e.activo = true
         GROUP BY e.id
         ORDER BY e.created_at DESC`,
        empresaId,
      ),
      prisma.$queryRawUnsafe<EmpresaSlugRow[]>(
        `SELECT slug FROM empresas WHERE id = $1`,
        empresaId,
      ),
      prisma.$queryRawUnsafe<VentasPorDiaRow[]>(
        `SELECT DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') as dia, COUNT(*) as ventas
         FROM entradas en
         JOIN eventos ev ON ev.id = en.evento_id AND ev.empresa_id = $1
         WHERE en.revendedor_id = $2
           AND en.created_at >= NOW() - INTERVAL '30 days'
           AND en.estado <> 'cancelada'
         GROUP BY DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')
         ORDER BY dia ASC`,
        empresaId, revendedorId,
      ),
    ])

    const totalVendidas = ventas.filter((v) => v.estado !== 'cancelada').length
    const totalGenerado = ventas
      .filter((v) => v.estado !== 'cancelada')
      .reduce((acc, v) => acc + Number(v.precio_pagado), 0)
    const comision = Number(revendedorRows[0].porcentaje_comision ?? 0)
    // Ganancia = comisión CONGELADA por entrada al momento de la venta (no recalcular con el % actual)
    const ganancia = ventas
      .filter((v) => v.estado !== 'cancelada')
      .reduce((acc, v) => acc + Number(v.comision_revendedor ?? 0), 0)

    return res.json({
      data: {
        revendedor: revendedorRows[0],
        ventas,
        eventos,
        stats: { totalVendidas, totalGenerado, comision, ganancia },
        empresaSlug: empresaRows[0]?.slug ?? '',
        ventas_por_dia: ventasPorDia.map((r) => ({ dia: r.dia, ventas: Number(r.ventas ?? 0n) })),
      },
    })
  } catch {
    logServerError('revendedores me')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.get('/', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_revendedores'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    const page = Math.max(1, Number(req.query.page) || 1)
    const requestedPageSize = Number(req.query.pageSize) || DEFAULT_PAGE_SIZE
    const pageSize = Math.min(HARD_LIMIT, Math.max(1, requestedPageSize))
    const busqueda = typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : ''
    const evento = typeof req.query.evento === 'string' ? req.query.evento.trim() : ''
    const desde = typeof req.query.desde === 'string' ? req.query.desde.trim() : ''
    const hasta = typeof req.query.hasta === 'string' ? req.query.hasta.trim() : ''
    const mostrarInactivos = req.query.mostrarInactivos === '1'
    const estado = typeof req.query.estado === 'string' ? req.query.estado.trim() : ''
    const soloInactivos = estado === 'inactivos'
    const incluirInactivos = estado === 'todos' || mostrarInactivos
    const orden = req.query.orden === 'antiguedad' ? 'antiguedad' : 'ganancias'
    const sortByRaw = typeof req.query.sortBy === 'string' ? req.query.sortBy.trim() : ''
    const fallbackSortBy = orden === 'antiguedad' ? 'alta' : 'total_generado'
    const sortBy = sortByRaw || fallbackSortBy
    const sortDir = req.query.sortDir === 'asc' ? 'asc' : orden === 'antiguedad' ? 'asc' : 'desc'

    // Postgres $n filter builder for revendedores list
    const pgParams: unknown[] = [empresaId]
    const pgConds: string[] = [`u.empresa_id = $1`, `u.rol = 'revendedor'`]

    if (soloInactivos) {
      pgConds.push('u.activo = false')
    } else if (!mostrarInactivos) {
      pgConds.push('u.activo = true')
    }

    if (busqueda) {
      pgParams.push(`%${busqueda}%`)
      const p = pgParams.length
      pgConds.push(`(u.nombre ILIKE $${p} OR u.apellido ILIKE $${p} OR u.email ILIKE $${p})`)
    }

    if (evento) {
      pgParams.push(evento)
      pgConds.push(`EXISTS (
        SELECT 1
        FROM entradas en_filtro
        WHERE en_filtro.revendedor_id = u.id AND en_filtro.evento_id = $${pgParams.length} AND en_filtro.estado <> 'cancelada'
      )`)
    }

    if (desde) {
      pgParams.push(desde)
      pgConds.push(`DATE(u.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') >= $${pgParams.length}::date`)
    }

    if (hasta) {
      pgParams.push(hasta)
      pgConds.push(`DATE(u.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') <= $${pgParams.length}::date`)
    }

    const pgWhereClause = pgConds.join(' AND ')
    const sortMap: Record<string, string> = {
      revendedor: `u.nombre ${sortDir}, u.apellido ${sortDir}`,
      total_ventas: `total_ventas ${sortDir}`,
      total_generado: `total_generado ${sortDir}`,
      total_comision: `total_comision ${sortDir}`,
      estado: `u.activo ${sortDir}`,
      alta: `u.created_at ${sortDir}`,
    }
    const orderClause = sortMap[sortBy] ?? `total_generado DESC, u.created_at DESC`

    // Site R3 — COUNT
    type CountRow = { total: bigint }
    const [countRow] = await prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*) as total FROM usuarios u WHERE ${pgWhereClause}`,
      ...pgParams,
    )

    const total = Number(countRow?.total ?? 0n)
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const currentPage = Math.min(page, totalPages)
    const offset = (currentPage - 1) * pageSize

    // Site R4 — revendedores list
    type RevendedorListRow = { id: string; nombre: string; apellido: string | null; email: string; activo: boolean; porcentaje_comision: string | null; created_at: Date; total_ventas: bigint; total_generado: string; total_comision: string }
    const limitIdx = pgParams.length + 1
    const offsetIdx = pgParams.length + 2
    const revendedores = await prisma.$queryRawUnsafe<RevendedorListRow[]>(
      `SELECT
        u.id, u.nombre, u.apellido, u.email, u.activo, u.porcentaje_comision, u.created_at,
        COUNT(en.id) as total_ventas,
        COALESCE(SUM(en.precio_pagado), 0) as total_generado,
        COALESCE(SUM(en.comision_revendedor), 0) as total_comision
       FROM usuarios u
       LEFT JOIN entradas en ON en.revendedor_id = u.id AND en.estado <> 'cancelada'
       WHERE ${pgWhereClause}
       GROUP BY u.id
       ORDER BY ${orderClause}
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      ...pgParams, pageSize, offset,
    )

    // Sites R5a-R5c — stats, empresa default, eventos
    type StatsRow = { total_revendedores: bigint; total_activos: string; total_inactivos: string; total_generado: string; total_comision: string }
    type EmpresaComisionRow = { comision_revendedor_default: string | null }
    type EventoDropdownRow = { id: string; nombre: string; total_ventas: bigint }
    const [statsRows, empresaRows, eventos] = await Promise.all([
      // Site R5a — aggregated stats
      prisma.$queryRawUnsafe<StatsRow[]>(
        `SELECT
           COUNT(*) as total_revendedores,
           COALESCE(SUM(CASE WHEN base.activo = true THEN 1 ELSE 0 END), 0) as total_activos,
           COALESCE(SUM(CASE WHEN base.activo = false THEN 1 ELSE 0 END), 0) as total_inactivos,
           COALESCE(SUM(base.total_generado), 0) as total_generado,
           COALESCE(SUM(base.total_comision), 0) as total_comision
         FROM (
           SELECT
             u.id,
             u.activo,
             COALESCE(SUM(en.precio_pagado), 0) as total_generado,
             COALESCE(SUM(en.comision_revendedor), 0) as total_comision
           FROM usuarios u
           LEFT JOIN entradas en ON en.revendedor_id = u.id AND en.estado <> 'cancelada'
           WHERE ${pgWhereClause}
           GROUP BY u.id, u.activo
         ) base`,
        ...pgParams,
      ),
      // Site R5b — empresa default commission
      prisma.$queryRawUnsafe<EmpresaComisionRow[]>(
        `SELECT comision_revendedor_default FROM empresas WHERE id = $1`,
        empresaId,
      ),
      // Site R5c — eventos dropdown
      prisma.$queryRawUnsafe<EventoDropdownRow[]>(
        `SELECT
           e.id,
           e.nombre,
           COALESCE(COUNT(en.id), 0) as total_ventas
         FROM eventos e
         LEFT JOIN entradas en ON en.evento_id = e.id AND en.estado <> 'cancelada'
         WHERE e.empresa_id = $1
         GROUP BY e.id, e.nombre
         ORDER BY total_ventas DESC, e.nombre ASC`,
        empresaId,
      ),
    ])

    return res.json({
      data: {
        revendedores,
        comision_default: empresaRows[0]?.comision_revendedor_default ?? 0,
        eventos,
        stats: {
          totalRevendedores: Number(statsRows[0]?.total_revendedores ?? 0n),
          totalActivos: Number(statsRows[0]?.total_activos ?? 0),
          totalInactivos: Number(statsRows[0]?.total_inactivos ?? 0),
          totalGenerado: Number(statsRows[0]?.total_generado ?? 0),
          totalComision: Number(statsRows[0]?.total_comision ?? 0),
        },
      },
      pagination: {
        page: currentPage,
        pageSize,
        total,
        totalPages,
      },
    })
  } catch (error) {
    logServerError('revendedores list', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.get('/export', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_revendedores'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const busqueda = typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : ''
    const mostrarInactivos = req.query.mostrarInactivos === '1'
    const estado = typeof req.query.estado === 'string' ? req.query.estado.trim() : ''
    const soloInactivos = estado === 'inactivos'
    const incluirInactivos = estado === 'todos' || mostrarInactivos
    const sortByRaw = typeof req.query.sortBy === 'string' ? req.query.sortBy.trim() : ''
    const sortBy = sortByRaw || 'total_generado'
    const sortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc'
    const exportLimit = resolveRevendedoresExportLimit()
    const exportFormat = resolveRevendedoresExportFormat(req)

    // Filtros de período / evento — semantica: período de VENTAS (en.created_at), no de alta del revendedor
    const desde = typeof req.query.desde === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.desde) ? req.query.desde : ''
    const hasta = typeof req.query.hasta === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.hasta) ? req.query.hasta : ''
    const evento = typeof req.query.evento === 'string' ? req.query.evento.trim() : ''

    // Build Postgres $n param arrays for Sites 7+8
    // Strategy: build WHERE params first (for COUNT standalone), then JOIN params, combining for full query

    // WHERE params (standalone, used in COUNT)
    const whereParams: unknown[] = []
    const whereFrags: string[] = []
    whereParams.push(empresaId)
    whereFrags.push(`u.empresa_id = $${whereParams.length}`)
    whereFrags.push(`u.rol = 'revendedor'`)
    if (soloInactivos) whereFrags.push('u.activo = false')
    else if (!incluirInactivos) whereFrags.push('u.activo = true')
    if (busqueda) {
      whereParams.push(`%${busqueda}%`)
      const wp = whereParams.length
      whereFrags.push(`(u.nombre ILIKE $${wp} OR u.apellido ILIKE $${wp} OR u.email ILIKE $${wp})`)
    }
    const pgWhereForCount = whereFrags.join(' AND ')

    // JOIN params for the full query — these come AFTER whereParams in the combined array
    // so their $n indices are offset by whereParams.length
    const joinParamsCombined: unknown[] = []
    const joinFrags: string[] = [`en.revendedor_id = u.id`, `en.estado <> 'cancelada'`]
    const wLen = whereParams.length
    if (desde) {
      joinParamsCombined.push(desde)
      joinFrags.push(`DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') >= $${wLen + joinParamsCombined.length}::date`)
    }
    if (hasta) {
      joinParamsCombined.push(hasta)
      joinFrags.push(`DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') <= $${wLen + joinParamsCombined.length}::date`)
    }
    if (evento) {
      joinParamsCombined.push(evento)
      joinFrags.push(`en.evento_id = $${wLen + joinParamsCombined.length}`)
    }
    const pgJoinClause = joinFrags.join(' AND ')

    // For the main query, param order: whereParams first, then joinParams, then limit
    // WHERE clauses use $1..$wLen, JOIN clauses use $wLen+1..$wLen+jLen, LIMIT uses last $n
    const combinedParams = [...whereParams, ...joinParamsCombined, exportLimit]
    const limitParamIdx = combinedParams.length

    // Site 7 — COUNT for export limit check (only WHERE params)
    type ExportCountRow = { total: bigint }
    const [exportCountRow] = await prisma.$queryRawUnsafe<ExportCountRow[]>(
      `SELECT COUNT(*) AS total FROM usuarios u WHERE ${pgWhereForCount}`,
      ...whereParams,
    )
    const total = Number(exportCountRow?.total ?? 0n)
    if (total > exportLimit) {
      return res.status(413).json({
        error: `Refiná los filtros para exportar hasta ${exportLimit} revendedores por archivo.`,
        code: 'export_limit_exceeded',
        limit: exportLimit,
        total,
      })
    }

    // Validate sort column and direction to prevent SQL injection
    const pgSortMap: Record<string, string> = {
      revendedor: `u.nombre ${sortDir === 'asc' ? 'ASC' : 'DESC'}, u.apellido ${sortDir === 'asc' ? 'ASC' : 'DESC'}`,
      total_ventas: `total_ventas ${sortDir === 'asc' ? 'ASC' : 'DESC'}`,
      total_generado: `total_generado ${sortDir === 'asc' ? 'ASC' : 'DESC'}`,
      total_comision: `total_comision ${sortDir === 'asc' ? 'ASC' : 'DESC'}`,
      estado: `u.activo ${sortDir === 'asc' ? 'ASC' : 'DESC'}`,
      alta: `u.created_at ${sortDir === 'asc' ? 'ASC' : 'DESC'}`,
    }
    const pgOrderClause = pgSortMap[sortBy] ?? `total_generado DESC, u.created_at DESC`

    // Site 8 — main export query
    type RevendedorExportRow = {
      id: string
      nombre: string
      apellido: string | null
      email: string
      activo: boolean
      porcentaje_comision: string | null
      created_at: Date
      total_ventas: bigint
      total_generado: string
      total_comision: string
    }
    const revendedores = await prisma.$queryRawUnsafe<RevendedorExportRow[]>(
      `SELECT
        u.id, u.nombre, u.apellido, u.email, u.activo, u.porcentaje_comision, u.created_at,
        COUNT(en.id) AS total_ventas,
        COALESCE(SUM(en.precio_pagado), 0) AS total_generado,
        COALESCE(SUM(en.comision_revendedor), 0) AS total_comision
       FROM usuarios u
       LEFT JOIN entradas en ON ${pgJoinClause}
       WHERE ${pgWhereForCount}
       GROUP BY u.id
       ORDER BY ${pgOrderClause}
       LIMIT $${limitParamIdx}`,
      ...combinedParams,
    )

    const columns = resolveRevendedoresExportColumns()
    const rows = serializeRevendedoresExportRows(revendedores as Record<string, unknown>[])

    if (exportFormat === 'xlsx') {
      const workbook = await buildRevendedoresWorkbookBuffer(rows, columns)
      res.setHeader('Content-Type', REVENDEDORES_EXPORT_CONTENT_TYPE)
      res.setHeader('Content-Disposition', `attachment; filename="${buildRevendedoresExportFilename()}"`)
      return res.status(200).send(workbook)
    }

    const csv = toCsv(rows, columns)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${buildRevendedoresCsvExportFilename()}"`)
    return res.status(200).send(csv)
  } catch {
    logServerError('revendedores export')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

function formatMoneyForCsv(value: unknown): string {
  const num = Number(value ?? 0)
  if (!Number.isFinite(num)) return '0.00'
  return num.toFixed(2)
}

function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

router.get('/payouts/export', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_revendedores'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const desde = isValidDateString(req.query.desde) ? req.query.desde : null
    const hasta = isValidDateString(req.query.hasta) ? req.query.hasta : null
    const evento = typeof req.query.evento === 'string' ? req.query.evento.trim() : ''
    const busqueda = typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : ''
    const estado = typeof req.query.estado === 'string' ? req.query.estado.trim() : ''
    const incluirInactivos = estado === 'todos' || estado === 'inactivos'
    const soloInactivos = estado === 'inactivos'

    // Default range: mes actual si no se pasa nada
    const today = new Date()
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().slice(0, 10)
    const effectiveDesde = desde ?? firstOfMonth
    const effectiveHasta = hasta ?? today.toISOString().slice(0, 10)

    // Build Postgres $n params — WHERE (user filters) first, then JOIN params for the date range
    const pgWhereParams: unknown[] = [empresaId]
    const pgWhereConds: string[] = [`u.empresa_id = $1`, `u.rol = 'revendedor'`]

    if (soloInactivos) pgWhereConds.push('u.activo = false')
    else if (!incluirInactivos) pgWhereConds.push('u.activo = true')

    if (busqueda) {
      pgWhereParams.push(`%${busqueda}%`)
      const p = pgWhereParams.length
      pgWhereConds.push(`(u.nombre ILIKE $${p} OR u.apellido ILIKE $${p} OR u.email ILIKE $${p})`)
    }
    const pgWhereClausePayouts = pgWhereConds.join(' AND ')
    const wLen = pgWhereParams.length

    // JOIN date/event params (offset by wLen)
    const pgJoinParams: unknown[] = [effectiveDesde, effectiveHasta]
    const pgJoinConds: string[] = [
      `en.estado <> 'cancelada'`,
      `DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') >= $${wLen + 1}::date`,
      `DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') <= $${wLen + 2}::date`,
    ]
    const pgCancelConds: string[] = [
      `en_cancel.estado = 'cancelada'`,
      `DATE(en_cancel.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') >= $${wLen + 1}::date`,
      `DATE(en_cancel.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') <= $${wLen + 2}::date`,
    ]

    if (evento) {
      pgJoinParams.push(evento)
      const eIdx = wLen + pgJoinParams.length
      pgJoinConds.push(`en.evento_id = $${eIdx}`)
      pgCancelConds.push(`en_cancel.evento_id = $${eIdx}`)
    }

    const pgJoinClause = pgJoinConds.join(' AND ')
    const pgCancelClause = pgCancelConds.join(' AND ')

    const EXPORT_LIMIT = 5000
    const allParams = [...pgWhereParams, ...pgJoinParams, EXPORT_LIMIT]
    const limitIdx = allParams.length

    // Site R6 — payouts export main query
    type PayoutExportRow = {
      id: string
      nombre: string
      apellido: string | null
      email: string
      activo: boolean
      porcentaje_comision: string | null
      total_ventas: bigint
      total_generado: string
      comision_a_pagar: string
      cancelaciones: bigint
      bruto_cancelado: string
    }
    const rows = await prisma.$queryRawUnsafe<PayoutExportRow[]>(
      `SELECT
         u.id,
         u.nombre,
         u.apellido,
         u.email,
         u.activo,
         u.porcentaje_comision,
         COUNT(en.id) AS total_ventas,
         COALESCE(SUM(en.precio_pagado), 0) AS total_generado,
         COALESCE(SUM(en.comision_revendedor), 0) AS comision_a_pagar,
         COALESCE(cancel_stats.cancelaciones, 0) AS cancelaciones,
         COALESCE(cancel_stats.bruto_cancelado, 0) AS bruto_cancelado
       FROM usuarios u
       LEFT JOIN entradas en
         ON en.revendedor_id = u.id
         AND ${pgJoinClause}
       LEFT JOIN (
         SELECT en_cancel.revendedor_id,
                COUNT(*) AS cancelaciones,
                COALESCE(SUM(en_cancel.precio_pagado), 0) AS bruto_cancelado
         FROM entradas en_cancel
         WHERE ${pgCancelClause}
         GROUP BY en_cancel.revendedor_id
       ) cancel_stats ON cancel_stats.revendedor_id = u.id
       WHERE ${pgWhereClausePayouts}
       GROUP BY u.id, cancel_stats.cancelaciones, cancel_stats.bruto_cancelado
       HAVING COUNT(en.id) > 0 OR COALESCE(cancel_stats.cancelaciones, 0) > 0
       ORDER BY comision_a_pagar DESC, total_generado DESC
       LIMIT $${limitIdx}`,
      ...allParams,
    )

    const headers = [
      'revendedor_id',
      'nombre',
      'apellido',
      'email',
      'estado',
      'porcentaje_comision',
      'ventas_confirmadas',
      'monto_generado',
      'comision_a_pagar',
      'cancelaciones',
      'bruto_cancelado',
    ]

    const lines: string[] = [headers.join(',')]

    let acumGenerado = 0
    let acumComision = 0
    let acumVentas = 0
    let acumCancelaciones = 0

    for (const row of rows) {
      const totalGenerado = Number(row.total_generado ?? 0)
      const comisionAPagar = Number(row.comision_a_pagar ?? 0)
      const ventas = Number(row.total_ventas ?? 0n)
      const cancelaciones = Number(row.cancelaciones ?? 0n)
      acumGenerado += totalGenerado
      acumComision += comisionAPagar
      acumVentas += ventas
      acumCancelaciones += cancelaciones

      lines.push([
        safeCsvCell(row.id),
        safeCsvCell(row.nombre ?? ''),
        safeCsvCell(row.apellido ?? ''),
        safeCsvCell(row.email ?? ''),
        safeCsvCell(row.activo ? 'activo' : 'inactivo'),
        safeCsvCell(formatMoneyForCsv(row.porcentaje_comision)),
        safeCsvCell(ventas),
        safeCsvCell(formatMoneyForCsv(totalGenerado)),
        safeCsvCell(formatMoneyForCsv(comisionAPagar)),
        safeCsvCell(cancelaciones),
        safeCsvCell(formatMoneyForCsv(row.bruto_cancelado)),
      ].join(','))
    }

    if (rows.length > 0) {
      lines.push([
        safeCsvCell('TOTAL'),
        '',
        '',
        '',
        '',
        '',
        safeCsvCell(acumVentas),
        safeCsvCell(formatMoneyForCsv(acumGenerado)),
        safeCsvCell(formatMoneyForCsv(acumComision)),
        safeCsvCell(acumCancelaciones),
        '',
      ].join(','))
    }

    const csv = '﻿' + lines.join('\r\n')
    const filename = `payouts-revendedores-${effectiveDesde}_${effectiveHasta}.csv`

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.send(csv)
  } catch {
    logServerError('revendedores payouts export')
    return res.status(500).json({ error: 'No se pudo exportar los payouts' })
  }
})

router.get('/:id', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_revendedores'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const { id } = req.params
    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    // Site R7 — revendedor detail with aggregates
    type RevendedorDetailRow = { id: string; nombre: string; apellido: string | null; email: string; activo: boolean; created_at: Date; porcentaje_comision: string | null; total_ventas: bigint; total_generado: string; total_comision: string }
    const revendedorRows = await prisma.$queryRawUnsafe<RevendedorDetailRow[]>(
      `SELECT u.id, u.nombre, u.apellido, u.email, u.activo, u.created_at,
        u.porcentaje_comision,
        COUNT(en.id) as total_ventas,
        COALESCE(SUM(en.precio_pagado), 0) as total_generado,
        COALESCE(SUM(en.comision_revendedor), 0) as total_comision
       FROM usuarios u
       LEFT JOIN entradas en ON en.revendedor_id = u.id AND en.estado <> 'cancelada'
       WHERE u.id = $1 AND u.empresa_id = $2 AND u.rol = 'revendedor'
       GROUP BY u.id, u.nombre, u.apellido, u.email, u.activo, u.created_at, u.porcentaje_comision`,
      id, empresaId,
    )

    if (!revendedorRows[0]) {
      return res.status(404).json({ error: 'Revendedor no encontrado' })
    }

    // Sites R8a-R8c — ventas por evento, por dia, últimas ventas
    type VentasPorEventoRow = { id: string; nombre: string; imagen_url: string | null; total_ventas: bigint; total_generado: string }
    type VentasPorDiaDetailRow = { dia: string; ventas: bigint }
    type UltimaVentaRow = { id: string; precio_pagado: string; estado: string; created_at: Date; evento_id: string; evento_nombre: string; categoria_nombre: string | null; comprador_nombre: string | null }
    const [ventasPorEvento, ventasPorDia, ultimasVentas] = await Promise.all([
      // Site R8a — grouped by event
      prisma.$queryRawUnsafe<VentasPorEventoRow[]>(
        `SELECT
          ev.id, ev.nombre, ev.imagen_url,
          COUNT(en.id) as total_ventas,
          COALESCE(SUM(en.precio_pagado), 0) as total_generado
         FROM entradas en
         JOIN eventos ev ON ev.id = en.evento_id AND ev.empresa_id = $1
         WHERE en.revendedor_id = $2 AND en.estado <> 'cancelada'
         GROUP BY ev.id, ev.nombre, ev.imagen_url
         ORDER BY total_ventas DESC`,
        empresaId, id,
      ),
      // Site R8b — daily sales last 30 days
      prisma.$queryRawUnsafe<VentasPorDiaDetailRow[]>(
        `SELECT DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') as dia, COUNT(*) as ventas
         FROM entradas en
         JOIN eventos ev ON ev.id = en.evento_id AND ev.empresa_id = $1
         WHERE en.revendedor_id = $2
         AND en.created_at >= NOW() - INTERVAL '30 days'
         AND en.estado <> 'cancelada'
         GROUP BY DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires')
         ORDER BY dia ASC`,
        empresaId, id,
      ),
      // Site R8c — recent sales list
      prisma.$queryRawUnsafe<UltimaVentaRow[]>(
        `SELECT en.id, en.precio_pagado, en.estado, en.created_at,
          ev.id as evento_id, ev.nombre as evento_nombre,
          ec.nombre as categoria_nombre,
          c.nombre as comprador_nombre
         FROM entradas en
         JOIN eventos ev ON ev.id = en.evento_id AND ev.empresa_id = $1
         LEFT JOIN entrada_categorias ec ON ec.id = en.categoria_id
         LEFT JOIN compradores c ON c.id = en.comprador_id
         WHERE en.revendedor_id = $2
         ORDER BY en.created_at DESC
         LIMIT $3`,
        empresaId, id, HARD_LIMIT,
      ),
    ])

    return res.json({
      data: {
        revendedor: revendedorRows[0],
        ventas_por_evento: ventasPorEvento,
        ventas_por_dia: ventasPorDia,
        ultimas_ventas: ultimasVentas,
      },
    })
  } catch {
    logServerError('revendedores detail')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// ============================================================
// Tickets físicos pre-impresos — endpoints para el panel del revendedor
// ============================================================

// GET /api/revendedores/me/tickets-fisicos?evento_id=...
// Lista los tickets físicos asignados al revendedor autenticado.
router.get('/me/tickets-fisicos', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (user.userType !== 'empleado' || !user.empresa_id) {
      return res.status(403).json({ error: 'Solo revendedores' })
    }
    // Verify rol = 'revendedor' via DB (rol no está en SessionUser).
    const me = await prisma.$queryRaw<Array<{ rol: string | null }>>`
      SELECT rol FROM usuarios WHERE id = ${user.id} AND empresa_id = ${user.empresa_id} LIMIT 1`
    if (!me[0] || me[0].rol !== 'revendedor') {
      return res.status(403).json({ error: 'Solo revendedores' })
    }

    const eventoId = typeof req.query.evento_id === 'string' ? req.query.evento_id : null
    const tickets = await listTicketsAsignadosARevendedor(user.id, user.empresa_id, eventoId)

    // Get evento + categoria + lote info for display (one extra query)
    const eventoIds = Array.from(new Set(tickets.map((t) => t.evento_id)))
    const categoriaIds = Array.from(new Set(tickets.map((t) => t.categoria_id)))
    const loteIds = Array.from(new Set(tickets.map((t) => t.lote_id)))

    const [eventos, categorias, lotes] = await Promise.all([
      prisma.evento.findMany({ where: { id: { in: eventoIds } }, select: { id: true, nombre: true } }),
      prisma.entradaCategoria.findMany({ where: { id: { in: categoriaIds } }, select: { id: true, nombre: true } }),
      prisma.ticketFisicoLote.findMany({ where: { id: { in: loteIds } }, select: { id: true, precio_impreso: true } }),
    ])

    const eventoMap = new Map(eventos.map((e) => [e.id, e.nombre]))
    const categoriaMap = new Map(categorias.map((c) => [c.id, c.nombre]))
    const loteMap = new Map(lotes.map((l) => [l.id, l.precio_impreso !== null ? Number(l.precio_impreso) : null]))

    return res.json({
      data: {
        tickets: tickets.map((t) => ({
          id: t.id,
          lote_id: t.lote_id,
          evento_id: t.evento_id,
          evento_nombre: eventoMap.get(t.evento_id) ?? 'Evento',
          categoria_id: t.categoria_id,
          categoria_nombre: categoriaMap.get(t.categoria_id) ?? 'Categoría',
          numero_secuencia: t.numero_secuencia,
          clave_corta: t.clave_corta,
          estado: t.estado,
          precio_sugerido: loteMap.get(t.lote_id) ?? null,
          precio_vendido: t.precio_vendido !== null ? Number(t.precio_vendido) : null,
          comprador_nombre: t.comprador_nombre,
          comprador_dni: t.comprador_dni,
          vendido_at: t.vendido_at?.toISOString() ?? null,
          asignado_at: t.asignado_at?.toISOString() ?? null,
        })),
      },
    })
  } catch (err) {
    logServerError('revendedores tickets-fisicos list', err)
    return res.status(500).json({ error: 'Error listando tickets' })
  }
})

// POST /api/revendedores/me/tickets-fisicos/:ticketId/vender
// Marca un ticket asignado al revendedor como vendido + registra datos del comprador.
router.post('/me/tickets-fisicos/:ticketId/vender', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (user.userType !== 'empleado' || !user.empresa_id) {
      return res.status(403).json({ error: 'Solo revendedores' })
    }
    // Verify rol = 'revendedor' via DB (rol no está en SessionUser).
    const me = await prisma.$queryRaw<Array<{ rol: string | null }>>`
      SELECT rol FROM usuarios WHERE id = ${user.id} AND empresa_id = ${user.empresa_id} LIMIT 1`
    if (!me[0] || me[0].rol !== 'revendedor') {
      return res.status(403).json({ error: 'Solo revendedores' })
    }

    const body = (req.body ?? {}) as Record<string, unknown>
    const compradorNombre = typeof body.comprador_nombre === 'string' ? body.comprador_nombre : ''
    const compradorDni = typeof body.comprador_dni === 'string' && body.comprador_dni.trim() ? body.comprador_dni.trim() : null
    const precioVendido =
      body.precio_vendido === null || body.precio_vendido === undefined ? null : Number(body.precio_vendido)

    if (!compradorNombre.trim()) {
      return res.status(400).json({ error: 'comprador_nombre es obligatorio' })
    }

    const ticket = await venderTicketFisico({
      ticketId: req.params.ticketId,
      revendedorId: user.id,
      empresaId: user.empresa_id,
      compradorNombre,
      compradorDni,
      precioVendido,
    })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'preimpresos.ticket.vendido_revendedor',
      entityType: 'ticket_fisico',
      entityId: req.params.ticketId,
      entityLabel: `#${ticket?.numero_secuencia ?? '?'} → ${compradorNombre.slice(0, 60)}`,
      payload: { comprador_dni: compradorDni, precio_vendido: precioVendido, lote_id: ticket?.lote_id ?? null },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.json({ data: { ticket } })
  } catch (err) {
    logServerError('revendedores tickets-fisicos vender', err)
    return res.status(400).json({ error: safeMsg(err, 'Error vendiendo ticket') })
  }
})

export default router
