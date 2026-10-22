import bcrypt from 'bcryptjs'
import { randomUUID as uuidv4 } from 'node:crypto'
import { prisma, prismaDirectUrl } from './prisma'
import type { MessagingDeliveryRequest, MessagingProvider, MessagingSendResult } from './messaging-provider'
import { resolveMessagingProviderEnabled } from './messaging-provider'
import {
  buildBuyerVerificationChallenge,
  hashBuyerVerificationCode,
  normalizeBuyerPhoneE164,
  resolveBuyerDeliveryChannels,
  type BuyerDeliveryPreference,
} from './buyer-settings'
import { touchPasswordVersion } from './password-version'
import { buildPasswordPolicyError, validatePasswordPolicy } from './password-policy'

type BuyerAccountSnapshot = {
  email: string | null
  name: string | null
  phoneE164: string | null
  phoneVerifiedAt: Date | string | null
  deliveryPreference: BuyerDeliveryPreference
}

type ServiceSuccess<T> = { ok: true; status: number; data: T }
type ServiceFailure = { ok: false; status: number; error: string }
type ServiceResult<T> = ServiceSuccess<T> | ServiceFailure

let messagingProviderOverride: MessagingProvider | null | undefined = undefined

function resolveBuyerMessagingProvider() {
  if (messagingProviderOverride !== undefined) {
    return messagingProviderOverride
  }

  return null
}

export function setBuyerMessagingProviderForTests(provider: MessagingProvider | null | undefined) {
  messagingProviderOverride = provider
}

export function isBuyerMessagingProviderAvailable() {
  return resolveMessagingProviderEnabled(resolveBuyerMessagingProvider())
}

export async function sendBuyerDeliveryWhatsApp(input: MessagingDeliveryRequest): Promise<MessagingSendResult> {
  const provider = resolveBuyerMessagingProvider()
  if (!provider || !resolveMessagingProviderEnabled(provider)) {
    return {
      ok: false,
      provider: provider?.name ?? 'whatsapp',
      retryable: true,
      errorCode: 'provider_unavailable',
      errorMessage: 'WhatsApp no está disponible en este momento',
    }
  }

  return provider.sendDeliveryMessage(input)
}

function asBuyerSnapshot(row: {
  email: string | null
  nombre: string | null
  phone_e164: string | null
  phone_verified_at: Date | null
  delivery_preference: string
}): BuyerAccountSnapshot {
  return {
    email: row.email ?? null,
    name: row.nombre ?? null,
    phoneE164: row.phone_e164 ?? null,
    phoneVerifiedAt: row.phone_verified_at ?? null,
    deliveryPreference: row.delivery_preference === 'whatsapp' || row.delivery_preference === 'both'
      ? row.delivery_preference
      : 'email',
  }
}

export async function getBuyerAccountSnapshot(input: { buyerId: string; empresaId: string }): Promise<ServiceResult<{ buyer: BuyerAccountSnapshot }>> {
  const buyer = await prisma.comprador.findFirst({
    where: { id: input.buyerId, empresa_id: input.empresaId },
    select: { id: true, nombre: true, email: true, password: true, phone_e164: true, phone_verified_at: true, delivery_preference: true },
  })
  if (!buyer) {
    return { ok: false, status: 404, error: 'Comprador no encontrado' }
  }

  return { ok: true, status: 200, data: { buyer: asBuyerSnapshot(buyer) } }
}

export async function changeBuyerPassword(input: {
  buyerId: string
  empresaId: string
  currentPassword: string
  newPassword: string
  confirmPassword: string
}): Promise<ServiceResult<{ ok: true }>> {
  if (!input.currentPassword || !input.newPassword || !input.confirmPassword) {
    return { ok: false, status: 400, error: 'Todos los campos son obligatorios' }
  }

  const validation = validatePasswordPolicy(input.newPassword)
  if (!validation.ok) {
    return { ok: false, status: 400, ...buildPasswordPolicyError(validation.reason) }
  }

  if (input.newPassword !== input.confirmPassword) {
    return { ok: false, status: 400, error: 'Las contraseñas nuevas no coinciden' }
  }

  const buyer = await prisma.comprador.findFirst({
    where: { id: input.buyerId, empresa_id: input.empresaId },
    select: { id: true, password: true },
  })
  if (!buyer || !buyer.password) {
    return { ok: false, status: 404, error: 'Comprador no encontrado' }
  }

  const passwordOk = await bcrypt.compare(input.currentPassword, buyer.password)
  if (!passwordOk) {
    return { ok: false, status: 400, error: 'La contraseña actual es incorrecta' }
  }

  const hash = await bcrypt.hash(input.newPassword, 12)

  await prismaDirectUrl.$transaction(async (tx) => {
    await tx.comprador.update({
      where: { id: input.buyerId },
      data: {
        password: hash,
        // Limpia el flag de rotación forzada. Si el comprador venía de un reset
        // hecho por la empresa, este cambio satisface la obligación.
        must_change_password: false,
        temporary_password_set_at: null,
      },
    })
    await touchPasswordVersion('comprador', input.buyerId, tx)
  })

  return { ok: true, status: 200, data: { ok: true } }
}

export async function requestBuyerWhatsAppCode(input: {
  buyerId: string
  empresaId: string
  phone: string
  now?: Date
}): Promise<ServiceResult<{ phoneE164: string; expiresAt: Date; resendAvailableAt: Date }>> {
  const provider = resolveBuyerMessagingProvider()
  if (!provider || !resolveMessagingProviderEnabled(provider)) {
    return { ok: false, status: 503, error: 'WhatsApp no está disponible en este momento' }
  }

  let phoneE164: string
  try {
    phoneE164 = normalizeBuyerPhoneE164(input.phone)
  } catch (error) {
    return { ok: false, status: 400, error: error instanceof Error ? error.message : 'Telefono invalido' }
  }

  const now = input.now ?? new Date()

  type TxResult =
    | { ok: true; challenge: ReturnType<typeof buildBuyerVerificationChallenge> }
    | { ok: false; status: number; error: string }

  let txResult: TxResult | null = null

  await prismaDirectUrl.$transaction(async (tx) => {
    // FOR UPDATE on compradores
    type BuyerLock = { id: string; phone_e164: string | null }[]
    const buyerRows = await tx.$queryRaw<BuyerLock>`
      SELECT id, phone_e164 FROM compradores
      WHERE id = ${input.buyerId} AND empresa_id = ${input.empresaId}
      LIMIT 1
      FOR UPDATE`

    if (!buyerRows.length) {
      txResult = { ok: false, status: 404, error: 'Comprador no encontrado' }
      return
    }

    // Get active challenges FOR UPDATE
    type ChallengeRow = {
      id: string; phone_e164: string; provider: string | null
      code_hash: string; status: string; attempts_count: number
      max_attempts: number; expires_at: Date; resend_available_at: Date | null
    }[]
    const activeRows = await tx.$queryRaw<ChallengeRow>`
      SELECT id, phone_e164, provider, code_hash, status, attempts_count, max_attempts, expires_at, resend_available_at
      FROM buyer_phone_verification_challenges
      WHERE buyer_id = ${input.buyerId} AND empresa_id = ${input.empresaId}
        AND status = 'pending' AND invalidated_at IS NULL
      ORDER BY created_at DESC
      FOR UPDATE`

    const activeSamePhone = activeRows.find((row) => row.phone_e164 === phoneE164)
    const resendAvailableAt = activeSamePhone?.resend_available_at ? new Date(activeSamePhone.resend_available_at) : null
    if (resendAvailableAt && resendAvailableAt.getTime() > now.getTime()) {
      txResult = { ok: false, status: 429, error: 'Esperá un minuto antes de pedir otro código' }
      return
    }

    if (activeRows.length > 0) {
      await tx.$executeRaw`
        UPDATE buyer_phone_verification_challenges
        SET status = 'invalidated', invalidated_at = ${now}, invalidation_reason = 'replaced'
        WHERE buyer_id = ${input.buyerId} AND empresa_id = ${input.empresaId}
          AND status = 'pending' AND invalidated_at IS NULL`
    }

    if (buyerRows[0].phone_e164 !== phoneE164) {
      await tx.comprador.update({
        where: { id: input.buyerId },
        data: { phone_e164: phoneE164, phone_verified_at: null, phone_verification_provider: null },
      })
    }

    const challenge = buildBuyerVerificationChallenge({
      buyerId: input.buyerId,
      empresaId: input.empresaId,
      phone: phoneE164,
      provider: provider.name,
      now,
    })

    await tx.buyerPhoneVerificationChallenge.create({
      data: {
        id: challenge.record.id,
        buyer_id: challenge.record.buyerId,
        empresa_id: challenge.record.empresaId,
        phone_e164: challenge.record.phoneE164,
        provider: challenge.record.provider,
        code_hash: challenge.record.codeHash,
        max_attempts: challenge.record.maxAttempts,
        expires_at: challenge.record.expiresAt,
        resend_available_at: challenge.record.resendAvailableAt,
      },
    })

    txResult = { ok: true, challenge }
  })

  if (!txResult) {
    return { ok: false, status: 500, error: 'Error interno del servidor' }
  }

  const txResultTyped = txResult as TxResult
  if (!txResultTyped.ok) {
    return txResultTyped
  }

  const successResult = txResultTyped as { ok: true; challenge: ReturnType<typeof buildBuyerVerificationChallenge> }
  const { challenge } = successResult

  const sendResult = await provider.sendVerificationCode({
    buyerId: input.buyerId,
    empresaId: input.empresaId,
    phoneE164,
    code: challenge.plainCode,
    expiresAt: challenge.record.expiresAt,
  })

  if (!sendResult.ok) {
    await prisma.buyerPhoneVerificationChallenge.update({
      where: { id: challenge.record.id },
      data: { status: 'invalidated', invalidated_at: new Date(), invalidation_reason: 'provider_unavailable' },
    })
    return { ok: false, status: 503, error: 'WhatsApp no está disponible en este momento' }
  }

  return {
    ok: true,
    status: 200,
    data: {
      phoneE164,
      expiresAt: challenge.record.expiresAt,
      resendAvailableAt: challenge.record.resendAvailableAt,
    },
  }
}

export async function verifyBuyerWhatsAppCode(input: {
  buyerId: string
  empresaId: string
  phone: string
  code: string
  now?: Date
}): Promise<ServiceResult<{ buyer: BuyerAccountSnapshot }>> {
  const provider = resolveBuyerMessagingProvider()
  if (!provider || !resolveMessagingProviderEnabled(provider)) {
    return { ok: false, status: 503, error: 'WhatsApp no está disponible en este momento' }
  }

  let phoneE164: string
  try {
    phoneE164 = normalizeBuyerPhoneE164(input.phone)
  } catch (error) {
    return { ok: false, status: 400, error: error instanceof Error ? error.message : 'Telefono invalido' }
  }

  if (!input.code || !input.code.trim()) {
    return { ok: false, status: 400, error: 'El código es obligatorio' }
  }

  const now = input.now ?? new Date()

  type BuyerSnapshot = { id: string; email: string | null; nombre: string | null; phone_e164: string | null; phone_verified_at: Date | null; delivery_preference: string }
  type ChallengeRow = {
    id: string; phone_e164: string; provider: string | null
    code_hash: string; status: string; attempts_count: number
    max_attempts: number; expires_at: Date; resend_available_at: Date | null
  }

  type TxResult =
    | { ok: true; buyer: BuyerSnapshot }
    | { ok: false; status: number; error: string }

  let txResult: TxResult | null = null

  await prismaDirectUrl.$transaction(async (tx) => {
    // FOR UPDATE on compradores
    type BuyerLock = BuyerSnapshot[]
    const buyerRows = await tx.$queryRaw<BuyerLock>`
      SELECT id, email, nombre, phone_e164, phone_verified_at, delivery_preference
      FROM compradores
      WHERE id = ${input.buyerId} AND empresa_id = ${input.empresaId}
      LIMIT 1
      FOR UPDATE`

    if (!buyerRows.length) {
      txResult = { ok: false, status: 404, error: 'Comprador no encontrado' }
      return
    }

    // Get challenge FOR UPDATE
    type ChallengeRowArr = ChallengeRow[]
    const challengeRows = await tx.$queryRaw<ChallengeRowArr>`
      SELECT id, phone_e164, provider, code_hash, status, attempts_count, max_attempts, expires_at, resend_available_at
      FROM buyer_phone_verification_challenges
      WHERE buyer_id = ${input.buyerId} AND empresa_id = ${input.empresaId}
        AND phone_e164 = ${phoneE164} AND status = 'pending' AND invalidated_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE`

    const challenge = challengeRows[0]
    if (!challenge) {
      txResult = { ok: false, status: 400, error: 'No hay un código activo para ese teléfono' }
      return
    }

    if (new Date(challenge.expires_at).getTime() <= now.getTime()) {
      await tx.$executeRaw`
        UPDATE buyer_phone_verification_challenges
        SET status = 'expired', invalidated_at = ${now}, invalidation_reason = 'expired'
        WHERE id = ${challenge.id}`
      txResult = { ok: false, status: 400, error: 'El código expiró. Pedí uno nuevo' }
      return
    }

    const expectedHash = hashBuyerVerificationCode(challenge.id, input.code)
    if (expectedHash !== challenge.code_hash) {
      const nextAttempts = Number(challenge.attempts_count ?? 0) + 1
      const exceeded = nextAttempts >= challenge.max_attempts
      await tx.$executeRaw`
        UPDATE buyer_phone_verification_challenges
        SET attempts_count = ${nextAttempts},
            status = ${exceeded ? 'invalidated' : challenge.status},
            invalidated_at = ${exceeded ? now : null},
            invalidation_reason = ${exceeded ? 'max_attempts' : null}
        WHERE id = ${challenge.id}`
      txResult = { ok: false, status: 400, error: 'El código es inválido' }
      return
    }

    await tx.$executeRaw`
      UPDATE buyer_phone_verification_challenges
      SET status = 'verified', verified_at = ${now}, attempts_count = attempts_count + 1
      WHERE id = ${challenge.id}`

    await tx.$executeRaw`
      UPDATE buyer_phone_verification_challenges
      SET status = 'invalidated', invalidated_at = ${now}, invalidation_reason = 'verified_elsewhere'
      WHERE buyer_id = ${input.buyerId} AND empresa_id = ${input.empresaId}
        AND id != ${challenge.id} AND status = 'pending' AND invalidated_at IS NULL`

    await tx.comprador.update({
      where: { id: input.buyerId },
      data: {
        phone_e164: phoneE164,
        phone_verified_at: now,
        phone_verification_provider: challenge.provider ?? provider.name,
      },
    })

    // Re-read updated buyer inside tx (FOR UPDATE)
    const updatedRows = await tx.$queryRaw<BuyerLock>`
      SELECT id, email, nombre, phone_e164, phone_verified_at, delivery_preference
      FROM compradores
      WHERE id = ${input.buyerId} AND empresa_id = ${input.empresaId}
      LIMIT 1
      FOR UPDATE`

    txResult = { ok: true, buyer: updatedRows[0] }
  })

  if (!txResult) {
    return { ok: false, status: 500, error: 'Error interno del servidor' }
  }

  const txResult2 = txResult as TxResult
  if (!txResult2.ok) {
    return txResult2 as ServiceFailure
  }

  const { buyer } = txResult2 as { ok: true; buyer: BuyerSnapshot }
  return { ok: true, status: 200, data: { buyer: asBuyerSnapshot(buyer) } }
}

export async function updateBuyerDeliveryPreference(input: {
  buyerId: string
  empresaId: string
  deliveryPreference: string
}): Promise<ServiceResult<{ buyer: BuyerAccountSnapshot }>> {
  if (input.deliveryPreference !== 'email' && input.deliveryPreference !== 'whatsapp' && input.deliveryPreference !== 'both') {
    return { ok: false, status: 400, error: 'deliveryPreference debe ser email, whatsapp o both' }
  }

  type BuyerLock = {
    id: string; email: string | null; nombre: string | null
    phone_e164: string | null; phone_verified_at: Date | null; delivery_preference: string
  }[]

  type TxResult =
    | { ok: true; buyer: BuyerLock[0] }
    | { ok: false; status: number; error: string }

  let txResult: TxResult | null = null

  await prismaDirectUrl.$transaction(async (tx) => {
    const buyerRows = await tx.$queryRaw<BuyerLock>`
      SELECT id, email, nombre, phone_e164, phone_verified_at, delivery_preference
      FROM compradores
      WHERE id = ${input.buyerId} AND empresa_id = ${input.empresaId}
      LIMIT 1
      FOR UPDATE`

    if (!buyerRows.length) {
      txResult = { ok: false, status: 404, error: 'Comprador no encontrado' }
      return
    }

    const buyer = buyerRows[0]
    const resolution = resolveBuyerDeliveryChannels(input.deliveryPreference as BuyerDeliveryPreference, buyer.phone_verified_at)
    if (!resolution.ok) {
      txResult = { ok: false, status: 400, error: 'Verificá tu WhatsApp antes de elegir ese canal de entrega' }
      return
    }

    await tx.comprador.update({
      where: { id: input.buyerId },
      data: { delivery_preference: input.deliveryPreference },
    })

    // Re-read updated buyer
    const updatedRows = await tx.$queryRaw<BuyerLock>`
      SELECT id, email, nombre, phone_e164, phone_verified_at, delivery_preference
      FROM compradores
      WHERE id = ${input.buyerId} AND empresa_id = ${input.empresaId}
      LIMIT 1
      FOR UPDATE`

    txResult = { ok: true, buyer: updatedRows[0] }
  })

  if (!txResult) {
    return { ok: false, status: 500, error: 'Error interno del servidor' }
  }

  const txResult3 = txResult as TxResult
  if (!txResult3.ok) {
    return txResult3 as ServiceFailure
  }

  const { buyer } = txResult3 as { ok: true; buyer: NonNullable<BuyerLock[0]> }
  return { ok: true, status: 200, data: { buyer: asBuyerSnapshot(buyer) } }
}
