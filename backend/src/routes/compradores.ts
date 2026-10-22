import { Router, Request, Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { verifyInternal, requireAuth, getRequestIp } from '../middleware/auth'
import { randomUUID as uuidv4, createHash } from 'node:crypto'
import bcrypt from 'bcryptjs'
import rateLimit from 'express-rate-limit'
import type { Permisos } from '../lib/permisos'
import { getActorEmpresaId, requirePermission, requirePermissionMiddleware } from '../lib/authz'
import { logServerError, logServerWarn } from '../lib/safe-log'
import { touchPasswordVersion } from '../lib/password-version'
import { actorFromRequest, logAuditEvent } from '../lib/audit-log'
import { buildPasswordPolicyError, validatePasswordPolicy } from '../lib/password-policy'
import { buildCompradoresCsvExportFilename, buildCompradoresExportFilename, buildCompradoresWorkbookBuffer, COMPRADORES_EXPORT_CONTENT_TYPE } from '../lib/compradores-export-workbook'
import { safeCsvCell } from '../lib/csv-escape'

const loginTokenRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => getRequestIp(req) || req.ip || 'unknown',
  handler: (req: Request, res: Response, _next: NextFunction, options) => {
    void req
    logServerWarn('[Compradores] login_token_rate_limited')
    return res.status(options.statusCode).json({ error: 'Demasiadas solicitudes, intentá en unos minutos' })
  },
})

const router = Router()
const HARD_LIMIT = 500
const DEFAULT_PAGE_SIZE = 25
const DEFAULT_EXPORT_LIMIT = 2000

type CompradoresQuery = {
  page: number
  pageSize: number
  busqueda: string
  evento: string
  desde: string
  hasta: string
  sortBy: string
  sortDir: 'asc' | 'desc'
}

type CompradoresActorView = {
  puedeVerMontos: boolean
}

function resolveCompradoresActorView(user: NonNullable<Request['user']>): CompradoresActorView {
  const esEmpleado = user.userType === 'empleado'
  const permisos = user.permisos as Permisos | undefined
  return {
    puedeVerMontos: !esEmpleado || !permisos || permisos.ver_montos_compradores,
  }
}

function readCompradoresQuery(req: Request): CompradoresQuery {
  const page = Math.max(1, Number(req.query.page) || 1)
  const requestedPageSize = Number(req.query.pageSize) || DEFAULT_PAGE_SIZE

  return {
    page,
    pageSize: Math.min(HARD_LIMIT, Math.max(1, requestedPageSize)),
    busqueda: typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : '',
    evento: typeof req.query.evento === 'string' ? req.query.evento.trim() : '',
    desde: typeof req.query.desde === 'string' ? req.query.desde.trim() : '',
    hasta: typeof req.query.hasta === 'string' ? req.query.hasta.trim() : '',
    sortBy: typeof req.query.sortBy === 'string' ? req.query.sortBy.trim() : 'alta',
    sortDir: req.query.sortDir === 'asc' ? 'asc' : 'desc',
  }
}

function buildCompradoresOrderClause(sortBy: string, sortDir: 'asc' | 'desc') {
  const sortMap: Record<string, string> = {
    comprador: `c.nombre ${sortDir}`,
    dni: `c.dni ${sortDir}`,
    total_entradas: `total_entradas ${sortDir}`,
    total_gastado: `total_gastado ${sortDir}`,
    ultima_compra: `ultima_compra ${sortDir}`,
    alta: `c.created_at ${sortDir}`,
  }
  return sortMap[sortBy] ?? `c.created_at ${sortDir}`
}

// Sort fields that reveal a money ranking even when the values themselves are redacted
// (e.g. binary-searching pageSize=1 against a known ordering). Must be gated the same
// way as the money fields themselves via `resolveCompradoresActorView(user).puedeVerMontos`.
const COMPRADORES_MONEY_SORT_FIELDS = new Set(['total_gastado'])

function resolveCompradoresSortBy(sortBy: string, view: CompradoresActorView): string {
  if (COMPRADORES_MONEY_SORT_FIELDS.has(sortBy) && !view.puedeVerMontos) return 'alta'
  return sortBy
}

// Postgres-compatible filter builder for list endpoint (uses $n placeholders)
function buildCompradoresPgFilters(empresaId: string, query: CompradoresQuery) {
  const params: unknown[] = [empresaId]
  const conds: string[] = ['c.empresa_id = $1']

  if (query.busqueda) {
    params.push(`%${query.busqueda}%`)
    const p = params.length
    conds.push(`( c.nombre ILIKE $${p} OR c.email ILIKE $${p} OR c.dni ILIKE $${p} )`)
  }

  if (query.evento) {
    params.push(query.evento)
    conds.push(`EXISTS (
      SELECT 1
      FROM entradas en_filtro
      WHERE en_filtro.comprador_id = c.id AND en_filtro.evento_id = $${params.length}
    )`)
  }

  if (query.desde) {
    params.push(query.desde)
    conds.push(`DATE(c.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') >= $${params.length}::date`)
  }

  if (query.hasta) {
    params.push(query.hasta)
    conds.push(`DATE(c.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') <= $${params.length}::date`)
  }

  return { whereClause: conds.join(' AND '), params }
}

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

function toCsv(rows: Array<Record<string, unknown>>, columns: string[]) {
  const header = columns.map(safeCsvCell).join(',')
  const body = rows.map((row) => columns.map((column) => safeCsvCell(row[column])).join(',')).join('\n')
  return body ? `${header}\n${body}\n` : `${header}\n`
}

const COMPRADOR_MONTO_FIELDS = ['total_gastado_entradas', 'total_gastado_consumibles', 'total_gastado', 'neto_empresa_total'] as const

function stripCompradorMontos<T extends Record<string, unknown>>(row: T): T {
  const clone: Record<string, unknown> = { ...row }
  for (const field of COMPRADOR_MONTO_FIELDS) delete clone[field]
  return clone as T
}

function resolveCompradoresExportColumns(view: CompradoresActorView) {
  const columns = ['fecha_registro', 'comprador', 'email', 'dni']
  if (view.puedeVerMontos) columns.push('total_gastado_entradas', 'total_gastado_consumibles', 'neto_empresa_total')
  return columns
}

function serializeCompradoresExportRows(rows: Record<string, unknown>[], view: CompradoresActorView) {
  return rows.map((comprador) => ({
    fecha_registro: formatCsvDateTime(String(comprador.created_at ?? '')),
    comprador: `${String(comprador.nombre ?? '')}${comprador.apellido ? ` ${String(comprador.apellido)}` : ''}`.trim(),
    email: String(comprador.email ?? ''),
    dni: String(comprador.dni ?? ''),
    ...(view.puedeVerMontos ? {
      total_gastado_entradas: Number(comprador.total_gastado_entradas ?? 0),
      total_gastado_consumibles: Number(comprador.total_gastado_consumibles ?? 0),
      neto_empresa_total: Number(comprador.neto_empresa_total ?? 0),
    } : {}),
  }))
}

function resolveCompradoresExportLimit() {
  const raw = Number(process.env.COMPRADORES_EXPORT_MAX_ROWS)
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_EXPORT_LIMIT
  return Math.floor(raw)
}

function resolveCompradoresExportFormat(req: Request) {
  return req.query.format === 'xlsx' ? 'xlsx' : 'csv'
}

// GET /compradores
router.get('/', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const empresaId = esEmpleado ? user.empresa_id! : user.id
    const permisos = user.permisos

    if (esEmpleado && (!permisos || !permisos.ver_compradores)) {
      return res.status(403).json({ error: 'Sin permisos' })
    }

    const view = resolveCompradoresActorView(user)
    const query = readCompradoresQuery(req)
    const { page, pageSize } = query
    const orderClause = buildCompradoresOrderClause(resolveCompradoresSortBy(query.sortBy, view), query.sortDir)
    const { whereClause: pgWhereClause, params } = buildCompradoresPgFilters(empresaId, query)

    // Site 1 — COUNT
    type CountRow = { total: bigint }
    const [countRow] = await prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT COUNT(*) as total FROM compradores c WHERE ${pgWhereClause}`,
      ...params,
    )

    const total = Number(countRow?.total ?? 0n)
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const currentPage = Math.min(page, totalPages)
    const offset = (currentPage - 1) * pageSize

    // Site 2 — totals aggregates
    type TotalsRow = {
      total_compradores: bigint
      total_entradas: string
      total_gastado: string
      total_con_email: bigint
    }
    const [totalsRow] = await prisma.$queryRawUnsafe<TotalsRow[]>(
      `SELECT
         COUNT(*) as total_compradores,
         COALESCE(SUM(stats.total_entradas), 0) as total_entradas,
         COALESCE(SUM(stats.total_gastado), 0) as total_gastado,
         COALESCE(SUM(CASE WHEN stats.tiene_email THEN 1 ELSE 0 END), 0) as total_con_email
       FROM (
         SELECT
           c.id,
           COUNT(DISTINCT en.id) as total_entradas,
           COALESCE(SUM(en.precio_pagado), 0) + COALESCE(cv_stats.total_consumibles, 0) as total_gastado,
           CASE WHEN c.email IS NOT NULL AND TRIM(c.email) <> '' THEN true ELSE false END as tiene_email
         FROM compradores c
         LEFT JOIN entradas en ON en.comprador_id = c.id
         LEFT JOIN (
           SELECT comprador_id, SUM(total) as total_consumibles
           FROM consumibles_ventas
           WHERE estado <> 'cancelado'
           GROUP BY comprador_id
         ) cv_stats ON cv_stats.comprador_id = c.id
         WHERE ${pgWhereClause}
         GROUP BY c.id, cv_stats.total_consumibles
       ) stats`,
      ...params,
    )

    // Site 3 — compradores list (GROUP_CONCAT → STRING_AGG)
    type CompradoresListRow = {
      id: string
      nombre: string
      apellido: string | null
      email: string | null
      telefono: string | null
      activo: boolean
      created_at: Date
      email_marketing_opt_out: boolean
      dni: string | null
      total_entradas: bigint
      total_gastado_entradas: string
      total_gastado_consumibles: string
      total_gastado: string
      neto_empresa_total: string
      ultima_compra: Date | null
      eventos_ids: string | null
    }
    const limitParamIdx = params.length + 1
    const offsetParamIdx = params.length + 2
    const compradores = await prisma.$queryRawUnsafe<CompradoresListRow[]>(
      `SELECT c.id, c.nombre, c.apellido, c.email, c.telefono, c.activo, c.created_at,
        c.email_marketing_opt_out, c.dni,
        COUNT(DISTINCT en.id) as total_entradas,
        COALESCE(SUM(en.precio_pagado), 0) as total_gastado_entradas,
        COALESCE(cv_stats.total_consumibles, 0) as total_gastado_consumibles,
        COALESCE(SUM(en.precio_pagado), 0) + COALESCE(cv_stats.total_consumibles, 0) as total_gastado,
        COALESCE(SUM(CASE WHEN en.estado <> 'cancelada' THEN en.precio_pagado - COALESCE(en.comision, 0) ELSE 0 END), 0)
          + COALESCE(cv_stats.total_consumibles, 0) as neto_empresa_total,
        MAX(en.created_at) as ultima_compra,
        STRING_AGG(DISTINCT en.evento_id::text, ',') as eventos_ids
       FROM compradores c
       LEFT JOIN entradas en ON en.comprador_id = c.id
       LEFT JOIN (
         SELECT comprador_id, SUM(total) as total_consumibles
         FROM consumibles_ventas
         WHERE estado <> 'cancelado'
         GROUP BY comprador_id
       ) cv_stats ON cv_stats.comprador_id = c.id
       WHERE ${pgWhereClause}
       GROUP BY c.id, cv_stats.total_consumibles
       ORDER BY ${orderClause}
       LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`,
      ...params, pageSize, offset,
    )

    // Site 4 — eventos list for filter dropdown
    type EventoRow = { id: string; nombre: string }
    const eventos = await prisma.$queryRawUnsafe<EventoRow[]>(
      `SELECT id, nombre FROM eventos WHERE empresa_id = $1 ORDER BY nombre`,
      empresaId,
    )

    return res.json({
      data: {
        compradores: view.puedeVerMontos
          ? compradores
          : compradores.map((comprador) => stripCompradorMontos(comprador as unknown as Record<string, unknown>)),
        eventos,
        totals: {
          total_compradores: Number(totalsRow?.total_compradores ?? 0n),
          total_entradas: Number(totalsRow?.total_entradas ?? 0),
          ...(view.puedeVerMontos ? { total_gastado: Number(totalsRow?.total_gastado ?? 0) } : {}),
          total_con_email: Number(totalsRow?.total_con_email ?? 0n),
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
    logServerError('compradores list')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.get('/export', verifyInternal, requireAuth, requirePermissionMiddleware('exportar'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const empresaId = esEmpleado ? user.empresa_id! : user.id
    const permisos = user.permisos

    if (esEmpleado && (!permisos || !permisos.ver_compradores)) {
      return res.status(403).json({ error: 'Sin permisos' })
    }

    const view = resolveCompradoresActorView(user)
    const query = readCompradoresQuery(req)
    const exportLimit = resolveCompradoresExportLimit()
    const exportFormat = resolveCompradoresExportFormat(req)

    // Site 1 — COUNT for export limit check
    // Build filter conditions dynamically
    const exportParams: unknown[] = [empresaId]
    const exportConditions: string[] = ['c.empresa_id = $1']
    if (query.busqueda) {
      exportParams.push(`%${query.busqueda}%`)
      const p = exportParams.length
      exportConditions.push(`( c.nombre ILIKE $${p} OR c.email ILIKE $${p} OR c.dni ILIKE $${p} )`)
    }
    if (query.evento) {
      exportParams.push(query.evento)
      const p = exportParams.length
      exportConditions.push(`EXISTS ( SELECT 1 FROM entradas en_filtro WHERE en_filtro.comprador_id = c.id AND en_filtro.evento_id = $${p} )`)
    }
    if (query.desde) {
      exportParams.push(query.desde)
      exportConditions.push(`DATE(c.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') >= $${exportParams.length}::date`)
    }
    if (query.hasta) {
      exportParams.push(query.hasta)
      exportConditions.push(`DATE(c.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') <= $${exportParams.length}::date`)
    }
    const exportWhere = exportConditions.join(' AND ')

    type ExportCountRow = { total: bigint }
    const [exportCountRow] = await prisma.$queryRawUnsafe<ExportCountRow[]>(
      `SELECT COUNT(*) AS total FROM compradores c WHERE ${exportWhere}`,
      ...exportParams,
    )
    const total = Number(exportCountRow?.total ?? 0n)
    if (total > exportLimit) {
      return res.status(413).json({
        error: `Refiná los filtros para exportar hasta ${exportLimit} compradores por archivo.`,
        code: 'export_limit_exceeded',
        limit: exportLimit,
        total,
      })
    }

    // Site 2 — main export query (GROUP_CONCAT → STRING_AGG)
    type CompradoresExportRow = {
      id: string
      nombre: string
      apellido: string | null
      email: string
      telefono: string | null
      activo: boolean
      created_at: Date
      email_marketing_opt_out: boolean
      dni: string | null
      total_entradas: bigint
      total_gastado: string
      ultima_compra: Date | null
      eventos_ids: string | null
    }

    // Build ORDER BY for raw query (validated against known sort map)
    const exportOrderMap: Record<string, string> = {
      comprador: `c.nombre ${query.sortDir === 'asc' ? 'ASC' : 'DESC'}`,
      dni: `c.dni ${query.sortDir === 'asc' ? 'ASC' : 'DESC'}`,
      total_entradas: `total_entradas ${query.sortDir === 'asc' ? 'ASC' : 'DESC'}`,
      total_gastado: `total_gastado ${query.sortDir === 'asc' ? 'ASC' : 'DESC'}`,
      ultima_compra: `ultima_compra ${query.sortDir === 'asc' ? 'ASC' : 'DESC'}`,
      alta: `c.created_at ${query.sortDir === 'asc' ? 'ASC' : 'DESC'}`,
    }
    const exportOrderClause = exportOrderMap[resolveCompradoresSortBy(query.sortBy, view)] ?? `c.created_at DESC`

    const mainParams = [...exportParams, exportLimit]
    const limitParamIdx = mainParams.length
    const compradores = await prisma.$queryRawUnsafe<CompradoresExportRow[]>(
      `SELECT c.id, c.nombre, c.apellido, c.email, c.telefono, c.activo, c.created_at,
        c.email_marketing_opt_out, c.dni,
        COUNT(DISTINCT en.id) AS total_entradas,
        COALESCE(SUM(en.precio_pagado), 0) AS total_gastado,
        MAX(en.created_at) AS ultima_compra,
        STRING_AGG(DISTINCT en.evento_id::text, ',') AS eventos_ids
       FROM compradores c
       LEFT JOIN entradas en ON en.comprador_id = c.id
       WHERE ${exportWhere}
       GROUP BY c.id
       ORDER BY ${exportOrderClause}
       LIMIT $${limitParamIdx}`,
      ...mainParams,
    )

    const buyerIds = compradores.map((comprador) => String(comprador.id)).filter(Boolean)
    const netoByBuyer = new Map<string, number>()
    const totalEntradasByBuyer = new Map<string, number>()
    const consumiblesByBuyer = new Map<string, number>()
    if (buyerIds.length > 0) {
      // Site 3 — entradas breakdown by buyer
      type EntradaBreakdownRow = { comprador_id: string; total_gastado_entradas: string; neto_empresa_total: string }
      const entradasParams: unknown[] = [buyerIds]
      const entradasConditions = [`en.comprador_id = ANY($1::text[])`]
      if (query.evento) {
        entradasParams.push(query.evento)
        entradasConditions.push(`en.evento_id = $${entradasParams.length}`)
      }
      const entradasRows = await prisma.$queryRawUnsafe<EntradaBreakdownRow[]>(
        `SELECT en.comprador_id,
                COALESCE(SUM(en.precio_pagado), 0) AS total_gastado_entradas,
                COALESCE(SUM(CASE WHEN en.estado <> 'cancelada' THEN en.precio_pagado - COALESCE(en.comision, 0) ELSE 0 END), 0) AS neto_empresa_total
         FROM entradas en
         WHERE ${entradasConditions.join(' AND ')}
         GROUP BY en.comprador_id`,
        ...entradasParams,
      )

      for (const row of entradasRows) {
        totalEntradasByBuyer.set(String(row.comprador_id), Number(row.total_gastado_entradas ?? 0))
        netoByBuyer.set(String(row.comprador_id), Number(row.neto_empresa_total ?? 0))
      }

      // Site 4 — consumibles breakdown by buyer
      type ConsumiblesBreakdownRow = { comprador_id: string; total_gastado_consumibles: string }
      const cvParams: unknown[] = [buyerIds]
      const cvConditions = [`cv.comprador_id = ANY($1::text[])`]
      if (query.evento) {
        cvParams.push(query.evento)
        cvConditions.push(`cv.evento_id = $${cvParams.length}`)
      }
      if (query.desde) {
        cvParams.push(query.desde)
        cvConditions.push(`DATE(cv.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') >= $${cvParams.length}::date`)
      }
      if (query.hasta) {
        cvParams.push(query.hasta)
        cvConditions.push(`DATE(cv.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') <= $${cvParams.length}::date`)
      }
      const consumiblesRows = await prisma.$queryRawUnsafe<ConsumiblesBreakdownRow[]>(
        `SELECT cv.comprador_id, COALESCE(SUM(cv.total), 0) AS total_gastado_consumibles
         FROM consumibles_ventas cv
         WHERE ${cvConditions.join(' AND ')}
         GROUP BY cv.comprador_id`,
        ...cvParams,
      )

      for (const row of consumiblesRows) {
        consumiblesByBuyer.set(String(row.comprador_id), Number(row.total_gastado_consumibles ?? 0))
      }
    }

    const columns = resolveCompradoresExportColumns(view)
    const rows = serializeCompradoresExportRows(
      compradores.map((comprador) => ({
        ...comprador,
        total_gastado_entradas: totalEntradasByBuyer.get(String(comprador.id)) ?? 0,
        total_gastado_consumibles: consumiblesByBuyer.get(String(comprador.id)) ?? 0,
        neto_empresa_total: netoByBuyer.get(String(comprador.id)) ?? 0,
      })) as Record<string, unknown>[],
      view,
    )

    if (exportFormat === 'xlsx') {
      const workbook = await buildCompradoresWorkbookBuffer(rows, columns)
      res.setHeader('Content-Type', COMPRADORES_EXPORT_CONTENT_TYPE)
      res.setHeader('Content-Disposition', `attachment; filename="${buildCompradoresExportFilename()}"`)
      return res.status(200).send(workbook)
    }

    const csv = toCsv(rows, columns)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${buildCompradoresCsvExportFilename()}"`)
    return res.status(200).send(csv)
  } catch {
    logServerError('compradores export')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /compradores/summary — KPIs globales independientes de filtros de UI
// MUST be declared before /:id to avoid Express shadowing
// Auth: empresa users always allowed; empleados need ver_recaudacion
router.get('/summary', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const permisos = user.permisos as Permisos | undefined

    if (esEmpleado && !permisos?.ver_recaudacion) {
      return res.status(403).json({ error: 'Sin permiso' })
    }

    // Access to this endpoint is gated by `ver_recaudacion`, but exact-money fields
    // inside it (top_spender.total_gastado, ticket_promedio_neto) must additionally
    // respect `ver_montos_compradores` — same redaction contract as GET / and GET /:id/compras.
    const view = resolveCompradoresActorView(user)

    const empresaId = esEmpleado ? user.empresa_id! : user.id

    // Neto expression matching entradas list pattern
    const NETO_EXPR = `COALESCE(en.neto_empresa_amount, en.precio_pagado - COALESCE(en.comision, 0) - COALESCE(en.mp_fee_amount, 0))`

    type GlobalRow = { total_compradores: bigint; con_email: bigint }
    type RecurrenciaRow = { sin_compras: bigint; con_1_compra: bigint; con_2_o_mas: bigint }
    type TopSpenderRow = { id: string; nombre: string; email: string | null; total_gastado: string; total_entradas: bigint }
    type Nuevos30dRow = { nuevos_30d: bigint }
    type TicketRow = { total_neto: string; total_entradas: bigint }

    const [
      globalRows,
      recurrenciaRows,
      topSpenderRows,
      nuevos30dRows,
      ticketRows,
    ] = await Promise.all([
      // Site 5 — Global aggregates: total, email
      prisma.$queryRawUnsafe<GlobalRow[]>(
        `SELECT
          COUNT(c.id) AS total_compradores,
          SUM(CASE WHEN TRIM(c.email) <> '' THEN 1 ELSE 0 END) AS con_email
         FROM compradores c
         WHERE c.empresa_id = $1`,
        empresaId,
      ),
      // Site 6 — Recurrencia: compradores con 0, 1, 2+ entradas no canceladas
      prisma.$queryRawUnsafe<RecurrenciaRow[]>(
        `SELECT
          SUM(CASE WHEN cnt = 0 THEN 1 ELSE 0 END) AS sin_compras,
          SUM(CASE WHEN cnt = 1 THEN 1 ELSE 0 END) AS con_1_compra,
          SUM(CASE WHEN cnt >= 2 THEN 1 ELSE 0 END) AS con_2_o_mas
         FROM (
           SELECT c.id, COUNT(en.id) AS cnt
           FROM compradores c
           LEFT JOIN entradas en ON en.comprador_id = c.id AND en.estado <> 'cancelada'
           WHERE c.empresa_id = $1
           GROUP BY c.id
         ) sub`,
        empresaId,
      ),
      // Site 7 — Top spender: entradas neto + consumibles
      prisma.$queryRawUnsafe<TopSpenderRow[]>(
        `SELECT
          c.id,
          c.nombre,
          c.email,
          COALESCE(SUM(CASE WHEN en.estado <> 'cancelada' THEN ${NETO_EXPR} ELSE 0 END), 0)
            + COALESCE(cv_stats.total_consumibles, 0) AS total_gastado,
          COUNT(DISTINCT CASE WHEN en.estado <> 'cancelada' THEN en.id END) AS total_entradas
         FROM compradores c
         LEFT JOIN entradas en ON en.comprador_id = c.id
         LEFT JOIN (
           SELECT comprador_id, SUM(total) as total_consumibles
           FROM consumibles_ventas
           WHERE estado <> 'cancelado'
           GROUP BY comprador_id
         ) cv_stats ON cv_stats.comprador_id = c.id
         WHERE c.empresa_id = $1
         GROUP BY c.id, c.nombre, c.email, cv_stats.total_consumibles
         ORDER BY total_gastado DESC
         LIMIT 1`,
        empresaId,
      ),
      // Site 8 — Nuevos en últimos 30 días (DATE_SUB → INTERVAL)
      prisma.$queryRawUnsafe<Nuevos30dRow[]>(
        `SELECT COUNT(id) AS nuevos_30d
         FROM compradores
         WHERE empresa_id = $1
           AND created_at >= NOW() - INTERVAL '30 days'`,
        empresaId,
      ),
      // Site 9 — Ticket promedio neto
      prisma.$queryRawUnsafe<TicketRow[]>(
        `SELECT
          COALESCE(SUM(${NETO_EXPR}), 0) AS total_neto,
          COUNT(en.id) AS total_entradas
         FROM entradas en
         JOIN eventos ev ON ev.id = en.evento_id
         WHERE ev.empresa_id = $1
           AND en.estado <> 'cancelada'`,
        empresaId,
      ),
    ])

    const globalRow = globalRows[0]
    const recurrenciaRow = recurrenciaRows[0]
    const ticketRow = ticketRows[0]

    const totalCompradores = Number(globalRow?.total_compradores ?? 0n)
    const conEmail = Number(globalRow?.con_email ?? 0n)

    const sinCompras = Number(recurrenciaRow?.sin_compras ?? 0n)
    const con1Compra = Number(recurrenciaRow?.con_1_compra ?? 0n)
    const con2OMas = Number(recurrenciaRow?.con_2_o_mas ?? 0n)

    const conEmailPct = totalCompradores > 0 ? (conEmail / totalCompradores) * 100 : 0
    const tasaRecurrenciaPct = totalCompradores > 0 ? (con2OMas / totalCompradores) * 100 : 0

    const totalNeto = Number(ticketRow?.total_neto ?? 0)
    const totalEntradas = Number(ticketRow?.total_entradas ?? 0n)
    const ticketPromedioNeto = totalEntradas > 0 ? totalNeto / totalEntradas : null

    const topSpenderRow = topSpenderRows[0] ?? null
    const topSpender = topSpenderRow
      ? {
          id: String(topSpenderRow.id),
          nombre: String(topSpenderRow.nombre),
          email: topSpenderRow.email ? String(topSpenderRow.email) : null,
          total_entradas: Number(topSpenderRow.total_entradas ?? 0),
          ...(view.puedeVerMontos ? { total_gastado: Number(topSpenderRow.total_gastado ?? 0) } : {}),
        }
      : null

    return res.json({
      data: {
        global: {
          total_compradores: totalCompradores,
          con_email: conEmail,
          con_email_pct: conEmailPct,
          sin_compras: sinCompras,
          con_1_compra: con1Compra,
          con_2_o_mas: con2OMas,
          tasa_recurrencia_pct: tasaRecurrenciaPct,
          ...(view.puedeVerMontos ? { ticket_promedio_neto: ticketPromedioNeto } : {}),
        },
        top_spender: topSpender,
        nuevos_30d: Number(nuevos30dRows[0]?.nuevos_30d ?? 0n),
      },
    })
  } catch {
    logServerError('compradores summary')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /compradores/:id/compras — historial unificado (entradas + consumibles)
router.get(
  '/:id/compras',
  verifyInternal,
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.user!
      const empresaId = getActorEmpresaId(user)
      const { id } = req.params

      if (!empresaId) return res.status(403).json({ error: 'Sin permisos' })
      if (!requirePermission(user, 'ver_compradores', res, 'Sin permisos')) return

      const view = resolveCompradoresActorView(user)

      // Verify comprador belongs to this empresa (tenant scoping)
      // Site A — verify comprador ownership
      type CompradoresOwnerRow = { id: string }
      const compradorCheck = await prisma.$queryRawUnsafe<CompradoresOwnerRow[]>(
        `SELECT id FROM compradores WHERE id = $1 AND empresa_id = $2`,
        id, empresaId,
      )
      if (!compradorCheck[0]) {
        return res.status(404).json({ error: 'Comprador no encontrado' })
      }

      const ITEMS_LIMIT = 100

      // Sites B1+B2 — entradas + consumibles in parallel
      type EntradaHistorialRow = {
        id: string
        tipo: string
        estado: string
        precio_pagado: string
        created_at: Date
        evento_nombre: string
        categoria_nombre: string | null
        barra_nombre: string | null
      }
      const [entradasRows, consumiblesRows] = await Promise.all([
        prisma.$queryRawUnsafe<EntradaHistorialRow[]>(
          `SELECT
             en.id,
             'entrada' AS tipo,
             en.estado,
             en.precio_pagado,
             en.created_at,
             ev.nombre AS evento_nombre,
             ec.nombre AS categoria_nombre,
             NULL AS barra_nombre
           FROM entradas en
           JOIN eventos ev ON ev.id = en.evento_id
           LEFT JOIN entrada_categorias ec ON ec.id = en.categoria_id
           WHERE en.comprador_id = $1 AND ev.empresa_id = $2
           ORDER BY en.created_at DESC
           LIMIT $3`,
          id, empresaId, ITEMS_LIMIT,
        ),
        prisma.$queryRawUnsafe<EntradaHistorialRow[]>(
          `SELECT
             cv.id,
             'consumible' AS tipo,
             cv.estado,
             CASE
               WHEN cv.estado = 'resuelto_parcial' AND cv.delivered_amount IS NOT NULL
               THEN cv.delivered_amount
               ELSE cv.total
             END AS precio_pagado,
             cv.created_at,
             ev.nombre AS evento_nombre,
             NULL AS categoria_nombre,
             b.nombre AS barra_nombre
           FROM consumibles_ventas cv
           JOIN eventos ev ON ev.id = cv.evento_id
           LEFT JOIN barras b ON b.id = cv.barra_id
           WHERE cv.comprador_id = $1 AND cv.empresa_id = $2
           ORDER BY cv.created_at DESC
           LIMIT $3`,
          id, empresaId, ITEMS_LIMIT,
        ),
      ])

      // Merge and sort unified timeline DESC
      const unified = [...entradasRows, ...consumiblesRows]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, ITEMS_LIMIT)
        .map((item) => ({
          id: String(item.id),
          tipo: item.tipo as 'entrada' | 'consumible',
          estado: String(item.estado),
          ...(view.puedeVerMontos ? { precio_pagado: Number(item.precio_pagado) } : {}),
          created_at: item.created_at instanceof Date
            ? item.created_at.toISOString()
            : String(item.created_at),
          evento_nombre: String(item.evento_nombre),
          categoria_nombre: item.categoria_nombre != null ? String(item.categoria_nombre) : null,
          barra_nombre: item.barra_nombre != null ? String(item.barra_nombre) : null,
        }))

      // Totales (counts include cancelled; gastado sums exclude them)
      const totalEntradas = entradasRows.length
      const totalConsumibles = consumiblesRows.length
      const gastadoEntradas = entradasRows.reduce((sum, e) => {
        return e.estado !== 'cancelada' ? sum + Number(e.precio_pagado) : sum
      }, 0)
      const gastadoConsumibles = consumiblesRows.reduce((sum, cv) => {
        return cv.estado !== 'cancelado' ? sum + Number(cv.precio_pagado) : sum
      }, 0)

      return res.json({
        data: {
          compras: unified,
          totales: {
            entradas: totalEntradas,
            consumibles: totalConsumibles,
            ...(view.puedeVerMontos ? {
              gastado_entradas: gastadoEntradas,
              gastado_consumibles: gastadoConsumibles,
              gastado_total: gastadoEntradas + gastadoConsumibles,
            } : {}),
          },
        },
      })
    } catch (error) {
      logServerError('compradores compras')
      return res.status(500).json({ error: 'Error interno del servidor' })
    }
  }
)

// POST /compradores/:id/login-token
router.post(
  '/:id/login-token',
  loginTokenRateLimit,
  verifyInternal,
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.user!
      const esEmpleado = user.userType === 'empleado'
      const permisos = user.permisos

      if (esEmpleado && (!permisos || !permisos.ingresar_como_comprador)) {
        return res.status(403).json({ error: 'Sin permisos' })
      }

      const empresaId = esEmpleado ? user.empresa_id! : user.id
      const { id } = req.params

      // Site C — verify comprador + fetch empresa slug
      type LoginTokenLookupRow = { id: string; slug: string }
      const rows = await prisma.$queryRawUnsafe<LoginTokenLookupRow[]>(
        `SELECT c.id, e.slug FROM compradores c
         JOIN empresas e ON e.id = c.empresa_id
         WHERE c.id = $1 AND c.empresa_id = $2`,
        id, empresaId,
      )
      if (!rows.length) {
        return res.status(404).json({ error: 'Comprador no encontrado' })
      }

      const token = uuidv4()
      const tokenHash = createHash('sha256').update(token).digest('hex')
      const expires = new Date(Date.now() + 60 * 1000) // 1 minuto

      // Site D — insert login token
      await prisma.loginToken.create({
        data: {
          id: tokenHash,
          comprador_id: id,
          empresa_slug: rows[0].slug,
          expires_at: expires,
        },
      })

      return res.json({ token, slug: rows[0].slug })
    } catch (error) {
      logServerError('compradores login-token')
      return res.status(500).json({ error: 'Error interno del servidor' })
    }
  }
)

// PUT /compradores/:id/password
router.put(
  '/:id/password',
  verifyInternal,
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.user!
      const esEmpleado = user.userType === 'empleado'
      const permisos = user.permisos

      // Solo dueños o empleados con permiso específico
      if (esEmpleado && (!permisos || !permisos.cambiar_password_compradores)) {
        return res.status(403).json({ error: 'Sin permisos' })
      }

      const empresaId = esEmpleado ? user.empresa_id! : user.id
      const { id } = req.params

      const { nuevaPassword } = req.body
      // No validamos la policy: la empresa puede setear cualquier contraseña
      // como reset. El comprador la rota en su próximo login con la policy
      // enforced del lado de él (must_change_password=true).
      if (typeof nuevaPassword !== 'string' || nuevaPassword.length === 0) {
        return res.status(400).json({ error: 'La nueva contraseña es obligatoria' })
      }

      // Site E — verify comprador ownership
      type CompradoresIdRow = { id: string }
      const passwordCheckRows = await prisma.$queryRawUnsafe<CompradoresIdRow[]>(
        `SELECT id FROM compradores WHERE id = $1 AND empresa_id = $2`,
        id, empresaId,
      )
      if (!passwordCheckRows.length) {
        return res.status(404).json({ error: 'Comprador no encontrado' })
      }

      const hash = await bcrypt.hash(nuevaPassword, 12)
      // Site F — update password + mark for forced rotation on next login
      await prisma.comprador.update({
        where: { id },
        data: {
          password: hash,
          must_change_password: true,
          temporary_password_set_at: new Date(),
        },
      })
      await touchPasswordVersion('comprador', id)

      await logAuditEvent({
        actor: actorFromRequest(req),
        action: 'comprador.password_changed_by_empresa',
        entityType: 'comprador',
        entityId: id,
        payload: { empresa_id: empresaId },
      })

      return res.json({ ok: true })
    } catch (error) {
      logServerError('compradores password update')
      return res.status(500).json({ error: 'Error interno del servidor' })
    }
  }
)

export default router
