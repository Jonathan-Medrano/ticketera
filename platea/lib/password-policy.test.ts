import assert from "node:assert/strict"
import test from "node:test"
import { PASSWORD_POLICY_HELPER_TEXT, validatePasswordPolicy } from "@/lib/password-policy"

test("frontend password policy helper accepts valid passwords", () => {
  assert.equal(validatePasswordPolicy("ClaveSegura12!"), null)
})

test("frontend password policy helper rejects weak or whitespace passwords", () => {
  assert.equal(validatePasswordPolicy("12345678"), PASSWORD_POLICY_HELPER_TEXT)
  assert.equal(validatePasswordPolicy("Clave Segura12!"), PASSWORD_POLICY_HELPER_TEXT)
})
