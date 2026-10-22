import { Router, type Request } from 'express'
import { prisma } from '../../lib/prisma'
import { Prisma } from '@prisma/client'
import { requireAuth } from '../../middleware/auth'
import { requireSuperAdminMiddleware } from '../../lib/authz'
import { createPlatformHandler } from './shared'
import { safeCsvCell } from '../../lib/csv-escape'

const router = Router()

type AuditLogRow = {
  id: number
  actor_id: string | null
  actor_email: string | null
  actor_label: string | null
  actor_type: string | null
  action: string
  entity_type: string | null
  entity_id: string | null
  entity_label: string | null
  payload: string | object | null
  ip_address: string | null
  created_at: Date | string
}

function parsePayload(value: string | object | null): unknown {
  if (value === null || value === undefined) return null
  if (typeof value === 'object') return value
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function clampPositiveInt(raw: unknown, fallback: number, max: number): number {
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.min(Math.floor(parsed), max)
}

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/

function sanitizeDateFilter(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  if (!trimmed) return null
  if (!ISO_DATE_PATTERN.test(trimmed)) return null
  const ts = new Date(trimmed).getTime()
  if (!Number.isFinite(ts)) return null
  return new Date(trimmed)
}

function readStringFilter(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const trimmed = raw.trim()
  return trimmed.length > 0 ? trimmed : null
}

function buildAuditWhere(req: Request): Prisma.AuditLogWhereInput {
  const action = readStringFilter(req.query.action)
  const entityType = readStringFilter(req.query.entityType)
  const actorId = readStringFilter(req.query.actorId)
  const dateFrom = sanitizeDateFilter(req.query.dateFrom)
  const dateTo = sanitizeDateFilter(req.query.dateTo)

  const where: Prisma.AuditLogWhereInput = {}
  if (action) where.action = action
  if (entityType) where.entity_type = entityType
  if (actorId) where.actor_id = actorId
  if (dateFrom || dateTo) {
    where.created_at = {}
    if (dateFrom) (where.created_at as Prisma.DateTimeFilter).gte = dateFrom
    if (dateTo) (where.created_at as Prisma.DateTimeFilter).lte = dateTo
  }
  return where
}

const csvEscape = safeCsvCell

router.get(
  '/',
  requireAuth,
  requireSuperAdminMiddleware,
  createPlatformHandler('platform audit logs list', async (req, res) => {
    const limit = clampPositiveInt(req.query.limit, 50, 200)
    const page = clampPositiveInt(req.query.page, 1, 10000)
    const offset = (page - 1) * limit

    const where = buildAuditWhere(req)

    const [rows, total, distinctActions] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
        select: {
          id: true,
          actor_id: true,
          actor_email: true,
          actor_label: true,
          actor_type: true,
          action: true,
          entity_type: true,
          entity_id: true,
          entity_label: true,
          payload: true,
          ip_address: true,
          created_at: true,
        },
      }),
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        distinct: ['action'],
        orderBy: { action: 'asc' },
        take: 200,
        select: { action: true },
      }),
    ])

    return res.json({
      data: {
        logs: rows.map((row) => ({
          id: row.id,
          createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
          actor: {
            id: row.actor_id,
            email: row.actor_email,
            label: row.actor_label,
            type: row.actor_type,
          },
          action: row.action,
          entity: {
            type: row.entity_type,
            id: row.entity_id,
            label: row.entity_label,
          },
          payload: parsePayload(row.payload as string | object | null),
          ipAddress: row.ip_address,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.max(1, Math.ceil(total / limit)),
        },
        availableActions: distinctActions.map((row) => row.action),
      },
    })
  }),
)

router.get(
  '/export',
  requireAuth,
  // Must match the gate on GET / (the listing) exactly — this exports the full audit trail
  // (actor emails, IPs, sensitive action payloads) up to 10k rows, so it can't be reachable
  // with a weaker capability than the UI listing requires.
  requireSuperAdminMiddleware,
  async (req, res) => {
    try {
      const where = buildAuditWhere(req)
      const exportLimit = 10000

      const rows = await prisma.auditLog.findMany({
        where,
        orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
        take: exportLimit,
        select: {
          id: true,
          actor_id: true,
          actor_email: true,
          actor_label: true,
          actor_type: true,
          action: true,
          entity_type: true,
          entity_id: true,
          entity_label: true,
          payload: true,
          ip_address: true,
          created_at: true,
        },
      })

      const headers = [
        'id', 'created_at', 'actor_id', 'actor_email', 'actor_label', 'actor_type',
        'action', 'entity_type', 'entity_id', 'entity_label', 'payload', 'ip_address',
      ]

      const lines: string[] = [headers.join(',')]

      for (const row of rows) {
        const createdAt = row.created_at instanceof Date
          ? row.created_at.toISOString()
          : String(row.created_at)
        const payloadVal = row.payload as string | object | null
        const payloadStr = typeof payloadVal === 'string'
          ? payloadVal
          : payloadVal ? JSON.stringify(payloadVal) : ''

        lines.push([
          csvEscape(row.id),
          csvEscape(createdAt),
          csvEscape(row.actor_id),
          csvEscape(row.actor_email),
          csvEscape(row.actor_label),
          csvEscape(row.actor_type),
          csvEscape(row.action),
          csvEscape(row.entity_type),
          csvEscape(row.entity_id),
          csvEscape(row.entity_label),
          csvEscape(payloadStr),
          csvEscape(row.ip_address),
        ].join(','))
      }

      const csv = '﻿' + lines.join('\r\n')
      const filename = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`

      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
      return res.send(csv)
    } catch (error) {
      // No loguear el error completo: puede incluir SQL interpolado con valores.
      console.error('[platform audit logs export] failed', {
        errorCode: (error as { code?: string } | null)?.code ?? 'unknown',
        errorName: error instanceof Error ? error.name : 'unknown',
      })
      return res.status(500).json({ error: 'No se pudo exportar el registro de auditoría' })
    }
  },
)

export default router
