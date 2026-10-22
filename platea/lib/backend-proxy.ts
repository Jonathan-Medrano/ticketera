import { auth } from "@/auth"
import type { Session } from "next-auth"
import { NextRequest, NextResponse } from "next/server"
import { resolveSafeProxyRedirect } from "@/lib/redirect-whitelist"
import { logClientError } from "@/lib/safe-client-log"
import { isMutationMethod, isSameOriginMutationAllowed } from "@/lib/csrf-origin"
import { readBuyerSessionRegistryFromRequest, validateBuyerSessionFreshness } from "@/lib/buyer-session/server"
import type { BuyerSessionUser } from "@/lib/buyer-session/types"
import { buildActorHeaders, isInternalUser, matchTenantSlugFromBackendPath, resolveRequestActorContext } from "@/lib/request-actor"

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001"
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || ""

if (process.env.NODE_ENV === "production" && !INTERNAL_SECRET) {
  throw new Error("[backend-proxy] INTERNAL_API_SECRET no está configurada. Todos los requests BFF fallarán con 401.")
}

interface ProxyOptions {
  requireAuth?: boolean  // default: true
  allowCrossOriginMutation?: boolean
  responseMode?: "json" | "raw"
  extraHeaders?: Record<string, string>
}

type ProxyAuthFn = () => Promise<Session | null>

function resolveClientIp(req: NextRequest) {
  const forwardedFor = req.headers.get("x-forwarded-for")
  if (forwardedFor) {
    const candidate = forwardedFor.split(",")[0]?.trim()
    if (candidate) return candidate
  }

  const realIp = req.headers.get("x-real-ip")
  if (realIp?.trim()) return realIp.trim()

  return null
}

function buildProxyForwardHeaders(options: {
  path: string
  internalUser?: Record<string, unknown> | null
  buyerUser?: BuyerSessionUser | null
  clientIp?: string | null
  clientUserAgent?: string | null
  extraHeaders?: Record<string, string>
}) {
  const { path, internalUser, buyerUser, clientIp, clientUserAgent, extraHeaders } = options

  return {
    "Content-Type": "application/json",
    "x-internal-secret": INTERNAL_SECRET,
    ...buildActorHeaders(resolveRequestActorContext({ path, internalUser, buyerUser })),
    ...(clientIp ? { "x-client-ip": clientIp } : {}),
    ...(clientUserAgent ? { "x-client-user-agent": clientUserAgent } : {}),
    ...(extraHeaders ?? {}),
  }
}

export async function proxyToBackend(
  req: NextRequest,
  path: string,
  options: ProxyOptions = {},
  deps: {
    authFn?: ProxyAuthFn
    readBuyerSessionRegistryFromRequest?: typeof readBuyerSessionRegistryFromRequest
    fetchImpl?: typeof fetch
  } = {}
): Promise<NextResponse> {
  const { requireAuth = true, allowCrossOriginMutation = false, extraHeaders } = options
  const authFn = deps.authFn ?? auth
  const readBuyerRegistry = deps.readBuyerSessionRegistryFromRequest ?? readBuyerSessionRegistryFromRequest
  const fetchImpl = deps.fetchImpl ?? fetch

  const tenantSlug = matchTenantSlugFromBackendPath(path)
  const session = tenantSlug ? null : await authFn()
  const internalUser = isInternalUser(session?.user ?? null) ? session?.user : null
  const rawBuyerUser = tenantSlug ? readBuyerRegistry(req)[tenantSlug] ?? null : null
  const buyerUser = rawBuyerUser ? await validateBuyerSessionFreshness(rawBuyerUser) : null

  if (requireAuth && !session && !buyerUser) {
    return NextResponse.json({ error: "No autorizado" }, { status: 401 })
  }

  if (isMutationMethod(req.method) && !allowCrossOriginMutation) {
    if (!isSameOriginMutationAllowed(req)) {
      return NextResponse.json({ error: "Origen inválido para operación sensible" }, { status: 403 })
    }
  }

  // Construir URL destino con query params
  const url = new URL(path, BACKEND_URL)
  req.nextUrl.searchParams.forEach((value, key) => {
    url.searchParams.set(key, value)
  })

  let body: string | undefined
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      body = await req.text()
    } catch {
      body = undefined
    }
  }

  const clientIp = resolveClientIp(req)
  const clientUserAgent = req.headers.get("user-agent")

  let response: Response
  try {
    response = await fetchImpl(url.toString(), {
      method: req.method,
      headers: buildProxyForwardHeaders({ path, internalUser, buyerUser, clientIp, clientUserAgent, extraHeaders }),
      body,
      // No seguir redirects automáticamente — los reenviamos explícitamente
      redirect: "manual",
    })
  } catch {
    // Error de red (fetch falló): el backend no está disponible
    logClientError(`proxy ${path}`)
    return NextResponse.json({ error: "No se pudo conectar al servidor" }, { status: 502 })
  }

  // Express puede devolver un redirect (ej: confirmar-redirect → tenant frontend)
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get("location")
    if (location) {
      return NextResponse.redirect(resolveSafeProxyRedirect(location, req.nextUrl.origin), response.status)
    }
    return NextResponse.json({ error: "Redirect sin location header" }, { status: 502 })
  }

  if (response.status === 204) {
    return new NextResponse(null, { status: response.status })
  }

  if (options.responseMode === "raw") {
    // Node fetch decomprime automáticamente content-encoding y consume el transfer-encoding
    // chunked. Reenviar esos headers haría que el browser intente decodificar un body ya
    // decodificado (gzip inválido) o calcular un length inexistente. Stripping defensivo.
    const forwardedHeaders = new Headers(response.headers)
    forwardedHeaders.delete("content-encoding")
    forwardedHeaders.delete("content-length")
    forwardedHeaders.delete("transfer-encoding")
    return new NextResponse(response.body, {
      status: response.status,
      headers: forwardedHeaders,
    })
  }

  try {
    const rawBody = await response.text()
    if (!rawBody.trim()) {
      return new NextResponse(null, { status: response.status })
    }

    const data = JSON.parse(rawBody)
    return NextResponse.json(data, { status: response.status })
  } catch {
    // Error de parse: el upstream devolvió HTML (ej: 502 de LB) en vez de JSON.
    // Preservamos el status HTTP real para que el cliente vea el código correcto.
    logClientError(`proxy ${path} (parse error, upstream status=${response.status})`)
    return NextResponse.json({ error: "Error del servidor upstream" }, { status: response.status })
  }
}
