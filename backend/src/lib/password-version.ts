// Table columns managed by prisma/schema.prisma — DDL removed (was inline before migration)
// Columns that were being ensured via ALTER TABLE are now part of the Empresa, Usuario,
// and Comprador models in schema.prisma.
import { Prisma } from '@prisma/client'
import { prisma } from './prisma'

// Accepts an optional Prisma transaction client so callers running inside
// prismaDirectUrl.$transaction() can pass `tx` and keep everything atomic.
type PrismaTx = Omit<typeof prisma, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>

export async function touchPasswordVersion(
  actorType: 'empresa' | 'empleado' | 'comprador',
  actorId: string,
  tx: PrismaTx = prisma,
) {
  const now = new Date()

  if (actorType === 'empresa') {
    await tx.empresa.update({
      where: { id: actorId },
      data: { password_changed_at: now },
    })
    return
  }

  if (actorType === 'empleado') {
    await tx.usuario.update({
      where: { id: actorId },
      data: { password_changed_at: now },
    })
    return
  }

  await tx.comprador.update({
    where: { id: actorId },
    data: { password_changed_at: now },
  })
}

export async function clearInternalPasswordRotationRequirement(
  actorId: string,
  tx: PrismaTx = prisma,
) {
  await tx.usuario.update({
    where: { id: actorId },
    data: {
      must_change_password: false,
      temporary_password_set_at: null,
    },
  })
}

// Re-export the Prisma error class so callers can catch P-codes without
// importing from @prisma/client directly (mirrors the mysql2 import pattern).
export { Prisma }
