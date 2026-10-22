const TENANT_REDIRECT_WHITELIST = new Set([
  "/checkout",
  "/consumibles/checkout",
  "/mis-tickets",
  "/configuracion",
])

export function resolveSafeTenantRedirect(input?: string | null) {
  if (!input) return "/"

  const normalized = input.startsWith("/") ? input : `/${input}`

  if (TENANT_REDIRECT_WHITELIST.has(normalized)) {
    return normalized
  }

  return "/"
}

function normalizeOrigin(origin: string) {
  return origin.trim().replace(/\/$/, "")
}

function resolveConfiguredAppOrigins() {
  return [process.env.NEXT_PUBLIC_APP_URL]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => new URL(normalizeOrigin(value)).origin)
}

function resolveTenantRootDomain() {
  const rootDomain = process.env.NEXT_PUBLIC_ROOT_DOMAIN?.trim()
  if (!rootDomain) return null

  const protocol = rootDomain.includes("localhost") || rootDomain.includes("Ticketera.local") ? "http" : "https"
  return new URL(`${protocol}://${rootDomain}`)
}

export function resolveSafeProxyRedirect(location: string, requestOrigin: string) {
  if (location.startsWith("/")) {
    return location
  }

  try {
    const target = new URL(location)
    const allowedOrigins = new Set([normalizeOrigin(requestOrigin), ...resolveConfiguredAppOrigins()])

    if (allowedOrigins.has(normalizeOrigin(target.origin))) {
      return target.toString()
    }

    const tenantRoot = resolveTenantRootDomain()
    if (tenantRoot) {
      const sameRootHost = target.hostname === tenantRoot.hostname || target.hostname.endsWith(`.${tenantRoot.hostname}`)
      const samePort = (target.port || "") === (tenantRoot.port || "")
      const sameProtocol = target.protocol === tenantRoot.protocol

      if (sameRootHost && samePort && sameProtocol) {
        return target.toString()
      }
    }
  } catch {
    return "/"
  }

  return "/"
}
