import TenantNavbar from "@/components/tenant/tenant-navbar"
import ConsumiblesCheckoutContent from "@/components/tenant/consumibles-checkout-content"
import { requireBuyerSessionForTenant } from "@/lib/buyer-session/server"

export default async function TenantConsumiblesCheckoutPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  await requireBuyerSessionForTenant(tenant, "consumibles/checkout")

  return (
    <>
      <TenantNavbar />
      <ConsumiblesCheckoutContent />
    </>
  )
}
