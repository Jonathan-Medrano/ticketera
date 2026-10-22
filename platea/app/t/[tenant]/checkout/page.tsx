import TenantNavbar from "@/components/tenant/tenant-navbar"
import CheckoutContent from "@/components/tenant/checkout-content"
import { requireBuyerSessionForTenant } from "@/lib/buyer-session/server"

export default async function CheckoutPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  await requireBuyerSessionForTenant(tenant, "checkout")
  return (
    <>
      <TenantNavbar />
      <CheckoutContent />
    </>
  )
}
