import { Router, type Request, type Response } from 'express'
import { logServerError } from '../lib/safe-log'
import { safeMsg } from '../lib/http-error'
import { actorFromRequest, logAuditEvent } from '../lib/audit-log'
import {
  anularTicket,
  assignTicketsToRevendedor,
  createLote,
  getLoteWithContext,
  getTicketsByLote,
  listLotesByEmpresa,
  unassignTicket,
  updateLoteEstado,
  type LoteEstado,
} from '../lib/preimpresos'
import { generateLotePdfBuffer } from '../lib/preimpresos-pdf'

import { getActorEmpresaId } from '../lib/authz'

const router = Router()

function empresaIdFromReq(req: Request): string | null {
  if (!req.user) return null
  return getActorEmpresaId(req.user) ?? null
}

router.get('/', async (req: Request, res: Response) => {
  try {
    const empresaId = empresaIdFromReq(req)
    if (!empresaId) return res.status(403).json({ error: 'Sin contexto de empresa' })
    const eventoId = typeof req.query.evento_id === 'string' ? req.query.evento_id : null
    const lotes = await listLotesByEmpresa(empresaId, eventoId)
    return res.json({ data: { lotes } })
  } catch (err) {
    logServerError('preimpresos list', err)
    return res.status(500).json({ error: 'Error listando lotes' })
  }
})

router.post('/', async (req: Request, res: Response) => {
  try {
    const empresaId = empresaIdFromReq(req)
    if (!empresaId) return res.status(403).json({ error: 'Sin contexto de empresa' })
    const body = (req.body ?? {}) as Record<string, unknown>

    const eventoId = typeof body.evento_id === 'string' ? body.evento_id : null
    const categoriaId = typeof body.categoria_id === 'string' ? body.categoria_id : null
    const fechaId = typeof body.fecha_id === 'string' ? body.fecha_id : null
    const cantidad = Number(body.cantidad)
    const precioImpreso = body.precio_impreso === null || body.precio_impreso === undefined ? null : Number(body.precio_impreso)
    const allowedFormatos = ['horizontal_4xa4', 'vertical_4xa4', 'tarjeta_8xa4', 'pulsera_12xa4'] as const
    const formato = (typeof body.formato === 'string' && (allowedFormatos as readonly string[]).includes(body.formato)
      ? (body.formato as typeof allowedFormatos[number])
      : 'horizontal_4xa4')
    const notas = typeof body.notas === 'string' && body.notas.trim() ? body.notas.trim() : null
    const seguridadGuilloche = body.seguridad_guilloche === true
    const seguridadMicrotexto = body.seguridad_microtexto === true
    const seguridadHologramaArea = body.seguridad_holograma_area === true

    if (!eventoId || !categoriaId) return res.status(400).json({ error: 'evento_id y categoria_id son obligatorios' })
    if (!Number.isFinite(cantidad) || cantidad < 1) return res.status(400).json({ error: 'cantidad debe ser un entero positivo' })

    const userId = req.user?.id ?? ''
    const loteId = await createLote({
      empresaId,
      eventoId,
      categoriaId,
      fechaId,
      cantidad: Math.floor(cantidad),
      precioImpreso,
      formato,
      notas,
      createdByUserId: userId,
      seguridadGuilloche,
      seguridadMicrotexto,
      seguridadHologramaArea,
    })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'preimpresos.lote.created',
      entityType: 'ticket_fisico_lote',
      entityId: loteId,
      entityLabel: `Lote ${cantidad} tickets · ${eventoId}`,
      payload: { cantidad, evento_id: eventoId, categoria_id: categoriaId, formato, precio_impreso: precioImpreso },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.status(201).json({ data: { lote_id: loteId } })
  } catch (err) {
    logServerError('preimpresos create', err)
    return res.status(400).json({ error: safeMsg(err, 'Error creando lote') })
  }
})

router.get('/:loteId/tickets', async (req: Request, res: Response) => {
  try {
    const empresaId = empresaIdFromReq(req)
    if (!empresaId) return res.status(403).json({ error: 'Sin contexto de empresa' })
    const tickets = await getTicketsByLote(req.params.loteId, empresaId)
    if (!tickets) return res.status(404).json({ error: 'Lote no encontrado' })
    return res.json({
      data: {
        tickets: tickets.map((t) => ({
          id: t.id,
          numero_secuencia: t.numero_secuencia,
          clave_corta: t.clave_corta,
          estado: t.estado,
          vendido_at: t.vendido_at?.toISOString() ?? null,
          usada_at: t.usada_at?.toISOString() ?? null,
          anulada_at: t.anulada_at?.toISOString() ?? null,
        })),
      },
    })
  } catch (err) {
    logServerError('preimpresos tickets', err)
    return res.status(500).json({ error: 'Error listando tickets' })
  }
})

router.get('/:loteId/pdf', async (req: Request, res: Response) => {
  try {
    const empresaId = empresaIdFromReq(req)
    if (!empresaId) return res.status(403).json({ error: 'Sin contexto de empresa' })

    const context = await getLoteWithContext(req.params.loteId, empresaId)
    if (!context) return res.status(404).json({ error: 'Lote no encontrado' })
    const tickets = await getTicketsByLote(req.params.loteId, empresaId)
    if (!tickets || tickets.length === 0) return res.status(404).json({ error: 'Lote sin tickets' })

    const pdfBuffer = await generateLotePdfBuffer({
      evento_nombre: context.evento?.nombre ?? 'Evento',
      evento_fecha: context.fecha?.fecha?.toISOString() ?? null,
      evento_lugar: context.evento?.lugar ?? null,
      categoria_nombre: context.categoria?.nombre ?? 'General',
      empresa_nombre: context.empresa?.nombre ?? 'Ticketera',
      precio_impreso: context.lote.precio_impreso !== null ? Number(context.lote.precio_impreso) : null,
      cantidad_total: context.lote.cantidad_total,
      formato: (context.lote.formato as 'horizontal_4xa4' | 'vertical_4xa4' | 'tarjeta_8xa4' | 'pulsera_12xa4') ?? 'horizontal_4xa4',
      seguridadGuilloche: context.lote.seguridad_guilloche,
      seguridadMicrotexto: context.lote.seguridad_microtexto,
      seguridadHologramaArea: context.lote.seguridad_holograma_area,
      tickets: tickets.map((t) => ({
        qr_code: t.qr_code,
        clave_corta: t.clave_corta,
        numero_secuencia: t.numero_secuencia,
      })),
    })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'preimpresos.lote.pdf_downloaded',
      entityType: 'ticket_fisico_lote',
      entityId: req.params.loteId,
      entityLabel: `PDF de lote ${context.lote.cantidad_total} tickets`,
      payload: { cantidad: context.lote.cantidad_total, evento_id: context.lote.evento_id },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="lote-${req.params.loteId.slice(0, 8)}-${context.lote.cantidad_total}-tickets.pdf"`,
    )
    return res.send(pdfBuffer)
  } catch (err) {
    logServerError('preimpresos pdf', err)
    return res.status(500).json({ error: 'Error generando PDF' })
  }
})

router.patch('/:loteId/estado', async (req: Request, res: Response) => {
  try {
    const empresaId = empresaIdFromReq(req)
    if (!empresaId) return res.status(403).json({ error: 'Sin contexto de empresa' })
    const body = (req.body ?? {}) as Record<string, unknown>
    const estado = typeof body.estado === 'string' ? (body.estado as LoteEstado) : null
    if (!estado || !['generado', 'enviado_imprenta', 'recibido', 'completado', 'anulado'].includes(estado)) {
      return res.status(400).json({ error: 'estado inválido' })
    }
    const lote = await updateLoteEstado(req.params.loteId, empresaId, estado)
    if (!lote) return res.status(404).json({ error: 'Lote no encontrado' })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'preimpresos.lote.estado_changed',
      entityType: 'ticket_fisico_lote',
      entityId: req.params.loteId,
      entityLabel: `Lote → ${estado}`,
      payload: { estado_nuevo: estado, evento_id: lote.evento_id },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.json({ data: { lote } })
  } catch (err) {
    logServerError('preimpresos estado', err)
    return res.status(500).json({ error: 'Error actualizando lote' })
  }
})

// Assign N tickets from a lote to a revendedor (empresa admin only).
// Picks the first N 'disponible' un-assigned tickets in numero_secuencia order.
router.post('/:loteId/asignar', async (req: Request, res: Response) => {
  try {
    const empresaId = empresaIdFromReq(req)
    if (!empresaId) return res.status(403).json({ error: 'Sin contexto de empresa' })
    const body = (req.body ?? {}) as Record<string, unknown>
    const revendedorId = typeof body.revendedor_id === 'string' ? body.revendedor_id : null
    const cantidad = Number(body.cantidad)

    if (!revendedorId) return res.status(400).json({ error: 'revendedor_id es obligatorio' })
    if (!Number.isFinite(cantidad) || cantidad < 1) return res.status(400).json({ error: 'cantidad inválida' })

    const result = await assignTicketsToRevendedor({
      loteId: req.params.loteId,
      empresaId,
      revendedorId,
      cantidad: Math.floor(cantidad),
      asignadoByUserId: req.user?.id ?? '',
    })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'preimpresos.lote.asignado',
      entityType: 'ticket_fisico_lote',
      entityId: req.params.loteId,
      entityLabel: `Asignó ${result.asignados}/${cantidad} a revendedor ${revendedorId}`,
      payload: { revendedor_id: revendedorId, cantidad_solicitada: cantidad, cantidad_asignada: result.asignados },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.json({ data: result })
  } catch (err) {
    logServerError('preimpresos asignar', err)
    return res.status(400).json({ error: safeMsg(err, 'Error asignando tickets') })
  }
})

router.post('/tickets/:ticketId/desasignar', async (req: Request, res: Response) => {
  try {
    const empresaId = empresaIdFromReq(req)
    if (!empresaId) return res.status(403).json({ error: 'Sin contexto de empresa' })
    const ticket = await unassignTicket(req.params.ticketId, empresaId)
    if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'preimpresos.ticket.desasignado',
      entityType: 'ticket_fisico',
      entityId: req.params.ticketId,
      entityLabel: `Ticket #${ticket.numero_secuencia} desasignado`,
      payload: { lote_id: ticket.lote_id },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.json({ data: { ticket } })
  } catch (err) {
    logServerError('preimpresos desasignar', err)
    return res.status(400).json({ error: safeMsg(err, 'Error desasignando ticket') })
  }
})

router.post('/tickets/:ticketId/anular', async (req: Request, res: Response) => {
  try {
    const empresaId = empresaIdFromReq(req)
    if (!empresaId) return res.status(403).json({ error: 'Sin contexto de empresa' })
    const body = (req.body ?? {}) as Record<string, unknown>
    const motivo = typeof body.motivo === 'string' ? body.motivo.slice(0, 191) : null

    const ticket = await anularTicket(req.params.ticketId, empresaId, motivo)
    if (!ticket) return res.status(404).json({ error: 'Ticket no encontrado' })

    void logAuditEvent({
      actor: actorFromRequest(req),
      action: 'preimpresos.ticket.anulado',
      entityType: 'ticket_fisico',
      entityId: req.params.ticketId,
      entityLabel: `Ticket #${ticket.numero_secuencia}`,
      payload: { lote_id: ticket.lote_id, motivo },
      ipAddress: req.requestMeta?.ip ?? null,
    })

    return res.json({ data: { ticket } })
  } catch (err) {
    logServerError('preimpresos anular', err)
    return res.status(400).json({ error: safeMsg(err, 'Error anulando ticket') })
  }
})

export default router
