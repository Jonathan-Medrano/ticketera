// Helper compartido de estado de publicación de eventos (dashboard).
// Antes vivía solo en evento-detalle-content.tsx; se extrae acá para poder
// reusarlo en eventos-content.tsx (listado) sin acoplar el bundle del listado
// al detalle completo del evento (charts, tabs, addons, etc).

export type PublicationStatus = "hidden" | "listed" | "live"

/** Copy legible del estado de publicación real del evento (independiente de `activo`). */
export function getPublicationStatusLabel(status: PublicationStatus) {
  switch (status) {
    case "live":
      return "En vivo"
    case "listed":
      return "Listado solo"
    case "hidden":
    default:
      return "Oculto"
  }
}
