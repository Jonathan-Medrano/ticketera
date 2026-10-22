/**
 * seed-portfolio-sitio.ts — aplica al sitio de venta de la empresa demo una plantilla base del editor
 * (los mismos valores de PLANTILLAS_SITIO en platea/components/dashboard/sitio-venta/branding-section.tsx),
 * con logo propio, banners de shows, galería y auspiciantes ficticios. Solo base local.
 *
 * Uso: npx tsx scripts/seed-portfolio-sitio.ts [nocturna|clara|vibrante|premium|tech|urbano|under|pastel]
 * Los logos SVG se generan en platea/public/demo/.
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { prisma } from '../src/lib/prisma'

if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? '')) throw new Error('Solo contra una base local.')

type Plantilla = { primario: string; fondo: string; texto: string; radius: string; boton: string; font: string; heading: string; nombre: string }
const PLANTILLAS: Record<string, Plantilla> = {
  nocturna: { nombre: 'Nocturna', primario: '#2563eb', fondo: '#000000', texto: '#ffffff', radius: 'rounded', boton: 'filled', font: '', heading: '' },
  clara: { nombre: 'Clara', primario: '#0f766e', fondo: '#f8fafc', texto: '#0f172a', radius: 'soft', boton: 'filled', font: 'poppins', heading: '' },
  vibrante: { nombre: 'Vibrante', primario: '#db2777', fondo: '#111827', texto: '#f9fafb', radius: 'rounded', boton: 'filled', font: 'montserrat', heading: '' },
  premium: { nombre: 'Premium', primario: '#b45309', fondo: '#0a0a0a', texto: '#f5f0e8', radius: 'soft', boton: 'outline', font: 'raleway', heading: 'playfair' },
  tech: { nombre: 'Tech', primario: '#6366f1', fondo: '#0f172a', texto: '#e2e8f0', radius: 'sharp', boton: 'filled', font: 'space-grotesk', heading: '' },
  urbano: { nombre: 'Urbano', primario: '#e11d48', fondo: '#18181b', texto: '#fafafa', radius: 'rounded', boton: 'filled', font: '', heading: 'bebas' },
  under: { nombre: 'Under', primario: '#a3e635', fondo: '#000000', texto: '#f4f4f5', radius: 'sharp', boton: 'outline', font: 'dm-sans', heading: '' },
  pastel: { nombre: 'Pastel', primario: '#a78bfa', fondo: '#fdf4ff', texto: '#3b0764', radius: 'rounded', boton: 'filled', font: 'inter', heading: '' },
}

const key = process.argv[2] ?? 'nocturna'
const t = PLANTILLAS[key]
if (!t) throw new Error(`Plantilla desconocida: ${key}`)

const outDir = path.resolve(__dirname, '..', '..', 'platea', 'public', 'demo')
fs.mkdirSync(outDir, { recursive: true })
const BASE = 'http://localhost:3000/demo'

/** Logo: marca de pulso + palabra, en los colores de la plantilla. */
function logoSvg(texto: string, acento: string, nombre: string) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="200" viewBox="0 0 640 200">
  <rect x="14" y="40" width="120" height="120" rx="30" fill="${acento}"/>
  <path d="M34 100h22l12-34 22 68 14-34h18" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="160" y="112" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="64" letter-spacing="2" fill="${texto}">${nombre}</text>
  <text x="162" y="150" font-family="Arial, sans-serif" font-size="24" letter-spacing="9" fill="${acento}">PRODUCCIONES</text>
</svg>`
}
function sponsorSvg(nombre: string, texto: string, i: number) {
  const formas = [
    '<circle cx="70" cy="100" r="30"/>',
    '<rect x="42" y="72" width="56" height="56" rx="10" transform="rotate(12 70 100)"/>',
    '<polygon points="70,66 102,126 38,126"/>',
    '<rect x="40" y="76" width="60" height="48" rx="24"/>',
    '<polygon points="70,68 98,84 98,116 70,132 42,116 42,84"/>',
  ]
  return `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="200" viewBox="0 0 460 200"><g fill="${texto}" opacity="0.9">${formas[i % formas.length]}</g><text x="128" y="116" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="40" fill="${texto}" opacity="0.9">${nombre}</text></svg>`
}
fs.writeFileSync(path.join(outDir, `logo-${key}.svg`), logoSvg(t.texto, t.primario, 'NOCTURNA'))
const sponsors = ['RUTA 9', 'AURORA', 'MOVI', 'BANCO SUR', 'PULSO FM'].map((n, i) => {
  const f = `sponsor-${key}-${i}.svg`
  fs.writeFileSync(path.join(outDir, f), sponsorSvg(n, t.texto, i))
  return { id: randomUUID(), name: n, logo_url: `${BASE}/${f}`, href: '' }
})

// Arte propio de scripts/arte-demo.mjs. Sin galería de fotos: una galería con imágenes de relleno se
// lee como relleno; el sitio muestra eventos, banners y auspiciantes.
const banners = ['banner-1', 'banner-2'].map((n) => `${BASE}/${n}.jpg`)
const homeBanners = [
  { id: randomUUID(), image_url: `${BASE}/banner-1.jpg`, title: '', subtitle: '', cta_label: 'Conseguí tus entradas', cta_href: '', visible: true },
  { id: randomUUID(), image_url: `${BASE}/banner-2.jpg`, title: '', subtitle: '', cta_label: 'Ver fechas', cta_href: '', visible: true },
]
const home_sections = [
  { id: 'section-eventos', type: 'eventos', visible: true },
  { id: 'section-banners', type: 'banners_group', visible: true, banners: homeBanners },
  { id: 'section-sponsors', type: 'auspiciantes_carousel', visible: true, sponsors },
]

async function main() {
  const empresa = await prisma.empresa.findFirstOrThrow({ where: { slug: 'nocturna' } })
  await prisma.empresa.update({ where: { id: empresa.id }, data: {
    logo_url: `${BASE}/logo-${key}.svg`,
    logo_size: 'large',
    banners: JSON.stringify(banners), banner_variant: 'blurred',
    home_sections: JSON.stringify(home_sections), galeria_fotos: [] as never,
    color_primario: t.primario, color_fondo: t.fondo, color_texto: t.texto,
    border_radius: t.radius, button_style: t.boton, font: t.font || null, heading_font: t.heading || null,
    titulo_eventos_home: 'Próximas fechas', subtitulo_eventos_home: 'Elegí tu show y conseguí tus entradas', cta_eventos_home: 'Ver entradas',
    support_contact_email: 'soporte@nocturna.example',
  } })
  console.log(`[sitio] plantilla ${t.nombre} aplicada a ${empresa.slug}`)

  // El sitio público cachea 60 s: se invalida para que la captura vea el cambio al instante.
  const secret = process.env.INTERNAL_API_SECRET
  if (secret) {
    const r = await fetch('http://localhost:3000/api/internal/revalidate-tenant', {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-internal-secret': secret }, body: JSON.stringify({ slug: empresa.slug }),
    }).catch(() => null)
    console.log('[sitio] revalidate:', r?.status ?? 'sin respuesta')
  }
}

main().catch((e) => { console.error(e); process.exit(1) }).finally(() => prisma.$disconnect())
