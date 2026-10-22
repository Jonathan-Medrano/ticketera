function normalizeHex(hex: string | null | undefined) {
  if (!hex) return null
  const value = hex.trim()
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) return null
  if (value.length === 4) {
    return `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`.toLowerCase()
  }
  return value.toLowerCase()
}

function hexToRgb(hex: string | null | undefined) {
  const normalized = normalizeHex(hex)
  if (!normalized) return null

  const int = Number.parseInt(normalized.slice(1), 16)
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255,
  }
}

export function getContrastTextColor(background: string | null | undefined) {
  const rgb = hexToRgb(background)
  if (!rgb) return "#ffffff"

  const luminance = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255
  return luminance > 0.62 ? "#0f172a" : "#ffffff"
}

export function withOpacity(color: string | null | undefined, opacity: number) {
  const rgb = hexToRgb(color)
  if (!rgb) return color ?? "#000000"
  const alpha = Math.max(0, Math.min(1, opacity))
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`
}

/**
 * Overlay oscuro tintado con un color de marca del tenant, para usar sobre imágenes
 * (banners, heroes) donde necesitamos legibilidad de texto blanco garantizada.
 * Mezcla el color con negro (blackWeight) antes de aplicar la opacidad, así el
 * resultado se mantiene lo bastante oscuro sin importar qué tan clara sea la marca —
 * nunca se sacrifica contraste por diferenciación visual.
 */
export function tenantOverlayColor(color: string | null | undefined, opacity: number, blackWeight = 0.65) {
  const rgb = hexToRgb(color)
  const alpha = Math.max(0, Math.min(1, opacity))
  if (!rgb) return `rgba(0, 0, 0, ${alpha})`

  const weight = Math.max(0, Math.min(1, blackWeight))
  const r = Math.round(rgb.r * (1 - weight))
  const g = Math.round(rgb.g * (1 - weight))
  const b = Math.round(rgb.b * (1 - weight))
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}
