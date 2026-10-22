"use client"

import { signOut } from "next-auth/react"
import { ShieldAlert } from "lucide-react"
import { Button } from "@/components/ui/button"

export default function ImpersonationBanner({ empresaNombre }: { empresaNombre: string }) {
  return (
    <div className="flex items-center justify-between gap-4 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950">
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 shrink-0" />
        <span>
          Modo impersonation — estás viendo el dashboard como <strong>{empresaNombre}</strong>.
          Al terminar vas a tener que volver a iniciar sesión como superadmin.
        </span>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 border-amber-700 bg-transparent text-amber-950 hover:bg-amber-600"
        onClick={() => void signOut({ callbackUrl: "/login" })}
      >
        Terminar impersonation
      </Button>
    </div>
  )
}
