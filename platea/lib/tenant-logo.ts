// Tamaño del logo del tenant. Fuente única de verdad para navbar y home.
//
// Por qué existe separado de `navbar_size`: el logo es la marca del cliente y es
// la promesa de producto ("tu sitio, con tu marca"). Atarlo a la altura de la
// barra dejaba sin salida al que sube un lockup horizontal, porque con
// `object-contain` el alto es el único límite y el logo queda diminuto.

export type TenantLogoSize = "small" | "medium" | "large" | "xl"

export const TENANT_LOGO_SIZES: TenantLogoSize[] = ["small", "medium", "large", "xl"]

export const TENANT_LOGO_SIZE_LABELS: Record<TenantLogoSize, string> = {
  small: "Chico",
  medium: "Mediano",
  large: "Grande",
  xl: "Extra grande",
}

/** Altura del logo. Responsive: más chico en mobile, más grande de `sm` para arriba. */
const LOGO_CLASSNAMES: Record<TenantLogoSize, string> = {
  small: "h-8 sm:h-9",     // 32 / 36 px
  medium: "h-10 sm:h-12",  // 40 / 48 px
  large: "h-12 sm:h-16",   // 48 / 64 px
  xl: "h-14 sm:h-20",      // 56 / 80 px
}

/**
 * Altura mínima de la barra para que el logo entre con aire.
 *
 * Sin esto, un logo `xl` (80px) dentro de una navbar `small` (56px) se recorta.
 * La barra crece sola: el tamaño de navbar sigue mandando el piso, el logo el techo.
 */
const BAR_MIN_CLASSNAMES: Record<TenantLogoSize, string> = {
  small: "min-h-[48px] sm:min-h-[52px]",
  medium: "min-h-[56px] sm:min-h-[64px]",
  large: "min-h-[64px] sm:min-h-[80px]",
  xl: "min-h-[72px] sm:min-h-[96px]",
}

/**
 * Alto mínimo que impone el logo, en px. Tiene que estar sincronizado con
 * BAR_MIN_CLASSNAMES: se usa para calcular `--tenant-navbar-h`, que es la
 * variable con la que TODAS las páginas reservan espacio bajo el navbar fijo.
 *
 * Si no se contempla, un logo grande sobre un navbar chico agranda la barra
 * pero no el clearance, y el contenido queda tapado por el navbar.
 * Se toma el valor de `sm+`, que es el mayor de los dos breakpoints.
 */
const BAR_MIN_PX: Record<TenantLogoSize, number> = {
  small: 52,
  medium: 64,
  large: 80,
  xl: 96,
}

const NAVBAR_PX: Record<string, number> = { small: 56, large: 96, medium: 80 }

/** Alto real del navbar: el mayor entre el tamaño configurado y lo que pide el logo. */
export function tenantNavbarHeightPx(
  logoSize: string | null | undefined,
  navbarSize: string | null | undefined,
): number {
  const base = NAVBAR_PX[navbarSize ?? "medium"] ?? NAVBAR_PX.medium
  return Math.max(base, BAR_MIN_PX[resolveTenantLogoSize(logoSize, navbarSize)])
}

/**
 * Los hints de tamaño que recibe Next/Image. Tienen que cubrir 2x: si se quedan
 * cortos, Next sirve una versión chica y el logo se ve borroso justo después de
 * agrandarlo.
 */
const IMAGE_HINTS: Record<TenantLogoSize, { width: number; height: number; sizes: string }> = {
  small: { width: 240, height: 96, sizes: "240px" },
  medium: { width: 320, height: 128, sizes: "320px" },
  large: { width: 420, height: 168, sizes: "420px" },
  xl: { width: 520, height: 208, sizes: "520px" },
}

/**
 * `logo_size` vacío o inválido = derivar de `navbar_size`.
 *
 * Es a propósito: la columna se agregó después, así que los tenants que ya
 * existen la tienen en NULL y no deben cambiar de aspecto solos.
 */
export function resolveTenantLogoSize(
  logoSize: string | null | undefined,
  navbarSize: string | null | undefined,
): TenantLogoSize {
  if (logoSize && (TENANT_LOGO_SIZES as string[]).includes(logoSize)) {
    return logoSize as TenantLogoSize
  }
  if (navbarSize === "small") return "small"
  if (navbarSize === "large") return "large"
  return "medium"
}

export function tenantLogoClassName(size: TenantLogoSize): string {
  return `${LOGO_CLASSNAMES[size]} w-auto object-contain`
}

export function tenantLogoBarMinClassName(size: TenantLogoSize): string {
  return BAR_MIN_CLASSNAMES[size]
}

export function tenantLogoImageHints(size: TenantLogoSize) {
  return IMAGE_HINTS[size]
}
