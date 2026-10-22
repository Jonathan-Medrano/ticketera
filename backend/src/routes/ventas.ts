import { Router, Request, Response } from 'express'
import { verifyInternal, requireAuth } from '../middleware/auth'
import type { Permisos } from '../lib/permisos'
import { getActorEmpresaId, requirePermissionMiddleware, requireAnyPermission } from '../lib/authz'
import { logServerError } from '../lib/safe-log'
import { cancelPendingConsumableSale } from '../lib/consumibles-sales'
import { buildConsumiblesExportFilename, buildConsumiblesWorkbookBuffer, CONSUMIBLES_EXPORT_CONTENT_TYPE } from '../lib/consumibles-export-workbook'
import { safeCsvCell } from '../lib/csv-escape'
import { prisma } from '../lib/prisma'

const router = Router()
const HARD_LIMIT = 500
const DEFAULT_PAGE_SIZE = 25
const DEFAULT_EXPORT_LIMIT = 2000

type ConsumiblesVentaRow = {
  id: string
  clave_corta: string
  estado: 'pendiente' | 'canjeado' | 'cancelado' | 'resuelto_parcial'
  origen?: string | null
  total?: number | null
  neto_empresa_amount?: number | null
  delivered_amount?: number | null
  refunded_amount?: number | null
  checkout_session_id?: string | null
  created_at: string
  barra_nombre?: string | null
  evento_nombre?: string | null
}

type ConsumiblesActorView = {
  puedeVerMontos: boolean
}

type ConsumiblesQuery = {
  page: number
  pageSize: number
  busqueda: string
  evento_id: string
  barra_id: string
  estado: string
  desde: string
  hasta: string
  sortBy: string
  sortDir: 'asc' | 'desc'
}
type ConsumiblesExportFormat = 'csv' | 'xlsx'
const CONSUMIBLES_ALLOWED_STATES = ['pendiente', 'canjeado', 'cancelado', 'resuelto_parcial'] as const

function resolveConsumiblesActorView(user: NonNullable<Request['user']>): ConsumiblesActorView {
  const esEmpleado = user.userType === 'empleado'
  const permisos = user.permisos as Permisos | undefined

  return {
    puedeVerMontos: !esEmpleado || !permisos || permisos.ver_totales_consumibles || permisos.ver_recaudacion,
  }
}

function readConsumiblesQuery(req: Request): ConsumiblesQuery {
  const page = Math.max(1, Number(req.query.page) || 1)
  const requestedPageSize = Number(req.query.pageSize) || DEFAULT_PAGE_SIZE

  return {
    page,
    pageSize: Math.min(HARD_LIMIT, Math.max(1, requestedPageSize)),
    busqueda: typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : '',
    evento_id: typeof req.query.evento_id === 'string' ? req.query.evento_id.trim() : '',
    barra_id: typeof req.query.barra_id === 'string' ? req.query.barra_id.trim() : '',
    estado: typeof req.query.estado === 'string' ? req.query.estado.trim() : '',
    desde: typeof req.query.desde === 'string' ? req.query.desde.trim() : '',
    hasta: typeof req.query.hasta === 'string' ? req.query.hasta.trim() : '',
    sortBy: typeof req.query.sortBy === 'string' ? req.query.sortBy.trim() : 'alta',
    sortDir: req.query.sortDir === 'asc' ? 'asc' : 'desc',
  }
}

function resolveConsumiblesExportFormat(req: Request): ConsumiblesExportFormat {
  return req.query.format === 'xlsx' ? 'xlsx' : 'csv'
}

function buildConsumiblesOrderClause(sortBy: string, sortDir: 'asc' | 'desc') {
  const sortMap: Record<string, string> = {
    clave: `cv.clave_corta ${sortDir}`,
    estado: `cv.estado ${sortDir}`,
    total: `cv.total ${sortDir}`,
    barra: `b.nombre ${sortDir}`,
    evento: `ev.nombre ${sortDir}`,
    alta: `cv.created_at ${sortDir}`,
  }

  return sortMap[sortBy] ?? `cv.created_at ${sortDir}`
}

function buildConsumiblesPgFilters(empresaId: string, query: ConsumiblesQuery) {
  const condiciones: string[] = []
  const params: unknown[] = []

  // empresaId — always first
  params.push(empresaId)
  condiciones.push(`cv.empresa_id = $1`)

  const estadosSeleccionados = query.estado
    .split(',')
    .map((value) => value.trim())
    .filter((value): value is (typeof CONSUMIBLES_ALLOWED_STATES)[number] => CONSUMIBLES_ALLOWED_STATES.includes(value as (typeof CONSUMIBLES_ALLOWED_STATES)[number]))

  if (query.evento_id) {
    params.push(query.evento_id)
    condiciones.push(`cv.evento_id = $${params.length}`)
  }
  if (query.barra_id) {
    params.push(query.barra_id)
    condiciones.push(`cv.barra_id = $${params.length}`)
  }
  if (query.busqueda) {
    const searchValue = `%${query.busqueda}%`
    params.push(searchValue, searchValue, searchValue, searchValue)
    const n = params.length
    condiciones.push(`(
      cv.clave_corta ILIKE $${n - 3}
      OR b.nombre ILIKE $${n - 2}
      OR ev.nombre ILIKE $${n - 1}
      OR EXISTS (
        SELECT 1
        FROM consumibles_venta_items cvi
        WHERE cvi.venta_id = cv.id
          AND cvi.nombre_snapshot ILIKE $${n}
      )
    )`)
  }
  if (estadosSeleccionados.length > 0 && estadosSeleccionados.length < CONSUMIBLES_ALLOWED_STATES.length) {
    params.push(estadosSeleccionados)
    condiciones.push(`cv.estado = ANY($${params.length}::text[])`)
  }
  if (query.desde) {
    params.push(query.desde)
    condiciones.push(
      `cv.created_at >= ($${params.length}::date)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'`,
    )
  }
  if (query.hasta) {
    params.push(query.hasta)
    condiciones.push(
      `cv.created_at < (($${params.length}::date) + INTERVAL '1 day')::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'`,
    )
  }

  return {
    pgWhereClause: condiciones.join(' AND '),
    params,
  }
}

function buildConsumiblesRowsQuery(whereClause: string, orderClause: string, limitClause: string) {
  return `SELECT cv.id, cv.clave_corta, cv.estado, cv.origen, cv.total, cv.neto_empresa_amount, cv.delivered_amount, cv.refunded_amount,
          cv.created_at, cv.resuelto_at, cv.refund_case_id, cv.barra_id, cv.evento_id, cv.checkout_session_id,
          b.nombre AS barra_nombre, ev.nombre AS evento_nombre
   FROM consumibles_ventas cv
   JOIN barras b ON b.id = cv.barra_id
   JOIN eventos ev ON ev.id = cv.evento_id
   WHERE ${whereClause}
   ORDER BY ${orderClause}
   ${limitClause}`
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

function shapeConsumiblesVentaRow(venta: ConsumiblesVentaRow, view: ConsumiblesActorView) {
  return {
    ...venta,
    total: view.puedeVerMontos ? Number(venta.total ?? 0) : null,
    neto_empresa_amount: view.puedeVerMontos ? (venta.neto_empresa_amount == null ? null : Number(venta.neto_empresa_amount)) : null,
    delivered_amount: view.puedeVerMontos ? (venta.delivered_amount == null ? null : Number(venta.delivered_amount)) : null,
    refunded_amount: view.puedeVerMontos ? (venta.refunded_amount == null ? null : Number(venta.refunded_amount)) : null,
  }
}

function resolveConsumiblesExportColumns(view: ConsumiblesActorView) {
  const columns = ['fecha_compra', 'estado', 'reembolsada', 'origen', 'evento', 'barra']
  if (view.puedeVerMontos) {
    columns.push('total', 'neto_empresa_amount', 'delivered_amount', 'reembolso_parcial', 'total_reembolsado', 'neto_total')
  }
  return columns
}

function serializeConsumiblesExportRows(rows: ConsumiblesVentaRow[], view: ConsumiblesActorView) {
  return rows.map((venta) => {
    const record: Record<string, unknown> = {
      fecha_compra: formatCsvDateTime(venta.created_at),
      estado: venta.estado,
      reembolsada: venta.estado === 'cancelado' || Number(venta.refunded_amount ?? 0) > 0 ? 'Sí' : 'No',
      origen: venta.origen ?? '',
      evento: venta.evento_nombre ?? '',
      barra: venta.barra_nombre ?? '',
      clave: venta.clave_corta ?? '',
      checkout_session_id: venta.checkout_session_id ?? '',
    }

    if (view.puedeVerMontos) {
      const refundedAmount = venta.refunded_amount == null ? 0 : Number(venta.refunded_amount)
      const totalAmount = Number(venta.total ?? 0)
      const netoEmpresaAmount = venta.neto_empresa_amount == null ? 0 : Number(venta.neto_empresa_amount)
      record.total = Number(venta.total ?? 0)
      record.neto_empresa_amount = venta.neto_empresa_amount == null ? '' : netoEmpresaAmount
      record.delivered_amount = venta.delivered_amount == null ? '' : Number(venta.delivered_amount)
      record.reembolso_parcial = refundedAmount > 0 && refundedAmount < totalAmount ? 'Sí' : 'No'
      record.total_reembolsado = refundedAmount
      record.neto_total = venta.estado === 'cancelado' ? 0 : netoEmpresaAmount
    }

    return record
  })
}

function resolveConsumiblesExportLimit() {
  const raw = Number(process.env.CONSUMIBLES_EXPORT_MAX_ROWS)
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_EXPORT_LIMIT
  return Math.floor(raw)
}

// GET /consumibles/ventas/eventos — eventos con ventas
// IMPORTANTE: registrada ANTES de /:id para que no sea capturada como param
router.get('/eventos', verifyInternal, requireAuth, requirePermissionMiddleware('ver_consumibles'), async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)
  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

  try {
    // Site 1 — migrated to Prisma
    const rows = await prisma.$queryRawUnsafe<{ id: string; nombre: string }[]>(
      `SELECT DISTINCT ev.id, ev.nombre
       FROM consumibles_ventas cv
       JOIN eventos ev ON ev.id = cv.evento_id
       WHERE cv.empresa_id = $1
       ORDER BY ev.nombre`,
      empresaId
    )

    return res.json(rows)
  } catch {
    logServerError('ventas eventos')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /consumibles/ventas/summary — KPIs independientes de filtros de UI
// MUST be declared before /:id to prevent Express matching /summary as /:id
// Auth: empresa users always allowed; empleados need ver_recaudacion permission
router.get('/summary', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const permisos = user.permisos as Permisos | undefined

    if (esEmpleado && !permisos?.ver_recaudacion) {
      return res.status(403).json({ error: 'Sin permiso' })
    }

    const empresaId = esEmpleado ? user.empresa_id! : user.id

    // neto = neto_empresa_amount ?? total - owner_fee_amount - mp_fee_amount
    // brutos: para resuelto_parcial usamos delivered_amount; para el resto total (excluye cancelados)
    const NETO_EXPR = `COALESCE(cv.neto_empresa_amount, cv.total - COALESCE(cv.owner_fee_amount, 0) - COALESCE(cv.mp_fee_amount, 0))`
    const BRUTO_EXPR = `CASE WHEN cv.estado = 'resuelto_parcial' THEN COALESCE(cv.delivered_amount, 0) ELSE cv.total END`

    // Sites 2-5 — migrated to Prisma
    type PeriodoRow = { vendidos: bigint; brutos: string; neto: string; cancelados: bigint }
    type PorDiaRow = { fecha: string; vendidos: bigint; neto: string }

    const [hoyRows, ultimos7dRows, ultimos30dRows, porDiaRows] = await Promise.all([
      // Site 2: Periodo hoy
      prisma.$queryRawUnsafe<PeriodoRow[]>(
        `SELECT
          COUNT(CASE WHEN cv.estado != 'cancelado' THEN 1 END) AS vendidos,
          COALESCE(SUM(CASE WHEN cv.estado != 'cancelado' THEN ${BRUTO_EXPR} ELSE 0 END), 0) AS brutos,
          COALESCE(SUM(CASE WHEN cv.estado != 'cancelado' THEN ${NETO_EXPR} ELSE 0 END), 0) AS neto,
          COUNT(CASE WHEN cv.estado = 'cancelado' THEN 1 END) AS cancelados
        FROM consumibles_ventas cv
        WHERE cv.empresa_id = $1
          AND DATE(cv.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') = (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date`,
        empresaId
      ),
      // Site 3: Periodo últimos 7 días
      prisma.$queryRawUnsafe<PeriodoRow[]>(
        `SELECT
          COUNT(CASE WHEN cv.estado != 'cancelado' THEN 1 END) AS vendidos,
          COALESCE(SUM(CASE WHEN cv.estado != 'cancelado' THEN ${BRUTO_EXPR} ELSE 0 END), 0) AS brutos,
          COALESCE(SUM(CASE WHEN cv.estado != 'cancelado' THEN ${NETO_EXPR} ELSE 0 END), 0) AS neto,
          COUNT(CASE WHEN cv.estado = 'cancelado' THEN 1 END) AS cancelados
        FROM consumibles_ventas cv
        WHERE cv.empresa_id = $1
          AND cv.created_at >= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - INTERVAL '7 days') AT TIME ZONE 'America/Argentina/Buenos_Aires'`,
        empresaId
      ),
      // Site 4: Periodo últimos 30 días
      prisma.$queryRawUnsafe<PeriodoRow[]>(
        `SELECT
          COUNT(CASE WHEN cv.estado != 'cancelado' THEN 1 END) AS vendidos,
          COALESCE(SUM(CASE WHEN cv.estado != 'cancelado' THEN ${BRUTO_EXPR} ELSE 0 END), 0) AS brutos,
          COALESCE(SUM(CASE WHEN cv.estado != 'cancelado' THEN ${NETO_EXPR} ELSE 0 END), 0) AS neto,
          COUNT(CASE WHEN cv.estado = 'cancelado' THEN 1 END) AS cancelados
        FROM consumibles_ventas cv
        WHERE cv.empresa_id = $1
          AND cv.created_at >= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - INTERVAL '30 days') AT TIME ZONE 'America/Argentina/Buenos_Aires'`,
        empresaId
      ),
      // Site 5: Serie diaria últimos 30 días
      prisma.$queryRawUnsafe<PorDiaRow[]>(
        `SELECT
          TO_CHAR(cv.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') AS fecha,
          COUNT(CASE WHEN cv.estado != 'cancelado' THEN 1 END) AS vendidos,
          COALESCE(SUM(CASE WHEN cv.estado != 'cancelado' THEN ${NETO_EXPR} ELSE 0 END), 0) AS neto
        FROM consumibles_ventas cv
        WHERE cv.empresa_id = $1
          AND cv.created_at >= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - INTERVAL '30 days') AT TIME ZONE 'America/Argentina/Buenos_Aires'
        GROUP BY TO_CHAR(cv.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD')
        ORDER BY fecha ASC`,
        empresaId
      ),
    ])

    function calcTicketPromedio(neto: number, vendidos: number): number | null {
      if (vendidos === 0) return null
      return neto / vendidos
    }

    function calcTasaCancelacion(cancelados: number, vendidos: number): number | null {
      const total = vendidos + cancelados
      if (total === 0) return null
      return (cancelados / total) * 100
    }

    function shapePeriodo(row: { vendidos: bigint; brutos: string; neto: string; cancelados: bigint }, includeTasa = false) {
      const vendidos = Number(row.vendidos ?? 0n)
      const brutos = Number(row.brutos ?? 0)
      const neto = Number(row.neto ?? 0)
      const cancelados = Number(row.cancelados ?? 0n)
      const base = {
        vendidos,
        brutos,
        neto,
        cancelados,
        ticket_promedio_neto: calcTicketPromedio(neto, vendidos),
      }
      if (includeTasa) {
        return { ...base, tasa_cancelacion_pct: calcTasaCancelacion(cancelados, vendidos) }
      }
      return base
    }

    // Fill missing days with zeros
    const dataByFecha = new Map<string, { vendidos: number; neto: number }>()
    for (const row of porDiaRows) {
      dataByFecha.set(row.fecha, { vendidos: Number(row.vendidos ?? 0n), neto: Number(row.neto ?? 0) })
    }

    const ventas_por_dia: Array<{ fecha: string; vendidos: number; neto: number }> = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - i)
      const fecha = d.toISOString().slice(0, 10)
      const existing = dataByFecha.get(fecha)
      ventas_por_dia.push({ fecha, vendidos: existing?.vendidos ?? 0, neto: existing?.neto ?? 0 })
    }

    return res.json({
      data: {
        periodo: {
          hoy: shapePeriodo(hoyRows[0]!),
          ultimos_7d: shapePeriodo(ultimos7dRows[0]!),
          ultimos_30d: shapePeriodo(ultimos30dRows[0]!, true),
        },
        ventas_por_dia,
      },
    })
  } catch {
    logServerError('consumibles ventas summary')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /consumibles/ventas — historial con filtros
router.get('/', verifyInternal, requireAuth, requirePermissionMiddleware('ver_consumibles'), async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)
  const actorView = resolveConsumiblesActorView(user)
  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

  try {
    const query = readConsumiblesQuery(req)
    const { page, pageSize } = query
    const orderClause = buildConsumiblesOrderClause(query.sortBy, query.sortDir)
    const { pgWhereClause, params } = buildConsumiblesPgFilters(empresaId, query)

    // Site 6: COUNT
    const countRows = await prisma.$queryRawUnsafe<{ total: bigint }[]>(
      `SELECT COUNT(*) as total
       FROM consumibles_ventas cv
       JOIN barras b ON b.id = cv.barra_id
       JOIN eventos ev ON ev.id = cv.evento_id
       WHERE ${pgWhereClause}`,
      ...params
    )

    const total = Number(countRows[0]?.total ?? 0n)
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const currentPage = Math.min(page, totalPages)
    const offset = (currentPage - 1) * pageSize

    // Sites 7-9: ventas rows, stats, ingresos por evento
    const limitIdx = params.length + 1
    const offsetIdx = params.length + 2
    const listParams = [...params, pageSize, offset]

    const [ventas, statsRows, ingresosPorEvento] = await Promise.all([
      // Site 7: ventas rows
      prisma.$queryRawUnsafe<ConsumiblesVentaRow[]>(
        buildConsumiblesRowsQuery(pgWhereClause, orderClause, `LIMIT $${limitIdx} OFFSET $${offsetIdx}`),
        ...listParams
      ),
      // Site 8: stats
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT
           COUNT(cv.id) as total_tickets,
           COALESCE(SUM(CASE WHEN cv.estado <> 'cancelado' THEN COALESCE(cv.neto_empresa_amount, cv.total - COALESCE(cv.owner_fee_amount, 0) - COALESCE(cv.mp_fee_amount, 0)) ELSE 0 END), 0) as total_neto_acreditado,
           COALESCE(SUM(CASE WHEN cv.estado = 'resuelto_parcial' THEN COALESCE(cv.delivered_amount, 0) WHEN cv.estado <> 'cancelado' THEN cv.total ELSE 0 END), 0) as total_bruto,
           COUNT(CASE WHEN cv.estado = 'pendiente' THEN 1 END) as total_pendientes,
           COUNT(CASE WHEN cv.estado = 'canjeado' THEN 1 END) as total_canjeados,
           COUNT(CASE WHEN cv.estado = 'cancelado' THEN 1 END) as total_cancelados,
           COUNT(CASE WHEN cv.estado = 'resuelto_parcial' THEN 1 END) as total_parciales
         FROM consumibles_ventas cv
         JOIN barras b ON b.id = cv.barra_id
         JOIN eventos ev ON ev.id = cv.evento_id
         WHERE ${pgWhereClause}`,
        ...params
      ),
      // Site 9: ingresos por evento
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT
           ev.id as evento_id,
           ev.nombre as evento_nombre,
           COUNT(cv.id) as total_tickets,
           COALESCE(SUM(CASE WHEN cv.estado <> 'cancelado' THEN COALESCE(cv.neto_empresa_amount, cv.total - COALESCE(cv.owner_fee_amount, 0) - COALESCE(cv.mp_fee_amount, 0)) ELSE 0 END), 0) as total_neto_acreditado,
           COALESCE(SUM(CASE WHEN cv.estado = 'resuelto_parcial' THEN COALESCE(cv.delivered_amount, 0) WHEN cv.estado <> 'cancelado' THEN cv.total ELSE 0 END), 0) as total_bruto,
           COUNT(CASE WHEN cv.estado = 'cancelado' THEN 1 END) as total_cancelados
         FROM consumibles_ventas cv
         JOIN barras b ON b.id = cv.barra_id
         JOIN eventos ev ON ev.id = cv.evento_id
         WHERE ${pgWhereClause}
         GROUP BY ev.id, ev.nombre
         ORDER BY total_bruto DESC, total_tickets DESC, ev.nombre ASC`,
        ...params
      ),
    ])

    const statsRow = statsRows[0]
    return res.json({
      data: {
        ventas: ventas.map((venta: ConsumiblesVentaRow) => ({
          ...shapeConsumiblesVentaRow(venta, actorView),
        })),
        stats: statsRow
          ? {
              total_tickets: Number(statsRow.total_tickets ?? 0n),
              total_neto_acreditado: actorView.puedeVerMontos ? Number(statsRow.total_neto_acreditado ?? 0) : null,
              total_bruto: actorView.puedeVerMontos ? Number(statsRow.total_bruto ?? 0) : null,
              total_pendientes: Number(statsRow.total_pendientes ?? 0n),
              total_canjeados: Number(statsRow.total_canjeados ?? 0n),
              total_cancelados: Number(statsRow.total_cancelados ?? 0n),
              total_parciales: Number(statsRow.total_parciales ?? 0n),
            }
          : {
              total_tickets: 0,
              total_neto_acreditado: 0,
              total_bruto: 0,
              total_pendientes: 0,
              total_canjeados: 0,
              total_cancelados: 0,
              total_parciales: 0,
            },
        ingresos_por_evento: ingresosPorEvento.map((item: Record<string, unknown>) => ({
          evento_id: item.evento_id,
          evento_nombre: item.evento_nombre,
          total_tickets: Number(item.total_tickets ?? 0n),
          total_neto_acreditado: actorView.puedeVerMontos ? Number(item.total_neto_acreditado ?? 0) : null,
          total_bruto: actorView.puedeVerMontos ? Number(item.total_bruto ?? 0) : null,
          total_cancelados: Number(item.total_cancelados ?? 0n),
        })),
      },
      pagination: {
        page: currentPage,
        pageSize,
        total,
        totalPages,
      },
    })
  } catch {
    logServerError('ventas list')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// Mismo criterio que entradas: 'exportar' + el permiso de dominio.
// Sin 'ver_consumibles', un empleado podia exportar las ventas de barra que
// GET '/' le niega. OJO: el rol 'operador' tiene 'exportar' pero NO
// 'ver_consumibles', asi que con este gate pierde el export de ventas de barra.
// Si se decide que debe conservarlo, la forma correcta es otorgarle
// 'ver_consumibles' en lib/permisos.ts — no reabrir el bypass.
router.get('/export', verifyInternal, requireAuth, requirePermissionMiddleware('exportar'), requirePermissionMiddleware('ver_consumibles'), async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)
  const actorView = resolveConsumiblesActorView(user)
  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

  try {
    const query = readConsumiblesQuery(req)
    const exportFormat = resolveConsumiblesExportFormat(req)
    const orderClause = buildConsumiblesOrderClause(query.sortBy, query.sortDir)
    const { pgWhereClause, params } = buildConsumiblesPgFilters(empresaId, query)
    const exportLimit = resolveConsumiblesExportLimit()

    // Site 10: export COUNT
    const countRows = await prisma.$queryRawUnsafe<{ total: bigint }[]>(
      `SELECT COUNT(*) as total
       FROM consumibles_ventas cv
       JOIN barras b ON b.id = cv.barra_id
       JOIN eventos ev ON ev.id = cv.evento_id
       WHERE ${pgWhereClause}`,
      ...params
    )

    const total = Number(countRows[0]?.total ?? 0n)
    if (total > exportLimit) {
      return res.status(413).json({
        error: `Refiná los filtros para exportar hasta ${exportLimit} ventas de consumibles por archivo.`,
        code: 'export_limit_exceeded',
        limit: exportLimit,
        total,
      })
    }

    // Site 11: export rows
    const ventas = await prisma.$queryRawUnsafe<ConsumiblesVentaRow[]>(
      buildConsumiblesRowsQuery(pgWhereClause, orderClause, `LIMIT $${params.length + 1}`),
      ...params,
      exportLimit
    )

    const columns = resolveConsumiblesExportColumns(actorView)
    const rows = serializeConsumiblesExportRows(ventas, actorView)

    if (exportFormat === 'xlsx') {
      const workbook = await buildConsumiblesWorkbookBuffer(rows, columns)
      res.setHeader('Content-Type', CONSUMIBLES_EXPORT_CONTENT_TYPE)
      res.setHeader('Content-Disposition', `attachment; filename="${buildConsumiblesExportFilename()}"`)
      return res.status(200).send(workbook)
    }

    const csv = toCsv(rows, columns)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', 'attachment; filename="Consumibles_Resumen.csv"')
    return res.status(200).send(csv)
  } catch {
    logServerError('ventas export')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /consumibles/ventas/:id — detalle
router.get('/:id', verifyInternal, requireAuth, requirePermissionMiddleware('ver_consumibles'), async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)
  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

  const { id } = req.params

  try {
    // Site 12: venta detail
    const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT cv.*, b.nombre AS barra_nombre, ev.nombre AS evento_nombre
       FROM consumibles_ventas cv
       JOIN barras b ON b.id = cv.barra_id
       JOIN eventos ev ON ev.id = cv.evento_id
       WHERE cv.id = $1 AND cv.empresa_id = $2`,
      id,
      empresaId
    )

    if (!rows.length) return res.status(404).json({ error: 'No encontrado' })

    // Site 13: venta items
    const items = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT cvi.id, cvi.consumible_id, cvi.nombre_snapshot AS consumible_nombre, cvi.cantidad, cvi.precio_unitario, cvi.subtotal,
              cvri.cantidad_entregada, cvri.cantidad_reembolsada, cvri.monto_entregado, cvri.monto_reembolsado, cvri.resolution_reason
       FROM consumibles_venta_items cvi
       LEFT JOIN consumibles_venta_resolucion_items cvri ON cvri.venta_item_id = cvi.id
       WHERE cvi.venta_id = $1`,
      id
    )

    return res.json({
      venta: {
        ...rows[0],
        delivered_amount: rows[0].delivered_amount == null ? null : Number(rows[0].delivered_amount),
        refunded_amount: rows[0].refunded_amount == null ? null : Number(rows[0].refunded_amount),
        items: items.map((item) => ({
          ...item,
          cantidad: Number(item.cantidad),
          precio_unitario: Number(item.precio_unitario),
          subtotal: Number(item.subtotal),
          cantidad_entregada: item.cantidad_entregada == null ? null : Number(item.cantidad_entregada),
          cantidad_reembolsada: item.cantidad_reembolsada == null ? null : Number(item.cantidad_reembolsada),
          monto_entregado: item.monto_entregado == null ? null : Number(item.monto_entregado),
          monto_reembolsado: item.monto_reembolsado == null ? null : Number(item.monto_reembolsado),
        })),
      },
    })
  } catch {
    logServerError('ventas detail')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// PATCH /consumibles/ventas/:id — cancelar (Prisma-native path, owns its own transaction)
router.patch('/:id', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)
  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requireAnyPermission(user, ['gestionar_consumibles', 'gestionar_reembolsos'], res)) return

  const { id } = req.params
  const { accion } = req.body

  if (accion !== 'cancelar') {
    return res.status(400).json({ error: 'Acción no válida' })
  }

  try {
    // Standalone call — cancelPendingConsumableSale owns the prismaDirectUrl transaction
    const result = await cancelPendingConsumableSale({
      ventaId: id,
      empresaId: String(empresaId),
    })

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error })
    }

    return res.json({ ok: true })
  } catch {
    logServerError('ventas cancel')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

export default router
