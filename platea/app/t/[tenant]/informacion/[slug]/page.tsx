import TenantNavbar from "@/components/tenant/tenant-navbar"
import TenantInfoPage from "@/components/tenant/tenant-info-page"
import { getTenantInfoPageKeyFromSlug } from "@/lib/tenant-info"
import { enforceBuyerPasswordRotation } from "@/lib/buyer-session/server"
import { notFound } from "next/navigation"

export default async function TenantInformacionPage({
  params,
}: {
  params: Promise<{ tenant: string; slug: string }>
}) {
  const { tenant, slug } = await params
  await enforceBuyerPasswordRotation(tenant)
  const pageKey = getTenantInfoPageKeyFromSlug(slug)
  if (!pageKey) notFound()

  return (
    <>
      <TenantNavbar />
      <TenantInfoPage pageKey={pageKey} />
    </>
  )
}
