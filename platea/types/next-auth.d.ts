import "next-auth"
import "next-auth/jwt"
import type { FrontendUserType, InternalPermissions, PlatformRoleSlug } from "@/lib/auth-identities"
import type { FrontendPlatformViewerPolicy, PlatformCapabilityKey } from "@/lib/internal-actor-routing"

declare module "next-auth" {
  interface User {
    slug: string
    accountName?: string
    permisos?: InternalPermissions
    userType?: FrontendUserType
    empresa_id?: string
    empleadoRol?: string | null
    roleSlug?: PlatformRoleSlug
    singletonKey?: string | null
    platformCapabilities?: PlatformCapabilityKey[]
    platformViewerPolicy?: FrontendPlatformViewerPolicy
    mustChangePassword?: boolean
    aprobada?: boolean
    email_verificado?: boolean
  }
  interface Session {
    user: {
      id: string
      slug: string
      name?: string | null
      accountName?: string | null
      email?: string | null
      permisos?: InternalPermissions
      userType?: FrontendUserType
      empresa_id?: string
      empresa_slug?: string
      empleadoRol?: string | null
      roleSlug?: PlatformRoleSlug
      singletonKey?: string | null
      platformCapabilities?: PlatformCapabilityKey[]
      platformViewerPolicy?: FrontendPlatformViewerPolicy
      mustChangePassword?: boolean
      aprobada?: boolean
      email_verificado?: boolean
      isImpersonated?: boolean
    }
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    passwordVersion?: number | null
    roleSlug?: PlatformRoleSlug
    singletonKey?: string | null
    userType?: FrontendUserType
    empresa_id?: string
    empleadoRol?: string | null
    permisos?: InternalPermissions
    empresa_slug?: string
    slug?: string
    accountName?: string
    platformCapabilities?: PlatformCapabilityKey[]
    platformViewerPolicy?: FrontendPlatformViewerPolicy
    mustChangePassword?: boolean
    aprobada?: boolean
    email_verificado?: boolean
    isImpersonated?: boolean
    impersonatedAt?: number
  }
}
