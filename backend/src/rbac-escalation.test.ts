import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import type { AddressInfo } from 'node:net'
import express from 'express'
import pool from './db'
import rolesRouter from './routes/roles'
import equipoRouter from './routes/equipo'
import { ROLES_PREDEFINIDOS } from './lib/permisos'

process.env.INTERNAL_API_SECRET = process.env.INTERNAL_API_SECRET || 'test-internal-secret'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'
const originalFetch = globalThis.fetch

function buildHeaders(user: Record<string, unknown> | null = null) {
  return {
    'content-type': 'application/json',
    'x-internal-secret': process.env.INTERNAL_API_SECRET!,
    'x-user': JSON.stringify(user),
  }
}

function buildEmpleadoUser(userId: string, empresaId: string, email: string, permisos: Record<string, boolean>) {
  return {
    id: userId,
    email,
    empresa_id: empresaId,
    userType: 'empleado' as const,
    permisos,
  }
}

async function createTestServer(app: express.Express) {
  const server = await new Promise<import('node:http').Server>((resolve) => {
    const instance = app.listen(0, () => resolve(instance))
  })

  const address = server.address() as AddressInfo
  const baseUrl = `http://127.0.0.1:${address.port}`

  return {
    baseUrl,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
    },
  }
}

async function requestJson(method: 'POST' | 'PATCH' | 'DELETE', url: string, user: Record<string, unknown> | null, body: unknown) {
  const response = await originalFetch(url, {
    method,
    headers: buildHeaders(user),
    body: body === undefined ? undefined : JSON.stringify(body),
  })

  const data: any = await response.json().catch(() => null)
  return { status: response.status, data }
}

async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS roles (
      id varchar(36) NOT NULL,
      empresa_id varchar(36) NOT NULL,
      nombre varchar(100) NOT NULL,
      slug varchar(50) NOT NULL,
      permisos text DEFAULT NULL,
      es_predefinido boolean DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (id),
      UNIQUE (empresa_id, slug)
    )
  `)
}

async function cleanup() {
  await pool.query(`DELETE FROM usuarios WHERE id LIKE 'phase-rbac-usr-%' OR empresa_id LIKE 'phase-rbac-emp-%'`)
  await pool.query(`DELETE FROM roles WHERE empresa_id LIKE 'phase-rbac-emp-%'`)
  await pool.query(`DELETE FROM empresas WHERE id LIKE 'phase-rbac-emp-%' OR slug LIKE 'phase-rbac-%'`)
}

async function seedEmpresa(empresaId: string, slug: string) {
  await pool.query(
    `INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
     VALUES (?, ?, ?, ?, ?, ?, true)`,
    [empresaId, `Empresa ${slug}`, slug, `${slug}@example.com`, TEST_PASSWORD_HASH, `Admin ${slug}`]
  )
}

async function seedEmpleado({
  userId,
  empresaId,
  email,
  permisos,
  rol = 'operador',
  porcentajeComision = null,
}: {
  userId: string
  empresaId: string
  email: string
  permisos: Record<string, boolean> | null
  rol?: string
  porcentajeComision?: number | null
}) {
  await pool.query(
    `INSERT INTO usuarios (id, empresa_id, nombre, apellido, email, password, rol, activo, permisos, porcentaje_comision)
     VALUES (?, ?, ?, ?, ?, ?, ?, true, ?, ?)`,
    [
      userId,
      empresaId,
      'Empleado',
      'RBAC',
      email,
      TEST_PASSWORD_HASH,
      rol,
      permisos === null ? null : JSON.stringify(permisos),
      porcentajeComision,
    ]
  )
}

async function getUsuarioRow(userId: string) {
  const [rows] = await pool.query<Array<{ activo: boolean; password: string; porcentaje_comision: number | null }>>(
    `SELECT activo, password, porcentaje_comision FROM usuarios WHERE id = ?`,
    [userId]
  )
  return rows[0] ?? null
}

beforeEach(async () => {
  await ensureSchema()
  await cleanup()
})

after(async () => {
  await ensureSchema()
  await cleanup()
  await pool.end()
})

test('employee cannot create role with permissions above own ceiling', async () => {
  const empresaId = 'phase-rbac-emp-1'
  const slug = 'phase-rbac-1'
  const empleadoId = 'phase-rbac-usr-1'
  const email = 'phase-rbac-usr-1@example.com'
  await seedEmpresa(empresaId, slug)
  await seedEmpleado({
    userId: empleadoId,
    empresaId,
    email,
    permisos: { ver_roles: true, crear_roles: true },
  })

  const app = express()
  app.use(express.json())
  app.use('/api/roles', rolesRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson('POST', `${server.baseUrl}/api/roles`, buildEmpleadoUser(empleadoId, empresaId, email, { ver_roles: true, crear_roles: true }), {
      nombre: 'Escalada total',
      permisos: {
        ver_roles: true,
        crear_roles: true,
        ver_configuracion: true,
        editar_configuracion: true,
      },
    })

    assert.equal(response.status, 403)
    assert.equal(response.data.error, 'No podés crear roles con permisos superiores a los tuyos')
  } finally {
    await server.close()
  }
})

test('employee cannot edit predefined roles', async () => {
  const empresaId = 'phase-rbac-emp-2'
  const slug = 'phase-rbac-2'
  const empleadoId = 'phase-rbac-usr-2'
  const email = 'phase-rbac-usr-2@example.com'
  await seedEmpresa(empresaId, slug)
  await seedEmpleado({
    userId: empleadoId,
    empresaId,
    email,
    permisos: { ver_roles: true, editar_roles: true },
  })

  await pool.query(
    `INSERT INTO roles (id, empresa_id, nombre, slug, permisos, es_predefinido)
     VALUES (?, ?, ?, ?, ?, true)`,
    ['phase-rbac-role-admin', empresaId, 'Admin', 'admin', JSON.stringify(ROLES_PREDEFINIDOS.admin)]
  )

  const app = express()
  app.use(express.json())
  app.use('/api/roles', rolesRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson('PATCH', `${server.baseUrl}/api/roles/phase-rbac-role-admin`, buildEmpleadoUser(empleadoId, empresaId, email, { ver_roles: true, editar_roles: true }), {
      nombre: 'Admin tocado',
    })

    assert.equal(response.status, 403)
    assert.equal(response.data.error, 'No podés editar roles predefinidos')
  } finally {
    await server.close()
  }
})

test('employee cannot create team member with privileged role assignment', async () => {
  const empresaId = 'phase-rbac-emp-3'
  const slug = 'phase-rbac-3'
  const empleadoId = 'phase-rbac-usr-3'
  const email = 'phase-rbac-usr-3@example.com'
  await seedEmpresa(empresaId, slug)
  await seedEmpleado({
    userId: empleadoId,
    empresaId,
    email,
    permisos: { ver_equipo: true, crear_equipo: true },
  })

  await pool.query(
    `INSERT INTO roles (id, empresa_id, nombre, slug, permisos, es_predefinido)
     VALUES (?, ?, ?, ?, ?, false)`,
    ['phase-rbac-role-priv', empresaId, 'Privilegiado', 'privilegiado', JSON.stringify({ ver_dashboard: true, editar_configuracion: true })]
  )

  const app = express()
  app.use(express.json())
  app.use('/api/equipo', equipoRouter)
  const server = await createTestServer(app)

  try {
    const response = await requestJson('POST', `${server.baseUrl}/api/equipo`, buildEmpleadoUser(empleadoId, empresaId, email, { ver_equipo: true, crear_equipo: true }), {
      nombre: 'Nuevo',
      apellido: 'Priv',
      email: 'nuevo-priv@example.com',
      password: 'super-secret-123',
      rol: 'privilegiado',
    })

    assert.equal(response.status, 403)
    assert.equal(response.data.error, 'No tenés permiso para asignar ese rol')
  } finally {
    await server.close()
  }
})

// ---------------------------------------------------------------------------
// Anti-escalación vertical: actuar sobre un principal MÁS privilegiado.
// Atacante = empleado con editar_equipo/eliminar_equipo pero SIN el resto de
// permisos de admin. Objetivo = admin (rol predefinido, permisos heredados).
// ---------------------------------------------------------------------------

const ATTACKER_PERMISOS = {
  ver_equipo: true,
  editar_equipo: true,
  eliminar_equipo: true,
  gestionar_revendedores: true,
}

async function setupEscalationScenario(suffix: string) {
  const empresaId = `phase-rbac-emp-${suffix}`
  const slug = `phase-rbac-${suffix}`
  const attackerId = `phase-rbac-usr-att-${suffix}`
  const attackerEmail = `phase-rbac-att-${suffix}@example.com`
  const adminId = `phase-rbac-usr-adm-${suffix}`
  const adminEmail = `phase-rbac-adm-${suffix}@example.com`

  await seedEmpresa(empresaId, slug)
  await seedEmpleado({
    userId: attackerId,
    empresaId,
    email: attackerEmail,
    permisos: ATTACKER_PERMISOS,
    rol: 'operador',
  })
  // Target admin: permisos NULL → hereda ROLES_PREDEFINIDOS.admin (ejercita el fallback por rol).
  await seedEmpleado({
    userId: adminId,
    empresaId,
    email: adminEmail,
    permisos: null,
    rol: 'admin',
  })

  return { empresaId, attackerId, attackerEmail, adminId, adminEmail }
}

function makeEquipoServer() {
  const app = express()
  app.use(express.json())
  app.use('/api/equipo', equipoRouter)
  return createTestServer(app)
}

test('employee with editar_equipo cannot reset password of a more-privileged admin', async () => {
  const { empresaId, attackerId, attackerEmail, adminId } = await setupEscalationScenario('pw')
  const before = await getUsuarioRow(adminId)
  const server = await makeEquipoServer()

  try {
    const response = await requestJson(
      'PATCH',
      `${server.baseUrl}/api/equipo/${adminId}/password`,
      buildEmpleadoUser(attackerId, empresaId, attackerEmail, ATTACKER_PERMISOS),
      { newPassword: 'attacker-chosen-pass-123' }
    )

    assert.equal(response.status, 403)
    assert.equal(response.data.error, 'No podés actuar sobre un usuario con más permisos que vos')

    // La cuenta admin queda intacta (mismo hash de password).
    const after = await getUsuarioRow(adminId)
    assert.equal(after?.password, before?.password)
  } finally {
    await server.close()
  }
})

test('employee with editar_equipo cannot deactivate a more-privileged admin', async () => {
  const { empresaId, attackerId, attackerEmail, adminId } = await setupEscalationScenario('act')
  const server = await makeEquipoServer()

  try {
    const response = await requestJson(
      'PATCH',
      `${server.baseUrl}/api/equipo/${adminId}`,
      buildEmpleadoUser(attackerId, empresaId, attackerEmail, ATTACKER_PERMISOS),
      { activo: false }
    )

    assert.equal(response.status, 403)
    assert.equal(response.data.error, 'No podés actuar sobre un usuario con más permisos que vos')

    const after = await getUsuarioRow(adminId)
    assert.equal(after?.activo, true)
  } finally {
    await server.close()
  }
})

test('employee with eliminar_equipo cannot delete a more-privileged admin', async () => {
  const { empresaId, attackerId, attackerEmail, adminId } = await setupEscalationScenario('del')
  const server = await makeEquipoServer()

  try {
    const response = await requestJson(
      'DELETE',
      `${server.baseUrl}/api/equipo/${adminId}`,
      buildEmpleadoUser(attackerId, empresaId, attackerEmail, ATTACKER_PERMISOS),
      undefined
    )

    assert.equal(response.status, 403)
    assert.equal(response.data.error, 'No podés actuar sobre un usuario con más permisos que vos')

    const after = await getUsuarioRow(adminId)
    assert.notEqual(after, null)
  } finally {
    await server.close()
  }
})

// Regresión (MEDIO): el target hereda permisos del rol resuelto desde la TABLA `roles`
// (que el dueño puede customizar), NO del hardcodeo ROLES_PREDEFINIDOS. Un target
// `rol='vendedor'` con `permisos` NULL pero cuyo rol `vendedor` fue customizado en la
// tabla para incluir `editar_configuracion` (autoridad) debe quedar PROTEGIDO frente a
// un atacante `editar_equipo` que NO tiene ese permiso. Con el bug previo (mirar el
// hardcodeo) el guard SUBESTIMABA al target y dejaba pasar el reset → 200; ahora 403.
test('employee cannot reset password of a target whose CUSTOMIZED role (from roles table) outranks them', async () => {
  const empresaId = 'phase-rbac-emp-customrole'
  const slug = 'phase-rbac-customrole'
  const attackerId = 'phase-rbac-usr-att-customrole'
  const attackerEmail = 'phase-rbac-att-customrole@example.com'
  const targetId = 'phase-rbac-usr-tgt-customrole'

  await seedEmpresa(empresaId, slug)
  await seedEmpleado({
    userId: attackerId,
    empresaId,
    email: attackerEmail,
    permisos: ATTACKER_PERMISOS,
    rol: 'operador',
  })
  // Target con permisos NULL → hereda del rol `vendedor` resuelto desde la tabla.
  await seedEmpleado({
    userId: targetId,
    empresaId,
    email: 'phase-rbac-tgt-customrole@example.com',
    permisos: null,
    rol: 'vendedor',
  })
  // El DUEÑO customizó el rol predefinido `vendedor` agregándole autoridad real.
  await pool.query(
    `INSERT INTO roles (id, empresa_id, nombre, slug, permisos, es_predefinido)
     VALUES (?, ?, ?, ?, ?, true)`,
    [
      'phase-rbac-role-vendedor-custom',
      empresaId,
      'Vendedor',
      'vendedor',
      JSON.stringify({
        ...ROLES_PREDEFINIDOS.vendedor,
        ver_configuracion: true,
        editar_configuracion: true,
      }),
    ]
  )

  const before = await getUsuarioRow(targetId)
  const server = await makeEquipoServer()

  try {
    const response = await requestJson(
      'PATCH',
      `${server.baseUrl}/api/equipo/${targetId}/password`,
      buildEmpleadoUser(attackerId, empresaId, attackerEmail, ATTACKER_PERMISOS),
      { newPassword: 'attacker-chosen-pass-123' }
    )

    assert.equal(response.status, 403)
    assert.equal(response.data.error, 'No podés actuar sobre un usuario con más permisos que vos')

    const after = await getUsuarioRow(targetId)
    assert.equal(after?.password, before?.password)
  } finally {
    await server.close()
  }
})

test('admin employee CAN deactivate a non-admin member (legit flow not broken)', async () => {
  const empresaId = 'phase-rbac-emp-okact'
  const slug = 'phase-rbac-okact'
  const adminActorId = 'phase-rbac-usr-adm-okact'
  const adminActorEmail = 'phase-rbac-adm-okact@example.com'
  const targetId = 'phase-rbac-usr-vend-okact'

  await seedEmpresa(empresaId, slug)
  await seedEmpleado({ userId: adminActorId, empresaId, email: adminActorEmail, permisos: ROLES_PREDEFINIDOS.admin, rol: 'admin' })
  await seedEmpleado({ userId: targetId, empresaId, email: 'phase-rbac-vend-okact@example.com', permisos: null, rol: 'vendedor' })

  const server = await makeEquipoServer()

  try {
    const response = await requestJson(
      'PATCH',
      `${server.baseUrl}/api/equipo/${targetId}`,
      buildEmpleadoUser(adminActorId, empresaId, adminActorEmail, ROLES_PREDEFINIDOS.admin),
      { activo: false }
    )

    assert.equal(response.status, 200)
    const after = await getUsuarioRow(targetId)
    assert.equal(after?.activo, false)
  } finally {
    await server.close()
  }
})

test('employee cannot edit their OWN porcentaje_comision', async () => {
  const empresaId = 'phase-rbac-emp-selfcom'
  const slug = 'phase-rbac-selfcom'
  const selfId = 'phase-rbac-usr-selfcom'
  const selfEmail = 'phase-rbac-selfcom@example.com'

  await seedEmpresa(empresaId, slug)
  // Empleado revendedor con editar_equipo (rol custom hostil) y comisión 10%.
  await seedEmpleado({
    userId: selfId,
    empresaId,
    email: selfEmail,
    permisos: { ver_equipo: true, editar_equipo: true, gestionar_revendedores: true },
    rol: 'revendedor',
    porcentajeComision: 10,
  })

  const server = await makeEquipoServer()

  try {
    const response = await requestJson(
      'PATCH',
      `${server.baseUrl}/api/equipo/${selfId}`,
      buildEmpleadoUser(selfId, empresaId, selfEmail, { ver_equipo: true, editar_equipo: true, gestionar_revendedores: true }),
      { porcentaje_comision: 90 }
    )

    assert.equal(response.status, 403)
    assert.equal(response.data.error, 'No podés editar tu propia comisión')

    const after = await getUsuarioRow(selfId)
    assert.equal(Number(after?.porcentaje_comision), 10)
  } finally {
    await server.close()
  }
})

test('admin employee CAN create a revendedor (self-view false positive fixed)', async () => {
  const empresaId = 'phase-rbac-emp-rev'
  const slug = 'phase-rbac-rev'
  const adminActorId = 'phase-rbac-usr-adm-rev'
  const adminActorEmail = 'phase-rbac-adm-rev@example.com'

  await seedEmpresa(empresaId, slug)
  await seedEmpleado({ userId: adminActorId, empresaId, email: adminActorEmail, permisos: ROLES_PREDEFINIDOS.admin, rol: 'admin' })

  const server = await makeEquipoServer()

  try {
    const response = await requestJson(
      'POST',
      `${server.baseUrl}/api/equipo`,
      buildEmpleadoUser(adminActorId, empresaId, adminActorEmail, ROLES_PREDEFINIDOS.admin),
      {
        nombre: 'Reven',
        apellido: 'Dedor',
        email: 'phase-rbac-nuevo-rev@example.com',
        password: 'super-secret-123',
        rol: 'revendedor',
      }
    )

    // Antes del fix devolvía 403 ('No tenés permiso para asignar ese rol') porque
    // ver_comision_propia/ver_ganancia_propia se contaban como escalación.
    assert.equal(response.status, 201)
    assert.equal(response.data.ok, true)
  } finally {
    await server.close()
  }
})
