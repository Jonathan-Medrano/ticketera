export type MessagingChannel = 'email' | 'whatsapp'

export type MessagingSendResult = {
  ok: boolean
  provider: string
  externalId?: string | null
  retryable?: boolean
  errorCode?: string | null
  errorMessage?: string | null
}

export type MessagingVerificationCodeRequest = {
  buyerId: string
  empresaId: string
  phoneE164: string
  code: string
  expiresAt: Date
}

export type MessagingDeliveryRequest = {
  channel: Extract<MessagingChannel, 'whatsapp'>
  recipient: string
  template: string
  variables?: Record<string, string>
  metadata?: Record<string, unknown>
}

export interface MessagingProvider {
  readonly name: string
  isEnabled(): boolean
  sendVerificationCode(input: MessagingVerificationCodeRequest): Promise<MessagingSendResult>
  sendDeliveryMessage(input: MessagingDeliveryRequest): Promise<MessagingSendResult>
}

export function resolveMessagingProviderEnabled(provider: MessagingProvider | null | undefined) {
  return Boolean(provider?.isEnabled())
}
