"use client"

import { useMemo, useState } from "react"
import { useTenantBuyerSession } from "./tenant-buyer-session-provider"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { useTenant, useTenantSalesReadiness } from "./tenant-provider"
import { useConsumiblesCart } from "./consumibles-cart-provider"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"
import {
  TenantConsumiblesEventoCatalog,
  TenantConsumiblesEventoCartSummary,
  TenantConsumiblesEventoEmptyState,
  TenantConsumiblesEventoFilters,
  TenantConsumiblesEventoHero,
  type ConsumibleBar,
  type EventoData,
} from "./tenant-consumibles-evento-sections"

import { TENANT_NAVBAR_CLEARANCE } from "@/lib/tenant-navbar-clearance"
export default function TenantConsumiblesEvento({ evento, barras }: { evento: EventoData; barras: ConsumibleBar[] }) {
  const tenant = useTenant()
  const salesReadiness = useTenantSalesReadiness()
  const { buyerSession } = useTenantBuyerSession()
  const router = useRouter()
  const { agregar, quitarUno, items, totalItems } = useConsumiblesCart()
  const [busqueda, setBusqueda] = useState("")
  const [barraFiltro, setBarraFiltro] = useState<string>("todas")
  const [tipoFiltro, setTipoFiltro] = useState<"todos" | "bebidas" | "comida">("todos")
  const canSell = salesReadiness?.can_sell ?? true
  const termino = busqueda.trim().toLowerCase()
  const barrasDisponibles = useMemo(() => barras.map((barra) => ({ id: barra.id, nombre: barra.nombre })), [barras])

  function clasificarItem(item: ConsumibleBar["items"][number]) {
    const texto = `${item.nombre} ${item.descripcion ?? ""}`.toLowerCase()
    const palabrasComida = ["burger", "hamburguesa", "papas", "pizza", "pancho", "nacho", "sandwich", "sándwich", "empanada", "comida"]
    return palabrasComida.some((palabra) => texto.includes(palabra)) ? "comida" : "bebidas"
  }

  const barrasFiltradas = useMemo(
    () => barras
      .filter((barra) => barraFiltro === "todas" || barra.id === barraFiltro)
      .map((barra) => ({
        ...barra,
        items: barra.items.filter((item) => {
          const coincideTexto = !termino || `${item.nombre} ${item.descripcion ?? ""}`.toLowerCase().includes(termino)
          const coincideTipo = tipoFiltro === "todos" || clasificarItem(item) === tipoFiltro
          return coincideTexto && coincideTipo
        }),
      }))
      .filter((barra) => barra.items.length > 0),
    [barraFiltro, barras, termino, tipoFiltro]
  )

  function getCantidadEnCarrito(barraId: string, consumibleId: string) {
    return items.find((entry) => entry.barraId === barraId && entry.consumibleId === consumibleId)?.cantidad ?? 0
  }

  function agregarConsumible(barra: ConsumibleBar, item: ConsumibleBar["items"][number]) {
    if (!canSell || Number(evento.venta_consumibles_habilitada) !== 1) return

    const cantidadActual = getCantidadEnCarrito(barra.id, item.consumible_id)
    if (!item.stock_ilimitado && cantidadActual >= item.stock_actual) {
      toast.error(`Stock insuficiente: solo quedan ${item.stock_actual} disponible${item.stock_actual === 1 ? "" : "s"} de ${item.nombre}`)
      return
    }

      agregar({
        barraId: barra.id,
        barraNombre: barra.nombre,
        buyerConsumibleRefundsEnabled: barra.buyer_consumible_refunds_enabled !== false,
        consumibleId: item.consumible_id,
        nombre: item.nombre,
      precio: Number(item.precio),
      cantidad: 1,
      eventoId: evento.id,
      eventoNombre: evento.nombre,
      stockDisponible: item.stock_actual,
    })
  }

  function irAlCheckout() {
    if (!buyerSession || buyerSession.userType !== "comprador") {
      router.push(buildTenantPath(tenant.slug, tenantRoutes.auth("consumibles/checkout")))
      return
    }
    router.push(buildTenantPath(tenant.slug, tenantRoutes.consumiblesCheckout()))
  }

  if (!barras.length) {
    return (
      <div className="min-h-screen pb-32" style={{ background: tenant.color_fondo, color: tenant.color_texto }}>
        <div className="max-w-4xl mx-auto px-4 space-y-6" style={{ paddingTop: TENANT_NAVBAR_CLEARANCE }}>
          <TenantConsumiblesEventoEmptyState tenant={tenant} />
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-32" style={{ background: tenant.color_fondo, color: tenant.color_texto }}>
      <div className="max-w-5xl mx-auto px-4 space-y-6" style={{ paddingTop: TENANT_NAVBAR_CLEARANCE }}>
        <TenantConsumiblesEventoHero tenant={tenant} evento={evento} />

        <TenantConsumiblesEventoFilters
          tenant={tenant}
          busqueda={busqueda}
          tipoFiltro={tipoFiltro}
          barraFiltro={barraFiltro}
          barrasDisponibles={barrasDisponibles}
          onBusquedaChange={setBusqueda}
          onClearBusqueda={() => setBusqueda("")}
          onTipoFiltroChange={setTipoFiltro}
          onBarraFiltroChange={setBarraFiltro}
        />

        <TenantConsumiblesEventoCartSummary tenant={tenant} totalItems={totalItems} onCheckout={irAlCheckout} />

        <TenantConsumiblesEventoCatalog
          tenant={tenant}
          barrasFiltradas={barrasFiltradas}
          totalItems={totalItems}
          canSell={canSell}
          getCantidadEnCarrito={getCantidadEnCarrito}
          onAgregarConsumible={agregarConsumible}
          onQuitarConsumibleUno={quitarUno}
        />
      </div>

    </div>
  )
}
