import { auth } from "@/auth"
import { redirect } from "next/navigation"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"
import EmailMarketingContent from "@/components/dashboard/marketing/email-content"

type CampanasResponse = {
  data: {
    campanas: Array<{
      id: number
      nombre: string
      tipo: "manual" | "automatica"
      asunto: string
      estado: "borrador" | "enviando" | "enviada" | "pausada"
      segmento_id: number | null
      evento_id: number | null
      segmento_nombre: string | null
      evento_nombre: string | null
      total_destinatarios: number
      total_enviados: number
      total_abiertos: number
      total_clicks: number
      enviada_at: string | null
      created_at: string
    }>
  }
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

type EventosResponse = {
  data: Array<{ id: string; nombre: string }>
}

type SegmentosResponse = {
  data: {
    automaticos: Array<{ slug: string; nombre: string; count: number }>
    manuales: Array<{ id: number; nombre: string; count: number }>
  }
}

type ConfigEmailResponse = {
  data: {
    email_marketing_from: string | null
    email_marketing_from_name: string | null
    email_marketing_habilitado: boolean
    marketing_carrito_ventana_min: number
    marketing_carrito_ventana_max: number
    marketing_automatizaciones: boolean
  }
}

export default async function EmailPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.ver_marketing) redirect("/sin-acceso")

  const [campanasRes, eventosRes, segmentosRes, configRes] = await Promise.all([
    fetchBackendFromServer<CampanasResponse>("/api/marketing/campanas"),
    fetchBackendFromServer<EventosResponse>("/api/eventos?basic=1&solo_activos=1").catch(() => ({ data: [] })),
    fetchBackendFromServer<SegmentosResponse>("/api/marketing/segmentos").catch(() => ({
      data: { automaticos: [], manuales: [] },
    })),
    fetchBackendFromServer<ConfigEmailResponse>("/api/marketing/email/configuracion").catch(() => ({
      data: { email_marketing_from: null, email_marketing_from_name: null, email_marketing_habilitado: false, marketing_carrito_ventana_min: 60, marketing_carrito_ventana_max: 120, marketing_automatizaciones: false },
    })),
  ])

  return (
    <EmailMarketingContent
      campanas={campanasRes.data.campanas}
      eventos={eventosRes.data ?? []}
      segmentos={segmentosRes.data}
      configEmail={configRes.data}
      permisos={permisos}
      esEmpleado={esEmpleado}
    />
  )
}
