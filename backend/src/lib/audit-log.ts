import type { Request } from 'express'
import { prisma } from './prisma'
import type { SessionUser } from '../types'

export type AuditActor = {
  id?: string | null
  email?: string | null
  label?: string | null
  type?: string | null
}

export type AuditEvent = {
  actor: AuditActor
  action: string
  entityType?: string | null
  entityId?: string | null
  entityLabel?: string | null
  payload?: Record<string, unknown> | null
  ipAddress?: string | null
}

export function actorFromSession(user: SessionUser | null | undefined): AuditActor {
  if (!user) return { type: 'anonymous' }
  return {
    id: user.id,
    email: user.email ?? null,
    label: user.name ?? user.email ?? null,
    type: user.userType,
  }
}

export function actorFromRequest(req: Request): AuditActor {
  return actorFromSession(req.user)
}

/**
 * Persiste un evento de auditoría. Fail-safe: si falla la escritura,
 * loguea a console pero no rompe la operación principal. La razón:
 * auditoría es un side-effect, no debe bloquear la lógica de negocio.
 */
export async function logAuditEvent(event: AuditEvent): Promise<void> {
  try {
    await prisma.$executeRaw`
      INSERT INTO audit_logs
        (actor_id, actor_email, actor_label, actor_type, action, entity_type, entity_id, entity_label, payload, ip_address)
      VALUES (
        ${event.actor.id ?? null},
        ${event.actor.email ?? null},
        ${event.actor.label ?? null},
        ${event.actor.type ?? null},
        ${event.action},
        ${event.entityType ?? null},
        ${event.entityId ?? null},
        ${event.entityLabel ?? null},
        ${event.payload ? JSON.stringify(event.payload) : null}::jsonb,
        ${event.ipAddress ?? null}
      )
    `
  } catch (err) {
    // No loguear el err completo: el error de Prisma/Postgres puede incluir la query
    // interpolada (puede contener payload JSON con datos sensibles). Solo loguear el code y action.
    console.error('[audit-log] persist failed', {
      action: event.action,
      errorCode: (err as { code?: string } | null)?.code ?? 'unknown',
    })
  }
}
