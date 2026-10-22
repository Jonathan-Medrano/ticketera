export type Permisos = {
  cambiar_password_compradores: boolean
  ingresar_como_comprador: boolean
  ver_dashboard: boolean
  ver_ingresos: boolean
  ver_eventos: boolean
  crear_eventos: boolean
  editar_eventos: boolean
  eliminar_eventos: boolean
  activar_eventos: boolean
  ver_recaudacion: boolean
  ver_entradas: boolean
  ver_precios_entradas: boolean
  ver_totales_entradas: boolean
  ver_compradores: boolean
  ver_montos_compradores: boolean
  ver_equipo: boolean
  crear_equipo: boolean
  editar_equipo: boolean
  eliminar_equipo: boolean
  ver_roles: boolean
  crear_roles: boolean
  editar_roles: boolean
  eliminar_roles: boolean
  escanear: boolean
  ver_configuracion: boolean
  editar_configuracion: boolean
  gestionar_revendedores: boolean
  // Permisos del propio revendedor
  ver_comision_propia: boolean
  ver_ganancia_propia: boolean
  // Consumibles
  ver_consumibles: boolean
  ver_totales_consumibles: boolean
  gestionar_consumibles: boolean
  gestionar_stock_barras: boolean
  gestionar_promociones: boolean
  vender_consumibles: boolean
  canjear_consumibles: boolean
  // Marketing
  ver_marketing: boolean
  gestionar_marketing: boolean   // legacy alias — implies all four sub-permisos below
  gestionar_codigos: boolean     // create/edit/delete promo codes
  gestionar_campanas: boolean    // create/edit/delete campaigns, segments, email config
  enviar_campanas: boolean       // trigger campaign sends (requires gestionar_campanas)
  gestionar_analitica: boolean   // edit GA4/Meta/GTM tracking + Google OAuth
  // Reconciliación / refunds automáticos
  gestionar_reembolsos: boolean
  // KPIs financieros por evento (ingresos netos, ticket promedio, ventas 7d)
  ver_kpis_eventos: boolean
  // Exportar datos a CSV desde cualquier sección
  exportar: boolean
  // Ver historial de actividad de cada miembro del equipo
  ver_actividad_equipo: boolean
}

export const PERMISOS_VACIOS: Permisos = {
  cambiar_password_compradores: false,
  ingresar_como_comprador: false,
  ver_dashboard: false,
  ver_ingresos: false,
  ver_eventos: false,
  crear_eventos: false,
  editar_eventos: false,
  eliminar_eventos: false,
  activar_eventos: false,
  ver_recaudacion: false,
  ver_entradas: false,
  ver_precios_entradas: false,
  ver_totales_entradas: false,
  ver_compradores: false,
  ver_montos_compradores: false,
  ver_equipo: false,
  crear_equipo: false,
  editar_equipo: false,
  eliminar_equipo: false,
  ver_roles: false,
  crear_roles: false,
  editar_roles: false,
  eliminar_roles: false,
  escanear: false,
  ver_configuracion: false,
  editar_configuracion: false,
  gestionar_revendedores: false,
  ver_comision_propia: false,
  ver_ganancia_propia: false,
  ver_consumibles: false,
  ver_totales_consumibles: false,
  gestionar_consumibles: false,
  gestionar_stock_barras: false,
  gestionar_promociones: false,
  vender_consumibles: false,
  canjear_consumibles: false,
  ver_marketing: false,
  gestionar_marketing: false,
  gestionar_codigos: false,
  gestionar_campanas: false,
  enviar_campanas: false,
  gestionar_analitica: false,
  gestionar_reembolsos: false,
  ver_kpis_eventos: false,
  exportar: false,
  ver_actividad_equipo: false,
}

/**
 * Checks whether an actor has a given permission.
 *
 * Semantics:
 *   - Non-employee (empresa / super_admin) → always allowed (no permission model applies).
 *   - Employee with undefined permisos → deny. Stale tokens that lost the permisos
 *     payload must not be treated as unrestricted. The caller should verify the user
 *     can reach the dashboard at all before invoking this.
 *   - Employee with a Permisos object (including an empty one {}) → check the key.
 *
 * This replaces the unsafe `!esEmpleado || !permisos || permisos[permiso]` pattern
 * that granted full access when an employee's session had permisos = undefined.
 */
export function puedeHacer(
  permiso: keyof Permisos,
  esEmpleado: boolean,
  permisos: Permisos | undefined,
): boolean {
  if (!esEmpleado) return true
  if (permisos == null) return false
  return permisos[permiso] === true
}

export function esRolRevendedor(permisos: Permisos | undefined): boolean {
  if (!permisos) return false
  return (
    !permisos.ver_dashboard &&
    !permisos.ver_eventos &&
    !permisos.ver_entradas &&
    !permisos.ver_compradores &&
    !permisos.ver_equipo &&
    !permisos.escanear &&
    !permisos.gestionar_revendedores &&
    !permisos.ver_configuracion &&
    (permisos.ver_comision_propia || permisos.ver_ganancia_propia)
  )
}

/**
 * Criterio único para "este empleado es un revendedor", usado en todos los
 * guards que deciden si mandarlo al portal /revendedor: proxy.ts,
 * dashboard-auth.ts, dashboard-ventas.ts, app/revendedor/layout.tsx y
 * app/revendedor/tickets-fisicos/page.tsx.
 *
 * Fuente de verdad: `empleadoRol` en DB. Fallback a la heurística de permisos
 * (`esRolRevendedor`) para sessions viejas emitidas antes de que existiera
 * `empleadoRol` en el JWT. Mantené estos call sites sincronizados con este
 * helper — divergir acá es exactamente el bug que causó que un revendedor
 * detectado solo por heurística pasara el guard del layout pero fuera
 * expulsado de una sub-página con un criterio más estricto.
 */
export function isRevendedor(
  user: { empleadoRol?: string | null; permisos?: Permisos | null } | null | undefined,
): boolean {
  if (!user) return false
  if (user.empleadoRol === "revendedor") return true
  return esRolRevendedor(user.permisos ?? undefined)
}

export const ROLES_PREDEFINIDOS: Record<string, Permisos> = {
  puerta: {
    ...PERMISOS_VACIOS,
    escanear: true,
  },
  vendedor: {
    ...PERMISOS_VACIOS,
    ver_dashboard: true,
    ver_eventos: true,
    ver_entradas: true,
    ver_compradores: true,
  },
  operador: {
    ...PERMISOS_VACIOS,
    ver_dashboard: true,
    ver_eventos: true,
    crear_eventos: true,
    editar_eventos: true,
    activar_eventos: true,
    ver_entradas: true,
    ver_precios_entradas: true,
    ver_totales_entradas: true,
    ver_compradores: true,
    ver_montos_compradores: true,
    exportar: true,
  },
  admin: {
    ...PERMISOS_VACIOS,
    ver_dashboard: true,
    ver_ingresos: true,
    ver_eventos: true,
    crear_eventos: true,
    editar_eventos: true,
    activar_eventos: true,
    eliminar_eventos: true,
    ver_recaudacion: true,
    ver_entradas: true,
    ver_precios_entradas: true,
    ver_totales_entradas: true,
    ver_compradores: true,
    ver_montos_compradores: true,
    ver_equipo: true,
    crear_equipo: true,
    editar_equipo: true,
    eliminar_equipo: true,
    ver_roles: true,
    crear_roles: true,
    editar_roles: true,
    eliminar_roles: true,
    gestionar_revendedores: true,
    ver_consumibles: true,
    ver_totales_consumibles: true,
    gestionar_consumibles: true,
    gestionar_stock_barras: true,
    gestionar_promociones: true,
    vender_consumibles: true,
    canjear_consumibles: true,
    gestionar_reembolsos: true,
    ver_kpis_eventos: true,
    ver_marketing: true,
    gestionar_marketing: true,
    gestionar_codigos: true,
    gestionar_campanas: true,
    enviar_campanas: true,
    gestionar_analitica: true,
    exportar: true,
    ver_actividad_equipo: true,
  },
  revendedor: {
    ...PERMISOS_VACIOS,
    ver_comision_propia: true,
    ver_ganancia_propia: true,
  },
  barra: {
    ...PERMISOS_VACIOS,
    ver_consumibles: true,
    ver_totales_consumibles: true,
    gestionar_stock_barras: true,
    vender_consumibles: true,
    canjear_consumibles: true,
  },
}
