import type { Request, Response, NextFunction } from 'express'
import rateLimit from 'express-rate-limit'
import { getRequestIp } from '../middleware/auth'
import { logServerWarn } from './safe-log'

export const PASSWORD_RESET_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000
export const PASSWORD_RESET_RATE_LIMIT_MAX = 5
export const PASSWORD_RESET_RATE_LIMIT_MESSAGE = {
  error: 'Demasiados intentos de recuperación, intentá nuevamente en 15 minutos',
}

export function passwordResetRateLimitKey(req: Request) {
  return getRequestIp(req) || req.ip || 'unknown'
}

export function createPasswordResetRateLimit() {
  return rateLimit({
    windowMs: PASSWORD_RESET_RATE_LIMIT_WINDOW_MS,
    max: PASSWORD_RESET_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: passwordResetRateLimitKey,
    handler: (req: Request, res: Response, _next: NextFunction, options) => {
      void req
      logServerWarn('[PasswordReset] password_reset_rate_limited')
      return res.status(options.statusCode).json(options.message)
    },
    message: PASSWORD_RESET_RATE_LIMIT_MESSAGE,
  })
}
