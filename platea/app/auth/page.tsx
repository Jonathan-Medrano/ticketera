import { redirect } from "next/navigation"
import TenantAuthPage from "@/app/t/[tenant]/auth/page"
import TenantSurfaceShell from "@/components/tenant/tenant-surface-shell"
import { resolveTenantFromHost } from "@/lib/tenant-host"

export default async function AuthEntryPage() {
  const tenant = await resolveTenantFromHost()

  if (!tenant) {
    redirect("/login")
  }

  return <TenantSurfaceShell tenant={tenant}><TenantAuthPage /></TenantSurfaceShell>
}
