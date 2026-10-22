export const PASSWORD_POLICY_DESCRIPTOR = {
  minLength: 12,
  allowedSpecialChars: `!"#$%&'()*+,-./:;<=>?@[\\]^_{|}~`,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
  forbidWhitespace: true,
} as const

export const PASSWORD_POLICY_HELPER_TEXT = 'Usá al menos 12 caracteres, incluyendo mayúscula, minúscula, número y carácter especial, sin espacios.'
export const PASSWORD_POLICY_ERROR_MESSAGE = 'La contraseña debe cumplir la política de seguridad'

const allowedSpecialSet = new Set(PASSWORD_POLICY_DESCRIPTOR.allowedSpecialChars.split(''))

export function validatePasswordPolicy(password: string) {
  if (!password?.trim()) return PASSWORD_POLICY_HELPER_TEXT
  if (/\s/.test(password)) return PASSWORD_POLICY_HELPER_TEXT
  if (password.length < PASSWORD_POLICY_DESCRIPTOR.minLength) return PASSWORD_POLICY_HELPER_TEXT
  if (!/[A-Z]/.test(password)) return PASSWORD_POLICY_HELPER_TEXT
  if (!/[a-z]/.test(password)) return PASSWORD_POLICY_HELPER_TEXT
  if (!/[0-9]/.test(password)) return PASSWORD_POLICY_HELPER_TEXT
  if (!password.split('').some((char) => allowedSpecialSet.has(char))) return PASSWORD_POLICY_HELPER_TEXT
  return null
}

export function isPasswordPolicyError(error: string | null | undefined) {
  return error === PASSWORD_POLICY_ERROR_MESSAGE || error === PASSWORD_POLICY_HELPER_TEXT
}

export type PasswordPolicyCheck = {
  key: 'minLength' | 'uppercase' | 'lowercase' | 'number' | 'special' | 'noWhitespace'
  label: string
  ok: boolean
}

export function getPasswordPolicyChecks(password: string): PasswordPolicyCheck[] {
  const value = password ?? ''
  return [
    { key: 'minLength', label: `Al menos ${PASSWORD_POLICY_DESCRIPTOR.minLength} caracteres`, ok: value.length >= PASSWORD_POLICY_DESCRIPTOR.minLength },
    { key: 'uppercase', label: 'Una mayúscula (A-Z)', ok: /[A-Z]/.test(value) },
    { key: 'lowercase', label: 'Una minúscula (a-z)', ok: /[a-z]/.test(value) },
    { key: 'number', label: 'Un número (0-9)', ok: /[0-9]/.test(value) },
    { key: 'special', label: 'Un carácter especial (! @ # $ % …)', ok: value.split('').some((c) => allowedSpecialSet.has(c)) },
    { key: 'noWhitespace', label: 'Sin espacios', ok: value.length > 0 && !/\s/.test(value) },
  ]
}
