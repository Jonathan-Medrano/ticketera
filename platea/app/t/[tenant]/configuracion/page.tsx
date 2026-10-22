import TenantNavbar from "@/components/tenant/tenant-navbar"
import TenantBuyerSettingsContent, { type BuyerAccountSnapshot } from "@/components/tenant/tenant-buyer-settings-content"
import { requireBuyerSessionForTenant } from "@/lib/buyer-session/server"
import { fetchTenantBackendFromServer } from "@/lib/server-backend"

type BuyerAccountResponse = {
  data: BuyerAccountSnapshot
}

export default async function TenantBuyerSettingsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  await requireBuyerSessionForTenant(tenant, "configuracion")

  const response = await fetchTenantBackendFromServer<BuyerAccountResponse>(`/api/tenant/${tenant}/account`, tenant)

  return (
    <>
      <TenantNavbar />
      <TenantBuyerSettingsContent initialSnapshot={response.data} />
    </>
  )
}
