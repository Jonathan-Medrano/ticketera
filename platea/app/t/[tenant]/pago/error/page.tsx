"use client"

import { Suspense } from "react"
import { useTenant } from "@/components/tenant/tenant-provider"
import { XCircle } from "lucide-react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"

import { TENANT_NAVBAR_CLEARANCE } from "@/lib/tenant-navbar-clearance"
function PagoErrorPageContent() {
  const tenant = useTenant()
  const searchParams = useSearchParams()
  const reason = searchParams.get("reason")

  const mensaje =
    reason === "expired"
      ? "Se venció el tiempo de la reserva mientras estabas pagando. No te preocupes: si no se completó a tiempo, vas a poder volver a intentarlo."
      : "El pago no pudo procesarse. No se realizó ningún cargo."

  return (
    <div
      className="min-h-screen flex items-start justify-center px-4 pb-10"
      style={{ background: tenant.color_fondo, paddingTop: TENANT_NAVBAR_CLEARANCE }}
    >
      <div className="text-center max-w-sm">
        <div className="h-20 w-20 rounded-full bg-destructive/15 flex items-center justify-center mx-auto mb-5">
          <XCircle className="h-10 w-10 text-destructive" />
        </div>
        <h1 className="text-2xl font-black mb-2" style={{ color: tenant.color_texto }}>
          Error en el pago
        </h1>
        <p className="text-sm mb-6" style={{ color: `${tenant.color_texto}60` }}>
          {mensaje}
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href={buildTenantPath(tenant.slug, tenantRoutes.home())}
            className="h-11 px-6 rounded-xl font-bold text-white text-sm inline-flex items-center justify-center"
            style={{ background: tenant.color_primario }}
          >
            Ver eventos
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function PagoErrorPage() {
  return (
    <Suspense fallback={null}>
      <PagoErrorPageContent />
    </Suspense>
  )
}
