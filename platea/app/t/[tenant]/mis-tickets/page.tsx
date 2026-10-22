import TenantNavbar from "@/components/tenant/tenant-navbar"
import MisTicketsContent from "@/components/tenant/mis-tickets-content"
import type { ConsumibleVenta } from "@/components/tenant/mis-tickets-content"
import { requireBuyerSessionForTenant } from "@/lib/buyer-session/server"
import { fetchTenantBackendFromServer } from "@/lib/server-backend"

type MisTicketsResponse = {
  data: {
    entradas: Array<{
      id: string
      qr_code: string
      clave_corta: string
      estado: "valida" | "usada" | "cancelada"
      precio_pagado: number
      created_at: string
      evento_nombre: string
      imagen_url?: string | null
      lugar?: string | null
      categoria_nombre?: string | null
      funcion_fecha?: string | null
      refund?: {
        eligible: boolean
        company_enabled: boolean
        event_enabled: boolean
        checkout_session_id?: string | null
        existing_request?: {
          case_id: string
          status?: string | null
          origin?: string | null
          reason?: string | null
          note?: string | null
          is_open: boolean
        } | null
      }
    }>
  }
}

type MisConsumiblesResponse = {
  data: {
    ventas: ConsumibleVenta[]
  }
}

export default async function MisTicketsPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  await requireBuyerSessionForTenant(tenant, "mis-tickets")

  const [ticketsResponse, consumiblesResponse] = await Promise.all([
    fetchTenantBackendFromServer<MisTicketsResponse>(`/api/tenant/${tenant}/mis-tickets`, tenant).catch(() => ({ data: { entradas: [] }, error: true as const })),
    fetchTenantBackendFromServer<MisConsumiblesResponse>(`/api/tenant/${tenant}/mis-consumibles`, tenant).catch(() => ({ data: { ventas: [] } })),
  ])

  return (
    <>
      <TenantNavbar />
      <MisTicketsContent
        entradas={ticketsResponse.data.entradas}
        entradasError={"error" in ticketsResponse}
        consumiblesVentas={consumiblesResponse.data.ventas}
      />
    </>
  )
}
