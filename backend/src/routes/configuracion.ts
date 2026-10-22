import { Router, Request, Response } from 'express'
import { Prisma } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { assertInternalEmailAvailable } from '../lib/internal-email'
import { getMarketplaceFeeSummariesByFlow } from '../lib/marketplace-fee'
import { verifyInternal, requireAuth } from '../middleware/auth'
import { getSalesReadiness } from '../lib/sales-readiness'
import { getActorEmpresaId, requirePermissionMiddleware, requireUserTypeMiddleware } from '../lib/authz'
import { logServerError } from '../lib/safe-log'
import { actorFromRequest, logAuditEvent } from '../lib/audit-log'
import { clearInternalPasswordRotationRequirement, touchPasswordVersion } from '../lib/password-version'
import { buildEmpresaMarketplaceFeeContract } from './empresa/shared'
import { buildPasswordPolicyError, validatePasswordPolicy } from '../lib/password-policy'
import { prisma } from '../lib/prisma'
import { revalidateVidriera } from '../lib/revalidate-vidriera'

const router = Router()

// GET /configuracion
router.get('/', verifyInternal, requireAuth, requirePermissionMiddleware('ver_configuracion'), async (req: Request, res: Response) => {
  try {
    const empresaId = getActorEmpresaId(req.user!)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`
      SELECT id, nombre, slug, email, admin_nombre, admin_apellido, comision_revendedor_default,
             tenant_public_disabled, vidriera_disabled, buyer_event_refunds_enabled,
             buyer_auto_refunds_enabled, buyer_auto_refunds_scope, buyer_cool_off_window_hours,
             buyer_request_window_days, manual_review_sla_days,
             mp_max_installments, fee_billing_mode, fee_split_buyer_pct
      FROM empresas WHERE id = ${empresaId}
    `

    if (!rows.length) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    const [salesReadiness, marketplaceFeeByFlow] = await Promise.all([
      getSalesReadiness(empresaId),
      getMarketplaceFeeSummariesByFlow(empresaId),
    ])

    return res.json({
      data: {
        ...rows[0],
        sales_readiness: salesReadiness,
        ...buildEmpresaMarketplaceFeeContract(marketplaceFeeByFlow),
      },
    })
  } catch {
    logServerError('configuracion get')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// PATCH /configuracion
router.patch('/', verifyInternal, requireAuth, requirePermissionMiddleware('editar_configuracion'), async (req: Request, res: Response) => {
  try {
    const empresaId = getActorEmpresaId(req.user!)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const body = req.body as Record<string, unknown>
    const data: {
      nombre?: string
      email?: string
      admin_nombre?: string
      admin_apellido?: string | null
    } = {}

    if (body.nombre !== undefined) {
      if (!body.nombre || typeof body.nombre !== 'string' || !body.nombre.trim()) {
        return res.status(400).json({ error: 'El nombre es obligatorio' })
      }
      data.nombre = body.nombre.trim()
    }

    if (body.email !== undefined) {
      if (!body.email || typeof body.email !== 'string' || !body.email.trim()) {
        return res.status(400).json({ error: 'El email es obligatorio' })
      }
      data.email = await assertInternalEmailAvailable(body.email, {
        exclude: { actorType: 'empresa', actorId: empresaId },
      })
    }

    if (body.admin_nombre !== undefined) {
      if (!body.admin_nombre || typeof body.admin_nombre !== 'string' || !body.admin_nombre.trim()) {
        return res.status(400).json({ error: 'El nombre administrador es obligatorio' })
      }
      data.admin_nombre = body.admin_nombre.trim()
    }

    if (body.admin_apellido !== undefined) {
      data.admin_apellido = typeof body.admin_apellido === 'string' && body.admin_apellido.trim() ? body.admin_apellido.trim() : null
    }

    if (Object.keys(data).length === 0) {
      return res.status(400).json({ error: 'No se enviaron campos internos para actualizar' })
    }

    try {
      await prisma.empresa.update({ where: { id: empresaId }, data })
    } catch (updateError) {
      if (updateError instanceof Prisma.PrismaClientKnownRequestError && updateError.code === 'P2025') {
        return res.status(404).json({ error: 'Empresa no encontrada' })
      }
      throw updateError
    }

    return res.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'El email ya está en uso por otra cuenta interna') {
      return res.status(409).json({ error: error.message })
    }
    logServerError('configuracion patch')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// PATCH /configuracion/password
// PATCH /configuracion/pagos — actualiza config de pagos (max cuotas MP, etc.)
// Separado del PATCH / para no mezclar con el SQL raw legacy.
router.patch('/pagos', verifyInternal, requireAuth, requirePermissionMiddleware('editar_configuracion'), async (req: Request, res: Response) => {
  try {
    const empresaId = getActorEmpresaId(req.user!)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const body = (req.body ?? {}) as Record<string, unknown>
    const patch: { mp_max_installments?: number; fee_billing_mode?: string; fee_split_buyer_pct?: number | null } = {}

    if (body.mp_max_installments !== undefined) {
      const max = Number(body.mp_max_installments)
      const ALLOWED = [1, 3, 6, 9, 12, 18, 24]
      if (!Number.isInteger(max) || !ALLOWED.includes(max)) {
        return res.status(400).json({ error: `mp_max_installments debe ser uno de ${ALLOWED.join(', ')}` })
      }
      patch.mp_max_installments = max
    }

    if (body.fee_billing_mode !== undefined) {
      if (body.fee_billing_mode !== 'absorbed' && body.fee_billing_mode !== 'passed_to_buyer' && body.fee_billing_mode !== 'split') {
        return res.status(400).json({ error: "fee_billing_mode debe ser 'absorbed', 'passed_to_buyer' o 'split'" })
      }
      patch.fee_billing_mode = body.fee_billing_mode

      if (body.fee_billing_mode === 'split') {
        // En modo split, fee_split_buyer_pct es obligatorio y debe ser un número en [0,100].
        const pct = Number(body.fee_split_buyer_pct)
        if (body.fee_split_buyer_pct === undefined || body.fee_split_buyer_pct === null || !Number.isFinite(pct) || pct < 0 || pct > 100) {
          return res.status(400).json({ error: 'fee_split_buyer_pct debe ser un número entre 0 y 100 cuando fee_billing_mode es "split"' })
        }
        patch.fee_split_buyer_pct = pct
      } else {
        // Fuera de split, limpiamos el pct para no dejar valores colgados.
        patch.fee_split_buyer_pct = null
      }
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No se enviaron campos válidos' })
    }

    const updated = await prisma.empresa.update({
      where: { id: String(empresaId) },
      data: patch,
      select: { id: true, mp_max_installments: true, fee_billing_mode: true, fee_split_buyer_pct: true },
    })

    return res.json({ data: updated })
  } catch (error) {
    logServerError('configuracion pagos patch', error)
    return res.status(500).json({ error: 'Error actualizando config de pagos' })
  }
})

// PATCH /configuracion/refunds — política de reembolsos del comprador
// Acepta cualquier subconjunto de: buyer_event_refunds_enabled, buyer_auto_refunds_enabled,
// buyer_auto_refunds_scope ('entradas'|'consumibles'|'todos'), buyer_cool_off_window_hours (0|6|12|24|48|72|168),
// buyer_request_window_days (int 1-365), manual_review_sla_days (int 1-90).
router.patch('/refunds', verifyInternal, requireAuth, requirePermissionMiddleware('editar_configuracion'), async (req: Request, res: Response) => {
  try {
    const empresaId = getActorEmpresaId(req.user!)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const body = (req.body ?? {}) as Record<string, unknown>
    const patch: {
      buyer_event_refunds_enabled?: boolean
      buyer_auto_refunds_enabled?: boolean
      buyer_auto_refunds_scope?: string
      buyer_cool_off_window_hours?: number
      buyer_request_window_days?: number
      manual_review_sla_days?: number
    } = {}

    if (typeof body.buyer_event_refunds_enabled === 'boolean') {
      patch.buyer_event_refunds_enabled = body.buyer_event_refunds_enabled
    }
    if (typeof body.buyer_auto_refunds_enabled === 'boolean') {
      patch.buyer_auto_refunds_enabled = body.buyer_auto_refunds_enabled
    }
    if (typeof body.buyer_auto_refunds_scope === 'string') {
      if (!['entradas', 'consumibles', 'todos'].includes(body.buyer_auto_refunds_scope)) {
        return res.status(400).json({ error: "buyer_auto_refunds_scope debe ser 'entradas', 'consumibles' o 'todos'" })
      }
      patch.buyer_auto_refunds_scope = body.buyer_auto_refunds_scope
    }
    if (body.buyer_cool_off_window_hours !== undefined) {
      const hours = Number(body.buyer_cool_off_window_hours)
      const ALLOWED_HOURS = [0, 6, 12, 24, 48, 72, 168]
      if (!Number.isInteger(hours) || !ALLOWED_HOURS.includes(hours)) {
        return res.status(400).json({ error: `buyer_cool_off_window_hours debe ser uno de ${ALLOWED_HOURS.join(', ')}` })
      }
      patch.buyer_cool_off_window_hours = hours
    }
    if (body.buyer_request_window_days !== undefined) {
      const days = Number(body.buyer_request_window_days)
      if (!Number.isInteger(days) || days < 1 || days > 365) {
        return res.status(400).json({ error: 'buyer_request_window_days debe ser un entero entre 1 y 365' })
      }
      patch.buyer_request_window_days = days
    }
    if (body.manual_review_sla_days !== undefined) {
      const days = Number(body.manual_review_sla_days)
      if (!Number.isInteger(days) || days < 1 || days > 90) {
        return res.status(400).json({ error: 'manual_review_sla_days debe ser un entero entre 1 y 90' })
      }
      patch.manual_review_sla_days = days
    }

    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'No se enviaron campos válidos' })
    }

    const updated = await prisma.empresa.update({
      where: { id: String(empresaId) },
      data: patch,
      select: {
        id: true,
        buyer_event_refunds_enabled: true,
        buyer_auto_refunds_enabled: true,
        buyer_auto_refunds_scope: true,
        buyer_cool_off_window_hours: true,
        buyer_request_window_days: true,
        manual_review_sla_days: true,
      },
    })

    return res.json({ data: updated })
  } catch (error) {
    logServerError('configuracion refunds patch', error)
    return res.status(500).json({ error: 'Error actualizando config de reembolsos' })
  }
})

router.patch('/password', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!

    const { passwordActual, nuevaPassword, confirmarPassword } = req.body

    if (!passwordActual || !nuevaPassword || !confirmarPassword) {
      return res.status(400).json({ error: 'Todos los campos son obligatorios' })
    }

    const validation = validatePasswordPolicy(nuevaPassword)
    if (!validation.ok) {
      return res.status(400).json(buildPasswordPolicyError(validation.reason))
    }

    if (nuevaPassword !== confirmarPassword) {
      return res.status(400).json({ error: 'Las contraseñas nuevas no coinciden' })
    }

    if (user.userType !== 'empresa' && user.userType !== 'empleado' && user.userType !== 'platform_staff') {
      return res.status(403).json({ error: 'Sin permiso' })
    }

    const rows: Array<{ id: string; password: string }> =
      user.userType === 'empresa'
        ? await prisma.$queryRaw`SELECT id, password FROM empresas WHERE id = ${user.id} AND activa = true`
        : user.userType === 'empleado'
          ? await prisma.$queryRaw`SELECT id, password FROM usuarios WHERE id = ${user.id} AND activo = true`
          : await prisma.$queryRaw`SELECT id, password FROM platform_admin_users WHERE id = ${user.id} AND activo = true`

    if (!rows.length) {
      return res.status(404).json({ error: user.userType === 'empresa' ? 'Empresa no encontrada' : 'Usuario no encontrado' })
    }

    const empresa = rows[0]
    const passwordOk = await bcrypt.compare(passwordActual, empresa.password)

    if (!passwordOk) {
      return res.status(400).json({ error: 'La contraseña actual es incorrecta' })
    }

    const hash = await bcrypt.hash(nuevaPassword, 12)

    if (user.userType === 'empresa') {
      // Empresa no tiene columna temporary_password_set_at (solo usuarios/platform_admin_users) --
      // must_change_password es el único flag a limpiar acá.
      await prisma.$executeRaw`
        UPDATE empresas
        SET password = ${hash}, must_change_password = false
        WHERE id = ${user.id}
      `
      await touchPasswordVersion('empresa', user.id)
    } else if (user.userType === 'empleado') {
      await prisma.$executeRaw`
        UPDATE usuarios
        SET password = ${hash}, must_change_password = false, temporary_password_set_at = NULL
        WHERE id = ${user.id}
      `
      await clearInternalPasswordRotationRequirement(user.id)
      await touchPasswordVersion('empleado', user.id)
    } else {
      await prisma.$executeRaw`
        UPDATE platform_admin_users
        SET password = ${hash}, must_change_password = false, temporary_password_set_at = NULL
        WHERE id = ${user.id}
      `
    }

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: `${user.userType}.password_changed`,
      entityType: user.userType === 'empresa' ? 'empresa' : 'usuario',
      entityId: user.id,
      payload: { userType: user.userType },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.json({ ok: true })
  } catch {
    logServerError('configuracion password patch')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.patch('/public-status', verifyInternal, requireAuth, requireUserTypeMiddleware(['empresa'], 'Solo la cuenta empresa puede cambiar la disponibilidad pública'), async (req: Request, res: Response) => {
  try {
    const publicDisabled = req.body?.publicDisabled
    if (typeof publicDisabled !== 'boolean') {
      return res.status(400).json({ error: 'publicDisabled debe ser boolean' })
    }

    const affectedRows = await prisma.$executeRaw`
      UPDATE empresas
      SET tenant_public_disabled = ${publicDisabled},
          tenant_public_disabled_at = CASE WHEN ${publicDisabled} THEN NOW() ELSE NULL END
      WHERE id = ${req.user!.id}
    `

    if (!affectedRows) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    // tenant_public_disabled es uno de los flags de elegibilidad de la vidriera
    // (vidriera.ts) -- si se apaga el storefront, sus eventos deben desaparecer
    // de la vidriera tambien, sin esperar los 600s de ISR.
    void revalidateVidriera()

    return res.json({
      data: {
        tenantPublicDisabled: publicDisabled,
        tenant_public_disabled: publicDisabled,
      },
    })
  } catch {
    logServerError('configuracion public status patch')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// Opt-out de la vidriera de descubrimiento cross-tenant (home + /eventos) --
// independiente de /public-status arriba: una empresa puede mantener su storefront
// propio prendido y no aparecer en el listado agregado de todas las empresas.
router.patch('/vidriera-status', verifyInternal, requireAuth, requireUserTypeMiddleware(['empresa'], 'Solo la cuenta empresa puede cambiar la disponibilidad en la vidriera'), async (req: Request, res: Response) => {
  try {
    const vidrieraDisabled = req.body?.vidrieraDisabled
    if (typeof vidrieraDisabled !== 'boolean') {
      return res.status(400).json({ error: 'vidrieraDisabled debe ser boolean' })
    }

    const affectedRows = await prisma.$executeRaw`
      UPDATE empresas
      SET vidriera_disabled = ${vidrieraDisabled},
          vidriera_disabled_at = CASE WHEN ${vidrieraDisabled} THEN NOW() ELSE NULL END
      WHERE id = ${req.user!.id}
    `

    if (!affectedRows) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    void revalidateVidriera()

    return res.json({
      data: {
        vidrieraDisabled,
        vidriera_disabled: vidrieraDisabled,
      },
    })
  } catch {
    logServerError('configuracion vidriera status patch')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

export default router
