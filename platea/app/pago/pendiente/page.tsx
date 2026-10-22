import { redirect } from "next/navigation"
import TenantPagoPendientePage from "@/app/t/[tenant]/pago/pendiente/page"
import { resolveTenantFromHost } from "@/lib/tenant-host"

export default async function PagoPendienteEntryPage() {
  const tenant = await resolveTenantFromHost()

  if (!tenant) {
    redirect("/")
  }

  return <TenantPagoPendientePage />
}
