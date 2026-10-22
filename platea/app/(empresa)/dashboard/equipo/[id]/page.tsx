import { redirect } from "next/navigation"
import { requireDashboardSession } from "@/lib/dashboard-auth"
import { fetchBackendFromServer } from "@/lib/server-backend"
import EquipoDetalleContent from "@/components/dashboard/equipo-detalle-content"

type EquipoDetalleResponse = {
  data: {
    usuario: {
      id: string
      nombre: string
      apellido: string | null
      email: string
      rol: string
      activo: number
      created_at: string
      porcentaje_comision: number | null
      must_change_password: number
    }
    stats: {
      total_ventas: number
      total_generado: number
      total_consumibles: number
      total_escaneos: number
    }
  }
}

type ActividadResponse = {
  data: {
    items: {
      id: string
      tipo: string
      descripcion: string
      metadata: Record<string, unknown> | null
      created_at: string
    }[]
    total: number
    page: number
    limit: number
  }
}

export default async function EquipoDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { esEmpleado, permisos } = await requireDashboardSession()
  if (esEmpleado && !permisos?.ver_equipo) redirect("/sin-acceso")

  const canVerActividad = !esEmpleado || Boolean(permisos?.ver_actividad_equipo)
  const canEdit = !esEmpleado || Boolean(permisos?.editar_equipo)
  const canResetPassword = !esEmpleado || Boolean(permisos?.editar_equipo)

  const { id } = await params

  const [detalleRes, actividadRes] = await Promise.all([
    fetchBackendFromServer<EquipoDetalleResponse>(`/api/equipo/${id}`).catch(() => null),
    canVerActividad
      ? fetchBackendFromServer<ActividadResponse>(`/api/equipo/${id}/actividad?limit=25`).catch(() => null)
      : Promise.resolve(null),
  ])

  if (!detalleRes?.data) redirect("/dashboard/equipo")

  return (
    <EquipoDetalleContent
      usuario={detalleRes.data.usuario}
      stats={detalleRes.data.stats}
      actividad={actividadRes?.data?.items ?? []}
      actividadTotal={actividadRes?.data?.total ?? 0}
      canVerActividad={canVerActividad}
      canEdit={canEdit}
      canResetPassword={canResetPassword}
    />
  )
}
