import { NextRequest, NextResponse } from "next/server"
import { authenticateBuyerByCredentials, authenticateBuyerByToken } from "@/lib/buyer-auth"
import { clearBuyerSession, readBuyerSessionRegistryFromRequest, writeBuyerSession } from "@/lib/buyer-session/server"
import { isSameOriginMutationAllowed } from "@/lib/csrf-origin"

export const runtime = "nodejs"

const PRIVATE_IP_RE = /^(127\.|10\.|172\.(1[6-9]|2\d|3[01])\.|192\.168\.|::1$|fc|fd)/i

function extractTrustedIp(request: NextRequest): string {
  const realIp = request.headers.get("x-real-ip")?.trim()
  if (realIp) return realIp

  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) {
    const parts = forwarded.split(",").map((p) => p.trim()).filter(Boolean)
    const lastPublic = [...parts].reverse().find((p) => !PRIVATE_IP_RE.test(p))
    if (lastPublic) return lastPublic
  }

  return "unknown"
}

// NOTE: This rate limiter is in-process (Node.js Map).
// In a multi-instance deployment (Vercel, ECS, autoscaler) each instance has
// its own counter, so an attacker can multiply the effective cap by N instances.
// For a single-instance MVP this is acceptable, but post-MVP this should be
// moved to a shared store (Redis, or the backend's persistent-rate-limit system).
// Conservative cap (5 attempts / 15 min) to reduce the horizontal-bypass window.
const _rl = new Map<string, { count: number; resetAt: number }>()
function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const window = 15 * 60 * 1000 // 15 min (was 10 min)
  const entry = _rl.get(ip)
  if (!entry || now > entry.resetAt) {
    _rl.set(ip, { count: 1, resetAt: now + window })
    return true
  }
  if (entry.count >= 5) return false // 5 attempts (was 15)
  entry.count++
  return true
}

export async function GET(request: NextRequest) {
  const tenantSlug = request.nextUrl.searchParams.get("tenant")?.trim()
  if (!tenantSlug) return NextResponse.json({ error: "tenant es requerido" }, { status: 400 })
  const registry = readBuyerSessionRegistryFromRequest(request)
  const rawUser = registry[tenantSlug] ?? null
  if (rawUser === null) return NextResponse.json({ user: null })
  const { passwordVersion: _, ...safeUser } = rawUser
  return NextResponse.json({ user: safeUser })
}

export async function POST(request: NextRequest) {
  if (!isSameOriginMutationAllowed(request)) {
    return NextResponse.json({ error: "Origen inválido para operación sensible" }, { status: 403 })
  }
  const ip = extractTrustedIp(request)
  if (!checkRateLimit(ip)) {
    return NextResponse.json({ error: "Demasiados intentos, esperá unos minutos" }, { status: 429 })
  }

  const body = await request.json().catch(() => null) as { tenantSlug?: string; mode?: string; email?: string; password?: string; token?: string } | null
  const tenantSlug = body?.tenantSlug?.trim()
  if (!tenantSlug) return NextResponse.json({ error: "tenantSlug es requerido" }, { status: 400 })

  const user = body?.mode === "token" && body.token
    ? await authenticateBuyerByToken(body.token, tenantSlug)
    : body?.mode === "password" && body.email && body.password
      ? await authenticateBuyerByCredentials(body.email, body.password, tenantSlug)
      : null

  if (!user) {
    return NextResponse.json({ error: body?.mode === "token" ? "Token inválido o expirado" : "Email o contraseña incorrectos" }, { status: 401 })
  }

  const response = NextResponse.json({ user })
  writeBuyerSession(response, readBuyerSessionRegistryFromRequest(request), tenantSlug, user)
  return response
}

export async function DELETE(request: NextRequest) {
  if (!isSameOriginMutationAllowed(request)) {
    return NextResponse.json({ error: "Origen inválido para operación sensible" }, { status: 403 })
  }

  const tenantSlug = request.nextUrl.searchParams.get("tenant")?.trim()
  if (!tenantSlug) return NextResponse.json({ error: "tenant es requerido" }, { status: 400 })

  const response = NextResponse.json({ ok: true })
  clearBuyerSession(response, readBuyerSessionRegistryFromRequest(request), tenantSlug)
  return response
}
