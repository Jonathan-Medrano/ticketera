import type { RequestHandler, Response } from 'express'
import { prisma } from './prisma'
import { normalizePermisos, type Permisos } from './permisos'
import type { PlatformStaffRoleSlug, SessionUser } from '../types'
import { parsePlatformPermissions, type PlatformPermissionKey } from './platform-profit-sharing'
import {
  getRequiredCapabilitiesForLegacyPermission,
  mapCapabilitiesToLegacyPlatformPermissions,
  resolvePlatformViewerPolicy,
  type PlatformRevenueVisibilityScope,
  type PlatformCapabilityKey,
} from './platform-governance'

function parsePlatformRoleSlug(raw: string | null | undefined): PlatformStaffRoleSlug | null {
  if (raw === 'superadmin') return 'superadmin'
  if (raw === 'empleado' || raw === 'socio' || raw === 'staff') return 'staff'
  return null
}

function parsePermisos(raw: string | null | undefined): Permisos | undefined {
  if (!raw) return undefined

  try {
    return normalizePermisos(JSON.parse(raw))
  } catch {
    return undefined
  }
}

// Real user rehydration — used by middleware on every request
export async function rehydrateSessionUser(user: SessionUser | null): Promise<SessionUser | null> {
  if (!user?.id || !user.userType) return null

  if (user.userType === 'empresa') {
    const empresa = await prisma.empresa.findUnique({
      where: { id: user.id },
      select: { id: true, nombre: true, slug: true, email: true, activa: true, aprobada: true, email_verificado: true },
    })

    if (!empresa || !empresa.activa || !empresa.aprobada || !empresa.email_verificado || !empresa.slug) return null

    return {
      id: empresa.id,
      name: empresa.nombre ?? null,
      email: empresa.email ?? null,
      userType: 'empresa',
      slug: empresa.slug,
    }
  }

  if (user.userType === 'empleado') {
    // No @relation in schema — fetch usuario + empresa separately, then rol if needed
    const empleado = await prisma.usuario.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        nombre: true,
        apellido: true,
        email: true,
        empresa_id: true,
        permisos: true,
        rol: true,
        activo: true,
        must_change_password: true,
      },
    })

    if (!empleado || !empleado.activo || !empleado.empresa_id) return null

    const empresa = await prisma.empresa.findUnique({
      where: { id: empleado.empresa_id },
      select: { slug: true, activa: true },
    })

    if (!empresa || !empresa.activa || !empresa.slug) return null

    // Fetch role permisos if the usuario has a rol assigned
    let rolPermisos: string | null = null
    if (empleado.rol) {
      const rol = await prisma.rol.findUnique({
        where: { empresa_id_slug: { empresa_id: empleado.empresa_id, slug: empleado.rol } },
        select: { permisos: true },
      })
      rolPermisos = rol?.permisos ?? null
    }

    return {
      id: empleado.id,
      name: `${empleado.nombre ?? ''} ${empleado.apellido ?? ''}`.trim() || null,
      email: empleado.email ?? null,
      userType: 'empleado',
      empresa_id: empleado.empresa_id,
      empresa_slug: empresa.slug,
      slug: empresa.slug,
      permisos: parsePermisos(empleado.permisos) ?? parsePermisos(rolPermisos),
      mustChangePassword: empleado.must_change_password,
    }
  }

  if (user.userType === 'comprador') {
    // No @relation in schema — fetch comprador + empresa separately
    const comprador = await prisma.comprador.findUnique({
      where: { id: user.id },
      select: { id: true, nombre: true, email: true, empresa_id: true },
    })

    if (!comprador || !comprador.empresa_id) return null

    const empresa = await prisma.empresa.findUnique({
      where: { id: comprador.empresa_id },
      select: { slug: true, activa: true, tenant_public_disabled: true, suspendido: true },
    })

    if (!empresa || !empresa.activa || empresa.tenant_public_disabled || empresa.suspendido) return null

    return {
      id: comprador.id,
      name: comprador.nombre ?? null,
      email: comprador.email ?? null,
      userType: 'comprador',
      empresa_id: comprador.empresa_id,
      empresa_slug: empresa.slug,
      slug: empresa.slug,
    }
  }

  if (user.userType === 'super_admin' || user.userType === 'platform_staff') {
    const admin = await prisma.platformAdminUser.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        nombre: true,
        email: true,
        permisos: true,
        role_slug: true,
        singleton_key: true,
        activo: true,
        must_change_password: true,
      },
    })

    if (!admin || !admin.activo) return null

    const roleSlug = parsePlatformRoleSlug(admin.role_slug) ?? (String(admin.singleton_key ?? '') === 'superadmin' ? 'superadmin' : 'staff')
    const singletonKey = admin.singleton_key ?? null
    const viewerPolicy = await resolvePlatformViewerPolicy(admin.id)
    const userType = roleSlug === 'superadmin' && singletonKey === 'superadmin'
      ? 'super_admin'
      : 'platform_staff'
    const legacyPermissions = mapCapabilitiesToLegacyPlatformPermissions(viewerPolicy.capabilities)

    return {
      id: admin.id,
      name: admin.nombre ?? null,
      email: admin.email ?? null,
      userType,
      slug: '',
      permisos: {
        ...parsePlatformPermissions(admin.permisos),
        ...legacyPermissions,
      },
      roleSlug,
      singletonKey,
      platformCapabilities: viewerPolicy.capabilities,
      platformViewerPolicy: viewerPolicy,
      mustChangePassword: userType === 'platform_staff' && admin.must_change_password,
    }
  }

  return null
}

export function getActorEmpresaId(user: SessionUser): string | null {
  if (user.userType === 'empresa') return user.id
  if (user.userType === 'empleado' || user.userType === 'comprador') return user.empresa_id ?? null
  return null
}

export function requirePermission(
  user: SessionUser,
  permission: keyof Permisos,
  res: Response,
  message = 'Sin permiso'
) {
  if (user.userType !== 'empleado') return true
  if (user.permisos?.[permission] === true) return true

  res.status(403).json({ error: message })
  return false
}

export function requireAnyPermission(
  user: SessionUser,
  permissions: (keyof Permisos)[],
  res: Response,
  message = 'Sin permiso'
): boolean {
  if (user.userType !== 'empleado') return true
  if (permissions.some((p) => user.permisos?.[p] === true)) return true
  res.status(403).json({ error: message })
  return false
}

export function isPlatformConsoleUser(user: SessionUser) {
  return user.userType === 'super_admin' || user.userType === 'platform_staff'
}

export function hasPlatformPermission(user: SessionUser, permission?: PlatformPermissionKey) {
  if (user.userType === 'super_admin' && user.singletonKey === 'superadmin') return true
  if (user.userType !== 'platform_staff') return false
  if (!permission) return true

  const userCapabilitySet = new Set(user.platformCapabilities ?? [])
  if (userCapabilitySet.size > 0) {
    return getRequiredCapabilitiesForLegacyPermission(permission).some((capability) => userCapabilitySet.has(capability))
  }

  const legacyPlatformPermissions = parsePlatformPermissions(
    user.permisos ? JSON.stringify(user.permisos) : null
  )

  return legacyPlatformPermissions[permission] === true
}

export function hasPlatformCapability(user: SessionUser, capability?: PlatformCapabilityKey) {
  if (user.userType === 'super_admin' && user.singletonKey === 'superadmin') return true
  if (user.userType !== 'platform_staff') return false
  if (!capability) return true
  return (user.platformCapabilities ?? []).includes(capability)
}

export function requirePlatformConsoleUser(user: SessionUser, res: Response, message = 'Sin permiso', permission?: PlatformPermissionKey) {
  if (hasPlatformPermission(user, permission)) return true

  res.status(403).json({ error: message })
  return false
}

export function requirePlatformCapability(user: SessionUser, res: Response, capability?: PlatformCapabilityKey, message = 'Sin permiso') {
  if (hasPlatformCapability(user, capability)) return true

  res.status(403).json({ error: message })
  return false
}

function hasRevenueVisibilityAtLeast(user: SessionUser, minimumScope: PlatformRevenueVisibilityScope) {
  if (user.userType === 'super_admin' && user.singletonKey === 'superadmin') return true
  if (user.userType !== 'platform_staff') return false

  const scope = user.platformViewerPolicy?.revenueVisibilityScope ?? 'own'
  const rank: Record<PlatformRevenueVisibilityScope, number> = { own: 0, branch: 1, global: 2 }
  return rank[scope] >= rank[minimumScope]
}

export function requirePlatformRevenueScope(user: SessionUser, res: Response, minimumScope: PlatformRevenueVisibilityScope, message = 'Sin permiso') {
  if (hasRevenueVisibilityAtLeast(user, minimumScope)) return true

  res.status(403).json({ error: message })
  return false
}

export function requireSingletonSuperAdmin(user: SessionUser, res: Response, message = 'Sin permiso') {
  if (user.userType === 'super_admin' && user.singletonKey === 'superadmin') return true

  res.status(403).json({ error: message })
  return false
}

export function requireUserType(
  user: SessionUser,
  allowed: SessionUser['userType'][],
  res: Response,
  message = 'Sin permiso'
) {
  if (allowed.includes(user.userType)) return true

  res.status(403).json({ error: message })
  return false
}

export function requirePermissionMiddleware(
  permission: keyof Permisos,
  message = 'Sin permiso'
): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autorizado' })
    }

    if (!requirePermission(req.user, permission, res, message)) {
      return
    }

    next()
  }
}

export function requireUserTypeMiddleware(
  allowed: SessionUser['userType'][],
  message = 'Sin permiso'
): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autorizado' })
    }

    if (!requireUserType(req.user, allowed, res, message)) {
      return
    }

    next()
  }
}

export function requirePlatformConsoleMiddleware(permission?: PlatformPermissionKey, message = 'Sin permiso'): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autorizado' })
    }

    if (!requirePlatformConsoleUser(req.user, res, message, permission)) {
      return
    }

    next()
  }
}

export function requirePlatformCapabilityMiddleware(capability?: PlatformCapabilityKey, message = 'Sin permiso'): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autorizado' })
    }

    if (!requirePlatformCapability(req.user, res, capability, message)) {
      return
    }

    next()
  }
}

export function requirePlatformRevenueScopeMiddleware(minimumScope: PlatformRevenueVisibilityScope, message = 'Sin permiso'): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autorizado' })
    }

    if (!requirePlatformRevenueScope(req.user, res, minimumScope, message)) {
      return
    }

    next()
  }
}

export function requireSingletonSuperAdminMiddleware(message = 'Sin permiso'): RequestHandler {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'No autorizado' })
    }

    if (!requireSingletonSuperAdmin(req.user, res, message)) {
      return
    }

    next()
  }
}

export const requireInternalDashboardActorMiddleware = requireUserTypeMiddleware(['empresa', 'empleado'])
export const requireSuperAdminMiddleware = requireSingletonSuperAdminMiddleware()
