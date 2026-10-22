"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useTenantBuyerSession } from "./tenant-buyer-session-provider"
import { useTenant } from "./tenant-provider"
import { Loader2 } from "lucide-react"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"

export default function TenantTokenLogin({ token }: { token?: string }) {
  const tenant = useTenant()
  const router = useRouter()
  const buyerSession = useTenantBuyerSession()
  const [error, setError] = useState(token ? "" : "Token inválido")
  const attemptedRef = useRef(false)

  useEffect(() => {
    if (!token || attemptedRef.current) return
    attemptedRef.current = true
    const tokenValue = token

    async function login() {
      const loginRes = await buyerSession.loginWithToken(tokenValue)

      // Defense in depth: the token is single-use, hashed at rest and expires in 60s,
      // but strip it from the URL once we know the outcome so it doesn't linger in
      // browser history or get captured by analytics/error-tracking scripts. Keeping
      // it in the URL while the request is in flight lets the user reload to retry
      // on a transient failure (network/5xx/timeout) instead of losing the token.
      window.history.replaceState({}, "", window.location.pathname)

      if (!loginRes.ok) {
        setError(loginRes.error ?? "Token inválido o expirado")
        return
      }

      router.push(buildTenantPath(tenant.slug, tenantRoutes.misTickets()))
      router.refresh()
    }

    login()
  }, [buyerSession, token, tenant.slug, router])

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
      {error ? (
        <div style={{ textAlign: "center", maxWidth: "360px", width: "100%" }}>
          <p style={{ color: "#f87171", fontSize: "16px", fontWeight: 600 }}>{error}</p>
          <button
            onClick={() => router.push(buildTenantPath(tenant.slug, tenantRoutes.auth()))}
            style={{
              marginTop: "16px",
              padding: "10px 24px",
              background: tenant.color_primario,
              color: "#fff",
              border: "none",
              borderRadius: "12px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Ir al login
          </button>
        </div>
      ) : (
        <div style={{ textAlign: "center", color: tenant.color_texto, maxWidth: "360px", width: "100%" }}>
          <Loader2 size={32} className="animate-spin" style={{ margin: "0 auto 16px" }} />
          <p style={{ fontSize: "14px", opacity: 0.6 }}>Iniciando sesión...</p>
        </div>
      )}
    </div>
  )
}
