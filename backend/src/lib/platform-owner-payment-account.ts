import { getSingletonSuperadmin } from './platform-profit-sharing'
import {
  disconnectPlatformPaymentAccount,
  getPlatformCollectorId,
  getPlatformPaymentAccountReadModel,
  revalidatePlatformPaymentAccount,
  upsertPlatformPaymentAccount,
  type PlatformPaymentAccountReadModel,
} from './platform-payment-accounts'

export type PlatformOwnerPaymentConnectionMode = 'manual' | 'oauth'
export type PlatformOwnerPaymentAccountReadModel = PlatformPaymentAccountReadModel | null

async function requireSingletonSuperadminId() {
  const superadmin = await getSingletonSuperadmin()
  if (!superadmin) throw new Error('No existe superadmin singleton configurado')
  return String(superadmin.id)
}

export async function getPlatformOwnerPaymentAccountReadModel() {
  const superadminId = await requireSingletonSuperadminId()
  const readModel = await getPlatformPaymentAccountReadModel(superadminId)
  if (!readModel) return null

  return {
    ...readModel,
    providerAccountLabel: !readModel.providerAccountLabel || readModel.providerAccountLabel === 'Mercado Pago platform'
      ? 'Mercado Pago owner'
      : readModel.providerAccountLabel,
  }
}

export async function upsertPlatformOwnerPaymentAccount(input: {
  accessToken: string
  refreshToken?: string | null
  oauthTokenType?: string | null
  oauthScope?: string | null
  oauthExpiresAt?: Date | null
  oauthConnectedAt?: Date | null
  providerAccountLabel?: string | null
}) {
  const superadminId = await requireSingletonSuperadminId()
  return upsertPlatformPaymentAccount({ ...input, platformAdminUserId: superadminId })
}

export async function disconnectPlatformOwnerPaymentAccount() {
  const superadminId = await requireSingletonSuperadminId()
  return disconnectPlatformPaymentAccount(superadminId)
}

export async function revalidatePlatformOwnerPaymentAccount() {
  const superadminId = await requireSingletonSuperadminId()
  return revalidatePlatformPaymentAccount(superadminId)
}

export async function getPlatformOwnerCollectorId(): Promise<string | null> {
  try {
    const superadminId = await requireSingletonSuperadminId()
    return getPlatformCollectorId(superadminId)
  } catch {
    return null
  }
}
