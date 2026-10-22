import { prisma } from './prisma'

/**
 * Política de reintento de delivery (notificación post-pago).
 *
 * El primer intento lo hace `dispatchBuyerPurchaseDelivery` directamente al
 * confirmar el pago. Si falla, marcamos delivery_status='pending' y un job
 * cron reintenta según backoff exponencial. Después de MAX_RETRIES intentos,
 * marcamos 'abandoned' y la sesión aparece en /dashboard/reconciliacion para
 * acción manual.
 */
export const MAX_RETRIES = 6

export type MarkDeliveryFailedInput = {
  sessionId: string
  errorMessage: string
}

/**
 * Llamar después de un dispatch fallido. Incrementa retry_count, calcula
 * próximo intento según backoff vía CASE WHEN, marca 'abandoned' si superó
 * MAX_RETRIES.
 *
 * Single query — atómico, no race conditions.
 * Fail-safe: nunca lanza — si la query rompe, loguea y sigue.
 */
export async function markDeliveryFailed(input: MarkDeliveryFailedInput): Promise<void> {
  try {
    const errorMsg = input.errorMessage.slice(0, 500)
    // Postgres INTERVAL syntax replaces MySQL DATE_ADD(NOW(), INTERVAL N UNIT).
    // All logic is identical to the original — backoff schedule unchanged.
    await prisma.$executeRaw`
      UPDATE checkout_sessions
      SET delivery_retry_count = delivery_retry_count + 1,
          delivery_last_error = ${errorMsg},
          delivery_status = CASE
            WHEN delivery_retry_count + 1 > ${MAX_RETRIES} THEN 'abandoned'
            ELSE 'pending'
          END,
          delivery_next_attempt_at = CASE
            WHEN delivery_retry_count + 1 > ${MAX_RETRIES} THEN NULL
            WHEN delivery_retry_count + 1 = 1 THEN NOW() + INTERVAL '1 minute'
            WHEN delivery_retry_count + 1 = 2 THEN NOW() + INTERVAL '5 minutes'
            WHEN delivery_retry_count + 1 = 3 THEN NOW() + INTERVAL '15 minutes'
            WHEN delivery_retry_count + 1 = 4 THEN NOW() + INTERVAL '60 minutes'
            WHEN delivery_retry_count + 1 = 5 THEN NOW() + INTERVAL '240 minutes'
            ELSE NOW() + INTERVAL '240 minutes'
          END
      WHERE id = ${input.sessionId}
    `
  } catch (err) {
    // No queremos romper el flujo de pago por esto — solo log
    console.error('[delivery-retry] markDeliveryFailed error:', err instanceof Error ? err.message : err)
  }
}

/**
 * Llamar después de un dispatch exitoso (al menos un canal OK).
 * Cierra el ciclo de reintentos.
 */
export async function markDeliverySucceeded(sessionId: string): Promise<void> {
  try {
    await prisma.$executeRaw`
      UPDATE checkout_sessions
      SET delivery_status = 'sent',
          delivery_completed_at = NOW(),
          delivery_next_attempt_at = NULL,
          delivery_last_error = NULL
      WHERE id = ${sessionId}
    `
  } catch (err) {
    console.error('[delivery-retry] markDeliverySucceeded error:', err instanceof Error ? err.message : err)
  }
}

/**
 * ¿El dispatch tuvo al menos un canal exitoso?
 * Mira el array de attempts que devuelve dispatchBuyerPurchaseDelivery.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function dispatchHadAnySuccess(attempts: any[] | undefined | null): boolean {
  if (!Array.isArray(attempts)) return false
  // El dispatcher (buyer-delivery-dispatcher.ts) emite 'sent' en éxito y 'failed' en error.
  // 'ok'/'success' se mantienen por compatibilidad, pero 'sent' es el valor real — sin él,
  // toda entrega exitosa se marcaba como fallida y el job de retry reenviaba hasta 7 veces.
  return attempts.some((a) => a && (a.status === 'sent' || a.status === 'ok' || a.status === 'success'))
}
