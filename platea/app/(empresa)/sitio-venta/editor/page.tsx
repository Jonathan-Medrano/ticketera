import { redirect } from "next/navigation"
import SitioVentaEditorShell from "@/components/dashboard/sitio-venta-editor-shell"
import { requireDashboardSession } from "@/lib/dashboard-auth"
import { fetchBackendFromServer } from "@/lib/server-backend"
import type { EventoPasadoOption } from "@/components/dashboard/sitio-venta/types"

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
    galeria_fotos?: string | null
    home_sections?: string | null
    announcement_bar?: Record<string, unknown> | null
    social_links?: Record<string, unknown> | null
    color_superficie?: string | null
    border_radius?: string | null
    button_style?: string | null
    heading_font?: string | null
    navbar_blur?: boolean | null
    card_columns?: string | null
    section_spacing?: string | null
    mobile_event_layout?: string | null
    event_card_style?: string | null
    eventos_layout?: string | null
  }
}

export default async function SitioVentaEditorPage() {
  // Esta ruta vive fuera de app/(empresa)/dashboard/layout.tsx a propósito (shell
  // propio sin sidebar), así que no hereda el gating que aplica requireDashboardSession()
  // en ese layout. Lo replicamos acá explícitamente: mismos redirects, mismo orden.
  const { permisos, esEmpleado } = await requireDashboardSession()

  if (esEmpleado && !permisos?.editar_configuracion) redirect("/sin-acceso")

  const [response, eventosPasadosResponse] = await Promise.all([
    fetchBackendFromServer<ConfiguracionResponse>("/api/sitio-venta"),
    // Eventos finalizados del tenant — opciones para "Vincular a un evento" en el
    // bloque testimonios (home). Nunca bloquea el editor: si falla, el selector
    // simplemente queda vacío (mismo criterio degradado que el resto del editor).
    fetchBackendFromServer<{ data: EventoPasadoOption[] }>("/api/eventos?basic=1&solo_pasados=1").catch(() => ({ data: [] })),
  ])

  return (
    <SitioVentaEditorShell
      empresa={response.data}
      permisos={permisos}
      esEmpleado={esEmpleado}
      eventosPasados={eventosPasadosResponse.data}
    />
  )
}
