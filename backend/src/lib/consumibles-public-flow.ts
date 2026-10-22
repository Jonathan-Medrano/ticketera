import { prisma } from './prisma'
import { buildEventPublicationSnapshot, type EventPublicationSource } from './event-publication'

export type TenantConsumiblePublicBar = {
  id: string
  nombre: string
  buyer_consumible_refunds_enabled: boolean
  items: Array<{
    consumible_id: string
    nombre: string
    descripcion: string | null
    imagen_url: string | null
    precio: number
    stock_actual: number
    stock_ilimitado: boolean
    agotado: boolean
  }>
}

export async function getTenantConsumiblesCatalog(slug: string, eventoId: string): Promise<TenantConsumiblePublicBar[] | null> {
  type EventoRow = { id: string; empresa_id: string; venta_consumibles_habilitada: boolean } & EventPublicationSource

  const eventoRows = await prisma.$queryRaw<EventoRow[]>`
    SELECT e.id, e.empresa_id, e.activo,
           e.venta_consumibles_habilitada::int AS venta_consumibles_habilitada,
           e.publication_mode, e.pre_publish_visibility, e.publish_at_utc, e.publish_timezone, e.published_live_at
    FROM eventos e
    JOIN empresas emp ON emp.id = e.empresa_id
    WHERE e.id = ${eventoId}
      AND emp.slug = ${slug}
      AND emp.activa = true
      AND COALESCE(emp.tenant_public_disabled, false) = false
    LIMIT 1
  `

  const evento = eventoRows[0]
  if (!evento) return null
  const publication = buildEventPublicationSnapshot(evento as unknown as EventPublicationSource & { activo: unknown })
  if (!publication.is_detail_visible) return null
  if (Number(evento.venta_consumibles_habilitada) !== 1) return []

  type CatalogRow = {
    barra_id: string
    barra_nombre: string
    barra_buyer_consumible_refunds_enabled: boolean
    consumible_id: string
    consumible_nombre: string
    consumible_descripcion: string | null
    consumible_imagen_url: string | null
    precio: number
    stock_actual: number
    stock_ilimitado: boolean
    agotado: boolean
  }

  const rows = await prisma.$queryRaw<CatalogRow[]>`
    SELECT
      b.id AS barra_id,
      b.nombre AS barra_nombre,
      COALESCE(b.buyer_consumible_refunds_enabled, true) AS barra_buyer_consumible_refunds_enabled,
      c.id AS consumible_id,
      c.nombre AS consumible_nombre,
      c.descripcion AS consumible_descripcion,
      c.imagen_url AS consumible_imagen_url,
      COALESCE(bs.precio_override, c.precio) AS precio,
      bs.stock_actual,
      bs.stock_ilimitado,
      bs.agotado
    FROM barras b
    JOIN barra_stock bs ON bs.barra_id = b.id
    JOIN consumibles c ON c.id = bs.consumible_id
    WHERE b.evento_id = ${eventoId}
      AND b.empresa_id = ${evento.empresa_id}
      AND b.activa = true
      AND bs.activo = true
      AND c.activo = true
      AND (bs.stock_actual > 0 OR bs.stock_ilimitado = true) AND bs.agotado = false
    ORDER BY b.nombre ASC, c.nombre ASC
  `

  const grouped = new Map<string, TenantConsumiblePublicBar>()

  for (const row of rows) {
    const barraId = String(row.barra_id)
    const current = grouped.get(barraId) ?? {
      id: barraId,
      nombre: String(row.barra_nombre),
      buyer_consumible_refunds_enabled: Boolean(row.barra_buyer_consumible_refunds_enabled),
      items: [],
    }

    current.items.push({
      consumible_id: String(row.consumible_id),
      nombre: String(row.consumible_nombre),
      descripcion: row.consumible_descripcion ? String(row.consumible_descripcion) : null,
      imagen_url: row.consumible_imagen_url ? String(row.consumible_imagen_url) : null,
      precio: Number(row.precio),
      stock_actual: Number(row.stock_actual),
      stock_ilimitado: Boolean(row.stock_ilimitado),
      agotado: Boolean(row.agotado),
    })

    grouped.set(barraId, current)
  }

  return Array.from(grouped.values())
}
