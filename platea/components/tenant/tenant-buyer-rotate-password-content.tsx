"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { KeyRound } from "lucide-react"

import PasswordInput from "@/components/password-input"
import PasswordStrength from "@/components/password-strength"
import { submitBuyerPasswordChange } from "@/components/tenant/tenant-buyer-settings-content"
import { useTenantBuyerSession } from "@/components/tenant/tenant-buyer-session-provider"
import { useTenant } from "@/components/tenant/tenant-provider"
import { TenantPanel } from "@/components/tenant/tenant-surface"
import { validatePasswordPolicy } from "@/lib/password-policy"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"

import { TENANT_NAVBAR_CLEARANCE } from "@/lib/tenant-navbar-clearance"
export default function TenantBuyerRotatePasswordContent({ tenantSlug }: { tenantSlug: string }) {
  const router = useRouter()
  const tenant = useTenant()
  const { buyerSession, loginWithPassword } = useTenantBuyerSession()
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  // useTenant() ya devuelve los colores ADAPTADOS al modo (light/dark) que el
  // comprador eligió desde el toggle del navbar. Acá solo aplicamos esos colores
  // — no hay tema propio para esta página.
  const inputStyle = {
    borderColor: `${tenant.color_texto}33`,
    background: tenant.color_fondo,
    color: tenant.color_texto,
    // Override del fondo del autofill de Chrome (sino pinta amarillo o blanco del
    // tema dashboard sobre el input, y el texto sugerido queda invisible).
    ['--input-autofill-bg']: tenant.color_fondo,
  } as React.CSSProperties

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError("")

    if (!currentPassword) {
      setError("Ingresá tu contraseña actual")
      return
    }
    const policyError = validatePasswordPolicy(newPassword)
    if (policyError) {
      setError(policyError)
      return
    }
    if (newPassword !== confirmPassword) {
      setError("Las contraseñas no coinciden")
      return
    }

    setLoading(true)
    const result = await submitBuyerPasswordChange({
      tenantSlug,
      currentPassword,
      newPassword,
      confirmPassword,
    })
    setLoading(false)

    if (!result.ok) {
      setError(result.error ?? "No se pudo actualizar la contraseña")
      return
    }

    // El backend rota passwordVersion al cambiar contraseña (anti-replay). La
    // cookie del comprador todavía tiene la versión vieja, así que cualquier
    // página protegida le va a tirar como "no logueado" hasta refrescar la
    // session. Re-autenticamos con la contraseña nueva → cookie con versión
    // nueva → todo el flow sigue normal.
    if (buyerSession?.email) {
      const relogin = await loginWithPassword(buyerSession.email, newPassword)
      if (!relogin.ok) {
        // Fallback: si la re-auth falla por algún motivo extraño, mandamos al
        // login para que el usuario se autentique manualmente.
        toast.success("Contraseña actualizada. Volvé a ingresar.")
        router.replace(buildTenantPath(tenantSlug, tenantRoutes.auth()))
        return
      }
    }

    toast.success("Contraseña actualizada")
    router.replace(buildTenantPath(tenantSlug, tenantRoutes.home()))
    router.refresh()
  }

  return (
    <div
      className="min-h-screen pb-28"
      style={{
        background: tenant.color_fondo,
        color: tenant.color_texto,
        // Override de los CSS vars del sistema con los colores del tenant para
        // que componentes hijos que usan Tailwind `text-foreground` / `bg-background`
        // (como PasswordStrength) hereden los colores correctos del tenant, no los
        // del tema del dashboard (que puede ser dark aunque el tenant sea light).
        ['--foreground' as string]: tenant.color_texto,
        ['--background' as string]: tenant.color_fondo,
      }}
    >
      <div className="mx-auto max-w-xl px-4 space-y-6" style={{ paddingTop: TENANT_NAVBAR_CLEARANCE }}>
        <TenantPanel tenant={tenant} className="rounded-[2rem] border p-5 md:p-6">
          <div className="flex items-center gap-3">
            <KeyRound className="h-5 w-5" style={{ color: tenant.color_primario }} />
            <div>
              <h1 className="text-2xl font-bold tracking-[-0.02em]">Actualizá tu contraseña</h1>
              <p className="mt-1 text-sm" style={{ color: `${tenant.color_texto}bf` }}>
                Tu contraseña fue seteada por la organización. Antes de seguir, definí una contraseña segura que sea tuya.
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <label className="block space-y-2 text-sm font-medium">
              <span>Contraseña actual</span>
              <PasswordInput
                id="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                style={inputStyle}
                required
              />
            </label>

            <label className="block space-y-2 text-sm font-medium">
              <span>Nueva contraseña</span>
              <PasswordInput
                id="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                style={inputStyle}
                required
              />
              <PasswordStrength password={newPassword} />
            </label>

            <label className="block space-y-2 text-sm font-medium">
              <span>Confirmar nueva contraseña</span>
              <PasswordInput
                id="confirm-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                style={inputStyle}
                required
              />
            </label>

            {error ? (
              <div role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-400">
                {error}
              </div>
            ) : null}

            <button
              type="submit"
              disabled={loading}
              className="h-11 w-full rounded-xl px-5 font-bold text-white transition-opacity disabled:opacity-60"
              style={{ background: tenant.color_primario }}
            >
              {loading ? "Guardando..." : "Actualizar contraseña"}
            </button>
          </form>
        </TenantPanel>
      </div>
    </div>
  )
}
