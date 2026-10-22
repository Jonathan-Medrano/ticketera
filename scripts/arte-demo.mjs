/**
 * arte-demo.mjs — genera el arte de la demo (flyers de eventos, banners del sitio, fotos de producto
 * de la barra y logos de auspiciantes) como imágenes propias, sin fotos de stock ni licencias.
 *
 * Salida: platea/public/demo/*.jpg|png (el seed de los sitios y de los eventos apunta ahí).
 * Uso:  node scripts/arte-demo.mjs        (requiere platea/node_modules por @playwright/test)
 */
import { createRequire } from 'node:module'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const require = createRequire(path.join(root, 'platea', 'package.json'))
const { chromium } = require('@playwright/test')
const OUT = path.join(root, 'platea', 'public', 'demo')
fs.mkdirSync(OUT, { recursive: true })

const DISPLAY = "Impact, 'Arial Narrow Bold', 'Bahnschrift', sans-serif"
const TEXT = "'Segoe UI', 'Helvetica Neue', Arial, sans-serif"

const base = (css, body) => `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:100%;height:100%;overflow:hidden}
.d{font-family:${DISPLAY};text-transform:uppercase;letter-spacing:.02em;line-height:.92}
.t{font-family:${TEXT}}
${css}
</style></head><body>${body}</body></html>`

// ───────────────────────── FLYERS 1920×1080 (el contenido va en el centro 4:3) ─────────────────────────

const flyers = {
  'noche-electrica': base(
    `body{background:linear-gradient(180deg,#0a0420 0%,#1b0b4d 48%,#3a0f6b 100%);position:relative}
     .sun{position:absolute;left:50%;top:380px;width:640px;height:640px;margin-left:-320px;border-radius:50%;
       background:linear-gradient(180deg,#ff2ea6 0%,#ff7a3d 60%,#ffd23d 100%);filter:drop-shadow(0 0 80px rgba(255,46,166,.55))}
     .sun::after{content:"";position:absolute;inset:0;border-radius:50%;
       background:repeating-linear-gradient(180deg,transparent 0 34px,#2a0c5c 34px 46px);mask:linear-gradient(180deg,transparent 52%,#000 52%)}
     .grid{position:absolute;left:-10%;right:-10%;bottom:-40px;height:430px;background:
       linear-gradient(#0a0420 0 0) top/100% 3px no-repeat,
       repeating-linear-gradient(90deg,rgba(47,242,255,.75) 0 2px,transparent 2px 120px),
       repeating-linear-gradient(0deg,rgba(47,242,255,.75) 0 2px,transparent 2px 60px);
       transform:perspective(520px) rotateX(58deg);transform-origin:top;opacity:.9}
     .horizon{position:absolute;left:0;right:0;top:672px;height:6px;background:#2ff2ff;box-shadow:0 0 40px 8px rgba(47,242,255,.7)}
     .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;padding-top:130px;color:#fff;text-align:center}
     .k{font-size:34px;letter-spacing:.5em;color:#2ff2ff}
     .h{font-size:190px;margin-top:14px;text-shadow:0 0 50px rgba(255,46,166,.8),0 6px 0 #ff2ea6}
     .v{font-size:96px;color:#ffd23d;margin-top:10px}
     .f{position:absolute;bottom:64px;left:0;right:0;text-align:center;color:#fff;font-size:30px;letter-spacing:.1em}`,
    `<div class="sun"></div><div class="horizon"></div><div class="grid"></div>
     <div class="wrap"><div class="d k t">Nocturna presenta</div><div class="d h">Noche<br>Eléctrica</div><div class="d v">Vol. 7</div></div>
     <div class="f t">12 NOV · COMPLEJO FORUM</div>`),

  'festival-cumbre': base(
    `body{background:linear-gradient(180deg,#ff8a3d 0%,#ff4d6d 38%,#7a1fa2 100%);position:relative}
     .sun{position:absolute;left:50%;top:300px;width:520px;height:520px;margin-left:-260px;border-radius:50%;background:#ffe08a;box-shadow:0 0 140px 40px rgba(255,224,138,.55)}
     svg{position:absolute;left:0;bottom:0;width:100%;height:520px}
     .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;padding-top:120px;color:#fff;text-align:center}
     .k{font-size:34px;letter-spacing:.5em;color:#fff3d1}
     .h{font-size:200px;margin-top:12px;text-shadow:0 8px 0 rgba(90,10,60,.55)}
     .v{font-size:110px;color:#4a0e6e;margin-top:8px;text-shadow:0 4px 0 rgba(255,255,255,.55)}
     .f{position:absolute;bottom:62px;left:0;right:0;text-align:center;color:#fff;font-size:30px;letter-spacing:.1em}`,
    `<div class="sun"></div>
     <svg viewBox="0 0 1920 520" preserveAspectRatio="none"><polygon fill="#5a1480" points="0,520 0,300 240,170 420,290 640,120 900,300 1120,150 1380,310 1620,190 1920,330 1920,520"/>
     <polygon fill="#3b0b5c" points="0,520 0,400 300,300 520,390 780,280 1040,400 1300,300 1560,400 1760,330 1920,410 1920,520"/>
     <polygon fill="#1d0536" points="0,520 0,460 380,400 760,470 1160,410 1540,470 1920,420 1920,520"/></svg>
     <div class="wrap"><div class="d k t">3 escenarios · 12 horas</div><div class="d h">Festival<br>Cumbre</div><div class="d v">2026</div></div>
     <div class="f t">9 DIC · PARQUE SARMIENTO</div>`),

  'sunset-rooftop': base(
    `body{background:linear-gradient(180deg,#ffd9a0 0%,#ff9d6c 34%,#d9558a 66%,#4b2a7a 100%);position:relative}
     .sun{position:absolute;left:50%;top:330px;width:420px;height:420px;margin-left:-210px;border-radius:50%;background:linear-gradient(180deg,#fff2c9,#ffc46b);box-shadow:0 0 120px 30px rgba(255,200,120,.6)}
     svg{position:absolute;left:0;bottom:0;width:100%;height:430px}
     .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;padding-top:110px;color:#2a0f3f;text-align:center}
     .k{font-size:34px;letter-spacing:.5em;color:#5b1f55}
     .h{font-size:158px;margin-top:12px;color:#fff;text-shadow:0 7px 0 rgba(120,30,90,.5)}
     .v{font-size:92px;color:#fff3d1;margin-top:8px;letter-spacing:.2em}
     .f{position:absolute;bottom:62px;left:0;right:0;text-align:center;color:#fff;font-size:30px;letter-spacing:.1em}`,
    `<div class="sun"></div>
     <svg viewBox="0 0 1920 430" preserveAspectRatio="none"><g fill="#2b1450"><rect x="0" y="250" width="150" height="180"/><rect x="170" y="170" width="120" height="260"/><rect x="310" y="230" width="170" height="200"/>
     <rect x="500" y="120" width="130" height="310"/><rect x="650" y="210" width="190" height="220"/><rect x="860" y="150" width="150" height="280"/><rect x="1030" y="240" width="170" height="190"/>
     <rect x="1220" y="100" width="140" height="330"/><rect x="1380" y="200" width="200" height="230"/><rect x="1600" y="160" width="130" height="270"/><rect x="1750" y="230" width="170" height="200"/></g>
     <g fill="#ffc46b" opacity=".85"><rect x="190" y="200" width="14" height="14"/><rect x="230" y="250" width="14" height="14"/><rect x="520" y="160" width="14" height="14"/><rect x="560" y="220" width="14" height="14"/>
     <rect x="880" y="190" width="14" height="14"/><rect x="1240" y="150" width="14" height="14"/><rect x="1290" y="240" width="14" height="14"/><rect x="1640" y="210" width="14" height="14"/></g></svg>
     <div class="wrap"><div class="d k t">Música en la terraza</div><div class="d h">Sunset<br>Rooftop</div><div class="d v">Sessions</div></div>
     <div class="f t">SÁB 10 OCT · BUEN PASTOR</div>`),

  'fiesta-retro': base(
    `body{background:#1a1a40;position:relative}
     .a{position:absolute;width:520px;height:520px;border-radius:50%;background:#ff3d9a;left:-120px;top:-150px}
     .b{position:absolute;width:0;height:0;border-left:260px solid transparent;border-right:260px solid transparent;border-bottom:450px solid #2de2c8;right:-60px;top:-80px;transform:rotate(18deg)}
     .c{position:absolute;width:340px;height:340px;background:#ffe23d;right:230px;bottom:-110px;transform:rotate(24deg)}
     .e{position:absolute;left:150px;bottom:-60px;width:420px;height:420px;border-radius:50%;border:60px solid #ff7a2e}
     .z{position:absolute;left:36%;top:48px;width:360px;height:70px;background:repeating-linear-gradient(135deg,#fff 0 18px,transparent 18px 36px);opacity:.9}
     .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;text-align:center}
     .k{font-size:36px;letter-spacing:.45em;color:#ffe23d;background:#1a1a40;padding:10px 26px}
     .h{font-size:240px;margin-top:20px;text-shadow:8px 8px 0 #ff3d9a,16px 16px 0 #2de2c8}
     .v{font-size:130px;color:#1a1a40;background:#ffe23d;padding:6px 36px;margin-top:34px;transform:rotate(-3deg)}
     .f{position:absolute;bottom:58px;left:0;right:0;text-align:center;color:#fff;font-size:30px;letter-spacing:.1em}`,
    `<div class="a"></div><div class="b"></div><div class="c"></div><div class="e"></div><div class="z"></div>
     <div class="wrap"><div class="d k t">Todos los viernes</div><div class="d h">Fiesta<br>Retro</div><div class="d v">Hits de los 90s</div></div>
     <div class="f t">JUE 17 SEP · QUALITY ESPACIO</div>`),
}

// ───────────────────────── BANNERS 1920×700 ─────────────────────────

const banners = {
  'banner-1': base(
    `body{background:linear-gradient(100deg,#1b0b4d,#7a1fa2 55%,#ff4d6d);position:relative}
     .r{position:absolute;right:-80px;top:-160px;width:760px;height:760px;border-radius:50%;border:70px solid rgba(255,255,255,.12)}
     .r2{position:absolute;right:140px;top:130px;width:360px;height:360px;border-radius:50%;background:linear-gradient(180deg,#ffd23d,#ff4d6d)}
     .w{position:absolute;left:280px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;color:#fff}
     .k{font-size:34px;letter-spacing:.45em;color:#ffd23d}.h{font-size:150px;margin:14px 0}.f{font-size:36px;letter-spacing:.15em}`,
    `<div class="r"></div><div class="r2"></div><div class="w"><div class="d k t">Entradas a la venta</div><div class="d h">Festival Cumbre</div><div class="t f">9 DE DICIEMBRE · PARQUE SARMIENTO</div></div>`),
  'banner-2': base(
    `body{background:linear-gradient(100deg,#0a0420,#1b0b4d 60%,#3a0f6b);position:relative}
     .g{position:absolute;left:0;right:0;bottom:0;height:260px;background:repeating-linear-gradient(90deg,rgba(47,242,255,.55) 0 2px,transparent 2px 100px),repeating-linear-gradient(0deg,rgba(47,242,255,.55) 0 2px,transparent 2px 52px);transform:perspective(420px) rotateX(58deg);transform-origin:bottom;opacity:.8}
     .s{position:absolute;right:70px;top:120px;width:320px;height:320px;border-radius:50%;background:linear-gradient(180deg,#ff2ea6,#ffd23d);box-shadow:0 0 90px rgba(255,46,166,.6)}
     .w{position:absolute;left:280px;top:0;bottom:0;display:flex;flex-direction:column;justify-content:center;color:#fff}
     .k{font-size:34px;letter-spacing:.45em;color:#2ff2ff}.h{font-size:150px;margin:14px 0;text-shadow:0 0 40px rgba(255,46,166,.7)}.f{font-size:36px;letter-spacing:.15em}`,
    `<div class="g"></div><div class="s"></div><div class="w"><div class="d k t">Próximo show</div><div class="d h">Noche Eléctrica</div><div class="t f">12 DE NOVIEMBRE · COMPLEJO FORUM</div></div>`),
}

// ───────────────────────── PRODUCTOS 800×800 (ilustración plana) ─────────────────────────

const prod = (bg, body) => base(`body{background:${bg};display:grid;place-items:center}`, `<svg viewBox="0 0 400 400" width="760" height="760">${body}</svg>`)
const products = {
  fernet: prod('radial-gradient(circle at 50% 38%,#ffe6b8,#f2b46b)', `
    <ellipse cx="200" cy="352" rx="108" ry="16" fill="#000" opacity=".18"/>
    <path d="M118 90h164l-16 250q-2 14-16 14H150q-14 0-16-14z" fill="#3a1d12"/>
    <path d="M118 90h164l-5 78H123z" fill="#5a3320" opacity=".8"/>
    <rect x="132" y="116" width="46" height="46" rx="8" fill="#fff" opacity=".28" transform="rotate(-10 155 139)"/>
    <rect x="212" y="170" width="44" height="44" rx="8" fill="#fff" opacity=".24" transform="rotate(14 234 192)"/>
    <rect x="160" y="226" width="40" height="40" rx="8" fill="#fff" opacity=".22" transform="rotate(-6 180 246)"/>
    <ellipse cx="200" cy="90" rx="82" ry="14" fill="#8a5a38"/><circle cx="262" cy="74" r="26" fill="#9bd14a"/><circle cx="262" cy="74" r="18" fill="#c8ea78"/>
    <path d="M300 40l-26 60" stroke="#fff" stroke-width="8" stroke-linecap="round"/>`),
  cerveza: prod('radial-gradient(circle at 50% 38%,#fff3c9,#f4c45a)', `
    <ellipse cx="200" cy="354" rx="112" ry="16" fill="#000" opacity=".16"/>
    <path d="M108 104h172l-14 238q-2 14-16 14H138q-14 0-16-14z" fill="#f2a516"/>
    <path d="M108 104h172l-6 100H114z" fill="#ffc83d" opacity=".9"/>
    <path d="M280 140h40q26 0 26 34v44q0 34-26 34h-34" fill="none" stroke="#f2a516" stroke-width="22" stroke-linecap="round"/>
    <g fill="#fff"><circle cx="134" cy="92" r="30"/><circle cx="178" cy="78" r="34"/><circle cx="226" cy="82" r="32"/><circle cx="262" cy="96" r="26"/></g>
    <g fill="#fff" opacity=".5"><circle cx="160" cy="230" r="6"/><circle cx="200" cy="270" r="5"/><circle cx="236" cy="220" r="7"/><circle cx="214" cy="300" r="5"/></g>`),
  gintonic: prod('radial-gradient(circle at 50% 38%,#e6fbf5,#8fe0d2)', `
    <ellipse cx="200" cy="352" rx="96" ry="14" fill="#000" opacity=".15"/>
    <path d="M126 96h148q10 0 8 12l-10 118q-6 66-72 66t-72-66l-10-118q-2-12 8-12z" fill="#d9f7f1" opacity=".9"/>
    <path d="M132 150h136l-6 76q-6 52-62 52t-62-52z" fill="#bff0e6"/>
    <rect x="186" y="290" width="28" height="58" fill="#d9f7f1"/><rect x="146" y="344" width="108" height="12" rx="6" fill="#d9f7f1"/>
    <g fill="#fff" opacity=".7"><rect x="148" y="140" width="40" height="40" rx="8" transform="rotate(-12 168 160)"/><rect x="212" y="170" width="38" height="38" rx="8" transform="rotate(16 231 189)"/><rect x="170" y="206" width="34" height="34" rx="8"/></g>
    <circle cx="276" cy="96" r="34" fill="#7bcb3c"/><circle cx="276" cy="96" r="24" fill="#a6e063"/><path d="M276 96l-18-16M276 96l18-16M276 96v-26M276 96l-18 16M276 96l18 16M276 96v26" stroke="#7bcb3c" stroke-width="3"/>`),
  vodka: prod('radial-gradient(circle at 50% 38%,#e9f2ff,#9ec2f2)', `
    <ellipse cx="200" cy="356" rx="84" ry="13" fill="#000" opacity=".16"/>
    <rect x="178" y="40" width="44" height="44" rx="6" fill="#1b2a49"/><path d="M182 84h36l24 56v206q0 12-12 12H170q-12 0-12-12V140z" fill="#e9f4ff" opacity=".95"/>
    <path d="M182 84h36l8 18h-52z" fill="#cfe3fa"/>
    <rect x="160" y="176" width="80" height="108" rx="10" fill="#1b2a49"/><text x="200" y="224" text-anchor="middle" font-family="Impact,Arial Black,sans-serif" font-size="27" fill="#fff" letter-spacing="1">VODKA</text>
    <path d="M200 244l14 20h-28z" fill="#6fb1ff"/><rect x="172" y="152" width="14" height="190" rx="7" fill="#fff" opacity=".6"/>`),
  energizante: prod('radial-gradient(circle at 50% 38%,#fff0d6,#ffb157)', `
    <ellipse cx="200" cy="356" rx="84" ry="13" fill="#000" opacity=".18"/>
    <rect x="132" y="62" width="136" height="286" rx="22" fill="#1d3a6e"/><rect x="132" y="62" width="136" height="44" rx="14" fill="#9aa9c2"/>
    <rect x="132" y="304" width="136" height="44" rx="14" fill="#9aa9c2"/>
    <path d="M132 150l136-26v70L132 220z" fill="#ffc23d"/><path d="M132 220l136-26v26L132 246z" fill="#ff5a3d"/>
    <path d="M205 112l-30 52h26l-12 44 40-60h-26z" fill="#fff" transform="translate(0 74)"/>
    <rect x="148" y="78" width="14" height="250" rx="7" fill="#fff" opacity=".3"/>`),
  agua: prod('radial-gradient(circle at 50% 38%,#eaf7ff,#9bd3f5)', `
    <ellipse cx="200" cy="356" rx="80" ry="12" fill="#000" opacity=".14"/>
    <rect x="178" y="40" width="44" height="26" rx="6" fill="#2d8be0"/><path d="M182 66h36l28 44v226q0 14-14 14H168q-14 0-14-14V110z" fill="#d6efff" opacity=".95"/>
    <path d="M154 170h92v110q-46 22-92 0z" fill="#7cc7f2" opacity=".85"/><path d="M154 170q23-14 46 0t46 0v-12q-23 14-46 0t-46 0z" fill="#b3e0fa"/>
    <rect x="150" y="150" width="100" height="60" fill="#2d8be0" opacity="0"/>
    <rect x="170" y="100" width="12" height="220" rx="6" fill="#fff" opacity=".7"/>`),
}

const browser = await chromium.launch()
async function render(name, html, w, h, type, quality = 88) {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 })
  await page.setContent(html)
  await page.waitForTimeout(250)
  await page.screenshot({ path: path.join(OUT, `${name}.${type === 'png' ? 'png' : 'jpg'}`), type, ...(type === 'jpeg' ? { quality } : {}) })
  await page.close()
  console.log('ok', name)
}
for (const [n, html] of Object.entries(flyers)) await render(`flyer-${n}`, html, 1920, 1080, 'jpeg')
for (const [n, html] of Object.entries(banners)) await render(n, html, 1920, 700, 'jpeg')
for (const [n, html] of Object.entries(products)) await render(`prod-${n}`, html, 800, 800, 'jpeg', 90)
await browser.close()
