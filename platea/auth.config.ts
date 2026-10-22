import type { NextAuthConfig } from "next-auth"
import { createGoogleAuthProvider } from "@/lib/google-auth"
import { getPlatformConsoleHomePath, isPlatformConsoleActor, type FrontendUserType, type PlatformCapabilityKey, type PlatformRoleSlug } from "@/lib/internal-actor-routing"
import { PASSWORD_ROTATION_PATH, isPasswordRotationPath, shouldForcePasswordRotation } from "@/lib/password-rotation"

export const authConfig: NextAuthConfig = {
  session: { strategy: "jwt" },
  pages: { signIn: "/login" },
  providers: [
    createGoogleAuthProvider(),
  ],
  callbacks: {
    // Minimal session callback para que el middleware (proxy.ts) tenga acceso
    // a empleadoRol, mustChangePassword, etc desde el JWT. La lógica completa
    // (refresh desde DB) vive en auth.ts y solo aplica en server components,
    // que llaman a auth() directamente desde @/auth.
    async session({ session, token }) {
      if (token && session.user) {
        const t = token as Record<string, unknown>
        session.user.id = (t.id as string | undefined) ?? session.user.id
        session.user.userType = t.userType as FrontendUserType | undefined
        session.user.empresa_id = t.empresa_id as string | undefined
        session.user.empleadoRol = (t.empleadoRol as string | null | undefined) ?? null
        session.user.singletonKey = (t.singletonKey as string | null | undefined) ?? null
        session.user.roleSlug = t.roleSlug as PlatformRoleSlug | undefined
        session.user.platformCapabilities = t.platformCapabilities as PlatformCapabilityKey[] | undefined
        session.user.permisos = t.permisos as typeof session.user.permisos
        session.user.mustChangePassword = t.mustChangePassword === true
      }
      return session
    },
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const user = auth?.user as {
        userType?: FrontendUserType
        singletonKey?: string | null
        roleSlug?: PlatformRoleSlug | null
        permisos?: Record<string, boolean> | null
        platformCapabilities?: PlatformCapabilityKey[] | null
        mustChangePassword?: boolean | null
      } | undefined

      const isDashboard = nextUrl.pathname.startsWith("/dashboard")
      const isRevendedor = nextUrl.pathname.startsWith("/revendedor")
      const isSuperAdmin = nextUrl.pathname.startsWith("/super-admin")
      const isProtected = isDashboard || isRevendedor || isSuperAdmin

      // Rutas protegidas — si no está logueado, mandar al login
      if (isProtected && !isLoggedIn) {
        return Response.redirect(new URL("/login?reason=session", nextUrl))
      }

      if (isLoggedIn && shouldForcePasswordRotation(user)) {
        if (isPasswordRotationPath(nextUrl.pathname)) return true
        if (isDashboard || isRevendedor || isSuperAdmin || nextUrl.pathname === "/login") {
          return Response.redirect(new URL(PASSWORD_ROTATION_PATH, nextUrl))
        }
      }

      if (isLoggedIn && isPlatformConsoleActor(user ?? {}) && (isDashboard || isRevendedor)) {
        return Response.redirect(new URL(getPlatformConsoleHomePath(user ?? {}), nextUrl))
      }

      return true
    },
  },
}
