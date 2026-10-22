"use client"

import { useEffect } from "react"
import { installGlobalClientErrorHandlers } from "@/lib/client-error-logger"

// Mounts window.onerror + unhandledrejection listeners once on the client.
// Insert into the root layout so it runs on every page (marketing, tenant,
// dashboard, super-admin alike).
//
// `serverIntl` lo calcula el root layout (server component) y viaja en el
// payload RSC, así que es literalmente la huella del ICU de Node. Sirve para
// compararla contra la del navegador cuando hay un hydration mismatch — ver
// `lib/hydration-diagnostics.ts`.
export default function ClientErrorHandlers({ serverIntl }: { serverIntl?: string }) {
  useEffect(() => {
    installGlobalClientErrorHandlers({ serverIntl })
  }, [serverIntl])
  return null
}
