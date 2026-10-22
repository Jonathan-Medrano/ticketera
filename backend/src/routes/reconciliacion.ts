import { Router, Request, Response } from 'express'
import { randomUUID } from 'node:crypto'
import { verifyInternal, requireAuth } from '../middleware/auth'
import { prisma, prismaDirectUrl } from '../lib/prisma'
import { getActorEmpresaId, requirePermissionMiddleware } from '../lib/authz'
import { logServerError } from '../lib/safe-log'
import { safeMsg } from '../lib/http-error'
import { executeMercadoPagoRefund } from '../lib/mp-refund'
import { actorFromRequest, logAuditEvent } from '../lib/audit-log'
import { dispatchHadAnySuccess, markDeliveryFailed, markDeliverySucceeded } from '../lib/delivery-retry'
import { generateSecureShortCode } from '../lib/secure-code'
import {
  dispatchBuyerPurchaseDelivery,
  distributeMarketplaceFeeByEntry,
  isDuplicateEntryError,
  parseCheckoutSessionData,
  type CheckoutItem,
  type CheckoutSessionRow,
  type DeliveryEntryReceipt,
} from './tenant'

const router = Router()

const DEFAULT_PAGE_SIZE = 25
const HARD_LIMIT = 100

type ReconciliacionQuery = {
  page: number
  pageSize: number
  estado: string // 'pendiente' | 'reembolsado' | 'todos'
  evento_id: string
  desde: string
  hasta: string
  busqueda: string
  sortBy: string
  sortDir: string
}

function readQuery(req: Request): ReconciliacionQuery {
  const page = Math.max(1, Number(req.query.page) || 1)
  const requestedPageSize = Number(req.query.pageSize) || DEFAULT_PAGE_SIZE
  const fechaRegex = /^\d{4}-\d{2}-\d{2}$/

  return {
    page,
    pageSize: Math.min(HARD_LIMIT, Math.max(1, requestedPageSize)),
    estado: typeof req.query.estado === 'string' ? req.query.estado.trim() : 'pendiente',
    evento_id: typeof req.query.evento_id === 'string' ? req.query.evento_id.trim() : '',
    desde: typeof req.query.desde === 'string' && fechaRegex.test(req.query.desde) ? req.query.desde : '',
    hasta: typeof req.query.hasta === 'string' && fechaRegex.test(req.query.hasta) ? req.query.hasta : '',
    busqueda: typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : '',
    sortBy: typeof req.query.sortBy === 'string' && ['created_at', 'comprador_nombre', 'amount_total'].includes(req.query.sortBy) ? req.query.sortBy : 'created_at',
    sortDir: req.query.sortDir === 'asc' ? 'asc' : 'desc',
  }
}

/**
 * Suma (precio × cantidad) de los items de un blob `datos` (checkout_sessions.datos
 * es TEXT con JSON). Tolerante a JSON malformado: si no parsea, devuelve 0.
 * Misma lógica que el enriquecido per-row de `pagos-sin-emitir`.
 */
function sumItemsAmount(datosRaw: unknown): number {
  try {
    const datos = typeof datosRaw === 'string' ? JSON.parse(datosRaw) : datosRaw
    const items = Array.isArray(datos?.items) ? datos.items : []
    return items.reduce((acc: number, item: { precio?: unknown; cantidad?: unknown }) => {
      const precio = Number(item?.precio ?? 0)
      const cantidad = Number(item?.cantidad ?? 0)
      return acc + (Number.isFinite(precio) && Number.isFinite(cantidad) ? precio * cantidad : 0)
    }, 0)
  } catch {
    return 0
  }
}

/**
 * GET /reconciliacion/pagos-sin-emitir
 *
 * Lista los casos donde MP aprobó un pago pero la entrada NO se emitió:
 *
 *   1. reconciliation_note='approved_after_expiry' — el webhook llegó pero la
 *      sesión ya estaba expirada (15min sin confirmar). El stock se devolvió
 *      al pool, MP cobró, pero no hay entrada en DB.
 *
 *   2. Sesiones con payment_id pero estado != 'confirmada' — flujo half-baked
 *      (raro, normalmente captura el caso 1).
 *
 * Filtros opcionales:
 *   - estado: 'pendiente' (default, sin acción tomada) | 'reembolsado' (refund_status='completed') | 'todos'
 *   - evento_id: filtrar por evento
 *   - desde/hasta: rango de fechas de creación de la sesión
 *   - busqueda: nombre o email del comprador
 *
 * Devuelve datos suficientes para que el operador decida la acción.
 */
router.get(
  '/pagos-sin-emitir',
  verifyInternal,
  requireAuth,
  requirePermissionMiddleware('ver_recaudacion'),
  async (req: Request, res: Response) => {
    try {
      const empresaId = getActorEmpresaId(req.user!)
      if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

      const q = readQuery(req)

      // Build Postgres positional params for dynamic WHERE
      const pgFiltros: string[] = ['cs.empresa_id = $1']
      const pgValores: unknown[] = [empresaId]
      let pgIdx = 2

      // Criterio principal
      pgFiltros.push(`(
        cs.reconciliation_note = 'approved_after_expiry'
        OR cs.reconciliation_note = 'emitted_manually'
        OR (cs.payment_id IS NOT NULL AND cs.estado <> 'confirmada' AND cs.estado <> 'cancelada')
        OR cs.delivery_status = 'abandoned'
      )`)

      if (q.estado === 'pendiente') {
        pgFiltros.push(
          `(cs.refund_status IS NULL OR cs.refund_status IN ('failed', 'pending')) AND cs.estado <> 'confirmada'`,
        )
      } else if (q.estado === 'reembolsado') {
        pgFiltros.push(`cs.refund_status = 'completed'`)
      } else if (q.estado === 'emitido') {
        pgFiltros.push(`cs.estado = 'confirmada' AND cs.reconciliation_note = 'emitted_manually'`)
      } else if (q.estado === 'notificacion_fallida') {
        pgFiltros.push(`cs.delivery_status = 'abandoned'`)
      }

      if (q.evento_id) {
        pgFiltros.push(`cs.datos::text ILIKE $${pgIdx}`)
        pgValores.push(`%"eventoId":"${q.evento_id}"%`)
        pgIdx++
      }

      if (q.desde) {
        pgFiltros.push(`DATE(cs.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') >= $${pgIdx}`)
        pgValores.push(q.desde)
        pgIdx++
      }

      if (q.hasta) {
        pgFiltros.push(`DATE(cs.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') <= $${pgIdx}`)
        pgValores.push(q.hasta)
        pgIdx++
      }

      if (q.busqueda) {
        pgFiltros.push(`(c.nombre ILIKE $${pgIdx} OR c.email ILIKE $${pgIdx})`)
        pgValores.push(`%${q.busqueda}%`)
        pgIdx++
      }

      const pgWhereClause = pgFiltros.join(' AND ')

      const totalPages_preCalc = (total_: number) => Math.max(1, Math.ceil(total_ / q.pageSize))

      const [countRows, pendientesRows] = await Promise.all([
        prisma.$queryRawUnsafe<{ total: bigint }[]>(
          `SELECT COUNT(*) AS total
           FROM checkout_sessions cs
           LEFT JOIN compradores c ON c.id = cs.comprador_id
           WHERE ${pgWhereClause}`,
          ...pgValores,
        ),
        // Trae los `datos` de TODOS los pendientes (set chico por naturaleza: son casos
        // excepcionales). Sumamos el monto en JS reusando el parser tolerante a JSON
        // malformado — castear datos::jsonb en SQL haría 500 ante una sola fila inválida.
        prisma.$queryRawUnsafe<{ datos: string }[]>(
          `SELECT cs.datos
           FROM checkout_sessions cs
           WHERE cs.empresa_id = $1
             AND cs.estado <> 'confirmada'
             AND cs.estado <> 'cancelada'
             AND (
               cs.reconciliation_note = 'approved_after_expiry'
               OR cs.payment_id IS NOT NULL
             )
             AND (cs.refund_status IS NULL OR cs.refund_status IN ('failed', 'pending'))`,
          empresaId,
        ),
      ])
      const total = Number(countRows[0]?.total ?? 0n)
      const totalPendientes = pendientesRows.length
      const montoPendiente = roundMoney(
        pendientesRows.reduce((acc, row) => acc + sumItemsAmount(row.datos), 0),
      )

      const totalPages = totalPages_preCalc(total)
      const currentPage = Math.min(q.page, totalPages)
      const offset = (currentPage - 1) * q.pageSize

      // sortBy 'amount_total' no es sortable en SQL (viene de JSON parsing) — fallback a created_at
      const sortDir = q.sortDir === 'asc' ? 'ASC' : 'DESC'
      const sortColumn = q.sortBy === 'comprador_nombre' ? 'c.nombre' : 'cs.created_at'

      const pgLimitIdx = pgIdx
      const pgOffsetIdx = pgIdx + 1
      const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT
           cs.id, cs.created_at, cs.expires_at,
           cs.payment_id, cs.payment_status,
           cs.reconciliation_status, cs.reconciliation_note,
           cs.refund_status, cs.refund_provider_id, cs.refund_amount,
           cs.refund_initiated_at, cs.refund_completed_at,
           cs.refund_initiated_by, cs.refund_error, cs.refund_reason,
           cs.delivery_status, cs.delivery_retry_count, cs.delivery_last_error,
           cs.delivery_next_attempt_at, cs.delivery_completed_at,
           cs.estado AS session_estado,
           cs.datos,
           c.id AS comprador_id,
           c.nombre AS comprador_nombre,
           c.email AS comprador_email,
           c.dni AS comprador_dni
         FROM checkout_sessions cs
         LEFT JOIN compradores c ON c.id = cs.comprador_id
         WHERE ${pgWhereClause}
         ORDER BY ${sortColumn} ${sortDir}
         LIMIT $${pgLimitIdx} OFFSET $${pgOffsetIdx}`,
        ...pgValores, q.pageSize, offset,
      )

      // Derivar evento_id + evento_nombre + amount_total de cs.datos JSON
      // ya que checkout_sessions no tiene esas columnas directas (todo vive en datos JSON).
      const enrichedRows = rows.map((row) => {
        let evento_id: string | null = null
        let evento_nombre: string | null = null
        let amount_total: number | null = null
        try {
          const datos = typeof row.datos === 'string' ? JSON.parse(row.datos) : row.datos
          const items = Array.isArray(datos?.items) ? datos.items : []
          const firstItem = items[0]
          if (firstItem) {
            evento_id = firstItem.eventoId ?? null
            evento_nombre = firstItem.eventoNombre ?? null
          }
          // Total = suma de (precio × cantidad) de cada item
          amount_total = items.reduce((acc: number, item: { precio?: unknown; cantidad?: unknown }) => {
            const precio = Number(item?.precio ?? 0)
            const cantidad = Number(item?.cantidad ?? 0)
            return acc + (Number.isFinite(precio) && Number.isFinite(cantidad) ? precio * cantidad : 0)
          }, 0)
        } catch {
          // datos no parseable — devolvemos null
        }
        const { datos: _datos, ...rest } = row
        void _datos
        return { ...rest, evento_id, evento_nombre, amount_total }
      })

      // Lista de eventos del empresa (para filtro)
      const eventos = await prisma.$queryRawUnsafe<{ id: string; nombre: string }[]>(
        `SELECT id, nombre FROM eventos WHERE empresa_id = $1 ORDER BY nombre ASC`,
        empresaId,
      )

      return res.json({
        data: {
          casos: enrichedRows,
          eventos,
          totalPendientes,
          montoPendiente,
        },
        pagination: {
          page: currentPage,
          pageSize: q.pageSize,
          total,
          totalPages,
        },
      })
    } catch {
      logServerError('reconciliacion pagos-sin-emitir')
      return res.status(500).json({ error: 'Error interno del servidor' })
    }
  },
)

/**
 * GET /reconciliacion/resumen
 *
 * Contador ligero usado por el badge del dashboard resumen. Devuelve solo
 * el count de pagos pendientes — query optimizada vs el endpoint completo.
 */
router.get(
  '/resumen',
  verifyInternal,
  requireAuth,
  requirePermissionMiddleware('ver_recaudacion'),
  async (req: Request, res: Response) => {
    try {
      const empresaId = getActorEmpresaId(req.user!)
      if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

      const rows = await prisma.$queryRawUnsafe<{ total: bigint }[]>(
        `SELECT COUNT(*) AS total
         FROM checkout_sessions
         WHERE empresa_id = $1
           AND estado <> 'confirmada'
           AND estado <> 'cancelada'
           AND (
             reconciliation_note = 'approved_after_expiry'
             OR payment_id IS NOT NULL
           )
           AND (refund_status IS NULL OR refund_status IN ('failed', 'pending'))`,
        empresaId,
      )

      return res.json({ data: { totalPendientes: Number(rows[0]?.total ?? 0n) } })
    } catch {
      logServerError('reconciliacion resumen')
      return res.status(500).json({ error: 'Error interno del servidor' })
    }
  },
)

type ReembolsoBody = {
  amount: number
  reason: string
}

function readReembolsoBody(body: unknown): ReembolsoBody | null {
  if (!body || typeof body !== 'object') return null
  const rec = body as Record<string, unknown>
  const amount = Number(rec.amount)
  if (!Number.isFinite(amount) || amount <= 0) return null
  const reason = typeof rec.reason === 'string' ? rec.reason.trim() : ''
  if (!reason) return null
  return { amount, reason }
}

/**
 * POST /reconciliacion/:sessionId/reembolsar
 *
 * Ejecuta refund automático vía Mercado Pago para un checkout_session que tiene
 * payment_id pero no se emitió entrada. Idempotente — si el caller manda 2x,
 * MP reconoce el idempotency_key y NO duplica el refund.
 *
 * Flujo:
 *   1. Valida que el caso es candidato a refund (payment_id + sin entrada emitida + sin refund completo)
 *   2. Genera idempotency_key (UUID) y lo persiste ANTES de llamar a MP
 *   3. Marca refund_status='pending'
 *   4. Llama a MP API
 *   5. Updatea refund_status='completed' o 'failed' según resultado
 *   6. Audit log + response
 *
 * Si el server cae entre paso 2 y 4, el caller puede reintentar usando el mismo
 * key persistido — MP devuelve el mismo refund sin duplicar.
 */
router.post(
  '/:sessionId/reembolsar',
  verifyInternal,
  requireAuth,
  requirePermissionMiddleware('gestionar_reembolsos'),
  async (req: Request, res: Response) => {
    const sessionId = req.params.sessionId
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'sessionId inválido' })
    }

    const empresaId = getActorEmpresaId(req.user!)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const body = readReembolsoBody(req.body)
    if (!body) {
      return res.status(400).json({ error: 'Body inválido. Requiere amount > 0 y reason no vacía.' })
    }

    try {
      const rows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT id, empresa_id, payment_id, datos, estado,
                reconciliation_note, refund_status, refund_idempotency_key,
                refund_provider_id
         FROM checkout_sessions
         WHERE id = $1 AND empresa_id = $2
         LIMIT 1`,
        sessionId, empresaId,
      )
      const session = rows[0]

      if (!session) {
        return res.status(404).json({ error: 'Sesión no encontrada' })
      }

      if (!session.payment_id) {
        return res.status(409).json({ error: 'La sesión no tiene un payment_id asociado — no hay nada que reembolsar.' })
      }

      if (session.refund_status === 'completed') {
        return res.status(409).json({
          error: 'Este pago ya fue reembolsado',
          data: { refundProviderId: session.refund_provider_id },
        })
      }

      // Validar que efectivamente es un caso de reconciliación.
      // Esto previene que alguien use este endpoint para reembolsar sesiones confirmadas
      // normales (que tienen entradas emitidas y deberían pasar por refund-manual).
      const esCandidato =
        session.reconciliation_note === 'approved_after_expiry' ||
        (session.estado !== 'confirmada' && session.estado !== 'cancelada')
      if (!esCandidato) {
        return res.status(409).json({
          error: 'Este pago no califica como caso de reconciliación. Usá el flujo de Reembolsos.',
        })
      }

      // Derivar amount_total del JSON datos (no es columna directa de checkout_sessions)
      const requestedAmount = Number(body.amount)
      let expectedAmount = 0
      try {
        const datos = typeof session.datos === 'string' ? JSON.parse(session.datos) : session.datos
        const items = Array.isArray(datos?.items) ? datos.items : []
        expectedAmount = items.reduce((acc: number, item: { precio?: unknown; cantidad?: unknown }) => {
          const precio = Number(item?.precio ?? 0)
          const cantidad = Number(item?.cantidad ?? 0)
          return acc + (Number.isFinite(precio) && Number.isFinite(cantidad) ? precio * cantidad : 0)
        }, 0)
      } catch {
        return res.status(500).json({ error: 'No se pudo parsear los datos de la sesión.' })
      }
      if (!Number.isFinite(expectedAmount) || expectedAmount <= 0) {
        return res.status(409).json({ error: 'La sesión no tiene un monto válido en sus items.' })
      }
      if (Math.abs(requestedAmount - expectedAmount) > 0.01) {
        return res.status(400).json({
          error: `El monto a reembolsar ($${requestedAmount.toFixed(2)}) no coincide con el de la sesión ($${expectedAmount.toFixed(2)}).`,
        })
      }

      // Reusar idempotency_key existente si ya intentamos antes; sino generar uno nuevo.
      // Esto es CRÍTICO para que un reintento no duplique el refund en MP.
      const idempotencyKey =
        typeof session.refund_idempotency_key === 'string' && session.refund_idempotency_key
          ? session.refund_idempotency_key
          : `recon-${sessionId}-${randomUUID()}`

      const actor = req.user!
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const actorAsRecord = actor as any
      const actorUserId = String(actorAsRecord.id ?? '') || null
      const actorName =
        (typeof actorAsRecord.nombre === 'string' && actorAsRecord.nombre.trim()) ||
        (typeof actorAsRecord.email === 'string' && actorAsRecord.email.trim()) ||
        null

      // 1. Persistir intento ANTES de llamar a MP (idempotency_key + status pending)
      await prisma.$executeRawUnsafe(
        `UPDATE checkout_sessions
         SET refund_status = 'pending',
             refund_idempotency_key = $1,
             refund_initiated_at = COALESCE(refund_initiated_at, NOW()),
             refund_initiated_by = $2,
             refund_amount = $3,
             refund_reason = $4,
             refund_error = NULL
         WHERE id = $5`,
        idempotencyKey, actorUserId, requestedAmount, body.reason, sessionId,
      )

      // 2. Llamar a MP
      const result = await executeMercadoPagoRefund({
        empresaId: String(empresaId),
        paymentId: String(session.payment_id),
        idempotencyKey,
        refundAmount: requestedAmount,
      })

      if (!result.ok) {
        // Marcar como failed pero CONSERVAR el idempotency_key — los retries lo usan
        await prisma.$executeRawUnsafe(
          `UPDATE checkout_sessions
           SET refund_status = 'failed',
               refund_error = $1
           WHERE id = $2`,
          result.error.slice(0, 500), sessionId,
        )

        await logAuditEvent({
          actor: actorFromRequest(req),
          action: 'reconciliacion.refund_failed',
          entityType: 'checkout_session',
          entityId: sessionId,
          entityLabel: String(session.payment_id),
          payload: {
            reason: result.reason,
            error_message: result.error,
            amount: requestedAmount,
            user_reason: body.reason,
          },
        })

        return res.status(result.httpStatus).json({ error: result.error, code: result.reason })
      }

      // 3. Success — guardar refund_provider_id + completed_at
      await prisma.$executeRawUnsafe(
        `UPDATE checkout_sessions
         SET refund_status = 'completed',
             refund_provider_id = $1,
             refund_completed_at = NOW(),
             refund_amount = COALESCE($2, refund_amount),
             refund_error = NULL
         WHERE id = $3`,
        result.refundProviderId, result.refundedAmount, sessionId,
      )

      await logAuditEvent({
        actor: actorFromRequest(req),
        action: 'reconciliacion.refund_completed',
        entityType: 'checkout_session',
        entityId: sessionId,
        entityLabel: String(session.payment_id),
        payload: {
          refund_provider_id: result.refundProviderId,
          refund_status: result.refundStatus,
          refunded_amount: result.refundedAmount,
          user_reason: body.reason,
          actor_name: actorName,
        },
      })

      return res.json({
        data: {
          refundStatus: 'completed',
          refundProviderId: result.refundProviderId,
          refundedAmount: result.refundedAmount,
        },
      })
    } catch {
      logServerError('reconciliacion reembolsar')
      return res.status(500).json({ error: 'Error interno del servidor' })
    }
  },
)

type EmitirBody = {
  reason: string
  forceWithoutStock: boolean
}

function readEmitirBody(body: unknown): EmitirBody | null {
  if (!body || typeof body !== 'object') return null
  const rec = body as Record<string, unknown>
  const reason = typeof rec.reason === 'string' ? rec.reason.trim() : ''
  if (!reason || reason.length < 5) return null
  return {
    reason,
    forceWithoutStock: rec.forceWithoutStock === true,
  }
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * POST /reconciliacion/:sessionId/emitir-manual
 *
 * Emite las entradas que NO fueron emitidas en su momento (porque la sesión
 * expiró, el webhook nunca llegó, etc.) leyendo los items originales de
 * checkout_sessions.datos.
 *
 * Reglas:
 *   - Solo aplica a sesiones con reconciliation_note='approved_after_expiry'
 *     o casos similares (pago aprobado pero sesión sin confirmar).
 *   - Por default INTENTA descontar el stock (el cleanup job lo devolvió).
 *     Si no alcanza: 409. El operador puede tildar forceWithoutStock=true
 *     para sobrevender conscientemente.
 *   - Solo soporta flow='entradas'. Consumibles requiere flujo dedicado.
 *   - Idempotente: si la sesión ya está confirmada, devuelve 409 con la info.
 *
 * Todo dentro de una transacción — atómico: emite todas las entradas o
 * ninguna (rollback en caso de error).
 */
router.post(
  '/:sessionId/emitir-manual',
  verifyInternal,
  requireAuth,
  requirePermissionMiddleware('gestionar_reembolsos'),
  async (req: Request, res: Response) => {
    const sessionId = req.params.sessionId
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'sessionId inválido' })
    }

    const empresaId = getActorEmpresaId(req.user!)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const body = readEmitirBody(req.body)
    if (!body) {
      return res.status(400).json({
        error: 'Body inválido. Requiere reason (mínimo 5 caracteres). forceWithoutStock opcional (boolean).',
      })
    }

    const actor = req.user!
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const actorAsRecord = actor as any
    const actorName =
      (typeof actorAsRecord.nombre === 'string' && actorAsRecord.nombre.trim()) ||
      (typeof actorAsRecord.email === 'string' && actorAsRecord.email.trim()) ||
      null

    // ─── Strategy A: prismaDirectUrl.$transaction with FOR UPDATE ───────────
    // MUST use direct port 5432 — PgBouncer transaction mode is incompatible
    // with session-scoped FOR UPDATE row locks.
    // ─────────────────────────────────────────────────────────────────────────

    type EntryToCreate = {
      eventoId: string
      categoriaId: string
      fechaId: string | null
      precio: number
      comision: number
      mpFeeAmount: number
      nombre: string | null
      apellido: string | null
      dni: string | null
    }

    // Prepare mutable results captured inside the transaction
    let txInserted: string[] = []
    let txFlow: string = 'entradas'
    let txSession: Record<string, unknown> | null = null

    try {
      await prismaDirectUrl.$transaction(async (tx) => {
        // 1. Lock + validate session (FOR UPDATE — serializes concurrent emitir calls)
        const sessionRows = await tx.$queryRaw<Record<string, unknown>[]>`
          SELECT id, empresa_id, comprador_id, payment_id, payment_status,
                 estado, reconciliation_note, refund_status, datos, revendedor_id
          FROM checkout_sessions
          WHERE id = ${sessionId} AND empresa_id = ${empresaId}
          LIMIT 1
          FOR UPDATE`

        const session = sessionRows[0] ?? null

        if (!session) {
          throw Object.assign(new Error('Sesión no encontrada'), { httpStatus: 404 })
        }

        // Idempotency guard: if already emitted return early
        if (session.estado === 'confirmada') {
          throw Object.assign(new Error('La sesión ya está confirmada — las entradas ya fueron emitidas'), { httpStatus: 409 })
        }

        if (session.refund_status === 'completed') {
          throw Object.assign(new Error('Este pago fue reembolsado. No se puede emitir entrada.'), { httpStatus: 409 })
        }

        const esCandidato =
          session.reconciliation_note === 'approved_after_expiry' ||
          (session.payment_id && session.estado !== 'confirmada' && session.estado !== 'cancelada')
        if (!esCandidato) {
          throw Object.assign(new Error('Esta sesión no califica para emisión manual de reconciliación.'), { httpStatus: 409 })
        }

        if (!session.comprador_id) {
          throw Object.assign(new Error('La sesión no tiene un comprador asociado.'), { httpStatus: 409 })
        }

        txSession = session

        // 2. Parse session data + validate flow
        const sessionData = parseCheckoutSessionData(session.datos as string)
        const flow = sessionData.flow ?? 'entradas'
        txFlow = flow

        // 'mixto' (Fase 3) tampoco está soportado acá todavía — mismo motivo que
        // 'consumibles': la sesión no tiene una lista `.items` única y requeriría
        // separar entradas/consumibles + sus dos fee snapshots. Tratar como refund.
        if (sessionData.flow === 'consumibles' || sessionData.flow === 'mixto') {
          throw Object.assign(new Error('Emisión manual de consumibles/mixto no soportada todavía. Tratá como refund.'), { httpStatus: 409 })
        }

        const items = sessionData.items as CheckoutItem[]
        if (!items.length) {
          throw Object.assign(new Error('La sesión no tiene items para emitir.'), { httpStatus: 409 })
        }

        // Distribuir la marketplace_fee tal cual estaba en la sesión original. Esto NO re-cobra
        // nada — MP ya cobró cuando aprobó el pago. Solo refleja en la tabla `entradas`
        // qué pasó: cuánto comisión le tocó a cada entrada para mantener consistencia con
        // reportes / liquidación. mp_fee_amount queda en 0 porque no tenemos esa info en
        // la sesión (vendría del payment de MP que ya pasó).
        const originalMarketplaceFee = Number(sessionData.marketplaceFee?.amount ?? 0)
        const feePerEntry = distributeMarketplaceFeeByEntry(items, originalMarketplaceFee)

        // Construir lista plana de entradas (expandiendo cantidad)
        const toCreate: EntryToCreate[] = []
        let entryIndex = 0
        for (const item of items) {
          const cantidad = Number(item.cantidad) || 0
          for (let i = 0; i < cantidad; i += 1) {
            toCreate.push({
              eventoId: String(item.eventoId),
              categoriaId: String(item.categoriaId),
              fechaId: item.fechaId ?? null,
              precio: roundMoney(Number(item.precio)),
              comision: roundMoney(feePerEntry[entryIndex] ?? 0),
              mpFeeAmount: 0,
              nombre: item.datos?.nombre ?? null,
              apellido: item.datos?.apellido ?? null,
              dni: item.datos?.dni ?? null,
            })
            entryIndex += 1
          }
        }

        if (toCreate.length === 0) {
          throw Object.assign(new Error('No hay entradas que emitir (cantidad total = 0).'), { httpStatus: 409 })
        }

        // 3b. Calcular comisión revendedor (si aplica) — igual que confirmarPagoLogic en tenant.ts
        let revendedorComisionPct = 0
        const sessionRevendedorId = (session.revendedor_id as string | null) ?? null
        if (sessionRevendedorId) {
          const revRows = await tx.$queryRaw<{ porcentaje_comision: number }[]>`
            SELECT porcentaje_comision
            FROM usuarios
            WHERE id = ${sessionRevendedorId}
              AND empresa_id = ${String(empresaId)}
              AND rol = 'revendedor'
            LIMIT 1`
          revendedorComisionPct = Number(revRows[0]?.porcentaje_comision ?? 0)
        }

        // 4. Stock decrement (FOR UPDATE per category — serializes stock changes)
        if (!body.forceWithoutStock) {
          const decrementsPorCategoria = new Map<string, number>()
          for (const entry of toCreate) {
            decrementsPorCategoria.set(
              entry.categoriaId,
              (decrementsPorCategoria.get(entry.categoriaId) ?? 0) + 1,
            )
          }

          for (const [categoriaId, cantidad] of decrementsPorCategoria) {
            const stockRows = await tx.$queryRaw<{ id: string; stock: number; stock_disponible: number }[]>`
              SELECT id, stock, stock_disponible
              FROM entrada_categorias
              WHERE id = ${categoriaId}
              FOR UPDATE`
            const cat = stockRows[0]
            if (!cat) {
              throw Object.assign(new Error(`Categoría ${categoriaId} no encontrada.`), { httpStatus: 409 })
            }

            const disponible = Number(cat.stock_disponible ?? 0)
            if (disponible < cantidad) {
              throw Object.assign(
                Object.assign(new Error(`Stock insuficiente en categoría (disponible ${disponible}, necesario ${cantidad}). Tildá "forzar sin stock" si querés sobrevender.`), {
                  httpStatus: 409,
                  code: 'insufficient_stock',
                  categoriaId,
                  disponible,
                  necesario: cantidad,
                }),
              )
            }

            await tx.$executeRaw`
              UPDATE entrada_categorias
              SET stock_disponible = stock_disponible - ${cantidad}
              WHERE id = ${categoriaId}`
          }
        }

        // 5. INSERT entradas (con retry loop para clave_corta única)
        const inserted: string[] = []
        for (const entry of toCreate) {
          let lastErr: unknown = null
          let success = false
          const sessionRevendedorIdForInsert = (session.revendedor_id as string | null) ?? null

          for (let attempt = 0; attempt < 10; attempt += 1) {
            const entradaId = randomUUID()
            const qrCode = randomUUID()
            const claveCorta = generateSecureShortCode()

            const comisionRevendedor = sessionRevendedorIdForInsert
              ? roundMoney((entry.precio * revendedorComisionPct) / 100)
              : 0
            const netoEmpresaAmount = roundMoney(entry.precio - entry.comision - entry.mpFeeAmount)

            try {
              await tx.$executeRaw`
                INSERT INTO entradas (
                  id, evento_id, categoria_id, fecha_id, comprador_id,
                  qr_code, clave_corta, estado, precio_pagado,
                  comision, mp_fee_amount, neto_empresa_amount,
                  nombre_comprador, apellido_comprador, dni_comprador,
                  checkout_session_id, revendedor_id, comision_revendedor, created_at
                ) VALUES (
                  ${entradaId},
                  ${entry.eventoId},
                  ${entry.categoriaId},
                  ${entry.fechaId},
                  ${session.comprador_id as string},
                  ${qrCode},
                  ${claveCorta},
                  'valida',
                  ${entry.precio},
                  ${entry.comision},
                  ${entry.mpFeeAmount},
                  ${netoEmpresaAmount},
                  ${entry.nombre},
                  ${entry.apellido},
                  ${entry.dni},
                  ${sessionId},
                  ${sessionRevendedorIdForInsert},
                  ${comisionRevendedor},
                  NOW()
                )`
              inserted.push(entradaId)
              success = true
              break
            } catch (err) {
              lastErr = err
              if (!isDuplicateEntryError(err)) {
                throw err
              }
              // retry con nueva clave_corta
            }
          }

          if (!success) {
            logServerError('reconciliacion emitir-manual: 10 collisions de clave_corta')
            throw lastErr ?? new Error('No se pudo generar clave_corta única tras 10 intentos')
          }
        }

        txInserted = inserted

        // 6. Mark session as manually confirmed
        await tx.$executeRaw`
          UPDATE checkout_sessions
          SET estado = 'confirmada',
              confirmed_at = COALESCE(confirmed_at, NOW()),
              reconciliation_status = 'reconciled',
              reconciliation_note = 'emitted_manually'
          WHERE id = ${sessionId}`
      }, {
        isolationLevel: 'Serializable',
        maxWait: 5000,
        timeout: 15000,
      })

      // 7. Audit log (outside transaction — must not block commit)
      await logAuditEvent({
        actor: actorFromRequest(req),
        action: 'reconciliacion.emit_manual',
        entityType: 'checkout_session',
        entityId: sessionId,
        entityLabel: txSession && (txSession as Record<string, unknown>).payment_id
          ? String((txSession as Record<string, unknown>).payment_id)
          : sessionId,
        payload: {
          entradas_emitidas: txInserted.length,
          force_without_stock: body.forceWithoutStock,
          reason: body.reason,
          actor_name: actorName,
          flow: txFlow,
        },
      })

      return res.json({
        data: {
          status: 'emitted',
          entradasEmitidas: txInserted.length,
          entradaIds: txInserted,
          forceWithoutStock: body.forceWithoutStock,
        },
      })
    } catch (err) {
      logServerError('reconciliacion emitir-manual')
      // Re-throw early-exit errors (404/409) as proper HTTP responses
      if (err && typeof err === 'object' && 'httpStatus' in err) {
        const e = err as Error & { httpStatus: number; code?: string; categoriaId?: string; disponible?: number; necesario?: number }
        return res.status(e.httpStatus).json({
          error: e.message,
          ...(e.code ? { code: e.code, categoriaId: e.categoriaId, disponible: e.disponible, necesario: e.necesario } : {}),
        })
      }
      return res.status(500).json({ error: safeMsg(err, 'Error interno del servidor') })
    }
  },
)

/**
 * POST /reconciliacion/:sessionId/reenviar-notificacion
 *
 * Reenvía la notificación (email/WhatsApp) de las entradas de una sesión ya
 * confirmada. Útil cuando:
 *   - Emitiste manualmente vía A2 (no dispara dispatch automático)
 *   - El dispatch original falló silenciosamente (caso 3 del audit)
 *   - Querés reenviar a pedido del comprador
 *
 * Llama a `dispatchBuyerPurchaseDelivery` (exportada de tenant.ts) — el mismo
 * camino que usa el flujo normal post-pago. Reusa toda la infra de email
 * templates + Resend + WhatsApp adapter.
 */
router.post(
  '/:sessionId/reenviar-notificacion',
  verifyInternal,
  requireAuth,
  requirePermissionMiddleware('gestionar_reembolsos'),
  async (req: Request, res: Response) => {
    const sessionId = req.params.sessionId
    if (!sessionId || typeof sessionId !== 'string') {
      return res.status(400).json({ error: 'sessionId inválido' })
    }

    const empresaId = getActorEmpresaId(req.user!)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    try {
      // 1. Cargar sesión con TODOS los campos que necesita dispatchBuyerPurchaseDelivery
      //    + el slug de la empresa (lo necesita para action URLs)
      const sessionRows = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT cs.id, cs.empresa_id, cs.comprador_id, cs.estado, cs.datos,
                cs.confirmed_at, cs.expires_at,
                c.email, c.phone_e164, c.phone_verified_at, c.delivery_preference,
                c.nombre AS comprador_nombre,
                emp.slug AS empresa_slug
         FROM checkout_sessions cs
         LEFT JOIN compradores c ON c.id = cs.comprador_id
         LEFT JOIN empresas emp ON emp.id = cs.empresa_id
         WHERE cs.id = $1 AND cs.empresa_id = $2
         LIMIT 1`,
        sessionId, empresaId,
      )
      const session = sessionRows[0]
      if (!session) {
        return res.status(404).json({ error: 'Sesión no encontrada' })
      }

      if (session.estado !== 'confirmada') {
        return res.status(409).json({
          error: 'La sesión no está confirmada — no hay entradas que notificar todavía.',
        })
      }

      const slug = typeof session.empresa_slug === 'string' ? session.empresa_slug : ''
      if (!slug) {
        return res.status(409).json({ error: 'La empresa no tiene slug configurado.' })
      }

      // 1b. Detectar flow de la sesión
      let sessionFlow: 'entradas' | 'consumibles' = 'entradas'
      try {
        const rawDatos = session.datos
        const parsed = typeof rawDatos === 'string' ? JSON.parse(rawDatos) : rawDatos
        if (parsed?.flow === 'consumibles') sessionFlow = 'consumibles'
      } catch {
        // JSON inválido → asumir entradas (flow legacy)
      }

      if (sessionFlow === 'consumibles') {
        return res.status(409).json({
          error:
            'Esta sesión es de consumibles. El reenvío manual de notificaciones para consumibles no está soportado en esta interfaz — revisá directamente los registros de consumibles_ventas.',
        })
      }

      // 2. Cargar entradas linkeadas a esta sesión (vía checkout_session_id)
      const entradasRows = await prisma.$queryRawUnsafe<{ qr_code: string; clave_corta: string; categoria_nombre: string | null; evento_nombre: string | null }[]>(
        `SELECT en.qr_code, en.clave_corta,
                ec.nombre AS categoria_nombre,
                ev.nombre AS evento_nombre
         FROM entradas en
         LEFT JOIN entrada_categorias ec ON ec.id = en.categoria_id
         LEFT JOIN eventos ev ON ev.id = en.evento_id
         WHERE en.checkout_session_id = $1
         ORDER BY en.created_at ASC`,
        sessionId,
      )

      if (entradasRows.length === 0) {
        return res.status(409).json({
          error:
            'No hay entradas linkeadas a esta sesión. Si la sesión es vieja (anterior al schema migration), el link no existe — emitilas manualmente.',
        })
      }

      // 3. Validar que hay un canal de notificación posible
      const hasEmail = typeof session.email === 'string' && session.email.trim().length > 0
      const hasPhone = typeof session.phone_e164 === 'string' && session.phone_e164.trim().length > 0
      if (!hasEmail && !hasPhone) {
        return res.status(409).json({
          error: 'El comprador no tiene email ni teléfono — no hay canal para notificar.',
        })
      }

      const entradas: DeliveryEntryReceipt[] = entradasRows.map((row) => ({
        qrCode: String(row.qr_code),
        claveCorta: String(row.clave_corta),
        categoria: typeof row.categoria_nombre === 'string' ? row.categoria_nombre : 'Entrada',
        evento: typeof row.evento_nombre === 'string' ? row.evento_nombre : 'Evento',
      }))

      // 4. Llamar dispatch (mismo camino que el flujo normal post-pago)
      try {
        const dispatchResult = await dispatchBuyerPurchaseDelivery({
          slug,
          flow: 'entradas',
          session: session as CheckoutSessionRow,
          entradas,
          ventas: [],
        })

        // Track resultado para el retry job
        if (dispatchHadAnySuccess(dispatchResult.attempts)) {
          await markDeliverySucceeded(sessionId)
        } else {
          const firstErr = dispatchResult.attempts.find((a) => a.errorMessage)
          await markDeliveryFailed({
            sessionId,
            errorMessage: firstErr?.errorMessage ?? 'manual resend: all channels failed',
          })
        }

        await logAuditEvent({
          actor: actorFromRequest(req),
          action: 'reconciliacion.notification_resent',
          entityType: 'checkout_session',
          entityId: sessionId,
          payload: {
            entradas_count: entradas.length,
            preference: dispatchResult.preference,
            attempts: dispatchResult.attempts.map((a) => ({
              channel: a.channel,
              status: a.status,
              provider: a.provider,
              error_code: a.errorCode ?? null,
            })),
          },
        })

        return res.json({
          data: {
            status: 'sent',
            preference: dispatchResult.preference,
            attempts: dispatchResult.attempts.map((a) => ({
              channel: a.channel,
              status: a.status,
              provider: a.provider,
              errorMessage: a.errorMessage ?? null,
            })),
            entradasNotificadas: entradas.length,
          },
        })
      } catch (dispatchErr) {
        logServerError('reconciliacion dispatch retry')
        await markDeliveryFailed({
          sessionId,
          errorMessage: dispatchErr instanceof Error ? dispatchErr.message : 'dispatch threw',
        })
        await logAuditEvent({
          actor: actorFromRequest(req),
          action: 'reconciliacion.notification_resend_failed',
          entityType: 'checkout_session',
          entityId: sessionId,
          payload: {
            error_message: dispatchErr instanceof Error ? dispatchErr.message : 'unknown',
          },
        })
        return res.status(502).json({
          error: 'El servicio de notificación falló. Reintentá en unos minutos.',
        })
      }
    } catch {
      logServerError('reconciliacion reenviar-notificacion')
      return res.status(500).json({ error: 'Error interno del servidor' })
    }
  },
)

export default router
