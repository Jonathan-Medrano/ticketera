import { auth } from "@/auth"
import CobrosContent from "@/components/dashboard/cobros-content"
import { buildEmptyMarketplaceFeeByFlow, type EmpresaMarketplaceFeeContract } from "@/lib/empresa-fees"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"
import type { SalesReadinessReason, SalesReadinessStatus } from "@/lib/tenant"
import { redirect } from "next/navigation"

type CobrosMercadoPagoResponse = {
  data: {
    provider: "mercadopago"
    payment_account: {
      id: string
      provider: "mercadopago"
      status: "pending_validation" | "ready_to_sell" | "blocked"
      reason: SalesReadinessReason | null
      credentialLast4: string | null
      providerAccountLabel: string | null
      validatedAt: string | null
      blockedAt: string | null
      updatedAt: string
    } | null
    sales_readiness: {
      status: SalesReadinessStatus
      reason: SalesReadinessReason | null
      canSell: boolean
    }
  } & EmpresaMarketplaceFeeContract
}

export default async function CobrosPage({
  searchParams,
}: {
  searchParams: Promise<{ mercadopago_oauth?: string; reason?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.ver_configuracion) redirect("/sin-acceso")
  const params = await searchParams

  let loadError: string | undefined
  const emptyFees = buildEmptyMarketplaceFeeByFlow()
  let initialData: CobrosMercadoPagoResponse["data"] = {
    provider: "mercadopago",
    payment_account: null,
    marketplace_fee: emptyFees.entradas,
    marketplaceFee: emptyFees.entradas,
    marketplace_fee_by_flow: emptyFees,
    marketplaceFeeByFlow: emptyFees,
    sales_readiness: {
      status: "missing_provider",
      reason: "missing_provider",
      canSell: false,
    },
  }

  try {
    const response = await fetchBackendFromServer<CobrosMercadoPagoResponse>("/api/cobros/mercadopago")
    initialData = response.data
  } catch (error) {
    loadError = error instanceof Error ? error.message : "No se pudo cargar la configuración de cobros"
  }

  return (
    <CobrosContent
      initialData={initialData}
      permisos={permisos}
      esEmpleado={esEmpleado}
      loadError={loadError}
      oauthFlash={{
        status: params.mercadopago_oauth,
        reason: params.reason,
      }}
    />
  )
}
