import { Router, Request, Response } from 'express'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { verifyInternal, requireAuth } from '../middleware/auth'
import { requireUserType, getActorEmpresaId, requirePermissionMiddleware } from '../lib/authz'
import {
  createMarketingCampanaEnviarRateLimit,
  createMarketingCampanaTestSendRateLimit,
} from '../lib/auth-rate-limit'
import { logServerError } from '../lib/safe-log'
import { safeCsvCell } from '../lib/csv-escape'
import { Resend } from 'resend'
import { sendEmailWithRetry } from '../lib/resend-retry'
import { prisma } from '../lib/prisma'
import { Prisma } from '@prisma/client'
import {
  buildStructuredContent,
  serializeStructuredContent,
  parseStructuredContent,
  renderMarketingEmailHtml,
} from '../lib/marketing-email-template'
import {
  buildGoogleAuthUrl,
  parseOAuthState,
  exchangeCode,
  saveGoogleConnection,
  getGoogleConnection,
  deleteGoogleConnection,
  listGa4Properties,
  getGa4MeasurementId,
  listGtmContainers,
  saveGa4Selection,
  saveGtmSelection,
} from '../lib/google-marketing-oauth'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

function getFromEmail(): string {
  const from = process.env.RESEND_FROM_EMAIL
  if (!from && process.env.NODE_ENV === 'production') {
    throw new Error('RESEND_FROM_EMAIL is required in production')
  }
  return from ?? 'onboarding@resend.dev'
}

const resendFromEmail = getFromEmail()

const DANGEROUS_HTML = /<script[\s>]|javascript:|on\w+\s*=/i

function getUnsubscribeSecret(): string {
  const s = process.env.UNSUBSCRIBE_TOKEN_SECRET
  if (!s) throw new Error('UNSUBSCRIBE_TOKEN_SECRET is not configured')
  return s
}

export function buildUnsubscribeToken(compradorId: string, empresaId: string): string {
  const secret = getUnsubscribeSecret()
  const payload64 = Buffer.from(JSON.stringify({ compradorId, empresaId })).toString('base64url')
  const sig = createHmac('sha256', secret).update(payload64).digest('base64url')
  return `${payload64}.${sig}`
}

const router = Router()

// Rate limiters de campañas de marketing: montados acá (middleware de ruta) y no
// globalmente en index.ts, para que corran DESPUÉS de `verifyInternal` +
// `requireAuth` + `requirePermissionMiddleware` — así el keying usa `req.user` ya
// autenticado (ver `getAuthenticatedActorEmpresaId` en `lib/auth-rate-limit.ts`) y
// ningún actor sin `x-internal-secret` válido llega a gastar una transacción Postgres
// de rate limit ni a tocar el bucket de otra empresa.
const marketingCampanaEnviarRateLimit = createMarketingCampanaEnviarRateLimit()
const marketingCampanaTestSendRateLimit = createMarketingCampanaTestSendRateLimit()

router.get('/promociones', verifyInternal, requireAuth, requirePermissionMiddleware('ver_marketing'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? '25'), 10)))
    const busqueda = typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : ''
    const estado = typeof req.query.estado === 'string' ? req.query.estado : 'todos'

    const offset = (page - 1) * pageSize

    const where: Prisma.MarketingCodigoDescuentoWhereInput = { empresa_id: empresaId }
    if (busqueda) where.codigo = { contains: busqueda, mode: 'insensitive' }
    if (estado === 'activo') where.activo = true
    else if (estado === 'inactivo') where.activo = false

    const [total, rawCodigos] = await Promise.all([
      prisma.marketingCodigoDescuento.count({ where }),
      prisma.marketingCodigoDescuento.findMany({
        where,
        orderBy: { created_at: 'desc' },
        skip: offset,
        take: pageSize,
        select: {
          id: true, codigo: true, tipo: true, valor: true, aplica_a: true,
          usos_maximos: true, usos_actuales: true, monto_minimo: true,
          valido_desde: true, valido_hasta: true, evento_id: true, activo: true, created_at: true,
        },
      }),
    ])

    // Fetch evento names for any codes that have evento_id
    const eventoIds = [...new Set(rawCodigos.map((c) => c.evento_id).filter(Boolean) as string[])]
    let eventoMap: Map<string, string> = new Map()
    if (eventoIds.length > 0) {
      const eventos = await prisma.evento.findMany({
        where: { id: { in: eventoIds } },
        select: { id: true, nombre: true },
      })
      eventoMap = new Map(eventos.map((e) => [e.id, e.nombre]))
    }

    const codigos = rawCodigos.map((c) => ({
      ...c,
      evento_nombre: c.evento_id ? (eventoMap.get(c.evento_id) ?? null) : null,
    }))

    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    return res.json({
      data: {
        codigos,
        totals: { total },
      },
      pagination: {
        page,
        pageSize,
        total,
        totalPages,
      },
    })
  } catch {
    logServerError('marketing promociones get')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

const csvEscape = safeCsvCell

function formatDateForCsv(value: unknown): string {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace('T', ' ')
  return String(value).slice(0, 19).replace('T', ' ')
}

router.get('/promociones/export', verifyInternal, requireAuth, requirePermissionMiddleware('exportar'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const busqueda = typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : ''
    const estado = typeof req.query.estado === 'string' ? req.query.estado : 'todos'

    const EXPORT_LIMIT = 10000

    type ExportRow = {
      id: number
      codigo: string
      tipo: string
      valor: unknown
      aplica_a: string
      usos_maximos: number | null
      usos_actuales: number
      monto_minimo: unknown
      valido_desde: Date | null
      valido_hasta: Date | null
      activo: boolean
      created_at: Date
      evento_nombre: string | null
      total_descuento_aplicado: unknown
      usos_registrados: unknown
    }

    const busquedaFilter = busqueda ? Prisma.sql`AND mcd.codigo ILIKE ${`%${busqueda}%`}` : Prisma.empty
    const estadoFilter = estado === 'activo'
      ? Prisma.sql`AND mcd.activo = true`
      : estado === 'inactivo'
        ? Prisma.sql`AND mcd.activo = false`
        : Prisma.empty

    const codigos = await prisma.$queryRaw<ExportRow[]>`
      SELECT mcd.id, mcd.codigo, mcd.tipo, mcd.valor, mcd.aplica_a,
             mcd.usos_maximos, mcd.usos_actuales, mcd.monto_minimo,
             mcd.valido_desde, mcd.valido_hasta, mcd.activo, mcd.created_at,
             ev.nombre AS evento_nombre,
             COALESCE(usos_stats.total_descuento, 0) AS total_descuento_aplicado,
             COALESCE(usos_stats.usos_count, 0) AS usos_registrados
      FROM marketing_codigos_descuento mcd
      LEFT JOIN eventos ev ON ev.id = mcd.evento_id
      LEFT JOIN (
        SELECT codigo_id,
               COUNT(*) AS usos_count,
               COALESCE(SUM(descuento_aplicado), 0) AS total_descuento
        FROM marketing_codigos_descuento_usos
        GROUP BY codigo_id
      ) usos_stats ON usos_stats.codigo_id = mcd.id
      WHERE mcd.empresa_id = ${empresaId}
      ${busquedaFilter}
      ${estadoFilter}
      ORDER BY mcd.created_at DESC
      LIMIT ${EXPORT_LIMIT}
    `

    const headers = [
      'codigo',
      'tipo',
      'valor',
      'aplica_a',
      'evento',
      'estado',
      'usos_actuales',
      'usos_maximos',
      'usos_registrados',
      'total_descuento_aplicado',
      'monto_minimo',
      'valido_desde',
      'valido_hasta',
      'created_at',
    ]

    const lines: string[] = [headers.join(',')]

    for (const row of codigos) {
      lines.push([
        csvEscape(row.codigo),
        csvEscape(row.tipo),
        csvEscape(row.valor),
        csvEscape(row.aplica_a),
        csvEscape(row.evento_nombre ?? 'Todos'),
        csvEscape(row.activo ? 'activo' : 'inactivo'),
        csvEscape(row.usos_actuales),
        csvEscape(row.usos_maximos ?? 'ilimitado'),
        csvEscape(row.usos_registrados),
        csvEscape(row.total_descuento_aplicado),
        csvEscape(row.monto_minimo ?? ''),
        csvEscape(formatDateForCsv(row.valido_desde)),
        csvEscape(formatDateForCsv(row.valido_hasta)),
        csvEscape(formatDateForCsv(row.created_at)),
      ].join(','))
    }

    const csv = '﻿' + lines.join('\r\n')
    const filename = `promociones-${new Date().toISOString().slice(0, 10)}.csv`

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.send(csv)
  } catch {
    logServerError('marketing promociones export')
    return res.status(500).json({ error: 'No se pudo exportar las promociones' })
  }
})

router.get('/promociones/stats', verifyInternal, requireAuth, requirePermissionMiddleware('ver_marketing'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    type StatsRow = {
      total: number
      activos: number
      usos_totales: number
      con_limite: number
    }

    const rows = await prisma.$queryRaw<StatsRow[]>`
      SELECT
        COUNT(*)::int                                          AS total,
        COUNT(*) FILTER (WHERE activo = true)::int            AS activos,
        COALESCE(SUM(usos_actuales), 0)::int                  AS usos_totales,
        COUNT(*) FILTER (WHERE usos_maximos IS NOT NULL)::int AS con_limite
      FROM marketing_codigos_descuento
      WHERE empresa_id = ${empresaId}
    `

    const row = rows[0] ?? { total: 0, activos: 0, usos_totales: 0, con_limite: 0 }

    return res.json({
      data: {
        total: Number(row.total),
        activos: Number(row.activos),
        usos_totales: Number(row.usos_totales),
        con_limite: Number(row.con_limite),
      },
    })
  } catch {
    logServerError('marketing promociones stats get')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.post('/promociones', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_codigos'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const {
      codigo,
      tipo,
      valor,
      aplica_a,
      usos_maximos,
      monto_minimo,
      valido_desde,
      valido_hasta,
      evento_id,
      activo,
    } = req.body

    if (!codigo || typeof codigo !== 'string' || !codigo.trim()) {
      return res.status(400).json({ error: 'El código es requerido' })
    }

    const codigoNorm = String(codigo).trim().toUpperCase()

    if (!tipo || !['porcentaje', 'monto_fijo'].includes(tipo)) {
      return res.status(400).json({ error: 'El tipo debe ser porcentaje o monto_fijo' })
    }

    const valorNum = Number(valor)
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      return res.status(400).json({ error: 'El valor debe ser mayor a 0' })
    }
    if (tipo === 'porcentaje' && valorNum > 100) {
      return res.status(400).json({ error: 'El descuento por porcentaje no puede superar el 100%' })
    }

    if (valido_desde !== undefined && valido_desde !== null) {
      if (isNaN(new Date(valido_desde).getTime())) {
        return res.status(400).json({ error: 'Fecha de inicio inválida' })
      }
    }
    if (valido_hasta !== undefined && valido_hasta !== null) {
      if (isNaN(new Date(valido_hasta).getTime())) {
        return res.status(400).json({ error: 'Fecha de fin inválida' })
      }
    }
    if (valido_desde && valido_hasta && new Date(valido_desde) >= new Date(valido_hasta)) {
      return res.status(400).json({ error: 'La fecha de inicio debe ser anterior a la fecha de fin' })
    }

    const apli = aplica_a && ['todos', 'entradas', 'consumibles'].includes(aplica_a) ? aplica_a : 'todos'
    const usosMax = usos_maximos != null && Number.isFinite(Number(usos_maximos)) && Number(usos_maximos) > 0 ? Number(usos_maximos) : null
    const montoMin = monto_minimo != null && Number.isFinite(Number(monto_minimo)) ? Number(monto_minimo) : null
    const validoDesde = valido_desde ? new Date(valido_desde) : null
    const validoHasta = valido_hasta ? new Date(valido_hasta) : null
    const eventoId = evento_id ? Number(evento_id) : null
    const activoVal = !(activo === false || activo === 0)

    const existing = await prisma.marketingCodigoDescuento.findFirst({
      where: { empresa_id: empresaId, codigo: codigoNorm },
      select: { id: true },
    })

    if (existing) {
      return res.status(409).json({ error: 'Ya existe un código con ese nombre para esta empresa' })
    }

    const created = await prisma.marketingCodigoDescuento.create({
      data: {
        empresa_id: empresaId,
        codigo: codigoNorm,
        tipo: tipo as 'porcentaje' | 'monto_fijo',
        valor: valorNum,
        aplica_a: apli as 'todos' | 'entradas' | 'consumibles',
        usos_maximos: usosMax,
        monto_minimo: montoMin,
        valido_desde: validoDesde,
        valido_hasta: validoHasta,
        evento_id: eventoId ? String(eventoId) : null,
        activo: activoVal,
      },
      select: { id: true },
    })

    return res.status(201).json({ ok: true, id: created.id })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({ error: 'Ya existe un código con ese nombre para esta empresa' })
    }
    logServerError('marketing promociones post')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.put('/promociones/:id', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_codigos'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const { id } = req.params

    const existingRecord = await prisma.marketingCodigoDescuento.findFirst({
      where: { id: parseInt(id, 10), empresa_id: empresaId },
      select: { id: true },
    })

    if (!existingRecord) {
      return res.status(404).json({ error: 'Código no encontrado' })
    }

    const {
      codigo,
      tipo,
      valor,
      aplica_a,
      usos_maximos,
      monto_minimo,
      valido_desde,
      valido_hasta,
      evento_id,
      activo,
    } = req.body

    if (!codigo || typeof codigo !== 'string' || !codigo.trim()) {
      return res.status(400).json({ error: 'El código es requerido' })
    }

    const codigoNorm = String(codigo).trim().toUpperCase()

    if (!tipo || !['porcentaje', 'monto_fijo'].includes(tipo)) {
      return res.status(400).json({ error: 'El tipo debe ser porcentaje o monto_fijo' })
    }

    const valorNum = Number(valor)
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      return res.status(400).json({ error: 'El valor debe ser mayor a 0' })
    }
    if (tipo === 'porcentaje' && valorNum > 100) {
      return res.status(400).json({ error: 'El descuento por porcentaje no puede superar el 100%' })
    }

    if (valido_desde !== undefined && valido_desde !== null) {
      if (isNaN(new Date(valido_desde).getTime())) {
        return res.status(400).json({ error: 'Fecha de inicio inválida' })
      }
    }
    if (valido_hasta !== undefined && valido_hasta !== null) {
      if (isNaN(new Date(valido_hasta).getTime())) {
        return res.status(400).json({ error: 'Fecha de fin inválida' })
      }
    }
    if (valido_desde && valido_hasta && new Date(valido_desde) >= new Date(valido_hasta)) {
      return res.status(400).json({ error: 'La fecha de inicio debe ser anterior a la fecha de fin' })
    }

    const apli = aplica_a && ['todos', 'entradas', 'consumibles'].includes(aplica_a) ? aplica_a : 'todos'
    const usosMax = usos_maximos != null && Number.isFinite(Number(usos_maximos)) && Number(usos_maximos) > 0 ? Number(usos_maximos) : null
    const montoMin = monto_minimo != null && Number.isFinite(Number(monto_minimo)) ? Number(monto_minimo) : null
    const validoDesde = valido_desde ? new Date(valido_desde) : null
    const validoHasta = valido_hasta ? new Date(valido_hasta) : null
    const eventoId = evento_id ? String(evento_id) : null
    const activoVal = activo === false || activo === 0 ? false : true

    const duplicate = await prisma.marketingCodigoDescuento.findFirst({
      where: { empresa_id: empresaId, codigo: codigoNorm, id: { not: parseInt(id, 10) } },
      select: { id: true },
    })

    if (duplicate) {
      return res.status(409).json({ error: 'Ya existe otro código con ese nombre para esta empresa' })
    }

    await prisma.marketingCodigoDescuento.update({
      where: { id: parseInt(id, 10) },
      data: {
        codigo: codigoNorm,
        tipo: tipo as 'porcentaje' | 'monto_fijo',
        valor: valorNum,
        aplica_a: apli as 'todos' | 'entradas' | 'consumibles',
        usos_maximos: usosMax,
        monto_minimo: montoMin,
        valido_desde: validoDesde,
        valido_hasta: validoHasta,
        evento_id: eventoId,
        activo: activoVal,
      },
    })

    return res.json({ ok: true })
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return res.status(409).json({ error: 'Ya existe otro código con ese nombre para esta empresa' })
    }
    logServerError('marketing promociones put')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.delete('/promociones/:id', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_codigos'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const { id } = req.params

    const existing = await prisma.marketingCodigoDescuento.findFirst({
      where: { id: parseInt(id, 10), empresa_id: empresaId },
      select: { id: true },
    })

    if (!existing) {
      return res.status(404).json({ error: 'Código no encontrado' })
    }

    await prisma.marketingCodigoDescuento.update({
      where: { id: parseInt(id, 10) },
      data: { activo: false },
    })

    return res.json({ ok: true })
  } catch {
    logServerError('marketing promociones delete')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

const AUTO_SEGMENTOS = [
  { slug: 'vip', nombre: 'VIP', descripcion: 'Top 10% de compradores por monto gastado en los últimos 180 días' },
  { slug: 'activos', nombre: 'Activos', descripcion: 'Compradores con 2 o más entradas confirmadas en los últimos 90 días' },
  { slug: 'nuevos', nombre: 'Nuevos', descripcion: 'Compradores cuya primera entrada fue en los últimos 30 días' },
  { slug: 'en_riesgo', nombre: 'En riesgo', descripcion: 'Última entrada hace entre 61 y 120 días' },
  { slug: 'inactivos', nombre: 'Inactivos', descripcion: 'Sin entradas confirmadas hace más de 120 días' },
  { slug: 'carrito_abandonado', nombre: 'Carrito abandonado', descripcion: 'Compradores con checkouts expirados sin compra posterior confirmada' },
] as const

type AutoSegmentoSlug = typeof AUTO_SEGMENTOS[number]['slug']

function isAutoSegmentoSlug(value: string): value is AutoSegmentoSlug {
  return AUTO_SEGMENTOS.some((s) => s.slug === value)
}

const segmentosCountCache = new Map<string, { counts: number[]; ts: number }>()
const SEGMENTOS_CACHE_TTL_MS = 5 * 60 * 1000

async function countAutoSegmento(slug: AutoSegmentoSlug, empresaId: string): Promise<number> {
  if (slug === 'vip') {
    type TotalRow = { total: bigint }
    const totalRows = await prisma.$queryRaw<TotalRow[]>`
      SELECT COUNT(DISTINCT c.id)::bigint AS total
      FROM compradores c
      JOIN entradas en ON en.comprador_id = c.id
      WHERE c.empresa_id = ${empresaId} AND en.estado != 'cancelada'
        AND en.created_at >= NOW() - INTERVAL '180 days'
    `
    const total = Number(totalRows[0]?.total ?? 0n)
    const vipLimit = Math.max(1, Math.ceil(total * 0.1))
    type CntRow = { cnt: bigint }
    const vipRows = await prisma.$queryRaw<CntRow[]>`
      SELECT COUNT(*)::bigint AS cnt FROM (
        SELECT c.id
        FROM compradores c
        JOIN entradas en ON en.comprador_id = c.id
        WHERE c.empresa_id = ${empresaId} AND en.estado != 'cancelada'
          AND en.created_at >= NOW() - INTERVAL '180 days'
        GROUP BY c.id
        ORDER BY SUM(en.precio_pagado) DESC, c.id
        LIMIT ${vipLimit}
      ) sub
    `
    return Number(vipRows[0]?.cnt ?? 0n)
  }

  if (slug === 'activos') {
    type CntRow = { cnt: bigint }
    const rows = await prisma.$queryRaw<CntRow[]>`
      SELECT COUNT(*)::bigint AS cnt FROM (
        SELECT c.id
        FROM compradores c
        JOIN entradas en ON en.comprador_id = c.id
        WHERE c.empresa_id = ${empresaId} AND en.estado != 'cancelada'
          AND en.created_at >= NOW() - INTERVAL '90 days'
        GROUP BY c.id
        HAVING COUNT(en.id) >= 2
      ) sub
    `
    return Number(rows[0]?.cnt ?? 0n)
  }

  if (slug === 'nuevos') {
    type CntRow = { cnt: bigint }
    const rows = await prisma.$queryRaw<CntRow[]>`
      SELECT COUNT(*)::bigint AS cnt FROM (
        SELECT c.id
        FROM compradores c
        JOIN entradas en ON en.comprador_id = c.id
        WHERE c.empresa_id = ${empresaId} AND en.estado != 'cancelada'
        GROUP BY c.id
        HAVING MIN(en.created_at) >= NOW() - INTERVAL '30 days'
      ) sub
    `
    return Number(rows[0]?.cnt ?? 0n)
  }

  if (slug === 'en_riesgo') {
    type CntRow = { cnt: bigint }
    const rows = await prisma.$queryRaw<CntRow[]>`
      SELECT COUNT(*)::bigint AS cnt FROM (
        SELECT c.id
        FROM compradores c
        JOIN entradas en ON en.comprador_id = c.id
        WHERE c.empresa_id = ${empresaId} AND en.estado != 'cancelada'
        GROUP BY c.id
        HAVING MAX(en.created_at) < NOW() - INTERVAL '61 days'
           AND MAX(en.created_at) >= NOW() - INTERVAL '120 days'
      ) sub
    `
    return Number(rows[0]?.cnt ?? 0n)
  }

  if (slug === 'inactivos') {
    type CntRow = { cnt: bigint }
    const rows = await prisma.$queryRaw<CntRow[]>`
      SELECT COUNT(*)::bigint AS cnt FROM (
        SELECT c.id
        FROM compradores c
        JOIN entradas en ON en.comprador_id = c.id
        WHERE c.empresa_id = ${empresaId} AND en.estado != 'cancelada'
        GROUP BY c.id
        HAVING MAX(en.created_at) < NOW() - INTERVAL '120 days'
      ) sub
    `
    return Number(rows[0]?.cnt ?? 0n)
  }

  if (slug === 'carrito_abandonado') {
    type TotalRow = { total: bigint }
    const rows = await prisma.$queryRaw<TotalRow[]>`
      SELECT COUNT(DISTINCT cs.comprador_id)::bigint AS total
      FROM checkout_sessions cs
      WHERE cs.empresa_id = ${empresaId} AND cs.estado = 'expirada' AND cs.comprador_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM entradas en
          WHERE en.comprador_id = cs.comprador_id
            AND en.estado != 'cancelada'
            AND en.created_at > cs.created_at
        )
    `
    return Number(rows[0]?.total ?? 0n)
  }

  return 0
}

type AutoSegmentoCompradorRow = {
  id: string
  nombre: string | null
  apellido: string | null
  email: string | null
  created_at: Date
  total_entradas?: bigint
  total_gastado?: unknown
  ultima_compra?: Date | null
  carritos_abandonados?: bigint
}

async function queryAutoSegmentoCompradores(
  slug: AutoSegmentoSlug,
  empresaId: string,
  page: number,
  pageSize: number
): Promise<{ compradores: AutoSegmentoCompradorRow[]; total: number }> {
  const offset = (page - 1) * pageSize

  if (slug === 'vip') {
    type TotalRow = { total: bigint }
    const totalRows = await prisma.$queryRaw<TotalRow[]>`
      SELECT COUNT(DISTINCT c.id)::bigint AS total
      FROM compradores c
      JOIN entradas en ON en.comprador_id = c.id
      WHERE c.empresa_id = ${empresaId} AND en.estado != 'cancelada'
        AND en.created_at >= NOW() - INTERVAL '180 days'
    `
    const total = Number(totalRows[0]?.total ?? 0n)
    const vipLimit = Math.max(1, Math.ceil(total * 0.1))
    const effectiveLimit = Math.min(pageSize, Math.max(0, vipLimit - offset))
    const compradores = await prisma.$queryRaw<AutoSegmentoCompradorRow[]>`
      SELECT c.id, c.nombre, c.apellido, c.email, c.created_at,
             COUNT(DISTINCT en.id)::bigint AS total_entradas,
             COALESCE(SUM(en.precio_pagado), 0) AS total_gastado
      FROM compradores c
      JOIN entradas en ON en.comprador_id = c.id
      WHERE c.empresa_id = ${empresaId} AND en.estado != 'cancelada'
        AND en.created_at >= NOW() - INTERVAL '180 days'
      GROUP BY c.id, c.nombre, c.apellido, c.email, c.created_at
      ORDER BY total_gastado DESC, c.id
      LIMIT ${effectiveLimit} OFFSET ${offset}
    `
    type CntRow = { cnt: bigint }
    const cntRows = await prisma.$queryRaw<CntRow[]>`
      SELECT COUNT(*)::bigint AS cnt FROM (
        SELECT c.id
        FROM compradores c
        JOIN entradas en ON en.comprador_id = c.id
        WHERE c.empresa_id = ${empresaId} AND en.estado != 'cancelada'
          AND en.created_at >= NOW() - INTERVAL '180 days'
        GROUP BY c.id
        ORDER BY SUM(en.precio_pagado) DESC, c.id
        LIMIT ${vipLimit}
      ) sub
    `
    return { compradores, total: Number(cntRows[0]?.cnt ?? 0n) }
  }

  if (slug === 'activos') {
    type CntRow = { cnt: bigint }
    const countRows = await prisma.$queryRaw<CntRow[]>`
      SELECT COUNT(*)::bigint AS cnt FROM (
        SELECT c.id
        FROM compradores c
        JOIN entradas en ON en.comprador_id = c.id
        WHERE c.empresa_id = ${empresaId} AND en.estado != 'cancelada'
          AND en.created_at >= NOW() - INTERVAL '90 days'
        GROUP BY c.id
        HAVING COUNT(en.id) >= 2
      ) sub
    `
    const compradores = await prisma.$queryRaw<AutoSegmentoCompradorRow[]>`
      SELECT c.id, c.nombre, c.apellido, c.email, c.created_at,
             COUNT(DISTINCT en.id)::bigint AS total_entradas,
             COALESCE(SUM(en.precio_pagado), 0) AS total_gastado
      FROM compradores c
      JOIN entradas en ON en.comprador_id = c.id
      WHERE c.empresa_id = ${empresaId} AND en.estado != 'cancelada'
        AND en.created_at >= NOW() - INTERVAL '90 days'
      GROUP BY c.id, c.nombre, c.apellido, c.email, c.created_at
      HAVING COUNT(en.id) >= 2
      ORDER BY c.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `
    return { compradores, total: Number(countRows[0]?.cnt ?? 0n) }
  }

  if (slug === 'nuevos') {
    type CntRow = { cnt: bigint }
    const countRows = await prisma.$queryRaw<CntRow[]>`
      SELECT COUNT(*)::bigint AS cnt FROM (
        SELECT c.id
        FROM compradores c
        JOIN entradas en ON en.comprador_id = c.id
        WHERE c.empresa_id = ${empresaId} AND en.estado != 'cancelada'
        GROUP BY c.id
        HAVING MIN(en.created_at) >= NOW() - INTERVAL '30 days'
      ) sub
    `
    const compradores = await prisma.$queryRaw<AutoSegmentoCompradorRow[]>`
      SELECT c.id, c.nombre, c.apellido, c.email, c.created_at,
             COUNT(DISTINCT en.id)::bigint AS total_entradas,
             COALESCE(SUM(en.precio_pagado), 0) AS total_gastado
      FROM compradores c
      JOIN entradas en ON en.comprador_id = c.id
      WHERE c.empresa_id = ${empresaId} AND en.estado != 'cancelada'
      GROUP BY c.id, c.nombre, c.apellido, c.email, c.created_at
      HAVING MIN(en.created_at) >= NOW() - INTERVAL '30 days'
      ORDER BY c.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `
    return { compradores, total: Number(countRows[0]?.cnt ?? 0n) }
  }

  if (slug === 'en_riesgo') {
    type CntRow = { cnt: bigint }
    const countRows = await prisma.$queryRaw<CntRow[]>`
      SELECT COUNT(*)::bigint AS cnt FROM (
        SELECT c.id
        FROM compradores c
        JOIN entradas en ON en.comprador_id = c.id
        WHERE c.empresa_id = ${empresaId} AND en.estado != 'cancelada'
        GROUP BY c.id
        HAVING MAX(en.created_at) < NOW() - INTERVAL '61 days'
           AND MAX(en.created_at) >= NOW() - INTERVAL '120 days'
      ) sub
    `
    const compradores = await prisma.$queryRaw<AutoSegmentoCompradorRow[]>`
      SELECT c.id, c.nombre, c.apellido, c.email, c.created_at,
             COUNT(DISTINCT en.id)::bigint AS total_entradas,
             COALESCE(SUM(en.precio_pagado), 0) AS total_gastado,
             MAX(en.created_at) AS ultima_compra
      FROM compradores c
      JOIN entradas en ON en.comprador_id = c.id
      WHERE c.empresa_id = ${empresaId} AND en.estado != 'cancelada'
      GROUP BY c.id, c.nombre, c.apellido, c.email, c.created_at
      HAVING MAX(en.created_at) < NOW() - INTERVAL '61 days'
         AND MAX(en.created_at) >= NOW() - INTERVAL '120 days'
      ORDER BY ultima_compra DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `
    return { compradores, total: Number(countRows[0]?.cnt ?? 0n) }
  }

  if (slug === 'inactivos') {
    type CntRow = { cnt: bigint }
    const countRows = await prisma.$queryRaw<CntRow[]>`
      SELECT COUNT(*)::bigint AS cnt FROM (
        SELECT c.id
        FROM compradores c
        JOIN entradas en ON en.comprador_id = c.id
        WHERE c.empresa_id = ${empresaId} AND en.estado != 'cancelada'
        GROUP BY c.id
        HAVING MAX(en.created_at) < NOW() - INTERVAL '120 days'
      ) sub
    `
    const compradores = await prisma.$queryRaw<AutoSegmentoCompradorRow[]>`
      SELECT c.id, c.nombre, c.apellido, c.email, c.created_at,
             COUNT(DISTINCT en.id)::bigint AS total_entradas,
             COALESCE(SUM(en.precio_pagado), 0) AS total_gastado,
             MAX(en.created_at) AS ultima_compra
      FROM compradores c
      JOIN entradas en ON en.comprador_id = c.id
      WHERE c.empresa_id = ${empresaId} AND en.estado != 'cancelada'
      GROUP BY c.id, c.nombre, c.apellido, c.email, c.created_at
      HAVING MAX(en.created_at) < NOW() - INTERVAL '120 days'
      ORDER BY ultima_compra DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `
    return { compradores, total: Number(countRows[0]?.cnt ?? 0n) }
  }

  if (slug === 'carrito_abandonado') {
    type CntRow = { cnt: bigint }
    const countRows = await prisma.$queryRaw<CntRow[]>`
      SELECT COUNT(DISTINCT cs.comprador_id)::bigint AS cnt
      FROM checkout_sessions cs
      WHERE cs.empresa_id = ${empresaId} AND cs.estado = 'expirada' AND cs.comprador_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM entradas en
          WHERE en.comprador_id = cs.comprador_id
            AND en.estado != 'cancelada'
            AND en.created_at > cs.created_at
        )
    `
    const compradores = await prisma.$queryRaw<AutoSegmentoCompradorRow[]>`
      SELECT c.id, c.nombre, c.apellido, c.email, c.created_at,
             COUNT(DISTINCT cs.id)::bigint AS carritos_abandonados
      FROM compradores c
      JOIN checkout_sessions cs ON cs.comprador_id = c.id AND cs.empresa_id = ${empresaId}
      WHERE c.empresa_id = ${empresaId} AND cs.estado = 'expirada'
        AND NOT EXISTS (
          SELECT 1 FROM entradas en
          WHERE en.comprador_id = cs.comprador_id
            AND en.estado != 'cancelada'
            AND en.created_at > cs.created_at
        )
      GROUP BY c.id, c.nombre, c.apellido, c.email, c.created_at
      ORDER BY c.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `
    return { compradores, total: Number(countRows[0]?.cnt ?? 0n) }
  }

  return { compradores: [], total: 0 }
}

router.get('/segmentos', verifyInternal, requireAuth, requirePermissionMiddleware('ver_marketing'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    let autoCounts: number[]
    const cached = segmentosCountCache.get(empresaId)
    if (cached && Date.now() - cached.ts < SEGMENTOS_CACHE_TTL_MS) {
      autoCounts = cached.counts
    } else {
      autoCounts = await Promise.all(AUTO_SEGMENTOS.map((s) => countAutoSegmento(s.slug, empresaId)))
      segmentosCountCache.set(empresaId, { counts: autoCounts, ts: Date.now() })
    }

    type ManualesRow = { id: bigint; nombre: string; descripcion: string | null; created_at: Date; count: bigint }
    const manualesResult = await prisma.$queryRaw<ManualesRow[]>`
      SELECT ms.id, ms.nombre, ms.descripcion, ms.created_at,
             COUNT(msc.comprador_id) as count
      FROM marketing_segmentos ms
      LEFT JOIN marketing_segmentos_compradores msc ON msc.segmento_id = ms.id
      WHERE ms.empresa_id = ${empresaId} AND ms.activo = true
      GROUP BY ms.id, ms.nombre, ms.descripcion, ms.created_at
      ORDER BY ms.created_at DESC
    `
    const automaticos = AUTO_SEGMENTOS.map((s, i) => ({
      slug: s.slug,
      nombre: s.nombre,
      descripcion: s.descripcion,
      count: autoCounts[i],
    }))

    const manuales = manualesResult.map((row) => ({
      id: Number(row.id),
      nombre: String(row.nombre),
      descripcion: row.descripcion ? String(row.descripcion) : null,
      count: Number(row.count ?? 0n),
      created_at: row.created_at,
    }))

    return res.json({ data: { automaticos, manuales } })
  } catch {
    logServerError('marketing segmentos get')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.get('/segmentos/:slugOrId/compradores', verifyInternal, requireAuth, requirePermissionMiddleware('ver_marketing'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const { slugOrId } = req.params
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? '20'), 10)))

    if (isAutoSegmentoSlug(slugOrId)) {
      const { compradores, total } = await queryAutoSegmentoCompradores(slugOrId, empresaId, page, pageSize)
      const totalPages = Math.max(1, Math.ceil(total / pageSize))
      return res.json({
        data: {
          compradores: compradores.map((c) => ({
            ...c,
            total_entradas: c.total_entradas !== undefined ? Number(c.total_entradas) : undefined,
            carritos_abandonados: c.carritos_abandonados !== undefined ? Number(c.carritos_abandonados) : undefined,
          })),
        },
        pagination: { page, pageSize, total, totalPages },
      })
    }

    const segmentoId = parseInt(slugOrId, 10)
    if (!Number.isFinite(segmentoId)) {
      return res.status(400).json({ error: 'Segmento no válido' })
    }

    const segRow = await prisma.marketingSegmento.findFirst({
      where: { id: segmentoId, empresa_id: empresaId, activo: true },
      select: { id: true },
    })
    if (!segRow) return res.status(404).json({ error: 'Segmento no encontrado' })

    const offset = (page - 1) * pageSize

    const total = await prisma.marketingSegmentoComprador.count({
      where: { segmento_id: segmentoId },
    })

    type CompradorRow = {
      id: string
      nombre: string | null
      apellido: string | null
      email: string | null
      created_at: Date
      total_entradas: bigint
      total_gastado: unknown
    }
    const compradores = await prisma.$queryRaw<CompradorRow[]>`
      SELECT c.id, c.nombre, c.apellido, c.email, c.created_at,
             COUNT(DISTINCT en.id) as total_entradas,
             COALESCE(SUM(en.precio_pagado), 0) as total_gastado
      FROM marketing_segmentos_compradores msc
      JOIN compradores c ON c.id = msc.comprador_id
      LEFT JOIN entradas en ON en.comprador_id = c.id AND en.empresa_id = ${empresaId}
      WHERE msc.segmento_id = ${segmentoId}
      GROUP BY c.id, c.nombre, c.apellido, c.email, c.created_at
      ORDER BY msc.agregado_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `

    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    return res.json({
      data: {
        compradores: compradores.map((c) => ({
          ...c,
          total_entradas: Number(c.total_entradas ?? 0n),
          total_gastado: Number(c.total_gastado ?? 0),
        })),
      },
      pagination: { page, pageSize, total, totalPages },
    })
  } catch {
    logServerError('marketing segmentos compradores get')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.post('/segmentos', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_campanas'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const { nombre, descripcion } = req.body

    if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre es requerido' })
    }
    if (nombre.trim().length > 100) {
      return res.status(400).json({ error: 'El nombre no puede superar 100 caracteres' })
    }

    const segmento = await prisma.marketingSegmento.create({
      data: {
        empresa_id: empresaId,
        nombre: nombre.trim(),
        descripcion: descripcion ? String(descripcion).trim() || null : null,
      },
      select: { id: true, nombre: true, descripcion: true, created_at: true },
    })

    return res.status(201).json({ ok: true, data: segmento })
  } catch {
    logServerError('marketing segmentos post')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.put('/segmentos/:id', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_campanas'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const { id } = req.params

    const existingSeg = await prisma.marketingSegmento.findFirst({
      where: { id: parseInt(id, 10), empresa_id: empresaId },
      select: { id: true },
    })
    if (!existingSeg) return res.status(404).json({ error: 'Segmento no encontrado' })

    const { nombre, descripcion, activo } = req.body

    if (nombre !== undefined) {
      if (typeof nombre !== 'string' || !nombre.trim()) {
        return res.status(400).json({ error: 'El nombre no puede estar vacío' })
      }
      if (nombre.trim().length > 100) {
        return res.status(400).json({ error: 'El nombre no puede superar 100 caracteres' })
      }
    }

    const updateData: Prisma.MarketingSegmentoUpdateInput = {}
    if (nombre !== undefined) updateData.nombre = nombre.trim()
    if (descripcion !== undefined) updateData.descripcion = String(descripcion).trim() || null
    if (activo !== undefined) updateData.activo = Boolean(activo)

    if (Object.keys(updateData).length === 0) return res.json({ ok: true })

    await prisma.marketingSegmento.update({
      where: { id: parseInt(id, 10) },
      data: updateData,
    })

    return res.json({ ok: true })
  } catch {
    logServerError('marketing segmentos put')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.delete('/segmentos/:id', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_campanas'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const { id } = req.params

    const existingSeg = await prisma.marketingSegmento.findFirst({
      where: { id: parseInt(id, 10), empresa_id: empresaId },
      select: { id: true },
    })
    if (!existingSeg) return res.status(404).json({ error: 'Segmento no encontrado' })

    await prisma.marketingSegmento.delete({
      where: { id: parseInt(id, 10) },
    })

    return res.json({ ok: true })
  } catch {
    logServerError('marketing segmentos delete')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.post('/segmentos/:id/compradores', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_campanas'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const { id } = req.params
    const { comprador_ids } = req.body

    if (!Array.isArray(comprador_ids) || comprador_ids.length === 0) {
      return res.status(400).json({ error: 'comprador_ids debe ser un array no vacío' })
    }

    const segRow = await prisma.marketingSegmento.findFirst({
      where: { id: parseInt(id, 10), empresa_id: empresaId, activo: true },
      select: { id: true },
    })
    if (!segRow) return res.status(404).json({ error: 'Segmento no encontrado' })

    const ids = comprador_ids.map(String).filter((s) => typeof s === 'string' && s.trim().length > 0)
    if (ids.length === 0) return res.status(400).json({ error: 'IDs de compradores inválidos' })

    const validCompradores = await prisma.comprador.findMany({
      where: { id: { in: ids }, empresa_id: empresaId },
      select: { id: true },
    })
    const validIds = validCompradores.map((c) => c.id)

    if (validIds.length === 0) return res.status(400).json({ error: 'Ningún comprador válido para esta empresa' })

    const segmentoId = parseInt(id, 10)
    await prisma.marketingSegmentoComprador.createMany({
      data: validIds.map((cid) => ({ segmento_id: segmentoId, comprador_id: cid })),
      skipDuplicates: true,
    })

    return res.json({ ok: true, agregados: validIds.length })
  } catch {
    logServerError('marketing segmentos compradores post')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.delete('/segmentos/:id/compradores/:compradorId', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_campanas'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const { id, compradorId } = req.params

    const segRow = await prisma.marketingSegmento.findFirst({
      where: { id: parseInt(id, 10), empresa_id: empresaId },
      select: { id: true },
    })
    if (!segRow) return res.status(404).json({ error: 'Segmento no encontrado' })

    await prisma.marketingSegmentoComprador.deleteMany({
      where: { segmento_id: parseInt(id, 10), comprador_id: compradorId },
    })

    return res.json({ ok: true })
  } catch {
    logServerError('marketing segmentos compradores delete')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// ─── Configuración email de la empresa ──────────────────────────────────────

router.get('/email/configuracion', verifyInternal, requireAuth, requirePermissionMiddleware('ver_marketing'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        email_marketing_from: true,
        email_marketing_from_name: true,
        email_marketing_habilitado: true,
        marketing_carrito_ventana_min: true,
        marketing_carrito_ventana_max: true,
        marketing_automatizaciones: true,
      },
    })

    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' })

    return res.json({
      data: {
        email_marketing_from: empresa.email_marketing_from ?? null,
        email_marketing_from_name: empresa.email_marketing_from_name ?? null,
        email_marketing_habilitado: Boolean(empresa.email_marketing_habilitado),
        marketing_carrito_ventana_min: empresa.marketing_carrito_ventana_min,
        marketing_carrito_ventana_max: empresa.marketing_carrito_ventana_max,
        marketing_automatizaciones: Boolean(empresa.marketing_automatizaciones),
      },
    })
  } catch {
    logServerError('marketing email configuracion get')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.put('/email/configuracion', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_campanas'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const {
      email_marketing_from,
      email_marketing_from_name,
      email_marketing_habilitado,
      marketing_carrito_ventana_min,
      marketing_carrito_ventana_max,
      marketing_automatizaciones,
    } = req.body

    const fromVal = typeof email_marketing_from === 'string' ? email_marketing_from.trim() || null : null
    const fromNameVal = typeof email_marketing_from_name === 'string' ? email_marketing_from_name.trim() || null : null
    const habilitadoVal = Boolean(email_marketing_habilitado)

    const ventanaMinRaw = typeof marketing_carrito_ventana_min === 'number' ? marketing_carrito_ventana_min : null
    const ventanaMaxRaw = typeof marketing_carrito_ventana_max === 'number' ? marketing_carrito_ventana_max : null
    const ventanaMinVal = ventanaMinRaw !== null ? Math.max(15, Math.min(1440, Math.floor(ventanaMinRaw))) : undefined
    const ventanaMaxVal = ventanaMaxRaw !== null ? Math.max(15, Math.min(1440, Math.floor(ventanaMaxRaw))) : undefined
    const automatizacionesVal = marketing_automatizaciones !== undefined ? Boolean(marketing_automatizaciones) : undefined

    if (ventanaMinVal !== undefined && ventanaMaxVal !== undefined && ventanaMinVal >= ventanaMaxVal) {
      return res.status(400).json({ error: 'La ventana mínima debe ser menor que la máxima' })
    }

    await prisma.empresa.update({
      where: { id: empresaId },
      data: {
        email_marketing_from: fromVal,
        email_marketing_from_name: fromNameVal,
        email_marketing_habilitado: habilitadoVal,
        ...(ventanaMinVal !== undefined && { marketing_carrito_ventana_min: ventanaMinVal }),
        ...(ventanaMaxVal !== undefined && { marketing_carrito_ventana_max: ventanaMaxVal }),
        ...(automatizacionesVal !== undefined && { marketing_automatizaciones: automatizacionesVal }),
      },
    })

    return res.json({ ok: true })
  } catch {
    logServerError('marketing email configuracion put')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// ─── CRUD Campañas ────────────────────────────────────────────────────────────

router.get('/campanas', verifyInternal, requireAuth, requirePermissionMiddleware('ver_marketing'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10))
    const pageSize = Math.min(100, Math.max(1, parseInt(String(req.query.pageSize ?? '25'), 10)))
    const tipo = typeof req.query.tipo === 'string' ? req.query.tipo : ''
    const estado = typeof req.query.estado === 'string' ? req.query.estado : ''
    const busqueda = typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : ''
    const offset = (page - 1) * pageSize

    const tipoFilter = tipo && ['manual', 'automatica'].includes(tipo)
      ? Prisma.sql`AND mc.tipo = ${tipo}`
      : Prisma.empty
    const estadoFilter = estado && ['borrador', 'enviando', 'enviada', 'pausada'].includes(estado)
      ? Prisma.sql`AND mc.estado = ${estado}`
      : Prisma.empty
    const busquedaFilter = busqueda ? Prisma.sql`AND mc.nombre ILIKE ${`%${busqueda}%`}` : Prisma.empty

    type CampanaCountRow = { total: bigint }
    const countRows = await prisma.$queryRaw<CampanaCountRow[]>`
      SELECT COUNT(*)::bigint AS total
      FROM marketing_campanas mc
      WHERE mc.empresa_id = ${empresaId}
      ${tipoFilter}
      ${estadoFilter}
      ${busquedaFilter}
    `
    const total = Number(countRows[0]?.total ?? 0n)

    type CampanaListRow = {
      id: number; nombre: string; tipo: string; asunto: string; estado: string
      segmento_id: number | null; evento_id: string | null
      total_destinatarios: number; total_enviados: number; total_abiertos: number; total_clicks: number
      programada_para: Date | null; enviada_at: Date | null; created_at: Date
      segmento_nombre: string | null; evento_nombre: string | null
    }
    const campanas = await prisma.$queryRaw<CampanaListRow[]>`
      SELECT mc.id, mc.nombre, mc.tipo, mc.asunto, mc.estado,
             mc.segmento_id, mc.evento_id,
             mc.total_destinatarios, mc.total_enviados, mc.total_abiertos, mc.total_clicks,
             mc.programada_para, mc.enviada_at, mc.created_at,
             ms.nombre AS segmento_nombre,
             ev.nombre AS evento_nombre
      FROM marketing_campanas mc
      LEFT JOIN marketing_segmentos ms ON ms.id = mc.segmento_id
      LEFT JOIN eventos ev ON ev.id = mc.evento_id
      WHERE mc.empresa_id = ${empresaId}
      ${tipoFilter}
      ${estadoFilter}
      ${busquedaFilter}
      ORDER BY mc.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `

    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    return res.json({
      data: { campanas },
      pagination: { page, pageSize, total, totalPages },
    })
  } catch {
    logServerError('marketing campanas get')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.get('/campanas/:id', verifyInternal, requireAuth, requirePermissionMiddleware('ver_marketing'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const { id } = req.params

    type CampanaDetailRow = {
      id: number; nombre: string; tipo: string; trigger_slug: string | null
      asunto: string; contenido_html: string; estado: string
      segmento_id: number | null; evento_id: string | null
      total_destinatarios: number; total_enviados: number; total_abiertos: number; total_clicks: number
      programada_para: Date | null; enviada_at: Date | null; created_at: Date
      segmento_nombre: string | null; evento_nombre: string | null
    }
    const rows = await prisma.$queryRaw<CampanaDetailRow[]>`
      SELECT mc.id, mc.nombre, mc.tipo, mc.trigger_slug, mc.asunto, mc.contenido_html,
             mc.estado, mc.segmento_id, mc.evento_id,
             mc.total_destinatarios, mc.total_enviados, mc.total_abiertos, mc.total_clicks,
             mc.programada_para, mc.enviada_at, mc.created_at,
             ms.nombre AS segmento_nombre,
             ev.nombre AS evento_nombre
      FROM marketing_campanas mc
      LEFT JOIN marketing_segmentos ms ON ms.id = mc.segmento_id
      LEFT JOIN eventos ev ON ev.id = mc.evento_id
      WHERE mc.id = ${parseInt(id, 10)} AND mc.empresa_id = ${empresaId}
    `

    if (!rows[0]) return res.status(404).json({ error: 'Campaña no encontrada' })

    // `contenido` = los campos estructurados (plantilla) para repoblar el editor.
    // null si la campaña es legacy (HTML crudo) — el front cae a un modo de respaldo.
    const contenido = parseStructuredContent(rows[0].contenido_html)

    return res.json({ data: { ...rows[0], contenido } })
  } catch {
    logServerError('marketing campanas get id')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.post('/campanas', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_campanas'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const { nombre, asunto, contenido, contenido_html, segmento_id, evento_id, tipo } = req.body

    if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre es requerido' })
    }
    if (!asunto || typeof asunto !== 'string' || !asunto.trim()) {
      return res.status(400).json({ error: 'El asunto es requerido' })
    }

    // Contenido estructurado (plantilla) → se serializa a JSON y se guarda en
    // contenido_html. Fallback legacy: si llega contenido_html crudo, se valida igual.
    let contenidoToStore: string
    if (contenido !== undefined && contenido !== null) {
      try {
        contenidoToStore = serializeStructuredContent(buildStructuredContent(contenido))
      } catch (e) {
        return res.status(400).json({ error: e instanceof Error ? e.message : 'Contenido inválido' })
      }
    } else {
      if (!contenido_html || typeof contenido_html !== 'string' || !contenido_html.trim()) {
        return res.status(400).json({ error: 'El contenido del email es requerido' })
      }
      if (DANGEROUS_HTML.test(contenido_html)) {
        return res.status(400).json({ error: 'El contenido contiene elementos no permitidos' })
      }
      contenidoToStore = contenido_html.trim()
    }

    const tipoVal = tipo && ['manual', 'automatica'].includes(tipo) ? tipo : 'manual'
    const segmentoId = segmento_id ? Number(segmento_id) : null
    const eventoId = evento_id ? String(evento_id) : null

    const created = await prisma.marketingCampana.create({
      data: {
        empresa_id: empresaId,
        nombre: nombre.trim(),
        tipo: tipoVal as 'manual' | 'automatica',
        asunto: asunto.trim(),
        contenido_html: contenidoToStore,
        segmento_id: segmentoId,
        evento_id: eventoId,
        estado: 'borrador',
      },
      select: { id: true },
    })

    return res.status(201).json({ ok: true, id: created.id })
  } catch {
    logServerError('marketing campanas post')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.put('/campanas/:id', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_campanas'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const { id } = req.params

    const existing = await prisma.marketingCampana.findFirst({
      where: { id: parseInt(id, 10), empresa_id: empresaId },
      select: { id: true, estado: true },
    })
    if (!existing) return res.status(404).json({ error: 'Campaña no encontrada' })
    if (existing.estado !== 'borrador') {
      return res.status(409).json({ error: 'Solo se pueden editar campañas en borrador' })
    }

    const { nombre, asunto, contenido, contenido_html, segmento_id, evento_id } = req.body

    if (!nombre || typeof nombre !== 'string' || !nombre.trim()) {
      return res.status(400).json({ error: 'El nombre es requerido' })
    }
    if (!asunto || typeof asunto !== 'string' || !asunto.trim()) {
      return res.status(400).json({ error: 'El asunto es requerido' })
    }

    let contenidoToStore: string
    if (contenido !== undefined && contenido !== null) {
      try {
        contenidoToStore = serializeStructuredContent(buildStructuredContent(contenido))
      } catch (e) {
        return res.status(400).json({ error: e instanceof Error ? e.message : 'Contenido inválido' })
      }
    } else {
      if (!contenido_html || typeof contenido_html !== 'string' || !contenido_html.trim()) {
        return res.status(400).json({ error: 'El contenido del email es requerido' })
      }
      if (DANGEROUS_HTML.test(contenido_html)) {
        return res.status(400).json({ error: 'El contenido contiene elementos no permitidos' })
      }
      contenidoToStore = contenido_html.trim()
    }

    const segmentoId = segmento_id ? Number(segmento_id) : null
    const eventoId = evento_id ? String(evento_id) : null

    await prisma.marketingCampana.update({
      where: { id: parseInt(id, 10) },
      data: {
        nombre: nombre.trim(),
        asunto: asunto.trim(),
        contenido_html: contenidoToStore,
        segmento_id: segmentoId,
        evento_id: eventoId,
      },
    })

    return res.json({ ok: true })
  } catch {
    logServerError('marketing campanas put')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.delete('/campanas/:id', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_campanas'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const { id } = req.params

    const existing = await prisma.marketingCampana.findFirst({
      where: { id: parseInt(id, 10), empresa_id: empresaId },
      select: { id: true, estado: true },
    })
    if (!existing) return res.status(404).json({ error: 'Campaña no encontrada' })
    if (existing.estado !== 'borrador') {
      return res.status(409).json({ error: 'Solo se pueden eliminar campañas en borrador' })
    }

    await prisma.marketingCampana.delete({
      where: { id: parseInt(id, 10) },
    })

    return res.json({ ok: true })
  } catch {
    logServerError('marketing campanas delete')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// ─── Envío ────────────────────────────────────────────────────────────────────

const campaignEnvioInProgress = new Set<string>()

async function runCampanaEnvioAsync(
  campanaId: string,
  empresaId: string,
  destinatarios: { id: string | number; email: string; nombre?: string | null; apellido?: string | null }[],
  fromHeader: string,
  replyTo: string | null,
  asunto: string,
  contenidoHtml: string,
  frontendUrl: string
): Promise<void> {
  if (campaignEnvioInProgress.has(campanaId)) return
  campaignEnvioInProgress.add(campanaId)

  const campanaIdInt = parseInt(campanaId, 10)

  try {
    // Bulk INSERT todos los envíos como 'pendiente' — 1 query en lugar de N
    if (destinatarios.length > 0) {
      await prisma.marketingEnvio.createMany({
        data: destinatarios.map((d) => ({
          campana_id: campanaIdInt,
          comprador_id: String(d.id),
          estado: 'pendiente' as const,
        })),
        skipDuplicates: true,
      })
    }

    // Recuperar IDs de envíos insertados
    const envioRows = await prisma.marketingEnvio.findMany({
      where: { campana_id: campanaIdInt, estado: 'pendiente' },
      select: { id: true, comprador_id: true },
    })
    const envioMap = new Map<string, number>()
    for (const row of envioRows) {
      envioMap.set(String(row.comprador_id), row.id)
    }

    let totalEnviados = 0
    const BATCH_SIZE = 50
    const BATCH_DELAY_MS = 1000

    for (let i = 0; i < destinatarios.length; i += BATCH_SIZE) {
      if (i > 0) await new Promise<void>((resolve) => setTimeout(resolve, BATCH_DELAY_MS))

      const batch = destinatarios.slice(i, i + BATCH_SIZE)

      await Promise.all(
        batch.map(async (dest) => {
          const envioId = envioMap.get(String(dest.id)) ?? null
          try {
            const token = buildUnsubscribeToken(String(dest.id), empresaId)
            const unsubscribeUrl = `${frontendUrl}/api/marketing/unsubscribe?token=${token}`
            const htmlConFooter =
              renderMarketingEmailHtml(String(contenidoHtml), { nombre: dest.nombre }) +
              `<p style="text-align:center;color:#999;font-size:12px;margin-top:32px">` +
              `<a href="${unsubscribeUrl}" style="color:#999">Darse de baja</a></p>`

            const result = await sendEmailWithRetry(resend!, {
              from: fromHeader,
              to: String(dest.email),
              ...(replyTo ? { replyTo } : {}),
              subject: String(asunto),
              html: htmlConFooter,
              headers: {
                'List-Unsubscribe': '<' + unsubscribeUrl + '>',
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
              },
            })

            const resendId = result?.data?.id ?? null
            const resendError = result?.error

            if (envioId !== null) {
              if (resendId) {
                await prisma.marketingEnvio.update({
                  where: { id: envioId },
                  data: { estado: 'enviado', resend_id: resendId, enviado_at: new Date() },
                })
              } else {
                const errMsg = resendError
                  ? (typeof resendError === 'object' && 'message' in resendError ? String((resendError as { message?: unknown }).message) : String(resendError)).slice(0, 500)
                  : 'resend_no_id'
                await prisma.marketingEnvio.update({
                  where: { id: envioId },
                  data: { estado: 'error', error_mensaje: errMsg },
                }).catch(() => undefined)
                return
              }
            }

            totalEnviados++
          } catch (err) {
            logServerError(`marketing campana envio destinatario ${dest.id}`)
            if (envioId !== null) {
              const errMsg = err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500)
              await prisma.marketingEnvio.update({
                where: { id: envioId },
                data: { estado: 'error', error_mensaje: errMsg },
              }).catch(() => undefined)
            }
          }
        })
      )
    }

    await prisma.marketingCampana.update({
      where: { id: campanaIdInt },
      data: { estado: 'enviada', total_enviados: totalEnviados, enviada_at: new Date() },
    })
  } catch {
    logServerError(`marketing campana envio async campana_id=${campanaId}`)
    await prisma.marketingCampana.updateMany({
      where: { id: campanaIdInt, estado: 'enviando' },
      data: { estado: 'borrador' },
    }).catch(() => undefined)
  } finally {
    campaignEnvioInProgress.delete(campanaId)
  }
}

router.post('/campanas/:id/enviar', verifyInternal, requireAuth, requirePermissionMiddleware('enviar_campanas'), marketingCampanaEnviarRateLimit, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const { id } = req.params

    type CampanaEnviarRow = {
      id: number; nombre: string; asunto: string; contenido_html: string; estado: string
      segmento_id: number | null; evento_id: string | null
      email_marketing_from: string | null; email_marketing_from_name: string | null
    }
    const campanaRows = await prisma.$queryRaw<CampanaEnviarRow[]>`
      SELECT mc.id, mc.nombre, mc.asunto, mc.contenido_html, mc.estado,
             mc.segmento_id, mc.evento_id,
             em.email_marketing_from, em.email_marketing_from_name
      FROM marketing_campanas mc
      JOIN empresas em ON em.id = mc.empresa_id
      WHERE mc.id = ${parseInt(id, 10)} AND mc.empresa_id = ${empresaId}
    `

    if (!campanaRows[0]) return res.status(404).json({ error: 'Campaña no encontrada' })
    const campana = campanaRows[0]

    if (campana.estado !== 'borrador') {
      return res.status(409).json({ error: 'La campaña ya fue enviada o está en proceso' })
    }

    // Guard atómico a nivel DB para prevenir doble envío en entornos multi-instancia.
    // $executeRaw returns affected row count directly (not wrapped).
    const lockCount = await prisma.$executeRaw`
      UPDATE marketing_campanas SET estado = 'enviando' WHERE id = ${parseInt(id, 10)} AND estado = 'borrador'
    `
    if (lockCount === 0) {
      return res.status(409).json({ error: 'La campaña ya está siendo enviada o fue enviada' })
    }

    // Sender: SIEMPRE el sender verificado de TICKETERA (no requiere configurar nada
    // por empresa). Si la empresa configuró un email válido, se usa como reply-to.
    if (!resend) {
      return res.status(500).json({ error: 'El servicio de email no está configurado (falta RESEND_API_KEY)' })
    }

    // Resolver destinatarios (excluye opt-outs)
    type DestRow = { id: string; email: string; nombre: string | null; apellido: string | null }
    let destinatariosRows: DestRow[] = []

    if (campana.segmento_id) {
      const segId = campana.segmento_id
      const segRow = await prisma.marketingSegmento.findFirst({
        where: { id: segId, empresa_id: empresaId },
        select: { id: true },
      })
      if (segRow) {
        destinatariosRows = await prisma.$queryRaw<DestRow[]>`
          SELECT DISTINCT c.id, c.email, c.nombre, c.apellido
          FROM marketing_segmentos_compradores msc
          JOIN compradores c ON c.id = msc.comprador_id
          WHERE msc.segmento_id = ${segId}
            AND c.email IS NOT NULL AND c.email != ''
            AND c.email_marketing_opt_out = false
        `
      }
    } else if (campana.evento_id) {
      destinatariosRows = await prisma.$queryRaw<DestRow[]>`
        SELECT DISTINCT c.id, c.email, c.nombre, c.apellido
        FROM entradas en
        JOIN compradores c ON c.id = en.comprador_id
        WHERE en.empresa_id = ${empresaId} AND en.evento_id = ${campana.evento_id}
          AND en.estado != 'cancelada'
          AND c.email IS NOT NULL AND c.email != ''
          AND c.email_marketing_opt_out = false
      `
    } else {
      destinatariosRows = await prisma.$queryRaw<DestRow[]>`
        SELECT id, email, nombre, apellido
        FROM compradores
        WHERE empresa_id = ${empresaId}
          AND email IS NOT NULL AND email != ''
          AND email_marketing_opt_out = false
      `
    }

    const destinatarios = destinatariosRows.filter((d) => d.email && String(d.email).trim())

    // Actualizar total_destinatarios (estado ya fue cambiado a 'enviando' en el UPDATE atómico anterior)
    await prisma.marketingCampana.update({
      where: { id: parseInt(id, 10) },
      data: { total_destinatarios: destinatarios.length },
    })

    // El from: SIEMPRE usa el sender verificado de TICKETERA (RESEND_FROM_EMAIL) para no
    // rebotar/caer en spam por dominios sin verificar. El email configurado por la empresa
    // (validado como bien formado arriba) pasa a ser el reply-to, y su nombre el display name.
    // TODO: verificación de dominio por-empresa vía Resend Domains API es la solución futura
    // correcta para poder enviar desde el dominio propio de cada empresa.
    const fromName = campana.email_marketing_from_name || null
    const fromHeader = fromName ? `${fromName} <${resendFromEmail}>` : resendFromEmail
    const configuredFrom = campana.email_marketing_from ? String(campana.email_marketing_from).trim() : ''
    const replyTo = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(configuredFrom) ? configuredFrom : null
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000'

    // Fire-and-forget — la respuesta HTTP no espera al envío
    void runCampanaEnvioAsync(
      id,
      empresaId,
      destinatarios as { id: string | number; email: string; nombre?: string | null; apellido?: string | null }[],
      fromHeader,
      replyTo,
      String(campana.asunto),
      String(campana.contenido_html ?? ''),
      frontendUrl
    )

    return res.status(202).json({
      ok: true,
      queued: true,
      total_destinatarios: destinatarios.length,
    })
  } catch {
    logServerError('marketing campanas enviar')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// ─── Stats de campaña ─────────────────────────────────────────────────────────

router.get('/campanas/:id/stats', verifyInternal, requireAuth, requirePermissionMiddleware('ver_marketing'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const { id } = req.params

    const campanaRow = await prisma.marketingCampana.findFirst({
      where: { id: parseInt(id, 10), empresa_id: empresaId },
      select: { id: true },
    })
    if (!campanaRow) return res.status(404).json({ error: 'Campaña no encontrada' })

    type StatsRow = { estado: string; total: bigint }
    const statsRows = await prisma.$queryRaw<StatsRow[]>`
      SELECT estado, COUNT(*)::bigint AS total
      FROM marketing_envios
      WHERE campana_id = ${parseInt(id, 10)}
      GROUP BY estado
    `

    const stats: Record<string, number> = {
      pendiente: 0,
      enviado: 0,
      abierto: 0,
      clicked: 0,
      bounced: 0,
      spam: 0,
      error: 0,
    }

    for (const row of statsRows) {
      stats[String(row.estado)] = Number(row.total ?? 0n)
    }

    return res.json({ data: stats })
  } catch {
    logServerError('marketing campanas stats')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.get('/analitica/tracking', verifyInternal, requireAuth, requirePermissionMiddleware('ver_marketing'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: {
        ga4_measurement_id: true,
        meta_pixel_id: true,
        gtm_container_id: true,
      },
    })

    return res.json({
      data: {
        ga4_measurement_id: empresa?.ga4_measurement_id ?? null,
        meta_pixel_id: empresa?.meta_pixel_id ?? null,
        gtm_container_id: empresa?.gtm_container_id ?? null,
      },
    })
  } catch {
    logServerError('marketing tracking get')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.put('/analitica/tracking', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_analitica'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(401).json({ error: 'No autorizado' })

    const { ga4_measurement_id, meta_pixel_id, gtm_container_id } = req.body

    const updateData: Prisma.EmpresaUpdateInput = {}

    // Validación de formato del lado del servidor (defensa en profundidad anti-XSS),
    // espeja la del storefront en platea/components/tenant/tenant-surface-shell.tsx.
    // Un valor vacío/limpiado se permite (deja borrar el tag); un valor no vacío que
    // no matchee su regex → 400.
    const GA4_RE = /^G-[A-Z0-9]{4,20}$/
    const META_PIXEL_RE = /^\d{10,20}$/
    const GTM_RE = /^GTM-[A-Z0-9]{4,10}$/

    if (ga4_measurement_id !== undefined) {
      const val = typeof ga4_measurement_id === 'string' ? ga4_measurement_id.trim() : null
      if (val) {
        if (!GA4_RE.test(val)) return res.status(400).json({ error: 'ga4_measurement_id inválido (formato esperado: G-XXXXXXXXXX)' })
        updateData.ga4_measurement_id = val
      } else {
        updateData.ga4_measurement_id = null
      }
    }

    if (meta_pixel_id !== undefined) {
      const val = typeof meta_pixel_id === 'string' ? meta_pixel_id.trim() : null
      if (val) {
        if (!META_PIXEL_RE.test(val)) return res.status(400).json({ error: 'meta_pixel_id inválido (debe ser un ID numérico de 10 a 20 dígitos)' })
        updateData.meta_pixel_id = val
      } else {
        updateData.meta_pixel_id = null
      }
    }

    if (gtm_container_id !== undefined) {
      const val = typeof gtm_container_id === 'string' ? gtm_container_id.trim() : null
      if (val) {
        if (!GTM_RE.test(val)) return res.status(400).json({ error: 'gtm_container_id inválido (formato esperado: GTM-XXXXXXX)' })
        updateData.gtm_container_id = val
      } else {
        updateData.gtm_container_id = null
      }
    }

    if (Object.keys(updateData).length === 0) return res.status(400).json({ error: 'No se enviaron campos para actualizar' })

    await prisma.empresa.update({
      where: { id: empresaId },
      data: updateData,
    })

    return res.json({ ok: true })
  } catch {
    logServerError('marketing tracking put')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// ─── Google OAuth — GA4 y GTM ─────────────────────────────────────────────────

router.get('/google/auth-url', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_analitica'), async (req: Request, res: Response) => {
  try {
    const empresaId = getActorEmpresaId(req.user!)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    const authUrl = buildGoogleAuthUrl(empresaId)
    return res.json({ authUrl })
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Falta configurar')) {
      return res.status(400).json({ error: error.message })
    }
    logServerError('marketing google auth-url')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.get('/google/callback', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const frontendBase = process.env.FRONTEND_URL ?? 'http://localhost:3000'
  const redirectSuccess = `${frontendBase}/dashboard/marketing/analitica?google_connected=1`
  const redirectError = (reason: string) => `${frontendBase}/dashboard/marketing/analitica?google_error=${encodeURIComponent(reason)}`

  try {
    const { code, state, error: providerError } = req.query as Record<string, string>
    if (providerError) return res.redirect(302, redirectError(providerError))
    if (!code || !state) return res.redirect(302, redirectError('missing_params'))

    const { empresaId: stateEmpresaId } = parseOAuthState(state)
    const empresaId = getActorEmpresaId(req.user!)
    if (!empresaId || empresaId !== stateEmpresaId) {
      return res.redirect(302, redirectError('state_mismatch'))
    }

    const tokens = await exchangeCode(code)
    await saveGoogleConnection(empresaId, {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresIn: tokens.expires_in,
      scope: tokens.scope,
      email: tokens.email,
    })

    return res.redirect(302, redirectSuccess)
  } catch {
    logServerError('marketing google callback')
    return res.redirect(302, redirectError('unexpected_error'))
  }
})

router.get('/google/status', verifyInternal, requireAuth, requirePermissionMiddleware('ver_marketing'), async (req: Request, res: Response) => {
  try {
    const empresaId = getActorEmpresaId(req.user!)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    const conn = await getGoogleConnection(empresaId)
    if (!conn) return res.json({ connected: false })
    return res.json({
      connected: true,
      email: conn.account_email ?? null,
      ga4PropertyId: conn.ga4_property_id ?? null,
      ga4MeasurementId: conn.ga4_measurement_id ?? null,
      gtmAccountId: conn.gtm_account_id ?? null,
      gtmContainerId: conn.gtm_container_id ?? null,
      connectedAt: conn.connected_at ?? null,
      // 'needs_reconnect' cuando el grant fue revocado / el token no se puede descifrar
      status: conn.status ?? null,
    })
  } catch {
    logServerError('marketing google status')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.delete('/google/connection', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_analitica'), async (req: Request, res: Response) => {
  try {
    const empresaId = getActorEmpresaId(req.user!)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    await deleteGoogleConnection(empresaId)
    return res.json({ ok: true })
  } catch {
    logServerError('marketing google connection delete')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.get('/google/ga4-properties', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_analitica'), async (req: Request, res: Response) => {
  try {
    const empresaId = getActorEmpresaId(req.user!)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    const properties = await listGa4Properties(empresaId)
    return res.json({ properties })
  } catch (error) {
    if (error instanceof Error && error.message.includes('No hay conexión')) {
      return res.status(400).json({ error: error.message })
    }
    logServerError('marketing google ga4-properties')
    return res.status(500).json({ error: 'Error al listar propiedades GA4' })
  }
})

router.post('/google/ga4-selection', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_analitica'), async (req: Request, res: Response) => {
  try {
    const empresaId = getActorEmpresaId(req.user!)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    const { propertyId } = req.body
    if (!propertyId) return res.status(400).json({ error: 'propertyId es requerido' })
    const measurementId = await getGa4MeasurementId(empresaId, String(propertyId)) ?? ''
    await saveGa4Selection(empresaId, String(propertyId), measurementId)
    return res.json({ ok: true, measurementId })
  } catch (error) {
    if (error instanceof Error && (error.message.includes('no pertenece') || error.message.includes('measurement-id'))) {
      return res.status(400).json({ error: error.message })
    }
    logServerError('marketing google ga4-selection')
    return res.status(500).json({ error: 'Error al guardar selección GA4' })
  }
})

router.get('/google/gtm-containers', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_analitica'), async (req: Request, res: Response) => {
  try {
    const empresaId = getActorEmpresaId(req.user!)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    const containers = await listGtmContainers(empresaId)
    return res.json({ containers })
  } catch (error) {
    if (error instanceof Error && error.message.includes('No hay conexión')) {
      return res.status(400).json({ error: error.message })
    }
    logServerError('marketing google gtm-containers')
    return res.status(500).json({ error: 'Error al listar contenedores GTM' })
  }
})

router.post('/google/gtm-selection', verifyInternal, requireAuth, requirePermissionMiddleware('gestionar_analitica'), async (req: Request, res: Response) => {
  try {
    const empresaId = getActorEmpresaId(req.user!)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    const { accountId, containerId } = req.body
    if (!accountId || !containerId) {
      return res.status(400).json({ error: 'accountId y containerId son requeridos' })
    }
    await saveGtmSelection(empresaId, String(accountId), String(containerId))
    return res.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && error.message.includes('no pertenece')) {
      return res.status(400).json({ error: error.message })
    }
    logServerError('marketing google gtm-selection')
    return res.status(500).json({ error: 'Error al guardar selección GTM' })
  }
})

// ─── Unsubscribe (opt-out) ────────────────────────────────────────────────────

router.post('/unsubscribe', verifyInternal, async (req: Request, res: Response) => {
  const { token } = req.body
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Token requerido' })
  }

  try {
    const secret = getUnsubscribeSecret()
    const [payload64, sig] = token.split('.')
    if (!payload64 || !sig) return res.status(400).json({ error: 'Token inválido' })

    const expected = createHmac('sha256', secret).update(payload64).digest('base64url')
    const sigBuf = Buffer.from(sig)
    const expectedBuf = Buffer.from(expected)
    if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) {
      return res.status(400).json({ error: 'Token inválido' })
    }

    const { compradorId, empresaId } = JSON.parse(Buffer.from(payload64, 'base64url').toString('utf8'))

    // Validar que empresa_id del token coincida con el registro del comprador.
    // Si no coincide (token de otra empresa o comprador inexistente), igual respondemos 200
    // — no damos información de si el comprador existe o no.
    await prisma.comprador.updateMany({
      where: { id: String(compradorId), empresa_id: String(empresaId) },
      data: { email_marketing_opt_out: true },
    })

    return res.json({ ok: true, message: 'Dado de baja correctamente' })
  } catch {
    return res.status(400).json({ error: 'Token inválido' })
  }
})

// ─── Test Send ────────────────────────────────────────────────────────────────

router.post('/campanas/:id/test-send', verifyInternal, requireAuth, requirePermissionMiddleware('enviar_campanas'), marketingCampanaTestSendRateLimit, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    if (!requireUserType(user, ['empresa', 'empleado'], res, 'No autorizado')) return

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const { email } = req.body
    if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(email))) {
      return res.status(400).json({ error: 'Email de prueba inválido' })
    }

    const campanaId = req.params.id

    type CampanaTestRow = {
      id: number; nombre: string; asunto: string; contenido_html: string
      email_marketing_from: string | null; email_marketing_from_name: string | null
    }
    const campanaRows = await prisma.$queryRaw<CampanaTestRow[]>`
      SELECT mc.id, mc.nombre, mc.asunto, mc.contenido_html,
             em.email_marketing_from, em.email_marketing_from_name
      FROM marketing_campanas mc
      JOIN empresas em ON em.id = mc.empresa_id
      WHERE mc.id = ${parseInt(campanaId, 10)} AND mc.empresa_id = ${empresaId}
    `

    if (!campanaRows[0]) return res.status(404).json({ error: 'Campaña no encontrada' })
    const campana = campanaRows[0]

    if (!resend) {
      return res.status(500).json({ error: 'El servicio de email no está configurado (falta RESEND_API_KEY)' })
    }

    // from: SIEMPRE el sender verificado de TICKETERA; el email de la empresa (si está
    // configurado y es válido) pasa a reply-to. (mismo criterio que runCampanaEnvioAsync)
    const fromName = campana.email_marketing_from_name || null
    const fromHeader = fromName ? `${fromName} <${resendFromEmail}>` : resendFromEmail
    const configuredFrom = campana.email_marketing_from ? String(campana.email_marketing_from).trim() : ''
    const replyTo = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(configuredFrom) ? configuredFrom : null

    // Consistencia con runCampanaEnvioAsync: footer de baja + List-Unsubscribe header.
    // El destinatario de prueba es un email arbitrario (suele ser el de la propia
    // empresa, no un comprador registrado), así que no hay contexto de comprador.
    // Usamos un token con compradorId sentinela ('__test__'): el endpoint /unsubscribe
    // hace un updateMany scopeado por compradorId+empresaId, por lo que un comprador
    // inexistente simplemente no afecta filas (no-op inofensivo).
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000'
    const testToken = buildUnsubscribeToken('__test__', empresaId)
    const unsubscribeUrl = `${frontendUrl}/api/marketing/unsubscribe?token=${testToken}`
    const htmlConFooter =
      renderMarketingEmailHtml(String(campana.contenido_html ?? ''), { nombre: 'Nombre' }) +
      `<p style="text-align:center;color:#999;font-size:12px;margin-top:32px">` +
      `<a href="${unsubscribeUrl}" style="color:#999">Darse de baja</a></p>`

    await resend.emails.send({
      from: fromHeader,
      to: String(email),
      ...(replyTo ? { replyTo } : {}),
      subject: `[TEST] ${String(campana.asunto)}`,
      html: htmlConFooter,
      headers: {
        'List-Unsubscribe': '<' + unsubscribeUrl + '>',
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    })

    return res.json({ ok: true })
  } catch {
    logServerError('marketing campanas test-send')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

export default router
