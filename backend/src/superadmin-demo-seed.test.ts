import './test-env'

import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { prisma } from './lib/prisma'
import {
  cleanupSuperadminDemoData,
  seedSuperadminDemoData,
  SUPERADMIN_DEMO_COMPANY_SLUG_PREFIX,
} from './lib/superadmin-demo-seed'

test('superadmin demo seed is re-runnable and leaves visible platform data', async () => {
  await cleanupSuperadminDemoData()

  const firstRun = await seedSuperadminDemoData()
  const secondRun = await seedSuperadminDemoData()

  assert.equal(firstRun.counts.companies, 5)
  assert.equal(secondRun.counts.companies, 5)
  assert.equal(secondRun.counts.entradas, 9)
  assert.equal(secondRun.counts.consumiblesVentas, 8)
  assert.equal(secondRun.ownerPaymentAccountStatus, 'ready_to_sell')
  assert.equal(secondRun.dashboard.gananciasOwner > 0, true)
  assert.equal(secondRun.dashboardSeriesDays >= 6, true)
  assert.equal(secondRun.bestCompany?.nombre, 'Demo Atlas Shows')

  const demoCompanies = secondRun.demoCompanies
  assert.equal(demoCompanies.length, 5)
  assert.equal(demoCompanies.some((company) => company.readiness === 'ready_to_sell'), true)
  assert.equal(demoCompanies.some((company) => company.readiness === 'pending_validation'), true)
  assert.equal(demoCompanies.some((company) => company.readiness === 'blocked'), true)
  assert.equal(demoCompanies.some((company) => company.ventas === 0), true)
  assert.equal(demoCompanies.some((company) => company.feeSourceEntradas === 'empresa'), true)
  assert.equal(demoCompanies.some((company) => company.feeSourceConsumibles === 'empresa'), true)
  assert.equal(secondRun.platformFeeDefaults.entradas.configured, true)
  assert.equal(secondRun.platformFeeDefaults.consumibles.configured, true)

  const rows = await prisma.$queryRaw<Array<{ slug: string }>>`
    SELECT slug FROM empresas WHERE slug ILIKE ${`${SUPERADMIN_DEMO_COMPANY_SLUG_PREFIX}%`} ORDER BY slug ASC
  `
  assert.equal(rows.length, 5)
})

after(async () => {
  await cleanupSuperadminDemoData()
  await prisma.$disconnect()
})
