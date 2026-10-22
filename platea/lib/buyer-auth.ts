import bcrypt from "bcryptjs"
import { prisma } from "@/lib/prisma"
import { consumeBuyerLoginToken } from "@/lib/buyer-token-auth"
import type { BuyerSessionUser } from "@/lib/buyer-session/types"
import { toPasswordVersion } from "@/lib/password-version"

function normalizeLoginEmail(email: string) {
  return email.trim().toLowerCase()
}

type BuyerRow = {
  id: string
  nombre: string
  email: string
  empresa_id: string
  empresa_slug: string
  password: string | null
  password_changed_at: Date | null
  must_change_password: boolean | null
}

export async function authenticateBuyerByCredentials(email: string, password: string, empresaSlug: string): Promise<BuyerSessionUser | null> {
  // Comprador has no @relation to Empresa — use $queryRaw for the JOIN.
  const rows = await prisma.$queryRaw<BuyerRow[]>`
    SELECT c.id, c.nombre, c.email, c.empresa_id, e.slug AS empresa_slug, c.password, c.password_changed_at, c.must_change_password
    FROM compradores c
    JOIN empresas e ON e.id = c.empresa_id
    WHERE LOWER(TRIM(c.email)) = ${normalizeLoginEmail(email)}
      AND e.slug = ${empresaSlug}
      AND e.activa = true
      AND COALESCE(e.tenant_public_disabled, false) = false
      AND COALESCE(e.suspendido, false) = false
  `

  const comprador = rows[0]
  if (!comprador) return null
  if (!comprador.password) return null
  if (!(await bcrypt.compare(password, comprador.password))) return null

  return {
    id: String(comprador.id),
    email: String(comprador.email),
    name: String(comprador.nombre),
    userType: "comprador",
    empresa_id: String(comprador.empresa_id),
    empresa_slug: String(comprador.empresa_slug),
    passwordVersion: toPasswordVersion(comprador.password_changed_at),
    mustChangePassword: comprador.must_change_password === true,
  }
}

export async function authenticateBuyerByToken(token: string, empresaSlug: string): Promise<BuyerSessionUser | null> {
  const consumed = await consumeBuyerLoginToken(token, empresaSlug)
  if (!consumed) return null

  // Comprador has no @relation to Empresa — use $queryRaw for the JOIN.
  const rows = await prisma.$queryRaw<BuyerRow[]>`
    SELECT c.id, c.nombre, c.email, c.empresa_id, e.slug AS empresa_slug, c.password_changed_at, c.must_change_password
    FROM compradores c
    JOIN empresas e ON e.id = c.empresa_id
    WHERE c.id = ${consumed.id}
      AND e.slug = ${empresaSlug}
      AND e.activa = true
      AND COALESCE(e.tenant_public_disabled, false) = false
      AND COALESCE(e.suspendido, false) = false
    LIMIT 1
  `

  const comprador = rows[0]
  if (!comprador) return null

  return {
    id: String(comprador.id),
    email: String(comprador.email),
    name: String(comprador.nombre),
    userType: "comprador",
    empresa_id: String(comprador.empresa_id),
    empresa_slug: String(comprador.empresa_slug),
    passwordVersion: toPasswordVersion(comprador.password_changed_at),
    mustChangePassword: comprador.must_change_password === true,
  }
}
