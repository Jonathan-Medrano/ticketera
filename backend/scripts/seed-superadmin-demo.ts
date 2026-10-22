import pool from '../src/db'
import { seedSuperadminDemoData } from '../src/lib/superadmin-demo-seed'

async function main() {
  try {
    const summary = await seedSuperadminDemoData()
    console.log(JSON.stringify({ ok: true, summary }, null, 2))
  } finally {
    await pool.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
