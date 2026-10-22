import NextAuth from "next-auth"
import { NextResponse } from "next/server"
import { authConfig } from "@/auth.config"
import { getMainDomainCandidates } from "@/lib/host-domains"
import { getPlatformConsoleHomePath, isPlatformConsoleActor, type FrontendUserType, type PlatformCapabilityKey, type PlatformRoleSlug } from "@/lib/internal-actor-routing"
import { PASSWORD_ROTATION_PATH, isPasswordRotationPath, shouldForcePasswordRotation } from "@/lib/password-rotation"
import { isRevendedor, type Permisos } from "@/lib/permisos"

const { auth } = NextAuth(authConfig)

type ProxyUser = {
  id?: string
  slug?: string
  email?: string | null
  userType?: FrontendUserType
  empresa_id?: string
  empleadoRol?: string | null
  permisos?: Permisos | null
  singletonKey?: string | null
  roleSlug?: PlatformRoleSlug | null
  platformCapabilities?: PlatformCapabilityKey[] | null
  mustChangePassword?: boolean | null
  email_verificado?: boolean | null
  aprobada?: boolean | null
}

export const proxy = auth(async function proxy(req) {
  const isLoggedIn = !!req.auth
  const user = (req.auth?.user as ProxyUser | undefined) ?? undefined
  const userType = user?.userType
  const hasValidIdentity = !!user?.id && !!userType && (
    userType === "empleado"
        ? !!user.empresa_id
        : userType === "empresa"
          ? !!user.slug
          : isPlatformConsoleActor(user ?? {})
  )

  const { pathname } = req.nextUrl
  const hostHeader = req.headers.get("x-forwarded-host") || req.headers.get("host") || ""
  const hostname = hostHeader.split(":")[0] || req.nextUrl.hostname

  const candidateRootDomains = getMainDomainCandidates()
  const matchedRoot = candidateRootDomains.find(
    (domain) => hostname === domain || hostname === `www.${domain}` || hostname.endsWith(`.${domain}`)
  )

  const isMainDomain =
    candidateRootDomains.includes(hostname) ||
    candidateRootDomains.some((domain) => hostname === `www.${domain}`)

  const isSubdomain = !isMainDomain && !!matchedRoot
  const internalAppRoutes = ["/dashboard", "/revendedor", "/super-admin", "/login", "/auth", "/sin-acceso"]
  const isInternalAppRoute = internalAppRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`))

  if (isSubdomain) {
    if (
      pathname.startsWith("/_next") ||
      pathname.startsWith("/api") ||
      pathname.includes(".")
    ) {
      return NextResponse.next()
    }

    // Setea x-tenant-path en TODOS los flows del tenant (incluyendo cuando la
    // URL viene ya con /t/[tenant]/ prefix por un redirect interno). Sin esto
    // el layout no sabe en qué path está y vuelve a enforceBuyerPasswordRotation
    // → loop infinito.
    if (pathname.startsWith("/t/")) {
      const headers = new Headers(req.headers)
      // pathname = "/t/empresaprueba/foo" → tenantPath = "/foo"
      const tenantPath = pathname.replace(/^\/t\/[^/]+/, "") || "/"
      headers.set("x-tenant-path", tenantPath)
      return NextResponse.next({ request: { headers } })
    }

    if (isInternalAppRoute) {
      return NextResponse.next()
    }

    const tenant = hostname.replace(`.${matchedRoot}`, "")
    const url = req.nextUrl.clone()
    url.pathname = `/t/${tenant}${pathname}`
    const headers = new Headers(req.headers)
    headers.set("x-tenant-path", pathname)
    return NextResponse.rewrite(url, { request: { headers } })
  }

  // Acceso por dominio principal + path /t/[tenant]/... (sin subdominio).
  // Seteamos x-tenant-path igual que en el flujo por subdominio (ver arriba)
  // para que tenant-surface-shell.tsx pueda suprimir analytics en rutas
  // sensibles (/auth/token, /auth/reset) sin importar la forma de acceso.
  // Estos paths no matchean protectedRoutes/login más abajo, así que esto
  // no cambia ningún comportamiento existente, solo agrega el header.
  if (pathname.startsWith("/t/")) {
    const headers = new Headers(req.headers)
    const tenantPath = pathname.replace(/^\/t\/[^/]+/, "") || "/"
    headers.set("x-tenant-path", tenantPath)
    return NextResponse.next({ request: { headers } })
  }

  const protectedRoutes = ["/dashboard", "/revendedor", "/super-admin"]
  const isProtected = protectedRoutes.some((route) => pathname.startsWith(route))

  if (isProtected && !isLoggedIn) {
    return NextResponse.redirect(new URL("/login", req.url))
  }

  // Gating central de empresa para sesiones LOGUEADAS sobre rutas protegidas.
  // Espeja el guard de requireDashboardSession() pero a nivel middleware para
  // cubrir TODO el árbol protegido (no solo (empresa)/dashboard). Solo aplica a
  // userType === "empresa": empleados / superadmin / platform_staff quedan
  // intactos. Bloqueamos SOLO cuando el flag es EXPLÍCITAMENTE false (no
  // undefined/true) para no romper sesiones viejas ni empresas ya verificadas.
  // /verificar-email y /pendiente-aprobacion NO están en protectedRoutes → no
  // hay loop de redirect.
  if (isProtected && isLoggedIn && userType === "empresa") {
    if (user?.email_verificado === false) {
      const verificarUrl = new URL("/verificar-email", req.url)
      if (user.email) verificarUrl.searchParams.set("email", user.email)
      return NextResponse.redirect(verificarUrl)
    }
    if (user?.aprobada === false) {
      return NextResponse.redirect(new URL("/pendiente-aprobacion", req.url))
    }
  }

  if (isLoggedIn && !hasValidIdentity && pathname === "/login") {
    return NextResponse.next()
  }

  if (isLoggedIn && pathname === "/login") {
    if (shouldForcePasswordRotation(user)) {
      return NextResponse.redirect(new URL(PASSWORD_ROTATION_PATH, req.url))
    }

    if (isPlatformConsoleActor(user ?? {})) {
      return NextResponse.redirect(new URL(getPlatformConsoleHomePath(user ?? {}), req.url))
    }

    if (userType === "empresa" || userType === "empleado") {
      const home = userType === "empleado" && isRevendedor(user) ? "/revendedor" : "/dashboard"
      return NextResponse.redirect(new URL(home, req.url))
    }

    return NextResponse.next()
  }

  if (shouldForcePasswordRotation(user) && !isPasswordRotationPath(pathname)) {
    if (pathname.startsWith("/dashboard") || pathname.startsWith("/revendedor") || pathname.startsWith("/super-admin")) {
      return NextResponse.redirect(new URL(PASSWORD_ROTATION_PATH, req.url))
    }
  }

  return NextResponse.next()
})

export const config = {
  matcher: ["/", "/((?!_next|favicon\\.ico|api|opengraph-image|robots\\.txt|sitemap\\.xml|icon).*)"],
}
