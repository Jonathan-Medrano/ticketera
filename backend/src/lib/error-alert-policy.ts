// Política PURA de despacho de alertas de error: decide SI corresponde alertar,
// sin tocar DB, Resend ni env. Aislada acá para poder testearla sin infra.
//
// Reglas (definidas con el usuario):
//   - Solo severidad 'error' / 'fatal' (los 'warn' quedan solo en el log).
//   - Anti-spam: alerta la 1ra vez de cada error (count_total === 1) y, si se
//     repite, re-alerta como mucho una vez por ventana de cooldown.

export const ALERT_SEVERITIES = new Set<string>(['error', 'fatal'])

export function isAlertSeverity(severity: string): boolean {
  return ALERT_SEVERITIES.has(severity)
}

export type AlertDecisionInput = {
  /** ERROR_ALERTS_ENABLED — master switch. */
  enabled: boolean
  severity: string
  /** error_logs.count_total: 1 = primera aparición de este fingerprint. */
  countTotal: number
  /** error_logs.last_alerted_at en ms, o null si nunca se alertó. */
  lastAlertedAtMs: number | null
  nowMs: number
  cooldownMs: number
}

export function shouldSendAlert(input: AlertDecisionInput): boolean {
  if (!input.enabled) return false
  if (!isAlertSeverity(input.severity)) return false
  // Error nuevo → siempre alerta.
  if (input.countTotal === 1) return true
  // Error recurrente que nunca alertó → alerta (ej. existía antes del feature).
  if (input.lastAlertedAtMs === null) return true
  // Recurrente: re-alerta solo si pasó el cooldown (estricto: en el borde, no).
  return input.nowMs - input.lastAlertedAtMs > input.cooldownMs
}
