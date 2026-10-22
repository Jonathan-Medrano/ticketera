import TenantHome from "@/components/tenant/tenant-home"
import { fetchPublicBackendFromServer } from "@/lib/server-backend"
import { enforceBuyerPasswordRotation } from "@/lib/buyer-session/server"
import type { TenantEventoResumen } from "@/lib/tenant"

export default async function TenantPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  await enforceBuyerPasswordRotation(tenant)

  const eventosResponse = await fetchPublicBackendFromServer<{ data: { eventos: TenantEventoResumen[] } }>(
    `/api/tenant/${tenant}/eventos`,
    { revalidate: 60, tags: [`tenant:${tenant}`] }
  )

  return <TenantHome eventos={eventosResponse.data.eventos} />
}
