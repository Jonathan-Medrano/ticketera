import { redirect } from "next/navigation"
import ComisionesContent from "@/components/dashboard/comisiones-content"
import { requireDashboardSession } from "@/lib/dashboard-auth"
import { puedeHacer } from "@/lib/permisos"

export default async function ComisionesPage() {
  const { permisos, esEmpleado } = await requireDashboardSession()

  // Solo accesible si la cuenta puede ver datos financieros (mismo gate que reconciliación).
  const puedeVer = puedeHacer("ver_recaudacion", esEmpleado, permisos)
  if (!puedeVer) redirect("/sin-acceso")

  return <ComisionesContent />
}
