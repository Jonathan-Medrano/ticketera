"use client"

import { usePathname } from "next/navigation"
import TenantBottomNav from "@/components/tenant/tenant-bottom-nav"
import { shouldHideTenantBottomNav, TENANT_BOTTOM_NAV_CLEARANCE_CLASS } from "@/lib/tenant-bottom-nav"

export default function TenantLayoutShell({
  children,
  hasConsumibles,
}: {
  children: React.ReactNode
  hasConsumibles: boolean
}) {
  const pathname = usePathname()
  const hideNav = shouldHideTenantBottomNav(pathname)

  return (
    <>
      {/* El clearance del bottom-nav era un style inline, asi que se aplicaba en
          TODOS los viewports — pero TenantBottomNav es `md:hidden`. Resultado:
          en desktop quedaban 80px muertos abajo del footer y el footer se veia
          "flotando". Ahora es una clase con breakpoint: la reserva existe solo
          en mobile, que es donde existe la barra. */}
      <div className={hideNav ? undefined : TENANT_BOTTOM_NAV_CLEARANCE_CLASS}>{children}</div>
      <TenantBottomNav hasConsumibles={hasConsumibles} />
    </>
  )
}
