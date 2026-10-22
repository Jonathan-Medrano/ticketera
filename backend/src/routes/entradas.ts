import { Router, Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import { verifyInternal, requireAuth } from '../middleware/auth'
import type { Permisos } from '../lib/permisos'
import { getActorEmpresaId, requirePermissionMiddleware } from '../lib/authz'
import { logServerError } from '../lib/safe-log'
import {
  buildEntradasCsvExportFilename,
  buildEntradasWorkbookBuffer,
  buildEntradasExportFilename,
  ENTRADAS_EXPORT_CSV_CONTENT_TYPE,
  ENTRADAS_EXPORT_CONTENT_TYPE,
} from '../lib/entradas-export-workbook'
import { toCsv } from '../lib/refund-manual'
import {
  dispatchBuyerPurchaseDelivery,
  type CheckoutSessionRow,
  type DeliveryEntryReceipt,
} from './tenant'

const router = Router()
const HARD_LIMIT = 500
const DEFAULT_PAGE_SIZE = 25
const DEFAULT_EXPORT_LIMIT = 2000

// Mismo patrón de validación de email usado en pos.ts / resto del backend.
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

type EntradasListRow = {
  id: string
  qr_code?: string | null
  clave_corta?: string | null
  estado: 'valida' | 'usada' | 'cancelada'
  precio_pagado?: number | null
  comision?: number | null
  neto_empresa_amount?: number | null
  created_at: string
  checkout_session_id?: string | null
  evento_nombre: string
  categoria_nombre?: string | null
  comprador_nombre?: string | null
  comprador_email?: string | null
  comprador_dni?: string | null
  funcion_fecha?: string | null
}

type EntradasActorView = {
  puedeVerTotales: boolean
  puedeVerPrecios: boolean
  puedeVerCompradorSensitive: boolean
}

type EntradasQuery = {
  page: number
  pageSize: number
  busqueda: string
  evento: string
  categoria_id: string
  estado: string
  sortBy: string
  sortDir: 'asc' | 'desc'
  includeRefunded: boolean
  desde: string
  hasta: string
}

type EntradasExportFormat = 'xlsx' | 'csv'
const ENTRADAS_ALLOWED_STATES = ['valida', 'usada', 'cancelada'] as const

function resolveEntradasActorView(user: NonNullable<Request['user']>): EntradasActorView {
  const esEmpleado = user.userType === 'empleado'
  const permisos = user.permisos as Permisos | undefined

  return {
    puedeVerTotales: !esEmpleado || !permisos || permisos.ver_totales_entradas || permisos.ver_recaudacion,
    puedeVerPrecios: !esEmpleado || !permisos || permisos.ver_precios_entradas || permisos.ver_recaudacion,
    puedeVerCompradorSensitive: !esEmpleado || !permisos || permisos.ver_montos_compradores,
  }
}

function resolveEntradasExportView(user: NonNullable<Request['user']>) {
  const baseView = resolveEntradasActorView(user)
  const esEmpleado = user.userType === 'empleado'
  const permisos = user.permisos as Permisos | undefined

  return {
    ...baseView,
    puedeVerCompradorSensitive: baseView.puedeVerCompradorSensitive || !esEmpleado || !permisos || permisos.ver_recaudacion,
  }
}

function readEntradasQuery(req: Request): EntradasQuery {
  const page = Math.max(1, Number(req.query.page) || 1)
  const requestedPageSize = Number(req.query.pageSize) || DEFAULT_PAGE_SIZE

  return {
    page,
    pageSize: Math.min(HARD_LIMIT, Math.max(1, requestedPageSize)),
    busqueda: typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : '',
    evento: typeof req.query.evento === 'string' ? req.query.evento.trim() : '',
    categoria_id: typeof req.query.categoria_id === 'string' ? req.query.categoria_id.trim() : '',
    estado: typeof req.query.estado === 'string' ? req.query.estado.trim() : '',
    sortBy: typeof req.query.sortBy === 'string' ? req.query.sortBy.trim() : 'alta',
    sortDir: req.query.sortDir === 'asc' ? 'asc' : 'desc',
    includeRefunded: req.query.includeRefunded === 'false' ? false : true,
    desde: typeof req.query.desde === 'string' ? req.query.desde.trim() : '',
    hasta: typeof req.query.hasta === 'string' ? req.query.hasta.trim() : '',
  }
}

function resolveEntradasExportFormat(req: Request): EntradasExportFormat {
  return req.query.format === 'csv' ? 'csv' : 'xlsx'
}

function buildEntradasOrderClause(sortBy: string, sortDir: 'asc' | 'desc') {
  const sortMap: Record<string, string> = {
    comprador: `c.nombre ${sortDir}`,
    evento: `ev.nombre ${sortDir}`,
    categoria: `ec.nombre ${sortDir}`,
    clave: `en.clave_corta ${sortDir}`,
    precio: `en.precio_pagado ${sortDir}`,
    estado: `en.estado ${sortDir}`,
    alta: `en.created_at ${sortDir}`,
  }

  return sortMap[sortBy] ?? `en.created_at ${sortDir}`
}

// Postgres-compatible filter builder for list and export endpoints (uses $n placeholders)
function buildEntradasPgFilters(empresaId: string, query: EntradasQuery) {
  const params: unknown[] = [empresaId]
  const conds: string[] = ['ev.empresa_id = $1']
  const estadosSeleccionados = query.estado
    .split(',')
    .map((v) => v.trim())
    .filter((v): v is (typeof ENTRADAS_ALLOWED_STATES)[number] => ENTRADAS_ALLOWED_STATES.includes(v as (typeof ENTRADAS_ALLOWED_STATES)[number]))

  if (query.busqueda) {
    params.push(`%${query.busqueda}%`)
    const p = params.length
    conds.push(`(
      c.nombre ILIKE $${p} OR
      c.email ILIKE $${p} OR
      c.dni ILIKE $${p} OR
      en.clave_corta ILIKE $${p} OR
      EXISTS (
        SELECT 1
        FROM platform_sale_allocations psa
        WHERE psa.source_type = 'entrada'
          AND psa.source_id = en.id
          AND psa.entry_kind = 'allocation'
          AND psa.checkout_session_id ILIKE $${p}
      )
    )`)
  }

  if (query.evento) {
    params.push(query.evento)
    conds.push(`ev.id = $${params.length}`)
  }

  if (query.categoria_id) {
    params.push(query.categoria_id)
    conds.push(`en.categoria_id = $${params.length}`)
  }

  if (query.desde) {
    params.push(query.desde)
    conds.push(
      `en.created_at >= ($${params.length}::date)::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'`,
    )
  }

  if (query.hasta) {
    params.push(query.hasta)
    conds.push(
      `en.created_at < (($${params.length}::date) + INTERVAL '1 day')::timestamp AT TIME ZONE 'America/Argentina/Buenos_Aires'`,
    )
  }

  if (estadosSeleccionados.length > 0 && estadosSeleccionados.length < ENTRADAS_ALLOWED_STATES.length) {
    conds.push(`en.estado = ANY($${params.length + 1}::text[])`)
    params.push(estadosSeleccionados)
  } else if (!query.includeRefunded) {
    conds.push(`en.estado <> 'cancelada'`)
  }

  return { whereClause: conds.join(' AND '), params }
}

function buildEntradasRowsQuery(whereClause: string, orderClause: string, limitClause: string) {
  return `SELECT 
    en.id, en.qr_code, en.clave_corta, en.estado, en.precio_pagado, en.comision, en.neto_empresa_amount, en.created_at,
    alloc.checkout_session_id,
    ev.nombre as evento_nombre,
    ec.nombre as categoria_nombre,
    c.nombre as comprador_nombre, c.email as comprador_email, c.dni as comprador_dni,
    ef.fecha as funcion_fecha
   FROM entradas en
    JOIN eventos ev ON ev.id = en.evento_id
    LEFT JOIN entrada_categorias ec ON ec.id = en.categoria_id
    LEFT JOIN compradores c ON c.id = en.comprador_id
    LEFT JOIN evento_fechas ef ON ef.id = en.fecha_id
    LEFT JOIN platform_sale_allocations alloc
      ON alloc.id = (
        SELECT psa.id
        FROM platform_sale_allocations psa
        WHERE psa.source_type = 'entrada'
          AND psa.source_id = en.id
          AND psa.entry_kind = 'allocation'
        ORDER BY psa.created_at DESC, psa.id DESC
        LIMIT 1
      )
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

  return formatter.format(date).replace(' ', ' ')
}

function resolveEntradasExportColumns(view: { puedeVerPrecios: boolean; puedeVerCompradorSensitive: boolean }) {
  const columns = [
    'fecha_compra',
    'estado',
    'reembolsada',
    'evento',
  ]

  if (view.puedeVerCompradorSensitive) {
    columns.push('comprador_email', 'comprador_dni')
  }

  if (view.puedeVerPrecios) {
    columns.push('precio_pagado', 'comision', 'neto_empresa_amount', 'total_reembolsado', 'total_sin_reembolso', 'total_final', 'neto_total')
  }

  return columns
}

function serializeEntradasExportRows(rows: EntradasListRow[], view: { puedeVerPrecios: boolean; puedeVerCompradorSensitive: boolean }) {
  return rows.map((entrada) => {
    const record: Record<string, unknown> = {
      // Excel receives this as stable local text to preserve CSV parity and avoid timezone drift.
      fecha_compra: formatCsvDateTime(entrada.created_at),
      estado: entrada.estado,
      reembolsada: entrada.estado === 'cancelada' ? 'Sí' : 'No',
      evento: entrada.evento_nombre,
      categoria: entrada.categoria_nombre ?? '',
      clave: entrada.clave_corta ?? '',
      checkout_session_id: entrada.checkout_session_id ?? '',
      comprador_nombre: entrada.comprador_nombre ?? '',
    }

    if (view.puedeVerCompradorSensitive) {
      record.comprador_email = entrada.comprador_email ?? ''
      record.comprador_dni = entrada.comprador_dni ?? ''
    }

    if (view.puedeVerPrecios) {
      const precioPagado = Number(entrada.precio_pagado ?? 0)
      const comision = Number(entrada.comision ?? 0)
      const netoEmpresaAmount = Number(entrada.neto_empresa_amount ?? (precioPagado - comision))
      const totalReembolsado = entrada.estado === 'cancelada' ? precioPagado : 0
      const totalFinal = entrada.estado === 'cancelada' ? 0 : precioPagado
      const netoTotal = entrada.estado === 'cancelada' ? 0 : netoEmpresaAmount
      record.precio_pagado = precioPagado
      record.comision = comision
      record.neto_empresa_amount = netoEmpresaAmount
      record.total_reembolsado = totalReembolsado
      record.total_sin_reembolso = precioPagado
      record.total_final = totalFinal
      record.neto_total = netoTotal
    }

    return record
  })
}

function resolveEntradasExportLimit() {
  const raw = Number(process.env.ENTRADAS_EXPORT_MAX_ROWS)
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_EXPORT_LIMIT
  return Math.floor(raw)
}

router.get('/', verifyInternal, requireAuth, requirePermissionMiddleware('ver_entradas'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    const { puedeVerTotales, puedeVerPrecios, puedeVerCompradorSensitive } = resolveEntradasActorView(user)
    const query = readEntradasQuery(req)
    const { pageSize } = query
    const page = query.page
    const orderClause = buildEntradasOrderClause(query.sortBy, query.sortDir)

    // Note: mp_fee_amount and neto_empresa_amount are guaranteed present by Prisma migrations.
    const { whereClause: pgWhereClause, params } = buildEntradasPgFilters(empresaId, query)

    // Site 10 — COUNT + eventos + stats (parallel)
    type CountRow = { total: bigint }
    type EventoRow = { id: string; nombre: string }
    type StatsRow = {
      total_entradas: bigint
      total_neto_acreditado: string
      total_bruto: string
      total_validas: bigint
      total_usadas: bigint
      total_canceladas: bigint
    }

    const [countRows, eventos, statsRows] = await Promise.all([
      // Site 10 — COUNT
      prisma.$queryRawUnsafe<CountRow[]>(
        `SELECT COUNT(*) as total
         FROM entradas en
         JOIN eventos ev ON ev.id = en.evento_id
         LEFT JOIN compradores c ON c.id = en.comprador_id
         WHERE ${pgWhereClause}`,
        ...params,
      ),
      // Site 11 — eventos for filter dropdown
      prisma.$queryRawUnsafe<EventoRow[]>(
        `SELECT id, nombre FROM eventos WHERE empresa_id = $1 AND activo = true ORDER BY nombre`,
        empresaId,
      ),
      // Site 12 — stats aggregates
      prisma.$queryRawUnsafe<StatsRow[]>(
        `SELECT
           COUNT(en.id) as total_entradas,
           COALESCE(SUM(CASE WHEN en.estado <> 'cancelada' THEN COALESCE(en.neto_empresa_amount, en.precio_pagado - COALESCE(en.comision, 0) - COALESCE(en.mp_fee_amount, 0)) ELSE 0 END), 0) as total_neto_acreditado,
           COALESCE(SUM(CASE WHEN en.estado <> 'cancelada' THEN en.precio_pagado ELSE 0 END), 0) as total_bruto,
           COUNT(CASE WHEN en.estado = 'valida' THEN 1 END) as total_validas,
           COUNT(CASE WHEN en.estado = 'usada' THEN 1 END) as total_usadas,
           COUNT(CASE WHEN en.estado = 'cancelada' THEN 1 END) as total_canceladas
         FROM entradas en
         JOIN eventos ev ON ev.id = en.evento_id
         LEFT JOIN compradores c ON c.id = en.comprador_id
         WHERE ${pgWhereClause}`,
        ...params,
      ),
    ])

    const total = Number(countRows[0]?.total ?? 0n)
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const currentPage = Math.min(page, totalPages)
    const currentOffset = (currentPage - 1) * pageSize

    // Site 13 — entradas rows
    const limitParamIdx = params.length + 1
    const offsetParamIdx = params.length + 2
    const entradas = await prisma.$queryRawUnsafe<EntradasListRow[]>(
      buildEntradasRowsQuery(pgWhereClause, orderClause, `LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`),
      ...params, pageSize, currentOffset,
    )

    const statsRow = statsRows[0]
    const entradasSanitizadas = entradas.map((entrada) => ({
      ...entrada,
      precio_pagado: puedeVerPrecios ? Number(entrada.precio_pagado ?? 0) : null,
      comision: puedeVerPrecios ? Number(entrada.comision ?? 0) : null,
      neto_empresa_amount: puedeVerPrecios ? Number(entrada.neto_empresa_amount ?? (Number(entrada.precio_pagado ?? 0) - Number(entrada.comision ?? 0))) : null,
      comprador_email: puedeVerCompradorSensitive ? entrada.comprador_email : null,
      comprador_dni: puedeVerCompradorSensitive ? entrada.comprador_dni : null,
    }))

    return res.json({
      data: {
        entradas: entradasSanitizadas,
        eventos,
        stats: {
          total_entradas: Number(statsRow?.total_entradas ?? 0),
          total_validas: Number(statsRow?.total_validas ?? 0),
          total_usadas: Number(statsRow?.total_usadas ?? 0),
          total_canceladas: Number(statsRow?.total_canceladas ?? 0),
          total_recaudado: puedeVerTotales ? Number(statsRow?.total_bruto ?? 0) : null,
          total_neto_acreditado: puedeVerTotales ? Number(statsRow?.total_neto_acreditado ?? 0) : null,
          total_bruto: puedeVerTotales ? Number(statsRow?.total_bruto ?? 0) : null,
        },
      },
      pagination: {
        page: currentPage,
        pageSize,
        total,
        totalPages,
      },
    })
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    logServerError(`entradas list — ${detail}`)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /entradas/:id/reenviar-email — reenvía la entrada por email desde el
// historial de ventas. Reusa el dispatcher canónico (dispatchBuyerPurchaseDelivery,
// mismos templates + Resend que el flujo online y el POS). El email destino es
// editable: por defecto se pre-carga el del comprador en el front, pero el cajero
// puede corregirlo / completarlo (caso "vendí en POS sin email"). Sin idempotencia:
// reenviar es justamente la intención. La entrega va por una checkout_session_id
// sintética `pos:<entrada_id>` (columna plana en delivery_dispatch_attempts, NO FK).
router.post('/:id/reenviar-email', verifyInternal, requireAuth, requirePermissionMiddleware('ver_entradas'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const entradaId = typeof req.params.id === 'string' ? req.params.id : ''
    if (!entradaId) return res.status(400).json({ error: 'Falta el id de la entrada' })

    const body = (req.body ?? {}) as Record<string, unknown>
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : ''
    if (!EMAIL_REGEX.test(email)) return res.status(400).json({ error: 'Email inválido' })

    type EntradaRow = {
      id: string
      qr_code: string | null
      clave_corta: string | null
      estado: 'valida' | 'usada' | 'cancelada'
      comprador_id: string | null
      comprador_nombre: string | null
      evento_nombre: string
      categoria_nombre: string | null
    }
    // Scope por empresa (aislamiento multi-tenant): solo entradas de eventos de esta empresa.
    const rows = await prisma.$queryRaw<EntradaRow[]>`
      SELECT en.id, en.qr_code, en.clave_corta, en.estado, en.comprador_id,
             c.nombre AS comprador_nombre,
             ev.nombre AS evento_nombre,
             ec.nombre AS categoria_nombre
      FROM entradas en
        JOIN eventos ev ON ev.id = en.evento_id
        LEFT JOIN entrada_categorias ec ON ec.id = en.categoria_id
        LEFT JOIN compradores c ON c.id = en.comprador_id
      WHERE en.id = ${entradaId} AND ev.empresa_id = ${empresaId}
      LIMIT 1`
    const entrada = rows[0]
    if (!entrada) return res.status(404).json({ error: 'Entrada no encontrada' })
    if (entrada.estado === 'cancelada') return res.status(409).json({ error: 'No se puede reenviar una entrada reembolsada' })
    if (!entrada.qr_code || !entrada.clave_corta) return res.status(409).json({ error: 'La entrada no tiene QR emitido' })

    const empresa = await prisma.empresa.findFirst({ where: { id: empresaId }, select: { slug: true } })
    const slug = empresa?.slug ?? ''
    if (!slug) return res.status(500).json({ error: 'Empresa sin slug configurado' })

    const session: CheckoutSessionRow = {
      id: `pos:${entrada.id}`,
      comprador_id: entrada.comprador_id ?? '',
      empresa_id: empresaId,
      datos: [],
      email,
      comprador_nombre: entrada.comprador_nombre ?? undefined,
      phone_e164: null,
      phone_verified_at: null,
      delivery_preference: 'email',
    }
    const entradas: DeliveryEntryReceipt[] = [{
      qrCode: entrada.qr_code,
      claveCorta: entrada.clave_corta,
      categoria: entrada.categoria_nombre ?? '',
      evento: entrada.evento_nombre,
    }]

    let dispatchResult
    try {
      dispatchResult = await dispatchBuyerPurchaseDelivery({ slug, flow: 'entradas', session, entradas, ventas: [] })
    } catch (err) {
      logServerError('entrada reenviar-email dispatch', err)
      return res.status(502).json({ error: 'No se pudo enviar el email, intentá de nuevo' })
    }

    const ok = dispatchResult.attempts.some((a) => a.channel === 'email' && a.status === 'sent')
    if (!ok) return res.status(502).json({ error: 'No se pudo enviar el email, intentá de nuevo' })
    return res.json({ data: { estado: 'enviado', email } })
  } catch (err) {
    logServerError('entrada reenviar-email', err)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /entradas/summary — KPIs independientes de filtros de UI
// MUST be declared before /:id (no /:id in this router, but kept here for safety)
// Auth: empresa users always allowed; empleados need ver_recaudacion permission
// Returns period aggregates + daily time-series for last 30 days
router.get('/summary', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const permisos = user.permisos as Permisos | undefined

    if (esEmpleado && !permisos?.ver_recaudacion) {
      return res.status(403).json({ error: 'Sin permiso' })
    }

    const empresaId = esEmpleado ? user.empresa_id! : user.id

    // Note: mp_fee_amount and neto_empresa_amount are guaranteed present by Prisma migrations.

    // Helper expression: neto = neto_empresa_amount ?? precio_pagado - comision - mp_fee_amount
    const NETO_EXPR = `COALESCE(en.neto_empresa_amount, en.precio_pagado - COALESCE(en.comision, 0) - COALESCE(en.mp_fee_amount, 0))`

    type PeriodoRow = { vendidas: bigint; brutos: string; neto: string; canceladas: bigint }
    type PorDiaRow = { fecha: string; vendidas: bigint; neto: string }

    const [
      hoyRows,
      ultimos7dRows,
      ultimos30dRows,
      porDiaRows,
    ] = await Promise.all([
      // Site 14 — Periodo: hoy
      prisma.$queryRawUnsafe<PeriodoRow[]>(
        `SELECT
          COUNT(CASE WHEN en.estado IN ('valida', 'usada') THEN 1 END) AS vendidas,
          COALESCE(SUM(CASE WHEN en.estado IN ('valida', 'usada') THEN en.precio_pagado ELSE 0 END), 0) AS brutos,
          COALESCE(SUM(CASE WHEN en.estado IN ('valida', 'usada') THEN ${NETO_EXPR} ELSE 0 END), 0) AS neto,
          COUNT(CASE WHEN en.estado = 'cancelada' THEN 1 END) AS canceladas
        FROM entradas en
        JOIN eventos ev ON ev.id = en.evento_id
        WHERE ev.empresa_id = $1
          AND DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') = (NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date`,
        empresaId,
      ),
      // Site 15 — Periodo: últimos 7 días (DATE_SUB → - INTERVAL)
      prisma.$queryRawUnsafe<PeriodoRow[]>(
        `SELECT
          COUNT(CASE WHEN en.estado IN ('valida', 'usada') THEN 1 END) AS vendidas,
          COALESCE(SUM(CASE WHEN en.estado IN ('valida', 'usada') THEN en.precio_pagado ELSE 0 END), 0) AS brutos,
          COALESCE(SUM(CASE WHEN en.estado IN ('valida', 'usada') THEN ${NETO_EXPR} ELSE 0 END), 0) AS neto,
          COUNT(CASE WHEN en.estado = 'cancelada' THEN 1 END) AS canceladas
        FROM entradas en
        JOIN eventos ev ON ev.id = en.evento_id
        WHERE ev.empresa_id = $1
          AND en.created_at >= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - INTERVAL '7 days') AT TIME ZONE 'America/Argentina/Buenos_Aires'`,
        empresaId,
      ),
      // Periodo: últimos 30 días (incluye tasa de cancelación)
      prisma.$queryRawUnsafe<PeriodoRow[]>(
        `SELECT
          COUNT(CASE WHEN en.estado IN ('valida', 'usada') THEN 1 END) AS vendidas,
          COALESCE(SUM(CASE WHEN en.estado IN ('valida', 'usada') THEN en.precio_pagado ELSE 0 END), 0) AS brutos,
          COALESCE(SUM(CASE WHEN en.estado IN ('valida', 'usada') THEN ${NETO_EXPR} ELSE 0 END), 0) AS neto,
          COUNT(CASE WHEN en.estado = 'cancelada' THEN 1 END) AS canceladas
        FROM entradas en
        JOIN eventos ev ON ev.id = en.evento_id
        WHERE ev.empresa_id = $1
          AND en.created_at >= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - INTERVAL '30 days') AT TIME ZONE 'America/Argentina/Buenos_Aires'`,
        empresaId,
      ),
      // Serie diaria: últimos 30 días (DATE_FORMAT → TO_CHAR)
      prisma.$queryRawUnsafe<PorDiaRow[]>(
        `SELECT
          TO_CHAR(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD') AS fecha,
          COUNT(CASE WHEN en.estado IN ('valida', 'usada') THEN 1 END) AS vendidas,
          COALESCE(SUM(CASE WHEN en.estado IN ('valida', 'usada') THEN ${NETO_EXPR} ELSE 0 END), 0) AS neto
        FROM entradas en
        JOIN eventos ev ON ev.id = en.evento_id
        WHERE ev.empresa_id = $1
          AND en.created_at >= ((NOW() AT TIME ZONE 'America/Argentina/Buenos_Aires')::date - INTERVAL '30 days') AT TIME ZONE 'America/Argentina/Buenos_Aires'
        GROUP BY TO_CHAR(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires', 'YYYY-MM-DD')
        ORDER BY fecha ASC`,
        empresaId,
      ),
    ])

    // Helper: compute ticket_promedio_neto (null when no sales)
    function calcTicketPromedio(neto: number, vendidas: number): number | null {
      if (vendidas === 0) return null
      return neto / vendidas
    }

    // Helper: compute tasa_cancelacion_pct (null when no entries at all)
    function calcTasaCancelacion(canceladas: number, vendidas: number): number | null {
      const total = vendidas + canceladas
      if (total === 0) return null
      return (canceladas / total) * 100
    }

    // Shape a periodo row
    function shapePeriodo(row: PeriodoRow | undefined, includeTasa = false) {
      const vendidas = Number(row?.vendidas ?? 0)
      const brutos = Number(row?.brutos ?? 0)
      const neto = Number(row?.neto ?? 0)
      const canceladas = Number(row?.canceladas ?? 0)
      const base = {
        vendidas,
        brutos,
        neto,
        canceladas,
        ticket_promedio_neto: calcTicketPromedio(neto, vendidas),
      }
      if (includeTasa) {
        return { ...base, tasa_cancelacion_pct: calcTasaCancelacion(canceladas, vendidas) }
      }
      return base
    }

    // Fill missing days in the last 30 days with zeros
    const dataByFecha = new Map<string, { vendidas: number; neto: number }>()
    for (const row of porDiaRows) {
      dataByFecha.set(row.fecha as string, { vendidas: Number(row.vendidas ?? 0), neto: Number(row.neto ?? 0) })
    }

    const ventas_por_dia: Array<{ fecha: string; vendidas: number; neto: number }> = []
    for (let i = 29; i >= 0; i--) {
      const d = new Date()
      d.setHours(0, 0, 0, 0)
      d.setDate(d.getDate() - i)
      const fecha = d.toISOString().slice(0, 10) // YYYY-MM-DD
      const existing = dataByFecha.get(fecha)
      ventas_por_dia.push({ fecha, vendidas: existing?.vendidas ?? 0, neto: existing?.neto ?? 0 })
    }

    return res.json({
      data: {
        periodo: {
          hoy: shapePeriodo(hoyRows[0]),
          ultimos_7d: shapePeriodo(ultimos7dRows[0]),
          ultimos_30d: shapePeriodo(ultimos30dRows[0], true),
        },
        ventas_por_dia,
      },
    })
  } catch {
    logServerError('entradas summary')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// El export exige AMBOS permisos: 'exportar' (poder bajar archivos) y
// 'ver_entradas' (poder ver estos datos). Sin el segundo, un empleado con
// 'exportar' pero sin acceso a entradas podia descargarse el listado completo
// que la UI le niega — un bypass del control de acceso de GET '/' (linea 302).
// El test que cubria esto pasaba en falso porque su fixture no otorgaba
// 'exportar', asi que el 403 venia del permiso equivocado.
router.get('/export', verifyInternal, requireAuth, requirePermissionMiddleware('exportar'), requirePermissionMiddleware('ver_entradas'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const exportView = resolveEntradasExportView(user)
    const exportFormat = resolveEntradasExportFormat(req)
    const query = readEntradasQuery(req)
    const orderClause = buildEntradasOrderClause(query.sortBy, query.sortDir)
    const exportLimit = resolveEntradasExportLimit()

    // Note: mp_fee_amount and neto_empresa_amount are guaranteed present by Prisma migrations.
    // Site 5 — COUNT for export limit check (Postgres $n params)
    const { whereClause: pgWhereClause, params: pgParams } = buildEntradasPgFilters(empresaId, query)
    type ExportCountRow = { total: bigint }
    const [exportCountRow] = await prisma.$queryRawUnsafe<ExportCountRow[]>(
      `SELECT COUNT(*) AS total
       FROM entradas en
       JOIN eventos ev ON ev.id = en.evento_id
       LEFT JOIN compradores c ON c.id = en.comprador_id
       WHERE ${pgWhereClause}`,
      ...pgParams,
    )

    const total = Number(exportCountRow?.total ?? 0n)
    if (total > exportLimit) {
      return res.status(413).json({
        error: `Refiná los filtros para exportar hasta ${exportLimit} entradas por archivo.`,
        code: 'export_limit_exceeded',
        limit: exportLimit,
        total,
      })
    }

    // Site 6 — main export rows query (Postgres $n params)
    const exportRowsParams = [...pgParams, exportLimit]
    const limitParamIdx = exportRowsParams.length
    const entradas = await prisma.$queryRawUnsafe<EntradasListRow[]>(
      buildEntradasRowsQuery(pgWhereClause, orderClause, `LIMIT $${limitParamIdx}`),
      ...exportRowsParams,
    )

    const columns = resolveEntradasExportColumns(exportView)
    const rows = serializeEntradasExportRows(entradas, exportView)

    if (exportFormat === 'csv') {
      const csv = toCsv(rows, columns)
      res.setHeader('Content-Type', ENTRADAS_EXPORT_CSV_CONTENT_TYPE)
      res.setHeader('Content-Disposition', `attachment; filename="${buildEntradasCsvExportFilename()}"`)
      return res.status(200).send(csv)
    }

    const workbook = await buildEntradasWorkbookBuffer(rows, columns)

    res.setHeader('Content-Type', ENTRADAS_EXPORT_CONTENT_TYPE)
    res.setHeader('Content-Disposition', `attachment; filename="${buildEntradasExportFilename()}"`)
    return res.status(200).send(workbook)
  } catch (err) {
    logServerError('entradas export', err)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

export default router
