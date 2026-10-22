import { redirect } from "next/navigation"
import TenantPagoErrorPage from "@/app/t/[tenant]/pago/error/page"
import { resolveTenantFromHost } from "@/lib/tenant-host"

export default async function PagoErrorEntryPage() {
  const tenant = await resolveTenantFromHost()

  if (!tenant) {
    redirect("/")
  }

  return <TenantPagoErrorPage />
}
