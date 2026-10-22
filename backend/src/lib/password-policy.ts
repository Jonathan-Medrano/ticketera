export const PASSWORD_POLICY_DESCRIPTOR = {
  minLength: 12,
  allowedSpecialChars: `!"#$%&'()*+,-./:;<=>?@[\\]^_{|}~`,
  requireUppercase: true,
  requireLowercase: true,
  requireNumber: true,
  requireSpecial: true,
  forbidWhitespace: true,
} as const

export type PasswordPolicyReason =
  | 'empty'
  | 'whitespace_only'
  | 'too_short'
  | 'missing_uppercase'
  | 'missing_lowercase'
  | 'missing_number'
  | 'missing_special'
  | 'contains_whitespace'

export type PasswordPolicyValidationResult =
  | { ok: true }
  | { ok: false; reason: PasswordPolicyReason }

export const PASSWORD_POLICY_ERROR_CODE = 'password_policy_failed'
export const PASSWORD_POLICY_ERROR_MESSAGE = 'La contraseña debe cumplir la política de seguridad'
export const PASSWORD_POLICY_GUIDANCE = 'Usá al menos 12 caracteres, incluyendo mayúscula, minúscula, número y carácter especial, sin espacios.'

const allowedSpecialSet = new Set(PASSWORD_POLICY_DESCRIPTOR.allowedSpecialChars.split(''))

export function validatePasswordPolicy(password: string): PasswordPolicyValidationResult {
  if (!password) return { ok: false, reason: 'empty' }
  if (!password.trim()) return { ok: false, reason: 'whitespace_only' }
  if (/\s/.test(password)) return { ok: false, reason: 'contains_whitespace' }
  if (password.length < PASSWORD_POLICY_DESCRIPTOR.minLength) return { ok: false, reason: 'too_short' }
  if (!/[A-Z]/.test(password)) return { ok: false, reason: 'missing_uppercase' }
  if (!/[a-z]/.test(password)) return { ok: false, reason: 'missing_lowercase' }
  if (!/[0-9]/.test(password)) return { ok: false, reason: 'missing_number' }
  if (!password.split('').some((char) => allowedSpecialSet.has(char))) return { ok: false, reason: 'missing_special' }
  return { ok: true }
}

export function buildPasswordPolicyError(reason: PasswordPolicyReason) {
  return {
    error: PASSWORD_POLICY_ERROR_MESSAGE,
    code: PASSWORD_POLICY_ERROR_CODE,
    details: {
      reason,
      message: PASSWORD_POLICY_GUIDANCE,
      policy: PASSWORD_POLICY_DESCRIPTOR,
    },
  }
}
