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

function buildApprovedEmail(params: { nombre: string; adminNombre?: string | null; dashboardUrl: string }) {
  const safeUrl = escapeHtml(params.dashboardUrl)
  const greetingName = (params.adminNombre ?? '').trim() || (params.nombre ?? '').trim()
  const safeGreeting = greetingName ? `Hola ${escapeHtml(greetingName)},` : 'Hola,'
  const safeNombre = escapeHtml((params.nombre ?? '').trim() || 'tu cuenta')
  return {
    subject: '¡Tu cuenta fue aprobada en TICKETERA! 🎉',
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#0f172a">
        <h2 style="margin-bottom:8px">¡Bienvenido a TICKETERA!</h2>
        <p style="margin:0 0 8px">${safeGreeting}</p>
        <p style="margin:0 0 16px">Tu cuenta <strong>${safeNombre}</strong> fue aprobada y ya está activa. Entrá a tu panel para empezar a crear eventos, vender entradas y gestionar tu barra.</p>
        <p style="text-align:center;margin:0 0 24px">
          <a href="${safeUrl}" style="display:inline-block;background:#0052cc;color:#ffffff;text-decoration:none;font-weight:600;font-size:16px;border-radius:12px;padding:14px 28px">Ir a mi panel</a>
        </p>
        <p style="color:#94a3b8;font-size:13px;margin:16px 0 0">Si el botón no funciona, copiá y pegá este enlace en tu navegador:<br><span style="word-break:break-all">${safeUrl}</span></p>
        <p style="color:#94a3b8;font-size:13px;margin:12px 0 0">Si no esperabas este mensaje, podés ignorarlo.</p>
      </div>
    `,
  }
}

export interface SendEmpresaApprovedEmailParams {
  email: string
  nombre: string
  adminNombre?: string | null
  /** URL al panel/login. Si no se pasa, se usa el base app url. */
  dashboardUrl?: string
}

/**
 * Envía el email de "cuenta aprobada" a la empresa. Best-effort: si Resend falla
 * logueamos pero no rompemos el flujo (aprobación / registro siguen su curso).
 *
 * IMPORTANTE: el SDK de Resend NO lanza excepción cuando rechaza el envío —
 * devuelve { data, error }. Chequeamos `error` explícitamente y logueamos FUERTE
 * con logServerError, así un fallo de deliverability es visible.
 */
export async function sendEmpresaApprovedEmail(params: SendEmpresaApprovedEmailParams): Promise<void> {
  const email = (params.email ?? '').trim().toLowerCase()
  if (!email) {
    return
  }

  const dashboardUrl = (params.dashboardUrl ?? buildAppBaseUrl()).replace(/\/$/, '')

  if (!resend) {
    // Sin proveedor configurado (dev/local): logueamos para poder probar.
    logServerWarn(`[EmpresaApproved] Resend no configurado — email de aprobación NO enviado a ${email}`)
    return
  }

  const emailCopy = buildApprovedEmail({
    nombre: params.nombre,
    adminNombre: params.adminNombre ?? null,
    dashboardUrl,
  })

  try {
    const { error } = await resend.emails.send({
      from: resendFromEmail,
      to: email,
      subject: emailCopy.subject,
      html: emailCopy.html,
    })
    if (error) {
      logServerError(
        `[EmpresaApproved] Resend rechazó el envío to=${email} status=${error.statusCode ?? '?'} ${error.name}: ${error.message}`,
      )
      return
    }
    logServerInfo(`[EmpresaApproved] email de aprobación enviado to=${email}`)
  } catch (error) {
    logServerError(
      `[EmpresaApproved] fallo al enviar email de aprobación to=${email}: ${error instanceof Error ? error.message : 'unknown_error'}`,
    )
  }
}
