import { prismaDirectUrl } from './prisma'
import { reversePlatformAllocationsForSources } from './platform-profit-sharing'

/**
 * cancelPendingConsumableSale — Prisma-native path.
 *
 * Owns its own prismaDirectUrl.$transaction with Serializable isolation.
 * FOR UPDATE issued via $queryRaw to lock the venta row before mutation.
 * Platform allocation reversal is done post-commit (best-effort, idempotent).
 *
 * Used by:
 *  - backend/src/routes/ventas.ts (standalone call, no connection arg)
 *  - backend/src/consumibles-sales-profit-sharing.test.ts (test — migrated from legacy path)
 */
export async function cancelPendingConsumableSale(input: {
  ventaId: string
  empresaId: string
  reversal?: {
    reason: string
    referenceType: string
    referenceId: string
  }
}): Promise<
  | { ok: true; previousStatus: string; nextStatus: 'cancelado'; restoredItems: number }
  | { ok: false; status: number; error: string; currentStatus?: string }
> {
  type LockResult = { estado: string; barra_id: string }[]
  type ItemResult = { consumible_id: string; cantidad: number }[]
  type TotalResult = { total: number }[]

  let txResult: {
    ok: true
    previousStatus: string
    nextStatus: 'cancelado'
    restoredItems: number
  } | {
    ok: false
    status: number
    error: string
    currentStatus?: string
  } | null = null

  await prismaDirectUrl.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<LockResult>`
      SELECT estado, barra_id FROM consumibles_ventas
      WHERE id = ${input.ventaId} AND empresa_id = ${input.empresaId}
      FOR UPDATE`

    if (!rows.length) {
      txResult = { ok: false as const, status: 404, error: 'No encontrado' }
      return
    }

    if (rows[0].estado !== 'pendiente') {
      txResult = {
        ok: false as const,
        status: 400,
        error: 'Solo se pueden cancelar ventas pendientes',
        currentStatus: rows[0].estado,
      }
      return
    }

    const items = await tx.$queryRaw<ItemResult>`
      SELECT consumible_id, cantidad FROM consumibles_venta_items
      WHERE venta_id = ${input.ventaId}`

    const ventaRows = await tx.$queryRaw<TotalResult>`
      SELECT total FROM consumibles_ventas
      WHERE id = ${input.ventaId} AND empresa_id = ${input.empresaId}`
    const totalOriginal = Number(ventaRows[0]?.total ?? 0)

    await tx.$executeRaw`
      UPDATE consumibles_ventas
      SET estado = 'cancelado',
          neto_empresa_amount = 0,
          owner_fee_amount = 0,
          mp_fee_amount = 0,
          refunded_amount = ${totalOriginal},
          resuelto_at = NOW()
      WHERE id = ${input.ventaId} AND empresa_id = ${input.empresaId}`

    for (const item of items) {
      // Los ítems con stock_ilimitado nunca se descontaron → tampoco se restauran.
      await tx.$executeRaw`
        UPDATE barra_stock
        SET stock_actual = stock_actual + ${item.cantidad}
        WHERE barra_id = ${rows[0].barra_id} AND consumible_id = ${item.consumible_id}
          AND stock_ilimitado = false`
    }

    // Reversal allocations inserted post-commit (best-effort, idempotent)
    // Cannot call reversePlatformAllocationsForSources inside Prisma tx (mixed drivers)
    txResult = {
      ok: true as const,
      previousStatus: rows[0].estado,
      nextStatus: 'cancelado' as const,
      restoredItems: items.length,
    }
  }, { isolationLevel: 'Serializable' })

  // Post-commit: reverse platform allocations (best-effort, idempotent)
  if (txResult !== null && (txResult as { ok: boolean }).ok) {
    await reversePlatformAllocationsForSources({
      sourceType: 'consumible_venta',
      sourceIds: [input.ventaId],
      empresaId: input.empresaId,
      reason: input.reversal?.reason ?? 'consumible_sale_cancelled',
      referenceType: input.reversal?.referenceType ?? 'consumible_sale_cancel',
      referenceId: input.reversal?.referenceId ?? input.ventaId,
    }).catch(() => {
      // best-effort: reversal is idempotent and can be retried
    })
  }

  return txResult!
}

