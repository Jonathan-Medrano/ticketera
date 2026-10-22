import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ROLES_PREDEFINIDOS,
  PERMISOS_VACIOS,
  hasPermissionEscalation,
  listPermissionEscalations,
  normalizePermisos,
} from './lib/permisos'

// Pure unit tests (no DB) for the vertical-escalation comparison primitive used by
// the equipo guard. Runnable without Postgres: `node --import tsx --test src/permisos-escalation.test.ts`.

test('admin dominates non-admin roles (vendedor/operador/revendedor/barra) → no escalation', () => {
  for (const slug of ['vendedor', 'operador', 'revendedor', 'barra'] as const) {
    assert.equal(
      hasPermissionEscalation(ROLES_PREDEFINIDOS.admin, ROLES_PREDEFINIDOS[slug]),
      false,
      `admin should dominate ${slug}`
    )
  }
})

// DECISIÓN (opción A): `escanear` es una capacidad OPERATIVA, no autoridad sobre
// cuentas/la empresa → se excluye del cómputo de escalación (NON_AUTHORITY_PERMISOS
// en permisos.ts). Por eso `admin` SÍ domina a `puerta` y un admin-empleado puede
// gestionar (reset/desactivar/eliminar) al personal de puerta. Si en el futuro se
// reclasifica `escanear` como autoridad, este test rompe y obliga a re-decidir.
test('admin dominates puerta (escanear is an operational capability, excluded from escalation)', () => {
  assert.deepEqual(listPermissionEscalations(ROLES_PREDEFINIDOS.admin, ROLES_PREDEFINIDOS.puerta), [])
  assert.equal(hasPermissionEscalation(ROLES_PREDEFINIDOS.admin, ROLES_PREDEFINIDOS.puerta), false)
})

test('non-admin acting on admin IS escalation', () => {
  const actor = normalizePermisos({ ver_equipo: true, editar_equipo: true, eliminar_equipo: true })
  assert.equal(hasPermissionEscalation(actor, ROLES_PREDEFINIDOS.admin), true)
})

test('equal permissions → no escalation (admin can manage admin)', () => {
  assert.equal(hasPermissionEscalation(ROLES_PREDEFINIDOS.admin, ROLES_PREDEFINIDOS.admin), false)
})

test('false positive fixed: self-view permisos do NOT count as escalation', () => {
  // Revendedor solo tiene ver_comision_propia/ver_ganancia_propia. Un admin no los
  // tiene, pero igual debe poder gestionarlo: no son privilegios reales sobre terceros.
  assert.equal(hasPermissionEscalation(ROLES_PREDEFINIDOS.admin, ROLES_PREDEFINIDOS.revendedor), false)

  // Incluso un actor sin NINGÚN permiso no "escala" hacia un target que solo tiene self-view.
  assert.deepEqual(listPermissionEscalations(PERMISOS_VACIOS, ROLES_PREDEFINIDOS.revendedor), [])
})

test('a real privilege still counts even alongside self-view permisos', () => {
  const target = normalizePermisos({
    ver_comision_propia: true,
    ver_ganancia_propia: true,
    editar_configuracion: true,
  })
  const actor = normalizePermisos({ ver_equipo: true })
  assert.deepEqual(listPermissionEscalations(actor, target), ['editar_configuracion'])
})

test('undefined actor permisos is treated as no permissions (fail-closed friendly)', () => {
  assert.equal(hasPermissionEscalation(undefined, ROLES_PREDEFINIDOS.vendedor), true)
})
