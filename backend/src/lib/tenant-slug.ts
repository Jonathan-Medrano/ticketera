import { prisma } from './prisma'

const RESERVED_TENANT_SLUGS = new Set([
  'www',
  'api',
  'app',
  'admin',
  'support',
  'soporte',
  'checkout',
  'pago',
  'pagos',
  'auth',
  'login',
  'register',
  'registro',
  'super-admin',
  'dashboard',
  'revendedor',
  'ticketera',
  'platea',
  'localhost',
  'mail',
  'smtp',
  'cdn',
  'assets',
  'static',
])

const TENANT_SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function normalizeTenantSlug(slug: string) {
  return slug.trim().toLowerCase()
}

export function validateTenantSlug(slug: string) {
  const normalized = normalizeTenantSlug(slug)

  if (!normalized) {
    return { ok: false as const, error: 'El subdominio es obligatorio' }
  }

  if (normalized.length < 3 || normalized.length > 40) {
    return { ok: false as const, error: 'El subdominio debe tener entre 3 y 40 caracteres' }
  }

  if (!TENANT_SLUG_REGEX.test(normalized)) {
    return { ok: false as const, error: 'El subdominio solo puede tener letras minúsculas, números y guiones internos' }
  }

  if (RESERVED_TENANT_SLUGS.has(normalized)) {
    return { ok: false as const, error: 'Ese subdominio está reservado y no se puede usar' }
  }

  return { ok: true as const, slug: normalized }
}

export async function assertTenantSlugAvailable(slug: string, excludeCompanyId?: string) {
  const validated = validateTenantSlug(slug)
  if (!validated.ok) {
    throw new Error(validated.error)
  }

  // slug stored lowercase per design
  const existing = await prisma.empresa.findFirst({
    where: {
      slug: validated.slug,
      ...(excludeCompanyId ? { id: { not: excludeCompanyId } } : {}),
    },
    select: { id: true },
  })

  if (existing) {
    throw new Error('El subdominio ya está en uso')
  }

  return validated.slug
}
