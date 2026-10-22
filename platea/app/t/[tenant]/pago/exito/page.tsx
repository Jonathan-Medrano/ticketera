import TenantNavbar from "@/components/tenant/tenant-navbar"
import PagoExitoContent from "@/components/tenant/pago-exito-content"
import { enforceBuyerPasswordRotation } from "@/lib/buyer-session/server"

export default async function PagoExitoPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenant: string }>
  searchParams: Promise<{ confirmed?: string }>
}) {
  const { tenant } = await params
  await enforceBuyerPasswordRotation(tenant)
  const { confirmed } = await searchParams
  return (
    <>
      <TenantNavbar />
      <PagoExitoContent confirmed={confirmed === "1"} />
    </>
  )
}
