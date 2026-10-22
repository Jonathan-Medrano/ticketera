import crypto from 'crypto'
import type { Request, Response, NextFunction } from 'express'
import { prismaDirectUrl } from './prisma'
import { getRequestIp } from '../middleware/auth'
import { logServerError, logServerWarn } from './safe-log'

type RateLimitState = {
  hits: number
  resetAtMs: bigint
}

function normalizeValue(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase() : ''
}

function hashIdentifier(value: string) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function buildBucketKey(prefix: string, req: Request, identifier?: string | null) {
  const scopedIdentifier = normalizeValue(identifier)
  if (scopedIdentifier) {
    return `${prefix}:id:${hashIdentifier(scopedIdentifier)}`
  }

  const ip = getRequestIp(req) || req.ip || 'unknown'
  return `${prefix}:ip:${ip}`
}

async function consumeBucket(bucketKey: string, windowMs: number): Promise<{ hits: number; resetAtMs: number }> {
  const now = BigInt(Date.now())
  const nextResetAt = now + BigInt(windowMs)

  type RowResult = { bucket_key: string; hits: number; reset_at_ms: bigint }[]

  let result: { hits: number; resetAtMs: number } | null = null

  await prismaDirectUrl.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<RowResult>`
      SELECT bucket_key, hits, reset_at_ms
      FROM rate_limit_buckets
      WHERE bucket_key = ${bucketKey}
      FOR UPDATE`

    const current = rows[0]

    if (!current || current.reset_at_ms <= now) {
      // updated_at es NOT NULL sin default — pasarlo explícito (Postgres no tiene ON UPDATE CURRENT_TIMESTAMP).
      await tx.$executeRaw`
        INSERT INTO rate_limit_buckets (bucket_key, hits, reset_at_ms, updated_at)
        VALUES (${bucketKey}, 1, ${nextResetAt}, NOW())
        ON CONFLICT (bucket_key)
        DO UPDATE SET hits = 1, reset_at_ms = ${nextResetAt}, updated_at = NOW()`

      result = { hits: 1, resetAtMs: Number(nextResetAt) }
      return
    }

    const nextHits = Number(current.hits) + 1
    await tx.$executeRaw`
      UPDATE rate_limit_buckets
      SET hits = ${nextHits}, reset_at_ms = ${current.reset_at_ms}, updated_at = NOW()
      WHERE bucket_key = ${bucketKey}`

    result = { hits: nextHits, resetAtMs: Number(current.reset_at_ms) }
  })

  return result!
}

type PersistentRateLimitOptions = {
  prefix: string
  windowMs: number
  max: number
  message: { error: string }
  getIdentifier?: (req: Request) => string | null | undefined
}

export function createPersistentRateLimit(options: PersistentRateLimitOptions) {
  const { prefix, windowMs, max, message, getIdentifier } = options

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const bucketKey = buildBucketKey(prefix, req, getIdentifier?.(req))
      const state = await consumeBucket(bucketKey, windowMs)

      if (state.hits > max) {
        logServerWarn(`[RateLimit] ${prefix}`)
        res.setHeader('Retry-After', Math.max(1, Math.ceil((state.resetAtMs - Date.now()) / 1000)).toString())
        return res.status(429).json(message)
      }

      return next()
    } catch (err) {
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
      logServerError(`persistent rate limit ${prefix} — ${detail}`)
      return res.status(500).json({ error: 'No se pudo validar el límite de intentos' })
    }
  }
}
