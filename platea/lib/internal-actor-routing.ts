import { esRolRevendedor, type Permisos } from "@/lib/permisos"

export type FrontendUserType = "empresa" | "empleado" | "comprador" | "super_admin" | "platform_staff"
export type PlatformRoleSlug = "superadmin" | "staff"
export type PlatformDirectPermissionKey = "platform_dashboard" | "platform_empresas" | "platform_configuracion" | "platform_usuarios"
export type PlatformCapabilityKey =
  | "platform.users.read"
  | "platform.users.write"
  | "platform.users.capabilities.grant"
  | "platform.revenue.view.own"
  | "platform.revenue.view.branch"
  | "platform.revenue.view.global"
  | "platform.companies.read"
  | "platform.settings.read"
  | "platform.companies.overrides.edit"
  | "platform.fees.defaults.edit"
  | "platform.alerts.receive"
export type PlatformRevenueVisibilityScope = "own" | "branch" | "global"

export type FrontendPlatformViewerPolicy = {
  actorUserId: string
  parentUserId: string | null
  branchRootUserId: string
  rootUserId: string
  roleLabel: string
  isRoot: boolean
  compatibilityMode: "grants" | "legacy_fallback"
  capabilities: PlatformCapabilityKey[]
  capabilityCeiling: PlatformCapabilityKey[]
  revenueVisibilityScope: PlatformRevenueVisibilityScope
}

const legacyPermissionCapabilityMap: Record<PlatformDirectPermissionKey, PlatformCapabilityKey[]> = {
  platform_dashboard: ["platform.revenue.view.own"],
  platform_empresas: ["platform.companies.read"],
  platform_configuracion: ["platform.settings.read", "platform.fees.defaults.edit", "platform.companies.overrides.edit"],
  platform_usuarios: ["platform.users.read", "platform.users.write", "platform.users.capabilities.grant"],
}

export function isPlatformConsoleUserType(userType?: FrontendUserType | null): userType is "super_admin" | "platform_staff" {
  return userType === "super_admin" || userType === "platform_staff"
}

export function isPlatformConsoleActor(user: {
  userType?: FrontendUserType | null
  singletonKey?: string | null
  roleSlug?: PlatformRoleSlug | null
  platformCapabilities?: PlatformCapabilityKey[] | null
}) {
  return isPlatformConsoleUserType(user.userType)
    || user.singletonKey === "superadmin"
    || user.roleSlug === "superadmin"
    || user.roleSlug === "staff"
    || Array.isArray(user.platformCapabilities)
}

export function getInternalActorHomePath(
  userType?: FrontendUserType | null,
  empleadoRol?: string | null,
  // Opcional y retrocompatible (sin caller en producción hoy). Si se pasa, aplica el
  // mismo fallback heurístico que `isRevendedor()` en `lib/permisos.ts` para sessions
  // viejas sin `empleadoRol` — evita que esta función quede como la única del código
  // base que detecta revendedor solo por rol explícito, sin la heurística de respaldo.
  permisos?: Permisos | null
) {
  if (isPlatformConsoleUserType(userType)) return "/super-admin/dashboard"
  if (userType === "empleado" && (empleadoRol === "revendedor" || esRolRevendedor(permisos ?? undefined))) {
    return "/revendedor"
  }
  return "/dashboard"
}

export function getPlatformConsoleHomePath(user: {
  userType?: FrontendUserType | null
  singletonKey?: string | null
  roleSlug?: PlatformRoleSlug | null
  permisos?: Record<string, boolean> | null
  platformCapabilities?: PlatformCapabilityKey[] | null
}): "/super-admin/dashboard" | "/super-admin/empresas" | "/super-admin/configuracion" | "/super-admin/usuarios" | "/" {
  if (user.userType === "super_admin" || user.singletonKey === "superadmin" || user.roleSlug === "superadmin") {
    return "/super-admin/dashboard"
  }

  if (hasPlatformCapability(user, "platform.revenue.view.own")) return "/super-admin/dashboard"
  if (hasPlatformCapability(user, "platform.companies.read")) return "/super-admin/empresas"
  if (hasPlatformCapability(user, "platform.settings.read")) return "/super-admin/configuracion"
  if (hasPlatformCapability(user, "platform.users.read")) return "/super-admin/usuarios"
  return "/"
}

function getLegacyDerivedCapabilities(permisos?: Record<string, boolean> | null) {
  const capabilities = new Set<PlatformCapabilityKey>()

  for (const permission of Object.keys(legacyPermissionCapabilityMap) as PlatformDirectPermissionKey[]) {
    if (!permisos?.[permission]) continue
    for (const capability of legacyPermissionCapabilityMap[permission]) {
      capabilities.add(capability)
    }
  }

  return [...capabilities]
}

function getUserCapabilities(user: {
  userType?: FrontendUserType | null
  singletonKey?: string | null
  roleSlug?: PlatformRoleSlug | null
  permisos?: Record<string, boolean> | null
  platformCapabilities?: PlatformCapabilityKey[] | null
}) {
  if (user.userType === "super_admin" || user.singletonKey === "superadmin" || user.roleSlug === "superadmin") {
    return [
      "platform.users.read",
      "platform.users.write",
      "platform.users.capabilities.grant",
      "platform.revenue.view.own",
        "platform.revenue.view.branch",
        "platform.revenue.view.global",
        "platform.companies.read",
        "platform.settings.read",
        "platform.companies.overrides.edit",
        "platform.fees.defaults.edit",
        "platform.alerts.receive",
    ] satisfies PlatformCapabilityKey[]
  }

  if (Array.isArray(user.platformCapabilities) && user.platformCapabilities.length > 0) {
    return user.platformCapabilities
  }

  return getLegacyDerivedCapabilities(user.permisos)
}

export function hasPlatformCapability(
  user: {
    userType?: FrontendUserType | null
    singletonKey?: string | null
    roleSlug?: PlatformRoleSlug | null
    permisos?: Record<string, boolean> | null
    platformCapabilities?: PlatformCapabilityKey[] | null
  },
  capability: PlatformCapabilityKey,
) {
  if (user.userType === "super_admin" || user.singletonKey === "superadmin" || user.roleSlug === "superadmin") return true
  if (!isPlatformConsoleActor(user)) return false
  return getUserCapabilities(user).includes(capability)
}

export function hasPlatformRevenueScope(
  user: {
    userType?: FrontendUserType | null
    singletonKey?: string | null
    roleSlug?: PlatformRoleSlug | null
    platformViewerPolicy?: FrontendPlatformViewerPolicy | null
    permisos?: Record<string, boolean> | null
    platformCapabilities?: PlatformCapabilityKey[] | null
  },
  minimumScope: PlatformRevenueVisibilityScope,
) {
  if (user.userType === "super_admin" || user.singletonKey === "superadmin" || user.roleSlug === "superadmin") return true
  if (!isPlatformConsoleActor(user)) return false

  const currentScope = user.platformViewerPolicy?.revenueVisibilityScope
    ?? (hasPlatformCapability(user, "platform.revenue.view.global")
      ? "global"
      : hasPlatformCapability(user, "platform.revenue.view.branch")
        ? "branch"
        : "own")
  const rank: Record<PlatformRevenueVisibilityScope, number> = { own: 0, branch: 1, global: 2 }

  return rank[currentScope] >= rank[minimumScope]
}

export function hasPlatformPermission(
  user: {
    userType?: FrontendUserType | null
    singletonKey?: string | null
    roleSlug?: PlatformRoleSlug | null
    permisos?: Record<string, boolean> | null
    platformCapabilities?: PlatformCapabilityKey[] | null
  },
  permission: PlatformDirectPermissionKey
) {
  return legacyPermissionCapabilityMap[permission].some((capability) => hasPlatformCapability(user, capability))
}
