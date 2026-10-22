import { getCachedSession } from "@/lib/dashboard-auth"
import { getBuyerSessionForTenantSlug } from "@/lib/buyer-session/server"
import type { BuyerSessionUser } from "@/lib/buyer-session/types"
import { buildActorHeaders, isInternalUser, resolveRequestActorContext } from "@/lib/request-actor"

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001"
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || ""

if (process.env.NODE_ENV === "production" && !INTERNAL_SECRET) {
  throw new Error("[server-backend] INTERNAL_API_SECRET no está configurada. Todos los requests internos fallarán con 401.")
}

type ApiErrorPayload = {
  error?: string
}

type PublicBackendFetchOptions = {
  cache?: "force-cache" | "no-store"
  revalidate?: number | false
  tags?: string[]
}

function buildServerBackendHeaders(path: string, internalUser?: Record<string, unknown> | null, buyerUser?: BuyerSessionUser | null) {
  return {
    "Content-Type": "application/json",
    "x-internal-secret": INTERNAL_SECRET,
    ...buildActorHeaders(resolveRequestActorContext({ path, internalUser, buyerUser })),
  }
}

export async function fetchBackendFromServer<T>(
  path: string,
  deps: {
    getCachedSession?: typeof getCachedSession
    fetchImpl?: typeof fetch
    revalidate?: number
  } = {}
): Promise<T> {
  const session = await (deps.getCachedSession ?? getCachedSession)()
  const fetchImpl = deps.fetchImpl ?? fetch

  if (!session) {
    throw new Error("No autorizado")
  }

  let response: Response

  try {
    response = await fetchImpl(new URL(path, BACKEND_URL), {
      method: "GET",
      headers: buildServerBackendHeaders(path, isInternalUser(session.user) ? session.user : null),
      ...(typeof deps.revalidate === "number"
        ? { next: { revalidate: deps.revalidate } }
        : { cache: "no-store" }),
    })
  } catch {
    throw new Error(`No se pudo conectar con el backend (${BACKEND_URL})`)
  }

  const payload = (await response.json()) as T | ApiErrorPayload

  if (!response.ok) {
    throw new Error((payload as ApiErrorPayload)?.error ?? "Error inesperado de API")
  }

  return payload as T
}

export async function fetchTenantBackendFromServer<T>(
  path: string,
  tenantSlug: string,
  deps: {
    getBuyerSessionForTenantSlug?: typeof getBuyerSessionForTenantSlug
    fetchImpl?: typeof fetch
  } = {}
): Promise<T> {
  const buyerSession = await (deps.getBuyerSessionForTenantSlug ?? getBuyerSessionForTenantSlug)(tenantSlug)
  const fetchImpl = deps.fetchImpl ?? fetch

  let response: Response

  try {
    response = await fetchImpl(new URL(path, BACKEND_URL), {
      method: "GET",
      headers: buildServerBackendHeaders(path, null, buyerSession),
      cache: "no-store",
    })
  } catch {
    throw new Error(`No se pudo conectar con el backend (${BACKEND_URL})`)
  }

  const payload = (await response.json()) as T | ApiErrorPayload

  if (!response.ok) {
    throw new Error((payload as ApiErrorPayload)?.error ?? "Error inesperado de API")
  }

  return payload as T
}

export async function fetchPublicBackendFromServer<T>(
  path: string,
  options: PublicBackendFetchOptions = {}
): Promise<T> {
  const { cache, revalidate, tags } = options

  let response: Response

  const next: { revalidate?: number | false; tags?: string[] } = {}
  if (typeof revalidate !== "undefined") next.revalidate = revalidate
  if (tags && tags.length > 0) next.tags = tags

  try {
    response = await fetch(new URL(path, BACKEND_URL), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": INTERNAL_SECRET,
        ...buildActorHeaders(resolveRequestActorContext({ path })),
      },
      ...(cache ? { cache } : {}),
      ...(Object.keys(next).length > 0 ? { next } : {}),
    })
  } catch {
    throw new Error(`No se pudo conectar con el backend (${BACKEND_URL})`)
  }

  const payload = (await response.json()) as T | ApiErrorPayload

  if (!response.ok) {
    throw new Error((payload as ApiErrorPayload)?.error ?? "Error inesperado de API")
  }

  return payload as T
}
