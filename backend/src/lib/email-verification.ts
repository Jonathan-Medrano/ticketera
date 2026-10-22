import crypto from 'crypto'
import { randomUUID as uuidv4 } from 'node:crypto'
import { prisma } from './prisma'
import { Resend } from 'resend'
import { logServerInfo, logServerWarn, logServerError } from './safe-log'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

function getFromEmail(): string {
  const from = process.env.RESEND_FROM_EMAIL
  if (!from && process.env.NODE_ENV === 'production') {
    throw new Error('RESEND_FROM_EMAIL is required in production')
  }
  return from ?? 'onboarding@resend.dev'
}

const resendFromEmail = getFromEmail()

// TTL de código + magic-link. Default 10 min; se puede overridear por env para
// testear la expiración rápido (ej: EMAIL_VERIFICATION_TTL_SECONDS=10). El default
// seguro hace que, al quitar el override, vuelva solo a 10 min sin tocar código.
const EMAIL_VERIFICATION_TTL_SECONDS = Number(process.env.EMAIL_VERIFICATION_TTL_SECONDS) || 600
const EMAIL_VERIFICATION_TTL_MS = EMAIL_VERIFICATION_TTL_SECONDS * 1000

function ttlLabel(): string {
  if (EMAIL_VERIFICATION_TTL_SECONDS < 60) return `${EMAIL_VERIFICATION_TTL_SECONDS} segundos`
  return `${Math.round(EMAIL_VERIFICATION_TTL_SECONDS / 60)} minutos`
}
const EMAIL_VERIFICATION_MAX_ATTEMPTS = 5

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function hashCode(code: string) {
  return crypto.createHash('sha256').update(code).digest('hex')
}

function generateCode(): string {
  // 6 dígitos seguros, zero-padded (000000–999999).
  return crypto.randomInt(0, 1_000_000).toString().padStart(6, '0')
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

const APP_BASE_DOMAIN = process.env.TENANT_BASE_URL ?? 'https://ticketera.com'

function buildAppBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : APP_BASE_DOMAIN)
  )
}

function buildVerificationUrl(token: string, email: string) {
  const base = buildAppBaseUrl().replace(/\/$/, '')
  return `${base}/verificar-email?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}`
}

function buildVerificationEmail(code: string, confirmUrl: string) {
  const safeCode = escapeHtml(code)
  const safeUrl = escapeHtml(confirmUrl)
  return {
    subject: 'Confirmá tu cuenta · TICKETERA',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#0f172a">
        <h2 style="margin-bottom:8px">Verificá tu email</h2>
        <p style="margin:0 0 16px">Confirmá tu cuenta en TICKETERA con un solo click:</p>
        <p style="text-align:center;margin:0 0 24px">
          <a href="${safeUrl}" style="display:inline-block;background:#0052cc;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;border-radius:12px;padding:14px 28px">Confirmar mi cuenta</a>
        </p>
        <p style="margin:0 0 8px;color:#475569">O ingresá este código manualmente:</p>
        <div style="font-size:36px;font-weight:700;letter-spacing:10px;text-align:center;color:#0052cc;background:#f1f5f9;border-radius:12px;padding:18px 0;margin:8px 0 16px">${safeCode}</div>
        <p style="margin:0 0 8px;color:#475569">El enlace y el código vencen en ${ttlLabel()}.</p>
        <p style="color:#94a3b8;font-size:13px;margin:16px 0 0">Si el botón no funciona, copiá y pegá este enlace en tu navegador:<br><span style="word-break:break-all">${safeUrl}</span></p>
        <p style="color:#94a3b8;font-size:13px;margin:12px 0 0">Si no creaste una cuenta en TICKETERA, podés ignorar este mensaje.</p>
      </div>
    `,
  }
}

function generateLinkToken(): string {
  // 32 bytes de entropía → suficiente para un magic-link de un solo uso y TTL corto.
  return crypto.randomBytes(32).toString('hex')
}

export interface SendEmailVerificationCodeParams {
  empresaId: string
  email: string
  ip?: string | null
}

/**
 * Genera un código de 6 dígitos para la empresa, borra los códigos previos no
 * consumidos y envía el email. Best-effort en el envío: si Resend falla logueamos
 * pero no rompemos — el usuario puede reenviar.
 */
export async function sendEmailVerificationCode(params: SendEmailVerificationCodeParams): Promise<void> {
  const email = normalizeEmail(params.email)
  const code = generateCode()
  const codeHash = hashCode(code)
  const linkToken = generateLinkToken()
  const linkTokenHash = hashCode(linkToken)
  const expiresAt = new Date(Date.now() + EMAIL_VERIFICATION_TTL_MS)

  // Un solo código activo por empresa: borramos los previos no consumidos.
  await prisma.$transaction([
    prisma.emailVerificationCode.deleteMany({
      where: { empresa_id: params.empresaId, consumed_at: null },
    }),
    prisma.emailVerificationCode.create({
      data: {
        id: uuidv4(),
        empresa_id: params.empresaId,
        email,
        code_hash: codeHash,
        link_token_hash: linkTokenHash,
        expires_at: expiresAt,
        requested_ip: params.ip ?? null,
      },
    }),
  ])

  const confirmUrl = buildVerificationUrl(linkToken, email)

  if (!resend) {
    // Sin proveedor configurado (dev/local): logueamos código y link para poder probar.
    logServerWarn(`[EmailVerification] Resend no configurado — código para ${email}: ${code}`)
    logServerWarn(`[EmailVerification] link de confirmación: ${confirmUrl}`)
    return
  }

  const emailCopy = buildVerificationEmail(code, confirmUrl)

  try {
    const { error } = await resend.emails.send({
      from: resendFromEmail,
      to: email,
      subject: emailCopy.subject,
      html: emailCopy.html,
    })
    if (error) {
      // Resend NO lanza excepción cuando rechaza el envío (dominio sin verificar,
      // modo sandbox, rate limit): devuelve { data: null, error }. Si no chequeamos
      // este campo, el mail nunca sale y el log diría "enviado" en falso. Lo
      // logueamos FUERTE para que un fallo de deliverability sea visible.
      logServerError(
        `[EmailVerification] Resend rechazó el envío empresa=${params.empresaId} status=${error.statusCode ?? '?'} ${error.name}: ${error.message}`,
      )
      return
    }
    logServerInfo(`[EmailVerification] código enviado empresa=${params.empresaId}`)
  } catch (error) {
    logServerError(
      `[EmailVerification] fallo al enviar código empresa=${params.empresaId}: ${error instanceof Error ? error.message : 'unknown_error'}`,
    )
  }
}

export interface VerifyEmailCodeParams {
  email: string
  code: string
  ip?: string | null
}

export type VerifyEmailCodeResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'expired' | 'too_many_attempts' | 'not_found' }

/**
 * Verifica el código contra la empresa identificada por email. Idempotente: si la
 * empresa ya está verificada devuelve ok:true. Incrementa attempts en cada intento
 * fallido y aplica el límite de 5 intentos por código.
 */
export async function verifyEmailCode(params: VerifyEmailCodeParams): Promise<VerifyEmailCodeResult> {
  const email = normalizeEmail(params.email)
  const code = (params.code ?? '').trim()

  if (!email || !code) {
    return { ok: false, reason: 'invalid' }
  }

  const empresa = await prisma.empresa.findFirst({
    where: { email },
    select: { id: true, email_verificado: true },
  })

  if (!empresa) {
    return { ok: false, reason: 'not_found' }
  }

  if (empresa.email_verificado) {
    // Idempotente: ya verificada.
    return { ok: true }
  }

  const record = await prisma.emailVerificationCode.findFirst({
    where: { empresa_id: empresa.id, consumed_at: null },
    orderBy: { created_at: 'desc' },
  })

  if (!record) {
    return { ok: false, reason: 'not_found' }
  }

  if (new Date(record.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' }
  }

  if (record.attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
    return { ok: false, reason: 'too_many_attempts' }
  }

  const matches = hashCode(code) === record.code_hash

  if (!matches) {
    await prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { attempts: { increment: 1 } },
    })
    return { ok: false, reason: 'invalid' }
  }

  const now = new Date()
  await prisma.$transaction([
    prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { consumed_at: now },
    }),
    prisma.empresa.update({
      where: { id: empresa.id },
      data: { email_verificado: true, email_verificado_at: now },
    }),
  ])

  logServerInfo(`[EmailVerification] email verificado empresa=${empresa.id}`)

  return { ok: true }
}

export type ConfirmEmailByLinkTokenResult =
  | { ok: true }
  | { ok: false; reason: 'invalid' | 'expired' }

/**
 * Confirma el email vía magic-link (token de un solo uso enviado en el email de
 * verificación). Idempotente: si la empresa ya está verificada devuelve ok:true,
 * así un doble-click o un reintento no muestran error. No usamos FOR UPDATE — la
 * operación es idempotente y el peor caso de una carrera es setear verificado dos
 * veces (sin efecto). El token tiene 32 bytes de entropía y TTL de 10 min.
 */
export async function confirmEmailByLinkToken(token: string): Promise<ConfirmEmailByLinkTokenResult> {
  const clean = (token ?? '').trim()
  if (!clean) {
    return { ok: false, reason: 'invalid' }
  }

  const tokenHash = hashCode(clean)

  const record = await prisma.emailVerificationCode.findFirst({
    where: { link_token_hash: tokenHash },
    orderBy: { created_at: 'desc' },
  })

  if (!record) {
    return { ok: false, reason: 'invalid' }
  }

  const empresa = await prisma.empresa.findFirst({
    where: { id: record.empresa_id },
    select: { id: true, email_verificado: true },
  })

  if (!empresa) {
    return { ok: false, reason: 'invalid' }
  }

  // Idempotente: ya verificada (incluye el caso de re-click sobre un token ya usado).
  if (empresa.email_verificado) {
    return { ok: true }
  }

  if (record.consumed_at) {
    // Token ya consumido pero la empresa no quedó verificada (caso anómalo): inválido.
    return { ok: false, reason: 'invalid' }
  }

  if (new Date(record.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: 'expired' }
  }

  const now = new Date()
  await prisma.$transaction([
    prisma.emailVerificationCode.update({
      where: { id: record.id },
      data: { consumed_at: now },
    }),
    prisma.empresa.update({
      where: { id: empresa.id },
      data: { email_verificado: true, email_verificado_at: now },
    }),
  ])

  logServerInfo(`[EmailVerification] email verificado por link empresa=${empresa.id}`)

  return { ok: true }
}
