"use client"

import { useCallback, useEffect, useState } from "react"
import { ClipboardList, Download, FileSearch, RefreshCw, Tag } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { SuperAdminPanel } from "@/components/super-admin/section-shell"
import { SAKpiCard, saKpiLabelCn, saKpiValueCn } from "@/components/super-admin/kpi-card"
import { useLoading } from "@/components/loading-provider"
import { useAppTheme, useOptionalSuperAdminTheme } from "@/components/theme-provider"
import { cn } from "@/lib/utils"
import { formatDateTime } from "@/lib/format"
import { number } from "@/components/super-admin/utils"
import { toast } from "sonner"

export type AuditLogActor = {
  id: string | null
  email: string | null
  label: string | null
  type: string | null
}

export type AuditLogEntity = {
  type: string | null
  id: string | null
  label: string | null
}

export type AuditLogEntry = {
  id: number
  createdAt: string
  actor: AuditLogActor
  action: string
  entity: AuditLogEntity
  payload: unknown
  ipAddress: string | null
}

export type AuditLogsPagination = {
  page: number
  limit: number
  total: number
  totalPages: number
}

export type AuditLogsData = {
  logs: AuditLogEntry[]
  pagination: AuditLogsPagination
  availableActions: string[]
}

type FiltersState = {
  action: string
  dateFrom: string
  dateTo: string
}

const ACTION_LABELS: Record<string, string> = {
  "platform.empresa.suspended": "Empresa suspendida",
  "platform.empresa.reactivated": "Empresa reactivada",
  "platform.empresa.public_disabled": "Cuenta pública desactivada",
  "platform.empresa.public_enabled": "Cuenta pública activada",
  "platform.empresa.fee_updated": "Fee actualizado",
  "platform.user.created": "Usuario creado",
  "platform.user.updated": "Usuario actualizado",
  "platform.user.deleted": "Usuario eliminado",
  "platform.payment_account.connected": "Cuenta de cobro conectada",
  "platform.payment_account.disconnected": "Cuenta de cobro desconectada",
}

function formatActionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action
}

function actionBadgeClass(action: string): string {
  if (
    action.includes("suspended") ||
    action.includes("public_disabled") ||
    action.includes("deleted") ||
    action.includes("disconnected")
  ) {
    return "!border-destructive/30 !bg-destructive/15 !text-destructive"
  }
  if (
    action.includes("reactivated") ||
    action.includes("public_enabled") ||
    action.includes("connected") ||
    action.includes("created")
  ) {
    return "!border-success/30 !bg-success/15 !text-success"
  }
  if (action.includes("fee_updated") || action.includes("updated")) {
    return "!border-warning/30 !bg-warning/15 !text-warning"
  }
  return "!border-primary/30 !bg-primary/15 !text-primary"
}

const POLL_MS = 30_000

function relativeTime(iso: string | undefined | null): string {
  if (!iso) return "—"
  const now = Date.now()
  const then = new Date(iso).getTime()
  const diff = Math.max(0, now - then)
  const seconds = Math.floor(diff / 1000)
  if (seconds < 60) return `hace ${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `hace ${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `hace ${hours}h`
  const days = Math.floor(hours / 24)
  return `hace ${days}d`
}

export default function AuditLogsSection({ initialData }: { initialData: AuditLogsData }) {
  const { withLoading } = useLoading()
  const { resolvedTheme } = useAppTheme()
  const superAdminTheme = useOptionalSuperAdminTheme()
  const effectiveTheme = superAdminTheme?.theme ?? resolvedTheme
  const [data, setData] = useState<AuditLogsData>(initialData)
  const [filters, setFilters] = useState<FiltersState>({ action: "all", dateFrom: "", dateTo: "" })
  const [page, setPage] = useState(initialData.pagination.page)
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null)
  const [lastFetchedAt, setLastFetchedAt] = useState<Date>(new Date())

  const fetchLogs = useCallback(
    async (nextPage: number, nextFilters: FiltersState) => {
      const params = new URLSearchParams()
      params.set("page", String(nextPage))
      params.set("limit", String(data.pagination.limit))
      if (nextFilters.action && nextFilters.action !== "all") params.set("action", nextFilters.action)
      if (nextFilters.dateFrom) params.set("dateFrom", nextFilters.dateFrom)
      if (nextFilters.dateTo) params.set("dateTo", nextFilters.dateTo)

      const res = await fetch(`/api/platform/audit-logs?${params.toString()}`)
      const body = await res.json()
      if (!res.ok) {
        toast.error(body?.error ?? "No se pudo cargar el registro de auditoría")
        return
      }
      setData(body.data as AuditLogsData)
      setPage(nextPage)
      setLastFetchedAt(new Date())
    },
    [data.pagination.limit],
  )

  useEffect(() => {
    setData(initialData)
    setPage(initialData.pagination.page)
  }, [initialData])

  // 30s polling — paused when the payload Dialog is open
  useEffect(() => {
    if (selectedLog) return
    const t = setInterval(() => void fetchLogs(page, filters), POLL_MS)
    return () => clearInterval(t)
  }, [fetchLogs, selectedLog, page, filters])

  const onApplyFilters = () => {
    void withLoading(() => fetchLogs(1, filters))
  }

  const onClearFilters = () => {
    const cleared = { action: "all", dateFrom: "", dateTo: "" }
    setFilters(cleared)
    void withLoading(() => fetchLogs(1, cleared))
  }

  const onPrev = () => {
    if (page <= 1) return
    void withLoading(() => fetchLogs(page - 1, filters))
  }

  const onNext = () => {
    if (page >= data.pagination.totalPages) return
    void withLoading(() => fetchLogs(page + 1, filters))
  }

  const onExportCsv = async () => {
    await withLoading(async () => {
      const params = new URLSearchParams()
      if (filters.action && filters.action !== "all") params.set("action", filters.action)
      if (filters.dateFrom) params.set("dateFrom", filters.dateFrom)
      if (filters.dateTo) params.set("dateTo", filters.dateTo)

      try {
        const res = await fetch(`/api/platform/audit-logs/export?${params.toString()}`)
        if (!res.ok) {
          toast.error("No se pudo exportar el CSV")
          return
        }
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
      } catch {
        toast.error("No se pudo descargar el CSV")
      }
    })
  }

  const hasActiveFilters =
    filters.action !== "all" || filters.dateFrom !== "" || filters.dateTo !== ""

  const from = data.pagination.total === 0 ? 0 : (page - 1) * data.pagination.limit + 1
  const to = Math.min(page * data.pagination.limit, data.pagination.total)

  return (
    <div className="space-y-6">
      {/* 1. Section header */}
      <header className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">
            Registro de auditoría
          </h1>
          <p className="text-sm text-muted-foreground">
            Acciones críticas del super-admin: suspensiones, cambios de fee, modificaciones de
            estado público. Útil para compliance y debugging.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void onExportCsv()}
          className="shrink-0 gap-2"
        >
          <Download className="h-3.5 w-3.5" />
          Exportar CSV
        </Button>
      </header>

      {/* 2. KPI strip */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SAKpiCard tone="neutral">
          <p className={cn(saKpiLabelCn, "flex items-center gap-1.5")}>
            <ClipboardList className="h-3.5 w-3.5" />
            Total registros
          </p>
          <p className={saKpiValueCn}>{number(data.pagination.total)}</p>
        </SAKpiCard>
        <SAKpiCard tone="neutral">
          <p className={cn(saKpiLabelCn, "flex items-center gap-1.5")}>
            <Tag className="h-3.5 w-3.5" />
            Tipos de acción
          </p>
          <p className={saKpiValueCn}>{number(data.availableActions.length)}</p>
        </SAKpiCard>
        <SAKpiCard tone="neutral">
          <p className={cn(saKpiLabelCn, "flex items-center gap-1.5")}>
            <RefreshCw className="h-3.5 w-3.5" />
            Última actividad
          </p>
          <p className={saKpiValueCn}>{relativeTime(data.logs[0]?.createdAt)}</p>
          {data.logs[0]?.createdAt && (
            <p className="font-mono text-[10px] tabular-nums text-muted-foreground/70">{formatDateTime(data.logs[0].createdAt)}</p>
          )}
        </SAKpiCard>
      </div>

      {/* 3. Filter panel */}
      {/* TODO: Replace date inputs with DatePicker once `npx shadcn@latest add calendar popover` is run */}
      <SuperAdminPanel>
        <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
          <div className="space-y-1.5">
            <Label
              htmlFor="filter-action"
              className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground"
            >
              Acción
            </Label>
            <Select
              value={filters.action}
              onValueChange={(value) => setFilters((prev) => ({ ...prev, action: value }))}
            >
              <SelectTrigger id="filter-action" className="h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent data-superadmin-theme={effectiveTheme} className="super-admin-theme-scope">
                <SelectItem value="all">Todas</SelectItem>
                {data.availableActions.map((action) => (
                  <SelectItem key={action} value={action}>
                    {formatActionLabel(action)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="filter-date-from"
              className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground"
            >
              Desde
            </Label>
            <input
              id="filter-date-from"
              type="date"
              value={filters.dateFrom}
              onChange={(e) => setFilters((prev) => ({ ...prev, dateFrom: e.target.value }))}
              className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <Label
              htmlFor="filter-date-to"
              className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground"
            >
              Hasta
            </Label>
            <input
              id="filter-date-to"
              type="date"
              value={filters.dateTo}
              onChange={(e) => setFilters((prev) => ({ ...prev, dateTo: e.target.value }))}
              className="h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="flex gap-2">
            <Button variant="default" onClick={onApplyFilters}>
              Aplicar
            </Button>
            <Button variant="outline" onClick={onClearFilters}>
              Limpiar
            </Button>
          </div>
        </div>
      </SuperAdminPanel>

      {/* 4. Table panel */}
      <SuperAdminPanel>
        {/* Toolbar row */}
        <div className="mb-4 flex items-center justify-between gap-4">
          <span className="text-xs text-muted-foreground">
            {data.pagination.total === 0
              ? "Sin registros"
              : `Mostrando ${number(from)}–${number(to)} de ${number(data.pagination.total)} registros`}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => void fetchLogs(page, filters)}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Actualizar
            </Button>
            <span className="text-xs text-muted-foreground">
              {relativeTime(lastFetchedAt.toISOString())}
            </span>
          </div>
        </div>

        {/* Empty state */}
        {data.logs.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border/60 py-12 text-center">
            <FileSearch className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">
              Sin registros para los filtros aplicados.
            </p>
            {hasActiveFilters && (
              <Button variant="outline" size="sm" onClick={onClearFilters}>
                Limpiar filtros
              </Button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full border-separate border-spacing-y-2 text-sm">
              <thead>
                <tr className="text-left text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  <th className="px-3 py-2 w-40">Fecha</th>
                  <th className="px-3 py-2">Actor</th>
                  <th className="px-3 py-2">Acción</th>
                  <th className="px-3 py-2">Entidad</th>
                  <th className="hidden px-3 py-2 text-right md:table-cell">IP</th>
                  <th className="px-3 py-2">Payload</th>
                </tr>
              </thead>
              <tbody>
                {data.logs.map((log) => (
                  <tr
                    key={log.id}
                    className="superadmin-row-card align-top transition dark:hover:bg-accent/30"
                  >
                    <td className="w-40 rounded-l-xl border-l border-border/40 px-3 py-3 font-mono tabular-nums text-xs text-foreground">
                      {formatDateTime(log.createdAt)}
                    </td>
                    <td className="px-3 py-3 text-foreground">
                      <p className="max-w-[160px] truncate font-medium">
                        {log.actor.label ?? log.actor.email ?? log.actor.id ?? "—"}
                      </p>
                      {log.actor.email && log.actor.label !== log.actor.email ? (
                        <p className="truncate text-xs text-muted-foreground">{log.actor.email}</p>
                      ) : null}
                      {log.actor.type ? (
                        <Badge
                          variant="outline"
                          className="mt-0.5 px-1.5 py-0 text-[10px] !border-border !bg-secondary !text-foreground"
                        >
                          {log.actor.type}
                        </Badge>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      <Badge
                        variant="outline"
                        className={cn("px-2.5 py-0.5 font-semibold", actionBadgeClass(log.action))}
                      >
                        {formatActionLabel(log.action)}
                      </Badge>
                    </td>
                    <td className="px-3 py-3 text-foreground">
                      <p className="max-w-[180px] truncate font-medium">
                        {log.entity.label ?? log.entity.id ?? "—"}
                      </p>
                      <p className="text-xs text-muted-foreground">{log.entity.type}</p>
                    </td>
                    <td className="hidden px-3 py-3 text-right md:table-cell">
                      <span className="font-mono text-xs text-muted-foreground">
                        {log.ipAddress ?? "—"}
                      </span>
                    </td>
                    <td className="rounded-r-xl border-r border-border/40 px-3 py-3">
                      {log.payload ? (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => setSelectedLog(log)}
                        >
                          Ver
                        </Button>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {data.pagination.totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between border-t border-border/40 pt-3">
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={onPrev}>
                Anterior
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= data.pagination.totalPages}
                onClick={onNext}
              >
                Siguiente
              </Button>
            </div>
            <span className="text-xs text-muted-foreground">
              Página {page} de {data.pagination.totalPages}
            </span>
          </div>
        )}
      </SuperAdminPanel>

      {/* 5. Payload Dialog */}
      <Dialog
        open={!!selectedLog}
        onOpenChange={(o) => {
          if (!o) setSelectedLog(null)
        }}
      >
        <DialogContent data-superadmin-theme={effectiveTheme} className="super-admin-theme-scope sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {selectedLog ? formatActionLabel(selectedLog.action) : ""}
            </DialogTitle>
            <DialogDescription>
              {selectedLog
                ? (selectedLog.entity.label ?? selectedLog.entity.id ?? "—")
                : ""}
            </DialogDescription>
          </DialogHeader>

          {selectedLog && (
            <>
              <div className="grid grid-cols-1 gap-3 rounded-xl border border-border/60 bg-muted/30 p-3 text-xs sm:grid-cols-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Fecha
                  </p>
                  <p className="mt-0.5 font-mono tabular-nums text-foreground">
                    {formatDateTime(selectedLog.createdAt)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Actor
                  </p>
                  <p className="mt-0.5 truncate text-foreground">
                    {selectedLog.actor.label ??
                      selectedLog.actor.email ??
                      selectedLog.actor.id ??
                      "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">IP</p>
                  <p className="mt-0.5 font-mono text-foreground">
                    {selectedLog.ipAddress ?? "—"}
                  </p>
                </div>
              </div>

              <pre className="mt-3 max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border/40 bg-muted/40 p-3 font-mono text-xs">
                {JSON.stringify(selectedLog.payload, null, 2)}
              </pre>
            </>
          )}

          <DialogFooter showCloseButton />
        </DialogContent>
      </Dialog>
    </div>
  )
}

