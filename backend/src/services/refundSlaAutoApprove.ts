import { prismaDirectUrl } from '../lib/prisma'
import { logEvent, logServerError, logServerInfo } from '../lib/safe-log'
import { logAuditEvent } from '../lib/audit-log'
import {
  approveRefundManualCase,
  executeRefundManualCase,
} from '../lib/refund-manual'

// Razon canonica del audit log y del campo evidence_note/reason del case
// cuando el SLA de la empresa vence sin respuesta.
export const REFUND_SLA_AUTO_APPROVE_REASON = 'sla_empresa_vencido'

// Actor sintetico que firma el evento en el audit log y en el case event.
const SLA_AUTO_APPROVE_ACTOR_ID = 'system:refund-sla-auto-approve'

const DEFAULT_REFUND_SLA_BATCH_SIZE = 50

// Advisory lock key reservado para este job (9003) — no colisiona con:
// 4242 delivery-retry, 7701 marketing carrito abandonado, 8823 checkoutCleanup,
// 9001 platform-governance, 9002 platform-profit-sharing.
const REFUND_SLA_ADVISORY_LOCK_KEY = 9003

export function resolveRefundSlaBatchSize(batchSize: number) {
  if (!Number.isFinite(batchSize)) {
    return DEFAULT_REFUND_SLA_BATCH_SIZE
  }
  return Math.min(DEFAULT_REFUND_SLA_BATCH_SIZE, Math.max(1, Math.trunc(batchSize)))
}

type ExpiredRefundCaseRow = {
  id: string
  empresa_id: string
  flow: 'entradas' | 'consumibles'
  request_origin: string
  status: string
  request_note: string | null
  manual_review_sla_days: number | null
  created_at: string | Date
}

/**
 * Busca y auto-aprueba los reembolsos manuales cuyo SLA de respuesta de la empresa
 * vencio sin que la empresa haya respondido (status sigue en 'requested' o 'under_review').
 *
 * Estrategia:
 *  - Una sola tx con advisory lock global (9003) para evitar que multiples backend
 *    procesen el mismo lote en paralelo.
 *  - SELECT ... FOR UPDATE SKIP LOCKED toma un batch pequeno y lo "reserva".
 *  - Para cada caso, llamamos al mismo helper que la empresa usaria desde el dashboard
 *    (approveRefundManualCase para entradas, executeRefundManualCase para consumibles).
 *  - El reason en el case + audit log es 'sla_empresa_vencido'.
 *
 * Devuelve la cantidad de casos auto-aprobados.
 */
export async function autoApproveSlaExpiredRefunds(batchSize = DEFAULT_REFUND_SLA_BATCH_SIZE): Promise<number> {
  const safeBatchSize = resolveRefundSlaBatchSize(batchSize)
  let totalApproved = 0

  // Loop por batches hasta que no queden mas pendientes vencidos.
  // Patron identico a cleanupExpiredCheckoutReservations.
  while (true) {
    const candidates = await prismaDirectUrl.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${REFUND_SLA_ADVISORY_LOCK_KEY})`

      // Filtramos por:
      //  - status IN ('requested', 'under_review'): la empresa NO respondio todavia.
      //    Si la empresa aprobo, rechazo, ejecuto o marco como no reembolsable, el status cambia y
      //    el SLA ya no aplica.
      //  - created_at + manual_review_sla_days dias < NOW(): el plazo vencio.
      //  - resolved_at IS NULL: defensivo, los status arriba ya lo cubren pero asi documentamos
      //    explicitamente que solo procesamos casos no resueltos.
      const rows = await tx.$queryRaw<ExpiredRefundCaseRow[]>`
        SELECT rmc.id, rmc.empresa_id, rmc.flow, rmc.request_origin, rmc.status, rmc.request_note,
               COALESCE(emp.manual_review_sla_days, 7) AS manual_review_sla_days,
               rmc.created_at
        FROM refund_manual_cases rmc
        JOIN empresas emp ON emp.id = rmc.empresa_id
        WHERE rmc.status IN ('requested', 'under_review')
          AND rmc.resolved_at IS NULL
          AND rmc.created_at + (COALESCE(emp.manual_review_sla_days, 7) * INTERVAL '1 day') < NOW()
        ORDER BY rmc.created_at ASC, rmc.id ASC
        LIMIT ${safeBatchSize}
        FOR UPDATE SKIP LOCKED
      `

      return rows
    }, {
      isolationLevel: 'Serializable',
      maxWait: 5000,
      timeout: 30000,
    })

    if (!candidates.length) break

    for (const candidate of candidates) {
      const slaDays = Number(candidate.manual_review_sla_days ?? 7)
      const noteSuffix = `Auto-aprobacion automatica del sistema: la empresa no respondio dentro del SLA de ${slaDays} dias.`

      try {
        let approveResult: { ok: boolean; status: number; error?: string }

        if (candidate.flow === 'consumibles') {
          // Para buyer_consumible_request, approveRefundManualCase rechaza con 409 porque
          // los consumibles van directo a execute. Usamos executeRefundManualCase como el
          // path equivalente que la empresa usaria desde el dashboard.
          approveResult = await executeRefundManualCase({
            caseId: candidate.id,
            empresaId: candidate.empresa_id,
            actorId: SLA_AUTO_APPROVE_ACTOR_ID,
            actorType: 'empresa',
            evidenceNote: noteSuffix,
            externalRefundReference: null,
          })
        } else {
          // Flow entradas: aprobacion manual (el ejecutor MP corre por separado en el
          // flujo de la empresa). Esto es equivalente a clickear "Aprobar" en el dashboard.
          approveResult = await approveRefundManualCase({
            caseId: candidate.id,
            empresaId: candidate.empresa_id,
            actorId: SLA_AUTO_APPROVE_ACTOR_ID,
            actorType: 'empresa',
            reason: REFUND_SLA_AUTO_APPROVE_REASON,
            note: noteSuffix,
          })
        }

        if (!approveResult.ok) {
          // No tiramos error, solo logueamos: puede haber un edge case (e.g. caso ya
          // resuelto entre el SELECT y el approve por otro path) que es OK saltear.
          logServerInfo(`[refund-sla] skipped case ${candidate.id} (status ${approveResult.status}): ${approveResult.error ?? 'sin detalle'}`)
          continue
        }

        totalApproved += 1

        await logAuditEvent({
          actor: { id: SLA_AUTO_APPROVE_ACTOR_ID, label: 'Sistema (SLA empresa vencido)', type: 'system' },
          action: 'refund_manual_case.sla_auto_approved',
          entityType: 'refund_manual_case',
          entityId: candidate.id,
          payload: {
            empresa_id: candidate.empresa_id,
            flow: candidate.flow,
            request_origin: candidate.request_origin,
            previous_status: candidate.status,
            sla_days: slaDays,
            reason: REFUND_SLA_AUTO_APPROVE_REASON,
          },
        })

        logEvent('refund_sla_auto_approved', {
          case_id: candidate.id,
          empresa_id: candidate.empresa_id,
          flow: candidate.flow,
          sla_days: slaDays,
        })
      } catch (err) {
        logServerError(`refund-sla auto-approve case ${candidate.id}`, err)
      }
    }

    if (candidates.length < safeBatchSize) break
  }

  if (totalApproved > 0) {
    logServerInfo(`[refund-sla] Auto-aprobados por SLA empresa vencido: ${totalApproved}`)
  }

  return totalApproved
}

export { DEFAULT_REFUND_SLA_BATCH_SIZE }
