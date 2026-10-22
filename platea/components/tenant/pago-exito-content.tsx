"use client"

import { useEffect } from "react"
import { useTenant } from "./tenant-provider"
import { CheckCircle2, Clock, Ticket } from "lucide-react"
import Link from "next/link"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"

import { TENANT_NAVBAR_CLEARANCE } from "@/lib/tenant-navbar-clearance"
export default function PagoExitoContent({ confirmed }: { confirmed: boolean }) {
  const tenant = useTenant()

  useEffect(() => {
    if (!confirmed) return
    if (typeof window !== "undefined" && typeof (window as { fbq?: (...args: unknown[]) => void }).fbq === "function") {
      ;(window as unknown as { fbq: (...args: unknown[]) => void }).fbq("track", "Purchase", { currency: "ARS" })
    }
  }, [confirmed])

  if (!confirmed) {
    return (
      <div
        className="min-h-screen flex items-center justify-center px-4 pb-10"
        style={{ background: tenant.color_fondo, paddingTop: TENANT_NAVBAR_CLEARANCE }}
      >
        <div className="text-center max-w-sm">
          <Clock className="h-16 w-16 text-amber-400 mx-auto mb-4" />
          <h1 className="text-2xl font-black mb-2" style={{ color: tenant.color_texto }}>
            Pago en proceso
          </h1>
          <p className="text-sm mb-6" style={{ color: `${tenant.color_texto}60` }}>
            Tu pago puede estar siendo procesado — revisá tus tickets en unos minutos.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Link
              href={buildTenantPath(tenant.slug, tenantRoutes.misTickets())}
              className="h-11 px-6 rounded-xl font-bold text-white inline-flex items-center justify-center gap-2"
              style={{ background: tenant.color_primario }}
            >
              <Ticket className="h-4 w-4" /> Revisar mis tickets
            </Link>
            <Link
              href={buildTenantPath(tenant.slug, tenantRoutes.home())}
              className="h-11 px-6 rounded-xl font-bold inline-flex items-center justify-center border"
              style={{ borderColor: `${tenant.color_texto}30`, color: tenant.color_texto }}
            >
              Volver al inicio
            </Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 pb-10"
      style={{ background: tenant.color_fondo, paddingTop: TENANT_NAVBAR_CLEARANCE }}
    >
      <div className="text-center max-w-sm">
        <div className="h-24 w-24 rounded-full flex items-center justify-center mx-auto mb-6" style={{ background: `${tenant.color_primario}33` }}>
          <CheckCircle2 className="h-12 w-12" style={{ color: tenant.color_primario }} />
        </div>
        <h1 className="text-3xl font-black mb-2" style={{ color: tenant.color_texto }}>
          ¡Compra exitosa!
        </h1>
        <p className="text-sm mb-2" style={{ color: `${tenant.color_texto}70` }}>
          Tus entradas fueron generadas correctamente.
        </p>
        <p className="text-xs mb-8" style={{ color: `${tenant.color_texto}50` }}>
          Te enviamos las entradas por email. También podés verlas en tu cuenta.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            href={buildTenantPath(tenant.slug, tenantRoutes.misTickets())}
            className="h-11 px-6 rounded-2xl font-bold text-white inline-flex items-center justify-center gap-2"
            style={{ background: tenant.color_primario }}
          >
            <Ticket className="h-4 w-4" /> Ver mis tickets
          </Link>
          <Link
            href={buildTenantPath(tenant.slug, tenantRoutes.home())}
            className="h-11 px-6 rounded-2xl font-bold inline-flex items-center justify-center border"
            style={{ borderColor: `${tenant.color_texto}25`, color: tenant.color_texto }}
          >
            Inicio
          </Link>
        </div>
      </div>
    </div>
  )
}
