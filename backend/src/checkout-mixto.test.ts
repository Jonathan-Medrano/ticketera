import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  parseCheckoutSessionData,
  getCheckoutFlow,
  countReservedEntryUnits,
  countReservedConsumibleUnits,
  prorateMixtoMpFee,
} from './routes/tenant'

test('prorateMixtoMpFee: la suma de las dos porciones es siempre exactamente el fee total', () => {
  const casos = [
    { fee: 100, entradas: 500, consumibles: 500 },
    { fee: 33.33, entradas: 1000, consumibles: 2000 },
    { fee: 17.5, entradas: 1, consumibles: 999999 },
    { fee: 0, entradas: 100, consumibles: 100 },
    { fee: 12.34, entradas: 333.33, consumibles: 666.67 },
    { fee: 9.99, entradas: 1, consumibles: 1 },
  ]
  for (const { fee, entradas, consumibles } of casos) {
    const result = prorateMixtoMpFee(fee, entradas, consumibles)
    assert.equal(
      Math.round((result.entradas + result.consumibles) * 100) / 100,
      Math.round(fee * 100) / 100,
      `fee=${fee} entradas=${entradas} consumibles=${consumibles}: ${result.entradas}+${result.consumibles} !== ${fee}`,
    )
  }
})

test('prorateMixtoMpFee: peso total 0 no divide por cero', () => {
  assert.deepEqual(prorateMixtoMpFee(50, 0, 0), { entradas: 0, consumibles: 0 })
})

test('prorateMixtoMpFee: reparte proporcional al peso de cada dominio', () => {
  const result = prorateMixtoMpFee(100, 750, 250)
  assert.equal(result.entradas, 75)
  assert.equal(result.consumibles, 25)
})

test('prorateMixtoMpFee: todo el peso en un solo dominio le asigna el 100% del fee al otro en 0', () => {
  const soloEntradas = prorateMixtoMpFee(42.5, 1000, 0)
  assert.equal(soloEntradas.entradas, 42.5)
  assert.equal(soloEntradas.consumibles, 0)

  const soloConsumibles = prorateMixtoMpFee(42.5, 0, 1000)
  assert.equal(soloConsumibles.entradas, 0)
  assert.equal(soloConsumibles.consumibles, 42.5)
})

test('parseCheckoutSessionData: round-trip preserva addons/seat_reservation_id para flow entradas (bug ya corregido esta sesión)', () => {
  const original = {
    flow: 'entradas',
    items: [{ categoriaId: 'cat1', eventoId: 'ev1', eventoNombre: 'Evento', categoriaNombre: 'General', precio: 100, cantidad: 2 }],
    addons: [{ id: 'addon1', nombre: 'Remera', precio: 50, cantidad: 1, eventoId: 'ev1' }],
    seat_reservation_id: 'seat-res-123',
    marketplaceFee: { amount: 10, currency: 'ARS', metadata: { mode: 'absorbed', percentage: 4, fixedAmount: 0 } },
    feeBillingMode: 'absorbed',
    feeBuyerFraction: 0,
    confirmationToken: 'tok-abc',
  }
  const parsed = parseCheckoutSessionData(JSON.stringify(original))
  assert.equal(parsed.flow, 'entradas')
  if (parsed.flow !== 'entradas') throw new Error('unreachable')
  assert.deepEqual(parsed.addons, original.addons)
  assert.equal(parsed.seat_reservation_id, original.seat_reservation_id)
  assert.equal(parsed.confirmationToken, original.confirmationToken)
  assert.equal(parsed.marketplaceFee?.amount, 10)
})

test('parseCheckoutSessionData: round-trip preserva ambos fee snapshots para flow mixto', () => {
  const original = {
    flow: 'mixto',
    itemsEntradas: [{ categoriaId: 'cat1', eventoId: 'ev1', eventoNombre: 'Evento', categoriaNombre: 'General', precio: 100, cantidad: 1 }],
    addons: [{ id: 'addon1', nombre: 'Remera', precio: 50, cantidad: 1, eventoId: 'ev1' }],
    itemsConsumibles: [{ barraId: 'barra1', barraNombre: 'Barra', consumibleId: 'cons1', nombre: 'Cerveza', precio: 30, cantidad: 3, eventoId: 'ev1', eventoNombre: 'Evento' }],
    marketplaceFeeEntradas: { amount: 4, currency: 'ARS', metadata: { mode: 'absorbed', percentage: 4, fixedAmount: 0 } },
    marketplaceFeeConsumibles: { amount: 3, currency: 'ARS', metadata: { mode: 'absorbed', percentage: 3, fixedAmount: 0 } },
    confirmationToken: 'tok-mixto',
  }
  const parsed = parseCheckoutSessionData(JSON.stringify(original))
  assert.equal(getCheckoutFlow(parsed), 'mixto')
  if (parsed.flow !== 'mixto') throw new Error('unreachable')
  assert.deepEqual(parsed.itemsEntradas, original.itemsEntradas)
  assert.deepEqual(parsed.itemsConsumibles, original.itemsConsumibles)
  assert.deepEqual(parsed.addons, original.addons)
  assert.equal(parsed.marketplaceFeeEntradas?.amount, 4)
  assert.equal(parsed.marketplaceFeeConsumibles?.amount, 3)
})

test('getCheckoutFlow/countReservedEntryUnits/countReservedConsumibleUnits: mixto cuenta cada porcion por separado', () => {
  const mixtoData = parseCheckoutSessionData(JSON.stringify({
    flow: 'mixto',
    itemsEntradas: [{ categoriaId: 'cat1', cantidad: 3 }, { categoriaId: 'cat2', cantidad: 2 }],
    itemsConsumibles: [{ barraId: 'b1', consumibleId: 'c1', cantidad: 5 }],
  }))
  assert.equal(getCheckoutFlow(mixtoData), 'mixto')
  assert.equal(countReservedEntryUnits(mixtoData), 5)
  assert.equal(countReservedConsumibleUnits(mixtoData), 5)
})

test('countReservedEntryUnits/countReservedConsumibleUnits: flows puros no se cuentan cruzados (anti-abuso no se evade)', () => {
  const entradasData = parseCheckoutSessionData(JSON.stringify({ flow: 'entradas', items: [{ categoriaId: 'cat1', cantidad: 4 }] }))
  assert.equal(countReservedEntryUnits(entradasData), 4)
  assert.equal(countReservedConsumibleUnits(entradasData), 0)

  const consumiblesData = parseCheckoutSessionData(JSON.stringify({ flow: 'consumibles', items: [{ barraId: 'b1', consumibleId: 'c1', cantidad: 7 }] }))
  assert.equal(countReservedEntryUnits(consumiblesData), 0)
  assert.equal(countReservedConsumibleUnits(consumiblesData), 7)
})
