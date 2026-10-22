import { auth } from "@/auth"
import { redirect } from "next/navigation"
import type { Permisos } from "@/lib/permisos"
import MarketingContent from "@/components/dashboard/marketing-content"

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.ver_marketing) redirect("/sin-acceso")

  return (
    <div className="flex flex-col">
      <MarketingContent />
      {children}
    </div>
  )
}
