import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { prisma } from '../../lib/prisma'
import {
  buildMarketplaceFeeSummary,
  getMarketplaceFeeOverridesByFlow,
  getMarketplaceFeeSummariesByFlow,
  getMarketplaceFeeSummariesByFlowBulk,
  getPlatformMarketplaceFeeDefaultsByFlow,
  upsertMarketplaceFeeConfigByEmpresaId,
} from '../../lib/marketplace-fee'
import { getPaymentAccountReadModelByEmpresaIdsBulk } from '../../lib/payment-accounts'
import { getPlatformCompanyAggregates, getPlatformCompanyReporting, type PlatformCompanyAggregate } from '../../lib/platform-reporting'
import { computeSalesReadiness, getSalesReadiness } from '../../lib/sales-readiness'
import bcrypt from 'bcryptjs'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { requireAuth } from '../../middleware/auth'
import {
  hasPlatformCapability,
  requirePlatformCapabilityMiddleware,
  requirePlatformRevenueScopeMiddleware,
  requireSuperAdminMiddleware,
} from '../../lib/authz'
import { actorFromRequest, logAuditEvent } from '../../lib/audit-log'
import { assertInternalEmailAvailable } from '../../lib/internal-email'
import { assertTenantSlugAvailable } from '../../lib/tenant-slug'
import { getDefaultSupportFaqs } from '../../lib/support-faqs'
import { buildCompanyContract, createPlatformHandler, parseMarketplaceFeeBody, parsePlatformFlow } from './shared'
import { Resend } from 'resend'
import { logServerError } from '../../lib/safe-log'
import { safeCsvCell } from '../../lib/csv-escape'
import { revalidateTenantPath } from '../../lib/revalidate-tenant'
import { revalidateVidriera } from '../../lib/revalidate-vidriera'
import { sendEmpresaApprovedEmail } from '../../lib/empresa-approved-email'
import { touchPasswordVersion } from '../../lib/password-version'

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

function getPlatformFromEmail(): string {
  const from = process.env.RESEND_FROM_EMAIL
  if (!from && process.env.NODE_ENV === 'production') {
    throw new Error('RESEND_FROM_EMAIL is required in production')
  }
  return from ?? 'onboarding@resend.dev'
}

const platformFromEmail = getPlatformFromEmail()

async function sendWelcomeEmailToEmpresa(
  email: string,
  adminNombre: string,
  empresaNombre: string,
  temporaryPassword: string
): Promise<void> {
  if (!resend) {
    logServerError('sendWelcomeEmailToEmpresa: resend not configured, skipping')
    return
  }
  const loginUrl = process.env.TENANT_BASE_URL
    ? `${process.env.TENANT_BASE_URL}/auth/empresa`
    : `${process.env.FRONTEND_URL ?? 'http://localhost:3000'}/auth/empresa`

  const esc = (s: string) =>
    String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  await resend.emails.send({
    from: platformFromEmail,
    to: email,
    subject: `Bienvenido a TICKETERA — tus credenciales de acceso`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
        <h2 style="color: #1a1a1a;">Hola ${esc(adminNombre)}, bienvenido/a a TICKETERA</h2>
        <p style="color: #444; font-size: 16px; line-height: 1.6;">
          Tu cuenta para <strong>${esc(empresaNombre)}</strong> fue creada exitosamente. Estas son tus credenciales de acceso:
        </p>
        <table style="background:#f5f5f5; padding:16px; border-radius:8px; width:100%;">
          <tr><td style="padding:4px 0;"><strong>Email:</strong></td><td>${esc(email)}</td></tr>
          <tr><td style="padding:4px 0;"><strong>Contraseña temporal:</strong></td><td><code style="background:#e0e0e0;padding:2px 6px;border-radius:4px;">${esc(temporaryPassword)}</code></td></tr>
        </table>
        <p style="color: #444; font-size: 16px; line-height: 1.6; margin-top: 16px;">
          <a href="${esc(loginUrl)}" style="background:#1a1a1a;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;display:inline-block;">Ingresar al panel</a>
        </p>
        <p style="color: #888; font-size: 13px; margin-top: 24px;">
          Por seguridad, cambiá tu contraseña al ingresar por primera vez.
        </p>
      </div>
    `,
  })
}

const router = Router()

// `platform.companies.read` grants access to the company-management list (approve, suspend,
// edit fees, etc.) but does NOT imply revenue visibility. Real money fields (ganancias_owner,
// volumen_bruto) — and the sales-count fields that proxy them (ventas, ventasTotales per flow)
// — must only reach viewers who also hold `platform.revenue.view.global` — the same capability
// `getPlatformDashboardReporting` / `analitica.ts` gate the platform-wide revenue breakdown on.
// Redact instead of omitting rows so company-management data (status flags, slugs, fee config)
// stays available to companies.read-only viewers.
function redactCompanyFinancials(company: PlatformCompanyAggregate): PlatformCompanyAggregate {
  return {
    ...company,
    gananciasOwner: 0,
    volumenBruto: 0,
    ventas: 0,
    metricasPorFlow: {
      entradas: { ...company.metricasPorFlow.entradas, volumenBruto: 0, gananciasOwner: 0, ventasTotales: 0 },
      consumibles: { ...company.metricasPorFlow.consumibles, volumenBruto: 0, gananciasOwner: 0, ventasTotales: 0 },
    },
  }
}

router.get(
  '/',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.companies.read'),
  createPlatformHandler('platform empresas', async (req, res) => {
    const rows = await getPlatformCompanyAggregates()
    const empresaIds = rows.map((row) => row.id)

    const [feesMap, accountsMap] = await Promise.all([
      getMarketplaceFeeSummariesByFlowBulk(empresaIds),
      getPaymentAccountReadModelByEmpresaIdsBulk(empresaIds),
    ])

    const canViewRevenue = hasPlatformCapability(req.user!, 'platform.revenue.view.global')

    const empresas = rows.map((row) => {
      const marketplaceFeeByFlow = feesMap.get(row.id)!
      const paymentAccount = accountsMap.get(row.id) ?? null
      const salesReadiness = computeSalesReadiness(paymentAccount, marketplaceFeeByFlow)

      return buildCompanyContract({
        company: canViewRevenue ? row : redactCompanyFinancials(row),
        salesReadiness,
        marketplaceFeeByFlow,
      })
    })

    return res.json({ data: { empresas } })
  })
)

router.post(
  '/',
  requireAuth,
  requireSuperAdminMiddleware,
  createPlatformHandler('platform empresa create', async (req, res) => {
    const body = req.body as Record<string, unknown>
    const nombre = typeof body.nombre === 'string' ? body.nombre.trim() : ''
    const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
    const email = typeof body.email === 'string' ? body.email.trim() : ''
    const admin_nombre = typeof body.admin_nombre === 'string' ? body.admin_nombre.trim() : ''
    const admin_apellido = typeof body.admin_apellido === 'string' ? body.admin_apellido.trim() || null : null

    if (!nombre || !slug || !email || !admin_nombre) {
      return res.status(400).json({ error: 'nombre, slug, email y admin_nombre son requeridos' })
    }

    let normalizedEmail: string
    let normalizedSlug: string
    try {
      normalizedEmail = await assertInternalEmailAvailable(email)
    } catch (e) {
      return res.status(409).json({ error: e instanceof Error ? e.message : 'Email en uso' })
    }
    try {
      normalizedSlug = await assertTenantSlugAvailable(slug)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Slug en uso'
      return res.status(msg.includes('reservado') || msg.startsWith('El subdominio') && !msg.includes('en uso') ? 400 : 409).json({ error: msg })
    }

    const temporaryPassword = randomBytes(9).toString('base64url').slice(0, 12)
    const hashedPassword = await bcrypt.hash(temporaryPassword, 12)
    const empresaId = randomUUID()

    await prisma.empresa.create({
      data: {
        id: empresaId,
        nombre,
        slug: normalizedSlug,
        email: normalizedEmail,
        password: hashedPassword,
        admin_nombre,
        admin_apellido,
        faqs: JSON.stringify(getDefaultSupportFaqs()),
        must_change_password: true,
      },
    })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.empresa.created',
      entityType: 'empresa',
      entityId: empresaId,
      entityLabel: nombre,
      payload: { slug: normalizedSlug, email: normalizedEmail },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    // Enviar email de bienvenida con credenciales. Si falla, no rompe la creación.
    void sendWelcomeEmailToEmpresa(normalizedEmail, admin_nombre, nombre, temporaryPassword).catch(() => {
      logServerError(`platform empresa create: welcome email failed for empresa ${empresaId}`)
    })

    return res.status(201).json({ data: { empresaId, temporaryPassword, email: normalizedEmail, slug: normalizedSlug } })
  }, { allowGenericBadRequest: true })
)

const csvEscape = safeCsvCell

function formatMoneyForCsv(value: unknown): string {
  const num = Number(value ?? 0)
  if (!Number.isFinite(num)) return '0.00'
  return num.toFixed(2)
}

function isValidDateString(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
}

const exportRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => String((req.user as { id?: string } | null)?.id ?? req.ip ?? 'unknown'),
  message: { error: 'Demasiadas exportaciones, esperá un minuto' },
})

router.get(
  '/owner-earnings/export',
  requireAuth,
  exportRateLimit,
  // Pure money export across ALL companies (up to 2000 rows) — `platform.companies.read` (needed
  // just to manage companies) must not be sufficient here. Require the same global revenue scope
  // `getPlatformDashboardReporting` gates the platform-wide breakdown on.
  requirePlatformRevenueScopeMiddleware('global'),
  createPlatformHandler('platform empresas owner-earnings export', async (req, res) => {
    const desde = isValidDateString(req.query.desde) ? req.query.desde : null
    const hasta = isValidDateString(req.query.hasta) ? req.query.hasta : null
    const soloActivas = req.query.solo_activas === '1' || req.query.solo_activas === 'true'

    const EXPORT_LIMIT = 2000

    // Build Postgres-compatible $queryRawUnsafe with positional params ($1, $2, ...)
    const pgEntradasValues: unknown[] = []
    const pgConsumiblesValues: unknown[] = []

    if (desde) pgEntradasValues.push(desde)
    if (hasta) pgEntradasValues.push(hasta)
    if (desde) pgConsumiblesValues.push(desde)
    if (hasta) pgConsumiblesValues.push(hasta)

    const allValues: unknown[] = [...pgEntradasValues, ...pgConsumiblesValues, EXPORT_LIMIT]
    let paramIdx = 0
    const nextPg = () => `$${++paramIdx}`

    const entradasDatePg = pgEntradasValues.length
      ? 'AND ' + [
          desde ? `DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') >= ${nextPg()}::date` : null,
          hasta ? `DATE(en.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') <= ${nextPg()}::date` : null,
        ].filter(Boolean).join(' AND ')
      : ''
    const consumiblesDatePg = pgConsumiblesValues.length
      ? 'AND ' + [
          desde ? `DATE(cv.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') >= ${nextPg()}::date` : null,
          hasta ? `DATE(cv.created_at AT TIME ZONE 'America/Argentina/Buenos_Aires') <= ${nextPg()}::date` : null,
        ].filter(Boolean).join(' AND ')
      : ''
    const empresaWherePg = soloActivas ? 'WHERE e.activa = true' : ''
    const limitPg = nextPg()

    // Build the SQL string with resolved $N references
    const exportSql = `
      SELECT
        e.id,
        e.nombre,
        e.slug,
        e.activa,
        COALESCE(e.suspendido, false) AS suspendido,
        COALESCE(entradas_stats.ventas, 0) AS entradas_ventas,
        COALESCE(entradas_stats.volumen_bruto, 0) AS entradas_volumen_bruto,
        COALESCE(entradas_stats.ganancias_owner, 0) AS entradas_ganancias_owner,
        COALESCE(consumibles_stats.ventas, 0) AS consumibles_ventas,
        COALESCE(consumibles_stats.volumen_bruto, 0) AS consumibles_volumen_bruto,
        COALESCE(consumibles_stats.ganancias_owner, 0) AS consumibles_ganancias_owner
      FROM empresas e
      LEFT JOIN (
        SELECT ev.empresa_id,
               COUNT(en.id) AS ventas,
               COALESCE(SUM(en.precio_pagado), 0) AS volumen_bruto,
               COALESCE(SUM(en.comision), 0) AS ganancias_owner
        FROM entradas en
        JOIN eventos ev ON ev.id = en.evento_id
        WHERE en.estado <> 'cancelada'
        ${entradasDatePg}
        GROUP BY ev.empresa_id
      ) entradas_stats ON entradas_stats.empresa_id = e.id
      LEFT JOIN (
        SELECT cv.empresa_id,
               COUNT(cv.id) AS ventas,
               COALESCE(SUM(cv.total), 0) AS volumen_bruto,
               COALESCE(SUM(cv.owner_fee_amount), 0) AS ganancias_owner
        FROM consumibles_ventas cv
        WHERE cv.estado <> 'cancelado'
        ${consumiblesDatePg}
        GROUP BY cv.empresa_id
      ) consumibles_stats ON consumibles_stats.empresa_id = e.id
      ${empresaWherePg}
      ORDER BY (COALESCE(entradas_stats.ganancias_owner, 0) + COALESCE(consumibles_stats.ganancias_owner, 0)) DESC, e.nombre ASC
      LIMIT ${limitPg}
    `

    const rows = await prisma.$queryRawUnsafe<{
      id: string
      nombre: string
      slug: string
      activa: boolean
      suspendido: boolean
      entradas_ventas: bigint
      entradas_volumen_bruto: unknown
      entradas_ganancias_owner: unknown
      consumibles_ventas: bigint
      consumibles_volumen_bruto: unknown
      consumibles_ganancias_owner: unknown
    }[]>(exportSql, ...allValues)

    const headers = [
      'empresa_id',
      'empresa_nombre',
      'slug',
      'estado',
      'entradas_ventas',
      'entradas_volumen_bruto',
      'entradas_ganancias_owner',
      'consumibles_ventas',
      'consumibles_volumen_bruto',
      'consumibles_ganancias_owner',
      'total_ventas',
      'total_volumen_bruto',
      'total_ganancias_owner',
    ]

    const lines: string[] = [headers.join(',')]

    let acumEntradasVentas = 0
    let acumEntradasBruto = 0
    let acumEntradasOwner = 0
    let acumConsumiblesVentas = 0
    let acumConsumiblesBruto = 0
    let acumConsumiblesOwner = 0

    for (const row of rows) {
      // Postgres returns COUNT as bigint (need Number()) and SUM as string Decimal
      const entradasVentas = Number(row.entradas_ventas ?? 0n)
      const entradasBruto = Number(row.entradas_volumen_bruto ?? 0)
      const entradasOwner = Number(row.entradas_ganancias_owner ?? 0)
      const consumiblesVentas = Number(row.consumibles_ventas ?? 0n)
      const consumiblesBruto = Number(row.consumibles_volumen_bruto ?? 0)
      const consumiblesOwner = Number(row.consumibles_ganancias_owner ?? 0)

      const totalVentas = entradasVentas + consumiblesVentas
      const totalBruto = entradasBruto + consumiblesBruto
      const totalOwner = entradasOwner + consumiblesOwner

      acumEntradasVentas += entradasVentas
      acumEntradasBruto += entradasBruto
      acumEntradasOwner += entradasOwner
      acumConsumiblesVentas += consumiblesVentas
      acumConsumiblesBruto += consumiblesBruto
      acumConsumiblesOwner += consumiblesOwner

      const estado = row.suspendido
        ? 'suspendida'
        : row.activa
          ? 'activa'
          : 'inactiva'

      lines.push([
        csvEscape(row.id),
        csvEscape(row.nombre),
        csvEscape(row.slug),
        csvEscape(estado),
        csvEscape(entradasVentas),
        csvEscape(formatMoneyForCsv(entradasBruto)),
        csvEscape(formatMoneyForCsv(entradasOwner)),
        csvEscape(consumiblesVentas),
        csvEscape(formatMoneyForCsv(consumiblesBruto)),
        csvEscape(formatMoneyForCsv(consumiblesOwner)),
        csvEscape(totalVentas),
        csvEscape(formatMoneyForCsv(totalBruto)),
        csvEscape(formatMoneyForCsv(totalOwner)),
      ].join(','))
    }

    if (rows.length > 0) {
      const acumTotalVentas = acumEntradasVentas + acumConsumiblesVentas
      const acumTotalBruto = acumEntradasBruto + acumConsumiblesBruto
      const acumTotalOwner = acumEntradasOwner + acumConsumiblesOwner

      lines.push([
        csvEscape('TOTAL'),
        '',
        '',
        '',
        csvEscape(acumEntradasVentas),
        csvEscape(formatMoneyForCsv(acumEntradasBruto)),
        csvEscape(formatMoneyForCsv(acumEntradasOwner)),
        csvEscape(acumConsumiblesVentas),
        csvEscape(formatMoneyForCsv(acumConsumiblesBruto)),
        csvEscape(formatMoneyForCsv(acumConsumiblesOwner)),
        csvEscape(acumTotalVentas),
        csvEscape(formatMoneyForCsv(acumTotalBruto)),
        csvEscape(formatMoneyForCsv(acumTotalOwner)),
      ].join(','))
    }

    const csv = '﻿' + lines.join('\r\n')
    const rangoSuffix = desde || hasta ? `-${desde ?? 'inicio'}_${hasta ?? 'hoy'}` : ''
    const filename = `owner-earnings${rangoSuffix}-${new Date().toISOString().slice(0, 10)}.csv`

    res.setHeader('Content-Type', 'text/csv; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`)
    return res.send(csv)
  })
)

router.get(
  '/:empresaId/ganancias',
  requireAuth,
  // Same as the owner-earnings export: this is a pure money endpoint for a single company,
  // so it needs `platform.revenue.view.global`, not just `platform.companies.read`.
  requirePlatformRevenueScopeMiddleware('global'),
  createPlatformHandler('platform empresa ganancias', async (req, res) => {
    const { empresaId } = req.params
    const reporting = await getPlatformCompanyReporting(empresaId)

    if (!reporting) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    const marketplaceFeeByFlow = await getMarketplaceFeeSummariesByFlow(empresaId)
    const salesReadiness = await getSalesReadiness(empresaId, { preloadedMarketplaceFee: marketplaceFeeByFlow })

    return res.json({
      data: {
        empresaId: reporting.empresaId,
        empresaNombre: reporting.empresaNombre,
        volumenBruto: reporting.volumenBruto,
        gananciasOwner: reporting.gananciasOwner,
        ventas: reporting.ventas,
        serieTemporal: reporting.serieTemporal,
        metricasPorFlow: reporting.metricasPorFlow,
        metricas_por_flow: reporting.metricasPorFlow,
        salesReadiness,
        sales_readiness: salesReadiness,
        marketplaceFeeByFlow: marketplaceFeeByFlow,
        marketplace_fee_by_flow: marketplaceFeeByFlow,
      },
    })
  })
)

router.get(
  '/:empresaId/fees',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.companies.read'),
  createPlatformHandler('platform empresa fees', async (req, res) => {
    const { empresaId } = req.params
    const empresaExists = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true } })
    if (!empresaExists) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    const [defaultsByFlow, overridesByFlow, resolvedByFlow] = await Promise.all([
      getPlatformMarketplaceFeeDefaultsByFlow(),
      getMarketplaceFeeOverridesByFlow(empresaId),
      getMarketplaceFeeSummariesByFlow(empresaId),
    ])

    return res.json({
      data: {
        empresaId,
        defaultsByFlow,
        defaults_by_flow: defaultsByFlow,
        overridesByFlow,
        overrides_by_flow: overridesByFlow,
        resolvedByFlow,
        resolved_by_flow: resolvedByFlow,
      },
    })
  })
)

router.patch(
  '/:empresaId/public-status',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.companies.overrides.edit'),
  createPlatformHandler('platform empresa public status patch', async (req, res) => {
    const { empresaId } = req.params
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, nombre: true, slug: true, tenant_public_disabled: true },
    })
    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    const publicDisabled = req.body?.publicDisabled
    if (typeof publicDisabled !== 'boolean') {
      return res.status(400).json({ error: 'publicDisabled debe ser boolean' })
    }

    const previousDisabled = empresa.tenant_public_disabled ?? false

    await prisma.empresa.update({
      where: { id: empresaId },
      data: {
        tenant_public_disabled: publicDisabled,
        tenant_public_disabled_at: publicDisabled ? new Date() : null,
      },
    })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: publicDisabled ? 'platform.empresa.public_disabled' : 'platform.empresa.public_enabled',
      entityType: 'empresa',
      entityId: empresaId,
      entityLabel: empresa.nombre ?? empresaId,
      payload: { previousDisabled, nextDisabled: publicDisabled },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    void revalidateTenantPath(empresa.slug)
    void revalidateVidriera()

    return res.json({
      data: {
        empresaId,
        tenantPublicDisabled: publicDisabled,
        tenant_public_disabled: publicDisabled,
      },
    })
  })
)

router.patch(
  '/:empresaId/es-prueba',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.companies.overrides.edit'),
  createPlatformHandler('platform empresa es_prueba patch', async (req, res) => {
    const { empresaId } = req.params
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, nombre: true, es_prueba: true },
    })
    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    const esPrueba = typeof req.body?.esPrueba === 'boolean'
      ? req.body.esPrueba
      : req.body?.es_prueba
    if (typeof esPrueba !== 'boolean') {
      return res.status(400).json({ error: 'esPrueba debe ser boolean' })
    }

    const previousValue = empresa.es_prueba ?? false

    await prisma.empresa.update({
      where: { id: empresaId },
      data: { es_prueba: esPrueba },
    })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: esPrueba ? 'platform.empresa.marked_test' : 'platform.empresa.unmarked_test',
      entityType: 'empresa',
      entityId: empresaId,
      entityLabel: empresa.nombre ?? empresaId,
      payload: { previousValue, nextValue: esPrueba },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    // es_prueba es uno de los flags de elegibilidad de la vidriera (vidriera.ts)
    void revalidateVidriera()

    return res.json({
      data: {
        empresaId,
        esPrueba,
        es_prueba: esPrueba,
      },
    })
  })
)

router.patch(
  '/:empresaId/suspension',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.companies.overrides.edit'),
  createPlatformHandler('platform empresa suspension patch', async (req, res) => {
    const { empresaId } = req.params
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, nombre: true, slug: true, suspendido: true },
    })
    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    const suspendido = req.body?.suspendido
    if (typeof suspendido !== 'boolean') {
      return res.status(400).json({ error: 'suspendido debe ser boolean' })
    }

    const motivo = typeof req.body?.motivo === 'string' ? req.body.motivo.trim().slice(0, 500) : null
    const previousSuspendido = empresa.suspendido ?? false

    await prisma.empresa.update({
      where: { id: empresaId },
      data: {
        suspendido,
        suspendido_at: suspendido ? new Date() : null,
        suspendido_motivo: suspendido ? motivo : null,
      },
    })

    // Al suspender: cancelar checkout sessions activas para que el cleanup job
    // libere el stock bloqueado en su próximo ciclo y no se emitan entradas nuevas.
    if (suspendido) {
      await prisma.checkoutSession.updateMany({
        where: { empresa_id: empresaId, estado: 'reservada' },
        data: { estado: 'cancelada' },
      })
    }

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: suspendido ? 'platform.empresa.suspended' : 'platform.empresa.reactivated',
      entityType: 'empresa',
      entityId: empresaId,
      entityLabel: empresa.nombre ?? empresaId,
      payload: {
        previousSuspendido,
        nextSuspendido: suspendido,
        motivo: suspendido ? motivo : null,
      },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    void revalidateTenantPath(empresa.slug)
    void revalidateVidriera()

    return res.json({
      data: {
        empresaId,
        suspendido,
        motivo: suspendido ? motivo : null,
      },
    })
  })
)

router.patch(
  '/:empresaId/aprobacion',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.companies.overrides.edit'),
  createPlatformHandler('platform empresa aprobacion patch', async (req, res) => {
    const { empresaId } = req.params
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, nombre: true, aprobada: true, email: true, admin_nombre: true },
    })
    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    const aprobada = req.body?.aprobada
    if (typeof aprobada !== 'boolean') {
      return res.status(400).json({ error: 'aprobada debe ser boolean' })
    }

    const previousAprobada = empresa.aprobada ?? true

    await prisma.empresa.update({
      where: { id: empresaId },
      data: {
        aprobada,
        aprobada_at: aprobada ? new Date() : null,
      },
    })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: aprobada ? 'platform.empresa.approved' : 'platform.empresa.unapproved',
      entityType: 'empresa',
      entityId: empresaId,
      entityLabel: empresa.nombre ?? empresaId,
      payload: { previousAprobada, nextAprobada: aprobada },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    // Solo en la transición pendiente→aprobada avisamos por email (best-effort).
    if (!previousAprobada && aprobada && empresa.email) {
      try {
        await sendEmpresaApprovedEmail({
          email: empresa.email,
          nombre: empresa.nombre,
          adminNombre: empresa.admin_nombre,
        })
      } catch (error) {
        logServerError('platform empresa aprobacion send approved email', error)
      }
    }

    // aprobada es uno de los flags de elegibilidad de la vidriera (vidriera.ts)
    void revalidateVidriera()

    return res.json({
      data: {
        empresaId,
        aprobada,
      },
    })
  })
)

router.patch(
  '/:empresaId/fees',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.companies.overrides.edit'),
  createPlatformHandler('platform empresa fees patch', async (req, res) => {
    const { empresaId } = req.params
    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true, nombre: true } })
    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    const body = req.body as Record<string, unknown>
    const flow = parsePlatformFlow(body.flow)
    const config = parseMarketplaceFeeBody(body)

    const marketplaceFee = await upsertMarketplaceFeeConfigByEmpresaId({
      empresaId,
      flow,
      ...config,
      updatedByPlatformAdminId: req.user!.id,
    })

    const [resolvedByFlow, overridesByFlow] = await Promise.all([
      getMarketplaceFeeSummariesByFlow(empresaId),
      getMarketplaceFeeOverridesByFlow(empresaId),
    ])

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.empresa.fee_updated',
      entityType: 'empresa',
      entityId: empresaId,
      entityLabel: empresa.nombre ?? empresaId,
      payload: { flow, config },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.json({
      data: {
        empresaId,
        flow,
        marketplace_fee: buildMarketplaceFeeSummary(marketplaceFee, { flow, source: 'empresa' }),
        marketplace_fee_by_flow: resolvedByFlow,
        marketplaceFeeByFlow: resolvedByFlow,
        overrides_by_flow: overridesByFlow,
        overridesByFlow,
      },
    })
  }, { allowGenericBadRequest: true })
)

router.patch(
  '/:empresaId/features',
  requireAuth,
  requireSuperAdminMiddleware,
  createPlatformHandler('platform empresa features patch', async (req, res) => {
    const { empresaId } = req.params
    const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true, nombre: true } })
    if (!empresa) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    const body = req.body as Record<string, unknown>
    const updateData: { revendedor_habilitado?: boolean; consumibles_habilitado?: boolean } = {}

    if (typeof body.revendedor_habilitado === 'boolean') {
      updateData.revendedor_habilitado = body.revendedor_habilitado
    }
    if (typeof body.consumibles_habilitado === 'boolean') {
      updateData.consumibles_habilitado = body.consumibles_habilitado
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No hay flags para actualizar' })
    }

    const updatedEmpresa = await prisma.empresa.update({
      where: { id: empresaId },
      data: updateData,
      select: { revendedor_habilitado: true, consumibles_habilitado: true },
    })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.empresa.features_updated',
      entityType: 'empresa',
      entityId: empresaId,
      entityLabel: empresa.nombre ?? empresaId,
      payload: body,
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.json({
      data: {
        empresaId,
        revendedorHabilitado: updatedEmpresa.revendedor_habilitado,
        consumiblesHabilitado: updatedEmpresa.consumibles_habilitado,
      },
    })
  })
)

router.post(
  '/:empresaId/impersonate',
  requireAuth,
  requireSuperAdminMiddleware,
  createPlatformHandler('platform empresa impersonate', async (req, res) => {
    const { empresaId } = req.params
    const empresaForImpersonate = await prisma.empresa.findFirst({
      where: { id: empresaId, activa: true },
      select: { id: true, nombre: true },
    })
    if (!empresaForImpersonate) return res.status(404).json({ error: 'Empresa no encontrada o inactiva' })

    const rawToken = randomBytes(32).toString('hex')
    const tokenHash = createHash('sha256').update(rawToken).digest('hex')
    const id = randomUUID()
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000)

    await prisma.platformImpersonationToken.create({
      data: { id, token_hash: tokenHash, empresa_id: empresaId, created_by: req.user!.id, expires_at: expiresAt },
    })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.empresa.impersonated',
      entityType: 'empresa',
      entityId: empresaId,
      entityLabel: empresaForImpersonate.nombre ?? empresaId,
      payload: null,
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.json({ data: { token: rawToken } })
  })
)

router.post(
  '/:empresaId/reset-password',
  requireAuth,
  requireSuperAdminMiddleware,
  createPlatformHandler('platform empresa reset-password', async (req, res) => {
    const { empresaId } = req.params
    const empresa = await prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { id: true, nombre: true, email: true },
    })
    if (!empresa) return res.status(404).json({ error: 'Empresa no encontrada' })

    const temporaryPassword = randomBytes(9).toString('base64url').slice(0, 12)
    const hash = await bcrypt.hash(temporaryPassword, 12)

    await prisma.empresa.update({
      where: { id: empresaId },
      data: { password: hash, must_change_password: true },
    })

    // Sin esto, una sesión ya activa con la password vieja sigue funcionando después
    // del reset — el passwordVersion check en auth.ts (jwt callback) es lo que invalida
    // sesiones existentes cuando cambia la contraseña.
    await touchPasswordVersion('empresa', empresaId)

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.empresa.password_reset',
      entityType: 'empresa',
      entityId: empresaId,
      entityLabel: empresa.nombre ?? empresaId,
      payload: { email: empresa.email },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.json({ data: { temporaryPassword, empresaId } })
  })
)

router.patch(
  '/:empresaId/comision',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.companies.overrides.edit'),
  createPlatformHandler('platform empresa comision patch', async (req, res) => {
    const { empresaId } = req.params
    const empresaForComision = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { id: true } })
    if (!empresaForComision) {
      return res.status(404).json({ error: 'Empresa no encontrada' })
    }

    const config = parseMarketplaceFeeBody(req.body as Record<string, unknown>)
    const marketplaceFee = await upsertMarketplaceFeeConfigByEmpresaId({
      empresaId,
      ...config,
      updatedByPlatformAdminId: req.user!.id,
    })

    const marketplaceFeeByFlow = await getMarketplaceFeeSummariesByFlow(empresaId)

    return res.json({
      data: {
        marketplace_fee: buildMarketplaceFeeSummary(marketplaceFee, { flow: 'entradas', source: 'empresa' }),
        marketplace_fee_by_flow: marketplaceFeeByFlow,
        marketplaceFeeByFlow: marketplaceFeeByFlow,
      },
    })
  }, { allowGenericBadRequest: true })
)

export default router
