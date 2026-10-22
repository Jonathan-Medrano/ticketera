// Victoria — apertura contextual: mapa de ruta del dashboard → id de tema.
//
// Al abrir el panel, si la ruta actual tiene un tema asociado, Victoria lo
// propone primero ("Veo que estás en X…") además de las sugerencias generales.
// La resolución es por PREFIJO MÁS LARGO, así /dashboard/consumibles/vender gana
// sobre /dashboard/consumibles. El Inicio (/dashboard exacto) NO tiene tema: ahí
// Victoria muestra el saludo general, no un nudge contextual de una sección.

import { TOPIC_BY_ID, type Topic } from "./knowledge"

const DASHBOARD_ROOT = "/dashboard"

/** Ruta canónica del dashboard → id de tema de la KB. */
export const ROUTE_TOPIC: Record<string, string> = {
  "/dashboard/ventas": "ventas",
  "/dashboard/eventos": "crear-evento",
  "/dashboard/eventos/nuevo": "crear-evento",
  "/dashboard/sitio-venta": "sitio-venta",
  "/dashboard/cobros": "cobros",
  "/dashboard/comisiones": "comisiones",
  "/dashboard/consumibles": "consumibles-setup",
  "/dashboard/consumibles/vender": "barra",
  "/dashboard/barras": "consumibles-setup",
  "/dashboard/escanear": "escanear",
  "/dashboard/equipo": "equipo",
  "/dashboard/roles": "roles",
  "/dashboard/reembolsos": "reembolsos",
  "/dashboard/compradores": "compradores",
  "/dashboard/configuracion": "configuracion",
  "/dashboard/pos": "pos",
  "/dashboard/marketing": "marketing",
  "/dashboard/reconciliacion": "reconciliacion",
  "/dashboard/revendedores": "revendedores",
  "/revendedor": "mi-panel-revendedor",
  "/revendedor/tickets-fisicos": "tickets-fisicos",
}

// Precalculado: claves ordenadas de más larga a más corta (longest-prefix-wins).
const SORTED_ROUTE_KEYS = Object.keys(ROUTE_TOPIC).sort((a, b) => b.length - a.length)

/**
 * Devuelve el tema asociado a la ruta actual, o `null` si no hay ninguno.
 * El Inicio (`/dashboard` exacto) devuelve null → saludo general. El guard de
 * DASHBOARD_ROOT evita que cualquier clave raíz capture subrutas por prefijo.
 */
export function topicForPath(pathname: string | null | undefined): Topic | null {
  if (!pathname) return null
  for (const key of SORTED_ROUTE_KEYS) {
    const matches =
      pathname === key ||
      (key !== DASHBOARD_ROOT && pathname.startsWith(key + "/"))
    if (matches) {
      const topic = TOPIC_BY_ID[ROUTE_TOPIC[key]]
      if (topic) return topic
    }
  }
  return null
}
