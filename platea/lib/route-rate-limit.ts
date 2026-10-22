import { createHash } from "node:crypto"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/prisma"

// Table managed by prisma/schema.prisma (RateLimitBucket → rate_limit_buckets)
// DDL removed — was inline CREATE TABLE before Phase 2.6 migration.

function getRequestIp(req: NextRequest) {
  const forwarded = req.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown"
  return req.headers.get("x-real-ip") || "unknown"
}

function normalizeValue(value: string | null | undefined) {
  return typeof value === "string" ? value.trim().toLowerCase() : ""
}

function hashIdentifier(value: string) {
  return createHash("sha256").update(value).digest("hex")
}

export function buildRouteRateLimitKey(req: NextRequest, options: LimitOptions) {
  const identifier = normalizeValue(options.identifier)
  if (identifier) {
    return `${options.prefix}:id:${hashIdentifier(identifier)}`
  }

  const ip = getRequestIp(req)
  return `${options.prefix}:ip:${ip}`
}

/**
 * Increment the hit counter for the given bucket key.
 *
 * Uses SERIALIZABLE isolation (Strategy B from design) — appropriate for
 * low-contention rate-limit counters in the frontend where FOR UPDATE via a
 * direct connection is not available (frontend uses pooler port 6543 only).
 *
 * P2034 (serialization failure) is retried up to 3 times with 50 ms backoff.
 */
async function consumeBucket(
  bucketKey: string,
  windowMs: number,
  attempt = 0
): Promise<{ hits: number; resetAtMs: number }> {
  const now = Date.now()
  const nextResetAt = now + windowMs

  try {
    return await prisma.$transaction(
      async (tx) => {
        const current = await tx.rateLimitBucket.findUnique({
          where: { bucket_key: bucketKey },
          select: { hits: true, reset_at_ms: true },
        })

        if (!current || Number(current.reset_at_ms) <= now) {
          // Window expired or bucket doesn't exist — upsert to reset
          await tx.rateLimitBucket.upsert({
            where: { bucket_key: bucketKey },
            create: {
              bucket_key: bucketKey,
              hits: 1,
              reset_at_ms: BigInt(nextResetAt),
            },
            update: {
              hits: 1,
              reset_at_ms: BigInt(nextResetAt),
            },
          })
          return { hits: 1, resetAtMs: nextResetAt }
        }

        const nextHits = Number(current.hits) + 1
        await tx.rateLimitBucket.update({
          where: { bucket_key: bucketKey },
          data: { hits: nextHits },
        })
        return { hits: nextHits, resetAtMs: Number(current.reset_at_ms) }
      },
      { isolationLevel: "Serializable" }
    )
  } catch (error: unknown) {
    // P2034 = serialization failure — retry with backoff (max 3 attempts)
    const isPrismaError = error !== null && typeof error === "object" && "code" in error
    if (isPrismaError && (error as { code: string }).code === "P2034" && attempt < 3) {
      await new Promise((res) => setTimeout(res, 50 * (attempt + 1)))
      return consumeBucket(bucketKey, windowMs, attempt + 1)
    }
    throw error
  }
}

type LimitOptions = {
  prefix: string
  windowMs: number
  max: number
  message: string
  identifier?: string | null
}

export async function enforceRouteRateLimit(req: NextRequest, options: LimitOptions) {
  const key = buildRouteRateLimitKey(req, options)
  const current = await consumeBucket(key, options.windowMs)

  if (current.hits > options.max) {
    return NextResponse.json({ error: options.message }, { status: 429 })
  }
  return null
}

export async function parseCredentialIdentifier(req: NextRequest) {
  const url = req.nextUrl.pathname
  if (!url.includes("/api/auth/callback/credentials")) return null

  try {
    const body = await req.clone().text()
    const params = new URLSearchParams(body)
    return normalizeValue(
      params.get("email")
      ?? params.get("comprador_id")
      ?? params.get("empresa_slug")
      ?? null
    )
  } catch {
    return null
  }
}
