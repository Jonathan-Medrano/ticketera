import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  resolveBuyerFeeFraction,
  applyFeeBilling,
  buyerVisibleFeeAmount,
  normalizeFeeBillingMode,
} from './lib/fee-billing'

test('resolveBuyerFeeFraction: mapeo de modos', () => {
  assert.equal(resolveBuyerFeeFraction('absorbed'), 0)
  assert.equal(resolveBuyerFeeFraction('passed_to_buyer'), 1)
  assert.equal(resolveBuyerFeeFraction('split', 60), 0.6)
  assert.equal(resolveBuyerFeeFraction('split', 0), 0)
  assert.equal(resolveBuyerFeeFraction('split', 100), 1)
  // null / inválido / negativo en split ⇒ 0 (conservador: la empresa absorbe)
  assert.equal(resolveBuyerFeeFraction('split', null), 0)
  assert.equal(resolveBuyerFeeFraction('split', NaN), 0)
  assert.equal(resolveBuyerFeeFraction('split', -10), 0)
  // pct > 100 ⇒ clamp a 1
  assert.equal(resolveBuyerFeeFraction('split', 150), 1)
})

test('normalizeFeeBillingMode acepta los 3 modos y defaultea a absorbed', () => {
  assert.equal(normalizeFeeBillingMode('absorbed'), 'absorbed')
  assert.equal(normalizeFeeBillingMode('passed_to_buyer'), 'passed_to_buyer')
  assert.equal(normalizeFeeBillingMode('split'), 'split')
  assert.equal(normalizeFeeBillingMode('cualquier_cosa'), 'absorbed')
  assert.equal(normalizeFeeBillingMode(undefined), 'absorbed')
})

test('applyFeeBilling: absorbed (p=0) — la empresa absorbe todo', () => {
  const r = applyFeeBilling({ subtotalBase: 10000, marketplaceFee: 1000, mode: 'absorbed' })
  assert.equal(r.amountChargedToBuyer, 10000) // comprador paga el base limpio
  assert.equal(r.amountReceivedByMerchant, 9000) // empresa recibe base - fee
  assert.equal(r.marketplaceFee, 1000) // plataforma cobra el fee completo
})

test('applyFeeBilling: passed_to_buyer (p=1) — el comprador paga todo', () => {
  const r = applyFeeBilling({ subtotalBase: 10000, marketplaceFee: 1000, mode: 'passed_to_buyer' })
  assert.equal(r.amountChargedToBuyer, 11000) // base + fee
  assert.equal(r.amountReceivedByMerchant, 10000) // empresa recibe el base completo
  assert.equal(r.marketplaceFee, 1000)
})

test('applyFeeBilling: split 60% — el comprador paga 60% del fee, la empresa absorbe 40%', () => {
  const r = applyFeeBilling({ subtotalBase: 10000, marketplaceFee: 1000, mode: 'split', feeSplitBuyerPct: 60 })
  assert.equal(r.amountChargedToBuyer, 10600) // base + fee*0.6 = 10000 + 600
  assert.equal(r.amountReceivedByMerchant, 9600) // base - fee*0.4 = 10000 - 400
  assert.equal(r.marketplaceFee, 1000) // plataforma SIEMPRE cobra el fee completo
})

test('split: el comprador + la empresa siempre cubren exactamente el fee completo', () => {
  // Invariante de plata: lo que paga de más el comprador + lo que absorbe la empresa = fee.
  for (const pct of [0, 25, 33, 50, 60, 75, 100]) {
    const base = 10000
    const fee = 1000
    const r = applyFeeBilling({ subtotalBase: base, marketplaceFee: fee, mode: 'split', feeSplitBuyerPct: pct })
    const compradorPagaDeMas = r.amountChargedToBuyer - base
    const empresaAbsorbe = base - r.amountReceivedByMerchant
    assert.equal(compradorPagaDeMas + empresaAbsorbe, fee, `pct=${pct}: la suma debe ser el fee completo`)
    assert.equal(r.marketplaceFee, fee, `pct=${pct}: la plataforma cobra el fee completo`)
  }
})

test('buyerVisibleFeeAmount: el surcharge mostrado escala por la fracción del comprador', () => {
  // precio 1000, fee 4% → fee total 40; en split 60% el comprador ve 24.
  assert.equal(buyerVisibleFeeAmount({ priceBase: 1000, feePercentage: 4, mode: 'absorbed' }), 0)
  assert.equal(buyerVisibleFeeAmount({ priceBase: 1000, feePercentage: 4, mode: 'passed_to_buyer' }), 40)
  assert.equal(buyerVisibleFeeAmount({ priceBase: 1000, feePercentage: 4, mode: 'split', feeSplitBuyerPct: 60 }), 24)
})
