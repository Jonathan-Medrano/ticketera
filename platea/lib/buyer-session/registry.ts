import { createHmac, timingSafeEqual } from "node:crypto"
import type { BuyerSessionRegistry, BuyerSessionUser } from "@/lib/buyer-session/types"

export const BUYER_SESSION_COOKIE_NAME = "platea_buyer_sessions"

const _buyerSessionSecret = (() => {
  const secret = process.env.BUYER_SESSION_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET
  if (!secret) throw new Error("BUYER_SESSION_SECRET (or AUTH_SECRET / NEXTAUTH_SECRET) is required")
  return secret
})()

function getBuyerSessionSecret() {
  return _buyerSessionSecret
}

function sign(payload: string) {
  return createHmac("sha256", getBuyerSessionSecret()).update(payload).digest("base64url")
}

function normalizeBuyerSessionUser(value: unknown): BuyerSessionUser | null {
  if (!value || typeof value !== "object") return null
  const user = value as Record<string, unknown>

  if (
    typeof user.id !== "string"
    || typeof user.email !== "string"
    || typeof user.name !== "string"
    || user.userType !== "comprador"
    || typeof user.empresa_id !== "string"
    || typeof user.empresa_slug !== "string"
  ) {
    return null
  }

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    userType: "comprador",
    empresa_id: user.empresa_id,
    empresa_slug: user.empresa_slug,
    passwordVersion: typeof user.passwordVersion === "number" && Number.isFinite(user.passwordVersion)
      ? user.passwordVersion
      : null,
    mustChangePassword: user.mustChangePassword === true,
  }
}

export function normalizeBuyerSessionRegistry(input: unknown): BuyerSessionRegistry {
  if (!input || typeof input !== "object") return {}

  const registry: BuyerSessionRegistry = {}
  for (const [tenantSlug, rawUser] of Object.entries(input as Record<string, unknown>)) {
    const normalizedUser = normalizeBuyerSessionUser(rawUser)
    if (!tenantSlug || !normalizedUser) continue
    registry[tenantSlug] = normalizedUser
  }
  return registry
}

export function serializeBuyerSessionRegistry(registry: BuyerSessionRegistry) {
  const payload = Buffer.from(JSON.stringify(normalizeBuyerSessionRegistry(registry)), "utf8").toString("base64url")
  return `${payload}.${sign(payload)}`
}

export function parseBuyerSessionRegistry(cookieValue: string | null | undefined): BuyerSessionRegistry {
  if (!cookieValue) return {}
  const [payload, signature] = cookieValue.split(".")
  if (!payload || !signature) return {}

  const actualBuffer = Buffer.from(signature)
  const expectedBuffer = Buffer.from(sign(payload))
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    return {}
  }

  try {
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as unknown
    return normalizeBuyerSessionRegistry(decoded)
  } catch {
    return {}
  }
}

export function upsertBuyerSession(registry: BuyerSessionRegistry, tenantSlug: string, user: BuyerSessionUser): BuyerSessionRegistry {
  return { ...normalizeBuyerSessionRegistry(registry), [tenantSlug]: user }
}

export function removeBuyerSession(registry: BuyerSessionRegistry, tenantSlug: string): BuyerSessionRegistry {
  const next = { ...normalizeBuyerSessionRegistry(registry) }
  delete next[tenantSlug]
  return next
}

export function getBuyerSessionForTenant(registry: BuyerSessionRegistry, tenantSlug: string) {
  return normalizeBuyerSessionRegistry(registry)[tenantSlug] ?? null
}
