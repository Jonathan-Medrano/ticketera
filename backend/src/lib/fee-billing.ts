// Fee billing: quién paga la comisión de plataforma.
// 'absorbed' (legacy/default): organizador absorbe. MP cobra precio_base, descuenta fee al payout.
// 'passed_to_buyer': comprador paga precio_base + fee. Organizador recibe precio_base completo.
// 'split': la empresa elige qué % del fee paga el comprador (fee_split_buyer_pct); el resto lo absorbe.
//
// El monto absoluto del fee NO cambia, y la plataforma SIEMPRE cobra el fee COMPLETO vía MP
// application_fee. El split se logra únicamente por cuánto se le cobra al comprador (inflación
// per-item por ratio = 1 + (fee·p)/subtotal). Solo cambia quién lo paga y cuánto cobra MP al comprador.

import { roundMoney } from './money'

export type FeeBillingMode = 'absorbed' | 'passed_to_buyer' | 'split'

export function normalizeFeeBillingMode(value: unknown): FeeBillingMode {
  if (value === 'passed_to_buyer') return 'passed_to_buyer'
  if (value === 'split') return 'split'
  return 'absorbed'
}

/**
 * Resuelve la fracción del fee que paga el comprador, p ∈ [0,1].
 * - 'absorbed'         ⇒ p = 0 (la empresa absorbe todo)
 * - 'passed_to_buyer'  ⇒ p = 1 (el comprador paga todo)
 * - 'split'            ⇒ p = fee_split_buyer_pct / 100 (clamp 0..1)
 *
 * Para 'split', un pct null/NaN/negativo se trata como 0 (conservador: la empresa absorbe).
 */
export function resolveBuyerFeeFraction(
  mode: FeeBillingMode,
  feeSplitBuyerPct?: number | null
): number {
  if (mode === 'passed_to_buyer') return 1
  if (mode === 'split') {
    const pct = Number(feeSplitBuyerPct)
    if (!Number.isFinite(pct) || pct <= 0) return 0
    return Math.min(pct / 100, 1)
  }
  return 0
}

// Clamp helper para la fracción del comprador (p ∈ [0,1]).
function clampFraction(p: number): number {
  if (!Number.isFinite(p) || p <= 0) return 0
  return Math.min(p, 1)
}

/**
 * Aplica el fee billing mode a los importes resultantes de un checkout.
 *
 * Generalizado por la fracción del comprador p ∈ [0,1]:
 * - amountChargedToBuyer    = base + fee·p
 * - amountReceivedByMerchant = max(base − fee·(1−p), 0)
 * - marketplaceFee          = fee (SIEMPRE el fee completo — la plataforma cobra todo vía MP)
 *
 * Casos: absorbed ⇒ p=0, passed_to_buyer ⇒ p=1, split ⇒ p=fee_split_buyer_pct/100.
 *
 * @param subtotalBase  Suma de items a precio_base (lo que el organizador definió)
 * @param marketplaceFee  Fee calculado sobre subtotal_base (4% típicamente — NO cambia según mode)
 * @param mode  'absorbed' | 'passed_to_buyer' | 'split'
 * @param feeSplitBuyerPct  Solo para mode='split': % del fee que paga el comprador (0..100)
 *
 * Devuelve los 3 importes clave para el flow MP + reports:
 * - amountChargedToBuyer: lo que se le cobra al comprador via MP (el unit_price * cantidad de la preference)
 * - amountReceivedByMerchant: lo que el organizador recibe (después del payout MP)
 * - marketplaceFee: lo que va a la plataforma (sin cambios respecto al input — fee COMPLETO)
 */
export function applyFeeBilling(params: {
  subtotalBase: number
  marketplaceFee: number
  mode: FeeBillingMode
  feeSplitBuyerPct?: number | null
}): {
  amountChargedToBuyer: number
  amountReceivedByMerchant: number
  marketplaceFee: number
} {
  const fee = roundMoney(params.marketplaceFee)
  const base = roundMoney(params.subtotalBase)
  const p = resolveBuyerFeeFraction(params.mode, params.feeSplitBuyerPct)

  return {
    amountChargedToBuyer: roundMoney(base + fee * p),
    amountReceivedByMerchant: roundMoney(Math.max(base - fee * (1 - p), 0)),
    marketplaceFee: fee,
  }
}

/**
 * Devuelve el precio que el comprador va a ver para un precio puntual (ej: una categoría
 * en el listado público), aplicando la fracción del comprador p ∈ [0,1].
 *
 * Acepta mode (+ feeSplitBuyerPct) o un buyerFraction explícito. Si se pasa buyerFraction
 * tiene prioridad; si no, se deriva de mode/feeSplitBuyerPct.
 */
export function buyerVisiblePrice(params: {
  priceBase: number
  feePercentage: number
  mode: FeeBillingMode
  feeSplitBuyerPct?: number | null
  buyerFraction?: number
}): number {
  const p = params.buyerFraction !== undefined
    ? clampFraction(params.buyerFraction)
    : resolveBuyerFeeFraction(params.mode, params.feeSplitBuyerPct)
  if (p <= 0) return roundMoney(params.priceBase)
  const fee = roundMoney(params.priceBase * (params.feePercentage / 100) * p)
  return roundMoney(params.priceBase + fee)
}

export function buyerVisibleFeeAmount(params: {
  priceBase: number
  feePercentage: number
  mode: FeeBillingMode
  feeSplitBuyerPct?: number | null
  buyerFraction?: number
}): number {
  const p = params.buyerFraction !== undefined
    ? clampFraction(params.buyerFraction)
    : resolveBuyerFeeFraction(params.mode, params.feeSplitBuyerPct)
  if (p <= 0) return 0
  return roundMoney(params.priceBase * (params.feePercentage / 100) * p)
}
