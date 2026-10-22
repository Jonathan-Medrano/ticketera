import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { TenantEmpresa } from "@/lib/tenant"
import { EventoDetalleStats } from "./evento-detalle-sections"

const tenantBase: TenantEmpresa = {
  id: "tenant-1",
  nombre: "Club Demo",
  slug: "club-demo",
  logo_url: null,
  color_primario: "#7c3aed",
  color_fondo: "#111827",
  color_texto: "#ffffff",
  mostrar_descripcion_home: true,
  mostrar_tanda_activa_home: true,
  mostrar_badge_stock_home: true,
  mostrar_fecha_home: true,
  mostrar_lugar_home: true,
  mostrar_precio_home: true,
  titulo_eventos_home: "Eventos",
  subtitulo_eventos_home: "Lo mejor",
  cta_eventos_home: "Comprar",
  banner_variant: "full",
  descripcion: "Experiencias en vivo",
  whatsapp: "+54911",
  banners: [],
  home_sections: null,
  faqs: null,
}

const fecha = { id: "fecha-1", fecha: "2026-09-12T23:00:00.000Z" }

/**
 * La franja de contexto reemplazó a un KPI-strip de tres números
 * ("Desde / Opciones / Disponibles"). Estos tests fijan las dos reglas del cambio:
 * los conteos NO vuelven, y lo que queda se adapta a cuántos datos hay.
 */
test("la franja de contexto ya no cuenta tipos de entrada", () => {
  const markup = renderToStaticMarkup(
    <EventoDetalleStats tenant={tenantBase} precioMinimo={12000} primeraFecha={fecha} lugar="Club Demo" />
  )

  // Los conteos duplicaban lo que cada card de categoría ya muestra, y "Disponibles"
  // significaba tipos acá y unidades abajo. No deben reaparecer.
  assert.doesNotMatch(markup, />\s*Opciones\s*</)
  assert.doesNotMatch(markup, />\s*Disponibles\s*</)
})

test("muestra cuándo, dónde y desde cuánto", () => {
  const markup = renderToStaticMarkup(
    <EventoDetalleStats tenant={tenantBase} precioMinimo={12000} primeraFecha={fecha} lugar="Club Demo" />
  )

  assert.match(markup, /Entradas desde/)
  assert.match(markup, /12\.000/)
  assert.match(markup, /Club Demo/)
  assert.match(markup, /Cómo llegar/)
})

test("sin precio cargado no inventa una card de precio", () => {
  const markup = renderToStaticMarkup(
    <EventoDetalleStats tenant={tenantBase} precioMinimo={0} primeraFecha={fecha} lugar="Club Demo" />
  )

  // Antes esta celda mostraba un guion suelto; ahora directamente no ocupa lugar.
  assert.doesNotMatch(markup, /Entradas desde/)
  assert.match(markup, /Club Demo/)
})

test("sin ningún dato de contexto no renderiza el contenedor vacío", () => {
  const markup = renderToStaticMarkup(<EventoDetalleStats tenant={tenantBase} precioMinimo={0} />)

  assert.equal(markup, "")
})

test("con un solo dato la card ocupa el ancho sin dejar huecos de grilla", () => {
  const markup = renderToStaticMarkup(<EventoDetalleStats tenant={tenantBase} precioMinimo={9500} />)

  // flex-wrap + basis (no grid-cols-3): con 1 o 2 cards se reparten todo el ancho
  // en vez de dejar una columna vacía al costado.
  assert.match(markup, /flex flex-wrap gap-3/)
  assert.match(markup, /flex-1 basis-\[220px\]/)
  assert.match(markup, /Entradas desde/)
})
