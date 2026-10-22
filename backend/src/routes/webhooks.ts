import { Router } from 'express'
import type { Request, Response } from 'express'
import { prisma } from '../lib/prisma'

const router = Router()

type ResendEventType = 'email.opened' | 'email.clicked' | 'email.bounced' | 'email.complained'

const ESTADO_MAP: Record<ResendEventType, string> = {
  'email.opened': 'abierto',
  'email.clicked': 'clicked',
  'email.bounced': 'bounced',
  'email.complained': 'spam',
}

const ESTADO_PRIORITY: Record<string, number> = {
  pendiente: 0, enviado: 1, abierto: 2, clicked: 3, bounced: 4, spam: 5, error: 6,
}

router.post('/resend', async (req: Request, res: Response) => {
  const { type, data } = req.body as { type?: string; data?: Record<string, unknown> }

  if (!type || !data) {
    return res.status(400).json({ error: 'Payload inválido' })
  }

  const nuevoEstado = ESTADO_MAP[type as ResendEventType]
  if (!nuevoEstado) {
    return res.json({ ok: true, ignored: true })
  }

  const resendId = (data.email_id as string | undefined) ?? null
  if (!resendId) {
    return res.status(400).json({ error: 'email_id faltante en payload' })
  }

  const envio = await prisma.marketingEnvio.findFirst({
    where: { resend_id: resendId },
    select: { id: true, campana_id: true, estado: true },
  })

  if (!envio) {
    return res.json({ ok: true, not_found: true })
  }

  const currentPriority = ESTADO_PRIORITY[envio.estado] ?? 0
  const newPriority = ESTADO_PRIORITY[nuevoEstado] ?? 0

  if (newPriority <= currentPriority) {
    return res.json({ ok: true, skipped: true })
  }

  const updateData: Record<string, unknown> = { estado: nuevoEstado as never }
  if (nuevoEstado === 'abierto') {
    updateData['abierto_at'] = new Date()
  }

  await prisma.marketingEnvio.update({
    where: { id: envio.id },
    data: updateData,
  })

  if (envio.campana_id != null) {
    const sqlMap: Record<string, string> = {
      abierto: 'UPDATE marketing_campanas SET total_abiertos = total_abiertos + 1 WHERE id = $1',
      clicked:  'UPDATE marketing_campanas SET total_clicks   = total_clicks   + 1 WHERE id = $1',
      bounced:  'UPDATE marketing_campanas SET total_bounces  = total_bounces  + 1 WHERE id = $1',
      spam:     'UPDATE marketing_campanas SET total_spam     = total_spam     + 1 WHERE id = $1',
    }
    const sql = sqlMap[nuevoEstado]
    if (sql) await prisma.$executeRawUnsafe(sql, envio.campana_id)
  }

  return res.json({ ok: true })
})

export default router
