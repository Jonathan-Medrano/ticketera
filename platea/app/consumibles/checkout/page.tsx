import { redirect } from "next/navigation"
import TenantConsumiblesCheckoutPage from "@/app/t/[tenant]/consumibles/checkout/page"
import TenantSurfaceShell from "@/components/tenant/tenant-surface-shell"
import { resolveTenantFromHost } from "@/lib/tenant-host"

export function renderConsumiblesCheckoutEntryForTenant(tenant: string) {
  return (
    <TenantSurfaceShell tenant={tenant}>
      <TenantConsumiblesCheckoutPage params={Promise.resolve({ tenant })} />
    </TenantSurfaceShell>
  )
}

export default async function ConsumiblesCheckoutEntryPage() {
  const tenant = await resolveTenantFromHost()

  if (!tenant) {
    redirect("/")
  }

  return renderConsumiblesCheckoutEntryForTenant(tenant)
}
