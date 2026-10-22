"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { formatInt, formatMoney } from "@/lib/format"

// ---------------- Types ----------------

type AsientoEstado = "disponible" | "reservado" | "vendido" | "bloqueado"

type Asiento = {
  id: string
  fila: string
  numero: number
  estado: AsientoEstado
}

type Seccion = {
  id: string
  nombre: string
  categoria_id: string | null
  color: string | null
  asientos: Asiento[]
}

export type SelectedAsiento = {
  asiento_id: string
  fila: string
  numero: number
  seccion_id: string
  seccion_nombre: string
  categoria_id: string | null
  precio: number
  // Fee billing mode: precioBuyer = precio + feeBuyer cuando la empresa cobra el
  // cargo por servicio al comprador (modo='passed_to_buyer'). Mismo criterio que
  // categorías normales — ver evento-detalle-sections.tsx.
  precioBuyer?: number
  feeBuyer?: number
}

type Props = {
  eventoId: string
  categorias: Array<{
    id: string
    nombre: string
    precio: number
    precio_buyer?: number
    fee_buyer_amount?: number
  }>
  selectedAsientos: SelectedAsiento[]
  onSelectionChange: (items: SelectedAsiento[]) => void
  maxPerSection?: number
  // Tenant brand colors — required so the map adapts to each tenant's palette
  colorPrimario: string
  colorTexto: string
}

// ---------------- Helpers ----------------

function groupByFila(asientos: Asiento[]): Map<string, Asiento[]> {
  const map = new Map<string, Asiento[]>()
  for (const a of asientos) {
    const row = map.get(a.fila) ?? []
    row.push(a)
    map.set(a.fila, row)
  }
  for (const [fila, seats] of map) {
    map.set(fila, [...seats].sort((a, b) => a.numero - b.numero))
  }
  return map
}

function getSortedFilas(map: Map<string, Asiento[]>): string[] {
  return [...map.keys()].sort((a, b) => {
    const na = parseInt(a, 10)
    const nb = parseInt(b, 10)
    if (!isNaN(na) && !isNaN(nb)) return na - nb
    return a.localeCompare(b)
  })
}

// ---------------- Skeleton ----------------

function SeatPickerSkeleton({ colorPrimario }: { colorPrimario: string }) {
  return (
    <div className="space-y-4 animate-pulse">
      {[1, 2].map((i) => (
        <div
          key={i}
          className="rounded-2xl border p-4 space-y-3"
          style={{ borderColor: `${colorPrimario}15`, background: `${colorPrimario}05` }}
        >
          <div className="h-4 w-32 rounded" style={{ background: `${colorPrimario}20` }} />
          <div className="h-3 w-20 rounded" style={{ background: `${colorPrimario}15` }} />
          <div className="flex flex-wrap gap-1.5">
            {Array.from({ length: 12 }, (_, j) => (
              <div key={j} className="h-10 w-[46px] rounded-lg" style={{ background: `${colorPrimario}12` }} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---------------- Seat button ----------------

type SeatButtonProps = {
  asiento: Asiento
  isSelected: boolean
  sectionColor: string
  colorPrimario: string
  colorTexto: string
  onClick: () => void
}

function SeatButton({ asiento, isSelected, colorPrimario, colorTexto, onClick }: SeatButtonProps) {
  const isTaken =
    asiento.estado === "reservado" ||
    asiento.estado === "vendido" ||
    asiento.estado === "bloqueado"

  const label = `${asiento.fila}${asiento.numero}`

  let style: React.CSSProperties
  if (isTaken) {
    style = {
      background: `${colorTexto}10`,
      color: `${colorTexto}28`,
      border: `1px solid ${colorTexto}10`,
      cursor: "not-allowed",
    }
  } else if (isSelected) {
    style = {
      background: colorPrimario,
      color: "#fff",
      border: `1px solid ${colorPrimario}`,
    }
  } else {
    style = {
      background: "transparent",
      color: colorTexto,
      border: `1px solid ${colorTexto}28`,
    }
  }

  return (
    <button
      type="button"
      disabled={isTaken}
      onClick={onClick}
      aria-label={`Asiento ${label}${isTaken ? ", no disponible" : isSelected ? ", seleccionado" : ""}`}
      aria-pressed={isSelected ? true : undefined}
      className="h-10 min-w-[46px] px-1 rounded-lg inline-flex items-center justify-center text-[11px] font-mono font-semibold tabular-nums leading-none transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1"
      style={style}
    >
      {label}
    </button>
  )
}

// ---------------- Legend ----------------

function SeatLegend({
  colorPrimario,
  colorTexto,
}: {
  colorPrimario: string
  colorTexto: string
}) {
  const items: Array<{ label: string; style: React.CSSProperties }> = [
    {
      label: "Disponible",
      style: {
        border: `1px solid ${colorTexto}28`,
        background: "transparent",
        color: colorTexto,
      },
    },
    {
      label: "Seleccionado",
      style: {
        background: colorPrimario,
        color: "#fff",
        border: `1px solid ${colorPrimario}`,
      },
    },
    {
      label: "Ocupado",
      style: {
        background: `${colorTexto}10`,
        color: `${colorTexto}28`,
        border: `1px solid ${colorTexto}10`,
      },
    },
  ]

  return (
    <div className="flex flex-wrap items-center gap-4 pt-1">
      {items.map(({ label, style }) => (
        <div key={label} className="flex items-center gap-1.5">
          <div
            className="h-5 w-8 rounded text-[10px] font-mono font-semibold flex items-center justify-center shrink-0"
            style={style}
          >
            A1
          </div>
          <span className="text-[11px]" style={{ color: `${colorTexto}55` }}>
            {label}
          </span>
        </div>
      ))}
    </div>
  )
}

// ---------------- Main component ----------------

export default function SeatPicker({
  eventoId,
  categorias,
  selectedAsientos,
  onSelectionChange,
  maxPerSection = 10,
  colorPrimario,
  colorTexto,
}: Props) {
  const [secciones, setSecciones] = useState<Seccion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [evictedCount, setEvictedCount] = useState(0)

  // Keep refs in sync so the polling interval always reads latest props without adding to deps
  const selectedAsientosRef = useRef(selectedAsientos)
  selectedAsientosRef.current = selectedAsientos
  const onSelectionChangeRef = useRef(onSelectionChange)
  onSelectionChangeRef.current = onSelectionChange

  useEffect(() => {
    let cancelled = false

    async function fetchData(isInitial: boolean) {
      if (isInitial) {
        setLoading(true)
        setSecciones([])
        setError("")
      }
      try {
        const r = await fetch(`/api/asientos/${eventoId}/disponibilidad`)
        if (cancelled) return
        if (!r.ok) throw new Error(`${r.status}`)
        const data = await r.json()
        if (cancelled) return
        const next: Seccion[] = Array.isArray(data?.secciones) ? data.secciones : []
        setSecciones(next)

        // Evict seats that are no longer available (taken by another buyer since last fetch)
        if (!isInitial && selectedAsientosRef.current.length > 0) {
          const takenIds = new Set<string>()
          for (const sec of next) {
            for (const a of sec.asientos) {
              if (a.estado !== "disponible") takenIds.add(a.id)
            }
          }
          const stillAvailable = selectedAsientosRef.current.filter(
            (s) => !takenIds.has(s.asiento_id),
          )
          if (stillAvailable.length !== selectedAsientosRef.current.length) {
            setEvictedCount(selectedAsientosRef.current.length - stillAvailable.length)
            onSelectionChangeRef.current(stillAvailable)
          }
        }
      } catch {
        if (isInitial && !cancelled)
          setError("No se pudo cargar el mapa de asientos. Reintentá.")
      } finally {
        if (isInitial && !cancelled) setLoading(false)
      }
    }

    fetchData(true)
    const interval = setInterval(() => fetchData(false), 30_000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [eventoId])

  const selectedIds = useMemo(
    () => new Set(selectedAsientos.map((s) => s.asiento_id)),
    [selectedAsientos],
  )

  function toggleAsiento(seccion: Seccion, asiento: Asiento) {
    if (asiento.estado !== "disponible") return

    const alreadySelected = selectedIds.has(asiento.id)
    if (alreadySelected) {
      onSelectionChange(selectedAsientos.filter((s) => s.asiento_id !== asiento.id))
      return
    }

    const countInSection = selectedAsientos.filter((s) => s.seccion_id === seccion.id).length
    if (countInSection >= maxPerSection) return

    const categoria = categorias.find((c) => c.id === seccion.categoria_id)
    const precio = categoria?.precio ?? 0
    const precioBuyer = categoria?.precio_buyer !== undefined ? categoria.precio_buyer : undefined
    const feeBuyer = categoria?.fee_buyer_amount !== undefined ? categoria.fee_buyer_amount : undefined

    onSelectionChange([
      ...selectedAsientos,
      {
        asiento_id: asiento.id,
        fila: asiento.fila,
        numero: asiento.numero,
        seccion_id: seccion.id,
        seccion_nombre: seccion.nombre,
        categoria_id: seccion.categoria_id,
        precio,
        precioBuyer,
        feeBuyer,
      },
    ])
  }

  if (loading) return <SeatPickerSkeleton colorPrimario={colorPrimario} />

  if (error) {
    return (
      <div
        className="rounded-2xl border px-4 py-5 text-sm text-center"
        style={{
          borderColor: `${colorTexto}15`,
          color: `${colorTexto}60`,
          background: `${colorTexto}05`,
        }}
      >
        {error}
      </div>
    )
  }

  if (secciones.length === 0) {
    return (
      <div
        className="rounded-2xl border px-4 py-5 text-sm text-center"
        style={{
          borderColor: `${colorTexto}15`,
          color: `${colorTexto}50`,
          background: `${colorTexto}05`,
        }}
      >
        No hay asientos configurados para este evento.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Escenario indicator */}
      <div
        className="text-center text-[11px] font-semibold uppercase tracking-widest py-1.5 rounded-xl"
        style={{ background: `${colorTexto}0a`, color: `${colorTexto}40` }}
      >
        ▲ Escenario / Pista
      </div>

      {/* Section jump nav — shown when 3+ sections */}
      {secciones.length >= 3 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
          {secciones.map((seccion) => {
            const sectionColor = seccion.color ?? colorPrimario
            const countSelected = selectedAsientos.filter((s) => s.seccion_id === seccion.id).length
            return (
              <button
                key={seccion.id}
                type="button"
                onClick={() =>
                  document.getElementById(`seat-seccion-${seccion.id}`)?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  })
                }
                className="flex items-center gap-1.5 shrink-0 h-11 px-3 rounded-full text-xs font-medium border transition-colors"
                style={{
                  borderColor: `${sectionColor}40`,
                  background: countSelected > 0 ? `${sectionColor}18` : `${sectionColor}08`,
                  color: colorTexto,
                }}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ background: sectionColor }}
                  aria-hidden="true"
                />
                {seccion.nombre}
                {countSelected > 0 && (
                  <span
                    className="ml-0.5 rounded-full px-1 text-[10px] font-bold"
                    style={{ background: sectionColor, color: "#fff" }}
                  >
                    {countSelected}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}

      {secciones.map((seccion) => {
        const filaMap = groupByFila(seccion.asientos)
        const filas = getSortedFilas(filaMap)
        const categoria = categorias.find((c) => c.id === seccion.categoria_id)
        const countSelected = selectedAsientos.filter(
          (s) => s.seccion_id === seccion.id,
        ).length
        const sectionColor = seccion.color ?? colorPrimario
        const disponibles = seccion.asientos.filter(a => a.estado === "disponible").length
        const maxSeatsPerRow = filas.length > 0
          ? Math.max(...filas.map((fila) => filaMap.get(fila)!.length))
          : 0

        return (
          <div
            id={`seat-seccion-${seccion.id}`}
            key={seccion.id}
            className="rounded-2xl border p-4 space-y-3 scroll-mt-4"
            style={{
              borderColor: `${sectionColor}28`,
              background: `${sectionColor}06`,
            }}
          >
            {/* Section header */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div
                  className="h-2.5 w-2.5 rounded-full shrink-0"
                  style={{ background: sectionColor }}
                  aria-hidden="true"
                />
                <p className="text-sm font-bold" style={{ color: colorTexto }}>
                  {seccion.nombre}
                </p>
                {categoria && (
                  <span
                    className="text-xs font-mono tabular-nums font-semibold"
                    style={{ color: sectionColor }}
                  >
                    {formatMoney(categoria.precio_buyer ?? categoria.precio)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[11px]" style={{ color: `${colorTexto}50` }}>
                  {formatInt(disponibles)} disp.
                </span>
                {countSelected > 0 && (
                  <span
                    className="text-xs font-bold px-2 py-0.5 rounded-full"
                    style={{ background: colorPrimario, color: "#fff" }}
                  >
                    {countSelected} sel.
                  </span>
                )}
              </div>
            </div>

            {/* Seat grid — overflow-x-auto for mobile */}
            <div className="relative">
              <div className="overflow-x-auto -mx-1 px-1 pb-1">
              <div className="space-y-1.5 w-max min-w-full">
                {filas.map((fila) => {
                  const asientos = filaMap.get(fila)!
                  return (
                    <div key={fila} className="flex items-center gap-1.5">
                      {/* Row label */}
                      <span
                        className="text-[10px] font-mono font-semibold w-4 shrink-0 text-right select-none"
                        style={{ color: `${colorTexto}38` }}
                        aria-label={`Fila ${fila}`}
                      >
                        {fila}
                      </span>
                      {/* Seats */}
                      <div className="flex items-center gap-1">
                        {asientos.map((asiento) => (
                          <SeatButton
                            key={asiento.id}
                            asiento={asiento}
                            isSelected={selectedIds.has(asiento.id)}
                            sectionColor={sectionColor}
                            colorPrimario={colorPrimario}
                            colorTexto={colorTexto}
                            onClick={() => toggleAsiento(seccion, asiento)}
                          />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
              </div>
              {maxSeatsPerRow > 12 && (
                <div
                  className="absolute inset-y-0 right-0 w-8 pointer-events-none"
                  style={{
                    background: `linear-gradient(to right, transparent, ${sectionColor}25)`,
                  }}
                  aria-hidden="true"
                />
              )}
            </div>
          </div>
        )
      })}

      {/* Legend */}
      <SeatLegend colorPrimario={colorPrimario} colorTexto={colorTexto} />

      {/* Eviction alert — shown when polling removes a seat someone else took */}
      {evictedCount > 0 && (
        <div
          className="flex items-start justify-between gap-3 rounded-xl border px-3 py-2.5 text-sm"
          style={{ borderColor: "rgba(245,158,11,.3)", background: "rgba(245,158,11,.1)", color: colorTexto }}
        >
          <span>
            {evictedCount === 1
              ? "Un asiento que habías seleccionado ya no está disponible — lo quitamos del pedido."
              : `${evictedCount} asientos que habías seleccionado ya no están disponibles — los quitamos del pedido.`}
          </span>
          <button
            type="button"
            onClick={() => setEvictedCount(0)}
            className="shrink-0 text-xs underline opacity-70 hover:opacity-100"
          >
            OK
          </button>
        </div>
      )}

      {/* Selection summary chips */}
      {selectedAsientos.length > 0 && (
        <div
          className="rounded-xl border px-3 py-2.5 space-y-1.5"
          style={{
            borderColor: `${colorPrimario}30`,
            background: `${colorPrimario}08`,
          }}
        >
          <p className="text-xs font-semibold" style={{ color: colorPrimario }}>
            {selectedAsientos.length} asiento
            {selectedAsientos.length !== 1 ? "s" : ""} seleccionado
            {selectedAsientos.length !== 1 ? "s" : ""}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {selectedAsientos.map((s) => (
              <span
                key={s.asiento_id}
                className="text-[11px] font-mono font-semibold px-2 py-0.5 rounded-lg"
                style={{ background: colorPrimario, color: "#fff" }}
              >
                {s.seccion_nombre.length > 8
                  ? s.seccion_nombre.slice(0, 8)
                  : s.seccion_nombre}{" "}
                {s.fila}{s.numero}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
