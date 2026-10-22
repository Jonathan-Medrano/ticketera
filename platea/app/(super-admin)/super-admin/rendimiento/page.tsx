import { auth } from "@/auth"
import PerformanceSection from "@/components/super-admin/performance-section"
import { getPlatformConsoleHomePath, hasPlatformCapability, isPlatformConsoleActor } from "@/lib/internal-actor-routing"
import { redirect } from "next/navigation"

export default async function SuperAdminRendimientoPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!isPlatformConsoleActor(session.user)) redirect("/dashboard")
  if (!hasPlatformCapability(session.user, "platform.companies.read")) {
    redirect(getPlatformConsoleHomePath(session.user))
  }

  return <PerformanceSection />
}
