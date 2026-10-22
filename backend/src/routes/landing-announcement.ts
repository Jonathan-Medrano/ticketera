import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { requireAuth } from '../middleware/auth'
import { requireSuperAdminMiddleware } from '../lib/authz'
import { actorFromRequest, logAuditEvent } from '../lib/audit-log'
import { createPlatformHandler } from './platform/shared'

const ANIMATION_MODES = ['static', 'marquee_infinite', 'marquee_finite'] as const
const ANIMATION_SPEEDS = ['slow', 'normal', 'fast'] as const

function serialize(row: { id: string; content_html: string; cta_label: string | null; cta_href: string | null; active: boolean | number; animation_mode: string; animation_speed: string; background_color: string | null; updated_at: Date }) {
  return {
    id: row.id,
    contentHtml: row.content_html,
    ctaLabel: row.cta_label,
    ctaHref: row.cta_href,
    active: Boolean(row.active),
    animationMode: row.animation_mode,
    animationSpeed: row.animation_speed,
    backgroundColor: row.background_color,
    updatedAt: row.updated_at,
  }
}

async function fetchActive() {
  return prisma.landingAnnouncement.findFirst({
    where: { active: true },
    orderBy: { updated_at: 'desc' },
    select: {
      id: true,
      content_html: true,
      cta_label: true,
      cta_href: true,
      active: true,
      animation_mode: true,
      animation_speed: true,
      background_color: true,
      updated_at: true,
    },
  })
}

async function fetchLatest() {
  return prisma.landingAnnouncement.findFirst({
    orderBy: { updated_at: 'desc' },
    select: {
      id: true,
      content_html: true,
      cta_label: true,
      cta_href: true,
      active: true,
      animation_mode: true,
      animation_speed: true,
      background_color: true,
      updated_at: true,
    },
  })
}

// =============================================================================
// PUBLIC router — no auth, mounted at top-level for the marketing landing.
// =============================================================================
export const publicLandingAnnouncementRouter = Router()

publicLandingAnnouncementRouter.get('/', async (_req, res) => {
  try {
    const row = await fetchActive()
    return res.json({ data: row ? serialize(row) : null })
  } catch (error) {
    return res.status(500).json({ error: 'Error al obtener el anuncio' })
  }
})

// =============================================================================
// ADMIN router — super-admin only, mounted under /platform.
// =============================================================================
export const adminLandingAnnouncementRouter = Router()

adminLandingAnnouncementRouter.get(
  '/',
  requireAuth,
  requireSuperAdminMiddleware,
  createPlatformHandler('landing-announcement get', async (_req, res) => {
    const row = await fetchLatest()
    return res.json({ data: row ? serialize(row) : null })
  })
)

adminLandingAnnouncementRouter.put(
  '/',
  requireAuth,
  requireSuperAdminMiddleware,
  createPlatformHandler('landing-announcement upsert', async (req, res) => {
    const body = req.body as Record<string, unknown>
    const contentHtml = typeof body.contentHtml === 'string' ? body.contentHtml.trim() : ''
    const ctaLabelRaw = typeof body.ctaLabel === 'string' ? body.ctaLabel.trim() : ''
    const ctaHrefRaw = typeof body.ctaHref === 'string' ? body.ctaHref.trim() : ''
    const active = body.active === true || body.active === 1 || body.active === '1'
    const animationModeRaw = typeof body.animationMode === 'string' ? body.animationMode : 'static'
    const animationSpeedRaw = typeof body.animationSpeed === 'string' ? body.animationSpeed : 'normal'
    const backgroundColorRaw = typeof body.backgroundColor === 'string' ? body.backgroundColor.trim() : ''

    if (!contentHtml) {
      return res.status(400).json({ error: 'contentHtml es requerido' })
    }
    if (contentHtml.length > 4000) {
      return res.status(400).json({ error: 'contentHtml excede 4000 caracteres' })
    }
    if (ctaLabelRaw.length > 120) {
      return res.status(400).json({ error: 'ctaLabel excede 120 caracteres' })
    }
    if (ctaHrefRaw && !/^(https?:\/\/|\/|#|mailto:)/.test(ctaHrefRaw)) {
      return res.status(400).json({ error: 'ctaHref debe empezar con http(s)://, /, # o mailto:' })
    }
    if (!ANIMATION_MODES.includes(animationModeRaw as typeof ANIMATION_MODES[number])) {
      return res.status(400).json({ error: 'animationMode inválido' })
    }
    if (!ANIMATION_SPEEDS.includes(animationSpeedRaw as typeof ANIMATION_SPEEDS[number])) {
      return res.status(400).json({ error: 'animationSpeed inválido' })
    }
    if (backgroundColorRaw && !/^#[0-9a-fA-F]{6}$/.test(backgroundColorRaw)) {
      return res.status(400).json({ error: 'backgroundColor debe ser un hex #rrggbb' })
    }

    const ctaLabel = ctaLabelRaw || null
    const ctaHref = ctaHrefRaw || null
    const backgroundColor = backgroundColorRaw || null
    const updatedBy = req.user!.id

    const existing = await fetchLatest()
    let id: string

    if (existing) {
      id = existing.id
      await prisma.landingAnnouncement.update({
        where: { id },
        data: {
          content_html: contentHtml,
          cta_label: ctaLabel,
          cta_href: ctaHref,
          active,
          animation_mode: animationModeRaw,
          animation_speed: animationSpeedRaw,
          background_color: backgroundColor,
          updated_by: String(updatedBy),
        },
      })
    } else {
      id = randomUUID()
      await prisma.landingAnnouncement.create({
        data: {
          id,
          content_html: contentHtml,
          cta_label: ctaLabel,
          cta_href: ctaHref,
          active,
          animation_mode: animationModeRaw,
          animation_speed: animationSpeedRaw,
          background_color: backgroundColor,
          updated_by: String(updatedBy),
        },
      })
    }

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: existing ? 'landing_announcement.updated' : 'landing_announcement.created',
      entityType: 'landing_announcement',
      entityId: id,
      entityLabel: ctaLabel ?? 'landing_announcement',
      payload: { active, hasCta: Boolean(ctaHref), animationMode: animationModeRaw, animationSpeed: animationSpeedRaw, backgroundColor },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    const row = await fetchLatest()
    return res.json({ data: row ? serialize(row) : null })
  })
)
