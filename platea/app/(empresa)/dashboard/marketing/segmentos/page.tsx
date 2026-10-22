import { auth } from "@/auth"
import { redirect } from "next/navigation"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"
import SegmentosContent from "@/components/dashboard/marketing/segmentos-content"

type SegmentosResponse = {
  data: {
    automaticos: Array<{
      slug: string
      nombre: string
      descripcion: string
      count: number
    }>
    manuales: Array<{
      id: number
      nombre: string
      descripcion: string | null
      count: number
      created_at: string
    }>
  }
}

export default async function SegmentosPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.ver_marketing) redirect("/sin-acceso")

  const response = await fetchBackendFromServer<SegmentosResponse>("/api/marketing/segmentos")

  return (
    <SegmentosContent
      automaticos={response.data.automaticos}
      manuales={response.data.manuales}
      permisos={permisos}
      esEmpleado={esEmpleado}
    />
  )
}
