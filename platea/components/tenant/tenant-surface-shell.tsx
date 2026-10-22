import { cookies, headers } from "next/headers"
import { notFound } from "next/navigation"
import { Suspense } from "react"
import { Toaster } from "sonner"
import Script from "next/script"
import TenantProvider from "@/components/tenant/tenant-provider"
import TenantLayoutShell from "@/components/tenant/tenant-layout-shell"
import TenantBuyerSessionProvider from "@/components/tenant/tenant-buyer-session-provider"
import TenantSuspended from "@/components/tenant/tenant-suspended"
import RefCapture from "@/components/tenant/ref-capture"
import { getBuyerSessionForTenantSlug } from "@/lib/buyer-session/server"
import { fetchPublicBackendFromServer } from "@/lib/server-backend"
import type { TenantEmpresa } from "@/lib/tenant"

function validGa4Id(id: string | null | undefined): string | null {
  return id && /^G-[A-Z0-9]{4,20}$/.test(id) ? id : null
}
function validPixelId(id: string | null | undefined): string | null {
  return id && /^\d{10,20}$/.test(id) ? id : null
}
function validGtmId(id: string | null | undefined): string | null {
  return id && /^GTM-[A-Z0-9]{4,10}$/.test(id) ? id : null
}

// Rutas que llevan un token sensible en el query string (magic-link de login,
// reset de password). `afterInteractive` no está sincronizado con el cleanup
// de la URL en el cliente: gtag/fbq pueden capturar `location.href` con el
// token todavía puesto como parte del pageview automático, antes de que se
// limpie. Se saltea la inyección de analytics de terceros en estas rutas
// puntuales — no afecta al resto del storefront del tenant.
const ANALYTICS_SUPPRESSED_TENANT_PATHS = ["/auth/token", "/auth/reset"]

function isAnalyticsSuppressedPath(tenantPath: string): boolean {
  return ANALYTICS_SUPPRESSED_TENANT_PATHS.some(
    (path) => tenantPath === path || tenantPath.startsWith(`${path}/`)
  )
}

export default async function TenantSurfaceShell({
  tenant,
  children,
  suppressAnalytics = false,
}: {
  tenant: string
  children: React.ReactNode
  /**
   * Fuerza a saltear la inyección de GA4/Meta Pixel/GTM sin importar el
   * pathname. Usalo cuando este shell se instancia directamente desde una
   * página (p. ej. `app/auth/token/page.tsx`, `app/auth/reset/page.tsx`) que
   * no pasa por `app/t/[tenant]/layout.tsx` y por lo tanto no tiene garantizado
   * el header `x-tenant-path` para la detección automática de abajo.
   */
  suppressAnalytics?: boolean
}) {
  const cookieStore = await cookies()
  const headersList = await headers()
  const tenantPath = headersList.get("x-tenant-path") ?? ""
  const skipAnalytics = suppressAnalytics || isAnalyticsSuppressedPath(tenantPath)
  const savedMode = cookieStore.get(`tenant-theme-${tenant}`)?.value
  const initialMode = savedMode === "light" ? "light" : "dark"

  let response: { data: { empresa: TenantEmpresa } }
  let consumiblesResponse: { data: { eventos: Array<{ id: string }> } }
  try {
    ;[response, consumiblesResponse] = await Promise.all([
      fetchPublicBackendFromServer<{ data: { empresa: TenantEmpresa } }>(`/api/tenant/${tenant}`, { revalidate: 300, tags: [`tenant:${tenant}`] }),
      fetchPublicBackendFromServer<{ data: { eventos: Array<{ id: string }> } }>(`/api/tenant/${tenant}/consumibles`, { revalidate: 120, tags: [`tenant:${tenant}`] }).catch(() => ({ data: { eventos: [] } })),
    ])
  } catch {
    notFound()
  }

  const empresa = response.data.empresa
  if (!empresa) notFound()

  if (empresa.suspendido) {
    return <TenantSuspended empresa={empresa} />
  }

  return (
    <TenantProvider empresa={empresa} initialMode={initialMode}>
      <TenantBuyerSessionProvider tenantSlug={tenant} initialBuyerSession={await getBuyerSessionForTenantSlug(tenant)}>
        {!skipAnalytics && validGa4Id(empresa.ga4_measurement_id) && (() => {
          const ga4Id = validGa4Id(empresa.ga4_measurement_id)!
          return (
            <>
              <Script src={`https://www.googletagmanager.com/gtag/js?id=${ga4Id}`} strategy="afterInteractive" />
              <Script id="ga4-init" strategy="afterInteractive">{`
                window.dataLayer = window.dataLayer || [];
                function gtag(){dataLayer.push(arguments);}
                gtag('js', new Date());
                gtag('config', '${ga4Id}');
              `}</Script>
            </>
          )
        })()}
        {!skipAnalytics && validPixelId(empresa.meta_pixel_id) && (() => {
          const pixelId = validPixelId(empresa.meta_pixel_id)!
          return (
            <Script id="meta-pixel" strategy="afterInteractive">{`
              !function(f,b,e,v,n,t,s)
              {if(f.fbq)return;n=f.fbq=function(){n.callMethod?
              n.callMethod.apply(n,arguments):n.queue.push(arguments)};
              if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';
              n.queue=[];t=b.createElement(e);t.async=!0;
              t.src=v;s=b.getElementsByTagName(e)[0];
              s.parentNode.insertBefore(t,s)}(window, document,'script',
              'https://connect.facebook.net/en_US/fbevents.js');
              fbq('init', '${pixelId}');
              fbq('track', 'PageView');
            `}</Script>
          )
        })()}
        {!skipAnalytics && validGtmId(empresa.gtm_container_id) && (() => {
          const gtmId = validGtmId(empresa.gtm_container_id)!
          return (
            <>
              <Script id="gtm" strategy="afterInteractive">{`
                (function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
                new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
                j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
                'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
                })(window,document,'script','dataLayer','${gtmId}');
              `}</Script>
              <noscript>
                <iframe
                  src={`https://www.googletagmanager.com/ns.html?id=${gtmId}`}
                  height="0"
                  width="0"
                  style={{ display: "none", visibility: "hidden" }}
                />
              </noscript>
            </>
          )
        })()}
        <div className="min-h-screen" style={{ background: "var(--tenant-fondo)" }}>
          <Suspense fallback={null}>
            <RefCapture tenantSlug={tenant} />
          </Suspense>
          <TenantLayoutShell hasConsumibles={consumiblesResponse.data.eventos.length > 0}>{children}</TenantLayoutShell>
          <Toaster richColors position="top-center" />
        </div>
      </TenantBuyerSessionProvider>
    </TenantProvider>
  )
}
