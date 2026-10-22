import { Request, Response, NextFunction } from 'express'
import { timingSafeEqual } from 'node:crypto'
import { SessionUser } from '../types'
import { rehydrateSessionUser } from '../lib/authz'
import { logServerError } from '../lib/safe-log'

type ActorKind = 'internal' | 'buyer' | 'anonymous'

function getHeaderValue(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

export function parseActorContextHeaders(req: Request) {
  const actorKindHeader = getHeaderValue(req.headers['x-actor-kind'])
  const actorKind: ActorKind = actorKindHeader === 'internal' || actorKindHeader === 'buyer' ? actorKindHeader : 'anonymous'
  return {
    actorKind,
    tenantSlug: getHeaderValue(req.headers['x-tenant-slug']) || null,
  }
}

export function getRequestIp(req: Request) {
  return getHeaderValue(req.headers['x-client-ip']) || req.ip || null
}

export function getRequestUserAgent(req: Request) {
  return getHeaderValue(req.headers['x-client-user-agent']) || getHeaderValue(req.headers['user-agent']) || null
}

export async function verifyInternal(req: Request, res: Response, next: NextFunction) {
  const secret = getHeaderValue(req.headers['x-internal-secret'])
  const expected = process.env.INTERNAL_API_SECRET ?? ''
  const received = secret ?? ''

  // Timing-safe comparison: prevents timing attacks that recover the secret char-by-char.
  // Length check is a safe early-exit — revealing "wrong length" gives no advantage
  // when the secret is a fixed-length token (e.g. 32/64 chars from .env).
  const expectedBuf = Buffer.from(expected)
  const receivedBuf = Buffer.alloc(expectedBuf.length) // same size, zero-filled
  Buffer.from(received).copy(receivedBuf, 0, 0, receivedBuf.length)
  const lengthOk = expected.length > 0 && received.length === expected.length
  const contentOk = timingSafeEqual(expectedBuf, receivedBuf)

  if (!lengthOk || !contentOk) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  try {
    const userHeader = req.headers['x-user'] as string
    const parsedUser = (userHeader && userHeader !== 'null')
      ? JSON.parse(userHeader) as SessionUser
      : null

    req.user = await rehydrateSessionUser(parsedUser)
  } catch {
    req.user = null
    logServerError('verifyInternal rehydrate user')
  }
  req.requestMeta = {
    ip: getRequestIp(req),
    userAgent: getRequestUserAgent(req),
    ...parseActorContextHeaders(req),
  }
  next()
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'No autorizado' })
  }
  next()
}
