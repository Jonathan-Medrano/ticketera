"use client"

import { useState } from "react"
import { signIn, useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import PasswordInput from "@/components/password-input"
import PasswordStrength from "@/components/password-strength"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { validatePasswordPolicy } from "@/lib/password-policy"

export default function ActualizarPasswordForzadaPage() {
  const router = useRouter()
  const { data: session } = useSession()
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError("")

    const validationError = validatePasswordPolicy(newPassword)
    if (validationError) {
      setError(validationError)
      return
    }

    if (newPassword !== confirmPassword) {
      setError("Las contraseñas no coinciden")
      return
    }

    setLoading(true)
    const response = await fetch("/api/configuracion/password", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        passwordActual: currentPassword,
        nuevaPassword: newPassword,
        confirmarPassword: confirmPassword,
      }),
    })

    const data = await response.json().catch(() => null)
    if (!response.ok) {
      setLoading(false)
      setError(data?.details?.message ?? data?.error ?? "No se pudo actualizar la contraseña")
      return
    }

    toast.success("Contraseña actualizada correctamente")

    const email = session?.user?.email
    const userType = session?.user?.userType
    if (!email) {
      setLoading(false)
      router.replace("/login")
      router.refresh()
      return
    }

    // callbackUrl = "/login" para que el proxy resuelva el destino correcto
    // (/dashboard, /revendedor, /super-admin/dashboard) leyendo el JWT FRESCO
    // recién emitido por este signIn — la session local todavía es la vieja sin
    // empleadoRol actualizado.
    const provider = userType === "empleado" ? "credentials-empleado" : "credentials-empresa"
    const loginResult = await signIn(provider, {
      email,
      password: newPassword,
      redirect: false,
      callbackUrl: "/login",
    })

    setLoading(false)

    if (loginResult?.error) {
      toast.error("Tu contraseña se actualizó, pero no pudimos iniciar sesión de nuevo. Ingresá con la nueva contraseña.")
      router.replace("/login")
      router.refresh()
      return
    }

    router.replace(loginResult?.url ?? "/login")
    router.refresh()
  }

  return (
    <div className="mx-auto max-w-xl rounded-2xl border border-border bg-card p-6 shadow-sm">
      <h1 className="text-2xl font-bold text-foreground">Actualizá tu contraseña</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Este usuario fue creado con una contraseña temporal. Antes de seguir, definí una nueva clave segura.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="current-password">Contraseña actual</Label>
          <Input id="current-password" type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} required />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="new-password">Nueva contraseña</Label>
          <PasswordInput id="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} required />
          <PasswordStrength password={newPassword} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="confirm-password">Confirmar nueva contraseña</Label>
          <PasswordInput id="confirm-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
        </div>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <Button type="submit" disabled={loading} className="w-full">
          {loading ? "Guardando..." : "Guardar y continuar"}
        </Button>
      </form>
    </div>
  )
}
