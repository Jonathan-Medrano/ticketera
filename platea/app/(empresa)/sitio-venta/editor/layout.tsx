import type { Metadata } from "next"
import LoadingProvider from "@/components/loading-provider"
import { Toaster } from "sonner"

export const metadata: Metadata = {
  title: "Editor · Sitio de venta",
}

// This route opens in its own tab (no dashboard sidebar/shell) — it does NOT sit
// under app/(empresa)/dashboard/layout.tsx, so LoadingProvider/Toaster (normally
// provided there) have to be reinstated here for useLoading()/toast() to work.
export default function SitioVentaEditorLayout({ children }: { children: React.ReactNode }) {
  return (
    <LoadingProvider>
      {children}
      <Toaster richColors position="top-right" />
    </LoadingProvider>
  )
}
