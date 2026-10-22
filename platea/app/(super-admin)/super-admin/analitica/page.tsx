import { auth } from "@/auth"
import RevenueAnalyticsSection from "@/components/super-admin/revenue-analytics-section"
import type { RevenueTimelineData } from "@/components/super-admin/revenue-analytics-section"
import { getPlatformConsoleHomePath, hasPlatformCapability, isPlatformConsoleActor } from "@/lib/internal-actor-routing"
import { fetchBackendFromServer } from "@/lib/server-backend"
import { redirect } from "next/navigation"

type PlatformRevenueTimelineResponse = {
  data: RevenueTimelineData
}

export default async function SuperAdminAnaliticaPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!isPlatformConsoleActor(session.user)) redirect("/dashboard")
  if (!hasPlatformCapability(session.user, "platform.revenue.view.own")) {
    redirect(getPlatformConsoleHomePath(session.user))
  }

  const response = await fetchBackendFromServer<PlatformRevenueTimelineResponse>("/api/platform/analitica/revenue-timeline?days=30")

  return <RevenueAnalyticsSection initialData={response.data} />
}
