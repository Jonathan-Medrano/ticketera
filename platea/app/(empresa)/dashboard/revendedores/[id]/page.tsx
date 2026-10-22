import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import dynamic from "next/dynamic"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"

const RevendedorDetalleContent = dynamic(
  () => import("@/components/dashboard/revendedor-detalle-content"),
  { loading: () => <div className="h-96 animate-pulse rounded-lg bg-muted" /> },
)

type RevendedorDetalleResponse = {
  data: {
    revendedor: {
      id: string
      nombre: string
      apellido?: string | null
      email: string
      activo: number
      porcentaje_comision?: number | null
      total_ventas: number
      total_generado: number
      // Suma real de comision_revendedor congelada por venta al momento del pago
      // (server-side, en revendedores.ts). Es el monto real a pagar — no depende
      // del % de comisión actual, que puede haber cambiado desde entonces.
      total_comision: number
    }
    ventas_por_evento: Array<{
      id: string
      nombre: string
      imagen_url?: string | null
      total_ventas: number
      total_generado: number
    }>
    ventas_por_dia: Array<{
      dia: string
      ventas: number
    }>
    ultimas_ventas: Array<{
      id: string
      precio_pagado: number
      estado: string
      created_at: string
      evento_id: string
      evento_nombre: string
      categoria_nombre?: string | null
      comprador_nombre?: string | null
    }>
  }
}

export default async function RevendedorDetallePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.gestionar_revendedores) redirect("/sin-acceso")

  const { id } = await params
  const response = await fetchBackendFromServer<RevendedorDetalleResponse>(`/api/revendedores/${id}`)

  if (!response.data.revendedor) notFound()

  return (
    <RevendedorDetalleContent
      revendedor={response.data.revendedor}
      ventasPorEvento={response.data.ventas_por_evento}
      ventasPorDia={response.data.ventas_por_dia.map((v) => ({
        dia: new Date(v.dia).toLocaleDateString("es-AR", {
          day: "numeric",
          month: "short",
          timeZone: "America/Argentina/Buenos_Aires",
        }),
        ventas: v.ventas,
      }))}
      ultimasVentas={response.data.ultimas_ventas}
    />
  )
}
