import { redirect } from "next/navigation"
import TenantConsumiblesPage from "@/app/t/[tenant]/consumibles/page"
import { resolveTenantFromHost } from "@/lib/tenant-host"

export default async function ConsumiblesEntryPage() {
  const tenant = await resolveTenantFromHost()

  if (!tenant) {
    redirect("/")
  }

  return <TenantConsumiblesPage params={Promise.resolve({ tenant })} />
}
