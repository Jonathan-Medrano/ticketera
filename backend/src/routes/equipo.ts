import { Router, Request, Response } from 'express'
import { verifyInternal, requireAuth } from '../middleware/auth'
import { prisma } from '../lib/prisma'
import { randomUUID as uuidv4 } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { assertInternalEmailAvailable } from '../lib/internal-email'
import { ensureIdentityConstraints } from '../lib/identity-constraints'
import { ROLES_PREDEFINIDOS, esRolRevendedor, hasPermissionEscalation, normalizePermisos, validateRolePermisos, type Permisos } from '../lib/permisos'
import { getActorEmpresaId, requirePermission, requirePermissionMiddleware } from '../lib/authz'
import { logServerError } from '../lib/safe-log'
import { actorFromRequest, logAuditEvent } from '../lib/audit-log'
import { logEmpleadoActividad } from '../lib/empleado-actividad'
import { touchPasswordVersion } from '../lib/password-version'
import type { SessionUser } from '../types'

const router = Router()

// Resuelve los permisos EFECTIVOS de un usuario objetivo, desde la MISMA fuente que
// usa el runtime para hidratar la sesión (ver authz.rehydrateSessionUser):
// - si el target tiene permisos custom serializados (columna `permisos`), esos mandan;
// - si no, hereda del ROL resuelto desde la tabla `roles` por (empresa_id, slug) —NO
//   del hardcodeo ROLES_PREDEFINIDOS—, porque el dueño puede customizar incluso los
//   roles predefinidos vía PATCH /roles/:id. Leer el hardcodeo SUBESTIMARÍA al target
//   y dejaría pasar el guard a un atacante;
// - sólo si NO existe la fila del rol (seeding aún no corrió) caemos a ROLES_PREDEFINIDOS.
// `empresaId` SIEMPRE viene de la sesión del actor (multi-tenant), nunca del body.
// Devuelve `null` cuando NO se pueden determinar (permisos corruptos o rol
// desconocido / custom sin fila) → el llamador debe FAIL-CLOSED (denegar).
async function resolveTargetEffectivePermisos(
  permisosRaw: unknown,
  rol: string | null,
  empresaId: string,
): Promise<Permisos | null> {
  if (permisosRaw !== null && permisosRaw !== undefined && permisosRaw !== '') {
    try {
      const parsed = typeof permisosRaw === 'string' ? JSON.parse(permisosRaw) : permisosRaw
      return normalizePermisos(parsed)
    } catch {
      return null
    }
  }

  if (!rol) return null

  // Misma query/fuente que authz.rehydrateSessionUser para los permisos del rol.
  const rolRow = await prisma.rol.findUnique({
    where: { empresa_id_slug: { empresa_id: empresaId, slug: rol } },
    select: { permisos: true },
  })

  if (rolRow?.permisos) {
    try {
      return normalizePermisos(JSON.parse(String(rolRow.permisos)))
    } catch {
      return null
    }
  }

  return ROLES_PREDEFINIDOS[rol] ?? null
}

// Guard anti-escalación vertical de privilegios: un EMPLEADO no puede ACTUAR
// (reset de password, activar/desactivar, eliminar, editar) sobre un principal
// con MÁS permisos que él. Sin esto, un empleado con `editar_equipo`/`eliminar_equipo`
// pero sin el resto de permisos de admin podría secuestrar/sabotear cuentas más
// privilegiadas del mismo tenant.
// - El dueño/empresa y super_admin NO se restringen (userType !== 'empleado').
// - Fail-closed: si no se pueden determinar los permisos del target, se deniega.
function assertCanActOnTargetUser(user: SessionUser, targetPermisos: Permisos | null, res: Response): boolean {
  if (user.userType !== 'empleado') return true
  if (!targetPermisos || hasPermissionEscalation(user.permisos as Permisos | undefined, targetPermisos)) {
    res.status(403).json({ error: 'No podés actuar sobre un usuario con más permisos que vos' })
    return false
  }
  return true
}

const ROLES_VALIDOS = ['admin', 'puerta', 'vendedor', 'revendedor'] as const
const HARD_LIMIT = 100
const DEFAULT_PAGE_SIZE = 25

async function getComisionRevendedorDefault(empresaId: string) {
  const rows = await prisma.$queryRawUnsafe<{ comision_revendedor_default: string }[]>(
    `SELECT comision_revendedor_default FROM empresas WHERE id = $1`,
    empresaId
  )
  return Number(rows[0]?.comision_revendedor_default ?? 0)
}

async function resolvePorcentajeComision(
  empresaId: string,
  rol: string | undefined,
  porcentajeComision: unknown,
  fallbackActual?: number | null
) {
  if (rol !== 'revendedor') return null

  if (
    porcentajeComision === undefined ||
    porcentajeComision === null ||
    porcentajeComision === ''
  ) {
    if (fallbackActual !== undefined && fallbackActual !== null) return fallbackActual
    return getComisionRevendedorDefault(empresaId)
  }

  const valor = Number(porcentajeComision)
  if (Number.isNaN(valor) || valor < 0 || valor > 100) {
    throw new Error('Comisión inválida (debe ser un número entre 0 y 100)')
  }

  return valor
}

// GET /equipo
router.get('/', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    if (!requirePermission(user, 'ver_equipo', res)) return
    const page = Math.max(1, Number(req.query.page) || 1)
    const requestedPageSize = Number(req.query.pageSize) || DEFAULT_PAGE_SIZE
    const pageSize = Math.min(HARD_LIMIT, Math.max(1, requestedPageSize))
    const busqueda = typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : ''
    const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy.trim() : 'alta'
    const sortDir = req.query.sortDir === 'asc' ? 'asc' : 'desc'

    // Mismo gate que la redacción de porcentaje_comision más abajo — se resuelve acá
    // arriba también porque el ORDER BY es un side-channel: si se permitiera ordenar
    // por comisión sin tener gestionar_revendedores, la POSICIÓN de cada revendedor en
    // la lista revelaría su ranking relativo de comisión aunque el valor esté en null.
    const puedeVerComisionRevendedor = user.userType !== 'empleado' || user.permisos?.gestionar_revendedores === true

    const sortMap: Record<string, string> = {
      miembro: `u.nombre ${sortDir}, u.apellido ${sortDir}`,
      rol: `u.rol ${sortDir}`,
      ventas: `COALESCE(us.total_ventas, 0) ${sortDir}`,
      generado: `COALESCE(us.total_generado, 0) ${sortDir}`,
      ...(puedeVerComisionRevendedor ? { comision: `u.porcentaje_comision ${sortDir}` } : {}),
      estado: `u.activo ${sortDir}`,
      alta: `u.created_at ${sortDir}`,
    }

    const orderClause = sortMap[sortBy] ?? `u.created_at ${sortDir}`

    const pgFiltros: string[] = ['u.empresa_id = $1']
    const pgValores: unknown[] = [empresaId]
    let pgIdx = 2

    if (busqueda) {
      pgFiltros.push(`(
        u.nombre ILIKE $${pgIdx} OR
        u.apellido ILIKE $${pgIdx} OR
        u.email ILIKE $${pgIdx} OR
        u.rol ILIKE $${pgIdx}
      )`)
      pgValores.push(`%${busqueda}%`)
      pgIdx++
    }

    const pgWhereClause = pgFiltros.join(' AND ')

    const countRows = await prisma.$queryRawUnsafe<{ total: bigint }[]>(
      `SELECT COUNT(*) as total
       FROM usuarios u
       WHERE ${pgWhereClause}`,
      ...pgValores
    )

    const total = Number(countRows[0]?.total ?? 0n)
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const currentPage = Math.min(page, totalPages)
    const offset = (currentPage - 1) * pageSize

    const rolesDb = await prisma.$queryRawUnsafe<{ slug: string; nombre: string; es_predefinido: boolean }[]>(
      `SELECT slug, nombre, es_predefinido FROM roles WHERE empresa_id = $1 ORDER BY nombre ASC`,
      empresaId
    )
    const roles = rolesDb.length > 0
      ? rolesDb
      : Object.entries(ROLES_PREDEFINIDOS).map(([slug]) => ({ slug, nombre: slug, es_predefinido: true }))

    const limitParam = pgIdx
    const offsetParam = pgIdx + 1
    const usuarios = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(
      `SELECT
         u.id,
         u.nombre,
         u.apellido,
         u.email,
         u.rol,
         u.activo,
         u.porcentaje_comision,
         u.created_at,
         u.permisos,
         COALESCE(us.total_ventas, 0) as total_ventas,
         COALESCE(us.total_generado, 0) as total_generado
       FROM usuarios u
       LEFT JOIN (
         SELECT revendedor_id, COUNT(id) as total_ventas, COALESCE(SUM(precio_pagado), 0) as total_generado
         FROM entradas
         WHERE revendedor_id IS NOT NULL
         GROUP BY revendedor_id
       ) us ON us.revendedor_id = u.id
       WHERE ${pgWhereClause}
       ORDER BY ${orderClause}
       LIMIT $${limitParam} OFFSET $${offsetParam}`,
       ...pgValores, pageSize, offset
     )

    // porcentaje_comision de un revendedor solo lo puede ver quien tiene
    // gestionar_revendedores (mismo gate que revendedores.ts) — acá se lista
    // junto al resto del equipo, así que se redacta fila por fila para no
    // filtrarlo por la puerta de atrás. No afecta a usuarios que no son
    // revendedores: ese dato no es sensible para ellos. (puedeVerComisionRevendedor
    // se resuelve arriba, antes del ORDER BY, para tapar también el side-channel de orden.)
    if (!puedeVerComisionRevendedor) {
      for (const u of usuarios) {
        if (u.rol === 'revendedor') u.porcentaje_comision = null
      }
    }

    const stats = (usuarios as Record<string, unknown>[]).map((u) => ({
      id: u.id,
      total_ventas: Number(u.total_ventas ?? 0),
      total_generado: Number(u.total_generado ?? 0),
    }))

    return res.json({
      data: { roles, usuarios, stats },
      pagination: {
        page: currentPage,
        pageSize,
        total,
        totalPages,
      },
    })
  } catch (err) {
    const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err)
    logServerError(`equipo list — ${detail}`)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /equipo
router.post('/', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    if (!requirePermission(user, 'crear_equipo', res)) return

    const { nombre, apellido, email, password, rol, porcentaje_comision, permisos, temporaryPassword } = req.body

    if (!nombre || !email || !password || !rol) {
      return res.status(400).json({ error: 'Faltan campos obligatorios' })
    }

    const empresaIdResolved = getActorEmpresaId(user)
    if (!empresaIdResolved) return res.status(400).json({ error: 'Actor sin empresa_id' })

    const rolesRows = await prisma.$queryRawUnsafe<{ slug: string; permisos: string | null; es_predefinido: boolean }[]>(
      `SELECT slug, permisos, es_predefinido FROM roles WHERE empresa_id = $1`,
      empresaIdResolved
    )
    // Si la tabla todavía no tiene roles para esta empresa (seeding aún no corrió),
    // fallback a los slugs de ROLES_PREDEFINIDOS
    const slugsEnTabla = rolesRows.map((r) => r.slug)
    const slugsValidos =
      slugsEnTabla.length > 0 ? slugsEnTabla : Object.keys(ROLES_PREDEFINIDOS)
    if (!slugsValidos.includes(rol)) {
      return res.status(400).json({ error: 'Rol inválido' })
    }

    const actorPermisos = normalizePermisos(user.permisos)
    const roleFromDb = rolesRows.find((row) => row.slug === rol)
    const targetRolePermisos = roleFromDb?.permisos
      ? normalizePermisos(JSON.parse(String(roleFromDb.permisos)))
      : ROLES_PREDEFINIDOS[rol] ?? null

    // Detectar "es revendedor" por HUELLA de permisos (esRolRevendedor), no solo por el
    // slug literal 'revendedor' — el resto del sistema (redirect de /dashboard a /revendedor,
    // etc.) ya detecta así. Un rol custom con la misma huella (ver_comision_propia/
    // ver_ganancia_propia sin ningún otro permiso, pero con OTRO slug) evadía el gate de
    // gestionar_revendedores y el enforcement del flag de plan si solo se comparaba el string.
    const esRevendedorEfectivo = rol === 'revendedor' || esRolRevendedor(targetRolePermisos ?? undefined)

    if (esRevendedorEfectivo) {
      // Si se está dando de alta un revendedor (con su comisión inicial), requiere permiso
      // adicional — mismo patrón que PATCH /:id para porcentaje_comision.
      if (!requirePermission(user, 'gestionar_revendedores', res)) return

      // `revendedor_habilitado` es un flag de plan controlado por super-admin (ver
      // routes/platform/empresas.ts). Hasta ahora solo lo leía el frontend (dashboard/features)
      // para esconder la UI — acá lo hacemos cumplir server-side, ACOTADO a la creación:
      // no bloquea nada sobre revendedores ya existentes.
      const empresaFlags = await prisma.empresa.findUnique({
        where: { id: empresaIdResolved },
        select: { revendedor_habilitado: true },
      })
      if (empresaFlags?.revendedor_habilitado === false) {
        return res.status(403).json({
          error: 'Tu plan no tiene habilitada la gestión de revendedores. Contactá a soporte.',
        })
      }
    }

    if (esEmpleado) {
      if (permisos !== undefined) {
        return res.status(403).json({ error: 'No tenés permiso para asignar permisos personalizados' })
      }

      if (!targetRolePermisos || hasPermissionEscalation(actorPermisos, targetRolePermisos)) {
        return res.status(403).json({ error: 'No tenés permiso para asignar ese rol' })
      }
    }

    await ensureIdentityConstraints()
    const normalizedEmail = await assertInternalEmailAvailable(email)

    // NO validamos la política de contraseñas en creación por empresa: la empresa
    // puede poner cualquier contraseña inicial. La fuerza queda garantizada porque
    // siempre marcamos must_change_password=true → el revendedor/empleado tiene
    // que rotar a una contraseña que SÍ cumpla la política en su primer login.
    if (typeof password !== 'string' || password.length === 0) {
      return res.status(400).json({ error: 'La contraseña es obligatoria' })
    }
    void temporaryPassword // legacy flag — must_change_password ahora es siempre true

    const hashed = await bcrypt.hash(password, 12)
    const id = uuidv4()
    let permisosJson: string | null = null
    if (permisos !== undefined) {
      const permisosValidados = validateRolePermisos(permisos, { allowEmpty: true })
      if (!permisosValidados.ok) {
        return res.status(400).json({ error: permisosValidados.error })
      }
      permisosJson = JSON.stringify(permisosValidados.data)
    }

    const porcentajeComisionFinal = await resolvePorcentajeComision(empresaIdResolved, rol, porcentaje_comision)

    await prisma.$executeRawUnsafe(
        `INSERT INTO usuarios (
           id, empresa_id, nombre, apellido, email, password, rol, porcentaje_comision, activo, permisos,
           must_change_password, temporary_password_set_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9, $10, $11)`,
        id,
        empresaIdResolved,
        nombre,
        apellido ?? null,
        normalizedEmail,
        hashed,
        rol,
        porcentajeComisionFinal,
        permisosJson,
        true, // must_change_password: SIEMPRE true en alta — la empresa puede
              // poner cualquier contraseña inicial, el usuario debe rotarla en
              // su primer login a una que cumpla la policy.
        new Date(),
    )

    await logEmpleadoActividad({
      empresaId: empresaIdResolved,
      empleadoId: id,
      tipo: 'empleado_creado',
      descripcion: `Empleado creado con rol "${rol}"`,
      metadata: { rol, creado_por: user.id },
    })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'equipo.empleado_creado',
      entityType: 'usuario',
      entityId: id,
      entityLabel: `${nombre}${apellido ? ' ' + apellido : ''} <${normalizedEmail}>`,
      payload: { rol, empresa_id: empresaIdResolved },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.status(201).json({ ok: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'El email ya está en uso por otra cuenta interna') {
      return res.status(409).json({ error: error.message })
    }
    if (error instanceof Error && error.message.includes('Comisión inválida')) {
      return res.status(400).json({ error: error.message })
    }
    logServerError('equipo create')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /equipo/:id
router.get('/:id', verifyInternal, requireAuth, requirePermissionMiddleware('ver_equipo'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const { id } = req.params

    const [usuarioRows, statsRows, escaneoRows] = await Promise.all([
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT u.id, u.nombre, u.apellido, u.email, u.rol, u.activo, u.created_at, u.porcentaje_comision, u.must_change_password
         FROM usuarios u
         WHERE u.id = $1 AND u.empresa_id = $2`,
        id, empresaId
      ),
      prisma.$queryRawUnsafe<{ total_ventas: bigint; total_generado: string; total_consumibles: bigint }[]>(
        `SELECT
           COUNT(DISTINCT en.id) AS total_ventas,
           COALESCE(SUM(en.precio_pagado), 0) AS total_generado,
           COUNT(DISTINCT cv.id) AS total_consumibles
         FROM usuarios u
         LEFT JOIN entradas en ON en.revendedor_id = u.id AND en.estado != 'cancelada'
         LEFT JOIN consumibles_ventas cv ON cv.usuario_id = u.id
         WHERE u.id = $1 AND u.empresa_id = $2`,
        id, empresaId
      ),
      prisma.$queryRawUnsafe<{ total_escaneos: bigint }[]>(
        `SELECT COUNT(*) AS total_escaneos
         FROM entradas en
         INNER JOIN eventos ev ON ev.id = en.evento_id AND ev.empresa_id = $1
         WHERE en.used_by_user_id = $2`,
        empresaId, id
      ),
    ])

    if (!usuarioRows[0]) return res.status(404).json({ error: 'Empleado no encontrado' })

    return res.json({
      data: {
        usuario: usuarioRows[0],
        stats: {
          total_ventas: Number(statsRows[0]?.total_ventas ?? 0n),
          total_generado: Number(statsRows[0]?.total_generado ?? 0),
          total_consumibles: Number(statsRows[0]?.total_consumibles ?? 0n),
          total_escaneos: Number(escaneoRows[0]?.total_escaneos ?? 0n),
        },
      },
    })
  } catch (error) {
    logServerError('equipo get by id', error)
    return res.status(500).json({ error: 'No se pudo cargar el empleado' })
  }
})

// GET /equipo/:id/actividad
router.get('/:id/actividad', verifyInternal, requireAuth, requirePermissionMiddleware('ver_actividad_equipo'), async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const { id } = req.params
    const page = Math.max(1, parseInt(String(req.query.page ?? '1'), 10))
    const limit = Math.min(100, Math.max(10, parseInt(String(req.query.limit ?? '25'), 10)))
    const offset = (page - 1) * limit

    const [countRows, rows] = await Promise.all([
      prisma.$queryRawUnsafe<{ total: bigint }[]>(
        'SELECT COUNT(*) AS total FROM empleados_actividad WHERE empresa_id = $1 AND empleado_id = $2',
        empresaId, id
      ),
      prisma.$queryRawUnsafe<Record<string, unknown>[]>(
        `SELECT id, tipo, descripcion, metadata, created_at
         FROM empleados_actividad
         WHERE empresa_id = $1 AND empleado_id = $2
         ORDER BY created_at DESC
         LIMIT $3 OFFSET $4`,
        empresaId, id, limit, offset
      ),
    ])
    const total = Number(countRows[0]?.total ?? 0n)

    return res.json({
      data: {
        items: rows.map((r) => ({
          ...r,
          metadata: r.metadata ? (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) : null,
        })),
        total,
        page,
        limit,
      },
    })
  } catch (error) {
    logServerError('equipo get actividad', error)
    return res.status(500).json({ error: 'No se pudo cargar la actividad' })
  }
})

// PATCH /equipo/comision-default
// IMPORTANTE: esta ruta debe ir ANTES de /:id para evitar que "comision-default" se interprete como un :id
router.patch(
  '/comision-default',
  verifyInternal,
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const user = req.user!
      const esEmpleado = user.userType === 'empleado'

      if (!requirePermission(user, 'gestionar_revendedores', res)) return

      const { comision } = req.body

      const valor = Number(comision)
      if (isNaN(valor) || valor < 0 || valor > 100) {
        return res
          .status(400)
          .json({ error: 'Comisión inválida (debe ser un número entre 0 y 100)' })
      }

      const empresaId = getActorEmpresaId(user)
      if (!empresaId) return res.status(400).json({ error: 'Actor sin empresa_id' })

      await prisma.$executeRawUnsafe(
        `UPDATE empresas SET comision_revendedor_default = $1 WHERE id = $2`,
        valor, empresaId
      )

      return res.json({ ok: true })
    } catch {
      logServerError('equipo comision-default patch')
      return res.status(500).json({ error: 'Error interno del servidor' })
    }
  }
)

// PATCH /equipo/:id
router.patch('/:id', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const { id } = req.params

    if (!requirePermission(user, 'editar_equipo', res)) return

    const body = req.body

    if (body.email !== undefined) {
      await ensureIdentityConstraints()
      const normalizedEmail = await assertInternalEmailAvailable(String(body.email), {
        exclude: { actorType: 'empleado', actorId: String(id) },
      })
      body.email = normalizedEmail
    }

    const empresaIdResolved = getActorEmpresaId(user)
    if (!empresaIdResolved) return res.status(400).json({ error: 'Actor sin empresa_id' })

    // Solo el dueño de la empresa puede cambiar roles
    if (body.rol !== undefined) {
      if (esEmpleado) {
        return res.status(403).json({ error: 'Sin permiso para cambiar roles' })
      }

      const rolesRows = await prisma.$queryRawUnsafe<{ slug: string }[]>(
        `SELECT slug FROM roles WHERE empresa_id = $1`,
        empresaIdResolved
      )

      const slugsEnTabla = rolesRows.map((r) => r.slug)
      const slugsValidos = slugsEnTabla.length > 0 ? slugsEnTabla : Object.keys(ROLES_PREDEFINIDOS)

      if (!slugsValidos.includes(body.rol)) {
        return res.status(400).json({ error: 'Rol inválido' })
      }
    }

    const rows = await prisma.$queryRawUnsafe<{ id: string; rol: string; porcentaje_comision: string | null; permisos: string | null }[]>(
      `SELECT id, rol, porcentaje_comision, permisos FROM usuarios WHERE id = $1 AND empresa_id = $2`,
      id, empresaIdResolved
    )

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' })
    }

    const usuarioActual = rows[0]

    // Anti-escalación vertical: un empleado no puede actuar sobre un usuario con
    // más permisos que él (p.ej. desactivar a un admin). Empresa/super_admin sin restricción.
    const targetPermisos = await resolveTargetEffectivePermisos(usuarioActual.permisos, usuarioActual.rol, empresaIdResolved)
    if (!assertCanActOnTargetUser(user, targetPermisos, res)) return

    // LOW: un empleado NO puede editar su PROPIA comisión (evita auto-aumento).
    if (esEmpleado && id === user.id && body.porcentaje_comision !== undefined) {
      return res.status(403).json({ error: 'No podés editar tu propia comisión' })
    }

    // Detectar "es revendedor" por HUELLA de permisos (esRolRevendedor), no solo por el
    // slug literal 'revendedor' — un rol custom con la misma huella (ver_comision_propia/
    // ver_ganancia_propia sin ningún otro permiso, pero con OTRO slug) evadía estos gates
    // si solo se comparaba el string. targetPermisos ya está resuelto arriba (línea 586).
    const targetEsRevendedorEfectivo = usuarioActual.rol === 'revendedor' || esRolRevendedor(targetPermisos ?? undefined)

    // Si se intenta modificar porcentaje_comision de un revendedor, requiere permiso adicional
    if (body.porcentaje_comision !== undefined && targetEsRevendedorEfectivo) {
      if (!requirePermission(user, 'gestionar_revendedores', res)) return
    }

    // Si se intenta activar/desactivar a un revendedor, requiere permiso adicional —
    // mismo patrón que porcentaje_comision más arriba, y que PATCH /:id/password y DELETE /:id.
    if (body.activo !== undefined && targetEsRevendedorEfectivo) {
      if (!requirePermission(user, 'gestionar_revendedores', res)) return
    }

    // Validar/sanitizar nombre y apellido si llegan
    if (!esEmpleado && body.nombre !== undefined) {
      if (typeof body.nombre !== 'string' || !body.nombre.trim()) {
        return res.status(400).json({ error: 'El nombre no puede estar vacío' })
      }
      body.nombre = body.nombre.trim()
    }
    if (!esEmpleado && body.apellido !== undefined) {
      body.apellido = typeof body.apellido === 'string' ? (body.apellido.trim() || null) : null
    }

    // Empleados solo pueden actualizar activo y porcentaje_comision, no el rol
    const camposPermitidos = esEmpleado
      ? ['activo', 'porcentaje_comision']
      : ['activo', 'rol', 'porcentaje_comision', 'email', 'nombre', 'apellido']

    // permisos se maneja por separado por necesitar serialización JSON
    let permisosJson: string | null = null
    if (!esEmpleado && body.permisos !== undefined) {
      const permisosValidados = validateRolePermisos(body.permisos, { allowEmpty: true })
      if (!permisosValidados.ok) {
        return res.status(400).json({ error: permisosValidados.error })
      }
      permisosJson = JSON.stringify(permisosValidados.data)
    }

    const updates = Object.entries(body)
      .filter(([k]) => camposPermitidos.includes(k))
      .reduce<Record<string, unknown>>((acc, [k, v]) => {
        // Postgres es estricto: `activo` es boolean, no acepta int/string.
        // Frontend puede mandar true/false, 1/0, o "1"/"0" según contexto.
        if (k === 'activo') {
          acc[k] = v === true || v === 1 || v === '1' || v === 'true'
        } else {
          acc[k] = v
        }
        return acc
      }, {})

    const rolFinal = typeof updates.rol === 'string' ? updates.rol : String(usuarioActual.rol)

    if (updates.porcentaje_comision !== undefined || (updates.rol === 'revendedor' && usuarioActual.rol !== 'revendedor')) {
        updates.porcentaje_comision = await resolvePorcentajeComision(
        empresaIdResolved,
        rolFinal,
        updates.porcentaje_comision,
        usuarioActual.rol === 'revendedor' ? Number(usuarioActual.porcentaje_comision ?? 0) : null
      )
    }

    const campos = Object.entries(updates)
      .map(([k]) => `${k} = ?`)
      .join(', ')

    const valores = Object.entries(updates).map(([, v]) => v)

    const allCampos =
      permisosJson !== null
        ? campos
          ? `${campos}, permisos = ?`
          : 'permisos = ?'
        : campos

    const allValores = permisosJson !== null ? [...valores, permisosJson] : valores

    if (!allCampos) return res.json({ ok: true })

    // Build Postgres positional SET clause
    const pgSetEntries = allCampos.split(', ')
    const pgSetClause = pgSetEntries.map((entry, i) => entry.replace('?', `$${i + 1}`)).join(', ')
    const pgIdIdx = allValores.length + 1
    const pgEmpresaIdx = allValores.length + 2
    await prisma.$executeRawUnsafe(
      `UPDATE usuarios SET ${pgSetClause} WHERE id = $${pgIdIdx} AND empresa_id = $${pgEmpresaIdx}`,
      ...allValores, id, empresaIdResolved
    )

    // Log activity for each changed field
    if (updates.rol !== undefined) {
      await logEmpleadoActividad({
        empresaId: empresaIdResolved,
        empleadoId: id,
        tipo: 'rol_cambiado',
        descripcion: `Rol cambiado a "${updates.rol}"`,
        metadata: { rol_nuevo: updates.rol, modificado_por: user.id },
      })
    }
    if (updates.activo !== undefined) {
      await logEmpleadoActividad({
        empresaId: empresaIdResolved,
        empleadoId: id,
        tipo: 'estado_cambiado',
        descripcion: updates.activo ? 'Cuenta activada' : 'Cuenta desactivada',
        metadata: { activo: updates.activo, modificado_por: user.id },
      })
    }

    return res.json({ ok: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'El email ya está en uso por otra cuenta interna') {
      return res.status(409).json({ error: error.message })
    }
    if (error instanceof Error && error.message.includes('Comisión inválida')) {
      return res.status(400).json({ error: error.message })
    }
    logServerError('equipo update', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// PATCH /equipo/:id/password — empresa (con permiso gestionar_revendedores) puede
// resetear la contraseña de un miembro de su equipo. Marca must_change_password=true
// para que el usuario la rote en su próximo login.
router.patch('/:id/password', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const { id } = req.params
    const { newPassword } = req.body as { newPassword?: unknown }

    if (id === user.id) {
      return res.status(400).json({ error: 'Usá el flujo de cambio de contraseña personal para tu propia cuenta' })
    }

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })

    const rows = await prisma.$queryRawUnsafe<{ id: string; rol: string; permisos: string | null }[]>(
      `SELECT id, rol, permisos FROM usuarios WHERE id = $1 AND empresa_id = $2`,
      id, empresaId
    )
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' })
    }

    const targetRol = rows[0].rol
    // Anti-escalación vertical: un empleado no puede resetear la password de un
    // usuario con más permisos que él (si no, se loguearía como ese admin). Fail-closed.
    // Se resuelve ANTES del gate de gestionar_revendedores para poder detectar "es
    // revendedor" por huella de permisos (esRolRevendedor), no solo por el slug literal
    // 'revendedor' — un rol custom con la misma huella evadía este gate.
    const targetPermisos = await resolveTargetEffectivePermisos(rows[0].permisos, targetRol, empresaId)
    const targetEsRevendedorEfectivo = targetRol === 'revendedor' || esRolRevendedor(targetPermisos ?? undefined)
    const permisoRequerido = targetEsRevendedorEfectivo ? 'gestionar_revendedores' : 'editar_equipo'
    if (!requirePermission(user, permisoRequerido, res)) return

    if (!assertCanActOnTargetUser(user, targetPermisos, res)) return

    // No validamos la policy: la empresa puede poner cualquier contraseña como
    // reset. El usuario va a estar forzado a rotarla en su próximo login (vía
    // must_change_password=true) con la policy ya enforced del lado de él.
    if (typeof newPassword !== 'string' || newPassword.length === 0) {
      return res.status(400).json({ error: 'La nueva contraseña es obligatoria' })
    }

    const hashed = await bcrypt.hash(newPassword, 12)

    await prisma.$executeRawUnsafe(
      `UPDATE usuarios
         SET password = $1, must_change_password = true, temporary_password_set_at = NOW()
       WHERE id = $2 AND empresa_id = $3`,
      hashed, id, empresaId
    )

    await touchPasswordVersion('empleado', id)

    await logEmpleadoActividad({
      empresaId,
      empleadoId: id,
      tipo: 'password_reseteado',
      descripcion: 'Contraseña reseteada por administrador del equipo',
      metadata: { reseteado_por: user.id },
    })

    return res.json({ ok: true })
  } catch (error) {
    logServerError('equipo password reset', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// DELETE /equipo/:id
router.delete('/:id', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const esEmpleado = user.userType === 'empleado'
    const { id } = req.params

    if (!requirePermission(user, 'eliminar_equipo', res)) return

    if (id === user.id) {
      return res.status(400).json({ error: 'No podés eliminarte a vos mismo' })
    }

    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(400).json({ error: 'Actor sin empresa_id' })

    const delRows = await prisma.$queryRawUnsafe<{ id: string; rol: string; permisos: string | null }[]>(
      `SELECT id, rol, permisos FROM usuarios WHERE id = $1 AND empresa_id = $2`,
      id, empresaId
    )

    if (delRows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' })
    }

    const targetUser = delRows[0]

    // Anti-escalación vertical: un empleado no puede eliminar a un usuario con
    // más permisos que él (sabotaje / DoS dirigido). Empresa/super_admin sin restricción.
    // Se resuelve ANTES del gate de gestionar_revendedores para poder detectar "es
    // revendedor" por huella de permisos (esRolRevendedor), no solo por el slug literal
    // 'revendedor' — un rol custom con la misma huella evadía este gate.
    const targetPermisos = await resolveTargetEffectivePermisos(targetUser.permisos, targetUser.rol, empresaId)
    const targetEsRevendedorEfectivo = targetUser.rol === 'revendedor' || esRolRevendedor(targetPermisos ?? undefined)

    // Si el usuario target es revendedor, requiere permiso adicional — mismo patrón
    // que PATCH /:id (porcentaje_comision) y PATCH /:id/password.
    if (targetEsRevendedorEfectivo) {
      if (!requirePermission(user, 'gestionar_revendedores', res)) return
    }
    if (!assertCanActOnTargetUser(user, targetPermisos, res)) return

    if (targetUser.rol === 'admin') {
      const adminRows = await prisma.$queryRawUnsafe<{ total: bigint }[]>(
        `SELECT COUNT(*) as total FROM usuarios WHERE empresa_id = $1 AND rol = 'admin' AND activo = true`,
        empresaId
      )
      const totalAdmins = Number(adminRows[0]?.total ?? 0n)
      if (totalAdmins <= 1) {
        return res.status(400).json({ error: 'No podés eliminar al único administrador del equipo' })
      }
    }

    await prisma.$executeRawUnsafe(
      `DELETE FROM usuarios WHERE id = $1 AND empresa_id = $2`,
      id, empresaId
    )

    await logEmpleadoActividad({
      empresaId: empresaId,
      empleadoId: id,
      tipo: 'empleado_eliminado',
      descripcion: 'Empleado eliminado del equipo',
      metadata: { eliminado_por: user.id },
    })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'equipo.empleado_eliminado',
      entityType: 'usuario',
      entityId: id,
      payload: { rol: targetUser.rol, empresa_id: empresaId },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.json({ ok: true })
  } catch {
    logServerError('equipo delete')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

export default router
