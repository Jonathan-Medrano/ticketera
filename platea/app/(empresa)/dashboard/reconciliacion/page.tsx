import { redirect } from "next/navigation"
import ReconciliacionContent, { type ReconciliacionData } from "@/components/dashboard/reconciliacion-content"
import { requireDashboardSession } from "@/lib/dashboard-auth"
import { puedeHacer } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"

type ReconciliacionPageSearchParams = {
  page?: string
  estado?: string
  evento_id?: string
  desde?: string
  hasta?: string
  busqueda?: string
}

type ReconciliacionResponse = {
  data: ReconciliacionData
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

export default async function ReconciliacionPage({
  searchParams,
}: {
  searchParams: Promise<ReconciliacionPageSearchParams>
}) {
  const { permisos, esEmpleado } = await requireDashboardSession()

  // Solo accesible si la cuenta puede ver datos financieros
  const puedeVer = puedeHacer("ver_recaudacion", esEmpleado, permisos)
  if (!puedeVer) redirect("/sin-acceso")

  const resolved = await searchParams
  const qs = new URLSearchParams()
  if (resolved.page) qs.set("page", resolved.page)
  if (resolved.estado) qs.set("estado", resolved.estado)
  if (resolved.evento_id) qs.set("evento_id", resolved.evento_id)
  if (resolved.desde) qs.set("desde", resolved.desde)
  if (resolved.hasta) qs.set("hasta", resolved.hasta)
  if (resolved.busqueda) qs.set("busqueda", resolved.busqueda)

  const response = await fetchBackendFromServer<ReconciliacionResponse>(
    `/api/reconciliacion/pagos-sin-emitir${qs.toString() ? `?${qs.toString()}` : ""}`,
  )

  const puedeGestionarReembolsos = puedeHacer("gestionar_reembolsos", esEmpleado, permisos)

  return (
    <ReconciliacionContent
      data={response.data}
      pagination={response.pagination}
      puedeGestionarReembolsos={puedeGestionarReembolsos}
    />
  )
}
