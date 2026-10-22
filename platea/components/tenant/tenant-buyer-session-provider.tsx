"use client"

import { createContext, useContext, useMemo, useState } from "react"
import type { BuyerSessionUser } from "@/lib/buyer-session/types"

type LoginResult =
  | { ok: true; user: BuyerSessionUser | null }
  | { ok: false; error: string }

type ContextValue = {
  tenantSlug: string
  buyerSession: BuyerSessionUser | null
  status: "authenticated" | "unauthenticated" | "loading"
  loginWithPassword: (email: string, password: string) => Promise<LoginResult>
  loginWithToken: (token: string) => Promise<LoginResult>
  logout: () => Promise<void>
}

const TenantBuyerSessionContext = createContext<ContextValue | null>(null)

async function requestBuyerSession(method: "POST" | "DELETE", tenantSlug: string, body?: Record<string, unknown>) {
  const response = await fetch(method === "DELETE" ? `/api/buyer-session?tenant=${encodeURIComponent(tenantSlug)}` : "/api/buyer-session", {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify({ tenantSlug, ...body }) : undefined,
  })
  const data = await response.json().catch(() => null)
  return { ok: response.ok, data }
}

export function useTenantBuyerSession() {
  const context = useContext(TenantBuyerSessionContext)
  if (!context) throw new Error("useTenantBuyerSession must be used within TenantBuyerSessionProvider")
  return context
}

export default function TenantBuyerSessionProvider({ tenantSlug, initialBuyerSession, children }: { tenantSlug: string; initialBuyerSession: BuyerSessionUser | null; children: React.ReactNode }) {
  const [buyerSession, setBuyerSession] = useState<BuyerSessionUser | null>(initialBuyerSession)
  const [status, setStatus] = useState<"authenticated" | "unauthenticated" | "loading">(initialBuyerSession ? "authenticated" : "unauthenticated")

  const value = useMemo<ContextValue>(() => ({
    tenantSlug,
    buyerSession,
    status,
    async loginWithPassword(email: string, password: string) {
      setStatus("loading")
      const response = await requestBuyerSession("POST", tenantSlug, { mode: "password", email, password })
      if (!response.ok) {
        setStatus(buyerSession ? "authenticated" : "unauthenticated")
        return { ok: false as const, error: response.data?.error ?? "Email o contraseña incorrectos" }
      }
      const user = response.data?.user ?? null
      setBuyerSession(user)
      setStatus(user ? "authenticated" : "unauthenticated")
      return { ok: true as const, user }
    },
    async loginWithToken(token: string) {
      setStatus("loading")
      const response = await requestBuyerSession("POST", tenantSlug, { mode: "token", token })
      if (!response.ok) {
        setStatus(buyerSession ? "authenticated" : "unauthenticated")
        return { ok: false as const, error: response.data?.error ?? "Token inválido o expirado" }
      }
      const user = response.data?.user ?? null
      setBuyerSession(user)
      setStatus(user ? "authenticated" : "unauthenticated")
      return { ok: true as const, user }
    },
    async logout() {
      setStatus("loading")
      await requestBuyerSession("DELETE", tenantSlug)
      setBuyerSession(null)
      setStatus("unauthenticated")
    },
  }), [buyerSession, status, tenantSlug])

  return <TenantBuyerSessionContext.Provider value={value}>{children}</TenantBuyerSessionContext.Provider>
}
