import { Resend } from 'resend'
import type { ErrorLog } from '@prisma/client'
import { prisma } from './prisma'
import { logServerError } from './safe-log'
import { logAuditEvent } from './audit-log'
import { shouldSendAlert } from './error-alert-policy'

/**
 * Alertas de errores por email al super-admin (y a las cuentas platform_staff
 * que tengan la capability `platform.alerts.receive`).
 *
 * Reglas (definidas con el usuario):
 *   - Solo severidad 'error' / 'fatal' (los 'warn' quedan solo en el log).
 *   - Anti-spam: alertamos la PRIMERA vez que aparece cada error distinto
 *     (fingerprint, count_total === 1) y, si se repite, re-alertamos como mucho
 *     una vez por ventana de cooldown (`last_alerted_at`).
 *   - Fail-safe: NUNCA tira ni bloquea el flujo. Es un side-effect.
 */

const ALERT_CAPABILITY = 'platform.alerts.receive'
const DEFAULT_COOLDOWN_MINUTES = 30

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

function alertsEnabled(): boolean {
  return (process.env.ERROR_ALERTS_ENABLED ?? 'true').toLowerCase() !== 'false'
}

function getFromEmail(): string | null {
  const from = process.env.RESEND_FROM_EMAIL?.trim()
  if (from) return from
  return process.env.NODE_ENV === 'production' ? null : 'onboarding@resend.dev'
}

function cooldownMs(): number {
  const min = Number(process.env.ERROR_ALERT_COOLDOWN_MINUTES)
  return (Number.isFinite(min) && min > 0 ? min : DEFAULT_COOLDOWN_MINUTES) * 60_000
}

function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

async function resolveRecipients(): Promise<string[]> {
  // super_admin (singleton) siempre + staff con la capability otorgada.
  const rows = await prisma.$queryRaw<{ email: string }[]>`
    SELECT DISTINCT u.email
    FROM platform_admin_users u
    WHERE u.activo = true
      AND u.email IS NOT NULL
      AND (
        u.singleton_key = 'superadmin'
        OR EXISTS (
          SELECT 1 FROM platform_admin_capability_grants g
          WHERE g.platform_admin_user_id = u.id
            AND g.capability_key = ${ALERT_CAPABILITY}
        )
      )
  `
  return rows.map((r) => r.email).filter(Boolean)
}

function buildHtml(row: ErrorLog): string {
  const consoleBase = process.env.PLATFORM_CONSOLE_URL?.trim().replace(/\/$/, '')
  const link = consoleBase ? `${consoleBase}/super-admin/logs` : null
  const tone = row.severity === 'fatal' ? '#dc2626' : '#d97706'
  const stackFrames = (row.stack ?? '').split('\n').slice(0, 12).map(escapeHtml).join('<br>')
  const contextStr = row.context ? escapeHtml(JSON.stringify(row.context, null, 2)) : null

  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;max-width:640px;margin:0 auto;color:#0f172a">
      <div style="border-left:4px solid ${tone};padding:12px 16px;background:#f8fafc;border-radius:8px">
        <p style="margin:0;font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:${tone};font-weight:700">
          Error ${escapeHtml(row.severity)} · ${escapeHtml(row.source)}
        </p>
        <p style="margin:6px 0 0;font-size:16px;font-weight:600">${escapeHtml(row.message)}</p>
      </div>
      <table style="width:100%;margin-top:16px;font-size:13px;border-collapse:collapse">
        <tr><td style="padding:4px 0;color:#64748b">Veces (total)</td><td style="text-align:right;font-weight:600">${row.count_total}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b">Primera vez</td><td style="text-align:right">${escapeHtml(row.first_seen_at?.toISOString?.() ?? row.first_seen_at)}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b">Última vez</td><td style="text-align:right">${escapeHtml(row.last_seen_at?.toISOString?.() ?? row.last_seen_at)}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b">Fingerprint</td><td style="text-align:right;font-family:monospace;font-size:11px">${escapeHtml(row.fingerprint.slice(0, 16))}…</td></tr>
      </table>
      ${stackFrames ? `<p style="margin:16px 0 4px;font-size:12px;font-weight:600;color:#64748b">Stack</p>
      <pre style="font-size:11px;background:#0f172a;color:#e2e8f0;padding:12px;border-radius:8px;overflow:auto;white-space:pre-wrap">${stackFrames}</pre>` : ''}
      ${contextStr ? `<p style="margin:16px 0 4px;font-size:12px;font-weight:600;color:#64748b">Contexto</p>
      <pre style="font-size:11px;background:#f1f5f9;padding:12px;border-radius:8px;overflow:auto;white-space:pre-wrap">${contextStr}</pre>` : ''}
      ${link ? `<p style="margin-top:20px"><a href="${escapeHtml(link)}" style="background:#0052cc;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px">Ver en la consola</a></p>` : ''}
      <p style="margin-top:20px;font-size:11px;color:#94a3b8">TICKETERA · Alerta automática de errores. Recibís esto porque tenés la capability "Recibir alertas de errores".</p>
    </div>
  `
}

/**
 * Despacha (si corresponde) una alerta por email para un error recién capturado.
 * `row` es la fila de error_logs devuelta por el upsert de captureError.
 * Pensada para llamarse fire-and-forget; captura todos sus errores internamente.
 */
export async function maybeSendErrorAlert(row: ErrorLog): Promise<void> {
  try {
    if (!resend) return

    const isNew = row.count_total === 1
    const shouldAlert = shouldSendAlert({
      enabled: alertsEnabled(),
      severity: row.severity,
      countTotal: row.count_total,
      lastAlertedAtMs: row.last_alerted_at ? row.last_alerted_at.getTime() : null,
      nowMs: Date.now(),
      cooldownMs: cooldownMs(),
    })
    if (!shouldAlert) return

    const from = getFromEmail()
    if (!from) return

    const recipients = await resolveRecipients()
    if (recipients.length === 0) return

    // Marcamos last_alerted_at ANTES de enviar: bajo capturas concurrentes del
    // mismo error, evita despachos duplicados (el cooldown ya aplica). El error
    // queda igual en el log si el envío falla.
    await prisma.errorLog.update({ where: { id: row.id }, data: { last_alerted_at: new Date() } })

    await resend.emails.send({
      from,
      to: recipients,
      subject: `[TICKETERA] ⚠ Error ${row.severity} en ${row.source}: ${row.message.slice(0, 80)}`,
      html: buildHtml(row),
    })

    await logAuditEvent({
      actor: { id: null, email: null, label: 'error-alert', type: 'system' },
      action: 'platform.error_alert_sent',
      entityType: 'error_log',
      entityId: row.fingerprint,
      payload: {
        severity: row.severity,
        source: row.source,
        count_total: row.count_total,
        is_new: isNew,
        recipients: recipients.length,
      },
    })
  } catch (err) {
    logServerError('maybeSendErrorAlert failed', err)
  }
}
