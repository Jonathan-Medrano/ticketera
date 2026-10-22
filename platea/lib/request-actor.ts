import type { BuyerSessionUser } from "@/lib/buyer-session/types"

type InternalUser = Record<string, unknown> & { userType?: string | null }

export type RequestActorContext = {
  actorKind: "internal" | "buyer" | "anonymous"
  tenantSlug: string | null
  user: InternalUser | BuyerSessionUser | null
}

const tenantPathPattern = /^\/api\/tenant\/([^/]+)/

export function matchTenantSlugFromBackendPath(path: string) {
  return path.match(tenantPathPattern)?.[1] ?? null
}

export function isInternalUser(user: InternalUser | null | undefined): user is InternalUser {
  return user?.userType === "empresa" || user?.userType === "empleado" || user?.userType === "super_admin" || user?.userType === "platform_staff"
}

export function resolveRequestActorContext(options: { path: string; internalUser?: InternalUser | null; buyerUser?: BuyerSessionUser | null }): RequestActorContext {
  const tenantSlug = matchTenantSlugFromBackendPath(options.path)
  if (tenantSlug) {
    if (options.buyerUser && options.buyerUser.empresa_slug === tenantSlug) {
      return { actorKind: "buyer", tenantSlug, user: options.buyerUser }
    }
    return { actorKind: "anonymous", tenantSlug, user: null }
  }

  if (isInternalUser(options.internalUser ?? null)) {
    return { actorKind: "internal", tenantSlug: null, user: options.internalUser ?? null }
  }

  return { actorKind: "anonymous", tenantSlug: null, user: null }
}

export function buildActorHeaders(context: RequestActorContext) {
  return {
    "x-user": JSON.stringify(context.user ?? null),
    "x-actor-kind": context.actorKind,
    "x-tenant-slug": context.tenantSlug ?? "",
  }
}
