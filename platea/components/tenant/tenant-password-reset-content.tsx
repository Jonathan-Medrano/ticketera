"use client"

import { useEffect, useState } from "react"
import { useSearchParams } from "next/navigation"
import Link from "next/link"
import { useTenant } from "./tenant-provider"
import { buildTenantApiPath } from "@/lib/tenant"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"
import { Send, ArrowLeft } from "lucide-react"
import { TenantInput } from "./tenant-field"
import { PASSWORD_POLICY_HELPER_TEXT, validatePasswordPolicy } from "@/lib/password-policy"

const RESEND_COOLDOWN_SECONDS = 30

export default function TenantPasswordResetContent() {
  const tenant = useTenant()
  const searchParams = useSearchParams()
  const token = searchParams.get("token")

  const [email, setEmail] = useState("")
  const [nuevaPassword, setNuevaPassword] = useState("")
  const [confirmarPassword, setConfirmarPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [ok, setOk] = useState("")
  const [cooldown, setCooldown] = useState(0)
  const resetCompletado = Boolean(token && ok)

  useEffect(() => {
    if (cooldown <= 0) return undefined
    const timer = window.setTimeout(() => setCooldown((current) => Math.max(0, current - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])

  async function handleSolicitar(e: React.FormEvent) {
    e.preventDefault()
    if (loading || cooldown > 0) return
    setLoading(true)
    setError("")
    setOk("")

    try {
      const res = await fetch(buildTenantApiPath(tenant.slug, "/password/forgot"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setError(data?.error ?? "No se pudo enviar el mail de recuperación")
        return
      }

      setOk("Si existe una cuenta con ese email, enviamos un enlace de recuperación.")
      setCooldown(RESEND_COOLDOWN_SECONDS)
    } catch {
      setError("No se pudo enviar el mail de recuperación. Verificá tu conexión.")
    } finally {
      setLoading(false)
    }
  }

  async function handleReset(e: React.FormEvent) {
    e.preventDefault()
    const validationError = validatePasswordPolicy(nuevaPassword)
    if (validationError) {
      setError(validationError)
      return
    }
    if (nuevaPassword !== confirmarPassword) {
      setError("Las contraseñas no coinciden")
      return
    }
    setLoading(true)
    setError("")
    setOk("")

    try {
      const res = await fetch(buildTenantApiPath(tenant.slug, "/password/reset"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, nuevaPassword, confirmarPassword }),
      })

      const data = await res.json().catch(() => null)

      if (!res.ok) {
        setError(data?.error ?? "No se pudo restablecer la contraseña")
        return
      }

      setOk("Contraseña actualizada correctamente. Ya podés iniciar sesión.")
    } catch {
      setError("No se pudo restablecer la contraseña. Verificá tu conexión.")
    } finally {
      setLoading(false)
    }
    setNuevaPassword("")
    setConfirmarPassword("")
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: tenant.color_fondo,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "104px 16px 40px",
      }}
    >
      <div style={{ width: "100%", maxWidth: "380px" }}>
        <div style={{ textAlign: "center", marginBottom: "24px" }}>
          <div style={{ display: "inline-flex", alignItems: "center", padding: "6px 12px", borderRadius: "999px", background: `${tenant.color_texto}10`, color: `${tenant.color_texto}cc`, fontSize: "11px", fontWeight: 700, marginBottom: "12px" }}>
            Seguridad de acceso
          </div>
          <h1 style={{ color: tenant.color_texto, fontSize: "24px", fontWeight: 900, marginBottom: "6px" }}>
            {token ? "Restablecer contraseña" : "Recuperar acceso"}
          </h1>
          <p style={{ color: tenant.color_texto, opacity: 0.55, fontSize: "14px" }}>
            {token ? "Elegí una nueva contraseña para seguir comprando" : "Te enviamos un enlace simple por email"}
          </p>
        </div>

        <div
          style={{
            background: `${tenant.color_texto}08`,
            border: `1px solid ${tenant.color_texto}14`,
            borderRadius: "16px",
            padding: "12px 16px",
            marginBottom: "16px",
            color: `${tenant.color_texto}80`,
            fontSize: "13px",
            lineHeight: 1.5,
          }}
        >
          {token
            ? "Elegí una contraseña nueva y segura para volver a entrar a tu cuenta."
            : "Ingresá el email con el que compraste tus entradas y te vamos a mandar un enlace de recuperación."}
        </div>

        <div
          style={{
            background: `${tenant.color_texto}08`,
            border: `1px solid ${tenant.color_texto}20`,
            borderRadius: "24px",
            padding: "24px",
            boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
          }}
        >
          {error && <div style={{ background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", fontSize: "14px", padding: "10px 16px", borderRadius: "12px", marginBottom: "12px" }}>{error}</div>}
          {ok && <div style={{ background: "rgba(34,197,94,0.15)", border: "1px solid rgba(34,197,94,0.3)", color: "#4ade80", fontSize: "14px", padding: "10px 16px", borderRadius: "12px", marginBottom: "12px" }}>{ok}</div>}

          {!token ? (
            <form onSubmit={handleSolicitar} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <TenantInput
                tenant={tenant}
                id="tenant-reset-email"
                name="email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="Tu email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                style={{ borderColor: `${tenant.color_texto}20` }}
              />
              <button
                type="submit"
                disabled={loading || cooldown > 0}
                style={{
                  width: "100%",
                  height: "44px",
                  background: tenant.color_primario,
                  color: "#fff",
                  border: "none",
                  borderRadius: "12px",
                  fontWeight: 700,
                  cursor: loading || cooldown > 0 ? "not-allowed" : "pointer",
                  opacity: loading || cooldown > 0 ? 0.7 : 1,
                }}
              >
                <span style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                  <Send size={16} /> {loading ? "Enviando..." : cooldown > 0 ? `Reenviar en ${cooldown}s` : "Enviar enlace"}
                </span>
              </button>
            </form>
          ) : resetCompletado ? (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <Link
                href={buildTenantPath(tenant.slug, tenantRoutes.auth())}
                style={{ width: "100%", height: "44px", background: tenant.color_primario, color: "#fff", border: "none", borderRadius: "12px", fontWeight: 700, textDecoration: "none", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
              >
                Ir al login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleReset} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <TenantInput
                tenant={tenant}
                id="tenant-reset-new-password"
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder="Nueva contraseña segura"
                value={nuevaPassword}
                onChange={(e) => setNuevaPassword(e.target.value)}
                required
                style={{ borderColor: `${tenant.color_texto}20` }}
              />
              <p style={{ color: `${tenant.color_texto}99`, fontSize: "12px", lineHeight: 1.4 }}>{PASSWORD_POLICY_HELPER_TEXT}</p>
              <TenantInput
                tenant={tenant}
                id="tenant-reset-confirm-password"
                name="confirmar"
                type="password"
                autoComplete="new-password"
                placeholder="Confirmar nueva contraseña"
                value={confirmarPassword}
                onChange={(e) => setConfirmarPassword(e.target.value)}
                required
                style={{ borderColor: `${tenant.color_texto}20` }}
              />
              <button
                type="submit"
                disabled={loading}
                style={{ width: "100%", height: "44px", background: tenant.color_primario, color: "#fff", border: "none", borderRadius: "12px", fontWeight: 700, cursor: "pointer", opacity: loading ? 0.7 : 1 }}
              >
                {loading ? "Guardando..." : "Restablecer contraseña"}
              </button>
            </form>
          )}

          <div style={{ marginTop: "16px", textAlign: "center" }}>
            <Link href={buildTenantPath(tenant.slug, tenantRoutes.auth())} style={{ color: tenant.color_texto, opacity: 0.7, textDecoration: "none", fontSize: "14px", display: "inline-flex", alignItems: "center", gap: "8px", paddingTop: "8px", paddingBottom: "8px" }}>
              <ArrowLeft size={16} /> Volver al login
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
