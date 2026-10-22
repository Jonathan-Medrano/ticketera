import assert from "node:assert/strict"
import { createRequire } from "node:module"
import Module from "node:module"
import test from "node:test"
import React from "react"

import {
  buildBuyerConsumibleDefaultRefundSelection,
  buildBuyerConsumibleRefundRequestItems,
  shouldShowBuyerConsumibleRefundPanel,
  type BuyerConsumibleVenta,
} from "./buyer-consumibles-contract"
import { shouldShowBuyerRefundCard } from "./mis-tickets-content"

const require = createRequire(import.meta.url)
type NodeModuleLoader = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown
}

function loadMisTicketsModule() {
  const nodeModule = Module as NodeModuleLoader
  const originalLoad = nodeModule._load

  nodeModule._load = function patchedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
    if (request === "next/navigation") {
      return {
        usePathname: () => "/mis-tickets",
        useRouter: () => ({ replace: () => undefined, refresh: () => undefined }),
        useSearchParams: () => new URLSearchParams(""),
      }
    }

    if (request === "react-qr-code") {
      return function QRCode() {
        return null
      }
    }

    if (request === "sonner") {
      return { toast: { success: () => undefined, error: () => undefined } }
    }

    if (request === "@/components/ui/dialog") {
      return {
        Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
      }
    }

    if (request === "@/components/ui/tabs") {
      return {
        Tabs: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        TabsContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        TabsList: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
        TabsTrigger: ({ children }: { children: React.ReactNode }) => <button>{children}</button>,
      }
    }

    if (request === "@/components/ui/button") return { Button: ({ children }: { children: React.ReactNode }) => <button>{children}</button> }
    if (request === "@/components/ui/input") return { Input: () => <input /> }
    if (request === "@/components/ui/label") return { Label: ({ children }: { children: React.ReactNode }) => <label>{children}</label> }
    if (request === "@/components/ui/textarea") return { Textarea: () => <textarea /> }
    if (request === "./tenant-provider") return { useTenant: () => ({ color_texto: "#fff", color_fondo: "#000", color_primario: "#7c3aed", slug: "club-demo" }) }
    if (request === "./tenant-image") return function TenantImage() { return null }
    if (request === "./tenant-surface") return {
      TenantCard: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
      TenantPanel: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
      TenantSurface: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
    }
    if (request === "./tenant-dialog") return { TenantDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }

    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const modulePath = require.resolve("./mis-tickets-content")
    delete require.cache[modulePath]
    return require(modulePath) as typeof import("./mis-tickets-content")
  } finally {
    nodeModule._load = originalLoad
  }
}

const {
  canShowBuyerRefundCTA,
  getBuyerConsumibleRefundAvailabilityCopy,
  getBuyerConsumibleRefundStatusCopy,
  getBuyerEntryAutomaticRefundAlertCopy,
  getBuyerRefundAvailabilityCopy,
  getBuyerRefundStatusCopy,
} = loadMisTicketsModule()

const ticketBase = {
  id: "ent-1",
  qr_code: "qr-1",
  clave_corta: "KEY-1",
  estado: "valida" as const,
  precio_pagado: 12000,
  created_at: "2026-05-16T10:00:00.000Z",
  evento_nombre: "Festival",
  categoria_nombre: "General",
}

test("mis tickets shows CTA only for eligible valid tickets", () => {
  assert.equal(canShowBuyerRefundCTA({ ...ticketBase, refund: { eligible: true, company_enabled: true, event_enabled: true } }), true)
  assert.equal(canShowBuyerRefundCTA({ ...ticketBase, estado: "cancelada", refund: { eligible: true, company_enabled: true, event_enabled: true } }), false)
  assert.equal(canShowBuyerRefundCTA({ ...ticketBase, refund: { eligible: false, company_enabled: true, event_enabled: true } }), false)
})

test("mis tickets surfaces duplicate and reviewed refund state copy", () => {
  assert.match(
    getBuyerRefundStatusCopy({
      ...ticketBase,
      refund: {
        eligible: false,
        company_enabled: true,
        event_enabled: true,
        existing_request: { case_id: "case-1", status: "requested", is_open: true },
      },
    }) ?? "",
    /solicitud enviada/i,
  )

  assert.match(
    getBuyerRefundStatusCopy({
      ...ticketBase,
      refund: {
        eligible: false,
        company_enabled: true,
        event_enabled: true,
        existing_request: { case_id: "case-2", status: "rejected", is_open: false },
      },
    }) ?? "",
    /rechazó tu solicitud/i,
  )
})

test("mis tickets explains why refund CTA is unavailable", () => {
  assert.match(
    getBuyerRefundAvailabilityCopy({
      ...ticketBase,
      refund: { eligible: false, company_enabled: false, event_enabled: true, checkout_session_id: "cs-1" },
    }),
    /empresa no tiene habilitadas/i,
  )

  assert.match(
    getBuyerRefundAvailabilityCopy({
      ...ticketBase,
      refund: { eligible: false, company_enabled: true, event_enabled: false, checkout_session_id: "cs-1" },
    }),
    /evento no tiene activadas las solicitudes de reembolso para compradores/i,
  )

  assert.match(
    getBuyerRefundAvailabilityCopy({
      ...ticketBase,
      refund: { eligible: false, company_enabled: true, event_enabled: true, checkout_session_id: null },
    }),
    /compra confirmada/i,
  )
})

test("mis tickets exposes automatic refund alert copy when policy applies to entries", () => {
  assert.match(
    getBuyerEntryAutomaticRefundAlertCopy({
      ...ticketBase,
      refund: {
        eligible: true,
        company_enabled: true,
        event_enabled: true,
        automatic_policy: { enabled: true, mode: "entradas", applies: true },
      },
    }) ?? "",
    /reembolso automáticamente/i,
  )

  assert.equal(
    getBuyerEntryAutomaticRefundAlertCopy({
      ...ticketBase,
      refund: {
        eligible: true,
        company_enabled: true,
        event_enabled: true,
        automatic_policy: { enabled: true, mode: "consumibles", applies: false },
      },
    }),
    null,
  )
})

test("mis tickets explains buyer consumible refund request and executed outcome by quantity", () => {
  assert.match(
    getBuyerConsumibleRefundStatusCopy({
      id: "venta-1",
      qr_code: "qr-1",
      clave_corta: "CV-1",
      total: 3000,
      estado: "pendiente",
      created_at: "2026-05-16T10:00:00.000Z",
      barra_id: "bar-1",
      barra_nombre: "Barra Norte",
      evento_id: "evt-1",
      evento_nombre: "Festival",
      items: [{
        venta_item_id: "item-1",
        consumible_id: "cons-1",
        nombre: "Agua",
        cantidad: 3,
        precio_unitario: 1000,
        subtotal: 3000,
        refund: {
          eligible_quantity: 1,
          requested_quantity: 2,
          executed_quantity: 2,
          rejected_quantity: 0,
          existing_request: { case_id: "case-1", status: "executed" },
        },
      }],
    }) ?? "",
    /2 unidad.*ya fueron reembolsadas/i,
  )

  assert.match(
    getBuyerConsumibleRefundAvailabilityCopy({
      id: "venta-1",
      qr_code: "qr-1",
      clave_corta: "CV-1",
      total: 3000,
      estado: "pendiente",
      created_at: "2026-05-16T10:00:00.000Z",
      barra_id: "bar-1",
      barra_nombre: "Barra Norte",
      evento_id: "evt-1",
      evento_nombre: "Festival",
      items: [{
        venta_item_id: "item-1",
        consumible_id: "cons-1",
        nombre: "Agua",
        cantidad: 3,
        precio_unitario: 1000,
        subtotal: 3000,
        refund: {
          eligible_quantity: 1,
          requested_quantity: 0,
          executed_quantity: 2,
          rejected_quantity: 0,
        },
      }],
    }),
    /podés pedir el reembolso de hasta 1 unidad/i,
  )
})

test("mis tickets surfaces pending-review, rejected, and non-refundable consumible copy", () => {
  assert.match(
    getBuyerConsumibleRefundStatusCopy({
      id: "venta-pending",
      qr_code: "qr-pending",
      clave_corta: "CV-PEND",
      total: 4000,
      estado: "pendiente",
      created_at: "2026-05-16T10:00:00.000Z",
      barra_id: "bar-1",
      barra_nombre: "Barra Norte",
      evento_id: "evt-1",
      evento_nombre: "Festival",
      items: [{
        venta_item_id: "item-pending",
        consumible_id: "cons-pending",
        nombre: "Agua",
        cantidad: 4,
        precio_unitario: 1000,
        subtotal: 4000,
        refund: {
          eligible_quantity: 2,
          requested_quantity: 2,
          executed_quantity: 0,
          rejected_quantity: 0,
          existing_request: { case_id: "case-pending", status: "under_review" },
        },
      }],
    }) ?? "",
    /Tenés 2 unidades en revisión manual/i,
  )

  assert.match(
    getBuyerConsumibleRefundAvailabilityCopy({
      id: "venta-rejected",
      qr_code: "qr-rejected",
      clave_corta: "CV-REJ",
      total: 2000,
      estado: "pendiente",
      created_at: "2026-05-16T10:00:00.000Z",
      barra_id: "bar-1",
      barra_nombre: "Barra Norte",
      evento_id: "evt-1",
      evento_nombre: "Festival",
      items: [{
        venta_item_id: "item-rejected",
        consumible_id: "cons-rejected",
        nombre: "Papas",
        cantidad: 2,
        precio_unitario: 1000,
        subtotal: 2000,
        refund: {
          eligible_quantity: 2,
          requested_quantity: 0,
          executed_quantity: 0,
          rejected_quantity: 1,
          existing_request: { case_id: "case-rejected", status: "rejected" },
        },
      }],
    }),
    /rechazó tu solicitud de reembolso por 1 unidad/i,
  )

  assert.match(
    getBuyerConsumibleRefundAvailabilityCopy({
      id: "venta-nonref",
      qr_code: "qr-nonref",
      clave_corta: "CV-NONREF",
      total: 1500,
      estado: "pendiente",
      created_at: "2026-05-16T10:00:00.000Z",
      barra_id: "bar-1",
      barra_nombre: "Barra Norte",
      evento_id: "evt-1",
      evento_nombre: "Festival",
      items: [{
        venta_item_id: "item-nonref",
        consumible_id: "cons-nonref",
        nombre: "Gaseosa",
        cantidad: 1,
        precio_unitario: 1500,
        subtotal: 1500,
        refund: {
          eligible_quantity: 1,
          requested_quantity: 0,
          executed_quantity: 0,
          rejected_quantity: 0,
          existing_request: { case_id: "case-nonref", status: "resolved_non_refundable" },
        },
      }],
    }),
    /no reembolsable/i,
  )
})

test("buyer consumible refund defaults to full selection and omits unchecked lines", () => {
  const venta: BuyerConsumibleVenta = {
    id: "venta-default",
    qr_code: "qr-default",
    clave_corta: "CV-DEFAULT",
    total: 6500,
    estado: "pendiente",
    created_at: "2026-05-16T10:00:00.000Z",
    barra_id: "bar-default",
    barra_nombre: "Barra Norte",
    evento_id: "evt-default",
    evento_nombre: "Festival",
    items: [
      {
        venta_item_id: "item-1",
        consumible_id: "cons-1",
        nombre: "Agua",
        cantidad: 3,
        precio_unitario: 1000,
        subtotal: 3000,
        refund: { eligible_quantity: 2, requested_quantity: 0, executed_quantity: 0, rejected_quantity: 0 },
      },
      {
        venta_item_id: "item-2",
        consumible_id: "cons-2",
        nombre: "Papas",
        cantidad: 2,
        precio_unitario: 1750,
        subtotal: 3500,
        refund: { eligible_quantity: 1, requested_quantity: 0, executed_quantity: 0, rejected_quantity: 0 },
      },
    ],
  }

  const defaults = buildBuyerConsumibleDefaultRefundSelection(venta)
  assert.deepEqual(defaults, { "item-1": true, "item-2": true })

  assert.deepEqual(buildBuyerConsumibleRefundRequestItems(venta, defaults), [
    { venta_id: "venta-default", venta_item_id: "item-1", quantity_requested: 2 },
    { venta_id: "venta-default", venta_item_id: "item-2", quantity_requested: 1 },
  ])

  assert.deepEqual(buildBuyerConsumibleRefundRequestItems(venta, { ...defaults, "item-2": false }), [
    { venta_id: "venta-default", venta_item_id: "item-1", quantity_requested: 2 },
  ])

  assert.deepEqual(buildBuyerConsumibleRefundRequestItems(venta, { "item-1": false, "item-2": false }), [])
})

/**
 * Reembolso APAGADO = no se muestra nada.
 *
 * Antes el bloque se renderizaba siempre y solo cambiaba el texto a "la empresa
 * no tiene habilitadas las solicitudes de reembolso". Anunciarle al comprador una
 * función que no puede usar es peor que no mostrarla: genera la expectativa y
 * después la frustra. La única excepción es una solicitud ya existente, que tiene
 * que seguir visible para que pueda seguir su estado.
 */
type TicketRefund = NonNullable<Parameters<typeof shouldShowBuyerRefundCard>[0]["refund"]>

function ticketConRefund(refund?: Partial<TicketRefund>) {
  if (!refund) return {} as Parameters<typeof shouldShowBuyerRefundCard>[0]
  return { refund: { eligible: true, company_enabled: true, event_enabled: true, ...refund } } as Parameters<
    typeof shouldShowBuyerRefundCard
  >[0]
}

test("la card de reembolso de entrada se oculta si la empresa o el evento lo tienen apagado", () => {
  assert.equal(shouldShowBuyerRefundCard(ticketConRefund()), false)

  assert.equal(
    shouldShowBuyerRefundCard(ticketConRefund({ company_enabled: false, event_enabled: true })),
    false,
  )
  assert.equal(
    shouldShowBuyerRefundCard(ticketConRefund({ company_enabled: true, event_enabled: false })),
    false,
  )

  assert.equal(
    shouldShowBuyerRefundCard(ticketConRefund({ company_enabled: true, event_enabled: true })),
    true,
  )
})

test("una solicitud ya existente mantiene visible la card aunque hayan apagado el reembolso", () => {
  assert.equal(
    shouldShowBuyerRefundCard(
      ticketConRefund({
        company_enabled: false,
        event_enabled: false,
        existing_request: { case_id: "case-1", status: "pending", is_open: true },
      }),
    ),
    true,
  )
})

test("el panel de reembolso de consumibles se oculta si la barra lo tiene apagado", () => {
  const items = [
    {
      venta_item_id: "item-1",
      consumible_id: "cons-1",
      nombre: "Agua",
      cantidad: 3,
      precio_unitario: 1000,
      subtotal: 3000,
      refund: { eligible_quantity: 2, requested_quantity: 0, executed_quantity: 0, rejected_quantity: 0 },
    },
  ]

  const base = {
    id: "venta-gate",
    qr_code: "qr-gate",
    clave_corta: "CV-GATE",
    total: 3000,
    estado: "pendiente",
    created_at: "2026-05-16T10:00:00.000Z",
    barra_id: "bar-gate",
    barra_nombre: "Barra Sur",
    evento_id: "evt-gate",
    evento_nombre: "Festival",
    items,
  } as BuyerConsumibleVenta

  assert.equal(shouldShowBuyerConsumibleRefundPanel(base), true)
  assert.equal(
    shouldShowBuyerConsumibleRefundPanel({ ...base, buyer_consumible_refunds_enabled: false }),
    false,
  )

  // ...salvo que ya haya una solicitud en revisión: ahí tiene que poder seguirla.
  const conSolicitud = {
    ...base,
    buyer_consumible_refunds_enabled: false,
    items: [{ ...items[0], refund: { ...items[0].refund, requested_quantity: 2 } }],
  } as BuyerConsumibleVenta
  assert.equal(shouldShowBuyerConsumibleRefundPanel(conSolicitud), true)
})

test("con el reembolso apagado y una solicitud en curso, el copy muestra el estado real y no 'la barra no acepta'", () => {
  const venta = {
    id: "venta-copy",
    qr_code: "qr-copy",
    clave_corta: "CV-COPY",
    total: 3000,
    estado: "pendiente",
    created_at: "2026-05-16T10:00:00.000Z",
    barra_id: "bar-copy",
    barra_nombre: "Barra Sur",
    evento_id: "evt-copy",
    evento_nombre: "Festival",
    buyer_consumible_refunds_enabled: false,
    items: [
      {
        venta_item_id: "item-1",
        consumible_id: "cons-1",
        nombre: "Agua",
        cantidad: 3,
        precio_unitario: 1000,
        subtotal: 3000,
        refund: { eligible_quantity: 0, requested_quantity: 2, executed_quantity: 0, rejected_quantity: 0 },
      },
    ],
  } as BuyerConsumibleVenta

  const copy = getBuyerConsumibleRefundAvailabilityCopy(venta)
  assert.match(copy, /en revisión manual/i)
  assert.doesNotMatch(copy, /no acepta solicitudes/i)
})
