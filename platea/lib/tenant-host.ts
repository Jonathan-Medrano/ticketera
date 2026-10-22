import { headers } from "next/headers"
import { getMainDomainCandidates } from "@/lib/host-domains"

const INTERNAL_APP_ROUTES = ["/dashboard", "/revendedor", "/super-admin", "/login", "/auth", "/sin-acceso"]

export function resolveTenantSlugFromHost(hostHeader: string, candidateRootDomains = getMainDomainCandidates()) {
  const hostname = hostHeader.split(":")[0]
  if (!hostname) return null

  const matchedRoot = candidateRootDomains.find(
    (domain) => hostname === domain || hostname === `www.${domain}` || hostname.endsWith(`.${domain}`)
  )

  const isMainDomain =
    candidateRootDomains.includes(hostname) ||
    candidateRootDomains.some((domain) => hostname === `www.${domain}`)

  if (isMainDomain || !matchedRoot) return null
  return hostname.replace(`.${matchedRoot}`, "") || null
}

export function resolveTenantSurface(pathname: string, hostHeader: string, candidateRootDomains = getMainDomainCandidates()) {
  const pathMatch = pathname.match(/^\/t\/([^/]+)/)
  if (pathMatch?.[1]) {
    return { surface: "tenant" as const, tenantSlug: pathMatch[1], origin: "path" as const }
  }

  const tenantSlug = resolveTenantSlugFromHost(hostHeader, candidateRootDomains)
  if (!tenantSlug) {
    return { surface: "internal" as const, tenantSlug: null, origin: "none" as const }
  }

  const isInternalPath = INTERNAL_APP_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))
  return { surface: isInternalPath ? "internal" as const : "tenant" as const, tenantSlug, origin: "host" as const }
}

export async function resolveTenantFromHost() {
  const headersList = await headers()
  const hostHeader = headersList.get("x-forwarded-host") || headersList.get("host") || ""
  return resolveTenantSlugFromHost(hostHeader)
}
