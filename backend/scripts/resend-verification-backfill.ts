/**
 * Backfill: reenvía el email de verificación (código + magic-link) a todas las
 * empresas que quedaron sin verificar — las que nunca recibieron el código por el
 * bug de la API key de Resend.
 *
 * Uso:
 *   node --import tsx scripts/resend-verification-backfill.ts            # DRY RUN (solo lista/cuenta)
 *   node --import tsx scripts/resend-verification-backfill.ts --send     # reenvía de verdad (throttled)
 *
 * Requiere que la migración link_token_hash esté aplicada en la DB y la
 * RESEND_API_KEY correcta en el .env. Pensado para correr local contra prod.
 */
import { prisma } from '../src/lib/prisma'
import { sendEmailVerificationCode } from '../src/lib/email-verification'

const SEND = process.argv.includes('--send')
const DELAY_MS = 800 // throttle para respetar el rate limit de Resend

async function main() {
  const pendientes = await prisma.empresa.findMany({
    where: { email_verificado: false },
    select: { id: true, email: true, nombre: true },
    orderBy: { nombre: 'asc' },
  })

  console.log(`Empresas sin verificar: ${pendientes.length}`)
  for (const e of pendientes) {
    console.log(`  - ${e.nombre} <${e.email}>`)
  }

  if (!SEND) {
    console.log('\nDRY RUN — no se envió nada. Corré con --send para reenviar.')
    return
  }

  let ok = 0
  let fail = 0
  for (const e of pendientes) {
    try {
      await sendEmailVerificationCode({ empresaId: e.id, email: e.email })
      ok++
      console.log(`✓ ${e.email}`)
    } catch (err) {
      fail++
      console.log(`✗ ${e.email}: ${err instanceof Error ? err.message : String(err)}`)
    }
    await new Promise((r) => setTimeout(r, DELAY_MS))
  }
  console.log(`\nListo. Enviados: ${ok}, fallidos: ${fail}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
