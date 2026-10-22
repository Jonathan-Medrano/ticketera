import { auth } from "@/auth"
import { redirect } from "next/navigation"
import RevendedorSidebar from "@/components/revendedor/revendedor-sidebar"
import LoadingProvider from "@/components/loading-provider"
import VictoriaWidget from "@/components/dashboard/victoria/victoria-widget"
import { isRevendedor, type Permisos } from "@/lib/permisos"
import { PASSWORD_ROTATION_PATH } from "@/lib/password-rotation"

export default async function RevendedorLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/login?reason=session")

  if (!session.user.id || !session.user.userType) redirect("/login?reason=session")

  if (session.user.userType === "empresa") redirect("/dashboard")
  if (session.user.userType !== "empleado") redirect("/login?reason=session")
  if (!session.user.empresa_id) redirect("/login?reason=session")
  if (session.user.mustChangePassword) redirect(PASSWORD_ROTATION_PATH)

  const permisos = session.user.permisos as Permisos | undefined

  // Fuente de verdad: rol en DB (empleadoRol). Fallback a heurística por
  // permisos para compatibilidad con sessions viejas que no traen empleadoRol.
  const esRevendedor = isRevendedor({ empleadoRol: session.user.empleadoRol, permisos })
  if (!esRevendedor) redirect("/sin-acceso")

  return (
    <LoadingProvider>
      <div className="flex h-screen bg-card overflow-hidden">
        <RevendedorSidebar
          nombre={session.user.name ?? ""}
          empresaId={session.user.empresa_id ?? ""}
        />
        <main className="flex-1 overflow-y-auto min-w-0">
          <div className="p-4 pt-16 md:pt-6 md:p-6 lg:p-8">{children}</div>
        </main>
      </div>
      <VictoriaWidget permisos={permisos} userType={session.user.userType} />
    </LoadingProvider>
  )
}
