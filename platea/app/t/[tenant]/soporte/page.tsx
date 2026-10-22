import TenantNavbar from "@/components/tenant/tenant-navbar"
import SoporteContent from "@/components/tenant/soporte-content"
import { enforceBuyerPasswordRotation } from "@/lib/buyer-session/server"

export default async function SoportePage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  await enforceBuyerPasswordRotation(tenant)

  return (
    <>
      <TenantNavbar />
      <SoporteContent />
    </>
  )
}
