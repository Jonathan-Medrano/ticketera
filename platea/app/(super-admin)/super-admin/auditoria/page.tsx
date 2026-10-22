import { auth } from "@/auth"
import AuditLogsSection from "@/components/super-admin/audit-logs-section"
import type { AuditLogsData } from "@/components/super-admin/audit-logs-section"
import { getPlatformConsoleHomePath, hasPlatformCapability, isPlatformConsoleActor } from "@/lib/internal-actor-routing"
import { fetchBackendFromServer } from "@/lib/server-backend"
import { redirect } from "next/navigation"

type PlatformAuditLogsResponse = {
  data: AuditLogsData
}

export default async function SuperAdminAuditoriaPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!isPlatformConsoleActor(session.user)) redirect("/dashboard")
  if (!hasPlatformCapability(session.user, "platform.settings.read")) {
    redirect(getPlatformConsoleHomePath(session.user))
  }

  const response = await fetchBackendFromServer<PlatformAuditLogsResponse>("/api/platform/audit-logs?page=1&limit=50")

  return <AuditLogsSection initialData={response.data} />
}
