"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { toast } from "sonner"
import { AlertCircle, CheckCircle2, ChevronDown, Clipboard, ClipboardList, Download, FileSpreadsheet, FileText, Link2, Loader2, Receipt, Ticket } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useLoading } from "@/components/loading-provider"
import { formatMoney, formatDateTime } from "@/lib/format"
import {
  buildRefundTimeline,
  filterAndSortRefundCases,
  getRefundAutomaticScopeLabel,
  getRefundBlockReasonLabel,
  getRefundFlowMeta,
  getRefundItemEligibilityMeta,
  getRefundOriginLabel,
  getRefundPaymentStatusLabel,
  getRefundReconciliationStatusLabel,
  resolveRefundExportErrorMessage,
  getRefundStatusMeta,
  getRefundTargetStatusLabel,
  getRefundTargetTypeLabel,
  getRefundVisibleActions,
  requiresEvidenceForRefundExecution,
  type RefundCaseFilters,
  type RefundAutomaticConfig,
  type RefundManualActionId,
  type RefundManualCaseDetail,
  type RefundManualCaseSummary,
  type RefundManualViewerAccess,
} from "./reembolsos-model"

type CreateRefundResponse = RefundManualCaseDetail

type ReembolsosContentProps = {
  cases: RefundManualCaseSummary[]
  selectedCase: RefundManualCaseDetail | null
  access: RefundManualViewerAccess
  automaticRefundConfig: RefundAutomaticConfig
  buyerEventRefundsEnabled: boolean
  initialFilters: RefundCaseFilters
  exportPath: string | null
}

type ActionFormState = {
  reason: string
  note: string
  evidenceNote: string
  externalRefundReference: string
  targetIds: string
  targetType: "entrada" | "consumible_venta"
}

const INITIAL_ACTION_FORM: ActionFormState = {
  reason: "",
  note: "",
  evidenceNote: "",
  externalRefundReference: "",
  targetIds: "",
  targetType: "entrada",
}

const INITIAL_FILTERS: RefundCaseFilters = {
  query: "",
  buyer: "",
  event: "all",
  flow: "all",
  sortOrder: "date_desc",
}

export default function ReembolsosContent({ cases, selectedCase, access, automaticRefundConfig, buyerEventRefundsEnabled, initialFilters, exportPath }: ReembolsosContentProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { withLoading } = useLoading()
  const [creating, setCreating] = useState({
    checkoutSessionId: "",
    reason: "",
    note: "",
  })
  const [buyerRefundsEnabled, setBuyerRefundsEnabled] = useState(buyerEventRefundsEnabled)
  const [buyerRefundsSaving, setBuyerRefundsSaving] = useState(false)
  const [automaticRefundForm, setAutomaticRefundForm] = useState({
    enabled: automaticRefundConfig.enabled,
    scope: automaticRefundConfig.scope,
  })
  const [automaticRefundSaving, setAutomaticRefundSaving] = useState(false)
  const automaticRefundInitRef = useRef(true)
  const automaticRefundLastSavedRef = useRef(JSON.stringify({
    enabled: automaticRefundConfig.enabled,
    scope: automaticRefundConfig.scope,
  }))
  const [activeAction, setActiveAction] = useState<RefundManualActionId | null>(null)
  const [actionForm, setActionForm] = useState<ActionFormState>(INITIAL_ACTION_FORM)
  const [filters, setFilters] = useState<RefundCaseFilters>(initialFilters)
  const [itemsCollapsed, setItemsCollapsed] = useState(true)
  const [timelineCollapsed, setTimelineCollapsed] = useState(true)
  const [isExporting, setIsExporting] = useState(false)
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx">("csv")
  const [executeConfirmOpen, setExecuteConfirmOpen] = useState(false)

  const visibleActions = useMemo(
    () => getRefundVisibleActions(selectedCase, access),
    [selectedCase, access]
  )

  const timeline = useMemo(
    () => buildRefundTimeline(selectedCase?.events ?? []),
    [selectedCase]
  )

  const stats = useMemo(() => {
    return cases.reduce(
      (acc, refundCase) => {
        acc.total += 1
        acc.byStatus[refundCase.status] = (acc.byStatus[refundCase.status] ?? 0) + 1
        return acc
      },
      {
        total: 0,
        byStatus: {} as Record<string, number>,
      }
    )
  }, [cases])

  const eventOptions = useMemo(
    () => Array.from(new Set(cases.map((refundCase) => refundCase.requested_event_name ?? "Sin evento"))).sort((a, b) => a.localeCompare(b, "es-AR")),
    [cases]
  )

  const filteredCases = filterAndSortRefundCases(cases, filters)

  const visibleSelectedCase = selectedCase && cases.some((refundCase) => refundCase.id === selectedCase.case.id)
    ? selectedCase
    : null

  const requesterLabel = visibleSelectedCase?.case.requester_actor_type === "comprador"
    ? visibleSelectedCase.purchase_context?.buyer?.nombre ?? visibleSelectedCase.case.requester_actor_id
    : visibleSelectedCase?.case.requester_actor_id ?? "—"

  const buyerLabel = visibleSelectedCase?.purchase_context?.buyer?.nombre
    ?? visibleSelectedCase?.case.requester_buyer_id
    ?? "—"

  useEffect(() => {
    setFilters(initialFilters)
  }, [initialFilters])

  useEffect(() => {
    setAutomaticRefundForm({
      enabled: automaticRefundConfig.enabled,
      scope: automaticRefundConfig.scope,
    })
    automaticRefundLastSavedRef.current = JSON.stringify({
      enabled: automaticRefundConfig.enabled,
      scope: automaticRefundConfig.scope,
    })
  }, [automaticRefundConfig.enabled, automaticRefundConfig.scope])

  useEffect(() => {
    const nextParams = new URLSearchParams(searchParams.toString())

    if (filters.query) nextParams.set("query", filters.query)
    else nextParams.delete("query")

    if (filters.buyer) nextParams.set("buyer", filters.buyer)
    else nextParams.delete("buyer")

    if (filters.event !== "all") nextParams.set("event", filters.event)
    else nextParams.delete("event")

    if (filters.flow !== "all") nextParams.set("flow", filters.flow)
    else nextParams.delete("flow")

    if (filters.sortOrder !== "date_desc") nextParams.set("sortOrder", filters.sortOrder)
    else nextParams.delete("sortOrder")

    nextParams.delete("page")
    nextParams.delete("pageSize")

    const currentQuery = searchParams.toString()
    const nextQuery = nextParams.toString()
    if (nextQuery === currentQuery) return

    const timeoutId = window.setTimeout(() => {
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname)
    }, 250)

    return () => window.clearTimeout(timeoutId)
  }, [filters, pathname, router, searchParams])

  useEffect(() => {
    if (automaticRefundInitRef.current) {
      automaticRefundInitRef.current = false
      return
    }

    const serializedForm = JSON.stringify(automaticRefundForm)
    if (serializedForm === automaticRefundLastSavedRef.current) {
      return
    }

    const timeoutId = window.setTimeout(async () => {
      setAutomaticRefundSaving(true)
      const toastId = toast.loading("Guardando política automática...")

      try {
        const response = await fetch("/api/reembolsos", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(automaticRefundForm),
        })

        const payload = await readJsonSafe(response)

        if (!response.ok) {
          const error = payload && typeof payload === "object" && "error" in payload
            ? String(payload.error ?? "No se pudo guardar la política")
            : "No se pudo guardar la política"
          toast.error(error, { id: toastId })
          return
        }

        automaticRefundLastSavedRef.current = serializedForm
        router.refresh()
        toast.success("Política automática guardada", { id: toastId })
      } finally {
        setAutomaticRefundSaving(false)
      }
    }, 350)

    return () => window.clearTimeout(timeoutId)
  }, [automaticRefundForm, router])

  function updateSearchParams(nextCaseId: string) {
    setActiveAction(null)
    setActionForm({
      ...INITIAL_ACTION_FORM,
      targetType: selectedCase?.case.flow === "consumibles" ? "consumible_venta" : "entrada",
    })
    const params = new URLSearchParams(searchParams.toString())
    params.set("caseId", nextCaseId)
    router.replace(`${pathname}?${params.toString()}`)
  }

  async function readJsonSafe(response: Response) {
    try {
      return await response.json()
    } catch {
      return null
    }
  }

  async function handleToggleBuyerRefunds(checked: boolean) {
    const next = checked
    setBuyerRefundsSaving(true)
    try {
      const res = await fetch("/api/reembolsos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ buyer_event_refunds_enabled: next }),
      })
      if (!res.ok) {
        toast.error("Error al cambiar la política de reembolsos")
        return
      }
      setBuyerRefundsEnabled(next)
      toast.success(next ? "Reembolsos de comprador activados" : "Reembolsos de comprador desactivados")
    } finally {
      setBuyerRefundsSaving(false)
    }
  }

  async function handleCopyItemId(itemId: string) {
    try {
      await navigator.clipboard.writeText(itemId)
      toast.success("ID copiado")
    } catch {
      toast.error("No se pudo copiar el ID")
    }
  }

  async function handleCreateCase() {
    if (!creating.checkoutSessionId.trim() || !creating.reason.trim()) {
      toast.error("Completá checkout_session_id y motivo")
      return
    }

    await withLoading(async () => {
      const response = await fetch("/api/reembolsos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          checkout_session_id: creating.checkoutSessionId.trim(),
          reason: creating.reason.trim(),
          note: creating.note.trim() || undefined,
        }),
      })

      const payload = (await readJsonSafe(response)) as CreateRefundResponse | { error?: string } | null

      if (!response.ok) {
        toast.error(payload && "error" in payload ? payload.error ?? "No se pudo crear el caso" : "No se pudo crear el caso")
        return
      }

      const newCaseId = payload && "case" in payload ? payload.case.id : null
      setCreating({ checkoutSessionId: "", reason: "", note: "" })
      if (newCaseId) updateSearchParams(newCaseId)
      router.refresh()
      toast.success("Caso de reembolso creado")
    })
  }

  function buildExportUrl(format: "csv" | "xlsx") {
    const params = new URLSearchParams()
    if (filters.query) params.set("query", filters.query)
    if (filters.buyer) params.set("buyer", filters.buyer)
    if (filters.event !== "all") params.set("event", filters.event)
    if (filters.flow !== "all") params.set("flow", filters.flow)
    if (filters.sortOrder !== "date_desc") params.set("sortOrder", filters.sortOrder)
    params.set("format", format)
    return `/api/reembolsos/export?${params.toString()}`
  }

  async function handleExport(format: "csv" | "xlsx") {
    if (!exportPath || isExporting) return

    setIsExporting(true)

    try {
      const response = await fetch(buildExportUrl(format), { method: "GET" })
      if (!response.ok) {
        const payload = await readJsonSafe(response)
        toast.error(resolveRefundExportErrorMessage(payload))
        return
      }

      const blob = await response.blob()
      const contentDisposition = response.headers.get("content-disposition") ?? ""
      const filenameMatch = contentDisposition.match(/filename="([^"]+)"/)
      const filename = filenameMatch?.[1] ?? (format === "xlsx" ? "reembolsos-export.xlsx" : "reembolsos-export.csv")

      const url = window.URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = filename
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      window.URL.revokeObjectURL(url)

      setExportDialogOpen(false)
      toast.success(`Exportación lista (${format.toUpperCase()})`)
    } catch {
      toast.error(resolveRefundExportErrorMessage(null))
    } finally {
      setIsExporting(false)
    }
  }

  function getExecuteBlockReason(): string | null {
    if (!selectedCase) return null
    if (requiresEvidenceForRefundExecution(selectedCase) && !actionForm.evidenceNote.trim() && !actionForm.externalRefundReference.trim()) {
      return "La ejecución requiere evidencia o referencia externa"
    }
    return null
  }

  async function handleSubmitAction() {
    if (!selectedCase) return

    let body: Record<string, unknown> | null = null

    if (activeAction === "approve") {
      if (!actionForm.reason.trim()) {
        toast.error("Indicá el motivo de aprobación")
        return
      }

      body = {
        action: "approve",
        reason: actionForm.reason.trim(),
        note: actionForm.note.trim() || undefined,
      }
    }

    if (activeAction === "reject") {
      if (!actionForm.reason.trim()) {
        toast.error("Indicá el motivo de rechazo")
        return
      }

      if (!actionForm.evidenceNote.trim() && !actionForm.externalRefundReference.trim()) {
        toast.error("El rechazo requiere evidencia o referencia externa")
        return
      }

      body = {
        action: "reject",
        reason: actionForm.reason.trim(),
        note: actionForm.note.trim() || undefined,
        evidence_note: actionForm.evidenceNote.trim() || undefined,
        external_refund_reference: actionForm.externalRefundReference.trim() || undefined,
      }
    }

    if (activeAction === "execute") {
      const blockReason = getExecuteBlockReason()
      if (blockReason) {
        toast.error(blockReason)
        return
      }

      body = {
        action: "execute",
        evidence_note: actionForm.evidenceNote.trim() || undefined,
        external_refund_reference: actionForm.externalRefundReference.trim() || undefined,
      }
    }

    if (activeAction === "resolve_non_refundable") {
      if (!actionForm.reason.trim()) {
        toast.error("Indicá el motivo del cierre")
        return
      }

      body = {
        action: "resolve_non_refundable",
        reason: actionForm.reason.trim(),
        note: actionForm.note.trim() || undefined,
      }
    }

    if (!body) return

    await withLoading(async () => {
      const response = await fetch(`/api/reembolsos/${selectedCase.case.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const payload = await readJsonSafe(response)
      if (!response.ok) {
        const error = payload && typeof payload === "object" && "error" in payload ? String(payload.error ?? "No se pudo actualizar el caso") : "No se pudo actualizar el caso"
        toast.error(error)
        return
      }

      setActiveAction(null)
      setExecuteConfirmOpen(false)
      setActionForm({
        ...INITIAL_ACTION_FORM,
        targetType: selectedCase.case.flow === "consumibles" ? "consumible_venta" : "entrada",
      })
      router.refresh()
      toast.success("Caso actualizado")
    })
  }

  const activeFilterLabels: string[] = []
  if (filters.query) activeFilterLabels.push(`Búsqueda: "${filters.query}"`)
  if (filters.buyer) activeFilterLabels.push(`Comprador: "${filters.buyer}"`)
  if (filters.event !== "all") activeFilterLabels.push(`Evento: "${filters.event}"`)
  if (filters.flow !== "all") activeFilterLabels.push(`Tipo: ${filters.flow}`)
  if (filters.sortOrder !== "date_desc") activeFilterLabels.push("Orden: más antiguo primero")

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reembolsos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gestión asistida anclada a compras reales. Entradas aprobadas intentan reembolso automático en Mercado Pago.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="min-h-8 px-3">{stats.total} Casos</Badge>
          <Badge variant="outline" className="min-h-8 px-3">{stats.byStatus.requested ?? 0} Solicitados</Badge>
          {(stats.byStatus.under_review ?? 0) > 0 && (
            <Badge variant="outline" className="min-h-8 px-3">{stats.byStatus.under_review} En revisión</Badge>
          )}
          <Badge variant="outline" className="min-h-8 px-3">{stats.byStatus.approved_for_manual_execution ?? 0} Aprobados</Badge>
          <Badge variant="outline" className="min-h-8 px-3">{stats.byStatus.rejected ?? 0} Rechazados</Badge>
          {(stats.byStatus.executed ?? 0) > 0 && (
            <Badge variant="outline" className="min-h-8 px-3">{stats.byStatus.executed} Ejecutados</Badge>
          )}
          <Badge variant="outline" className="min-h-8 px-3">{stats.byStatus.resolved_non_refundable ?? 0} No Reembolsables</Badge>
          {exportPath ? (
            <Button
              type="button"
              variant="default"
              size="sm"
              className="h-8 px-3 text-xs"
              onClick={() => setExportDialogOpen(true)}
            >
              Exportar
            </Button>
          ) : null}
        </div>
      </div>

      {access.canCreateManualCases ? (
        <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <Receipt className="mt-0.5 h-5 w-5 text-primary" />
            <div className="flex-1 space-y-4">
              <div>
                <h2 className="text-sm font-semibold text-foreground">Crear caso manual</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Abrí el caso desde un <code>checkout_session_id</code> real. Después vas a vincular items y definir el cierre.
                </p>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="refund-checkout-session">Checkout session</Label>
                  <Input
                    id="refund-checkout-session"
                    value={creating.checkoutSessionId}
                    onChange={(event) => setCreating((current) => ({ ...current, checkoutSessionId: event.target.value }))}
                    placeholder="cs_..."
                  />
                </div>

                <div className="space-y-2 md:col-span-2">
                  <Label htmlFor="refund-reason">Motivo</Label>
                  <Input
                    id="refund-reason"
                    value={creating.reason}
                    onChange={(event) => setCreating((current) => ({ ...current, reason: event.target.value }))}
                    placeholder="Ej: cancelación operativa o reclamo validado"
                  />
                </div>

                <div className="space-y-2 md:col-span-3">
                  <Label htmlFor="refund-note">Nota interna</Label>
                  <Textarea
                    id="refund-note"
                    value={creating.note}
                    onChange={(event) => setCreating((current) => ({ ...current, note: event.target.value }))}
                    placeholder="Contexto adicional para auditoría interna"
                    rows={3}
                  />
                </div>

              </div>

              <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                <Button type="button" onClick={handleCreateCase}>Crear caso</Button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {access.canCreateManualCases ? (
        <section className="rounded-2xl border border-primary/20 bg-primary/5 px-4 py-4 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-full bg-primary/15 p-2 text-primary">
                <Receipt className="h-4 w-4" />
              </div>
              <div>
                <Label htmlFor="buyer-refunds-enabled" className="text-sm font-semibold text-foreground">Reembolsos de comprador</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Si lo activás, cada evento puede decidir si expone el botón de reembolso. Si lo desactivás, ningún evento lo ofrece.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Badge variant="outline" className={buyerRefundsEnabled ? "border-success/40 bg-success/15 text-success" : "border-border bg-background text-muted-foreground"}>
                {buyerRefundsEnabled ? "Activo" : "Inactivo"}
              </Badge>
              {buyerRefundsSaving ? (
                <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Guardando...
                </span>
              ) : null}
              <div className="flex items-center gap-2">
                <Checkbox
                  id="buyer-refunds-enabled"
                  checked={buyerRefundsEnabled}
                  disabled={buyerRefundsSaving}
                  onCheckedChange={(checked) => handleToggleBuyerRefunds(checked === true)}
                />
                <label htmlFor="buyer-refunds-enabled" className="text-sm text-foreground cursor-pointer">Activar</label>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {access.canCreateManualCases ? (
        <section className="rounded-2xl border border-amber-500/40 bg-amber-500/10 px-4 py-4 shadow-sm">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full bg-amber-500/20 p-2 text-amber-700 dark:text-amber-400">
                  <AlertCircle className="h-4 w-4" />
                </div>
                <div>
                  <Label htmlFor="refund-auto-enabled" className="text-sm font-semibold text-foreground">Reembolsos automáticos</Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Si lo activás, los pedidos de comprador por QR se intentan ejecutar automáticamente para {getRefundAutomaticScopeLabel(automaticRefundForm.scope).toLowerCase()}.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Badge variant="outline" className={automaticRefundForm.enabled ? "border-success/40 bg-success/15 text-success" : "border-border bg-background text-muted-foreground"}>
                  {automaticRefundForm.enabled ? "Activo" : "Inactivo"}
                </Badge>
                {automaticRefundSaving ? (
                  <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Guardando...
                  </span>
                ) : null}
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="refund-auto-enabled"
                    checked={automaticRefundForm.enabled}
                    onCheckedChange={(checked) => setAutomaticRefundForm((current) => ({ ...current, enabled: checked === true }))}
                  />
                  <label htmlFor="refund-auto-enabled" className="text-sm text-foreground cursor-pointer">Activar</label>
                </div>
              </div>
            </div>

            {automaticRefundForm.enabled ? (
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-3">
                  <Label htmlFor="refund-auto-scope" className="shrink-0">Aplicar a</Label>
                  <div className="w-full max-w-sm">
                    <Select
                      value={automaticRefundForm.scope}
                      onValueChange={(value) => setAutomaticRefundForm((current) => ({ ...current, scope: value as RefundAutomaticConfig["scope"] }))}
                    >
                      <SelectTrigger id="refund-auto-scope" className="bg-background">
                        <SelectValue placeholder="Elegí un alcance" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="todos">Todos</SelectItem>
                        <SelectItem value="consumibles">Consumibles</SelectItem>
                        <SelectItem value="entradas">Entradas</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

              </div>
            ) : null}
          </div>
        </section>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(320px,0.95fr)_minmax(0,1.45fr)]">
        <section className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="rounded-t-2xl border-b border-primary/15 bg-primary/8 px-4 py-3">
            <h2 className="text-sm font-semibold text-foreground">Casos abiertos y trazabilidad</h2>
            <p className="mt-1 text-xs text-muted-foreground">Seleccioná un caso para revisar contexto, items y eventos.</p>
          </div>

          <div className="border-b border-primary/15 px-4 py-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="refund-filter-query">Buscar</Label>
                <Input
                  id="refund-filter-query"
                  value={filters.query}
                  onChange={(event) => setFilters((current) => ({ ...current, query: event.target.value }))}
                  placeholder="Motivo, checkout, evento o entrada"
                  className="h-10"
                />
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="refund-filter-buyer">Comprador</Label>
                <Input
                  id="refund-filter-buyer"
                  value={filters.buyer}
                  onChange={(event) => setFilters((current) => ({ ...current, buyer: event.target.value }))}
                  placeholder="Nombre del comprador"
                  className="h-10"
                />
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="refund-filter-flow">Tipo</Label>
                <Select
                  value={filters.flow}
                  onValueChange={(value) => setFilters((current) => ({ ...current, flow: value === "all" ? "all" : value as "entradas" | "consumibles" }))}
                >
                  <SelectTrigger id="refund-filter-flow" className="h-10 w-full bg-background border-input">
                    <SelectValue placeholder="Todos" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="entradas">Entradas</SelectItem>
                    <SelectItem value="consumibles">Consumibles</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="refund-filter-sort">Fecha</Label>
                <Select
                  value={filters.sortOrder}
                  onValueChange={(value) => setFilters((current) => ({ ...current, sortOrder: value as "date_desc" | "date_asc" }))}
                >
                  <SelectTrigger id="refund-filter-sort" className="h-10 w-full bg-background border-input">
                    <SelectValue placeholder="Más reciente primero" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date_desc">Más reciente primero</SelectItem>
                    <SelectItem value="date_asc">Más antiguo primero</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-3 space-y-1.5">
              <Label htmlFor="refund-filter-event">Evento</Label>
              <Select
                value={filters.event}
                onValueChange={(value) => setFilters((current) => ({ ...current, event: value }))}
              >
                <SelectTrigger id="refund-filter-event" className="h-10 w-full bg-background border-input">
                  <SelectValue placeholder="Todos los eventos" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos los eventos</SelectItem>
                  {eventOptions.map((eventName) => (
                    <SelectItem key={eventName} value={eventName}>{eventName}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="mt-3 flex justify-end">
              <Button type="button" variant="outline" className="h-10 px-4" onClick={() => setFilters(INITIAL_FILTERS)}>
                Limpiar filtros
              </Button>
            </div>
          </div>

          <div className="max-h-[70vh] overflow-y-auto p-3">
            {filteredCases.length === 0 ? (
              <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
                {cases.length === 0 ? (
                  <>
                    <p className="text-sm text-muted-foreground">No hay casos de reembolso todavía.</p>
                    <p className="mt-1 text-xs text-muted-foreground">Los casos aparecen cuando se inicia un proceso de reembolso.</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">No hay casos que coincidan con los filtros.</p>
                    <Button type="button" variant="ghost" size="sm" className="mt-3 h-8 text-xs" onClick={() => setFilters(INITIAL_FILTERS)}>
                      Limpiar filtros
                    </Button>
                  </>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {filteredCases.map((refundCase) => {
                  const statusMeta = getRefundStatusMeta(refundCase.status)
                  const flowMeta = getRefundFlowMeta(refundCase.flow)
                  const active = visibleSelectedCase?.case.id === refundCase.id

                  return (
                    <button
                      key={refundCase.id}
                      type="button"
                      onClick={() => updateSearchParams(refundCase.id)}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition ${
                        active
                          ? "border-primary/40 bg-primary/8 shadow-sm"
                          : "border-border bg-background hover:border-primary/20 hover:bg-accent/40"
                      }`}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge className={statusMeta.className}>{statusMeta.label}</Badge>
                        <Badge className={flowMeta.className}>{flowMeta.label}</Badge>
                        <Badge variant="outline">{getRefundOriginLabel(refundCase.request_origin)}</Badge>
                      </div>

                      <p className="mt-3 text-sm font-semibold text-foreground">{refundCase.request_reason}</p>
                      <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                        <p>Evento: {refundCase.requested_event_name ?? "Sin evento"}</p>
                        <p>Comprador: {refundCase.buyer_name ?? "—"}</p>
                        <p>Checkout: <span className="font-mono tabular-nums">{refundCase.checkout_session_id}</span></p>
                        <p><span className="font-mono tabular-nums">{formatMoney(refundCase.requested_amount)}</span> · {getRefundPaymentStatusLabel(refundCase.payment_status ?? "sin estado MP")}</p>
                        <p>Creado: {formatDateTime(refundCase.created_at)}</p>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        <section className="space-y-6">
          {visibleSelectedCase ? (
            <>
              <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge className={getRefundStatusMeta(visibleSelectedCase.case.status).className}>
                        {getRefundStatusMeta(visibleSelectedCase.case.status).label}
                      </Badge>
                      <Badge className={getRefundFlowMeta(visibleSelectedCase.case.flow).className}>
                        {getRefundFlowMeta(visibleSelectedCase.case.flow).label}
                      </Badge>
                      <Badge variant="outline">{getRefundOriginLabel(visibleSelectedCase.case.request_origin)}</Badge>
                      <Badge variant="outline" className="font-mono tabular-nums">{formatMoney(visibleSelectedCase.case.requested_amount)}</Badge>
                    </div>

                    <div>
                      <h2 className="text-xl font-semibold text-foreground">{visibleSelectedCase.case.request_reason}</h2>
                      <p className="mt-1 text-sm text-muted-foreground">Caso: <span className="font-mono tabular-nums">{visibleSelectedCase.case.id}</span> · Checkout: <span className="font-mono tabular-nums">{visibleSelectedCase.case.checkout_session_id}</span></p>
                    </div>
                  </div>

                </div>

                <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-xl border border-border bg-background px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Estado de pago</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{getRefundPaymentStatusLabel(visibleSelectedCase.case.payment_status)}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-background px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Reconciliación</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{getRefundReconciliationStatusLabel(visibleSelectedCase.case.reconciliation_status)}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-background px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Creado</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{formatDateTime(visibleSelectedCase.case.created_at)}</p>
                  </div>
                  <div className="rounded-xl border border-border bg-background px-4 py-3">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Resuelto</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{formatDateTime(visibleSelectedCase.case.resolved_at)}</p>
                  </div>
                </div>

                <div className="mt-5 grid gap-4 xl:grid-cols-2">
                  <div className="rounded-xl border border-border bg-background p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <ClipboardList className="h-4 w-4 text-primary" /> Contexto de compra
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                      <p><span className="font-medium text-foreground">Comprador:</span> {visibleSelectedCase.purchase_context?.buyer?.nombre ?? "—"}</p>
                      <p><span className="font-medium text-foreground">Email:</span> {visibleSelectedCase.purchase_context?.buyer?.email ?? "—"}</p>
                      <p><span className="font-medium text-foreground">Items en compra:</span> {visibleSelectedCase.purchase_context?.items_count ?? 0}</p>
                      <p><span className="font-medium text-foreground">Confirmada:</span> {formatDateTime(visibleSelectedCase.purchase_context?.confirmed_at)}</p>
                      <p><span className="font-medium text-foreground">Payment ID:</span> {visibleSelectedCase.purchase_context?.payment_id ?? "—"}</p>
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-background p-4">
                    <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                      <CheckCircle2 className="h-4 w-4 text-primary" /> Trazabilidad manual
                    </div>
                    <div className="mt-3 space-y-2 text-sm text-muted-foreground">
                      <p><span className="font-medium text-foreground">Solicitante:</span> {visibleSelectedCase.case.requester_actor_type} · {requesterLabel}</p>
                      <p><span className="font-medium text-foreground">Comprador:</span> {buyerLabel}</p>
                      <p><span className="font-medium text-foreground">Entrada solicitada:</span> {visibleSelectedCase.case.requested_entry_id ?? "—"}</p>
                      <p><span className="font-medium text-foreground">Evento solicitado:</span> {visibleSelectedCase.case.requested_event_name ?? visibleSelectedCase.case.requested_event_id ?? "—"}</p>
                      <p><span className="font-medium text-foreground">Nota inicial:</span> {visibleSelectedCase.case.request_note ?? "—"}</p>
                      <p><span className="font-medium text-foreground">Referencia externa:</span> {visibleSelectedCase.case.external_refund_reference ?? "—"}</p>
                      <p><span className="font-medium text-foreground">Evidencia:</span> {visibleSelectedCase.case.evidence_note ?? "—"}</p>
                      <p><span className="font-medium text-foreground">Policy Snapshot:</span> Empresa {visibleSelectedCase.case.company_policy_snapshot ? "Activa" : "Inactiva"} · Evento {visibleSelectedCase.case.event_policy_snapshot ? "Activo" : "Inactivo"}</p>
                    </div>
                  </div>
                </div>
              </article>

              <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 text-left"
                  onClick={() => setItemsCollapsed((current) => !current)}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    {visibleSelectedCase.case.flow === "entradas" ? <Ticket className="h-4 w-4 text-primary" /> : <Receipt className="h-4 w-4 text-primary" />}
                    Items Vinculados
                  </div>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${itemsCollapsed ? "-rotate-90" : "rotate-0"}`} />
                </button>

                <div className={`grid transition-all duration-300 ease-out ${itemsCollapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}>
                  <div className="overflow-hidden">
                    <div className="mt-4 space-y-3">
                    {visibleSelectedCase.items.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                        Todavía no hay items vinculados a este caso.
                      </div>
                    ) : (
                      visibleSelectedCase.items.map((item) => {
                        const eligibilityMeta = getRefundItemEligibilityMeta(item.eligibility)

                        return (
                          <div key={item.id} className="rounded-xl border border-border bg-background p-4">
                          <div className="flex flex-wrap items-center gap-2">
                              <div className="flex flex-1 flex-wrap items-center gap-2">
                                <Badge variant="outline">{getRefundTargetTypeLabel(item.target_type)}</Badge>
                                <Badge className={eligibilityMeta.className}>{eligibilityMeta.label}</Badge>
                              </div>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="icon"
                                      aria-label="Copiar ID de la entrada"
                                      className="h-8 w-8 shrink-0"
                                      onClick={() => void handleCopyItemId(item.target_id)}
                                    >
                                      <Clipboard className="h-4 w-4" aria-hidden />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent>Copiar ID de la entrada</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            </div>

                            <div className="mt-3 grid gap-2 text-sm text-muted-foreground md:grid-cols-2 xl:grid-cols-4">
                              <p><span className="font-medium text-foreground">Estado Anterior:</span> {getRefundTargetStatusLabel(item.target_status_before)}</p>
                              <p><span className="font-medium text-foreground">Estado Actual:</span> {getRefundTargetStatusLabel(item.target_status_after)}</p>
                              <p><span className="font-medium text-foreground">Monto:</span> <span className="font-mono tabular-nums">{item.amount_snapshot != null ? formatMoney(item.amount_snapshot) : "—"}</span></p>
                              <p><span className="font-medium text-foreground">Bloqueo:</span> {getRefundBlockReasonLabel(item.block_reason)}</p>
                            </div>

                            {item.target_type === "consumible_venta" && (visibleSelectedCase.consumible_items?.length ?? 0) > 0 ? (
                              <div className="mt-4 space-y-2 rounded-lg border border-dashed border-border p-3">
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Detalle por producto</p>
                                {visibleSelectedCase.consumible_items
                                  ?.filter((consumibleItem) => consumibleItem.venta_id === item.target_id)
                                  .map((consumibleItem) => (
                                    <div key={consumibleItem.id} className="grid gap-2 text-sm text-muted-foreground md:grid-cols-2 xl:grid-cols-5">
                                      <p><span className="font-medium text-foreground">Producto:</span> {consumibleItem.nombre}</p>
                                      <p><span className="font-medium text-foreground">Original:</span> {consumibleItem.quantity_original}</p>
                                      <p><span className="font-medium text-foreground">Solicitado:</span> {consumibleItem.quantity_requested}</p>
                                      <p><span className="font-medium text-foreground">Ejecutado:</span> {consumibleItem.quantity_executed}</p>
                                      <p><span className="font-medium text-foreground">Estado item:</span> {getRefundStatusMeta(consumibleItem.status).label}</p>
                                    </div>
                                  ))}
                              </div>
                            ) : null}
                          </div>
                        )
                      })
                    )}
                    </div>
                  </div>
                </div>
              </article>

              <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 text-left"
                  onClick={() => setTimelineCollapsed((current) => !current)}
                >
                  <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                    <Link2 className="h-4 w-4 text-primary" /> Timeline de Auditoría
                  </div>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${timelineCollapsed ? "-rotate-90" : "rotate-0"}`} />
                </button>

                <div className={`grid transition-all duration-300 ease-out ${timelineCollapsed ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100"}`}>
                  <div className="overflow-hidden">
                    <div className="mt-4 space-y-4">
                    {timeline.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
                        Este caso todavía no registró eventos visibles.
                      </div>
                    ) : (
                      timeline.map((entry, index) => (
                        <div key={entry.id} className="grid grid-cols-[18px_minmax(0,1fr)] gap-3">
                          <div className="flex flex-col items-center pt-4">
                            <div className="h-2.5 w-2.5 rounded-full bg-primary" />
                            {index < timeline.length - 1 ? <div className="mt-2 h-full w-px bg-border" /> : null}
                          </div>
                          <div className="flex-1 rounded-xl border border-border bg-background px-4 py-3">
                            <div className="flex flex-col gap-1 md:flex-row md:items-center md:justify-between">
                              <p className="text-sm font-semibold text-foreground">{entry.title}</p>
                              <p className="text-xs text-muted-foreground">{formatDateTime(entry.createdAt)}</p>
                            </div>
                            <p className="mt-2 text-sm text-muted-foreground">{entry.detail}</p>
                          </div>
                        </div>
                      ))
                    )}
                    </div>
                  </div>
                </div>
              </article>

              {visibleActions.length > 0 ? (
                <article className="rounded-2xl border border-border bg-card p-5 shadow-sm">
                  <h3 className="text-sm font-semibold text-foreground">Acciones disponibles</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Acciones disponibles en este caso.
                  </p>

                  <div className="mt-4 flex flex-wrap gap-3">
                    {visibleActions.map((action) => (
                      <Button
                        key={action.id}
                        type="button"
                        variant={activeAction === action.id ? "default" : "outline"}
                        disabled={action.disabled}
                        onClick={() => {
                          setActiveAction(action.id)
                          setActionForm({
                            ...INITIAL_ACTION_FORM,
                            targetType: visibleSelectedCase?.case.flow === "consumibles" ? "consumible_venta" : "entrada",
                          })
                        }}
                        title={action.disabledReason}
                      >
                        {action.label}
                      </Button>
                    ))}
                  </div>

                  {activeAction ? (
                    <div className="mt-5 rounded-2xl border border-border bg-background p-4">
                      <p className="text-sm font-semibold text-foreground">
                        {visibleActions.find((action) => action.id === activeAction)?.label}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {visibleActions.find((action) => action.id === activeAction)?.description}
                      </p>

                      {activeAction === "approve" || activeAction === "reject" || activeAction === "resolve_non_refundable" ? (
                        <div className="mt-4 grid gap-3">
                          <div className="space-y-2">
                            <Label htmlFor="refund-action-reason">Motivo</Label>
                            <Input
                              id="refund-action-reason"
                              value={actionForm.reason}
                              onChange={(event) => setActionForm((current) => ({ ...current, reason: event.target.value }))}
                              placeholder="Motivo visible para auditoría"
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="refund-action-note">Nota</Label>
                            <Textarea
                              id="refund-action-note"
                              value={actionForm.note}
                              onChange={(event) => setActionForm((current) => ({ ...current, note: event.target.value }))}
                              placeholder="Contexto adicional"
                              rows={4}
                            />
                          </div>
                        </div>
                      ) : null}

                      {activeAction === "reject" || activeAction === "execute" ? (
                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                          <div className="space-y-2 md:col-span-2">
                            <Label htmlFor="refund-action-evidence">Evidencia</Label>
                            <Textarea
                              id="refund-action-evidence"
                              value={actionForm.evidenceNote}
                              onChange={(event) => setActionForm((current) => ({ ...current, evidenceNote: event.target.value }))}
                              placeholder="Ej: comprobante, ticket o referencia operativa"
                              rows={4}
                            />
                          </div>
                          <div className="space-y-2 md:col-span-2">
                            <Label htmlFor="refund-action-reference">Referencia externa</Label>
                            <Input
                              id="refund-action-reference"
                              value={actionForm.externalRefundReference}
                              onChange={(event) => setActionForm((current) => ({ ...current, externalRefundReference: event.target.value }))}
                              placeholder="Ej: MP-REF-123"
                            />
                          </div>
                        </div>
                      ) : null}

                      <div className="mt-4 flex flex-wrap justify-end gap-2">
                        <Button type="button" variant="ghost" onClick={() => setActiveAction(null)}>
                          Cancelar
                        </Button>
                        <Button
                          type="button"
                          variant={activeAction === "execute" ? "destructive" : "default"}
                          onClick={() => {
                            if (activeAction === "execute") {
                              const blockReason = getExecuteBlockReason()
                              if (blockReason) {
                                toast.error(blockReason)
                                return
                              }
                              setExecuteConfirmOpen(true)
                              return
                            }
                            void handleSubmitAction()
                          }}
                        >
                          {activeAction === "execute" ? "Reembolsar…" : "Guardar acción"}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </article>
              ) : null}
            </>
          ) : (
            <div className="rounded-2xl border border-dashed border-border bg-card px-4 py-12 text-center text-sm text-muted-foreground shadow-sm">
              Seleccioná un caso para ver el detalle operativo.
            </div>
          )}
        </section>
      </div>

      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Exportar reembolsos</DialogTitle>
            <DialogDescription>
              Se exportarán los casos según los filtros activos actualmente.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Casos a exportar</p>
              <p className="mt-1 text-2xl font-bold text-foreground">{cases.length}</p>
              {activeFilterLabels.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {activeFilterLabels.map((label) => (
                    <li key={label} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span className="h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0" />
                      {label}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-xs text-muted-foreground">Sin filtros activos — se exportan todos los casos.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label>Formato</Label>
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant={exportFormat === "csv" ? "default" : "outline"}
                  className="h-9 gap-2"
                  onClick={() => setExportFormat("csv")}
                >
                  <FileText className="h-4 w-4" />
                  CSV
                </Button>
                <Button
                  type="button"
                  variant={exportFormat === "xlsx" ? "default" : "outline"}
                  className="h-9 gap-2"
                  onClick={() => setExportFormat("xlsx")}
                >
                  <FileSpreadsheet className="h-4 w-4" />
                  Excel
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={() => setExportDialogOpen(false)} disabled={isExporting}>
              Cancelar
            </Button>
            <Button type="button" onClick={() => void handleExport(exportFormat)} disabled={isExporting} className="gap-2">
              {isExporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {isExporting ? "Exportando..." : "Exportar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={executeConfirmOpen} onOpenChange={setExecuteConfirmOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Confirmar reembolso</DialogTitle>
            <DialogDescription>
              Esta acción ejecuta el reembolso en Mercado Pago y cierra el caso. No se puede deshacer.
            </DialogDescription>
          </DialogHeader>

          {visibleSelectedCase ? (
            <div className="space-y-3 py-2">
              <div className="rounded-xl border border-border bg-muted/30 px-4 py-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Monto a reembolsar</p>
                <p className="mt-1 font-mono text-2xl font-bold tabular-nums text-foreground">
                  {formatMoney(visibleSelectedCase.case.requested_amount)}
                </p>
              </div>
              <div className="rounded-xl border border-border bg-background px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Comprador</span>
                  <span className="font-medium text-foreground">{buyerLabel}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Evento</span>
                  <span className="font-medium text-foreground">{visibleSelectedCase.case.requested_event_name ?? "Sin evento"}</span>
                </div>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <span className="text-muted-foreground">Checkout</span>
                  <span className="font-mono text-xs text-foreground">{visibleSelectedCase.case.checkout_session_id}</span>
                </div>
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setExecuteConfirmOpen(false)}>
              Cancelar
            </Button>
            <Button type="button" variant="destructive" onClick={() => void handleSubmitAction()} className="gap-2">
              <Receipt className="h-4 w-4" aria-hidden />
              Confirmar reembolso
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
