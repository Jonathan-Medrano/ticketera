import { Request, Response, NextFunction } from 'express'
import { logServerError } from '../lib/safe-log'
import { captureError } from '../lib/error-logger'

type RequestWithUser = Request & { user?: { id?: string; userType?: string }; requestMeta?: { ip?: string } }

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  logServerError('express middleware', err)

  const reqWithUser = req as RequestWithUser
  const userAgent = req.headers['user-agent']
  const ip = reqWithUser.requestMeta?.ip ?? (req.ip || (req.headers['x-forwarded-for'] as string | undefined) || null)

  // Fire-and-forget — do NOT await; captureError is failsafe and we must
  // respond to the client even if persistence fails.
  void captureError({
    source: 'backend',
    severity: 'error',
    message: err?.message ?? String(err),
    stack: err?.stack ?? null,
    context: {
      url: req.originalUrl,
      method: req.method,
      status: 500,
      user_id: reqWithUser.user?.id ?? null,
      user_type: reqWithUser.user?.userType ?? null,
      route_path: (req.route?.path as string | undefined) ?? null,
    },
    userAgent: typeof userAgent === 'string' ? userAgent : null,
    ipAddress: typeof ip === 'string' ? ip : null,
  })

  res.status(500).json({ error: 'Error interno del servidor' })
}
