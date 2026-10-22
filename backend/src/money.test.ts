import assert from 'node:assert/strict'
import { test } from 'node:test'
import { roundMoney } from './lib/money'

test('roundMoney leaves integers untouched', () => {
  assert.equal(roundMoney(0), 0)
  assert.equal(roundMoney(1), 1)
  assert.equal(roundMoney(1500), 1500)
  assert.equal(roundMoney(99999), 99999)
})

test('roundMoney keeps exact 2-decimal values', () => {
  assert.equal(roundMoney(1.23), 1.23)
  assert.equal(roundMoney(0.01), 0.01)
  assert.equal(roundMoney(1234.56), 1234.56)
  assert.equal(roundMoney(99.99), 99.99)
})

test('roundMoney rounds to 2 decimals (half up at cent boundary)', () => {
  assert.equal(roundMoney(1.005), 1.01)
  assert.equal(roundMoney(1.004), 1.0)
  assert.equal(roundMoney(2.675), 2.68)
  assert.equal(roundMoney(1.235), 1.24)
})

test('roundMoney handles floating point accumulation edge cases', () => {
  // El caso clásico: 0.1 + 0.2 === 0.30000000000000004
  assert.equal(roundMoney(0.1 + 0.2), 0.3)
  assert.equal(roundMoney(0.1 + 0.2 + 0.3), 0.6)
  // 19.99 * 3 = 59.97 pero en float da 59.96999999999999
  assert.equal(roundMoney(19.99 * 3), 59.97)
  // 0.07 * 100 acumulado
  assert.equal(roundMoney(0.07 + 0.07 + 0.07), 0.21)
})

test('roundMoney handles negative amounts', () => {
  // Math.round redondea el .5 hacia +Infinity, por eso -1.235 -> -1.23 (no -1.24).
  // Es el comportamiento estándar de Math.round y coincide con la impl original en prod.
  assert.equal(roundMoney(-1.235), -1.23)
  assert.equal(roundMoney(-1.236), -1.24)
  assert.equal(roundMoney(-0.1 - 0.2), -0.3)
  assert.equal(roundMoney(-1500), -1500)
  assert.equal(roundMoney(-99.99), -99.99)
})

test('roundMoney matches toFixed(2) for normal monetary values', () => {
  // CLAVE de Fase 2: para montos normales el resultado debe ser IDÉNTICO
  // a Number(value.toFixed(2)). Esto garantiza que no cambia valores existentes.
  const normalValues = [0, 1, 12.5, 100, 250.75, 999.9, 1234.56, 50000, 0.99]
  for (const value of normalValues) {
    assert.equal(
      roundMoney(value),
      Number(value.toFixed(2)),
      `roundMoney(${value}) debería igualar Number(${value}.toFixed(2))`,
    )
  }
})

test('roundMoney result always has at most 2 decimal places', () => {
  const inputs = [1.111, 9.876, 0.005, 12345.6789, 0.1 + 0.2]
  for (const value of inputs) {
    const result = roundMoney(value)
    // El resultado, formateado a 2 decimales, debe ser igual a sí mismo:
    // no debe tener un 3er decimal significativo.
    assert.equal(result, Number(result.toFixed(2)), `roundMoney(${value}) = ${result} no tiene 2 decimales`)
  }
})
