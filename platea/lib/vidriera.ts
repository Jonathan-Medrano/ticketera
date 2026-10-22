import type { TenantEventPublicationSnapshot } from "./tenant"

// Evento público cross-tenant para la vidriera de descubrimiento (home + /eventos).
// No confundir con "marketplace" (fee de Mercado Pago) — ver backend/src/routes/vidriera.ts.
export type VidrieraEventoPublico = TenantEventPublicationSnapshot & {
  id: string
  nombre: string
  descripcion?: string | null
  lugar?: string | null
  ciudad?: string | null
  imagen_url?: string | null
  proxima_fecha?: string | null
  precio_desde?: number | null
  empresa_id: string
  empresa_slug: string
  empresa_nombre: string
  empresa_logo_url?: string | null
}
