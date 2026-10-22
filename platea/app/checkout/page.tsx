import { redirect } from "next/navigation"
import TenantCheckoutPage from "@/app/t/[tenant]/checkout/page"
import TenantSurfaceShell from "@/components/tenant/tenant-surface-shell"
import { resolveTenantFromHost } from "@/lib/tenant-host"

export default async function CheckoutEntryPage() {
  const tenant = await resolveTenantFromHost()

  if (!tenant) {
    redirect("/")
  }

  return <TenantSurfaceShell tenant={tenant}><TenantCheckoutPage params={Promise.resolve({ tenant })} /></TenantSurfaceShell>
}
