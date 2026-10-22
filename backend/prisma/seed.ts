import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'node:crypto'

const prisma = new PrismaClient()

const SUPERADMIN_PERMISOS = {
  platform_dashboard: true,
  platform_empresas: true,
  platform_configuracion: true,
  platform_usuarios: true,
} as const

async function main() {
  const email = process.env.SUPERADMIN_EMAIL?.trim().toLowerCase() ?? 'admin@ticketera.com'
  const loginAlias = process.env.SUPERADMIN_LOGIN_ALIAS?.trim().toLowerCase() ?? 'superadmin'
  const nombre = process.env.SUPERADMIN_NAME?.trim() ?? 'Super Admin'
  const password = process.env.SUPERADMIN_PASSWORD?.trim()

  if (!password) {
    throw new Error(
      'SUPERADMIN_PASSWORD es obligatoria. Definila como variable de entorno antes de correr `prisma db seed`.',
    )
  }
  if (password.length < 12) {
    throw new Error('SUPERADMIN_PASSWORD debe tener al menos 12 caracteres.')
  }

  const passwordHash = await bcrypt.hash(password, 12)

  const result = await prisma.platformAdminUser.upsert({
    where: { singleton_key: 'superadmin' },
    update: {
      nombre,
      email,
      login_alias: loginAlias,
      password: passwordHash,
      role_slug: 'superadmin',
      permisos: JSON.stringify(SUPERADMIN_PERMISOS),
      activo: true,
      must_change_password: false,
      temporary_password_set_at: null,
    },
    create: {
      id: randomUUID(),
      nombre,
      email,
      login_alias: loginAlias,
      password: passwordHash,
      role_slug: 'superadmin',
      permisos: JSON.stringify(SUPERADMIN_PERMISOS),
      singleton_key: 'superadmin',
      activo: true,
      must_change_password: false,
    },
  })

  console.log(JSON.stringify({
    ok: true,
    seeded: 'platform_admin_users (superadmin)',
    id: result.id,
    email: result.email,
    login_alias: result.login_alias,
  }, null, 2))
}

main()
  .catch((error) => {
    console.error('[seed] error:', error)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
