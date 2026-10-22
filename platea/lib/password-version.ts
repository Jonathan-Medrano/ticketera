// Table managed by prisma/schema.prisma — DDL removed (was inline before migration)
// ALTER TABLE calls that were here have been replaced by the Prisma schema for
// Empresa, Usuario, Comprador, and PlatformAdminUser models.
//
// TODO (Phase 2.x — platea/auth.ts): platea/auth.ts still calls ensurePasswordVersionColumns()
// and uses mysql2/pool. ensurePasswordVersionColumns is exported as a no-op shim here so it
// compiles while that file is awaiting translation. Remove the shim once platea/auth.ts is migrated.
import { prisma } from "@/lib/prisma"

// No-op shim — DDL is no longer needed since schema is managed by Prisma.
// Remove this once platea/auth.ts is translated (Phase 2.x).
export async function ensurePasswordVersionColumns() {
  // no-op: columns are managed by prisma/schema.prisma
}

export function toPasswordVersion(value: unknown) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(String(value))
  const time = date.getTime()
  return Number.isFinite(time) ? time : null
}

export async function getCompanyPasswordVersion(companyId: string) {
  const empresa = await prisma.empresa.findFirst({
    where: { id: companyId, activa: true },
    select: { password_changed_at: true },
  })
  return toPasswordVersion(empresa?.password_changed_at)
}

export async function getEmployeePasswordVersion(employeeId: string, email: string) {
  // No @relation on Usuario — need JOIN via $queryRaw to filter by empresa.activa.
  // email is stored lowercased per design.
  const rows = await prisma.$queryRaw<Array<{ password_changed_at: Date | null }>>`
    SELECT u.password_changed_at
    FROM usuarios u
    JOIN empresas e ON e.id = u.empresa_id
    WHERE u.id = ${employeeId} AND u.email = ${email} AND u.activo = true AND e.activa = true
    LIMIT 1
  `
  return toPasswordVersion(rows[0]?.password_changed_at)
}

export async function getPlatformAdminPasswordVersion(adminId: string) {
  const admin = await prisma.platformAdminUser.findFirst({
    where: { id: adminId, activo: true },
    select: { password_changed_at: true },
  })
  return toPasswordVersion(admin?.password_changed_at)
}

export async function getBuyerPasswordVersion(buyerId: string) {
  // No @relation on Comprador — need JOIN via $queryRaw to filter by empresa.activa.
  const rows = await prisma.$queryRaw<Array<{ password_changed_at: Date | null }>>`
    SELECT c.password_changed_at
    FROM compradores c
    JOIN empresas e ON e.id = c.empresa_id
    WHERE c.id = ${buyerId} AND e.activa = true
    LIMIT 1
  `
  return toPasswordVersion(rows[0]?.password_changed_at)
}
