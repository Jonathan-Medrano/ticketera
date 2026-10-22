/**
 * capturas.mjs — saca las capturas del portfolio contra el entorno LOCAL (datos de demo).
 * Uso (con backend :3001, frontend :3000 y la base sembrada con seed:demo + seed-portfolio):
 *   node scripts/capturas.mjs [publico|empresa|superadmin]   (sin argumento: todo)
 * Salida: docs/capturas/*.png (1440x900 a 2x; páginas largas en alto completo).
 * Requiere @playwright/test (está en platea/).
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'platea', 'package.json'))
const { chromium, devices } = require('@playwright/test')

const BASE = 'http://localhost:3000'
const OUT = path.join(root, 'docs', 'capturas')
fs.mkdirSync(OUT, { recursive: true })

const EMPRESA = { email: 'demo@demo.ticketera.test', password: 'Demo1234!' }
// La contraseña del superadmin es la que se pasó a `prisma db seed` (SUPERADMIN_PASSWORD).
const SUPERADMIN = { email: 'admin@ticketera.com', password: process.env.SUPERADMIN_PASSWORD ?? '' }
const TENANT = 'nocturna'

// [nombre, url, fullPage]
const PUBLICO = [
  ['01-landing', '/', true],
  ['02-precios', '/precios', true],
  ['03-login', '/login', false],
  ['04-sitio-publico-tenant', `/t/${TENANT}`, true],
]
const EMPRESA_PAGES = [
  ['10-dashboard', '/dashboard', true],
  ['11-eventos', '/dashboard/eventos', true],
  ['12-evento-nuevo', '/dashboard/eventos/nuevo', true],
  ['13-ventas', '/dashboard/ventas', true],
  ['14-cobros-mercado-pago', '/dashboard/cobros', true],
  ['15-sitio-venta-editor', '/sitio-venta/editor', false],
  ['16-consumibles-catalogo', '/dashboard/consumibles', true],
  ['17-pos', '/dashboard/pos', false],
  ['17a-escanear-qr', '/dashboard/escanear', false],
  ['17b-consumibles-canjear', '/dashboard/consumibles/canjear', false],
  ['17c-consumibles-vender', '/dashboard/consumibles/vender', false],
  ['18-equipo', '/dashboard/equipo', true],
  ['19-roles', '/dashboard/roles', true],
  ['20-comisiones', '/dashboard/comisiones', true],
  ['21-marketing', '/dashboard/marketing', false],
  ['21a-marketing-promociones', '/dashboard/marketing/promociones', true],
  ['21b-marketing-segmentos', '/dashboard/marketing/segmentos', true],
  ['21c-marketing-email', '/dashboard/marketing/email', true],
  ['21d-marketing-analitica', '/dashboard/marketing/analitica', true],
  ['16a-consumibles-ventas', '/dashboard/consumibles/ventas', true],
  ['16b-consumibles-promociones', '/dashboard/consumibles/promociones', true],
  ['22-reconciliacion', '/dashboard/reconciliacion', true],
  ['23-reembolsos', '/dashboard/reembolsos', true],
  ['24-revendedores', '/dashboard/revendedores', true],
  ['25-compradores', '/dashboard/compradores', true],
  ['26-eventos-velocity', '/dashboard/eventos/velocity', true],
]
const SUPER_PAGES = [
  ['30-super-dashboard', '/super-admin/dashboard', true],
  ['31-super-empresas', '/super-admin/empresas', true],
  ['32-super-comisiones', '/super-admin/comisiones', true],
  ['33-super-fee-tiers', '/super-admin/fee-tiers', true],
  ['34-super-configuracion', '/super-admin/configuracion', true],
  ['35-super-usuarios', '/super-admin/usuarios', true],
  ['36-super-auditoria', '/super-admin/auditoria', true],
  ['37-super-rendimiento', '/super-admin/rendimiento', true],
  ['38-super-analitica', '/super-admin/analitica', true],
]

// Oculta el badge de Next dev y el widget de chat para que las capturas queden limpias.
const LIMPIAR = 'nextjs-portal, [data-nextjs-dev-tools-button], .fixed.bottom-4.right-6 { display: none !important }'

async function login(page, { email, password }) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' })
  await page.locator('input[name="email"]').first().fill(email)
  await page.locator('input[name="current-password"]').first().fill(password)
  await page.locator('button[type="submit"]').first().click()
  await page.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 })
}

async function go(page, url) {
  try { await page.goto(url, { waitUntil: 'networkidle', timeout: 90000 }) }
  catch { await page.waitForLoadState('domcontentloaded'); await page.waitForTimeout(4000) }
}

/** Recorre la página para disparar las imágenes con carga diferida y vuelve arriba (el header sticky queda en su lugar). */
async function cargarTodo(page) {
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += 500) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 140)) }
    window.scrollTo(0, 0)
  })
  await page.waitForTimeout(1200)
}

async function shoot(page, name, fullPage) {
  // El layout es 100vh con scroll interno: para páginas largas se agranda el viewport en vez de usar fullPage.
  for (const f of page.frames()) await f.addStyleTag({ content: LIMPIAR }).catch(() => {})
  const docScroll = name >= '50' && name < '70' && !/qr/.test(name)
  if (docScroll) await cargarTodo(page)
  await page.waitForTimeout(3500)
  // Páginas con scroll de documento (sitio público): fullPage real; el resto, viewport alto.
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: docScroll })
  console.log('ok  ', name, '→', page.url().replace(BASE, ''))
}

async function shootAll(page, list) {
  for (const [name, url, full] of list) {
    try {
      await page.setViewportSize({ width: 1440, height: full ? 1500 : 900 })
      await go(page, BASE + url)
      await shoot(page, name, full)
    } catch (e) {
      console.log('FAIL', name, e.message.split('\n')[0])
    }
  }
}

const which = process.argv[2]
const browser = await chromium.launch()
const ctx = () => browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, locale: 'es-AR' })

if (!which || which === 'publico') {
  const c = await ctx(); const p = await c.newPage()
  await shootAll(p, PUBLICO)
  // Página pública de un evento (el primero del sitio del tenant)
  await p.goto(`${BASE}/t/${TENANT}`, { waitUntil: 'networkidle' })
  const href = await p.locator(`a[href*="/evento/"]`).first().getAttribute('href').catch(() => null)
  if (href) { await go(p, BASE + href); await shoot(p, '05-evento-publico', true) }
  await c.close()
}
if (!which || which === 'empresa') {
  const c = await ctx(); const p = await c.newPage()
  await login(p, EMPRESA)
  await shootAll(p, EMPRESA_PAGES)
  await p.goto(`${BASE}/dashboard/eventos`, { waitUntil: 'networkidle' })
  // Evento de referencia: "Noche Eléctrica Vol. 7" (tiene lista de espera y consumibles); si no está, el primero.
  const href = await p.evaluate(() => {
    const links = [...document.querySelectorAll('a[href^="/dashboard/eventos/"]')].filter((a) => /\/[0-9a-f-]{36}$/.test(a.getAttribute('href')))
    const pick = links.find((a) => (a.closest('div[class*="rounded"]')?.innerText ?? a.innerText).includes('Noche Eléctrica')) ?? links[0]
    return pick?.getAttribute('href') ?? null
  })
  if (href) {
    await go(p, BASE + href); await shoot(p, '40-evento-detalle', true)
    await go(p, `${BASE}${href}/editar`); await shoot(p, '41-evento-editar', true)
    await go(p, `${BASE}${href}/preimpresos`); await shoot(p, '42-evento-preimpresos', true)
    await go(p, `${BASE}${href}/waitlist`); await shoot(p, '43-evento-lista-espera', true)
  }
  await c.close()
}
if (!which || which === 'superadmin') {
  const c = await ctx(); const p = await c.newPage()
  await login(p, SUPERADMIN)
  await shootAll(p, SUPER_PAGES)
  await c.close()
}
async function revalidar() {
  const secret = process.env.INTERNAL_API_SECRET
  if (!secret) return
  await fetch(`${BASE}/api/internal/revalidate-tenant`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': secret }, body: JSON.stringify({ slug: TENANT }) }).catch(() => {})
}
async function loginComprador(page) {
  await page.goto(`${BASE}/t/${TENANT}/auth?redirect=mis-tickets`, { waitUntil: 'networkidle' })
  await page.locator('input[type="email"]').fill('comprador@demo.ticketera.test')
  await page.locator('input[type="password"]').fill('Demo1234!')
  await page.locator('button[type="submit"]').click()
  await page.waitForURL((u) => u.pathname.endsWith('/mis-tickets'), { timeout: 30000 })
}

if (!which || which === 'comprador') {
  // Flujo del comprador en el sitio del tenant: evento → selección → carrito → mis tickets (QR) → consumibles → pago.
  execSync('npx tsx scripts/seed-portfolio-sitio.ts premium', { cwd: path.join(root, 'backend'), stdio: 'inherit' })
  await revalidar()
  for (const mobile of [false, true]) {
    const c = mobile
      ? await browser.newContext({ ...devices['iPhone 14'], locale: 'es-AR' })
      : await ctx()
    const p = await c.newPage()
    // En el celular se captura SIEMPRE el viewport (lo que vería la persona) y nunca la página entera.
    // El desborde lateral de carruseles dejaba una franja blanca: se recorta el eje X.
    const limpiarMovil = async () => { if (mobile) await p.addStyleTag({ content: 'html,body{overflow-x:hidden !important}' }).catch(() => {}) }
    const shotMovil = async (name) => {
      await limpiarMovil()
      for (const f of p.frames()) await f.addStyleTag({ content: LIMPIAR }).catch(() => {})
      await p.waitForTimeout(1500)
      await p.screenshot({ path: path.join(OUT, `${name}.png`) })
      console.log('ok  ', name, '→', p.url().replace(BASE, ''))
    }
    const pre = mobile ? '7' : '6'
    const sh = (n, name, full) => (mobile ? shotMovil(`${pre}${n}-${name}`) : shoot(p, `${pre}${n}-${name}`, full))

    await loginComprador(p)
    await p.waitForTimeout(3000)
    await sh(3, 'mis-tickets', true)
    await p.getByText('Noche Eléctrica Vol. 7').first().click()
    await p.waitForSelector('[role="dialog"] canvas, [role="dialog"] svg, [role="dialog"] img', { timeout: 15000 }).catch(() => {})
    await p.waitForTimeout(2500)
    await sh(4, 'ticket-qr', false)
    await p.keyboard.press('Escape')
    // Home del sitio (sólo móvil: el escritorio ya tiene las capturas 50-*)
    if (mobile) {
      await go(p, `${BASE}/t/${TENANT}`); await p.waitForTimeout(3000)
      await shotMovil(`${pre}9-home`)
    }
    // Evento Noche Eléctrica: la 3ª tarjeta del home
    await go(p, `${BASE}/t/${TENANT}`); await p.waitForTimeout(2500)
    const hrefs = await p.evaluate(() => [...new Set([...document.querySelectorAll('a[href*="/evento/"]')].map((a) => a.getAttribute('href')))])
    const ev = hrefs.find((h) => h.includes('679baf76')) ?? hrefs[2]
    await go(p, BASE + ev); await p.waitForTimeout(3000); await go(p, BASE + ev); await p.waitForTimeout(2500)
    await sh(0, 'evento-entradas', true)
    const vip = p.getByRole('button', { name: /VIP/ }).first()
    if (await vip.count()) {
      await vip.click(); await p.getByRole('button', { name: 'Agregar unidad' }).first().click(); await p.getByRole('button', { name: 'Agregar unidad' }).first().click()
      await p.getByRole('button', { name: /^Agregar$/ }).first().click().catch(() => {})
      await p.waitForTimeout(2500)
      await sh(1, 'evento-seleccion', true)
      // Zona de entradas en el viewport (más legible que la página completa)
      await p.getByText('ENTRADAS DISPONIBLES').first().scrollIntoViewIfNeeded()
      await p.evaluate((m) => window.scrollBy(0, m ? -110 : -90), mobile); await p.waitForTimeout(900)
      if (mobile) await shotMovil(`${pre}1b-seleccion-detalle`)
      else { await p.screenshot({ path: path.join(OUT, `${pre}1b-seleccion-detalle.png`) }); console.log('ok  ', `${pre}1b-seleccion-detalle`) }
    }
    // Carrito → checkout: se navega con el link del header (el carrito vive en el cliente)
    await p.evaluate(() => window.scrollTo(0, 0))
    await p.getByRole('link', { name: /carrito/i }).first().click().catch(() => {})
    await p.waitForLoadState('networkidle').catch(() => {}); await p.waitForTimeout(3500)
    await sh(2, 'checkout', true)
    await go(p, `${BASE}/t/${TENANT}/consumibles`); await p.waitForTimeout(3000)
    await sh(5, 'consumibles', true)
    await go(p, `${BASE}/t/${TENANT}/consumibles/mis-compras`); await p.waitForTimeout(3000)
    await sh(6, 'mis-compras-consumibles', true)
    await go(p, `${BASE}/t/${TENANT}/pago/exito`); await p.waitForTimeout(3000)
    await sh(8, 'pago-exito', true)
    await c.close()
  }
}

if (!which || which === 'sitio') {
  // Sitio público del tenant con cada plantilla base del editor (el seed aplica la plantilla y revalida el cache).
  const PLANTILLAS = ['nocturna', 'vibrante', 'premium', 'clara', 'tech', 'urbano', 'under', 'pastel']
  const c = await ctx(); const p = await c.newPage()
  const m = await browser.newContext({ ...devices['iPhone 14'], locale: 'es-AR' })
  const pm = await m.newPage()
  for (const [i, tpl] of PLANTILLAS.entries()) {
    execSync(`npx tsx scripts/seed-portfolio-sitio.ts ${tpl}`, { cwd: path.join(root, 'backend'), stdio: 'inherit' })
    await p.setViewportSize({ width: 1440, height: 900 })
    await go(p, `${BASE}/t/nocturna`)   // 1ª visita: el cache sirve lo viejo y se regenera en segundo plano
    await p.waitForTimeout(3000)
    await go(p, `${BASE}/t/nocturna`)
    await p.waitForTimeout(2500)
    await shoot(p, `50-sitio-${String(i + 1).padStart(2, '0')}-${tpl}`, true)
    if (tpl === 'vibrante' || tpl === 'premium') {
      await go(pm, `${BASE}/t/nocturna`); await pm.waitForTimeout(2500)
      await go(pm, `${BASE}/t/nocturna`); await pm.waitForTimeout(2500)
      await pm.addStyleTag({ content: 'html,body{overflow-x:hidden !important}' + LIMPIAR })
      await pm.waitForTimeout(1500)
      await pm.screenshot({ path: path.join(OUT, `55-sitio-movil-${tpl}.png`) })   // viewport, como se ve en el teléfono
      console.log('ok  ', `55-sitio-movil-${tpl}`)
    }
  }
  // Página de un evento con la plantilla final
  execSync('npx tsx scripts/seed-portfolio-sitio.ts premium', { cwd: path.join(root, 'backend'), stdio: 'inherit' })
  await go(p, `${BASE}/t/nocturna`)
  const href = await p.locator('a[href*="/evento/"]').first().getAttribute('href').catch(() => null)
  if (href) { await go(p, BASE + href); await p.waitForTimeout(2500); await shoot(p, '56-sitio-evento-premium', true) }
  await c.close(); await m.close()
}
await browser.close()
