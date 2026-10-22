"use client"

import type { CSSProperties, ReactNode } from "react"
import type { TenantEmpresa } from "@/lib/tenant"

type SurfaceTone = "soft" | "muted" | "subtle"

function resolveSurfaceStyle(tenant: TenantEmpresa, tone: SurfaceTone): CSSProperties {
  switch (tone) {
    case "muted":
      return {
        borderColor: `${tenant.color_texto}14`,
        background: `${tenant.color_texto}06`,
      }
    case "subtle":
      return {
        borderColor: `${tenant.color_texto}12`,
        background: `${tenant.color_texto}04`,
      }
    case "soft":
    default:
      return {
        borderColor: `${tenant.color_texto}14`,
        background: `${tenant.color_texto}05`,
      }
  }
}

export function TenantSurface({
  tenant,
  children,
  className,
  tone = "soft",
  style,
}: {
  tenant: TenantEmpresa
  children: ReactNode
  className: string
  tone?: SurfaceTone
  style?: CSSProperties
}) {
  return (
    <div className={className} style={{ ...resolveSurfaceStyle(tenant, tone), ...style }}>
      {children}
    </div>
  )
}

export function TenantPanel({
  tenant,
  children,
  className = "rounded-3xl border p-4 md:p-5",
  tone = "muted",
  style,
}: {
  tenant: TenantEmpresa
  children: ReactNode
  className?: string
  tone?: SurfaceTone
  style?: CSSProperties
}) {
  return (
    <TenantSurface tenant={tenant} className={className} tone={tone} style={style}>
      {children}
    </TenantSurface>
  )
}

export function TenantCard({
  tenant,
  children,
  className = "rounded-2xl border p-4",
  tone = "soft",
  style,
}: {
  tenant: TenantEmpresa
  children: ReactNode
  className?: string
  tone?: SurfaceTone
  style?: CSSProperties
}) {
  return (
    <TenantSurface tenant={tenant} className={className} tone={tone} style={style}>
      {children}
    </TenantSurface>
  )
}
