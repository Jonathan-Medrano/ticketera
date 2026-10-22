import { createHash, randomInt, randomUUID } from 'node:crypto'

export type BuyerDeliveryPreference = 'email' | 'whatsapp' | 'both'
export type BuyerDeliveryChannel = 'email' | 'whatsapp'

export const BUYER_PHONE_VERIFICATION_CODE_LENGTH = 6
export const BUYER_PHONE_VERIFICATION_TTL_MINUTES = 10
export const BUYER_PHONE_VERIFICATION_TTL_MS = BUYER_PHONE_VERIFICATION_TTL_MINUTES * 60 * 1000
export const BUYER_PHONE_VERIFICATION_MAX_ATTEMPTS = 5
export const BUYER_PHONE_VERIFICATION_RESEND_COOLDOWN_SECONDS = 60

export type BuyerPhoneVerificationChallengeRecord = {
  id: string
  buyerId: string
  empresaId: string
  phoneE164: string
  provider: string | null
  codeHash: string
  expiresAt: Date
  resendAvailableAt: Date
  maxAttempts: number
}

export function normalizeBuyerPhoneE164(phone: string) {
  const normalized = phone.replace(/[\s()\-]/g, '')
  const withPlus = normalized.startsWith('+') ? normalized : normalized.startsWith('00') ? `+${normalized.slice(2)}` : `+${normalized}`

  if (!/^\+[1-9]\d{7,14}$/.test(withPlus)) {
    throw new Error('Telefono invalido. Debe estar en formato E.164')
  }

  return withPlus
}

export function generateBuyerVerificationCode(length = BUYER_PHONE_VERIFICATION_CODE_LENGTH) {
  let code = ''
  for (let index = 0; index < length; index += 1) {
    code += String(randomInt(0, 10))
  }
  return code
}

export function hashBuyerVerificationCode(challengeId: string, code: string) {
  return createHash('sha256').update(`${challengeId}:${code.trim()}`).digest('hex')
}

export function buildBuyerVerificationChallenge(input: {
  buyerId: string
  empresaId: string
  phone: string
  provider?: string | null
  challengeId?: string
  code?: string
  now?: Date
}) {
  const now = input.now ?? new Date()
  const id = input.challengeId ?? randomUUID()
  const phoneE164 = normalizeBuyerPhoneE164(input.phone)
  const code = input.code ?? generateBuyerVerificationCode()
  const expiresAt = new Date(now.getTime() + BUYER_PHONE_VERIFICATION_TTL_MS)
  const resendAvailableAt = new Date(now.getTime() + BUYER_PHONE_VERIFICATION_RESEND_COOLDOWN_SECONDS * 1000)

  return {
    plainCode: code,
    record: {
      id,
      buyerId: input.buyerId,
      empresaId: input.empresaId,
      phoneE164,
      provider: input.provider ?? null,
      codeHash: hashBuyerVerificationCode(id, code),
      expiresAt,
      resendAvailableAt,
      maxAttempts: BUYER_PHONE_VERIFICATION_MAX_ATTEMPTS,
    } satisfies BuyerPhoneVerificationChallengeRecord,
  }
}

export function resolveBuyerDeliveryChannels(preference: BuyerDeliveryPreference, phoneVerifiedAt: string | Date | null | undefined) {
  if (preference === 'email') {
    return { ok: true as const, channels: ['email'] as BuyerDeliveryChannel[] }
  }

  if (!phoneVerifiedAt) {
    return { ok: false as const, reason: 'phone_not_verified' as const, channels: [] as BuyerDeliveryChannel[] }
  }

  return {
    ok: true as const,
    channels: preference === 'both' ? ['email', 'whatsapp'] as BuyerDeliveryChannel[] : ['whatsapp'] as BuyerDeliveryChannel[],
  }
}
