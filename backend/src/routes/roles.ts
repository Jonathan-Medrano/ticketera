import { Router, Request, Response } from 'express'
import { prisma, prismaDirectUrl } from '../lib/prisma'
import { verifyInternal, requireAuth } from '../middleware/auth'
import { randomUUID as uuidv4 } from 'node:crypto'
import { ROLES_PREDEFINIDOS, hasPermissionEscalation, listPermissionEscalations, validateRolePermisos, type Permisos } from '../lib/permisos'
import { getActorEmpresaId, requirePermission } from '../lib/authz'
import { logServerError } from '../lib/safe-log'

const router = Router()
const HARD_LIMIT = 500
const DEFAULT_PAGE_SIZE = 25

/**
 * Cuenta los permisos activos (true) de un blob `permisos` (JSON string).
 * Tolerante a JSON malformado o null: devuelve 0 en vez de romper la lista.
 */
function contarPermisosActivos(permisosRaw: string | null): number {
  if (!permisosRaw) return 0
  try {
    const obj = JSON.parse(permisosRaw)
    if (!obj || typeof obj !== 'object') return 0
    return Object.values(obj).filter((v) => v === true).length
  } catch {
    return 0
  }
}

// GET /roles
router.get('/', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    if (!requirePermission(user, 'ver_roles', res)) return
    const page = Math.max(1, Number(req.query.page) || 1)
    const requestedPageSize = Number(req.query.pageSize) || DEFAULT_PAGE_SIZE
    const pageSize = Math.min(HARD_LIMIT, Math.max(1, requestedPageSize))
    const busqueda = typeof req.query.busqueda === 'string' ? req.query.busqueda.trim() : ''
    const sortBy = typeof req.query.sortBy === 'string' ? req.query.sortBy.trim() : 'nombre'
    const sortDir = req.query.sortDir === 'desc' ? 'desc' : 'asc'

    // Lazy seeding robusto: aseguramos SIEMPRE que existan todos los roles predefinidos.
    // FOR UPDATE via prismaDirectUrl (direct port 5432) locks the empresa roles rows.
    await prismaDirectUrl.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM roles WHERE empresa_id = ${empresaId} FOR UPDATE`
      // Seed any missing predefined roles (skipDuplicates = INSERT ... ON CONFLICT DO NOTHING)
      const slugs = Object.keys(ROLES_PREDEFINIDOS)
      for (const slug of slugs) {
        const permisos = ROLES_PREDEFINIDOS[slug]
        const nombre = slug.charAt(0).toUpperCase() + slug.slice(1)
        const id = uuidv4()
        await tx.rol.createMany({
          data: [{ id, empresa_id: empresaId, nombre, slug, permisos: JSON.stringify(permisos), es_predefinido: true }],
          skipDuplicates: true,
        })
      }
    })

    const sortMap: Record<string, string> = {
      nombre: `r.nombre ${sortDir}`,
      tipo: `r.es_predefinido ${sortDir}`,
      usuarios: `cantidad_usuarios ${sortDir}`,
      alta: `r.created_at ${sortDir}`,
    }
    const orderClause = sortMap[sortBy] ?? `r.nombre ${sortDir}`

    // Dynamic search filter + COUNT + paginated list
    // Use $queryRawUnsafe for complex GROUP BY + ORDER BY with dynamic clauses
    const searchFilter = busqueda ? `%${busqueda}%` : null
    const searchClause = busqueda
      ? `AND (r.nombre ILIKE $2 OR r.slug ILIKE $2)`
      : ''

    interface RolCountRow { total: bigint }
    const countArgs: unknown[] = [empresaId]
    if (busqueda) countArgs.push(searchFilter)

    const countSql = `
      SELECT COUNT(*) as total
      FROM roles r
      WHERE r.empresa_id = $1
        ${searchClause}
    `
    const countRows = await prisma.$queryRawUnsafe<RolCountRow[]>(countSql, ...countArgs)

    const total = Number(countRows[0]?.total ?? 0n)
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const currentPage = Math.min(page, totalPages)
    const offset = (currentPage - 1) * pageSize

    interface RolListRow {
      id: string
      empresa_id: string
      nombre: string
      slug: string
      permisos: string | null
      es_predefinido: boolean
      created_at: Date
      cantidad_usuarios: bigint
    }

    // orderClause is built from an allowlist (sortMap) — safe to interpolate
    const listArgs: unknown[] = [empresaId]
    if (busqueda) listArgs.push(searchFilter)
    const pageParam = listArgs.length + 1
    const offsetParam = listArgs.length + 2
    listArgs.push(pageSize, offset)

    const listSql = `
      SELECT r.id, r.empresa_id, r.nombre, r.slug, r.permisos, r.es_predefinido, r.created_at,
             COUNT(u.id) as cantidad_usuarios
      FROM roles r
      LEFT JOIN usuarios u ON u.empresa_id = r.empresa_id AND u.rol = r.slug
      WHERE r.empresa_id = $1
        ${searchClause}
      GROUP BY r.id, r.empresa_id, r.nombre, r.slug, r.permisos, r.es_predefinido, r.created_at
      ORDER BY ${orderClause}
      LIMIT $${pageParam} OFFSET $${offsetParam}
    `
    const roles = await prisma.$queryRawUnsafe<RolListRow[]>(listSql, ...listArgs)

    return res.json({
      data: roles.map((r) => ({
        ...r,
        cantidad_usuarios: Number(r.cantidad_usuarios),
        cantidad_permisos: contarPermisosActivos(r.permisos),
      })),
      pagination: {
        page: currentPage,
        pageSize,
        total,
        totalPages,
      },
    })
  } catch {
    logServerError('roles list')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /roles
router.post('/', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    if (!requirePermission(user, 'crear_roles', res)) return

    const { nombre, permisos: permisosRol } = req.body

    if (!nombre || typeof nombre !== 'string' || nombre.trim().length === 0) {
      return res.status(400).json({ error: 'El nombre es obligatorio' })
    }
    if (!permisosRol || typeof permisosRol !== 'object') {
      return res.status(400).json({ error: 'Los permisos son obligatorios' })
    }

    const permisosValidados = validateRolePermisos(permisosRol)
    if (!permisosValidados.ok) {
      return res.status(400).json({ error: permisosValidados.error })
    }

    if (user.userType === 'empleado') {
      const escalated = listPermissionEscalations(user.permisos as Permisos | undefined, permisosValidados.data)
      if (escalated.length > 0) {
        return res.status(403).json({ error: 'No podés crear roles con permisos superiores a los tuyos' })
      }
    }

    const slug = nombre
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')

    if (!slug) {
      return res.status(400).json({ error: 'Nombre de rol inválido' })
    }

    const existente = await prisma.rol.findFirst({
      where: { empresa_id: empresaId, slug },
      select: { id: true },
    })
    if (existente) {
      return res.status(409).json({ error: 'Ya existe un rol con ese nombre' })
    }

    const id = uuidv4()
    await prisma.rol.create({
      data: {
        id,
        empresa_id: empresaId,
        nombre: nombre.trim(),
        slug,
        permisos: JSON.stringify(permisosValidados.data),
        es_predefinido: false,
      },
    })

    return res.status(201).json({ ok: true, id, slug })
  } catch {
    logServerError('roles create')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// GET /roles/:id
router.get('/:id', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    if (!requirePermission(user, 'ver_roles', res)) return
    const { id } = req.params

    const rol = await prisma.rol.findFirst({
      where: { id, empresa_id: empresaId },
    })

    if (!rol) {
      return res.status(404).json({ error: 'Rol no encontrado' })
    }

    const usuarios = await prisma.usuario.findMany({
      where: { empresa_id: empresaId, rol: rol.slug },
      select: { id: true, nombre: true, apellido: true, email: true, activo: true },
      orderBy: { nombre: 'asc' },
    })

    return res.json({ ...rol, usuarios })
  } catch {
    logServerError('roles detail')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// PATCH /roles/:id
router.patch('/:id', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    if (!requirePermission(user, 'editar_roles', res)) return
    const { id } = req.params

    const rol = await prisma.rol.findFirst({
      where: { id, empresa_id: empresaId },
    })

    if (!rol) {
      return res.status(404).json({ error: 'Rol no encontrado' })
    }

    const body = req.body
    const { nombre, permisos: permisosRol } = body

    if (user.userType === 'empleado' && rol.es_predefinido) {
      return res.status(403).json({ error: 'No podés editar roles predefinidos' })
    }

    // Si cambia el nombre, verificar que el nuevo slug no colisione
    let nuevoSlug = rol.slug
    if (nombre && nombre.trim() !== rol.nombre) {
      const candidato = nombre
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')

      if (candidato !== rol.slug) {
        // Verificar si tiene usuarios: no podemos cambiar el slug si tiene usuarios
        const countUsuarios = await prisma.usuario.count({
          where: { empresa_id: empresaId, rol: rol.slug },
        })
        if (countUsuarios > 0) {
          return res.status(400).json({
            error: 'No se puede cambiar el nombre del rol porque tiene usuarios asignados',
          })
        }

        // Verificar que no exista otro con ese slug
        const existente = await prisma.rol.findFirst({
          where: { empresa_id: empresaId, slug: candidato, NOT: { id } },
          select: { id: true },
        })
        if (existente) {
          return res.status(409).json({ error: 'Ya existe un rol con ese nombre' })
        }

        nuevoSlug = candidato
      }
    }

    const updateData: Record<string, unknown> = {}

    if (nombre) {
      updateData.nombre = nombre.trim()
      updateData.slug = nuevoSlug
    }
    if (permisosRol) {
      const permisosValidados = validateRolePermisos(permisosRol)
      if (!permisosValidados.ok) {
        return res.status(400).json({ error: permisosValidados.error })
      }

      if (user.userType === 'empleado' && hasPermissionEscalation(user.permisos as Permisos | undefined, permisosValidados.data)) {
        return res.status(403).json({ error: 'No podés asignar permisos superiores a los tuyos' })
      }

      updateData.permisos = JSON.stringify(permisosValidados.data)
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'Nada que actualizar' })
    }

    await prisma.rol.update({
      where: { id },
      data: updateData,
    })

    return res.json({ ok: true })
  } catch {
    logServerError('roles update')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// DELETE /roles/:id
router.delete('/:id', verifyInternal, requireAuth, async (req: Request, res: Response) => {
  try {
    const user = req.user!
    const empresaId = getActorEmpresaId(user)
    if (!empresaId) return res.status(403).json({ error: 'Sin permiso' })
    if (!requirePermission(user, 'eliminar_roles', res)) return
    const { id } = req.params

    const rol = await prisma.rol.findFirst({
      where: { id, empresa_id: empresaId },
    })

    if (!rol) {
      return res.status(404).json({ error: 'Rol no encontrado' })
    }

    if (rol.es_predefinido) {
      return res.status(400).json({ error: 'No se puede eliminar un rol predefinido' })
    }

    const countUsuarios = await prisma.usuario.count({
      where: { empresa_id: empresaId, rol: rol.slug },
    })

    if (countUsuarios > 0) {
      return res
        .status(400)
        .json({ error: 'No se puede eliminar un rol con usuarios asignados' })
    }

    await prisma.rol.delete({
      where: { id },
    })

    return res.json({ ok: true })
  } catch {
    logServerError('roles delete')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

export default router
