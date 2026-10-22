"use client"

import { createContext, useContext, useMemo, useState } from "react"

export type ConsumibleCartItem = {
  barraId: string
  barraNombre: string
  buyerConsumibleRefundsEnabled?: boolean
  consumibleId: string
  nombre: string
  precio: number
  cantidad: number
  eventoId: string
  eventoNombre: string
  stockDisponible?: number
}

type ConsumiblesCartCtx = {
  items: ConsumibleCartItem[]
  agregar: (item: ConsumibleCartItem) => void
  quitar: (barraId: string, consumibleId: string) => void
  quitarUno: (barraId: string, consumibleId: string) => void
  limpiar: () => void
  total: number
  totalItems: number
}

const ConsumiblesCartContext = createContext<ConsumiblesCartCtx | null>(null)

export function useConsumiblesCart() {
  const ctx = useContext(ConsumiblesCartContext)
  if (!ctx) throw new Error("useConsumiblesCart must be used within ConsumiblesCartProvider")
  return ctx
}

function getKey(barraId: string, consumibleId: string) {
  return `${barraId}::${consumibleId}`
}

export default function ConsumiblesCartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ConsumibleCartItem[]>([])

  function agregar(item: ConsumibleCartItem) {
    setItems((prev) => {
      const key = getKey(item.barraId, item.consumibleId)
      const existing = prev.find((entry) => getKey(entry.barraId, entry.consumibleId) === key)
      if (existing) {
        const nextCantidad = existing.cantidad + item.cantidad
        const maxCantidad = typeof item.stockDisponible === "number" ? item.stockDisponible : undefined
        return prev.map((entry) =>
          getKey(entry.barraId, entry.consumibleId) === key
              ? {
                  ...entry,
                  cantidad: typeof maxCantidad === "number" ? Math.min(nextCantidad, maxCantidad) : nextCantidad,
                  buyerConsumibleRefundsEnabled:
                    typeof item.buyerConsumibleRefundsEnabled === "boolean"
                      ? item.buyerConsumibleRefundsEnabled
                      : entry.buyerConsumibleRefundsEnabled,
                  stockDisponible: typeof item.stockDisponible === "number" ? item.stockDisponible : entry.stockDisponible,
                }
            : entry
        )
      }
      return [...prev, item]
    })
  }

  function quitar(barraId: string, consumibleId: string) {
    const key = getKey(barraId, consumibleId)
    setItems((prev) => prev.filter((entry) => getKey(entry.barraId, entry.consumibleId) !== key))
  }

  function quitarUno(barraId: string, consumibleId: string) {
    const key = getKey(barraId, consumibleId)
    setItems((prev) => {
      const existing = prev.find((entry) => getKey(entry.barraId, entry.consumibleId) === key)
      if (!existing) return prev
      if (existing.cantidad <= 1) {
        return prev.filter((entry) => getKey(entry.barraId, entry.consumibleId) !== key)
      }
      return prev.map((entry) =>
        getKey(entry.barraId, entry.consumibleId) === key ? { ...entry, cantidad: entry.cantidad - 1 } : entry
      )
    })
  }

  function limpiar() {
    setItems([])
  }

  const value = useMemo(() => {
    const total = items.reduce((acc, item) => acc + item.precio * item.cantidad, 0)
    const totalItems = items.reduce((acc, item) => acc + item.cantidad, 0)
    return { items, agregar, quitar, quitarUno, limpiar, total, totalItems }
  }, [items])

  return <ConsumiblesCartContext.Provider value={value}>{children}</ConsumiblesCartContext.Provider>
}
