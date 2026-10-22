"use client"

import type { ComponentProps } from "react"
import type { TenantEmpresa } from "@/lib/tenant"
import { DialogContent } from "@/components/ui/dialog"

type TenantDialogContentProps = ComponentProps<typeof DialogContent> & {
  tenant: TenantEmpresa
}

export function TenantDialogContent({ tenant, className = "", style, ...props }: TenantDialogContentProps) {
  return (
    <DialogContent
      {...props}
      className={`rounded-3xl ${className}`.trim()}
      style={{
        background: tenant.color_fondo,
        borderColor: `${tenant.color_texto}14`,
        ...style,
      }}
    />
  )
}
