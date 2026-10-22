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

    const empresa = await prisma.empresa.findUnique({
      where: { id: String(empresaId) },
      select: { revendedor_habilitado: true, consumibles_habilitado: true, pos_movil_habilitado: true, es_prueba: true },
    })

    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    return res.json({
      data: {
        revendedorHabilitado: empresa.revendedor_habilitado,
        consumiblesHabilitado: empresa.consumibles_habilitado,
        posMovilHabilitado: empresa.pos_movil_habilitado,
        esPrueba: empresa.es_prueba,
      },
    })
  }
)

export default router
