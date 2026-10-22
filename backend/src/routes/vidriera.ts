import { Router, Request, Response } from 'express'
import { prisma } from '../lib/prisma'
import { verifyInternal } from '../middleware/auth'
import { buildEventPublicationSnapshot } from '../lib/event-publication'
import { isVidrieraHabilitada } from '../lib/platform-settings'

const router = Router()

const DEFAULT_LIMIT = 60
const MAX_LIMIT = 100

// Shape explícito de salida (no spreadea el row crudo): esta ruta agrega TODAS las
// empresas elegibles en una sola respuesta, así que conviene no filtrar campos internos
// de scheduling (publication_mode, publish_at_utc, etc.) más allá del snapshot público
// ya calculado por buildEventPublicationSnapshot.
function serializeVidrieraEvent(row: VidrieraEventoRow) {
  const {
    id, nombre, descripcion, lugar, ciudad, imagen_url, proxima_fecha, precio_desde,
    empresa_id, empresa_slug, empresa_nombre, empresa_logo_url,
  } = row

  return {
    id, nombre, descripcion, lugar, ciudad, imagen_url, proxima_fecha, precio_desde,
    empresa_id, empresa_slug, empresa_nombre, empresa_logo_url,
    ...buildEventPublicationSnapshot(row),
  }
}

type VidrieraEventoRow = {
  id: string; nombre: string; descripcion: string | null; lugar: string | null; ciudad: string | null
  imagen_url: string | null
  modo_fecha: string | null; activo: boolean
  publication_mode: string | null; pre_publish_visibility: string | null
  publish_at_utc: Date | null; publish_timezone: string | null; published_live_at: Date | null
  proxima_fecha: Date | null; precio_desde: number | null
  empresa_id: string; empresa_slug: string; empresa_nombre: string; empresa_logo_url: string | null
}

// GET /vidriera/eventos — descubrimiento público CROSS-TENANT (home marketing + página /eventos).
// Distinto de /tenant/:slug/eventos: acá no hay slug conocido, se agregan eventos de
// TODAS las empresas elegibles a la vez. Por eso la elegibilidad de empresa es más
// estricta que la ruta de un tenant conocido (esa no necesita filtrar es_prueba/aprobada
// porque quien pide un slug puntual ya sabe a qué tenant se refiere).
// Cuanto se sobre-pide en SQL para compensar que is_listed se recalcula en JS
// DESPUÉS del corte (ver comentario junto al filtro más abajo).
const SQL_FETCH_MULTIPLIER = 5
const SQL_FETCH_CAP = 500

router.get('/eventos', verifyInternal, async (req: Request, res: Response) => {
  // Gate de plataforma: con una sola empresa, una "vidriera" de un solo evento comunica
  // lo contrario de lo que queremos. Se decide acá y no en el front para que ningún
  // consumidor pueda saltearlo. `habilitada: false` es respuesta válida, no error:
  // el front simplemente no renderiza la sección.
  if (!(await isVidrieraHabilitada())) {
    return res.json({ data: { habilitada: false, eventos: [] } })
  }

  const limitParam = Number(req.query.limit)
  const limit = Number.isFinite(limitParam) && limitParam > 0
    ? Math.min(Math.floor(limitParam), MAX_LIMIT)
    : DEFAULT_LIMIT
  const sqlFetchLimit = Math.min(limit * SQL_FETCH_MULTIPLIER, SQL_FETCH_CAP)

  const eventos = await prisma.$queryRaw<VidrieraEventoRow[]>`
    SELECT e.id, e.nombre, e.descripcion, e.lugar, e.ciudad, e.imagen_url, e.modo_fecha, e.activo,
      e.publication_mode, e.pre_publish_visibility, e.publish_at_utc, e.publish_timezone, e.published_live_at,
      ef_stats.proxima_fecha,
      ec_stats.precio_desde::float AS precio_desde,
      em.id AS empresa_id, em.slug AS empresa_slug, em.nombre AS empresa_nombre, em.logo_url AS empresa_logo_url
    FROM eventos e
    JOIN empresas em ON em.id = e.empresa_id
      AND em.activa = TRUE
      AND em.aprobada = TRUE
      AND COALESCE(em.email_verificado, TRUE) = TRUE
      AND COALESCE(em.es_prueba, FALSE) = FALSE
      AND COALESCE(em.suspendido, FALSE) = FALSE
      AND COALESCE(em.tenant_public_disabled, FALSE) = FALSE
      AND COALESCE(em.vidriera_disabled, FALSE) = FALSE
    JOIN (
      SELECT evento_id, MIN(fecha) AS proxima_fecha
      FROM evento_fechas
      GROUP BY evento_id
    ) ef_stats ON ef_stats.evento_id = e.id AND ef_stats.proxima_fecha >= NOW()
    LEFT JOIN (
      SELECT ec.evento_id,
        MIN(CASE WHEN ec.tanda_id IS NULL OR et2.estado = 'activa' THEN ec.precio END) AS precio_desde
      FROM entrada_categorias ec
      LEFT JOIN evento_tandas et2 ON et2.id = ec.tanda_id
      WHERE ec.activa = TRUE
      GROUP BY ec.evento_id
    ) ec_stats ON ec_stats.evento_id = e.id
    ORDER BY ef_stats.proxima_fecha ASC
    LIMIT ${sqlFetchLimit}
  `

  // is_listed depende de estado que SQL no puede calcular (scheduling, pre_publish_visibility),
  // por eso se recalcula acá. El corte a `limit` tiene que pasar DESPUÉS de este filtro:
  // si se cortara en SQL antes de saber cuáles son visibles, un evento oculto entre los
  // primeros N por fecha le comería el lugar a uno visible más atrás en la cola.
  const data = eventos
    .map((evento) => serializeVidrieraEvent(evento))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((evento: any) => evento.is_listed)
    .slice(0, limit)

  return res.json({ data: { habilitada: true, eventos: data } })
})

export default router
