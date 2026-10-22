"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTenantBuyerSession } from "./tenant-buyer-session-provider"
import { useTenant } from "./tenant-provider"
import { buildTenantApiPath } from "@/lib/tenant"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"
import { resolveSafeTenantRedirect } from "@/lib/redirect-whitelist"
import {
  TenantAuthCard,
  TenantAuthLoginForm,
  TenantAuthRegisterForm,
  TenantAuthShell,
  TenantAuthTabs,
} from "./tenant-auth-sections"
import { validatePasswordPolicy } from "@/lib/password-policy"

export default function TenantAuth({ redirectTo }: { redirectTo?: string }) {
  const tenant = useTenant()
  const router = useRouter()
  const buyerSession = useTenantBuyerSession()

  function resolveRedirectTarget() {
    const target = resolveSafeTenantRedirect(redirectTo)
    return target === "/" ? buildTenantPath(tenant.slug, tenantRoutes.home()) : buildTenantPath(tenant.slug, target)
  }

  useEffect(() => {
    if (!buyerSession.buyerSession) return
    router.replace(resolveRedirectTarget())
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buyerSession.buyerSession])

  const [tab, setTab] = useState<"login" | "registro">("login")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState("")
  const [showPass, setShowPass] = useState(false)
  const [showPass2, setShowPass2] = useState(false)

  const [loginData, setLoginData] = useState({ email: "", password: "" })
  const [regData, setRegData] = useState({
    nombre: "",
    apellido: "",
    email: "",
    dni: "",
    password: "",
    confirmar: "",
  })

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    setLoading(true)

    const res = await buyerSession.loginWithPassword(loginData.email, loginData.password)
    setLoading(false)

    if (!res.ok) {
      setError(res.error ?? "Email o contraseña incorrectos")
      return
    }

    if (res.user?.mustChangePassword) {
      router.push(buildTenantPath(tenant.slug, tenantRoutes.actualizarPassword()))
      router.refresh()
      return
    }

    router.push(resolveRedirectTarget())
    router.refresh()
  }

  async function handleRegistro(e: React.FormEvent) {
    e.preventDefault()
    setError("")

    const passwordValidationError = validatePasswordPolicy(regData.password)
    if (passwordValidationError) {
      setError(passwordValidationError)
      return
    }
    if (regData.password !== regData.confirmar) {
      setError("Las contraseñas no coinciden")
      return
    }

    setLoading(true)

    try {
      const res = await fetch(buildTenantApiPath(tenant.slug, "/registro"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(regData),
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok) {
        setError((data as { error?: string }).error ?? "Error al crear la cuenta")
        return
      }

      const loginRes = await buyerSession.loginWithPassword(regData.email, regData.password)

      if (!loginRes.ok) {
        setError("Cuenta creada. Iniciá sesión.")
        setTab("login")
        return
      }

      router.push(resolveRedirectTarget())
      router.refresh()
    } catch {
      setError("No se pudo crear la cuenta. Verificá tu conexión.")
    } finally {
      setLoading(false)
    }
  }

  const p = tenant.color_primario
  const bg = tenant.color_fondo
  const tx = tenant.color_texto
  const palette = { primary: p, background: bg, text: tx }

  return (
    <TenantAuthShell tenant={tenant} palette={palette}>
      <TenantAuthTabs
        palette={palette}
        tab={tab}
        onChange={(nextTab) => {
          setTab(nextTab)
          setError("")
        }}
      />

      <TenantAuthCard palette={palette} error={error}>
        {tab === "login" ? (
          <TenantAuthLoginForm
            tenant={tenant}
            palette={palette}
            loginData={loginData}
            showPass={showPass}
            loading={loading}
            onSubmit={handleLogin}
            onChange={setLoginData}
            onTogglePassword={() => setShowPass(!showPass)}
          />
        ) : (
          <TenantAuthRegisterForm
            tenant={tenant}
            palette={palette}
            regData={regData}
            showPass={showPass}
            showPass2={showPass2}
            loading={loading}
            onSubmit={handleRegistro}
            onChange={setRegData}
            onTogglePassword={() => setShowPass(!showPass)}
            onTogglePasswordConfirm={() => setShowPass2(!showPass2)}
          />
        )}
      </TenantAuthCard>
    </TenantAuthShell>
  )
}
