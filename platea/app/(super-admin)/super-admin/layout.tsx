import { auth } from "@/auth"
import { isPlatformConsoleActor } from "@/lib/internal-actor-routing"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import LoadingProvider from "@/components/loading-provider"
import { SuperAdminThemeProvider } from "@/components/theme-provider"
import { Toaster } from "sonner"
import SuperAdminSidebar from "@/components/super-admin/sidebar"
import { normalizeSuperAdminTheme, SUPER_ADMIN_THEME_COOKIE_KEY } from "@/components/super-admin/theme"

export default async function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  const cookieStore = await cookies()
  const initialTheme = normalizeSuperAdminTheme(cookieStore.get(SUPER_ADMIN_THEME_COOKIE_KEY)?.value, "dark")
  if (!session) redirect("/login")

  if (!isPlatformConsoleActor(session.user)) {
    redirect(session.user.userType === "comprador" ? "/" : "/dashboard")
  }

  return (
    <LoadingProvider>
      <SuperAdminThemeProvider initialTheme={initialTheme}>
        <div className="super-admin-shell h-screen overflow-hidden bg-background text-foreground">
          <div className="flex h-full overflow-hidden bg-[var(--superadmin-shell-gradient)]">
            <SuperAdminSidebar
              ownerName={session.user.name ?? session.user.email ?? "Owner"}
              roleSlug={session.user.roleSlug}
              singletonKey={session.user.singletonKey}
              permisos={session.user.permisos as never}
              platformCapabilities={session.user.platformCapabilities}
              viewerPolicy={session.user.platformViewerPolicy}
            />
            <main id="main-content" className="min-w-0 flex-1 overflow-y-auto">
              <div className="min-h-full px-4 pb-4 pt-16 md:px-5 lg:px-6 lg:py-6">{children}</div>
            </main>
          </div>
        </div>
        <Toaster richColors position="top-right" />
      </SuperAdminThemeProvider>
    </LoadingProvider>
  )
}
