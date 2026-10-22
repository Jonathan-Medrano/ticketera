import { Router } from 'express'
import {
  buildMercadoPagoOAuthAuthorizationUrl,
  exchangeMercadoPagoAuthorizationCode,
  parseMercadoPagoOAuthState,
} from '../../lib/mercadopago-oauth'
import {
  disconnectPlatformOwnerPaymentAccount,
  getPlatformOwnerPaymentAccountReadModel,
} from '../../lib/platform-owner-payment-account'
import { getSingletonSuperadmin } from '../../lib/platform-profit-sharing'
import {
  disconnectPlatformPaymentAccount,
  getPlatformPaymentAccountReadModel,
  listPlatformPaymentAccounts,
  upsertPlatformPaymentAccount,
} from '../../lib/platform-payment-accounts'
import { requirePlatformCapabilityMiddleware, requirePlatformConsoleMiddleware } from '../../lib/authz'
import { requireAuth } from '../../middleware/auth'
import { actorFromRequest, logAuditEvent } from '../../lib/audit-log'
import { logServerError } from '../../lib/safe-log'
import { createPlatformHandler } from './shared'

const router = Router()

function isMercadoPagoConfigurationBadRequest(error: Error) {
  return [
    'El code de OAuth es obligatorio',
    'El state de OAuth es inválido',
    'El state de OAuth expiró',
  ].includes(error.message)
}

function getSuperAdminConfiguracionRedirectUrl(status: 'connected' | 'error', reason?: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3000'
  const url = new URL('/super-admin/configuracion', baseUrl)
  url.searchParams.set('mercadopago_oauth', status)
  if (reason) {
    url.searchParams.set('reason', reason)
  }
  return url.toString()
}

function getPlatformCobrosRedirectUrl(status: 'connected' | 'error', reason?: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim() || 'http://localhost:3000'
  const url = new URL('/super-admin/dashboard', baseUrl)
  url.searchParams.set('mercadopago_oauth', status)
  if (reason) url.searchParams.set('reason', reason)
  return url.toString()
}

function getPlatformOAuthRedirectUrl(userType: string | null | undefined, status: 'connected' | 'error', reason?: string) {
  if (userType === 'super_admin') {
    return getSuperAdminConfiguracionRedirectUrl(status, reason)
  }

  return getPlatformCobrosRedirectUrl(status, reason)
}

function getManualMercadoPagoDisabledMessage() {
  return 'La configuración manual de Mercado Pago owner ya no está disponible. Usá Conectar Mercado Pago vía OAuth.'
}

router.get(
  '/mercadopago',
  requireAuth,
  requirePlatformConsoleMiddleware(),
  createPlatformHandler('platform cobros mercadopago get', async (req, res) => {
    const isSingletonSuperadmin = req.user!.userType === 'super_admin'
    const [ownerPaymentAccount, currentUserPaymentAccount, paymentAccounts] = await Promise.all([
      isSingletonSuperadmin ? getPlatformOwnerPaymentAccountReadModel() : Promise.resolve(null),
      getPlatformPaymentAccountReadModel(req.user!.id),
      isSingletonSuperadmin ? listPlatformPaymentAccounts() : Promise.resolve([]),
    ])

    return res.json({
      data: {
        ownerPaymentAccount: isSingletonSuperadmin ? ownerPaymentAccount : null,
        owner_payment_account: isSingletonSuperadmin ? ownerPaymentAccount : null,
        currentUserPaymentAccount,
        current_user_payment_account: currentUserPaymentAccount,
        paymentAccounts,
        payment_accounts: paymentAccounts,
      },
    })
  })
)

router.post(
  '/mercadopago/oauth/start',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.fees.defaults.edit'),
  createPlatformHandler('platform cobros mercadopago oauth start', async (req, res) => {
    const authUrl = buildMercadoPagoOAuthAuthorizationUrl({
      subject: 'platform_owner',
      actorUserId: req.user!.id,
    })

    return res.json({ authUrl })
  }, { allowGenericBadRequest: true })
)

router.get(
  '/mercadopago/oauth/callback',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.fees.defaults.edit'),
  async (req, res) => {
    const redirectWithError = (reason: string) => res.redirect(302, getPlatformOAuthRedirectUrl(req.user?.userType, 'error', reason))

    try {
      const providerError = typeof req.query.error === 'string' ? req.query.error : null
      if (providerError) {
        return redirectWithError(providerError)
      }

      const state = typeof req.query.state === 'string' ? req.query.state : ''
      const code = typeof req.query.code === 'string' ? req.query.code : ''
      const payload = parseMercadoPagoOAuthState(state)

      if (payload.subject !== 'platform_owner' || payload.actorUserId !== req.user!.id) {
        return redirectWithError('state_mismatch')
      }

      const oauthResult = await exchangeMercadoPagoAuthorizationCode(code, 'platform_owner')
      const oauthExpiresAt = typeof oauthResult.expires_in === 'number'
        ? new Date(Date.now() + oauthResult.expires_in * 1000)
        : null

      const singleton = await getSingletonSuperadmin()
      const targetPlatformAdminUserId = req.user!.userType === 'super_admin' && singleton
        ? String(singleton.id)
        : req.user!.id

      await upsertPlatformPaymentAccount({
        platformAdminUserId: targetPlatformAdminUserId,
        accessToken: oauthResult.access_token!,
        refreshToken: oauthResult.refresh_token ?? null,
        oauthTokenType: oauthResult.token_type ?? null,
        oauthScope: oauthResult.scope ?? null,
        oauthExpiresAt,
        oauthConnectedAt: new Date(),
      })

      void logAuditEvent({
        actor: actorFromRequest(req),
        action: 'platform.payment_account.connected',
        entityType: 'payment_account',
        entityId: targetPlatformAdminUserId,
        entityLabel: req.user!.userType === 'super_admin' ? 'Cuenta owner (singleton)' : 'Cuenta staff',
        payload: {
          provider: 'mercadopago',
          method: 'oauth',
          isOwnerSingleton: req.user!.userType === 'super_admin',
          hasRefreshToken: !!oauthResult.refresh_token,
          expiresAt: oauthExpiresAt ? oauthExpiresAt.toISOString() : null,
        },
        ipAddress: req.requestMeta?.ip ?? null,
      })

      return res.redirect(302, getPlatformOAuthRedirectUrl(req.user?.userType, 'connected'))
    } catch (error) {
      if (error instanceof Error) {
        if (isMercadoPagoConfigurationBadRequest(error) || error.message.startsWith('Falta configurar ') || error.message.startsWith('Mercado Pago OAuth')) {
          return redirectWithError('oauth_exchange_failed')
        }
      }

      logServerError('platform mercadopago oauth callback', error)
      return redirectWithError('unexpected_error')
    }
  }
)

router.post('/mercadopago', requireAuth, requirePlatformConsoleMiddleware(), async (_req, res) => {
  return res.status(405).json({ error: getManualMercadoPagoDisabledMessage() })
})

router.patch('/mercadopago', requireAuth, requirePlatformConsoleMiddleware(), async (_req, res) => {
  return res.status(405).json({ error: getManualMercadoPagoDisabledMessage() })
})

router.delete(
  '/mercadopago',
  requireAuth,
  requirePlatformCapabilityMiddleware('platform.fees.defaults.edit'),
  createPlatformHandler('platform cobros mercadopago delete', async (req, res) => {
    const isOwnerSingleton = req.user!.userType === 'super_admin'

    if (isOwnerSingleton) {
      await disconnectPlatformOwnerPaymentAccount()
    } else {
      await disconnectPlatformPaymentAccount(req.user!.id)
    }

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'platform.payment_account.disconnected',
      entityType: 'payment_account',
      entityId: req.user!.id,
      entityLabel: isOwnerSingleton ? 'Cuenta owner (singleton)' : 'Cuenta staff',
      payload: {
        provider: 'mercadopago',
        isOwnerSingleton,
      },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.json({ data: await getPlatformPaymentAccountReadModel(req.user!.id) })
  })
)

export default router
