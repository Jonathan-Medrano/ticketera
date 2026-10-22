import { PrismaClient } from '@prisma/client'

/**
 * Frontend Prisma client — usa Supabase pooler (DATABASE_URL, port 6543).
 *
 * No tiene client directo porque el frontend no debe correr migrations ni
 * advisory locks; cualquier operación de locking pesado debe pasar por el
 * backend Express (vía BFF) que sí tiene `prismaDirectUrl`.
 *
 * Patrón singleton para Next.js dev mode (hot reload).
 */

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  })

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}
