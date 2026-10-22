import { Router, type Request } from 'express'
import { Prisma } from '@prisma/client'
import { prisma } from '../../lib/prisma'
import { requireAuth } from '../../middleware/auth'
import { requirePlatformCapabilityMiddleware } from '../../lib/authz'
import { actorFromRequest, logAuditEvent } from '../../lib/audit-log'
import { createPlatformHandler } from './shared'

const router = Router()

function parsePagination(req: Request) {
  const pageRaw = Number(req.query.page ?? 1)
  const pageSizeRaw = Number(req.query.pageSize ?? req.query.page_size ?? 50)
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1
  const pageSize = Number.isFinite(pageSizeRaw) ? Math.max(1, Math.min(200, Math.floor(pageSizeRaw))) : 50
  return { page, pageSize, skip: (page - 1) * pageSize }
}

function parseFilters(req: Request) {
  const source = typeof req.query.source === 'string' && (req.query.source === 'backend' || req.query.source === 'frontend')
    ? req.query.source
    : null
  const severity = typeof req.query.severity === 'string' && ['error', 'warn', 'fatal'].includes(req.query.severity)
    ? req.query.severity
    : null

  let resolved: 'only' | 'unresolved' | 'all' = 'unresolved'
  if (req.query.resolved === 'true' || req.query.resolved === 'only') resolved = 'only'
  else if (req.query.resolved === 'all') resolved = 'all'

  const search = typeof req.query.search === 'string' ? req.query.search.trim() : ''

  const sinceRaw = typeof req.query.since === 'string' ? req.query.since : null
  const since = sinceRaw ? new Date(sinceRaw) : null
  const validSince = since && !Number.isNaN(since.getTime()) ? since : null

  return { source, severity, resolved, search, since: validSince }
}

function buildWhere(filters: ReturnType<typeof parseFilters>): Prisma.ErrorLogWhereInput {
  const where: Prisma.ErrorLogWhereInput = {}
  if (filters.source) where.source = filters.source
  if (filters.severity) where.severity = filters.severity
  if (filters.resolved === 'unresolved') where.resolved_at = null
  if (filters.resolved === 'only') where.resolved_at = { not: null }
  if (filters.search) {
    where.OR = [
      { message: { contains: filters.search, mode: 'insensitive' } },
      { fingerprint: { contains: filters.search, mode: 'insensitive' } },
    ]
  }
  if (filters.since) where.last_seen_at = { gte: filters.since }
  return where
}

router.get(
  '/',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.settings.read'),
  createPlatformHandler('platform error-logs list', async (req, res) => {
    const { page, pageSize, skip } = parsePagination(req)
    const filters = parseFilters(req)
    const where = buildWhere(filters)

    const [rows, total, metrics] = await Promise.all([
      prisma.errorLog.findMany({
        where,
        orderBy: [{ last_seen_at: 'desc' }],
        skip,
        take: pageSize,
      }),
      prisma.errorLog.count({ where }),
      computeOverviewMetrics(),
    ])

    return res.json({
      data: {
        items: rows.map(serializeRow),
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize)),
        metrics,
        filters,
      },
    })
  })
)

router.get(
  '/:id',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.settings.read'),
  createPlatformHandler('platform error-logs detail', async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'id inválido' })
    const row = await prisma.errorLog.findUnique({ where: { id } })
    if (!row) return res.status(404).json({ error: 'No encontrado' })
    return res.json({ data: { error: serializeRow(row) } })
  })
)

router.post(
  '/:id/resolve',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.settings.read'),
  createPlatformHandler('platform error-logs resolve', async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'id inválido' })

    const existing = await prisma.errorLog.findUnique({ where: { id } })
    if (!existing) return res.status(404).json({ error: 'No encontrado' })

    const updated = await prisma.errorLog.update({
      where: { id },
      data: { resolved_at: new Date(), resolved_by: req.user!.id },
    })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.error_log.resolved',
      entityType: 'error_log',
      entityId: String(id),
      entityLabel: existing.message.slice(0, 80),
      payload: { fingerprint: existing.fingerprint, source: existing.source, severity: existing.severity },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.json({ data: { error: serializeRow(updated) } })
  })
)

router.post(
  '/:id/unresolve',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.settings.read'),
  createPlatformHandler('platform error-logs unresolve', async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'id inválido' })

    const updated = await prisma.errorLog.update({
      where: { id },
      data: { resolved_at: null, resolved_by: null },
    })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.error_log.unresolved',
      entityType: 'error_log',
      entityId: String(id),
      entityLabel: updated.message.slice(0, 80),
      payload: { fingerprint: updated.fingerprint },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.json({ data: { error: serializeRow(updated) } })
  })
)

router.delete(
  '/:id',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.settings.read'),
  createPlatformHandler('platform error-logs delete', async (req, res) => {
    const id = Number(req.params.id)
    if (!Number.isFinite(id) || id <= 0) return res.status(400).json({ error: 'id inválido' })

    const existing = await prisma.errorLog.findUnique({ where: { id }, select: { id: true, fingerprint: true, message: true } })
    if (!existing) return res.status(404).json({ error: 'No encontrado' })

    await prisma.errorLog.delete({ where: { id } })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.error_log.deleted',
      entityType: 'error_log',
      entityId: String(id),
      entityLabel: existing.message.slice(0, 80),
      payload: { fingerprint: existing.fingerprint },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.status(204).send()
  })
)

async function computeOverviewMetrics() {
  const now = new Date()
  const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const prev24h = new Date(now.getTime() - 48 * 60 * 60 * 1000)

  const [totalUnresolved, totalLast24h, totalPrev24h, totalBackend, totalFrontend, lastSeen] = await Promise.all([
    prisma.errorLog.count({ where: { resolved_at: null } }),
    prisma.errorLog.count({ where: { last_seen_at: { gte: last24h } } }),
    prisma.errorLog.count({ where: { last_seen_at: { gte: prev24h, lt: last24h } } }),
    prisma.errorLog.count({ where: { source: 'backend', last_seen_at: { gte: last24h } } }),
    prisma.errorLog.count({ where: { source: 'frontend', last_seen_at: { gte: last24h } } }),
    prisma.errorLog.findFirst({ orderBy: { last_seen_at: 'desc' }, select: { last_seen_at: true } }),
  ])

  return {
    totalUnresolved,
    totalLast24h,
    totalPrev24h,
    deltaPct: totalPrev24h === 0 ? null : Math.round(((totalLast24h - totalPrev24h) / totalPrev24h) * 100),
    totalBackend24h: totalBackend,
    totalFrontend24h: totalFrontend,
    lastSeenAt: lastSeen?.last_seen_at?.toISOString() ?? null,
  }
}

function serializeRow(row: {
  id: number
  fingerprint: string
  source: string
  severity: string
  message: string
  stack: string | null
  context: unknown
  user_agent: string | null
  ip_address: string | null
  count_total: number
  first_seen_at: Date
  last_seen_at: Date
  resolved_at: Date | null
  resolved_by: string | null
}) {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    source: row.source,
    severity: row.severity,
    message: row.message,
    stack: row.stack,
    context: row.context,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
    countTotal: row.count_total,
    firstSeenAt: row.first_seen_at.toISOString(),
    lastSeenAt: row.last_seen_at.toISOString(),
    resolvedAt: row.resolved_at?.toISOString() ?? null,
    resolvedBy: row.resolved_by,
  }
}

export default router
