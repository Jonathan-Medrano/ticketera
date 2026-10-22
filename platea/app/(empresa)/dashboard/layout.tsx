import Sidebar from "@/components/dashboard/sidebar"
import LoadingProvider from "@/components/loading-provider"
import DashboardErrorBoundary from "@/components/dashboard/error-boundary"
import ImpersonationBanner from "@/components/dashboard/impersonation-banner"
import PlatformMessagesBanner from "@/components/dashboard/platform-messages-banner"
import VictoriaWidget from "@/components/dashboard/victoria/victoria-widget"
import { requireDashboardSession } from "@/lib/dashboard-auth"
import { fetchBackendFromServer } from "@/lib/server-backend"
import { Toaster } from "sonner"

type PlatformMessage = { id: string; titulo: string; cuerpo: string; tipo: "info" | "warning" | "critical" }
type MessagesResponse = { data: { messages: PlatformMessage[] } }
type FeaturesResponse = { data: { revendedorHabilitado: boolean; consumiblesHabilitado: boolean; posMovilHabilitado?: boolean; esPrueba?: boolean } }

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { session, permisos } = await requireDashboardSession()

  const [messagesResult, featuresResult] = await Promise.allSettled([
    fetchBackendFromServer<MessagesResponse>("/api/dashboard/mensajes"),
    fetchBackendFromServer<FeaturesResponse>("/api/dashboard/features"),
  ])

  const messages = messagesResult.status === "fulfilled" ? messagesResult.value.data.messages : []
  const featureFlags = featuresResult.status === "fulfilled"
    ? featuresResult.value.data
    : { revendedorHabilitado: true, consumiblesHabilitado: true, posMovilHabilitado: false, esPrueba: false }

  return (
    <LoadingProvider>
      {session.user.isImpersonated && (
        <ImpersonationBanner empresaNombre={session.user.name ?? session.user.slug ?? "empresa"} />
      )}
      <div data-layout="dashboard" className="flex h-screen bg-card overflow-hidden">
        <Sidebar
          empresaNombre={session.user.name ?? ""}
          permisos={permisos}
          userType={session.user.userType}
          featureFlags={featureFlags}
        />
        <main className="flex-1 overflow-y-auto min-w-0 pt-16 md:pt-0" style={{ scrollbarGutter: "stable" }}>
          <PlatformMessagesBanner messages={messages} />
          <div className="p-4 md:p-6 lg:p-8">
            <DashboardErrorBoundary>{children}</DashboardErrorBoundary>
          </div>
        </main>
      </div>
      <VictoriaWidget featureFlags={featureFlags} permisos={permisos} userType={session.user.userType} />
      <Toaster richColors position="top-right" />
    </LoadingProvider>
  )
}
