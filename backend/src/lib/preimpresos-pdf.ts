import PDFDocument from 'pdfkit'
import QRCode from 'qrcode'

// PDF point math: 1 mm = 2.83465 pts
const MM = 2.83465

export type TicketFormato = 'horizontal_4xa4' | 'vertical_4xa4' | 'tarjeta_8xa4' | 'pulsera_12xa4'

export type TicketDataForPdf = {
  qr_code: string
  clave_corta: string
  numero_secuencia: number
}

export type LotePdfInput = {
  evento_nombre: string
  evento_fecha: string | null
  evento_lugar?: string | null
  categoria_nombre: string
  empresa_nombre: string
  precio_impreso: number | null
  cantidad_total: number
  formato: TicketFormato
  tickets: TicketDataForPdf[]
  // Optional anti-forgery layer flags (sub-fase 2.3)
  seguridadGuilloche?: boolean
  seguridadMicrotexto?: boolean
  seguridadHologramaArea?: boolean
}

const SECTOR_COLOR = '#1ba8e7'
const TEXT_DARK = '#0b1724'
const TEXT_MUTED = '#5a6d7e'
const BORDER_COLOR = '#0e2030'
const GUILLOCHE_COLOR = '#dde9f3'

function formatFecha(iso: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleString('es-AR', {
      weekday: 'long',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function formatFechaCorta(iso: string | null): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    return d.toLocaleString('es-AR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  } catch {
    return iso
  }
}

function formatPrecio(precio: number | null): string {
  if (precio === null || precio === undefined) return ''
  return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', minimumFractionDigits: 0 }).format(precio)
}

function formatSecuencia(n: number, total: number): string {
  const width = String(total).length
  return `Nº ${String(n).padStart(width, '0')} / ${total}`
}

// ============================================================
// FORMAT SPECS — page size, tickets per page, and per-format layout
// ============================================================

type FormatSpec = {
  pageW_mm: number
  pageH_mm: number
  ticketsPerPage: number
  // Returns rect of the slot (x_mm, y_mm, w_mm, h_mm) for the given slot index
  slotRect: (slot: number) => { xMm: number; yMm: number; wMm: number; hMm: number }
  draw: (doc: InstanceType<typeof PDFDocument>, p: DrawTicketParams) => void
}

type DrawTicketParams = {
  xMm: number
  yMm: number
  wMm: number
  hMm: number
  ticket: TicketDataForPdf
  qrBuffer: Buffer
  eventoNombre: string
  eventoFecha: string | null
  eventoLugar: string | null
  categoriaNombre: string
  empresaNombre: string
  precio: number | null
  cantidadTotal: number
  seguridad: { guilloche: boolean; microtexto: boolean; hologramaArea: boolean }
}

const FORMAT_SPECS: Record<TicketFormato, FormatSpec> = {
  horizontal_4xa4: {
    pageW_mm: 297,
    pageH_mm: 210,
    ticketsPerPage: 4,
    slotRect: (slot) => {
      const margin = 5
      const spacing = 2
      const ticketH = (210 - margin * 2 - spacing * 3) / 4
      return {
        xMm: margin,
        yMm: margin + slot * (ticketH + spacing),
        wMm: 297 - margin * 2,
        hMm: ticketH,
      }
    },
    draw: drawTicketHorizontal,
  },
  vertical_4xa4: {
    pageW_mm: 210,
    pageH_mm: 297,
    ticketsPerPage: 4,
    slotRect: (slot) => {
      // 2 columns × 2 rows
      const margin = 5
      const spacingX = 2
      const spacingY = 2
      const cols = 2
      const rows = 2
      const ticketW = (210 - margin * 2 - spacingX * (cols - 1)) / cols
      const ticketH = (297 - margin * 2 - spacingY * (rows - 1)) / rows
      const col = slot % cols
      const row = Math.floor(slot / cols)
      return {
        xMm: margin + col * (ticketW + spacingX),
        yMm: margin + row * (ticketH + spacingY),
        wMm: ticketW,
        hMm: ticketH,
      }
    },
    draw: drawTicketVertical,
  },
  tarjeta_8xa4: {
    // Credit-card 85.6 x 54mm, 8 per A4 portrait (2 cols x 4 rows)
    pageW_mm: 210,
    pageH_mm: 297,
    ticketsPerPage: 8,
    slotRect: (slot) => {
      const cardW = 85.6
      const cardH = 54
      const cols = 2
      const rows = 4
      const totalW = cardW * cols + 4
      const totalH = cardH * rows + 6
      const offsetX = (210 - totalW) / 2
      const offsetY = (297 - totalH) / 2
      const col = slot % cols
      const row = Math.floor(slot / cols)
      return {
        xMm: offsetX + col * (cardW + 4),
        yMm: offsetY + row * (cardH + 2),
        wMm: cardW,
        hMm: cardH,
      }
    },
    draw: drawTicketTarjeta,
  },
  pulsera_12xa4: {
    // Wristband-like: 190x16mm bands, 12 stacked vertically on A4 portrait
    pageW_mm: 210,
    pageH_mm: 297,
    ticketsPerPage: 12,
    slotRect: (slot) => {
      const bandW = 190
      const bandH = 18
      const margin = 10
      const spacing = 2
      const offsetX = (210 - bandW) / 2
      return {
        xMm: offsetX,
        yMm: margin + slot * (bandH + spacing),
        wMm: bandW,
        hMm: bandH,
      }
    },
    draw: drawTicketPulsera,
  },
}

// ============================================================
// MAIN ENTRY POINT
// ============================================================

export async function generateLotePdfBuffer(input: LotePdfInput): Promise<Buffer> {
  const spec = FORMAT_SPECS[input.formato] ?? FORMAT_SPECS.horizontal_4xa4

  const doc = new PDFDocument({
    size: [spec.pageW_mm * MM, spec.pageH_mm * MM],
    margin: 0,
    info: {
      Title: `Tickets — ${input.evento_nombre} — ${input.categoria_nombre}`,
      Author: input.empresa_nombre,
      Creator: 'Ticketera',
      Subject: `Lote pre-impreso (${input.formato})`,
    },
  })

  const chunks: Buffer[] = []
  doc.on('data', (chunk: Buffer) => chunks.push(chunk))
  const finalPromise = new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
  })

  const qrBuffers = await Promise.all(
    input.tickets.map((t) =>
      QRCode.toBuffer(t.qr_code, {
        errorCorrectionLevel: 'M',
        margin: 1,
        scale: 8,
        color: { dark: '#000000', light: '#ffffff' },
      }),
    ),
  )

  const totalPages = Math.ceil(input.tickets.length / spec.ticketsPerPage)
  const seguridad = {
    guilloche: input.seguridadGuilloche === true,
    microtexto: input.seguridadMicrotexto === true,
    hologramaArea: input.seguridadHologramaArea === true,
  }

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    if (pageIndex > 0) doc.addPage({ size: [spec.pageW_mm * MM, spec.pageH_mm * MM], margin: 0 })

    for (let slot = 0; slot < spec.ticketsPerPage; slot += 1) {
      const ticketIndex = pageIndex * spec.ticketsPerPage + slot
      if (ticketIndex >= input.tickets.length) break
      const ticket = input.tickets[ticketIndex]
      const qrBuffer = qrBuffers[ticketIndex]
      const rect = spec.slotRect(slot)

      spec.draw(doc, {
        xMm: rect.xMm,
        yMm: rect.yMm,
        wMm: rect.wMm,
        hMm: rect.hMm,
        ticket,
        qrBuffer,
        eventoNombre: input.evento_nombre,
        eventoFecha: input.evento_fecha,
        eventoLugar: input.evento_lugar ?? null,
        categoriaNombre: input.categoria_nombre,
        empresaNombre: input.empresa_nombre,
        precio: input.precio_impreso,
        cantidadTotal: input.cantidad_total,
        seguridad,
      })

      drawCropMarks(doc, rect.xMm, rect.yMm, rect.wMm, rect.hMm)
    }
  }

  doc.end()
  return await finalPromise
}

// ============================================================
// PER-FORMAT DRAW FUNCTIONS
// ============================================================

function drawTicketHorizontal(doc: InstanceType<typeof PDFDocument>, p: DrawTicketParams) {
  const x = p.xMm * MM
  const y = p.yMm * MM
  const w = p.wMm * MM
  const h = p.hMm * MM

  doc.save()
  doc.rect(x, y, w, h).fillColor('#ffffff').fill()
  doc.restore()

  if (p.seguridad.guilloche) drawGuilloche(doc, x, y, w, h)

  const bandWMm = 22
  const bandW = bandWMm * MM
  doc.save()
  doc.rect(x, y, bandW, h).fillColor(SECTOR_COLOR).fill()
  doc.restore()

  // Vertical event name on band (rotated -90)
  doc.save()
  doc.fillColor('#ffffff')
  doc.font('Helvetica-Bold').fontSize(11)
  doc.translate(x + bandW / 2, y + h / 2)
  doc.rotate(-90)
  const eventoCorto = p.eventoNombre.length > 36 ? `${p.eventoNombre.slice(0, 33)}…` : p.eventoNombre
  doc.text(eventoCorto.toUpperCase(), -((h / 2) - 4 * MM), -6, {
    width: h - 8 * MM,
    align: 'center',
    lineBreak: false,
  })
  doc.restore()

  doc.save()
  doc.fillColor('#ffffff').font('Helvetica').fontSize(8)
  doc.text(formatSecuencia(p.ticket.numero_secuencia, p.cantidadTotal), x + 2 * MM, y + h - 6 * MM, {
    width: bandW - 4 * MM,
    align: 'center',
    lineBreak: false,
  })
  doc.restore()

  // Border
  doc.save()
  doc.lineWidth(0.4).strokeColor(BORDER_COLOR).rect(x, y, w, h).stroke()
  doc.restore()

  // Center content
  const contentX = x + bandW + 4 * MM
  const contentY = y + 4 * MM
  const contentW = w - bandW - 4 * MM - 40 * MM

  doc.font('Helvetica-Bold').fontSize(7).fillColor(TEXT_MUTED).text(p.empresaNombre.toUpperCase(), contentX, contentY, { width: contentW, lineBreak: false })
  doc.font('Helvetica-Bold').fontSize(14).fillColor(TEXT_DARK).text(p.eventoNombre, contentX, contentY + 3 * MM, { width: contentW, lineBreak: false, ellipsis: true })

  const fechaText = formatFecha(p.eventoFecha)
  if (fechaText) {
    doc.font('Helvetica').fontSize(9).fillColor(TEXT_DARK).text(fechaText, contentX, contentY + 10 * MM, { width: contentW, lineBreak: false })
  }
  if (p.eventoLugar) {
    doc.font('Helvetica').fontSize(8).fillColor(TEXT_MUTED).text(p.eventoLugar, contentX, contentY + 14 * MM, { width: contentW, lineBreak: false })
  }

  const footerY = y + h - 9 * MM
  doc.font('Helvetica-Bold').fontSize(11).fillColor(SECTOR_COLOR).text(p.categoriaNombre.toUpperCase(), contentX, footerY, { width: contentW / 2, lineBreak: false })
  if (p.precio !== null) {
    doc.font('Helvetica-Bold').fontSize(11).fillColor(TEXT_DARK).text(formatPrecio(p.precio), contentX + contentW / 2, footerY, { width: contentW / 2, align: 'right', lineBreak: false })
  }

  // QR on the right
  const qrSize = Math.min(28 * MM, h - 8 * MM)
  const qrX = x + w - qrSize - 4 * MM
  const qrY = y + (h - qrSize) / 2 - 2 * MM
  doc.image(p.qrBuffer, qrX, qrY, { width: qrSize, height: qrSize })

  doc.font('Courier-Bold').fontSize(7).fillColor(TEXT_DARK).text(p.ticket.clave_corta, qrX, qrY + qrSize + 1 * MM, {
    width: qrSize,
    align: 'center',
    lineBreak: false,
  })

  if (p.seguridad.hologramaArea) drawHologramaArea(doc, x + bandW + 4 * MM, y + h - 18 * MM, 14 * MM, 10 * MM)
  if (p.seguridad.microtexto) drawMicrotexto(doc, x + 4 * MM, y + h - 2.5 * MM, w - 8 * MM, p.eventoNombre)
}

function drawTicketVertical(doc: InstanceType<typeof PDFDocument>, p: DrawTicketParams) {
  const x = p.xMm * MM
  const y = p.yMm * MM
  const w = p.wMm * MM
  const h = p.hMm * MM

  doc.save()
  doc.rect(x, y, w, h).fillColor('#ffffff').fill()
  doc.restore()

  if (p.seguridad.guilloche) drawGuilloche(doc, x, y, w, h)

  // Top color band (full width)
  const headerHMm = 18
  const headerH = headerHMm * MM
  doc.save()
  doc.rect(x, y, w, headerH).fillColor(SECTOR_COLOR).fill()
  doc.restore()

  // Empresa nombre + sequence en header
  doc.save()
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7)
  doc.text(p.empresaNombre.toUpperCase(), x + 4 * MM, y + 3 * MM, { width: w - 8 * MM, lineBreak: false })
  doc.font('Helvetica-Bold').fontSize(13)
  const eventoCorto = p.eventoNombre.length > 28 ? `${p.eventoNombre.slice(0, 25)}…` : p.eventoNombre
  doc.text(eventoCorto, x + 4 * MM, y + 7 * MM, { width: w - 8 * MM, lineBreak: false, ellipsis: true })
  doc.restore()

  // Border
  doc.save()
  doc.lineWidth(0.4).strokeColor(BORDER_COLOR).rect(x, y, w, h).stroke()
  doc.restore()

  // Body
  const bodyY = y + headerH + 4 * MM
  const bodyX = x + 4 * MM
  const bodyW = w - 8 * MM

  const fechaText = formatFechaCorta(p.eventoFecha)
  if (fechaText) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(TEXT_MUTED).text('FECHA', bodyX, bodyY, { width: bodyW, lineBreak: false })
    doc.font('Helvetica').fontSize(10).fillColor(TEXT_DARK).text(fechaText, bodyX, bodyY + 3 * MM, { width: bodyW, lineBreak: false })
  }

  if (p.eventoLugar) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(TEXT_MUTED).text('LUGAR', bodyX, bodyY + 10 * MM, { width: bodyW, lineBreak: false })
    doc.font('Helvetica').fontSize(9).fillColor(TEXT_DARK).text(p.eventoLugar, bodyX, bodyY + 13 * MM, { width: bodyW, lineBreak: false })
  }

  doc.font('Helvetica-Bold').fontSize(8).fillColor(TEXT_MUTED).text('CATEGORÍA', bodyX, bodyY + 20 * MM, { width: bodyW, lineBreak: false })
  doc.font('Helvetica-Bold').fontSize(12).fillColor(SECTOR_COLOR).text(p.categoriaNombre.toUpperCase(), bodyX, bodyY + 23 * MM, { width: bodyW, lineBreak: false })

  if (p.precio !== null) {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(TEXT_MUTED).text('PRECIO', bodyX, bodyY + 32 * MM, { width: bodyW, lineBreak: false })
    doc.font('Helvetica-Bold').fontSize(13).fillColor(TEXT_DARK).text(formatPrecio(p.precio), bodyX, bodyY + 35 * MM, { width: bodyW, lineBreak: false })
  }

  // QR centered at the bottom
  const qrSize = Math.min(35 * MM, w - 16 * MM)
  const qrX = x + (w - qrSize) / 2
  const qrY = y + h - qrSize - 12 * MM
  doc.image(p.qrBuffer, qrX, qrY, { width: qrSize, height: qrSize })

  doc.font('Courier-Bold').fontSize(8).fillColor(TEXT_DARK).text(p.ticket.clave_corta, x, qrY + qrSize + 1 * MM, {
    width: w,
    align: 'center',
    lineBreak: false,
  })

  doc.font('Helvetica-Bold').fontSize(7).fillColor(TEXT_MUTED).text(formatSecuencia(p.ticket.numero_secuencia, p.cantidadTotal), x, y + h - 4 * MM, {
    width: w,
    align: 'center',
    lineBreak: false,
  })

  if (p.seguridad.hologramaArea) drawHologramaArea(doc, x + 4 * MM, y + headerH + 4 * MM, 12 * MM, 12 * MM)
  if (p.seguridad.microtexto) drawMicrotexto(doc, x + 4 * MM, y + h - 2 * MM, w - 8 * MM, p.eventoNombre)
}

function drawTicketTarjeta(doc: InstanceType<typeof PDFDocument>, p: DrawTicketParams) {
  const x = p.xMm * MM
  const y = p.yMm * MM
  const w = p.wMm * MM
  const h = p.hMm * MM

  // Rounded card background
  doc.save()
  doc.roundedRect(x, y, w, h, 3 * MM).fillColor('#ffffff').fill()
  doc.restore()

  if (p.seguridad.guilloche) drawGuilloche(doc, x, y, w, h)

  // Left color band
  const bandWMm = 14
  const bandW = bandWMm * MM
  doc.save()
  doc.roundedRect(x, y, bandW, h, 3 * MM).fillColor(SECTOR_COLOR).fill()
  doc.rect(x + bandW - 3 * MM, y, 3 * MM, h).fillColor(SECTOR_COLOR).fill()
  doc.restore()

  // Empresa nombre on band (rotated)
  doc.save()
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(7)
  doc.translate(x + bandW / 2, y + h / 2)
  doc.rotate(-90)
  doc.text(p.empresaNombre.toUpperCase(), -(h / 2 - 3 * MM), -3, { width: h - 6 * MM, align: 'center', lineBreak: false })
  doc.restore()

  // Border
  doc.save()
  doc.lineWidth(0.3).strokeColor(BORDER_COLOR).roundedRect(x, y, w, h, 3 * MM).stroke()
  doc.restore()

  // Content
  const contentX = x + bandW + 3 * MM
  const contentY = y + 3 * MM
  const contentW = w - bandW - 3 * MM - 24 * MM

  doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT_DARK).text(p.eventoNombre, contentX, contentY, { width: contentW, lineBreak: false, ellipsis: true })

  const fechaText = formatFechaCorta(p.eventoFecha)
  if (fechaText) {
    doc.font('Helvetica').fontSize(7).fillColor(TEXT_MUTED).text(fechaText, contentX, contentY + 5 * MM, { width: contentW, lineBreak: false })
  }

  doc.font('Helvetica-Bold').fontSize(8).fillColor(SECTOR_COLOR).text(p.categoriaNombre.toUpperCase(), contentX, contentY + 9 * MM, { width: contentW, lineBreak: false, ellipsis: true })

  if (p.precio !== null) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT_DARK).text(formatPrecio(p.precio), contentX, contentY + 13 * MM, { width: contentW, lineBreak: false })
  }

  doc.font('Helvetica').fontSize(6).fillColor(TEXT_MUTED).text(formatSecuencia(p.ticket.numero_secuencia, p.cantidadTotal), contentX, contentY + h - 11 * MM, { width: contentW, lineBreak: false })

  // QR small, right side
  const qrSize = 20 * MM
  const qrX = x + w - qrSize - 2 * MM
  const qrY = y + (h - qrSize) / 2
  doc.image(p.qrBuffer, qrX, qrY, { width: qrSize, height: qrSize })

  doc.font('Courier-Bold').fontSize(5).fillColor(TEXT_DARK).text(p.ticket.clave_corta, qrX, qrY + qrSize + 0.5 * MM, {
    width: qrSize,
    align: 'center',
    lineBreak: false,
  })

  if (p.seguridad.hologramaArea) drawHologramaArea(doc, contentX, y + h - 8 * MM, 7 * MM, 5 * MM)
}

function drawTicketPulsera(doc: InstanceType<typeof PDFDocument>, p: DrawTicketParams) {
  const x = p.xMm * MM
  const y = p.yMm * MM
  const w = p.wMm * MM
  const h = p.hMm * MM

  // Background
  doc.save()
  doc.rect(x, y, w, h).fillColor('#ffffff').fill()
  doc.restore()

  if (p.seguridad.guilloche) drawGuilloche(doc, x, y, w, h)

  // Left + right end zones (colored, where the band closes around the wrist)
  const endWMm = 12
  const endW = endWMm * MM
  doc.save()
  doc.rect(x, y, endW, h).fillColor(SECTOR_COLOR).fill()
  doc.rect(x + w - endW, y, endW, h).fillColor(SECTOR_COLOR).fill()
  doc.restore()

  // Border
  doc.save()
  doc.lineWidth(0.3).strokeColor(BORDER_COLOR).rect(x, y, w, h).stroke()
  doc.restore()

  // Center content (event nombre, fecha, categoría)
  const centerX = x + endW + 4 * MM
  const centerW = w - endW * 2 - 8 * MM - 30 * MM
  const cy = y + h / 2

  doc.font('Helvetica-Bold').fontSize(9).fillColor(TEXT_DARK).text(p.eventoNombre, centerX, cy - 3.5 * MM, { width: centerW, lineBreak: false, ellipsis: true })
  const fechaCat: string[] = []
  const fechaText = formatFechaCorta(p.eventoFecha)
  if (fechaText) fechaCat.push(fechaText)
  fechaCat.push(p.categoriaNombre)
  if (p.precio !== null) fechaCat.push(formatPrecio(p.precio))
  doc.font('Helvetica').fontSize(7).fillColor(TEXT_MUTED).text(fechaCat.join(' · '), centerX, cy + 0.5 * MM, { width: centerW, lineBreak: false, ellipsis: true })

  // QR on the right (before right end zone)
  const qrSize = h - 4 * MM
  const qrX = x + w - endW - qrSize - 2 * MM
  const qrY = y + 2 * MM
  doc.image(p.qrBuffer, qrX, qrY, { width: qrSize, height: qrSize })

  // Sequence + clave on left end zone
  doc.save()
  doc.fillColor('#ffffff').font('Helvetica-Bold').fontSize(6)
  doc.text(formatSecuencia(p.ticket.numero_secuencia, p.cantidadTotal), x, y + h / 2 - 3 * MM, { width: endW, align: 'center', lineBreak: false })
  doc.font('Courier-Bold').fontSize(6.5)
  doc.text(p.ticket.clave_corta, x, y + h / 2 + 0.5 * MM, { width: endW, align: 'center', lineBreak: false })
  doc.restore()
}

// ============================================================
// SECURITY OVERLAYS (sub-fase 2.3)
// ============================================================

function drawGuilloche(doc: InstanceType<typeof PDFDocument>, x: number, y: number, w: number, h: number) {
  // Lissajous-style fine line pattern in pale background color. Hard to reproduce
  // with photocopy because thin lines collapse or alias. Stays under the content.
  doc.save()
  doc.lineWidth(0.15).strokeColor(GUILLOCHE_COLOR)
  const steps = 600
  const cx = x + w / 2
  const cy = y + h / 2
  const rx = w * 0.45
  const ry = h * 0.45
  doc.moveTo(cx + rx, cy)
  for (let i = 1; i <= steps; i += 1) {
    const t = (i / steps) * Math.PI * 2
    const px = cx + rx * Math.cos(7 * t)
    const py = cy + ry * Math.sin(5 * t)
    doc.lineTo(px, py)
  }
  doc.stroke()

  doc.moveTo(cx + rx, cy)
  for (let i = 1; i <= steps; i += 1) {
    const t = (i / steps) * Math.PI * 2
    const px = cx + rx * Math.cos(5 * t + 0.5)
    const py = cy + ry * Math.sin(3 * t + 0.5)
    doc.lineTo(px, py)
  }
  doc.stroke()
  doc.restore()
}

function drawMicrotexto(doc: InstanceType<typeof PDFDocument>, x: number, y: number, w: number, eventoNombre: string) {
  // 4pt repeated text at the bottom of the ticket — visible to a magnifier,
  // not to a casual photocopy.
  doc.save()
  doc.font('Helvetica').fontSize(3.5).fillColor(TEXT_MUTED)
  const slug = eventoNombre.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 12)
  const piece = ` · TICKETERA · ${slug} `
  const repeated = piece.repeat(Math.ceil(w / 20))
  doc.text(repeated, x, y, { width: w, lineBreak: false, ellipsis: false })
  doc.restore()
}

function drawHologramaArea(doc: InstanceType<typeof PDFDocument>, x: number, y: number, w: number, h: number) {
  // Marked box where the organizer can stick a hologram label after printing.
  // Hatched pattern with "HOLOGRAMA" text — visual placeholder, not actual security.
  doc.save()
  doc.lineWidth(0.3).strokeColor('#bbb8aa').dash(1, { space: 1 })
  doc.rect(x, y, w, h).stroke()
  doc.undash()
  doc.font('Helvetica').fontSize(4).fillColor('#aaa6a0')
  doc.text('HOLOGRAMA', x, y + h / 2 - 1 * MM, { width: w, align: 'center', lineBreak: false })
  doc.restore()
}

// ============================================================
// CROP MARKS
// ============================================================

function drawCropMarks(doc: InstanceType<typeof PDFDocument>, xMm: number, yMm: number, wMm: number, hMm: number) {
  doc.save()
  doc.lineWidth(0.25).strokeColor('#000000')
  const len = 2 * MM
  const off = 0.5 * MM

  const xL = xMm * MM
  const xR = (xMm + wMm) * MM
  const yT = yMm * MM
  const yB = (yMm + hMm) * MM

  doc.moveTo(xL - len - off, yT).lineTo(xL - off, yT).stroke()
  doc.moveTo(xL, yT - len - off).lineTo(xL, yT - off).stroke()
  doc.moveTo(xR + off, yT).lineTo(xR + len + off, yT).stroke()
  doc.moveTo(xR, yT - len - off).lineTo(xR, yT - off).stroke()
  doc.moveTo(xL - len - off, yB).lineTo(xL - off, yB).stroke()
  doc.moveTo(xL, yB + off).lineTo(xL, yB + len + off).stroke()
  doc.moveTo(xR + off, yB).lineTo(xR + len + off, yB).stroke()
  doc.moveTo(xR, yB + off).lineTo(xR, yB + len + off).stroke()
  doc.restore()
}
