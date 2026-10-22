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

const PERMISSION_DEPENDENCIES: Array<{ key: keyof Permisos; requires: keyof Permisos; label: string; requiresLabel: string }> = [
  { key: 'ver_ingresos', requires: 'ver_dashboard', label: 'ver_ingresos', requiresLabel: 'ver_dashboard' },
  { key: 'ver_recaudacion', requires: 'ver_dashboard', label: 'ver_recaudacion', requiresLabel: 'ver_dashboard' },
  { key: 'crear_eventos', requires: 'ver_eventos', label: 'crear_eventos', requiresLabel: 'ver_eventos' },
  { key: 'editar_eventos', requires: 'ver_eventos', label: 'editar_eventos', requiresLabel: 'ver_eventos' },
  { key: 'activar_eventos', requires: 'ver_eventos', label: 'activar_eventos', requiresLabel: 'ver_eventos' },
  { key: 'eliminar_eventos', requires: 'ver_eventos', label: 'eliminar_eventos', requiresLabel: 'ver_eventos' },
  { key: 'ver_precios_entradas', requires: 'ver_entradas', label: 'ver_precios_entradas', requiresLabel: 'ver_entradas' },
  { key: 'ver_totales_entradas', requires: 'ver_entradas', label: 'ver_totales_entradas', requiresLabel: 'ver_entradas' },
  { key: 'ver_montos_compradores', requires: 'ver_compradores', label: 'ver_montos_compradores', requiresLabel: 'ver_compradores' },
  { key: 'cambiar_password_compradores', requires: 'ver_compradores', label: 'cambiar_password_compradores', requiresLabel: 'ver_compradores' },
  { key: 'ingresar_como_comprador', requires: 'ver_compradores', label: 'ingresar_como_comprador', requiresLabel: 'ver_compradores' },
  { key: 'crear_equipo', requires: 'ver_equipo', label: 'crear_equipo', requiresLabel: 'ver_equipo' },
  { key: 'editar_equipo', requires: 'ver_equipo', label: 'editar_equipo', requiresLabel: 'ver_equipo' },
  { key: 'eliminar_equipo', requires: 'ver_equipo', label: 'eliminar_equipo', requiresLabel: 'ver_equipo' },
  { key: 'crear_roles', requires: 'ver_roles', label: 'crear_roles', requiresLabel: 'ver_roles' },
  { key: 'editar_roles', requires: 'ver_roles', label: 'editar_roles', requiresLabel: 'ver_roles' },
  { key: 'eliminar_roles', requires: 'ver_roles', label: 'eliminar_roles', requiresLabel: 'ver_roles' },
  { key: 'editar_configuracion', requires: 'ver_configuracion', label: 'editar_configuracion', requiresLabel: 'ver_configuracion' },
  { key: 'ver_totales_consumibles', requires: 'ver_consumibles', label: 'ver_totales_consumibles', requiresLabel: 'ver_consumibles' },
  { key: 'gestionar_consumibles', requires: 'ver_consumibles', label: 'gestionar_consumibles', requiresLabel: 'ver_consumibles' },
  { key: 'gestionar_stock_barras', requires: 'ver_consumibles', label: 'gestionar_stock_barras', requiresLabel: 'ver_consumibles' },
  { key: 'gestionar_promociones', requires: 'ver_consumibles', label: 'gestionar_promociones', requiresLabel: 'ver_consumibles' },
  { key: 'vender_consumibles', requires: 'ver_consumibles', label: 'vender_consumibles', requiresLabel: 'ver_consumibles' },
  { key: 'canjear_consumibles', requires: 'ver_consumibles', label: 'canjear_consumibles', requiresLabel: 'ver_consumibles' },
  { key: 'gestionar_reembolsos', requires: 'ver_recaudacion', label: 'gestionar_reembolsos', requiresLabel: 'ver_recaudacion' },
  { key: 'ver_kpis_eventos', requires: 'ver_eventos', label: 'Ver KPIs financieros', requiresLabel: 'ver_eventos' },
  { key: 'gestionar_marketing', requires: 'ver_marketing', label: 'gestionar_marketing', requiresLabel: 'ver_marketing' },
  { key: 'gestionar_codigos', requires: 'ver_marketing', label: 'gestionar_codigos', requiresLabel: 'ver_marketing' },
  { key: 'gestionar_campanas', requires: 'ver_marketing', label: 'gestionar_campanas', requiresLabel: 'ver_marketing' },
  { key: 'enviar_campanas', requires: 'gestionar_campanas', label: 'enviar_campanas', requiresLabel: 'gestionar_campanas' },
  { key: 'gestionar_analitica', requires: 'ver_marketing', label: 'gestionar_analitica', requiresLabel: 'ver_marketing' },
  { key: 'ver_actividad_equipo', requires: 'ver_equipo', label: 'ver_actividad_equipo', requiresLabel: 'ver_equipo' },
]

export function normalizePermisos(input: unknown): Permisos {
  const normalized = { ...PERMISOS_VACIOS }

  if (!input || typeof input !== 'object') {
    return normalized
  }

  for (const key of Object.keys(PERMISOS_VACIOS) as (keyof Permisos)[]) {
    normalized[key] = (input as Record<string, unknown>)[key] === true
  }

  // Backward compat: gestionar_marketing (legacy) implies all four sub-permisos.
  // Tokens and roles saved before the split always had gestionar_marketing; promote
  // them on every read so route guards that now check the specific sub-permiso still work.
  if (normalized.gestionar_marketing) {
    normalized.gestionar_codigos = true
    normalized.gestionar_campanas = true
    normalized.enviar_campanas = true
    normalized.gestionar_analitica = true
  }

  return normalized
}

export function validateRolePermisos(
  input: unknown,
  options?: { allowEmpty?: boolean }
): { ok: true; data: Permisos } | { ok: false; error: string } {
  const normalized = normalizePermisos(input)
  const activeCount = (Object.keys(normalized) as (keyof Permisos)[]).filter((key) => normalized[key]).length

  // allowEmpty: roles (templates) requieren ≥ 1 permiso porque sino son inútiles
  // como template. Pero un USUARIO individual puede tener 0 permisos (ej.
  // revendedor que no necesita ver comisión ni ganancia propia).
  if (activeCount === 0 && !options?.allowEmpty) {
    return { ok: false, error: 'Debés seleccionar al menos un permiso para crear o editar el rol' }
  }

  for (const dependency of PERMISSION_DEPENDENCIES) {
    if (normalized[dependency.key] && !normalized[dependency.requires]) {
      return {
        ok: false,
        error: `El permiso ${dependency.label} requiere ${dependency.requiresLabel}`,
      }
    }
  }

  return { ok: true, data: normalized }
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

// Permisos de AUTO-consulta del propio revendedor (ver SU comisión / SU ganancia).
// NO son privilegios reales sobre la empresa ni sobre terceros: solo dejan que el
// revendedor mire sus propios números. Por eso NO deben contar como "escalación":
// si los contáramos, un admin (que no los tiene) no podría crear/gestionar
// revendedores ni actuar sobre ellos, lo cual es un falso positivo. Se excluyen de
// forma centralizada acá para que TODO el cómputo de escalación (otorgar roles en
// POST/PATCH de equipo/roles y el nuevo guard "actuar sobre un principal") sea
// consistente.
//
// `escanear` se incluye por el mismo motivo: es una capacidad OPERATIVA de puerta,
// no autoridad sobre cuentas ni sobre la empresa (gestionar a un usuario no te
// otorga escanear). Sin esto, un admin-empleado —que no tiene `escanear`— no
// podría gestionar al personal de `puerta`. OJO: `editar_configuracion` e
// `ingresar_como_comprador` SÍ son autoridad real → NO van acá.
const NON_AUTHORITY_PERMISOS: ReadonlyArray<keyof Permisos> = ['ver_comision_propia', 'ver_ganancia_propia', 'escanear']

export function listPermissionEscalations(actorPermisos: Permisos | undefined, targetPermisos: Permisos) {
  const actor = actorPermisos ?? PERMISOS_VACIOS
  return (Object.keys(targetPermisos) as (keyof Permisos)[]).filter(
    (key) => !NON_AUTHORITY_PERMISOS.includes(key) && targetPermisos[key] === true && actor[key] !== true
  )
}

export function hasPermissionEscalation(actorPermisos: Permisos | undefined, targetPermisos: Permisos) {
  return listPermissionEscalations(actorPermisos, targetPermisos).length > 0
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
