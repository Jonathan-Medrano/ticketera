import { auth } from "@/auth"
import ConfiguracionSection from "@/components/super-admin/configuracion-section"
import type { PlatformFeeConfigurationData } from "@/components/super-admin/types"
import { getPlatformConsoleHomePath, hasPlatformCapability, isPlatformConsoleActor } from "@/lib/internal-actor-routing"
import { fetchBackendFromServer } from "@/lib/server-backend"
import { redirect } from "next/navigation"

type PlatformConfigResponse = {
  data: PlatformFeeConfigurationData
}

export default async function SuperAdminConfiguracionPage({
  searchParams,
}: {
  searchParams: Promise<{ mercadopago_oauth?: string; reason?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  if (!isPlatformConsoleActor(session.user)) redirect("/dashboard")
  if (!hasPlatformCapability(session.user, "platform.settings.read")) redirect(getPlatformConsoleHomePath(session.user))

  const params = await searchParams

  const response = await fetchBackendFromServer<PlatformConfigResponse>("/api/platform/configuracion/fees")

  return (
    <ConfiguracionSection
      initialDefaultsByFlow={response.data.defaultsByFlow}
      initialOwnerPaymentAccount={response.data.ownerPaymentAccount}
      initialCurrentUserPaymentAccount={response.data.currentUserPaymentAccount}
      initialProfitSharingCutoff={response.data.profitSharingCutoff}
      canManageSingletonOnly={hasPlatformCapability(session.user, "platform.fees.defaults.edit")}
      viewerScope={response.data.viewerScope}
      oauthFlash={{
        status: params.mercadopago_oauth,
        reason: params.reason,
      }}
    />
  )
}
