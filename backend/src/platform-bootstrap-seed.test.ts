import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { prismaDirectUrl } from './lib/prisma'

const PLATFORM_SUPERADMIN_EMAIL = 'superadmin@platea.local'
const PLATFORM_SUPERADMIN_LOGIN_ALIAS = 'superadmin'
const PLATFORM_SUPERADMIN_PASSWORD = '12345678'

type PlatformAdminRow = {
  email: string
  login_alias: string
  password: string
  role_slug: string
  singleton_key: string | null
  activo: boolean | number
}

// platform_admin_users is a real, shared table in the Postgres test DB — every other
// test file's own process (`node --test` runs each file as a separate process, but
// they all point at the same `ticketera_test` database) can query it. Dropping it here
// without restoring it left the table permanently gone for the rest of the `npm test`
// run (whatever ran after this file alphabetically), cascading into unrelated 500s in
// any code path that touches platform_admin_users (e.g. auth registro's internal-email
// uniqueness check). Snapshot the structure before dropping, and put it back in
// `after()` so this test stays self-contained instead of leaking state to the suite.
beforeEach(async () => {
  await prismaDirectUrl.$executeRaw(Prisma.sql`DROP TABLE IF EXISTS platform_admin_users_test_snapshot`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`CREATE TABLE platform_admin_users_test_snapshot (LIKE platform_admin_users INCLUDING ALL)`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DROP TABLE IF EXISTS platform_admin_users`)
})

after(async () => {
  await prismaDirectUrl.$executeRaw(Prisma.sql`DROP TABLE IF EXISTS platform_admin_users`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`ALTER TABLE platform_admin_users_test_snapshot RENAME TO platform_admin_users`)
  await prismaDirectUrl.$disconnect()
})

test('fresh initialization seeds superadmin with documented credentials', async () => {
  const rows = await prismaDirectUrl.$queryRaw<PlatformAdminRow[]>(Prisma.sql`
    SELECT email, login_alias, password, role_slug, singleton_key, activo
    FROM platform_admin_users
    ORDER BY created_at ASC, id ASC
  `)

  assert.equal(rows.length, 1)
  assert.equal(rows[0]?.email, PLATFORM_SUPERADMIN_EMAIL)
  assert.equal(rows[0]?.login_alias, PLATFORM_SUPERADMIN_LOGIN_ALIAS)
  assert.equal(rows[0]?.role_slug, 'superadmin')
  assert.equal(rows[0]?.singleton_key, 'superadmin')
  assert.equal(Number(rows[0]?.activo), 1)
  assert.equal(await bcrypt.compare(PLATFORM_SUPERADMIN_PASSWORD, String(rows[0]?.password)), true)
})
