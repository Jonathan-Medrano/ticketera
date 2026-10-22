import { Router, Request, Response } from 'express'
import { buildMercadoPagoOAuthAuthorizationUrl, exchangeMercadoPagoAuthorizationCode, parseMercadoPagoOAuthState } from '../lib/mercadopago-oauth'
import { getMarketplaceFeeSummariesByFlow } from '../lib/marketplace-fee'
import { disconnectPaymentAccountByEmpresaId, getPaymentAccountReadModelByEmpresaId, upsertPaymentAccountByEmpresaId } from '../lib/payment-accounts'
import type { Permisos } from '../lib/permisos'
import { getSalesReadiness } from '../lib/sales-readiness'
import { requireAuth, verifyInternal } from '../middleware/auth'
import { requirePermissionMiddleware } from '../lib/authz'
import { logServerError } from '../lib/safe-log'
import { buildEmpresaMarketplaceFeeContract } from './empresa/shared'
import { prisma } from '../lib/prisma'

const router = Router()

function resolveEmpresaContext(req: Request) {
  const user = req.user!
  const esEmpleado = user.userType === 'empleado'
  const permisos = user.permisos as Permisos | undefined

  return {
    empresaId: esEmpleado ? user.empresa_id! : user.id,
    esEmpleado,
    permisos,
  }
}

const DEFAULT_COLOR_PRIMARIO = '#6366f1'

async function buildCobrosMercadoPagoResponse(empresaId: string) {
  const [paymentAccount, marketplaceFeeByFlow, salesReadiness, empresa] = await Promise.all([
    getPaymentAccountReadModelByEmpresaId(empresaId),
    getMarketplaceFeeSummariesByFlow(empresaId),
    getSalesReadiness(empresaId),
    prisma.empresa.findUnique({
      where: { id: empresaId },
      select: { logo_url: true, color_primario: true },
    }),
  ])

  const sitioConfigurado =
    empresa?.logo_url != null ||
    (empresa?.color_primario != null && empresa.color_primario !== DEFAULT_COLOR_PRIMARIO)

  return {
    provider: 'mercadopago' as const,
    payment_account: paymentAccount,
    ...buildEmpresaMarketplaceFeeContract(marketplaceFeeByFlow),
    sales_readiness: salesReadiness,
    sitio_configurado: sitioConfigurado ?? false,
  }
}

function isMercadoPagoConfigurationBadRequest(error: Error) {
  return [
    'El code de OAuth es obligatorio',
    'El state de OAuth es inválido',
    'El state de OAuth expiró',
  ].includes(error.message)
}

function getDashboardCobrosRedirectUrl(status: 'connected' | 'error', reason?: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3000'
  const url = new URL('/dashboard/cobros', baseUrl)
  url.searchParams.set('mercadopago_oauth', status)
  if (reason) {
    url.searchParams.set('reason', reason)
  }
  return url.toString()
}

router.get('/mercadopago', verifyInternal, requireAuth, requirePermissionMiddleware('ver_configuracion'), async (req: Request, res: Response) => {
  try {
    const { empresaId } = resolveEmpresaContext(req)

    return res.json({ data: await buildCobrosMercadoPagoResponse(empresaId) })
  } catch {
    logServerError('cobros mercadopago get')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.post('/mercadopago/oauth/start', verifyInternal, requireAuth, requirePermissionMiddleware('editar_configuracion'), async (req: Request, res: Response) => {
  try {
    const { empresaId } = resolveEmpresaContext(req)

    const authUrl = buildMercadoPagoOAuthAuthorizationUrl({
      empresaId,
      actorUserId: req.user!.id,
    })

    return res.json({ authUrl })
  } catch (error) {
    if (error instanceof Error && (isMercadoPagoConfigurationBadRequest(error) || error.message.startsWith('Falta configurar '))) {
      return res.status(400).json({ error: error.message })
    }
    logServerError('cobros mercadopago oauth start')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

router.get('/mercadopago/oauth/callback', verifyInternal, requireAuth, requirePermissionMiddleware('editar_configuracion', 'sin_permiso'), async (req: Request, res: Response) => {
  const redirectWithError = (reason: string) => res.redirect(302, getDashboardCobrosRedirectUrl('error', reason))

  try {
    const { empresaId } = resolveEmpresaContext(req)

    const providerError = typeof req.query.error === 'string' ? req.query.error : null
    if (providerError) {
      return redirectWithError(providerError)
    }

    const state = typeof req.query.state === 'string' ? req.query.state : ''
    const code = typeof req.query.code === 'string' ? req.query.code : ''
    const payload = parseMercadoPagoOAuthState(state)

    if (payload.empresaId !== empresaId || payload.actorUserId !== req.user!.id) {
      return redirectWithError('state_mismatch')
    }

    const oauthResult = await exchangeMercadoPagoAuthorizationCode(code)
    const oauthExpiresAt = typeof oauthResult.expires_in === 'number'
      ? new Date(Date.now() + oauthResult.expires_in * 1000)
      : null

    await upsertPaymentAccountByEmpresaId({
      empresaId,
      accessToken: oauthResult.access_token!,
      refreshToken: oauthResult.refresh_token ?? null,
      oauthTokenType: oauthResult.token_type ?? null,
      oauthScope: oauthResult.scope ?? null,
      oauthExpiresAt,
      oauthConnectedAt: new Date(),
    })

    return res.redirect(302, getDashboardCobrosRedirectUrl('connected'))
  } catch (error) {
    if (error instanceof Error) {
      if (isMercadoPagoConfigurationBadRequest(error) || error.message.startsWith('Falta configurar ') || error.message.startsWith('Mercado Pago OAuth')) {
        return redirectWithError('oauth_exchange_failed')
      }
    }
    logServerError('cobros mercadopago oauth callback', error)
    return redirectWithError('unexpected_error')
  }
})

router.post('/mercadopago', verifyInternal, requireAuth, async (_req: Request, res: Response) => {
  return res.status(405).json({
    error: 'La configuración manual de Mercado Pago ya no está disponible. Usá Conectar Mercado Pago vía OAuth.',
  })
})

router.patch('/mercadopago', verifyInternal, requireAuth, async (_req: Request, res: Response) => {
  return res.status(405).json({
    error: 'La configuración manual de Mercado Pago ya no está disponible. Usá Conectar Mercado Pago vía OAuth.',
  })
})
router.delete('/mercadopago', verifyInternal, requireAuth, requirePermissionMiddleware('editar_configuracion'), async (req: Request, res: Response) => {
  try {
    const { empresaId } = resolveEmpresaContext(req)

    await disconnectPaymentAccountByEmpresaId(empresaId)
    return res.json({ data: await buildCobrosMercadoPagoResponse(empresaId) })
  } catch {
    logServerError('cobros mercadopago delete')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

export default router
