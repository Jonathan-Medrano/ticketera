"use client"

import { useState, useEffect, useRef, useCallback } from "react"
import { useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { IconAction } from "@/components/ui/icon-action"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { formatDateTime, formatMoney, formatTime } from "@/lib/format"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  CheckCircle2,
  Clock,
  XCircle,
  AlertTriangle,
  Camera,
  Keyboard,
  PanelRightClose,
  PanelRightOpen,
  Trash2,
  ArrowLeft,
  ChevronDown,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  Wifi,
  WifiOff,
  CloudDownload,
  RefreshCw,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { logClientError } from "@/lib/safe-client-log"
import { consumiblesApi, type BarraDto } from "@/lib/api"
import EscanearStatsCard from "@/components/dashboard/escanear-stats-card"
import {
  buildConsumiblesResolutionPayload,
  buildInitialConsumibleResolutionDrafts,
  isConsumibleResolutionComplete,
  updateConsumibleUnitStatus,
  type ConsumibleResolutionDraft,
} from "./consumibles-canjear-helpers"

type EventoScanner = { id: string; nombre: string }
type Paso = "seleccion" | "camara" | "manual"
type Modo = "entradas" | "consumibles"
type PreviewConsumible = {
  ok: true
  venta_id: string
  barra_id: string
  barra_nombre: string
  evento_nombre: string
  total: number
  clave_corta: string
  items: Array<{ venta_item_id: string; nombre: string; cantidad: number; precio_unitario: number; subtotal: number }>
}

const RESULTADO_VISIBLE_MS = 3000
const SCAN_COOLDOWN_MS = 2500

function resolveErrorType(motivo?: string): Resultado['error_type'] {
  if (!motivo) return 'other'
  const m = motivo.toLowerCase()
  if (m.includes('no encontrada') || m.includes('no encontrado')) return 'not_found'
  if (m.includes('ya utilizada') || m.includes('ya canjeado') || m.includes('ya resuelto')) return 'already_used'
  if (m.includes('cancelada') || m.includes('cancelado')) return 'cancelled'
  return 'other'
}

function getResultadoBgFull(resultado: Resultado): string {
  if (resultado.ok) return "bg-green-600"
  switch (resultado.error_type) {
    case 'not_found': return "bg-slate-700"
    case 'already_used': return "bg-amber-500"
    case 'cancelled': return "bg-red-600"
    default: return "bg-red-600"
  }
}

function getResultadoBgManual(resultado: Resultado): string {
  if (resultado.ok) return "bg-green-500"
  switch (resultado.error_type) {
    case 'not_found': return "bg-slate-500"
    case 'already_used': return "bg-amber-500"
    case 'cancelled': return "bg-red-600"
    default: return "bg-red-500"
  }
}

function formatUsadaAt(usada_at: string | null | undefined): string | null {
  if (!usada_at) return null
  const formatted = formatDateTime(usada_at)
  return formatted === "—" ? null : formatted
}

function getResponsiveQrBox() {
  if (typeof window === "undefined") return { width: 260, height: 260 }
  const viewportWidth = window.innerWidth
  const isMobile = viewportWidth < 768
  const size = isMobile ? Math.max(260, Math.min(Math.floor(viewportWidth * 0.78), 340)) : 280
  return { width: size, height: size }
}

interface Resultado {
  ok: boolean
  motivo?: string
  error_type?: 'not_found' | 'already_used' | 'cancelled' | 'other'
  comprador?: string
  dni?: string
  categoria?: string
  evento?: string
  usada_at?: string | null
  used_by_user_name?: string | null
  hora: string
  detalle?: string
  // Seated event fields
  asiento_id?: string | null
  asiento_fila?: string | null
  asiento_numero?: number | null
}

type CacheEntry = {
  qr_code: string
  clave_corta: string
  comprador: string | null
  dni: string | null
  categoria: string | null
  estado: string
}

const CACHE_STORAGE_PREFIX = 'ticketera_scan_cache_'

function ConnectivityBadge({ isOnline }: { isOnline: boolean }) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
      isOnline ? "bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400" : "bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400"
    )}>
      {isOnline ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
      {isOnline ? "Online" : "Sin conexión"}
    </span>
  )
}

export default function EscanearContent({
  eventos,
  canScanEntries,
  canRedeemConsumibles,
}: {
  eventos: EventoScanner[]
  canScanEntries: boolean
  canRedeemConsumibles: boolean
}) {
  const searchParams = useSearchParams()
  const [paso, setPaso] = useState<Paso>("seleccion")
  // ?modo=consumibles permite linkear directo al modo consumibles (ej. desde el
  // redirect de la vieja página dedicada /dashboard/consumibles/canjear).
  const [modo, setModo] = useState<Modo>(() =>
    searchParams.get("modo") === "consumibles" && canRedeemConsumibles
      ? "consumibles"
      : canScanEntries ? "entradas" : "consumibles"
  )
  const [eventoId, setEventoId] = useState("")
  const [barras, setBarras] = useState<Array<Pick<BarraDto, "id" | "nombre">>>([])
  const [barraId, setBarraId] = useState("")
  const [resultado, setResultado] = useState<Resultado | null>(null)
  const [historial, setHistorial] = useState<Resultado[]>([])
  const [panelVisible, setPanelVisible] = useState(false)
  const [codigoManual, setCodigoManual] = useState("")
  const [loading, setLoading] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [cameraError, setCameraError] = useState("")
  const [previewConsumible, setPreviewConsumible] = useState<PreviewConsumible | null>(null)
  const [confirmingConsumible, setConfirmingConsumible] = useState(false)
  const [resolutionDrafts, setResolutionDrafts] = useState<ConsumibleResolutionDraft[]>([])
  const [expandedItems, setExpandedItems] = useState<string[]>([])
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx">("xlsx")
  const [exportFilters, setExportFilters] = useState({ escaneador: "", desde: "", hasta: "" })
  const [isExporting, setIsExporting] = useState(false)
  const [cacheMap, setCacheMap] = useState<Map<string, CacheEntry> | null>(null)
  const [cacheStatus, setCacheStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [cacheCount, setCacheCount] = useState(0)
  const [isOnline, setIsOnline] = useState(true)
  const scannerRef = useRef<{ stop: () => Promise<void> } | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cooldownRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastScannedCodeRef = useRef<string | null>(null)
  const scanLockedRef = useRef(false)
  const escanearRef = useRef<((codigo: string) => Promise<void>) | null>(null)
  const cameraStartIdRef = useRef(0)
  const cameraStartingRef = useRef(false)
  const qrBoxSizeRef = useRef(getResponsiveQrBox())

  const eventoNombre = eventos.find((e) => e.id === eventoId)?.nombre ?? ""
  const noHayEventos = eventos.length === 0

  useEffect(() => {
    if (modo !== "consumibles" || !eventoId) {
      setBarras([])
      setBarraId("")
      return
    }

    consumiblesApi
      .getBarras(eventoId, { soloActivas: true })
      .then((data) => setBarras(data.map((barra) => ({ id: barra.id, nombre: barra.nombre }))))
      .catch(() => {
        setBarras([])
        setBarraId("")
      })
  }, [eventoId, modo])

  useEffect(() => {
    setIsOnline(navigator.onLine)
    const onOnline = () => setIsOnline(true)
    const onOffline = () => setIsOnline(false)
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  useEffect(() => {
    if (!eventoId || modo !== 'entradas') {
      setCacheMap(null)
      setCacheStatus('idle')
      setCacheCount(0)
      return
    }
    try {
      const stored = sessionStorage.getItem(CACHE_STORAGE_PREFIX + eventoId)
      if (stored) {
        const entries: CacheEntry[] = JSON.parse(stored)
        const map = new Map<string, CacheEntry>()
        for (const e of entries) {
          map.set(e.qr_code.toUpperCase(), e)
          map.set(e.clave_corta.toUpperCase(), e)
        }
        setCacheMap(map)
        setCacheStatus('ready')
        setCacheCount(entries.length)
      }
    } catch {
      // ignore corrupt cache
    }
  }, [eventoId, modo])

  function pushResultado(next: Resultado) {
    setResultado(next)
    setHistorial((prev) => [next, ...prev].slice(0, 50))
  }

  const escanear = useCallback(async (codigo: string) => {
    const codigoNormalizado = codigo.trim().toUpperCase()
    if (!eventoId || loading || !codigoNormalizado || previewConsumible || confirmingConsumible) return
    if (modo === "consumibles" && !barraId) return
    if (scanLockedRef.current && lastScannedCodeRef.current === codigoNormalizado) return
    if (scanLockedRef.current) return

    scanLockedRef.current = true
    lastScannedCodeRef.current = codigoNormalizado

    if (!navigator.onLine) {
      const cached = cacheMap?.get(codigoNormalizado)
      pushResultado({
        ok: false,
        motivo: 'Sin conexión — el marcado requiere internet',
        error_type: 'other',
        comprador: cached?.comprador ?? undefined,
        categoria: cached?.categoria ?? undefined,
        hora: formatTime(new Date()),
      })
      scanLockedRef.current = false
      return
    }

    setLoading(true)

    try {
      const endpoint = modo === "entradas" ? "/api/escanear" : "/api/consumibles/canjear"
      const body = modo === "entradas"
        ? { codigo: codigoNormalizado, evento_id: eventoId }
        : { codigo: codigoNormalizado, barra_id: barraId }

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({ ok: false, motivo: "No se pudo validar el código" }))

      if (modo === "consumibles" && res.ok && data.ok) {
        setPreviewConsumible(data)
        setResolutionDrafts(buildInitialConsumibleResolutionDrafts(data.items ?? []))
        setExpandedItems((data.items ?? []).map((item: { venta_item_id: string }) => item.venta_item_id))
        return
      }

      const r: Resultado = {
        ok: Boolean(data.ok),
        motivo: data.motivo,
        error_type: !data.ok ? resolveErrorType(data.motivo) : undefined,
        comprador: data.comprador,
        dni: data.dni,
        categoria: data.categoria,
        evento: data.evento,
        usada_at: data.usada_at,
        used_by_user_name: data.used_by_user_name,
        detalle: modo === "consumibles" && data.ok ? "Listo para entregar" : undefined,
        hora: formatTime(new Date()),
        asiento_id: data.asiento_id ?? null,
        asiento_fila: data.asiento_fila ?? null,
        asiento_numero: data.asiento_numero ?? null,
      }
      pushResultado(r)
    } catch {
      pushResultado({
        ok: false,
        motivo: !navigator.onLine ? 'Sin conexión — el marcado requiere internet' : (modo === 'entradas' ? 'Error de conexión al validar la entrada' : 'Error de conexión al validar el consumo'),
        hora: formatTime(new Date())
      })
    } finally {
      setLoading(false)
      if (timeoutRef.current) clearTimeout(timeoutRef.current)
      if (cooldownRef.current) clearTimeout(cooldownRef.current)

      if (modo === "entradas") {
        return
      }

      if (!previewConsumible) timeoutRef.current = setTimeout(() => setResultado(null), RESULTADO_VISIBLE_MS)
      cooldownRef.current = setTimeout(() => {
        scanLockedRef.current = false
        lastScannedCodeRef.current = null
      }, SCAN_COOLDOWN_MS)
    }
  }, [barraId, cacheMap, confirmingConsumible, eventoId, loading, modo, previewConsumible])

  useEffect(() => {
    escanearRef.current = escanear
  }, [escanear])

  const iniciarCamara = useCallback(async () => {
    if (scannerRef.current || cameraStartingRef.current) return
    const startId = ++cameraStartIdRef.current
    cameraStartingRef.current = true
    setCameraError("")
    try {
      const { Html5Qrcode } = await import("html5-qrcode")
      const scanner = new Html5Qrcode("qr-reader")
      scannerRef.current = scanner
      qrBoxSizeRef.current = getResponsiveQrBox()
      await scanner.start(
        { facingMode: "environment" },
        { fps: 10, qrbox: qrBoxSizeRef.current },
        (decoded: string) => { void escanearRef.current?.(decoded) },
        () => {}
      )

      if (cameraStartIdRef.current !== startId) {
        try { await scanner.stop() } catch {}
        if (scannerRef.current === scanner) scannerRef.current = null
        return
      }

      setScanning(true)
    } catch (error) {
      if (cameraStartIdRef.current !== startId) return
      logClientError("escanear camera start")
      setScanning(false)
      const message = error instanceof Error ? error.message : ""
      if (!message.includes("play() request was interrupted")) {
        setCameraError("No se pudo acceder a la cámara. Revisá permisos o usá el modo manual.")
      }
    } finally {
      if (cameraStartIdRef.current === startId) cameraStartingRef.current = false
    }
  }, [])

  const detenerCamara = useCallback(async () => {
    cameraStartIdRef.current += 1
    cameraStartingRef.current = false
    const scanner = scannerRef.current
    scannerRef.current = null
    if (scanner) {
      try { await scanner.stop() } catch {}
    }
    setScanning(false)
  }, [])

  useEffect(() => {
    if (paso === "camara") void iniciarCamara()
    else void detenerCamara()
    return () => { void detenerCamara() }
  }, [detenerCamara, iniciarCamara, paso])

  // html5-qrcode calcula la zona de detección (qrbox) una única vez al iniciar
  // el stream — no la recalcula sola. Si el operador rota el celular con la
  // cámara activa, el marco visual (CSS, fluido) se desincroniza de la zona
  // real de detección. Reiniciamos el scanner para recalcularla.
  useEffect(() => {
    if (paso !== "camara") return

    let debounceId: ReturnType<typeof setTimeout> | null = null

    const handleViewportChange = () => {
      if (debounceId) clearTimeout(debounceId)
      debounceId = setTimeout(() => {
        const next = getResponsiveQrBox()
        const prev = qrBoxSizeRef.current
        if (next.width === prev.width && next.height === prev.height) return
        void detenerCamara().then(() => { void iniciarCamara() })
      }, 350)
    }

    window.addEventListener("resize", handleViewportChange)
    window.addEventListener("orientationchange", handleViewportChange)
    return () => {
      if (debounceId) clearTimeout(debounceId)
      window.removeEventListener("resize", handleViewportChange)
      window.removeEventListener("orientationchange", handleViewportChange)
    }
  }, [paso, detenerCamara, iniciarCamara])

  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    if (cooldownRef.current) clearTimeout(cooldownRef.current)
  }, [])

  // Request compartido por los dos caminos de confirmación (todo-entregado de un tap,
  // y resolución por unidad para reembolso parcial) — mismo manejo de éxito/error,
  // solo cambia el body y el copy del resultado.
  async function ejecutarCanjeConsumible(body: Record<string, unknown>, allEntregado: boolean) {
    if (!previewConsumible) return
    setConfirmingConsumible(true)
    try {
      const res = await fetch("/api/consumibles/canjear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({ ok: false, motivo: "No se pudo completar el canje" }))
      pushResultado({
        ok: Boolean(data.ok),
        motivo: data.motivo,
        error_type: !data.ok ? resolveErrorType(data.motivo) : undefined,
        detalle: data.ok
          ? (() => {
              const total = previewConsumible.items.reduce((acc, item) => acc + item.cantidad, 0)
              if (data.delivered_amount != null && data.refunded_amount != null && data.refunded_amount > 0) {
                return `${previewConsumible.barra_nombre} · ${total} item(s) · ${formatMoney(data.delivered_amount)} entregado · ${formatMoney(data.refunded_amount)} reembolsado`
              }
              return `${previewConsumible.barra_nombre} · ${total} item(s) · ${allEntregado ? "todo entregado" : "resolución registrada"}`
            })()
          : undefined,
        hora: formatTime(new Date()),
      })
      setPreviewConsumible(null)
      setResolutionDrafts([])
      setExpandedItems([])
    } catch {
      pushResultado({ ok: false, motivo: "Error de conexión al completar el canje", hora: formatTime(new Date()) })
      setPreviewConsumible(null)
      setResolutionDrafts([])
      setExpandedItems([])
    } finally {
      setConfirmingConsumible(false)
    }
  }

  // Camino feliz: un solo tap, sin exigir marcar cada unidad individual primero
  // (el backend ya soporta este atajo vía accion:"confirmar" — antes la UI
  // obligaba a tocar cada unidad igual, incluso cuando se iba a entregar todo).
  function confirmarTodoEntregado() {
    if (!previewConsumible) return
    void ejecutarCanjeConsumible(
      { accion: "confirmar", venta_id: previewConsumible.venta_id, barra_id: previewConsumible.barra_id },
      true
    )
  }

  function confirmarConsumible() {
    if (!previewConsumible) return
    if (!isConsumibleResolutionComplete(resolutionDrafts)) return
    const hasRefundedItems = resolutionDrafts.some((draft) => draft.cantidad_reembolsada > 0)
    void ejecutarCanjeConsumible(
      hasRefundedItems
        ? {
            accion: "resolver",
            venta_id: previewConsumible.venta_id,
            barra_id: previewConsumible.barra_id,
            items: buildConsumiblesResolutionPayload(resolutionDrafts),
          }
        : { accion: "confirmar", venta_id: previewConsumible.venta_id, barra_id: previewConsumible.barra_id },
      !hasRefundedItems
    )
  }

  function notifyNoEvents() { toast.error("No hay eventos disponibles para escanear") }

  function continuarEscaneoEntradas() {
    setResultado(null)
    scanLockedRef.current = false
    lastScannedCodeRef.current = null
  }

  function closePreviewConsumible() {
    setPreviewConsumible(null)
    setResolutionDrafts([])
    setExpandedItems([])
  }

  async function handleExport() {
    if (!eventoId) { toast.error("Elegí un evento para exportar"); return }
    setIsExporting(true)
    try {
      const params = new URLSearchParams({ evento_id: eventoId, format: exportFormat })
      if (exportFilters.escaneador) params.set("escaneador", exportFilters.escaneador)
      if (exportFilters.desde) params.set("desde", exportFilters.desde)
      if (exportFilters.hasta) params.set("hasta", exportFilters.hasta)
      const res = await fetch(`/api/escanear/export?${params.toString()}`)
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error((data as { error?: string }).error ?? "Error al exportar")
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = exportFormat === "xlsx" ? `Escaneos_${eventoNombre.replace(/\s+/g, "_")}.xlsx` : `Escaneos_${eventoNombre.replace(/\s+/g, "_")}.csv`
      a.click()
      URL.revokeObjectURL(url)
      setExportDialogOpen(false)
      toast.success("Exportación lista")
    } catch {
      toast.error("Error al exportar")
    } finally {
      setIsExporting(false)
    }
  }

  async function downloadCache() {
    if (!eventoId) return
    setCacheStatus('loading')
    try {
      const res = await fetch(`/api/escanear/cache?evento_id=${eventoId}`)
      if (!res.ok) throw new Error(`${res.status}`)
      const body = await res.json()
      const entries: CacheEntry[] = body.data ?? []
      sessionStorage.setItem(CACHE_STORAGE_PREFIX + eventoId, JSON.stringify(entries))
      const map = new Map<string, CacheEntry>()
      for (const e of entries) {
        map.set(e.qr_code.toUpperCase(), e)
        map.set(e.clave_corta.toUpperCase(), e)
      }
      setCacheMap(map)
      setCacheStatus('ready')
      setCacheCount(entries.length)
      toast.success(`Cache descargada: ${entries.length} entradas`)
    } catch {
      setCacheStatus('error')
      toast.error('No se pudo descargar la cache')
    }
  }

  function toggleExpandedItem(ventaItemId: string) {
    setExpandedItems((current) => current.includes(ventaItemId)
      ? current.filter((id) => id !== ventaItemId)
      : [...current, ventaItemId])
  }

  function renderConsumibleDialogBody() {
    if (!previewConsumible) return null

    const totalEntregado = previewConsumible.items.reduce((acc, item) => {
      const draft = resolutionDrafts.find((current) => current.venta_item_id === item.venta_item_id)
      return acc + ((draft?.cantidad_entregada ?? 0) * Number(item.precio_unitario))
    }, 0)

    return (
      <div className="space-y-4">
        <div className="rounded-2xl border p-4 bg-muted/30">
          <p className="font-semibold">{previewConsumible.barra_nombre}</p>
          <p className="text-xs text-muted-foreground">{previewConsumible.evento_nombre}</p>
          <p className="text-xs font-mono mt-2 text-muted-foreground">{previewConsumible.clave_corta}</p>
        </div>
        <div className="space-y-2">
          {previewConsumible.items.map((item, index) => {
            const draft = resolutionDrafts.find((current) => current.venta_item_id === item.venta_item_id)
            const isExpanded = expandedItems.includes(item.venta_item_id)
            return (
              <div key={`${previewConsumible.venta_id}-${index}`} className="rounded-2xl border p-3 space-y-3">
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-3 text-left"
                  onClick={() => toggleExpandedItem(item.venta_item_id)}
                >
                  <div>
                    <span className="font-medium text-sm">{item.cantidad}x {item.nombre}</span>
                    <div className="mt-1 flex items-center gap-2 text-xs">
                      <span className={cn("inline-flex items-center gap-1", draft?.status === "delivered" ? "text-green-600" : draft?.status === "refunded" ? "text-red-600" : "text-amber-600")}>
                        {draft?.status === "refunded" ? <XCircle className="h-3.5 w-3.5" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                        {draft?.status === "delivered" ? "Todo entregado" : draft?.status === "refunded" ? "Todo reembolsado" : "Entrega parcial"}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-sm">{formatMoney(item.subtotal)}</span>
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", isExpanded ? "rotate-180" : "rotate-0")} />
                  </div>
                </button>

                {isExpanded ? (
                  <div className="space-y-2">
                    <label className="text-xs text-muted-foreground">Resolución por unidad</label>
                    <div className="flex flex-wrap gap-2">
                      {draft?.units.map((unit, unitIndex) => (
                        <div key={unit.id} className="flex items-center gap-2 rounded-xl border px-2.5 py-2">
                          <span className="text-xs font-medium text-muted-foreground shrink-0">#{unitIndex + 1}</span>
                          <Button
                            type="button"
                            variant={unit.status === "delivered" ? "default" : "outline"}
                            size="sm"
                            className="h-11 gap-1.5 px-3"
                            disabled={confirmingConsumible}
                            aria-label={`Unidad ${unitIndex + 1}: marcar como entregada`}
                            onClick={() => setResolutionDrafts((current) => updateConsumibleUnitStatus(current, item.venta_item_id, unit.id, "delivered"))}
                          >
                            <CheckCircle2 className="h-4 w-4" />
                            <span>Entregado</span>
                          </Button>
                          <Button
                            type="button"
                            variant={unit.status === "refunded" ? "destructive" : "outline"}
                            size="sm"
                            className="h-11 gap-1.5 px-3"
                            disabled={confirmingConsumible}
                            aria-label={`Unidad ${unitIndex + 1}: marcar como reembolsada`}
                            onClick={() => setResolutionDrafts((current) => updateConsumibleUnitStatus(current, item.venta_item_id, unit.id, "refunded"))}
                          >
                            <XCircle className="h-4 w-4" />
                            <span>Reembolsado</span>
                          </Button>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground">
                      <p>Entregados: <span className="font-semibold text-foreground">{draft?.cantidad_entregada ?? 0}</span></p>
                      <p>Reembolsados: <span className="font-semibold text-foreground">{draft?.cantidad_reembolsada ?? 0}</span></p>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
        <div className="border-t pt-3 flex items-center justify-between font-semibold"><span>Total</span><span className="font-mono tabular-nums">{formatMoney(totalEntregado)}</span></div>
        <div className="space-y-2">
          <Button className="h-12 w-full gap-2" onClick={confirmarTodoEntregado} disabled={confirmingConsumible}>
            <CheckCircle2 className="h-4 w-4" />
            {confirmingConsumible ? "Registrando..." : "Marcar todo como entregado"}
          </Button>
          <div className="grid grid-cols-2 gap-3">
            <Button variant="outline" className="h-11" onClick={closePreviewConsumible} disabled={confirmingConsumible}>Cancelar</Button>
            <Button
              variant="outline"
              className="h-11"
              onClick={confirmarConsumible}
              disabled={confirmingConsumible || !isConsumibleResolutionComplete(resolutionDrafts)}
            >
              {confirmingConsumible ? "Registrando..." : "Confirmar resolución parcial"}
            </Button>
          </div>
        </div>
      </div>
    )
  }

  function handleManual(e: React.FormEvent) {
    e.preventDefault()
    if (!codigoManual.trim()) return
    void escanear(codigoManual.trim())
    setCodigoManual("")
  }

  const readyForScan = eventoId && (modo === "entradas" || barraId)

  function renderPasoContent() {
    if (paso === "seleccion") {
      return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="bg-card rounded-2xl border border-border p-8 w-full max-w-sm space-y-6">
          <div className="text-center">
            <div className="h-14 w-14 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4"><Camera className="h-7 w-7 text-primary" /></div>
            <h2 className="text-xl font-bold text-foreground">Escáner operativo</h2>
            <p className="text-muted-foreground text-sm mt-1">Elegí evento, modo y empezá a validar.</p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant={modo === "entradas" ? "default" : "outline"} className="h-11" disabled={!canScanEntries} onClick={() => setModo("entradas")}>Entradas</Button>
            <Button type="button" variant={modo === "consumibles" ? "default" : "outline"} className="h-11" disabled={!canRedeemConsumibles} onClick={() => setModo("consumibles")}>Consumibles</Button>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">Evento</label>
            {noHayEventos ? (
              <button type="button" onClick={notifyNoEvents} className="flex h-11 w-full items-center justify-between rounded-md border border-input bg-muted/40 px-3 text-sm text-muted-foreground"><span>No hay eventos disponibles</span></button>
            ) : (
              <Select value={eventoId} onValueChange={(value) => { setEventoId(value); setBarraId("") }}>
                <SelectTrigger className="h-11! w-full"><SelectValue placeholder="Seleccionar evento..." /></SelectTrigger>
                <SelectContent>{eventos.map((ev) => <SelectItem className="py-2.5 px-2.5" key={ev.id} value={ev.id}>{ev.nombre}</SelectItem>)}</SelectContent>
              </Select>
            )}
          </div>

          {/* Stats en vivo — solo cuando se eligió evento + modo entradas */}
          {modo === "entradas" && eventoId ? (
            <EscanearStatsCard eventoId={eventoId} />
          ) : null}

          {modo === "entradas" && eventoId ? (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2">
              <div className="flex items-center gap-2 min-w-0">
                <ConnectivityBadge isOnline={isOnline} />
                {cacheStatus === 'ready' ? (
                  <span className="text-xs text-muted-foreground truncate">{cacheCount} entradas en cache</span>
                ) : cacheStatus === 'error' ? (
                  <span className="text-xs text-red-500 truncate">Error al descargar</span>
                ) : null}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-10 gap-1.5 shrink-0"
                disabled={cacheStatus === 'loading'}
                onClick={() => void downloadCache()}
              >
                {cacheStatus === 'loading' ? (
                  <><RefreshCw className="h-3.5 w-3.5 animate-spin" />Descargando...</>
                ) : cacheStatus === 'ready' ? (
                  <><RefreshCw className="h-3.5 w-3.5" />Actualizar</>
                ) : (
                  <><CloudDownload className="h-3.5 w-3.5" />Descargar cache</>
                )}
              </Button>
            </div>
          ) : null}

          {modo === "consumibles" ? (
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Barra</label>
              <Select value={barraId || "_none"} onValueChange={(value) => setBarraId(value === "_none" ? "" : value)} disabled={!eventoId || barras.length === 0}>
                <SelectTrigger className="h-11! w-full"><SelectValue placeholder={eventoId ? "Seleccionar barra..." : "Elegí un evento primero"} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="_none">Seleccionar barra...</SelectItem>
                  {barras.map((barra) => <SelectItem key={barra.id} value={barra.id}>{barra.nombre}</SelectItem>)}
                </SelectContent>
              </Select>
              {eventoId && barras.length === 0 && (
                <p className="text-xs text-muted-foreground">No hay barras activas para este evento</p>
              )}
            </div>
          ) : null}

          <div className="space-y-2">
            <Button className="w-full h-12 gap-2 text-base" disabled={!readyForScan && !noHayEventos} onClick={() => noHayEventos ? notifyNoEvents() : setPaso("camara")}><Camera className="h-5 w-5" /> Usar cámara</Button>
            <Button variant="outline" className="w-full h-12 gap-2 text-base" disabled={!readyForScan && !noHayEventos} onClick={() => noHayEventos ? notifyNoEvents() : setPaso("manual")}><Keyboard className="h-5 w-5" /> Escribir código</Button>
            {eventoId ? (
              <Button
                type="button"
                variant="default"
                className="w-full gap-2"
                onClick={() => setExportDialogOpen(true)}
              >
                <Download className="h-4 w-4" />
                Exportar historial
              </Button>
            ) : null}
          </div>
        </div>
      </div>
      )
    }

    if (paso === "manual") {
      return (
      <div className="min-h-[80vh] flex items-center justify-center">
        <div className="bg-card rounded-2xl border border-border p-8 w-full max-w-sm space-y-6">
          <div className="flex items-center gap-3">
            <IconAction label="Volver a selección" variant="ghost" size="sm" className="h-10 w-10 p-0" onClick={() => setPaso("seleccion")}><ArrowLeft className="h-4 w-4" /></IconAction>
            <div>
              <h2 className="text-lg font-bold text-foreground">Escribir código</h2>
              <p className="text-xs text-muted-foreground">{eventoNombre}{modo === "consumibles" && barraId ? ` · ${barras.find((item) => item.id === barraId)?.nombre ?? ""}` : ""}</p>
            </div>
          </div>

          {resultado ? (
            <div className={cn("rounded-2xl p-4 transition-all space-y-3", getResultadoBgManual(resultado))}>
              <div className="flex items-start gap-3">
                <div className="shrink-0 mt-0.5">
                  {resultado.ok
                    ? <CheckCircle2 className="h-8 w-8 text-white" />
                    : resultado.error_type === 'already_used'
                      ? <Clock className="h-8 w-8 text-white" />
                      : resultado.error_type === 'not_found'
                        ? <XCircle className="h-8 w-8 text-white" />
                        : <AlertTriangle className="h-8 w-8 text-white" />
                  }
                </div>
                <div className="min-w-0 flex-1">
                  <p className="font-bold text-white text-lg leading-tight">
                    {resultado.ok ? "✓ VÁLIDA" : resultado.error_type === 'already_used' ? "⚠ YA USADA" : resultado.error_type === 'not_found' ? "✗ NO ENCONTRADA" : resultado.error_type === 'cancelled' ? "✗ CANCELADA" : "✗ INVÁLIDA"}
                  </p>
                  {resultado.ok ? (
                    <div className="mt-1 space-y-0.5">
                      {(resultado.comprador || resultado.detalle) ? <p className="text-white font-medium text-sm">{resultado.detalle ?? resultado.comprador}</p> : null}
                      {resultado.categoria ? <p className="text-white/80 text-xs">{resultado.categoria}</p> : null}
                      {resultado.evento ? <p className="text-white/70 text-xs">{resultado.evento}</p> : null}
                      {resultado.dni ? <p className="text-white/70 text-xs font-mono">DNI {resultado.dni}</p> : null}
                      {resultado.asiento_fila && resultado.asiento_numero != null ? (
                        <p className="text-white/90 text-xs font-mono font-semibold">
                          Asiento — Fila {resultado.asiento_fila} · N° {resultado.asiento_numero}
                        </p>
                      ) : null}
                    </div>
                  ) : (
                    <div className="mt-1 space-y-0.5">
                      {resultado.error_type === 'already_used' && resultado.comprador ? <p className="text-white font-medium text-sm">{resultado.comprador}{resultado.categoria ? ` · ${resultado.categoria}` : ""}</p> : null}
                      {resultado.error_type === 'already_used' && resultado.usada_at ? <p className="text-white/80 text-xs flex items-center gap-1"><Clock className="h-3 w-3 inline" /> Usada el {formatUsadaAt(resultado.usada_at)}</p> : null}
                      {resultado.error_type === 'already_used' && resultado.used_by_user_name ? <p className="text-white/70 text-xs">Por: {resultado.used_by_user_name}</p> : null}
                      {resultado.error_type !== 'already_used' ? <p className="text-white/90 text-sm">{resultado.motivo}</p> : null}
                    </div>
                  )}
                </div>
              </div>
              {modo === "entradas" ? <Button type="button" variant="secondary" className="w-full h-12" onClick={continuarEscaneoEntradas}>Continuar</Button> : null}
            </div>
          ) : null}

          <form onSubmit={handleManual} className="space-y-3">
            <Input className="h-12 bg-background font-mono text-center text-lg tracking-widest" placeholder="Clave corta o código QR" value={codigoManual} onChange={(e) => setCodigoManual(e.target.value.toUpperCase())} autoFocus autoComplete="off" />
            <Button type="submit" className="w-full h-12 text-base" disabled={loading || !codigoManual}>{loading ? "Verificando..." : modo === "entradas" ? "Verificar entrada" : "Validar consumo"}</Button>
          </form>

          {historial.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Últimos escaneos</p>
              <div className="space-y-1.5 max-h-48 overflow-y-auto">
                {historial.slice(0, 10).map((r, i) => (
                  <div key={i} className={cn(
                    "flex items-center gap-2.5 px-3 py-2 rounded-xl text-sm",
                    r.ok ? "bg-green-50"
                      : r.error_type === 'already_used' ? "bg-amber-50"
                      : r.error_type === 'not_found' ? "bg-muted/60"
                      : "bg-red-50"
                  )}>
                    <div className="flex-1 min-w-0">
                      <p className="text-foreground truncate">{r.ok ? (r.detalle ?? r.comprador ?? "OK") : r.motivo}</p>
                      {r.ok && r.categoria ? <p className="text-muted-foreground text-xs truncate">{r.categoria}{r.evento ? ` · ${r.evento}` : ""}</p> : null}
                      {!r.ok && r.error_type === 'already_used' && r.usada_at ? <p className="text-muted-foreground text-xs">Usada el {formatUsadaAt(r.usada_at)}</p> : null}
                    </div>
                    <span className="text-muted-foreground text-xs shrink-0">{r.hora}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
      )
    }

    return (
      <div className="fixed inset-0 z-50 bg-black flex flex-col">
        <div className="absolute top-0 left-0 right-0 z-10 flex items-center justify-between px-4 pt-4 pb-3" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.7), transparent)" }}>
          <button onClick={() => setPaso("seleccion")} className="h-10 w-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center" aria-label="Volver a selección"><ArrowLeft className="h-5 w-5 text-white" /></button>
          <div className="text-center"><p className="text-white font-semibold text-sm">{eventoNombre}</p><p className="text-white/70 text-xs">{modo === "entradas" ? "Apuntá al código QR" : "Validá y completá la entrega"}</p></div>
          <button onClick={() => setPanelVisible(!panelVisible)} className="h-10 w-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center" aria-label={panelVisible ? "Ocultar panel" : "Mostrar panel"}>{panelVisible ? <PanelRightClose className="h-5 w-5 text-white" /> : <PanelRightOpen className="h-5 w-5 text-white" />}</button>
        </div>

        <div className="flex-1 relative">
          <div id="qr-reader" className="w-full h-full" style={{ minHeight: "100dvh" }} />
          {cameraError ? <div className="absolute inset-x-4 top-24 z-20 max-w-md mx-auto rounded-2xl border border-red-400/30 bg-black/75 backdrop-blur p-4 text-center"><p className="text-sm font-semibold text-white mb-1">No se pudo iniciar la cámara</p><p className="text-xs text-white/70 mb-3">{cameraError}</p><div className="flex items-center justify-center gap-2"><Button type="button" variant="outline" className="h-9" onClick={() => void iniciarCamara()}>Reintentar cámara</Button><Button type="button" className="h-9" onClick={() => setPaso("manual")}>Ir a modo manual</Button></div></div> : null}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><div className="relative w-[78vw] h-[78vw] max-w-[340px] max-h-[340px] min-w-[260px] min-h-[260px] md:w-72 md:h-72 rounded-panel-lg border border-white/18 shadow-[0_0_0_9999px_rgba(0,0,0,0.32)]"><div className="pointer-events-none absolute inset-x-2 top-[8%] h-[3px] rounded-full bg-[var(--primary)] shadow-[0_0_14px_3px_var(--primary)] motion-safe:animate-[qr-scanline_2.4s_ease-in-out_infinite] motion-reduce:hidden" /><div className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 border-white rounded-tl-lg" /><div className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 border-white rounded-tr-lg" /><div className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 border-white rounded-bl-lg" /><div className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 border-white rounded-br-lg" /></div></div>
          {loading && !resultado ? (
            <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
              <div className="rounded-full bg-black/60 p-4 backdrop-blur"><Loader2 className="h-8 w-8 animate-spin text-white" /></div>
            </div>
          ) : null}
          {resultado ? (
            <div className={cn("absolute inset-0 z-20 flex flex-col items-center justify-center px-8 text-center pointer-events-auto motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-200", getResultadoBgFull(resultado))}>
              <div className="shrink-0">
                {resultado.ok
                  ? <CheckCircle2 className="h-28 w-28 text-white" strokeWidth={2.5} />
                  : resultado.error_type === 'already_used'
                    ? <Clock className="h-28 w-28 text-white" strokeWidth={2.5} />
                    : resultado.error_type === 'not_found'
                      ? <XCircle className="h-28 w-28 text-white" strokeWidth={2.5} />
                      : <AlertTriangle className="h-28 w-28 text-white" strokeWidth={2.5} />
                }
              </div>
              <p className="mt-4 text-4xl font-black uppercase tracking-tight text-white">
                {resultado.ok ? "Válida" : resultado.error_type === 'already_used' ? "Ya usada" : resultado.error_type === 'not_found' ? "No encontrada" : resultado.error_type === 'cancelled' ? "Cancelada" : "Inválida"}
              </p>
              <div className="mt-3 w-full max-w-sm space-y-1">
                {resultado.ok ? (
                  <>
                    {(resultado.comprador || resultado.detalle) ? <p className="text-lg font-semibold text-white">{resultado.detalle ?? resultado.comprador}</p> : null}
                    {resultado.categoria ? <p className="text-sm text-white/85">{resultado.categoria}</p> : null}
                    {resultado.evento ? <p className="text-sm text-white/75">{resultado.evento}</p> : null}
                    {resultado.dni ? <p className="font-mono text-sm text-white/70">DNI {resultado.dni}</p> : null}
                    {resultado.asiento_fila && resultado.asiento_numero != null ? (
                      <p className="font-mono text-sm font-bold text-white/90 mt-1">
                        Asiento — Fila {resultado.asiento_fila} · N° {resultado.asiento_numero}
                      </p>
                    ) : null}
                  </>
                ) : (
                  <>
                    {resultado.error_type === 'already_used' && resultado.comprador ? <p className="text-lg font-semibold text-white">{resultado.comprador}{resultado.categoria ? ` · ${resultado.categoria}` : ""}</p> : null}
                    {resultado.error_type === 'already_used' && resultado.usada_at ? <p className="text-sm text-white/85">Usada el {formatUsadaAt(resultado.usada_at)}</p> : null}
                    {resultado.error_type === 'already_used' && resultado.used_by_user_name ? <p className="text-sm text-white/75">Por: {resultado.used_by_user_name}</p> : null}
                    {resultado.error_type !== 'already_used' ? <p className="text-base text-white/90">{resultado.motivo}</p> : null}
                  </>
                )}
              </div>
              {modo === "entradas" ? <Button type="button" variant="secondary" className="mt-6 h-12 w-full max-w-xs text-base font-semibold" onClick={continuarEscaneoEntradas}>Continuar</Button> : null}
            </div>
          ) : null}
          <div className="absolute bottom-4 left-4 z-10">
            <ConnectivityBadge isOnline={isOnline} />
          </div>
        </div>

        {panelVisible ? <div className="absolute top-0 right-0 bottom-0 w-72 max-w-[78vw] bg-black/80 backdrop-blur flex flex-col pt-16"><div className="flex items-center justify-between px-4 py-3 border-b border-white/10"><p className="text-sm font-semibold text-white">Historial</p><div className="flex items-center gap-2"><span className="text-xs text-white/50">{historial.length} escaneos</span>{historial.length > 0 ? <button type="button" onClick={() => setHistorial([])} aria-label="Limpiar historial" className="flex h-11 w-11 items-center justify-center rounded-full text-white/50 hover:text-white hover:bg-white/10"><Trash2 className="h-3.5 w-3.5" /></button> : null}</div></div><div className="flex-1 overflow-y-auto divide-y divide-white/10">{historial.length === 0 ? <div className="flex items-center justify-center h-32"><p className="text-white/40 text-sm text-center">Los escaneos aparecerán acá</p></div> : historial.map((r, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className={cn("h-7 w-7 rounded-full flex items-center justify-center shrink-0",
                  r.ok ? "bg-green-500/30"
                    : r.error_type === 'already_used' ? "bg-amber-500/30"
                    : r.error_type === 'not_found' ? "bg-slate-500/30"
                    : "bg-red-500/30"
                )}>
                  {r.ok ? <CheckCircle2 className="h-4 w-4 text-green-400" />
                    : r.error_type === 'already_used' ? <Clock className="h-4 w-4 text-amber-400" />
                    : r.error_type === 'not_found' ? <XCircle className="h-4 w-4 text-slate-400" />
                    : <AlertTriangle className="h-4 w-4 text-red-400" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white truncate">{r.ok ? (r.detalle ?? r.comprador ?? "OK") : r.motivo}</p>
                  {r.ok && r.categoria ? <p className="text-xs text-white/50 truncate">{r.categoria}</p> : null}
                  {!r.ok && r.error_type === 'already_used' && r.usada_at ? <p className="text-xs text-white/50">Usada el {formatUsadaAt(r.usada_at)}</p> : null}
                  <p className="text-xs text-white/40">{r.hora}</p>
                </div>
              </div>
            ))}</div></div> : null}
      </div>
    )
  }

  return (
    <>
      {renderPasoContent()}
      <Dialog open={!!previewConsumible} onOpenChange={(open) => { if (!open && !confirmingConsumible) closePreviewConsumible() }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar entrega en barra</DialogTitle>
            <DialogDescription className="sr-only">Revisá los ítems del pedido y confirmá la entrega en barra.</DialogDescription>
          </DialogHeader>
          {renderConsumibleDialogBody()}
        </DialogContent>
      </Dialog>

      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5 text-primary" />
              Exportar historial de escaneos
            </DialogTitle>
            <DialogDescription className="sr-only">Seleccioná el rango de fechas y el formato para exportar el historial.</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
              <p className="text-sm font-medium text-foreground">{eventoNombre}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Solo se exportan entradas ya escaneadas.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="export-desde" className="text-xs">Desde</Label>
                <Input
                  id="export-desde"
                  type="date"
                  className="h-9"
                  value={exportFilters.desde}
                  onChange={(e) => setExportFilters((f) => ({ ...f, desde: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="export-hasta" className="text-xs">Hasta</Label>
                <Input
                  id="export-hasta"
                  type="date"
                  className="h-9"
                  value={exportFilters.hasta}
                  onChange={(e) => setExportFilters((f) => ({ ...f, hasta: e.target.value }))}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="export-escaneador" className="text-xs">Escaneador (opcional)</Label>
              <Input
                id="export-escaneador"
                placeholder="Nombre del empleado..."
                className="h-9"
                value={exportFilters.escaneador}
                onChange={(e) => setExportFilters((f) => ({ ...f, escaneador: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Formato</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={exportFormat === "xlsx" ? "default" : "outline"}
                  className="h-9 gap-2"
                  onClick={() => setExportFormat("xlsx")}
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Excel
                </Button>
                <Button
                  type="button"
                  variant={exportFormat === "csv" ? "default" : "outline"}
                  className="h-9 gap-2"
                  onClick={() => setExportFormat("csv")}
                >
                  <FileText className="h-4 w-4" />
                  CSV
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setExportDialogOpen(false)} disabled={isExporting}>
              Cancelar
            </Button>
            <Button onClick={() => void handleExport()} disabled={isExporting} className="gap-2">
              {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isExporting ? "Exportando..." : "Exportar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
