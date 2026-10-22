"use client"

import Link from "next/link"
import { useTenant } from "./tenant-provider"

export default function TenantWatermark() {
  const tenant = useTenant()

  return (
    <div
      className="border-t text-center px-4 py-2 text-[11px] font-bold tracking-[0.18em] uppercase select-none"
      style={{
        background: `${tenant.color_texto}06`,
        color: `${tenant.color_texto}66`,
        borderColor: `${tenant.color_texto}12`,
        backdropFilter: "blur(10px)",
      }}
    >
      Plataforma de tickets por{' '}
      <Link href="/" className="text-[#0284C7] hover:text-[#38BDF8] transition-colors">
        Ticketera
      </Link>
    </div>
  )
}
