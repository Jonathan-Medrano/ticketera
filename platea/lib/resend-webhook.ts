import { Webhook } from 'svix'
import type { NextRequest } from 'next/server'

let warnedMissingSecret = false

export type ResendWebhookVerifyResult =
  | { ok: true; mode: 'verified'; payload: unknown }
  | { ok: true; mode: 'skipped'; reason: 'secret_not_configured'; payload: unknown }
  | { ok: false; reason: 'missing_headers' | 'invalid_signature' | 'body_read_error' }

export async function verifyResendWebhook(req: NextRequest): Promise<ResendWebhookVerifyResult> {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim()

  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('RESEND_WEBHOOK_SECRET is required in production')
    }
    if (!warnedMissingSecret) {
      warnedMissingSecret = true
      console.warn(
        '[resend-webhook] RESEND_WEBHOOK_SECRET no configurado — firma no validada en dev.',
      )
    }
    try {
      const payload = await req.json()
      return { ok: true, mode: 'skipped', reason: 'secret_not_configured', payload }
    } catch {
      return { ok: false, reason: 'body_read_error' }
    }
  }

  const svixId = req.headers.get('svix-id')
  const svixTimestamp = req.headers.get('svix-timestamp')
  const svixSignature = req.headers.get('svix-signature')

  if (!svixId || !svixTimestamp || !svixSignature) {
    return { ok: false, reason: 'missing_headers' }
  }

  let body: string
  try {
    body = await req.text()
  } catch {
    return { ok: false, reason: 'body_read_error' }
  }

  try {
    const wh = new Webhook(secret)
    const payload = wh.verify(body, {
      'svix-id': svixId,
      'svix-timestamp': svixTimestamp,
      'svix-signature': svixSignature,
    })
    return { ok: true, mode: 'verified', payload }
  } catch {
    return { ok: false, reason: 'invalid_signature' }
  }
}
