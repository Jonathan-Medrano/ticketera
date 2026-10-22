import { createHash } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'
import { logServerError } from './safe-log'
import { maybeSendErrorAlert } from './error-alert'

export type ErrorLogSource = 'backend' | 'frontend'
export type ErrorLogSeverity = 'error' | 'fatal' | 'warn'

export type CaptureErrorParams = {
  source: ErrorLogSource
  severity?: ErrorLogSeverity
  message: string
  stack?: string | null
  context?: Record<string, unknown> | null
  userAgent?: string | null
  ipAddress?: string | null
}

// Normalize a stack trace so the same error in different requests produces
// the same fingerprint. Strips line/column numbers (which can drift across
// builds), file path prefixes, and timestamps; keeps function names and
// relative file paths.
function normalizeStackForFingerprint(stack: string | null | undefined): string {
  if (!stack) return ''
  return stack
    .split('\n')
    .slice(0, 8) // first 8 frames is enough to identify the error site
    .map((line) =>
      line
        .replace(/:\d+:\d+/g, '') // strip :line:col
        .replace(/\(.*?node_modules\//g, '(.../') // collapse node_modules paths
        .replace(/file:\/\/\/[A-Za-z]:/g, '') // strip windows file:// roots
        .replace(/\/[A-Za-z0-9_.-]+\/(src|dist)\//, '/<app>/$1/') // collapse cwd
        .trim(),
    )
    .filter(Boolean)
    .join('\n')
}

export function computeErrorFingerprint(params: { source: ErrorLogSource; message: string; stack?: string | null }) {
  const stable = `${params.source}|${(params.message ?? '').slice(0, 500)}|${normalizeStackForFingerprint(params.stack)}`
  return createHash('sha256').update(stable).digest('hex')
}

const FORBIDDEN_CONTEXT_KEYS = new Set<string>([
  'token',
  'access_token',
  'refresh_token',
  'secret',
  'password',
  'credential',
  'authorization',
  'apikey',
  'api_key',
  'private_key',
  'card',
  'cvv',
  'signature',
])

function sanitizeContext(input: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (!input || typeof input !== 'object') return null
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    const k = key.toLowerCase()
    if (FORBIDDEN_CONTEXT_KEYS.has(k) || k.includes('token') || k.includes('secret') || k.includes('password')) {
      out[key] = '[REDACTED]'
      continue
    }
    if (typeof value === 'string' && value.length > 2000) {
      out[key] = `${value.slice(0, 2000)}…[truncated ${value.length - 2000}]`
      continue
    }
    out[key] = value
  }
  return out
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null
  if (value.length <= max) return value
  return `${value.slice(0, max)}…[truncated ${value.length - max}]`
}

/**
 * Persist an error in the error_logs table, deduplicating by fingerprint.
 *
 * Failsafe: this function MUST NOT throw. If the DB is down or another error
 * occurs while writing, we fall back to stdout via logServerError so the
 * original error is never lost.
 */
export async function captureError(params: CaptureErrorParams): Promise<void> {
  try {
    const severity = params.severity ?? 'error'
    const message = (params.message ?? '').trim() || 'unknown'
    const truncatedMessage = truncate(message, 2000) ?? 'unknown'
    const truncatedStack = truncate(params.stack ?? null, 10000)
    const sanitizedContext = sanitizeContext(params.context)
    const contextInput = sanitizedContext === null ? Prisma.JsonNull : (sanitizedContext as Prisma.InputJsonValue)
    const fingerprint = computeErrorFingerprint({ source: params.source, message, stack: truncatedStack })
    const now = new Date()

    const row = await prisma.errorLog.upsert({
      where: { fingerprint },
      create: {
        fingerprint,
        source: params.source,
        severity,
        message: truncatedMessage,
        stack: truncatedStack,
        context: contextInput,
        user_agent: truncate(params.userAgent ?? null, 500),
        ip_address: truncate(params.ipAddress ?? null, 45),
        count_total: 1,
        first_seen_at: now,
        last_seen_at: now,
      },
      update: {
        // On dedupe: bump count, refresh last_seen, refresh context with the latest
        // (so the dashboard shows the most recent request/url that hit this error).
        count_total: { increment: 1 },
        last_seen_at: now,
        severity,
        context: contextInput,
        user_agent: truncate(params.userAgent ?? null, 500),
        ip_address: truncate(params.ipAddress ?? null, 45),
        // If the error was previously marked resolved but it's happening again,
        // un-resolve it so it's surfaced in the dashboard.
        resolved_at: null,
        resolved_by: null,
      },
    })

    // Side-effect fire-and-forget: alerta por email al super-admin si corresponde
    // (severidad + cooldown anti-spam). maybeSendErrorAlert captura sus propios
    // errores; el .catch es defensa extra para que jamás afecte a captureError.
    void maybeSendErrorAlert(row).catch((alertErr) =>
      logServerError('error alert dispatch failed', alertErr),
    )
  } catch (writeError) {
    logServerError('captureError failed (falling back to stdout)', writeError)
    logServerError(`original error [${params.source}/${params.severity ?? 'error'}]: ${params.message}`, params.stack)
  }
}
