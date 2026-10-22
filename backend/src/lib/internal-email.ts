import { prisma } from './prisma'

export type InternalActorType = 'empresa' | 'empleado' | 'platform_staff' | 'super_admin'

type InternalEmailConflict = {
  actorType: InternalActorType
  actorId: string
  email: string
}

type InternalEmailAvailabilityOptions = {
  exclude?: {
    actorType: InternalActorType
    actorId: string
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase()
}

function shouldExclude(conflict: InternalEmailConflict, exclude?: InternalEmailAvailabilityOptions['exclude']) {
  return !!exclude && conflict.actorType === exclude.actorType && conflict.actorId === exclude.actorId
}

export async function findInternalEmailConflict(email: string, options: InternalEmailAvailabilityOptions = {}) {
  const normalizedEmail = normalizeEmail(email)
  if (!normalizedEmail) return null

  const empresa = await prisma.empresa.findFirst({
    where: { email: normalizedEmail },
    select: { id: true, email: true },
  })

  if (empresa) {
    const conflict: InternalEmailConflict = {
      actorType: 'empresa',
      actorId: empresa.id,
      email: empresa.email ?? normalizedEmail,
    }
    if (!shouldExclude(conflict, options.exclude)) {
      return conflict
    }
  }

  const usuario = await prisma.usuario.findFirst({
    where: { email: normalizedEmail },
    select: { id: true, email: true },
  })

  if (usuario) {
    const conflict: InternalEmailConflict = {
      actorType: 'empleado',
      actorId: usuario.id,
      email: usuario.email,
    }
    if (!shouldExclude(conflict, options.exclude)) {
      return conflict
    }
  }

  const admin = await prisma.platformAdminUser.findFirst({
    where: { email: normalizedEmail },
    select: { id: true, email: true, singleton_key: true },
  })

  if (admin) {
    const conflict: InternalEmailConflict = {
      actorType: (admin.singleton_key ?? '') === 'superadmin' ? 'super_admin' : 'platform_staff',
      actorId: admin.id,
      email: admin.email,
    }
    if (!shouldExclude(conflict, options.exclude)) {
      return conflict
    }
  }

  return null
}

export async function assertInternalEmailAvailable(email: string, options: InternalEmailAvailabilityOptions = {}) {
  const conflict = await findInternalEmailConflict(email, options)
  if (conflict) {
    throw new Error('El email ya está en uso por otra cuenta interna')
  }

  return normalizeEmail(email)
}
