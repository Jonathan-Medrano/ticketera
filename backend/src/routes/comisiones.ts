import { Router, Request, Response } from 'express'
import { verifyInternal, requireAuth } from '../middleware/auth'
import { getActorEmpresaId, requirePermissionMiddleware } from '../lib/authz'
import { logServerError } from '../lib/safe-log'
import { prisma } from '../lib/prisma'

const router = Router()

const AR_TZ = 'America/Argentina/Buenos_Aires'

function isValidDateInput(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * GET /comisiones
 *
 * Reporte de comisiones REALES por venta para la empresa autenticada: cuánto se
 * cobró bruto, la comisión real de Mercado Pago (capturada del pago), la comisión
 * de TICKETERA y el neto que le queda a la empresa. Cubre dos flujos: entradas
 * (online checkout MP) y consumibles (barra).
 *
 * Fórmula por fila (poblada en el webhook de confirmación de pago, ver
 * backend/src/routes/tenant.ts:1136-1140 entradas / :1011-1014 consumibles):
 *   entradas:    bruto = precio_pagado
 *                comision_ticketera = comision
 *                comision_mp = mp_fee_amount
 *                neto = neto_empresa_amount  (== precio_pagado - comision - mp_fee_amount)
 *   consumibles: bruto = total
 *                comision_ticketera = owner_fee_amount
 *                comision_mp = mp_fee_amount
 *                neto = neto_empresa_amount  (== total - owner_fee_amount - mp_fee_amount)
 *
 * Solo se agregan filas con mp_fee_amount NOT NULL (= la comisión real fue
 * capturada). Las confirmadas ANTES de que se empezara a capturar mp_fee_amount
 * tienen mp_fee_amount NULL y se reportan aparte en `sin_datos` para transparencia,
 * sin contaminar las sumas.
 *
 * Query params:
 *   - desde (YYYY-MM-DD, AR) — default: hace 30 días
 *   - hasta (YYYY-MM-DD, AR) — default: hoy
 * El rango se evalúa sobre created_at proyectado a AR (AT TIME ZONE).
 */
router.get(
  '/',
  verifyInternal,
  requireAuth,
  requirePermissionMiddleware('ver_recaudacion'),
  async (req: Request, res: Response) => {
    try {
      const empresaId = getActorEmpresaId(req.user!)
      if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

      const desdeInput = isValidDateInput(req.query.desde) ? req.query.desde : null
      const hastaInput = isValidDateInput(req.query.hasta) ? req.query.hasta : null

      const today = new Date()
      const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)
      const desde = desdeInput ?? thirtyDaysAgo.toISOString().slice(0, 10)
      const hasta = hastaInput ?? today.toISOString().slice(0, 10)

      // Boundaries de fecha en AR: comparamos created_at proyectado a AR contra el
      // rango [desde, hasta] inclusive (DATE(...) >= desde AND DATE(...) <= hasta).
      // Solo ventas confirmadas/pagas: entradas estado <> 'cancelada',
      // consumibles estado <> 'cancelado' (pendiente/canjeado/resuelto_parcial cuentan
      // como vendidas, igual que el resto del reporting — ver dashboard.ts / ventas.ts).
      const params = [empresaId, desde, hasta] as const

      const [entradasRows, consumiblesRows, porEventoRows] = await Promise.all([
        // Totales de entradas (solo filas con mp_fee_amount capturado)
        prisma.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT
             COUNT(*) FILTER (WHERE en.mp_fee_amount IS NOT NULL)                       AS cantidad,
             COALESCE(SUM(en.precio_pagado) FILTER (WHERE en.mp_fee_amount IS NOT NULL), 0)     AS bruto,
             COALESCE(SUM(en.mp_fee_amount), 0)                                          AS comision_mp,
             COALESCE(SUM(en.comision) FILTER (WHERE en.mp_fee_amount IS NOT NULL), 0)   AS comision_ticketera,
             COALESCE(SUM(en.neto_empresa_amount), 0)                                    AS neto,
             COUNT(*) FILTER (WHERE en.mp_fee_amount IS NULL)                            AS sin_datos_cantidad,
             COALESCE(SUM(en.precio_pagado) FILTER (WHERE en.mp_fee_amount IS NULL), 0)  AS sin_datos_bruto
           FROM entradas en
           JOIN eventos ev ON ev.id = en.evento_id
           WHERE ev.empresa_id = $1
             AND en.estado <> 'cancelada'
             AND DATE(en.created_at AT TIME ZONE '${AR_TZ}') >= $2::date
             AND DATE(en.created_at AT TIME ZONE '${AR_TZ}') <= $3::date`,
          ...params,
        ),
        // Totales de consumibles (solo filas con mp_fee_amount capturado)
        prisma.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT
             COUNT(*) FILTER (WHERE cv.mp_fee_amount IS NOT NULL)                        AS cantidad,
             COALESCE(SUM(cv.total) FILTER (WHERE cv.mp_fee_amount IS NOT NULL), 0)              AS bruto,
             COALESCE(SUM(cv.mp_fee_amount), 0)                                          AS comision_mp,
             COALESCE(SUM(cv.owner_fee_amount) FILTER (WHERE cv.mp_fee_amount IS NOT NULL), 0)   AS comision_ticketera,
             COALESCE(SUM(cv.neto_empresa_amount), 0)                                    AS neto,
             COUNT(*) FILTER (WHERE cv.mp_fee_amount IS NULL)                            AS sin_datos_cantidad,
             COALESCE(SUM(cv.total) FILTER (WHERE cv.mp_fee_amount IS NULL), 0)          AS sin_datos_bruto
           FROM consumibles_ventas cv
           JOIN eventos ev ON ev.id = cv.evento_id
           WHERE ev.empresa_id = $1
             AND cv.estado <> 'cancelado'
             AND DATE(cv.created_at AT TIME ZONE '${AR_TZ}') >= $2::date
             AND DATE(cv.created_at AT TIME ZONE '${AR_TZ}') <= $3::date`,
          ...params,
        ),
        // Desglose por evento (entradas + consumibles unificados), solo filas con dato
        prisma.$queryRawUnsafe<Record<string, unknown>[]>(
          `SELECT
             ev.id                                   AS evento_id,
             ev.nombre                               AS nombre,
             COALESCE(SUM(t.bruto), 0)               AS bruto,
             COALESCE(SUM(t.comision_mp), 0)         AS comision_mp,
             COALESCE(SUM(t.comision_ticketera), 0)   AS comision_ticketera,
             COALESCE(SUM(t.neto), 0)                AS neto,
             COALESCE(SUM(t.cantidad), 0)            AS cantidad
           FROM eventos ev
           JOIN (
             SELECT en.evento_id AS evento_id,
                    en.precio_pagado AS bruto,
                    en.mp_fee_amount AS comision_mp,
                    en.comision AS comision_ticketera,
                    en.neto_empresa_amount AS neto,
                    1 AS cantidad
             FROM entradas en
             WHERE en.estado <> 'cancelada'
               AND en.mp_fee_amount IS NOT NULL
               AND DATE(en.created_at AT TIME ZONE '${AR_TZ}') >= $2::date
               AND DATE(en.created_at AT TIME ZONE '${AR_TZ}') <= $3::date
             UNION ALL
             SELECT cv.evento_id AS evento_id,
                    cv.total AS bruto,
                    cv.mp_fee_amount AS comision_mp,
                    cv.owner_fee_amount AS comision_ticketera,
                    cv.neto_empresa_amount AS neto,
                    1 AS cantidad
             FROM consumibles_ventas cv
             WHERE cv.estado <> 'cancelado'
               AND cv.mp_fee_amount IS NOT NULL
               AND DATE(cv.created_at AT TIME ZONE '${AR_TZ}') >= $2::date
               AND DATE(cv.created_at AT TIME ZONE '${AR_TZ}') <= $3::date
           ) t ON t.evento_id = ev.id
           WHERE ev.empresa_id = $1
           GROUP BY ev.id, ev.nombre
           ORDER BY bruto DESC`,
          ...params,
        ),
      ])

      const ent = entradasRows[0] ?? {}
      const con = consumiblesRows[0] ?? {}

      const entradas = {
        bruto: num(ent.bruto),
        comision_mp: num(ent.comision_mp),
        comision_ticketera: num(ent.comision_ticketera),
        neto: num(ent.neto),
        cantidad: num(ent.cantidad),
      }
      const consumibles = {
        bruto: num(con.bruto),
        comision_mp: num(con.comision_mp),
        comision_ticketera: num(con.comision_ticketera),
        neto: num(con.neto),
        cantidad: num(con.cantidad),
      }

      const totales = {
        bruto: entradas.bruto + consumibles.bruto,
        comision_mp: entradas.comision_mp + consumibles.comision_mp,
        comision_ticketera: entradas.comision_ticketera + consumibles.comision_ticketera,
        neto: entradas.neto + consumibles.neto,
      }

      const sin_datos = {
        cantidad: num(ent.sin_datos_cantidad) + num(con.sin_datos_cantidad),
        monto_bruto: num(ent.sin_datos_bruto) + num(con.sin_datos_bruto),
      }

      const por_evento = porEventoRows.map((r) => ({
        evento_id: String(r.evento_id),
        nombre: String(r.nombre ?? ''),
        bruto: num(r.bruto),
        comision_mp: num(r.comision_mp),
        comision_ticketera: num(r.comision_ticketera),
        neto: num(r.neto),
        cantidad: num(r.cantidad),
      }))

      return res.json({
        data: {
          desde,
          hasta,
          totales,
          por_flujo: { entradas, consumibles },
          por_evento,
          sin_datos,
        },
      })
    } catch (err) {
      logServerError('comisiones reporte', err)
      return res.status(500).json({ error: 'Error interno del servidor' })
    }
  },
)

export default router
