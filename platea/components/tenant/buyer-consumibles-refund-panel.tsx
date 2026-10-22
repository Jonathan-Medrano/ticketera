import React, { useState } from "react"

import { ChevronDown, ChevronUp } from "lucide-react"

import { Label } from "@/components/ui/label"
import type { TenantEmpresa } from "@/lib/tenant"
import { useTenantTheme } from "./tenant-provider"
import { cn } from "@/lib/utils"
import { TenantCard } from "./tenant-surface"
import { TenantInput, TenantTextarea } from "./tenant-field"
import {
  buildBuyerConsumibleRefundRequestItems,
  getBuyerAutomaticRefundAlertCopy,
  type BuyerConsumibleRefundMode,
  getBuyerConsumibleRefundAvailabilityCopy,
  getBuyerConsumibleRefundableItems,
  shouldShowBuyerConsumibleRefundPanel,
  type BuyerConsumibleRefundSelection,
  type BuyerConsumibleVenta,
} from "./buyer-consumibles-contract"

type BuyerConsumiblesRefundPanelProps = {
  tenant: TenantEmpresa
  venta: BuyerConsumibleVenta
  selection: BuyerConsumibleRefundSelection
  reason: string
  note: string
  mode: BuyerConsumibleRefundMode
  submitting: boolean
  onModeChange: (mode: BuyerConsumibleRefundMode) => void
  onToggleItem: (ventaItemId: string, nextChecked: boolean) => void
  onReasonChange: (value: string) => void
  onNoteChange: (value: string) => void
  onSubmit: () => void | Promise<void>
}

export function BuyerConsumiblesRefundPanel({
  tenant,
  venta,
  selection,
  reason,
  note,
  mode,
  submitting,
  onModeChange,
  onToggleItem,
  onReasonChange,
  onNoteChange,
  onSubmit,
}: BuyerConsumiblesRefundPanelProps) {
  const { mode: tenantMode } = useTenantTheme()
  const [open, setOpen] = useState(false)
  const refundableItems = getBuyerConsumibleRefundableItems(venta)
  const selectedItems = buildBuyerConsumibleRefundRequestItems(venta, selection)
  const availabilityCopy = getBuyerConsumibleRefundAvailabilityCopy(venta)
  const automaticRefundAlert = getBuyerAutomaticRefundAlertCopy(venta.refund_policy, "consumibles")
  const canRequestRefund = refundableItems.length > 0

  if (!shouldShowBuyerConsumibleRefundPanel(venta)) return null

  return (
    <TenantCard tenant={tenant} className="rounded-2xl border p-4 text-left" tone="muted">
      <div className="space-y-3">
        {canRequestRefund ? (
          <>
            {automaticRefundAlert ? (
              <div className={cn(
                "rounded-xl border border-border/50 bg-muted/50 px-3 py-3 text-xs",
                "text-foreground/80"
              )}>
                {automaticRefundAlert}
              </div>
            ) : null}
            <button type="button" onClick={() => setOpen((current) => !current)} className="flex w-full items-center justify-between gap-3 text-left">
              <div>
                <p className="text-sm font-semibold">Reembolso de esta compra</p>
                <p className="mt-1 text-xs" style={{ color: `${tenant.color_texto}66` }}>
                  Elegí si querés pedir el reembolso total o parcial de esta compra.
                </p>
              </div>
              {open ? <ChevronUp className="h-4 w-4 shrink-0" style={{ color: `${tenant.color_texto}55` }} /> : <ChevronDown className="h-4 w-4 shrink-0" style={{ color: `${tenant.color_texto}55` }} />}
            </button>

            {open ? (
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Tipo de reembolso</Label>
              <div className="grid grid-cols-2 gap-2">
                {([["total", "Reembolso total"], ["parcial", "Reembolso parcial"]] as const).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => onModeChange(value)}
                    aria-pressed={mode === value}
                    className="rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors cursor-pointer"
                    style={
                      mode === value
                        ? { borderColor: tenant.color_primario, background: `${tenant.color_primario}15`, color: tenant.color_texto }
                        : { borderColor: `${tenant.color_texto}20`, color: `${tenant.color_texto}80` }
                    }
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {mode === "parcial" ? refundableItems.map((item) => {
              const checked = selection[item.venta_item_id] !== false
              const eligibleQuantity = Number(item.refund?.eligible_quantity ?? 0)
              return (
                <label
                  key={item.venta_item_id}
                  htmlFor={`buyer-consumible-refund-${item.venta_item_id}`}
                  className="flex items-start gap-3 rounded-xl border px-3 py-3"
                  style={{ borderColor: `${tenant.color_texto}18` }}
                >
                  <input
                    id={`buyer-consumible-refund-${item.venta_item_id}`}
                    type="checkbox"
                    checked={checked}
                    onChange={(event) => onToggleItem(item.venta_item_id, event.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0"
                    style={{ accentColor: tenant.color_primario }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{item.nombre}</span>
                    <span className="block text-xs" style={{ color: `${tenant.color_texto}55` }}>
                      Se va a solicitar el total disponible: {eligibleQuantity} unidad{eligibleQuantity === 1 ? "" : "es"}.
                    </span>
                  </span>
                </label>
              )
            }) : null}

            {mode === "parcial" ? (
              <p className="text-xs" style={{ color: `${tenant.color_texto}55` }}>
                {selectedItems.length === 0
                  ? "Tenés que dejar al menos una línea marcada para enviar la solicitud."
                  : `${selectedItems.length} línea${selectedItems.length === 1 ? "" : "s"} incluida${selectedItems.length === 1 ? "" : "s"} en el pedido.`}
              </p>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="buyer-consumible-refund-reason">Motivo</Label>
              <TenantInput
                tenant={tenant}
                id="buyer-consumible-refund-reason"
                value={reason}
                onChange={(event) => onReasonChange(event.target.value)}
                placeholder="Ej: no voy a retirar todo el pedido"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="buyer-consumible-refund-note">Nota opcional</Label>
              <TenantTextarea
                tenant={tenant}
                id="buyer-consumible-refund-note"
                value={note}
                onChange={(event) => onNoteChange(event.target.value)}
                placeholder="Si querés, dejá más contexto para la empresa"
                rows={3}
              />
            </div>
            <button
              type="button"
              className="w-full h-11 rounded-xl text-sm font-bold text-white transition-opacity hover:opacity-90 disabled:opacity-50 cursor-pointer"
              style={{ background: tenant.color_primario }}
              disabled={submitting}
              onClick={() => void onSubmit()}
            >
              {submitting ? "Enviando solicitud..." : "Solicitar reembolso"}
            </button>
          </div>
            ) : null}
          </>
        ) : (
          <div>
            <p className="text-sm font-semibold">Reembolso de esta compra</p>
            <p className="mt-1 text-xs" style={{ color: `${tenant.color_texto}66` }}>
              {availabilityCopy}
            </p>
          </div>
        )}
      </div>
    </TenantCard>
  )
}
