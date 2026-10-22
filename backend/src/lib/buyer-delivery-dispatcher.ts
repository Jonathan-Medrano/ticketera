import type { MessagingChannel, MessagingSendResult } from './messaging-provider'
import { resolveBuyerDeliveryChannels, type BuyerDeliveryPreference } from './buyer-settings'

export type DeliveryDispatchStatus = 'pending' | 'sent' | 'failed' | 'skipped'
export type DeliveryDispatchBlockedReason = 'phone_not_verified' | 'missing_recipient'

export type DeliveryChannelAdapter = {
  channel: MessagingChannel
  isEnabled(): boolean
  send(input: BuyerDeliveryDispatchInput): Promise<MessagingSendResult>
}

export type BuyerDeliveryDispatchInput = {
  checkoutSessionId: string
  empresaId: string
  buyerId: string | null
  email: string | null
  phoneE164: string | null
  deliveryPreference: BuyerDeliveryPreference
  phoneVerifiedAt: string | Date | null
  metadata?: Record<string, unknown>
}

export type BuyerDeliveryDispatchAttemptContract = {
  checkoutSessionId: string
  buyerId: string | null
  empresaId: string
  channel: MessagingChannel
  recipient: string | null
  status: DeliveryDispatchStatus
  provider: string | null
  errorCode?: string | null
  errorMessage?: string | null
}

export type BuyerDeliveryDispatchPlanChannel = {
  channel: MessagingChannel
  recipient: string | null
  blockedReason?: DeliveryDispatchBlockedReason
}

function buildBlockedAttempt(input: BuyerDeliveryDispatchInput, channel: MessagingChannel, recipient: string | null, reason: DeliveryDispatchBlockedReason): BuyerDeliveryDispatchAttemptContract {
  return {
    checkoutSessionId: input.checkoutSessionId,
    buyerId: input.buyerId,
    empresaId: input.empresaId,
    channel,
    recipient,
    status: 'skipped',
    provider: null,
    errorCode: reason,
    errorMessage: reason === 'phone_not_verified'
      ? 'WhatsApp no pudo enviarse porque el teléfono no está verificado'
      : 'No hay un destinatario válido para este canal',
  }
}

export function buildBuyerDeliveryDispatchPlan(input: BuyerDeliveryDispatchInput) {
  return {
    ok: true as const,
    channels: [
      ...(input.deliveryPreference === 'email' || input.deliveryPreference === 'both'
        ? [{ channel: 'email' as const, recipient: input.email, ...(input.email ? {} : { blockedReason: 'missing_recipient' as const }) }]
        : []),
      ...(input.deliveryPreference === 'whatsapp' || input.deliveryPreference === 'both'
        ? [{
            channel: 'whatsapp' as const,
            recipient: input.phoneE164,
            ...(!input.phoneE164
              ? { blockedReason: 'missing_recipient' as const }
              : !resolveBuyerDeliveryChannels('whatsapp', input.phoneVerifiedAt).ok
                ? { blockedReason: 'phone_not_verified' as const }
                : {}),
          }]
        : []),
    ] satisfies BuyerDeliveryDispatchPlanChannel[],
  }
}

export async function executeBuyerDeliveryDispatch(input: BuyerDeliveryDispatchInput, adapters: DeliveryChannelAdapter[]) {
  const plan = buildBuyerDeliveryDispatchPlan(input)
  const adaptersByChannel = new Map(adapters.map((adapter) => [adapter.channel, adapter]))
  const attempts: BuyerDeliveryDispatchAttemptContract[] = []

  for (const step of plan.channels) {
    if ('blockedReason' in step && step.blockedReason) {
      attempts.push(buildBlockedAttempt(input, step.channel, step.recipient, step.blockedReason))
      continue
    }

    const adapter = adaptersByChannel.get(step.channel)
    if (!adapter || !adapter.isEnabled()) {
      attempts.push({
        checkoutSessionId: input.checkoutSessionId,
        buyerId: input.buyerId,
        empresaId: input.empresaId,
        channel: step.channel,
        recipient: step.recipient,
        status: 'failed',
        provider: null,
        errorCode: 'channel_unavailable',
        errorMessage: `El canal ${step.channel} no está disponible`,
      })
      continue
    }

    let result: MessagingSendResult
    try {
      result = await adapter.send(input)
    } catch (error) {
      result = {
        ok: false,
        provider: step.channel,
        errorCode: 'dispatch_exception',
        errorMessage: error instanceof Error ? error.message : 'No se pudo despachar el canal',
      }
    }

    attempts.push({
      checkoutSessionId: input.checkoutSessionId,
      buyerId: input.buyerId,
      empresaId: input.empresaId,
      channel: step.channel,
      recipient: step.recipient,
      status: result.ok ? 'sent' : 'failed',
      provider: result.provider,
      errorCode: result.errorCode ?? null,
      errorMessage: result.errorMessage ?? null,
    })
  }

  return { ok: true as const, plan: plan.channels, attempts }
}
