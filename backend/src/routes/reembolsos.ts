import { Router, Request, Response } from 'express'
import { verifyInternal, requireAuth } from '../middleware/auth'
import { getActorEmpresaId, requirePermission, requirePermissionMiddleware, requireUserType } from '../lib/authz'
import {
  approveRefundManualCase,
  countRefundManualCases,
  createRefundManualCase,
  executeRefundManualCase,
  getRefundManualCaseDetail,
  linkRefundManualCaseItems,
  listRefundManualCases,
  normalizeBuyerAutomaticRefundMode,
  REFUND_MANUAL_EXPORT_COLUMNS,
  rejectRefundManualCase,
  resolveRefundManualExportLimit,
  resolveRefundManualCaseAsNonRefundable,
  selectRefundManualCasesForExport,
  toCsv,
} from '../lib/refund-manual'
import {
  buildReembolsosCsvExportFilename,
  buildReembolsosExportFilename,
  buildReembolsosWorkbookBuffer,
  REFUND_MANUAL_EXPORT_CONTENT_TYPE,
} from '../lib/refund-manual-export-workbook'
import { logServerError } from '../lib/safe-log'
import { prisma } from '../lib/prisma'

const router = Router()

function readRefundManualCasesQuery(req: Request) {
  return {
    status: typeof req.query.status === 'string' ? req.query.status : undefined,
    query: typeof req.query.query === 'string' ? req.query.query : undefined,
    buyer: typeof req.query.buyer === 'string' ? req.query.buyer : undefined,
    event: typeof req.query.event === 'string' ? req.query.event : undefined,
    flow: req.query.flow === 'entradas' || req.query.flow === 'consumibles' ? req.query.flow : 'all',
    sortOrder: req.query.sortOrder === 'date_asc' ? 'date_asc' : 'date_desc',
  } as const
}

async function getEmpresaAutomaticRefundConfig(empresaId: string) {
  const row = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { buyer_auto_refunds_enabled: true, buyer_auto_refunds_scope: true },
  })

  const mode = normalizeBuyerAutomaticRefundMode(
    Boolean(row?.buyer_auto_refunds_enabled),
    row?.buyer_auto_refunds_scope,
  )

  return {
    enabled: mode !== 'manual',
    mode,
    scope: mode === 'manual' ? 'todos' : mode,
  }
}

async function getEmpresaBuyerEventRefundsEnabled(empresaId: string): Promise<boolean> {
  const row = await prisma.empresa.findUnique({
    where: { id: empresaId },
    select: { buyer_event_refunds_enabled: true },
  })
  return row?.buyer_event_refunds_enabled === true
}

async function resolveMutationContext(req: Request, res: Response) {
  const user = req.user!
  const empresaId = getActorEmpresaId(user)

  if (!empresaId) {
    res.status(403).json({ error: 'Sin permiso' })
    return null
  }

  if (!requireUserType(user, ['empresa', 'empleado'], res)) return null

  return {
    user,
    empresaId: String(empresaId),
    actorId: String(user.id),
    actorType: (user.userType === 'empleado' ? 'empleado' : 'empresa') as 'empresa' | 'empleado',
  }
}

async function requireBuyerConsumibleEmployeeMutation(req: Request, res: Response, empresaId: string) {
  const detail = await getRefundManualCaseDetail(req.params.id, empresaId)
  if (!detail) {
    res.status(404).json({ error: 'No encontrado' })
    return null
  }

  const isBuyerConsumibleCase = detail.case.flow === 'consumibles' && detail.case.request_origin === 'buyer_consumible_request'
  if (!isBuyerConsumibleCase) {
    res.status(403).json({ error: 'Sin permiso' })
    return null
  }

  return detail
}

router.get('/', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)

    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    if (!requireUserType(user, ['empresa', 'empleado'], res)) return
    if (!requirePermission(user, 'ver_dashboard', res)) return

    const [cases, automaticRefundConfig, buyerEventRefundsEnabled] = await Promise.all([
      listRefundManualCases(String(empresaId), readRefundManualCasesQuery(req)),
      getEmpresaAutomaticRefundConfig(String(empresaId)),
      getEmpresaBuyerEventRefundsEnabled(String(empresaId)),
    ])

    return res.json({ data: { cases, automatic_refund_config: automaticRefundConfig, buyer_event_refunds_enabled: buyerEventRefundsEnabled } })
  } catch {
    logServerError('reembolsos list')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.get('/export', verifyInternal, requireAuth, requirePermissionMiddleware('exportar'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)

    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    if (!requireUserType(user, ['empresa', 'empleado'], res)) return
    if (!requirePermission(user, 'ver_dashboard', res)) return

    const query = readRefundManualCasesQuery(req)
    const exportFormat = req.query.format === 'xlsx' ? 'xlsx' : 'csv'
    const exportLimit = resolveRefundManualExportLimit()
    const total = await countRefundManualCases(String(empresaId), query)

    if (total > exportLimit) {
      return res.status(413).json({
        error: `Refiná los filtros para exportar hasta ${exportLimit} casos de reembolso por archivo.`,
        code: 'export_limit_exceeded',
        limit: exportLimit,
        total,
      })
    }

    const rows = await selectRefundManualCasesForExport(String(empresaId), query, exportLimit)

    if (exportFormat === 'xlsx') {
      const buffer = await buildReembolsosWorkbookBuffer(rows, [...REFUND_MANUAL_EXPORT_COLUMNS])
      res.setHeader('Content-Type', REFUND_MANUAL_EXPORT_CONTENT_TYPE)
      res.setHeader('Content-Disposition', `attachment; filename="${buildReembolsosExportFilename()}"`)
      return res.status(200).send(buffer)
    }

    const csv = toCsv(rows, [...REFUND_MANUAL_EXPORT_COLUMNS])
    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${buildReembolsosCsvExportFilename()}"`)
    return res.status(200).send(csv)
  } catch {
    logServerError('reembolsos export')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.patch('/', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)

    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    if (!requireUserType(user, ['empresa'], res, 'Solo la empresa puede cambiar la política de reembolsos')) return

    const { enabled, scope, buyer_event_refunds_enabled } = req.body ?? {}

    if (typeof buyer_event_refunds_enabled === 'boolean') {
      await prisma.empresa.update({
        where: { id: String(empresaId) },
        data: { buyer_event_refunds_enabled },
      })
      return res.json({ ok: true, data: { buyer_event_refunds_enabled } })
    }

    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled debe ser boolean' })
    }

    if (scope !== 'consumibles' && scope !== 'entradas' && scope !== 'todos') {
      return res.status(400).json({ error: 'scope debe ser consumibles, entradas o todos' })
    }

    await prisma.empresa.update({
      where: { id: String(empresaId) },
      data: {
        buyer_auto_refunds_enabled: enabled,
        buyer_auto_refunds_scope: scope,
      },
    })

    return res.json({ ok: true, data: { automatic_refund_config: await getEmpresaAutomaticRefundConfig(String(empresaId)) } })
  } catch {
    logServerError('reembolsos policy patch')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.get('/:id', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)

    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    if (!requireUserType(user, ['empresa', 'empleado'], res)) return
    if (!requirePermission(user, 'ver_dashboard', res)) return

    const detail = await getRefundManualCaseDetail(req.params.id, String(empresaId))
    if (!detail) return res.status(404).json({ error: 'No encontrado' })

    return res.json(detail)
  } catch {
    logServerError('reembolsos detail')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.post('/', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)

    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    if (!requireUserType(user, ['empresa'], res, 'Solo la empresa puede crear casos de reembolso por ahora')) return

    const checkoutSessionId = typeof req.body?.checkout_session_id === 'string' ? req.body.checkout_session_id.trim() : ''
    const reason = typeof req.body?.reason === 'string' ? req.body.reason : ''
    const note = typeof req.body?.note === 'string' ? req.body.note : null
    const externalRefundReference = typeof req.body?.external_refund_reference === 'string'
      ? req.body.external_refund_reference
      : null

    if (!checkoutSessionId) {
      return res.status(400).json({ error: 'checkout_session_id es requerido' })
    }

    const result = await createRefundManualCase({
      empresaId: String(empresaId),
      checkoutSessionId,
      actorId: String(user.id),
      actorType: 'empresa',
      reason,
      note,
      externalRefundReference,
    })

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error })
    }

    return res.status(result.status).json(result.data)
  } catch {
    logServerError('reembolsos create')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.post('/:id/items', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)

    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    if (!requireUserType(user, ['empresa'], res, 'Solo la empresa puede vincular items del reembolso por ahora')) return

    const items = Array.isArray(req.body?.items) ? req.body.items : []
    const result = await linkRefundManualCaseItems({
      caseId: req.params.id,
      empresaId: String(empresaId),
      actorId: String(user.id),
      actorType: 'empresa',
      items,
    })

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error })
    }

    return res.status(result.status).json(result.data)
  } catch {
    logServerError('reembolsos link items')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.post('/:id/approve', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)

    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    if (!requireUserType(user, ['empresa'], res, 'Solo la empresa puede aprobar reembolsos por ahora')) return

    const reason = typeof req.body?.reason === 'string' ? req.body.reason : ''
    const note = typeof req.body?.note === 'string' ? req.body.note : null

    const result = await approveRefundManualCase({
      caseId: req.params.id,
      empresaId: String(empresaId),
      actorId: String(user.id),
      actorType: 'empresa',
      reason,
      note,
    })

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error })
    }

    return res.status(result.status).json(result.data)
  } catch {
    logServerError('reembolsos approve')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.post('/:id/execute', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const context = await resolveMutationContext(req, res)
    if (!context) return

    if (context.user.userType === 'empleado') {
      if (!requirePermission(context.user, 'ver_dashboard', res)) return
      if (!requirePermission(context.user, 'gestionar_consumibles', res)) return
      if (!(await requireBuyerConsumibleEmployeeMutation(req, res, context.empresaId))) return
    }

    const evidenceNote = typeof req.body?.evidence_note === 'string' ? req.body.evidence_note : null
    const externalRefundReference = typeof req.body?.external_refund_reference === 'string'
      ? req.body.external_refund_reference
      : null

    const result = await executeRefundManualCase({
      caseId: req.params.id,
      empresaId: context.empresaId,
      actorId: context.actorId,
      actorType: context.actorType,
      evidenceNote,
      externalRefundReference,
    })

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error })
    }

    return res.status(result.status).json(result.data)
  } catch {
    logServerError('reembolsos execute')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.post('/:id/reject', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const context = await resolveMutationContext(req, res)
    if (!context) return

    if (context.user.userType === 'empleado') {
      if (!requirePermission(context.user, 'ver_dashboard', res)) return
      if (!requirePermission(context.user, 'gestionar_consumibles', res)) return
      if (!(await requireBuyerConsumibleEmployeeMutation(req, res, context.empresaId))) return
    }

    const reason = typeof req.body?.reason === 'string' ? req.body.reason : ''
    const note = typeof req.body?.note === 'string' ? req.body.note : null
    const evidenceNote = typeof req.body?.evidence_note === 'string' ? req.body.evidence_note : null
    const externalRefundReference = typeof req.body?.external_refund_reference === 'string'
      ? req.body.external_refund_reference
      : null

    const result = await rejectRefundManualCase({
      caseId: req.params.id,
      empresaId: context.empresaId,
      actorId: context.actorId,
      actorType: context.actorType,
      reason,
      note,
      evidenceNote,
      externalRefundReference,
    })

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error })
    }

    return res.status(result.status).json(result.data)
  } catch {
    logServerError('reembolsos reject')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.post('/:id/resolve-non-refundable', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const context = await resolveMutationContext(req, res)
    if (!context) return

    if (context.user.userType === 'empleado') {
      if (!requirePermission(context.user, 'ver_dashboard', res)) return
      if (!requirePermission(context.user, 'gestionar_consumibles', res)) return
      if (!(await requireBuyerConsumibleEmployeeMutation(req, res, context.empresaId))) return
    }

    const reason = typeof req.body?.reason === 'string' ? req.body.reason : ''
    const note = typeof req.body?.note === 'string' ? req.body.note : null

    const result = await resolveRefundManualCaseAsNonRefundable({
      caseId: req.params.id,
      empresaId: context.empresaId,
      actorId: context.actorId,
      actorType: context.actorType,
      reason,
      note,
    })

    if (!result.ok) {
      return res.status(result.status).json({ error: result.error })
    }

    return res.status(result.status).json(result.data)
  } catch {
    logServerError('reembolsos resolve non refundable')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

export default router
