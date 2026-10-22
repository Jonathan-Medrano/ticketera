// app/(empresa)/dashboard/configuracion/page.tsx
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import ConfiguracionContent from "@/components/dashboard/configuracion-content"
import { buildEmptyMarketplaceFeeByFlow, type EmpresaMarketplaceFeeContract } from "@/lib/empresa-fees"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"
import type { SalesReadinessReason, SalesReadinessStatus } from "@/lib/tenant"

type ConfiguracionResponse = {
  data: {
    id: string
    nombre: string
    slug: string
    email?: string | null
      admin_nombre?: string | null
      admin_apellido?: string | null
      tenant_public_disabled?: number | boolean
      mp_max_installments?: number
      sales_readiness?: {
      status: SalesReadinessStatus
      reason: SalesReadinessReason | null
      canSell: boolean
    }
  } & EmpresaMarketplaceFeeContract
}

export default async function ConfiguracionPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.ver_configuracion) redirect("/sin-acceso")

  let loadError: string | undefined
  const emptyFees = buildEmptyMarketplaceFeeByFlow()
  let empresa: ConfiguracionResponse["data"] = {
    id: session.user.empresa_id ?? session.user.id,
    nombre: session.user.name ?? "Empresa",
    slug: session.user.slug ?? "",
    email: session.user.email ?? "",
    admin_nombre: "",
    admin_apellido: "",
    tenant_public_disabled: false,
    mp_max_installments: 1,
    sales_readiness: {
      status: "missing_provider",
      reason: "missing_provider",
      canSell: false,
    },
    marketplace_fee: emptyFees.entradas,
    marketplaceFee: emptyFees.entradas,
    marketplace_fee_by_flow: emptyFees,
    marketplaceFeeByFlow: emptyFees,
  }

  try {
    const response = await fetchBackendFromServer<ConfiguracionResponse>("/api/configuracion")
    empresa = response.data
  } catch (error) {
    loadError = error instanceof Error ? error.message : "No se pudo cargar la configuración"
  }

  return <ConfiguracionContent empresa={empresa} permisos={permisos} esEmpleado={esEmpleado} loadError={loadError} />
}
