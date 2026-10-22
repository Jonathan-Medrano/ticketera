import { PrismaClient } from '@prisma/client'

/**
 * Two-client architecture (per migrate-to-postgres-prisma design):
 *
 * - `prisma`           → DATABASE_URL = Supabase pooler (port 6543, transaction mode).
 *                        Para queries cortas, sin advisory locks ni session-scoped state.
 *
 * - `prismaDirectUrl`  → DIRECT_URL = conexión directa (port 5432).
 *                        OBLIGATORIO para:
 *                          - prisma migrate deploy
 *                          - $queryRaw con FOR UPDATE
 *                          - Advisory locks (pg_advisory_xact_lock)
 *                          - Cualquier transacción larga
 *
 * Si necesitás bloquear stock o procesar refunds → SIEMPRE `prismaDirectUrl`.
 */

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient
  prismaDirectUrl?: PrismaClient
}

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

export const prismaDirectUrl =
  globalForPrisma.prismaDirectUrl ??
  new PrismaClient({
    datasources: { db: { url: process.env.DIRECT_URL } },
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
  globalForPrisma.prismaDirectUrl = prismaDirectUrl
}

async function shutdown() {
  await Promise.allSettled([prisma.$disconnect(), prismaDirectUrl.$disconnect()])
  process.exit(0)
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
