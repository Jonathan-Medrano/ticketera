import { buildTenantPublicUrl, tenantRoutes } from "@/lib/tenant-routes"
import type { VidrieraEventoPublico } from "@/lib/vidriera"

// schema.org/Event por cada evento listado, para que Google pueda mostrar rich
// snippets (fecha/precio/lugar) en resultados de busqueda de la vidriera.
export default function VidrieraJsonLd({ eventos }: { eventos: VidrieraEventoPublico[] }) {
  if (eventos.length === 0) return null

  // Google exige name + startDate + location (Place con address) para que un Event
  // offline califique para rich results -- si falta lugar o fecha, mejor omitir el
  // evento del structured data que emitir un Event invalido/incompleto.
  const itemListElement = eventos
    .filter((evento) => evento.proxima_fecha && evento.lugar)
    .map((evento, index) => {
      const url = `${buildTenantPublicUrl(evento.empresa_slug)}${tenantRoutes.evento(evento.id)}`

      const event: Record<string, unknown> = {
        "@type": "Event",
        name: evento.nombre,
        url,
        startDate: evento.proxima_fecha,
        eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
        eventStatus: "https://schema.org/EventScheduled",
        location: {
          "@type": "Place",
          name: evento.lugar,
          address: evento.lugar,
        },
        organizer: {
          "@type": "Organization",
          name: evento.empresa_nombre,
          url: buildTenantPublicUrl(evento.empresa_slug),
        },
      }

      if (evento.descripcion) event.description = evento.descripcion
      if (evento.imagen_url) event.image = [evento.imagen_url]
      // No incluimos "availability": no tenemos stock en este payload y no queremos
      // afirmar InStock/SoldOut sin datos reales detras.
      if (evento.precio_desde != null) {
        event.offers = {
          "@type": "Offer",
          price: evento.precio_desde,
          priceCurrency: "ARS",
          url,
        }
      }

      return {
        "@type": "ListItem",
        position: index + 1,
        item: event,
      }
    })

  if (itemListElement.length === 0) return null

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    itemListElement,
  }

  // Escapamos "<" para que un nombre/descripcion con "</script>" (contenido cargado
  // por la empresa, no confiable) no pueda cerrar el tag y ejecutar HTML/JS arbitrario.
  const json = JSON.stringify(jsonLd).replace(/</g, "\\u003c")

  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger
      dangerouslySetInnerHTML={{ __html: json }}
    />
  )
}
