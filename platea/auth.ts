import NextAuth from "next-auth"
import Credentials from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { authConfig } from "./auth.config"
import { type FrontendUserType, type InternalPermissions, resolveCompanyOrSuperAdminLogin } from "@/lib/auth-identities"
import {
  buildGoogleAuthErrorRedirect,
  buildGoogleOnboardingRedirect,
  createGoogleAuthProvider,
  GOOGLE_AUTH_ERROR_CODES,
  resolveGoogleProfileNames,
} from "@/lib/google-auth"
import {
  ensurePasswordVersionColumns,
  getCompanyPasswordVersion,
  getEmployeePasswordVersion,
  getPlatformAdminPasswordVersion,
} from "@/lib/password-version"
import { PERMISOS_VACIOS, ROLES_PREDEFINIDOS, type Permisos } from "@/lib/permisos"
import type { FrontendPlatformViewerPolicy, PlatformCapabilityKey } from "@/lib/internal-actor-routing"
import { prisma } from "@/lib/prisma"
import { checkLoginRateLimit } from "@/lib/login-rate-limit"

function normalizeLoginEmail(email: string) {
  return email.trim().toLowerCase()
}

type AuthExtendedUser = {
  slug?: string
  accountName?: string
  userType?: FrontendUserType
  empresa_id?: string
  empleadoRol?: string | null
  permisos?: InternalPermissions
  empresa_slug?: string
  roleSlug?: "superadmin" | "staff"
  singletonKey?: string | null
  platformCapabilities?: PlatformCapabilityKey[]
  platformViewerPolicy?: FrontendPlatformViewerPolicy
  mustChangePassword?: boolean
  aprobada?: boolean
  email_verificado?: boolean
}

type PlatformDirectPermissions = Record<"platform_dashboard" | "platform_empresas" | "platform_configuracion" | "platform_usuarios", boolean>

const platformCapabilityCatalog = [
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

const legacyPlatformPermissionCapabilityMap: Record<keyof PlatformDirectPermissions, PlatformCapabilityKey[]> = {
  platform_dashboard: ["platform.revenue.view.own"],
  platform_empresas: ["platform.companies.read"],
  platform_configuracion: ["platform.settings.read", "platform.fees.defaults.edit", "platform.companies.overrides.edit"],
  platform_usuarios: ["platform.users.read", "platform.users.write", "platform.users.capabilities.grant"],
}

function normalizePlatformDirectPermissions(raw: unknown): PlatformDirectPermissions {
  return {
    platform_dashboard: Boolean(raw && typeof raw === "object" && (raw as Record<string, unknown>).platform_dashboard === true),
    platform_empresas: Boolean(raw && typeof raw === "object" && (raw as Record<string, unknown>).platform_empresas === true),
    platform_configuracion: Boolean(raw && typeof raw === "object" && (raw as Record<string, unknown>).platform_configuracion === true),
    platform_usuarios: Boolean(raw && typeof raw === "object" && (raw as Record<string, unknown>).platform_usuarios === true),
  }
}

function getPlatformCapabilitiesFromLegacyPermissions(raw: unknown, isRoot: boolean) {
  if (isRoot) return [...platformCapabilityCatalog]
  const permissions = normalizePlatformDirectPermissions(raw)
  const capabilities = new Set<PlatformCapabilityKey>()

  for (const permission of Object.keys(legacyPlatformPermissionCapabilityMap) as Array<keyof PlatformDirectPermissions>) {
    if (!permissions[permission]) continue
    for (const capability of legacyPlatformPermissionCapabilityMap[permission]) {
      capabilities.add(capability)
    }
  }

  return [...capabilities]
}

function mapCapabilitiesToLegacyPermissions(capabilities: PlatformCapabilityKey[]): PlatformDirectPermissions {
  const set = new Set(capabilities)
  return {
    platform_dashboard: set.has("platform.revenue.view.own") || set.has("platform.revenue.view.branch") || set.has("platform.revenue.view.global"),
    platform_empresas: set.has("platform.companies.read"),
    platform_configuracion: set.has("platform.settings.read") || set.has("platform.fees.defaults.edit") || set.has("platform.companies.overrides.edit"),
    platform_usuarios: set.has("platform.users.read") || set.has("platform.users.write") || set.has("platform.users.capabilities.grant"),
  }
}

function normalizePlatformRoleSlug(raw: string | null | undefined): "superadmin" | "staff" {
  return raw === "superadmin" ? "superadmin" : "staff"
}

async function resolveFrontendPlatformViewerPolicy(adminId: string, roleSlug: "superadmin" | "staff", singletonKey: string | null, legacyPermisos: unknown) {
  const isRoot = roleSlug === "superadmin" && singletonKey === "superadmin"
  const [relationshipRow, grantRows, rootRow] = await Promise.all([
    prisma.platformAdminRelationship.findUnique({
      where: { platform_admin_user_id: adminId },
      select: { parent_platform_admin_user_id: true, branch_root_platform_admin_user_id: true },
    }).catch(() => null),
    prisma.platformAdminCapabilityGrant.findMany({
      where: { platform_admin_user_id: adminId },
      select: { capability_key: true },
      orderBy: { capability_key: "asc" },
    }).catch(() => [] as { capability_key: string }[]),
    prisma.platformAdminUser.findFirst({
      where: { singleton_key: "superadmin" },
      select: { id: true },
      orderBy: [{ created_at: "asc" }, { id: "asc" }],
    }).catch(() => null),
  ])

  const grantedCapabilities = grantRows
    .map((row) => row.capability_key)
    .filter((capability): capability is PlatformCapabilityKey => platformCapabilityCatalog.includes(capability as PlatformCapabilityKey))
  const capabilities = grantedCapabilities.length > 0
    ? grantedCapabilities
    : getPlatformCapabilitiesFromLegacyPermissions(legacyPermisos, isRoot)
  const revenueVisibilityScope = capabilities.includes("platform.revenue.view.global")
    ? "global"
    : capabilities.includes("platform.revenue.view.branch")
      ? "branch"
      : "own"

  return {
    actorUserId: adminId,
    parentUserId: relationshipRow?.parent_platform_admin_user_id ?? null,
    branchRootUserId: relationshipRow?.branch_root_platform_admin_user_id ?? adminId,
    rootUserId: rootRow?.id ?? adminId,
    roleLabel: roleSlug,
    isRoot,
    compatibilityMode: grantedCapabilities.length > 0 ? "grants" : "legacy_fallback",
    capabilities,
    capabilityCeiling: capabilities,
    revenueVisibilityScope,
  } satisfies FrontendPlatformViewerPolicy
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    createGoogleAuthProvider(),
    Credentials({
      id: "credentials-empresa",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Contraseña", type: "password" },
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null

        const ip = (request as { headers?: { get?: (k: string) => string | null } } | null)?.headers?.get?.("x-forwarded-for")?.split(",")[0]?.trim()
          ?? (request as { headers?: { get?: (k: string) => string | null } } | null)?.headers?.get?.("x-real-ip")
          ?? "unknown"
        if (!(await checkLoginRateLimit(ip))) throw new Error("Demasiados intentos. Intentá de nuevo más tarde.")

        return resolveCompanyOrSuperAdminLogin(String(credentials.email), String(credentials.password))
      },
    }),
    Credentials({
      id: "credentials-empleado",
      credentials: {
        email: {},
        password: {},
      },
      async authorize(credentials, request) {
        if (!credentials?.email || !credentials?.password) return null

        const ip = (request as { headers?: { get?: (k: string) => string | null } } | null)?.headers?.get?.("x-forwarded-for")?.split(",")[0]?.trim()
          ?? (request as { headers?: { get?: (k: string) => string | null } } | null)?.headers?.get?.("x-real-ip")
          ?? "unknown"
        if (!(await checkLoginRateLimit(ip))) throw new Error("Demasiados intentos. Intentá de nuevo más tarde.")

        await ensurePasswordVersionColumns()
        const normalizedEmail = normalizeLoginEmail(String(credentials.email))

        // No @relation on Usuario — JOIN via $queryRaw (email stored lowercase per design)
        const rows = await prisma.$queryRaw<Array<{
          id: string; nombre: string; apellido: string | null; email: string; password: string;
          empresa_slug: string; empresa_id: string;
          permisos: string | null; rol: string | null; rol_permisos: string | null;
          must_change_password: boolean;
        }>>`
          SELECT u.id, u.nombre, u.apellido, u.email, u.password,
                 e.slug AS empresa_slug, e.id AS empresa_id,
                 u.permisos, u.rol, r.permisos AS rol_permisos, u.must_change_password
          FROM usuarios u
          JOIN empresas e ON e.id = u.empresa_id
          LEFT JOIN roles r ON r.empresa_id = u.empresa_id AND r.slug = u.rol
          WHERE u.email = ${normalizedEmail} AND u.activo = true AND e.activa = true
          LIMIT 1
        `

        const empleado = rows[0]
        if (!empleado) return null

        const ok = await bcrypt.compare(credentials.password as string, empleado.password)
        if (!ok) return null

        let permisos: Permisos = PERMISOS_VACIOS
        if (empleado.permisos) {
          try { permisos = JSON.parse(empleado.permisos) } catch { permisos = { ...PERMISOS_VACIOS } }
        } else if (empleado.rol_permisos) {
          try { permisos = JSON.parse(empleado.rol_permisos) } catch { permisos = { ...PERMISOS_VACIOS } }
        } else if (empleado.rol && ROLES_PREDEFINIDOS[empleado.rol]) {
          permisos = ROLES_PREDEFINIDOS[empleado.rol]
        }

        return {
          id: empleado.id,
          name: `${empleado.nombre} ${empleado.apellido ?? ""}`.trim(),
          email: empleado.email,
          slug: empleado.empresa_slug,
          userType: "empleado",
          empresa_id: empleado.empresa_id,
          empleadoRol: empleado.rol ?? null,
          permisos,
          mustChangePassword: empleado.must_change_password === true,
        }
      },
    }),
    Credentials({
      id: "credentials-impersonation",
      credentials: { token: {} },
      async authorize(credentials) {
        if (!credentials?.token) return null
        const { createHash } = await import("node:crypto")
        const tokenHash = createHash("sha256").update(String(credentials.token)).digest("hex")

        const tokenRow = await prisma.platformImpersonationToken.findUnique({
          where: { token_hash: tokenHash },
          select: { empresa_id: true, used_at: true, expires_at: true },
        })
        if (!tokenRow || tokenRow.used_at !== null || tokenRow.expires_at <= new Date()) return null

        const empresa = await prisma.empresa.findUnique({
          where: { id: tokenRow.empresa_id },
          select: { id: true, nombre: true, slug: true, email: true, activa: true },
        })
        if (!empresa || !empresa.activa) return null

        await prisma.platformImpersonationToken.update({
          where: { token_hash: tokenHash },
          data: { used_at: new Date() },
        })

        const identity = {
          id: empresa.id,
          name: empresa.nombre,
          email: empresa.email ?? "",
          slug: empresa.slug,
          userType: "empresa" as FrontendUserType,
          isImpersonated: true,
        }
        return identity as unknown as ReturnType<typeof resolveCompanyOrSuperAdminLogin> extends Promise<infer T> ? T : never
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === "google") {
        const normalizedEmail = normalizeLoginEmail(user.email ?? "")
        if (!normalizedEmail) {
          return buildGoogleAuthErrorRedirect(GOOGLE_AUTH_ERROR_CODES.emailUnavailable)
        }

        // Endurecimiento: Google debe afirmar que el email está verificado en su lado.
        // Sin este claim no podemos confiar en que el usuario controla la casilla, así
        // que cortamos el sign-in (no auto-confirmamos email_verificado más abajo).
        const googleProfile = profile && typeof profile === "object" ? (profile as Record<string, unknown>) : undefined
        if (googleProfile?.email_verified !== true) {
          return buildGoogleAuthErrorRedirect(GOOGLE_AUTH_ERROR_CODES.emailUnverified)
        }

        const empresa = await prisma.empresa.findFirst({
          where: { email: normalizedEmail },
          select: { id: true, nombre: true, slug: true, email: true, activa: true, admin_nombre: true, admin_apellido: true, aprobada: true, email_verificado: true },
        })

        if (!empresa) {
          const { firstName, lastName } = resolveGoogleProfileNames(
            profile && typeof profile === "object" ? (profile as Record<string, unknown>) : undefined,
            user.name
          )

          return buildGoogleOnboardingRedirect({
            email: normalizedEmail,
            firstName,
            lastName,
          })
        }

        if (!empresa.activa) {
          return buildGoogleAuthErrorRedirect(GOOGLE_AUTH_ERROR_CODES.inactiveAccount)
        }

        // El login con Google CONFIRMA el email: Google ya probó (email_verified=true)
        // que el usuario controla la casilla. Si la empresa aún no estaba verificada,
        // la marcamos verificada en DB para que deje de rebotar a /verificar-email.
        if (empresa.email_verificado === false) {
          await prisma.empresa.update({
            where: { id: empresa.id },
            data: { email_verificado: true, email_verificado_at: new Date() },
          })
        }

        user.id = empresa.id
        user.name = empresa.nombre
        user.email = empresa.email ?? undefined
        ;(user as AuthExtendedUser).slug = empresa.slug
        ;(user as AuthExtendedUser).accountName = `${empresa.admin_nombre ?? ""} ${empresa.admin_apellido ?? ""}`.trim() || empresa.admin_nombre || empresa.nombre
        ;(user as AuthExtendedUser).userType = "empresa"
        ;(user as AuthExtendedUser).aprobada = empresa.aprobada
        ;(user as AuthExtendedUser).email_verificado = true
      }
      return true
    },
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id
        token.slug = (user as AuthExtendedUser).slug
        token.accountName = (user as AuthExtendedUser).accountName
        token.userType = (user as AuthExtendedUser).userType
        token.empresa_id = (user as AuthExtendedUser).empresa_id
        token.empleadoRol = (user as AuthExtendedUser).empleadoRol
        token.permisos = (user as AuthExtendedUser).permisos
        token.empresa_slug = (user as AuthExtendedUser).empresa_slug
        token.roleSlug = (user as AuthExtendedUser).roleSlug
        token.singletonKey = (user as AuthExtendedUser).singletonKey
        token.platformCapabilities = (user as AuthExtendedUser).platformCapabilities
        token.platformViewerPolicy = (user as AuthExtendedUser).platformViewerPolicy
        token.mustChangePassword = (user as AuthExtendedUser).mustChangePassword
        token.aprobada = (user as AuthExtendedUser).aprobada
        token.email_verificado = (user as AuthExtendedUser).email_verificado
        token.isImpersonated = (user as { isImpersonated?: boolean }).isImpersonated ?? false
        // Sello el inicio de la impersonation UNA sola vez (en el sign-in, cuando `user` está presente).
        // No se puede usar token.iat: en el primer callback aún no existe (jose lo agrega recién en encode),
        // y @auth/core re-encodea en cada lectura de sesión reseteando iat → daría idle-timeout, no cap absoluto.
        if (token.isImpersonated) {
          token.impersonatedAt = Math.floor(Date.now() / 1000)
        }
      }

      if (token.userType === "empleado" && token.id && token.email) {
        await ensurePasswordVersionColumns()
        const rows = await prisma.$queryRaw<Array<{
          id: string; nombre: string; apellido: string | null; email: string;
          empresa_id: string; empresa_slug: string; rol: string | null;
          permisos: string | null; rol_permisos: string | null;
          password_changed_at: Date | null; must_change_password: boolean;
        }>>`
          SELECT u.id, u.nombre, u.apellido, u.email, u.empresa_id, e.slug AS empresa_slug, u.rol,
                 u.permisos, r.permisos AS rol_permisos, u.password_changed_at, u.must_change_password
          FROM usuarios u
          JOIN empresas e ON e.id = u.empresa_id
          LEFT JOIN roles r ON r.empresa_id = u.empresa_id AND r.slug = u.rol
          WHERE u.id = ${token.id as string} AND u.email = ${token.email as string}
            AND u.activo = true AND e.activa = true
          LIMIT 1
        `

        const empleado = rows[0]

        if (!empleado) {
          return {}
        }

        const passwordVersion = getEmployeePasswordVersion
          ? await getEmployeePasswordVersion(String(token.id), String(token.email))
          : null
        if (token.passwordVersion && passwordVersion !== null && token.passwordVersion !== passwordVersion) {
          return {}
        }

        let permisos: Permisos = PERMISOS_VACIOS
        if (empleado.permisos) {
          try { permisos = JSON.parse(empleado.permisos) } catch { permisos = { ...PERMISOS_VACIOS } }
        } else if (empleado.rol_permisos) {
          try { permisos = JSON.parse(empleado.rol_permisos) } catch { permisos = { ...PERMISOS_VACIOS } }
        }

        token.name = `${empleado.nombre} ${empleado.apellido ?? ""}`.trim()
        token.slug = empleado.empresa_slug
        token.empresa_id = empleado.empresa_id
        token.empleadoRol = empleado.rol ?? null
        token.permisos = permisos
        token.passwordVersion = passwordVersion
        token.mustChangePassword = empleado.must_change_password === true
      }

      if (token.userType === "empresa" && token.id) {
        // TTL corto para sesiones impersonadas: máximo 30 minutos ABSOLUTOS desde el sign-in.
        // Se compara contra impersonatedAt (sellado una vez en el sign-in), NO contra iat —
        // iat se resetea en cada re-encode de @auth/core y nunca expiraría con uso activo.
        if (token.isImpersonated) {
          const startedAt = typeof token.impersonatedAt === "number" ? token.impersonatedAt : 0
          if (startedAt === 0 || Date.now() / 1000 - startedAt > 1800) {
            return {}
          }
        }

        await ensurePasswordVersionColumns()
        const empresa = await prisma.empresa.findUnique({
          where: { id: token.id as string },
          select: { id: true, nombre: true, slug: true, email: true, activa: true, admin_nombre: true, admin_apellido: true, password_changed_at: true, aprobada: true, email_verificado: true, must_change_password: true },
        })

        if (!empresa || !empresa.activa) {
          return {}
        }

        // Validar passwordVersion siempre — incluyendo sesiones impersonadas.
        // Si la empresa cambia su password, el superadmin debe re-impersonar.
        const passwordVersion = await getCompanyPasswordVersion(String(token.id))
        if (token.passwordVersion && passwordVersion !== null && token.passwordVersion !== passwordVersion) {
          return {}
        }
        token.passwordVersion = passwordVersion

        token.name = empresa.nombre
        token.accountName = `${empresa.admin_nombre ?? ""} ${empresa.admin_apellido ?? ""}`.trim() || empresa.admin_nombre || empresa.nombre
        token.slug = empresa.slug
        token.email = empresa.email ?? undefined
        token.aprobada = empresa.aprobada
        token.email_verificado = empresa.email_verificado
        token.mustChangePassword = empresa.must_change_password === true
      }

      if (token.userType === "comprador") {
        return {}
      }

      if ((token.userType === "super_admin" || token.userType === "platform_staff") && token.id) {
        await ensurePasswordVersionColumns()
        const admin = await prisma.platformAdminUser.findUnique({
          where: { id: token.id as string },
          select: { id: true, nombre: true, email: true, permisos: true, role_slug: true, singleton_key: true, activo: true, must_change_password: true, password_changed_at: true },
        })

        if (!admin || !admin.activo) {
          return {}
        }

        const passwordVersion = await getPlatformAdminPasswordVersion(String(token.id))
        if (token.passwordVersion && passwordVersion !== null && token.passwordVersion !== passwordVersion) {
          return {}
        }
        token.passwordVersion = passwordVersion

        token.name = admin.nombre
        token.accountName = admin.nombre
        token.email = admin.email
        token.slug = ""
        token.roleSlug = normalizePlatformRoleSlug(admin.role_slug)
        token.singletonKey = admin.singleton_key ?? null
        const viewerPolicy = await resolveFrontendPlatformViewerPolicy(
          admin.id,
          normalizePlatformRoleSlug(admin.role_slug),
          admin.singleton_key ?? null,
          admin.permisos ? JSON.parse(admin.permisos) : undefined,
        )
        token.platformCapabilities = viewerPolicy.capabilities
        token.platformViewerPolicy = viewerPolicy
        token.permisos = mapCapabilitiesToLegacyPermissions(viewerPolicy.capabilities)
        token.userType = admin.role_slug === "superadmin" && admin.singleton_key === "superadmin"
          ? "super_admin"
          : "platform_staff"
        token.mustChangePassword = token.userType === "platform_staff" && admin.must_change_password === true
      }

      return token
    },
    async session({ session, token }) {
      if (token) {
        session.user.id = token.id as string
        session.user.slug = token.slug as string
        session.user.accountName = (token.accountName as string | null | undefined) ?? session.user.name ?? undefined
        session.user.userType = token.userType as FrontendUserType
        session.user.empresa_id = token.empresa_id as string
        session.user.empleadoRol = (token.empleadoRol as string | null | undefined) ?? null
        session.user.permisos = token.permisos as InternalPermissions
        session.user.roleSlug = token.roleSlug as "superadmin" | "staff" | undefined
        session.user.singletonKey = (token.singletonKey as string | null | undefined) ?? null
        session.user.platformCapabilities = token.platformCapabilities as PlatformCapabilityKey[] | undefined
        session.user.platformViewerPolicy = token.platformViewerPolicy as FrontendPlatformViewerPolicy | undefined
        session.user.mustChangePassword = token.mustChangePassword === true
        session.user.aprobada = token.aprobada as boolean | undefined
        session.user.email_verificado = token.email_verificado as boolean | undefined
        session.user.isImpersonated = token.isImpersonated === true
      }
      return session
    },
  },
})
