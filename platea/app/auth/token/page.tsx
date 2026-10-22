import { redirect } from "next/navigation"
import TenantAuthTokenPage from "@/app/t/[tenant]/auth/token/page"
import TenantSurfaceShell from "@/components/tenant/tenant-surface-shell"
import { resolveTenantFromHost } from "@/lib/tenant-host"

export default async function AuthTokenEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const tenant = await resolveTenantFromHost()

  if (!tenant) {
    redirect("/login")
  }

  return (
    <TenantSurfaceShell tenant={tenant} suppressAnalytics>
      <TenantAuthTokenPage searchParams={searchParams} />
    </TenantSurfaceShell>
  )
}
