import { Router, type Request } from 'express'
import { prisma } from '../lib/prisma'
import { createPersistentRateLimit } from '../lib/persistent-rate-limit'
import { getActorEmpresaId } from '../lib/authz'
import { logServerError } from '../lib/safe-log'

const router = Router()

// Rate limit persistente por empresa + IP. Esta ruta corre TRAS el guard interno
// (verifyInternal → req.user ya poblado), así que el identificador puede scopear por
// empresa. Ventana 60s / 40 hits: holgado para una sesión activa del asistente, corta
// loops/doble-fire accidental del front sin molestar al uso normal.
const victoriaFeedbackRateLimit = createPersistentRateLimit({
  prefix: 'victoria-feedback',
  windowMs: 60 * 1000,
  max: 40,
  message: { error: 'Demasiado feedback en poco tiempo' },
  getIdentifier: (req) => {
    const empresaId = req.user ? getActorEmpresaId(req.user) : null
    const forwarded = req.headers['x-forwarded-for']
    const fwd = Array.isArray(forwarded) ? forwarded[0] : forwarded
    const ip = (fwd ?? req.ip ?? 'unknown').split(',')[0].trim()
    return `${empresaId ?? 'unknown'}:${ip}`
  },
})

// Limpia y capa un string libre de telemetría: descarta caracteres de control ASCII
// (NUL, saltos de línea, DEL) para mantenerlo en una sola línea plana, recorta y
// trunca a `max`. Devuelve null si queda vacío. Defensa en profundidad: la columna
// también está capada en VARCHAR.
function cleanString(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null
  let cleaned = ''
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0
    // Drop C0 control chars (0x00-0x1F) and DEL (0x7F).
    if (code < 0x20 || code === 0x7f) continue
    cleaned += ch
  }
  cleaned = cleaned.trim()
  if (!cleaned) return null
  return cleaned.length > max ? cleaned.slice(0, max) : cleaned
}

type TelemetriaInsert = {
  empresaId: string
  tipo: 'fallback' | 'voto' | 'match' | 'gated'
  queryText: string | null
  topicId: string | null
  voto: 'up' | 'down' | null
  ruta: string | null
}

// Fire-and-forget: arranca el INSERT y devolvemos 204 sin esperar. Un fallo de
// telemetría NUNCA debe romper la UX del asistente, así que sólo lo logueamos.
function recordTelemetria(row: TelemetriaInsert) {
  void prisma.victoriaTelemetria
    .create({ data: row })
    .catch(() => logServerError('victoria telemetria insert'))
}

router.post('/feedback', victoriaFeedbackRateLimit, async (req: Request, res) => {
  // empresa_id SIEMPRE del contexto autenticado, NUNCA del body — cierra cross-tenant.
  const empresaId = req.user ? getActorEmpresaId(req.user) : null
  if (!empresaId) {
    return res.status(401).json({ error: 'No autorizado' })
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  const ruta = cleanString(body.ruta, 200)

  if (body.tipo === 'fallback') {
    const queryText = cleanString(body.query, 200)
    if (!queryText) {
      return res.status(400).json({ error: 'query es obligatorio (string no vacío)' })
    }
    recordTelemetria({ empresaId, tipo: 'fallback', queryText, topicId: null, voto: null, ruta })
    return res.status(204).send()
  }

  if (body.tipo === 'voto') {
    const topicId = cleanString(body.topicId, 100)
    const voto = body.voto === 'up' || body.voto === 'down' ? body.voto : null
    if (!topicId || !voto) {
      return res.status(400).json({ error: 'topicId y voto (up|down) son obligatorios' })
    }
    recordTelemetria({ empresaId, tipo: 'voto', queryText: null, topicId, voto, ruta })
    return res.status(204).send()
  }

  if (body.tipo === 'match') {
    const topicId = cleanString(body.topicId, 100)
    if (!topicId) {
      return res.status(400).json({ error: 'topicId es obligatorio' })
    }
    recordTelemetria({ empresaId, tipo: 'match', queryText: null, topicId, voto: null, ruta })
    return res.status(204).send()
  }

  if (body.tipo === 'gated') {
    const topicId = cleanString(body.topicId, 100)
    const reason = body.reason === 'permiso' || body.reason === 'flag' ? body.reason : null
    if (!topicId || !reason) {
      return res.status(400).json({ error: 'topicId y reason (permiso|flag) son obligatorios' })
    }
    recordTelemetria({ empresaId, tipo: 'gated', queryText: reason, topicId, voto: null, ruta })
    return res.status(204).send()
  }

  return res.status(400).json({ error: 'tipo inválido' })
})

export default router
