"use client"

import { createContext, useCallback, useContext, useMemo, useState } from "react"
import { addCartItem, removeCartItem, removeCartItemUnit } from "./cart-helpers"

export interface CartItem {
  categoriaId: string
  eventoId: string
  eventoNombre: string
  categoriaNombre: string
  precio: number
  cantidad: number
  fechaId?: string
  fechaNombre?: string
  stockDisponible?: number
  // Fee billing mode: precioBuyer = precio + feeBuyer cuando modo='passed_to_buyer'.
  // El carrito UI muestra precioBuyer; el body al backend sigue mandando 'precio' (base).
  precioBuyer?: number
  feeBuyer?: number
  // 'addon' = extras como parking/meet&greet/merch. No requieren datos por unidad,
  // se mandan en un array `addons` aparte al backend en /checkout.
  kind?: "item" | "addon"
  addonId?: string
  // Seated-event fields — present only when the event uses tipo_mapa="numerado".
  // cantidad is always 1 for seated items and is fixed (not editable).
  asiento_id?: string
  asiento_fila?: string
  asiento_numero?: number
  asiento_seccion?: string
}

interface CartCtx {
  items: CartItem[]
  agregar: (item: CartItem) => void
  quitar: (categoriaId: string, fechaId?: string, asientoId?: string) => void
  quitarUno: (categoriaId: string, fechaId?: string, asientoId?: string) => void
  limpiar: () => void
  total: number
  totalBuyer: number
  totalFeeBuyer: number
  totalItems: number
}

const CartContext = createContext<CartCtx | null>(null)

export function useCart() {
  const ctx = useContext(CartContext)
  if (!ctx) throw new Error("useCart must be used within CartProvider")
  return ctx
}

export default function CartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<CartItem[]>([])

  const agregar = useCallback((item: CartItem) => {
    setItems((prev) => addCartItem(prev, item))
  }, [])

  const quitar = useCallback((categoriaId: string, fechaId?: string, asientoId?: string) => {
    setItems((prev) => removeCartItem(prev, categoriaId, fechaId, asientoId))
  }, [])

  const quitarUno = useCallback((categoriaId: string, fechaId?: string, asientoId?: string) => {
    setItems((prev) => removeCartItemUnit(prev, categoriaId, fechaId, asientoId))
  }, [])

  const limpiar = useCallback(() => {
    setItems([])
  }, [])

  const value = useMemo(() => {
    const total = items.reduce((acc, item) => acc + item.precio * item.cantidad, 0)
    const totalBuyer = items.reduce((acc, item) => acc + (item.precioBuyer ?? item.precio) * item.cantidad, 0)
    const totalFeeBuyer = items.reduce((acc, item) => acc + (item.feeBuyer ?? 0) * item.cantidad, 0)
    const totalItems = items.reduce((acc, item) => acc + item.cantidad, 0)

    return { items, agregar, quitar, quitarUno, limpiar, total, totalBuyer, totalFeeBuyer, totalItems }
  }, [agregar, items, limpiar, quitar, quitarUno])

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>
}
