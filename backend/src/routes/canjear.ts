import { Router, Request, Response } from 'express'
import { verifyInternal, requireAuth } from '../middleware/auth'
import { getActorEmpresaId, requirePermission, requireUserType } from '../lib/authz'
import { logServerError } from '../lib/safe-log'
import { confirmConsumiblesRedeem, previewConsumiblesRedeem, resolveConsumiblesRedeem } from '../lib/consumibles-redeem'

const router = Router()

// POST /consumibles/canjear
router.post('/', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)

  if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
  if (!requireUserType(user, ['empresa', 'empleado'], res)) return
  if (!requirePermission(user, 'canjear_consumibles', res)) return

  const { codigo, barra_id, venta_id, accion } = req.body

  if (!barra_id || typeof barra_id !== 'string') {
    return res.status(400).json({ error: 'barra_id es requerido' })
  }

  try {
    if (accion === 'confirmar') {
      if (!venta_id || typeof venta_id !== 'string') {
        return res.status(400).json({ error: 'venta_id es requerido' })
      }

      return res.json(
        await confirmConsumiblesRedeem({
          ventaId: venta_id,
          barraId: barra_id,
          empresaId: String(empresaId),
          actorId: String(user.id),
          actorType: user.userType === 'empleado' ? 'empleado' : 'empresa',
        })
      )
    }

    if (accion === 'resolver') {
      if (!venta_id || typeof venta_id !== 'string') {
        return res.status(400).json({ error: 'venta_id es requerido' })
      }

      const items = Array.isArray(req.body?.items) ? req.body.items : []
      return res.json(
        await resolveConsumiblesRedeem({
          ventaId: venta_id,
          barraId: barra_id,
          empresaId: String(empresaId),
          actorId: String(user.id),
          actorType: user.userType === 'empleado' ? 'empleado' : 'empresa',
          items,
        })
      )
    }

    if (!codigo || typeof codigo !== 'string') {
      return res.status(400).json({ error: 'codigo es requerido' })
    }

    const result = await previewConsumiblesRedeem({
      codigo,
      barraId: barra_id,
      empresaId: String(empresaId),
      actorId: String(user.id),
      actorType: user.userType === 'empleado' ? 'empleado' : 'empresa',
    })

    if (!result.ok && result.motivo === 'Barra no encontrada') {
      return res.status(404).json({ error: result.motivo })
    }

    return res.json(result)
  } catch {
    logServerError('canjear post')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

export default router
