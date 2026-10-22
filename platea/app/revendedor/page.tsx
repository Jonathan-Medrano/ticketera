import { auth } from "@/auth"
import { redirect } from "next/navigation"
import RevendedorContent from "@/components/revendedor/revendedor-content"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"

type RevendedorPortalResponse = {
  data: {
    revendedor: {
      id: string
      nombre: string
      apellido?: string | null
      email: string
      porcentaje_comision?: number | null
    }
    ventas: Array<{
      id: string
      precio_pagado: number
      created_at: string
      estado: string
      evento_nombre: string
      evento_id: string
      imagen_url?: string | null
      categoria_nombre?: string | null
    }>
    eventos: Array<{
      id: string
      nombre: string
      imagen_url?: string | null
      stock_disponible: number
      vendidas: number
      stock_total: number
    }>
    stats: {
      totalVendidas: number
      totalGenerado: number
      comision: number
      ganancia: number
    }
    empresaSlug: string
    ventas_por_dia: { dia: string; ventas: number }[]
  }
}

export default async function RevendedorPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const response = await fetchBackendFromServer<RevendedorPortalResponse>("/api/revendedores/me")

  return (
    <RevendedorContent
      revendedor={response.data.revendedor}
      ventas={response.data.ventas}
      eventos={response.data.eventos}
      stats={response.data.stats}
      empresaSlug={response.data.empresaSlug}
      ventasPorDia={response.data.ventas_por_dia}
      permisos={permisos}
    />
  )
}
