import { Router } from 'express'
import { randomUUID as uuidv4 } from 'node:crypto'

import { requireAuth } from '../../middleware/auth'
import { requirePlatformCapabilityMiddleware } from '../../lib/authz'
import { createPlatformHandler } from './shared'
import { actorFromRequest, logAuditEvent } from '../../lib/audit-log'
import { prisma, prismaDirectUrl } from '../../lib/prisma'
import {
  aplicarTier,
  getFeeTierState,
  getHistorialFeeTier,
  getPctVigentePorEmpresa,
  getTiers,
  validarEscalera,
  type FeeTier,
} from '../../lib/fee-tiers'

/**
 * API de super-admin para comisiones por volumen.
 * Ver openspec/changes/fee-tiers-por-volumen/.
 *
 * `verifyInternal` (x-internal-secret) ya se aplica a nivel del router platform
 * en routes/platform.ts. Cada ruta suma requireAuth + capability (R3.6).
 */

const router = Router()

const CAP_LEER = 'platform.settings.read'
const CAP_ESCALERA = 'platform.fees.defaults.edit'
const CAP_EMPRESA = 'platform.companies.overrides.edit'

function parseTiersBody(raw: unknown): FeeTier[] {
  if (!Array.isArray(raw)) {
    throw new Error('El cuerpo debe incluir un array "tiers"')
  }

  return raw.map((item, idx) => {
    const t = item as Record<string, unknown>
    const nombre = typeof t.nombre === 'string' ? t.nombre.trim() : ''
    if (!nombre) {
      throw new Error(`El tier #${idx + 1} necesita un nombre`)
    }
    return {
      id: typeof t.id === 'string' && t.id.trim() ? t.id.trim() : uuidv4(),
      nombre,
      min_entradas_90d: Number(t.min_entradas_90d),
      pct_entradas: Number(t.pct_entradas),
      pct_consumibles: Number(t.pct_consumibles),
      activo: Boolean(t.activo),
      orden: Number.isFinite(Number(t.orden)) ? Number(t.orden) : idx,
    }
  })
}

// ---------------------------------------------------------------------------
// Escalera
// ---------------------------------------------------------------------------

router.get(
  '/',
  requireAuth,
  requirePlatformCapabilityMiddleware(CAP_LEER),
  createPlatformHandler('platform fee-tiers get', async (_req, res) => {
    const tiers = await getTiers()
    const validacion = validarEscalera(tiers)
    return res.json({ data: { tiers, validacion } })
  }),
)

router.put(
  '/',
  requireAuth,
  requirePlatformCapabilityMiddleware(CAP_ESCALERA),
  createPlatformHandler(
    'platform fee-tiers put',
    async (req, res) => {
      const body = req.body as Record<string, unknown>
      const tiers = parseTiersBody(body.tiers)

      // La validación corre en el servidor SIEMPRE, no solo en la UI:
      // un cliente puede mandar cualquier cosa.
      const validacion = validarEscalera(tiers)
      if (validacion.errores.length > 0) {
        return res.status(400).json({ error: validacion.errores[0], errores: validacion.errores })
      }

      const previos = await getTiers()

      await prismaDirectUrl.$transaction(async (tx) => {
        const idsNuevos = new Set(tiers.map((t) => t.id))
        for (const previo of previos) {
          if (!idsNuevos.has(previo.id)) {
            await tx.platformFeeTier.delete({ where: { id: previo.id } })
          }
        }
        for (const tier of tiers) {
          await tx.platformFeeTier.upsert({
            where: { id: tier.id },
            create: {
              id: tier.id,
              nombre: tier.nombre,
              min_entradas_90d: tier.min_entradas_90d,
              pct_entradas: tier.pct_entradas,
              pct_consumibles: tier.pct_consumibles,
              activo: tier.activo,
              orden: tier.orden,
            },
            update: {
              nombre: tier.nombre,
              min_entradas_90d: tier.min_entradas_90d,
              pct_entradas: tier.pct_entradas,
              pct_consumibles: tier.pct_consumibles,
              activo: tier.activo,
              orden: tier.orden,
            },
          })
        }
      })

      await logAuditEvent({
        actor: actorFromRequest(req),
        action: 'platform.fee_tiers.update',
        entityType: 'platform_fee_tiers',
        entityId: null,
        entityLabel: 'Escalera de comisiones por volumen',
        payload: { previos, nuevos: tiers },
      })

      const guardados = await getTiers()
      return res.json({ data: { tiers: guardados, validacion: validarEscalera(guardados) } })
    },
    { allowGenericBadRequest: true },
  ),
)

// ---------------------------------------------------------------------------
// Cola de descensos pendientes (R4.2)
// ---------------------------------------------------------------------------

router.get(
  '/pendientes',
  requireAuth,
  requirePlatformCapabilityMiddleware(CAP_LEER),
  createPlatformHandler('platform fee-tiers pendientes get', async (_req, res) => {
    const rows = await prismaDirectUrl.$queryRaw<
      {
        empresa_id: string
        empresa_nombre: string
        entradas_ventana: number
        pending_desde: Date | null
        evaluated_at: Date | null
        tier_actual: string | null
        tier_propuesto: string | null
        pct_entradas_propuesto: string | null
        pct_consumibles_propuesto: string | null
      }[]
    >`
      SELECT s.empresa_id,
             e.nombre                AS empresa_nombre,
             s.entradas_ventana,
             s.pending_desde,
             s.evaluated_at,
             actual.nombre           AS tier_actual,
             prop.nombre             AS tier_propuesto,
             prop.pct_entradas       AS pct_entradas_propuesto,
             prop.pct_consumibles    AS pct_consumibles_propuesto
      FROM empresa_fee_tier_state s
      JOIN empresas e ON e.id = s.empresa_id
      LEFT JOIN platform_fee_tiers actual ON actual.id = s.current_tier_id
      LEFT JOIN platform_fee_tiers prop   ON prop.id   = s.pending_downgrade_tier_id
      WHERE s.pending_downgrade_tier_id IS NOT NULL
      ORDER BY s.pending_desde ASC NULLS LAST
    `

    return res.json({ data: { pendientes: rows } })
  }),
)

router.post(
  '/pendientes/:empresaId/aplicar',
  requireAuth,
  requirePlatformCapabilityMiddleware(CAP_EMPRESA),
  createPlatformHandler('platform fee-tiers aplicar descenso', async (req, res) => {
    const empresaId = String(req.params.empresaId)

    const state = await getFeeTierState(empresaId)
    if (!state?.pending_downgrade_tier_id) {
      return res.status(404).json({ error: 'Esa empresa no tiene un descenso pendiente' })
    }
    if (state.pinned) {
      return res.status(409).json({ error: 'La empresa tiene la comisión fijada a mano. Quitá el pin antes de aplicar un tier.' })
    }

    const tierRow = await prisma.platformFeeTier.findUnique({ where: { id: state.pending_downgrade_tier_id } })
    if (!tierRow) {
      return res.status(409).json({ error: 'El tier propuesto ya no existe. Volvé a correr la evaluación.' })
    }

    const tier: FeeTier = {
      id: String(tierRow.id),
      nombre: String(tierRow.nombre),
      min_entradas_90d: Number(tierRow.min_entradas_90d),
      pct_entradas: Number(tierRow.pct_entradas),
      pct_consumibles: Number(tierRow.pct_consumibles),
      activo: Boolean(tierRow.activo),
      orden: Number(tierRow.orden),
    }

    const pctVigenteMap = await getPctVigentePorEmpresa([empresaId])
    const pctVigente = pctVigenteMap.get(empresaId) ?? { entradas: null, consumibles: null }

    // R4.4 — origen 'admin' + id del admin que lo aprobó.
    await aplicarTier({
      empresaId,
      tier,
      entradasVentana: state.entradas_ventana,
      origen: 'admin',
      aplicadoPor: req.user?.id ?? null,
      pctVigente,
    })

    await logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.fee_tiers.downgrade_applied',
      entityType: 'empresas',
      entityId: empresaId,
      entityLabel: tier.nombre,
      payload: { tier, pctAnterior: pctVigente, entradasVentana: state.entradas_ventana },
    })

    return res.json({ ok: true, data: { empresaId, tier } })
  }),
)

router.delete(
  '/pendientes/:empresaId',
  requireAuth,
  requirePlatformCapabilityMiddleware(CAP_EMPRESA),
  createPlatformHandler('platform fee-tiers descartar descenso', async (req, res) => {
    const empresaId = String(req.params.empresaId)

    await prisma.empresaFeeTierState.update({
      where: { empresa_id: empresaId },
      data: { pending_downgrade_tier_id: null, pending_desde: null },
    })

    await logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.fee_tiers.downgrade_dismissed',
      entityType: 'empresas',
      entityId: empresaId,
      entityLabel: null,
      payload: {},
    })

    return res.json({ ok: true })
  }),
)

// ---------------------------------------------------------------------------
// Pin / unpin (R5)
// ---------------------------------------------------------------------------

router.post(
  '/:empresaId/pin',
  requireAuth,
  requirePlatformCapabilityMiddleware(CAP_EMPRESA),
  createPlatformHandler('platform fee-tiers pin', async (req, res) => {
    const empresaId = String(req.params.empresaId)
    const body = req.body as Record<string, unknown>
    const motivo = typeof body.motivo === 'string' ? body.motivo.trim() : ''

    // Motivo obligatorio: un pin sin explicación es una comisión que nadie
    // sabe por qué está donde está.
    if (!motivo) {
      return res.status(400).json({ error: 'Escribí el motivo del acuerdo comercial' })
    }

    await prisma.empresaFeeTierState.upsert({
      where: { empresa_id: empresaId },
      create: {
        empresa_id: empresaId,
        pinned: true,
        pinned_por: req.user?.id ?? null,
        pinned_motivo: motivo.slice(0, 200),
      },
      update: {
        pinned: true,
        pinned_por: req.user?.id ?? null,
        pinned_motivo: motivo.slice(0, 200),
        pending_downgrade_tier_id: null,
        pending_desde: null,
      },
    })

    await logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.fee_tiers.pinned',
      entityType: 'empresas',
      entityId: empresaId,
      entityLabel: null,
      payload: { motivo },
    })

    return res.json({ ok: true })
  }),
)

router.post(
  '/:empresaId/unpin',
  requireAuth,
  requirePlatformCapabilityMiddleware(CAP_EMPRESA),
  createPlatformHandler('platform fee-tiers unpin', async (req, res) => {
    const empresaId = String(req.params.empresaId)

    await prisma.empresaFeeTierState.update({
      where: { empresa_id: empresaId },
      data: { pinned: false, pinned_por: null, pinned_motivo: null },
    })

    await logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.fee_tiers.unpinned',
      entityType: 'empresas',
      entityId: empresaId,
      entityLabel: null,
      payload: {},
    })

    return res.json({ ok: true })
  }),
)

// ---------------------------------------------------------------------------
// Estado + historial por empresa (R7.3)
// ---------------------------------------------------------------------------

router.get(
  '/:empresaId',
  requireAuth,
  requirePlatformCapabilityMiddleware(CAP_LEER),
  createPlatformHandler('platform fee-tiers empresa get', async (req, res) => {
    const empresaId = String(req.params.empresaId)
    const [state, historial, pctVigenteMap] = await Promise.all([
      getFeeTierState(empresaId),
      getHistorialFeeTier(empresaId),
      getPctVigentePorEmpresa([empresaId]),
    ])

    return res.json({
      data: {
        state,
        historial,
        pctVigente: pctVigenteMap.get(empresaId) ?? { entradas: null, consumibles: null },
      },
    })
  }),
)

export default router
