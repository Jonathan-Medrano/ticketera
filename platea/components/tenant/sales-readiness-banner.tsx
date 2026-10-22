"use client"

import { AlertTriangle } from "lucide-react"
import { getSalesReadinessMessage, getSalesReadinessStatusLabel } from "@/lib/tenant"
import { useTenant, useTenantSalesReadiness } from "./tenant-provider"

export default function TenantSalesReadinessBanner() {
  const tenant = useTenant()
  const salesReadiness = useTenantSalesReadiness()

  if (!salesReadiness || salesReadiness.can_sell) {
    return null
  }

  return (
    <div
      className="rounded-3xl border px-4 py-4"
      style={{
        borderColor: `${tenant.color_primario}35`,
        background: `${tenant.color_primario}14`,
      }}
    >
      <div className="flex items-start gap-3">
        <div
          className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl"
          style={{ background: `${tenant.color_primario}20`, color: tenant.color_primario }}
        >
          <AlertTriangle className="h-4 w-4" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-bold" style={{ color: tenant.color_texto }}>
            Compras pausadas
          </p>
          <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: tenant.color_primario }}>
            {getSalesReadinessStatusLabel(salesReadiness.status)}
          </p>
          <p className="text-sm leading-relaxed" style={{ color: `${tenant.color_texto}cc` }}>
            {getSalesReadinessMessage(salesReadiness, "public")}
          </p>
        </div>
      </div>
    </div>
  )
}
