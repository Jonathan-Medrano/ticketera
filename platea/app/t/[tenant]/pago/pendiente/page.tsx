"use client"

import { useTenant } from "@/components/tenant/tenant-provider"
import { Clock } from "lucide-react"
import Link from "next/link"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"

import { TENANT_NAVBAR_CLEARANCE } from "@/lib/tenant-navbar-clearance"
export default function PagoPendientePage() {
  const tenant = useTenant()

  return (
    <div
      className="min-h-screen flex items-start justify-center px-4 pb-10"
      style={{ background: tenant.color_fondo, paddingTop: TENANT_NAVBAR_CLEARANCE }}
    >
      <div className="text-center max-w-sm">
        <div className="h-20 w-20 rounded-full bg-amber-500/15 flex items-center justify-center mx-auto mb-5">
          <Clock className="h-10 w-10 text-amber-500" />
        </div>
        <h1 className="text-2xl font-black mb-2" style={{ color: tenant.color_texto }}>
          Pago pendiente
        </h1>
        <p className="text-sm mb-6" style={{ color: `${tenant.color_texto}60` }}>
          Tu pago está siendo procesado. Te avisaremos por email cuando se confirme y tus entradas
          estarán disponibles.
        </p>
        <Link
          href={buildTenantPath(tenant.slug, tenantRoutes.misTickets())}
          className="h-11 px-6 rounded-xl font-bold text-white text-sm inline-flex items-center"
          style={{ background: tenant.color_primario }}
        >
          Ver mis tickets
        </Link>
      </div>
    </div>
  )
}
