import { redirect } from "next/navigation"
import TenantPagoExitoPage from "@/app/t/[tenant]/pago/exito/page"
import { resolveTenantFromHost } from "@/lib/tenant-host"

export default async function PagoExitoEntryPage({
  searchParams,
}: {
  searchParams: Promise<{ confirmed?: string }>
}) {
  const tenant = await resolveTenantFromHost()

  if (!tenant) {
    redirect("/")
  }

  return <TenantPagoExitoPage params={Promise.resolve({ tenant })} searchParams={searchParams} />
}
