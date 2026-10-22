import { Router } from 'express'
import type { Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { prisma } from '../../lib/prisma'
import { requireSuperAdminMiddleware } from '../../lib/authz'
import { actorFromRequest, logAuditEvent } from '../../lib/audit-log'
import { validatePasswordPolicy, buildPasswordPolicyError } from '../../lib/password-policy'

const router = Router()

router.patch('/password',
  requireSuperAdminMiddleware,
  async (req: Request, res: Response) => {
    const actor = actorFromRequest(req)
    const body = req.body as Record<string, unknown>
    const { currentPassword, newPassword, confirmPassword } = body

    if (!currentPassword || typeof currentPassword !== 'string') {
      return res.status(400).json({ error: 'La contraseña actual es requerida' })
    }
    if (!newPassword || typeof newPassword !== 'string') {
      return res.status(400).json({ error: 'La nueva contraseña es requerida' })
    }
    if (confirmPassword !== undefined && confirmPassword !== newPassword) {
      return res.status(400).json({ error: 'Las contraseñas no coinciden' })
    }

    const policyResult = validatePasswordPolicy(newPassword)
    if (!policyResult.ok) {
      return res.status(400).json(buildPasswordPolicyError(policyResult.reason))
    }

    const admin = await prisma.platformAdminUser.findFirst({
      where: { id: String(actor.id), activo: true },
      select: { id: true, password: true },
    })
    if (!admin) {
      return res.status(404).json({ error: 'Usuario no encontrado' })
    }

    const ok = await bcrypt.compare(currentPassword, admin.password)
    if (!ok) {
      return res.status(400).json({ error: 'La contraseña actual es incorrecta' })
    }

    const hash = await bcrypt.hash(newPassword, 12)
    await prisma.platformAdminUser.update({
      where: { id: String(actor.id) },
      data: {
        password: hash,
        password_changed_at: new Date(),
        must_change_password: false,
      },
    })

    void logAuditEvent({
      actor,
      action: 'platform_admin_password_changed',
      entityType: 'platform_admin_user',
      entityId: String(actor.id),
    })

    return res.json({ data: { ok: true } })
  }
)

export default router
