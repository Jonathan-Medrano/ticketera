import assert from 'node:assert/strict'
import { after, beforeEach, test } from 'node:test'
import bcrypt from 'bcryptjs'
import { Prisma } from '@prisma/client'
import { prismaDirectUrl } from './lib/prisma'

const TEST_PASSWORD_HASH = '$2a$12$4xM3C8z4Y4G1NeM9eY5Q7uy3x2kB1gVY0j9mJQ0k3kE4dN1s4R6Ku'

type PlatformAdminRow = {
  email: string
  login_alias: string
  password: string
  role_slug: string
  singleton_key: string | null
}

beforeEach(async () => {
  process.env.MARKETPLACE_FEE_MODE = 'percentage'
  process.env.MARKETPLACE_FEE_PERCENTAGE = '12.5'
  process.env.MARKETPLACE_FEE_FIXED_AMOUNT = ''

  // In Postgres/Prisma migration flow, tables already exist from prisma migrate deploy.
  // We only clean test-specific data instead of dropping/recreating tables.
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresa_marketplace_fees WHERE empresa_id LIKE 'phase5-bootstrap-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresa_marketplace_fee_overrides WHERE empresa_id LIKE 'phase5-bootstrap-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_marketplace_fee_defaults WHERE flow IN ('entradas', 'consumibles')`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresas WHERE id LIKE 'phase5-bootstrap-%' OR slug LIKE 'phase5-bootstrap-%'`)

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO empresas (id, nombre, slug, email, password, admin_nombre, activa)
    VALUES ('phase5-bootstrap-emp-1', 'Empresa Bootstrap', 'phase5-bootstrap-emp-1', 'phase5-bootstrap-emp-1@example.com', ${TEST_PASSWORD_HASH}, 'Admin Bootstrap', true)
  `)

  await prismaDirectUrl.$executeRaw(Prisma.sql`
    INSERT INTO empresa_marketplace_fees (id, empresa_id, mode, percentage, fixed_amount)
    VALUES ('phase5-bootstrap-legacy-fee-1', 'phase5-bootstrap-emp-1', 'fixed', NULL, 45.5)
  `)
})

after(async () => {
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresa_marketplace_fees WHERE empresa_id LIKE 'phase5-bootstrap-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresa_marketplace_fee_overrides WHERE empresa_id LIKE 'phase5-bootstrap-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_marketplace_fee_defaults WHERE flow IN ('entradas', 'consumibles')`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM platform_admin_users WHERE email = 'superadmin@platea.local' OR id LIKE 'phase5-bootstrap-%'`)
  await prismaDirectUrl.$executeRaw(Prisma.sql`DELETE FROM empresas WHERE id LIKE 'phase5-bootstrap-%' OR slug LIKE 'phase5-bootstrap-%'`)
  await prismaDirectUrl.$disconnect()
})

test('runtime bootstrap seeds singleton superadmin and backfills fee policy tables from legacy state', async () => {
  const adminRows = await prismaDirectUrl.$queryRaw<PlatformAdminRow[]>(Prisma.sql`
    SELECT email, login_alias, password, role_slug, singleton_key
    FROM platform_admin_users
    WHERE singleton_key = 'superadmin'
    LIMIT 1
  `)

  assert.equal(adminRows.length, 1)
  assert.equal(adminRows[0]?.email, 'superadmin@platea.local')
  assert.equal(adminRows[0]?.login_alias, 'superadmin')
  assert.equal(adminRows[0]?.role_slug, 'superadmin')
  assert.equal(adminRows[0]?.singleton_key, 'superadmin')
  assert.equal(await bcrypt.compare('12345678', String(adminRows[0]?.password)), true)

  const defaultRows = await prismaDirectUrl.$queryRaw<any[]>(Prisma.sql`
    SELECT flow, mode, percentage, fixed_amount
    FROM platform_marketplace_fee_defaults
    ORDER BY flow ASC
  `)
  assert.equal(defaultRows.length, 2)
  assert.deepEqual(
    defaultRows.map((row) => ({ flow: String(row.flow), mode: String(row.mode), percentage: Number(row.percentage ?? 0), fixedAmount: row.fixed_amount === null ? null : Number(row.fixed_amount) })),
    [
      { flow: 'consumibles', mode: 'percentage', percentage: 12.5, fixedAmount: null },
      { flow: 'entradas', mode: 'percentage', percentage: 12.5, fixedAmount: null },
    ]
  )

  const overrideRows = await prismaDirectUrl.$queryRaw<any[]>(Prisma.sql`
    SELECT flow, mode, percentage, fixed_amount
    FROM empresa_marketplace_fee_overrides
    WHERE empresa_id = 'phase5-bootstrap-emp-1'
    ORDER BY flow ASC
  `)
  assert.equal(overrideRows.length, 2)
  assert.deepEqual(
    overrideRows.map((row) => ({ flow: String(row.flow), mode: String(row.mode), percentage: row.percentage === null ? null : Number(row.percentage), fixedAmount: row.fixed_amount === null ? null : Number(row.fixed_amount) })),
    [
      { flow: 'consumibles', mode: 'fixed', percentage: null, fixedAmount: 45.5 },
      { flow: 'entradas', mode: 'fixed', percentage: null, fixedAmount: 45.5 },
    ]
  )

  // Verify owner_fee columns exist on consumibles_ventas (Postgres information_schema)
  const ownerFeeColumnRows = await prismaDirectUrl.$queryRaw<any[]>(Prisma.sql`
    SELECT COUNT(*) as total
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'consumibles_ventas'
      AND column_name IN ('owner_fee_amount', 'owner_fee_currency', 'owner_fee_mode', 'owner_fee_percentage', 'owner_fee_fixed_amount')
  `)
  assert.equal(Number(ownerFeeColumnRows[0]?.total ?? 0), 5)

  // Verify payment tables exist (Postgres information_schema)
  const paymentTableRows = await prismaDirectUrl.$queryRaw<any[]>(Prisma.sql`
    SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name IN ('empresa_payment_accounts', 'platform_payment_accounts')
    ORDER BY table_name ASC
  `)
  assert.deepEqual(paymentTableRows.map((row) => String(row.table_name)), ['empresa_payment_accounts', 'platform_payment_accounts'])
})
