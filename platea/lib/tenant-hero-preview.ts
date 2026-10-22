import type { CSSProperties } from "react"

export type TenantHeroVariant = "blurred" | "full"

type TenantHeroColors = {
  color_primario: string
  color_fondo: string
  color_texto: string
}

export function normalizeTenantHeroVariant(variant?: TenantHeroVariant | null): TenantHeroVariant {
  return variant === "full" ? "full" : "blurred"
}

export function getCanonicalTenantHeroPreviewImage({
  banners,
}: {
  banners?: Array<string | null | undefined>
}): string | undefined {
  // Mientras el hero público siga leyendo tenant.banners, el preview debe usar
  // la misma fuente canónica para evitar mostrar una imagen distinta al render real.
  return banners?.find((banner): banner is string => typeof banner === "string" && banner.trim().length > 0)?.trim()
}

export function getTenantHeroVisualTokens(variant: TenantHeroVariant) {
  if (variant === "full") {
    return {
      showSecondaryChip: true,
      publicHeight: "clamp(180px, 30vw, 420px)",
      publicObjectPosition: "center 32%",
      publicBottomPaddingClassName: "pb-8 md:pb-12",
      publicContentMaxWidthClassName: "max-w-3xl",
      publicTitleClassName: "text-4xl md:text-6xl lg:text-7xl",
      publicDescriptionClassName: "text-base md:text-lg max-w-2xl",
      previewMinHeight: 250,
      previewContentMinHeightClassName: "min-h-[250px]",
      previewTitleClassName: "text-[28px] sm:text-[32px]",
      previewDescriptionClassName: "text-sm sm:text-[15px] max-w-xl",
    }
  }

  return {
    showSecondaryChip: false,
    publicHeight: "clamp(140px, 22vw, 260px)",
    publicObjectPosition: "center center",
    publicBottomPaddingClassName: "pb-6 md:pb-8",
    publicContentMaxWidthClassName: "max-w-2xl",
    publicTitleClassName: "text-3xl md:text-5xl",
    publicDescriptionClassName: "text-sm md:text-base max-w-xl",
    previewMinHeight: 180,
    previewContentMinHeightClassName: "min-h-[180px]",
    previewTitleClassName: "text-2xl sm:text-[28px]",
    previewDescriptionClassName: "text-sm max-w-lg",
  }
}

export function getTenantHeroFallbackStyle(colors: TenantHeroColors): CSSProperties {
  return {
    background: `radial-gradient(circle at top, ${colors.color_primario}55, transparent 45%), linear-gradient(135deg, ${colors.color_primario}99, ${colors.color_fondo})`,
  }
}

export function getTenantHeroOverlayStyle(variant: TenantHeroVariant, colors: TenantHeroColors): CSSProperties | undefined {
  if (variant === "full") return undefined

  return {
    background: `linear-gradient(to bottom, rgba(0,0,0,0.15), rgba(0,0,0,0.7) 65%, ${colors.color_fondo})`,
  }
}

export function getTenantHeroTopOverlayStyle(): CSSProperties | undefined {
  return undefined
}

export function getTenantHeroSideOverlayStyle(): CSSProperties | undefined {
  return undefined
}

export function getTenantHeroPreviewModel(colors: TenantHeroColors & { banners?: Array<string | null | undefined>; banner_variant?: TenantHeroVariant | null }) {
  const variant = normalizeTenantHeroVariant(colors.banner_variant)
  return {
    variant,
    image: getCanonicalTenantHeroPreviewImage({ banners: colors.banners }),
    visuals: getTenantHeroVisualTokens(variant),
    fallbackStyle: getTenantHeroFallbackStyle(colors),
    overlayStyle: getTenantHeroOverlayStyle(variant, colors),
    topOverlayStyle: getTenantHeroTopOverlayStyle(),
    sideOverlayStyle: getTenantHeroSideOverlayStyle(),
  }
}
