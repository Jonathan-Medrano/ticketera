import { randomInt } from 'node:crypto'

const SAFE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const DEFAULT_CODE_LENGTH = 12

export function generateSecureShortCode(length = DEFAULT_CODE_LENGTH) {
  if (!Number.isInteger(length) || length < 6 || length > 20) {
    throw new Error('Invalid secure code length')
  }

  let code = ''
  for (let i = 0; i < length; i += 1) {
    code += SAFE_ALPHABET[randomInt(0, SAFE_ALPHABET.length)]
  }

  return code
}
