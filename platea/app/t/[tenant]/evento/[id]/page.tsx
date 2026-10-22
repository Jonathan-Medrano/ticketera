import type { Metadata } from "next"
import { notFound } from "next/navigation"
import TenantNavbar from "@/components/tenant/tenant-navbar"
import EventoDetalle from "@/components/tenant/evento-detalle"
import { fetchPublicBackendFromServer } from "@/lib/server-backend"
import { enforceBuyerPasswordRotation } from "@/lib/buyer-session/server"

type TenantEventoDetalleResponse = {
  data: {
    evento: {
      id: string
      nombre: string
      descripcion?: string | null
      lugar?: string | null
      imagen_url?: string | null
      modo_fecha: "unica" | "multiple" | "pase"
      venta_consumibles_habilitada: number
      tipo_mapa?: string | null
      publication_status: "hidden" | "listed" | "live"
      publication_reason: "manual_inactive" | "scheduled_hidden" | "scheduled_listed" | "scheduled_detail_visible" | "live"
      is_listed: boolean
      is_detail_visible: boolean
      is_checkout_open: boolean
      publication: {
        mode: "immediate" | "scheduled"
        pre_publish_visibility: "hidden" | "listado_solo" | "detail_visible"
        publish_at_utc: string | null
        publish_timezone: string | null
        published_live_at: string | null
      }
      buyer_event_refunds_enabled?: number
      company_buyer_event_refunds_enabled?: number
      tanda_activa?: {
        id: string
        nombre: string
        descripcion?: string | null
        imagen_url?: string | null
        activa_desde?: string | null
      } | null
    }
    categorias: Array<{
      id: string
      nombre: string
      descripcion?: string | null
      precio: number
      stock_disponible: number
      entradas_por_unidad?: number
      precio_buyer?: number
      fee_buyer_amount?: number
    }>
    fechas: Array<{
      id: string
      fecha: string
    }>
    addons?: Array<{
      id: string
      nombre: string
      descripcion?: string | null
      precio: number
      stock_disponible: number
      max_por_compra: number
      precio_buyer?: number
      fee_buyer_amount?: number
    }>
      consumibles?: {
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
        }>
      }>
    }
  }
}

export async function generateMetadata({ params }: { params: Promise<{ tenant: string; id: string }> }): Promise<Metadata> {
  const { tenant, id } = await params
  const response = await fetchPublicBackendFromServer<TenantEventoDetalleResponse>(
    `/api/tenant/${tenant}/evento/${id}`,
    { revalidate: 30, tags: [`tenant:${tenant}`] }
  ).catch(() => null)

  if (!response?.data?.evento) return {}

  const { nombre, imagen_url, descripcion } = response.data.evento
  return {
    title: nombre,
    description: descripcion ?? undefined,
    openGraph: {
      title: nombre,
      ...(imagen_url ? { images: [{ url: imagen_url }] } : {}),
    },
  }
}

export default async function EventoPage({ params }: { params: Promise<{ tenant: string; id: string }> }) {
  const { tenant, id } = await params
  await enforceBuyerPasswordRotation(tenant)

  // Paraleliza ambos fetchs — son independientes (metadata del evento vs consumibles).
  // Antes era secuencial = suma de latencias; ahora corre concurrente.
  const [response, consumibles] = await Promise.all([
    fetchPublicBackendFromServer<TenantEventoDetalleResponse>(
      `/api/tenant/${tenant}/evento/${id}`,
      { revalidate: 30 }
    ),
    fetchPublicBackendFromServer<{ data: { barras: Array<{ id: string; nombre: string; items: Array<{ consumible_id: string; nombre: string; descripcion?: string | null; imagen_url?: string | null; precio: number; stock_actual: number; stock_ilimitado: boolean; agotado: boolean }> }> } }>(
      `/api/tenant/${tenant}/evento/${id}/consumibles`
    ).catch(() => ({ data: { barras: [] } })),
  ])

  if (!response.data.evento) notFound()

  return (
    <>
      <TenantNavbar />
        <EventoDetalle
          evento={response.data.evento}
          categorias={response.data.categorias}
          fechas={response.data.fechas}
          consumiblesBarras={consumibles.data.barras}
          addons={response.data.addons ?? []}
          tenantSlug={tenant}
        />
      </>
  )
}
