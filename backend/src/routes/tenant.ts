import { Router, Request, Response } from 'express'
import { prisma, prismaDirectUrl } from '../lib/prisma'
import { roundMoney } from '../lib/money'
import { type Prisma } from '@prisma/client'
import { getRequestIp, getRequestUserAgent, verifyInternal, requireAuth } from '../middleware/auth'
import { randomUUID as uuidv4, createHmac, timingSafeEqual } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { Resend } from 'resend'
import { Preference, Payment } from 'mercadopago'
import { consumePasswordReset, requestPasswordReset } from '../lib/password-reset'
import { resolveMarketplaceFee, type MarketplaceFeeMetadata } from '../lib/marketplace-fee'
import { normalizeFeeBillingMode, resolveBuyerFeeFraction, type FeeBillingMode } from '../lib/fee-billing'
import { getMercadoPagoClientByEmpresaId } from '../lib/payment-accounts'
import { getPlatformOwnerCollectorId } from '../lib/platform-owner-payment-account'
import { assertCanSell, getSalesReadiness, SalesReadinessError, type SalesReadiness } from '../lib/sales-readiness'
import { requireUserType } from '../lib/authz'
import { logEvent, logServerError } from '../lib/safe-log'
import { dispatchHadAnySuccess, markDeliveryFailed, markDeliverySucceeded } from '../lib/delivery-retry'
import { buildPasswordPolicyError, validatePasswordPolicy } from '../lib/password-policy'
import { assertBuyerEmailAvailable, ensureIdentityConstraints } from '../lib/identity-constraints'
import { generateSecureShortCode } from '../lib/secure-code'
import { getTenantConsumiblesCatalog } from '../lib/consumibles-public-flow'
import { persistPlatformAllocations, resolvePlatformAllocations } from '../lib/platform-profit-sharing'
import { resolvePublicSupportFaqCollection } from '../lib/support-faqs'
import { releaseStockForCheckoutSession } from '../services/checkoutCleanup'
import { buildEventPublicationSnapshot, type EventPublicationSource } from '../lib/event-publication'
import { createSensitiveRateLimit } from '../lib/auth-rate-limit'
import {
  changeBuyerPassword,
  getBuyerAccountSnapshot,
  isBuyerMessagingProviderAvailable,
  requestBuyerWhatsAppCode,
  sendBuyerDeliveryWhatsApp,
  updateBuyerDeliveryPreference,
  verifyBuyerWhatsAppCode,
} from '../lib/buyer-settings-service'
import {
  executeBuyerDeliveryDispatch,
  type BuyerDeliveryDispatchAttemptContract,
  type BuyerDeliveryDispatchInput,
  type DeliveryChannelAdapter,
} from '../lib/buyer-delivery-dispatcher'
import {
  createBuyerConsumibleRefundRequest,
  createBuyerEventRefundRequest,
  normalizeBuyerAutomaticRefundMode,
  shouldAutoRefundBuyerFlow,
} from '../lib/refund-manual'

const TENANT_BASE_DOMAIN = process.env.TENANT_BASE_URL ?? 'https://ticketera.com'

function buildTenantBaseUrl(slug: string) {
  const isDev = process.env.NODE_ENV === 'development'
  if (isDev) return `http://${slug}.localhost:3000`
  const url = new URL(TENANT_BASE_DOMAIN)
  return `${url.protocol}//${slug}.${url.host}`
}

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

function getFromEmail(): string {
  const from = process.env.RESEND_FROM_EMAIL
  if (!from && process.env.NODE_ENV === 'production') {
    throw new Error('RESEND_FROM_EMAIL is required in production')
  }
  return from ?? 'onboarding@resend.dev'
}

const resendFromEmail = getFromEmail()
const HARD_LIMIT = 500
const CHECKOUT_RESERVA_MINUTOS = 15
const MAX_ACTIVE_CHECKOUT_SESSIONS_PER_BUYER = 2
const MAX_RESERVED_ENTRIES_PER_BUYER = 10
const MAX_RESERVED_CONSUMIBLES_PER_BUYER = 30

// P2034 = serialization failure — retry on high-contention paths (checkout + webhook confirmation).
async function withSerializableRetry<T>(
  fn: () => Promise<T>,
  opts: { retries?: number; backoffMs?: number } = {},
): Promise<T> {
  const { retries = 3, backoffMs = 50 } = opts
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn()
    } catch (err: unknown) {
      const code = (err as { code?: string } | null | undefined)?.code
      if (code === 'P2034' && attempt < retries) {
        await new Promise((r) => setTimeout(r, backoffMs * (attempt + 1)))
        continue
      }
      throw err
    }
  }
  throw new Error('unreachable')
}

// Checkout mixto (Fase 3): el mp_fee_amount es el fee de PROCESAMIENTO de Mercado
// Pago sobre el pago COMPLETO (un solo Payment para todo el carrito mixto). Hay
// que prorratearlo entre el dominio entradas y el de consumibles por peso de
// subtotal ANTES de distribuirlo entrada-a-entrada / venta-a-venta — si no, cada
// dominio le asignaría el 100% del mp_fee y la plata no cerraría (doble conteo).
// La porción de consumibles se calcula por resta (no por su propio ratio) para
// garantizar que entradas + consumibles === mpFeeAmount exacto, sin perder
// centavos por redondeo independiente de cada porción.
export function prorateMixtoMpFee(
  mpFeeAmount: number,
  pesoEntradas: number,
  pesoConsumibles: number,
): { entradas: number; consumibles: number } {
  const pesoTotal = pesoEntradas + pesoConsumibles
  if (pesoTotal <= 0) return { entradas: 0, consumibles: 0 }
  const entradas = roundMoney(mpFeeAmount * pesoEntradas / pesoTotal)
  const consumibles = roundMoney(Math.max(mpFeeAmount - entradas, 0))
  return { entradas, consumibles }
}

function normalizeRateLimitValue(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

const buyerAccountPasswordRateLimit = createSensitiveRateLimit({
  prefix: 'tenant-buyer-account-password',
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Demasiados intentos para cambiar la contraseña, intentá nuevamente en 15 minutos' },
  getIdentifier: (req) => normalizeRateLimitValue(req.user?.id) || normalizeRateLimitValue(req.requestMeta?.ip),
})

const buyerAccountWhatsappRequestRateLimit = createSensitiveRateLimit({
  prefix: 'tenant-buyer-whatsapp-request',
  windowMs: 15 * 60 * 1000,
  max: 3,
  message: { error: 'Demasiados pedidos de código, esperá unos minutos antes de reintentar' },
  // Limitar por user_id únicamente — sin incluir phone — para que cambiar el
  // teléfono en el body no evada el rate limit (bypass fue posible antes).
  getIdentifier: (req) => normalizeRateLimitValue(req.user?.id),
})

const buyerAccountWhatsappVerifyRateLimit = createSensitiveRateLimit({
  prefix: 'tenant-buyer-whatsapp-verify',
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: { error: 'Demasiados intentos de verificación, esperá unos minutos antes de reintentar' },
  getIdentifier: (req) => `${normalizeRateLimitValue(req.user?.id)}:${normalizeRateLimitValue(req.body?.phone)}`,
})

const paymentWebhookRateLimit = createSensitiveRateLimit({
  prefix: 'tenant-payment-webhook',
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Demasiados webhooks, intentá nuevamente en unos minutos' },
  getIdentifier: (req) => {
    const slug = normalizeRateLimitValue(req.params.slug)
    const paymentId = normalizeRateLimitValue(req.body?.data?.id ?? req.query['data.id'] ?? req.query.id)
    return `${slug}:${paymentId || normalizeRateLimitValue(req.requestMeta?.ip)}`
  },
})

/**
 * Verifies the Mercado Pago webhook signature.
 * Header format: x-signature: ts=<timestamp>,v1=<hmac_sha256>
 * Manifest: id:<dataId>;request-id:<xRequestId>;ts:<ts>
 */
function verifyMercadoPagoSignature(
  dataId: string | number,
  xRequestId: string | undefined,
  xSignature: string | undefined,
  secret: string,
): boolean {
  if (!xSignature) return false

  // Parse ts and v1 from header
  const parts: Record<string, string> = {}
  for (const part of xSignature.split(',')) {
    const idx = part.indexOf('=')
    if (idx !== -1) {
      parts[part.slice(0, idx).trim()] = part.slice(idx + 1).trim()
    }
  }
  const ts = parts['ts']
  const v1 = parts['v1']
  if (!ts || !v1) return false

  // Build manifest string
  const xReqId = xRequestId ?? ''
  const manifest = `id:${dataId};request-id:${xReqId};ts:${ts}`

  // Compute HMAC-SHA256
  const computed = createHmac('sha256', secret).update(manifest).digest('hex')

  // Timing-safe comparison (buffers must be same length)
  const computedBuf = Buffer.from(computed)
  const v1Buf = Buffer.from(v1)
  if (computedBuf.length !== v1Buf.length) return false
  return timingSafeEqual(computedBuf, v1Buf)
}

/**
 * Resolve a fully-public tenant by slug (active, not disabled, not suspended).
 * slug stored lowercase per design — always normalise before querying.
 */
async function findPublicTenant(slug: string, options?: { allowSuspended?: boolean }) {
  return prisma.empresa.findFirst({
    where: {
      slug: slug.trim().toLowerCase(), // slug stored lowercase per design
      activa: true,
      aprobada: true, // empresa pendiente de aprobación = sitio cerrado al público
      tenant_public_disabled: false,
      ...(options?.allowSuspended ? {} : { suspendido: false }),
    },
    select: { id: true, suspendido: true, nombre: true, mp_max_installments: true, fee_billing_mode: true, fee_split_buyer_pct: true },
  })
}

function rejectTenantActorMismatch(req: Request, res: Response, slug: string) {
  if (req.requestMeta?.actorKind === 'buyer' && req.requestMeta.tenantSlug && req.requestMeta.tenantSlug !== slug) {
    res.status(401).json({ error: 'La sesión comprador no corresponde a este tenant' })
    return true
  }

  return false
}

async function resolveTenantBuyerAccountContext(req: Request, res: Response) {
  const { slug } = req.params
  if (rejectTenantActorMismatch(req, res, slug)) return null

  const user = req.user!
  if (!requireUserType(user, ['comprador'], res, 'No autorizado')) return null
  if (!user.id || !user.empresa_slug || user.empresa_slug !== slug) {
    res.status(401).json({ error: 'No autorizado' })
    return null
  }

  const empresa = await findPublicTenant(slug)

  if (!empresa) {
    res.status(404).json({ error: 'Empresa no encontrada' })
    return null
  }

  return {
    slug,
    buyerId: String(user.id),
    empresaId: String(empresa.id),
  }
}

type PublicSupportFaq = {
  id: string
  question: string
  answer: string
  hidden: boolean
}

function buildTenantAppUrl(slug: string, path: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return new URL(`/t/${slug}${normalizedPath}`, baseUrl).toString()
}

function buildQrImageUrl(value: string) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(value)}`
}

function buildEmailActionButton(label: string, href: string) {
  return `
    <div style="margin:20px 0 8px;">
      <a href="${href}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:999px;font-weight:600;">
        ${label}
      </a>
    </div>
  `
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildEntradasEmailHtml(compradorNombre: string | null | undefined, slug: string, entradas: DeliveryEntryReceipt[]) {
  const ticketsUrl = buildTenantAppUrl(slug, '/mis-tickets?success=1')
  const entradasHtml = entradas
    .map(
      (entrada) => `
        <div style="border:1px solid #eee;border-radius:8px;padding:16px;margin-bottom:12px;">
          <p style="font-weight:bold;margin:0">${escHtml(entrada.evento)}</p>
          <p style="color:#666;margin:4px 0">${escHtml(entrada.categoria)}</p>
          <div style="background:#fff;padding:12px;border-radius:12px;width:max-content;margin:12px auto;">
            <img src="${buildQrImageUrl(entrada.qrCode)}" alt="QR de acceso" width="180" height="180" style="display:block;" />
          </div>
          <p style="margin:8px 0">Clave de acceso: <strong style="font-size:18px;letter-spacing:2px">${escHtml(entrada.claveCorta)}</strong></p>
        </div>
      `,
    )
    .join('')

  return {
    subject: '¡Tus entradas están listas!',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>¡Hola ${compradorNombre ? escHtml(compradorNombre) : '!'}</h2>
        <p>Tu compra fue exitosa y ya quedó confirmada. Acá están tus entradas:</p>
        ${entradasHtml}
        ${buildEmailActionButton('Ver mis tickets en la web', ticketsUrl)}
        <p style="color:#666;font-size:13px">Mostrá el código QR o la clave de acceso en la puerta del evento. También podés volver a ver todo desde Mis tickets.</p>
      </div>
    `,
    actionUrl: ticketsUrl,
  }
}

function buildConsumiblesEmailHtml(compradorNombre: string | null | undefined, slug: string, ventas: DeliveryConsumibleReceipt[]) {
  const consumiblesUrl = buildTenantAppUrl(slug, '/mis-tickets?tab=consumibles&success=1')
  const ventasHtml = ventas
    .map(
      (venta) => `
        <div style="border:1px solid #eee;border-radius:8px;padding:16px;margin-bottom:12px;">
          <p style="font-weight:bold;margin:0">${escHtml(venta.barra)}</p>
          <p style="color:#666;margin:4px 0">Total: $${(venta.total ?? 0).toLocaleString('es-AR')}</p>
          <div style="background:#fff;padding:12px;border-radius:12px;width:max-content;margin:12px auto;">
            <img src="${buildQrImageUrl(venta.qrCode)}" alt="QR de canje" width="180" height="180" style="display:block;" />
          </div>
          <p style="margin:8px 0">Clave de canje: <strong style="font-size:18px;letter-spacing:2px">${escHtml(venta.claveCorta)}</strong></p>
        </div>
      `,
    )
    .join('')

  return {
    subject: '¡Tus consumibles están listos!',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>¡Hola ${compradorNombre ? escHtml(compradorNombre) : '!'}</h2>
        <p>Tu compra de consumibles fue exitosa y ya quedó confirmada. Tenés un QR por barra:</p>
        ${ventasHtml}
        ${buildEmailActionButton('Ver mis consumibles en la web', consumiblesUrl)}
        <p style="color:#666;font-size:13px">Mostrá el QR o la clave en la barra correspondiente. También podés volver a verlos desde Mis consumibles.</p>
      </div>
    `,
    actionUrl: consumiblesUrl,
  }
}

function buildEmpresaSaleNotificationHtml(params: {
  empresaNombre: string
  compradorLabel: string
  flow: 'entradas' | 'consumibles' | 'mixto'
  items: Array<{ nombre: string; cantidad: number; precioUnitario: number }>
  total: number
  fecha: Date
}) {
  const { empresaNombre, compradorLabel, flow, items, total, fecha } = params
  const dashboardUrl = (process.env.NEXT_PUBLIC_APP_URL ?? 'https://app.ticketera.ar') + '/dashboard'
  const fmtArs = (n: number) =>
    new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(n)
  const totalItems = items.reduce((acc, i) => acc + i.cantidad, 0)
  const tipoLabel = flow === 'consumibles' ? 'consumible(s)' : flow === 'mixto' ? 'entrada(s) y consumible(s)' : 'entrada(s)'
  const fechaAr = fecha.toLocaleString('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const itemsHtml = items
    .map(
      (item) => `
        <tr>
          <td style="padding:6px 8px 6px 0;border-bottom:1px solid #f0f0f0">${escHtml(item.nombre)}</td>
          <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;text-align:center">${item.cantidad}</td>
          <td style="padding:6px 0 6px 8px;border-bottom:1px solid #f0f0f0;text-align:right;font-family:monospace">${escHtml(fmtArs(item.precioUnitario))}</td>
        </tr>
      `,
    )
    .join('')

  return {
    subject: `Nueva venta — ${escHtml(empresaNombre)}`,
    html: `
      <div style="font-family:sans-serif;max-width:520px;margin:0 auto">
        <h2 style="margin-bottom:4px">¡Vendiste ${totalItems} ${tipoLabel}!</h2>
        <p style="color:#555;margin-top:0">Comprador: <strong>${escHtml(compradorLabel)}</strong></p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <thead>
            <tr>
              <th style="text-align:left;padding:6px 8px 6px 0;border-bottom:2px solid #e5e7eb">Categoría / Producto</th>
              <th style="text-align:center;padding:6px 8px;border-bottom:2px solid #e5e7eb">Cant.</th>
              <th style="text-align:right;padding:6px 0 6px 8px;border-bottom:2px solid #e5e7eb">Precio unit.</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
          <tfoot>
            <tr>
              <td colspan="2" style="padding:10px 8px 6px 0"><strong>Total cobrado</strong></td>
              <td style="padding:10px 0 6px 8px;text-align:right;font-family:monospace"><strong>${escHtml(fmtArs(total))}</strong></td>
            </tr>
          </tfoot>
        </table>
        <p style="color:#9ca3af;font-size:13px;margin-top:0">Fecha: ${fechaAr}</p>
        ${buildEmailActionButton('Ver en el dashboard →', dashboardUrl)}
      </div>
    `,
  }
}

async function sendSaleNotificationToEmpresa(sessionId: string): Promise<void> {
  if (!resend) return
  try {
    const rows = await prisma.$queryRaw<{
      empresa_email: string | null
      empresa_nombre: string
      datos: string
      confirmed_at: Date | null
      comprador_email: string
      comprador_nombre: string | null
    }[]>`
      SELECT
        e.email       AS empresa_email,
        e.nombre      AS empresa_nombre,
        cs.datos,
        cs.confirmed_at,
        c.email       AS comprador_email,
        c.nombre      AS comprador_nombre
      FROM checkout_sessions cs
      JOIN empresas    e ON e.id = cs.empresa_id
      JOIN compradores c ON c.id = cs.comprador_id
      WHERE cs.id = ${sessionId}
      LIMIT 1
    `
    const row = rows[0]
    if (!row?.empresa_email) return

    const sessionData = parseCheckoutSessionData(row.datos)
    const flow = getCheckoutFlow(sessionData)

    // 'mixto' no tiene un único `.items` — combinamos ambas listas (entradas primero,
    // luego consumibles) para el resumen de la notificación a la empresa.
    const items =
      sessionData.flow === 'mixto'
        ? [
            ...sessionData.itemsEntradas.map((i) => ({
              nombre: i.categoriaNombre,
              cantidad: Number(i.cantidad),
              precioUnitario: Number(i.precio),
            })),
            ...sessionData.itemsConsumibles.map((i) => ({
              nombre: i.nombre,
              cantidad: Number(i.cantidad),
              precioUnitario: Number(i.precio),
            })),
          ]
        : flow === 'consumibles'
          ? (sessionData.items as ConsumibleCheckoutItem[]).map((i) => ({
              nombre: i.nombre,
              cantidad: Number(i.cantidad),
              precioUnitario: Number(i.precio),
            }))
          : (sessionData.items as CheckoutItem[]).map((i) => ({
              nombre: i.categoriaNombre,
              cantidad: Number(i.cantidad),
              precioUnitario: Number(i.precio),
            }))

    const total = items.reduce((acc, i) => acc + i.precioUnitario * i.cantidad, 0)
    const compradorLabel = row.comprador_nombre?.trim() || row.comprador_email

    const { subject, html } = buildEmpresaSaleNotificationHtml({
      empresaNombre: row.empresa_nombre,
      compradorLabel,
      flow,
      items,
      total,
      fecha: row.confirmed_at ? new Date(row.confirmed_at) : new Date(),
    })

    await resend.emails.send({
      from: resendFromEmail,
      to: row.empresa_email,
      subject,
      html,
    })
  } catch {
    // Fire-and-forget: never propagate errors; the webhook already succeeded
  }
}

async function persistDeliveryDispatchAttempts(attempts: BuyerDeliveryDispatchAttemptContract[], payloadJson: string) {
  if (!attempts.length) return

  await prisma.deliveryDispatchAttempt.createMany({
    data: attempts.map((attempt) => ({
      id: uuidv4(),
      checkout_session_id: attempt.checkoutSessionId,
      buyer_id: attempt.buyerId,
      empresa_id: attempt.empresaId,
      channel: attempt.channel,
      status: attempt.status,
      provider: attempt.provider ?? null,
      recipient: attempt.recipient ?? null,
      error_code: attempt.errorCode ?? null,
      error_message: attempt.errorMessage ?? null,
      payload_json: payloadJson,
      dispatched_at: attempt.status === 'sent' ? new Date() : null,
    })),
  })
}

export async function dispatchBuyerPurchaseDelivery(input: {
  slug: string
  flow: CheckoutFlow
  session: CheckoutSessionRow
  entradas: DeliveryEntryReceipt[]
  ventas: DeliveryConsumibleReceipt[]
}): Promise<{ preference: 'email' | 'whatsapp' | 'both'; attempts: BuyerDeliveryDispatchAttemptContract[] }> {
  const deliveryPreference = input.session.delivery_preference === 'whatsapp' || input.session.delivery_preference === 'both'
    ? input.session.delivery_preference
    : 'email'
  const emailContent = input.flow === 'consumibles'
    ? buildConsumiblesEmailHtml(input.session.comprador_nombre, input.slug, input.ventas)
    : buildEntradasEmailHtml(input.session.comprador_nombre, input.slug, input.entradas)
  const payload = {
    flow: input.flow,
    slug: input.slug,
    preference: deliveryPreference,
    actionUrl: emailContent.actionUrl,
    entradas: input.entradas,
    ventas: input.ventas,
  }
  const dispatchInput: BuyerDeliveryDispatchInput = {
    checkoutSessionId: input.session.id,
    empresaId: String(input.session.empresa_id),
    buyerId: input.session.comprador_id ? String(input.session.comprador_id) : null,
    email: input.session.email ?? null,
    phoneE164: input.session.phone_e164 ?? null,
    deliveryPreference,
    phoneVerifiedAt: input.session.phone_verified_at ?? null,
    metadata: payload,
  }
  const adapters: DeliveryChannelAdapter[] = [
    {
      channel: 'email',
      isEnabled: () => Boolean(resend),
      async send(currentInput) {
        if (!resend || !currentInput.email) {
          return {
            ok: false,
            provider: 'resend',
            errorCode: !currentInput.email ? 'missing_recipient' : 'provider_unavailable',
            errorMessage: !currentInput.email ? 'No hay email disponible para la entrega' : 'Email no está disponible en este momento',
          }
        }

        await resend.emails.send({
          from: resendFromEmail,
          to: currentInput.email,
          subject: emailContent.subject,
          html: emailContent.html,
        })

        return { ok: true, provider: 'resend' }
      },
    },
    {
      channel: 'whatsapp',
      isEnabled: () => isBuyerMessagingProviderAvailable(),
      async send(currentInput) {
        if (!currentInput.phoneE164) {
          return {
            ok: false,
            provider: 'whatsapp',
            errorCode: 'missing_recipient',
            errorMessage: 'No hay teléfono disponible para la entrega',
          }
        }

        return sendBuyerDeliveryWhatsApp({
          channel: 'whatsapp',
          recipient: currentInput.phoneE164,
          template: currentInput.metadata?.flow === 'consumibles' ? 'buyer-consumables-delivery' : 'buyer-ticket-delivery',
          variables: {
            buyer_name: input.session.comprador_nombre ?? 'Comprador',
            action_url: emailContent.actionUrl,
            item_count: String(input.flow === 'consumibles' ? input.ventas.length : input.entradas.length),
          },
          metadata: {
            checkout_session_id: currentInput.checkoutSessionId,
            slug: input.slug,
            flow: input.flow,
          },
        })
      },
    },
  ]

  const dispatchResult = await executeBuyerDeliveryDispatch(dispatchInput, adapters)
  await persistDeliveryDispatchAttempts(dispatchResult.attempts, JSON.stringify(payload))

  return {
    preference: deliveryPreference,
    attempts: dispatchResult.attempts,
  }
}

export function isDuplicateEntryError(error: unknown): boolean {
  const code = (error as { code?: string } | null | undefined)?.code
  return code === 'P2002'
}

function isOpenRefundRequestStatus(status: unknown) {
  return status === 'requested' || status === 'under_review' || status === 'approved_for_manual_execution'
}

export type CheckoutItem = {
  categoriaId: string
  eventoId: string
  eventoNombre: string
  categoriaNombre: string
  fechaId?: string | null
  precio: number
  cantidad: number
  datos?: {
    nombre?: string
    apellido?: string
    dni?: string
  }
  // Seated events: id of the specific seat in the asientos table
  asiento_id?: string | null
}

type ConsumibleCheckoutItem = {
  barraId: string
  barraNombre: string
  consumibleId: string
  nombre: string
  precio: number
  cantidad: number
  eventoId: string
  eventoNombre: string
}

type CheckoutFlow = 'entradas' | 'consumibles' | 'mixto'

type TicketCheckoutAddon = {
  id: string
  nombre: string
  precio: number
  cantidad: number
  eventoId: string
}

type TicketCheckoutSessionData = {
  flow?: 'entradas'
  items: CheckoutItem[]
  addons?: TicketCheckoutAddon[]
  marketplaceFee: CheckoutSessionMarketplaceFee | null
  feeBillingMode?: FeeBillingMode
  // Fracción del fee que paga el comprador, p ∈ [0,1] (auditoría/debug del split).
  feeBuyerFraction?: number
  confirmationToken?: string
  // Seated events: the UUID used to reserve seats in the asientos table (set by BFF before checkout)
  seat_reservation_id?: string | null
}

type ConsumiblesCheckoutSessionData = {
  flow: 'consumibles'
  items: ConsumibleCheckoutItem[]
  marketplaceFee: CheckoutSessionMarketplaceFee | null
  feeBillingMode?: FeeBillingMode
  // Fracción del fee que paga el comprador, p ∈ [0,1] (auditoría/debug del split).
  feeBuyerFraction?: number
  confirmationToken?: string
}

type CheckoutSessionMarketplaceFee = {
  amount: number
  currency: string
  metadata: MarketplaceFeeMetadata
}

// Fase 3 — checkout combinado entradas+addons+consumibles en un solo carrito con
// UNA sola preferencia de Mercado Pago. v1 deliberadamente NO soporta asientos
// numerados (seat_reservation_id) ni códigos de descuento (codigo_descuento) — esos
// campos están ausentes de este tipo A PROPÓSITO para que el compilador los excluya
// en vez de soportarlos a medias.
//
// Dos snapshots de fee separados (uno por dominio), NUNCA un único monto combinado:
// confirmarPagoLogic distribuye cada uno con su propia fórmula (distributeMarketplaceFeeByEntry
// para entradas, distributeMarketplaceFeeByTotal para consumibles), cada uno resuelto vía su
// propia llamada a resolveMarketplaceFee(empresaId, subtotalDelDominio, flowDelDominio).
type MixtoCheckoutSessionData = {
  flow: 'mixto'
  itemsEntradas: CheckoutItem[]
  addons?: TicketCheckoutAddon[]
  itemsConsumibles: ConsumibleCheckoutItem[]
  marketplaceFeeEntradas: CheckoutSessionMarketplaceFee | null
  marketplaceFeeConsumibles: CheckoutSessionMarketplaceFee | null
  feeBillingMode?: FeeBillingMode
  // Fracción del fee que paga el comprador, p ∈ [0,1] (auditoría/debug del split).
  feeBuyerFraction?: number
  confirmationToken?: string
}

export type CheckoutSessionData = TicketCheckoutSessionData | ConsumiblesCheckoutSessionData | MixtoCheckoutSessionData

export type CheckoutSessionRow = {
  id: string
  comprador_id: string
  empresa_id: string
  datos: string | CheckoutItem[] | CheckoutSessionData
  estado?: 'reservada' | 'confirmada' | 'expirada' | 'cancelada'
  expires_at?: string | Date | null
  confirmed_at?: string | Date | null
  email?: string
  comprador_nombre?: string
  phone_e164?: string | null
  phone_verified_at?: string | Date | null
  delivery_preference?: 'email' | 'whatsapp' | 'both' | null
}

export type DeliveryEntryReceipt = { qrCode: string; claveCorta: string; categoria: string; evento: string }
export type DeliveryConsumibleReceipt = { qrCode: string; claveCorta: string; barra: string; total: number }

function buildPublicSalesReadiness(readiness: SalesReadiness) {
  return {
    status: readiness.status,
    reason: readiness.reason,
    can_sell: readiness.canSell,
  }
}

function buildPublicationHiddenDetailError() {
  return { error: 'Evento no encontrado' }
}

function buildPublicationCheckoutError(eventoNombre: string) {
  return {
    error: `El evento "${eventoNombre}" todavía no está disponible para compra pública`,
  }
}

function serializeTenantPublicEvent<T extends Record<string, unknown> & EventPublicationSource>(row: T) {
  return {
    ...row,
    ...buildEventPublicationSnapshot(row),
  }
}

function resolvePublicSupportFaqs(value: unknown): PublicSupportFaq[] {
  return resolvePublicSupportFaqCollection(value)
}

// Testimonios (bloque home_sections) pueden vincularse opcionalmente a un evento
// pasado del propio tenant vía `evento_id`. Extrae esos IDs del JSON crudo de
// home_sections (persistido como texto) para resolverlos en la ruta pública —
// sin validar existencia acá, eso es responsabilidad del caller.
function extractTestimonioEventoIds(homeSectionsRaw: unknown): string[] {
  if (typeof homeSectionsRaw !== 'string' || !homeSectionsRaw) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(homeSectionsRaw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const ids = new Set<string>()
  for (const section of parsed) {
    if (!section || typeof section !== 'object' || (section as Record<string, unknown>).type !== 'testimonios') continue
    const testimonios = (section as Record<string, unknown>).testimonios
    if (!Array.isArray(testimonios)) continue
    for (const testimonio of testimonios) {
      if (!testimonio || typeof testimonio !== 'object') continue
      const eventoId = (testimonio as Record<string, unknown>).evento_id
      if (typeof eventoId === 'string' && eventoId.trim()) ids.add(eventoId.trim())
    }
  }
  return Array.from(ids)
}

export function parseCheckoutSessionData(raw: string | CheckoutItem[] | CheckoutSessionData): CheckoutSessionData {
  const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw

  if (Array.isArray(parsed)) {
    return {
      items: parsed,
      marketplaceFee: null,
    }
  }

  const marketplaceFee = parsed?.marketplaceFee ?? null
  const confirmationToken = typeof parsed?.confirmationToken === 'string' ? parsed.confirmationToken : undefined
  const feeBillingMode = parsed?.feeBillingMode
  const feeBuyerFraction = typeof parsed?.feeBuyerFraction === 'number' ? parsed.feeBuyerFraction : undefined

  if (parsed?.flow === 'consumibles') {
    return {
      flow: 'consumibles',
      items: Array.isArray(parsed?.items) ? parsed.items : [],
      marketplaceFee,
      feeBillingMode,
      feeBuyerFraction,
      confirmationToken,
    }
  }

  if (parsed?.flow === 'mixto') {
    return {
      flow: 'mixto',
      itemsEntradas: Array.isArray(parsed?.itemsEntradas) ? parsed.itemsEntradas : [],
      addons: Array.isArray(parsed?.addons) ? parsed.addons : undefined,
      itemsConsumibles: Array.isArray(parsed?.itemsConsumibles) ? parsed.itemsConsumibles : [],
      marketplaceFeeEntradas: parsed?.marketplaceFeeEntradas ?? null,
      marketplaceFeeConsumibles: parsed?.marketplaceFeeConsumibles ?? null,
      feeBillingMode,
      feeBuyerFraction,
      confirmationToken,
    }
  }

  return {
    flow: 'entradas',
    items: Array.isArray(parsed?.items) ? parsed.items : [],
    marketplaceFee,
    feeBillingMode,
    feeBuyerFraction,
    confirmationToken,
    addons: Array.isArray(parsed?.addons) ? parsed.addons : undefined,
    seat_reservation_id: parsed?.seat_reservation_id ?? undefined,
  }
}

export function getCheckoutFlow(sessionData: CheckoutSessionData): CheckoutFlow {
  if (sessionData.flow === 'mixto') return 'mixto'
  return sessionData.flow === 'consumibles' ? 'consumibles' : 'entradas'
}

function generateCheckoutConfirmationToken() {
  return uuidv4()
}

function parseCheckoutItems(raw: string | CheckoutItem[] | CheckoutSessionData): CheckoutItem[] {
  const sessionData = parseCheckoutSessionData(raw)
  if (sessionData.flow === 'mixto') return sessionData.itemsEntradas
  return sessionData.items as CheckoutItem[]
}

function parseConsumibleCheckoutItems(raw: string | CheckoutItem[] | CheckoutSessionData): ConsumibleCheckoutItem[] {
  const sessionData = parseCheckoutSessionData(raw)
  if (sessionData.flow === 'mixto') return sessionData.itemsConsumibles
  return getCheckoutFlow(sessionData) === 'consumibles' ? (sessionData.items as ConsumibleCheckoutItem[]) : []
}

function buildStockNecesario(items: CheckoutItem[]): Map<string, number> {
  const stockNecesario = new Map<string, number>()
  for (const item of items) {
    stockNecesario.set(item.categoriaId, (stockNecesario.get(item.categoriaId) ?? 0) + Number(item.cantidad))
  }
  return stockNecesario
}

// 'mixto' reserva entradas Y consumibles a la vez — cada contador de abuso necesita
// SOLO su porción. Sin esto, una sesión 'mixto' contaría 0 en ambos límites
// (MAX_RESERVED_ENTRIES_PER_BUYER / MAX_RESERVED_CONSUMIBLES_PER_BUYER) porque
// getCheckoutFlow(sessionData) nunca es exactamente 'entradas' NI 'consumibles' — un
// buyer podría stackear reservas ilimitadas vía el checkout mixto evitando el límite.
export function countReservedEntryUnits(sessionData: CheckoutSessionData): number {
  if (sessionData.flow === 'mixto') {
    return sessionData.itemsEntradas.reduce((sum, item) => sum + Number(item.cantidad ?? 0), 0)
  }
  if (getCheckoutFlow(sessionData) !== 'entradas') return 0
  return sessionData.items.reduce((sum, item) => sum + Number(item.cantidad ?? 0), 0)
}

export function countReservedConsumibleUnits(sessionData: CheckoutSessionData): number {
  if (sessionData.flow === 'mixto') {
    return sessionData.itemsConsumibles.reduce((sum, item) => sum + Number(item.cantidad ?? 0), 0)
  }
  if (getCheckoutFlow(sessionData) !== 'consumibles') return 0
  return sessionData.items.reduce((sum, item) => sum + Number(item.cantidad ?? 0), 0)
}

async function getActiveReservedEntryCountForBuyer(tx: Prisma.TransactionClient, compradorId: string, empresaId: string) {
  // FOR UPDATE prevents concurrent checkouts from reading stale session counts.
  const rows = await tx.$queryRaw<{ datos: string }[]>`
    SELECT datos
    FROM checkout_sessions
    WHERE comprador_id = ${compradorId} AND empresa_id = ${empresaId}
      AND estado = 'reservada' AND expires_at IS NOT NULL AND expires_at > NOW()
    FOR UPDATE
  `

  return rows.reduce((acc, row) => acc + countReservedEntryUnits(parseCheckoutSessionData(row.datos)), 0)
}

async function getActiveReservedConsumiblesCountForBuyer(tx: Prisma.TransactionClient, compradorId: string, empresaId: string) {
  // FOR UPDATE prevents concurrent checkouts from reading stale session counts.
  const rows = await tx.$queryRaw<{ datos: string }[]>`
    SELECT datos
    FROM checkout_sessions
    WHERE comprador_id = ${compradorId} AND empresa_id = ${empresaId}
      AND estado = 'reservada' AND expires_at IS NOT NULL AND expires_at > NOW()
    FOR UPDATE
  `

  return rows.reduce((acc, row) => acc + countReservedConsumibleUnits(parseCheckoutSessionData(row.datos)), 0)
}

async function cancelarReserva(sessionId: string, empresaId: string) {
  try {
    await prismaDirectUrl.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<CheckoutSessionRow[]>`
        SELECT id, comprador_id, empresa_id, datos, estado, expires_at, confirmed_at
        FROM checkout_sessions
        WHERE id = ${sessionId} AND empresa_id = ${empresaId}
        FOR UPDATE
      `

      const session = locked[0]
      if (!session || session.estado !== 'reservada') return

      await releaseStockForCheckoutSession(tx, session)
      await tx.$executeRaw`
        UPDATE checkout_sessions SET estado = 'cancelada' WHERE id = ${sessionId}
      `
    }, {
      isolationLevel: 'Serializable',
      maxWait: 5000,
      timeout: 10000,
    })
  } catch (error) {
    logServerError('tenant cancel checkout reservation')
  }
}

export function distributeMarketplaceFeeByEntry(items: CheckoutItem[], totalFee: number) {
  const totalFeeCents = Math.round(roundMoney(totalFee) * 100)
  const entries = items.flatMap((item) =>
    Array.from({ length: Number(item.cantidad) }, () => ({ priceCents: Math.round(Number(item.precio) * 100) }))
  )

  if (!entries.length || totalFeeCents <= 0) {
    return entries.map(() => 0)
  }

  const subtotalCents = entries.reduce((acc, entry) => acc + entry.priceCents, 0)
  if (subtotalCents <= 0) {
    return entries.map(() => 0)
  }

  const shares = entries.map((entry, index) => {
    const exactCents = (totalFeeCents * entry.priceCents) / subtotalCents
    const baseCents = Math.floor(exactCents)

    return {
      index,
      cents: baseCents,
      remainder: exactCents - baseCents,
    }
  })

  let remainingCents = totalFeeCents - shares.reduce((acc, share) => acc + share.cents, 0)
  const sortedByRemainder = [...shares].sort((a, b) => {
    if (b.remainder !== a.remainder) {
      return b.remainder - a.remainder
    }

    return a.index - b.index
  })

  for (let i = 0; i < sortedByRemainder.length && remainingCents > 0; i += 1) {
    sortedByRemainder[i].cents += 1
    remainingCents -= 1
  }

  return shares.sort((a, b) => a.index - b.index).map((share) => roundMoney(share.cents / 100))
}

function buildSalesNotReadyResponse(error: SalesReadinessError) {
  return {
    code: error.code,
    status: error.readiness.status,
    reason: error.readiness.reason,
    error: error.message,
  }
}

function distributeMarketplaceFeeByTotal(totals: number[], totalFee: number) {
  const totalFeeCents = Math.round(roundMoney(totalFee) * 100)
  const weights = totals.map((value, index) => ({
    index,
    priceCents: Math.max(0, Math.round(Number(value) * 100)),
  }))

  if (!weights.length || totalFeeCents <= 0) {
    return weights.map(() => 0)
  }

  const subtotalCents = weights.reduce((acc, item) => acc + item.priceCents, 0)
  if (subtotalCents <= 0) {
    return weights.map(() => 0)
  }

  const shares = weights.map((item) => {
    const exactCents = (totalFeeCents * item.priceCents) / subtotalCents
    const baseCents = Math.floor(exactCents)

    return {
      index: item.index,
      cents: baseCents,
      remainder: exactCents - baseCents,
    }
  })

  let remainingCents = totalFeeCents - shares.reduce((acc, share) => acc + share.cents, 0)
  const sortedByRemainder = [...shares].sort((a, b) => {
    if (b.remainder !== a.remainder) {
      return b.remainder - a.remainder
    }

    return a.index - b.index
  })

  for (let i = 0; i < sortedByRemainder.length && remainingCents > 0; i += 1) {
    sortedByRemainder[i].cents += 1
    remainingCents -= 1
  }

  return shares.sort((a, b) => a.index - b.index).map((share) => roundMoney(share.cents / 100))
}

async function verificarPagoAprobado(
  sessionId: string,
  paymentId: string | number,
  totalEsperado: number,
  empresaId: string
): Promise<{ ok: true; paymentStatus: string; mpFeeAmount: number; applicationFeeAmount: number; netReceivedAmount: number } | { ok: false; error: string; reason: string; status: number; paymentStatus?: string }> {
  const mpClient = await getMercadoPagoClientByEmpresaId(empresaId)
  if (!mpClient) {
    return {
      ok: false,
      error: 'No se pudo verificar el pago de la empresa',
      reason: 'payment_provider_unavailable',
      status: 409,
    }
  }

  const paymentClient = new Payment(mpClient)
  const payment = await paymentClient.get({ id: paymentId })

  const status = String(payment.status ?? '')
  const externalReference = String(payment.external_reference ?? '')
  const transactionAmount = Number(payment.transaction_amount ?? 0)
  const currencyId = String(payment.currency_id ?? '')
  const feeDetails = Array.isArray(payment.fee_details) ? payment.fee_details : []
  const applicationFeeAmount = roundMoney(feeDetails
    .filter((fee: any) => String(fee?.type ?? '') === 'application_fee')
    .reduce((acc: number, fee: any) => acc + Number(fee?.amount ?? 0), 0))
  const mpFeeAmountFromDetails = roundMoney(feeDetails
    .filter((fee: any) => String(fee?.type ?? '') === 'mercadopago_fee')
    .reduce((acc: number, fee: any) => acc + Number(fee?.amount ?? 0), 0))
  const netReceivedAmount = roundMoney(Number(payment.transaction_details?.net_received_amount ?? 0))
  const mpFeeAmount = mpFeeAmountFromDetails > 0
    ? mpFeeAmountFromDetails
    : roundMoney(Math.max(transactionAmount - applicationFeeAmount - netReceivedAmount, 0))

  if (status !== 'approved') {
    return { ok: false, error: 'El pago todavía no figura como aprobado', reason: 'payment_not_approved', status: 409, paymentStatus: status }
  }

  if (externalReference !== sessionId) {
    return { ok: false, error: 'El pago no coincide con la sesión', reason: 'payment_session_mismatch', status: 409, paymentStatus: status }
  }

  if (Math.abs(transactionAmount - totalEsperado) > 0.01) {
    return { ok: false, error: 'El monto aprobado no coincide con la compra', reason: 'payment_amount_mismatch', status: 409, paymentStatus: status }
  }

  // Currency gate: las preferences hardcodean currency_id: 'ARS'. Si MP reporta otra moneda,
  // el monto cobrado no es comparable contra totalEsperado (que está en ARS) — rechazar igual
  // que un monto que no coincide.
  if (currencyId !== 'ARS') {
    return { ok: false, error: 'La moneda del pago no coincide con la compra', reason: 'payment_currency_mismatch', status: 409, paymentStatus: status }
  }

  return { ok: true, paymentStatus: status, mpFeeAmount, applicationFeeAmount, netReceivedAmount }
}

// Lógica de confirmar pago — extraída para reutilizar en confirmar-redirect sin fetch interno
async function confirmarPagoLogic(
  sessionId: string,
  slug: string,
  paymentId: string | number,
  options?: { compradorId?: string; confirmationToken?: string | null }
): Promise<{ ok: boolean; entradas?: number; ventas?: number; flow?: CheckoutFlow; error?: string; reason?: string; status: number; paymentStatus?: string; delivery?: { preference: 'email' | 'whatsapp' | 'both'; attempts: BuyerDeliveryDispatchAttemptContract[] } }> {
  // Pre-flight read (no lock) — load session to verify ownership + call MP API before acquiring the lock.
  // The lock inside the transaction re-reads with FOR UPDATE to prevent races.
  const sessionRows = await prisma.$queryRaw<CheckoutSessionRow[]>`
    SELECT cs.*, c.email, c.nombre as comprador_nombre, c.phone_e164, c.phone_verified_at, c.delivery_preference
    FROM checkout_sessions cs
    JOIN compradores c ON c.id = cs.comprador_id
    JOIN empresas e ON e.id = cs.empresa_id
    WHERE cs.id = ${sessionId} AND e.slug = ${slug}
  `

  if (!sessionRows[0]) return { ok: false, error: 'Sesión no encontrada', reason: 'session_not_found', status: 404 }

  const sesion = sessionRows[0]
  const sessionData = parseCheckoutSessionData(sesion.datos)
  const flow = getCheckoutFlow(sessionData)

  // 'mixto' no tiene un único `.items` — combinamos ambas listas SOLO para el total
  // esperado y el check `!items.length`. El fulfillment más abajo opera sobre cada
  // lista (itemsEntradas/itemsConsumibles) por separado, con su propio fee snapshot.
  const items: Array<CheckoutItem | ConsumibleCheckoutItem> = sessionData.flow === 'mixto'
    ? [...sessionData.itemsEntradas, ...sessionData.itemsConsumibles]
    : sessionData.items
  // Los addons SÍ se cobran vía MP en el checkout mixto (a diferencia del flow 'entradas'
  // actual, que no los incluye en mpItems — ver nota en el endpoint nuevo). Por eso acá
  // entran al totalEsperado únicamente para 'mixto'.
  const addonsForTotal: TicketCheckoutAddon[] = flow === 'mixto' ? ((sessionData as MixtoCheckoutSessionData).addons ?? []) : []
  const totalEsperado = items.reduce((acc, item) => acc + Number(item.precio) * Number(item.cantidad), 0)
    + addonsForTotal.reduce((acc, a) => acc + Number(a.precio) * Number(a.cantidad), 0)

  if (options?.compradorId && String(sesion.comprador_id) !== String(options.compradorId)) {
    return { ok: false, error: 'La sesión no pertenece al usuario autenticado', reason: 'session_owner_mismatch', status: 403 }
  }

  if (options?.confirmationToken && sessionData.confirmationToken !== options.confirmationToken) {
    return { ok: false, error: 'La confirmación no coincide con la sesión', reason: 'confirmation_token_mismatch', status: 403 }
  }

  if (!items.length) {
    return { ok: false, error: 'Datos de sesión inválidos', reason: 'invalid_session', status: 400 }
  }

  // Owner fee (nuestra comisión marketplace): 'mixto' trae DOS snapshots separados
  // (uno por dominio, cada uno resuelto con su propio resolveMarketplaceFee en el
  // checkout) — nunca se combinan en un solo monto.
  const marketplaceFeeEntradas = sessionData.flow === 'mixto'
    ? sessionData.marketplaceFeeEntradas
    : (sessionData.flow !== 'consumibles' ? sessionData.marketplaceFee : null)
  const marketplaceFeeConsumibles = sessionData.flow === 'mixto'
    ? sessionData.marketplaceFeeConsumibles
    : (sessionData.flow === 'consumibles' ? sessionData.marketplaceFee : null)

  const missingFeeSnapshot = flow === 'mixto'
    ? (!marketplaceFeeEntradas || !marketplaceFeeConsumibles)
    : (flow === 'entradas' ? !marketplaceFeeEntradas : !marketplaceFeeConsumibles)
  if (missingFeeSnapshot) {
    return { ok: false, error: 'La sesión no tiene comisión marketplace válida', reason: 'missing_marketplace_fee_snapshot', status: 409 }
  }

  const verificacionPago = await verificarPagoAprobado(sessionId, paymentId, totalEsperado, sesion.empresa_id)
  if (!verificacionPago.ok) return verificacionPago

  const marketplaceFeeEntradasAmount = marketplaceFeeEntradas?.amount ?? 0
  const marketplaceFeeConsumiblesAmount = marketplaceFeeConsumibles?.amount ?? 0
  // Alias legado: el resto del código no-mixto (branches 'entradas'/'consumibles')
  // sigue usando este nombre tal cual estaba.
  const marketplaceFeeAmount = flow === 'consumibles' ? marketplaceFeeConsumiblesAmount : marketplaceFeeEntradasAmount

  const itemsEntradasForFee: CheckoutItem[] = flow === 'mixto'
    ? (sessionData as MixtoCheckoutSessionData).itemsEntradas
    : (items as CheckoutItem[])

  // mp_fee_amount es el fee de PROCESAMIENTO de Mercado Pago sobre el pago COMPLETO
  // (un solo Payment para todo el carrito mixto). Hay que prorratearlo entre el
  // dominio entradas y el de consumibles ANTES de distribuirlo entrada-a-entrada /
  // venta-a-venta — si no, cada dominio le asignaría el 100% del mp_fee y la plata
  // no cerraría (doble conteo). Para 'entradas'/'consumibles' puros, todo el mp_fee
  // es de ese único dominio (comportamiento sin cambios).
  const addonsForFeeWeight: TicketCheckoutAddon[] = flow === 'mixto' ? ((sessionData as MixtoCheckoutSessionData).addons ?? []) : []
  const pesoEntradasMixto = itemsEntradasForFee.reduce((acc, it) => acc + Number(it.precio) * Number(it.cantidad), 0)
    + addonsForFeeWeight.reduce((acc, a) => acc + Number(a.precio) * Number(a.cantidad), 0)
  const pesoConsumiblesMixto = flow === 'mixto'
    ? (sessionData as MixtoCheckoutSessionData).itemsConsumibles.reduce((acc, it) => acc + Number(it.precio) * Number(it.cantidad), 0)
    : 0
  const mpFeeProrated = prorateMixtoMpFee(verificacionPago.mpFeeAmount, pesoEntradasMixto, pesoConsumiblesMixto)
  const mpFeeEntradasPortion = flow === 'mixto' ? mpFeeProrated.entradas : verificacionPago.mpFeeAmount
  const mpFeeConsumiblesPortion = flow === 'mixto' ? mpFeeProrated.consumibles : verificacionPago.mpFeeAmount

  const feeByEntry = (flow === 'entradas' || flow === 'mixto') ? distributeMarketplaceFeeByEntry(itemsEntradasForFee, marketplaceFeeEntradasAmount) : []
  const mpFeeByEntry = (flow === 'entradas' || flow === 'mixto') ? distributeMarketplaceFeeByEntry(itemsEntradasForFee, mpFeeEntradasPortion) : []

  const entradasCreadas: DeliveryEntryReceipt[] = []
  const ventasCreadas: DeliveryConsumibleReceipt[] = []
  let lockedSessionForDelivery: CheckoutSessionRow | null = null

  try {
    // withSerializableRetry wraps the entire $transaction — retries on P2034 serialization failures.
    await withSerializableRetry(() =>
      prismaDirectUrl.$transaction(async (tx) => {
        // FOR UPDATE on checkout_sessions — idempotency guard: if already 'confirmada', reconcile and return.
        const lockedRows = await tx.$queryRaw<CheckoutSessionRow[]>`
          SELECT cs.*, c.email, c.nombre as comprador_nombre, c.phone_e164, c.phone_verified_at, c.delivery_preference
          FROM checkout_sessions cs
          JOIN compradores c ON c.id = cs.comprador_id
          JOIN empresas e ON e.id = cs.empresa_id
          WHERE cs.id = ${sessionId} AND e.slug = ${slug}
          FOR UPDATE
        `

        const lockedSession = lockedRows[0]
        if (!lockedSession) throw Object.assign(new Error('session_not_found'), { _result: { ok: false, error: 'Sesión no encontrada', reason: 'session_not_found', status: 404 } })

        // Idempotency: MP can deliver the webhook multiple times.
        // If already confirmed, just update payment tracking and return success.
        if (lockedSession.estado === 'confirmada') {
          await tx.$executeRaw`
            UPDATE checkout_sessions
            SET payment_id = ${String(paymentId)}, payment_status = ${verificacionPago.paymentStatus},
                reconciliation_status = 'reconciled', reconciliation_note = NULL, last_payment_checked_at = NOW()
            WHERE id = ${lockedSession.id}
          `
          throw Object.assign(new Error('already_confirmed'), {
            _result: {
              ok: true,
              entradas: (flow === 'entradas' || flow === 'mixto') ? itemsEntradasForFee.length : undefined,
              ventas: (flow === 'consumibles' || flow === 'mixto')
                ? (flow === 'mixto' ? (sessionData as MixtoCheckoutSessionData).itemsConsumibles.length : items.length)
                : undefined,
              flow,
              status: 200,
            },
          })
        }

        if (lockedSession.estado !== 'reservada') {
          // COMMIT (no rollback) — persist reconciliation note for audit
          await tx.$executeRaw`
            UPDATE checkout_sessions
            SET payment_id = ${String(paymentId)}, payment_status = ${verificacionPago.paymentStatus},
                reconciliation_status = 'needs_review',
                reconciliation_note = ${'invalid_state:' + (lockedSession.estado ?? 'unknown')},
                last_payment_checked_at = NOW()
            WHERE id = ${lockedSession.id}
          `
          throw Object.assign(new Error('invalid_state'), {
            _result: { ok: false, error: `La sesión está ${lockedSession.estado ?? 'inválida'}`, reason: 'invalid_state', status: 409 },
          })
        }

        if (lockedSession.expires_at && new Date(lockedSession.expires_at).getTime() < Date.now()) {
          await tx.$executeRaw`
            UPDATE checkout_sessions
            SET payment_id = ${String(paymentId)}, payment_status = ${verificacionPago.paymentStatus},
                reconciliation_status = 'needs_review', reconciliation_note = 'approved_after_expiry',
                last_payment_checked_at = NOW()
            WHERE id = ${lockedSession.id}
          `
          throw Object.assign(new Error('approved_after_expiry'), {
            _result: { ok: false, error: 'El pago se aprobó fuera de la ventana de reserva y quedó pendiente de revisión', reason: 'approved_after_expiry', status: 409 },
          })
        }

        // Check empresa suspendida: el dinero ya salió de MP — marcar needs_review para refund manual.
        const empresaRows = await tx.$queryRaw<{ suspendido: boolean }[]>`
          SELECT suspendido FROM empresas WHERE id = ${lockedSession.empresa_id} LIMIT 1
        `
        if (empresaRows[0]?.suspendido) {
          await tx.$executeRaw`
            UPDATE checkout_sessions
            SET payment_id = ${String(paymentId)}, payment_status = ${verificacionPago.paymentStatus},
                reconciliation_status = 'needs_review', reconciliation_note = 'empresa_suspendida_al_confirmar',
                last_payment_checked_at = NOW()
            WHERE id = ${lockedSession.id}
          `
          throw Object.assign(new Error('empresa_suspendida'), {
            _result: { ok: false, error: 'La empresa está suspendida. El pago quedó pendiente de revisión para reembolso manual.', reason: 'empresa_suspendida', status: 409 },
          })
        }

        let feeEntryIndex = 0
        const entradaAllocations: Array<{ entradaId: string; precio: number }> = []
        const ventaAllocations: Array<{ ventaId: string; total: number }> = []
        const addonAllocations: Array<{ addonVentaId: string; precio: number }> = []

        if (flow === 'consumibles') {
          const grouped = new Map<string, { barraId: string; barraNombre: string; eventoId: string; eventoNombre: string; items: ConsumibleCheckoutItem[] }>()
          for (const rawItem of items as ConsumibleCheckoutItem[]) {
            const current = grouped.get(rawItem.barraId) ?? {
              barraId: rawItem.barraId,
              barraNombre: rawItem.barraNombre,
              eventoId: rawItem.eventoId,
              eventoNombre: rawItem.eventoNombre,
              items: [],
            }
            current.items.push(rawItem)
            grouped.set(rawItem.barraId, current)
          }

          const groupedVentas = [...grouped.values()]
          const ownerFeeByVenta = distributeMarketplaceFeeByTotal(
            groupedVentas.map((currentGroup) => roundMoney(currentGroup.items.reduce((acc, item) => acc + Number(item.precio) * Number(item.cantidad), 0))),
            marketplaceFeeAmount,
          )
          const mpFeeByVenta = distributeMarketplaceFeeByTotal(
            groupedVentas.map((currentGroup) => roundMoney(currentGroup.items.reduce((acc, item) => acc + Number(item.precio) * Number(item.cantidad), 0))),
            verificacionPago.mpFeeAmount,
          )

          let ownerFeeIndex = 0
          for (const nestedGroup of groupedVentas) {
            const ventaId = uuidv4()
            const qrCode = uuidv4()
            const totalVenta = roundMoney(nestedGroup.items.reduce((acc, item) => acc + Number(item.precio) * Number(item.cantidad), 0))
            const ownerFeeAmount = ownerFeeByVenta[ownerFeeIndex] ?? 0
            const mpFeeAmount = mpFeeByVenta[ownerFeeIndex] ?? 0
            const netoEmpresaAmount = roundMoney(Math.max(totalVenta - ownerFeeAmount - mpFeeAmount, 0))
            ownerFeeIndex += 1

            let claveCorta = ''
            let ventaInsertada = false
            for (let intento = 0; intento < 10; intento++) {
              const candidata = generateSecureShortCode()
              try {
                await tx.consumiblesVenta.create({
                  data: {
                    id: ventaId,
                    barra_id: nestedGroup.barraId,
                    evento_id: nestedGroup.eventoId,
                    empresa_id: String(lockedSession.empresa_id),
                    comprador_id: String(lockedSession.comprador_id),
                    usuario_id: null,
                    checkout_session_id: lockedSession.id,
                    origen: 'tenant_publico',
                    qr_code: qrCode,
                    clave_corta: candidata,
                    total: totalVenta,
                    descuento: 0,
                    promocion_id: null,
                    estado: 'pendiente',
                    owner_fee_amount: ownerFeeAmount,
                    // marketplaceFeeConsumibles === sessionData.marketplaceFee acá (flow === 'consumibles');
                    // se usa esta variable (en vez de sessionData.marketplaceFee) solo para que el
                    // discriminated union tipe bien ahora que CheckoutSessionData incluye 'mixto'.
                    owner_fee_currency: marketplaceFeeConsumibles!.currency,
                    owner_fee_mode: marketplaceFeeConsumibles!.metadata.mode,
                    owner_fee_percentage: marketplaceFeeConsumibles!.metadata.percentage,
                    owner_fee_fixed_amount: marketplaceFeeConsumibles!.metadata.fixedAmount,
                    mp_fee_amount: mpFeeAmount,
                    neto_empresa_amount: netoEmpresaAmount,
                  },
                })
                claveCorta = candidata
                ventaInsertada = true
                break
              } catch (error) {
                // P2002 = unique constraint violation (Postgres equivalent of ER_DUP_ENTRY)
                const code = (error as { code?: string } | null | undefined)?.code
                if (code === 'P2002') continue
                throw error
              }
            }

            if (!ventaInsertada) throw new Error('No se pudo generar clave única para la venta de consumibles')

            for (const item of nestedGroup.items) {
              await tx.consumiblesVentaItem.create({
                data: {
                  id: uuidv4(),
                  venta_id: ventaId,
                  consumible_id: item.consumibleId,
                  nombre_snapshot: item.nombre,
                  precio_unitario: Number(item.precio),
                  cantidad: Number(item.cantidad),
                  subtotal: roundMoney(Number(item.precio) * Number(item.cantidad)),
                },
              })
            }

            ventaAllocations.push({ ventaId, total: totalVenta })
            ventasCreadas.push({ qrCode, claveCorta, barra: nestedGroup.barraNombre, total: totalVenta })
          }
        } else if (flow === 'mixto') {
          const mixtoData = sessionData as MixtoCheckoutSessionData

          // --- Consumibles: agrupación por barra (MISMA lógica que el branch 'consumibles'
          // de arriba, pero sobre mixtoData.itemsConsumibles y con el fee/owner-fee propio
          // del dominio consumibles — marketplaceFeeConsumiblesAmount / mpFeeConsumiblesPortion). ---
          {
            const grouped = new Map<string, { barraId: string; barraNombre: string; eventoId: string; eventoNombre: string; items: ConsumibleCheckoutItem[] }>()
            for (const rawItem of mixtoData.itemsConsumibles) {
              const current = grouped.get(rawItem.barraId) ?? {
                barraId: rawItem.barraId,
                barraNombre: rawItem.barraNombre,
                eventoId: rawItem.eventoId,
                eventoNombre: rawItem.eventoNombre,
                items: [],
              }
              current.items.push(rawItem)
              grouped.set(rawItem.barraId, current)
            }

            const groupedVentas = [...grouped.values()]
            const ownerFeeByVenta = distributeMarketplaceFeeByTotal(
              groupedVentas.map((currentGroup) => roundMoney(currentGroup.items.reduce((acc, item) => acc + Number(item.precio) * Number(item.cantidad), 0))),
              marketplaceFeeConsumiblesAmount,
            )
            const mpFeeByVenta = distributeMarketplaceFeeByTotal(
              groupedVentas.map((currentGroup) => roundMoney(currentGroup.items.reduce((acc, item) => acc + Number(item.precio) * Number(item.cantidad), 0))),
              mpFeeConsumiblesPortion,
            )

            let ownerFeeIndex = 0
            for (const nestedGroup of groupedVentas) {
              const ventaId = uuidv4()
              const qrCode = uuidv4()
              const totalVenta = roundMoney(nestedGroup.items.reduce((acc, item) => acc + Number(item.precio) * Number(item.cantidad), 0))
              const ownerFeeAmount = ownerFeeByVenta[ownerFeeIndex] ?? 0
              const mpFeeAmountVenta = mpFeeByVenta[ownerFeeIndex] ?? 0
              const netoEmpresaAmount = roundMoney(Math.max(totalVenta - ownerFeeAmount - mpFeeAmountVenta, 0))
              ownerFeeIndex += 1

              let claveCorta = ''
              let ventaInsertada = false
              for (let intento = 0; intento < 10; intento++) {
                const candidata = generateSecureShortCode()
                try {
                  await tx.consumiblesVenta.create({
                    data: {
                      id: ventaId,
                      barra_id: nestedGroup.barraId,
                      evento_id: nestedGroup.eventoId,
                      empresa_id: String(lockedSession.empresa_id),
                      comprador_id: String(lockedSession.comprador_id),
                      usuario_id: null,
                      checkout_session_id: lockedSession.id,
                      origen: 'tenant_publico',
                      qr_code: qrCode,
                      clave_corta: candidata,
                      total: totalVenta,
                      descuento: 0,
                      promocion_id: null,
                      estado: 'pendiente',
                      owner_fee_amount: ownerFeeAmount,
                      owner_fee_currency: marketplaceFeeConsumibles!.currency,
                      owner_fee_mode: marketplaceFeeConsumibles!.metadata.mode,
                      owner_fee_percentage: marketplaceFeeConsumibles!.metadata.percentage,
                      owner_fee_fixed_amount: marketplaceFeeConsumibles!.metadata.fixedAmount,
                      mp_fee_amount: mpFeeAmountVenta,
                      neto_empresa_amount: netoEmpresaAmount,
                    },
                  })
                  claveCorta = candidata
                  ventaInsertada = true
                  break
                } catch (error) {
                  const code = (error as { code?: string } | null | undefined)?.code
                  if (code === 'P2002') continue
                  throw error
                }
              }

              if (!ventaInsertada) throw new Error('No se pudo generar clave única para la venta de consumibles')

              for (const item of nestedGroup.items) {
                await tx.consumiblesVentaItem.create({
                  data: {
                    id: uuidv4(),
                    venta_id: ventaId,
                    consumible_id: item.consumibleId,
                    nombre_snapshot: item.nombre,
                    precio_unitario: Number(item.precio),
                    cantidad: Number(item.cantidad),
                    subtotal: roundMoney(Number(item.precio) * Number(item.cantidad)),
                  },
                })
              }

              ventaAllocations.push({ ventaId, total: totalVenta })
              ventasCreadas.push({ qrCode, claveCorta, barra: nestedGroup.barraNombre, total: totalVenta })
            }
          }

          // --- Entradas + addons: MISMA lógica que el branch 'entradas' (else final) de
          // abajo, pero sobre mixtoData.itemsEntradas/mixtoData.addons y con el fee/owner-fee
          // propio del dominio entradas (marketplaceFeeEntradasAmount / feeByEntry/mpFeeByEntry,
          // ya calculados arriba sobre itemsEntradasForFee). NO hay seat marking — fuera de
          // scope v1 (el tipo mixto no trae seat_reservation_id). ---
          {
            const categoriaIds = [...new Set(mixtoData.itemsEntradas.map((i) => i.categoriaId).filter(Boolean))]
            const entradasPorUnidadByCategoria = new Map<string, number>()
            if (categoriaIds.length > 0) {
              const categoriasActivas = await tx.entradaCategoria.findMany({
                where: { id: { in: categoriaIds }, activa: true },
                select: { id: true, entradas_por_unidad: true },
              })
              const activasSet = new Set(categoriasActivas.map((r) => String(r.id)))
              for (const c of categoriasActivas) {
                entradasPorUnidadByCategoria.set(String(c.id), Math.max(1, Number(c.entradas_por_unidad ?? 1)))
              }
              const inactivas = categoriaIds.filter((cid) => !activasSet.has(String(cid)))
              if (inactivas.length > 0) {
                await tx.$executeRaw`
                  UPDATE checkout_sessions
                  SET reconciliation_status = 'needs_review',
                      reconciliation_note = ${'categoria_inactiva:' + inactivas.join(',')}
                  WHERE id = ${lockedSession.id}
                `
                logServerError(`tenant confirmar pago mixto: categorias inactivas ${inactivas.join(',')} session=${lockedSession.id}`)
                throw Object.assign(new Error('categoria_inactiva'), {
                  _result: { ok: false, error: 'Una o más categorías de entradas ya no están disponibles', reason: 'categoria_inactiva', status: 409 },
                })
              }
            }

            // Revendedor: el checkout mixto v1 no acepta ?ref= (fuera de scope), así que
            // lockedSession.revendedor_id será siempre null acá — se mantiene la MISMA
            // lectura que el branch 'entradas' por fidelidad/forward-compat, es un no-op.
            let revendedorComisionPct = 0
            const sessionRevendedorId = (lockedSession as CheckoutSessionRow & { revendedor_id?: string | null }).revendedor_id ?? null
            if (sessionRevendedorId) {
              const revRow = await tx.$queryRaw<{ porcentaje_comision: number | null }[]>`
                SELECT porcentaje_comision FROM usuarios
                WHERE id = ${sessionRevendedorId} AND empresa_id = ${String(lockedSession.empresa_id)}
                  AND rol = 'revendedor' LIMIT 1
              `
              revendedorComisionPct = Number(revRow[0]?.porcentaje_comision ?? 0)
            }

            for (const item of mixtoData.itemsEntradas) {
              const entradasPorUnidad = entradasPorUnidadByCategoria.get(String(item.categoriaId)) ?? 1
              for (let unidad = 0; unidad < item.cantidad; unidad++) {
                const comisionUnidad = feeByEntry[feeEntryIndex] ?? 0
                const mpFeeUnidad = mpFeeByEntry[feeEntryIndex] ?? 0
                feeEntryIndex += 1

                const comisionRevendedorUnidad = sessionRevendedorId
                  ? roundMoney((Number(item.precio) * revendedorComisionPct) / 100)
                  : 0

                const precioPorQR = roundMoney(Number(item.precio) / entradasPorUnidad)
                const comisionPorQR = roundMoney(comisionUnidad / entradasPorUnidad)
                const mpFeePorQR = roundMoney(mpFeeUnidad / entradasPorUnidad)
                const comisionRevPorQR = roundMoney(comisionRevendedorUnidad / entradasPorUnidad)
                const netoEmpresaPorQR = roundMoney(Math.max(precioPorQR - comisionPorQR - mpFeePorQR, 0))

                for (let qrIdx = 0; qrIdx < entradasPorUnidad; qrIdx++) {
                  const qrCode = uuidv4()
                  const entradaId = uuidv4()
                  let claveCorta = ''
                  let entradaInsertada = false
                  for (let intento = 0; intento < 10; intento++) {
                    const candidata = generateSecureShortCode()
                    try {
                      await tx.entrada.create({
                        data: {
                          id: entradaId,
                          evento_id: item.eventoId,
                          categoria_id: item.categoriaId,
                          fecha_id: item.fechaId ?? null,
                          comprador_id: String(lockedSession.comprador_id),
                          qr_code: qrCode,
                          clave_corta: candidata,
                          estado: 'valida',
                          precio_pagado: precioPorQR,
                          comision: comisionPorQR,
                          mp_fee_amount: mpFeePorQR,
                          neto_empresa_amount: netoEmpresaPorQR,
                          nombre_comprador: item.datos?.nombre ?? null,
                          apellido_comprador: item.datos?.apellido ?? null,
                          dni_comprador: item.datos?.dni ?? null,
                          checkout_session_id: lockedSession.id,
                          revendedor_id: sessionRevendedorId,
                          comision_revendedor: comisionRevPorQR,
                        },
                      })
                      claveCorta = candidata
                      entradaInsertada = true
                      break
                    } catch (error) {
                      const code = (error as { code?: string } | null | undefined)?.code
                      if (code === 'P2002') continue
                      throw error
                    }
                  }

                  if (!entradaInsertada) throw new Error('No se pudo generar clave única para la entrada')

                  entradaAllocations.push({ entradaId, precio: precioPorQR })
                  entradasCreadas.push({ qrCode, claveCorta, categoria: item.categoriaNombre, evento: item.eventoNombre })
                }
              }
            }

            // Sin seat marking para mixto v1 (fuera de scope — el tipo no trae seat_reservation_id).

            // Add-ons: misma lógica que el branch 'entradas'.
            const addonsInSession = mixtoData.addons ?? []
            if (addonsInSession.length > 0) {
              const totalSubtotal = mixtoData.itemsEntradas.reduce((acc, it) => acc + Number(it.precio) * Number(it.cantidad), 0)
                + addonsInSession.reduce((acc, a) => acc + Number(a.precio) * Number(a.cantidad), 0)
              const feePctEffectiveAddon = totalSubtotal > 0 ? Number(marketplaceFeeEntradasAmount) / totalSubtotal : 0
              for (const addon of addonsInSession) {
                const eventoId = addon.eventoId ?? mixtoData.itemsEntradas[0]?.eventoId ?? ''
                for (let i = 0; i < Number(addon.cantidad); i++) {
                  const qrCode = uuidv4()
                  const addonVentaId = uuidv4()
                  const precioPorAddon = Number(addon.precio)
                  const comisionPorAddon = Math.round((precioPorAddon * feePctEffectiveAddon + Number.EPSILON) * 100) / 100
                  const netoPorAddon = Math.round(Math.max(precioPorAddon - comisionPorAddon, 0) * 100) / 100
                  let claveCorta = ''
                  let inserted = false
                  for (let intento = 0; intento < 10; intento++) {
                    const candidata = generateSecureShortCode()
                    try {
                      await tx.eventoAddonVenta.create({
                        data: {
                          id: addonVentaId,
                          addon_id: addon.id,
                          comprador_id: String(lockedSession.comprador_id),
                          checkout_session_id: lockedSession.id,
                          evento_id: eventoId,
                          empresa_id: String(lockedSession.empresa_id),
                          qr_code: qrCode,
                          clave_corta: candidata,
                          estado: 'valida',
                          precio_pagado: precioPorAddon,
                          comision: comisionPorAddon,
                          mp_fee_amount: null,
                          neto_empresa_amount: netoPorAddon,
                        },
                      })
                      claveCorta = candidata
                      inserted = true
                      break
                    } catch (error) {
                      const code = (error as { code?: string } | null | undefined)?.code
                      if (code === 'P2002') continue
                      throw error
                    }
                  }
                  if (!inserted) throw new Error('No se pudo generar clave única para el addon')
                  addonAllocations.push({ addonVentaId, precio: precioPorAddon })
                  entradasCreadas.push({ qrCode, claveCorta, categoria: addon.nombre, evento: '(adicional)' })
                }
              }
            }
          }
        } else {
          // Verificar que todas las categorías referenciadas siguen activas antes de emitir entradas.
          // Protege contra borrado/desactivación entre la reserva y la confirmación del pago.
          // Además trae entradas_por_unidad para el pack model: una unidad comprada puede generar
          // N QRs (entradas_por_unidad > 1 = pack 2x1, 3x2, etc.)
          const categoriaIds = [...new Set((items as CheckoutItem[]).map((i) => i.categoriaId).filter(Boolean))]
          const entradasPorUnidadByCategoria = new Map<string, number>()
          if (categoriaIds.length > 0) {
            const categoriasActivas = await tx.entradaCategoria.findMany({
              where: { id: { in: categoriaIds }, activa: true },
              select: { id: true, entradas_por_unidad: true },
            })
            const activasSet = new Set(categoriasActivas.map((r) => String(r.id)))
            for (const c of categoriasActivas) {
              entradasPorUnidadByCategoria.set(String(c.id), Math.max(1, Number(c.entradas_por_unidad ?? 1)))
            }
            const inactivas = categoriaIds.filter((cid) => !activasSet.has(String(cid)))
            if (inactivas.length > 0) {
              await tx.$executeRaw`
                UPDATE checkout_sessions
                SET reconciliation_status = 'needs_review',
                    reconciliation_note = ${'categoria_inactiva:' + inactivas.join(',')}
                WHERE id = ${lockedSession.id}
              `
              logServerError(`tenant confirmar pago: categorias inactivas ${inactivas.join(',')} session=${lockedSession.id}`)
              throw Object.assign(new Error('categoria_inactiva'), {
                _result: { ok: false, error: 'Una o más categorías de entradas ya no están disponibles', reason: 'categoria_inactiva', status: 409 },
              })
            }
          }

          // Calcular comisión revendedor (si aplica) — se calcula una sola vez
          let revendedorComisionPct = 0
          const sessionRevendedorId = (lockedSession as CheckoutSessionRow & { revendedor_id?: string | null }).revendedor_id ?? null
          if (sessionRevendedorId) {
            const revRow = await tx.$queryRaw<{ porcentaje_comision: number | null }[]>`
              SELECT porcentaje_comision FROM usuarios
              WHERE id = ${sessionRevendedorId} AND empresa_id = ${String(lockedSession.empresa_id)}
                AND rol = 'revendedor' LIMIT 1
            `
            revendedorComisionPct = Number(revRow[0]?.porcentaje_comision ?? 0)
          }

          for (const item of items as CheckoutItem[]) {
            // Pack model: una unidad comprada puede generar N QRs si entradas_por_unidad > 1.
            // El precio del pack se splittea proporcionalmente entre los N QRs (precio_pagado,
            // comision, mp_fee_amount, neto_empresa) para mantener consistencia contable:
            // suma de los N == lo cobrado al comprador por la unidad.
            const entradasPorUnidad = entradasPorUnidadByCategoria.get(String(item.categoriaId)) ?? 1
            for (let unidad = 0; unidad < item.cantidad; unidad++) {
              const comisionUnidad = feeByEntry[feeEntryIndex] ?? 0
              const mpFeeUnidad = mpFeeByEntry[feeEntryIndex] ?? 0
              feeEntryIndex += 1

              const comisionRevendedorUnidad = sessionRevendedorId
                ? roundMoney((Number(item.precio) * revendedorComisionPct) / 100)
                : 0

              // Split equitativo entre los N QRs del pack
              const precioPorQR = roundMoney(Number(item.precio) / entradasPorUnidad)
              const comisionPorQR = roundMoney(comisionUnidad / entradasPorUnidad)
              const mpFeePorQR = roundMoney(mpFeeUnidad / entradasPorUnidad)
              const comisionRevPorQR = roundMoney(comisionRevendedorUnidad / entradasPorUnidad)
              const netoEmpresaPorQR = roundMoney(Math.max(precioPorQR - comisionPorQR - mpFeePorQR, 0))

              for (let qrIdx = 0; qrIdx < entradasPorUnidad; qrIdx++) {
                const qrCode = uuidv4()
                const entradaId = uuidv4()
                let claveCorta = ''
                let entradaInsertada = false
                for (let intento = 0; intento < 10; intento++) {
                  const candidata = generateSecureShortCode()
                  try {
                    await tx.entrada.create({
                      data: {
                        id: entradaId,
                        evento_id: item.eventoId,
                        categoria_id: item.categoriaId,
                        fecha_id: item.fechaId ?? null,
                        comprador_id: String(lockedSession.comprador_id),
                        qr_code: qrCode,
                        clave_corta: candidata,
                        estado: 'valida',
                        precio_pagado: precioPorQR,
                        comision: comisionPorQR,
                        mp_fee_amount: mpFeePorQR,
                        neto_empresa_amount: netoEmpresaPorQR,
                        nombre_comprador: item.datos?.nombre ?? null,
                        apellido_comprador: item.datos?.apellido ?? null,
                        dni_comprador: item.datos?.dni ?? null,
                        checkout_session_id: lockedSession.id,
                        revendedor_id: sessionRevendedorId,
                        comision_revendedor: comisionRevPorQR,
                      },
                    })
                    claveCorta = candidata
                    entradaInsertada = true
                    break
                  } catch (error) {
                    const code = (error as { code?: string } | null | undefined)?.code
                    if (code === 'P2002') continue
                    throw error
                  }
                }

                if (!entradaInsertada) throw new Error('No se pudo generar clave única para la entrada')

                entradaAllocations.push({ entradaId, precio: precioPorQR })
                entradasCreadas.push({ qrCode, claveCorta, categoria: item.categoriaNombre, evento: item.eventoNombre })
              }
            }
          }

          // Seated events: mark confirmed seats as vendido and link to their entradas.
          // Items with asiento_id always have cantidad=1 and entradas_por_unidad=1 (enforced by SeatPicker).
          const sessionTypedData = sessionData as TicketCheckoutSessionData
          if (sessionTypedData.seat_reservation_id) {
            const seatedPairs = (sessionTypedData.items as CheckoutItem[])
              .filter((it) => it.asiento_id)
            if (seatedPairs.length > 0) {
              // Build asiento_id → entradaId mapping by matching items to their allocations by position.
              // The allocation array mirrors the items loop order (one allocation per QR generated).
              let allocationIdx = 0
              for (const it of (sessionTypedData.items as CheckoutItem[])) {
                const epu = 1  // packs (entradas_por_unidad > 1) are incompatible with seated events
                for (let u = 0; u < Number(it.cantidad); u++) {
                  for (let q = 0; q < epu; q++) {
                    const allocation = entradaAllocations[allocationIdx++]
                    if (it.asiento_id && allocation) {
                      await tx.$executeRaw`
                        UPDATE asientos
                        SET estado = 'vendido', entrada_id = ${allocation.entradaId},
                            checkout_session_id = NULL, reserved_until = NULL
                        WHERE id = ${it.asiento_id} AND estado = 'reservado'
                          AND checkout_session_id = ${sessionTypedData.seat_reservation_id}
                      `
                      await tx.$executeRaw`
                        UPDATE entradas SET asiento_id = ${it.asiento_id} WHERE id = ${allocation.entradaId}
                      `
                    }
                  }
                }
              }
            }
          }

          // Add-ons: una unidad comprada → 1 QR único en evento_addon_ventas.
          // sessionDataTyped.addons ya tiene los precios INFLADOS si modo=passed.
          // Los addon_ventas se incluyen en platform_sale_allocations con flow='entradas'
          // y sourceType='addon_venta' (mismo % de admin que el evento padre).
          const addonsInSession = (sessionData as TicketCheckoutSessionData)?.addons ?? []
          if (addonsInSession.length > 0) {
            // Calcular fee_pct efectivo para distribuir comision por unidad de addon
            const totalSubtotal = (sessionData as TicketCheckoutSessionData).items.reduce((acc, it) => acc + Number(it.precio) * Number(it.cantidad), 0)
              + addonsInSession.reduce((acc, a) => acc + Number(a.precio) * Number(a.cantidad), 0)
            const feePctEffectiveAddon = totalSubtotal > 0 ? Number(marketplaceFeeAmount) / totalSubtotal : 0
            for (const addon of addonsInSession) {
              // El evento_id del addon viene de la DB (snapshot al reservar). Esto es CRÍTICO
              // para data integrity: si el carrito tiene items multi-evento, el addon_venta
              // debe quedar asociado al evento del addon, no al primer item del carrito.
              const eventoId = addon.eventoId ?? (sessionData as TicketCheckoutSessionData).items[0]?.eventoId ?? ''
              for (let i = 0; i < Number(addon.cantidad); i++) {
                const qrCode = uuidv4()
                const addonVentaId = uuidv4()
                const precioPorAddon = Number(addon.precio)
                const comisionPorAddon = Math.round((precioPorAddon * feePctEffectiveAddon + Number.EPSILON) * 100) / 100
                const netoPorAddon = Math.round(Math.max(precioPorAddon - comisionPorAddon, 0) * 100) / 100
                let claveCorta = ''
                let inserted = false
                for (let intento = 0; intento < 10; intento++) {
                  const candidata = generateSecureShortCode()
                  try {
                    await tx.eventoAddonVenta.create({
                      data: {
                        id: addonVentaId,
                        addon_id: addon.id,
                        comprador_id: String(lockedSession.comprador_id),
                        checkout_session_id: lockedSession.id,
                        evento_id: eventoId,
                        empresa_id: String(lockedSession.empresa_id),
                        qr_code: qrCode,
                        clave_corta: candidata,
                        estado: 'valida',
                        precio_pagado: precioPorAddon,
                        comision: comisionPorAddon,
                        mp_fee_amount: null,
                        neto_empresa_amount: netoPorAddon,
                      },
                    })
                    claveCorta = candidata
                    inserted = true
                    break
                  } catch (error) {
                    const code = (error as { code?: string } | null | undefined)?.code
                    if (code === 'P2002') continue
                    throw error
                  }
                }
                if (!inserted) throw new Error('No se pudo generar clave única para el addon')
                addonAllocations.push({ addonVentaId, precio: precioPorAddon })
                entradasCreadas.push({ qrCode, claveCorta, categoria: addon.nombre, evento: '(adicional)' })
              }
            }
          }
        }

        // 'mixto' persiste AMBAS allocations (una por dominio) con su propio flow FIJO
        // ('consumibles'/'entradas' — NUNCA la variable 'mixto', que resolvePlatformAllocations
        // no acepta) y su propio totalOwnerFeeAmount — nunca un monto combinado.
        if ((flow === 'consumibles' || flow === 'mixto') && ventaAllocations.length > 0) {
          await persistPlatformAllocations(
            await resolvePlatformAllocations({
              flow: 'consumibles',
              totalOwnerFeeAmount: marketplaceFeeConsumiblesAmount,
              currency: marketplaceFeeConsumibles!.currency,
              sales: ventaAllocations.map((venta) => ({
                sourceType: 'consumible_venta' as const,
                sourceId: venta.ventaId,
                amountWeight: venta.total,
                checkoutSessionId: lockedSession.id,
                empresaId: String(lockedSession.empresa_id),
              })),
            }),
            tx,
          )
        }

        if ((flow === 'entradas' || flow === 'mixto') && (entradaAllocations.length > 0 || addonAllocations.length > 0)) {
          // Combina entradas + addons en la MISMA distribución para que el
          // marketplaceFeeEntradasAmount total se reparta proporcional al peso de cada venta
          // (entrada o addon). Si separáramos en dos llamadas, duplicaríamos el ownerFee.
          await persistPlatformAllocations(
            await resolvePlatformAllocations({
              flow: 'entradas',
              totalOwnerFeeAmount: marketplaceFeeEntradasAmount,
              currency: marketplaceFeeEntradas!.currency,
              sales: [
                ...entradaAllocations.map((entrada) => ({
                  sourceType: 'entrada' as const,
                  sourceId: entrada.entradaId,
                  amountWeight: entrada.precio,
                  checkoutSessionId: lockedSession.id,
                  empresaId: String(lockedSession.empresa_id),
                })),
                ...addonAllocations.map((addon) => ({
                  sourceType: 'addon_venta' as const,
                  sourceId: addon.addonVentaId,
                  amountWeight: addon.precio,
                  checkoutSessionId: lockedSession.id,
                  empresaId: String(lockedSession.empresa_id),
                })),
              ],
            }),
            tx,
          )
        }

        // Incrementar usos del código de descuento si la sesión tenía uno aplicado.
        // UPDATE atómico con guard: si usos_maximos ya fue alcanzado entre la reserva
        // y la confirmación (race condition), affectedRows === 0. El pago ya fue procesado
        // así que no se puede rechazar — se loguea como overage para auditoría del operador.
        const codigoDescuentoSesion = (lockedSession as CheckoutSessionRow & { codigo_descuento?: string | null }).codigo_descuento
        if (codigoDescuentoSesion) {
          const codigoUpper = String(codigoDescuentoSesion).toUpperCase()
          // RETURNING id ⇒ la fila vuelve SOLO cuando el guard dejó incrementar (usos_maximos
          // no alcanzado). 0 filas = overage. El id devuelto es el codigo_id para la fila de uso.
          const incrementedRows = await tx.$queryRaw<{ id: number }[]>`
            UPDATE marketing_codigos_descuento
            SET usos_actuales = usos_actuales + 1
            WHERE empresa_id = ${String(lockedSession.empresa_id)} AND UPPER(codigo) = ${codigoUpper}
              AND (usos_maximos IS NULL OR usos_actuales < usos_maximos)
            RETURNING id
          `
          const codigoId = incrementedRows[0]?.id
          if (codigoId == null) {
            console.warn(
              `[discount-overage] Código "${codigoDescuentoSesion}" superó usos_maximos al confirmar pago. ` +
              `checkout_session_id=${sessionId} empresa_id=${lockedSession.empresa_id}. ` +
              `El pago fue procesado y no puede revertirse — requiere revisión manual.`
            )
          } else {
            // Registrar la redención per-use (atómico con el incremento) para reporting:
            // export de promociones + gráfico "descuentos por día" de cierre-caja.
            const descuentoAplicado = (lockedSession as CheckoutSessionRow & { descuento_monto?: string | number | null }).descuento_monto ?? 0
            await tx.$executeRaw`
              INSERT INTO marketing_codigos_descuento_usos
                (codigo_id, comprador_id, checkout_session_id, descuento_aplicado)
              VALUES (${codigoId}, ${String(lockedSession.comprador_id)}, ${String(lockedSession.id)}, ${descuentoAplicado}::numeric)
            `
          }
        }

        await tx.$executeRaw`
          UPDATE checkout_sessions
          SET estado = 'confirmada', confirmed_at = NOW(),
              payment_id = ${String(paymentId)}, payment_status = ${verificacionPago.paymentStatus},
              reconciliation_status = 'reconciled', reconciliation_note = NULL,
              last_payment_checked_at = NOW()
          WHERE id = ${lockedSession.id}
        `

        lockedSessionForDelivery = lockedSession
      }, {
        isolationLevel: 'Serializable',
        maxWait: 5000,
        timeout: 30000,
      })
    )
  } catch (err: unknown) {
    // Errors thrown with _result carry a structured response (early returns from inside tx).
    const result = (err as { _result?: { ok: boolean; error?: string; reason?: string; status: number } } | null)?._result
    if (result) return result

    logServerError('tenant auth token')
    return { ok: false, error: 'Error al procesar la compra', reason: 'confirm_failed', status: 500 }
  }

  // Delivery is outside the transaction — commit already happened.
  let delivery: { preference: 'email' | 'whatsapp' | 'both'; attempts: BuyerDeliveryDispatchAttemptContract[] }
  const deliverySession = lockedSessionForDelivery!
  try {
    delivery = await dispatchBuyerPurchaseDelivery({
      slug,
      flow,
      session: deliverySession,
      entradas: entradasCreadas,
      ventas: ventasCreadas,
    })

    if (dispatchHadAnySuccess(delivery.attempts)) {
      await markDeliverySucceeded(deliverySession.id)
    } else {
      const firstErr = delivery.attempts.find((a) => a.errorMessage)
      await markDeliveryFailed({
        sessionId: deliverySession.id,
        errorMessage: firstErr?.errorMessage ?? 'all channels failed at initial dispatch',
      })
    }
  } catch (dispatchErr) {
    logServerError('tenant buyer delivery dispatch')
    await markDeliveryFailed({
      sessionId: deliverySession.id,
      errorMessage: dispatchErr instanceof Error ? dispatchErr.message : 'dispatch threw',
    })
    const preference: 'email' | 'whatsapp' | 'both' = deliverySession.delivery_preference === 'whatsapp' || deliverySession.delivery_preference === 'both'
      ? deliverySession.delivery_preference
      : 'email'
    delivery = { preference, attempts: [] }
  }

  return { ok: true, entradas: entradasCreadas.length, ventas: ventasCreadas.length, flow, delivery, status: 200 }
}

const router = Router()

// Validación de formato de slug — se aplica a TODAS las rutas con :slug antes de los handlers.
// Previene caracteres inválidos que podrían causar comportamientos inesperados en construcción
// de URLs (SSRF potencial) aunque las queries sean parametrizadas.
const VALID_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$|^[a-z0-9]$/
router.param('slug', (req, res, next, slug) => {
  if (!VALID_SLUG_RE.test(slug)) {
    return res.status(400).json({ error: 'Slug inválido' })
  }
  return next()
})

// GET /tenant/:slug — datos públicos de la empresa
router.get('/:slug', verifyInternal, async (req: Request, res: Response) => {
  const { slug } = req.params

  // slug stored lowercase per design — allowSuspended: true because the public info view
  // does NOT filter out suspendido (only tenant_public_disabled matters for info display).
  const empresa = await prisma.empresa.findFirst({
    where: {
      slug: slug.trim().toLowerCase(), // slug stored lowercase per design
      activa: true,
      aprobada: true, // empresa pendiente de aprobación = layout devuelve 404
      tenant_public_disabled: false,
    },
    select: {
      id: true,
      nombre: true,
      slug: true,
      logo_url: true,
      favicon_url: true,
      navbar_size: true,
      logo_size: true,
      navbar_color: true,
      font: true,
      color_primario: true,
      color_fondo: true,
      color_texto: true,
      desktop_event_card_size: true,
      mostrar_descripcion_home: true,
      mostrar_tanda_activa_home: true,
      mostrar_badge_stock_home: true,
      mostrar_fecha_home: true,
      mostrar_lugar_home: true,
      mostrar_precio_home: true,
      titulo_eventos_home: true,
      subtitulo_eventos_home: true,
      cta_eventos_home: true,
      banner_variant: true,
      descripcion: true,
      whatsapp: true,
      banners: true,
      home_sections: true,
      info_pages: true,
      support_contact_email: true,
      faqs: true,
      galeria_fotos: true,
      announcement_bar: true,
      social_links: true,
      color_superficie: true,
      border_radius: true,
      button_style: true,
      heading_font: true,
      navbar_blur: true,
      card_columns: true,
      section_spacing: true,
      mobile_event_layout: true,
      event_card_style: true,
      eventos_layout: true,
      ga4_measurement_id: true,
      meta_pixel_id: true,
      gtm_container_id: true,
      suspendido: true,
    },
  })

  if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' })

  const { support_contact_email, ...publicEmpresa } = empresa
  const isSuspendido = Boolean(publicEmpresa.suspendido)

  const salesReadiness = isSuspendido ? null : await getSalesReadiness(empresa.id)

  // Testimonios (home_sections) pueden anclarse opcionalmente a un evento pasado del
  // propio tenant (evento_id). Resolvemos acá — scoped a empresa.id, nunca cross-tenant —
  // solo nombre + imagen_url (sin precio/stock, no es un widget de venta). Si el evento
  // referenciado fue borrado o ya no existe, simplemente no aparece en el mapa y el
  // render público cae al diseño de testimonio suelto (avatar genérico).
  const testimonioEventoIds = extractTestimonioEventoIds(publicEmpresa.home_sections)
  const testimonioEventos: Record<string, { nombre: string; imagen_url: string | null }> = {}
  if (testimonioEventoIds.length > 0) {
    const eventosVinculados = await prisma.evento.findMany({
      where: { id: { in: testimonioEventoIds }, empresa_id: empresa.id },
      select: { id: true, nombre: true, imagen_url: true },
    })
    for (const e of eventosVinculados) {
      testimonioEventos[e.id] = { nombre: e.nombre, imagen_url: e.imagen_url }
    }
  }

  return res.json({
    data: {
      empresa: {
        ...publicEmpresa,
        suspendido: isSuspendido,
        faqs: resolvePublicSupportFaqs(publicEmpresa.faqs),
        support_contact_enabled: !!(typeof support_contact_email === 'string' && support_contact_email.trim().length > 0),
        sales_readiness: salesReadiness ? buildPublicSalesReadiness(salesReadiness) : null,
        testimonio_eventos: testimonioEventos,
      },
    },
  })
})

// GET /tenant/:slug/eventos — listado público del tenant
router.get('/:slug/eventos', verifyInternal, async (req: Request, res: Response) => {
  const { slug } = req.params

  // Resolve empresa via Prisma (slug stored lowercase per design)
  const empresaResult = await findPublicTenant(slug).then(async (e) => {
    if (!e) return null
    // fetch extra fields not in findPublicTenant select
    return prisma.empresa.findUnique({
      where: { id: e.id },
      select: { id: true, buyer_auto_refunds_enabled: true, buyer_auto_refunds_scope: true },
    })
  })

  if (!empresaResult) return res.status(404).json({ error: 'Empresa no encontrada' })

  type EventoListRow = {
    id: string; nombre: string; descripcion: string | null; lugar: string | null; imagen_url: string | null;
    modo_fecha: string | null; tipo_mapa: string | null; activo: boolean; venta_consumibles_habilitada: boolean;
    publication_mode: string | null; pre_publish_visibility: string | null;
    publish_at_utc: Date | null; publish_timezone: string | null; published_live_at: Date | null;
    tanda_activa_id: string | null; tanda_activa_nombre: string | null;
    tanda_activa_descripcion: string | null; tanda_activa_imagen_url: string | null;
    proxima_fecha: Date | null; precio_desde: number | null; stock_total: number;
  }
  const eventos = await prisma.$queryRaw<EventoListRow[]>`
    SELECT e.id, e.nombre, e.descripcion, e.lugar, e.imagen_url, e.modo_fecha, e.tipo_mapa, e.activo, e.venta_consumibles_habilitada,
      e.publication_mode, e.pre_publish_visibility, e.publish_at_utc, e.publish_timezone, e.published_live_at,
      et.id AS tanda_activa_id,
      et.nombre AS tanda_activa_nombre,
      et.descripcion AS tanda_activa_descripcion,
      et.imagen_url AS tanda_activa_imagen_url,
      ef_stats.proxima_fecha,
      ec_stats.precio_desde::float AS precio_desde,
      -- SUM(entrada_categorias.stock_disponible) es un SUM de int4 -> Postgres lo devuelve
      -- como int8/bigint, que Prisma mapea a JS BigInt (no number) via $queryRaw. Sin este
      -- cast, res.json() explota con 'Do not know how to serialize a BigInt' en runtime
      -- (no en el shape de tipos, que miente diciendo number) apenas un tenant pide su
      -- listado publico de eventos -- mismo motivo que precio_desde ya castea a ::float.
      COALESCE(ec_stats.stock_total, 0)::int AS stock_total
    FROM eventos e
    JOIN empresas em ON em.id = e.empresa_id
      AND em.slug = ${slug}
      AND em.activa = TRUE
      AND COALESCE(em.tenant_public_disabled, FALSE) = FALSE
      AND COALESCE(em.suspendido, FALSE) = FALSE
    LEFT JOIN evento_tandas et ON et.id = (
      SELECT MIN(id) FROM evento_tandas
      WHERE evento_id = e.id AND estado = 'activa'
    )
    LEFT JOIN (
      SELECT evento_id, MIN(fecha) AS proxima_fecha
      FROM evento_fechas
      GROUP BY evento_id
    ) ef_stats ON ef_stats.evento_id = e.id
    LEFT JOIN (
      SELECT ec.evento_id,
        MIN(CASE WHEN ec.tanda_id IS NULL OR et2.estado = 'activa' THEN ec.precio END) AS precio_desde,
        COALESCE(SUM(CASE WHEN ec.tanda_id IS NULL OR et2.estado = 'activa' THEN ec.stock_disponible ELSE 0 END), 0) AS stock_total
      FROM entrada_categorias ec
      LEFT JOIN evento_tandas et2 ON et2.id = ec.tanda_id
      WHERE ec.activa = TRUE
      GROUP BY ec.evento_id
    ) ec_stats ON ec_stats.evento_id = e.id
    GROUP BY e.id, e.tipo_mapa, et.id, et.nombre, et.descripcion, et.imagen_url, ef_stats.proxima_fecha, ec_stats.precio_desde, ec_stats.stock_total
    ORDER BY ef_stats.proxima_fecha ASC
  `

  const data = eventos
    .map((evento: EventoListRow) => {
      const serialized = serializeTenantPublicEvent(evento)
      return {
        ...serialized,
        tanda_activa: evento.tanda_activa_id
          ? {
              id: evento.tanda_activa_id,
              nombre: evento.tanda_activa_nombre,
              descripcion: evento.tanda_activa_descripcion,
              imagen_url: evento.tanda_activa_imagen_url,
            }
          : null,
      }
    })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((evento: any) => evento.is_listed)

  return res.json({ data: { eventos: data } })
})

// GET /tenant/:slug/consumibles — eventos activos habilitados para venta pública de consumibles
router.get('/:slug/consumibles', verifyInternal, async (req: Request, res: Response) => {
  const { slug } = req.params

  // Resolve empresa via Prisma (slug stored lowercase per design)
  const empresaResultConsumibles = await findPublicTenant(slug).then(async (e) => {
    if (!e) return null
    return prisma.empresa.findUnique({
      where: { id: e.id },
      select: { id: true, buyer_auto_refunds_enabled: true, buyer_auto_refunds_scope: true },
    })
  })

  if (!empresaResultConsumibles) return res.status(404).json({ error: 'Empresa no encontrada' })

  type ConsumiblesEventoRow = {
    id: string; nombre: string; descripcion: string | null; lugar: string | null; imagen_url: string | null;
    modo_fecha: string | null; activo: boolean; venta_consumibles_habilitada: boolean;
    publication_mode: string | null; pre_publish_visibility: string | null;
    publish_at_utc: Date | null; publish_timezone: string | null; published_live_at: Date | null;
    proxima_fecha: Date | null; barras_activas: bigint; items_disponibles: bigint; stock_total_consumibles: bigint;
  }
  const eventosConsumibles = await prisma.$queryRaw<ConsumiblesEventoRow[]>`
    SELECT e.id, e.nombre, e.descripcion, e.lugar, e.imagen_url, e.modo_fecha, e.activo, e.venta_consumibles_habilitada,
      e.publication_mode, e.pre_publish_visibility, e.publish_at_utc, e.publish_timezone, e.published_live_at,
      ef_stats.proxima_fecha,
      COUNT(DISTINCT CASE WHEN b.activa = TRUE THEN b.id END) AS barras_activas,
      COUNT(CASE WHEN b.activa = TRUE AND bs.activo = TRUE AND c.activo = TRUE AND bs.agotado = FALSE AND (bs.stock_ilimitado = TRUE OR bs.stock_actual > 0) THEN 1 END) AS items_disponibles,
      COALESCE(SUM(CASE WHEN b.activa = TRUE AND bs.activo = TRUE AND c.activo = TRUE THEN bs.stock_actual ELSE 0 END), 0) AS stock_total_consumibles
    FROM eventos e
    JOIN empresas em ON em.id = e.empresa_id
      AND em.slug = ${slug}
      AND em.activa = TRUE
      AND COALESCE(em.tenant_public_disabled, FALSE) = FALSE
      AND COALESCE(em.suspendido, FALSE) = FALSE
    LEFT JOIN (
      SELECT evento_id, MIN(fecha) AS proxima_fecha
      FROM evento_fechas
      GROUP BY evento_id
    ) ef_stats ON ef_stats.evento_id = e.id
    LEFT JOIN barras b ON b.evento_id = e.id AND b.empresa_id = e.empresa_id
    LEFT JOIN barra_stock bs ON bs.barra_id = b.id
    LEFT JOIN consumibles c ON c.id = bs.consumible_id
    WHERE e.venta_consumibles_habilitada = TRUE
    GROUP BY e.id, ef_stats.proxima_fecha
    ORDER BY ef_stats.proxima_fecha ASC, e.nombre ASC
  `

  return res.json({
    data: {
      eventos: eventosConsumibles
        .map((evento: ConsumiblesEventoRow) => ({
          ...serializeTenantPublicEvent(evento),
          venta_consumibles_habilitada: Boolean(evento.venta_consumibles_habilitada),
          barras_activas: Number(evento.barras_activas ?? 0n),
          items_disponibles: Number(evento.items_disponibles ?? 0n),
          stock_total_consumibles: Number(evento.stock_total_consumibles ?? 0n),
          consumibles_disponibles: Number(evento.items_disponibles ?? 0n) > 0,
        }))
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((evento: any) => evento.is_detail_visible),
    },
  })
})

// POST /tenant/:slug/registro
router.post('/:slug/registro', verifyInternal, async (req: Request, res: Response) => {
  const { slug } = req.params
  const { nombre, apellido, email, dni, password } = req.body

  if (!nombre || !apellido || !email || !password) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' })
  }

  if (typeof nombre !== 'string' || nombre.trim().length === 0 || nombre.trim().length > 80) {
    return res.status(400).json({ error: 'El nombre debe tener entre 1 y 80 caracteres' })
  }

  if (typeof apellido !== 'string' || apellido.trim().length === 0 || apellido.trim().length > 80) {
    return res.status(400).json({ error: 'El apellido debe tener entre 1 y 80 caracteres' })
  }

  if (typeof email !== 'string' || email.length > 254 || !email.includes('@') || !email.slice(email.indexOf('@') + 1).includes('.')) {
    return res.status(400).json({ error: 'El email no es válido' })
  }

  if (dni !== undefined && dni !== null && dni !== '') {
    if (typeof dni !== 'string' || !/^[a-zA-Z0-9]{1,15}$/.test(dni.trim())) {
      return res.status(400).json({ error: 'El DNI solo puede tener letras y números, máximo 15 caracteres' })
    }
  }

  const { telefono } = req.body
  if (telefono !== undefined && telefono !== null && telefono !== '') {
    if (typeof telefono !== 'string' || telefono.length > 30) {
      return res.status(400).json({ error: 'El teléfono no puede exceder 30 caracteres' })
    }
  }

  const validation = validatePasswordPolicy(password)
  if (!validation.ok) {
    return res.status(400).json(buildPasswordPolicyError(validation.reason))
  }

  const empresaTenant = await findPublicTenant(slug)

  if (!empresaTenant) {
    return res.status(404).json({ error: 'Empresa no encontrada' })
  }

  const empresaId = empresaTenant.id

  await ensureIdentityConstraints()

  let normalizedEmail: string
  try {
    normalizedEmail = await assertBuyerEmailAvailable(email, String(empresaId))
  } catch (error) {
    if (error instanceof Error && error.message === 'Ya existe una cuenta compradora con ese email en esta empresa') {
      return res.status(409).json({ error: error.message })
    }
    throw error
  }

  const hashed = await bcrypt.hash(password, 12)
  const id = uuidv4()

  await prisma.comprador.create({
    data: {
      id,
      empresa_id: String(empresaId),
      nombre: `${nombre} ${apellido}`,
      email: normalizedEmail,
      dni: dni ?? null,
      password: hashed,
    },
  })

  return res.status(201).json({ ok: true })
})

// GET /tenant/:slug/auth/token
// Legacy endpoint disabled: el consumo del token mágico ahora vive exclusivamente
// en el provider server-side de NextAuth para evitar side effects por GET y fuga de PII.
router.get('/:slug/auth/token', verifyInternal, async (req: Request, res: Response) => {
  void req
  return res.status(410).json({ error: 'Este endpoint ya no está disponible. Usá el flujo de acceso actual.' })
})

// POST /tenant/:slug/password/forgot
router.post('/:slug/password/forgot', verifyInternal, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params
    const isDev = process.env.NODE_ENV === 'development'
    const tenantBase = buildTenantBaseUrl(slug)

  const empresaTenant = await findPublicTenant(slug)

  if (!empresaTenant) {
    return res.status(404).json({ error: 'Empresa no encontrada' })
  }

  const result = await requestPasswordReset({
      actorType: 'comprador',
      email: typeof req.body?.email === 'string' ? req.body.email : '',
      tenantSlug: slug,
      resetBaseUrl: tenantBase,
      requestIp: req.requestMeta?.ip ?? getRequestIp(req),
      requestUserAgent: req.requestMeta?.userAgent ?? getRequestUserAgent(req),
    })

    if (!result.ok) {
      return res.status(result.status).json(result)
    }

    return res.status(result.status).json(result.data)
  } catch (error) {
    logServerError('tenant password forgot')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /tenant/:slug/password/reset
router.post('/:slug/password/reset', verifyInternal, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params
    const empresaTenant = await findPublicTenant(slug)

    if (!empresaTenant) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    const result = await consumePasswordReset({
      actorType: 'comprador',
      tenantSlug: slug,
      token: typeof req.body?.token === 'string' ? req.body.token : '',
      nuevaPassword: typeof req.body?.nuevaPassword === 'string' ? req.body.nuevaPassword : '',
      confirmarPassword: typeof req.body?.confirmarPassword === 'string' ? req.body.confirmarPassword : '',
      consumedIp: req.requestMeta?.ip ?? getRequestIp(req),
      consumedUserAgent: req.requestMeta?.userAgent ?? getRequestUserAgent(req),
    })

    if (!result.ok) {
      return res.status(result.status).json(result)
    }

    return res.status(result.status).json(result.data)
  } catch (error) {
    logServerError('tenant password reset')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.get('/:slug/account', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const context = await resolveTenantBuyerAccountContext(req, res)
    if (!context) return

    const result = await getBuyerAccountSnapshot(context)
    if (!result.ok) {
      return res.status(result.status).json(result)
    }

    return res.status(result.status).json({
      data: {
        ...result.data,
        whatsappVerification: {
          providerAvailable: isBuyerMessagingProviderAvailable(),
        },
      },
    })
  } catch {
    logServerError('tenant account get')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.patch('/:slug/account/password', verifyInternal, requireAuth, buyerAccountPasswordRateLimit, async (req: Request, res: Response) => {
  try {
    const context = await resolveTenantBuyerAccountContext(req, res)
    if (!context) return

    const result = await changeBuyerPassword({
      ...context,
      currentPassword: typeof req.body?.currentPassword === 'string' ? req.body.currentPassword : '',
      newPassword: typeof req.body?.newPassword === 'string' ? req.body.newPassword : '',
      confirmPassword: typeof req.body?.confirmPassword === 'string' ? req.body.confirmPassword : '',
    })

    if (!result.ok) {
      return res.status(result.status).json(result)
    }

    return res.status(result.status).json(result.data)
  } catch {
    logServerError('tenant account password patch')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.post('/:slug/account/whatsapp/request-code', verifyInternal, requireAuth, buyerAccountWhatsappRequestRateLimit, async (req: Request, res: Response) => {
  try {
    const context = await resolveTenantBuyerAccountContext(req, res)
    if (!context) return

    const result = await requestBuyerWhatsAppCode({
      ...context,
      phone: typeof req.body?.phone === 'string' ? req.body.phone : '',
    })

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error })
    }

    return res.status(result.status).json({ data: result.data })
  } catch {
    logServerError('tenant whatsapp request code')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.post('/:slug/account/whatsapp/verify-code', verifyInternal, requireAuth, buyerAccountWhatsappVerifyRateLimit, async (req: Request, res: Response) => {
  try {
    const context = await resolveTenantBuyerAccountContext(req, res)
    if (!context) return

    const result = await verifyBuyerWhatsAppCode({
      ...context,
      phone: typeof req.body?.phone === 'string' ? req.body.phone : '',
      code: typeof req.body?.code === 'string' ? req.body.code : '',
    })

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error })
    }

    return res.status(result.status).json({ data: result.data })
  } catch {
    logServerError('tenant whatsapp verify code')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.patch('/:slug/account/delivery-preference', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const context = await resolveTenantBuyerAccountContext(req, res)
    if (!context) return

    const result = await updateBuyerDeliveryPreference({
      ...context,
      deliveryPreference: typeof req.body?.deliveryPreference === 'string' ? req.body.deliveryPreference : '',
    })

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error })
    }

    return res.status(result.status).json({ data: result.data })
  } catch {
    logServerError('tenant delivery preference patch')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /tenant/:slug/evento/:id/categorias
router.get('/:slug/evento/:id/categorias', verifyInternal, async (req: Request, res: Response) => {
  const { slug, id } = req.params

  // Resolve empresa via Prisma (slug stored lowercase per design)
  const empresaForCategorias = await findPublicTenant(slug)
  if (!empresaForCategorias) return res.status(404).json(buildPublicationHiddenDetailError())

  const eventoForCategorias = await prisma.evento.findFirst({
    where: { id, empresa_id: empresaForCategorias.id },
    select: { id: true, activo: true, publication_mode: true, pre_publish_visibility: true, publish_at_utc: true, publish_timezone: true, published_live_at: true },
  })

  if (!eventoForCategorias) return res.status(404).json(buildPublicationHiddenDetailError())

  const publication = buildEventPublicationSnapshot(eventoForCategorias as unknown as EventPublicationSource)
  if (!publication.is_detail_visible) return res.status(404).json(buildPublicationHiddenDetailError())

  const categorias = await prisma.$queryRaw<{ id: string; nombre: string; descripcion: string | null; precio: number; stock_disponible: number; entradas_por_unidad: number }[]>`
    SELECT ec.id, ec.nombre, ec.descripcion, ec.precio::float AS precio, ec.stock_disponible, ec.entradas_por_unidad
    FROM entrada_categorias ec
    LEFT JOIN evento_tandas et ON et.id = ec.tanda_id
    WHERE ec.evento_id = ${id} AND ec.activa = true
      AND (ec.tanda_id IS NULL OR (et.evento_id = ${id} AND et.estado = 'activa'))
    ORDER BY ec.precio ASC
  `

  // Fee billing mode: mismo enriquecimiento que GET /:slug/evento/:id (línea ~3048) — este
  // endpoint alimenta el modal de compra rápida del home del tenant, que también necesita
  // precio_buyer/fee_buyer_amount (ej. para el SeatPicker de eventos numerados). Sin esto el
  // modal mostraba el precio sin el cargo por servicio del comprador.
  const feeBillingModeCategorias = normalizeFeeBillingMode(empresaForCategorias.fee_billing_mode)
  const buyerFeeFractionCategorias = resolveBuyerFeeFraction(feeBillingModeCategorias, Number(empresaForCategorias.fee_split_buyer_pct))
  let feePctEffectiveCategorias = 0
  if (buyerFeeFractionCategorias > 0) {
    const sample = await resolveMarketplaceFee(empresaForCategorias.id, 1000, 'entradas')
    feePctEffectiveCategorias = sample.amount > 0 ? (sample.amount / 1000) * buyerFeeFractionCategorias : 0
  }
  const categoriasEnriquecidas = categorias.map((cat) => {
    const feeBuyer = feePctEffectiveCategorias > 0
      ? Math.round((Number(cat.precio) * feePctEffectiveCategorias + Number.EPSILON) * 100) / 100
      : 0
    return {
      ...cat,
      precio_buyer: Math.round((Number(cat.precio) + feeBuyer + Number.EPSILON) * 100) / 100,
      fee_buyer_amount: feeBuyer,
    }
  })

  return res.json({ categorias: categoriasEnriquecidas })
})

// GET /tenant/:slug/evento/:id/consumibles
router.get('/:slug/evento/:id/consumibles', verifyInternal, async (req: Request, res: Response) => {
  const { slug, id } = req.params

  try {
    const empresaForConsumibles = await findPublicTenant(slug)

    if (!empresaForConsumibles) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    const barras = await getTenantConsumiblesCatalog(slug, id)
    if (barras === null) {
      return res.status(404).json({ error: 'Evento no encontrado' })
    }

    return res.json({ data: { barras } })
  } catch {
    logServerError('tenant evento consumibles get')
    return res.status(500).json({ error: 'No se pudo cargar el catálogo de consumibles' })
  }
})

// GET /tenant/:slug/mis-consumibles — ventas públicas de consumibles del comprador autenticado
router.get('/:slug/mis-consumibles', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params
    if (rejectTenantActorMismatch(req, res, slug)) return
    const user = req.user!

    if (!requireUserType(user, ['comprador'], res, 'No autorizado')) return
    if (!user.id || !user.empresa_slug || user.empresa_slug !== slug) return res.status(401).json({ error: 'No autorizado' })

    const empresaForMisConsumibles = await findPublicTenant(slug)
    if (!empresaForMisConsumibles) return res.status(404).json({ error: 'Empresa no encontrada' })

    const empresaForRefundPolicy = await prisma.empresa.findUnique({
      where: { id: empresaForMisConsumibles.id },
      select: { buyer_auto_refunds_enabled: true, buyer_auto_refunds_scope: true },
    })

    type VentaRow = {
      id: string; qr_code: string; clave_corta: string; total: number; estado: string
      canjeado_at: Date | null; resuelto_at: Date | null; delivered_amount: number | null
      refunded_amount: number | null; created_at: Date; barra_id: string; barra_nombre: string
      buyer_consumible_refunds_enabled: boolean; evento_id: string; evento_nombre: string
    }
    const ventas = await prisma.$queryRaw<VentaRow[]>`
      SELECT cv.id, cv.qr_code, cv.clave_corta, cv.total::float AS total, cv.estado, cv.canjeado_at, cv.resuelto_at,
             cv.delivered_amount::float AS delivered_amount, cv.refunded_amount::float AS refunded_amount, cv.created_at,
             cv.barra_id, b.nombre AS barra_nombre, COALESCE(b.buyer_consumible_refunds_enabled, true) AS buyer_consumible_refunds_enabled,
             ev.id AS evento_id, ev.nombre AS evento_nombre
      FROM consumibles_ventas cv
      JOIN barras b ON b.id = cv.barra_id
      JOIN eventos ev ON ev.id = cv.evento_id
      WHERE cv.comprador_id = ${user.id} AND cv.empresa_id = ${empresaForMisConsumibles.id} AND cv.origen = 'tenant_publico'
      ORDER BY cv.created_at DESC
      LIMIT ${HARD_LIMIT}
    `

    if (!ventas.length) {
      return res.json({ data: { ventas: [] } })
    }

    const ventaIds = ventas.map((venta) => String(venta.id))

    type VentaItemRow = {
      venta_id: string; consumible_id: string; venta_item_id: string; nombre: string
      cantidad: number; precio_unitario: number; subtotal: number
      cantidad_entregada: number | null; cantidad_reembolsada: number | null
      monto_entregado: number | null; monto_reembolsado: number | null; resolution_reason: string | null
    }
    const items = await prisma.$queryRaw<VentaItemRow[]>`
      SELECT cvi.venta_id, cvi.consumible_id, cvi.id AS venta_item_id, cvi.nombre_snapshot AS nombre,
             cvi.cantidad, cvi.precio_unitario::float AS precio_unitario, cvi.subtotal::float AS subtotal,
             cvri.cantidad_entregada, cvri.cantidad_reembolsada,
             cvri.monto_entregado::float AS monto_entregado, cvri.monto_reembolsado::float AS monto_reembolsado,
             cvri.resolution_reason
      FROM consumibles_venta_items cvi
      JOIN consumibles_ventas cv ON cv.id = cvi.venta_id AND cv.empresa_id = ${empresaForMisConsumibles.id}
      LEFT JOIN consumibles_venta_resolucion_items cvri ON cvri.venta_item_id = cvi.id
      WHERE cvi.venta_id = ANY(${ventaIds}::text[])
      ORDER BY cvi.nombre_snapshot ASC
    `

    const ventaItemIds = items.map((item) => String(item.venta_item_id))
    const refundByVentaItem = new Map<string, {
      executed_quantity: number
      requested_quantity: number
      rejected_quantity: number
      latest_case_id: string | null
      latest_status: string | null
    }>()

    if (ventaItemIds.length) {
      // Postgres: replace MySQL SUBSTRING_INDEX+GROUP_CONCAT with DISTINCT ON / FIRST_VALUE window function approach
      type RefundAggRow = {
        venta_item_id: string
        executed_quantity: number
        requested_quantity: number
        rejected_quantity: number
        latest_case_id: string | null
        latest_status: string | null
      }
      const refundRows = await prisma.$queryRaw<RefundAggRow[]>`
        SELECT
          ci.venta_item_id,
          COALESCE(SUM(CASE WHEN ci.status = 'executed' THEN ci.quantity_executed ELSE 0 END), 0)::int AS executed_quantity,
          COALESCE(SUM(CASE WHEN ci.status IN ('requested', 'under_review', 'approved_for_manual_execution') THEN ci.quantity_requested ELSE 0 END), 0)::int AS requested_quantity,
          COALESCE(SUM(CASE WHEN ci.status = 'rejected' THEN ci.quantity_rejected ELSE 0 END), 0)::int AS rejected_quantity,
          (SELECT ci2.case_id FROM refund_manual_case_consumible_items ci2
           WHERE ci2.venta_item_id = ci.venta_item_id
           ORDER BY ci2.updated_at DESC, ci2.id DESC LIMIT 1) AS latest_case_id,
          (SELECT ci2.status FROM refund_manual_case_consumible_items ci2
           WHERE ci2.venta_item_id = ci.venta_item_id
           ORDER BY ci2.updated_at DESC, ci2.id DESC LIMIT 1) AS latest_status
        FROM refund_manual_case_consumible_items ci
        WHERE ci.venta_item_id = ANY(${ventaItemIds}::text[])
        GROUP BY ci.venta_item_id
      `

      for (const refundRow of refundRows) {
        refundByVentaItem.set(String(refundRow.venta_item_id), {
          executed_quantity: Number(refundRow.executed_quantity ?? 0),
          requested_quantity: Number(refundRow.requested_quantity ?? 0),
          rejected_quantity: Number(refundRow.rejected_quantity ?? 0),
          latest_case_id: typeof refundRow.latest_case_id === 'string' ? refundRow.latest_case_id : null,
          latest_status: typeof refundRow.latest_status === 'string' ? refundRow.latest_status : null,
        })
      }
    }

    const itemsByVenta = new Map<string, VentaItemRow[]>()
    for (const item of items) {
      const ventaId = String(item.venta_id)
      const current = itemsByVenta.get(ventaId) ?? []
      current.push(item)
      itemsByVenta.set(ventaId, current)
    }

    const automaticRefundMode = normalizeBuyerAutomaticRefundMode(
      empresaForRefundPolicy?.buyer_auto_refunds_enabled ?? false,
      empresaForRefundPolicy?.buyer_auto_refunds_scope ?? 'todos',
    )

    return res.json({
      data: {
        ventas: ventas.map((venta) => ({
          ...venta,
          total: Number(venta.total),
          delivered_amount: venta.delivered_amount == null ? null : Number(venta.delivered_amount),
          refunded_amount: venta.refunded_amount == null ? null : Number(venta.refunded_amount),
          buyer_consumible_refunds_enabled: Number(venta.buyer_consumible_refunds_enabled ?? 1) === 1,
          refund_policy: {
            enabled: automaticRefundMode !== 'manual',
            mode: automaticRefundMode,
            applies: shouldAutoRefundBuyerFlow(automaticRefundMode, 'consumibles'),
          },
          items: (itemsByVenta.get(String(venta.id)) ?? []).map((item) => {
            const refund = refundByVentaItem.get(String(item.venta_item_id))
            const originalQuantity = Number(item.cantidad)
            const executedQuantity = refund?.executed_quantity ?? 0
            const requestedQuantity = refund?.requested_quantity ?? 0
            const rejectedQuantity = refund?.rejected_quantity ?? 0

            return {
            venta_item_id: item.venta_item_id,
            consumible_id: item.consumible_id,
            nombre: item.nombre,
            cantidad: Number(item.cantidad),
            precio_unitario: Number(item.precio_unitario),
            subtotal: Number(item.subtotal),
            cantidad_entregada: item.cantidad_entregada == null ? null : Number(item.cantidad_entregada),
            cantidad_reembolsada: item.cantidad_reembolsada == null ? null : Number(item.cantidad_reembolsada),
            monto_entregado: item.monto_entregado == null ? null : Number(item.monto_entregado),
            monto_reembolsado: item.monto_reembolsado == null ? null : Number(item.monto_reembolsado),
            resolution_reason: typeof item.resolution_reason === 'string' ? item.resolution_reason : null,
            refund: {
              eligible_quantity: Math.max(0, originalQuantity - executedQuantity - requestedQuantity),
              requested_quantity: requestedQuantity,
              executed_quantity: executedQuantity,
              rejected_quantity: rejectedQuantity,
              existing_request: refund?.latest_case_id
                ? { case_id: refund.latest_case_id, status: refund.latest_status }
                : null,
            },
          }
          }),
        })),
      },
    })
  } catch {
    logServerError('tenant mis consumibles')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /tenant/:slug/mis-tickets — tickets del comprador autenticado
router.get('/:slug/mis-tickets', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const { slug } = req.params
  if (rejectTenantActorMismatch(req, res, slug)) return
  const user = req.user!

  if (!requireUserType(user, ['comprador'], res, 'No autorizado')) return
  if (!user.id || !user.empresa_slug || user.empresa_slug !== slug) return res.status(401).json({ error: 'No autorizado' })

  type MisTicketsCompradorRow = {
    id: string
    buyer_auto_refunds_enabled: boolean | null
    buyer_auto_refunds_scope: string | null
    buyer_request_window_days: number | null
  }
  const compradorRows = await prisma.$queryRaw<MisTicketsCompradorRow[]>`
    SELECT c.id, emp.buyer_auto_refunds_enabled, emp.buyer_auto_refunds_scope,
           COALESCE(emp.buyer_request_window_days, 30) AS buyer_request_window_days
    FROM compradores c
    JOIN empresas emp ON emp.id = c.empresa_id
      AND emp.slug = ${slug}
      AND emp.activa = TRUE
      AND COALESCE(emp.tenant_public_disabled, FALSE) = FALSE
      AND COALESCE(emp.suspendido, FALSE) = FALSE
    WHERE c.id = ${user.id}
    LIMIT 1
  `

  if (!compradorRows[0]) {
    return res.json({ data: { entradas: [] } })
  }

  type MisTicketsEntradaRow = {
    id: string; qr_code: string; clave_corta: string | null; estado: string; precio_pagado: number; created_at: Date;
    evento_nombre: string; imagen_url: string | null; lugar: string | null;
    categoria_nombre: string | null; funcion_fecha: Date | null;
    company_buyer_event_refunds_enabled: boolean; event_buyer_event_refunds_enabled: boolean;
    refund_checkout_session_id: string | null; refund_checkout_status: string | null;
    refund_request_case_id: string | null; refund_request_status: string | null;
    refund_request_origin: string | null; refund_request_note: string | null; refund_request_reason: string | null;
  }
  const entradas = await prisma.$queryRaw<MisTicketsEntradaRow[]>`
    SELECT
      en.id, en.qr_code, en.clave_corta, en.estado, en.precio_pagado::float AS precio_pagado, en.created_at,
      ev.nombre AS evento_nombre, ev.imagen_url, ev.lugar,
      ec.nombre AS categoria_nombre,
      ef.fecha AS funcion_fecha,
      COALESCE(emp.buyer_event_refunds_enabled, FALSE) AS company_buyer_event_refunds_enabled,
      COALESCE(ev.buyer_event_refunds_enabled, FALSE) AS event_buyer_event_refunds_enabled,
      alloc.checkout_session_id AS refund_checkout_session_id,
      cs.estado AS refund_checkout_status,
      latest_case.id AS refund_request_case_id,
      latest_case.status AS refund_request_status,
      latest_case.request_origin AS refund_request_origin,
      latest_case.request_note AS refund_request_note,
      latest_case.request_reason AS refund_request_reason
    FROM entradas en
    JOIN eventos ev ON ev.id = en.evento_id
    JOIN empresas emp ON emp.id = ev.empresa_id
    LEFT JOIN entrada_categorias ec ON ec.id = en.categoria_id
    LEFT JOIN evento_fechas ef ON ef.id = en.fecha_id
    LEFT JOIN platform_sale_allocations alloc
      ON alloc.id = (
        SELECT psa.id
        FROM platform_sale_allocations psa
        WHERE psa.source_type = 'entrada'
          AND psa.source_id = en.id
          AND psa.entry_kind = 'allocation'
        ORDER BY psa.created_at DESC, psa.id DESC
        LIMIT 1
      )
    LEFT JOIN checkout_sessions cs
      ON cs.id = alloc.checkout_session_id
     AND cs.empresa_id = emp.id
    LEFT JOIN refund_manual_cases latest_case
      ON latest_case.id = (
        SELECT rmc.id
        FROM refund_manual_cases rmc
        WHERE rmc.empresa_id = emp.id
          AND rmc.requested_entry_id = en.id
        ORDER BY rmc.created_at DESC, rmc.id DESC
        LIMIT 1
      )
    WHERE en.comprador_id = ${user.id}
      AND emp.slug = ${slug}
    ORDER BY en.created_at DESC
    LIMIT ${HARD_LIMIT}
  `

  const automaticRefundMode = normalizeBuyerAutomaticRefundMode(compradorRows[0].buyer_auto_refunds_enabled, compradorRows[0].buyer_auto_refunds_scope)
  const requestWindowDays = Number(compradorRows[0].buyer_request_window_days ?? 30)

  return res.json({
    data: {
      entradas: entradas.map((entrada: MisTicketsEntradaRow) => {
        const requestStatus = typeof entrada.refund_request_status === 'string' ? entrada.refund_request_status : null
        const companyEnabled = Boolean(entrada.company_buyer_event_refunds_enabled)
        const eventEnabled = Boolean(entrada.event_buyer_event_refunds_enabled)
        const effectivePolicy = companyEnabled && eventEnabled
        const linkedConfirmedCheckout = typeof entrada.refund_checkout_session_id === 'string' && entrada.refund_checkout_status === 'confirmada'
        const existingRequest = typeof entrada.refund_request_case_id === 'string'
          ? {
              case_id: String(entrada.refund_request_case_id),
              status: requestStatus,
              origin: typeof entrada.refund_request_origin === 'string' ? entrada.refund_request_origin : null,
              reason: typeof entrada.refund_request_reason === 'string' ? entrada.refund_request_reason : null,
              note: typeof entrada.refund_request_note === 'string' ? entrada.refund_request_note : null,
              is_open: isOpenRefundRequestStatus(requestStatus),
            }
          : null

        // Plazo del comprador para PEDIR reembolso de esta entrada.
        // El backend tambien lo valida; aca lo exponemos para que la UI muestre badge / disabled.
        let requestWindowExpiresAt: string | null = null
        let requestWindowExpired = false
        if (requestWindowDays > 0 && entrada.created_at) {
          const purchased = entrada.created_at instanceof Date ? entrada.created_at : new Date(entrada.created_at)
          if (!Number.isNaN(purchased.getTime())) {
            const deadlineMs = purchased.getTime() + requestWindowDays * 24 * 60 * 60 * 1000
            requestWindowExpiresAt = new Date(deadlineMs).toISOString()
            requestWindowExpired = Date.now() > deadlineMs
          }
        }

        return {
          ...entrada,
          refund: {
            eligible:
              effectivePolicy
              && linkedConfirmedCheckout
              && entrada.estado === 'valida'
              && !existingRequest
              && !requestWindowExpired,
            company_enabled: companyEnabled,
            event_enabled: eventEnabled,
            checkout_session_id: typeof entrada.refund_checkout_session_id === 'string' ? entrada.refund_checkout_session_id : null,
            existing_request: existingRequest,
            automatic_policy: {
              enabled: automaticRefundMode !== 'manual',
              mode: automaticRefundMode,
              applies: shouldAutoRefundBuyerFlow(automaticRefundMode, 'entradas'),
            },
            request_window: {
              days: requestWindowDays,
              expires_at: requestWindowExpiresAt,
              expired: requestWindowExpired,
            },
          },
        }
      }),
    },
  })
})

router.post('/:slug/refunds', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params
    const user = req.user!

    if (!requireUserType(user, ['comprador'], res, 'No autorizado')) return
    if (!user.id || !user.empresa_slug || user.empresa_slug !== slug) return res.status(401).json({ error: 'No autorizado' })

    const empresaForRefund = await findPublicTenant(slug)

    if (!empresaForRefund) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    const entradaId = typeof req.body?.entrada_id === 'string' ? req.body.entrada_id.trim() : ''
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : ''
    const note = typeof req.body?.note === 'string' ? req.body.note : null

    if (!entradaId) {
      return res.status(400).json({ error: 'entrada_id es requerido' })
    }

    const result = await createBuyerEventRefundRequest({
      empresaId: empresaForRefund.id,
      buyerId: String(user.id),
      entryId: entradaId,
      actorId: String(user.id),
      reason,
      note,
    })

    if (!result.ok) {
      return res.status(result.status).json(
        result.data ? { error: result.error, data: result.data } : { error: result.error }
      )
    }

    return res.status(result.status).json(result.data)
  } catch {
    logServerError('tenant buyer refund create')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.post('/:slug/consumibles-refund-requests', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params
    const user = req.user!

    if (!requireUserType(user, ['comprador'], res, 'No autorizado')) return
    if (!user.id || !user.empresa_slug || user.empresa_slug !== slug) return res.status(401).json({ error: 'No autorizado' })

    const empresaForConsumibleRefund = await findPublicTenant(slug)

    if (!empresaForConsumibleRefund) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    const items = Array.isArray(req.body?.items) ? req.body.items : []
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : ''
    const note = typeof req.body?.note === 'string' ? req.body.note : null

    const result = await createBuyerConsumibleRefundRequest({
      empresaId: empresaForConsumibleRefund.id,
      buyerId: String(user.id),
      actorId: String(user.id),
      reason,
      note,
      items,
    })

    if (!result.ok) {
      return res.status(result.status).json(
        result.data ? { error: result.error, data: result.data } : { error: result.error }
      )
    }

    return res.status(result.status).json(result.data)
  } catch {
    logServerError('tenant buyer consumible refund create')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /tenant/:slug/evento/:id — detalle público del evento
router.get('/:slug/evento/:id', verifyInternal, async (req: Request, res: Response) => {
  const { slug, id } = req.params

  // Resolve empresa via Prisma then join evento with tanda
  const empresaForEvento = await findPublicTenant(slug)
  if (!empresaForEvento) return res.status(404).json({ error: 'Evento no encontrado' })

  type EventoDetailRow = {
    id: string; nombre: string; descripcion: string | null; lugar: string | null; imagen_url: string | null
    modo_fecha: string; tipo_mapa: string | null; activo: boolean; venta_consumibles_habilitada: boolean
    publication_mode: string; pre_publish_visibility: string; publish_at_utc: Date | null
    publish_timezone: string | null; published_live_at: Date | null
    empresa_id: string; slug: string; company_buyer_event_refunds_enabled: boolean
    tanda_activa_id: string | null; tanda_activa_nombre: string | null
    tanda_activa_descripcion: string | null; tanda_activa_imagen_url: string | null
    tanda_activa_activa_desde: Date | null
  }

  const eventoRows = await prisma.$queryRaw<EventoDetailRow[]>`
    SELECT e.id, e.nombre, e.descripcion, e.lugar, e.imagen_url,
           e.modo_fecha, e.tipo_mapa, e.activo, e.venta_consumibles_habilitada,
           e.publication_mode, e.pre_publish_visibility, e.publish_at_utc,
           e.publish_timezone, e.published_live_at,
           emp.id AS empresa_id, emp.slug,
           COALESCE(emp.buyer_event_refunds_enabled, false) AS company_buyer_event_refunds_enabled,
           et.id AS tanda_activa_id,
           et.nombre AS tanda_activa_nombre,
           et.descripcion AS tanda_activa_descripcion,
           et.imagen_url AS tanda_activa_imagen_url,
           et.activa_desde AS tanda_activa_activa_desde
    FROM eventos e
    JOIN empresas emp ON emp.id = e.empresa_id
      AND emp.id = ${empresaForEvento.id}
    LEFT JOIN evento_tandas et ON et.evento_id = e.id AND et.estado = 'activa'
    WHERE e.id = ${id}
  `

  if (!eventoRows[0]) return res.status(404).json({ error: 'Evento no encontrado' })
  const publication = buildEventPublicationSnapshot(eventoRows[0] as unknown as EventPublicationSource)
  if (!publication.is_detail_visible) return res.status(404).json(buildPublicationHiddenDetailError())

  // Paraleliza queries independientes — categorías, fechas y addons no dependen entre sí.
  const [categorias, fechas, addonsRaw] = await Promise.all([
    prisma.$queryRaw<{ id: string; nombre: string; descripcion: string | null; precio: number; stock_disponible: number; entradas_por_unidad: number }[]>`
      SELECT ec.id, ec.nombre, ec.descripcion, ec.precio::float AS precio, ec.stock_disponible, ec.entradas_por_unidad
      FROM entrada_categorias ec
      LEFT JOIN evento_tandas et ON et.id = ec.tanda_id
      WHERE ec.evento_id = ${id} AND ec.activa = true
        AND (ec.tanda_id IS NULL OR (et.evento_id = ${id} AND et.estado = 'activa'))
      ORDER BY ec.precio ASC
    `,
    prisma.$queryRaw<{ id: string; fecha: Date | null }[]>`
      SELECT id, fecha FROM evento_fechas WHERE evento_id = ${id} ORDER BY fecha ASC
    `,
    prisma.$queryRaw<{ id: string; nombre: string; descripcion: string | null; precio: number; stock_disponible: number; max_por_compra: number }[]>`
      SELECT id, nombre, descripcion, precio::float AS precio, stock_disponible, max_por_compra
      FROM evento_addons
      WHERE evento_id = ${id} AND activo = true AND stock_disponible > 0
      ORDER BY orden_visual ASC, created_at ASC
    `,
  ])

  const evento = eventoRows[0]

  // Fee billing mode: enriquecer cada categoría con precio_buyer + fee_buyer_amount según la
  // fracción del comprador p. El % efectivo se obtiene con un sample de 1000 ARS (exacto para fee
  // mode 'percentage', aproximado para 'fixed' o 'hybrid') y se MULTIPLICA por p, así el cargo por
  // servicio mostrado refleja solo la parte que paga el comprador (absorbed ⇒ sin cargo, split ⇒
  // parcial, passed_to_buyer ⇒ completo). El frontend usa estos valores para mostrar discriminado.
  const empresaFeeBillingMode = normalizeFeeBillingMode(empresaForEvento.fee_billing_mode)
  const empresaBuyerFeeFraction = resolveBuyerFeeFraction(empresaFeeBillingMode, Number(empresaForEvento.fee_split_buyer_pct))
  let feePctEffective = 0
  if (empresaBuyerFeeFraction > 0) {
    const sample = await resolveMarketplaceFee(empresaForEvento.id, 1000, 'entradas')
    feePctEffective = sample.amount > 0 ? (sample.amount / 1000) * empresaBuyerFeeFraction : 0
  }
  const categoriasEnriquecidas = categorias.map((cat) => {
    const feeBuyer = feePctEffective > 0
      ? Math.round((Number(cat.precio) * feePctEffective + Number.EPSILON) * 100) / 100
      : 0
    return {
      ...cat,
      precio_buyer: Math.round((Number(cat.precio) + feeBuyer + Number.EPSILON) * 100) / 100,
      fee_buyer_amount: feeBuyer,
    }
  })

  const addonsEnriquecidos = addonsRaw.map((a) => {
    const feeBuyer = feePctEffective > 0
      ? Math.round((Number(a.precio) * feePctEffective + Number.EPSILON) * 100) / 100
      : 0
    return {
      ...a,
      precio_buyer: Math.round((Number(a.precio) + feeBuyer + Number.EPSILON) * 100) / 100,
      fee_buyer_amount: feeBuyer,
    }
  })

  return res.json({
    data: {
      evento: {
        ...evento,
        ...publication,
        fee_billing_mode: empresaFeeBillingMode,
        tanda_activa: evento.tanda_activa_id
          ? {
              id: evento.tanda_activa_id,
              nombre: evento.tanda_activa_nombre,
              descripcion: evento.tanda_activa_descripcion,
              imagen_url: evento.tanda_activa_imagen_url,
              activa_desde: evento.tanda_activa_activa_desde,
            }
          : null,
      },
      categorias: categoriasEnriquecidas,
      fechas,
      addons: addonsEnriquecidos,
    },
  })
})

// POST /tenant/:slug/consumibles/checkout
router.post('/:slug/consumibles/checkout', verifyInternal, async (req: Request, res: Response) => {
  const { slug } = req.params

  if (rejectTenantActorMismatch(req, res, slug)) return

  if (!req.user || req.user.userType !== 'comprador' || !req.user.id || req.user.empresa_slug !== slug) {
    return res.status(401).json({ error: 'No autorizado' })
  }

  const MAX_CHECKOUT_ITEMS = 20
  const rawItems = Array.isArray(req.body?.items) ? (req.body.items as ConsumibleCheckoutItem[]) : []
  if (!rawItems.length) {
    return res.status(400).json({ error: 'items es requerido' })
  }
  if (rawItems.length > MAX_CHECKOUT_ITEMS) {
    return res.status(400).json({ error: `Máximo ${MAX_CHECKOUT_ITEMS} items por checkout` })
  }

  const empresaTenant = await findPublicTenant(slug)
  if (!empresaTenant) return res.status(404).json({ error: 'Empresa no encontrada' })

  const empresaId = empresaTenant.id
  const empresaNombre = empresaTenant.nombre

  const sameEvent = new Set(rawItems.map((item) => item.eventoId))
  if (sameEvent.size !== 1) {
    return res.status(400).json({ error: 'Todos los consumibles del checkout deben pertenecer al mismo evento' })
  }

  const requestedEventoId = rawItems[0]?.eventoId
  if (requestedEventoId) {
    const eventoForPublication = await prisma.evento.findFirst({
      where: { id: requestedEventoId, empresa_id: empresaId },
      select: { id: true, nombre: true, activo: true, publication_mode: true, pre_publish_visibility: true, publish_at_utc: true, publish_timezone: true, published_live_at: true },
    })

    if (!eventoForPublication || !buildEventPublicationSnapshot(eventoForPublication as unknown as EventPublicationSource).is_checkout_open) {
      return res.status(409).json(buildPublicationCheckoutError(eventoForPublication?.nombre ? String(eventoForPublication.nombre) : 'este evento'))
    }
  }

  try {
    await assertCanSell(empresaId)
  } catch (error) {
    if (error instanceof SalesReadinessError) {
      return res.status(error.statusCode).json(buildSalesNotReadyResponse(error))
    }

    logServerError('tenant consumibles checkout readiness validation')
    return res.status(500).json({ error: 'No se pudo validar la disponibilidad de cobro' })
  }

  const mpClient = await getMercadoPagoClientByEmpresaId(empresaId)
  if (!mpClient) {
    return res.status(409).json({
      code: 'sales_not_ready',
      status: 'missing_provider',
      reason: 'missing_provider',
      error: 'La empresa no está lista para vender',
    })
  }

  const compradorForCheckout = await prisma.comprador.findFirst({
    where: { email: String(req.user.email).trim().toLowerCase(), empresa_id: empresaId },
    select: { id: true },
  })
  if (!compradorForCheckout) return res.status(404).json({ error: 'Comprador no encontrado' })
  // Wrap in array-like shape to avoid touching the transaction code that uses compradorRows[0].id
  const compradorRows = [compradorForCheckout]

  const sessionId = uuidv4()
  const expiresAt = new Date(Date.now() + CHECKOUT_RESERVA_MINUTOS * 60 * 1000)

  let canonicalItems: ConsumibleCheckoutItem[] = []
  let sessionData: CheckoutSessionData | null = null

  type BarraStockLockRow = {
    id: string; barra_id: string; consumible_id: string; stock_actual: number; precio_override: string | null; activo: boolean
    stock_ilimitado: boolean; agotado: boolean
    barra_nombre: string; evento_id: string; barra_activa: boolean
    nombre: string; precio_base: string | number; consumible_activo: boolean
    evento_nombre: string; venta_consumibles_habilitada: boolean
    evento_activo: boolean; publication_mode: string; pre_publish_visibility: string
    publish_at_utc: Date | null; publish_timezone: string | null; published_live_at: Date | null
  }

  try {
    await withSerializableRetry(() =>
      prismaDirectUrl.$transaction(async (tx) => {
        // FOR UPDATE on checkout_sessions to prevent concurrent over-reservation.
        const activeSessionRows = await tx.$queryRaw<[{ total: bigint }]>`
          SELECT COUNT(*) as total FROM (
            SELECT 1
            FROM checkout_sessions
            WHERE comprador_id = ${String(compradorRows[0].id)} AND empresa_id = ${empresaId}
              AND estado = 'reservada' AND expires_at IS NOT NULL AND expires_at > NOW()
            FOR UPDATE
          ) AS locked
        `

        const activeReservedSessions = Number(activeSessionRows[0]?.total ?? 0)
        if (activeReservedSessions >= MAX_ACTIVE_CHECKOUT_SESSIONS_PER_BUYER) {
          throw Object.assign(new Error('too_many_sessions'), {
            _httpStatus: 429,
            _httpBody: { error: 'Ya tenés demasiadas reservas activas. Terminá o esperá que venza alguna antes de seguir.' },
          })
        }

        const requestedUnits = rawItems.reduce((acc, item) => acc + Number(item.cantidad ?? 0), 0)
        const activeReservedUnits = await getActiveReservedConsumiblesCountForBuyer(tx, String(compradorRows[0].id), empresaId)
        if (activeReservedUnits + requestedUnits > MAX_RESERVED_CONSUMIBLES_PER_BUYER) {
          throw Object.assign(new Error('too_many_units'), {
            _httpStatus: 429,
            _httpBody: { error: 'Superaste el máximo de consumibles reservados simultáneamente para este usuario.' },
          })
        }

        // Build pair arrays for ANY() — Postgres doesn't support dynamic OR conditions as safely
        const barraIds = rawItems.map((item) => item.barraId)
        const consumibleIds = rawItems.map((item) => item.consumibleId)

        // FOR UPDATE on barra_stock — consumable stock reservation lock.
        // Using INNER JOIN + ANY() to lock the specific rows needed.
        const stockRows = await tx.$queryRaw<BarraStockLockRow[]>`
          SELECT bs.id, bs.barra_id, bs.consumible_id, bs.stock_actual, bs.precio_override, bs.activo,
                 bs.stock_ilimitado, bs.agotado,
                 b.nombre AS barra_nombre, b.evento_id, b.activa AS barra_activa,
                 c.nombre, c.precio AS precio_base, c.activo AS consumible_activo,
                 e.nombre AS evento_nombre, e.venta_consumibles_habilitada,
                 e.activo AS evento_activo, e.publication_mode, e.pre_publish_visibility,
                 e.publish_at_utc, e.publish_timezone, e.published_live_at
          FROM barra_stock bs
          JOIN barras b ON b.id = bs.barra_id
          JOIN consumibles c ON c.id = bs.consumible_id
          JOIN eventos e ON e.id = b.evento_id
          WHERE b.empresa_id = ${empresaId}
            AND bs.barra_id = ANY(${barraIds}::text[])
            AND bs.consumible_id = ANY(${consumibleIds}::text[])
          ORDER BY bs.id
          FOR UPDATE
        `

        const stockMap = new Map<string, BarraStockLockRow>()
        for (const row of stockRows) {
          stockMap.set(`${row.barra_id}::${row.consumible_id}`, row)
        }

        canonicalItems = rawItems.map((item) => {
          if (!item.barraId || !item.consumibleId || !item.eventoId || !Number.isInteger(item.cantidad) || item.cantidad <= 0) {
            throw new Error('item_invalid')
          }

          const row = stockMap.get(`${item.barraId}::${item.consumibleId}`)
          if (!row) throw new Error(`stock_missing:${item.barraId}:${item.consumibleId}`)
          if (String(row.evento_id) !== String(item.eventoId)) throw new Error('event_mismatch')
          if (!row.venta_consumibles_habilitada) throw new Error('sale_disabled')
          if (!buildEventPublicationSnapshot({
            activo: row.evento_activo,
            publication_mode: row.publication_mode,
            pre_publish_visibility: row.pre_publish_visibility,
            publish_at_utc: row.publish_at_utc,
            publish_timezone: row.publish_timezone,
            published_live_at: row.published_live_at,
          }).is_checkout_open) {
            throw new Error(`event_not_live:${String(row.evento_nombre)}`)
          }
          if (!row.barra_activa || !row.activo || !row.consumible_activo) throw new Error('stock_inactive')
          // agotado: kill-switch manual — el comprador no puede comprarlo aunque haya stock.
          if (row.agotado) {
            throw Object.assign(new Error('sin_stock_consumible'), {
              _httpStatus: 409,
              _httpBody: { error: `"${String(row.nombre)}" está agotado` },
            })
          }

          return {
            barraId: String(row.barra_id),
            barraNombre: String(row.barra_nombre),
            consumibleId: String(row.consumible_id),
            nombre: String(row.nombre),
            precio: Number(row.precio_override ?? row.precio_base),
            cantidad: Number(item.cantidad),
            eventoId: String(row.evento_id),
            eventoNombre: String(row.evento_nombre),
          }
        })

        const requiredByKey = new Map<string, number>()
        for (const item of canonicalItems) {
          const key = `${item.barraId}::${item.consumibleId}`
          requiredByKey.set(key, (requiredByKey.get(key) ?? 0) + Number(item.cantidad))
        }

        for (const [key, cantidad] of requiredByKey.entries()) {
          const row = stockMap.get(key)
          if (!row) {
            throw Object.assign(new Error('sin_stock_consumible'), {
              _httpStatus: 409,
              _httpBody: { error: 'El consumible ya no está disponible' },
            })
          }
          // Los ítems con stock_ilimitado no se validan contra stock_actual.
          if (!row.stock_ilimitado && Number(row.stock_actual) < cantidad) {
            throw Object.assign(new Error('sin_stock_consumible'), {
              _httpStatus: 409,
              _httpBody: { error: `Solo quedan ${Number(row.stock_actual)} disponible${Number(row.stock_actual) === 1 ? '' : 's'} de "${row.nombre}" en ${row.barra_nombre}` },
            })
          }
        }

        const subtotalBase = canonicalItems.reduce((acc, item) => acc + Number(item.precio) * Number(item.cantidad), 0)
        const marketplaceFee = await resolveMarketplaceFee(empresaId, subtotalBase, 'consumibles')
        // Aplicar fee billing mode (mismo patrón que entradas — inflar items.precio por la fracción
        // del comprador p). p = 0 (absorbed, sin inflación), 1 (passed_to_buyer, fee completo) o
        // fee_split_buyer_pct/100 (split, fracción). El marketplace_fee absoluto NO cambia (la
        // plataforma cobra el fee completo vía MP application_fee).
        const feeBillingMode = normalizeFeeBillingMode(empresaTenant.fee_billing_mode)
        const buyerFeeFraction = resolveBuyerFeeFraction(feeBillingMode, Number(empresaTenant.fee_split_buyer_pct))
        if (buyerFeeFraction > 0 && subtotalBase > 0 && marketplaceFee.amount > 0) {
          const ratio = 1 + (marketplaceFee.amount * buyerFeeFraction / subtotalBase)
          for (const item of canonicalItems) {
            item.precio = Math.round((Number(item.precio) * ratio + Number.EPSILON) * 100) / 100
          }
        }
        sessionData = {
          flow: 'consumibles',
          items: canonicalItems,
          marketplaceFee: {
            amount: marketplaceFee.amount,
            currency: marketplaceFee.currency,
            metadata: marketplaceFee.metadata,
          },
          feeBillingMode,
          feeBuyerFraction: buyerFeeFraction,
          confirmationToken: generateCheckoutConfirmationToken(),
        }

        for (const [key, cantidad] of requiredByKey.entries()) {
          // Los ítems con stock_ilimitado no se descuentan (no se reserva stock).
          if (stockMap.get(key)?.stock_ilimitado) continue
          const [barraId, consumibleId] = key.split('::')
          await tx.$executeRaw`
            UPDATE barra_stock SET stock_actual = stock_actual - ${cantidad}
            WHERE barra_id = ${barraId} AND consumible_id = ${consumibleId}
          `
        }

        await tx.checkoutSession.create({
          data: {
            id: sessionId,
            comprador_id: String(compradorRows[0].id),
            empresa_id: empresaId,
            datos: JSON.stringify(sessionData),
            estado: 'reservada',
            expires_at: expiresAt,
          },
        })
      }, {
        isolationLevel: 'Serializable',
        maxWait: 5000,
        timeout: 15000,
      })
    )
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'item_invalid') return res.status(400).json({ error: 'Cada item debe tener barra, consumible y cantidad válida' })
      if (error.message.startsWith('stock_missing:')) return res.status(400).json({ error: 'Uno de los consumibles ya no está disponible en la barra seleccionada' })
      if (error.message === 'event_mismatch') return res.status(400).json({ error: 'Uno de los consumibles no pertenece al evento enviado' })
      if (error.message === 'sale_disabled') return res.status(409).json({ error: 'La venta pública de consumibles ya no está habilitada para este evento' })
      if (error.message.startsWith('event_not_live:')) return res.status(409).json(buildPublicationCheckoutError(error.message.slice('event_not_live:'.length)))
      if (error.message === 'stock_inactive') return res.status(409).json({ error: 'Uno de los consumibles ya no está operativo para venta pública' })
      const httpBody = (error as { _httpBody?: { error: string } } | null)?._httpBody
      const httpStatus = (error as { _httpStatus?: number } | null)?._httpStatus
      if (httpBody && httpStatus) return res.status(httpStatus).json(httpBody)
    }

    logServerError('tenant consumibles checkout reservation')
    return res.status(500).json({ error: 'No se pudo iniciar el checkout de consumibles' })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!
  const sessionDataTyped = sessionData as ConsumiblesCheckoutSessionData | null
  if (!sessionDataTyped?.marketplaceFee) {
    await cancelarReserva(sessionId, empresaId)
    return res.status(500).json({ error: 'No se pudo preparar la comisión del checkout' })
  }

  const totalBuyer = canonicalItems.reduce((acc, item) => acc + Number(item.precio) * item.cantidad, 0)
  if (totalBuyer <= 0) {
    await cancelarReserva(sessionId, empresaId)
    return res.status(400).json({ error: 'Los consumibles gratuitos no pueden procesarse vía Mercado Pago. Contactá al organizador.' })
  }

  const mpItems = canonicalItems.map((item) => ({
    id: `${item.barraId}:${item.consumibleId}`,
    title: `${item.eventoNombre} — ${item.barraNombre} · ${item.nombre}`,
    quantity: item.cantidad,
    unit_price: Number(item.precio),
    currency_id: 'ARS',
  }))

  const platformSponsorId = sessionDataTyped.marketplaceFee.amount > 0
    ? await getPlatformOwnerCollectorId()
    : null

  // Max cuotas configurado por la empresa. Si es 1 (default), MP solo ofrece pago al contado.
  // Cuotas SIN INTERÉS se manejan en el panel de promociones MP del vendedor, no acá.
  const maxInstallmentsConsumibles = Math.max(1, Math.min(24, empresaTenant.mp_max_installments ?? 1))

  const preference = new Preference(mpClient)
  try {
    const response = await preference.create({
      body: {
        items: mpItems,
        payer: { email: req.user.email! },
        back_urls: {
          success: `${baseUrl}/api/tenant/${slug}/pago/confirmar-redirect?session=${sessionId}&ct=${encodeURIComponent(sessionDataTyped.confirmationToken ?? '')}`,
          failure: `${baseUrl}/api/tenant/${slug}/pago/confirmar-redirect?session=${sessionId}&ct=${encodeURIComponent(sessionDataTyped.confirmationToken ?? '')}&status=failure`,
          pending: `${baseUrl}/api/tenant/${slug}/pago/confirmar-redirect?session=${sessionId}&ct=${encodeURIComponent(sessionDataTyped.confirmationToken ?? '')}&status=pending`,
        },
        notification_url: `${baseUrl}/api/tenant/${slug}/pago/webhook`,
        auto_return: 'approved',
        external_reference: sessionId,
        marketplace_fee: sessionDataTyped.marketplaceFee.amount,
        ...(platformSponsorId ? { sponsor_id: Number(platformSponsorId) } : {}),
        payment_methods: { installments: maxInstallmentsConsumibles },
        metadata: {
          session_id: sessionId,
          empresa_id: empresaId,
          checkout_flow: 'consumibles',
          marketplace_fee: {
            amount: sessionDataTyped.marketplaceFee.amount,
            ...sessionDataTyped.marketplaceFee.metadata,
          },
        },
        statement_descriptor: empresaNombre,
      },
    })

    return res.json({ init_point: response.init_point, expires_at: expiresAt.toISOString() })
  } catch {
    await cancelarReserva(sessionId, empresaId)
    logServerError('tenant consumibles mercadopago preference')
    return res.status(500).json({ error: 'No se pudo crear la preferencia de pago' })
  }
})

// POST /tenant/:slug/checkout
router.post('/:slug/checkout', verifyInternal, async (req: Request, res: Response) => {
  const { slug } = req.params

  if (rejectTenantActorMismatch(req, res, slug)) return

  // req.user puede ser null (comprador no autenticado) o un objeto con userType='comprador'
  if (!req.user || req.user.userType !== 'comprador' || !req.user.id || req.user.empresa_slug !== slug) {
    return res.status(401).json({ error: 'No autorizado' })
  }

  const { items, addons: addonsRaw, codigo_descuento: codigoDescuentoRaw, utm_source, utm_medium, utm_campaign, checkout_session_id: seatReservationIdRaw } = req.body
  // Injected by the BFF when the event has tipo_mapa=numerado — links this session to the seat reservation
  const seatReservationId = typeof seatReservationIdRaw === 'string' && seatReservationIdRaw ? seatReservationIdRaw : null
  const codigoDescuento = typeof codigoDescuentoRaw === 'string' ? codigoDescuentoRaw.trim().toUpperCase() : null
  // Addons opcionales: array de { id | addon_id, cantidad }
  // Acepta ambos nombres de campo para compatibilidad con el frontend (manda `id`).
  // Cualquier `precio` que venga del body se IGNORA — se re-fetchea de DB con FOR UPDATE.
  const addonsInput = Array.isArray(addonsRaw)
    ? (addonsRaw as Array<{ id?: unknown; addon_id?: unknown; cantidad?: unknown }>)
        .map((a) => {
          const id = typeof a.addon_id === 'string' && a.addon_id ? a.addon_id : (typeof a.id === 'string' ? a.id : '')
          return { addon_id: id, cantidad: Math.max(0, Math.floor(Number(a.cantidad) || 0)) }
        })
        .filter((a) => a.addon_id && a.cantidad > 0)
    : []
  const utmSource = typeof utm_source === 'string' ? utm_source.trim().slice(0, 100) || null : null
  const utmMedium = typeof utm_medium === 'string' ? utm_medium.trim().slice(0, 100) || null : null
  const utmCampaign = typeof utm_campaign === 'string' ? utm_campaign.trim().slice(0, 100) || null : null

  const empresaTenantCheckout = await findPublicTenant(slug)
  if (!empresaTenantCheckout) return res.status(404).json({ error: 'Empresa no encontrada' })

  const empresaId = empresaTenantCheckout.id
  const empresaNombre = empresaTenantCheckout.nombre

  const MAX_CHECKOUT_ITEMS = 20
  const rawCheckoutItems = Array.isArray(items) ? (items as CheckoutItem[]) : []
  if (!Array.isArray(items) || rawCheckoutItems.length === 0) return res.status(400).json({ error: 'items requeridos' })
  if (rawCheckoutItems.length > MAX_CHECKOUT_ITEMS) return res.status(400).json({ error: `Máximo ${MAX_CHECKOUT_ITEMS} items por checkout` })
  if (rawCheckoutItems.length > 0) {
    const categoriaIds = Array.from(new Set(rawCheckoutItems.map((item) => item.categoriaId).filter(Boolean)))
    if (categoriaIds.length > 0) {
      // Fetch event publication state for each category (no FOR UPDATE needed — informational pre-check before tx)
      const publicationRows = await prisma.$queryRaw<{ categoria_id: string; evento_id: string; evento_nombre: string; activo: boolean; publication_mode: string; pre_publish_visibility: string; publish_at_utc: Date | null; publish_timezone: string | null; published_live_at: Date | null }[]>`
        SELECT ec.id AS categoria_id, ev.id AS evento_id, ev.nombre AS evento_nombre,
               ev.activo, ev.publication_mode, ev.pre_publish_visibility, ev.publish_at_utc, ev.publish_timezone, ev.published_live_at
        FROM entrada_categorias ec
        JOIN eventos ev ON ev.id = ec.evento_id
        WHERE ec.id = ANY(${categoriaIds}::text[]) AND ev.empresa_id = ${empresaId}
      `

      const publicationByCategoria = new Map<string, typeof publicationRows[0]>()
      for (const row of publicationRows) {
        publicationByCategoria.set(String(row.categoria_id), row)
      }

      for (const item of rawCheckoutItems) {
        const row = publicationByCategoria.get(String(item.categoriaId))
        if (!row || !buildEventPublicationSnapshot(row as unknown as EventPublicationSource).is_checkout_open) {
          return res.status(409).json(buildPublicationCheckoutError(row?.evento_nombre ? String(row.evento_nombre) : 'este evento'))
        }
      }
    }
  }

  try {
    await assertCanSell(empresaId)
  } catch (error) {
    if (error instanceof SalesReadinessError) {
      return res.status(error.statusCode).json(buildSalesNotReadyResponse(error))
    }

      logServerError('tenant checkout readiness validation')
    return res.status(500).json({ error: 'No se pudo validar la disponibilidad de cobro' })
  }

  const mpClient = await getMercadoPagoClientByEmpresaId(empresaId)
  if (!mpClient) {
    return res.status(409).json({
      code: 'sales_not_ready',
      status: 'missing_provider',
      reason: 'missing_provider',
      error: 'La empresa no está lista para vender',
    })
  }

  const compradorForTicketCheckout = await prisma.comprador.findFirst({
    where: { email: String(req.user.email).trim().toLowerCase(), empresa_id: empresaId },
    select: { id: true },
  })
  if (!compradorForTicketCheckout) return res.status(404).json({ error: 'Comprador no encontrado' })
  // Wrap in array-like shape to avoid touching the transaction code that uses compradorRows[0].id
  const compradorRows = [compradorForTicketCheckout]

  const sessionId = uuidv4()
  const expiresAt = new Date(Date.now() + CHECKOUT_RESERVA_MINUTOS * 60 * 1000)

  let canonicalItems: CheckoutItem[] = []
  let sessionData: CheckoutSessionData | null = null

  // Validate items before entering the transaction (cheap, no DB)
  for (const item of rawCheckoutItems) {
    if (!item.categoriaId || !Number.isInteger(Number(item.cantidad)) || Number(item.cantidad) <= 0) {
      return res.status(400).json({ error: 'Cada item debe tener una categoría válida y cantidad entera mayor a 0' })
    }
    if (Number(item.cantidad) > 20) {
      return res.status(400).json({ error: 'La cantidad máxima por categoría es 20' })
    }
  }

  type EntradaCategoriaLockRow = {
    id: string; stock_disponible: number; nombre: string; precio: string | number
    evento_id: string; evento_nombre: string; modo_fecha: string
    evento_activo: boolean; publication_mode: string; pre_publish_visibility: string
    publish_at_utc: Date | null; publish_timezone: string | null; published_live_at: Date | null
  }

  try {
    await withSerializableRetry(() =>
      prismaDirectUrl.$transaction(async (tx) => {
        // FOR UPDATE on checkout_sessions to prevent concurrent over-reservation.
        const activeSessionRows = await tx.$queryRaw<[{ total: bigint }]>`
          SELECT COUNT(*) as total FROM (
            SELECT 1
            FROM checkout_sessions
            WHERE comprador_id = ${String(compradorRows[0].id)} AND empresa_id = ${empresaId}
              AND estado = 'reservada' AND expires_at IS NOT NULL AND expires_at > NOW()
            FOR UPDATE
          ) AS locked
        `

        const activeReservedSessions = Number(activeSessionRows[0]?.total ?? 0)
        if (activeReservedSessions >= MAX_ACTIVE_CHECKOUT_SESSIONS_PER_BUYER) {
          throw Object.assign(new Error('too_many_sessions'), {
            _httpStatus: 429,
            _httpBody: { error: 'Ya tenés demasiadas reservas activas. Terminá o esperá que venza alguna antes de seguir.' },
          })
        }

        const requestedEntries = (items as CheckoutItem[]).reduce((acc, item) => acc + Number(item.cantidad ?? 0), 0)
        const activeReservedEntries = await getActiveReservedEntryCountForBuyer(tx, String(compradorRows[0].id), empresaId)

        if (activeReservedEntries + requestedEntries > MAX_RESERVED_ENTRIES_PER_BUYER) {
          throw Object.assign(new Error('too_many_entries'), {
            _httpStatus: 429,
            _httpBody: { error: 'Superaste el máximo de entradas reservadas simultáneamente para este usuario.' },
          })
        }

        const stockNecesario = buildStockNecesario(items as CheckoutItem[])
        const categoriaIds = Array.from(stockNecesario.keys())

        // FOR UPDATE on entrada_categorias — stock reservation lock.
        const catRows = await tx.$queryRaw<EntradaCategoriaLockRow[]>`
          SELECT ec.id, ec.stock_disponible, ec.nombre, ec.precio,
                 ev.id as evento_id, ev.nombre as evento_nombre, ev.modo_fecha,
                 ev.activo AS evento_activo, ev.publication_mode, ev.pre_publish_visibility,
                 ev.publish_at_utc, ev.publish_timezone, ev.published_live_at
          FROM entrada_categorias ec
          JOIN eventos ev ON ev.id = ec.evento_id
          LEFT JOIN evento_tandas et ON et.id = ec.tanda_id
          WHERE ec.id = ANY(${categoriaIds}::text[]) AND ev.empresa_id = ${empresaId} AND ec.activa = true
            AND (ec.tanda_id IS NULL OR (et.evento_id = ev.id AND et.estado = 'activa'))
          ORDER BY ec.id
          FOR UPDATE OF ec
        `

        const catMap = new Map<string, EntradaCategoriaLockRow>()
        for (const row of catRows) {
          catMap.set(String(row.id), row)
        }

        canonicalItems = (items as CheckoutItem[]).map((item) => {
          const categoria = catMap.get(item.categoriaId)

          if (!categoria) throw new Error(`Categoría inválida para checkout: ${item.categoriaId}`)

          if (String(categoria.evento_id) !== String(item.eventoId)) {
            throw new Error(`La categoría "${categoria.nombre}" no pertenece al evento enviado`)
          }

          if (!buildEventPublicationSnapshot({
            activo: categoria.evento_activo,
            publication_mode: categoria.publication_mode,
            pre_publish_visibility: categoria.pre_publish_visibility,
            publish_at_utc: categoria.publish_at_utc,
            publish_timezone: categoria.publish_timezone,
            published_live_at: categoria.published_live_at,
          }).is_checkout_open) {
            throw new Error(`event_not_live:${String(categoria.evento_nombre)}`)
          }

          return {
            ...item,
            eventoId: String(categoria.evento_id),
            eventoNombre: String(categoria.evento_nombre),
            categoriaNombre: String(categoria.nombre),
            precio: Number(categoria.precio),
          }
        })

        // Seated events: validate submitted asiento_ids belong to this buyer's reservation.
        // Defense in depth against cross-tenant seat hijack: even though POST /api/asientos/reservar
        // now scopes its lock query to evento_id, we don't trust that alone here — cross-check
        // each asiento's evento_id/empresa_id against the item it's being bought for.
        if (seatReservationId) {
          const seatedItems = canonicalItems.filter(
            (it): it is typeof it & { asiento_id: string } => typeof it.asiento_id === 'string' && it.asiento_id.length > 0
          )
          if (seatedItems.length > 0) {
            const submittedAsientoIds = seatedItems.map((it) => it.asiento_id)
            const validSeats = await tx.$queryRaw<{ id: string; evento_id: string; empresa_id: string }[]>`
              SELECT id, evento_id, empresa_id FROM asientos
              WHERE checkout_session_id = ${seatReservationId}
                AND estado = 'reservado'
                AND id = ANY(${submittedAsientoIds}::text[])
            `
            const validSeatMap = new Map(validSeats.map((s) => [s.id, s]))
            const todosValidos = seatedItems.every((it) => {
              const seat = validSeatMap.get(it.asiento_id)
              return !!seat && seat.evento_id === it.eventoId && seat.empresa_id === empresaId
            })
            if (validSeats.length !== submittedAsientoIds.length || !todosValidos) {
              throw Object.assign(new Error('asientos_invalidos'), {
                _httpStatus: 409,
                _httpBody: { error: 'Uno o más asientos no pertenecen a tu reserva. Volvé a elegir asientos.' },
              })
            }
          }
        }

        for (const [categoriaId, cantidadNecesaria] of stockNecesario.entries()) {
          const categoria = catMap.get(categoriaId)
          if (!categoria || Number(categoria.stock_disponible) < cantidadNecesaria) {
            throw Object.assign(new Error('sin_stock'), {
              _httpStatus: 409,
              _httpBody: {
                error: categoria
                  ? `Solo quedan ${Number(categoria.stock_disponible)} disponible${Number(categoria.stock_disponible) === 1 ? '' : 's'} de "${categoria.nombre}"`
                  : 'La categoría seleccionada ya no está disponible',
              },
            })
          }

          if (String(categoria.modo_fecha) === 'multiple') {
            const itemsCategoria = canonicalItems.filter((item) => item.categoriaId === categoriaId)
            if (itemsCategoria.some((item) => !item.fechaId)) {
              throw Object.assign(new Error('falta_fecha'), {
                _httpStatus: 400,
                _httpBody: { error: `Debés seleccionar una fecha para "${categoria.nombre}"` },
              })
            }

            const fechaIds = itemsCategoria.map((item) => item.fechaId).filter((value): value is string => !!value)
            if (fechaIds.length > 0) {
              const fechaRows = await tx.$queryRaw<{ id: string }[]>`
                SELECT id FROM evento_fechas
                WHERE evento_id = ${String(categoria.evento_id)} AND id = ANY(${fechaIds}::text[])
              `
              if (fechaRows.length !== fechaIds.length) {
                throw Object.assign(new Error('fecha_invalida'), {
                  _httpStatus: 400,
                  _httpBody: { error: `La fecha elegida para "${categoria.nombre}" no es válida` },
                })
              }
            }
          }
        }

        // Addons: validar stock + snapshot precio/nombre. Stock lock FOR UPDATE igual que categorías.
        type AddonResolved = { id: string; nombre: string; precio: number; cantidad: number; eventoId: string }
        const addonsResolved: AddonResolved[] = []
        if (addonsInput.length > 0) {
          const addonIds = [...new Set(addonsInput.map((a) => a.addon_id))]
          const addonRows = await tx.$queryRaw<Array<{ id: string; evento_id: string; nombre: string; precio: number; stock_disponible: number; max_por_compra: number; activo: boolean }>>`
            SELECT id, evento_id, nombre, precio::float AS precio, stock_disponible, max_por_compra, activo
            FROM evento_addons WHERE id = ANY(${addonIds}::text[]) AND empresa_id = ${empresaId}
            ORDER BY id
            FOR UPDATE
          `
          const addonsByEvento = new Set(canonicalItems.map((i) => i.eventoId))
          const addonRowMap = new Map(addonRows.map((r) => [r.id, r]))
          for (const input of addonsInput) {
            const row = addonRowMap.get(input.addon_id)
            if (!row) {
              throw Object.assign(new Error('addon_no_existe'), {
                _httpStatus: 400, _httpBody: { error: 'Uno de los adicionales seleccionados ya no está disponible' },
              })
            }
            if (!row.activo || row.stock_disponible <= 0) {
              throw Object.assign(new Error('addon_inactivo'), {
                _httpStatus: 409, _httpBody: { error: `El adicional "${row.nombre}" no está disponible` },
              })
            }
            if (!addonsByEvento.has(row.evento_id)) {
              throw Object.assign(new Error('addon_otro_evento'), {
                _httpStatus: 400, _httpBody: { error: `El adicional "${row.nombre}" no pertenece a este evento` },
              })
            }
            if (input.cantidad > row.max_por_compra) {
              throw Object.assign(new Error('addon_max_compra'), {
                _httpStatus: 400, _httpBody: { error: `Máximo ${row.max_por_compra} unidades de "${row.nombre}" por compra` },
              })
            }
            if (input.cantidad > row.stock_disponible) {
              throw Object.assign(new Error('addon_sin_stock'), {
                _httpStatus: 409, _httpBody: { error: `Solo quedan ${row.stock_disponible} de "${row.nombre}"` },
              })
            }
            addonsResolved.push({ id: row.id, nombre: row.nombre, precio: Number(row.precio), cantidad: input.cantidad, eventoId: row.evento_id })
          }
        }

        const subtotalItemsBase = canonicalItems.reduce((acc, item) => acc + Number(item.precio) * Number(item.cantidad), 0)
        const subtotalAddonsBase = addonsResolved.reduce((acc, a) => acc + a.precio * a.cantidad, 0)
        const subtotalBase = subtotalItemsBase + subtotalAddonsBase

        // Descuento: validamos el código con FOR UPDATE (lockea la fila para que dos reservas
        // concurrentes no pasen ambas el chequeo de usos_maximos) y lo aplicamos como REDUCCIÓN
        // PROPORCIONAL de cada precio (items + addons) — la misma técnica que passed_to_buyer pero
        // al revés. Así el descuento fluye consistente por toda la cadena: lo que cobra MP, el
        // precio_pagado de cada entrada, la comisión y el neto del productor.
        let descuentoMonto: number | null = null
        if (codigoDescuento) {
          type CodRow = { id: number; tipo: string; valor: string; aplica_a: string; usos_maximos: number | null; usos_actuales: number; monto_minimo: string | null; valido_desde: Date | null; valido_hasta: Date | null; activo: boolean }
          const [cod] = await tx.$queryRaw<CodRow[]>`
            SELECT id, tipo, valor, aplica_a, usos_maximos, usos_actuales, monto_minimo, valido_desde, valido_hasta, activo
            FROM marketing_codigos_descuento
            WHERE empresa_id = ${empresaId} AND UPPER(codigo) = ${codigoDescuento}
            LIMIT 1
            FOR UPDATE
          `
          const ahora = new Date()
          if (
            cod &&
            cod.activo &&
            (!cod.valido_desde || new Date(cod.valido_desde) <= ahora) &&
            (!cod.valido_hasta || new Date(cod.valido_hasta) >= ahora) &&
            (cod.usos_maximos == null || Number(cod.usos_actuales) < Number(cod.usos_maximos)) &&
            (cod.monto_minimo == null || subtotalBase >= Number(cod.monto_minimo)) &&
            (String(cod.aplica_a) === 'todos' || String(cod.aplica_a) === 'entradas')
          ) {
            if (String(cod.tipo) === 'porcentaje') {
              descuentoMonto = roundMoney((subtotalBase * Number(cod.valor)) / 100)
            } else {
              descuentoMonto = roundMoney(Math.min(Number(cod.valor), subtotalBase))
            }
          } else if (cod !== undefined) {
            // Code was found but is invalid (expired, exhausted, wrong aplica_a, below minimum).
            throw new Error('discount_invalid')
          } else {
            // Code not found at all.
            throw new Error('discount_invalid')
          }
        }

        // Deflactar precios por el descuento. El subtotal NETO (post-descuento) es la base
        // sobre la que la plataforma cobra su comisión (decisión de negocio: fee sobre neto).
        if (descuentoMonto && descuentoMonto > 0 && subtotalBase > 0) {
          const ratioDesc = (subtotalBase - descuentoMonto) / subtotalBase
          for (const item of canonicalItems) {
            item.precio = roundMoney(Number(item.precio) * ratioDesc)
          }
          for (const a of addonsResolved) {
            a.precio = roundMoney(a.precio * ratioDesc)
          }
        }

        const subtotalNeto = roundMoney(subtotalBase - (descuentoMonto ?? 0))
        const marketplaceFee = await resolveMarketplaceFee(empresaId, subtotalNeto, 'entradas')
        // Fee billing mode: INFLAR cada item.precio + addon.precio por la fracción del comprador p
        // sobre el subtotal YA descontado. p = 0 (absorbed, sin inflación), 1 (passed_to_buyer, fee
        // completo) o fee_split_buyer_pct/100 (split, fracción). El marketplace_fee absoluto NO cambia
        // (la plataforma cobra el fee completo vía MP application_fee).
        const feeBillingMode = normalizeFeeBillingMode(empresaTenantCheckout.fee_billing_mode)
        const buyerFeeFraction = resolveBuyerFeeFraction(feeBillingMode, Number(empresaTenantCheckout.fee_split_buyer_pct))
        if (buyerFeeFraction > 0 && subtotalNeto > 0 && marketplaceFee.amount > 0) {
          const ratio = 1 + (marketplaceFee.amount * buyerFeeFraction / subtotalNeto)
          for (const item of canonicalItems) {
            item.precio = Math.round((Number(item.precio) * ratio + Number.EPSILON) * 100) / 100
          }
          for (const a of addonsResolved) {
            a.precio = Math.round((a.precio * ratio + Number.EPSILON) * 100) / 100
          }
        }
        sessionData = {
          flow: 'entradas',
          items: canonicalItems,
          addons: addonsResolved,
          marketplaceFee: {
            amount: marketplaceFee.amount,
            currency: marketplaceFee.currency,
            metadata: marketplaceFee.metadata,
          },
          feeBillingMode,
          feeBuyerFraction: buyerFeeFraction,
          confirmationToken: generateCheckoutConfirmationToken(),
          seat_reservation_id: seatReservationId,
        }

        for (const [categoriaId, cantidadNecesaria] of stockNecesario.entries()) {
          await tx.$executeRaw`
            UPDATE entrada_categorias SET stock_disponible = stock_disponible - ${cantidadNecesaria} WHERE id = ${categoriaId}
          `
          logEvent('stock_decremented', { categoria_id: categoriaId, quantity: cantidadNecesaria, source: 'checkout_reservation', empresa_id: empresaId })
        }

        // Reservar stock de addons
        for (const a of addonsResolved) {
          await tx.$executeRaw`UPDATE evento_addons SET stock_disponible = stock_disponible - ${a.cantidad} WHERE id = ${a.id}`
          logEvent('addon_stock_decremented', { addon_id: a.id, quantity: a.cantidad, source: 'checkout_reservation', empresa_id: empresaId })
        }

        // El descuento ya fue validado (FOR UPDATE) y aplicado a los precios más arriba,
        // antes de resolver la comisión. Acá abajo solo se persiste descuento_monto en la sesión.

        // Capturar revendedor_id exclusivamente del parámetro ?ref= de la URL
        let revendedorIdParaSession: string | null = null
        const refParam = typeof req.query.ref === 'string' ? req.query.ref.trim() : ''
        if (refParam) {
          const revRows = await tx.$queryRaw<{ id: string }[]>`
            SELECT id FROM usuarios WHERE id = ${refParam} AND empresa_id = ${empresaId}
              AND rol = 'revendedor' AND activo = true LIMIT 1
          `
          if (revRows[0]) revendedorIdParaSession = refParam
        }

        await tx.checkoutSession.create({
          data: {
            id: sessionId,
            comprador_id: String(compradorRows[0].id),
            empresa_id: empresaId,
            datos: JSON.stringify(sessionData),
            estado: 'reservada',
            expires_at: expiresAt,
            codigo_descuento: descuentoMonto ? (codigoDescuento ?? null) : null,
            descuento_monto: descuentoMonto,
            utm_source: utmSource,
            utm_medium: utmMedium,
            utm_campaign: utmCampaign,
            revendedor_id: revendedorIdParaSession,
          },
        })
      }, {
        isolationLevel: 'Serializable',
        maxWait: 5000,
        timeout: 15000,
      })
    )
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'event_not_live:' || error.message.startsWith('event_not_live:')) {
        return res.status(409).json(buildPublicationCheckoutError(error.message.slice('event_not_live:'.length)))
      }
      if (error.message === 'discount_invalid') {
        return res.status(409).json({ error: 'El código de descuento no es válido, expiró o ya fue utilizado.' })
      }
      const httpBody = (error as { _httpBody?: { error: string } } | null)?._httpBody
      const httpStatus = (error as { _httpStatus?: number } | null)?._httpStatus
      if (httpBody && httpStatus) return res.status(httpStatus).json(httpBody)
    }
    logServerError('tenant checkout reservation')
    return res.status(500).json({ error: 'No se pudo iniciar el checkout' })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!
  const sessionDataTyped2 = sessionData as TicketCheckoutSessionData | null

  if (!sessionDataTyped2?.marketplaceFee) {
    await cancelarReserva(sessionId, empresaId)
    return res.status(500).json({ error: 'No se pudo preparar la comisión del checkout' })
  }

  const totalBuyer = canonicalItems.reduce((acc, item) => acc + Number(item.precio) * item.cantidad, 0)
  if (totalBuyer <= 0) {
    await cancelarReserva(sessionId, empresaId)
    return res.status(400).json({ error: 'Las entradas gratuitas no pueden procesarse vía Mercado Pago. Contactá al organizador.' })
  }

  const mpItems = canonicalItems.map((item) => ({
    id: item.categoriaId,
    title: `${item.eventoNombre} — ${item.categoriaNombre}`,
    quantity: item.cantidad,
    unit_price: Number(item.precio),
    currency_id: 'ARS',
  }))

  const platformSponsorId = sessionDataTyped2.marketplaceFee.amount > 0
    ? await getPlatformOwnerCollectorId()
    : null

  // Max cuotas configurado por la empresa. Default 1 = solo contado.
  const maxInstallmentsEntradas = Math.max(1, Math.min(24, empresaTenantCheckout.mp_max_installments ?? 1))

  const preference = new Preference(mpClient)
  try {
    const response = await preference.create({
      body: {
        items: mpItems,
        payer: { email: req.user.email! },
        back_urls: {
          success: `${baseUrl}/api/tenant/${slug}/pago/confirmar-redirect?session=${sessionId}&ct=${encodeURIComponent(sessionDataTyped2.confirmationToken ?? '')}`,
          failure: `${baseUrl}/api/tenant/${slug}/pago/confirmar-redirect?session=${sessionId}&ct=${encodeURIComponent(sessionDataTyped2.confirmationToken ?? '')}&status=failure`,
          pending: `${baseUrl}/api/tenant/${slug}/pago/confirmar-redirect?session=${sessionId}&ct=${encodeURIComponent(sessionDataTyped2.confirmationToken ?? '')}&status=pending`,
        },
        notification_url: `${baseUrl}/api/tenant/${slug}/pago/webhook`,
        auto_return: 'approved',
        external_reference: sessionId,
        marketplace_fee: sessionDataTyped2.marketplaceFee.amount,
        ...(platformSponsorId ? { sponsor_id: Number(platformSponsorId) } : {}),
        payment_methods: { installments: maxInstallmentsEntradas },
        metadata: {
          session_id: sessionId,
          empresa_id: empresaId,
          marketplace_fee: {
            amount: sessionDataTyped2.marketplaceFee.amount,
            ...sessionDataTyped2.marketplaceFee.metadata,
          },
        },
        statement_descriptor: empresaNombre,
      },
    })

    return res.json({ init_point: response.init_point, expires_at: expiresAt.toISOString() })
  } catch (error) {
    await cancelarReserva(sessionId, empresaId)
    logServerError('tenant mercadopago preference')
    return res.status(500).json({ error: 'No se pudo crear la preferencia de pago' })
  }
})

// POST /tenant/:slug/checkout-mixto
// Fase 3 — carrito combinado: entradas + addons + consumibles en UNA sola reserva
// con UNA sola preferencia de Mercado Pago (en vez de los dos checkouts separados
// de arriba). Endpoint ADITIVO: no hay ningún link/botón/feature-flag en el
// frontend que lo llame — vive inerte hasta que se decida wirearlo. NO reemplaza
// ni modifica /:slug/checkout ni /:slug/consumibles/checkout, que siguen intactos.
//
// Fuera de scope v1 — rechazados explícitamente, no soportados a medias:
//   - Asientos numerados (asiento_id / checkout_session_id de reserva de asiento)
//   - Códigos de descuento (codigo_descuento)
router.post('/:slug/checkout-mixto', verifyInternal, async (req: Request, res: Response) => {
  const { slug } = req.params

  if (rejectTenantActorMismatch(req, res, slug)) return

  if (!req.user || req.user.userType !== 'comprador' || !req.user.id || req.user.empresa_slug !== slug) {
    return res.status(401).json({ error: 'No autorizado' })
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  const { items, addons: addonsRaw, consumibles } = body

  // Rechazo explícito (no soporte a medias) de lo fuera de scope v1. Se rechaza
  // cualquier valor truthy sin importar el tipo — no solo strings no vacíos — para
  // no dejar pasar silenciosamente un valor mal tipado enviado por un cliente.
  const codigoDescuentoRawMixto = body.codigo_descuento
  if (typeof codigoDescuentoRawMixto === 'string' ? codigoDescuentoRawMixto.trim() : Boolean(codigoDescuentoRawMixto)) {
    return res.status(400).json({ error: 'Códigos de descuento no soportados en checkout mixto v1' })
  }
  const seatReservationIdRawMixto = body.checkout_session_id
  if (typeof seatReservationIdRawMixto === 'string' ? seatReservationIdRawMixto.trim() : Boolean(seatReservationIdRawMixto)) {
    return res.status(400).json({ error: 'Asientos numerados no soportados en checkout mixto v1' })
  }

  const rawCheckoutItems = Array.isArray(items) ? (items as CheckoutItem[]) : []
  if (rawCheckoutItems.some((item) => item?.asiento_id)) {
    return res.status(400).json({ error: 'Asientos numerados no soportados en checkout mixto v1' })
  }

  const addonsInput = Array.isArray(addonsRaw)
    ? (addonsRaw as Array<{ id?: unknown; addon_id?: unknown; cantidad?: unknown }>)
        .map((a) => {
          const id = typeof a.addon_id === 'string' && a.addon_id ? a.addon_id : (typeof a.id === 'string' ? a.id : '')
          return { addon_id: id, cantidad: Math.max(0, Math.floor(Number(a.cantidad) || 0)) }
        })
        .filter((a) => a.addon_id && a.cantidad > 0)
    : []

  const rawConsumibleItems = Array.isArray(consumibles) ? (consumibles as ConsumibleCheckoutItem[]) : []

  const MAX_CHECKOUT_ITEMS = 20
  if (!rawCheckoutItems.length && !rawConsumibleItems.length) {
    return res.status(400).json({ error: 'El carrito mixto necesita al menos un item de entradas o de consumibles' })
  }
  if (rawCheckoutItems.length > MAX_CHECKOUT_ITEMS) {
    return res.status(400).json({ error: `Máximo ${MAX_CHECKOUT_ITEMS} items de entradas por checkout` })
  }
  if (rawConsumibleItems.length > MAX_CHECKOUT_ITEMS) {
    return res.status(400).json({ error: `Máximo ${MAX_CHECKOUT_ITEMS} items de consumibles por checkout` })
  }

  // Validación barata (sin DB) antes de entrar a la transacción — mismo patrón que /:slug/checkout.
  for (const item of rawCheckoutItems) {
    if (!item.categoriaId || !Number.isInteger(Number(item.cantidad)) || Number(item.cantidad) <= 0) {
      return res.status(400).json({ error: 'Cada item de entradas debe tener una categoría válida y cantidad entera mayor a 0' })
    }
    if (Number(item.cantidad) > 20) {
      return res.status(400).json({ error: 'La cantidad máxima por categoría es 20' })
    }
  }
  for (const item of rawConsumibleItems) {
    if (!item.barraId || !item.consumibleId || !item.eventoId || !Number.isInteger(Number(item.cantidad)) || Number(item.cantidad) <= 0) {
      return res.status(400).json({ error: 'Cada item de consumibles debe tener barra, consumible y cantidad válida' })
    }
  }

  const empresaTenantMixto = await findPublicTenant(slug)
  if (!empresaTenantMixto) return res.status(404).json({ error: 'Empresa no encontrada' })
  const empresaId = empresaTenantMixto.id
  const empresaNombre = empresaTenantMixto.nombre

  // Publicación: categorías de entradas (informacional, pre-tx — mismo patrón que /:slug/checkout).
  if (rawCheckoutItems.length > 0) {
    const categoriaIds = Array.from(new Set(rawCheckoutItems.map((item) => item.categoriaId).filter(Boolean)))
    if (categoriaIds.length > 0) {
      const publicationRows = await prisma.$queryRaw<{ categoria_id: string; evento_id: string; evento_nombre: string; activo: boolean; publication_mode: string; pre_publish_visibility: string; publish_at_utc: Date | null; publish_timezone: string | null; published_live_at: Date | null }[]>`
        SELECT ec.id AS categoria_id, ev.id AS evento_id, ev.nombre AS evento_nombre,
               ev.activo, ev.publication_mode, ev.pre_publish_visibility, ev.publish_at_utc, ev.publish_timezone, ev.published_live_at
        FROM entrada_categorias ec
        JOIN eventos ev ON ev.id = ec.evento_id
        WHERE ec.id = ANY(${categoriaIds}::text[]) AND ev.empresa_id = ${empresaId}
      `
      const publicationByCategoria = new Map<string, typeof publicationRows[0]>()
      for (const row of publicationRows) publicationByCategoria.set(String(row.categoria_id), row)

      for (const item of rawCheckoutItems) {
        const row = publicationByCategoria.get(String(item.categoriaId))
        if (!row || !buildEventPublicationSnapshot(row as unknown as EventPublicationSource).is_checkout_open) {
          return res.status(409).json(buildPublicationCheckoutError(row?.evento_nombre ? String(row.evento_nombre) : 'este evento'))
        }
      }
    }
  }

  // Publicación: consumibles deben pertenecer todos al mismo evento (mismo patrón que /:slug/consumibles/checkout).
  if (rawConsumibleItems.length > 0) {
    const sameEvent = new Set(rawConsumibleItems.map((item) => item.eventoId))
    if (sameEvent.size !== 1) {
      return res.status(400).json({ error: 'Todos los consumibles del checkout deben pertenecer al mismo evento' })
    }
    const requestedEventoId = rawConsumibleItems[0]?.eventoId
    if (requestedEventoId) {
      const eventoForPublication = await prisma.evento.findFirst({
        where: { id: requestedEventoId, empresa_id: empresaId },
        select: { id: true, nombre: true, activo: true, publication_mode: true, pre_publish_visibility: true, publish_at_utc: true, publish_timezone: true, published_live_at: true },
      })
      if (!eventoForPublication || !buildEventPublicationSnapshot(eventoForPublication as unknown as EventPublicationSource).is_checkout_open) {
        return res.status(409).json(buildPublicationCheckoutError(eventoForPublication?.nombre ? String(eventoForPublication.nombre) : 'este evento'))
      }
    }
  }

  try {
    await assertCanSell(empresaId)
  } catch (error) {
    if (error instanceof SalesReadinessError) {
      return res.status(error.statusCode).json(buildSalesNotReadyResponse(error))
    }
    logServerError('tenant checkout mixto readiness validation')
    return res.status(500).json({ error: 'No se pudo validar la disponibilidad de cobro' })
  }

  const mpClient = await getMercadoPagoClientByEmpresaId(empresaId)
  if (!mpClient) {
    return res.status(409).json({
      code: 'sales_not_ready',
      status: 'missing_provider',
      reason: 'missing_provider',
      error: 'La empresa no está lista para vender',
    })
  }

  const compradorMixto = await prisma.comprador.findFirst({
    where: { email: String(req.user.email).trim().toLowerCase(), empresa_id: empresaId },
    select: { id: true },
  })
  if (!compradorMixto) return res.status(404).json({ error: 'Comprador no encontrado' })
  const compradorRows = [compradorMixto]

  const sessionId = uuidv4()
  const expiresAt = new Date(Date.now() + CHECKOUT_RESERVA_MINUTOS * 60 * 1000)

  let canonicalItemsEntradas: CheckoutItem[] = []
  let canonicalItemsConsumibles: ConsumibleCheckoutItem[] = []
  let addonsResolvedMixto: TicketCheckoutAddon[] = []
  let sessionData: CheckoutSessionData | null = null

  type EntradaCategoriaLockRow = {
    id: string; stock_disponible: number; nombre: string; precio: string | number
    evento_id: string; evento_nombre: string; modo_fecha: string
    evento_activo: boolean; publication_mode: string; pre_publish_visibility: string
    publish_at_utc: Date | null; publish_timezone: string | null; published_live_at: Date | null
  }
  type BarraStockLockRow = {
    id: string; barra_id: string; consumible_id: string; stock_actual: number; precio_override: string | null; activo: boolean
    stock_ilimitado: boolean; agotado: boolean
    barra_nombre: string; evento_id: string; barra_activa: boolean
    nombre: string; precio_base: string | number; consumible_activo: boolean
    evento_nombre: string; venta_consumibles_habilitada: boolean
    evento_activo: boolean; publication_mode: string; pre_publish_visibility: string
    publish_at_utc: Date | null; publish_timezone: string | null; published_live_at: Date | null
  }

  try {
    await withSerializableRetry(() =>
      prismaDirectUrl.$transaction(async (tx) => {
        // --- Límites anti-abuso (mismos contadores que los dos checkouts existentes;
        // ahora son mixto-aware, ver countReservedEntryUnits/countReservedConsumibleUnits). ---
        const activeSessionRows = await tx.$queryRaw<[{ total: bigint }]>`
          SELECT COUNT(*) as total FROM (
            SELECT 1 FROM checkout_sessions
            WHERE comprador_id = ${String(compradorRows[0].id)} AND empresa_id = ${empresaId}
              AND estado = 'reservada' AND expires_at IS NOT NULL AND expires_at > NOW()
            FOR UPDATE
          ) AS locked
        `
        const activeReservedSessions = Number(activeSessionRows[0]?.total ?? 0)
        if (activeReservedSessions >= MAX_ACTIVE_CHECKOUT_SESSIONS_PER_BUYER) {
          throw Object.assign(new Error('too_many_sessions'), {
            _httpStatus: 429,
            _httpBody: { error: 'Ya tenés demasiadas reservas activas. Terminá o esperá que venza alguna antes de seguir.' },
          })
        }

        const requestedEntries = rawCheckoutItems.reduce((acc, item) => acc + Number(item.cantidad ?? 0), 0)
        if (requestedEntries > 0) {
          const activeReservedEntries = await getActiveReservedEntryCountForBuyer(tx, String(compradorRows[0].id), empresaId)
          if (activeReservedEntries + requestedEntries > MAX_RESERVED_ENTRIES_PER_BUYER) {
            throw Object.assign(new Error('too_many_entries'), {
              _httpStatus: 429,
              _httpBody: { error: 'Superaste el máximo de entradas reservadas simultáneamente para este usuario.' },
            })
          }
        }

        const requestedConsumibleUnits = rawConsumibleItems.reduce((acc, item) => acc + Number(item.cantidad ?? 0), 0)
        if (requestedConsumibleUnits > 0) {
          const activeReservedConsumibles = await getActiveReservedConsumiblesCountForBuyer(tx, String(compradorRows[0].id), empresaId)
          if (activeReservedConsumibles + requestedConsumibleUnits > MAX_RESERVED_CONSUMIBLES_PER_BUYER) {
            throw Object.assign(new Error('too_many_units'), {
              _httpStatus: 429,
              _httpBody: { error: 'Superaste el máximo de consumibles reservados simultáneamente para este usuario.' },
            })
          }
        }

        // --- Lock 1/3: entrada_categorias (mismo orden que /:slug/checkout) ---
        const stockNecesarioEntradas = buildStockNecesario(rawCheckoutItems)
        const categoriaIdsEntradas = Array.from(stockNecesarioEntradas.keys())

        const catRows = categoriaIdsEntradas.length > 0
          ? await tx.$queryRaw<EntradaCategoriaLockRow[]>`
              SELECT ec.id, ec.stock_disponible, ec.nombre, ec.precio,
                     ev.id as evento_id, ev.nombre as evento_nombre, ev.modo_fecha,
                     ev.activo AS evento_activo, ev.publication_mode, ev.pre_publish_visibility,
                     ev.publish_at_utc, ev.publish_timezone, ev.published_live_at
              FROM entrada_categorias ec
              JOIN eventos ev ON ev.id = ec.evento_id
              LEFT JOIN evento_tandas et ON et.id = ec.tanda_id
              WHERE ec.id = ANY(${categoriaIdsEntradas}::text[]) AND ev.empresa_id = ${empresaId} AND ec.activa = true
                AND (ec.tanda_id IS NULL OR (et.evento_id = ev.id AND et.estado = 'activa'))
              ORDER BY ec.id
              FOR UPDATE OF ec
            `
          : []

        const catMap = new Map<string, EntradaCategoriaLockRow>()
        for (const row of catRows) catMap.set(String(row.id), row)

        canonicalItemsEntradas = rawCheckoutItems.map((item) => {
          const categoria = catMap.get(item.categoriaId)
          if (!categoria) throw new Error(`Categoría inválida para checkout: ${item.categoriaId}`)
          if (String(categoria.evento_id) !== String(item.eventoId)) {
            throw new Error(`La categoría "${categoria.nombre}" no pertenece al evento enviado`)
          }
          if (!buildEventPublicationSnapshot({
            activo: categoria.evento_activo,
            publication_mode: categoria.publication_mode,
            pre_publish_visibility: categoria.pre_publish_visibility,
            publish_at_utc: categoria.publish_at_utc,
            publish_timezone: categoria.publish_timezone,
            published_live_at: categoria.published_live_at,
          }).is_checkout_open) {
            throw new Error(`event_not_live:${String(categoria.evento_nombre)}`)
          }
          return {
            ...item,
            eventoId: String(categoria.evento_id),
            eventoNombre: String(categoria.evento_nombre),
            categoriaNombre: String(categoria.nombre),
            precio: Number(categoria.precio),
          }
        })

        for (const [categoriaId, cantidadNecesaria] of stockNecesarioEntradas.entries()) {
          const categoria = catMap.get(categoriaId)
          if (!categoria || Number(categoria.stock_disponible) < cantidadNecesaria) {
            throw Object.assign(new Error('sin_stock'), {
              _httpStatus: 409,
              _httpBody: {
                error: categoria
                  ? `Solo quedan ${Number(categoria.stock_disponible)} disponible${Number(categoria.stock_disponible) === 1 ? '' : 's'} de "${categoria.nombre}"`
                  : 'La categoría seleccionada ya no está disponible',
              },
            })
          }

          if (String(categoria.modo_fecha) === 'multiple') {
            const itemsCategoria = canonicalItemsEntradas.filter((item) => item.categoriaId === categoriaId)
            if (itemsCategoria.some((item) => !item.fechaId)) {
              throw Object.assign(new Error('falta_fecha'), {
                _httpStatus: 400,
                _httpBody: { error: `Debés seleccionar una fecha para "${categoria.nombre}"` },
              })
            }
            const fechaIds = itemsCategoria.map((item) => item.fechaId).filter((value): value is string => !!value)
            if (fechaIds.length > 0) {
              const fechaRows = await tx.$queryRaw<{ id: string }[]>`
                SELECT id FROM evento_fechas
                WHERE evento_id = ${String(categoria.evento_id)} AND id = ANY(${fechaIds}::text[])
              `
              if (fechaRows.length !== fechaIds.length) {
                throw Object.assign(new Error('fecha_invalida'), {
                  _httpStatus: 400,
                  _httpBody: { error: `La fecha elegida para "${categoria.nombre}" no es válida` },
                })
              }
            }
          }
        }

        // --- Lock 2/3: evento_addons (mismo orden que /:slug/checkout) ---
        type AddonResolved = { id: string; nombre: string; precio: number; cantidad: number; eventoId: string }
        const addonsResolved: AddonResolved[] = []
        if (addonsInput.length > 0) {
          const addonIds = [...new Set(addonsInput.map((a) => a.addon_id))]
          const addonRows = await tx.$queryRaw<Array<{ id: string; evento_id: string; nombre: string; precio: number; stock_disponible: number; max_por_compra: number; activo: boolean }>>`
            SELECT id, evento_id, nombre, precio::float AS precio, stock_disponible, max_por_compra, activo
            FROM evento_addons WHERE id = ANY(${addonIds}::text[]) AND empresa_id = ${empresaId}
            ORDER BY id
            FOR UPDATE
          `
          const addonsByEvento = new Set(canonicalItemsEntradas.map((i) => i.eventoId))
          const addonRowMap = new Map(addonRows.map((r) => [r.id, r]))
          for (const input of addonsInput) {
            const row = addonRowMap.get(input.addon_id)
            if (!row) {
              throw Object.assign(new Error('addon_no_existe'), {
                _httpStatus: 400, _httpBody: { error: 'Uno de los adicionales seleccionados ya no está disponible' },
              })
            }
            if (!row.activo || row.stock_disponible <= 0) {
              throw Object.assign(new Error('addon_inactivo'), {
                _httpStatus: 409, _httpBody: { error: `El adicional "${row.nombre}" no está disponible` },
              })
            }
            if (!addonsByEvento.has(row.evento_id)) {
              throw Object.assign(new Error('addon_otro_evento'), {
                _httpStatus: 400, _httpBody: { error: `El adicional "${row.nombre}" no pertenece a este evento` },
              })
            }
            if (input.cantidad > row.max_por_compra) {
              throw Object.assign(new Error('addon_max_compra'), {
                _httpStatus: 400, _httpBody: { error: `Máximo ${row.max_por_compra} unidades de "${row.nombre}" por compra` },
              })
            }
            if (input.cantidad > row.stock_disponible) {
              throw Object.assign(new Error('addon_sin_stock'), {
                _httpStatus: 409, _httpBody: { error: `Solo quedan ${row.stock_disponible} de "${row.nombre}"` },
              })
            }
            addonsResolved.push({ id: row.id, nombre: row.nombre, precio: Number(row.precio), cantidad: input.cantidad, eventoId: row.evento_id })
          }
        }

        // --- Lock 3/3: barra_stock (agregado al final del orden fijo) ---
        const barraIds = rawConsumibleItems.map((item) => item.barraId)
        const consumibleIds = rawConsumibleItems.map((item) => item.consumibleId)

        const stockRows = (barraIds.length > 0 && consumibleIds.length > 0)
          ? await tx.$queryRaw<BarraStockLockRow[]>`
              SELECT bs.id, bs.barra_id, bs.consumible_id, bs.stock_actual, bs.precio_override, bs.activo,
                     bs.stock_ilimitado, bs.agotado,
                     b.nombre AS barra_nombre, b.evento_id, b.activa AS barra_activa,
                     c.nombre, c.precio AS precio_base, c.activo AS consumible_activo,
                     e.nombre AS evento_nombre, e.venta_consumibles_habilitada,
                     e.activo AS evento_activo, e.publication_mode, e.pre_publish_visibility,
                     e.publish_at_utc, e.publish_timezone, e.published_live_at
              FROM barra_stock bs
              JOIN barras b ON b.id = bs.barra_id
              JOIN consumibles c ON c.id = bs.consumible_id
              JOIN eventos e ON e.id = b.evento_id
              WHERE b.empresa_id = ${empresaId}
                AND bs.barra_id = ANY(${barraIds}::text[])
                AND bs.consumible_id = ANY(${consumibleIds}::text[])
              ORDER BY bs.id
              FOR UPDATE
            `
          : []

        const stockMap = new Map<string, BarraStockLockRow>()
        for (const row of stockRows) stockMap.set(`${row.barra_id}::${row.consumible_id}`, row)

        canonicalItemsConsumibles = rawConsumibleItems.map((item) => {
          const row = stockMap.get(`${item.barraId}::${item.consumibleId}`)
          if (!row) throw new Error(`stock_missing:${item.barraId}:${item.consumibleId}`)
          if (String(row.evento_id) !== String(item.eventoId)) throw new Error('event_mismatch')
          if (!row.venta_consumibles_habilitada) throw new Error('sale_disabled')
          if (!buildEventPublicationSnapshot({
            activo: row.evento_activo,
            publication_mode: row.publication_mode,
            pre_publish_visibility: row.pre_publish_visibility,
            publish_at_utc: row.publish_at_utc,
            publish_timezone: row.publish_timezone,
            published_live_at: row.published_live_at,
          }).is_checkout_open) {
            throw new Error(`event_not_live:${String(row.evento_nombre)}`)
          }
          if (!row.barra_activa || !row.activo || !row.consumible_activo) throw new Error('stock_inactive')
          if (row.agotado) {
            throw Object.assign(new Error('sin_stock_consumible'), {
              _httpStatus: 409,
              _httpBody: { error: `"${String(row.nombre)}" está agotado` },
            })
          }
          return {
            barraId: String(row.barra_id),
            barraNombre: String(row.barra_nombre),
            consumibleId: String(row.consumible_id),
            nombre: String(row.nombre),
            precio: Number(row.precio_override ?? row.precio_base),
            cantidad: Number(item.cantidad),
            eventoId: String(row.evento_id),
            eventoNombre: String(row.evento_nombre),
          }
        })

        const requiredByKeyConsumibles = new Map<string, number>()
        for (const item of canonicalItemsConsumibles) {
          const key = `${item.barraId}::${item.consumibleId}`
          requiredByKeyConsumibles.set(key, (requiredByKeyConsumibles.get(key) ?? 0) + Number(item.cantidad))
        }

        for (const [key, cantidad] of requiredByKeyConsumibles.entries()) {
          const row = stockMap.get(key)
          if (!row) {
            throw Object.assign(new Error('sin_stock_consumible'), {
              _httpStatus: 409,
              _httpBody: { error: 'El consumible ya no está disponible' },
            })
          }
          if (!row.stock_ilimitado && Number(row.stock_actual) < cantidad) {
            throw Object.assign(new Error('sin_stock_consumible'), {
              _httpStatus: 409,
              _httpBody: { error: `Solo quedan ${Number(row.stock_actual)} disponible${Number(row.stock_actual) === 1 ? '' : 's'} de "${row.nombre}" en ${row.barra_nombre}` },
            })
          }
        }

        // --- Fee de marketplace: DOS resoluciones independientes, una por dominio. ---
        const subtotalEntradasYAddonsBase = canonicalItemsEntradas.reduce((acc, item) => acc + Number(item.precio) * Number(item.cantidad), 0)
          + addonsResolved.reduce((acc, a) => acc + a.precio * a.cantidad, 0)
        const subtotalConsumiblesBase = canonicalItemsConsumibles.reduce((acc, item) => acc + Number(item.precio) * Number(item.cantidad), 0)

        const marketplaceFeeEntradasResolved = await resolveMarketplaceFee(empresaId, subtotalEntradasYAddonsBase, 'entradas')
        const marketplaceFeeConsumiblesResolved = await resolveMarketplaceFee(empresaId, subtotalConsumiblesBase, 'consumibles')

        // Fee billing mode: mismo patrón (inflar precio por la fracción del comprador p)
        // que los dos checkouts existentes, aplicado a AMBOS dominios con el mismo p
        // (config a nivel empresa).
        const feeBillingMode = normalizeFeeBillingMode(empresaTenantMixto.fee_billing_mode)
        const buyerFeeFraction = resolveBuyerFeeFraction(feeBillingMode, Number(empresaTenantMixto.fee_split_buyer_pct))

        if (buyerFeeFraction > 0 && subtotalEntradasYAddonsBase > 0 && marketplaceFeeEntradasResolved.amount > 0) {
          const ratioEntradas = 1 + (marketplaceFeeEntradasResolved.amount * buyerFeeFraction / subtotalEntradasYAddonsBase)
          for (const item of canonicalItemsEntradas) {
            item.precio = Math.round((Number(item.precio) * ratioEntradas + Number.EPSILON) * 100) / 100
          }
          for (const a of addonsResolved) {
            a.precio = Math.round((a.precio * ratioEntradas + Number.EPSILON) * 100) / 100
          }
        }
        if (buyerFeeFraction > 0 && subtotalConsumiblesBase > 0 && marketplaceFeeConsumiblesResolved.amount > 0) {
          const ratioConsumibles = 1 + (marketplaceFeeConsumiblesResolved.amount * buyerFeeFraction / subtotalConsumiblesBase)
          for (const item of canonicalItemsConsumibles) {
            item.precio = Math.round((Number(item.precio) * ratioConsumibles + Number.EPSILON) * 100) / 100
          }
        }

        addonsResolvedMixto = addonsResolved

        sessionData = {
          flow: 'mixto',
          itemsEntradas: canonicalItemsEntradas,
          addons: addonsResolved.length > 0 ? addonsResolved : undefined,
          itemsConsumibles: canonicalItemsConsumibles,
          marketplaceFeeEntradas: {
            amount: marketplaceFeeEntradasResolved.amount,
            currency: marketplaceFeeEntradasResolved.currency,
            metadata: marketplaceFeeEntradasResolved.metadata,
          },
          marketplaceFeeConsumibles: {
            amount: marketplaceFeeConsumiblesResolved.amount,
            currency: marketplaceFeeConsumiblesResolved.currency,
            metadata: marketplaceFeeConsumiblesResolved.metadata,
          },
          feeBillingMode,
          feeBuyerFraction: buyerFeeFraction,
          confirmationToken: generateCheckoutConfirmationToken(),
        }

        // --- Descuento de stock en las tres tablas, dentro de la misma transacción. ---
        for (const [categoriaId, cantidadNecesaria] of stockNecesarioEntradas.entries()) {
          await tx.$executeRaw`
            UPDATE entrada_categorias SET stock_disponible = stock_disponible - ${cantidadNecesaria} WHERE id = ${categoriaId}
          `
          logEvent('stock_decremented', { categoria_id: categoriaId, quantity: cantidadNecesaria, source: 'checkout_mixto_reservation', empresa_id: empresaId })
        }

        for (const a of addonsResolved) {
          await tx.$executeRaw`UPDATE evento_addons SET stock_disponible = stock_disponible - ${a.cantidad} WHERE id = ${a.id}`
          logEvent('addon_stock_decremented', { addon_id: a.id, quantity: a.cantidad, source: 'checkout_mixto_reservation', empresa_id: empresaId })
        }

        for (const [key, cantidad] of requiredByKeyConsumibles.entries()) {
          if (stockMap.get(key)?.stock_ilimitado) continue
          const [barraId, consumibleId] = key.split('::')
          await tx.$executeRaw`
            UPDATE barra_stock SET stock_actual = stock_actual - ${cantidad}
            WHERE barra_id = ${barraId} AND consumible_id = ${consumibleId}
          `
          logEvent('stock_decremented', { barra_id: barraId, consumible_id: consumibleId, quantity: cantidad, source: 'checkout_mixto_reservation', empresa_id: empresaId })
        }

        await tx.checkoutSession.create({
          data: {
            id: sessionId,
            comprador_id: String(compradorRows[0].id),
            empresa_id: empresaId,
            datos: JSON.stringify(sessionData),
            estado: 'reservada',
            expires_at: expiresAt,
          },
        })
      }, {
        isolationLevel: 'Serializable',
        maxWait: 5000,
        timeout: 30000,
      })
    )
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === 'item_invalid') return res.status(400).json({ error: 'Cada item debe tener barra, consumible y cantidad válida' })
      if (error.message.startsWith('stock_missing:')) return res.status(400).json({ error: 'Uno de los consumibles ya no está disponible en la barra seleccionada' })
      if (error.message === 'event_mismatch') return res.status(400).json({ error: 'Uno de los consumibles no pertenece al evento enviado' })
      if (error.message === 'sale_disabled') return res.status(409).json({ error: 'La venta pública de consumibles ya no está habilitada para este evento' })
      if (error.message.startsWith('event_not_live:')) return res.status(409).json(buildPublicationCheckoutError(error.message.slice('event_not_live:'.length)))
      if (error.message === 'stock_inactive') return res.status(409).json({ error: 'Uno de los consumibles ya no está operativo para venta pública' })
      const httpBody = (error as { _httpBody?: { error: string } } | null)?._httpBody
      const httpStatus = (error as { _httpStatus?: number } | null)?._httpStatus
      if (httpBody && httpStatus) return res.status(httpStatus).json(httpBody)
    }
    logServerError('tenant checkout mixto reservation')
    return res.status(500).json({ error: 'No se pudo iniciar el checkout' })
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL!
  const sessionDataMixto = sessionData as MixtoCheckoutSessionData | null
  if (!sessionDataMixto?.marketplaceFeeEntradas || !sessionDataMixto?.marketplaceFeeConsumibles) {
    await cancelarReserva(sessionId, empresaId)
    return res.status(500).json({ error: 'No se pudo preparar la comisión del checkout' })
  }

  const totalBuyer = canonicalItemsEntradas.reduce((acc, item) => acc + Number(item.precio) * item.cantidad, 0)
    + addonsResolvedMixto.reduce((acc, a) => acc + Number(a.precio) * a.cantidad, 0)
    + canonicalItemsConsumibles.reduce((acc, item) => acc + Number(item.precio) * item.cantidad, 0)
  if (totalBuyer <= 0) {
    await cancelarReserva(sessionId, empresaId)
    return res.status(400).json({ error: 'El carrito gratuito no puede procesarse vía Mercado Pago. Contactá al organizador.' })
  }

  // mpItems combinado: entradas + addons + consumibles (a diferencia de /:slug/checkout,
  // que hoy NO incluye addons en los items de MP — ver nota en el reporte de esta fase).
  const mpItems = [
    ...canonicalItemsEntradas.map((item) => ({
      id: item.categoriaId,
      title: `${item.eventoNombre} — ${item.categoriaNombre}`,
      quantity: item.cantidad,
      unit_price: Number(item.precio),
      currency_id: 'ARS',
    })),
    ...addonsResolvedMixto.map((addon) => ({
      id: addon.id,
      title: `Adicional — ${addon.nombre}`,
      quantity: addon.cantidad,
      unit_price: Number(addon.precio),
      currency_id: 'ARS',
    })),
    ...canonicalItemsConsumibles.map((item) => ({
      id: `${item.barraId}:${item.consumibleId}`,
      title: `${item.eventoNombre} — ${item.barraNombre} · ${item.nombre}`,
      quantity: item.cantidad,
      unit_price: Number(item.precio),
      currency_id: 'ARS',
    })),
  ]

  const marketplaceFeeTotalAmount = roundMoney(
    sessionDataMixto.marketplaceFeeEntradas.amount + sessionDataMixto.marketplaceFeeConsumibles.amount,
  )
  const platformSponsorId = marketplaceFeeTotalAmount > 0
    ? await getPlatformOwnerCollectorId()
    : null

  const maxInstallmentsMixto = Math.max(1, Math.min(24, empresaTenantMixto.mp_max_installments ?? 1))

  const preference = new Preference(mpClient)
  try {
    const response = await preference.create({
      body: {
        items: mpItems,
        payer: { email: req.user.email! },
        back_urls: {
          success: `${baseUrl}/api/tenant/${slug}/pago/confirmar-redirect?session=${sessionId}&ct=${encodeURIComponent(sessionDataMixto.confirmationToken ?? '')}`,
          failure: `${baseUrl}/api/tenant/${slug}/pago/confirmar-redirect?session=${sessionId}&ct=${encodeURIComponent(sessionDataMixto.confirmationToken ?? '')}&status=failure`,
          pending: `${baseUrl}/api/tenant/${slug}/pago/confirmar-redirect?session=${sessionId}&ct=${encodeURIComponent(sessionDataMixto.confirmationToken ?? '')}&status=pending`,
        },
        notification_url: `${baseUrl}/api/tenant/${slug}/pago/webhook`,
        auto_return: 'approved',
        external_reference: sessionId,
        marketplace_fee: marketplaceFeeTotalAmount,
        ...(platformSponsorId ? { sponsor_id: Number(platformSponsorId) } : {}),
        payment_methods: { installments: maxInstallmentsMixto },
        metadata: {
          session_id: sessionId,
          empresa_id: empresaId,
          checkout_flow: 'mixto',
          marketplace_fee: {
            amount: marketplaceFeeTotalAmount,
            entradas: {
              amount: sessionDataMixto.marketplaceFeeEntradas.amount,
              ...sessionDataMixto.marketplaceFeeEntradas.metadata,
            },
            consumibles: {
              amount: sessionDataMixto.marketplaceFeeConsumibles.amount,
              ...sessionDataMixto.marketplaceFeeConsumibles.metadata,
            },
          },
        },
        statement_descriptor: empresaNombre,
      },
    })

    return res.json({ init_point: response.init_point, expires_at: expiresAt.toISOString() })
  } catch (error) {
    await cancelarReserva(sessionId, empresaId)
    logServerError('tenant checkout mixto mercadopago preference')
    return res.status(500).json({ error: 'No se pudo crear la preferencia de pago' })
  }
})

// POST /tenant/:slug/pago/confirmar
router.post('/:slug/pago/confirmar', verifyInternal, async (req: Request, res: Response) => {
  const { slug } = req.params
  const { sessionId, paymentId } = req.body

  if (!req.user || req.user.userType !== 'comprador' || !req.user.id || req.user.empresa_slug !== slug) {
    return res.status(401).json({ error: 'No autorizado' })
  }

  if (!sessionId || !paymentId) {
    return res.status(400).json({ error: 'sessionId y paymentId son obligatorios' })
  }

  const result = await confirmarPagoLogic(sessionId, slug, paymentId, { compradorId: req.user.id })
  const { status, ...body } = result
  return res.status(status).json(body)
})

// GET /tenant/:slug/pago/confirmar-redirect
router.get('/:slug/pago/confirmar-redirect', verifyInternal, async (req: Request, res: Response) => {
  const { slug } = req.params
  const sessionId = req.query.session as string
  const confirmationToken = req.query.ct as string | undefined
  const status =
    (req.query.status as string) ?? (req.query.collection_status as string) ?? null
  const paymentId = (req.query.payment_id as string) ?? (req.query.collection_id as string) ?? null

  const tenantBase = buildTenantBaseUrl(slug)

  if (!sessionId || !paymentId || !confirmationToken || (status && status !== 'approved')) {
    return res.redirect(`${tenantBase}/pago/error?reason=payment`)
  }

  try {
    const result = await confirmarPagoLogic(sessionId, slug, paymentId, { confirmationToken })
    if (!result.ok) {
      const reason = result.reason ?? 'payment'
      return res.redirect(`${tenantBase}/pago/error?reason=${encodeURIComponent(reason)}`)
    }

    if (result.flow === 'consumibles') {
      return res.redirect(`${tenantBase}/mis-tickets?tab=consumibles&success=1`)
    }
  } catch (err) {
    logServerError('tenant payment confirmation redirect')
    return res.redirect(`${tenantBase}/pago/error?reason=payment`)
  }

  return res.redirect(`${tenantBase}/mis-tickets?success=1`)
})

router.post('/:slug/pago/webhook', verifyInternal, paymentWebhookRateLimit, async (req: Request, res: Response) => {
  const { slug } = req.params
  const type = typeof req.body?.type === 'string' ? req.body.type : typeof req.query.type === 'string' ? req.query.type : ''
  const topic = typeof req.body?.topic === 'string' ? req.body.topic : typeof req.query.topic === 'string' ? req.query.topic : ''
  const paymentId = req.body?.data?.id ?? req.query['data.id'] ?? req.query.id

  // Verify Mercado Pago webhook signature before doing anything else.
  // MERCADOPAGO_SKIP_WEBHOOK_SIGNATURE=true disables this check in local dev only.
  if (process.env.NODE_ENV === 'production' && process.env.MERCADOPAGO_SKIP_WEBHOOK_SIGNATURE === 'true') {
    console.error('[webhook] FATAL: MERCADOPAGO_SKIP_WEBHOOK_SIGNATURE must not be set in production')
    return res.status(500).json({ error: 'Configuración inválida del servidor' })
  }
  const skipSignature = process.env.NODE_ENV !== 'production' && process.env.MERCADOPAGO_SKIP_WEBHOOK_SIGNATURE === 'true'
  if (!skipSignature) {
    const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET
    if (!webhookSecret) {
      console.error('[webhook] MERCADOPAGO_WEBHOOK_SECRET no configurado')
      return res.status(500).json({ error: 'Configuración incompleta' })
    }
    const xSignature = req.headers['x-signature'] as string | undefined
    const xRequestId = req.headers['x-request-id'] as string | undefined
    const dataId = req.body?.data?.id ?? req.query['data.id'] ?? req.query.id
    if (!verifyMercadoPagoSignature(String(dataId ?? ''), xRequestId, xSignature, webhookSecret)) {
      console.warn('[webhook] Firma inválida', { slug, dataId })
      return res.status(401).json({ error: 'Firma inválida' })
    }
  }

  if (!(type === 'payment' || topic === 'payment')) {
    return res.status(202).json({ ok: true, ignored: true })
  }

  if (!paymentId) {
    return res.status(400).json({ error: 'payment id requerido' })
  }

  try {
    const empresaRow = await prisma.empresa.findFirst({
      where: { slug: slug.trim().toLowerCase(), activa: true },
      select: { id: true },
    })

    if (!empresaRow) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    const empresaId = String(empresaRow.id)

    // Verificar que el paymentId está asociado a una checkout_session de esta empresa.
    // Esto previene que un atacante use un paymentId de otra empresa para atacar un slug diferente.
    // Se ejecuta después de la validación HMAC y antes de consultar la API de Mercado Pago.
    const sessionCheck = await prisma.$queryRaw<{ id: string }[]>`
      SELECT cs.id FROM checkout_sessions cs
      JOIN empresas em ON em.id = cs.empresa_id
      WHERE cs.payment_id = ${String(paymentId)} AND em.slug = ${slug}
      LIMIT 1
    `
    // Si no hay sesión para este paymentId+slug, puede ser un pago recién creado (aún sin
    // payment_id en checkout_sessions) o un ataque cross-empresa. En ambos casos dejamos
    // continuar solo si el checkout_sessions tiene external_reference válido, que se verifica
    // en confirmarPagoLogic. Sin embargo, si ya existe el registro con OTRO slug, lo rechazamos.
    const crossCheck = await prisma.$queryRaw<{ slug: string }[]>`
      SELECT em.slug FROM checkout_sessions cs
      JOIN empresas em ON em.id = cs.empresa_id
      WHERE cs.payment_id = ${String(paymentId)}
      LIMIT 1
    `
    if (crossCheck[0] && crossCheck[0].slug !== slug) {
      console.warn('[webhook] paymentId pertenece a otro slug', { slug, paymentId, ownerSlug: crossCheck[0].slug })
      return res.status(404).json({ error: 'Sesión no encontrada' })
    }

    const mpClient = await getMercadoPagoClientByEmpresaId(empresaId)
    if (!mpClient) {
      return res.status(202).json({ ok: true, ignored: true })
    }

    const paymentClient = new Payment(mpClient)
    const payment = await paymentClient.get({ id: paymentId })
    const sessionId = String(payment.external_reference ?? '')

    if (!sessionId) {
      return res.status(202).json({ ok: true, ignored: true })
    }

    logEvent('webhook_received', { provider: 'mercadopago', slug, payment_id: String(paymentId), session_id: sessionId })

    // Idempotency check con ciclo processing → done/failed.
    // Problema que resuelve: si el INSERT tenía éxito pero confirmarPagoLogic() fallaba
    // después, el registro quedaba marcado como procesado sin que el pago se confirmara.
    // Un reintento de MP encontraba ER_DUP_ENTRY y devolvía 202 sin hacer nada →
    // el comprador pagaba pero no recibía sus entradas.
    // Solución: status='processing' durante la ejecución. Si falla → status='failed',
    // lo que permite que el siguiente reintento de MP reprocese el webhook.
    const paymentIdStr = String(paymentId)
    try {
      await prisma.processedWebhook.create({
        data: {
          provider: 'mercadopago',
          payment_id: paymentIdStr,
          empresa_id: empresaId,
          session_id: sessionId,
          result: 'pending',
          status: 'processing',
        },
      })
    } catch (err) {
      // P2002 = unique constraint violation (Postgres equivalent of ER_DUP_ENTRY)
      const code = (err as { code?: string } | null | undefined)?.code
      if (code === 'P2002') {
        const existing = await prisma.processedWebhook.findUnique({
          where: { provider_payment_id: { provider: 'mercadopago', payment_id: paymentIdStr } },
          select: { status: true },
        })
        const existingStatus = existing?.status as string | undefined

        if (existingStatus === 'done') {
          logEvent('webhook_idempotent_hit', { provider: 'mercadopago', payment_id: paymentIdStr, empresa_id: empresaId })
          return res.status(202).json({ ok: true, idempotent: true })
        }

        if (existingStatus === 'processing') {
          logEvent('webhook_duplicate_processing', { provider: 'mercadopago', payment_id: paymentIdStr, empresa_id: empresaId })
          return res.status(202).json({ ok: true, idempotent: true })
        }

        if (existingStatus === 'failed') {
          // El intento anterior falló: permitir reprocesamiento limpiando el registro anterior
          await prisma.processedWebhook.delete({
            where: { provider_payment_id: { provider: 'mercadopago', payment_id: paymentIdStr } },
          })
          await prisma.processedWebhook.create({
            data: {
              provider: 'mercadopago',
              payment_id: paymentIdStr,
              empresa_id: empresaId,
              session_id: sessionId,
              result: 'pending',
              status: 'processing',
            },
          })
          logEvent('webhook_retry_after_failure', { provider: 'mercadopago', payment_id: paymentIdStr, empresa_id: empresaId })
        } else {
          // status desconocido o NULL — tratar como idempotente para no procesar dos veces
          logEvent('webhook_idempotent_hit', { provider: 'mercadopago', payment_id: paymentIdStr, empresa_id: empresaId })
          return res.status(202).json({ ok: true, idempotent: true })
        }
      } else {
        throw err
      }
    }

    const result = await confirmarPagoLogic(sessionId, slug, paymentId)

    if (result.ok) {
      void prisma.processedWebhook.updateMany({
        where: { provider: 'mercadopago', payment_id: paymentIdStr },
        data: { status: 'done', result: result.reason ?? 'ok', processed_at: new Date() },
      }).catch(() => {})
      logEvent('payment_confirmed', { session_id: sessionId, empresa_id: empresaId, payment_id: paymentIdStr, flow: result.flow ?? null, quantity: result.entradas ?? result.ventas ?? 0 })
      void sendSaleNotificationToEmpresa(sessionId)
    } else if (result.reason === 'approved_after_expiry' || result.reason === 'invalid_state') {
      void prisma.processedWebhook.updateMany({
        where: { provider: 'mercadopago', payment_id: paymentIdStr },
        data: { status: 'done', result: `reconciliation:${result.reason}`, processed_at: new Date() },
      }).catch(() => {})
      logEvent('payment_reconciliation_pending', { session_id: sessionId, empresa_id: empresaId, payment_id: paymentIdStr, reason: result.reason })
    } else if (result.reason === 'payment_not_approved' && (result.paymentStatus === 'rejected' || result.paymentStatus === 'cancelled')) {
      void prisma.processedWebhook.updateMany({
        where: { provider: 'mercadopago', payment_id: paymentIdStr },
        data: { status: 'done', result: `cancelled:${result.paymentStatus}`, processed_at: new Date() },
      }).catch(() => {})

      void cancelarReserva(sessionId, empresaId).catch(() => {
        logServerError(`webhook cancelarReserva failed for session ${sessionId}`)
      })

      logEvent('payment_rejected_cancelled', { session_id: sessionId, empresa_id: empresaId, payment_id: paymentIdStr, payment_status: result.paymentStatus })
    } else {
      const rawErrMsg = result.error ?? result.reason ?? null
      const errMsg = typeof rawErrMsg === 'string' ? rawErrMsg.slice(0, 255) : (rawErrMsg ?? null)
      void prisma.processedWebhook.updateMany({
        where: { provider: 'mercadopago', payment_id: paymentIdStr },
        data: { status: 'failed', result: `error:${result.reason ?? 'unknown'}`, error_message: errMsg, processed_at: new Date() },
      }).catch(() => {})
    }

    if (!result.ok && result.reason !== 'approved_after_expiry' && result.reason !== 'invalid_state' &&
        !(result.reason === 'payment_not_approved' && (result.paymentStatus === 'rejected' || result.paymentStatus === 'cancelled'))) {
      return res.status(result.status).json({ ok: false, reason: result.reason ?? 'payment' })
    }

    return res.status(202).json({ ok: true, reconciled: result.ok, reason: result.reason ?? null })
  } catch {
    void prisma.processedWebhook.updateMany({
      where: { provider: 'mercadopago', payment_id: String(paymentId) },
      data: { status: 'failed', result: 'error:exception', processed_at: new Date() },
    }).catch(() => {})
    logServerError('tenant payment webhook')
    return res.status(500).json({ error: 'No se pudo reconciliar el webhook de pago' })
  }
})

// POST /tenant/:slug/validar-codigo-descuento
// Este endpoint es SOLO para preview en el UI: calcula el monto del descuento sin
// incrementar usos_actuales ni hacer ningún lock. El enforcement real (FOR UPDATE +
// incremento) ocurre en el checkout (POST /:slug/checkout) y en confirmarPagoLogic().
// No agregar FOR UPDATE aquí porque este endpoint no está en una transacción y un
// SELECT FOR UPDATE fuera de transacción es no-op en MySQL (autocommit).
router.post('/:slug/validar-codigo-descuento', verifyInternal, async (req: Request, res: Response) => {
  try {
    const { slug } = req.params
    const { codigo, subtotal, eventoId, tipo_compra } = req.body

    if (!codigo || typeof codigo !== 'string' || !codigo.trim()) {
      return res.status(400).json({ error: 'El código es requerido' })
    }

    if (subtotal == null || !Number.isFinite(Number(subtotal)) || Number(subtotal) < 0) {
      return res.status(400).json({ error: 'El subtotal es requerido' })
    }

    const subtotalNum = Number(subtotal)
    const codigoNorm = String(codigo).trim().toUpperCase()

    const empresaForCodigo = await findPublicTenant(slug)

    if (!empresaForCodigo) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    const empresaId = empresaForCodigo.id

    const codigo_row = await prisma.marketingCodigoDescuento.findFirst({
      where: { empresa_id: empresaId, codigo: { equals: codigoNorm, mode: 'insensitive' } },
      select: { id: true, codigo: true, tipo: true, valor: true, aplica_a: true, usos_maximos: true, usos_actuales: true, monto_minimo: true, valido_desde: true, valido_hasta: true, activo: true },
    })

    if (!codigo_row || !codigo_row.activo) {
      return res.status(400).json({ error: 'El código no es válido o ya no está disponible' })
    }

    const ahora = new Date()

    if (codigo_row.valido_desde && new Date(codigo_row.valido_desde) > ahora) {
      return res.status(400).json({ error: 'El código aún no está vigente' })
    }

    if (codigo_row.valido_hasta && new Date(codigo_row.valido_hasta) < ahora) {
      return res.status(400).json({ error: 'El código está vencido' })
    }

    if (codigo_row.usos_maximos != null && Number(codigo_row.usos_actuales) >= Number(codigo_row.usos_maximos)) {
      return res.status(400).json({ error: 'El código alcanzó el límite de usos' })
    }

    if (codigo_row.monto_minimo != null && subtotalNum < Number(codigo_row.monto_minimo)) {
      return res.status(400).json({ error: `El monto mínimo para usar este código es $${Number(codigo_row.monto_minimo).toLocaleString('es-AR')}` })
    }

    const apli = String(codigo_row.aplica_a ?? 'todos')
    if (tipo_compra && apli !== 'todos' && apli !== tipo_compra) {
      return res.status(400).json({ error: `Este código solo aplica para ${apli}` })
    }

    let descuento_monto = 0
    if (String(codigo_row.tipo) === 'porcentaje') {
      descuento_monto = roundMoney((subtotalNum * Number(codigo_row.valor)) / 100)
    } else {
      descuento_monto = roundMoney(Math.min(Number(codigo_row.valor), subtotalNum))
    }

    return res.json({
      ok: true,
      descuento_monto,
      tipo: codigo_row.tipo,
      valor: Number(codigo_row.valor),
      codigo_id: codigo_row.id,
    })
  } catch {
    logServerError('tenant validar codigo descuento')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /tenant/:slug/soporte
router.post('/:slug/soporte', verifyInternal, async (req: Request, res: Response) => {
  const { slug } = req.params
  const { nombre, email, mensaje } = req.body

  if (typeof nombre !== 'string' || !nombre.trim() || nombre.trim().length > 100) {
    return res.status(400).json({ error: 'nombre es obligatorio y debe tener máximo 100 caracteres' })
  }
  if (typeof email !== 'string' || !email.trim() || !email.includes('@') || !email.includes('.') || email.trim().length > 254) {
    return res.status(400).json({ error: 'email inválido' })
  }
  if (typeof mensaje !== 'string' || !mensaje.trim() || mensaje.trim().length > 4000) {
    return res.status(400).json({ error: 'mensaje es obligatorio y debe tener máximo 4000 caracteres' })
  }

  // slug stored lowercase per design
  const empresa = await prisma.empresa.findFirst({
    where: {
      slug: slug.trim().toLowerCase(),
      activa: true,
      tenant_public_disabled: false,
      suspendido: false,
    },
    select: { id: true, nombre: true, email: true, support_contact_email: true },
  })

  if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' })
  if (typeof empresa.support_contact_email !== 'string' || empresa.support_contact_email.trim().length === 0) {
    return res.status(409).json({ error: 'Soporte no disponible' })
  }

  const empresaId = String(empresa.id)

  // Persistir el mensaje en DB ANTES de enviar el email.
  // Si Resend falla, el registro queda con email_enviado=false para revisión manual.
  const mensajeRow = await prisma.soporteMensaje.create({
    data: {
      empresa_id: empresaId,
      nombre: nombre.trim(),
      email: email.trim(),
      mensaje: mensaje.trim(),
      email_enviado: false,
    },
    select: { id: true },
  })
  const mensajeId = mensajeRow.id

  const esc = (s: string) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')

  try {
    const emailResult = await resend?.emails.send({
      from: resendFromEmail,
      to: empresa.support_contact_email,
      subject: `Consulta de soporte — ${empresa.nombre}`,
      html: `
        <h2>Nueva consulta de soporte</h2>
        <p><strong>Nombre:</strong> ${esc(nombre)}</p>
        <p><strong>Email:</strong> ${esc(email)}</p>
        <p><strong>Mensaje:</strong></p>
        <p>${esc(mensaje)}</p>
      `,
    })

    if (emailResult?.data?.id) {
      void prisma.soporteMensaje.update({
        where: { id: mensajeId },
        data: { email_enviado: true },
      }).catch(() => undefined)
    }
  } catch {
    // El mensaje ya quedó guardado en DB con email_enviado=false para revisión manual
    // No propagamos el error al cliente — el mensaje se recibió correctamente
  }

  return res.json({ ok: true })
})

export default router
