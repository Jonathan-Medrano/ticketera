"use client"

import { signOut } from "next-auth/react"
import { LogOut } from "lucide-react"

export function PendienteAprobacionLogout() {
  return (
    <button
      type="button"
      onClick={() => void signOut({ callbackUrl: "/login" })}
      className="inline-flex items-center gap-1.5 text-sm font-semibold text-[color:var(--marketing-accent)] underline-offset-4 hover:underline"
    >
      <LogOut className="h-4 w-4" />
      Cerrar sesión
    </button>
  )
}
