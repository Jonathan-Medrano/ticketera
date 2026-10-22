export const tenantRoutes = {
  home: () => "/",
  auth: (redirectTo?: string) =>
    redirectTo ? `/auth?redirect=${encodeURIComponent(redirectTo)}` : "/auth",
  authReset: () => "/auth/reset",
  checkout: () => "/checkout",
  consumibles: () => "/consumibles",
  consumiblesEvento: (id: string) => `/consumibles/${id}`,
  consumiblesCheckout: () => "/consumibles/checkout",
  consumiblesMisCompras: () => "/consumibles/mis-compras",
  misTickets: () => "/mis-tickets",
  configuracion: () => "/configuracion",
  actualizarPassword: () => "/actualizar-password",
  informacion: () => "/informacion",
  informacionPage: (slug: string) => `/informacion/${slug}`,
  contacto: () => "/informacion/contacto",
  arrepentimiento: () => "/informacion/arrepentimiento",
  soporte: () => "/soporte",
  terminos: () => "/informacion/terminos",
  privacidad: () => "/informacion/privacidad",
  defensaConsumidor: () => "/informacion/defensa-consumidor",
  eliminarCuenta: () => "/informacion/eliminar-cuenta",
  evento: (id: string) => `/evento/${id}`,
  pagoExito: () => "/pago/exito",
  pagoPendiente: () => "/pago/pendiente",
  pagoError: () => "/pago/error",
}

const ROOT_DOMAIN_PATTERN = /^[a-zA-Z0-9.-]+(:\d+)?$/

let rootDomainWarned = false

function warnIfRootDomainInvalid(value: string) {
  if (rootDomainWarned) return
  if (process.env.NODE_ENV === "production") return
  if (ROOT_DOMAIN_PATTERN.test(value)) return

  rootDomainWarned = true
  if (typeof console !== "undefined") {
    console.warn(
      `[tenant-routes] NEXT_PUBLIC_ROOT_DOMAIN tiene formato inválido. ` +
        `Esperado: hostname con puerto opcional (ej: "localhost:3000" o "ticketera.com"). ` +
        `Revisá tu .env.local — buildTenantPublicUrl() va a generar URLs malformadas.`,
    )
  }
}

export function buildTenantPublicUrl(slug: string) {
  const rootDomainRaw = process.env.NEXT_PUBLIC_ROOT_DOMAIN || "Ticketera.local:3000"
  warnIfRootDomainInvalid(rootDomainRaw)
  const isLocal = rootDomainRaw.includes("localhost") || rootDomainRaw.includes("Ticketera.local")
  const protocol = isLocal ? "http" : "https"
  return `${protocol}://${slug}.${rootDomainRaw}`
}

export function buildTenantPath(slug: string, path: string) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`
  return `/t/${slug}${normalizedPath === "/" ? "" : normalizedPath}`
}
