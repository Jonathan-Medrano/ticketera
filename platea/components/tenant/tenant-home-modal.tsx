"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import {
  X,
  Plus,
  Minus,
  Check,
  CalendarDays,
} from "lucide-react"
import { formatDateLong, formatMoney } from "@/lib/format"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { buildTenantApiPath, type TenantEventoResumen } from "@/lib/tenant"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"
import TenantImage from "./tenant-image"
import type { SelectedAsiento } from "./seat-picker"

// Lazy-load SeatPicker — only needed for "numerado" events
const SeatPicker = dynamic(() => import("./seat-picker"), { ssr: false })

type TenantEvento = TenantEventoResumen

type TenantCategoria = {
  id: string
  nombre: string
  descripcion?: string | null
  precio: number
  stock_disponible: number
  // Fee billing mode: si la empresa cobra el cargo por servicio al comprador.
  // El endpoint /evento/:id/categorias (usado por este modal) enriquece con estos
  // campos igual que el flujo SSR completo (evento-detalle-sections.tsx / evento-detalle.tsx).
  precio_buyer?: number
  fee_buyer_amount?: number
}

type TenantConfig = {
  color_primario: string
  color_texto: string
  color_fondo: string
  slug: string
}

export type TenantHomeModalProps = {
  modalEvento: TenantEvento
  modalCategorias: TenantCategoria[]
  loadingModal: boolean
  errorModal: string
  seleccion: Record<string, number>
  agregadoOk: boolean
  totalSeleccionado: number
  totalPrecio: number
  buyerSession: { userType: string } | null
  tenant: TenantConfig
  onClose: () => void
  onCambiarCantidad: (catId: string, delta: number, max: number) => void
  onAgregar: () => void
  /** Called for seated ("numerado") events — passes selected seats to parent */
  onAgregarAsientos?: (asientos: SelectedAsiento[]) => void
}

function getEventoImagen(evento: TenantEvento) {
  return evento.tanda_activa?.imagen_url || evento.imagen_url || undefined
}

export default function TenantHomeModal({
  modalEvento,
  modalCategorias,
  loadingModal,
  errorModal,
  seleccion,
  agregadoOk,
  totalSeleccionado,
  totalPrecio,
  buyerSession,
  tenant,
  onClose,
  onCambiarCantidad,
  onAgregar,
  onAgregarAsientos,
}: TenantHomeModalProps) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => { document.body.style.overflow = prev }
  }, [])

  // Seat picker disabled system-wide — always fall back to the "libre" (category) flow
  const isNumerado = false
  const [selectedAsientos, setSelectedAsientos] = useState<SelectedAsiento[]>([])
  const [asientosAgregadosOk, setAsientosAgregadosOk] = useState(false)

  function handleAgregarAsientos() {
    if (selectedAsientos.length === 0) return
    onAgregarAsientos?.(selectedAsientos)
    setAsientosAgregadosOk(true)
    setTimeout(() => {
      onClose()
    }, 1200)
  }

  const totalAsientosPrecio = selectedAsientos.reduce((acc, s) => acc + (s.precioBuyer ?? s.precio), 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="relative w-full max-w-md max-h-[90vh] overflow-y-auto overflow-x-hidden rounded-3xl shadow-2xl"
        style={{ background: tenant.color_fondo, border: `1px solid ${tenant.color_texto}20` }}
      >
        {/* Header modal */}
        <div className="relative h-44 overflow-hidden">
          {getEventoImagen(modalEvento) ? (
            <TenantImage src={getEventoImagen(modalEvento)} alt={modalEvento.nombre} fill sizes="448px" className="object-cover" />
          ) : (
            <div
              className="w-full h-full"
              style={{ background: `${tenant.color_primario}33` }}
            />
          )}
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to bottom, transparent, ${tenant.color_fondo})`,
            }}
          />
          <div className="absolute top-3 left-3 flex flex-wrap items-center gap-2">
            {modalEvento.stock_total != null && (
              <span className="rounded-full bg-black/45 backdrop-blur px-2.5 py-1 text-[11px] font-semibold text-white">
                {Number(modalEvento.stock_total) > 0 ? `${Number(modalEvento.stock_total)} disponibles` : "Sin stock"}
              </span>
            )}
            {modalEvento.tanda_activa && (
              <span className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-white" style={{ background: `${tenant.color_primario}dd` }}>
                {modalEvento.tanda_activa.nombre}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="absolute top-3 right-3 h-11 w-11 rounded-full bg-black/50 backdrop-blur flex items-center justify-center text-white cursor-pointer"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
          <div className="absolute bottom-3 left-4 right-4">
            <h2
              className="font-black text-lg leading-tight"
              style={{ color: tenant.color_texto }}
            >
              {modalEvento.nombre}
            </h2>
            {modalEvento.tanda_activa && (
              <p className="text-xs font-semibold mt-1" style={{ color: tenant.color_primario }}>
                Tanda activa: {modalEvento.tanda_activa.nombre}
              </p>
            )}
            {modalEvento.tanda_activa?.descripcion && (
              <p className="text-xs mt-1 line-clamp-2" style={{ color: `${tenant.color_texto}75` }}>
                {modalEvento.tanda_activa.descripcion}
              </p>
            )}
            {modalEvento.proxima_fecha && (
              <div
                className="flex items-center gap-1 text-xs mt-0.5"
                style={{ color: `${tenant.color_texto}70` }}
              >
                <CalendarDays className="h-3 w-3" />
                {formatDateLong(modalEvento.proxima_fecha)}
              </div>
            )}
          </div>
        </div>

        {/* Body — scrollable content only; CTA lives outside in the sticky footer below */}
        <div className="px-4 pt-3 space-y-3 max-h-[60vh] md:max-h-[65vh] overflow-y-auto">
          {isNumerado ? (
            /* ── Numbered seat map ── */
            <>
              {loadingModal ? (
                <div className="py-8 text-center" style={{ color: `${tenant.color_texto}50` }}>
                  <div
                    className="h-6 w-6 border-2 rounded-full animate-spin mx-auto mb-2"
                    style={{
                      borderColor: `${tenant.color_primario}40`,
                      borderTopColor: tenant.color_primario,
                    }}
                  />
                  Cargando categorías...
                </div>
              ) : errorModal ? (
                <div
                  className="rounded-2xl border px-4 py-5 text-sm text-center"
                  style={{
                    borderColor: `${tenant.color_texto}15`,
                    color: `${tenant.color_texto}70`,
                    background: `${tenant.color_texto}05`,
                  }}
                >
                  {errorModal}
                </div>
              ) : (
                <SeatPicker
                  eventoId={modalEvento.id}
                  categorias={modalCategorias.map((c) => ({
                    id: c.id,
                    nombre: c.nombre,
                    precio: Number(c.precio),
                    precio_buyer: c.precio_buyer !== undefined ? Number(c.precio_buyer) : undefined,
                    fee_buyer_amount: c.fee_buyer_amount !== undefined ? Number(c.fee_buyer_amount) : undefined,
                  }))}
                  selectedAsientos={selectedAsientos}
                  onSelectionChange={setSelectedAsientos}
                  colorPrimario={tenant.color_primario}
                  colorTexto={tenant.color_texto}
                />
              )}
            </>
          ) : (
            /* ── Free seating — quantity selectors ── */
            <>
              {loadingModal ? (
                <div className="py-8 text-center" style={{ color: `${tenant.color_texto}50` }}>
                  <div
                    className="h-6 w-6 border-2 rounded-full animate-spin mx-auto mb-2"
                    style={{
                      borderColor: `${tenant.color_primario}40`,
                      borderTopColor: tenant.color_primario,
                    }}
                  />
                  Cargando...
                </div>
              ) : errorModal ? (
                <div
                  className="rounded-2xl border px-4 py-5 text-sm text-center"
                  style={{
                    borderColor: `${tenant.color_texto}15`,
                    color: `${tenant.color_texto}70`,
                    background: `${tenant.color_texto}05`,
                  }}
                >
                  {errorModal}
                </div>
              ) : modalCategorias.length === 0 ? (
                <div
                  className="rounded-2xl border px-4 py-5 text-sm text-center"
                  style={{
                    borderColor: `${tenant.color_texto}15`,
                    color: `${tenant.color_texto}50`,
                    background: `${tenant.color_texto}05`,
                  }}
                >
                  No hay categorías disponibles
                </div>
              ) : (
                <TooltipProvider>
                  {modalCategorias.map((cat) => {
                    const cantidad = seleccion[cat.id] ?? 0
                    const isAgotado = cat.stock_disponible <= 0
                    const isSelected = cantidad > 0
                    return (
                      <div
                        key={cat.id}
                        className={`flex flex-col sm:flex-row sm:items-center gap-3 rounded-2xl border-2 p-4 transition-colors ${isAgotado ? "opacity-60" : ""}`}
                        style={{
                          background: isSelected ? `${tenant.color_primario}12` : `${tenant.color_texto}08`,
                          borderColor: isSelected ? tenant.color_primario : `${tenant.color_texto}10`,
                        }}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-3">
                            <p className={`font-bold text-sm ${isAgotado ? "line-through" : ""}`} style={{ color: tenant.color_texto }}>
                              {cat.nombre}
                            </p>
                            <p className={`shrink-0 font-black font-mono tabular-nums ${isAgotado ? "line-through" : ""}`} style={{ color: tenant.color_primario }}>
                              {formatMoney(cat.precio)}
                            </p>
                          </div>
                          {cat.descripcion && (
                            <p className="text-xs mt-0.5 truncate" style={{ color: `${tenant.color_texto}60` }}>
                              {cat.descripcion}
                            </p>
                          )}
                          {isAgotado ? (
                            <p className="text-xs font-semibold text-red-400 mt-1">Agotado</p>
                          ) : (
                            <p className="text-xs mt-1" style={{ color: `${tenant.color_texto}40` }}>
                              {cat.stock_disponible} disponibles
                            </p>
                          )}
                        </div>
                        <div className="flex items-center justify-between sm:justify-end gap-2 w-full sm:w-auto shrink-0">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => onCambiarCantidad(cat.id, -1, cat.stock_disponible)}
                                disabled={cantidad === 0}
                                className="h-11 w-11 rounded-full flex items-center justify-center disabled:opacity-30 cursor-pointer"
                                style={{ background: `${tenant.color_texto}15` }}
                                aria-label="Quitar unidad"
                              >
                                <Minus className="h-3.5 w-3.5" style={{ color: tenant.color_texto }} />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Quitar unidad</TooltipContent>
                          </Tooltip>
                          <span className="w-5 text-center font-bold text-sm" style={{ color: tenant.color_texto }}>
                            {cantidad}
                          </span>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={() => onCambiarCantidad(cat.id, 1, cat.stock_disponible)}
                                disabled={cantidad >= cat.stock_disponible}
                                className="h-11 w-11 rounded-full flex items-center justify-center disabled:opacity-30 cursor-pointer"
                                style={{ background: tenant.color_primario }}
                                aria-label="Agregar unidad"
                              >
                                <Plus className="h-3.5 w-3.5 text-white" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent>Agregar unidad</TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    )
                  })}
                </TooltipProvider>
              )}
            </>
          )}
        </div>

        {/* Sticky footer — CTA always visible, never buried in scroll */}
        <div className="px-4 pb-6 pt-3 space-y-2">
          {isNumerado ? (
            <>
              {!loadingModal && !errorModal && (
                <button
                  onClick={handleAgregarAsientos}
                  disabled={selectedAsientos.length === 0}
                  className="w-full h-12 rounded-2xl font-bold text-white text-sm disabled:opacity-40 transition-all flex items-center justify-between px-5 cursor-pointer"
                  style={{
                    background: asientosAgregadosOk
                      ? `${tenant.color_primario}99`
                      : tenant.color_primario,
                  }}
                >
                  {asientosAgregadosOk ? (
                    <>
                      <Check className="h-5 w-5" />
                      <span>¡Agregado al carrito!</span>
                      <span />
                    </>
                  ) : (
                    <>
                      <span>
                        {selectedAsientos.length > 0
                          ? `${selectedAsientos.length} asiento${selectedAsientos.length !== 1 ? "s" : ""}`
                          : "Elegí tus asientos"}
                      </span>
                      <span>
                        {totalAsientosPrecio > 0 ? formatMoney(totalAsientosPrecio) : ""}
                      </span>
                    </>
                  )}
                </button>
              )}
              {!buyerSession && selectedAsientos.length > 0 && (
                <p className="text-center text-xs" style={{ color: `${tenant.color_texto}60` }}>
                  Necesitás{" "}
                  <Link
                    href={buildTenantPath(tenant.slug, tenantRoutes.auth())}
                    className="underline font-medium"
                    style={{ color: tenant.color_primario }}
                  >
                    iniciar sesión
                  </Link>{" "}
                  para comprar
                </p>
              )}
            </>
          ) : (
            <>
              {!loadingModal && modalCategorias.length > 0 && (
                <button
                  onClick={onAgregar}
                  disabled={modalEvento?.modo_fecha === "multiple" ? false : totalSeleccionado === 0}
                  className="w-full h-12 rounded-2xl font-bold text-white text-sm disabled:opacity-40 transition-all flex items-center justify-between px-5 cursor-pointer"
                  style={{ background: agregadoOk ? `${tenant.color_primario}99` : tenant.color_primario }}
                >
                  {agregadoOk ? (
                    <>
                      <Check className="h-5 w-5" />
                      <span>¡Agregado al carrito!</span>
                      <span />
                    </>
                  ) : (
                    <>
                      <span>
                        {modalEvento?.modo_fecha === "multiple"
                          ? "Elegir fecha y continuar"
                          : totalSeleccionado > 0
                            ? `${totalSeleccionado} entrada${totalSeleccionado !== 1 ? "s" : ""}`
                            : "Seleccioná una entrada"}
                      </span>
                      <span>
                        {modalEvento?.modo_fecha === "multiple"
                          ? "→"
                          : totalPrecio > 0
                            ? formatMoney(totalPrecio)
                            : ""}
                      </span>
                    </>
                  )}
                </button>
              )}
              {!buyerSession && totalSeleccionado > 0 && (
                <p className="text-center text-xs" style={{ color: `${tenant.color_texto}60` }}>
                  Necesitás{" "}
                  <Link
                    href={buildTenantPath(tenant.slug, tenantRoutes.auth())}
                    className="underline font-medium"
                    style={{ color: tenant.color_primario }}
                  >
                    iniciar sesión
                  </Link>{" "}
                  para comprar
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
