import assert from "node:assert/strict"
import test from "node:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { TenantEmpresa } from "@/lib/tenant"
import { TenantHomeBannerSection } from "./tenant-home-sections"

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

test("tenant home banner keeps CTA clickable in public mode only", () => {
  const publicMarkup = renderToStaticMarkup(
    <TenantHomeBannerSection
      mode="public"
      tenant={tenantBase}
      section={{ id: "banner-1", type: "banner", title: "Promo", subtitle: "Imperdible", image_url: "", cta_label: "Comprar ahora", cta_href: "/promo" }}
    />
  )
  const editorMarkup = renderToStaticMarkup(
    <TenantHomeBannerSection
      mode="editor"
      tenant={tenantBase}
      section={{ id: "banner-1", type: "banner", title: "Promo", subtitle: "Imperdible", image_url: "", cta_label: "Comprar ahora", cta_href: "/promo" }}
    />
  )

  assert.match(publicMarkup, /href="\/promo"/)
  assert.doesNotMatch(editorMarkup, /href="\/promo"/)
  assert.match(editorMarkup, /Comprar ahora/)
})
