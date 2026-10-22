import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { BUYER_SESSION_COOKIE_NAME, getBuyerSessionForTenant, parseBuyerSessionRegistry, removeBuyerSession, serializeBuyerSessionRegistry, upsertBuyerSession } from "@/lib/buyer-session/registry"
import type { BuyerSessionRegistry, BuyerSessionUser } from "@/lib/buyer-session/types"
import { getBuyerPasswordVersion } from "@/lib/password-version"
import { prisma } from "@/lib/prisma"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  }
}

export function readBuyerSessionRegistryFromRequest(request: { cookies: { get(name: string): { value: string } | undefined } }) {
  return parseBuyerSessionRegistry(request.cookies.get(BUYER_SESSION_COOKIE_NAME)?.value)
}

export async function readBuyerSessionRegistry(): Promise<BuyerSessionRegistry> {
  const cookieStore = await cookies()
  return parseBuyerSessionRegistry(cookieStore.get(BUYER_SESSION_COOKIE_NAME)?.value)
}

export async function validateBuyerSessionFreshness(
  buyer: BuyerSessionUser | null,
  deps: {
    getBuyerPasswordVersion?: typeof getBuyerPasswordVersion
  } = {}
): Promise<BuyerSessionUser | null> {
  if (!buyer) return null

  if (buyer.passwordVersion === null) {
    return buyer
  }

  const currentPasswordVersion = await (deps.getBuyerPasswordVersion ?? getBuyerPasswordVersion)(buyer.id)
  if (currentPasswordVersion === null || currentPasswordVersion === buyer.passwordVersion) {
    return buyer
  }

  return null
}

export async function getBuyerSessionForTenantSlug(tenantSlug: string): Promise<BuyerSessionUser | null> {
  return validateBuyerSessionFreshness(getBuyerSessionForTenant(await readBuyerSessionRegistry(), tenantSlug))
}

export function resolveBuyerSessionRedirectPath(tenantSlug: string, redirectTo?: string) {
  return buildTenantPath(tenantSlug, tenantRoutes.auth(redirectTo))
}

/**
 * Si el comprador tiene una session activa Y must_change_password=true en DB,
 * lo redirige a /actualizar-password. No-op si no hay session (público no
 * autenticado puede seguir navegando). Diseñado para usarse en el TenantLayout
 * y bloquear acceso a todas las rutas del tenant (eventos, consumibles, etc)
 * mientras el comprador no rote.
 */
export async function enforceBuyerPasswordRotation(tenantSlug: string) {
  const buyer = await getBuyerSessionForTenantSlug(tenantSlug)
  if (!buyer) return // no logueado: las rutas públicas siguen accesibles
  const row = await prisma.comprador.findUnique({
    where: { id: buyer.id },
    select: { must_change_password: true },
  })
  if (row?.must_change_password === true) {
    redirect(buildTenantPath(tenantSlug, "/actualizar-password"))
  }
}

export async function requireBuyerSessionForTenant(
  tenantSlug: string,
  redirectTo?: string,
  deps: {
    getBuyerSessionForTenantSlug?: (tenantSlug: string) => Promise<BuyerSessionUser | null>
    redirect?: (location: string) => never
    skipRotationCheck?: boolean
  } = {}
) {
  const buyer = await (deps.getBuyerSessionForTenantSlug ?? getBuyerSessionForTenantSlug)(tenantSlug)
  if (!buyer) {
    ;(deps.redirect ?? redirect)(resolveBuyerSessionRedirectPath(tenantSlug, redirectTo))
    // unreachable — el redirect tira RedirectError. Throw explícito para narrow TS.
    throw new Error("redirected")
  }
  // Comprador con must_change_password=true tiene que rotar antes de seguir.
  // Chequeamos DIRECTO en DB (no solo cookie) porque:
  //  1. Cookies viejos (pre-fix) no tienen el campo mustChangePassword
  //  2. Si la empresa lo resetea mientras el comprador está navegando, el cookie
  //     tiene info stale.
  // El parámetro skipRotationCheck=true se usa en la propia página de rotación
  // para evitar loop infinito.
  if (!deps.skipRotationCheck) {
    const row = await prisma.comprador.findUnique({
      where: { id: buyer.id },
      select: { must_change_password: true },
    })
    if (row?.must_change_password === true) {
      ;(deps.redirect ?? redirect)(buildTenantPath(tenantSlug, "/actualizar-password"))
      throw new Error("redirected")
    }
  }
  return buyer
}

export function writeBuyerSession(response: { cookies: { set(name: string, value: string, options: ReturnType<typeof cookieOptions>): void } }, registry: BuyerSessionRegistry, tenantSlug: string, user: BuyerSessionUser) {
  response.cookies.set(BUYER_SESSION_COOKIE_NAME, serializeBuyerSessionRegistry(upsertBuyerSession(registry, tenantSlug, user)), cookieOptions())
}

export function clearBuyerSession(response: { cookies: { set(name: string, value: string, options: ReturnType<typeof cookieOptions>): void } }, registry: BuyerSessionRegistry, tenantSlug: string) {
  const nextRegistry = removeBuyerSession(registry, tenantSlug)
  if (Object.keys(nextRegistry).length === 0) {
    response.cookies.set(BUYER_SESSION_COOKIE_NAME, "", { ...cookieOptions(), maxAge: 0 })
    return
  }
  response.cookies.set(BUYER_SESSION_COOKIE_NAME, serializeBuyerSessionRegistry(nextRegistry), cookieOptions())
}
