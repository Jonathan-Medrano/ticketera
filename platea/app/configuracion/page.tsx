import { redirect } from "next/navigation"
import TenantBuyerSettingsPage from "@/app/t/[tenant]/configuracion/page"
import TenantSurfaceShell from "@/components/tenant/tenant-surface-shell"
import { resolveTenantFromHost } from "@/lib/tenant-host"

export default async function BuyerSettingsEntryPage() {
  const tenant = await resolveTenantFromHost()

  if (!tenant) {
    redirect("/")
  }

  return <TenantSurfaceShell tenant={tenant}><TenantBuyerSettingsPage params={Promise.resolve({ tenant })} /></TenantSurfaceShell>
}
