import { auth } from "@/auth"
import DashboardSection from "@/components/super-admin/dashboard-section"
import { normalizePlatformDashboardData, type PlatformDashboardResponseData } from "@/components/super-admin/types"
import { getPlatformConsoleHomePath, hasPlatformCapability, isPlatformConsoleActor } from "@/lib/internal-actor-routing"
import { fetchBackendFromServer } from "@/lib/server-backend"
import { redirect } from "next/navigation"

type PlatformDashboardResponse = {
  data: PlatformDashboardResponseData
}

export default async function SuperAdminDashboardPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!isPlatformConsoleActor(session.user)) redirect("/dashboard")
  if (!hasPlatformCapability(session.user, "platform.revenue.view.own")) redirect(getPlatformConsoleHomePath(session.user))

  const dashboard = await fetchBackendFromServer<PlatformDashboardResponse>("/api/platform/dashboard")
  const normalizedDashboard = normalizePlatformDashboardData(dashboard.data)

  return <DashboardSection ownerName={session.user.name ?? session.user.email ?? "Owner"} dashboard={normalizedDashboard} />
}
