import { createHash } from "node:crypto"
import { prisma } from "@/lib/prisma"

type CompradorTokenRow = {
  id: string
  nombre: string
  email: string
  empresa_slug: string
}

export async function consumeBuyerLoginToken(token: string, empresaSlug: string) {
  const normalizedToken = token.trim()
  const normalizedSlug = empresaSlug.trim()

  if (!normalizedToken || !normalizedSlug) {
    return null
  }

  const tokenHash = createHash("sha256").update(normalizedToken).digest("hex")

  // Marca el token como usado atómicamente: empresa activa + no-usado + no-expirado.
  // Postgres usa `UPDATE ... SET ... FROM ...` (NO `UPDATE ... JOIN ... SET`, que es
  // sintaxis MySQL y rompía el login por token tras la migración a Postgres).
  const updateResult = await prisma.$executeRaw`
    UPDATE login_tokens t
    SET usado = true
    FROM compradores c, empresas e
    WHERE t.id = ${tokenHash}
      AND c.id = t.comprador_id
      AND e.id = c.empresa_id
      AND t.empresa_slug = ${normalizedSlug}
      AND e.slug = ${normalizedSlug}
      AND e.activa = true
      AND COALESCE(e.tenant_public_disabled, false) = false
      AND t.usado = false
      AND t.expires_at > NOW()
  `

  if (updateResult !== 1) {
    return null
  }

  const rows = await prisma.$queryRaw<CompradorTokenRow[]>`
    SELECT c.id, c.nombre, c.email, e.slug AS empresa_slug
    FROM login_tokens t
    JOIN compradores c ON c.id = t.comprador_id
    JOIN empresas e ON e.id = c.empresa_id
    WHERE t.id = ${tokenHash}
      AND e.slug = ${normalizedSlug}
      AND e.activa = true
      AND COALESCE(e.tenant_public_disabled, false) = false
    LIMIT 1
  `

  return rows[0] ?? null
}
