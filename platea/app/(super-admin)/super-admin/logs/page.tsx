import { auth } from "@/auth"
import { redirect } from "next/navigation"
import ErrorLogsSection from "@/components/super-admin/error-logs-section"
import { getPlatformConsoleHomePath, hasPlatformCapability, isPlatformConsoleActor } from "@/lib/internal-actor-routing"

export default async function SuperAdminLogsPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!isPlatformConsoleActor(session.user)) redirect("/dashboard")
  if (!hasPlatformCapability(session.user, "platform.settings.read")) {
    redirect(getPlatformConsoleHomePath(session.user))
  }

  return <ErrorLogsSection />
}
