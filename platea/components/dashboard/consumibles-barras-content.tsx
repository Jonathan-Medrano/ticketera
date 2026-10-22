"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { formatMoney, formatInt } from "@/lib/format"
import { writeDashboardSearchParam } from "@/lib/dashboard-grid-search"
import { useDashboardDebouncedSearch } from "@/lib/use-dashboard-debounced-search"
import { toast } from "sonner"
import { logClientError } from "@/lib/safe-client-log"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { IconAction } from "@/components/ui/icon-action"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import {
  Plus,
  Pencil,
  Trash2,
  AlertTriangle,
  Wine,
  Package,
  ChevronRight,
  ArrowLeft,
  TrendingDown,
  Ban,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Columns3,
  ChevronsLeft,
  ChevronLeft,
  ChevronsRight,
  Infinity as InfinityIcon,
} from "lucide-react"
import { useLoading } from "@/components/loading-provider"
import { puedeHacer, type Permisos } from "@/lib/permisos"
import {
  consumiblesApi,
  type BarraDto,
  type BarraStockDto,
  type CoberturaBarraDto,
  type ConsumibleDto,
} from "@/lib/api"
import { BarrasExportAction } from "@/components/dashboard/barras-export-action"

interface Props {
  eventos: Array<{ id: string; nombre: string }>
  permisos?: Permisos
  esEmpleado?: boolean
}

type Barra = BarraDto
type StockItem = BarraStockDto
type Consumible = ConsumibleDto

export default function ConsumiblesBarrasContent({ eventos, permisos, esEmpleado }: Props) {
  const puede = (permiso: keyof Permisos) => puedeHacer(permiso, esEmpleado ?? false, permisos)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { withLoading } = useLoading()

  const eventoQuery = searchParams.get("evento") ?? ""
  const barraQuery = searchParams.get("barra") ?? ""
  const barraBusqueda = searchParams.get("barraBusqueda") ?? ""
  const barraEstado = searchParams.get("barraEstado") ?? "todos"
  const barrasPage = Math.max(1, Number(searchParams.get("barrasPage") ?? "1") || 1)
  const barrasPageSize = [10, 25, 50, 100].includes(Number(searchParams.get("barrasPageSize")))
    ? Number(searchParams.get("barrasPageSize"))
    : 25

  const [eventoId, setEventoId] = useState<string>(eventoQuery)
  const [barras, setBarras] = useState<Barra[]>([])
  const [cargandoBarras, setCargandoBarras] = useState(false)
  const [sortBarrasBy, setSortBarrasBy] = useState<"nombre" | "estado">("nombre")
  const [sortBarrasDir, setSortBarrasDir] = useState<"asc" | "desc">("asc")
  const [columnasBarrasVisibles, setColumnasBarrasVisibles] = useState({
    estado: true,
  })
  // Panel de stock
  const [barraSeleccionada, setBarraSeleccionada] = useState<Barra | null>(null)
  const [stock, setStock] = useState<StockItem[]>([])
  const [cargandoStock, setCargandoStock] = useState(false)
  const [stockEstadoFiltro, setStockEstadoFiltro] = useState<"todos" | "activos" | "inactivos">("todos")
  const [busquedaStock, setBusquedaStock] = useState("")
  const [sortStockBy, setSortStockBy] = useState<"nombre" | "stock_actual" | "stock_inicial" | "precio_base" | "precio_override" | "estado_stock">("nombre")
  const [sortStockDir, setSortStockDir] = useState<"asc" | "desc">("asc")
  const [stockPage, setStockPage] = useState(1)
  const [stockPageSize, setStockPageSize] = useState(25)
  const [columnasStockVisibles, setColumnasStockVisibles] = useState({
    precioBase: true,
    precioOverride: true,
    stockInicial: true,
    stockActual: true,
  })
  const { value: barraBusquedaInput, setValue: setBarraBusquedaInput } =
    useDashboardDebouncedSearch({
      urlValue: barraBusqueda,
      emit: (next) => updateQuery({ barraBusqueda: next, barrasPage: 1 }),
    })

  // Modal barra nueva / editar
  const [modalBarra, setModalBarra] = useState<Barra | "nueva" | null>(null)
  const [formBarra, setFormBarra] = useState("")
  const [formBuyerRefundsEnabled, setFormBuyerRefundsEnabled] = useState(true)

  // Modal eliminar barra
  const [modalEliminarBarra, setModalEliminarBarra] = useState<Barra | null>(null)

  // Modal agregar consumible a stock
  const [modalAgregarStock, setModalAgregarStock] = useState(false)
  const [consumiblesCatalogo, setConsumiblesCatalogo] = useState<Consumible[]>([])
  const [formStock, setFormStock] = useState({
    consumible_id: "",
    stock_inicial: "",
    precio_override: "",
    stock_ilimitado: false,
  })

  // Modal stock masivo
  const [modalStockMasivo, setModalStockMasivo] = useState(false)
  const [itemsMasivos, setItemsMasivos] = useState<
    Array<{ consumible_id: string; nombre: string; stock_inicial: string; precio_override: string }>
  >([])
  const [consumibleSeleccionadoId, setConsumibleSeleccionadoId] = useState("")
  const [coberturaBarras, setCoberturaBarras] = useState<CoberturaBarraDto[]>([])
  const [cargandoCobertura, setCargandoCobertura] = useState(false)
  const [asignarATodas, setAsignarATodas] = useState(false)
  const [barrasSeleccionadas, setBarrasSeleccionadas] = useState<string[]>([])
  const [formAsignacion, setFormAsignacion] = useState({ stock_inicial: "0", precio_override: "", stock_ilimitado: false })

  // Confirmaciones de operaciones masivas (preview antes del submit)
  const [confirmarStockMasivo, setConfirmarStockMasivo] = useState(false)
  const [confirmarAsignacionMasiva, setConfirmarAsignacionMasiva] = useState(false)

  function updateQuery(next: { evento?: string; barra?: string; barraBusqueda?: string; barraEstado?: string; barrasPage?: number; barrasPageSize?: string }) {
    const params = new URLSearchParams(searchParams.toString())

    if (next.evento !== undefined) {
      if (next.evento) params.set("evento", next.evento)
      else params.delete("evento")
    }

    if (next.barra !== undefined) {
      if (next.barra) params.set("barra", next.barra)
      else params.delete("barra")
    }

    if (next.barraBusqueda !== undefined) {
      writeDashboardSearchParam(params, "barraBusqueda", next.barraBusqueda)
    }

    if (next.barraEstado !== undefined) {
      if (next.barraEstado && next.barraEstado !== "todos") params.set("barraEstado", next.barraEstado)
      else params.delete("barraEstado")
    }

    if (next.barrasPage !== undefined) {
      params.set("barrasPage", String(next.barrasPage))
    }

    if (next.barrasPageSize !== undefined) {
      if (next.barrasPageSize) params.set("barrasPageSize", next.barrasPageSize)
      else params.delete("barrasPageSize")
    }

    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }

  useEffect(() => {
    setEventoId(eventoQuery)
  }, [eventoQuery])

  // Cargar barras cuando cambia el evento
  useEffect(() => {
    if (!eventoId) {
      setBarras([])
      setBarraSeleccionada(null)
      return
    }

    setCargandoBarras(true)
    consumiblesApi
      .getBarras(eventoId)
      .then((data) => {
        setBarras(data)
        setBarraSeleccionada(null)
      })
      .catch(() => {
        logClientError("consumibles barras load barras")
        toast.error("No se pudieron cargar las barras")
      })
      .finally(() => setCargandoBarras(false))
  }, [eventoId])

  useEffect(() => {
    if (!eventoId) {
      setConsumiblesCatalogo([])
      setConsumibleSeleccionadoId("")
      setCoberturaBarras([])
      return
    }

    consumiblesApi
      .list({ pageSize: 500, estado: "activos", sortBy: "nombre", sortDir: "asc" })
      .then((data) => setConsumiblesCatalogo(data))
      .catch(() => {
        logClientError("consumibles barras load catalogo")
        toast.error("No se pudo cargar el catálogo de consumibles")
      })
  }, [eventoId])

  useEffect(() => {
    if (!barraQuery) {
      setBarraSeleccionada(null)
      setStock([])
      return
    }

    const barra = barras.find((item) => item.id === barraQuery)
    if (barra) {
      setBarraSeleccionada((prev) => (prev?.id === barra.id ? prev : barra))
    } else {
      setBarraSeleccionada(null)
      setStock([])
    }
  }, [barraQuery, barras])

  useEffect(() => {
    if (!eventoId || !consumibleSeleccionadoId) {
      setCoberturaBarras([])
      setBarrasSeleccionadas([])
      setAsignarATodas(false)
      return
    }

    setCargandoCobertura(true)
    consumiblesApi
      .getCobertura(consumibleSeleccionadoId, eventoId)
      .then((data) => {
        setCoberturaBarras(data.barras)
        setBarrasSeleccionadas([])
        setAsignarATodas(false)
      })
      .catch(() => {
        logClientError("consumibles barras load cobertura")
        setCoberturaBarras([])
      })
      .finally(() => setCargandoCobertura(false))
  }, [eventoId, consumibleSeleccionadoId])

  // Cargar stock cuando se selecciona una barra
  const cargarStockBarra = useCallback(async (barra: Barra) => {
    setCargandoStock(true)
    try {
      const data = await consumiblesApi.getBarraStock(barra.id)
      setStock(data)
    } catch {
      logClientError("consumibles barras load stock")
    } finally {
      setCargandoStock(false)
    }
  }, [])

  async function verStock(barra: Barra) {
    updateQuery({ barra: barra.id })
  }

  useEffect(() => {
    if (!barraSeleccionada) return
    void cargarStockBarra(barraSeleccionada)
  }, [barraSeleccionada, cargarStockBarra])

  // ─── BARRAS ─────────────────────────────────────────────────────────────────

  function abrirNuevaBarra() {
    setFormBarra("")
    setFormBuyerRefundsEnabled(true)
    setModalBarra("nueva")
  }

  function abrirEditarBarra(barra: Barra) {
    setFormBarra(barra.nombre)
    setFormBuyerRefundsEnabled(Number(barra.buyer_consumible_refunds_enabled ?? 1) === 1)
    setModalBarra(barra)
  }

  async function guardarBarra() {
    if (!formBarra.trim()) {
      toast.error("El nombre es obligatorio")
      return
    }

    const esNueva = modalBarra === "nueva"

    await withLoading(async () => {
      try {
        if (esNueva) {
          const id = await consumiblesApi.createBarra({
            evento_id: eventoId,
            nombre: formBarra.trim(),
            buyer_consumible_refunds_enabled: formBuyerRefundsEnabled,
          })
          const nueva: Barra = {
            id,
            nombre: formBarra.trim(),
            activa: 1,
            buyer_consumible_refunds_enabled: formBuyerRefundsEnabled ? 1 : 0,
            evento_id: eventoId,
            empresa_id: "",
          }
          toast.success("Barra creada correctamente")
          setBarras((prev) => [...prev, nueva])
        } else {
          const barra = modalBarra as Barra
          await consumiblesApi.updateBarra(barra.id, {
            nombre: formBarra.trim(),
            buyer_consumible_refunds_enabled: formBuyerRefundsEnabled,
          })
          toast.success("Barra actualizada correctamente")
          setBarras((prev) =>
            prev.map((b) => (b.id === barra.id ? { ...b, nombre: formBarra.trim(), buyer_consumible_refunds_enabled: formBuyerRefundsEnabled ? 1 : 0 } : b))
          )
          if (barraSeleccionada?.id === barra.id) {
            setBarraSeleccionada((prev) =>
              prev ? { ...prev, nombre: formBarra.trim(), buyer_consumible_refunds_enabled: formBuyerRefundsEnabled ? 1 : 0 } : prev
            )
          }
        }
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo guardar la barra")
        return
      }

      setModalBarra(null)
      router.refresh()
    })
  }

  async function toggleActivaBarra(barra: Barra) {
    const nuevaActiva = Number(barra.activa) === 1 ? 0 : 1
    await withLoading(async () => {
      try {
        await consumiblesApi.updateBarra(barra.id, { activa: nuevaActiva })
        setBarras((prev) =>
          prev.map((b) => (b.id === barra.id ? { ...b, activa: nuevaActiva } : b))
        )
        setCoberturaBarras((prev) =>
          prev.map((b) => (b.id === barra.id ? { ...b, activa: nuevaActiva } : b))
        )
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo actualizar")
      }
    })
  }

  async function confirmarEliminarBarra() {
    if (!modalEliminarBarra) return
    await withLoading(async () => {
      try {
        await consumiblesApi.deleteBarra(modalEliminarBarra.id)
        setBarras((prev) => prev.filter((b) => b.id !== modalEliminarBarra.id))
        setCoberturaBarras((prev) => prev.filter((b) => b.id !== modalEliminarBarra.id))
        if (barraSeleccionada?.id === modalEliminarBarra.id) {
          setBarraSeleccionada(null)
          setStock([])
        }
        setModalEliminarBarra(null)
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo eliminar la barra")
      }
    })
  }

  // ─── STOCK ──────────────────────────────────────────────────────────────────

  async function abrirAgregarStock() {
    setFormStock({ consumible_id: "", stock_inicial: "", precio_override: "", stock_ilimitado: false })
    setModalAgregarStock(true)

    if (consumiblesCatalogo.length === 0) {
      try {
        const data = await consumiblesApi.list({ pageSize: 500, estado: "activos", sortBy: "nombre", sortDir: "asc" })
        setConsumiblesCatalogo(data)
      } catch {
        logClientError("consumibles barras preload catalogo")
      }
    }
  }

  async function guardarStock() {
    if (!formStock.consumible_id) {
      toast.error("Seleccioná un consumible")
      return
    }
    const stockInicialNum = Number(formStock.stock_inicial)
    if (!formStock.stock_ilimitado) {
      if (formStock.stock_inicial === "" || !Number.isFinite(stockInicialNum) || stockInicialNum < 0) {
        toast.error("El stock inicial debe ser 0 o mayor")
        return
      }
      if (!Number.isInteger(stockInicialNum)) {
        toast.error("El stock inicial debe ser un número entero (sin decimales)")
        return
      }
    }

    if (!barraSeleccionada) return

    await withLoading(async () => {
      try {
        await consumiblesApi.addBarraStock(barraSeleccionada.id, {
          consumible_id: formStock.consumible_id,
          stock_inicial: formStock.stock_ilimitado ? 0 : stockInicialNum,
          precio_override: formStock.precio_override ? Number(formStock.precio_override) : null,
          stock_ilimitado: formStock.stock_ilimitado,
        })

        toast.success("Consumible agregado al stock")
        const stockData = await consumiblesApi.getBarraStock(barraSeleccionada.id)
        setStock(stockData)

        setModalAgregarStock(false)
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo agregar")
        return
      }
    })
  }

  async function setItemDisponibilidad(
    item: StockItem,
    cambios: { stock_ilimitado?: boolean; agotado?: boolean }
  ) {
    if (!barraSeleccionada) return

    await withLoading(async () => {
      try {
        await consumiblesApi.setItemDisponibilidad(barraSeleccionada.id, item.consumible_id, cambios)
        const stockData = await consumiblesApi.getBarraStock(barraSeleccionada.id)
        setStock(stockData)

        if (cambios.agotado !== undefined) {
          toast.success(cambios.agotado ? "Producto marcado como agotado" : "Producto marcado como disponible")
        } else if (cambios.stock_ilimitado !== undefined) {
          toast.success(cambios.stock_ilimitado ? "Stock ilimitado activado" : "Stock ilimitado desactivado")
        } else {
          toast.success("Disponibilidad actualizada")
        }
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo actualizar la disponibilidad")
      }
    })
  }

  function abrirStockMasivo() {
    setItemsMasivos(
      stock.map((s) => ({
        consumible_id: s.consumible_id,
        nombre: s.nombre,
        stock_inicial: String(s.stock_inicial),
        precio_override: s.precio_override != null ? String(s.precio_override) : "",
      }))
    )
    setModalStockMasivo(true)
  }

  function pedirConfirmacionStockMasivo() {
    if (itemsMasivos.length === 0) return

    const invalido = itemsMasivos.find((item) => {
      const num = Number(item.stock_inicial)
      return item.stock_inicial === "" || !Number.isFinite(num) || num < 0 || !Number.isInteger(num)
    })
    if (invalido) {
      toast.error(`Stock inicial inválido en "${invalido.nombre}": debe ser un entero 0 o mayor`)
      return
    }

    setConfirmarStockMasivo(true)
  }

  async function guardarStockMasivo() {
    if (!barraSeleccionada) return

    await withLoading(async () => {
      const items = itemsMasivos.map((item) => ({
        consumible_id: item.consumible_id,
        stock_inicial: Number(item.stock_inicial),
        precio_override: item.precio_override ? Number(item.precio_override) : null,
      }))

      try {
        await consumiblesApi.updateBarraStock(barraSeleccionada.id, { items })

        toast.success("Stock actualizado correctamente")
        const stockData = await consumiblesApi.getBarraStock(barraSeleccionada.id)
        setStock(stockData)

        setConfirmarStockMasivo(false)
        setModalStockMasivo(false)
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo actualizar el stock")
        return
      }
    })
  }

  function toggleBarraAsignada(barraId: string) {
    setBarrasSeleccionadas((prev) =>
      prev.includes(barraId) ? prev.filter((id) => id !== barraId) : [...prev, barraId]
    )
  }

  function pedirConfirmacionAsignacionMasiva() {
    if (!eventoId || !consumibleSeleccionadoId) {
      toast.error("Seleccioná un evento y un producto")
      return
    }

    if (!asignarATodas && barrasSeleccionadas.length === 0) {
      toast.error("Seleccioná al menos una barra o elegí todas las barras")
      return
    }

    const stockInicial = Number(formAsignacion.stock_inicial)
    if (!formAsignacion.stock_ilimitado) {
      if (formAsignacion.stock_inicial === "" || !Number.isFinite(stockInicial) || stockInicial < 0) {
        toast.error("El stock inicial debe ser 0 o mayor")
        return
      }
      if (!Number.isInteger(stockInicial)) {
        toast.error("El stock inicial debe ser un número entero (sin decimales)")
        return
      }
    }

    setConfirmarAsignacionMasiva(true)
  }

  async function asignarConsumibleMasivo() {
    if (!eventoId || !consumibleSeleccionadoId) {
      toast.error("Seleccioná un evento y un producto")
      return
    }

    const stockInicial = Number(formAsignacion.stock_inicial)

    await withLoading(async () => {
      try {
        const result = await consumiblesApi.assignToBarras(consumibleSeleccionadoId, {
          evento_id: eventoId,
          todas: asignarATodas,
          barra_ids: asignarATodas ? undefined : barrasSeleccionadas,
          stock_inicial: formAsignacion.stock_ilimitado ? 0 : stockInicial,
          precio_override: formAsignacion.precio_override
            ? Number(formAsignacion.precio_override)
            : null,
          stock_ilimitado: formAsignacion.stock_ilimitado,
        })

        const cobertura = await consumiblesApi.getCobertura(consumibleSeleccionadoId, eventoId)
        setCoberturaBarras(cobertura.barras)
        setBarrasSeleccionadas([])
        setAsignarATodas(false)
        setConfirmarAsignacionMasiva(false)
        toast.success(`Asignación realizada en ${result.data.assigned} barra(s)`)
        router.refresh()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo asignar el producto")
      }
    })
  }

  // ─── RENDER ─────────────────────────────────────────────────────────────────

  function toggleBarrasSort(column: "nombre" | "estado") {
    const nextDir: "asc" | "desc" = sortBarrasBy === column && sortBarrasDir === "asc" ? "desc" : "asc"
    setSortBarrasBy(column)
    setSortBarrasDir(nextDir)
  }

  function getBarrasSortIcon(column: "nombre" | "estado") {
    if (sortBarrasBy !== column) return <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
    return sortBarrasDir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
  }

  function toggleStockSort(column: "nombre" | "stock_actual" | "stock_inicial" | "precio_base" | "precio_override" | "estado_stock") {
    const nextDir: "asc" | "desc" = sortStockBy === column && sortStockDir === "asc" ? "desc" : "asc"
    setSortStockBy(column)
    setSortStockDir(nextDir)
  }

  function getStockSortIcon(column: "nombre" | "stock_actual" | "stock_inicial" | "precio_base" | "precio_override" | "estado_stock") {
    if (sortStockBy !== column) return <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
    return sortStockDir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
  }

  const barrasFiltradas = useMemo(() => {
    const query = barraBusqueda.trim().toLowerCase()
    const items = barras.filter((barra) => {
      const matchesQuery = !query || barra.nombre.toLowerCase().includes(query)
      const matchesEstado =
        barraEstado === "todos" ||
        (barraEstado === "activas" && Number(barra.activa) === 1) ||
        (barraEstado === "inactivas" && Number(barra.activa) !== 1)

      return matchesQuery && matchesEstado
    })

    items.sort((a, b) => {
      let comparison = 0

      switch (sortBarrasBy) {
        case "estado":
          comparison = Number(b.activa) - Number(a.activa)
          break
        case "nombre":
        default:
          comparison = a.nombre.localeCompare(b.nombre, "es")
          break
      }

      if (comparison === 0) {
        comparison = a.nombre.localeCompare(b.nombre, "es")
      }

      return sortBarrasDir === "asc" ? comparison : comparison * -1
    })

    return items
  }, [barras, barraBusqueda, barraEstado, sortBarrasBy, sortBarrasDir])

  const barrasTotalPages = Math.max(1, Math.ceil(barrasFiltradas.length / barrasPageSize))
  const barrasCurrentPage = Math.min(barrasPage, barrasTotalPages)
  const barrasRangeStart = barrasFiltradas.length === 0 ? 0 : (barrasCurrentPage - 1) * barrasPageSize + 1
  const barrasRangeEnd = Math.min(barrasFiltradas.length, barrasCurrentPage * barrasPageSize)
  const barrasPaginadas = barrasFiltradas.slice((barrasCurrentPage - 1) * barrasPageSize, barrasCurrentPage * barrasPageSize)

  const stockFiltrado = useMemo(() => {
    const query = busquedaStock.trim().toLowerCase()
    const filteredByEstado = stock.filter((item) => {
      if (stockEstadoFiltro === "activos") return Number(item.activo) === 1
      if (stockEstadoFiltro === "inactivos") return Number(item.activo) !== 1
      return true
    })

    const items = query
      ? filteredByEstado.filter((item) => {
          const nombre = item.nombre.toLowerCase()
          const descripcion = item.descripcion?.toLowerCase() ?? ""
          return nombre.includes(query) || descripcion.includes(query)
        })
      : [...filteredByEstado]

    items.sort((a, b) => {
      const sinStockA = Number(a.stock_actual) <= 0
      const sinStockB = Number(b.stock_actual) <= 0
      const lowStockA = !sinStockA && Number(a.stock_inicial) > 0 && Number(a.stock_actual) <= Number(a.stock_inicial) * 0.2
      const lowStockB = !sinStockB && Number(b.stock_inicial) > 0 && Number(b.stock_actual) <= Number(b.stock_inicial) * 0.2

      let comparison = 0
      switch (sortStockBy) {
        case "stock_actual":
          comparison = Number(a.stock_actual) - Number(b.stock_actual)
          break
        case "stock_inicial":
          comparison = Number(a.stock_inicial) - Number(b.stock_inicial)
          break
        case "precio_base":
          comparison = Number(a.precio_base) - Number(b.precio_base)
          break
        case "precio_override":
          comparison = Number(a.precio_override ?? -1) - Number(b.precio_override ?? -1)
          break
        case "estado_stock":
          comparison = Number(sinStockA) - Number(sinStockB)
          if (comparison === 0) comparison = Number(lowStockA) - Number(lowStockB)
          break
        case "nombre":
        default:
          comparison = a.nombre.localeCompare(b.nombre, "es")
          break
      }

      if (comparison === 0) {
        comparison = a.nombre.localeCompare(b.nombre, "es")
      }

      return sortStockDir === "asc" ? comparison : comparison * -1
    })

    return items
  }, [stock, stockEstadoFiltro, busquedaStock, sortStockBy, sortStockDir])

  useEffect(() => {
    setStockPage(1)
  }, [stockEstadoFiltro, busquedaStock, sortStockBy, sortStockDir, stockPageSize, barraSeleccionada?.id])

  const stockTotalPages = Math.max(1, Math.ceil(stockFiltrado.length / stockPageSize))
  const stockCurrentPage = Math.min(stockPage, stockTotalPages)
  const stockRangeStart = stockFiltrado.length === 0 ? 0 : (stockCurrentPage - 1) * stockPageSize + 1
  const stockRangeEnd = Math.min(stockFiltrado.length, stockCurrentPage * stockPageSize)
  const stockPaginado = stockFiltrado.slice((stockCurrentPage - 1) * stockPageSize, stockCurrentPage * stockPageSize)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          {barraSeleccionada ? (
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  updateQuery({ barra: "" })
                }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
              >
                <ArrowLeft className="h-5 w-5" />
              </button>
              <div>
                <h1 className="text-2xl font-bold text-foreground">{barraSeleccionada.nombre}</h1>
                <p className="text-muted-foreground text-sm mt-1">
                  Stock de la barra · {stock.length} producto{stock.length !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
          ) : (
            <div>
              <h1 className="text-2xl font-bold text-foreground">Gestión de barras</h1>
              <p className="text-muted-foreground text-sm mt-1">
                Administrá las barras y su stock por evento
              </p>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          {barraSeleccionada && puede("gestionar_consumibles") && (
            <>
              <Button variant="outline" className="gap-2 h-10" onClick={abrirStockMasivo}>
                <Package className="h-4 w-4" /> Carga masiva
              </Button>
              <Button className="gap-2 h-10" onClick={abrirAgregarStock}>
                <Plus className="h-4 w-4" /> Agregar consumible
              </Button>
            </>
          )}
          <BarrasExportAction eventos={eventos} eventoIdActivo={eventoId} />
        </div>
      </div>

      {/* Vista de stock de barra */}
      {barraSeleccionada ? (
        <>
          {cargandoStock ? (
            <div className="bg-card rounded-2xl border border-border p-8 text-center text-muted-foreground text-sm">
              Cargando stock...
            </div>
          ) : (
            <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
              <div className="border-b border-primary/15 bg-primary/8 px-5 py-4">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  <div className="flex flex-col sm:flex-row gap-3 xl:flex-1">
                    <Select value={stockEstadoFiltro} onValueChange={(value) => setStockEstadoFiltro(value as typeof stockEstadoFiltro)}>
                      <SelectTrigger className="h-10 w-full bg-card sm:w-40">
                        <SelectValue placeholder="Estado" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos">Todos</SelectItem>
                        <SelectItem value="activos">Activos</SelectItem>
                        <SelectItem value="inactivos">Inactivos</SelectItem>
                      </SelectContent>
                    </Select>

                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" className="h-10 gap-2 bg-card">
                          <Columns3 className="h-4 w-4" />
                          <span>Columnas</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="w-52">
                        <DropdownMenuLabel>Columnas visibles</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuCheckboxItem checked={columnasStockVisibles.precioBase} onCheckedChange={(checked) => setColumnasStockVisibles((prev) => ({ ...prev, precioBase: checked === true }))}>Precio base</DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem checked={columnasStockVisibles.precioOverride} onCheckedChange={(checked) => setColumnasStockVisibles((prev) => ({ ...prev, precioOverride: checked === true }))}>Precio override</DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem checked={columnasStockVisibles.stockInicial} onCheckedChange={(checked) => setColumnasStockVisibles((prev) => ({ ...prev, stockInicial: checked === true }))}>Stock inicial</DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem checked={columnasStockVisibles.stockActual} onCheckedChange={(checked) => setColumnasStockVisibles((prev) => ({ ...prev, stockActual: checked === true }))}>Stock actual</DropdownMenuCheckboxItem>
                      </DropdownMenuContent>
                    </DropdownMenu>

                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        className="pl-9 h-10 bg-card border-primary/20"
                        placeholder="Buscar producto por nombre o descripción..."
                        value={busquedaStock}
                        onChange={(e) => setBusquedaStock(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="flex flex-col sm:flex-row gap-3 xl:items-center xl:justify-end">
                    <Select value={String(stockPageSize)} onValueChange={(value) => setStockPageSize(Number(value))}>
                      <SelectTrigger className="h-10 w-24 bg-card">
                        <SelectValue placeholder="25" />
                      </SelectTrigger>
                      <SelectContent>
                        {[10, 25, 50, 100].map((size) => (
                          <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
                      <span>{stockRangeStart}-{stockRangeEnd} de {stockFiltrado.length}</span>
                      <Badge variant="outline" className="rounded-full px-3 py-1">{stockCurrentPage}/{stockTotalPages}</Badge>
                    </div>

                    <div className="flex items-center gap-1">
                      <IconAction label="Primera página" variant="ghost" size="icon-sm" onClick={() => setStockPage(1)} disabled={stockCurrentPage <= 1}>
                        <ChevronsLeft className="h-4 w-4" />
                      </IconAction>
                      <IconAction label="Página anterior" variant="ghost" size="icon-sm" onClick={() => setStockPage((current) => Math.max(1, current - 1))} disabled={stockCurrentPage <= 1}>
                        <ChevronLeft className="h-4 w-4" />
                      </IconAction>
                      <IconAction label="Página siguiente" variant="ghost" size="icon-sm" onClick={() => setStockPage((current) => Math.min(stockTotalPages, current + 1))} disabled={stockCurrentPage >= stockTotalPages}>
                        <ChevronRight className="h-4 w-4" />
                      </IconAction>
                      <IconAction label="Última página" variant="ghost" size="icon-sm" onClick={() => setStockPage(stockTotalPages)} disabled={stockCurrentPage >= stockTotalPages}>
                        <ChevronsRight className="h-4 w-4" />
                      </IconAction>
                    </div>
                  </div>
                </div>
              </div>

              {stock.length === 0 ? (
                <div className="p-8 md:p-16 text-center">
                  <Package className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <h3 className="font-semibold text-foreground mb-1">Sin productos en esta barra</h3>
                  <p className="text-muted-foreground text-sm mb-4">
                    Agregá consumibles del catálogo para gestionar el stock
                  </p>
                  {puede("gestionar_consumibles") && (
                    <Button className="gap-2" onClick={abrirAgregarStock}>
                      <Plus className="h-4 w-4" /> Agregar consumible
                    </Button>
                  )}
                </div>
              ) : stockFiltrado.length === 0 ? (
                <div className="p-8 md:p-16 text-center">
                  <Package className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                  <h3 className="font-semibold text-foreground mb-1">Sin productos para mostrar</h3>
                  <p className="text-muted-foreground text-sm">Probá con otro filtro o término de búsqueda.</p>
                </div>
              ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-sm">
                  <thead>
                    <tr className="border-b border-primary/15 bg-primary/10">
                      <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleStockSort("nombre")}>Consumible {getStockSortIcon("nombre")}</button></th>
                      {columnasStockVisibles.precioBase && <th className="text-right px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleStockSort("precio_base")}>Precio base {getStockSortIcon("precio_base")}</button></th>}
                      {columnasStockVisibles.precioOverride && <th className="text-right px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleStockSort("precio_override")}>Precio override {getStockSortIcon("precio_override")}</button></th>}
                      {columnasStockVisibles.stockInicial && <th className="text-right px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleStockSort("stock_inicial")}>Stock inicial {getStockSortIcon("stock_inicial")}</button></th>}
                      {columnasStockVisibles.stockActual && <th className="text-right px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleStockSort("stock_actual")}>Stock actual {getStockSortIcon("stock_actual")}</button></th>}
                      <th className="text-right px-5 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]"><button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleStockSort("estado_stock")}>Restock {getStockSortIcon("estado_stock")}</button></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {stockPaginado.map((s) => {
                      const ilimitado = s.stock_ilimitado === true
                      const agotado = s.agotado === true
                      const sinStock = !ilimitado && !agotado && Number(s.stock_actual) <= 0
                      const lowStock = !ilimitado && !agotado && !sinStock && Number(s.stock_inicial) > 0 && Number(s.stock_actual) <= Number(s.stock_inicial) * 0.2
                      const restockPendiente = Number(s.restock_pendiente ?? 0) === 1

                      return <tr key={s.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-5 py-4">
                          <p className="font-medium text-foreground">{s.nombre}</p>
                          {s.descripcion && (
                            <p className="text-xs text-muted-foreground">{s.descripcion}</p>
                          )}
                          <div className="flex flex-wrap items-center gap-2 mt-1.5">
                            {agotado && (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 flex items-center gap-1">
                                <Ban className="h-3 w-3" /> Agotado
                              </span>
                            )}
                            {ilimitado && (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary flex items-center gap-1">
                                <InfinityIcon className="h-3 w-3" /> Ilimitado
                              </span>
                            )}
                            {sinStock && (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 flex items-center gap-1">
                                <Ban className="h-3 w-3" /> Sin stock
                              </span>
                            )}
                            {lowStock && (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 flex items-center gap-1">
                                <TrendingDown className="h-3 w-3" /> Bajo stock
                              </span>
                            )}
                            {restockPendiente && (
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                                Pedido pendiente
                              </span>
                            )}
                          </div>
                        </td>
                        {columnasStockVisibles.precioBase && <td className="px-4 py-4 text-right font-mono tabular-nums text-foreground">
                          {formatMoney(s.precio_base)}
                        </td>}
                        {columnasStockVisibles.precioOverride && <td className="px-4 py-4 text-right font-mono tabular-nums text-foreground">
                          {s.precio_override != null
                            ? formatMoney(s.precio_override)
                            : <span className="text-muted-foreground">—</span>}
                        </td>}
                        {columnasStockVisibles.stockInicial && <td className="px-4 py-4 text-right tabular-nums text-foreground">{formatInt(s.stock_inicial)}</td>}
                        {columnasStockVisibles.stockActual && <td className="px-4 py-4 text-right">
                          {agotado ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                              <Ban className="h-3 w-3" /> Agotado
                            </span>
                          ) : ilimitado ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                              <InfinityIcon className="h-3 w-3" /> Ilimitado
                            </span>
                          ) : (
                            <span
                              className={`font-medium tabular-nums ${
                                sinStock
                                  ? "text-destructive"
                                  : lowStock
                                  ? "text-amber-600"
                                  : "text-foreground"
                              }`}
                            >
                              {formatInt(s.stock_actual)}
                            </span>
                          )}
                        </td>}
                        <td className="px-5 py-4">
                          <div className="flex flex-wrap items-center justify-end gap-1.5 sm:flex-nowrap sm:gap-2">
                            {puede("gestionar_consumibles") && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8 gap-1.5"
                                onClick={() => setItemDisponibilidad(s, { stock_ilimitado: !ilimitado })}
                              >
                                <InfinityIcon className="h-3.5 w-3.5" />
                                {ilimitado ? "Quitar ilimitado" : "Ilimitado"}
                              </Button>
                            )}
                            {puede("gestionar_consumibles") && (
                              <Button
                                variant={agotado ? "outline" : "destructive"}
                                size="sm"
                                className="h-8"
                                onClick={() => setItemDisponibilidad(s, { agotado: !agotado })}
                              >
                                {agotado ? "Marcar disponible" : "Marcar como agotado"}
                              </Button>
                            )}
                            {puede("gestionar_consumibles") && !restockPendiente && (sinStock || lowStock) && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8"
                                onClick={async () => {
                                    if (!barraSeleccionada) return
                                    await withLoading(async () => {
                                      try {
                                        await consumiblesApi.requestRestock(barraSeleccionada.id, s.id)
                                        const stockData = await consumiblesApi.getBarraStock(barraSeleccionada.id)
                                        setStock(stockData)
                                        toast.success("Pedido de reposición generado")
                                      } catch (error) {
                                      toast.error(error instanceof Error ? error.message : "No se pudo pedir reposición")
                                    }
                                  })
                                }}
                              >
                                Pedir
                              </Button>
                            )}
                            {puede("gestionar_consumibles") && restockPendiente && s.restock_alerta_id && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-8"
                                onClick={async () => {
                                    if (!barraSeleccionada) return
                                    await withLoading(async () => {
                                      try {
                                        await consumiblesApi.resolveRestock(barraSeleccionada.id, s.id, s.restock_alerta_id!)
                                        const stockData = await consumiblesApi.getBarraStock(barraSeleccionada.id)
                                        setStock(stockData)
                                        toast.success("Pedido de reposición resuelto")
                                      } catch (error) {
                                      toast.error(error instanceof Error ? error.message : "No se pudo resolver el pedido")
                                    }
                                  })
                                }}
                              >
                                Resolver
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    })}
                  </tbody>
                </table>
              </div>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          {/* Selector de evento */}
          <div className="bg-card rounded-2xl border border-border p-5">
            <div className="max-w-xl space-y-1.5">
              <Label htmlFor="evento-select">Evento</Label>
              {eventos.length === 0 ? (
                <p className="text-sm text-muted-foreground leading-relaxed text-pretty">
                  No hay eventos activos. Activá un evento para gestionar sus barras.
                </p>
              ) : (
                 <Select value={eventoId} onValueChange={(value) => updateQuery({ evento: value, barra: "" })}>
                   <SelectTrigger id="evento-select" className="h-10">
                     <SelectValue placeholder="Seleccioná un evento..." />
                   </SelectTrigger>
                  <SelectContent>
                    {eventos.map((ev) => (
                      <SelectItem key={ev.id} value={ev.id}>
                        {ev.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>

          {/* Lista de barras */}
          {eventoId && (
            <>
              <div className="flex items-center justify-between">
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <p>
                    {cargandoBarras
                      ? "Cargando barras..."
                      : `${barrasFiltradas.length} barra${barrasFiltradas.length !== 1 ? "s" : ""}`}
                  </p>
                  {!cargandoBarras && barrasFiltradas.length > 0 && (
                    <>
                      <span>·</span>
                      <span>{barrasFiltradas.reduce((acc, barra) => acc + Number(barra.total_items ?? 0), 0)} productos asignados</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {puede("gestionar_consumibles") && eventoId && (
                    <Button className="gap-2 h-9 px-4" onClick={abrirNuevaBarra}>
                      <Plus className="h-4 w-4" /> Nueva barra
                    </Button>
                  )}
                </div>
              </div>

              {!cargandoBarras ? (
                <div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
                  <div className="border-b border-primary/15 bg-primary/8 px-5 py-4">
                    <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                      <div className="flex flex-col sm:flex-row gap-3 xl:flex-1">
                        <Select value={barraEstado} onValueChange={(value) => updateQuery({ barraEstado: value, barrasPage: 1 })}>
                          <SelectTrigger className="h-10 w-full bg-card sm:w-40">
                            <SelectValue placeholder="Estado" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="todos">Todos</SelectItem>
                            <SelectItem value="activas">Activas</SelectItem>
                            <SelectItem value="inactivas">Inactivas</SelectItem>
                          </SelectContent>
                        </Select>

                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" className="h-10 gap-2 bg-card">
                              <Columns3 className="h-4 w-4" />
                              <span>Columnas</span>
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="start" className="w-48">
                            <DropdownMenuLabel>Columnas visibles</DropdownMenuLabel>
                            <DropdownMenuSeparator />
                            <DropdownMenuCheckboxItem checked={columnasBarrasVisibles.estado} onCheckedChange={(checked) => setColumnasBarrasVisibles((prev) => ({ ...prev, estado: checked === true }))}>
                              Estado
                            </DropdownMenuCheckboxItem>
                          </DropdownMenuContent>
                        </DropdownMenu>

                        <div className="relative flex-1">
                          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                          <Input
                            className="h-10 border-primary/20 bg-card pl-9"
                            placeholder="Buscar barra por nombre..."
                            value={barraBusquedaInput}
                            onChange={(e) => setBarraBusquedaInput(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3 xl:items-center xl:justify-end">
                        <Select value={String(barrasPageSize)} onValueChange={(value) => updateQuery({ barrasPageSize: value, barrasPage: 1 })}>
                          <SelectTrigger className="h-10 w-24 bg-card">
                            <SelectValue placeholder="25" />
                          </SelectTrigger>
                          <SelectContent>
                            {[10, 25, 50, 100].map((size) => (
                              <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
                          <span>{barrasRangeStart}-{barrasRangeEnd} de {barrasFiltradas.length}</span>
                          <Badge variant="outline" className="rounded-full px-3 py-1">{barrasCurrentPage}/{barrasTotalPages}</Badge>
                        </div>

                        <div className="flex items-center gap-1">
                          <IconAction label="Primera página" variant="ghost" size="icon-sm" onClick={() => updateQuery({ barrasPage: 1 })} disabled={barrasCurrentPage <= 1}>
                            <ChevronsLeft className="h-4 w-4" />
                          </IconAction>
                          <IconAction label="Página anterior" variant="ghost" size="icon-sm" onClick={() => updateQuery({ barrasPage: barrasCurrentPage - 1 })} disabled={barrasCurrentPage <= 1}>
                            <ChevronLeft className="h-4 w-4" />
                          </IconAction>
                          <IconAction label="Página siguiente" variant="ghost" size="icon-sm" onClick={() => updateQuery({ barrasPage: barrasCurrentPage + 1 })} disabled={barrasCurrentPage >= barrasTotalPages}>
                            <ChevronRight className="h-4 w-4" />
                          </IconAction>
                          <IconAction label="Última página" variant="ghost" size="icon-sm" onClick={() => updateQuery({ barrasPage: barrasTotalPages })} disabled={barrasCurrentPage >= barrasTotalPages}>
                            <ChevronsRight className="h-4 w-4" />
                          </IconAction>
                        </div>
                      </div>
                    </div>
                  </div>

                  {barrasFiltradas.length === 0 ? (
                    <div className="p-8 text-center md:p-16">
                      <Wine className="mx-auto mb-3 h-10 w-10 text-muted-foreground" />
                      <h3 className="mb-1 font-semibold text-foreground">Sin barras para mostrar</h3>
                      <p className="mb-4 text-sm text-muted-foreground">
                        {barraBusqueda ? "Probá con otro término de búsqueda" : "Creá barras para asignarles consumibles y gestionar el stock"}
                      </p>
                      {puede("gestionar_consumibles") && (
                        <Button className="gap-2" onClick={abrirNuevaBarra}>
                          <Plus className="h-4 w-4" /> Crear barra
                        </Button>
                      )}
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[760px] text-sm">
                        <thead>
                          <tr className="border-b border-primary/15 bg-primary/10">
                            <th className="text-left px-5 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">
                              <button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleBarrasSort("nombre")}>
                                Barra {getBarrasSortIcon("nombre")}
                              </button>
                            </th>
                            {columnasBarrasVisibles.estado && <th className="text-left px-4 py-3.5 text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">
                              <button type="button" className="inline-flex items-center gap-1.5 cursor-pointer" onClick={() => toggleBarrasSort("estado")}>
                                Estado {getBarrasSortIcon("estado")}
                              </button>
                            </th>}
                            <th className="px-5 py-3.5 text-right text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Acción</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {barrasPaginadas.map((barra) => {
                            const inactiva = Number(barra.activa) !== 1
                            return (
                              <tr
                                key={barra.id}
                                className={`transition-colors ${inactiva ? "opacity-60" : "hover:bg-muted/30"}`}
                              >
                              <td className="px-5 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary shrink-0">
                                    <Wine className="h-4 w-4" />
                                  </div>
                                  <div>
                                    <p className="font-medium text-foreground">{barra.nombre}</p>
                                    <div className="flex flex-wrap items-center gap-2 mt-1">
                                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-card border border-border text-muted-foreground">
                                        {Number(barra.total_items ?? 0)} producto{Number(barra.total_items ?? 0) !== 1 ? "s" : ""}
                                      </span>
                                      {Number(barra.low_stock_items ?? 0) > 0 && (
                                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400">
                                          {Number(barra.low_stock_items)} bajo stock
                                        </span>
                                      )}
                                      {Number(barra.sin_stock_items ?? 0) > 0 && (
                                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400">
                                          {Number(barra.sin_stock_items)} sin stock
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>
                                {columnasBarrasVisibles.estado && <td className="px-4 py-4">
                                  <span
                                    className={`text-xs font-medium px-2.5 py-1 rounded-full ${
                                      !inactiva
                                        ? "bg-primary/10 text-primary"
                                        : "bg-muted text-muted-foreground"
                                    }`}
                                  >
                                    {!inactiva ? "Activa" : "Inactiva"}
                                  </span>
                                </td>}
                              <td className="px-5 py-4">
                                <div className="flex items-center gap-1 justify-end">
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8 gap-1.5 px-2 text-xs font-medium text-primary"
                                    onClick={() => verStock(barra)}
                                  >
                                    Ver stock <ChevronRight className="h-3 w-3" />
                                  </Button>
                                  {puede("gestionar_consumibles") && (
                                    <>
                                      <IconAction
                                        label="Editar"
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 w-8 p-0"
                                        onClick={() => abrirEditarBarra(barra)}
                                      >
                                        <Pencil className="h-4 w-4" />
                                      </IconAction>
                                      <IconAction
                                        label={!inactiva ? "Desactivar" : "Activar"}
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 w-8 p-0"
                                        onClick={() => toggleActivaBarra(barra)}
                                      >
                                        <span className={`text-xs font-bold ${!inactiva ? "text-primary" : "text-muted-foreground"}`}>
                                          {!inactiva ? "ON" : "OFF"}
                                        </span>
                                      </IconAction>
                                      <IconAction
                                        label="Eliminar"
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 w-8 p-0 text-destructive hover:text-destructive hover:bg-destructive/10"
                                        onClick={() => setModalEliminarBarra(barra)}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </IconAction>
                                    </>
                                  )}
                                </div>
                              </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : null}

              <div className="bg-card rounded-2xl border border-border p-5 space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-foreground">Cobertura por producto</h2>
                    <p className="text-sm text-muted-foreground mt-1">
                      Mirá en qué barras se vende cada consumible y asignalo de forma masiva.
                    </p>
                  </div>

                  <div className="w-full space-y-1.5 md:ml-auto md:w-72">
                    <Label htmlFor="consumible-cobertura">Consumible</Label>
                    <Select value={consumibleSeleccionadoId} onValueChange={setConsumibleSeleccionadoId}>
                      <SelectTrigger id="consumible-cobertura" className="h-10 w-full">
                        <SelectValue placeholder="Seleccioná un consumible..." />
                      </SelectTrigger>
                      <SelectContent>
                        {consumiblesCatalogo.map((c) => (
                          <SelectItem key={c.id} value={c.id}>
                            {c.nombre} — {formatMoney(c.precio)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                {!consumibleSeleccionadoId ? (
                  <div className="rounded-xl border border-dashed border-border p-6 text-sm text-muted-foreground text-center">
                    Seleccioná un consumible para ver en qué barras está asignado.
                  </div>
                ) : cargandoCobertura ? (
                  <div className="rounded-xl border border-border p-6 text-sm text-muted-foreground text-center">
                    Cargando cobertura del producto...
                  </div>
                ) : coberturaBarras.length === 0 ? (
                  <div className="rounded-xl border border-border p-6 text-sm text-muted-foreground text-center">
                    No hay barras cargadas para este evento.
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4 items-start">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
                        {coberturaBarras.map((barra) => {
                          const asignada = Number(barra.asignado) === 1
                          const seleccionada = barrasSeleccionadas.includes(barra.id)
                          const ilimitado = asignada && barra.stock_ilimitado === true
                          const agotado = asignada && barra.agotado === true
                          const sinStock = asignada && !ilimitado && !agotado && Number(barra.stock_actual) <= 0
                          const lowStock = asignada && !ilimitado && !agotado && !sinStock && Number(barra.stock_inicial) > 0 && Number(barra.stock_actual) <= Number(barra.stock_inicial) * 0.2
                          const checked = asignarATodas || seleccionada

                          return (
                            <label
                              key={barra.id}
                              className={`flex h-full cursor-pointer flex-col gap-3 rounded-2xl border bg-card p-4 transition-colors ${
                                checked
                                  ? "border-primary bg-primary/5"
                                  : "border-border hover:bg-muted/30"
                              } ${asignarATodas ? "cursor-default" : ""}`}
                            >
                              <div className="flex items-start gap-3">
                                <input
                                  type="checkbox"
                                  className="mt-0.5 h-4 w-4 shrink-0"
                                  checked={checked}
                                  disabled={asignarATodas}
                                  onChange={() => toggleBarraAsignada(barra.id)}
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="truncate font-medium text-foreground">{barra.nombre}</p>
                                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                                    <span
                                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                                        Number(barra.activa) === 1
                                          ? "bg-primary/10 text-primary"
                                          : "bg-muted text-muted-foreground"
                                      }`}
                                    >
                                      {Number(barra.activa) === 1 ? "Activa" : "Inactiva"}
                                    </span>
                                    <span
                                      className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                                        asignada
                                          ? "bg-primary/10 text-primary"
                                          : "bg-muted text-muted-foreground"
                                      }`}
                                    >
                                      {asignada ? "Asignado" : "Sin asignar"}
                                    </span>
                                    {agotado && (
                                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 flex items-center gap-1">
                                        <Ban className="h-3 w-3" /> Agotado
                                      </span>
                                    )}
                                    {ilimitado && (
                                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-primary/10 text-primary flex items-center gap-1">
                                        <InfinityIcon className="h-3 w-3" /> Ilimitado
                                      </span>
                                    )}
                                    {sinStock && (
                                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 flex items-center gap-1">
                                        <Ban className="h-3 w-3" /> Sin stock
                                      </span>
                                    )}
                                    {lowStock && (
                                      <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400 flex items-center gap-1">
                                        <TrendingDown className="h-3 w-3" /> Bajo stock
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </div>
                              <div className="mt-auto grid grid-cols-2 gap-2 border-t border-border pt-3 text-xs">
                                <div>
                                  <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Stock inicial</span>
                                  <span className="font-mono tabular-nums text-foreground">{formatInt(barra.stock_inicial)}</span>
                                </div>
                                <div>
                                  <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Stock actual</span>
                                  {ilimitado ? (
                                    <span className="font-medium text-primary">Ilimitado</span>
                                  ) : agotado ? (
                                    <span className="font-medium text-red-700 dark:text-red-400">Agotado</span>
                                  ) : (
                                    <span className="font-mono tabular-nums text-foreground">{formatInt(barra.stock_actual)}</span>
                                  )}
                                </div>
                                <div className="col-span-2">
                                  <span className="block text-[10px] uppercase tracking-wide text-muted-foreground">Precio</span>
                                  <span className="font-mono tabular-nums text-foreground">
                                    {barra.precio_override != null
                                      ? `${formatMoney(barra.precio_override)} (override)`
                                      : "Precio base"}
                                  </span>
                                </div>
                              </div>
                            </label>
                          )
                        })}
                      </div>

                      {puede("gestionar_consumibles") && (
                        <div className="min-w-0 space-y-3 md:w-72">
                          <div className="rounded-xl border border-border p-4 space-y-3">
                            <div className="flex items-center gap-2">
                              <input
                                id="asignar-todas"
                                type="checkbox"
                              checked={asignarATodas}
                              onChange={(e) => setAsignarATodas(e.target.checked)}
                            />
                            <Label htmlFor="asignar-todas" className="text-sm font-medium text-foreground">
                              Asignar a todas las barras
                            </Label>
                          </div>

                            <label htmlFor="ilimitado-asignacion" className="flex items-start gap-2 cursor-pointer">
                              <input
                                id="ilimitado-asignacion"
                                type="checkbox"
                                checked={formAsignacion.stock_ilimitado}
                                onChange={(e) =>
                                  setFormAsignacion((prev) => ({ ...prev, stock_ilimitado: e.target.checked }))
                                }
                                className="mt-0.5 h-4 w-4 shrink-0"
                              />
                              <span className="min-w-0">
                                <span className="block text-sm font-medium text-foreground">Stock ilimitado</span>
                                <span className="block text-xs text-muted-foreground">Se vende sin descontar stock.</span>
                              </span>
                            </label>

                            {!formAsignacion.stock_ilimitado && (
                              <div className="space-y-1.5">
                                <Label htmlFor="stock-asignacion">Stock inicial</Label>
                                <Input
                                  id="stock-asignacion"
                                type="number"
                                min="0"
                                step="1"
                                inputMode="numeric"
                                className="font-mono tabular-nums"
                                value={formAsignacion.stock_inicial}
                                onChange={(e) =>
                                  setFormAsignacion((prev) => ({ ...prev, stock_inicial: e.target.value }))
                                }
                              />
                              </div>
                            )}

                            <div className="space-y-1.5">
                              <Label htmlFor="precio-asignacion">Precio override (opcional)</Label>
                              <Input
                                id="precio-asignacion"
                              type="number"
                              min="0"
                              step="0.01"
                              value={formAsignacion.precio_override}
                              onChange={(e) =>
                                setFormAsignacion((prev) => ({ ...prev, precio_override: e.target.value }))
                              }
                              placeholder="Usar precio base"
                            />
                            </div>

                            <p className="text-xs text-muted-foreground">
                              {asignarATodas
                                ? `Se asignará en ${coberturaBarras.length} barra(s) del evento.`
                                : `Seleccionadas: ${barrasSeleccionadas.length} barra(s).`}
                            </p>

                            <Button className="w-full" onClick={pedirConfirmacionAsignacionMasiva}>
                              Guardar asignación masiva
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Modal Nueva / Editar barra */}
      <Dialog
        open={!!modalBarra}
        onOpenChange={(open) => {
          if (!open) setModalBarra(null)
        }}
      >
        <DialogContent className="bg-card sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {modalBarra === "nueva" ? "Nueva barra" : "Editar barra"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {modalBarra === "nueva" ? "Crear nueva barra" : "Editar nombre de la barra"}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="nombre-barra">Nombre *</Label>
              <Input
                id="nombre-barra"
                value={formBarra}
                onChange={(e) => setFormBarra(e.target.value)}
                placeholder="Ej: Barra principal, Barra VIP..."
              />
            </div>
            <label htmlFor="buyer-refunds-barra" className="flex items-start gap-3 rounded-xl border px-3 py-3 cursor-pointer">
              <input
                id="buyer-refunds-barra"
                type="checkbox"
                checked={formBuyerRefundsEnabled}
                onChange={(event) => setFormBuyerRefundsEnabled(event.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">Permitir solicitudes de reembolso del comprador</span>
                <span className="block text-xs text-muted-foreground">Esto solo afecta los pedidos del comprador. Los reembolsos operativos por escaneo en barra siguen permitidos.</span>
              </span>
            </label>
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1 h-10"
                onClick={() => setModalBarra(null)}
              >
                Cancelar
              </Button>
              <Button className="flex-1 h-10" onClick={guardarBarra}>
                {modalBarra === "nueva" ? "Crear barra" : "Guardar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal eliminar barra */}
      <Dialog
        open={!!modalEliminarBarra}
        onOpenChange={(open) => {
          if (!open) setModalEliminarBarra(null)
        }}
      >
        <DialogContent className="bg-card sm:max-w-sm p-6">
          <DialogHeader>
            <DialogTitle className="text-foreground">¿Eliminar barra?</DialogTitle>
            <DialogDescription className="sr-only">Confirmar eliminación de barra</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-destructive/10 border border-destructive/20 rounded-xl p-4">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">
                  {modalEliminarBarra?.nombre}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Se eliminará la barra y todo su stock. Esta acción no se puede deshacer.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 h-10"
                onClick={() => setModalEliminarBarra(null)}
              >
                Cancelar
              </Button>
              <Button
                variant="destructive"
                className="flex-1 h-10"
                onClick={confirmarEliminarBarra}
              >
                Eliminar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal agregar consumible al stock */}
      <Dialog
        open={modalAgregarStock}
        onOpenChange={(open) => {
          if (!open) setModalAgregarStock(false)
        }}
      >
        <DialogContent className="bg-card max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Agregar consumible</DialogTitle>
            <DialogDescription className="sr-only">
              Agregar un consumible al stock de la barra
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="consumible-select">Consumible *</Label>
              {consumiblesCatalogo.length === 0 ? (
                <p className="text-sm text-muted-foreground">Cargando catálogo...</p>
              ) : (
                <Select
                  value={formStock.consumible_id}
                  onValueChange={(v) =>
                    setFormStock((f) => ({ ...f, consumible_id: v }))
                  }
                >
                  <SelectTrigger id="consumible-select" className="h-10">
                    <SelectValue placeholder="Seleccioná un consumible..." />
                  </SelectTrigger>
                  <SelectContent>
                    {consumiblesCatalogo.map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.nombre} — {formatMoney(c.precio)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            <label htmlFor="stock-ilimitado" className="flex items-start gap-3 rounded-xl border px-3 py-3 cursor-pointer">
              <input
                id="stock-ilimitado"
                type="checkbox"
                checked={formStock.stock_ilimitado}
                onChange={(event) =>
                  setFormStock((f) => ({ ...f, stock_ilimitado: event.target.checked }))
                }
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">Stock ilimitado</span>
                <span className="block text-xs text-muted-foreground">El producto se vende sin descontar stock. No es necesario cargar una cantidad inicial.</span>
              </span>
            </label>

            {!formStock.stock_ilimitado && (
              <div className="space-y-1.5">
                <Label htmlFor="stock-inicial">Stock inicial *</Label>
                <Input
                  id="stock-inicial"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  className="font-mono tabular-nums"
                  value={formStock.stock_inicial}
                  onChange={(e) =>
                    setFormStock((f) => ({ ...f, stock_inicial: e.target.value }))
                  }
                  placeholder="0"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="precio-override">Precio especial (opcional)</Label>
              <Input
                id="precio-override"
                type="number"
                min="0"
                step="0.01"
                value={formStock.precio_override}
                onChange={(e) =>
                  setFormStock((f) => ({ ...f, precio_override: e.target.value }))
                }
                placeholder="Dejar vacío para usar precio base"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1 h-10"
                onClick={() => setModalAgregarStock(false)}
              >
                Cancelar
              </Button>
              <Button className="flex-1 h-10" onClick={guardarStock}>
                Agregar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal stock masivo */}
      <Dialog
        open={modalStockMasivo}
        onOpenChange={(open) => {
          if (!open) setModalStockMasivo(false)
        }}
      >
        <DialogContent className="bg-card w-full max-w-sm sm:max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-foreground">Carga masiva de stock</DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              Editá el stock inicial y precio de todos los productos de la barra
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 mt-2">
            {itemsMasivos.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                No hay productos en esta barra
              </p>
            ) : (
              <>
                <div className="hidden sm:grid sm:grid-cols-[1fr_110px_120px] gap-2 px-1">
                  <span className="text-xs font-semibold text-muted-foreground uppercase">
                    Producto
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground uppercase">
                    Stock inicial
                  </span>
                  <span className="text-xs font-semibold text-muted-foreground uppercase">
                    Precio override
                  </span>
                </div>
                {itemsMasivos.map((item, i) => (
                  <div key={item.consumible_id} className="grid grid-cols-1 sm:grid-cols-[1fr_110px_120px] gap-2 sm:items-center border-b border-border pb-3 sm:border-0 sm:pb-0">
                    <span className="text-sm text-foreground truncate">{item.nombre}</span>
                    <div className="space-y-1">
                      <label htmlFor={`stock-masivo-inicial-${item.consumible_id}`} className="text-xs font-medium text-muted-foreground sm:hidden">
                        Stock inicial
                      </label>
                      <Input
                        id={`stock-masivo-inicial-${item.consumible_id}`}
                        type="number"
                        min="0"
                        step="1"
                        inputMode="numeric"
                        value={item.stock_inicial}
                        onChange={(e) =>
                          setItemsMasivos((prev) =>
                            prev.map((it, idx) =>
                              idx === i ? { ...it, stock_inicial: e.target.value } : it
                            )
                          )
                        }
                        className="h-8 text-sm font-mono tabular-nums"
                      />
                    </div>
                    <div className="space-y-1">
                      <label htmlFor={`stock-masivo-precio-${item.consumible_id}`} className="text-xs font-medium text-muted-foreground sm:hidden">
                        Precio override
                      </label>
                      <Input
                        id={`stock-masivo-precio-${item.consumible_id}`}
                        type="number"
                        min="0"
                        step="0.01"
                        value={item.precio_override}
                        onChange={(e) =>
                          setItemsMasivos((prev) =>
                            prev.map((it, idx) =>
                              idx === i ? { ...it, precio_override: e.target.value } : it
                            )
                          )
                        }
                        placeholder="base"
                        className="h-8 text-sm"
                      />
                    </div>
                  </div>
                ))}
              </>
            )}

            <div className="flex gap-2 pt-4">
              <Button
                variant="outline"
                className="flex-1 h-10"
                onClick={() => setModalStockMasivo(false)}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 h-10"
                onClick={pedirConfirmacionStockMasivo}
                disabled={itemsMasivos.length === 0}
              >
                Guardar cambios
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmación carga masiva de stock */}
      <Dialog
        open={confirmarStockMasivo}
        onOpenChange={(open) => {
          if (!open) setConfirmarStockMasivo(false)
        }}
      >
        <DialogContent className="bg-card sm:max-w-sm p-6">
          <DialogHeader>
            <DialogTitle className="text-foreground">¿Confirmar carga masiva?</DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              Revisá el impacto antes de aplicar los cambios de stock.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-foreground">
              Se actualizará el stock de{" "}
              <span className="font-mono tabular-nums font-semibold">{formatInt(itemsMasivos.length)}</span>{" "}
              producto{itemsMasivos.length !== 1 ? "s" : ""} en la barra{" "}
              <span className="font-semibold">{barraSeleccionada?.nombre}</span>.
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 h-10"
                onClick={() => setConfirmarStockMasivo(false)}
              >
                Cancelar
              </Button>
              <Button className="flex-1 h-10" onClick={guardarStockMasivo}>
                Confirmar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmación asignación masiva de cobertura */}
      <Dialog
        open={confirmarAsignacionMasiva}
        onOpenChange={(open) => {
          if (!open) setConfirmarAsignacionMasiva(false)
        }}
      >
        <DialogContent className="bg-card sm:max-w-sm p-6">
          <DialogHeader>
            <DialogTitle className="text-foreground">¿Confirmar asignación masiva?</DialogTitle>
            <DialogDescription className="text-muted-foreground text-sm">
              Revisá el impacto antes de asignar el producto.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/30 p-4 text-sm text-foreground space-y-2">
              <p>
                Se asignará el producto en{" "}
                <span className="font-mono tabular-nums font-semibold">
                  {formatInt(asignarATodas ? coberturaBarras.length : barrasSeleccionadas.length)}
                </span>{" "}
                barra{(asignarATodas ? coberturaBarras.length : barrasSeleccionadas.length) !== 1 ? "s" : ""}
                {asignarATodas ? " (todas las del evento)" : ""}.
              </p>
              <p className="text-muted-foreground text-xs">
                {formAsignacion.stock_ilimitado
                  ? "Stock ilimitado"
                  : <>Stock inicial: <span className="font-mono tabular-nums">{formatInt(formAsignacion.stock_inicial)}</span></>}
                {" · "}
                {formAsignacion.precio_override
                  ? `Precio override: ${formatMoney(formAsignacion.precio_override)}`
                  : "Usa precio base"}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 h-10"
                onClick={() => setConfirmarAsignacionMasiva(false)}
              >
                Cancelar
              </Button>
              <Button className="flex-1 h-10" onClick={asignarConsumibleMasivo}>
                Confirmar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
