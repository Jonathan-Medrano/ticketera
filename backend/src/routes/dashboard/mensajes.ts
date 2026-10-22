import { Router } from 'express'
import { prisma } from '../../lib/prisma'
import { requireAuth } from '../../middleware/auth'
import { getActorEmpresaId } from '../../lib/authz'

const router = Router()

router.get(
  '/',
  requireAuth,
  async (req, res) => {
    const empresaId = getActorEmpresaId(req.user!)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const empresaIdStr = String(empresaId)
    const now = new Date()

    type MsgRow = { id: string; titulo: string; cuerpo: string; tipo: string }

    const messages = await prisma.$queryRaw<MsgRow[]>`
      SELECT pm.id, pm.titulo, pm.cuerpo, pm.tipo::text AS tipo
      FROM platform_messages pm
      LEFT JOIN platform_message_dismissals pmd
        ON pmd.message_id = pm.id AND pmd.empresa_id = ${empresaIdStr}
      WHERE pm.activo = true
        AND (pm.expires_at IS NULL OR pm.expires_at > ${now})
        AND (pm.target_type = 'all' OR (pm.target_type = 'empresa' AND pm.target_empresa_id = ${empresaIdStr}))
        AND pmd.message_id IS NULL
      ORDER BY pm.created_at DESC
    `

    return res.json({ data: { messages } })
  }
)

router.post(
  '/:messageId/dismiss',
  requireAuth,
  async (req, res) => {
    const empresaId = getActorEmpresaId(req.user!)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const { messageId } = req.params
    await prisma.platformMessageDismissal.upsert({
      where: {
        message_id_empresa_id: {
          message_id: messageId,
          empresa_id: String(empresaId),
        },
      },
      create: {
        message_id: messageId,
        empresa_id: String(empresaId),
      },
      update: {},
    })

    return res.json({ data: { dismissed: true } })
  }
)

export default router
