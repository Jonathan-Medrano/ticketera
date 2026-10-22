import crypto from 'crypto'
import bcrypt from 'bcryptjs'
import { randomUUID as uuidv4 } from 'node:crypto'
import { Prisma } from '@prisma/client'
import { prisma, prismaDirectUrl } from './prisma'
import { Resend } from 'resend'
import { logServerInfo, logServerWarn } from './safe-log'
import { clearInternalPasswordRotationRequirement, touchPasswordVersion } from './password-version'
import { buildPasswordPolicyError, validatePasswordPolicy } from './password-policy'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

function getFromEmail(): string {
  const from = process.env.RESEND_FROM_EMAIL
  if (!from && process.env.NODE_ENV === 'production') {
    throw new Error('RESEND_FROM_EMAIL is required in production')
  }
  return from ?? 'onboarding@resend.dev'
}

const resendFromEmail = getFromEmail()

export type PasswordResetActor = 'empresa' | 'empleado' | 'comprador'

export interface PasswordResetRequestInput {
  actorType: PasswordResetActor
  email: string
  tenantSlug?: string
  resetBaseUrl?: string
  requestIp?: string | null
  requestUserAgent?: string | null
}

export interface PasswordResetConsumeInput {
  token: string
  nuevaPassword: string
  confirmarPassword: string
  actorType?: PasswordResetActor
  tenantSlug?: string
  consumedIp?: string | null
  consumedUserAgent?: string | null
}

type ResolvedPasswordResetActor = {
  actorType: PasswordResetActor
  actorId: string
  empresaId: string
  tenantSlug: string | null
  email: string
  displayName: string
  empresaNombre: string
  resetBaseUrl: string
}

const PASSWORD_RESET_TTL_MINUTES = 15
const PASSWORD_RESET_TTL_MS = PASSWORD_RESET_TTL_MINUTES * 60 * 1000
const PUBLIC_RESET_RESPONSE = { ok: true }

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function hashResetToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

const APP_BASE_DOMAIN = process.env.TENANT_BASE_URL ?? 'https://ticketera.com'

function buildAppBaseUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : APP_BASE_DOMAIN)
}

function buildResetUrl(actor: ResolvedPasswordResetActor, token: string) {
  const base = actor.resetBaseUrl.replace(/\/$/, '')
  if (actor.actorType === 'comprador') {
    return `${base}/auth/reset?token=${encodeURIComponent(token)}`
  }

  return `${base}/login/reset?token=${encodeURIComponent(token)}&actor=${actor.actorType}`
}

function escHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function buildEmailCopy(actor: ResolvedPasswordResetActor, resetUrl: string) {
  if (actor.actorType === 'comprador') {
    return {
      subject: `Recuperá tu acceso a ${actor.empresaNombre}`,
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2>Hola ${escHtml(actor.displayName)}</h2>
          <p>Recibimos un pedido para restablecer tu contraseña.</p>
          <p>Este enlace vence en ${PASSWORD_RESET_TTL_MINUTES} minutos:</p>
          <p><a href="${escHtml(resetUrl)}">${escHtml(resetUrl)}</a></p>
          <p style="color:#666;font-size:13px">Si no fuiste vos, podés ignorar este mensaje.</p>
        </div>
      `,
    }
  }

  return {
    subject: `Recuperá el acceso a ${actor.empresaNombre}`,
    html: `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
        <h2>Hola ${escHtml(actor.displayName)}</h2>
        <p>Recibimos un pedido para restablecer la contraseña de tu acceso.</p>
        <p>Este enlace vence en ${PASSWORD_RESET_TTL_MINUTES} minutos:</p>
        <p><a href="${escHtml(resetUrl)}">${escHtml(resetUrl)}</a></p>
        <p style="color:#666;font-size:13px">Si no fuiste vos, podés ignorar este mensaje.</p>
      </div>
    `,
  }
}

function auditPasswordReset(event: string, payload: Record<string, unknown>) {
  const status = typeof payload.status === 'string' ? payload.status : 'ok'
  const actorType = typeof payload.actorType === 'string' ? payload.actorType : 'unknown'
  const tenantScoped = payload.tenantSlug ? 'tenant' : 'global'
  logServerInfo(`[PasswordReset] ${event} actor=${actorType} status=${status} scope=${tenantScoped}`)
}

async function resolveActorForReset(input: PasswordResetRequestInput): Promise<ResolvedPasswordResetActor | null> {
  // email is stored lowercased per design
  const email = normalizeEmail(input.email)

  if (input.actorType === 'empresa') {
    // No relation fields in schema — direct field query is fine here.
    const empresa = await prisma.empresa.findFirst({
      where: { email, activa: true },
      select: { id: true, nombre: true, slug: true, email: true, admin_nombre: true },
    })

    if (!empresa) return null

    return {
      actorType: 'empresa',
      actorId: empresa.id,
      empresaId: empresa.id,
      tenantSlug: empresa.slug,
      email: empresa.email ?? email,
      displayName: empresa.admin_nombre || empresa.nombre,
      empresaNombre: empresa.nombre,
      resetBaseUrl: input.resetBaseUrl || buildAppBaseUrl(),
    }
  }

  if (input.actorType === 'empleado') {
    // JOIN required — no @relation on Usuario model; use $queryRaw.
    const rows = await prisma.$queryRaw<Array<{
      id: string
      nombre: string
      apellido: string | null
      email: string
      empresa_id: string
      empresa_nombre: string
      empresa_slug: string
    }>>`
      SELECT u.id, u.nombre, u.apellido, u.email, u.empresa_id,
             e.nombre AS empresa_nombre, e.slug AS empresa_slug
      FROM usuarios u
      JOIN empresas e ON e.id = u.empresa_id
      WHERE u.email = ${email} AND u.activo = true AND e.activa = true
      LIMIT 1
    `

    const empleado = rows[0]
    if (!empleado) return null

    return {
      actorType: 'empleado',
      actorId: empleado.id,
      empresaId: empleado.empresa_id,
      tenantSlug: empleado.empresa_slug,
      email: empleado.email,
      displayName: `${empleado.nombre} ${empleado.apellido ?? ''}`.trim(),
      empresaNombre: empleado.empresa_nombre,
      resetBaseUrl: input.resetBaseUrl || buildAppBaseUrl(),
    }
  }

  if (!input.tenantSlug) return null

  // JOIN required — no @relation on Comprador model; use $queryRaw.
  const rows = await prisma.$queryRaw<Array<{
    id: string
    nombre: string
    email: string
    empresa_id: string
    empresa_nombre: string
    empresa_slug: string
  }>>`
    SELECT c.id, c.nombre, c.email, c.empresa_id,
           e.nombre AS empresa_nombre, e.slug AS empresa_slug
    FROM compradores c
    JOIN empresas e ON e.id = c.empresa_id
    WHERE c.email = ${email} AND e.slug = ${input.tenantSlug} AND e.activa = true
    LIMIT 1
  `

  const comprador = rows[0]
  if (!comprador) return null

  return {
    actorType: 'comprador',
    actorId: comprador.id,
    empresaId: comprador.empresa_id,
    tenantSlug: comprador.empresa_slug,
    email: comprador.email,
    displayName: comprador.nombre,
    empresaNombre: comprador.empresa_nombre,
    resetBaseUrl: input.resetBaseUrl || buildAppBaseUrl(),
  }
}

export async function requestPasswordReset(input: PasswordResetRequestInput) {
  // email is stored lowercased per design
  const email = normalizeEmail(input.email)

  if (!email) {
    return { ok: false as const, status: 400, error: 'El email es obligatorio' }
  }

  const actor = await resolveActorForReset({ ...input, email })

  if (!actor) {
    auditPasswordReset('password_reset_requested', {
      actorType: input.actorType,
      email,
      tenantSlug: input.tenantSlug ?? null,
      status: 'ignored',
      reason: 'actor_not_found',
      requestIp: input.requestIp ?? null,
    })
    return { ok: true as const, status: 200, data: PUBLIC_RESET_RESPONSE }
  }

  const token = crypto.randomBytes(32).toString('hex')
  const tokenHash = hashResetToken(token)
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_TTL_MS)
  const now = new Date()

  // Invalidate active tokens then insert the new one atomically.
  // No FOR UPDATE needed here — pooler client is sufficient.
  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: {
        actor_type: actor.actorType,
        actor_id: actor.actorId,
        used_at: null,
        invalidated_at: null,
        expires_at: { gt: now },
      },
      data: {
        invalidated_at: now,
        invalidation_reason: 'reissued',
      },
    }),
    prisma.passwordResetToken.create({
      data: {
        id: uuidv4(),
        actor_type: actor.actorType,
        actor_id: actor.actorId,
        empresa_id: actor.empresaId,
        tenant_slug: actor.tenantSlug,
        email: actor.email,
        token_hash: tokenHash,
        expires_at: expiresAt,
        requested_ip: input.requestIp ?? null,
        requested_user_agent: input.requestUserAgent ?? null,
      },
    }),
  ])

  const resetUrl = buildResetUrl(actor, token)
  const emailCopy = buildEmailCopy(actor, resetUrl)

  if (!resend) {
    auditPasswordReset('password_reset_rejected', {
      actorType: actor.actorType,
      actorId: actor.actorId,
      empresaId: actor.empresaId,
      tenantSlug: actor.tenantSlug,
      status: 'email_provider_not_configured',
      requestIp: input.requestIp ?? null,
    })
  }

  try {
    const sendResult = await resend?.emails.send({
      from: resendFromEmail,
      to: actor.email,
      subject: emailCopy.subject,
      html: emailCopy.html,
    })
    // Resend NO lanza excepción cuando rechaza (dominio sin verificar, sandbox,
    // rate limit): devuelve { data: null, error }. Sin chequear este campo, el
    // reset "se envía" en falso y el usuario nunca recibe el enlace.
    if (sendResult?.error) {
      auditPasswordReset('password_reset_rejected', {
        actorType: actor.actorType,
        actorId: actor.actorId,
        empresaId: actor.empresaId,
        tenantSlug: actor.tenantSlug,
        status: 'email_rejected',
        requestIp: input.requestIp ?? null,
        error: `${actor.actorType} status=${sendResult.error.statusCode ?? '?'} ${sendResult.error.name}: ${sendResult.error.message}`,
      })
      logServerWarn(
        `[PasswordReset] Resend rechazó el envío actor=${actor.actorType} status=${sendResult.error.statusCode ?? '?'} ${sendResult.error.name}: ${sendResult.error.message}`,
      )
    }
  } catch (error) {
    auditPasswordReset('password_reset_rejected', {
      actorType: actor.actorType,
      actorId: actor.actorId,
      empresaId: actor.empresaId,
      tenantSlug: actor.tenantSlug,
      status: 'email_failed',
      requestIp: input.requestIp ?? null,
      error: error instanceof Error ? error.message : 'unknown_error',
    })
  }

  auditPasswordReset('password_reset_issued', {
    actorType: actor.actorType,
    actorId: actor.actorId,
    empresaId: actor.empresaId,
    tenantSlug: actor.tenantSlug,
    requestIp: input.requestIp ?? null,
  })

  return { ok: true as const, status: 200, data: PUBLIC_RESET_RESPONSE }
}

export async function consumePasswordReset(input: PasswordResetConsumeInput) {
  const token = input.token.trim()
  const nuevaPassword = input.nuevaPassword
  const confirmarPassword = input.confirmarPassword

  if (!token || !nuevaPassword || !confirmarPassword) {
    return { ok: false as const, status: 400, error: 'Todos los campos son obligatorios' }
  }

  const validation = validatePasswordPolicy(nuevaPassword)
  if (!validation.ok) {
    return { ok: false as const, status: 400, ...buildPasswordPolicyError(validation.reason) }
  }

  if (nuevaPassword !== confirmarPassword) {
    return { ok: false as const, status: 400, error: 'Las contraseñas no coinciden' }
  }

  const hash = await bcrypt.hash(nuevaPassword, 12)
  const tokenHash = hashResetToken(token)

  // consumePasswordReset uses FOR UPDATE — must use prismaDirectUrl (direct port, not pooler).
  // The $queryRaw fetches the row with a lock; all subsequent writes happen in the same tx.
  try {
    const result = await prismaDirectUrl.$transaction(async (tx) => {
      // SELECT ... FOR UPDATE — lock the token row to prevent double-consumption.
      const rows = await tx.$queryRaw<Array<{
        id: string
        actor_type: string
        actor_id: string
        empresa_id: string
        tenant_slug: string | null
        expires_at: Date
        used_at: Date | null
        invalidated_at: Date | null
      }>>`
        SELECT id, actor_type, actor_id, empresa_id, tenant_slug, expires_at, used_at, invalidated_at
        FROM password_reset_tokens
        WHERE token_hash = ${tokenHash}
        LIMIT 1
        FOR UPDATE
      `

      const resetToken = rows[0]

      if (!resetToken) {
        auditPasswordReset('password_reset_rejected', {
          status: 'invalid_token',
          consumedIp: input.consumedIp ?? null,
        })
        return { ok: false as const, status: 404, error: 'Token inválido' }
      }

      if (input.actorType && resetToken.actor_type !== input.actorType) {
        auditPasswordReset('password_reset_rejected', {
          actorType: resetToken.actor_type,
          actorId: resetToken.actor_id,
          status: 'actor_mismatch',
          consumedIp: input.consumedIp ?? null,
        })
        return { ok: false as const, status: 400, error: 'Token inválido' }
      }

      if (input.tenantSlug && resetToken.tenant_slug !== input.tenantSlug) {
        auditPasswordReset('password_reset_rejected', {
          actorType: resetToken.actor_type,
          actorId: resetToken.actor_id,
          tenantSlug: input.tenantSlug,
          status: 'tenant_mismatch',
          consumedIp: input.consumedIp ?? null,
        })
        return { ok: false as const, status: 400, error: 'Token inválido' }
      }

      if (resetToken.invalidated_at) {
        auditPasswordReset('password_reset_rejected', {
          actorType: resetToken.actor_type,
          actorId: resetToken.actor_id,
          status: 'invalidated_token',
          consumedIp: input.consumedIp ?? null,
        })
        return { ok: false as const, status: 400, error: 'Este enlace ya no es válido' }
      }

      if (resetToken.used_at) {
        auditPasswordReset('password_reset_rejected', {
          actorType: resetToken.actor_type,
          actorId: resetToken.actor_id,
          status: 'used_token',
          consumedIp: input.consumedIp ?? null,
        })
        return { ok: false as const, status: 400, error: 'Este enlace ya fue utilizado' }
      }

      if (new Date(resetToken.expires_at).getTime() < Date.now()) {
        auditPasswordReset('password_reset_rejected', {
          actorType: resetToken.actor_type,
          actorId: resetToken.actor_id,
          status: 'expired_token',
          consumedIp: input.consumedIp ?? null,
        })
        return { ok: false as const, status: 400, error: 'El enlace expiró' }
      }

      const now = new Date()

      // Mark token as consumed — the WHERE guards against double-consumption races.
      const consumeResult = await tx.$executeRaw`
        UPDATE password_reset_tokens
        SET used_at = ${now}, consumed_ip = ${input.consumedIp ?? null}, consumed_user_agent = ${input.consumedUserAgent ?? null}
        WHERE id = ${resetToken.id} AND used_at IS NULL AND invalidated_at IS NULL
      `

      if (!consumeResult) {
        auditPasswordReset('password_reset_rejected', {
          actorType: resetToken.actor_type,
          actorId: resetToken.actor_id,
          status: 'used_token',
          consumedIp: input.consumedIp ?? null,
        })
        return { ok: false as const, status: 400, error: 'Este enlace ya fue utilizado' }
      }

      // Update the actor's password
      const actorType = resetToken.actor_type as PasswordResetActor
      if (actorType === 'empresa') {
        const updatedCount = await tx.$executeRaw`
          UPDATE empresas SET password = ${hash} WHERE id = ${resetToken.actor_id} AND activa = true
        `
        if (!updatedCount) {
          throw new Error(`No se pudo actualizar la contraseña para actor ${actorType}:${resetToken.actor_id}`)
        }
      } else if (actorType === 'empleado') {
        const updatedCount = await tx.$executeRaw`
          UPDATE usuarios SET password = ${hash} WHERE id = ${resetToken.actor_id} AND activo = true
        `
        if (!updatedCount) {
          throw new Error(`No se pudo actualizar la contraseña para actor ${actorType}:${resetToken.actor_id}`)
        }
      } else {
        const updatedCount = await tx.$executeRaw`
          UPDATE compradores SET password = ${hash} WHERE id = ${resetToken.actor_id}
        `
        if (!updatedCount) {
          throw new Error(`No se pudo actualizar la contraseña para actor ${actorType}:${resetToken.actor_id}`)
        }
      }

      if (actorType === 'empleado') {
        await clearInternalPasswordRotationRequirement(resetToken.actor_id, tx)
      }

      await touchPasswordVersion(actorType, resetToken.actor_id, tx)

      return {
        ok: true as const,
        resetToken: {
          actor_type: resetToken.actor_type,
          actor_id: resetToken.actor_id,
          empresa_id: resetToken.empresa_id,
          tenant_slug: resetToken.tenant_slug,
        },
      }
    })

    if (!result.ok) {
      return result
    }

    auditPasswordReset('password_reset_consumed', {
      actorType: result.resetToken.actor_type,
      actorId: result.resetToken.actor_id,
      empresaId: result.resetToken.empresa_id,
      tenantSlug: result.resetToken.tenant_slug,
      consumedIp: input.consumedIp ?? null,
    })

    return { ok: true as const, status: 200, data: { ok: true } }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      // P2025: record not found (shouldn't happen here — we lock first — but handle defensively)
      if (error.code === 'P2025') {
        return { ok: false as const, status: 404, error: 'Token inválido' }
      }
    }
    throw error
  }
}
