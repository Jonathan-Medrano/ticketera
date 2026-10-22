"use client"

import { Minus, Plus } from "lucide-react"
import { formatMoney } from "@/lib/format"
import type { TenantEmpresa } from "@/lib/tenant"
import TenantImage from "./tenant-image"
import { TenantCard } from "./tenant-surface"

/**
 * Card de consumible compartida entre la sección embebida en el detalle de
 * evento (`EventoDetalleConsumiblesSection`) y el catálogo completo
 * (`TenantConsumiblesEventoCatalog`) — antes eran dos sistemas de card
 * distintos para el mismo dato (ver plan de rediseño de consumibles, Fase 1.2).
 * Muestra un stepper +/- (no un botón de "agregar" mudo) para que la cantidad
 * en el carrito sea visible y reversible, igual que Entradas/Addons.
 */
export function ConsumibleCard({
  tenant,
  nombre,
  descripcion,
  imagenUrl,
  precio,
  stockActual,
  stockIlimitado,
  agotado = false,
  cantidadEnCarrito,
  canSell,
  onIncrementar,
  onDecrementar,
  size = "compact",
}: {
  tenant: TenantEmpresa
  nombre: string
  descripcion?: string | null
  imagenUrl?: string | null
  precio: number
  stockActual: number
  stockIlimitado: boolean
  agotado?: boolean
  cantidadEnCarrito: number
  canSell: boolean
  onIncrementar: () => void
  onDecrementar: () => void
  /** "compact" para listas embebidas (miniatura chica), "full" para el catálogo en grilla (imagen grande). */
  size?: "compact" | "full"
}) {
  const sinStock = agotado || (!stockIlimitado && stockActual <= 0)
  const disabled = !canSell || sinStock
  const stockLabel = agotado ? "Agotado" : stockIlimitado ? "Ilimitado" : `${stockActual} disponible${stockActual === 1 ? "" : "s"}`
  const isFull = size === "full"

  return (
    <TenantCard
      tenant={tenant}
      className={isFull ? "rounded-[1.75rem] overflow-hidden border flex flex-col" : "rounded-2xl p-3 border"}
      tone="subtle"
    >
      {isFull ? (
        <div className="relative h-40">
          {imagenUrl ? (
            <TenantImage src={imagenUrl} alt={nombre} className="h-full w-full object-cover" fill sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw" />
          ) : (
            <div className="h-full w-full" style={{ background: `linear-gradient(135deg, ${tenant.color_primario}22, ${tenant.color_fondo})` }} />
          )}
          <div className="absolute top-3 right-3 rounded-full px-3 py-1 text-xs font-bold" style={{ background: "rgba(15,23,42,.62)", color: "#fff" }}>
            {stockLabel}
          </div>
        </div>
      ) : null}

      <div className={isFull ? "p-4 flex-1 flex flex-col" : "flex items-start gap-3"}>
        {!isFull && (
          <div className="relative h-14 w-14 shrink-0 rounded-xl overflow-hidden" style={{ background: `${tenant.color_texto}08` }}>
            {imagenUrl ? (
              <TenantImage src={imagenUrl} alt={nombre} className="h-full w-full object-cover" fill sizes="56px" />
            ) : (
              <div className="h-full w-full" style={{ background: `linear-gradient(135deg, ${tenant.color_primario}22, ${tenant.color_fondo})` }} />
            )}
          </div>
        )}

        <div className={isFull ? "flex-1 flex flex-col" : "min-w-0 flex-1"}>
          <h3 className={isFull ? "font-black text-lg leading-tight line-clamp-1" : "font-bold text-sm leading-tight truncate"} style={{ color: tenant.color_texto }}>
            {nombre}
          </h3>
          {descripcion ? (
            <p className={isFull ? "text-sm mt-2 line-clamp-2" : "text-xs mt-0.5 line-clamp-1"} style={{ color: `${tenant.color_texto}68` }}>
              {descripcion}
            </p>
          ) : null}
          {!isFull ? (
            <p className="text-xs mt-0.5" style={{ color: sinStock ? undefined : `${tenant.color_texto}55` }}>
              {sinStock ? <span className="font-semibold text-red-400">{stockLabel}</span> : stockLabel}
            </p>
          ) : null}

          <div className={isFull ? "mt-auto pt-4 flex items-end justify-between gap-3" : "mt-2 flex items-center justify-between gap-3"}>
            <p className={isFull ? "text-2xl font-black font-mono tabular-nums" : "text-sm font-black font-mono tabular-nums"} style={{ color: tenant.color_primario }}>
              {formatMoney(precio)}
            </p>

            {cantidadEnCarrito > 0 ? (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={onDecrementar}
                  disabled={!canSell}
                  aria-label={`Quitar una unidad de ${nombre}`}
                  className="h-9 w-9 rounded-full flex items-center justify-center disabled:opacity-30 cursor-pointer"
                  style={{ background: `${tenant.color_texto}12`, color: tenant.color_texto }}
                >
                  <Minus className="h-3.5 w-3.5" />
                </button>
                <span className="w-5 text-center text-sm font-bold tabular-nums" style={{ color: tenant.color_texto }}>
                  {cantidadEnCarrito}
                </span>
                <button
                  type="button"
                  onClick={onIncrementar}
                  disabled={disabled || (!stockIlimitado && cantidadEnCarrito >= stockActual)}
                  aria-label={`Agregar una unidad de ${nombre}`}
                  className="h-9 w-9 rounded-full flex items-center justify-center disabled:opacity-30 cursor-pointer"
                  style={{ background: tenant.color_primario, color: "#fff" }}
                >
                  <Plus className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={onIncrementar}
                disabled={disabled}
                aria-label={`Agregar ${nombre}`}
                className={isFull ? "shrink-0 h-12 w-12 rounded-2xl flex items-center justify-center transition-opacity disabled:opacity-40 cursor-pointer" : "shrink-0 h-9 w-9 rounded-full flex items-center justify-center transition-opacity disabled:opacity-40 cursor-pointer"}
                style={{ background: tenant.color_primario, color: "#fff" }}
              >
                <Plus className={isFull ? "h-5 w-5" : "h-3.5 w-3.5"} />
              </button>
            )}
          </div>
        </div>
      </div>
    </TenantCard>
  )
}
