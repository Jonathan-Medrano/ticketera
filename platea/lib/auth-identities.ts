import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import type { FrontendUserType, PlatformRoleSlug } from "@/lib/internal-actor-routing"
import type { Permisos } from "@/lib/permisos"

export type { FrontendUserType, PlatformRoleSlug } from "@/lib/internal-actor-routing"
export { getInternalActorHomePath, isPlatformConsoleUserType } from "@/lib/internal-actor-routing"

export type PlatformDirectPermissions = Record<
  "platform_dashboard" | "platform_empresas" | "platform_configuracion" | "platform_usuarios",
  boolean
>

export type InternalPermissions = Permisos | PlatformDirectPermissions

export type LoginIdentity = {
  id: string
  email: string
  slug: string
  name: string
  accountName?: string
  userType: "empresa" | "super_admin" | "platform_staff"
  roleSlug?: PlatformRoleSlug
  singletonKey?: string | null
  permisos?: InternalPermissions
  mustChangePassword?: boolean
  aprobada?: boolean
  email_verificado?: boolean
}

function normalizeLoginIdentifier(value: string) {
  return value.trim().toLowerCase()
}

// El slug de la empresa se muestra en toda la app como "slug.ticketera.com" (es la URL
// pública de su storefront), así que es habitual que lo peguen entero en el campo
// "Email o usuario" en vez del slug solo. Sin esto, ese texto no matchea ni el email
// ni el slug y el login falla con "Email o contraseña incorrectos" aunque la contraseña
// sea correcta.
function extractSlugFromDomainIdentifier(value: string): string | null {
  const match = value.match(/^(?:https?:\/\/)?([a-z0-9-]+)\.ticketera\.com\/?$/)
  return match ? match[1] : null
}

function resolvePlatformUserType(
  roleSlug: string | null | undefined,
  singletonKey: string | null | undefined
): Extract<FrontendUserType, "super_admin" | "platform_staff"> {
  return roleSlug === "superadmin" && singletonKey === "superadmin"
    ? "super_admin"
    : "platform_staff"
}

function normalizePlatformRoleSlug(raw: string | null | undefined): PlatformRoleSlug {
  return raw === "superadmin" ? "superadmin" : "staff"
}

export async function resolveCompanyOrSuperAdminLogin(email: string, password: string): Promise<LoginIdentity | null> {
  const normalizedIdentifier = normalizeLoginIdentifier(email)

  // Check platform admin first (superadmin / platform_staff)
  const platformAdmin = await prisma.platformAdminUser.findFirst({
    where: {
      activo: true,
      OR: [
        { email: normalizedIdentifier },
        { login_alias: normalizedIdentifier },
      ],
    },
    select: {
      id: true,
      nombre: true,
      email: true,
      password: true,
      permisos: true,
      role_slug: true,
      singleton_key: true,
      must_change_password: true,
    },
  })

  if (platformAdmin) {
    const passwordOk = await bcrypt.compare(password, platformAdmin.password)
    if (!passwordOk) return null

    const userType = resolvePlatformUserType(platformAdmin.role_slug, platformAdmin.singleton_key)

    return {
      id: platformAdmin.id,
      name: platformAdmin.nombre,
      accountName: platformAdmin.nombre,
      email: platformAdmin.email,
      slug: "",
      userType,
      roleSlug: normalizePlatformRoleSlug(platformAdmin.role_slug),
      singletonKey: platformAdmin.singleton_key ?? null,
      permisos: platformAdmin.permisos ? JSON.parse(platformAdmin.permisos) : undefined,
      mustChangePassword: userType === "platform_staff" && platformAdmin.must_change_password === true,
    }
  }

  // Check empresa — acepta email O slug como identificador. Ambos son únicos
  // por empresa, el slug ya se usa como subdominio público (slug.ticketera.com),
  // así que es seguro y conocido por el dueño.
  const domainSlug = extractSlugFromDomainIdentifier(normalizedIdentifier)
  const empresa = await prisma.empresa.findFirst({
    where: {
      OR: [
        { email: normalizedIdentifier },
        { slug: normalizedIdentifier },
        ...(domainSlug ? [{ slug: domainSlug }] : []),
      ],
      activa: true,
    },
    select: {
      id: true,
      nombre: true,
      email: true,
      password: true,
      slug: true,
      admin_nombre: true,
      admin_apellido: true,
      aprobada: true,
      email_verificado: true,
      must_change_password: true,
    },
  })

  if (!empresa) return null
  if (!empresa.password) return null

  const passwordOk = await bcrypt.compare(password, empresa.password)
  if (!passwordOk) return null

  return {
    id: empresa.id,
    name: empresa.nombre,
    accountName: `${empresa.admin_nombre ?? ""} ${empresa.admin_apellido ?? ""}`.trim() || empresa.admin_nombre || empresa.nombre,
    email: empresa.email ?? "",
    slug: empresa.slug,
    userType: "empresa",
    aprobada: empresa.aprobada,
    email_verificado: empresa.email_verificado,
    mustChangePassword: empresa.must_change_password === true,
  }
}
