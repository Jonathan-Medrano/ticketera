import assert from 'node:assert/strict'
import test from 'node:test'
import { validatePasswordPolicy } from './password-policy'

test('password policy accepts valid passwords with allowed specials', () => {
  assert.deepEqual(validatePasswordPolicy('ClaveSegura12!'), { ok: true })
  assert.deepEqual(validatePasswordPolicy('OtraClave#2026'), { ok: true })
})

test('password policy rejects weak and whitespace passwords with canonical reasons', () => {
  assert.deepEqual(validatePasswordPolicy('corta'), { ok: false, reason: 'too_short' })
  assert.deepEqual(validatePasswordPolicy('aaaaaaaaaaaa!1'), { ok: false, reason: 'missing_uppercase' })
  assert.deepEqual(validatePasswordPolicy('AAAAAAAAAAAA!1'), { ok: false, reason: 'missing_lowercase' })
  assert.deepEqual(validatePasswordPolicy('AAAAAAAAAAAA!!'), { ok: false, reason: 'missing_lowercase' })
  assert.deepEqual(validatePasswordPolicy('Clave Segura12!'), { ok: false, reason: 'contains_whitespace' })
})
