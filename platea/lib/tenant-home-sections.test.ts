import assert from "node:assert/strict"
import test from "node:test"
import {
  MAX_TESTIMONIOS,
  buildGoogleMapsDirectionsUrl,
  buildOsmEmbedSrc,
  chunkSponsors,
  getRenderableSponsors,
  getRenderableTestimonios,
  hasRenderableBannerContent,
  hasRenderableMapaContent,
  hasRenderableTextoLibreContent,
  insertTenantHomeSection,
  normalizeTenantHomeSections,
  parseTenantHomeMapaCoords,
  parseTenantHomeVideoEmbedUrl,
  reorderTenantHomeSections,
} from "./tenant-home-sections"

test("normalizeTenantHomeSections keeps eventos compatibility when config is missing or invalid", () => {
  assert.deepEqual(normalizeTenantHomeSections(null), [{ id: "eventos-default", type: "eventos" }])
  assert.deepEqual(normalizeTenantHomeSections("{bad json}"), [{ id: "eventos-default", type: "eventos" }])
})

test("normalizeTenantHomeSections keeps a single eventos section and normalizes supported types", () => {
  const sections = normalizeTenantHomeSections([
    { id: "banner-1", type: "banner", title: "Promo", subtitle: "Sub", image_url: "https://cdn/banner.jpg", cta_label: "Ver", cta_href: "/promo" },
    { id: "event-1", type: "eventos" },
    { id: "event-2", type: "eventos" },
    { id: "sponsors-1", type: "auspiciantes_carousel", sponsors: [{ id: "s-1", name: "Marca", logo_url: "https://cdn/logo.svg", href: "https://marca.test" }] },
  ])

  assert.equal(sections.filter((section) => section.type === "eventos").length, 1)
  assert.equal(sections[0]?.type, "banner")
  assert.equal(sections[1]?.type, "eventos")
  assert.equal(sections[2]?.type, "auspiciantes_carousel")
})

test("banner and sponsor helpers expose only renderable content", () => {
  const sections = normalizeTenantHomeSections([
    { id: "event-1", type: "eventos" },
    { id: "banner-1", type: "banner", title: "", subtitle: "", image_url: "", cta_label: "", cta_href: "" },
    { id: "sponsors-1", type: "auspiciantes_carousel", sponsors: [{ id: "s-1", name: "", logo_url: "" }, { id: "s-2", name: "Marca", logo_url: "https://cdn/logo.svg" }] },
  ])

  const banner = sections.find((section) => section.type === "banner")
  const sponsors = sections.find((section) => section.type === "auspiciantes_carousel")

  assert.equal(banner?.type === "banner" ? hasRenderableBannerContent(banner) : false, false)
  assert.deepEqual(
    sponsors?.type === "auspiciantes_carousel" ? chunkSponsors(getRenderableSponsors(sponsors), 3) : [],
    [[{ id: "s-2", name: "Marca", logo_url: "https://cdn/logo.svg", href: "" }]]
  )
})

test("insertTenantHomeSection inserts new sections after the chosen anchor without altering contract", () => {
  const sections = normalizeTenantHomeSections([
    { id: "event-1", type: "eventos" },
    { id: "banner-1", type: "banner", title: "Promo", subtitle: "Sub", image_url: "", cta_label: "Ver", cta_href: "/promo" },
  ])

  const inserted = insertTenantHomeSection(sections, "event-1", {
    id: "sponsors-1",
    type: "auspiciantes_carousel",
    title: "Acompañan",
    subtitle: "Marcas",
    sponsors: [],
  })

  assert.deepEqual(inserted.map((section) => section.id), ["event-1", "sponsors-1", "banner-1"])
  assert.equal(inserted[1]?.type, "auspiciantes_carousel")
})

test("reorderTenantHomeSections reorders supported sections without changing their contract", () => {
  const sections = normalizeTenantHomeSections([
    { id: "event-1", type: "eventos" },
    { id: "banner-1", type: "banner", title: "Promo", subtitle: "Sub", image_url: "", cta_label: "Ver", cta_href: "/promo" },
    { id: "sponsors-1", type: "auspiciantes_carousel", title: "Acompañan", subtitle: "Marcas", sponsors: [] },
  ])

  const reordered = reorderTenantHomeSections(sections, ["banner-1", "sponsors-1", "event-1"])

  assert.deepEqual(reordered.map((section) => section.id), ["banner-1", "sponsors-1", "event-1"])
  assert.deepEqual(reordered[2], { id: "event-1", type: "eventos" })
})

test("normalizeTenantHomeSections sanitizes injected script/event-handler payloads in texto_libre HTML", () => {
  const sections = normalizeTenantHomeSections([
    {
      id: "texto-1",
      type: "texto_libre",
      titulo: "Sobre nosotros",
      contenido_html: '<p onclick="alert(1)">Hola</p><script>alert(document.cookie)</script><img src=x onerror=alert(1)>',
    },
  ])

  const texto = sections.find((section) => section.type === "texto_libre")
  assert.equal(texto?.type === "texto_libre" ? texto.contenido_html : null, "<p>Hola</p>")
})

test("normalizeTenantHomeSections strips javascript: links from texto_libre but keeps safe https/mailto links", () => {
  const sections = normalizeTenantHomeSections([
    {
      id: "texto-1",
      type: "texto_libre",
      titulo: "",
      contenido_html: '<a href="javascript:alert(1)">malo</a><a href="https://ticketera.com">bueno</a>',
    },
  ])

  const texto = sections.find((section) => section.type === "texto_libre")
  const html = texto?.type === "texto_libre" ? texto.contenido_html : ""
  assert.doesNotMatch(html, /javascript:/)
  assert.doesNotMatch(html, /href="javascript/)
  assert.match(html, /href="https:\/\/ticketera\.com"/)
})

test("normalizeTenantHomeSections applies texto_libre defaults when fields are missing", () => {
  const sections = normalizeTenantHomeSections([{ id: "texto-1", type: "texto_libre" }])

  assert.deepEqual(sections.find((section) => section.type === "texto_libre"), {
    id: "texto-1",
    type: "texto_libre",
    titulo: "",
    contenido_html: "",
    visible: true,
  })
})

test("normalizeTenantHomeSections respects explicit visible:false on texto_libre", () => {
  const sections = normalizeTenantHomeSections([
    { id: "texto-1", type: "texto_libre", titulo: "Info", contenido_html: "<p>hola</p>", visible: false },
  ])

  const texto = sections.find((section) => section.type === "texto_libre")
  assert.equal(texto?.visible, false)
})

test("normalizeTenantHomeSections applies countdown defaults and falls back to proximo_evento for missing/invalid modo", () => {
  const withoutModo = normalizeTenantHomeSections([{ id: "cd-1", type: "countdown" }])
  const withInvalidModo = normalizeTenantHomeSections([{ id: "cd-2", type: "countdown", modo: "bogus" }])

  assert.deepEqual(withoutModo.find((section) => section.type === "countdown"), {
    id: "cd-1",
    type: "countdown",
    titulo: "",
    modo: "proximo_evento",
    fecha_manual: "",
    texto_finalizado: "",
    visible: true,
  })
  assert.equal(
    withInvalidModo.find((section) => section.type === "countdown")?.type === "countdown"
      ? (withInvalidModo.find((section) => section.type === "countdown") as { modo: string }).modo
      : null,
    "proximo_evento"
  )
})

test("normalizeTenantHomeSections preserves fecha_manual mode and trims its fields", () => {
  const sections = normalizeTenantHomeSections([
    {
      id: "cd-1",
      type: "countdown",
      titulo: "  Arranca ya  ",
      modo: "fecha_manual",
      fecha_manual: "  2026-12-31T23:00  ",
      texto_finalizado: "  ¡Ya arrancó!  ",
    },
  ])

  assert.deepEqual(sections.find((section) => section.type === "countdown"), {
    id: "cd-1",
    type: "countdown",
    titulo: "Arranca ya",
    modo: "fecha_manual",
    fecha_manual: "2026-12-31T23:00",
    texto_finalizado: "¡Ya arrancó!",
    visible: true,
  })
})

test("hasRenderableTextoLibreContent requires a non-empty titulo or meaningful HTML content", () => {
  assert.equal(hasRenderableTextoLibreContent({ titulo: "", contenido_html: "" }), false)
  assert.equal(hasRenderableTextoLibreContent({ titulo: "", contenido_html: "<p></p>" }), false)
  assert.equal(hasRenderableTextoLibreContent({ titulo: "", contenido_html: "<p>&nbsp;</p>" }), false)
  assert.equal(hasRenderableTextoLibreContent({ titulo: "Solo título", contenido_html: "" }), true)
  assert.equal(hasRenderableTextoLibreContent({ titulo: "", contenido_html: "<p>Hola</p>" }), true)
})

// ---------------------------------------------------------------------------
// parseTenantHomeVideoEmbedUrl — YouTube / Instagram URL -> embed src
// ---------------------------------------------------------------------------

test("parseTenantHomeVideoEmbedUrl resolves YouTube watch/short/embed URLs (with and without www.) to a validated /embed/{id} src", () => {
  assert.deepEqual(parseTenantHomeVideoEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), {
    provider: "youtube",
    embedSrc: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  })
  assert.deepEqual(parseTenantHomeVideoEmbedUrl("https://youtube.com/watch?v=dQw4w9WgXcQ"), {
    provider: "youtube",
    embedSrc: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  })
  assert.deepEqual(parseTenantHomeVideoEmbedUrl("https://youtu.be/dQw4w9WgXcQ"), {
    provider: "youtube",
    embedSrc: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  })
  assert.deepEqual(parseTenantHomeVideoEmbedUrl("https://www.youtube.com/shorts/dQw4w9WgXcQ"), {
    provider: "youtube",
    embedSrc: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  })
  assert.deepEqual(parseTenantHomeVideoEmbedUrl("https://www.youtube.com/embed/dQw4w9WgXcQ"), {
    provider: "youtube",
    embedSrc: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  })
})

test("parseTenantHomeVideoEmbedUrl ignores extra query params (e.g. playlist position, timestamp) and still resolves the id", () => {
  assert.deepEqual(parseTenantHomeVideoEmbedUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&list=PLxyz"), {
    provider: "youtube",
    embedSrc: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  })
})

test("parseTenantHomeVideoEmbedUrl works without an explicit protocol via the https:// fallback", () => {
  assert.deepEqual(parseTenantHomeVideoEmbedUrl("youtu.be/dQw4w9WgXcQ"), {
    provider: "youtube",
    embedSrc: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  })
  assert.deepEqual(parseTenantHomeVideoEmbedUrl("www.youtube.com/watch?v=dQw4w9WgXcQ"), {
    provider: "youtube",
    embedSrc: "https://www.youtube.com/embed/dQw4w9WgXcQ",
  })
})

test("parseTenantHomeVideoEmbedUrl resolves Instagram post/reel URLs to /p/{shortcode}/embed", () => {
  assert.deepEqual(parseTenantHomeVideoEmbedUrl("https://www.instagram.com/p/Cabc123XYZ/"), {
    provider: "instagram",
    embedSrc: "https://www.instagram.com/p/Cabc123XYZ/embed",
  })
  assert.deepEqual(parseTenantHomeVideoEmbedUrl("https://instagram.com/reel/Cabc123XYZ/"), {
    provider: "instagram",
    embedSrc: "https://www.instagram.com/p/Cabc123XYZ/embed",
  })
})

test("parseTenantHomeVideoEmbedUrl returns null for empty input, unrecognized domains, and malformed URLs", () => {
  assert.equal(parseTenantHomeVideoEmbedUrl(""), null)
  assert.equal(parseTenantHomeVideoEmbedUrl("   "), null)
  assert.equal(parseTenantHomeVideoEmbedUrl("https://vimeo.com/123456789"), null)
  assert.equal(parseTenantHomeVideoEmbedUrl("not a valid url at all"), null)
  assert.equal(parseTenantHomeVideoEmbedUrl("https://"), null)
})

test("parseTenantHomeVideoEmbedUrl returns null for YouTube URLs without a recognizable video id", () => {
  assert.equal(parseTenantHomeVideoEmbedUrl("https://www.youtube.com/watch"), null) // missing ?v=
  assert.equal(parseTenantHomeVideoEmbedUrl("https://www.youtube.com/"), null) // no path segment at all
  assert.equal(parseTenantHomeVideoEmbedUrl("https://www.youtube.com/channel/UCxxxxxxxxxxxxxxxxxxxxxx"), null)
})

test("parseTenantHomeVideoEmbedUrl rejects an injection payload in the ?v= param instead of leaking it into embedSrc", () => {
  const malicious = 'https://www.youtube.com/watch?v="><script>alert(1)</script>'
  const result = parseTenantHomeVideoEmbedUrl(malicious)

  assert.equal(result, null)
})

// ---------------------------------------------------------------------------
// parseTenantHomeMapaCoords — lat/lng text field parsing + range validation
// ---------------------------------------------------------------------------

test("parseTenantHomeMapaCoords parses valid numeric lat/lng strings", () => {
  assert.deepEqual(parseTenantHomeMapaCoords("-34.6037", "-58.3816"), { lat: -34.6037, lng: -58.3816 })
  assert.deepEqual(parseTenantHomeMapaCoords("0", "0"), { lat: 0, lng: 0 })
})

test("parseTenantHomeMapaCoords returns null when lat or lng is empty", () => {
  assert.equal(parseTenantHomeMapaCoords("", ""), null)
  assert.equal(parseTenantHomeMapaCoords("-34.6037", ""), null)
  assert.equal(parseTenantHomeMapaCoords("", "-58.3816"), null)
  assert.equal(parseTenantHomeMapaCoords("   ", "   "), null)
})

test("parseTenantHomeMapaCoords returns null for non-numeric input", () => {
  assert.equal(parseTenantHomeMapaCoords("abc", "-58.3816"), null)
  assert.equal(parseTenantHomeMapaCoords("-34.6037", "xyz"), null)
  assert.equal(parseTenantHomeMapaCoords("not-a-number", "not-a-number"), null)
})

test("parseTenantHomeMapaCoords returns null when lat or lng is out of range", () => {
  assert.equal(parseTenantHomeMapaCoords("90.0001", "0"), null)
  assert.equal(parseTenantHomeMapaCoords("-90.0001", "0"), null)
  assert.equal(parseTenantHomeMapaCoords("0", "180.0001"), null)
  assert.equal(parseTenantHomeMapaCoords("0", "-180.0001"), null)
})

test("parseTenantHomeMapaCoords accepts the exact boundary values", () => {
  assert.deepEqual(parseTenantHomeMapaCoords("90", "180"), { lat: 90, lng: 180 })
  assert.deepEqual(parseTenantHomeMapaCoords("-90", "-180"), { lat: -90, lng: -180 })
})

// ---------------------------------------------------------------------------
// buildOsmEmbedSrc / buildGoogleMapsDirectionsUrl — URL building + encoding
// ---------------------------------------------------------------------------

test("buildOsmEmbedSrc percent-encodes the bbox and marker query params (commas are not left raw)", () => {
  const src = buildOsmEmbedSrc(-34.6037, -58.3816)
  const url = new URL(src)

  assert.equal(url.origin + url.pathname, "https://www.openstreetmap.org/export/embed.html")
  // Raw commas must be encoded (%2C), not passed through literally in the query string.
  assert.doesNotMatch(src.split("?")[1] ?? "", /,/)
  assert.equal(url.searchParams.get("marker"), "-34.6037,-58.3816")
  assert.equal(url.searchParams.get("layer"), "mapnik")

  const [west, south, east, north] = (url.searchParams.get("bbox") ?? "").split(",").map(Number)
  assert.ok(Math.abs(west - (-58.3916)) < 1e-9)
  assert.ok(Math.abs(south - (-34.6137)) < 1e-9)
  assert.ok(Math.abs(east - (-58.3716)) < 1e-9)
  assert.ok(Math.abs(north - (-34.5937)) < 1e-9)
})

test("buildGoogleMapsDirectionsUrl percent-encodes a free-text address with spaces and special characters", () => {
  const src = buildGoogleMapsDirectionsUrl("Av. Callao 1234 & Piso 2, CABA")
  const url = new URL(src)

  assert.equal(url.searchParams.get("destination"), "Av. Callao 1234 & Piso 2, CABA")
  // Sanity: the raw "&" from the address must not have been interpreted as a query separator.
  assert.equal(url.searchParams.get("api"), "1")
  assert.equal([...url.searchParams.keys()].length, 2)
})

test("buildGoogleMapsDirectionsUrl prioritizes coordinates over the free-text address when both are present", () => {
  const src = buildGoogleMapsDirectionsUrl("Av. Callao 1234, CABA", { lat: -34.6037, lng: -58.3816 })
  const url = new URL(src)

  assert.equal(url.searchParams.get("destination"), "-34.6037,-58.3816")
})

test("buildGoogleMapsDirectionsUrl falls back to the address when coords are null/omitted", () => {
  const src = buildGoogleMapsDirectionsUrl("Av. Callao 1234, CABA", null)
  const url = new URL(src)

  assert.equal(url.searchParams.get("destination"), "Av. Callao 1234, CABA")
})

// ---------------------------------------------------------------------------
// hasRenderableMapaContent
// ---------------------------------------------------------------------------

test("hasRenderableMapaContent is true when there is an address OR valid coordinates, false otherwise", () => {
  assert.equal(hasRenderableMapaContent({ direccion: "", lat: "", lng: "" }), false)
  assert.equal(hasRenderableMapaContent({ direccion: "", lat: "abc", lng: "def" }), false)
  assert.equal(hasRenderableMapaContent({ direccion: "Av. Siempre Viva 742", lat: "", lng: "" }), true)
  assert.equal(hasRenderableMapaContent({ direccion: "", lat: "-34.6037", lng: "-58.3816" }), true)
  assert.equal(hasRenderableMapaContent({ direccion: "Av. Siempre Viva 742", lat: "-34.6037", lng: "-58.3816" }), true)
})

// ---------------------------------------------------------------------------
// getRenderableTestimonios
// ---------------------------------------------------------------------------

test("getRenderableTestimonios filters out testimonios missing nombre or texto, keeps complete ones in order", () => {
  const section = {
    testimonios: [
      { id: "t-1", nombre: "Ana", texto: "Excelente lugar", rol: "Clienta", url_foto: "" },
      { id: "t-2", nombre: "", texto: "Sin nombre no cuenta", rol: "", url_foto: "" },
      { id: "t-3", nombre: "Sin texto no cuenta", texto: "", rol: "", url_foto: "" },
      { id: "t-4", nombre: "Beto", texto: "Volvería mil veces", rol: "", url_foto: "" },
      { id: "t-5", nombre: "   ", texto: "   ", rol: "", url_foto: "" },
    ],
  }

  const result = getRenderableTestimonios(section)

  assert.deepEqual(result.map((t) => t.id), ["t-1", "t-4"])
})

// ---------------------------------------------------------------------------
// normalizeTenantHomeSections — video_embed / mapa / testimonios
// ---------------------------------------------------------------------------

test("normalizeTenantHomeSections applies video_embed defaults when fields are missing", () => {
  const sections = normalizeTenantHomeSections([{ id: "video-1", type: "video_embed" }])

  assert.deepEqual(sections.find((section) => section.type === "video_embed"), {
    id: "video-1",
    type: "video_embed",
    url: "",
    visible: true,
  })
})

test("normalizeTenantHomeSections respects explicit visible:false on video_embed", () => {
  const sections = normalizeTenantHomeSections([
    { id: "video-1", type: "video_embed", url: "https://youtu.be/dQw4w9WgXcQ", visible: false },
  ])

  const video = sections.find((section) => section.type === "video_embed")
  assert.equal(video?.visible, false)
  assert.equal(video?.type === "video_embed" ? video.url : null, "https://youtu.be/dQw4w9WgXcQ")
})

test("normalizeTenantHomeSections applies mapa defaults when fields are missing", () => {
  const sections = normalizeTenantHomeSections([{ id: "mapa-1", type: "mapa" }])

  assert.deepEqual(sections.find((section) => section.type === "mapa"), {
    id: "mapa-1",
    type: "mapa",
    direccion: "",
    lat: "",
    lng: "",
    visible: true,
  })
})

test("normalizeTenantHomeSections respects explicit visible:false on mapa and trims its fields", () => {
  const sections = normalizeTenantHomeSections([
    { id: "mapa-1", type: "mapa", direccion: "  Av. Siempre Viva 742  ", lat: "  -34.6037  ", lng: "  -58.3816  ", visible: false },
  ])

  const mapa = sections.find((section) => section.type === "mapa")
  assert.equal(mapa?.visible, false)
  assert.deepEqual(mapa?.type === "mapa" ? { direccion: mapa.direccion, lat: mapa.lat, lng: mapa.lng } : null, {
    direccion: "Av. Siempre Viva 742",
    lat: "-34.6037",
    lng: "-58.3816",
  })
})

test("normalizeTenantHomeSections applies testimonios defaults when fields are missing", () => {
  const sections = normalizeTenantHomeSections([{ id: "testi-1", type: "testimonios" }])

  assert.deepEqual(sections.find((section) => section.type === "testimonios"), {
    id: "testi-1",
    type: "testimonios",
    titulo: "",
    testimonios: [],
    visible: true,
  })
})

test("normalizeTenantHomeSections respects explicit visible:false on testimonios", () => {
  const sections = normalizeTenantHomeSections([
    { id: "testi-1", type: "testimonios", titulo: "Lo que dicen", testimonios: [], visible: false },
  ])

  const testimonios = sections.find((section) => section.type === "testimonios")
  assert.equal(testimonios?.visible, false)
})

test("normalizeTenantHomeSections clamps testimonios to MAX_TESTIMONIOS, keeping the first N in order", () => {
  assert.equal(MAX_TESTIMONIOS, 10)

  const rawTestimonios = Array.from({ length: 12 }, (_, i) => ({
    id: `t-${i}`,
    nombre: `Testimonio ${i}`,
    texto: `Texto ${i}`,
    rol: "",
    url_foto: "",
  }))

  const sections = normalizeTenantHomeSections([{ id: "testi-1", type: "testimonios", titulo: "", testimonios: rawTestimonios }])
  const testimonios = sections.find((section) => section.type === "testimonios")
  const list = testimonios?.type === "testimonios" ? testimonios.testimonios : []

  assert.equal(list.length, MAX_TESTIMONIOS)
  assert.deepEqual(
    list.map((t) => t.id),
    rawTestimonios.slice(0, MAX_TESTIMONIOS).map((t) => t.id)
  )
})
