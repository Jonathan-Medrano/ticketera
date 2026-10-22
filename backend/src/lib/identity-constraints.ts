import { prisma } from './prisma'

export function normalizeActorEmail(email: string) {
  return email.trim().toLowerCase()
}

/**
 * No-op in Postgres: unique indexes are managed via Prisma schema migrations.
 * Kept for API compatibility with callers that invoke this at startup.
 */
export async function ensureIdentityConstraints() {
  // MySQL-specific DDL guards removed — Postgres schema enforces these constraints.
}

export async function assertBuyerEmailAvailable(email: string, empresaId: string, excludeBuyerId?: string) {
  const normalizedEmail = normalizeActorEmail(email)

  const comprador = await prisma.comprador.findFirst({
    where: {
      empresa_id: empresaId,
      email: normalizedEmail,
      ...(excludeBuyerId ? { NOT: { id: excludeBuyerId } } : {}),
    },
    select: { id: true },
  })

  if (comprador) {
    throw new Error('Ya existe una cuenta compradora con ese email en esta empresa')
  }

  return normalizedEmail
}
