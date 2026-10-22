// Email "tu cupo está disponible" — usa Resend si está configurado, sino solo loguea.
// Failsafe: nunca throw, así no rompe la promotion.

import { Resend } from 'resend'
import { logServerError, logServerInfo } from './safe-log'

type WaitlistPromotedEmail = {
  toEmail: string
  compradorNombre: string
  eventoNombre: string
  categoriaNombre: string
  cantidadSolicitada: number
  checkoutUrl: string
  expiresAt: Date
  empresaNombre: string
  empresaSlug: string
}

export async function sendWaitlistPromotedEmail(payload: WaitlistPromotedEmail): Promise<void> {
  try {
    const apiKey = process.env.RESEND_API_KEY
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? 'noreply@ticketera.com'

    if (!apiKey) {
      logServerInfo(`[Waitlist email skip] RESEND_API_KEY missing — pretend-sending to ${payload.toEmail}`)
      return
    }

    const resend = new Resend(apiKey)
    const minutes = Math.max(1, Math.round((payload.expiresAt.getTime() - Date.now()) / 60000))

    const html = `
      <!DOCTYPE html>
      <html lang="es">
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #0b1724;">
          <div style="text-align: center; padding: 16px 0;">
            <h1 style="color: #1ba8e7; margin: 0 0 8px 0;">🎟️ ¡Hay cupo disponible!</h1>
            <p style="color: #5a6d7e; margin: 0;">Estabas en la lista de espera de <strong>${escapeHtml(payload.eventoNombre)}</strong></p>
          </div>

          <div style="background: #f4f7fa; border-radius: 12px; padding: 20px; margin: 16px 0;">
            <p style="margin: 0 0 8px 0;">Hola <strong>${escapeHtml(payload.compradorNombre)}</strong>,</p>
            <p style="margin: 0 0 16px 0;">
              Se liberó cupo para <strong>${payload.cantidadSolicitada} ${payload.cantidadSolicitada === 1 ? 'entrada' : 'entradas'}</strong>
              en la categoría <strong>${escapeHtml(payload.categoriaNombre)}</strong> del evento <strong>${escapeHtml(payload.eventoNombre)}</strong>.
            </p>
            <p style="margin: 0; color: #b45309;">
              <strong>⏰ Tenés ${minutes} minutos para comprar</strong> antes de que el cupo se ofrezca a la siguiente persona.
            </p>
          </div>

          <div style="text-align: center; padding: 20px 0;">
            <a href="${payload.checkoutUrl}"
               style="display: inline-block; background: #1ba8e7; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600;">
              Completar mi compra
            </a>
          </div>

          <p style="text-align: center; color: #5a6d7e; font-size: 12px; margin-top: 32px;">
            Evento de ${escapeHtml(payload.empresaNombre)}<br>
            Si ya no querés ese cupo, ignorá este email y pasará a la siguiente persona en lista.
          </p>
        </body>
      </html>
    `

    await resend.emails.send({
      from: fromEmail,
      to: payload.toEmail,
      subject: `🎟️ ¡Hay cupo! ${payload.eventoNombre} — tenés ${minutes} min`,
      html,
    })
  } catch (err) {
    // Failsafe: log y seguir
    logServerError('waitlist email send failed', err)
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)
}
