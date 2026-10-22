import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { SitioVentaInfoPageEditor } from "@/components/dashboard/sitio-venta/info-page-editor"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"
import { getTenantInfoPageKeyFromSlug } from "@/lib/tenant-info"

type ConfiguracionResponse = {
  data: {
    id: string
    slug: string
    logo_url?: string | null
    navbar_size?: "small" | "medium" | "large" | null
    navbar_color?: string | null
    color_primario?: string | null
    color_fondo?: string | null
    color_texto?: string | null
    desktop_event_card_size?: "large" | "medium" | "small" | null
    mostrar_descripcion_home?: number | boolean
    mostrar_tanda_activa_home?: number | boolean
    mostrar_badge_stock_home?: number | boolean
    mostrar_fecha_home?: number | boolean
    mostrar_lugar_home?: number | boolean
    mostrar_precio_home?: number | boolean
    titulo_eventos_home?: string | null
    subtitulo_eventos_home?: string | null
    cta_eventos_home?: string | null
    banner_variant?: "blurred" | "full" | null
    banners?: string | null
    info_pages?: string | null
    support_contact_email?: string | null
    faqs?: string | null
  }
}

export default async function SitioVentaInfoDynamicPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const pageKey = getTenantInfoPageKeyFromSlug(slug)
  if (!pageKey) notFound()

  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.ver_configuracion) redirect("/sin-acceso")

  const response = await fetchBackendFromServer<ConfiguracionResponse>("/api/sitio-venta")

  return (
    <SitioVentaInfoPageEditor
      key={`${response.data.id}:${slug}:${response.data.info_pages ?? ""}`}
      empresa={response.data}
      permisos={permisos}
      esEmpleado={esEmpleado}
      pageKey={pageKey}
    />
  )
}
