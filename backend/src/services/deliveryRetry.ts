import { prismaDirectUrl } from '../lib/prisma'
import {
  dispatchBuyerPurchaseDelivery,
  type CheckoutSessionRow,
  type DeliveryEntryReceipt,
} from '../routes/tenant'
import { dispatchHadAnySuccess, markDeliveryFailed, markDeliverySucceeded } from '../lib/delivery-retry'
import { logServerError } from '../lib/safe-log'

const BATCH_SIZE = 20
// Unique advisory lock key for this job — stable integer, no collision with other jobs
const DELIVERY_RETRY_LOCK_KEY = 4242

export type DeliveryRetryResult = {
  scanned: number
  succeeded: number
  failed: number
  abandoned: number
}

type DeliverySessionRow = {
  id: string
  empresa_id: string
  comprador_id: string
  datos: string
  confirmed_at: Date | null
  expires_at: Date | null
  estado: string
  delivery_retry_count: number
  email: string | null
  phone_e164: string | null
  phone_verified_at: Date | null
  delivery_preference: string | null
  comprador_nombre: string | null
  empresa_slug: string | null
}

type EntradaForDelivery = {
  qr_code: string
  clave_corta: string
  categoria_nombre: string | null
  evento_nombre: string | null
}

/**
 * Picks 'pending' delivery sessions whose next_attempt_at is due, retries the
 * dispatch, and updates their delivery_status accordingly.
 *
 * Uses pg_try_advisory_lock to guarantee a single instance runs at a time in
 * multi-replica deployments — replaces MySQL GET_LOCK which is not available in Postgres.
 * Must use prismaDirectUrl (direct port 5432) because advisory locks are session-scoped
 * and incompatible with PgBouncer transactional mode.
 *
 * Reuses `dispatchBuyerPurchaseDelivery` from tenant.ts — same infra as the normal flow.
 */
export async function runDeliveryRetry(): Promise<DeliveryRetryResult> {
  const result: DeliveryRetryResult = { scanned: 0, succeeded: 0, failed: 0, abandoned: 0 }

  // 1. Adquirir lock distribuido (non-blocking — returns false if another instance holds it).
  const lockResult = await prismaDirectUrl.$queryRaw<{ acquired: boolean }[]>`
    SELECT pg_try_advisory_lock(${DELIVERY_RETRY_LOCK_KEY}) AS acquired
  `
  if (!lockResult[0]?.acquired) {
    // Otra réplica ya está procesando — salir sin hacer nada.
    return result
  }

  try {
    // 2. Pickea sesiones pending con next_attempt_at vencido.
    const rows = await prismaDirectUrl.$queryRaw<DeliverySessionRow[]>`
      SELECT cs.id, cs.empresa_id, cs.comprador_id, cs.datos,
             cs.confirmed_at, cs.expires_at, cs.estado,
             cs.delivery_retry_count,
             c.email, c.phone_e164, c.phone_verified_at, c.delivery_preference,
             c.nombre AS comprador_nombre,
             emp.slug AS empresa_slug
      FROM checkout_sessions cs
      LEFT JOIN compradores c ON c.id = cs.comprador_id
      LEFT JOIN empresas emp ON emp.id = cs.empresa_id
      WHERE cs.delivery_status = 'pending'
        AND cs.delivery_next_attempt_at IS NOT NULL
        AND cs.delivery_next_attempt_at <= NOW()
        AND cs.estado = 'confirmada'
      ORDER BY cs.delivery_next_attempt_at ASC
      LIMIT ${BATCH_SIZE}
    `

    result.scanned = rows.length
    if (rows.length === 0) return result

    for (const session of rows) {
      const sessionId = String(session.id)
      const slug = typeof session.empresa_slug === 'string' ? session.empresa_slug : ''
      if (!slug) {
        await markDeliveryFailed({
          sessionId,
          errorMessage: 'empresa sin slug',
        })
        result.failed += 1
        continue
      }

      // Detectar el flow de la sesión desde datos JSON
      let sessionFlow: 'entradas' | 'consumibles' = 'entradas'
      try {
        const rawDatos = session.datos
        const parsed = typeof rawDatos === 'string' ? JSON.parse(rawDatos) : rawDatos
        if (parsed?.flow === 'consumibles') sessionFlow = 'consumibles'
      } catch {
        // Si el JSON falla, asumimos entradas (flow legacy)
      }

      // Consumibles: el retry automático no está soportado (requiere datos de
      // consumibles_ventas con estructura diferente a entradas). Marcar para
      // revisión manual en lugar de fallar silenciosamente.
      if (sessionFlow === 'consumibles') {
        await prismaDirectUrl.$executeRaw`
          UPDATE checkout_sessions
          SET delivery_status = 'manual_review_needed',
              reconciliation_note = COALESCE(NULLIF(reconciliation_note, ''), 'delivery_retry_consumibles_not_supported'),
              delivery_last_error = 'delivery_retry_consumibles_not_supported',
              updated_at = NOW()
          WHERE id = ${sessionId}
        `
        result.failed += 1
        continue
      }

      // Cargar entradas linkeadas (flow entradas)
      let entradasRows: EntradaForDelivery[]
      try {
        entradasRows = await prismaDirectUrl.$queryRaw<EntradaForDelivery[]>`
          SELECT en.qr_code, en.clave_corta,
                 ec.nombre AS categoria_nombre,
                 ev.nombre AS evento_nombre
          FROM entradas en
          LEFT JOIN entrada_categorias ec ON ec.id = en.categoria_id
          LEFT JOIN eventos ev ON ev.id = en.evento_id
          WHERE en.checkout_session_id = ${sessionId}
          ORDER BY en.created_at ASC
        `
      } catch (err) {
        logServerError('delivery retry: load entradas')
        await markDeliveryFailed({
          sessionId,
          errorMessage: err instanceof Error ? err.message : 'load entradas failed',
        })
        result.failed += 1
        continue
      }

      if (entradasRows.length === 0) {
        // Sin entradas linkeadas — no hay nada que reenviar. Marcar abandoned para
        // que aparezca en reconciliación.
        await markDeliveryFailed({
          sessionId,
          errorMessage: 'no entradas linked to session (legacy data or wrong flow)',
        })
        result.failed += 1
        continue
      }

      const entradas: DeliveryEntryReceipt[] = entradasRows.map((row) => ({
        qrCode: String(row.qr_code),
        claveCorta: String(row.clave_corta),
        categoria: typeof row.categoria_nombre === 'string' ? row.categoria_nombre : 'Entrada',
        evento: typeof row.evento_nombre === 'string' ? row.evento_nombre : 'Evento',
      }))

      try {
        const dispatchResult = await dispatchBuyerPurchaseDelivery({
          slug,
          flow: 'entradas',
          session: session as CheckoutSessionRow,
          entradas,
          ventas: [],
        })

        if (dispatchHadAnySuccess(dispatchResult.attempts)) {
          await markDeliverySucceeded(sessionId)
          result.succeeded += 1
        } else {
          const firstErr = dispatchResult.attempts.find((a) => a.errorMessage)
          await markDeliveryFailed({
            sessionId,
            errorMessage: firstErr?.errorMessage ?? 'all channels failed',
          })

          // Verificar si la última escritura nos llevó a abandoned
          const postUpdateRows = await prismaDirectUrl.$queryRaw<{ delivery_status: string }[]>`
            SELECT delivery_status FROM checkout_sessions WHERE id = ${sessionId}
          `
          if (postUpdateRows[0]?.delivery_status === 'abandoned') {
            result.abandoned += 1
          } else {
            result.failed += 1
          }
        }
      } catch (err) {
        logServerError('delivery retry: dispatch threw')
        await markDeliveryFailed({
          sessionId,
          errorMessage: err instanceof Error ? err.message : 'dispatch threw',
        })
        result.failed += 1
      }
    }

    console.info(
      JSON.stringify({
        ts: new Date().toISOString(),
        event: 'delivery_retry_batch',
        ...result,
      }),
    )

    return result
  } finally {
    await prismaDirectUrl.$queryRaw`SELECT pg_advisory_unlock(${DELIVERY_RETRY_LOCK_KEY})`.catch(() => undefined)
  }
}
