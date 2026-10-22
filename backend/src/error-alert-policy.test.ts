import { test } from 'node:test'
import assert from 'node:assert/strict'
import { shouldSendAlert, isAlertSeverity, type AlertDecisionInput } from './lib/error-alert-policy'

const COOLDOWN = 30 * 60_000 // 30 min
const NOW = 1_000_000_000_000

function input(overrides: Partial<AlertDecisionInput> = {}): AlertDecisionInput {
  return {
    enabled: true,
    severity: 'error',
    countTotal: 1,
    lastAlertedAtMs: null,
    nowMs: NOW,
    cooldownMs: COOLDOWN,
    ...overrides,
  }
}

test('severidad: error y fatal alertan, warn y otros no', () => {
  assert.equal(isAlertSeverity('error'), true)
  assert.equal(isAlertSeverity('fatal'), true)
  assert.equal(isAlertSeverity('warn'), false)
  assert.equal(isAlertSeverity('info'), false)
})

test('error nuevo (count_total=1) -> alerta', () => {
  assert.equal(shouldSendAlert(input({ severity: 'error', countTotal: 1 })), true)
})

test('fatal nuevo -> alerta', () => {
  assert.equal(shouldSendAlert(input({ severity: 'fatal', countTotal: 1 })), true)
})

test('warn nuevo -> NO alerta (queda solo en el log)', () => {
  assert.equal(shouldSendAlert(input({ severity: 'warn', countTotal: 1 })), false)
})

test('deshabilitado -> NO alerta aunque sea fatal nuevo', () => {
  assert.equal(shouldSendAlert(input({ enabled: false, severity: 'fatal', countTotal: 1 })), false)
})

test('error recurrente que nunca alerto (lastAlerted=null) -> alerta', () => {
  assert.equal(shouldSendAlert(input({ countTotal: 50, lastAlertedAtMs: null })), true)
})

test('anti-spam: error recurrente DENTRO del cooldown -> NO alerta', () => {
  // alertado hace 5 min, cooldown 30 min
  assert.equal(
    shouldSendAlert(input({ countTotal: 500, lastAlertedAtMs: NOW - 5 * 60_000 })),
    false,
  )
})

test('error recurrente DESPUES del cooldown -> re-alerta', () => {
  // alertado hace 31 min, cooldown 30 min
  assert.equal(
    shouldSendAlert(input({ countTotal: 500, lastAlertedAtMs: NOW - 31 * 60_000 })),
    true,
  )
})

test('borde exacto del cooldown (now - last === cooldown) -> NO alerta (estricto >)', () => {
  assert.equal(
    shouldSendAlert(input({ countTotal: 2, lastAlertedAtMs: NOW - COOLDOWN })),
    false,
  )
})

test('escenario del loop: 1 nuevo alerta, las 499 repeticiones siguientes NO', () => {
  // 1ra aparicion
  assert.equal(shouldSendAlert(input({ countTotal: 1, lastAlertedAtMs: null })), true)
  // se marca last_alerted_at = NOW; las repeticiones inmediatas caen dentro del cooldown
  let sent = 0
  for (let i = 2; i <= 500; i++) {
    if (shouldSendAlert(input({ countTotal: i, lastAlertedAtMs: NOW, nowMs: NOW + i * 100 }))) sent++
  }
  assert.equal(sent, 0, 'ninguna de las 499 repeticiones dentro del cooldown debe alertar')
})
