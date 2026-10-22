import { notFound } from "next/navigation"
import TenantNavbar from "@/components/tenant/tenant-navbar"
import TenantConsumiblesEvento from "@/components/tenant/tenant-consumibles-evento"
import { fetchPublicBackendFromServer } from "@/lib/server-backend"
import { enforceBuyerPasswordRotation } from "@/lib/buyer-session/server"

type ConsumiblesEventoResponse = {
  data: {
    evento: {
      id: string
      nombre: string
      descripcion?: string | null
      lugar?: string | null
      imagen_url?: string | null
      modo_fecha: "unica" | "multiple" | "pase"
      venta_consumibles_habilitada: number
      publication_status?: "hidden" | "listed" | "live"
    }
  }
}

type ConsumiblesCatalogResponse = {
  data: {
    barras: Array<{
      id: string
      nombre: string
      buyer_consumible_refunds_enabled?: boolean
      items: Array<{
        consumible_id: string
        nombre: string
        descripcion?: string | null
        imagen_url?: string | null
        precio: number
        stock_actual: number
        stock_ilimitado: boolean
        agotado: boolean
      }>
    }>
  }
}

export default async function TenantConsumiblesEventoPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  await enforceBuyerPasswordRotation(tenant)

  const [eventoResponse, catalogoResponse] = await Promise.all([
    fetchPublicBackendFromServer<ConsumiblesEventoResponse>(`/api/tenant/${tenant}/evento/${id}`),
    fetchPublicBackendFromServer<ConsumiblesCatalogResponse>(`/api/tenant/${tenant}/evento/${id}/consumibles`).catch(() => ({ data: { barras: [] } })),
  ])

  if (!eventoResponse.data.evento) notFound()

  return (
    <>
      <TenantNavbar />
      <TenantConsumiblesEvento evento={eventoResponse.data.evento} barras={catalogoResponse.data.barras} />
    </>
  )
}
