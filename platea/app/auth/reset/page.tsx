import { redirect } from "next/navigation"
import TenantAuthResetPage from "@/app/t/[tenant]/auth/reset/page"
import TenantSurfaceShell from "@/components/tenant/tenant-surface-shell"
import { resolveTenantFromHost } from "@/lib/tenant-host"

export default async function AuthResetEntryPage() {
  const tenant = await resolveTenantFromHost()

  if (!tenant) {
    redirect("/login")
  }

  return (
    <TenantSurfaceShell tenant={tenant} suppressAnalytics>
      <TenantAuthResetPage />
    </TenantSurfaceShell>
  )
}
