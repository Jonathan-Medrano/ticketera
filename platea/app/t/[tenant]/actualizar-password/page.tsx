import TenantNavbar from "@/components/tenant/tenant-navbar"
import TenantBuyerRotatePasswordContent from "@/components/tenant/tenant-buyer-rotate-password-content"
import { requireBuyerSessionForTenant } from "@/lib/buyer-session/server"

export default async function TenantBuyerRotatePasswordPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  // skipRotationCheck=true para evitar loop: esta página es justamente donde la
  // rotación se hace. Si chequeáramos, redirigiría a sí misma.
  await requireBuyerSessionForTenant(tenant, "actualizar-password", { skipRotationCheck: true })

  return (
    <>
      <TenantNavbar />
      <TenantBuyerRotatePasswordContent tenantSlug={tenant} />
    </>
  )
}
