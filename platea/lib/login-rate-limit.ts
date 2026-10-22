import { createHash } from "node:crypto"
import { Prisma } from "@prisma/client"
import { prisma } from "./prisma"

// Persistent login rate limiter — Postgres-backed (rate_limit_buckets, shared table
// with the backend's equivalent system in backend/src/lib/persistent-rate-limit.ts).
// Replaces the previous in-process Node.js Map in auth.ts: that Map reset on every
// server restart/redeploy and gave each Vercel instance its own independent counter,
// so an attacker could multiply the effective cap by however many instances were
// warm — a real bypass, not a theoretical one, flagged by the file's own comment.
//
// Deliberately does NOT reuse backend/src/lib/persistent-rate-limit.ts's approach
// (SELECT ... FOR UPDATE inside an explicit transaction): platea/lib/prisma.ts only
// exposes the Supabase POOLER client (PgBouncer transaction mode) by design — the
// frontend must never hold row locks across statements, that's reserved for the
// backend's direct-connection client. Instead this uses a single atomic
// `INSERT ... ON CONFLICT DO UPDATE` statement, which Postgres guarantees is
// race-free on its own without an explicit lock, so it's safe over the pooler.
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000 // 15 min
const LOGIN_RATE_LIMIT_MAX_ATTEMPTS = 5

// hashIdentifier — NOT optional hardening, this is load-bearing. bucket_key is
// VARCHAR(191); the raw ip param here ultimately comes from the client-controlled
// x-forwarded-for/x-real-ip headers (see auth.ts). Without normalizing it first, a
// single request with an oversized header (no need to even look like an IP) throws a
// Postgres "value too long" error on every attempt — which used to fail the whole
// check open unconditionally, a trivial total bypass of the very limiter this file
// exists to enforce (found by ticketera-security before this ever shipped). Hashing
// guarantees a fixed 64-char output regardless of what the caller sends.
function hashIdentifier(value: string): string {
  return createHash("sha256").update(value).digest("hex")
}

export async function checkLoginRateLimit(ip: string): Promise<boolean> {
  const bucketKey = `frontend-login:ip:${hashIdentifier(ip || "unknown")}`
  const now = BigInt(Date.now())
  const nextResetAt = now + BigInt(LOGIN_RATE_LIMIT_WINDOW_MS)

  try {
    const rows = await prisma.$queryRaw<Array<{ hits: number }>>`
      INSERT INTO rate_limit_buckets (bucket_key, hits, reset_at_ms, updated_at)
      VALUES (${bucketKey}, 1, ${nextResetAt}, NOW())
      ON CONFLICT (bucket_key) DO UPDATE SET
        hits = CASE WHEN rate_limit_buckets.reset_at_ms <= ${now} THEN 1 ELSE rate_limit_buckets.hits + 1 END,
        reset_at_ms = CASE WHEN rate_limit_buckets.reset_at_ms <= ${now} THEN ${nextResetAt} ELSE rate_limit_buckets.reset_at_ms END,
        updated_at = NOW()
      RETURNING hits
    `
    const hits = Number(rows[0]?.hits ?? 1)
    return hits <= LOGIN_RATE_LIMIT_MAX_ATTEMPTS
  } catch (err) {
    // The catch MUST distinguish error shape, not fail open unconditionally (that was
    // the actual vulnerability flagged in review, not just the VARCHAR length itself —
    // hashing fixes the length, but an indiscriminate catch would still fail open on
    // any future data/query-shape bug, which is itself a bypass surface).
    //
    // PrismaClientKnownRequestError = the query executed and Postgres rejected it
    // (constraint violation, bad type, etc.) — that's a bug or a crafted attack input,
    // not a hiccup, so fail CLOSED (block this attempt).
    //
    // Anything else (PrismaClientInitializationError, connection refused/timeout, DB
    // genuinely unreachable) is real infra trouble — fail OPEN so a database blip can't
    // lock every user out of login, the platform's single most critical path. Note this
    // is not the only control: the backend's own rate-limited routes and Google OAuth
    // login are unaffected either way.
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      console.error("[login-rate-limit] query rejected by Postgres, failing closed:", err)
      return false
    }
    console.error("[login-rate-limit] infra error, failing open:", err)
    return true
  }
}
