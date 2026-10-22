import { notFound } from "next/navigation"
import TenantConsumiblesEventoPage from "@/app/t/[tenant]/consumibles/[id]/page"
import { resolveTenantFromHost } from "@/lib/tenant-host"

export default async function ConsumiblesEventoEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const tenant = await resolveTenantFromHost()
  const { id } = await params

  if (!tenant) {
    notFound()
  }

  return <TenantConsumiblesEventoPage params={Promise.resolve({ tenant, id })} />
}
