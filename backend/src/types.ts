import type { Permisos } from './lib/permisos'
import type {
  PlatformCapabilityKey,
  PlatformViewerPolicy,
} from './lib/platform-governance'

export type PlatformStaffRoleSlug = 'superadmin' | 'staff'

export type SessionUserType = 'empresa' | 'empleado' | 'comprador' | 'super_admin' | 'platform_staff'

export interface SessionUser {
  id: string
  name?: string | null
  email?: string | null
  userType: SessionUserType
  slug?: string
  empresa_id?: string
  empresa_slug?: string
  permisos?: Permisos | Record<string, boolean>
  roleSlug?: PlatformStaffRoleSlug
  singletonKey?: string | null
  platformCapabilities?: PlatformCapabilityKey[]
  platformViewerPolicy?: PlatformViewerPolicy
  mustChangePassword?: boolean
}

declare global {
  namespace Express {
    interface RequestMeta {
      ip: string | null
      userAgent: string | null
      actorKind?: 'internal' | 'buyer' | 'anonymous'
      tenantSlug?: string | null
    }

    interface Request {
      user: SessionUser | null
      requestMeta?: RequestMeta
    }
  }
}
