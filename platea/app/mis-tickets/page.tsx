import { redirect } from "next/navigation"
import TenantMisTicketsPage from "@/app/t/[tenant]/mis-tickets/page"
import TenantSurfaceShell from "@/components/tenant/tenant-surface-shell"
import { resolveTenantFromHost } from "@/lib/tenant-host"

export default async function MisTicketsEntryPage() {
  const tenant = await resolveTenantFromHost()

  if (!tenant) {
    redirect("/")
  }

  return <TenantSurfaceShell tenant={tenant}><TenantMisTicketsPage params={Promise.resolve({ tenant })} /></TenantSurfaceShell>
}
