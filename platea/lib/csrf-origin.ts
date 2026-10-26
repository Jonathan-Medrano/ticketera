import type { NextRequest } from "next/server"

function normalizeOrigin(origin: string) {
  return origin.trim().replace(/\/$/, "")
}

function resolveExternalRequestOrigin(req: Pick<NextRequest, "headers" | "nextUrl">) {
  const forwardedProto = req.headers.get("x-forwarded-proto")?.trim()
  const forwardedHost = req.headers.get("x-forwarded-host")?.trim() || req.headers.get("host")?.trim()

  if (forwardedProto && forwardedHost) {
    return normalizeOrigin(`${forwardedProto}://${forwardedHost}`)
  }

  return normalizeOrigin(req.nextUrl.origin)
}

function getLocalCandidateDomains() {
  const rootDomainRaw = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "Ticketera.local:3000"
  const rootDomain = rootDomainRaw.split(":")[0]

  return Array.from(new Set([rootDomain, "Ticketera.local", "localhost", "127.0.0.1"]))
}

function isLocalEquivalentHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase()
  return getLocalCandidateDomains().some((domain) => normalized === domain || normalized.endsWith(`.${domain}`))
}

function isAllowedLocalDevOrigin(origin: string, targetOrigin: string) {
  if (process.env.NODE_ENV === "production") return false

  try {
    const source = new URL(origin)
    const target = new URL(targetOrigin)

    const samePort = (source.port || (source.protocol === "https:" ? "443" : "80")) === (target.port || (target.protocol === "https:" ? "443" : "80"))
    if (!samePort) return false

    return isLocalEquivalentHostname(source.hostname) && isLocalEquivalentHostname(target.hostname)
  } catch {
    return false
  }
}

export function isMutationMethod(method: string) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase())
}

export function isSameOriginMutationAllowed(req: Pick<NextRequest, "method" | "headers" | "nextUrl">) {
  if (!isMutationMethod(req.method)) return true

  const origin = req.headers.get("origin")
  if (!origin) return false

  const normalizedOrigin = normalizeOrigin(origin)
  const normalizedTarget = resolveExternalRequestOrigin(req)

  return normalizedOrigin === normalizedTarget || isAllowedLocalDevOrigin(normalizedOrigin, normalizedTarget)
}
