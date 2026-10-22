import { Prisma } from '@prisma/client'

/**
 * Returns a safe error message for HTTP responses.
 * Masks Prisma/DB infrastructure errors to avoid leaking internals;
 * passes through explicit business-logic error messages.
 */
export function safeMsg(err: unknown, fallback: string): string {
  if (
    err instanceof Prisma.PrismaClientKnownRequestError ||
    err instanceof Prisma.PrismaClientUnknownRequestError ||
    err instanceof Prisma.PrismaClientInitializationError ||
    err instanceof Prisma.PrismaClientRustPanicError
  ) {
    return fallback
  }
  return err instanceof Error ? err.message : fallback
}
