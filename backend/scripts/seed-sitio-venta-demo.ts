/**
 * seed-sitio-venta-demo.ts
 * =====================================================================
 * Pobla el sitio de venta de la primera empresa con imágenes demo
 * de picsum.photos (fotos reales, estables por seed). Solo para
 * smoke-testing del editor de dashboard y del tenant público.
 *
 * Idempotente: si logo_url ya contiene 'picsum.photos', sale sin modificar.
 *
 * Para limpiar:
 *   UPDATE empresas
 *     SET logo_url = NULL, banners = NULL, home_sections = NULL,
 *         galeria_fotos = NULL, support_contact_email = NULL
 *     WHERE logo_url LIKE '%picsum.photos%';
 * =====================================================================
 */

import { randomUUID } from 'node:crypto'
import pool from '../src/db'

async function main() {
  const slugArg = process.argv.find(a => a.startsWith('--slug='))?.split('=')[1]

  const [rows] = await pool.query<any[]>(
    slugArg
      ? `SELECT id, slug, logo_url FROM empresas WHERE slug = ? LIMIT 1`
      : `SELECT id, slug, logo_url FROM empresas LIMIT 1`,
    slugArg ? [slugArg] : []
  )

  if ((rows as any[]).length === 0) {
    const msg = slugArg ? `No se encontró empresa con slug "${slugArg}".` : 'No hay empresas en la DB. Corrí primero seed-events-demo.'
    console.log(`❌  ${msg}`)
    process.exit(1)
  }

  const empresa = (rows as any[])[0]
  const empresaId = String(empresa.id)
  const slug = String(empresa.slug)

  if (empresa.logo_url && String(empresa.logo_url).includes('picsum.photos')) {
    console.log(`⚠️  La empresa "${slug}" ya tiene imágenes demo. Saliendo sin modificar.`)
    console.log(`   Para re-sembrar, corrí el cleanup del header primero.`)
    process.exit(0)
  }

  console.log(`ℹ️  Sembrando sitio de venta demo para: ${slug} (${empresaId})`)

  // --- Imágenes ---------------------------------------------------------------

  const logo_url = 'https://picsum.photos/seed/platea-logo/400/400'

  const banners = [
    'https://picsum.photos/seed/banner-rock/1200/450',
    'https://picsum.photos/seed/banner-festival/1200/450',
    'https://picsum.photos/seed/banner-noche/1200/450',
  ]

  const galeria_fotos = [
    { id: randomUUID(), url: 'https://picsum.photos/seed/gal-venue/800/600',    titulo: 'El venue',             visible: true  },
    { id: randomUUID(), url: 'https://picsum.photos/seed/gal-backstage/800/600', titulo: 'Backstage',           visible: true  },
    { id: randomUUID(), url: 'https://picsum.photos/seed/gal-crowd/800/600',    titulo: 'El público',           visible: true  },
    { id: randomUUID(), url: 'https://picsum.photos/seed/gal-stage/800/600',    titulo: 'Escenario principal',  visible: true  },
    { id: randomUUID(), url: 'https://picsum.photos/seed/gal-artists/800/600',  titulo: 'Artistas en vivo',     visible: true  },
    { id: randomUUID(), url: 'https://picsum.photos/seed/gal-close/800/600',    titulo: 'Cierre de temporada',  visible: true  },
    { id: randomUUID(), url: 'https://picsum.photos/seed/gal-bar/800/600',      titulo: 'Bar y consumibles',    visible: true  },
    { id: randomUUID(), url: 'https://picsum.photos/seed/gal-lights/800/600',   titulo: 'Luces del show',       visible: false },
  ]

  const homeBanners = [
    {
      id:        randomUUID(),
      image_url: 'https://picsum.photos/seed/hbanner-temporada/1400/500',
      title:     '¡Nueva temporada!',
      subtitle:  '',
      cta_label: 'Conseguí tus entradas',
      cta_href:  '',
      visible:   true,
    },
    {
      id:        randomUUID(),
      image_url: 'https://picsum.photos/seed/hbanner-finde/1400/500',
      title:     'Shows todos los fines de semana',
      subtitle:  '',
      cta_label: 'Ver fechas',
      cta_href:  '',
      visible:   true,
    },
  ]

  const sponsors = [
    { id: randomUUID(), name: 'Cerveza Imperial', logo_url: 'https://picsum.photos/seed/sp-imperial/200/200', href: '' },
    { id: randomUUID(), name: 'Red Bull',          logo_url: 'https://picsum.photos/seed/sp-redbull/200/200',  href: '' },
    { id: randomUUID(), name: 'Personal',          logo_url: 'https://picsum.photos/seed/sp-personal/200/200', href: '' },
    { id: randomUUID(), name: 'Banco Ciudad',      logo_url: 'https://picsum.photos/seed/sp-banco/200/200',    href: '' },
    { id: randomUUID(), name: 'Claro',             logo_url: 'https://picsum.photos/seed/sp-claro/200/200',    href: '' },
  ]

  const home_sections = [
    { id: 'section-eventos',   type: 'eventos',               visible: true                          },
    { id: 'section-galeria',   type: 'galeria',               visible: true                          },
    { id: 'section-banners',   type: 'banners_group',         visible: true, banners:  homeBanners   },
    { id: 'section-sponsors',  type: 'auspiciantes_carousel', visible: true, sponsors: sponsors       },
  ]

  // --- Update -----------------------------------------------------------------

  await pool.query(
    `UPDATE empresas SET
      logo_url                  = ?,
      banners                   = ?,
      banner_variant            = 'blurred',
      home_sections             = ?,
      galeria_fotos             = ?,
      color_primario            = '#2563eb',
      color_fondo               = '#0f172a',
      color_texto               = '#f8fafc',
      titulo_eventos_home       = 'Próximas fechas',
      subtitulo_eventos_home    = 'Elegí tu show y conseguí tus entradas',
      cta_eventos_home          = 'Ver entradas',
      desktop_event_card_size   = 'large',
      mostrar_descripcion_home  = true,
      mostrar_fecha_home        = true,
      mostrar_lugar_home        = true,
      mostrar_precio_home       = true,
      mostrar_badge_stock_home  = true,
      support_contact_email     = 'soporte@demo.internal'
    WHERE id = ?`,
    [
      logo_url,
      JSON.stringify(banners),
      JSON.stringify(home_sections),
      JSON.stringify(galeria_fotos),
      empresaId,
    ]
  )

  console.log('✅  Sitio de venta demo sembrado:')
  console.log(`    Logo        : ${logo_url}`)
  console.log(`    Banners     : ${banners.length} imágenes`)
  console.log(`    Galería     : ${galeria_fotos.length} fotos (${galeria_fotos.filter(f => f.visible).length} visibles)`)
  console.log(`    Home banner : ${homeBanners.length} slides`)
  console.log(`    Sponsors    : ${sponsors.length}`)
  console.log()
  console.log(`    Tenant → http://localhost:3000/t/${slug}`)
  console.log(`    Editor → http://localhost:3000/dashboard/sitio-venta`)

  await pool.end()
}

main().catch((err) => {
  console.error('❌  Error:', err)
  process.exit(1)
})
