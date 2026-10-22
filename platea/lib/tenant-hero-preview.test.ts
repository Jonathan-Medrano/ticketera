import assert from "node:assert/strict"
import test from "node:test"
import {
  getCanonicalTenantHeroPreviewImage,
  getTenantHeroPreviewModel,
  normalizeTenantHeroVariant,
} from "./tenant-hero-preview"

test("normalizeTenantHeroVariant falls back to blurred", () => {
  assert.equal(normalizeTenantHeroVariant("full"), "full")
  assert.equal(normalizeTenantHeroVariant("blurred"), "blurred")
  assert.equal(normalizeTenantHeroVariant(null), "blurred")
})

test("getCanonicalTenantHeroPreviewImage picks the first non-empty banner", () => {
  assert.equal(
    getCanonicalTenantHeroPreviewImage({ banners: [undefined, "   ", "https://cdn.test/hero.jpg", "https://cdn.test/second.jpg"] }),
    "https://cdn.test/hero.jpg"
  )
})

test("getTenantHeroPreviewModel keeps banners as the canonical hero source", () => {
  const preview = getTenantHeroPreviewModel({
    color_primario: "#2563eb",
    color_fondo: "#020617",
    color_texto: "#f8fafc",
    banners: ["   ", "https://cdn.test/canonical-hero.jpg"],
    banner_variant: "blurred",
  })

  assert.equal(preview.image, "https://cdn.test/canonical-hero.jpg")
  assert.equal(preview.variant, "blurred")
})

test("getTenantHeroPreviewModel aligns image and overlay tokens with selected variant", () => {
  const full = getTenantHeroPreviewModel({
    color_primario: "#2563eb",
    color_fondo: "#020617",
    color_texto: "#f8fafc",
    banners: ["https://cdn.test/hero.jpg"],
    banner_variant: "full",
  })

  assert.equal(full.variant, "full")
  assert.equal(full.image, "https://cdn.test/hero.jpg")
  assert.equal(full.visuals.showSecondaryChip, true)
  assert.equal(full.visuals.publicObjectPosition, "center 32%")
  assert.equal(full.overlayStyle, undefined)
  assert.equal(full.topOverlayStyle, undefined)
  assert.equal(full.sideOverlayStyle, undefined)

  const blurred = getTenantHeroPreviewModel({
    color_primario: "#2563eb",
    color_fondo: "#020617",
    color_texto: "#f8fafc",
    banners: [],
    banner_variant: null,
  })

  assert.equal(blurred.variant, "blurred")
  assert.equal(blurred.image, undefined)
  assert.equal(blurred.visuals.showSecondaryChip, false)
  assert.equal(blurred.visuals.publicObjectPosition, "center center")
  assert.ok(blurred.overlayStyle)
  assert.equal(blurred.topOverlayStyle, undefined)
  assert.equal(blurred.sideOverlayStyle, undefined)
})
