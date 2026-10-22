import TenantNavbar from "@/components/tenant/tenant-navbar"
import TenantConsumiblesHub from "@/components/tenant/tenant-consumibles-hub"
import { fetchPublicBackendFromServer } from "@/lib/server-backend"
import { enforceBuyerPasswordRotation } from "@/lib/buyer-session/server"
import type { TenantConsumiblesEventoResumen } from "@/lib/tenant"

type TenantConsumiblesResponse = {
  data: {
    eventos: TenantConsumiblesEventoResumen[]
  }
}

export default async function TenantConsumiblesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  await enforceBuyerPasswordRotation(tenant)

  const response = await fetchPublicBackendFromServer<TenantConsumiblesResponse>(`/api/tenant/${tenant}/consumibles`, {
    revalidate: 60,
    tags: [`tenant:${tenant}`],
  }).catch(() => ({ data: { eventos: [] } }))

  return (
    <>
      <TenantNavbar />
      <TenantConsumiblesHub eventos={response.data.eventos} />
    </>
  )
}
