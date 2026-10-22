import { PaymentRefund } from 'mercadopago'
import { getMercadoPagoClientByEmpresaId, getPaymentAccountByEmpresaId } from './payment-accounts'

export type MpRefundInput = {
  empresaId: string
  paymentId: string
  /** Idempotency key único — MP no procesa dos refunds con el mismo key. Usar UUID por intento. */
  idempotencyKey: string
  /** Monto a reembolsar. Solo refund total = monto del payment original soportado en MVP. */
  refundAmount: number
}

export type MpRefundOk = {
  ok: true
  refundProviderId: string | null
  refundStatus: string | null
  refundedAmount: number | null
}

export type MpRefundFail = {
  ok: false
  /** Status code que conviene devolver al cliente (409 = problema de negocio, 502 = problema MP) */
  httpStatus: number
  /** Mensaje human-readable */
  error: string
  /** Código interno para clasificar el error y permitir reintentos inteligentes */
  reason:
    | 'invalid_amount'
    | 'no_payment_account'
    | 'account_not_ready'
    | 'client_init_failed'
    | 'credentials_invalid'
    | 'provider_blocked'
    | 'provider_rejected'
    | 'provider_unreachable'
}

export type MpRefundResult = MpRefundOk | MpRefundFail

/**
 * Clasifica un error que devolvió MP API para decidir status HTTP + razón.
 * Inspirado en la lógica existente de refund-manual.ts pero con `reason` machine-readable.
 */
function classifyRefundError(error: unknown): MpRefundFail {
  const message =
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : 'Mercado Pago rechazó el reembolso automático'

  const status =
    typeof error === 'object' && error && 'status' in error && typeof (error as { status?: unknown }).status === 'number'
      ? Number((error as { status: number }).status)
      : undefined

  if (status === 400 || status === 404 || status === 409) {
    return { ok: false, httpStatus: 409, error: message, reason: 'provider_rejected' }
  }

  if (status === 401 || status === 403) {
    return {
      ok: false,
      httpStatus: 409,
      error: 'La cuenta de Mercado Pago de la empresa no permite ejecutar reembolsos automáticos',
      reason: status === 401 ? 'credentials_invalid' : 'provider_blocked',
    }
  }

  if (status === 408 || status === 429 || (status !== undefined && status >= 500)) {
    return {
      ok: false,
      httpStatus: 502,
      error: 'Mercado Pago no respondió a tiempo. Reintentar en unos minutos.',
      reason: 'provider_unreachable',
    }
  }

  return { ok: false, httpStatus: 502, error: message, reason: 'provider_rejected' }
}

/**
 * Ejecuta un refund automático contra Mercado Pago vía el SDK oficial.
 *
 * Garantías:
 *   - Idempotencia: el mismo idempotencyKey NO ejecuta dos refunds (MP lo garantiza server-side).
 *     Si el caller llama 2x con el mismo key, MP devuelve el mismo refund — no duplica.
 *   - Sin side effects en DB: esta función SOLO llama a MP. El caller actualiza su propia tabla.
 *   - Fail-safe: nunca lanza excepción, siempre retorna result.ok = true/false.
 *
 * Usar desde flujos como:
 *   - refund-manual (caso refund_manual_cases) — el caller pasa refundCaseId como key
 *   - reconciliacion (caso checkout_session sin entrada) — el caller pasa sessionId como key
 */
export async function executeMercadoPagoRefund(input: MpRefundInput): Promise<MpRefundResult> {
  if (!(input.refundAmount > 0)) {
    return {
      ok: false,
      httpStatus: 409,
      error: 'El monto del reembolso debe ser mayor a 0',
      reason: 'invalid_amount',
    }
  }

  const paymentAccount = await getPaymentAccountByEmpresaId(input.empresaId)
  if (!paymentAccount) {
    return {
      ok: false,
      httpStatus: 409,
      error: 'La empresa no tiene una cuenta de Mercado Pago conectada',
      reason: 'no_payment_account',
    }
  }

  if (paymentAccount.status !== 'ready_to_sell') {
    return {
      ok: false,
      httpStatus: 409,
      error: 'La cuenta de Mercado Pago de la empresa no está lista para reembolsos',
      reason: 'account_not_ready',
    }
  }

  const mpClient = await getMercadoPagoClientByEmpresaId(input.empresaId)
  if (!mpClient) {
    return {
      ok: false,
      httpStatus: 409,
      error: 'No se pudo inicializar el cliente de Mercado Pago',
      reason: 'client_init_failed',
    }
  }

  try {
    const refundClient = new PaymentRefund(mpClient)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const refund = await (refundClient as any).create({
      payment_id: input.paymentId,
      body: { amount: input.refundAmount },
      requestOptions: {
        idempotencyKey: input.idempotencyKey,
      },
    })

    return {
      ok: true,
      refundProviderId: refund?.id != null ? String(refund.id) : null,
      refundStatus: typeof refund?.status === 'string' ? refund.status : null,
      refundedAmount: refund?.amount != null ? Number(refund.amount) : null,
    }
  } catch (error) {
    return classifyRefundError(error)
  }
}
