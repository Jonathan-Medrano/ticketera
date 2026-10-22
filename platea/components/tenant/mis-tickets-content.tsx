"use client"

import React, { useMemo, useRef, useState } from "react"

const HARD_LIMIT = 500
import { formatDate, formatMoney } from "@/lib/format"
import { useTenant, useTenantTheme } from "./tenant-provider"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"
import { Ticket, CalendarDays, MapPin, CheckCircle2, XCircle, Download, Beer, QrCode, ChevronDown, ChevronUp, TriangleAlert } from "lucide-react"
import dynamic from 'next/dynamic'
const QRCode = dynamic(() => import('react-qr-code'), { ssr: false })
import Link from "next/link"
import { Dialog, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Suspense } from "react"
import TenantImage from "./tenant-image"
import { TenantCard, TenantPanel, TenantSurface } from "./tenant-surface"
import { TenantDialogContent } from "./tenant-dialog"
import { toast } from "sonner"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  buildBuyerConsumibleDefaultRefundSelection,
  buildBuyerConsumibleRefundRequestItems,
  getBuyerAutomaticRefundAlertCopy,
  getBuyerConsumibleRefundAvailabilityCopy as getSharedBuyerConsumibleRefundAvailabilityCopy,
  getBuyerConsumibleRefundStatusCopy as getSharedBuyerConsumibleRefundStatusCopy,
  type BuyerConsumibleRefundMode,
  type BuyerConsumibleRefundSelection,
  type BuyerConsumibleVenta,
} from "./buyer-consumibles-contract"
import { BuyerConsumiblesRefundPanel } from "./buyer-consumibles-refund-panel"

import { TENANT_NAVBAR_CLEARANCE } from "@/lib/tenant-navbar-clearance"
type TicketItem = {
  id: string
  qr_code: string
  clave_corta: string
  estado: "valida" | "usada" | "cancelada"
  precio_pagado: number
  created_at: string
  evento_nombre: string
  imagen_url?: string | null
  lugar?: string | null
  categoria_nombre?: string | null
  funcion_fecha?: string | null
  refund?: {
    eligible: boolean
    company_enabled: boolean
    event_enabled: boolean
    checkout_session_id?: string | null
    existing_request?: {
      case_id: string
      status?: string | null
      origin?: string | null
      reason?: string | null
      note?: string | null
      is_open: boolean
    } | null
    automatic_policy?: {
      enabled: boolean
      mode: "manual" | "consumibles" | "entradas" | "todos"
      applies: boolean
    } | null
    request_window?: {
      days: number
      expires_at: string | null
      expired: boolean
    } | null
  }
}

// Devuelve cuanto tiempo le queda al comprador para pedir reembolso de la entrada.
// - Si no hay request_window configurada o expires_at es null -> null (no aplica).
// - Si esta expirado -> { expired: true }.
// - Si quedan <= 24hs -> hours.
// - Si quedan mas -> days.
export function getBuyerRefundWindowTimeLeft(ticket: TicketItem): {
  expired: boolean
  hours?: number
  days?: number
} | null {
  const window = ticket.refund?.request_window
  if (!window || !window.expires_at) return null
  const deadlineMs = new Date(window.expires_at).getTime()
  if (Number.isNaN(deadlineMs)) return null
  const remainingMs = deadlineMs - Date.now()
  if (remainingMs <= 0) return { expired: true }
  const hoursLeft = Math.ceil(remainingMs / (60 * 60 * 1000))
  if (hoursLeft <= 24) return { expired: false, hours: hoursLeft }
  const daysLeft = Math.ceil(remainingMs / (24 * 60 * 60 * 1000))
  return { expired: false, days: daysLeft }
}

type BuyerRefundRequestForm = {
  reason: string
  note: string
}

export function canShowBuyerRefundCTA(ticket: TicketItem) {
  return ticket.estado === "valida" && Boolean(ticket.refund?.eligible)
}

/**
 * Si mostrar o no la tarjeta de reembolso al comprador.
 *
 * Antes se renderizaba SIEMPRE y solo cambiaba el texto, asi que cuando el
 * dueno no tenia la función activada el comprador leia "la empresa no tiene
 * habilitadas las solicitudes de reembolso". Anunciarle una función apagada es
 * peor que no mostrar nada: siembra la duda y expone una limitación que no le
 * importa.
 *
 * La excepción es clave: si el comprador YA pidió un reembolso, la tarjeta se
 * muestra igual. Es su solicitud y necesita poder ver en qué estado está —
 * ocultarla lo dejaría sin forma de seguirla.
 */
export function shouldShowBuyerRefundCard(ticket: TicketItem) {
  if (ticket.refund?.existing_request) return true
  if (!ticket.refund) return false
  if (!ticket.refund.company_enabled || !ticket.refund.event_enabled) return false
  return true
}

export function getBuyerRefundStatusCopy(ticket: TicketItem) {
  const existingRequest = ticket.refund?.existing_request
  if (!existingRequest) return null

  switch (existingRequest.status) {
    case "requested":
      return "Solicitud enviada. La empresa todavía no la revisó."
    case "under_review":
      return "Tu solicitud está en revisión."
    case "approved_for_manual_execution":
      return "Tu solicitud fue aprobada y está pendiente de ejecución manual."
    case "rejected":
      return "La empresa rechazó tu solicitud de reembolso."
    case "executed":
      return "El reembolso ya fue procesado para esta entrada."
    case "resolved_non_refundable":
      return "La empresa marcó esta solicitud como no reembolsable."
    default:
      return "Esta entrada ya tiene una solicitud de reembolso asociada."
  }
}

export function getBuyerRefundAvailabilityCopy(ticket: TicketItem) {
  const requestCopy = getBuyerRefundStatusCopy(ticket)
  if (requestCopy) return requestCopy

  if (canShowBuyerRefundCTA(ticket)) {
    return "Podés pedir un reembolso y la empresa lo va a revisar desde su bandeja manual."
  }

  if (ticket.refund && !ticket.refund.company_enabled) {
    return "La empresa no tiene habilitadas las solicitudes de reembolso para compradores."
  }

  if (ticket.refund && !ticket.refund.event_enabled) {
    return "Este evento no tiene activadas las solicitudes de reembolso para compradores."
  }

  if (ticket.refund && !ticket.refund.checkout_session_id) {
    return "Esta entrada no está ligada a una compra confirmada."
  }

  if (ticket.refund?.request_window?.expired) {
    return "Ya pasó el plazo para pedir reembolso de esta entrada."
  }

  return "Esta entrada no tiene reembolso autogestionado disponible en este momento."
}

export function getBuyerEntryAutomaticRefundAlertCopy(ticket: TicketItem) {
  return getBuyerAutomaticRefundAlertCopy(ticket.refund?.automatic_policy, "entradas")
}

type MisTicketsTab = "entradas" | "consumibles"

export type ConsumibleVenta = BuyerConsumibleVenta

export function getBuyerConsumibleRefundStatusCopy(venta: ConsumibleVenta) {
  return getSharedBuyerConsumibleRefundStatusCopy(venta)
}

export function getBuyerConsumibleRefundAvailabilityCopy(venta: ConsumibleVenta) {
  return getSharedBuyerConsumibleRefundAvailabilityCopy(venta)
}

function getDeliveredItemsCount(venta: ConsumibleVenta) {
  if (venta.estado === "canjeado") {
    return venta.items.reduce((sum, item) => sum + Number(item.cantidad ?? 0), 0)
  }

  return venta.items.reduce((sum, item) => sum + Number(item.cantidad_entregada ?? 0), 0)
}

function getRefundedItemsCount(venta: ConsumibleVenta) {
  if (venta.estado === "cancelado") {
    return venta.items.reduce((sum, item) => sum + Number(item.cantidad ?? 0), 0)
  }

  return venta.items.reduce((sum, item) => sum + Number(item.cantidad_reembolsada ?? 0), 0)
}

function renderConsumibleResolutionBadge(item: ConsumibleVenta["items"][number]) {
  const entregados = Number(item.cantidad_entregada ?? 0)
  const reembolsados = Number(item.cantidad_reembolsada ?? 0)
  const total = Number(item.cantidad ?? 0)

  if (entregados <= 0 && reembolsados <= 0) return null

  if (reembolsados <= 0 && entregados >= total) {
    return <span className="mt-1 inline-flex items-center gap-1 text-xs text-green-400"><CheckCircle2 className="h-3.5 w-3.5" /> Todo entregado</span>
  }

  if (entregados <= 0 && reembolsados >= total) {
    return <span className="mt-1 inline-flex items-center gap-1 text-xs text-red-400"><XCircle className="h-3.5 w-3.5" /> Todo reembolsado</span>
  }

  return (
    <span className="mt-1 flex flex-wrap gap-2 text-xs">
      {entregados > 0 ? <span className="inline-flex items-center gap-1 text-green-400"><CheckCircle2 className="h-3.5 w-3.5" /> Entregados: {entregados}</span> : null}
      {reembolsados > 0 ? <span className="inline-flex items-center gap-1 text-red-400"><XCircle className="h-3.5 w-3.5" /> Reembolsados: {reembolsados}</span> : null}
    </span>
  )
}

type ConsumibleSeleccionado = ConsumibleVenta & {
  kind: "consumible"
}

type SeleccionadaItem = TicketItem | ConsumibleSeleccionado

const estadoConfig = {
  valida: { label: "Válida", icon: CheckCircle2, color: "#22c55e" },
  usada: { label: "Usada", icon: CheckCircle2, color: "#6b7280" },
  cancelada: { label: "Reembolsada", icon: XCircle, color: "#ef4444" },
}

const consumibleEstadoConfig = {
  pendiente: { label: "Válida", icon: QrCode, color: "#22c55e" },
  canjeado: { label: "Usada", icon: CheckCircle2, color: "#6b7280" },
  cancelado: { label: "Reembolsado", icon: XCircle, color: "#ef4444" },
  resuelto_parcial: { label: "Parcial", icon: XCircle, color: "#f59e0b" },
} as const

function renderConsumibleClosedSummary(venta: ConsumibleSeleccionado, tenant: ReturnType<typeof useTenant>) {
  if (venta.estado === "canjeado") {
    return (
      <div className="py-8">
        <div className="h-16 w-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: `${tenant.color_texto}10` }}>
          <CheckCircle2 className="h-8 w-8 text-slate-400" />
        </div>
        <p style={{ color: `${tenant.color_texto}80` }}>Este consumible fue canjeado</p>
      </div>
    )
  }

  if (venta.estado === "resuelto_parcial") {
    return (
      <div className="space-y-4 py-4">
        <div className="h-16 w-16 rounded-full flex items-center justify-center mx-auto" style={{ background: `${tenant.color_texto}10` }}>
          <XCircle className="h-8 w-8 text-amber-400" />
        </div>
        <p style={{ color: `${tenant.color_texto}80` }}>Este consumible se resolvió parcialmente</p>
        <div className="grid grid-cols-2 gap-3 text-left">
          <div className="rounded-2xl border p-3" style={{ borderColor: "rgba(34,197,94,0.35)", background: "rgba(34,197,94,0.08)" }}>
            <div className="inline-flex items-center gap-1 text-sm font-medium text-green-400">
              <CheckCircle2 className="h-4 w-4" /> Entregado
            </div>
            <p className="mt-2 text-lg font-semibold font-mono tabular-nums" style={{ color: tenant.color_texto }}>{formatMoney(Number(venta.delivered_amount ?? 0))}</p>
          </div>
          <div className="rounded-2xl border p-3" style={{ borderColor: "rgba(239,68,68,0.35)", background: "rgba(239,68,68,0.08)" }}>
            <div className="inline-flex items-center gap-1 text-sm font-medium text-red-400">
              <XCircle className="h-4 w-4" /> Reembolsado
            </div>
            <p className="mt-2 text-lg font-semibold font-mono tabular-nums" style={{ color: tenant.color_texto }}>{formatMoney(Number(venta.refunded_amount ?? 0))}</p>
          </div>
        </div>
        <TenantCard tenant={tenant} className="rounded-2xl border p-4 text-left" tone="muted">
          <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: `${tenant.color_texto}55` }}>Detalle de resolución</p>
          <div className="space-y-3">
            {venta.items.map((item) => (
              <div key={`${venta.id}-${item.venta_item_id}`} className="flex items-start justify-between text-sm gap-3">
                <div className="min-w-0">
                  <span className="block leading-tight">
                    {item.cantidad}x {item.nombre}
                  </span>
                  {renderConsumibleResolutionBadge(item)}
                </div>
                <span className="shrink-0 font-mono tabular-nums" style={{ color: tenant.color_texto }}>{formatMoney(Number(item.subtotal))}</span>
              </div>
            ))}
          </div>
        </TenantCard>
      </div>
    )
  }

  return (
    <div className="py-8">
      <div className="h-16 w-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: `${tenant.color_texto}10` }}>
        <XCircle className="h-8 w-8 text-red-400" />
      </div>
      <p style={{ color: `${tenant.color_texto}80` }}>Este consumible fue reembolsado</p>
    </div>
  )
}

function drawRoundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fillStyle: string,
  strokeStyle?: string,
  lineWidth = 0
) {
  context.beginPath()
  context.moveTo(x + radius, y)
  context.lineTo(x + width - radius, y)
  context.quadraticCurveTo(x + width, y, x + width, y + radius)
  context.lineTo(x + width, y + height - radius)
  context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height)
  context.lineTo(x + radius, y + height)
  context.quadraticCurveTo(x, y + height, x, y + height - radius)
  context.lineTo(x, y + radius)
  context.quadraticCurveTo(x, y, x + radius, y)
  context.closePath()
  context.fillStyle = fillStyle
  context.fill()

  if (strokeStyle && lineWidth > 0) {
    context.strokeStyle = strokeStyle
    context.lineWidth = lineWidth
    context.stroke()
  }
}

async function loadImageFromMarkup(markup: string) {
  const blob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" })
  const url = URL.createObjectURL(blob)

  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve(image)
      image.onerror = reject
      image.src = url
    })
  } finally {
    URL.revokeObjectURL(url)
  }
}

function buildPdfFromJpeg(jpegDataUrl: string, width: number, height: number) {
  const base64 = jpegDataUrl.split(",")[1]
  const imageBytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0))
  const pageWidth = 595.28
  const pageHeight = Math.max(400, pageWidth * (height / width))
  const imageHeight = pageHeight
  const contentStream = `q\n${pageWidth} 0 0 ${imageHeight} 0 0 cm\n/Im0 Do\nQ`
  const encoder = new TextEncoder()

  const objects: Uint8Array[] = []
  objects.push(encoder.encode("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"))
  objects.push(encoder.encode("2 0 obj\n<< /Type /Pages /Count 1 /Kids [3 0 R] >>\nendobj\n"))
  objects.push(encoder.encode(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>\nendobj\n`))
  objects.push(encoder.encode(`4 0 obj\n<< /Length ${contentStream.length} >>\nstream\n${contentStream}\nendstream\nendobj\n`))
  objects.push(
    encoder.encode(
      `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imageBytes.length} >>\nstream\n`
    )
  )

  const endImageStream = encoder.encode("\nendstream\nendobj\n")
  const header = encoder.encode("%PDF-1.4\n%����\n")
  const parts: Uint8Array[] = [header]
  const offsets: number[] = [0]
  let cursor = header.length

  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(cursor)
    parts.push(objects[index])
    cursor += objects[index].length

    if (index === 4) {
      parts.push(imageBytes)
      parts.push(endImageStream)
      cursor += imageBytes.length + endImageStream.length
    }
  }

  const xrefOffset = cursor
  const xref = [`xref`, `0 ${objects.length + 1}`, `0000000000 65535 f `]
  for (let index = 1; index < offsets.length; index += 1) {
    xref.push(`${offsets[index].toString().padStart(10, "0")} 00000 n `)
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  parts.push(encoder.encode(`${xref.join("\n")}\n${trailer}`))

  return new Blob(parts.map((part) => part.slice().buffer), { type: "application/pdf" })
}

async function renderTicketPdf(options: {
  ticket: TicketItem
  tenantText: string
  qrMarkup?: string
}) {
  const { ticket, tenantText, qrMarkup } = options
  const width = 1200
  const height = 1700
  const canvas = document.createElement("canvas")
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext("2d")
  if (!context) throw new Error("No pudimos preparar el PDF")

  const formattedDate = ticket.funcion_fecha
    ? new Date(ticket.funcion_fecha).toLocaleDateString("es-AR", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "America/Argentina/Buenos_Aires",
      })
    : null
  const locationLabel = ticket.lugar?.trim() ? ticket.lugar.trim() : null
  const issuedDate = formatDate(ticket.created_at)
  context.fillStyle = "#ffffff"
  context.fillRect(0, 0, width, height)

  context.fillStyle = tenantText
  context.font = "700 46px Arial"
  context.textAlign = "center"
  context.fillText(ticket.evento_nombre, 600, 200, 860)
  context.fillStyle = "#94a3b8"
  context.font = "32px Arial"
  context.fillText(ticket.categoria_nombre ?? "Entrada general", 600, 255, 700)

  drawRoundedRect(context, 170, 355, 860, 845, 34, "#ffffff", "#eef2f7", 2)

  if (qrMarkup) {
    const qrImage = await loadImageFromMarkup(qrMarkup)
    context.drawImage(qrImage, 220, 395, 760, 760)
  }

  drawRoundedRect(context, 180, 1215, 840, 165, 34, "#f1f5f9")
  context.fillStyle = "#94a3b8"
  context.font = "28px Arial"
  context.textAlign = "center"
  context.fillText("Clave de acceso", 600, 1270)
  context.fillStyle = "#0f172a"
  context.font = "700 60px Arial"
  context.fillText(ticket.clave_corta, 600, 1340)

  context.fillStyle = "#cbd5e1"
  context.font = "30px Arial"
  context.fillText("Mostrá este código en la puerta del evento", 600, 1475)

  context.fillStyle = "#64748b"
  context.font = "24px Arial"
  let metaY = 1555
  context.fillText(`Emitido ${issuedDate}`, 600, metaY)
  metaY += 26

  const isValidTicket = ticket.estado === "valida"
  const statusPillColor = isValidTicket ? "#22c55e" : "#ef4444"
  const statusPillBg = isValidTicket ? "rgba(34,197,94,0.14)" : "rgba(239,68,68,0.14)"
  const statusLabel = isValidTicket ? "✓ VALIDA" : "✕ NO VALIDA"
  drawRoundedRect(context, 445, metaY, 310, 54, 27, statusPillBg)
  context.fillStyle = statusPillColor
  context.font = "700 24px Arial"
  context.fillText(statusLabel, 600, metaY + 35)
  metaY += 86

  if (formattedDate) {
    context.fillText(formattedDate, 600, metaY)
    metaY += 42
  }
  if (locationLabel) {
    context.fillText(locationLabel, 600, metaY)
  }
  context.textAlign = "start"

  const jpeg = canvas.toDataURL("image/jpeg", 0.96)
  return buildPdfFromJpeg(jpeg, width, height)
}

function MisTicketsInner({ entradas, entradasError, consumiblesVentas }: { entradas: TicketItem[]; entradasError?: boolean; consumiblesVentas: ConsumibleVenta[] }) {
  const tenant = useTenant()
  const { mode: tenantMode } = useTenantTheme()
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const success = searchParams.get("success")
  const [seleccionada, setSeleccionada] = useState<SeleccionadaItem | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const [refundSubmitting, setRefundSubmitting] = useState(false)
  const [refundForm, setRefundForm] = useState<BuyerRefundRequestForm>({ reason: "", note: "" })
  const [consumibleRefundReason, setConsumibleRefundReason] = useState("")
  const [consumibleRefundNote, setConsumibleRefundNote] = useState("")
  const [consumibleRefundSelection, setConsumibleRefundSelection] = useState<BuyerConsumibleRefundSelection>({})
  const [consumibleRefundMode, setConsumibleRefundMode] = useState<BuyerConsumibleRefundMode>("total")
  const [refundPanelOpen, setRefundPanelOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const qrContainerRef = useRef<HTMLDivElement | null>(null)
  const activeTab: MisTicketsTab = searchParams.get("tab") === "consumibles" ? "consumibles" : "entradas"
  const ticketStats = useMemo(() => {
    return entradas.reduce(
      (acc, entrada) => {
        acc[entrada.estado] += 1
        return acc
      },
      { valida: 0, usada: 0, cancelada: 0 }
    )
  }, [entradas])
  const filteredEntradas = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return entradas
    return entradas.filter(
      (e) =>
        e.evento_nombre.toLowerCase().includes(q) ||
        (e.categoria_nombre ?? "").toLowerCase().includes(q) ||
        e.clave_corta.toLowerCase().includes(q)
    )
  }, [entradas, searchQuery])

  const consumiblesStats = useMemo(
    () => consumiblesVentas.reduce(
      (acc, venta) => {
        acc.qrs += 1
        acc.items += venta.items.reduce((sum, item) => sum + item.cantidad, 0)
        acc.total += Number(venta.total)
        if (venta.estado === "pendiente") acc.valida += 1
        acc.usada += getDeliveredItemsCount(venta)
        acc.reembolsada += getRefundedItemsCount(venta)
        return acc
      },
      { qrs: 0, items: 0, total: 0, valida: 0, usada: 0, reembolsada: 0 }
    ),
    [consumiblesVentas]
  )
  const consumiblesPorEvento = useMemo(() => {
    const grouped = new Map<string, {
      eventoId: string
      eventoNombre: string
      ventas: ConsumibleVenta[]
      totalQrs: number
      totalItems: number
      totalMonto: number
    }>()

    for (const venta of consumiblesVentas) {
      const current = grouped.get(venta.evento_id) ?? {
        eventoId: venta.evento_id,
        eventoNombre: venta.evento_nombre,
        ventas: [],
        totalQrs: 0,
        totalItems: 0,
        totalMonto: 0,
      }

      current.ventas.push(venta)
      current.totalQrs += 1
      current.totalItems += venta.items.reduce((sum, item) => sum + item.cantidad, 0)
      current.totalMonto += Number(venta.total)
      grouped.set(venta.evento_id, current)
    }

    return Array.from(grouped.values())
  }, [consumiblesVentas])

  function handleTabChange(nextTab: string) {
    const tab = nextTab === "consumibles" ? "consumibles" : "entradas"
    const params = new URLSearchParams(searchParams.toString())

    if (tab === "entradas") {
      params.delete("tab")
    } else {
      params.set("tab", tab)
    }

    const nextUrl = params.toString() ? `${pathname}?${params.toString()}` : pathname
    router.replace(nextUrl, { scroll: false })
  }

  function describeConsumibleItems(venta: ConsumibleVenta) {
    return venta.items
      .map((item) => `${item.cantidad} ${item.nombre}`)
      .join(" · ")
  }

  async function handleDownloadTicket(ticket: TicketItem) {
    try {
      setDownloadingId(ticket.id)
      const qrSvg = qrContainerRef.current?.querySelector("svg")
      const pdfBlob = await renderTicketPdf({
        ticket,
        tenantText: tenant.color_texto,
        qrMarkup: qrSvg instanceof SVGSVGElement ? qrSvg.outerHTML : undefined,
      })
      const url = URL.createObjectURL(pdfBlob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `${ticket.evento_nombre}-${ticket.clave_corta}.pdf`.toLowerCase().replace(/[^a-z0-9-_\.áéíóúñ]/gi, "-")
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.success("PDF descargado")
    } catch {
      toast.error("No pudimos descargar el PDF del ticket")
    } finally {
      window.setTimeout(() => setDownloadingId(null), 250)
    }
  }

  async function handleSubmitRefundRequest(ticket: TicketItem) {
    if (!canShowBuyerRefundCTA(ticket)) {
      toast.error("Esta entrada no puede pedir reembolso desde acá")
      return
    }

    if (!refundForm.reason.trim()) {
      toast.error("Contanos brevemente por qué querés pedir el reembolso")
      return
    }

    try {
      setRefundSubmitting(true)
      const response = await fetch(`/api/tenant/${tenant.slug}/refunds`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entrada_id: ticket.id,
          reason: refundForm.reason.trim(),
          note: refundForm.note.trim() || undefined,
        }),
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const fallback = payload && typeof payload === "object" && "error" in payload ? String(payload.error ?? "No se pudo crear la solicitud") : "No se pudo crear la solicitud"
        toast.error(fallback)
        return
      }

      toast.success("Solicitud de reembolso enviada")
      setRefundForm({ reason: "", note: "" })
      setSeleccionada(null)
      router.refresh()
    } finally {
      setRefundSubmitting(false)
    }
  }

  async function handleSubmitBuyerConsumibleRefundRequest(venta: ConsumibleVenta) {
    const items = buildBuyerConsumibleRefundRequestItems(venta, consumibleRefundSelection)

    if (!items.length) {
      toast.error("Dejá al menos una línea marcada para pedir el reembolso")
      return
    }

    if (!consumibleRefundReason.trim()) {
      toast.error("Contanos por qué querés pedir el reembolso")
      return
    }

    try {
      setRefundSubmitting(true)
      const response = await fetch(`/api/tenant/${tenant.slug}/consumibles-refund-requests`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, reason: consumibleRefundReason.trim(), note: consumibleRefundNote.trim() || undefined }),
      })

      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const fallback = payload && typeof payload === "object" && "error" in payload ? String(payload.error ?? "No se pudo crear la solicitud") : "No se pudo crear la solicitud"
        toast.error(fallback)
        return
      }

      toast.success("Solicitud de reembolso enviada")
      setSeleccionada(null)
      setConsumibleRefundReason("")
      setConsumibleRefundNote("")
      setConsumibleRefundSelection({})
      setConsumibleRefundMode("total")
      router.refresh()
    } finally {
      setRefundSubmitting(false)
    }
  }

  return (
    <div className="min-h-screen pb-28" style={{ background: tenant.color_fondo, color: tenant.color_texto }}>
      {downloadingId ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/20 backdrop-blur-[2px]">
          <div className="rounded-2xl px-5 py-4 text-sm font-semibold shadow-lg" style={{ background: tenant.color_fondo, color: tenant.color_texto, border: `1px solid ${tenant.color_texto}14` }}>
            Generando PDF...
          </div>
        </div>
      ) : null}
      <div className="max-w-2xl mx-auto px-4" style={{ paddingTop: TENANT_NAVBAR_CLEARANCE }}>
        {success && (
          <div className="mb-6 bg-green-500/20 border border-green-500/30 rounded-2xl px-4 py-4 flex items-center gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-400 shrink-0" />
            <div>
              <p className="font-semibold text-green-400 text-sm">¡Compra exitosa!</p>
              <p className="text-green-400/70 text-xs">
                {activeTab === "consumibles" ? "Tus consumibles ya están disponibles" : "Tus entradas ya están disponibles"}
              </p>
            </div>
          </div>
        )}

        <Tabs value={activeTab} onValueChange={handleTabChange} className="gap-6">
          <TenantPanel tenant={tenant} className="mb-0 rounded-3xl border p-4 md:p-5">
            <h1 className="text-2xl font-black" style={{ color: tenant.color_texto }}>Mis tickets</h1>
              <p className="text-sm mt-1 mb-4" style={{ color: `${tenant.color_texto}66` }}>
                {activeTab === "entradas"
                  ? entradasError
                    ? "No disponible ahora"
                    : `${entradas.length} entrada${entradas.length !== 1 ? "s" : ""}`
                  : `${consumiblesStats.qrs} QR${consumiblesStats.qrs !== 1 ? "s" : ""} de consumibles`}
              </p>
            <TabsList
              aria-label="Secciones de Mis tickets"
              className="grid h-[60px] w-full grid-cols-2 items-stretch gap-2 rounded-2xl bg-transparent p-0"
            >
              <TabsTrigger
                value="entradas"
                className="h-full w-full justify-center self-stretch rounded-2xl px-0 py-0 text-center text-[15px] font-semibold"
                style={{ color: activeTab === "entradas" ? "#ffffff" : `${tenant.color_texto}80`, background: activeTab === "entradas" ? tenant.color_primario : `${tenant.color_texto}12` }}
              >
                Entradas
              </TabsTrigger>
              <TabsTrigger
                value="consumibles"
                className="h-full w-full justify-center self-stretch rounded-2xl px-0 py-0 text-center text-[15px] font-semibold"
                style={{ color: activeTab === "consumibles" ? "#ffffff" : `${tenant.color_texto}80`, background: activeTab === "consumibles" ? tenant.color_primario : `${tenant.color_texto}12` }}
              >
                Consumibles
              </TabsTrigger>
            </TabsList>

            {activeTab === "entradas" ? (
              entradasError ? null : (
                <div className="mt-5 grid grid-cols-1 gap-3 text-center sm:grid-cols-3">
                  <TenantCard tenant={tenant} className="rounded-2xl border p-3 text-center">
                    <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: `${tenant.color_texto}55` }}>Válidas</p>
                    <p className="font-black text-sm" style={{ color: tenant.color_texto }}>{ticketStats.valida}</p>
                  </TenantCard>
                  <TenantCard tenant={tenant} className="rounded-2xl border p-3 text-center">
                    <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: `${tenant.color_texto}55` }}>Usadas</p>
                    <p className="font-black text-sm" style={{ color: tenant.color_texto }}>{ticketStats.usada}</p>
                  </TenantCard>
                  <TenantCard tenant={tenant} className="rounded-2xl border p-3 text-center">
                    <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: `${tenant.color_texto}55` }}>Reembolsadas</p>
                    <p className="font-black text-sm" style={{ color: tenant.color_texto }}>{ticketStats.cancelada}</p>
                  </TenantCard>
                </div>
              )
            ) : (
              <div className="mt-5 grid grid-cols-1 gap-3 text-center sm:grid-cols-3">
                <TenantCard tenant={tenant} className="rounded-2xl border p-3 text-center">
                  <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: `${tenant.color_texto}55` }}>Válidas</p>
                  <p className="font-black text-sm" style={{ color: tenant.color_texto }}>{consumiblesStats.valida}</p>
                </TenantCard>
                <TenantCard tenant={tenant} className="rounded-2xl border p-3 text-center">
                  <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: `${tenant.color_texto}55` }}>Items canjeados</p>
                  <p className="font-black text-sm" style={{ color: tenant.color_texto }}>{consumiblesStats.usada}</p>
                </TenantCard>
                <TenantCard tenant={tenant} className="rounded-2xl border p-3 text-center">
                  <p className="text-[11px] uppercase tracking-wide mb-1" style={{ color: `${tenant.color_texto}55` }}>Items reembolsados</p>
                  <p className="font-black text-sm" style={{ color: tenant.color_texto }}>{consumiblesStats.reembolsada}</p>
                </TenantCard>
              </div>
            )}
          </TenantPanel>

          <TabsContent value="entradas" className="mt-0">
            {entradasError ? (
              <TenantSurface tenant={tenant} className="text-center py-16 rounded-3xl border">
                <TriangleAlert className="h-12 w-12 mx-auto mb-4" style={{ color: `${tenant.color_texto}40` }} />
                <h2 className="text-lg font-bold mb-1.5" style={{ color: tenant.color_texto }}>No pudimos cargar tus entradas ahora</h2>
                <p className="text-sm mb-5" style={{ color: `${tenant.color_texto}60` }}>Reintentá en un momento. Tus consumibles siguen disponibles en la otra pestaña.</p>
                <button
                  type="button"
                  onClick={() => router.refresh()}
                  className="inline-flex min-h-11 items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white"
                  style={{ background: tenant.color_primario }}
                >
                  Reintentar
                </button>
              </TenantSurface>
            ) : (
              <>
                {entradas.length >= HARD_LIMIT && (
                  <div className="mb-3 rounded-2xl border px-4 py-3 text-xs" style={{ borderColor: `${tenant.color_texto}20`, background: `${tenant.color_texto}08`, color: `${tenant.color_texto}70` }}>
                    Estás viendo tus últimas {HARD_LIMIT} entradas. Las compras más antiguas no se muestran.
                  </div>
                )}
                {entradas.length > 5 && (
                  <div className="mb-3">
                    <input
                      type="search"
                      placeholder="Buscar por evento, categoría o clave..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full h-11 rounded-2xl px-4 text-sm focus:outline-none"
                      style={{ background: `${tenant.color_texto}0a`, border: `1px solid ${tenant.color_texto}18`, color: tenant.color_texto }}
                    />
                  </div>
                )}
                {entradas.length === 0 ? (
                  <TenantSurface tenant={tenant} className="text-center py-20 rounded-3xl border">
                    <Ticket className="h-16 w-16 mx-auto mb-4" style={{ color: `${tenant.color_texto}25` }} />
                    <h2 className="text-lg font-bold mb-1.5" style={{ color: tenant.color_texto }}>No tenés entradas todavía</h2>
                    <p className="text-sm mb-5" style={{ color: `${tenant.color_texto}60` }}>Comprá entradas para verlas acá</p>
                    <Link
                      href={buildTenantPath(tenant.slug, tenantRoutes.home())}
                      className="inline-flex min-h-11 items-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white"
                      style={{ background: tenant.color_primario }}
                    >
                      Ver eventos
                    </Link>
                  </TenantSurface>
                ) : filteredEntradas.length === 0 ? (
                  <TenantSurface tenant={tenant} className="text-center py-12 rounded-3xl border">
                    <Ticket className="h-12 w-12 mx-auto mb-3" style={{ color: `${tenant.color_texto}30` }} />
                    <p className="text-sm font-medium" style={{ color: tenant.color_texto }}>Sin resultados para &ldquo;{searchQuery}&rdquo;</p>
                    <button type="button" onClick={() => setSearchQuery("")} className="mt-2 text-xs underline underline-offset-2" style={{ color: `${tenant.color_primario}` }}>Limpiar búsqueda</button>
                  </TenantSurface>
                ) : (
                  <div className="space-y-3">
                    {filteredEntradas.map((entrada) => {
                  const estado = estadoConfig[entrada.estado as keyof typeof estadoConfig]
                  const Icon = estado.icon

                  return (
                    <TenantSurface
                      tenant={tenant}
                      key={entrada.id}
                      className="w-full border rounded-3xl overflow-hidden text-left transition-all active:scale-[0.98] shadow-sm"
                    >
                      <button onClick={() => {
                        setRefundForm({ reason: "", note: "" })
                        setSeleccionada(entrada)
                      }} className="block w-full text-left">
                        <div className="relative w-full aspect-video">
                          {entrada.imagen_url ? (
                            <TenantImage src={entrada.imagen_url} alt={entrada.evento_nombre} className="w-full h-full object-cover" fill sizes="(max-width: 768px) 100vw, 672px" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center" style={{ background: `${tenant.color_primario}22` }}>
                              <Ticket className="h-12 w-12" style={{ color: tenant.color_primario }} />
                            </div>
                          )}
                          <div className="absolute top-3 right-3">
                            <div className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: "rgba(0,0,0,0.45)", color: estado.color }}>
                              <Icon className="h-3.5 w-3.5" />
                              {estado.label}
                            </div>
                          </div>
                        </div>
                        <div className="p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <p className="font-bold text-base leading-tight line-clamp-2" style={{ color: tenant.color_texto }}>{entrada.evento_nombre}</p>
                              <p className="text-sm mt-0.5" style={{ color: `${tenant.color_texto}80` }}>{entrada.categoria_nombre}</p>
                            </div>
                            <p className="text-xs font-mono tabular-nums shrink-0 mt-0.5" style={{ color: `${tenant.color_texto}45` }}>{entrada.clave_corta}</p>
                          </div>
                          {(entrada.funcion_fecha || entrada.lugar) && (
                            <div className="mt-2.5 space-y-1">
                              {entrada.funcion_fecha && (
                                <div className="flex items-center gap-1 text-xs" style={{ color: `${tenant.color_texto}55` }}>
                                  <CalendarDays className="h-3 w-3" />
                                  {new Date(entrada.funcion_fecha).toLocaleDateString("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: "America/Argentina/Buenos_Aires" })}
                                </div>
                              )}
                              {entrada.lugar && (
                                <div className="flex items-center gap-1 text-xs" style={{ color: `${tenant.color_texto}55` }}>
                                  <MapPin className="h-3 w-3" />
                                  {entrada.lugar}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </button>
                    </TenantSurface>
                  )
                })}
                  </div>
                )}
              </>
            )}
          </TabsContent>

          <TabsContent value="consumibles" className="mt-0">
            {consumiblesVentas.length >= HARD_LIMIT && (
              <div className="mb-3 rounded-2xl border px-4 py-3 text-xs" style={{ borderColor: `${tenant.color_texto}20`, background: `${tenant.color_texto}08`, color: `${tenant.color_texto}70` }}>
                Estás viendo tus últimos {HARD_LIMIT} QRs de consumibles. Las compras más antiguas no se muestran.
              </div>
            )}
            {consumiblesVentas.length === 0 ? (
              <TenantSurface tenant={tenant} className="text-center py-20 rounded-3xl border">
                <Beer className="h-16 w-16 mx-auto mb-4" style={{ color: `${tenant.color_texto}30` }} />
                <h2 className="text-lg font-bold mb-2" style={{ color: tenant.color_texto }}>No tenés consumibles comprados</h2>
                <p className="text-sm" style={{ color: `${tenant.color_texto}66` }}>
                  Cuando compres consumibles, tus QRs van a aparecer acá.
                </p>
              </TenantSurface>
            ) : (
              <div className="space-y-6">
                {consumiblesPorEvento.map((grupo) => (
                  <div key={grupo.eventoId} className="space-y-3">
                    <div className="px-1">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.22em]" style={{ color: `${tenant.color_texto}45` }}>
                        {grupo.eventoNombre}
                      </p>
                    </div>

                    <div className="space-y-3">
                      {grupo.ventas.map((venta) => {
                        const estado = consumibleEstadoConfig[venta.estado]
                        const Icon = estado.icon

                        return (
                          <TenantSurface
                            tenant={tenant}
                            key={venta.id}
                            className="w-full border rounded-3xl p-4 text-left transition-all active:scale-[0.98] shadow-sm"
                          >
                      <button onClick={() => {
                        setConsumibleRefundReason("")
                        setConsumibleRefundNote("")
                        setConsumibleRefundSelection(buildBuyerConsumibleDefaultRefundSelection(venta))
                        setConsumibleRefundMode("total")
                        setSeleccionada({ ...venta, kind: "consumible" })
                      }} className="grid w-full grid-cols-[48px_minmax(0,1fr)] gap-x-3 gap-y-2 sm:flex sm:flex-row sm:gap-4">
                              <div className="relative h-12 w-12 sm:h-16 sm:w-16 rounded-xl overflow-hidden shrink-0" style={{ background: `${tenant.color_texto}10` }}>
                                <div
                                  className="h-full w-full flex items-center justify-center"
                                  style={{ background: `${tenant.color_primario}22` }}
                                >
                                  <Beer className="h-5 w-5 sm:h-7 sm:w-7" style={{ color: tenant.color_primario }} />
                                </div>
                              </div>

                              <div className="min-w-0 sm:flex-1">
                                <p className="font-bold leading-tight line-clamp-2 sm:truncate" style={{ color: tenant.color_texto }}>{venta.evento_nombre}</p>
                                <p className="text-sm" style={{ color: `${tenant.color_texto}80` }}>{venta.barra_nombre || "General"}</p>
                                <p className="text-xs mt-1 line-clamp-2 sm:truncate" style={{ color: `${tenant.color_texto}55` }}>
                                  {describeConsumibleItems(venta)}
                                </p>
                              </div>

                              <div className="col-span-2 flex items-center justify-between gap-3 pt-1 sm:pt-0 sm:col-auto sm:flex-col sm:items-end sm:justify-between sm:shrink-0">
                                <div className="flex items-center gap-1" style={{ color: estado.color }}>
                                  <Icon className="h-4 w-4" />
                                  <span className="text-xs font-medium">{estado.label}</span>
                                </div>
                                <p className="text-xs font-mono text-right truncate max-w-[52%] sm:max-w-full" style={{ color: `${tenant.color_texto}45` }}>{venta.clave_corta}</p>
                              </div>
                            </button>
                          </TenantSurface>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>

      {/* Modal QR */}
      <Dialog open={!!seleccionada} onOpenChange={() => {
        setRefundForm({ reason: "", note: "" })
        setConsumibleRefundReason("")
        setConsumibleRefundNote("")
        setConsumibleRefundSelection({})
        setConsumibleRefundMode("total")
        setRefundPanelOpen(false)
        setSeleccionada(null)
      }}>
          <TenantDialogContent tenant={tenant} className="sm:max-w-sm max-h-[85vh] overflow-y-auto mx-auto">
          <DialogHeader>
            <DialogTitle className="text-center" style={{ color: tenant.color_texto }}>
              {seleccionada?.evento_nombre}
            </DialogTitle>
          </DialogHeader>

          {seleccionada && (
            <div className="space-y-4 text-center">
              <p className="text-sm" style={{ color: `${tenant.color_texto}80` }}>
                {"kind" in seleccionada ? seleccionada.barra_nombre || "General" : seleccionada.categoria_nombre}
              </p>

              {(("kind" in seleccionada && seleccionada.estado === "pendiente") || (!("kind" in seleccionada) && seleccionada.estado === "valida")) ? (
                <>
                  <div ref={qrContainerRef} className="bg-white p-4 rounded-2xl mx-auto w-fit">
                    <QRCode value={seleccionada.qr_code} size={200} />
                  </div>
                  <TenantCard tenant={tenant} className="rounded-xl px-4 py-3" tone="muted">
                    <p className="text-xs mb-1" style={{ color: `${tenant.color_texto}55` }}>{"kind" in seleccionada ? "Clave de canje" : "Clave de acceso"}</p>
                    <p className="text-2xl font-black tracking-widest font-mono" style={{ color: tenant.color_texto }}>
                      {seleccionada.clave_corta}
                    </p>
                  </TenantCard>
                  <p className="text-xs" style={{ color: `${tenant.color_texto}45` }}>
                    {"kind" in seleccionada ? "Mostrá este código en la barra para retirar tus consumibles" : "Mostrá este código en la puerta del evento"}
                  </p>
                  {!("kind" in seleccionada) && (
                    <button
                      type="button"
                      onClick={() => handleDownloadTicket(seleccionada)}
                      disabled={downloadingId === seleccionada.id}
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl px-4 font-semibold text-white disabled:opacity-60"
                      style={{ background: tenant.color_primario }}
                    >
                      <Download className="h-4 w-4" />
                      {downloadingId === seleccionada.id ? "Generando PDF..." : "Descargar PDF"}
                    </button>
                  )}
                </>
              ) : (
                "kind" in seleccionada
                  ? renderConsumibleClosedSummary(seleccionada, tenant)
                  : <div className="py-8">
                      <div className="h-16 w-16 rounded-full flex items-center justify-center mx-auto mb-4" style={{ background: `${tenant.color_texto}10` }}>
                        {seleccionada.estado === "usada" ? (
                          <CheckCircle2 className="h-8 w-8 text-slate-400" />
                        ) : (
                          <XCircle className="h-8 w-8 text-red-400" />
                        )}
                      </div>
                      <p style={{ color: `${tenant.color_texto}80` }}>
                        {`Esta entrada fue ${seleccionada.estado === "usada" ? "utilizada" : "reembolsada"}`}
                      </p>
                    </div>
              )}

              {!("kind" in seleccionada) && seleccionada.funcion_fecha && (
                <div className="flex items-center justify-center gap-1.5 text-xs" style={{ color: `${tenant.color_texto}55` }}>
                  <CalendarDays className="h-3.5 w-3.5" />
                  {new Date(seleccionada.funcion_fecha).toLocaleDateString("es-AR", {
                    weekday: "long",
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                    timeZone: "America/Argentina/Buenos_Aires",
                  })}
                </div>
              )}

              {!("kind" in seleccionada) ? (
                shouldShowBuyerRefundCard(seleccionada) ? (
                <TenantCard tenant={tenant} className="rounded-2xl border p-4 text-left" tone="muted">
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => setRefundPanelOpen((current) => !current)}
                      className="flex w-full items-center justify-between gap-3 text-left"
                    >
                      <div>
                        <p className="text-sm font-semibold" style={{ color: tenant.color_texto }}>Reembolso de esta entrada</p>
                        <p className="mt-1 text-xs" style={{ color: `${tenant.color_texto}66` }}>
                          {getBuyerRefundAvailabilityCopy(seleccionada)}
                        </p>
                      </div>
                      {refundPanelOpen ? <ChevronUp className="h-4 w-4 shrink-0" style={{ color: `${tenant.color_texto}55` }} /> : <ChevronDown className="h-4 w-4 shrink-0" style={{ color: `${tenant.color_texto}55` }} />}
                    </button>

                    {refundPanelOpen ? (
                      <>
                        {seleccionada.refund?.existing_request ? (
                          <div className="rounded-xl border px-3 py-3 text-xs" style={{ borderColor: `${tenant.color_texto}18`, color: `${tenant.color_texto}80` }}>
                            <p><span className="font-semibold">Estado:</span> {getBuyerRefundStatusCopy(seleccionada) ?? "—"}</p>
                            <p><span className="font-semibold">Caso:</span> {seleccionada.refund.existing_request.case_id}</p>
                            {seleccionada.refund.existing_request.reason ? <p><span className="font-semibold">Motivo:</span> {seleccionada.refund.existing_request.reason}</p> : null}
                          </div>
                        ) : null}

                        {canShowBuyerRefundCTA(seleccionada) ? (
                          <div className="space-y-3">
                            {getBuyerEntryAutomaticRefundAlertCopy(seleccionada) ? (
                              <div className="rounded-xl px-3 py-3 text-xs" style={{ border: `1px solid ${tenant.color_texto}18`, background: `${tenant.color_texto}08`, color: `${tenant.color_texto}` }}>
                                {getBuyerEntryAutomaticRefundAlertCopy(seleccionada)}
                              </div>
                            ) : null}
                            <div className="space-y-1.5 text-left">
                              <label htmlFor="buyer-refund-reason" className="text-sm font-medium" style={{ color: tenant.color_texto }}>Motivo</label>
                              <input
                                id="buyer-refund-reason"
                                value={refundForm.reason}
                                onChange={(event) => setRefundForm((current) => ({ ...current, reason: event.target.value }))}
                                placeholder="Ej: no voy a poder asistir"
                                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                                style={{ background: `${tenant.color_texto}0a`, border: `1px solid ${tenant.color_texto}20`, color: tenant.color_texto }}
                              />
                            </div>
                            <div className="space-y-1.5 text-left">
                              <label htmlFor="buyer-refund-note" className="text-sm font-medium" style={{ color: tenant.color_texto }}>Nota opcional</label>
                              <textarea
                                id="buyer-refund-note"
                                value={refundForm.note}
                                onChange={(event) => setRefundForm((current) => ({ ...current, note: event.target.value }))}
                                placeholder="Si querés, dejá un poco más de contexto"
                                rows={3}
                                className="w-full rounded-xl px-3 py-2 text-sm outline-none resize-none"
                                style={{ background: `${tenant.color_texto}0a`, border: `1px solid ${tenant.color_texto}20`, color: tenant.color_texto }}
                              />
                            </div>
                            <button
                              type="button"
                              className="w-full min-h-11 rounded-xl px-4 py-2 text-sm font-bold text-white transition-opacity disabled:opacity-50 disabled:cursor-not-allowed"
                              disabled={refundSubmitting}
                              style={{ background: tenant.color_primario }}
                              onClick={() => void handleSubmitRefundRequest(seleccionada)}
                            >
                              {refundSubmitting ? "Enviando solicitud..." : "Solicitar reembolso"}
                            </button>
                            {(() => {
                              const timeLeft = getBuyerRefundWindowTimeLeft(seleccionada)
                              if (!timeLeft || timeLeft.expired) return null
                              const copy = timeLeft.hours !== undefined
                                ? `Tenés ${timeLeft.hours} ${timeLeft.hours === 1 ? "hora" : "horas"} para pedir reembolso.`
                                : `Tenés ${timeLeft.days} ${timeLeft.days === 1 ? "día" : "días"} para pedir reembolso.`
                              return (
                                <p className="text-center text-xs" style={{ color: `${tenant.color_texto}60` }}>
                                  {copy}
                                </p>
                              )
                            })()}
                          </div>
                        ) : seleccionada.refund?.request_window?.expired && !seleccionada.refund?.existing_request ? (
                          <div className="space-y-2">
                            <button
                              type="button"
                              className="w-full min-h-11 rounded-xl px-4 py-2 text-sm font-bold text-white opacity-50 cursor-not-allowed"
                              disabled
                              title="Ya pasó el plazo para pedir reembolso de esta entrada"
                              style={{ background: tenant.color_primario }}
                            >
                              Solicitar reembolso
                            </button>
                            <p className={`text-center text-xs ${tenantMode === "light" ? "text-rose-700" : "text-rose-300"}`}>
                              Ya pasó el plazo para pedir reembolso de esta entrada.
                            </p>
                          </div>
                        ) : null}
                      </>
                    ) : null}
                  </div>
                </TenantCard>
                ) : null
              ) : (
                <BuyerConsumiblesRefundPanel
                  tenant={tenant}
                  venta={seleccionada}
                  selection={consumibleRefundSelection}
                  reason={consumibleRefundReason}
                  note={consumibleRefundNote}
                  mode={consumibleRefundMode}
                  submitting={refundSubmitting}
                  onModeChange={(mode) => {
                    setConsumibleRefundMode(mode)
                    if (mode === "total") {
                      setConsumibleRefundSelection(buildBuyerConsumibleDefaultRefundSelection(seleccionada))
                    }
                  }}
                  onToggleItem={(ventaItemId, nextChecked) => setConsumibleRefundSelection((current) => ({ ...current, [ventaItemId]: nextChecked }))}
                  onReasonChange={setConsumibleRefundReason}
                  onNoteChange={setConsumibleRefundNote}
                  onSubmit={() => handleSubmitBuyerConsumibleRefundRequest(seleccionada)}
                />
              )}
            </div>
          )}
        </TenantDialogContent>
      </Dialog>
    </div>
  )
}

export default function MisTicketsContent({
  entradas,
  entradasError,
  consumiblesVentas,
}: {
  entradas: TicketItem[]
  entradasError?: boolean
  consumiblesVentas: ConsumibleVenta[]
}) {
  return (
    <Suspense>
      <MisTicketsInner entradas={entradas} entradasError={entradasError} consumiblesVentas={consumiblesVentas} />
    </Suspense>
  )
}
