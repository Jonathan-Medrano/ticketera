import { redirect } from "next/navigation"

import ReembolsosContent from "@/components/dashboard/reembolsos-content"
import type { RefundManualCaseDetail } from "@/components/dashboard/reembolsos-model"
import { requireDashboardSession } from "@/lib/dashboard-auth"
import { fetchBackendFromServer } from "@/lib/server-backend"
import { loadRefundsDashboardData } from "./page-model"

export default async function ReembolsosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { esEmpleado, permisos } = await requireDashboardSession()

  if (esEmpleado && !permisos?.gestionar_reembolsos) {
    redirect("/sin-acceso")
  }

  const params = await searchParams
  const data = await loadRefundsDashboardData({ searchParams: params, fetchBackendFromServer })
  const cases = data.cases
  const selectedCaseId = data.selectedCaseId && data.cases.some((refundCase) => refundCase.id === data.selectedCaseId)
    ? data.selectedCaseId
    : cases[0]?.id

  const selectedCase = selectedCaseId
    ? await fetchBackendFromServer<RefundManualCaseDetail>(`/api/reembolsos/${selectedCaseId}`)
    : null

  return (
    <ReembolsosContent
      cases={cases}
      selectedCase={selectedCase}
      automaticRefundConfig={data.automaticRefundConfig}
      buyerEventRefundsEnabled={data.buyerEventRefundsEnabled}
      initialFilters={data.initialFilters}
      exportPath={data.exportPath}
      access={{
        canCreateManualCases: !esEmpleado,
        canMutateEntryCases: !esEmpleado,
        canMutateBuyerConsumibleCases: !esEmpleado || Boolean(permisos?.gestionar_consumibles),
        canMutateCompanyConsumibleCases: !esEmpleado,
      }}
    />
  )
}
