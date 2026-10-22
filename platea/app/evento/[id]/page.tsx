import { notFound } from "next/navigation"
import TenantEventoPage from "@/app/t/[tenant]/evento/[id]/page"
import { resolveTenantFromHost } from "@/lib/tenant-host"

export default async function EventoEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const tenant = await resolveTenantFromHost()
  const { id } = await params

  if (!tenant) {
    notFound()
  }

  return <TenantEventoPage params={Promise.resolve({ tenant, id })} />
}
