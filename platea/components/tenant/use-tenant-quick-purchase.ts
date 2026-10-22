"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"
import { buildTenantApiPath, type TenantEventoResumen } from "@/lib/tenant"
import type { CartItem } from "./cart-provider"
import type { TenantCategoria } from "./tenant-home-sections"

type UseTenantQuickPurchaseParams = {
  canSell: boolean
  tenantSlug: string
  session: unknown
  agregar: (item: CartItem) => void
}

export function useTenantQuickPurchase({ canSell, tenantSlug, session, agregar }: UseTenantQuickPurchaseParams) {
  const router = useRouter()
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [modalEvento, setModalEvento] = useState<TenantEventoResumen | null>(null)
  const [modalCategorias, setModalCategorias] = useState<TenantCategoria[]>([])
  const [loadingModal, setLoadingModal] = useState(false)
  const [errorModal, setErrorModal] = useState("")
  const [seleccion, setSeleccion] = useState<Record<string, number>>({})
  const [agregadoOk, setAgregadoOk] = useState(false)
  const [categoriasCache, setCategoriasCache] = useState<Record<string, TenantCategoria[]>>({})

  const closeModal = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current)
      closeTimerRef.current = null
    }
    setModalEvento(null)
  }, [])

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current)
      }
    }
  }, [])

  const abrirModal = useCallback(async (evento: TenantEventoResumen) => {
    if (!canSell) return

    setModalEvento(evento)
    setSeleccion({})
    setAgregadoOk(false)
    setErrorModal("")

    const cachedCategorias = categoriasCache[evento.id]
    if (cachedCategorias) {
      setModalCategorias(cachedCategorias)
      setLoadingModal(false)
      return
    }

    setLoadingModal(true)
    try {
      const res = await fetch(buildTenantApiPath(tenantSlug, `/evento/${evento.id}/categorias`))
      const data = await res.json()
      const categorias = Array.isArray(data.categorias) ? data.categorias : []
      setModalCategorias(categorias)
      setCategoriasCache((prev) => ({ ...prev, [evento.id]: categorias }))
    } catch {
      setModalCategorias([])
      setErrorModal("No se pudieron cargar las entradas disponibles. Reintentá en unos segundos.")
    } finally {
      setLoadingModal(false)
    }
  }, [canSell, categoriasCache, tenantSlug])

  const cambiarCantidad = useCallback((catId: string, delta: number, max: number) => {
    setSeleccion((prev) => {
      const actual = prev[catId] ?? 0
      if (delta > 0 && actual >= max) {
        toast.error(`Solo quedan ${max} disponible${max === 1 ? "" : "s"}`)
        return prev
      }

      const nueva = Math.max(0, Math.min(max, actual + delta))
      if (nueva === 0) {
        const next = { ...prev }
        delete next[catId]
        return next
      }

      return { ...prev, [catId]: nueva }
    })
  }, [])

  const totalSeleccionado = useMemo(() => Object.values(seleccion).reduce((acc, value) => acc + value, 0), [seleccion])

  const totalPrecio = useMemo(
    () =>
      Object.entries(seleccion).reduce((acc, [catId, cantidad]) => {
        const categoria = modalCategorias.find((cat) => cat.id === catId)
        return acc + (categoria ? Number(categoria.precio) * cantidad : 0)
      }, 0),
    [modalCategorias, seleccion]
  )

  const handleAgregar = useCallback(() => {
    if (!canSell) return

    if (!(session as { user?: { userType?: string } } | null)?.user || (session as { user?: { userType?: string } } | null)?.user?.userType !== "comprador") {
      router.push(buildTenantPath(tenantSlug, tenantRoutes.auth("checkout")))
      return
    }

    if (modalEvento?.modo_fecha === "multiple") {
      router.push(buildTenantPath(tenantSlug, tenantRoutes.evento(modalEvento.id)))
      return
    }

    for (const [catId, cantidad] of Object.entries(seleccion)) {
      const categoria = modalCategorias.find((cat) => cat.id === catId)
      if (!categoria || cantidad === 0) continue

      if (cantidad > Number(categoria.stock_disponible)) {
        toast.error(`Solo quedan ${categoria.stock_disponible} disponible${Number(categoria.stock_disponible) === 1 ? "" : "s"} de ${categoria.nombre}`)
        return
      }

      agregar({
        categoriaId: categoria.id,
        eventoId: modalEvento!.id,
        eventoNombre: modalEvento!.nombre,
        categoriaNombre: categoria.nombre,
        precio: Number(categoria.precio),
        cantidad,
        stockDisponible: Number(categoria.stock_disponible),
      })
    }

    setAgregadoOk(true)
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current)
    closeTimerRef.current = setTimeout(() => {
      setModalEvento(null)
      closeTimerRef.current = null
    }, 1200)
  }, [agregar, canSell, modalCategorias, modalEvento, router, seleccion, session])

  return {
    modalEvento,
    modalCategorias,
    loadingModal,
    errorModal,
    seleccion,
    agregadoOk,
    totalSeleccionado,
    totalPrecio,
    abrirModal,
    cambiarCantidad,
    handleAgregar,
    closeModal,
  }
}
