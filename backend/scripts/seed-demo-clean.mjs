/**
 * seed-demo-clean.mjs
 * =====================================================================
 * Borra TODO lo marcado como DEMO: la(s) empresa(s) demo + sus eventos,
 * categorias, stock, entradas, ventas, compradores, usuarios y cualquier
 * dato que un bot de auditoria haya generado al navegar (checkouts, ventas
 * de barra, waitlist, addons, etc.).
 *
 * FILTRO EXACTO (ver lib/demo-seed-shared.mjs): borra SOLO empresas con
 *   es_prueba = true  AND  email endsWith '@demo.ticketera.test'.
 * Nunca usa `LIKE '%demo%'` sobre el nombre -> una empresa REAL llamada
 * "Demo SA" jamas entra, y la empresa de prueba manual `empresaprueba`
 * (otro dominio de email) tampoco se toca.
 *
 * IDEMPOTENTE: si no hay empresas demo, sale sin hacer nada. Cada delete es
 * defensivo (try/catch por tabla): una tabla ausente/renombrada no aborta el
 * resto; se reporta el conteo borrado por tabla.
 *
 * GUARDIA: se niega a correr si la DB destino no es local/test (default-deny),
 * salvo override consciente TICKETERA_ALLOW_PROD=1.
 *
 *   Uso:
 *     npm run seed:demo:clean                 # si el .env apunta a DB local/test
 *     npm run seed:demo:clean -- --test-db    # contra el contenedor de test
 * =====================================================================
 */

import 'dotenv/config'
import {
  DEMO_EMAIL_DOMAIN,
  isDemoEmail,
  bootstrapDemoPrisma,
} from './lib/demo-seed-shared.mjs'

const { prisma, source } = bootstrapDemoPrisma()

async function main() {
  console.log(`[seed-demo-clean] destino: ${source}`)

  // 1) Identificar empresas demo con filtro EXACTO (doble condicion).
  const empresas = await prisma.empresa.findMany({
    where: {
      es_prueba: true,
      email: { endsWith: `@${DEMO_EMAIL_DOMAIN}` },
    },
    select: { id: true, slug: true, email: true, nombre: true },
  })

  // Cinturon y tiranta: re-validar el sufijo en JS (Prisma `endsWith` ya es exacto,
  // esto es solo una defensa extra contra cualquier sorpresa de driver).
  const demo = empresas.filter((e) => isDemoEmail(e.email))

  if (demo.length === 0) {
    console.log('[seed-demo-clean] No hay empresas demo. Nada que borrar (idempotente).')
    return
  }

  const empresaIds = demo.map((e) => e.id)
  console.log(`[seed-demo-clean] Empresas demo a borrar (${demo.length}):`)
  for (const e of demo) console.log(`   - ${e.nombre} <${e.email}> (slug=${e.slug}, id=${e.id})`)

  // 2) Resolver IDs hijos para las tablas que NO tienen empresa_id.
  const eventos = await prisma.evento.findMany({ where: { empresa_id: { in: empresaIds } }, select: { id: true } })
  const eventoIds = eventos.map((e) => e.id)

  const barras = await prisma.barra.findMany({ where: { empresa_id: { in: empresaIds } }, select: { id: true } })
  const barraIds = barras.map((b) => b.id)

  const ventas = await prisma.consumiblesVenta.findMany({ where: { empresa_id: { in: empresaIds } }, select: { id: true } })
  const ventaIds = ventas.map((v) => v.id)

  const inEmpresa = { empresa_id: { in: empresaIds } }
  const inEvento = { evento_id: { in: eventoIds } }
  const inBarra = { barra_id: { in: barraIds } }
  const inVenta = { venta_id: { in: ventaIds } }

  // 3) Plan de borrado (hijos -> padres). NO hay FKs en la DB (el schema Prisma
  //    no define @relation), asi que el orden es por claridad, no por constraint.
  //    Cada paso es defensivo: si una tabla no existe/cambio, se loguea y sigue.
  const steps = [
    // -- consumibles / barra --
    ['consumibles_venta_resolucion_items', () => prisma.consumiblesVentaResolucionItem.deleteMany({ where: inVenta })],
    ['consumibles_venta_items',            () => prisma.consumiblesVentaItem.deleteMany({ where: inVenta })],
    ['consumibles_ventas',                 () => prisma.consumiblesVenta.deleteMany({ where: inEmpresa })],
    ['consumibles_canje_auditoria',        () => prisma.consumiblesCanjeAuditoria.deleteMany({ where: inEmpresa })],
    ['consumibles_promociones',            () => prisma.consumiblePromocion.deleteMany({ where: inEmpresa })],
    ['barra_restock_alertas',              () => prisma.barraRestockAlerta.deleteMany({ where: inEmpresa })],
    ['barra_stock_logs',                   () => prisma.barraStockLog.deleteMany({ where: inEmpresa })],
    ['barra_stock',                        () => prisma.barraStock.deleteMany({ where: inBarra })],
    ['barras',                             () => prisma.barra.deleteMany({ where: inEmpresa })],
    ['consumibles',                        () => prisma.consumible.deleteMany({ where: inEmpresa })],
    // -- entradas / eventos --
    ['entradas',                           () => prisma.entrada.deleteMany({ where: inEvento })],
    ['evento_addon_ventas',                () => prisma.eventoAddonVenta.deleteMany({ where: inEmpresa })],
    ['evento_addons',                      () => prisma.eventoAddon.deleteMany({ where: inEmpresa })],
    ['ticket_fisicos',                     () => prisma.ticketFisico.deleteMany({ where: inEmpresa })],
    ['ticket_fisico_lotes',                () => prisma.ticketFisicoLote.deleteMany({ where: inEmpresa })],
    ['waitlist_entries',                   () => prisma.waitlistEntry.deleteMany({ where: inEmpresa })],
    ['entrada_categorias',                 () => prisma.entradaCategoria.deleteMany({ where: inEvento })],
    ['evento_tandas',                      () => prisma.eventoTanda.deleteMany({ where: inEvento })],
    ['evento_fechas',                      () => prisma.eventoFecha.deleteMany({ where: inEvento })],
    ['evento_ventas_snapshot',             () => prisma.eventoVentasSnapshot.deleteMany({ where: inEvento })],
    // -- checkout / pagos / refunds --
    ['checkout_sessions',                  () => prisma.checkoutSession.deleteMany({ where: inEmpresa })],
    ['processed_webhooks',                 () => prisma.processedWebhook.deleteMany({ where: inEmpresa })],
    ['refund_manual_cases',                () => prisma.refundManualCase.deleteMany({ where: inEmpresa })],
    ['empresa_payment_accounts',           () => prisma.empresaPaymentAccount.deleteMany({ where: inEmpresa })],
    ['empresa_marketplace_fee_overrides',  () => prisma.empresaMarketplaceFeeOverride.deleteMany({ where: inEmpresa })],
    ['delivery_dispatch_attempts',         () => prisma.deliveryDispatchAttempt.deleteMany({ where: inEmpresa })],
    ['buyer_phone_verification_challenges',() => prisma.buyerPhoneVerificationChallenge.deleteMany({ where: inEmpresa })],
    // -- marketing --
    ['marketing_codigos_descuento',        () => prisma.marketingCodigoDescuento.deleteMany({ where: inEmpresa })],
    ['marketing_segmentos',                () => prisma.marketingSegmento.deleteMany({ where: inEmpresa })],
    ['marketing_campanas',                 () => prisma.marketingCampana.deleteMany({ where: inEmpresa })],
    ['marketing_oauth_accounts',           () => prisma.marketingOAuthAccount.deleteMany({ where: inEmpresa })],
    // -- plataforma / soporte / actividad --
    ['platform_message_dismissals',        () => prisma.platformMessageDismissal.deleteMany({ where: inEmpresa })],
    ['platform_impersonation_tokens',      () => prisma.platformImpersonationToken.deleteMany({ where: inEmpresa })],
    ['platform_sale_allocations',          () => prisma.platformSaleAllocation.deleteMany({ where: inEmpresa })],
    ['empleados_actividad',                () => prisma.empleadoActividad.deleteMany({ where: inEmpresa })],
    ['soporte_mensajes',                   () => prisma.soporteMensaje.deleteMany({ where: inEmpresa })],
    // -- identidad / auth --
    ['email_verification_codes',           () => prisma.emailVerificationCode.deleteMany({ where: inEmpresa })],
    ['password_reset_tokens',              () => prisma.passwordResetToken.deleteMany({ where: inEmpresa })],
    ['roles',                              () => prisma.rol.deleteMany({ where: inEmpresa })],
    ['usuarios',                           () => prisma.usuario.deleteMany({ where: inEmpresa })],
    ['compradores',                        () => prisma.comprador.deleteMany({ where: inEmpresa })],
    ['eventos',                            () => prisma.evento.deleteMany({ where: inEmpresa })],
    // -- finalmente, la empresa --
    ['empresas',                           () => prisma.empresa.deleteMany({ where: { id: { in: empresaIds } } })],
  ]

  let totalBorrado = 0
  for (const [tabla, run] of steps) {
    try {
      const { count } = await run()
      totalBorrado += count
      if (count > 0) console.log(`  [del] ${tabla.padEnd(38)} ${count}`)
    } catch (e) {
      console.warn(`  [skip] ${tabla.padEnd(38)} (${e.code || e.message})`)
    }
  }

  console.log('\n========================================')
  console.log('CLEANUP DEMO OK')
  console.log(`  Empresas demo borradas : ${demo.length}`)
  console.log(`  Filas borradas (total) : ${totalBorrado}`)
  console.log('========================================\n')
}

main()
  .catch((e) => {
    console.error('FATAL:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
