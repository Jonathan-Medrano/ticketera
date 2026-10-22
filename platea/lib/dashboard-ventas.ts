import { isRevendedor, type Permisos } from "@/lib/permisos"
import type { DashboardVentasTab } from "@/lib/dashboard-query-scope"

export function getVisibleVentasTabs({
  esEmpleado,
  permisos,
}: {
  esEmpleado: boolean
  permisos?: Permisos
}): DashboardVentasTab[] {
  if (!esEmpleado) return ["entradas", "consumibles"]

  const tabs: DashboardVentasTab[] = []
  if (permisos?.ver_entradas) tabs.push("entradas")
  if (permisos?.ver_consumibles) tabs.push("consumibles")
  return tabs
}

export function getDefaultVentasTab(args: { esEmpleado: boolean; permisos?: Permisos }) {
  return getVisibleVentasTabs(args)[0] ?? null
}

export function buildDashboardVentasPath(tab?: DashboardVentasTab | null) {
  if (!tab) return "/dashboard/ventas"
  return `/dashboard/ventas?tab=${tab}`
}

export function getDashboardFirstAccessiblePath({
  esEmpleado,
  permisos,
  empleadoRol,
}: {
  esEmpleado: boolean
  permisos?: Permisos
  empleadoRol?: string | null
}) {
  if (!esEmpleado) return "/dashboard"
  // Defensa: si el empleado es revendedor (por DB o heurística), su home es
  // /revendedor, no /sin-acceso. Esto se dispara cuando la página de /dashboard
  // se renderiza con un revendedor (caso edge mustChangePassword=true).
  if (isRevendedor({ empleadoRol, permisos })) return "/revendedor"
  if (permisos?.escanear) return "/dashboard/escanear"
  if (permisos?.ver_eventos) return "/dashboard/eventos"

  const ventasTab = getDefaultVentasTab({ esEmpleado, permisos })
  if (ventasTab) return buildDashboardVentasPath(ventasTab)

  if (permisos?.ver_compradores) return "/dashboard/compradores"
  if (permisos?.ver_equipo) return "/dashboard/equipo"
  return "/sin-acceso"
}

export function canAccessVentasNav({
  userType,
  permisos,
}: {
  userType?: string
  permisos?: Permisos
}) {
  return getVisibleVentasTabs({
    esEmpleado: userType === "empleado",
    permisos,
  }).length > 0
}
