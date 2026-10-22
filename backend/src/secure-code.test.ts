import assert from 'node:assert/strict'
import { test } from 'node:test'
import { generateSecureShortCode } from './lib/secure-code'

test('secure short code has expected length and safe alphabet', () => {
  const code = generateSecureShortCode()
  assert.equal(code.length, 12)
  assert.match(code, /^[A-Z2-9]+$/)
  assert.equal(code.includes('0'), false)
  assert.equal(code.includes('1'), false)
  assert.equal(code.includes('I'), false)
  assert.equal(code.includes('O'), false)
})

test('secure short code generation yields different values across calls', () => {
  const values = new Set(Array.from({ length: 20 }, () => generateSecureShortCode()))
  assert.equal(values.size, 20)
})
