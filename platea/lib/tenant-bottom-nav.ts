export const TENANT_BOTTOM_NAV_CLEARANCE = "calc(80px + env(safe-area-inset-bottom))"

/**
 * Reserva de espacio para el bottom-nav, SOLO en mobile.
 *
 * La barra es `md:hidden`, asi que en desktop reservar ese espacio deja un hueco
 * muerto abajo del footer (se veia como un footer flotando). El breakpoint tiene
 * que acompanar al de la barra: si se cambia uno, cambiar el otro.
 */
export const TENANT_BOTTOM_NAV_CLEARANCE_CLASS = "pb-[calc(80px+env(safe-area-inset-bottom))] md:pb-0"

function getTenantRouteKeys(pathname: string) {
  const segments = pathname.split("/").filter(Boolean)

  return {
    pageKey: segments[0] === "t" ? segments[2] : segments[0],
    pageSubKey: segments[0] === "t" ? segments[3] : segments[1],
  }
}

export function isTenantConsumiblesPath(pathname: string) {
  return getTenantRouteKeys(pathname).pageKey === "consumibles"
}

export function isTenantConsumiblesCheckoutPath(pathname: string) {
  const { pageKey, pageSubKey } = getTenantRouteKeys(pathname)
  return pageKey === "consumibles" && pageSubKey === "checkout"
}

export function shouldHideTenantBottomNav(pathname: string) {
  const { pageKey } = getTenantRouteKeys(pathname)

  return (
    pageKey === "auth" ||
    pageKey === "checkout" ||
    pageKey === "evento" ||
    pageKey === "pago" ||
    isTenantConsumiblesCheckoutPath(pathname)
  )
}
