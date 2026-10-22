"use client"

import { useEffect, useState } from "react"
import { signIn } from "next-auth/react"
import { useRouter } from "next/navigation"

export default function ImpersonatePage() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch("/api/auth/impersonate-relay")
      .then(async (res) => {
        if (!res.ok) {
          setError("Token inválido, expirado o ya utilizado.")
          return
        }
        const data = await res.json() as { token?: string }
        if (!data.token) {
          setError("Token inválido, expirado o ya utilizado.")
          return
        }
        return signIn("credentials-impersonation", { token: data.token, redirect: false })
      })
      .then((result) => {
        if (!result) return
        if (result.error) {
          setError("El token expiró o ya fue utilizado.")
        } else {
          router.replace("/dashboard")
        }
      })
      .catch(() => setError("Error inesperado al iniciar sesión."))
  }, [router])

  if (error) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 text-center">
        <p className="text-lg font-semibold text-destructive">{error}</p>
        <p className="text-sm text-muted-foreground">Cerrá esta pestaña y generá un nuevo link desde el panel de superadmin.</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground">Iniciando sesión como empresa...</p>
    </div>
  )
}
